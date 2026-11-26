import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile, readdir, lstat, realpath, readlink, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readInstallation } from './installation.mjs';
import { resolveOfficialSource, resolveRemote, runGit } from './git-remote.mjs';
import { acquireLock, createBackup, validateBackup, verifyRollbackAnchors, cleanupBackups, snapshotTree, sha256 } from './install-backup.mjs';

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
  const codebuddy = path.join(home, '.codebuddy', 'skills', 'ake');
  const agentPaths = [{ path: canonical, mode: 'canonical' }];
  for (const candidate of [claude, codebuddy]) {
    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink() && await realpath(candidate) === canonicalInfo) agentPaths.push({ path: candidate, mode: 'symlink' });
      else issues.push(`unsupported additional AKE path: ${candidate}`);
    } catch (e) { if (e.code !== 'ENOENT') issues.push(`cannot inspect ${candidate}`); else if (await lstat(candidate).catch(() => null)) issues.push(`broken AKE symlink: ${candidate}`); }
  }
  if (agentPaths.some(item => item.path === codebuddy) && !agentPaths.some(item => item.path === claude)) issues.push('CodeBuddy-only linked topology is not safely supported');
  const allHomes = [path.join(home, '.agents', 'skills'), path.join(home, '.claude', 'skills'), path.join(home, '.codebuddy', 'skills')];
  const absent = error => error.code === 'ENOENT' || error.code === 'ENOTDIR';
  for (const name of await readdir(home).catch(error => absent(error) ? [] : Promise.reject(error))) {
    const owner = path.join(home, name);
    const ownerInfo = await lstat(owner).catch(() => null);
    if (!ownerInfo || (!ownerInfo.isDirectory() && !ownerInfo.isSymbolicLink())) continue;
    const candidate = path.join(owner, 'skills', 'ake');
    if (candidate === canonical || candidate === claude || candidate === codebuddy || (name === '.agents' && await realpath(candidate).catch(() => null) === canonicalInfo)) continue;
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

function comparableTree(entries, platform) {
  return entries.map(item => {
    let mode = item.mode;
    if (item.type === 'symlink') mode = null;
    else if (platform === 'win32') {
      // Git tracks only the executable bit for regular files; Windows exposes writable/read-only, not POSIX execute bits.
      mode = item.type === 'file' ? ((item.mode & 0o222) ? 'writable' : 'read-only') : null;
    }
    return [item.relativePath, item.type, mode, item.sha256, item.linkTarget];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}

async function compareLocalSource(installation, gitRunner, platform) {
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
    return { status: JSON.stringify(comparableTree(sourceTree, platform)) === JSON.stringify(comparableTree(installedTree, platform)) ? 'clean' : 'modified', baseline: `local-source:${sourceRoot}` };
  } catch { return { status: 'unknown', baseline: null }; }
}

export async function detectCustomization(installation, remote, { gitRunner = runGit, tempDirectory = os.tmpdir(), report: details, platform = process.platform } = {}) {
  const lockItem = installation.lock?.skills?.ake;
  const ref = lockItem?.ref;
  if (lockItem?.sourceType === 'local' && !ref) {
    const baseline = await compareLocalSource(installation, gitRunner, platform);
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
    return JSON.stringify(comparableTree(oldEntries, platform)) === JSON.stringify(comparableTree(localEntries, platform)) ? 'clean' : 'modified';
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

export async function resolveWindowsCli(command, { env = process.env } = {}) {
  const envValue = name => env[Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())];
  const extensions = (envValue('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  let match = null;
  for (const directory of (envValue('PATH') ?? '').split(';').filter(Boolean)) {
    const names = extensions.map(extension => `${command}${extension}`);
    for (const name of names) {
      const requested = path.resolve(directory, name);
      const actual = (await readdir(directory).catch(() => [])).find(item => item.toLowerCase() === path.basename(requested).toLowerCase());
      if (!actual) continue;
      const candidate = path.join(directory, actual);
      const info = await lstat(candidate).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink()) { match = { candidate, extension: path.extname(candidate).toLowerCase() }; break; }
    }
    if (match) break;
  }
  if (!match) return null;
  if (['.exe', '.com'].includes(match.extension)) return { command: match.candidate, prefix: [] };
  if (match.extension !== '.cmd') return null;
  const directories = [...new Set([path.dirname(match.candidate), path.dirname(process.execPath)])];
  for (const directory of directories) {
    const packageName = ['npx', 'npm'].includes(command) ? 'npm' : 'skills';
    const packageRoot = path.join(directory, 'node_modules', packageName);
    try {
      const packagePath = path.join(packageRoot, 'package.json'), packageStat = await lstat(packagePath);
      if (!packageStat.isFile() || packageStat.isSymbolicLink()) continue;
      const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
      if (pkg.name !== packageName) continue;
      const bin = command === 'npx' ? pkg.bin?.npx : command === 'npm' ? pkg.bin?.npm : (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.skills);
      if (typeof bin !== 'string' || path.isAbsolute(bin) || bin.split(/[\\/]/).includes('..')) continue;
      const cliPath = path.resolve(packageRoot, bin);
      const cliStat = await lstat(cliPath);
      const packageReal = await realpath(packageRoot), cliReal = await realpath(cliPath);
      if (!cliStat.isFile() || cliStat.isSymbolicLink() || !isWithinDirectory(packageReal, cliReal, 'win32')) continue;
      return { command: process.execPath, prefix: [cliReal] };
    } catch { /* invalid package metadata or files are unavailable */ }
  }
  return null;
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
  const nonAke = { ...lock, skills: { ...lock.skills } }; delete nonAke.skills.ake;
  const listings = {}, protectedSkills = [];
  const home = path.dirname(installation.agentsHome);
  const skillsRoots = [path.join(installation.agentsHome, 'skills'), ...['.claude', '.codebuddy'].map(agent => path.join(home, agent, 'skills'))];
  for (const directory of [...skillsRoots, path.join(home, '.claude'), path.join(home, '.codebuddy')]) {
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
    try { const stat = await lstat(item.path); paths.push({ path: item.path, type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'other', target: await realpath(item.path), linkTarget: stat.isSymbolicLink() ? await readlink(item.path) : null }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; paths.push({ path: item.path, type: 'missing' }); }
  }
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return JSON.stringify(stable({ nonAke, listings, paths, protectedSkills }));
}

export async function verifyInstalled(installation, remote, { platform = process.platform } = {}) {
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
    } else {
      // Windows filesystems expose read-only state, not Git's executable bit; compare the former and preserve raw-byte checks.
      const modeMismatch = platform === 'win32'
        ? Boolean(item.mode & 0o222) !== Boolean(mode & 0o222)
        : (item.mode & 0o111) !== (mode & 0o111);
      if (item.type !== 'file' || item.sha256 !== sha256(wanted.bytes) || modeMismatch) throw new Error(`target file mismatch: ${item.relativePath}`);
    }
  }
  const lockInfo = await lstat(installation.lockPath);
  if (!lockInfo.isFile() || lockInfo.isSymbolicLink()) throw new Error('installed Skills lock is not a regular file');
  const lockBytes = await readFile(installation.lockPath);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const item = lock.skills?.ake;
  if (item?.ref?.toLowerCase() !== remote.targetCommit || item?.skillPath !== 'skills/ake/SKILL.md' || item?.sourceType !== 'github' || item?.source !== remote.repo || item?.sourceUrl?.replace(/\/$/, '') !== remote.sourceUrl.replace(/\/$/, '')) throw new Error('installed Skills lock does not identify the exact target');
  const skillText = await readFile(path.join(installation.canonicalPath, 'SKILL.md'), 'utf8');
  const required = ['bootstrap.mjs', 'resources/ake-source/package.json', 'resources/ake-source/scripts/ake.mjs'];
  // Literal marker heuristic only; this is not semantic validation or authentication.
  for (const helper of ['preflight.mjs', 'init-git.mjs']) if (skillText.includes(helper)) required.push(helper);
  for (const relative of required) await readFile(path.join(installation.canonicalPath, relative));
}

function isWithinDirectory(parent, target, platform = process.platform) {
  let relative = path.relative(path.resolve(parent), path.resolve(target));
  if (platform === 'win32') relative = relative.toLowerCase();
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePath(left, right, platform) {
  const normalize = value => path.resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
  return platform === 'win32' ? normalize(left).toLowerCase() === normalize(right).toLowerCase() : normalize(left) === normalize(right);
}

export async function createNpmWorkspace(home, { platform = process.platform, tempRoot = os.tmpdir(), env = process.env, entry, projectRoot = process.cwd() } = {}) {
  const tempInfo = await lstat(tempRoot).catch(() => null);
  if (!tempInfo?.isDirectory() || tempInfo.isSymbolicLink()) throw new Error('temporary root is not a real directory');
  const tempReal = await realpath(tempRoot);
  const directory = await mkdtemp(path.join(tempRoot, 'ake-npm-'));
  try {
    const info = await lstat(directory);
    const directoryReal = await realpath(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !isWithinDirectory(tempRoot, directory, platform) || !isWithinDirectory(tempReal, directoryReal, platform)) throw new Error('temporary directory escaped its root');
    const protectedRoots = [path.join(home, '.agents'), env.DSH_AGENTS_HOME, entry ? (await findBundle(entry))?.root : null, projectRoot].filter(Boolean);
    const protectedRealRoots = await Promise.all(protectedRoots.map(root => realpath(root).catch(() => path.resolve(root))));
    if ([...protectedRoots, ...protectedRealRoots].some(root => isWithinDirectory(root, directory, platform) || isWithinDirectory(root, directoryReal, platform))) throw new Error('temporary directory is inside a protected AKE or project path');
    const homeReal = await realpath(home).catch(() => path.resolve(home));
    if (platform !== 'win32') {
      if ([home, homeReal].some(root => isWithinDirectory(root, directory, platform) || isWithinDirectory(root, directoryReal, platform))) throw new Error('controlled npm temporary directory must not be inside HOME');
    } else if ([home, homeReal].some(root => isWithinDirectory(root, directory, platform) || isWithinDirectory(root, directoryReal, platform))) {
      const homeRelative = path.resolve(homeReal, path.relative(path.resolve(home), path.resolve(tempRoot)));
      const identityHolds = samePath(tempReal, homeRelative, platform) || !isWithinDirectory(homeReal, tempReal, platform);
      const allowed = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Temp'), path.join(home, 'AppData', 'Local', 'Temp')].filter(Boolean);
      const allowedPairs = await Promise.all(allowed.map(async root => ({ lexical: root, real: await realpath(root).catch(() => null) })));
      if (!identityHolds || !allowedPairs.some(({ lexical, real }) => real && isWithinDirectory(lexical, directory, platform) && isWithinDirectory(real, directoryReal, platform))) throw new Error('temporary directory inside HOME is not a standard Temp directory');
    }
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw Object.assign(error, { code: 'PREFLIGHT' });
  }
}


export function makeSkillsEnvironment(base, home, npmDirectory, platform = process.platform) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (/^(GIT_.*|npm_config_.*|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|XDG_CONFIG_HOME|XDG_CACHE_HOME|CLAUDE_CONFIG_DIR|CODEX_HOME|VIBE_HOME|HERMES_HOME|AUTOHAND_HOME|GROK_HOME|SARVAM_HOME|REASONIX_HOME|FLATPAK_XDG_CONFIG_HOME)$/i.test(key)) delete env[key];
  const paths = platform === 'win32' ? path.win32 : path;
  const result = {
    ...env, HOME: home, USERPROFILE: home, APPDATA: paths.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: paths.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: paths.join(home, '.config'), XDG_CACHE_HOME: paths.join(home, '.cache'),
    TMPDIR: npmDirectory, TMP: npmDirectory, TEMP: npmDirectory,
    npm_config_cache: path.join(npmDirectory, 'cache'), npm_config_logs_dir: path.join(npmDirectory, 'logs'),
    npm_config_update_notifier: 'false',
  };
  if (platform === 'win32') {
    const root = paths.parse(home).root;
    const drive = root.replace(/[\\/]+$/, '');
    const relative = paths.relative(root, home);
    result.HOMEDRIVE = drive;
    result.HOMEPATH = relative ? `\\${relative}` : '\\';
  }
  return result;
}

async function assertRealHome(home, platform, label) {
  const info = await lstat(home).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error(`${label} is missing, not a real directory, or is a symlink`), { code: 'PREFLIGHT' });
  return realpath(home);
}

async function verifyHomeSentinel(home, env, platform, label) {
  const expected = await assertRealHome(home, platform, label);
  const { stdout } = await spawnCapture(process.execPath, ['-e', "process.stdout.write(require('node:os').homedir())"], { cwd: home, env, shell: false });
  const actual = await realpath(stdout.trim()).catch(() => null);
  if (!actual || !samePath(actual, expected, platform)) throw Object.assign(new Error(`${label} environment resolves to ${stdout.trim()}, expected ${expected}`), { code: 'PREFLIGHT' });
}

const PINNED_SKILLS_VERSION = '1.8.1';

export async function acquirePinnedSkillsCli({ npmDirectory, baseEnvironment, platform = process.platform }) {
  const cliHome = path.join(npmDirectory, 'home');
  const cache = path.join(npmDirectory, 'cache');
  const userConfig = path.join(npmDirectory, 'npmrc-user');
  const globalConfig = path.join(npmDirectory, 'npmrc-global');
  await mkdir(cliHome, { recursive: true });
  await mkdir(cache, { recursive: true });
  await writeFile(userConfig, '');
  await writeFile(globalConfig, '');
  const env = makeSkillsEnvironment(baseEnvironment, cliHome, npmDirectory, platform);
  await verifyHomeSentinel(cliHome, env, platform, 'isolated npm HOME');
  env.npm_config_cache = cache;
  env.npm_config_userconfig = userConfig;
  env.npm_config_globalconfig = globalConfig;
  const npm = platform === 'win32' ? await resolveWindowsCli('npm', { env: baseEnvironment }) : { command: 'npm', prefix: [] };
  if (!npm) throw Object.assign(new Error('npm is unavailable; cannot acquire the pinned Skills CLI'), { code: 'PREFLIGHT' });
  await spawnCapture(npm.command, [...npm.prefix, 'install', '--prefix', npmDirectory, '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', `skills@${PINNED_SKILLS_VERSION}`], { env, cwd: npmDirectory, shell: false });
  const packageRoot = path.join(npmDirectory, 'node_modules', 'skills');
  const packageRootStat = await lstat(packageRoot);
  if (!packageRootStat.isDirectory() || packageRootStat.isSymbolicLink()) throw Object.assign(new Error('pinned Skills CLI package directory is missing or unsafe'), { code: 'PREFLIGHT' });
  const packagePath = path.join(packageRoot, 'package.json');
  const packageStat = await lstat(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) throw Object.assign(new Error('pinned Skills CLI package metadata is missing or unsafe'), { code: 'PREFLIGHT' });
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.skills;
  if (pkg.name !== 'skills' || pkg.version !== PINNED_SKILLS_VERSION || typeof bin !== 'string' || path.isAbsolute(bin) || bin.split(/[\\/]/).includes('..')) throw Object.assign(new Error('installed Skills CLI package identity/version is not the pinned official package'), { code: 'PREFLIGHT' });
  const cliPath = path.resolve(packageRoot, bin);
  const cliStat = await lstat(cliPath);
  const [npmReal, packageReal, cliReal] = await Promise.all([realpath(npmDirectory), realpath(packageRoot), realpath(cliPath)]);
  if (!isWithinDirectory(npmReal, packageReal, platform) || !cliStat.isFile() || cliStat.isSymbolicLink() || !isWithinDirectory(packageReal, cliReal, platform)) throw Object.assign(new Error('pinned Skills CLI entry is missing or escapes its isolated package'), { code: 'PREFLIGHT' });
  const version = await spawnCapture(process.execPath, [cliReal, '--version'], { env, shell: false });
  const reportedVersion = version.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  if (reportedVersion !== PINNED_SKILLS_VERSION) throw Object.assign(new Error('pinned Skills CLI did not report the expected version'), { code: 'PREFLIGHT' });
  return { command: process.execPath, prefix: [cliReal], version: PINNED_SKILLS_VERSION, env };
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

const AGENT_PATH_OVERRIDES = /^(CLAUDE_CONFIG_DIR|CODEX_HOME|VIBE_HOME|HERMES_HOME|AUTOHAND_HOME|GROK_HOME|SARVAM_HOME|REASONIX_HOME|FLATPAK_XDG_CONFIG_HOME|XDG_CONFIG_HOME)$/i;
function rejectAgentPathOverrides(...environments) {
  const present = new Set();
  for (const env of environments) for (const [key, value] of Object.entries(env ?? {})) {
    if (AGENT_PATH_OVERRIDES.test(key) && value != null && String(value) !== '') present.add(key);
  }
  if (present.size) throw Object.assign(new Error(`agent path overrides require manual review before update: ${[...present].sort().join(', ')}`), { code: 'IDENTITY_AMBIGUOUS' });
}

// Production entry accepts only parsed CLI arguments. Dependency-injected runUpdate
// remains available to isolated tests and is not used by the production CLI.
export async function runProductionUpdate(argv = []) {
  if (!Array.isArray(argv) || argv.some(arg => typeof arg !== 'string')) throw Object.assign(new Error('update arguments must be a string array'), { code: 'USAGE' });
  return runUpdate({ argv: [...argv] });
}

export async function runUpdate(options = {}) {
  const flags = options.flags ?? parseUpdateArgs(options.argv ?? []);
  const entry = options.entry ?? options.installationOptions?.entry ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/ake.mjs');
  let installationOptions = { ...(options.installationOptions ?? {}), entry };
  const output = { status: 'failed', stage: 'preflight', errorCode: null, message: '', dryRun: flags.dryRun, installationBefore: null, installationAfter: null, sourceUrl: null, defaultBranch: null, oldCommit: null, targetCommit: null, customization: null, baseline: null, backupPath: null, rollback: 'not_needed', warnings: [], initiatedBy: null, scopeBefore: null, bootstrap: false, reloadNotice: null };
  let heldLock = null, backup = null, installation, effectsBefore, installStarted = false, npmDirectory = null, skillsEnvironment = null, cli = null, cliPrefix = [];
  const report = (status, stage, code, message) => Object.assign(output, { status, stage, errorCode: code, message });
  try {
    const bundle = await findBundle(entry);
    const pkg = options.package ?? bundle?.package;
    if (!pkg?.repository?.url) throw Object.assign(new Error('AKE bundle package.json has no repository.url'), { code: 'UNTRUSTED_SOURCE' });
    const source = resolveInstallSource(pkg.repository.url); output.sourceUrl = source.sourceUrl;
    installationOptions = { ...installationOptions, sourceInfo: source };
    const platform = options.platform ?? process.platform;
    const baseEnvironment = options.env ?? process.env;
    rejectAgentPathOverrides(baseEnvironment, installationOptions.env ?? process.env);
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
      try { check = options.isCurrent ? await options.isCurrent(installation, remote) : (await verifyInstalled(installation, remote, { platform }), true); } catch { check = false; }
      if (check === true) { report('up_to_date', 'complete', null, 'AKE is already up to date'); return output; }
    }
    if (flags.dryRun) { report('dry_run', 'plan', null, `Would update from ${existingRef ?? 'unknown/local'} to ${remote.targetCommit}; no installation changes made`); return output; }
    const bootstrapInProgress = Boolean(installation.bootstrap);
    const beforeLock = installation;
    heldLock = await (options.acquireLock ?? acquireLock)(installation.agentsHome);
    installation = await (options.resolveInstallation ?? resolveInstallation)({ ...installationOptions, allowCompletedBootstrap: bootstrapInProgress });
    if (installation.canonicalPath !== beforeLock.canonicalPath || JSON.stringify(installation.agentPaths) !== JSON.stringify(beforeLock.agentPaths) || (installation.lockBytes && beforeLock.lockBytes && !Buffer.from(installation.lockBytes).equals(Buffer.from(beforeLock.lockBytes)))) throw Object.assign(new Error('installation identity, links or lock changed while acquiring update lock'), { code: 'DRIFT' });
    output.installationBefore = publicInstallation(installation);
    if (installation.lock?.skills?.ake?.installMode === 'copy' && (installation.agentPaths ?? []).some(item => item.mode === 'symlink')) {
      throw Object.assign(new Error('copy-mode Skills lock conflicts with an existing agent symlink; refusing because Skills CLI --copy may replace that symlink with an unbacked copy'), { code: 'IDENTITY_AMBIGUOUS' });
    }
    const customizationDetails = {};
    const customization = await (options.detectCustomization ?? detectCustomization)(installation, remote, { gitRunner: options.gitRunner, report: customizationDetails, platform });
    output.customization = customization; output.baseline = customizationDetails.baseline ?? null;
    // Explicit customized-source opt-in is a deliberate Lead 裁决 2026-11-14; never infer it from dry-run or status.
    if (customization !== 'clean' && !flags.acceptCustomized) throw Object.assign(new Error(`local installation is ${customization}; back it up and rerun only after explicit approval with --accept-customized`), { code: 'CUSTOMIZED_CONFIRMATION_REQUIRED' });
    const targetHome = path.dirname(installation.agentsHome ?? '');
    if (!path.isAbsolute(installation.agentsHome ?? '') || !samePath(path.join(targetHome, '.agents'), installation.agentsHome, platform)) throw Object.assign(new Error('verified installation has no canonical HOME/.agents target'), { code: 'IDENTITY_AMBIGUOUS' });
    try { npmDirectory = await createNpmWorkspace(targetHome, { platform, tempRoot: options.tempRoot ?? os.tmpdir(), env: baseEnvironment, entry, projectRoot: options.projectRoot ?? process.cwd() }); }
    catch (error) { throw Object.assign(new Error(`cannot create controlled temporary npm workspace: ${error.message}`), { code: 'PREFLIGHT' }); }
    skillsEnvironment = makeSkillsEnvironment(baseEnvironment, targetHome, npmDirectory, platform);
    const injectedCli = options.acquireSkillsCli || options.probeSkillsCli || options.skillsCli;
    if (!injectedCli) {
      await verifyHomeSentinel(targetHome, skillsEnvironment, platform, 'verified Skills target HOME');
    }
    try {
      if (options.acquireSkillsCli) {
        const acquired = await options.acquireSkillsCli({ npmDirectory, baseEnvironment, platform });
        cli = acquired.command; cliPrefix = acquired.prefix ?? [];
      } else if (options.probeSkillsCli || options.skillsCli) {
        // Explicit injection is a test seam; the production path always fetches the pinned package in isolation.
        cli = options.skillsCli ?? 'skills';
        await (options.probeSkillsCli ?? ((command, args, env) => spawnCapture(command, args, { env, shell: false })))(cli, ['--version'], makeSkillsEnvironment(baseEnvironment, path.join(npmDirectory, 'home'), npmDirectory, platform));
        output.warnings.push('测试注入的 Skills CLI；本次未验证官方 CLI acquisition');
      } else {
        const acquired = await acquirePinnedSkillsCli({ npmDirectory, baseEnvironment, platform });
        cli = acquired.command; cliPrefix = acquired.prefix;
        output.warnings.push(`真实更新使用隔离安装并校验的 Skills CLI ${acquired.version}（npm lifecycle scripts 已禁用）`);
      }
      if (!cli) throw new Error('Skills CLI acquisition returned no executable');
    } catch (error) {
      throw Object.assign(new Error(`cannot acquire verified Skills CLI before installation changes: ${error.message}`), { code: 'PREFLIGHT' });
    }
    effectsBefore = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
    backup = await (options.createBackup ?? createBackup)({ agentsHome: installation.agentsHome, installation, lockPath: installation.lockPath, targetCommit: remote.targetCommit });
    output.backupPath = backup.backupPath;
    const effectsAtBackup = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
    if (effectsAtBackup !== effectsBefore) throw Object.assign(new Error('installation side effects changed while creating backup'), { code: 'DRIFT' });
    if (!options.createBackup) {
      await verifyRollbackAnchors(backup);
      await validateBackup(backup.backupPath);
      const current = options.resolveInstallation ? installation : await resolveInstallation({ ...installationOptions, allowCompletedBootstrap: bootstrapInProgress });
      if (!(await readFile(installation.lockPath)).equals(Buffer.from(backup.originalLockBytes)) || JSON.stringify(current.agentPaths) !== JSON.stringify(installation.agentPaths) || JSON.stringify(await snapshotTree(current.canonicalPath)) !== JSON.stringify(backup.originalTree)) throw Object.assign(new Error('installation, links or complete lock changed after backup'), { code: 'DRIFT' });
    }
    const modeArgs = installation.lock?.skills?.ake?.installMode === 'copy' ? ['--copy'] : [];
    const linkedAgents = [['.claude', 'claude-code'], ['.codebuddy', 'codebuddy']].filter(([dir]) => (installation.agentPaths ?? []).some(x => x.path === path.join(targetHome, dir, 'skills', 'ake'))).map(([, id]) => id);
    const agentArgs = (linkedAgents.length === 1 ? ['codex', ...linkedAgents] : linkedAgents.length ? linkedAgents : ['codex']).flatMap(id => ['-a', id]);
    installStarted = true;
    try { await (options.runSkillsAdd ?? spawnCapture)(cli, [...cliPrefix, 'add', `${source.repo}@${remote.targetCommit}`, '--skill', 'ake', '-g', '-y', ...modeArgs, ...agentArgs], { env: skillsEnvironment, shell: false }); }
    catch (error) { throw Object.assign(new Error(error.message, { cause: error }), { code: 'INSTALL' }); }
    try {
      const effectsAfter = await (options.snapshotInstallEffects ?? snapshotInstallEffects)(installation);
      if (effectsBefore !== effectsAfter) throw new Error('Skills CLI changed non-AKE lock entries, agent directory entries, or canonical/link identity');
      await (options.verifyInstalled ?? verifyInstalled)(installation, remote, { platform });
    } catch (error) { throw Object.assign(new Error(error.message, { cause: error }), { code: 'VERIFY' }); }
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
      output.rollback = 'not_attempted';
      output.warnings.push(`安装已启动或启动结果未知；未自动恢复或清理备份。请保持其他程序停写，检查当前安装、链接和 lock；核对备份 ${backup.backupPath}/manifest.json 与 data 后，先另存现场，再由人工决定如何恢复，勿盲目覆盖或重试。备份路径：${backup.backupPath}`);
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
