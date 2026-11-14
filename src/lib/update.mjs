import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile, readdir, lstat, realpath, readlink, mkdtemp, rm, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readInstallation } from './installation.mjs';
import { resolveOfficialSource, resolveRemote, runGit } from './git-remote.mjs';
import { acquireLock, createBackup, restoreBackup, cleanupBackups, snapshotTree, sha256 } from './install-backup.mjs';

const UPDATE_FLAGS = new Set(['--dry-run', '--json', '--accept-customized']);
export function parseUpdateArgs(argv) {
  const flags = { dryRun: false, json: false, acceptCustomized: false };
  for (const arg of argv) {
    if (!UPDATE_FLAGS.has(arg)) throw Object.assign(new Error(`unknown or extra update argument: ${arg}`), { code: 'USAGE' });
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flags[key]) throw Object.assign(new Error(`duplicate update argument: ${arg}`), { code: 'USAGE' });
    flags[key] = true;
  }
  return flags;
}

export function resolveInstallSource(repoUrl) {
  if (typeof repoUrl !== 'string' || !repoUrl.trim()) throw Object.assign(new Error('repository.url is missing or not a string'), { code: 'UNTRUSTED_SOURCE' });
  try { return resolveOfficialSource(repoUrl); }
  catch (error) { throw Object.assign(new Error(`invalid repository.url: ${error.message}`), { code: 'UNTRUSTED_SOURCE' }); }
}

async function findBundle(entry) {
  let directory = path.dirname(path.resolve(entry));
  while (true) {
    try {
      const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (pkg.name === 'agent-knowledge-engine') return { root: directory, package: pkg };
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
async function locateBundle(entry) { return (await findBundle(entry))?.package ?? null; }

// Checkout bootstrap is a deliberate exception, not inferred trust: Lead 裁决 2026-11-14.
export async function verifyCheckoutBootstrap({ entry, home, repoUrl, sourceInfo: expectedSourceInfo, gitRunner = runGit } = {}) {
  const checkout = await findBundle(entry);
  if (!checkout) throw Object.assign(new Error('cannot identify the AKE source checkout'), { code: 'IDENTITY_AMBIGUOUS' });
  if (typeof checkout.package.repository?.url !== 'string' || !checkout.package.repository.url.trim()) throw Object.assign(new Error(`checkout package.json is missing repository.url: ${path.join(checkout.root, 'package.json')}`), { code: 'UNTRUSTED_SOURCE' });
  let source = expectedSourceInfo;
  if (!source) {
    try { source = resolveInstallSource(checkout.package.repository.url); }
    catch (error) { throw Object.assign(new Error(`checkout repository.url is invalid: ${error.message}`), { code: 'UNTRUSTED_SOURCE' }); }
  }
  if (checkout.package.repository.url !== source.sourceUrl || (repoUrl && repoUrl !== source.sourceUrl)) throw Object.assign(new Error('checkout package repository.url is not the exact official repository URL'), { code: 'UNTRUSTED_SOURCE' });
  const skillDir = path.join(checkout.root, 'skills', 'ake');
  try { const info = await lstat(skillDir); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('checkout skills/ake is not a real directory'); }
  catch { throw Object.assign(new Error('checkout skills/ake is missing or unsafe'), { code: 'IDENTITY_AMBIGUOUS' }); }
  let origin, dirty, head;
  try {
    ({ stdout: origin } = await gitRunner(['-C', checkout.root, 'remote', 'get-url', 'origin']));
    ({ stdout: dirty } = await gitRunner(['-C', checkout.root, 'status', '--porcelain', '--', 'skills/ake']));
    ({ stdout: head } = await gitRunner(['-C', checkout.root, 'rev-parse', 'HEAD']));
  } catch (error) { throw Object.assign(new Error(`cannot verify checkout trust: ${error.message}`), { code: 'IDENTITY_AMBIGUOUS' }); }
  const originUrl = origin.trim();
  if (originUrl !== source.sourceUrl) throw Object.assign(new Error('checkout origin does not exactly match official repository URL'), { code: 'UNTRUSTED_SOURCE' });
  if (dirty.trim()) throw Object.assign(new Error('checkout skills/ake has local changes; refusing bootstrap'), { code: 'IDENTITY_AMBIGUOUS' });
  const fullHead = head.trim();
  if (!/^[0-9a-f]{40}$/i.test(fullHead)) throw Object.assign(new Error('checkout HEAD is not a full commit SHA'), { code: 'IDENTITY_AMBIGUOUS' });
  return { root: checkout.root, shortHead: fullHead.slice(0, 7), head: fullHead.toLowerCase(), skillDir, initiatedBy: 'checkout', bootstrap: true, scopeBefore: 'development' };
}

export async function resolveInstallation({ home = os.homedir(), env = process.env, entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/ake.mjs'), allowCompletedBootstrap = false, sourceInfo: expectedSourceInfo = null } = {}) {
  entry = path.resolve(entry);
  const entryInfo = await lstat(entry).catch(() => null);
  if (!entryInfo?.isFile() || entryInfo.isSymbolicLink()) throw Object.assign(new Error(`CLI entry is missing or not a regular file: ${entry}`), { code: 'IDENTITY_AMBIGUOUS' });
  const configuredAgentsHome = env.DSH_AGENTS_HOME && path.isAbsolute(env.DSH_AGENTS_HOME) ? path.resolve(env.DSH_AGENTS_HOME) : path.join(home, '.agents');
  const agentsHome = await realpath(configuredAgentsHome).catch(() => configuredAgentsHome);
  const canonical = path.join(agentsHome, 'skills', 'ake');
  const lockPath = path.join(agentsHome, '.skill-lock.json');
  const installation = await readInstallation({ entry, env, home });
  const checkoutBootstrap = installation.scope === 'development' ? await verifyCheckoutBootstrap({ entry, home, repoUrl: (await findBundle(entry))?.package?.repository?.url, sourceInfo: expectedSourceInfo }) : null;
  const issues = [];
  const defaultAgentsHome = await realpath(path.join(home, '.agents')).catch(() => path.join(home, '.agents'));
  if (agentsHome !== defaultAgentsHome) issues.push(`DSH_AGENTS_HOME points to ${agentsHome}, but Skills CLI is only verified to write HOME/.agents; reinstall under HOME/.agents or migrate manually before retrying`);
  let canonicalInfo = null;
  try { const stat = await lstat(canonical); if (stat.isSymbolicLink() || !stat.isDirectory()) issues.push('canonical installation is not a real directory'); else canonicalInfo = await realpath(canonical); }
  catch { issues.push('canonical installation is missing or unreadable'); }
  if (canonicalInfo && canonicalInfo !== canonical) issues.push('canonical path resolves outside the configured agentsHome layout');
  if (checkoutBootstrap) {
    if (!canonicalInfo) issues.push('checkout bootstrap target canonical installation is unavailable');
  } else if (installation.scope !== 'user' || installation.mode !== 'canonical' || installation.canonicalPath !== canonicalInfo || !installation.loadPath || await realpath(installation.loadPath) !== canonicalInfo) issues.push('cannot prove this process is using the canonical user Skill');
  const claude = path.join(home, '.claude', 'skills', 'ake');
  const agentPaths = [{ path: canonical, mode: 'canonical' }];
  try {
    const stat = await lstat(claude);
    if (stat.isSymbolicLink() && await realpath(claude) === canonicalInfo) agentPaths.push({ path: claude, mode: 'symlink' });
    else issues.push(`unsupported additional AKE path: ${claude}`);
  } catch (e) { if (e.code !== 'ENOENT') issues.push(`cannot inspect ${claude}`); }
  const allHomes = [path.join(home, '.agents', 'skills'), path.join(home, '.claude', 'skills')];
  const absent = error => error.code === 'ENOENT' || error.code === 'ENOTDIR';
  for (const name of await readdir(home).catch(error => absent(error) ? [] : Promise.reject(error))) {
    const owner = path.join(home, name);
    const ownerInfo = await lstat(owner).catch(() => null);
    if (!ownerInfo || (!ownerInfo.isDirectory() && !ownerInfo.isSymbolicLink())) continue;
    const candidate = path.join(owner, 'skills', 'ake');
    if (candidate === canonical || candidate === claude || (name === '.agents' && await realpath(candidate).catch(() => null) === canonicalInfo)) continue;
    try { await lstat(candidate); issues.push(`unsupported additional AKE path: ${candidate}`); }
    catch (error) { if (!absent(error)) issues.push(`cannot inspect ${candidate}`); }
  }
  for (const skillsDir of allHomes) {
    try { for (const name of await readdir(skillsDir)) if (name.toLowerCase() === 'ake' && path.join(skillsDir, name) !== claude && await realpath(path.join(skillsDir, name)).catch(() => null) !== canonicalInfo) issues.push(`unsupported AKE installation path: ${path.join(skillsDir, name)}`); }
    catch (e) { if (!absent(e)) issues.push(`cannot inspect ${skillsDir}`); }
  }
  let lockBytes, lock;
  try { const lockInfo = await lstat(lockPath); if (!lockInfo.isFile() || lockInfo.isSymbolicLink()) throw new Error('Skills lock is not a regular file'); lockBytes = await readFile(lockPath); lock = JSON.parse(lockBytes.toString('utf8')); }
  catch (e) { issues.push(e.code === 'ENOENT' ? 'Skills lock is missing' : 'Skills lock is unreadable or malformed'); }
  const item = lock?.skills?.ake;
  if (!item) issues.push('AKE lock entry is missing');
  else if (!['local', 'github'].includes(item.sourceType) || typeof item.source !== 'string') issues.push('AKE lock source type or source value is unsupported');
  const bundle = await findBundle(entry);
  if (!bundle) throw Object.assign(new Error(`cannot locate agent-knowledge-engine package.json from CLI entry: ${entry}`), { code: 'IDENTITY_AMBIGUOUS' });
  const bundleRepositoryUrl = bundle.package.repository?.url;
  let sourceInfo;
  if (expectedSourceInfo) {
    if (typeof expectedSourceInfo.sourceUrl !== 'string' || typeof expectedSourceInfo.repo !== 'string') throw Object.assign(new Error('carried-forward official source identity is incomplete'), { code: 'UNTRUSTED_SOURCE' });
    sourceInfo = expectedSourceInfo;
  } else {
    if (typeof bundleRepositoryUrl !== 'string' || !bundleRepositoryUrl.trim()) throw Object.assign(new Error(`AKE package.json is missing repository.url: ${path.join(bundle.root, 'package.json')}`), { code: 'UNTRUSTED_SOURCE' });
    try { sourceInfo = resolveInstallSource(bundleRepositoryUrl); }
    catch (error) { throw Object.assign(new Error(`invalid AKE package.json repository.url at ${path.join(bundle.root, 'package.json')}: ${error.message}`), { code: 'UNTRUSTED_SOURCE' }); }
  }
  const sourceKnown = typeof bundleRepositoryUrl === 'string' && bundleRepositoryUrl.trim().replace(/\/$/, '') === sourceInfo.sourceUrl.replace(/\/$/, '');
  const sourceDeclarationMissing = typeof bundleRepositoryUrl !== 'string' || !bundleRepositoryUrl.trim();
  if (item?.sourceType === 'github' && (item.sourceUrl?.replace(/\/$/, '') !== sourceInfo.sourceUrl.replace(/\/$/, '') || item.source !== sourceInfo.repo || item.skillPath !== 'skills/ake/SKILL.md')) issues.push('installed lock source is not the configured official repository/skill path');
  if (checkoutBootstrap && !allowCompletedBootstrap && item?.sourceType === 'github' && /^[0-9a-f]{40}$/i.test(item.ref ?? '') && item.skillPath === 'skills/ake/SKILL.md') issues.push('checkout bootstrap is only permitted for local or legacy installs; use the installed bundle for subsequent updates');
  if (issues.length) throw Object.assign(new Error(`${issues.join('; ')} (scope=${installation.scope ?? 'unknown'}, mode=${installation.mode ?? 'unknown'}, loadPath=${installation.loadPath ?? 'unknown'}, canonical=${installation.canonicalPath ?? 'unknown'}, expected=${canonicalInfo ?? 'unknown'})`), { code: 'IDENTITY_AMBIGUOUS', installation, issues });
  return { ...installation, canonicalPath: canonicalInfo, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths, agentsHome, lockPath, lock, lockBytes, sourceInfo, sourceKnown, sourceDeclarationMissing, initiatedBy: checkoutBootstrap ? 'checkout' : 'installed-bundle', bootstrap: Boolean(checkoutBootstrap), scopeBefore: checkoutBootstrap ? 'development' : installation.scope, checkout: checkoutBootstrap };
}

async function compareLocalSource(installation, gitRunner) {
  const source = installation.lock?.skills?.ake?.source;
  if (typeof source !== 'string' || !path.isAbsolute(source)) return { status: 'unknown', baseline: null };
  try {
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) return { status: 'unknown', baseline: null };
    const sourceRoot = await realpath(source);
    const canonicalFromParent = path.join(await realpath(path.dirname(source)), path.basename(source));
    if (sourceRoot !== canonicalFromParent) return { status: 'unknown', baseline: null };
    const bundle = await findBundle(path.join(sourceRoot, 'package.json'));
    if (bundle?.package?.name !== 'agent-knowledge-engine') return { status: 'unknown', baseline: null };
    const sourceSkill = path.join(sourceRoot, 'skills', 'ake');
    const skillInfo = await lstat(sourceSkill);
    if (!skillInfo.isDirectory() || skillInfo.isSymbolicLink() || !(await lstat(path.join(sourceSkill, 'SKILL.md'))).isFile()) return { status: 'unknown', baseline: null };
    const { stdout: gitRootOutput } = await gitRunner(['-C', sourceRoot, 'rev-parse', '--show-toplevel']);
    if (await realpath(gitRootOutput.trim()) !== sourceRoot) return { status: 'unknown', baseline: null };
    const { stdout } = await gitRunner(['-C', sourceRoot, 'status', '--porcelain', '--', 'skills/ake']);
    if (stdout.trim()) return { status: 'unknown', baseline: null };
    const sourceTree = await snapshotTree(sourceSkill), installedTree = await snapshotTree(installation.canonicalPath);
    const comparable = entries => entries.map(item => [item.relativePath, item.type, item.mode, item.sha256, item.linkTarget]).sort((a, b) => a[0].localeCompare(b[0]));
    return { status: JSON.stringify(comparable(sourceTree)) === JSON.stringify(comparable(installedTree)) ? 'clean' : 'modified', baseline: `local-source:${sourceRoot}` };
  } catch { return { status: 'unknown', baseline: null }; }
}

export async function detectCustomization(installation, remote, { gitRunner = runGit, tempDirectory = os.tmpdir(), report: details } = {}) {
  const lockItem = installation.lock?.skills?.ake;
  const ref = lockItem?.ref;
  if (lockItem?.sourceType === 'local' && !ref) {
    const baseline = await compareLocalSource(installation, gitRunner);
    if (details && baseline.baseline) details.baseline = baseline.baseline;
    return baseline.status;
  }
  if (lockItem?.sourceType !== 'github' || !/^[0-9a-f]{40}$/i.test(ref ?? '')) return 'unknown';
  const directory = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(tempDirectory, 'ake-custom-')));
  const bare = path.join(directory, 'old.git');
  try {
    await gitRunner(['init', '--bare', bare]);
    await gitRunner(['--git-dir', bare, 'fetch', '--no-tags', installation.sourceInfo.sourceUrl, ref]);
    const oldEntries = await snapshotGitTree(bare, ref, gitRunner);
    const localEntries = await snapshotTree(installation.canonicalPath);
    const comparable = entries => entries.map(item => [item.relativePath, item.type, item.mode, item.sha256, item.linkTarget]).sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(comparable(oldEntries)) === JSON.stringify(comparable(localEntries)) ? 'clean' : 'modified';
  } catch { return 'unknown'; }
  finally { await import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })); }
}

async function snapshotGitTree(bare, ref, gitRunner) {
  const { stdout } = await gitRunner(['--git-dir', bare, 'ls-tree', '-r', '-z', '--full-tree', ref, '--', 'skills/ake']);
  const files = [];
  const dirs = new Set();
  for (const record of stdout.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const relativePath = record.slice(tab + 1).replace(/^skills\/ake\//, '');
    let parent = path.posix.dirname(relativePath);
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent); }
    const base = { relativePath, mode: Number.parseInt(mode, 8) & 0o777 };
    if (mode === '120000') {
      const { stdout: target } = await gitRunner(['--git-dir', bare, 'cat-file', 'blob', object]);
      files.push({ ...base, type: 'symlink', sha256: null, linkTarget: String(target) });
    } else {
      const { stdout: contents } = await gitRunner(['--git-dir', bare, 'cat-file', 'blob', object], { encoding: 'buffer' });
      files.push({ ...base, type: 'file', sha256: sha256(contents), linkTarget: null });
    }
  }
  return [...dirs].map(relativePath => ({ relativePath, type: 'directory', mode: 0o755, sha256: null, linkTarget: null })).concat(files).sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
}

function spawnCapture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr || `skills exited ${code ?? signal}`), { code: 'INSTALL', exitCode: code, stderr })));
  });
}

async function snapshotInstallEffects(installation) {
  const lockInfo = await lstat(installation.lockPath);
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink()) throw new Error('Skills lock is not a regular file');
  const lock = JSON.parse(await readFile(installation.lockPath, 'utf8'));
  const nonAke = { ...lock.skills }; delete nonAke.ake;
  const listings = {}, protectedSkills = [];
  const skillsRoots = [path.join(installation.agentsHome, 'skills'), path.join(path.dirname(installation.agentsHome), '.claude', 'skills')];
  for (const directory of [...skillsRoots, path.join(path.dirname(installation.agentsHome), '.claude')]) {
    try {
      const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe side-effect directory: ${directory}`);
      const names = (await readdir(directory)).sort(); listings[directory] = names;
      if (skillsRoots.includes(directory)) for (const name of names) {
        if (name === 'ake') continue;
        const full = path.join(directory, name), entry = await lstat(full);
        if (entry.isSymbolicLink()) protectedSkills.push({ path: full, type: 'symlink', target: await readlink(full) });
        else if (entry.isDirectory()) protectedSkills.push({ path: full, type: 'directory', entries: await snapshotTree(full) });
        else if (entry.isFile()) protectedSkills.push({ path: full, type: 'file', mode: entry.mode & 0o777, sha256: sha256(await readFile(full)) });
        else throw new Error(`unsupported sibling skill entry: ${full}`);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; listings[directory] = null; }
  }
  const paths = [];
  for (const item of installation.agentPaths ?? []) {
    try { const stat = await lstat(item.path); paths.push({ path: item.path, type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'other', target: await realpath(item.path) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; paths.push({ path: item.path, type: 'missing' }); }
  }
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return JSON.stringify(stable({ nonAke, listings, paths, protectedSkills }));
}

export async function verifyInstalled(installation, remote) {
  const expected = new Map();
  for (const entry of remote.entries ?? []) {
    expected.set(entry.relativePath, entry);
    let parent = path.posix.dirname(entry.relativePath);
    while (parent !== '.') { expected.set(parent, { relativePath: parent, type: 'tree', mode: '040000' }); parent = path.posix.dirname(parent); }
  }
  const actual = await snapshotTree(installation.canonicalPath);
  if (actual.length !== expected.size) throw new Error('installed canonical tree contains missing or extra paths');
  for (const item of actual) {
    const wanted = expected.get(item.relativePath);
    if (!wanted) throw new Error(`unexpected installed path: ${item.relativePath}`);
    if (wanted.type === 'tree') { if (item.type !== 'directory') throw new Error(`target type mismatch: ${item.relativePath}`); continue; }
    const mode = Number.parseInt(wanted.mode, 8) & 0o777;
    if (wanted.type === 'blob' && wanted.mode === '120000') {
      if (item.type !== 'symlink' || item.linkTarget !== Buffer.from(wanted.bytes).toString()) throw new Error(`target symlink mismatch: ${item.relativePath}`);
    } else if (item.type !== 'file' || item.sha256 !== sha256(wanted.bytes) || (item.mode & 0o111) !== (mode & 0o111)) throw new Error(`target file mismatch: ${item.relativePath}`);
  }
  const lockInfo = await lstat(installation.lockPath);
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink()) throw new Error('installed Skills lock is not a regular file');
  const lockBytes = await readFile(installation.lockPath);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const item = lock.skills?.ake;
  if (item?.ref?.toLowerCase() !== remote.targetCommit || item?.skillPath !== 'skills/ake/SKILL.md' || item?.sourceType !== 'github' || item?.source !== remote.repo || item?.sourceUrl?.replace(/\/$/, '') !== remote.sourceUrl.replace(/\/$/, '')) throw new Error('installed Skills lock does not identify the exact target');
  for (const relative of ['SKILL.md', 'bootstrap.mjs', 'resources/ake-source/package.json', 'resources/ake-source/scripts/ake.mjs']) await readFile(path.join(installation.canonicalPath, relative));
}

function isWithinDirectory(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function createNpmWorkspace(home) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ake-npm-'));
  if (isWithinDirectory(home, directory)) {
    await rm(directory, { recursive: true, force: true });
    throw Object.assign(new Error('controlled npm temporary directory must not be inside HOME'), { code: 'PREFLIGHT' });
  }
  return directory;
}

async function stageLocalNpxCache(base, home, npmDirectory) {
  const configured = Object.entries(base).find(([key]) => key.toLowerCase() === 'npm_config_cache')?.[1];
  const defaultCache = process.platform === 'win32'
    ? path.join(base.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'npm-cache')
    : path.join(home, '.npm');
  const cachedPackages = path.join(configured ? path.resolve(configured) : defaultCache, '_npx');
  const info = await lstat(cachedPackages).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!info || !info.isDirectory() || info.isSymbolicLink()) return false;
  const isolatedCache = path.join(npmDirectory, 'cache');
  await mkdir(isolatedCache, { recursive: true });
  await cp(cachedPackages, path.join(isolatedCache, '_npx'), { recursive: true, dereference: false });
  return true;
}

function cacheTimestampIsSane(info) {
  return Number.isFinite(info.mtimeMs) && info.mtimeMs > 0 && info.mtimeMs <= Date.now() + 5 * 60_000;
}

async function realCacheDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) return null;
  const resolved = await realpath(directory);
  return resolved === path.resolve(directory) ? resolved : null;
}

export async function discoverCachedSkillsCli(home) {
  try {
    const homeReal = await realpath(home);
    const npmRoot = path.join(homeReal, '.npm');
    if (!await realCacheDirectory(npmRoot)) return [];
    const npxRoot = path.join(npmRoot, '_npx');
    const npxReal = await realCacheDirectory(npxRoot);
    if (!npxReal) return [];
    const entries = await readdir(npxReal, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) continue;
      try {
        const hashRoot = path.join(npxReal, entry.name);
        const hashReal = await realCacheDirectory(hashRoot);
        if (!hashReal) continue;
        const nodeModules = path.join(hashReal, 'node_modules');
        const packageDirectory = path.join(nodeModules, 'skills');
        const binDirectory = path.join(nodeModules, '.bin');
        const packageReal = await realCacheDirectory(packageDirectory);
        const binReal = await realCacheDirectory(binDirectory);
        const skillsBinReal = await realCacheDirectory(path.join(packageDirectory, 'bin'));
        if (!await realCacheDirectory(nodeModules) || !packageReal || !binReal || !skillsBinReal) continue;

        const binEntry = path.join(binReal, 'skills');
        const binInfo = await lstat(binEntry);
        if ((!binInfo.isFile() && !binInfo.isSymbolicLink()) || !cacheTimestampIsSane(binInfo)) continue;
        if (binInfo.isSymbolicLink() && await readlink(binEntry) !== '../skills/bin/cli.mjs') continue;

        const packageJsonPath = path.join(packageReal, 'package.json');
        const packageInfo = await lstat(packageJsonPath);
        if (!packageInfo.isFile() || packageInfo.isSymbolicLink() || !cacheTimestampIsSane(packageInfo)) continue;
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
        const packageBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.skills;
        if (packageJson.name !== 'skills' || typeof packageBin !== 'string' || path.isAbsolute(packageBin) || packageBin.split(/[\\/]/).includes('..')) continue;

        const expectedCli = path.join(skillsBinReal, 'cli.mjs');
        const cliInfo = await lstat(expectedCli);
        if (!cliInfo.isFile() || cliInfo.isSymbolicLink() || !cacheTimestampIsSane(cliInfo)) continue;
        const cliPath = await realpath(expectedCli);
        if (cliPath !== path.join(packageReal, 'bin', 'cli.mjs') || path.resolve(packageReal, packageBin) !== cliPath || !isWithinDirectory(packageReal, cliPath)) continue;
        if (binInfo.isSymbolicLink()) {
          if (await realpath(binEntry) !== cliPath) continue;
        } else if (!(await readFile(binEntry)).equals(await readFile(cliPath))) continue;
        candidates.push(cliPath);
      } catch { /* unreadable, anomalous, or malformed cache entries are unavailable */ }
    }
    return [...new Set(candidates)];
  } catch { return []; }
}

function parseCachedCliVersion(output) {
  const match = String(output).match(/\bv?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  return match ? { core: match.slice(1, 4).map(Number), prerelease: match[4] ?? '' } : null;
}

function compareCachedCliVersions(left, right) {
  for (let index = 0; index < 3; index++) if (left.version.core[index] !== right.version.core[index]) return right.version.core[index] - left.version.core[index];
  if (!left.version.prerelease && right.version.prerelease) return -1;
  if (left.version.prerelease && !right.version.prerelease) return 1;
  const prereleaseOrder = left.version.prerelease.localeCompare(right.version.prerelease);
  if (prereleaseOrder) return prereleaseOrder;
  return left.cliPath < right.cliPath ? -1 : left.cliPath > right.cliPath ? 1 : 0;
}

function makeSkillsEnvironment(base, home, npmDirectory) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (/^(GIT_.*|npm_config_.*)$/i.test(key)) delete env[key];
  return {
    ...env, HOME: home, TMPDIR: npmDirectory, TMP: npmDirectory, TEMP: npmDirectory,
    npm_config_cache: path.join(npmDirectory, 'cache'), npm_config_logs_dir: path.join(npmDirectory, 'logs'),
    npm_config_update_notifier: 'false',
  };
}

function writeDiagnostic(options, text) {
  const writer = options.writeStderr ?? (message => process.stderr.write(message));
  writer(`${text.replace(/\r?\n$/, '')}\n`);
}

function publicInstallation(value) {
  if (!value) return null;
  const { os: platform = process.platform, loadPath = null, canonicalPath = null, scope = null, mode = null, version = null, sourceType = null, commit = null, resourcesComplete = null, agentPaths = null, warnings = [] } = value;
  const source = value.sourceKnown === false ? null : sourceType === 'github' ? value.sourceInfo?.repo ?? null : sourceType === 'local' ? 'local' : null;
  return { os: platform, loadPath, canonicalPath, scope, mode, version, source, sourceType, commit, resourcesComplete, agentPaths, warnings, initiatedBy: value.initiatedBy ?? null, scopeBefore: value.scopeBefore ?? scope, bootstrap: value.bootstrap ?? false };
}

export async function runUpdate(options = {}) {
  const flags = options.flags ?? parseUpdateArgs(options.argv ?? []);
  const entry = options.entry ?? options.installationOptions?.entry ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/ake.mjs');
  let installationOptions = { ...(options.installationOptions ?? {}), entry };
  const output = { status: 'failed', stage: 'preflight', errorCode: null, message: '', dryRun: flags.dryRun, installationBefore: null, installationAfter: null, sourceUrl: null, defaultBranch: null, oldCommit: null, targetCommit: null, customization: null, baseline: null, backupPath: null, rollback: 'not_needed', warnings: [], initiatedBy: null, scopeBefore: null, bootstrap: false, reloadNotice: null };
  let heldLock = null, backup = null, installation, effectsBefore, installStarted = false, npmDirectory = null, skillsEnvironment = null;
  const report = (status, stage, code, message) => Object.assign(output, { status, stage, errorCode: code, message });
  try {
    const pkg = options.package ?? await locateBundle(entry);
    if (!pkg?.repository?.url) throw Object.assign(new Error('AKE bundle package.json has no repository.url'), { code: 'UNTRUSTED_SOURCE' });
    const source = resolveInstallSource(pkg.repository.url); output.sourceUrl = source.sourceUrl;
    installationOptions = { ...installationOptions, sourceInfo: source };
    try { npmDirectory = await createNpmWorkspace(options.home ?? os.homedir()); }
    catch (error) { throw Object.assign(new Error(`cannot create controlled temporary npm workspace: ${error.message}`), { code: 'PREFLIGHT' }); }
    const baseEnvironment = options.env ?? process.env;
    skillsEnvironment = makeSkillsEnvironment(baseEnvironment, options.home ?? os.homedir(), npmDirectory);
    const probeEnvironment = makeSkillsEnvironment(baseEnvironment, npmDirectory, npmDirectory);
    let cli = options.skillsCli ?? 'skills', cliPrefix = [];
    const probeSkillsCli = options.probeSkillsCli ?? ((command, args, env) => spawnCapture(command, args, { env, shell: false }));
    try { await probeSkillsCli(cli, ['--version'], probeEnvironment); }
    catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await stageLocalNpxCache(baseEnvironment, options.home ?? os.homedir(), npmDirectory);
          await probeSkillsCli('npx', ['--no-install', 'skills', '--version'], probeEnvironment);
          cli = 'npx'; cliPrefix = ['--no-install', 'skills'];
          output.warnings.push('通过 npx --no-install 使用本地 Skills CLI 缓存；这不证明其版本或完整性，也未自动下载');
        } catch (fallbackError) {
          writeDiagnostic(options, `npx --no-install skills --version failed: ${fallbackError.stderr ?? fallbackError.message}`);
          const runnable = [];
          const candidates = await (options.discoverSkillsCli ?? discoverCachedSkillsCli)(options.home ?? os.homedir()).catch(() => []);
          for (const candidate of candidates) {
            try {
              const result = await probeSkillsCli(process.execPath, [candidate, '--version'], probeEnvironment);
              const version = parseCachedCliVersion(result?.stdout);
              if (version) runnable.push({ cliPath: candidate, version });
            } catch (candidateError) { writeDiagnostic(options, `cached Skills CLI probe failed for ${candidate}: ${candidateError.stderr ?? candidateError.message}`); }
          }
          runnable.sort(compareCachedCliVersions);
          const discovered = runnable[0]?.cliPath;
          if (!discovered) throw Object.assign(new Error('Skills CLI unavailable; npx --no-install fallback was attempted without downloading and failed. 请先安装 Vercel Skills CLI（例如 npm i -g skills），本次未自动下载。'), { code: 'PREFLIGHT' });
          cli = process.execPath; cliPrefix = [discovered];
          output.warnings.push('使用本机 npx 缓存中的 Skills CLI（只读发现）；版本和完整性未验证');
        }
      } else {
        writeDiagnostic(options, `skills --version failed: ${error.stderr ?? error.message}`);
        throw Object.assign(new Error('Skills CLI is unavailable. 请先安装 Vercel Skills CLI（例如 npm i -g skills）；未自动启动 npx 安装。'), { code: 'PREFLIGHT' });
      }
    }
    installation = await (options.resolveInstallation ?? resolveInstallation)(installationOptions);
    output.installationBefore = publicInstallation(installation);
    output.initiatedBy = installation.initiatedBy ?? 'installed-bundle'; output.scopeBefore = installation.scopeBefore ?? installation.scope; output.bootstrap = Boolean(installation.bootstrap);
    if (output.bootstrap) output.warnings.push('本次更新经源码 checkout 引导，目标为用户级安装');
    const recordedRef = installation.lock?.skills?.ake?.ref;
    output.oldCommit = /^[0-9a-f]{40}$/i.test(recordedRef ?? '') ? recordedRef.toLowerCase() : null;
    const remote = await (options.resolveRemote ?? resolveRemote)({ repoUrl: pkg.repository.url, gitRunner: options.gitRunner });
    output.defaultBranch = remote.defaultBranch; output.targetCommit = remote.targetCommit;
    const existingRef = output.oldCommit;
    if (installation.lock?.skills?.ake?.sourceType === 'github' && existingRef === remote.targetCommit) {
      let check = false;
      try { check = options.isCurrent ? await options.isCurrent(installation, remote) : (await verifyInstalled(installation, remote), true); } catch { check = false; }
      if (check === true) { report('up_to_date', 'complete', null, 'AKE is already up to date'); return output; }
    }
    if (flags.dryRun) { report('dry_run', 'plan', null, `Would update from ${existingRef ?? 'unknown/local'} to ${remote.targetCommit}; no installation changes made`); return output; }
    const bootstrapInProgress = Boolean(installation.bootstrap);
    heldLock = await (options.acquireLock ?? acquireLock)(installation.agentsHome);
    installation = await (options.resolveInstallation ?? resolveInstallation)({ ...installationOptions, allowCompletedBootstrap: bootstrapInProgress });
    output.installationBefore = publicInstallation(installation);
    const customizationDetails = {};
    const customization = await (options.detectCustomization ?? detectCustomization)(installation, remote, { gitRunner: options.gitRunner, report: customizationDetails });
    output.customization = customization; output.baseline = customizationDetails.baseline ?? null;
    // Explicit customized-source opt-in is a deliberate Lead 裁决 2026-11-14; never infer it from dry-run or status.
    if (customization !== 'clean' && !flags.acceptCustomized) throw Object.assign(new Error(`local installation is ${customization}; back it up and rerun only after explicit approval with --accept-customized`), { code: 'CUSTOMIZED_CONFIRMATION_REQUIRED' });
    effectsBefore = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
    backup = await (options.createBackup ?? createBackup)({ agentsHome: installation.agentsHome, installation, lockPath: installation.lockPath, targetCommit: remote.targetCommit });
    output.backupPath = backup.backupPath;
    const effectsAtBackup = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
    if (effectsAtBackup !== effectsBefore) throw Object.assign(new Error('installation side effects changed while creating backup'), { code: 'DRIFT' });
    const agentArgs = ['-a', 'codex']; if ((installation.agentPaths ?? []).some(x => x.path.endsWith(path.join('.claude', 'skills', 'ake')))) agentArgs.push('-a', 'claude-code');
    installStarted = true;
    try { await (options.runSkillsAdd ?? spawnCapture)(cli, [...cliPrefix, 'add', `${source.repo}@${remote.targetCommit}`, '--skill', 'ake', '-g', '-y', ...agentArgs], { env: skillsEnvironment, shell: false }); }
    catch (error) { throw Object.assign(error, { code: error.code ?? 'INSTALL' }); }
    try {
      const effectsAfter = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
      if (effectsBefore !== effectsAfter) throw new Error('Skills CLI changed non-AKE lock entries, agent directory entries, or canonical/link identity');
      await (options.verifyInstalled ?? verifyInstalled)(installation, remote);
    } catch (error) { throw Object.assign(error, { code: error.code ?? 'VERIFY' }); }
    const installationAfter = await (options.readAfter ?? (async () => await resolveInstallation({ ...installationOptions, allowCompletedBootstrap: Boolean(installation.bootstrap) })))();
    output.installationAfter = publicInstallation(installationAfter);
    if (installationAfter.sourceDeclarationMissing) output.warnings.push('已安装版本未声明 repository.url；下次更新需要包含该字段的版本，否则将因无法确认来源而拒绝');
    try { output.warnings.push(...await (options.cleanupBackups ?? cleanupBackups)(installation.agentsHome, { currentBackup: backup.backupPath })); }
    catch (error) { output.warnings.push(`backup cleanup failed; retained backups: ${error.message}`); }
    output.reloadNotice = 'DSH 每次加载/注入 Skill 时读取磁盘；本 Session 已注入的旧内容不会自动刷新。更新后请在新消息中重新调用 `/ake`，若上下文仍使用旧注入内容，请新开 Session 后再试；无需声称必须重启 DSH。';
    report('updated', 'complete', null, 'AKE updated and verified; replacement is non-atomic');
  } catch (error) {
    if (!output.installationBefore && error.installation) output.installationBefore = publicInstallation(error.installation);
    output.rollback = 'not_needed';
    if (backup && installStarted) {
      try {
        await (options.restoreBackup ?? restoreBackup)(backup, { lockPath: installation.lockPath });
        if (typeof effectsBefore !== 'undefined') {
          const effectsAfterRollback = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
          if (effectsAfterRollback !== effectsBefore) throw new Error('post-rollback side-effect snapshot differs from pre-install state');
        }
        output.rollback = 'succeeded';
      }
      catch (rollbackError) { output.warnings.push(...(rollbackError.warnings ?? [])); output.rollback = 'failed'; output.backupPath = backup.backupPath; report('failed', 'rollback', 'ROLLBACK_FAILED', `${error.message}; rollback failed: ${rollbackError.message}; preserve backup and reconcile the listed paths manually from ${backup.backupPath}`); }
    }
    if (backup && !installStarted) output.warnings.push('安装进程尚未启动；保留已验证备份，不恢复现场');
    if (output.rollback !== 'failed') {
      const stages = { USAGE: 'arguments', PREFLIGHT: 'preflight', UNTRUSTED_SOURCE: 'identity', IDENTITY_AMBIGUOUS: 'identity', REMOTE: 'remote', LOCKED: 'lock', CUSTOMIZED_CONFIRMATION_REQUIRED: 'customization', BACKUP: 'backup', INSTALL: 'install', VERIFY: 'verify', DRIFT: 'backup' };
      report('failed', stages[error.code] ?? 'update', error.code ?? 'UPDATE', error.message);
    }
  } finally {
    await heldLock?.release().catch(error => output.warnings.push(`could not release lock: ${error.message}`));
    if (npmDirectory) await rm(npmDirectory, { recursive: true, force: true }).catch(error => output.warnings.push(`could not remove controlled npm workspace ${npmDirectory}: ${error.message}`));
  }
  return output;
}

export function updateExitCode(result) { return result.errorCode === 'USAGE' ? 2 : result.status === 'failed' ? 1 : 0; }
