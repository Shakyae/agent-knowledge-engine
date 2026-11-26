import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUpdateArgs, resolveInstallSource, updateExitCode, runUpdate, runProductionUpdate, detectCustomization, resolveInstallation, verifyInstalled } from '../../src/lib/update.mjs';
import { mkdir, writeFile, readFile, readdir, lstat, rm, symlink, cp, chmod } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { runGit, resolveRemote } from '../../src/lib/git-remote.mjs';
import { assertOutsideGitWorkTree, cleanTestEnv, tempRoot } from '../helpers/test-env.mjs';

const sha = 'a'.repeat(40);
async function makeWorkDir(prefix) { return tempRoot(prefix); }
async function updateRoots(t, prefix) {
  const root = await makeWorkDir(prefix); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), agentsHome = path.join(home, '.agents'), tempRoot = path.join(root, 'temp');
  await mkdir(agentsHome, { recursive: true }); await mkdir(tempRoot);
  return { root, home, agentsHome, lockPath: path.join(agentsHome, '.skill-lock.json'), tempRoot };
}
test('Windows npm resolution accepts copied Path and rejects missing candidates', async t => {
  const { resolveWindowsCli } = await import('../../src/lib/update.mjs');
  const root = await makeWorkDir('ake-win-npm-path-'); t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'node_modules', 'npm', 'bin'); await mkdir(bin, { recursive: true });
  await writeFile(path.join(root, 'npm.cmd'), '@echo off');
  await writeFile(path.join(root, 'node_modules', 'npm', 'package.json'), JSON.stringify({ name: 'npm', bin: { npm: 'bin/npm-cli.js' } }));
  const cli = path.join(bin, 'npm-cli.js'); await writeFile(cli, '// fixture');
  const env = { Path: root, PathExt: '.CMD' };
  assert.deepEqual(await resolveWindowsCli('npm', { env }), { command: process.execPath, prefix: [await realpath(cli)] });
  assert.equal(await resolveWindowsCli('npm', { env: { Path: path.join(root, 'missing'), PathExt: '.CMD' } }), null);
});

test('production update entry rejects injected dependency objects before work', async () => {
  let called = false;
  await assert.rejects(runProductionUpdate({ argv: [], resolveRemote: () => { called = true; } }), { code: 'USAGE' });
  await assert.rejects(runProductionUpdate(['--force']), { code: 'USAGE' });
  assert.equal(called, false);
});

test('update arguments are allowlisted and duplicates rejected', () => {
  assert.deepEqual(parseUpdateArgs(['--dry-run', '--json']), { dryRun: true, json: true, acceptCustomized: false });
  assert.throws(() => parseUpdateArgs(['--force']), { code: 'USAGE' });
  assert.throws(() => parseUpdateArgs(['--json', '--json']), { code: 'USAGE' });
  assert.equal(updateExitCode({ errorCode: 'USAGE' }), 2);
  assert.equal(updateExitCode({ status: 'failed', errorCode: 'REMOTE' }), 1);
  assert.equal(updateExitCode({ status: 'dry_run' }), 0);
});

test('update rejects missing starting repository.url before CLI or remote work', async () => {
  let probed = false, remote = false;
  const result = await runUpdate({ flags: { dryRun: true, json: true, acceptCustomized: false }, package: { name: 'agent-knowledge-engine' },
    probeSkillsCli: async () => { probed = true; }, resolveRemote: async () => { remote = true; } });
  assert.equal(result.errorCode, 'UNTRUSTED_SOURCE'); assert.match(result.message, /has no repository.url/); assert.equal(probed, false); assert.equal(remote, false);
});

test('dry-run never probes Skills CLI, creates npm temp, or consults HOME cache', async t => {
  const root = await makeWorkDir('ake-dry-run-no-cli-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); await mkdir(home);
  let probed = false, acquired = false;
  const installation = { lock: { skills: { ake: { sourceType: 'local' } } } };
  const result = await runUpdate({ home, env: cleanTestEnv({ HOME: home }), flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async () => { probed = true; }, acquireSkillsCli: async () => { acquired = true; }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha, entries: [] }) });
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.equal(probed || acquired, false); assert.deepEqual(await readdir(home), []);
});

test('Skills CLI acquisition failure happens before backup or install', async () => {
  let acquired = false, backed = false, installed = false;
  const installation = { agentsHome: '/fake/.agents', canonicalPath: '/fake/.agents/skills/ake', loadPath: '/fake/.agents/skills/ake', scope: 'user', mode: 'canonical', sourceType: 'local', agentPaths: [], lockPath: '/fake/.agents/.skill-lock.json', lock: { skills: { ake: { sourceType: 'local' } } } };
  const result = await runUpdate({ flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha, entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean',
    acquireSkillsCli: async () => { acquired = true; throw new Error('offline'); }, createBackup: async () => { backed = true; }, runSkillsAdd: async () => { installed = true; } });
  assert.equal(result.errorCode, 'PREFLIGHT'); assert.match(result.message, /before installation changes: offline/); assert.equal(acquired, true); assert.equal(backed || installed, false);
});

test('customization compares installed tree with old pinned ref, not new target', async t => {
  const root = await makeWorkDir('ake-customization-'); t.after(() => rm(root, { recursive: true, force: true }));
  const bare = path.join(root, 'repo.git'), work = path.join(root, 'work'), canonical = path.join(root, 'installed');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' }); execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
  await mkdir(path.join(work, 'skills', 'ake'), { recursive: true }); await writeFile(path.join(work, 'skills', 'ake', 'SKILL.md'), '# old');
  execFileSync('git', ['-C', work, 'config', 'core.autocrlf', 'false']); execFileSync('git', ['-C', work, 'config', 'core.filemode', 'false']);
  execFileSync('git', ['-C', work, 'add', '.']); execFileSync('git', ['-C', work, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'old'], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, 'push', 'origin', 'HEAD:refs/heads/main'], { stdio: 'ignore' });
  const oldRef = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), '# old');
  const installation = { lock: { skills: { ake: { sourceType: 'github', ref: oldRef } } }, sourceInfo: { sourceUrl: bare }, canonicalPath: canonical };
  const gitErrors = []; const trackedGit = async (...args) => { try { return await runGit(...args); } catch (error) { gitErrors.push(error.message); throw error; } };
  assert.equal(await detectCustomization(installation, { targetCommit: 'f'.repeat(40) }, { gitRunner: trackedGit, tempDirectory: root }), 'clean', gitErrors.join('; '));
  await writeFile(path.join(canonical, 'SKILL.md'), '# edited');
  assert.equal(await detectCustomization(installation, { targetCommit: 'f'.repeat(40) }, { tempDirectory: root }), 'modified');
  installation.lock.skills.ake.ref = null;
  assert.equal(await detectCustomization(installation, {}), 'unknown');
});

test('binary target tree preserves raw bytes, verifies, and detects local byte mutation', async t => {
  const root = await makeWorkDir('ake-binary-tree-'); t.after(() => rm(root, { recursive: true, force: true }));
  const bare = path.join(root, 'remote.git'), work = path.join(root, 'work'), official = 'https://github.com/o/r.git';
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' }); execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, 'checkout', '-b', 'main'], { stdio: 'ignore' });
  const binary = Buffer.from([0xc3, 0x28, 0x00, 0xff, 0x7f]);
  const files = { 'SKILL.md': '---\\nname: ake\\n---\\n# binary fixture\\n', 'bootstrap.mjs': 'export {};', 'resources/ake-source/package.json': JSON.stringify({ name: 'agent-knowledge-engine', repository: { url: official } }), 'resources/ake-source/scripts/ake.mjs': '// cli' };
  for (const [relative, contents] of Object.entries(files)) { const target = path.join(work, 'skills', 'ake', ...relative.split('/')); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, contents); }
  await writeFile(path.join(work, 'skills', 'ake', 'binary.dat'), binary);
  execFileSync('git', ['-C', work, 'config', 'core.autocrlf', 'false']); execFileSync('git', ['-C', work, 'config', 'core.filemode', 'false']); execFileSync('git', ['-C', work, 'config', 'core.symlinks', 'true']);
  await symlink('SKILL.md', path.join(work, 'skills', 'ake', 'skill-link'), 'file');
  execFileSync('git', ['-C', work, 'add', '.']); execFileSync('git', ['-C', work, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'binary target'], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, 'push', 'origin', 'HEAD:refs/heads/main'], { stdio: 'ignore' }); execFileSync('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const targetCommit = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const gitRunner = (args, options) => runGit(args.map(arg => arg === official ? bare : arg), options);
  const remote = await resolveRemote({ repoUrl: official, gitRunner, tempDirectory: root });
  assert.equal(remote.targetCommit, targetCommit); const binaryEntry = remote.entries.find(item => item.relativePath === 'binary.dat');
  assert.ok(Buffer.isBuffer(binaryEntry.bytes)); assert.deepEqual(binaryEntry.bytes, binary);
  const canonicalPath = path.join(root, 'installed'); await cp(path.join(work, 'skills', 'ake'), canonicalPath, { recursive: true, verbatimSymlinks: true });
  const lockPath = path.join(root, 'skills-lock.json'), lock = { skills: { ake: { sourceType: 'github', source: 'o/r', sourceUrl: official, ref: targetCommit, skillPath: 'skills/ake/SKILL.md' } } };
  await writeFile(lockPath, JSON.stringify(lock));
  const installation = { canonicalPath, lockPath, lock, sourceInfo: { sourceUrl: official, repo: 'o/r' } };
  assert.equal(await detectCustomization(installation, remote, { gitRunner, tempDirectory: root }), 'clean');
  await verifyInstalled(installation, remote);
  const skillFile = path.join(canonicalPath, 'SKILL.md');
  assert.equal(await detectCustomization(installation, remote, { gitRunner, tempDirectory: root, platform: 'win32' }), 'clean', '0644 Git mode and normal writable Windows mode are equivalent');
  await verifyInstalled(installation, remote, { platform: 'win32' });
  await chmod(skillFile, 0o444);
  assert.equal(await detectCustomization(installation, remote, { gitRunner, tempDirectory: root, platform: 'win32' }), 'modified', 'Windows read-only drift remains observable');
  await assert.rejects(verifyInstalled(installation, remote, { platform: 'win32' }), /target file mismatch: SKILL.md/);
  await chmod(skillFile, 0o644);
  const link = path.join(canonicalPath, 'skill-link'); await rm(link); await symlink('bootstrap.mjs', link, 'file');
  assert.equal(await detectCustomization(installation, remote, { gitRunner, tempDirectory: root, platform: 'win32' }), 'modified', 'symlink target drift remains observable');
  await assert.rejects(verifyInstalled(installation, remote, { platform: 'win32' }), /target symlink mismatch: skill-link/);
  await rm(link); await symlink('SKILL.md', link, 'file');
  const modified = Buffer.from(await readFile(path.join(canonicalPath, 'binary.dat'))); modified[1] ^= 0xff; await writeFile(path.join(canonicalPath, 'binary.dat'), modified);
  assert.equal(await detectCustomization(installation, remote, { gitRunner, tempDirectory: root }), 'modified');
  await assert.rejects(verifyInstalled(installation, remote), /target file mismatch/);
});

test('installed verifier rejects wrong refs and extra files', async t => {
  const root = await makeWorkDir('ake-verify-'); t.after(() => rm(root, { recursive: true, force: true }));
  const canonicalPath = path.join(root, 'skills', 'ake'), lockPath = path.join(root, '.skill-lock.json'), targetCommit = '9'.repeat(40);
  const files = { 'SKILL.md': '# skill', 'bootstrap.mjs': 'export {};', 'resources/ake-source/package.json': '{}', 'resources/ake-source/scripts/ake.mjs': '// cli' };
  await mkdir(canonicalPath, { recursive: true });
  const entries = [];
  for (const [relativePath, contents] of Object.entries(files)) { const target = path.join(canonicalPath, ...relativePath.split('/')); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, contents); entries.push({ relativePath, bytes: contents, mode: '100644', type: 'blob' }); }
  const remote = { targetCommit, repo: 'o/r', sourceUrl: 'https://github.com/o/r.git', entries };
  const installation = { canonicalPath, lockPath };
  const validLock = { skills: { ake: { ref: targetCommit, skillPath: 'skills/ake/SKILL.md', sourceType: 'github', source: 'o/r', sourceUrl: remote.sourceUrl } } };
  await writeFile(lockPath, JSON.stringify(validLock)); await verifyInstalled(installation, remote);
  await writeFile(lockPath, JSON.stringify({ skills: { ake: { ...validLock.skills.ake, ref: '8'.repeat(40) } } }));
  await assert.rejects(verifyInstalled(installation, remote), /lock does not identify/);
  await writeFile(lockPath, JSON.stringify(validLock)); await rm(path.join(canonicalPath, 'bootstrap.mjs'));
  await assert.rejects(verifyInstalled(installation, remote), /missing or extra paths/);
  await writeFile(path.join(canonicalPath, 'bootstrap.mjs'), files['bootstrap.mjs']); await writeFile(path.join(canonicalPath, 'extra.txt'), 'unexpected');
  await assert.rejects(verifyInstalled(installation, remote), /missing or extra paths/);
});

test('local source baseline accepts clean copies, flags changes, and leaves invalid sources unknown', async t => {
  const root = await makeWorkDir('ake-local-baseline-'); t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), sourceSkill = path.join(source, 'skills', 'ake'), canonicalPath = path.join(root, 'home', '.agents', 'skills', 'ake');
  await mkdir(sourceSkill, { recursive: true }); const sourceRealPath = await realpath(source); await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine', repository: { url: 'https://github.com/o/r.git' } }));
  await writeFile(path.join(sourceSkill, 'SKILL.md'), '# official'); await writeFile(path.join(sourceSkill, 'extra.txt'), 'same'); await symlink('SKILL.md', path.join(sourceSkill, 'skill-link'), 'file');
  execFileSync('git', ['init', source], { stdio: 'ignore' }); execFileSync('git', ['-C', source, 'config', 'core.autocrlf', 'false']); execFileSync('git', ['-C', source, 'config', 'core.filemode', 'false']); execFileSync('git', ['-C', source, 'config', 'core.symlinks', 'true']); execFileSync('git', ['-C', source, 'add', '.']); execFileSync('git', ['-C', source, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'source'], { stdio: 'ignore' });
  await mkdir(path.dirname(canonicalPath), { recursive: true }); await cp(sourceSkill, canonicalPath, { recursive: true, verbatimSymlinks: true });
  const lockPath = path.join(root, 'home', '.agents', '.skill-lock.json'); await writeFile(lockPath, JSON.stringify({ skills: { ake: { sourceType: 'local', source } } }));
  const installation = { agentsHome: path.join(root, 'home', '.agents'), canonicalPath, loadPath: canonicalPath, scope: 'user', mode: 'canonical', sourceType: 'local', agentPaths: [{ path: canonicalPath, mode: 'canonical' }], lockPath, lock: { skills: { ake: { sourceType: 'local', source } } } };
  const details = {}; assert.equal(await detectCustomization(installation, {}, { report: details }), 'clean'); assert.equal(details.baseline, `local-source:${sourceRealPath}`);
  assert.equal(await detectCustomization(installation, {}, { platform: 'win32' }), 'clean', 'local-source and installed writable Windows modes compare without POSIX execute bits');
  const installedSkillFile = path.join(canonicalPath, 'SKILL.md'); await chmod(installedSkillFile, 0o444);
  assert.equal(await detectCustomization(installation, {}, { platform: 'win32' }), 'modified', 'read-only drift stays visible for local-source installs'); await chmod(installedSkillFile, 0o644);
  const installedLink = path.join(canonicalPath, 'skill-link'); await rm(installedLink); await symlink('extra.txt', installedLink, 'file');
  assert.equal(await detectCustomization(installation, {}, { platform: 'win32' }), 'modified', 'local-source symlink target remains part of comparison'); await rm(installedLink); await symlink('SKILL.md', installedLink, 'file');
  let installed = false;
  const updateOptions = { flags: { dryRun: false, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } }, resolveInstallation: async () => installation,
    probeSkillsCli: async () => {}, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha, entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), snapshotInstallEffects: async () => 'baseline', createBackup: async () => ({ backupPath: '/tests/.work/local-baseline-backup' }),
    runSkillsAdd: async () => { installed = true; }, verifyInstalled: async () => {}, readAfter: async () => installation, cleanupBackups: async () => [] };
  const cleanUpdate = await runUpdate(updateOptions); assert.equal(cleanUpdate.status, 'updated'); assert.equal(cleanUpdate.customization, 'clean'); assert.equal(cleanUpdate.baseline, `local-source:${sourceRealPath}`); assert.equal(installed, true);
  installed = false; await writeFile(path.join(canonicalPath, 'SKILL.md'), '# modified');
  assert.equal(await detectCustomization(installation, {}), 'modified');
  const modifiedUpdate = await runUpdate(updateOptions); assert.equal(modifiedUpdate.errorCode, 'CUSTOMIZED_CONFIRMATION_REQUIRED'); assert.equal(modifiedUpdate.customization, 'modified'); assert.equal(installed, false);
  await writeFile(path.join(sourceSkill, 'SKILL.md'), '# dirty source'); assert.equal(await detectCustomization(installation, {}), 'unknown');
  const dirtyUpdate = await runUpdate(updateOptions); assert.equal(dirtyUpdate.errorCode, 'CUSTOMIZED_CONFIRMATION_REQUIRED'); assert.equal(installed, false);
  installation.lock.skills.ake.source = path.join(root, 'missing'); assert.equal(await detectCustomization(installation, {}), 'unknown');
  const missingUpdate = await runUpdate(updateOptions); assert.equal(missingUpdate.errorCode, 'CUSTOMIZED_CONFIRMATION_REQUIRED'); assert.equal(installed, false);
  const nonGit = path.join(root, 'non-git'); await mkdir(path.join(nonGit, 'skills', 'ake'), { recursive: true }); assertOutsideGitWorkTree(nonGit);
  await writeFile(path.join(nonGit, 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine' })); await writeFile(path.join(nonGit, 'skills', 'ake', 'SKILL.md'), '# source');
  installation.lock.skills.ake.source = nonGit; assert.equal(await detectCustomization(installation, {}), 'unknown');
  const nonGitUpdate = await runUpdate(updateOptions); assert.equal(nonGitUpdate.errorCode, 'CUSTOMIZED_CONFIRMATION_REQUIRED'); assert.equal(installed, false);
});

test('checkout bootstrap requires exact package/origin and a clean Skill payload, while targeting temp HOME', async t => {
  async function fixture({ repoUrl = 'https://github.com/Shakyae/agent-knowledge-engine.git', origin = 'https://github.com/Shakyae/agent-knowledge-engine.git', dirty = false, missingRepo = false } = {}) {
    const root = await makeWorkDir('ake-bootstrap-'); t.after(() => rm(root, { recursive: true, force: true }));
    const checkout = path.join(root, 'checkout'), home = path.join(root, 'home'); await mkdir(path.join(checkout, 'skills', 'ake'), { recursive: true }); await mkdir(path.join(checkout, 'scripts'), { recursive: true });
    const packageMetadata = { name: 'agent-knowledge-engine' }; if (!missingRepo) packageMetadata.repository = { url: repoUrl };
    await writeFile(path.join(checkout, 'package.json'), JSON.stringify(packageMetadata));
    await writeFile(path.join(checkout, 'scripts', 'ake.mjs'), ''); await writeFile(path.join(checkout, 'skills', 'ake', 'SKILL.md'), '# source payload');
    const canonical = path.join(home, '.agents', 'skills', 'ake'), lockPath = path.join(home, '.agents', '.skill-lock.json');
    await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), '# installed legacy'); await writeFile(lockPath, JSON.stringify({ skills: { ake: { source: '/local/checkout', sourceType: 'local' } } }));
    execFileSync('git', ['init', checkout], { stdio: 'ignore' }); execFileSync('git', ['-C', checkout, 'add', '.']);
    execFileSync('git', ['-C', checkout, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'source'], { stdio: 'ignore' });
    execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', origin]);
    if (dirty) await writeFile(path.join(checkout, 'skills', 'ake', 'SKILL.md'), '# modified');
    return { root, checkout, home, entry: path.join(checkout, 'scripts', 'ake.mjs'), canonical };
  }
  const valid = await fixture();
  const installation = await resolveInstallation({ entry: valid.entry, home: valid.home, env: {} });
  assert.equal(installation.bootstrap, true); assert.equal(installation.initiatedBy, 'checkout'); assert.equal(installation.scopeBefore, 'development'); assert.equal(installation.canonicalPath, await realpath(valid.canonical));
  await assert.rejects(resolveInstallation({ entry: path.join(valid.root, 'missing', 'ake.mjs'), home: valid.home, env: {} }), { code: 'IDENTITY_AMBIGUOUS' });
  const missingRepo = await fixture({ missingRepo: true });
  await assert.rejects(resolveInstallation({ entry: missingRepo.entry, home: missingRepo.home, env: {} }), error => error.code === 'UNTRUSTED_SOURCE' && error.message.includes('missing repository.url'));
  const claude = path.join(valid.home, '.claude', 'skills', 'ake'); await mkdir(path.dirname(claude), { recursive: true }); await symlink(path.relative(path.dirname(claude), valid.canonical), claude);
  const withClaude = await resolveInstallation({ entry: valid.entry, home: valid.home, env: {} }); assert.equal(withClaude.agentPaths.length, 2);
  const other = path.join(valid.home, '.cursor', 'skills', 'ake'); await mkdir(path.dirname(other), { recursive: true }); await symlink(path.relative(path.dirname(other), valid.canonical), other);
  await assert.rejects(resolveInstallation({ entry: valid.entry, home: valid.home, env: {} }), { code: 'IDENTITY_AMBIGUOUS' });
  const badOrigin = await fixture({ origin: 'https://example.invalid/fork.git' });
  await assert.rejects(resolveInstallation({ entry: badOrigin.entry, home: badOrigin.home, env: {} }), { code: 'UNTRUSTED_SOURCE' });
  const dirty = await fixture({ dirty: true });
  await assert.rejects(resolveInstallation({ entry: dirty.entry, home: dirty.home, env: {} }), { code: 'IDENTITY_AMBIGUOUS' });
  const wrongPackage = await fixture({ repoUrl: 'https://github.com/fork/agent-knowledge-engine.git' });
  await assert.rejects(resolveInstallation({ entry: wrongPackage.entry, home: wrongPackage.home, env: {} }), { code: 'UNTRUSTED_SOURCE' });
  const copiedAgent = await fixture();
  const claudeCopies = path.join(copiedAgent.home, '.claude', 'skills'); await mkdir(claudeCopies, { recursive: true });
  await cp(copiedAgent.canonical, path.join(claudeCopies, 'ake'), { recursive: true });
  await writeFile(path.join(copiedAgent.home, '.agents', '.skill-lock.json'), JSON.stringify({ skills: { ake: { sourceType: 'local', source: '/local', installMode: 'copy' } } }));
  await assert.rejects(resolveInstallation({ entry: copiedAgent.entry, home: copiedAgent.home, env: {} }), { code: 'IDENTITY_AMBIGUOUS' });
});

test('official source rejects host/path injection', () => {
  assert.equal(resolveInstallSource('https://github.com/o/r').repo, 'o/r');
  for (const url of ['https://github.com.evil.test/o/r', 'https://github.com/o/r/../../x', 'https://mirror.test/o/r']) assert.throws(() => resolveInstallSource(url), { code: 'UNTRUSTED_SOURCE' });
});

test('dry-run plans but never locks, backs up, or installs', async () => {
  let locked = false, backed = false, installed = false;
  const installation = { agentsHome: '/tmp/fake', lock: { skills: { ake: { ref: sha } } } };
  const result = await runUpdate({ probeSkillsCli: async () => {}, flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40) }),
    acquireLock: async () => { locked = true; }, createBackup: async () => { backed = true; }, runSkillsAdd: async () => { installed = true; } });
  assert.equal(result.status, 'dry_run'); assert.equal(locked || backed || installed, false);
});

test('modified state needs opt-in and install failure never invokes rollback', async t => {
  const { root, home, agentsHome, lockPath, tempRoot } = await updateRoots(t, 'ake-update-customized-');
  const installation = { agentsHome, lockPath, agentPaths: [], lock: { skills: { ake: { ref: sha } } } };
  let rollback = false, installArgs, installReached = false;
  const base = { home, tempRoot, probeSkillsCli: async () => {}, snapshotInstallEffects: async () => 'same', acquireLock: async () => ({ release: async () => {} }), flags: { dryRun: false, json: false, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } }, installationOptions: {},
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    detectCustomization: async () => 'modified', createBackup: async () => { throw new Error('must not backup until accepted'); } };
  const refused = await runUpdate(base);
  assert.equal(refused.errorCode, 'CUSTOMIZED_CONFIRMATION_REQUIRED');
  const accepted = await runUpdate({ ...base, flags: { ...base.flags, acceptCustomized: true }, detectCustomization: async () => 'clean', createBackup: async () => ({ backupPath: path.join(root, 'backup'), manifest: {}, originalTree: [], originalLockBytes: null }),
    runSkillsAdd: async (_cmd, args) => { installReached = true; installArgs = args; throw Object.assign(new Error('stub partial failure'), { code: 'INSTALL' }); },
    restoreBackup: async () => { rollback = true; }, verifyInstalled: async () => {} });
  assert.equal(accepted.errorCode, 'INSTALL'); assert.equal(accepted.rollback, 'not_attempted'); assert.equal(rollback, false); assert.equal(installReached, true);
  assert.ok(installArgs.includes(`o/r@${'b'.repeat(40)}`)); assert.ok(installArgs.includes('--skill')); assert.ok(installArgs.includes('ake')); assert.equal(installArgs.includes('--copy'), false);
});

test('CodeBuddy topology appearing after lock refuses before acquisition and releases lock', async () => {
  const agentsHome = '/fake/.agents', canonical = '/fake/.agents/skills/ake';
  const before = { agentsHome, agentPaths: [{ path: canonical, mode: 'canonical' }], lock: { skills: { ake: { sourceType: 'local' } } } };
  const after = { ...before, agentPaths: [...before.agentPaths, { path: '/fake/.claude/skills/ake', mode: 'symlink' }, { path: '/fake/.codebuddy/skills/ake', mode: 'symlink' }] };
  let calls = 0, released = false, acquired = false, backed = false, installed = false;
  const result = await runUpdate({ flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => ++calls === 1 ? before : after,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => { released = true; } }), acquireSkillsCli: async () => { acquired = true; },
    createBackup: async () => { backed = true; }, runSkillsAdd: async () => { installed = true; } });
  assert.equal(calls, 2); assert.equal(result.errorCode, 'DRIFT'); assert.match(result.message, /changed while acquiring/);
  assert.equal(released, true); assert.equal(acquired || backed || installed, false);
});

test('CodeBuddy up-to-date result does not write', async () => {
  const agentsHome = '/fake/.agents', targetCommit = 'b'.repeat(40);
  const installation = { agentsHome, agentPaths: [{ path: '/fake/.codebuddy/skills/ake', mode: 'symlink' }], lock: { skills: { ake: { sourceType: 'github', ref: targetCommit } } } };
  let locked = false;
  const result = await runUpdate({ flags: { dryRun: false, json: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => installation, resolveRemote: async () => ({ targetCommit, sourceUrl: 'https://github.com/o/r.git', repo: 'o/r' }),
    isCurrent: async () => true, acquireLock: async () => { locked = true; } });
  assert.equal(result.status, 'up_to_date'); assert.equal(locked, false);
});

test('copy-mode lock with an existing agent symlink refuses before acquisition or backup', async () => {
  const installation = { agentsHome: '/fake/.agents', lockPath: '/fake/.agents/.skill-lock.json', agentPaths: [{ path: '/fake/.claude/skills/ake', mode: 'symlink' }], lock: { skills: { ake: { ref: sha, installMode: 'copy' } } } };
  let acquired = false, backed = false, installed = false;
  const result = await runUpdate({ flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), acquireSkillsCli: async () => { acquired = true; }, createBackup: async () => { backed = true; }, runSkillsAdd: async () => { installed = true; } });
  assert.equal(result.errorCode, 'IDENTITY_AMBIGUOUS'); assert.match(result.message, /copy-mode Skills lock conflicts/); assert.equal(acquired || backed || installed, false);
});

test('Windows Skills environment overrides all inherited profile and npm paths', async () => {
  const { makeSkillsEnvironment } = await import('../../src/lib/update.mjs');
  const target = 'C:\\Users\\ake-target', temp = 'C:\\Temp\\ake-work';
  const env = makeSkillsEnvironment({ HOME: 'C:\\Users\\attacker', USERPROFILE: 'C:\\Users\\attacker', APPDATA: 'C:\\Users\\attacker\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\attacker\\AppData\\Local', HOMEDRIVE: 'D:', HOMEPATH: '\\attacker', NPM_CONFIG_CACHE: 'C:\\Users\\attacker\\.npm', CLAUDE_CONFIG_DIR: 'C:\\Users\\attacker\\claude' }, target, temp, 'win32');
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.HOME, target); assert.equal(env.USERPROFILE, target);
  assert.equal(env.APPDATA, path.win32.join(target, 'AppData', 'Roaming')); assert.equal(env.LOCALAPPDATA, path.win32.join(target, 'AppData', 'Local'));
  assert.equal(env.HOMEDRIVE, 'C:'); assert.equal(env.HOMEPATH, '\\Users\\ake-target');
  assert.equal(env.npm_config_cache, path.join(temp, 'cache')); assert.equal(env.npm_config_logs_dir, path.join(temp, 'logs'));
  assert.equal(Object.keys(env).some(key => key.toLowerCase() === 'npm_config_cache' && env[key] === 'C:\\Users\\attacker\\.npm'), false);
});

test('nonempty agent path overrides refuse before identity or network without touching paths', async t => {
  const root = await makeWorkDir('ake-agent-overrides-'); t.after(() => rm(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside'), link = path.join(root, 'link'), missing = path.join(root, 'missing');
  await mkdir(outside); await writeFile(path.join(outside, 'SKILL.md'), 'external customization'); await symlink(outside, link);
  const entries = await readdir(root), keys = ['claude_config_dir', 'CODEX_HOME', 'VIBE_HOME', 'HERMES_HOME', 'AUTOHAND_HOME', 'GROK_HOME', 'SARVAM_HOME', 'REASONIX_HOME', 'FLATPAK_XDG_CONFIG_HOME', 'XDG_CONFIG_HOME'];
  for (const key of keys) for (const value of [outside, link, missing, path.join(root, '.config'), path.join(root, '.claude')]) {
    let called = false;
    const result = await runUpdate({ flags: { dryRun: true, json: true }, package: { repository: { url: 'https://github.com/o/r.git' } }, env: { [key]: value }, installationOptions: { env: {} },
      resolveInstallation: async () => { called = true; }, resolveRemote: async () => { called = true; }, acquireLock: async () => { called = true; },
      createBackup: async () => { called = true; }, acquireSkillsCli: async () => { called = true; }, runSkillsAdd: async () => { called = true; } });
    assert.equal(result.errorCode, 'IDENTITY_AMBIGUOUS'); assert.ok(result.message.includes(key)); assert.equal(called, false);
    assert.equal(await readFile(path.join(outside, 'SKILL.md'), 'utf8'), 'external customization'); assert.deepEqual(await readdir(root), entries);
    assert.equal((await lstat(link)).isSymbolicLink(), true);
  }
  let called = false;
  const alternate = await runUpdate({ flags: { dryRun: true, json: true }, package: { repository: { url: 'https://github.com/o/r.git' } }, env: {}, installationOptions: { env: { CODEX_HOME: outside } }, resolveInstallation: async () => { called = true; } });
  assert.equal(alternate.errorCode, 'IDENTITY_AMBIGUOUS'); assert.equal(called, false);
  let identityOrRemote = false;
  const whitespace = await runUpdate({ flags: { dryRun: false, json: true }, package: { repository: { url: 'https://github.com/o/r.git' } }, env: { CODEX_HOME: '  ' }, installationOptions: { env: {} },
    resolveInstallation: async () => { identityOrRemote = true; }, resolveRemote: async () => { identityOrRemote = true; } });
  assert.equal(whitespace.errorCode, 'IDENTITY_AMBIGUOUS'); assert.match(whitespace.message, /CODEX_HOME/); assert.equal(identityOrRemote, false);
  const empty = await runUpdate({ flags: { dryRun: true, json: true }, package: { repository: { url: 'https://github.com/o/r.git' } }, env: { CODEX_HOME: '' }, installationOptions: { env: {} },
    resolveInstallation: async () => ({ agentsHome: path.join(root, '.agents'), agentPaths: [], lock: {} }),
    resolveRemote: async () => ({ targetCommit: 'b'.repeat(40), sourceUrl: 'https://github.com/o/r.git', repo: 'o/r' }) });
  assert.equal(empty.status, 'dry_run', JSON.stringify(empty));
});

test('default process environment overrides refuse without identity or remote work', () => {
  const moduleUrl = new URL('../../src/lib/update.mjs', import.meta.url).href;
  const script = `import {runUpdate} from ${JSON.stringify(moduleUrl)}; let called=false; const result=await runUpdate({flags:{dryRun:false,json:true},package:{repository:{url:'https://github.com/o/r.git'}},resolveInstallation:async()=>{called=true},resolveRemote:async()=>{called=true}}); console.log(JSON.stringify({result,called}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: cleanTestEnv({ CODEX_HOME: ' ' }) });
  assert.equal(child.status, 0, child.stderr);
  const { result, called } = JSON.parse(child.stdout);
  assert.equal(result.errorCode, 'IDENTITY_AMBIGUOUS'); assert.match(result.message, /CODEX_HOME/); assert.equal(called, false);
});

test('Skills environment removes inherited agent-specific home overrides', async () => {
  const { makeSkillsEnvironment } = await import('../../src/lib/update.mjs');
  const keys = ['CODEX_HOME', 'VIBE_HOME', 'HERMES_HOME', 'AUTOHAND_HOME', 'GROK_HOME', 'SARVAM_HOME', 'REASONIX_HOME', 'FLATPAK_XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR'];
  const input = Object.fromEntries(keys.map(key => [key.toLowerCase(), '/outside-target']));
  const result = makeSkillsEnvironment(input, '/target', '/tmp/isolated');
  for (const key of keys) assert.equal(result[key.toLowerCase()], undefined, key);
});

test('verified installation home overrides caller HOME and inherited Windows profile paths', async t => {
  const root = await makeWorkDir('ake-target-home-env-'); t.after(() => rm(root, { recursive: true, force: true }));
  const targetHome = path.join(root, 'target-user'), callerHome = path.join(root, 'other-user'), tempRoot = path.join(root, 'temp');
  const agentsHome = path.join(targetHome, '.agents'), canonicalPath = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonicalPath, { recursive: true }); await mkdir(callerHome); await mkdir(tempRoot);
  const installation = { agentsHome, canonicalPath, lockPath, mode: 'canonical', agentPaths: [], lock: { skills: { ake: { sourceType: 'local' } } } };
  let installEnv;
  const result = await runUpdate({ home: callerHome, tempRoot, platform: 'win32', projectRoot: path.join(root, 'project'), env: { HOME: callerHome, USERPROFILE: callerHome, APPDATA: path.join(callerHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(callerHome, 'AppData', 'Local') },
    flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', acquireSkillsCli: async () => ({ command: 'node', prefix: [] }),
    snapshotInstallEffects: async () => 'same', createBackup: async () => ({ backupPath: path.join(root, 'backup') }), runSkillsAdd: async (_command, _args, options) => { installEnv = options.env; },
    verifyInstalled: async () => {}, readAfter: async () => installation, cleanupBackups: async () => [] });
  assert.equal(result.status, 'updated', JSON.stringify(result));
  assert.equal(installEnv.HOME, targetHome); assert.equal(installEnv.USERPROFILE, targetHome);
  assert.equal(installEnv.APPDATA, path.win32.join(targetHome, 'AppData', 'Roaming')); assert.equal(installEnv.LOCALAPPDATA, path.win32.join(targetHome, 'AppData', 'Local'));
  assert.equal(path.basename(installEnv.npm_config_cache), 'cache'); assert.equal(installEnv.npm_config_cache.startsWith(path.join(tempRoot, 'ake-npm-')), true);
});

test('copy-mode lock preserves --copy without changing observed agent paths', async t => {
  const { root, home, agentsHome, lockPath, tempRoot } = await updateRoots(t, 'ake-update-copy-mode-');
  const installation = { agentsHome, lockPath, mode: 'canonical', agentPaths: [], lock: { skills: { ake: { ref: sha, installMode: 'copy' } } } };
  let installArgs, installReached = false;
  const result = await runUpdate({ home, tempRoot, probeSkillsCli: async () => {}, flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'before', createBackup: async () => ({ backupPath: path.join(root, 'backup'), manifest: {}, originalTree: [], originalLockBytes: null }),
    runSkillsAdd: async (_command, args) => { installReached = true; installArgs = args; throw Object.assign(new Error('stop after capture'), { code: 'INSTALL' }); }, restoreBackup: async () => {}, verifyInstalled: async () => {} });
  assert.equal(result.errorCode, 'INSTALL'); assert.equal(installReached, true); assert.ok(installArgs.includes('--copy'));
});

test('latest verified installation short-circuits without CLI, npm, lock, or backup', async () => {
  let touched = false, probed = false, acquired = false;
  const result = await runUpdate({ probeSkillsCli: async () => { probed = true; }, acquireSkillsCli: async () => { acquired = true; }, flags: { dryRun: false, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => ({ lock: { skills: { ake: { sourceType: 'github', ref: sha } } } }),
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'trunk', targetCommit: sha }), isCurrent: async () => true,
    acquireLock: async () => { touched = true; }, createBackup: async () => { touched = true; }, runSkillsAdd: async () => { touched = true; } });
  assert.equal(result.status, 'up_to_date'); assert.equal(touched || probed || acquired, false);
});

test('synchronous installer launch failure retains backup without rollback or cleanup', async t => {
  const { home, agentsHome, lockPath, tempRoot, root } = await updateRoots(t, 'ake-update-rollback-');
  let installReached = false, rollbackReached = false, cleanupReached = false;
  const result = await runUpdate({ home, tempRoot, probeSkillsCli: async () => {}, flags: { dryRun: false, json: false, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => ({ agentsHome, lockPath, lock: { skills: { ake: { ref: sha } } }, agentPaths: [] }),
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'baseline', createBackup: async () => ({ backupPath: path.join(root, 'keep-backup'), manifest: {}, originalTree: [], originalLockBytes: null }),
    runSkillsAdd: () => { installReached = true; throw Object.assign(new Error('spawn failed synchronously'), { code: 'ENOENT' }); }, restoreBackup: async () => { rollbackReached = true; }, cleanupBackups: async () => { cleanupReached = true; } });
  assert.equal(result.errorCode, 'INSTALL'); assert.equal(result.backupPath, path.join(root, 'keep-backup')); assert.equal(result.rollback, 'not_attempted');
  assert.equal(installReached, true); assert.equal(rollbackReached, false); assert.equal(cleanupReached, false); assert.match(result.warnings.join(' '), /未自动恢复/);
});

test('pinned acquisition uses an isolated npm prefix and disables lifecycle scripts', async t => {
  const root = await makeWorkDir('ake-pinned-cli-'); t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'), bin = path.join(root, 'bin'), capture = path.join(root, 'npm-capture.json');
  await mkdir(workspace); await mkdir(bin);
  const npm = path.join(bin, 'npm');
  const npmScript = `const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2); fs.writeFileSync(process.env.AKE_CAPTURE, JSON.stringify({args,home:process.env.HOME,userProfile:process.env.USERPROFILE,appData:process.env.APPDATA,localAppData:process.env.LOCALAPPDATA,tmp:process.env.TMP,temp:process.env.TEMP,cache:process.env.npm_config_cache,userconfig:process.env.npm_config_userconfig,globalconfig:process.env.npm_config_globalconfig})); const prefix=args[args.indexOf('--prefix')+1], root=path.join(prefix,'node_modules','skills'); fs.mkdirSync(path.join(root,'bin'),{recursive:true}); fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'skills',version:'1.8.1',bin:{skills:'bin/cli.mjs'}})); fs.writeFileSync(path.join(root,'bin','cli.mjs'),\"if(process.argv[2]==='--version') console.log('skills 1.8.1');\");\n`;
  await writeFile(npm, `#!/usr/bin/env node\n${npmScript}`); await chmod(npm, 0o755);
  // resolveWindowsCli intentionally requires both npm.cmd and verifiable adjacent npm package metadata.
  const npmPackage = path.join(bin, 'node_modules', 'npm');
  await mkdir(path.join(npmPackage, 'bin'), { recursive: true });
  await writeFile(path.join(bin, 'npm.cmd'), '@echo off\r\n');
  await writeFile(path.join(npmPackage, 'package.json'), JSON.stringify({ name: 'npm', bin: { npm: 'bin/npm-cli.js' } }));
  await writeFile(path.join(npmPackage, 'bin', 'npm-cli.js'), npmScript);
  const { acquirePinnedSkillsCli, resolveWindowsCli } = await import('../../src/lib/update.mjs');
  if (process.platform !== 'win32') await symlink(process.execPath, path.join(bin, 'node'));
  const userCache = path.join(root, 'user-cache');
  const baseEnvironment = cleanTestEnv({ HOME: path.join(root, 'user-home'), NPM_CONFIG_CACHE: userCache, AKE_CAPTURE: capture });
  for (const key of Object.keys(baseEnvironment)) if (['path', 'pathext', 'ake_capture'].includes(key.toLowerCase())) delete baseEnvironment[key];
  baseEnvironment.PATH = bin;
  baseEnvironment.PATHEXT = '.CMD';
  baseEnvironment.AKE_CAPTURE = capture;
  const windowsEnvironment = baseEnvironment;
  const emptyPath = path.join(root, 'empty-path'); await mkdir(emptyPath);
  const missingEnvironment = { ...baseEnvironment, PATH: emptyPath, AKE_CAPTURE: path.join(root, 'missing-npm-capture.json') };
  const missingNpm = await resolveWindowsCli('npm', { env: missingEnvironment });
  assert.equal(missingNpm, null, 'an isolated PATH without npm must fail discovery rather than search the host PATH');
  await assert.rejects(acquirePinnedSkillsCli({ npmDirectory: path.join(root, 'missing-npm-workspace'), baseEnvironment: missingEnvironment, platform: 'win32' }), error => error.code === 'PREFLIGHT' && /npm is unavailable/.test(error.message));
  await assert.rejects(lstat(path.join(root, 'missing-npm-capture.json')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(root, 'missing-npm-workspace', 'node_modules')), { code: 'ENOENT' });
  const resolvedWindowsNpm = await resolveWindowsCli('npm', { env: windowsEnvironment });
  assert.equal(resolvedWindowsNpm?.command, process.execPath, 'Windows resolver must select the isolated Node-run npm stub');
  assert.deepEqual(resolvedWindowsNpm?.prefix, [await realpath(path.join(npmPackage, 'bin', 'npm-cli.js'))], 'Windows resolver must use adjacent fixture metadata, not a host npm installation');
  const acquired = await acquirePinnedSkillsCli({ npmDirectory: workspace, baseEnvironment });
  const captured = JSON.parse(await readFile(capture, 'utf8'));
  assert.equal(captured.args[0], 'install'); assert.ok(captured.args.includes('--ignore-scripts')); assert.ok(captured.args.includes('skills@1.8.1'));
  assert.equal(captured.args[captured.args.indexOf('--prefix') + 1], workspace);
  assert.ok(captured.args.includes('--registry=https://registry.npmjs.org'));
  assert.equal(captured.home, path.join(workspace, 'home')); assert.equal(captured.userProfile, path.join(workspace, 'home'));
  assert.equal(captured.appData, path.join(workspace, 'home', 'AppData', 'Roaming')); assert.equal(captured.localAppData, path.join(workspace, 'home', 'AppData', 'Local'));
  assert.equal(captured.tmp, workspace); assert.equal(captured.temp, workspace);
  assert.equal(captured.cache, path.join(workspace, 'cache')); assert.equal(captured.userconfig, path.join(workspace, 'npmrc-user')); assert.equal(captured.globalconfig, path.join(workspace, 'npmrc-global')); await assert.rejects(lstat(userCache), { code: 'ENOENT' });
  assert.equal(acquired.version, '1.8.1'); assert.equal(acquired.command, process.execPath); assert.equal(path.basename(acquired.prefix[0]), 'cli.mjs');
});

test('identity resolution ignores ordinary files directly under HOME', async t => {
  const root = await makeWorkDir('ake-home-files-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const canonical = path.join(home, '.agents', 'skills', 'ake');
  const bundleRoot = path.join(canonical, 'resources', 'ake-source');
  const entry = path.join(bundleRoot, 'scripts', 'ake.mjs');
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, '#!/usr/bin/env node\n');
  await writeFile(path.join(bundleRoot, 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine', repository: { url: 'https://github.com/o/r.git' } }));
  await writeFile(path.join(home, '.zshrc'), 'export PATH="$HOME/bin:$PATH"\n');
  await writeFile(path.join(home, '.DS_Store'), 'binary noise');
  await mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
  await symlink(canonical, path.join(home, '.claude', 'skills', 'ake'));
  await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills: { ake: { source: '/tmp/local', sourceType: 'local' } } }));
  const resolved = await resolveInstallation({ home, entry });
  assert.equal(resolved.scope, 'user');
  assert.equal(resolved.canonicalPath, await realpath(canonical));
  assert.deepEqual(resolved.issues ?? [], []);
});

test('simulated Windows layout on macOS allows standard temp workspace paths and removes them', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await makeWorkDir('ake-win-temp-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(home, 'AppData', 'Local', 'Temp'); await mkdir(tempRoot, { recursive: true });
  const directory = await createNpmWorkspace(home, { platform: 'win32', tempRoot, env: {}, projectRoot: path.join(root, 'project') });
  assert.ok(directory.startsWith(tempRoot)); await rm(directory, { recursive: true });
  await assert.rejects(lstat(directory), { code: 'ENOENT' });
  const local = path.join(root, 'local'), localTemp = path.join(local, 'Temp'); await mkdir(localTemp, { recursive: true });
  const localDirectory = await createNpmWorkspace(home, { platform: 'win32', tempRoot: localTemp, env: { LOCALAPPDATA: local }, projectRoot: path.join(root, 'project') });
  assert.ok(localDirectory.startsWith(localTemp)); await rm(localDirectory, { recursive: true });
});

test('simulated Windows layout on macOS rejects AKE/project paths and symlink temp roots while preserving POSIX HOME policy', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-temp-policy-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(root, 'project'), bundle = path.join(root, 'bundle'), entry = path.join(bundle, 'scripts', 'ake.mjs');
  await mkdir(path.dirname(entry), { recursive: true }); await writeFile(path.join(bundle, 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine' })); await writeFile(entry, '');
  for (const forbidden of [path.join(home, '.agents'), path.join(home, 'custom-agents'), project, bundle]) {
    await mkdir(forbidden, { recursive: true });
    await assert.rejects(createNpmWorkspace(home, { platform: 'win32', tempRoot: forbidden, env: { DSH_AGENTS_HOME: path.join(home, 'custom-agents') }, entry, projectRoot: project }), { code: 'PREFLIGHT' });
  }
  const outside = path.join(root, 'outside'), link = path.join(root, 'temp-link'); await mkdir(outside); await symlink(outside, link);
  await assert.rejects(createNpmWorkspace(home, { platform: 'win32', tempRoot: link, env: {}, projectRoot: project }), /temporary root is not a real directory/);
  const homeTemp = path.join(home, 'tmp'); await mkdir(homeTemp, { recursive: true });
  await assert.rejects(createNpmWorkspace(home, { platform: 'darwin', tempRoot: homeTemp, env: {}, projectRoot: project }), { code: 'PREFLIGHT' });
  const posixTemp = path.join(root, 'posix-temp'); await mkdir(posixTemp);
  const allowed = await createNpmWorkspace(home, { platform: 'darwin', tempRoot: posixTemp, env: {}, projectRoot: project }); await rm(allowed, { recursive: true });
});


test('simulated Windows layout on macOS rejects Temp symlink escape with no leftover workspace', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-win-temp-escape-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), documents = path.join(home, 'Documents'), local = path.join(home, 'AppData', 'Local'), tempAlias = path.join(local, 'Temp');
  await mkdir(documents, { recursive: true }); await mkdir(local, { recursive: true }); await symlink(documents, tempAlias);
  const before = await readdir(documents);
  await assert.rejects(createNpmWorkspace(home, { platform: 'win32', tempRoot: documents, env: { LOCALAPPDATA: local }, projectRoot: path.join(root, 'project') }), { code: 'PREFLIGHT' });
  assert.deepEqual(await readdir(documents), before);
});

test('simulated Windows layout on macOS accepts HOME symlink alias for standard Temp', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-win-home-alias-')); t.after(() => rm(root, { recursive: true, force: true }));
  const realHome = path.join(root, 'real-home'), homeAlias = path.join(root, 'home-alias'), tempRoot = path.join(homeAlias, 'AppData', 'Local', 'Temp');
  await mkdir(path.join(realHome, 'AppData', 'Local', 'Temp'), { recursive: true }); await symlink(realHome, homeAlias);
  const directory = await createNpmWorkspace(homeAlias, { platform: 'win32', tempRoot, env: {}, projectRoot: path.join(root, 'project') });
  await rm(directory, { recursive: true }); await assert.rejects(lstat(directory), { code: 'ENOENT' });
});

test('simulated Windows layout on macOS accepts standard Temp redirected outside HOME', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-win-temp-outside-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), outsideTemp = path.join(root, 'outside-temp'); await mkdir(home); await mkdir(outsideTemp);
  const directory = await createNpmWorkspace(home, { platform: 'win32', tempRoot: outsideTemp, env: { LOCALAPPDATA: path.join(home, 'AppData', 'Local') }, projectRoot: path.join(root, 'project') });
  await rm(directory, { recursive: true }); await assert.rejects(lstat(directory), { code: 'ENOENT' });
});

test('simulated Windows layout on macOS rejects nested Temp symlink escape with no leftover workspace', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-win-nested-escape-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), documentsNested = path.join(home, 'Documents', 'nested'), local = path.join(home, 'AppData', 'Local'), tempAlias = path.join(local, 'Temp');
  await mkdir(documentsNested, { recursive: true }); await mkdir(local, { recursive: true }); await symlink(path.join(home, 'Documents'), tempAlias);
  const before = await readdir(documentsNested);
  await assert.rejects(createNpmWorkspace(home, { platform: 'win32', tempRoot: path.join(tempAlias, 'nested'), env: { LOCALAPPDATA: local }, projectRoot: path.join(root, 'project') }), { code: 'PREFLIGHT' });
  assert.deepEqual(await readdir(documentsNested), before);
});

test('simulated Windows layout on macOS accepts Temp symlink redirected to an external nested directory', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-win-temp-external-link-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), local = path.join(home, 'AppData', 'Local'), tempAlias = path.join(local, 'Temp'), outsideTemp = path.join(root, 'outside-temp');
  await mkdir(local, { recursive: true }); await mkdir(path.join(outsideTemp, 'nested'), { recursive: true }); await symlink(outsideTemp, tempAlias);
  const directory = await createNpmWorkspace(home, { platform: 'win32', tempRoot: path.join(tempAlias, 'nested'), env: { LOCALAPPDATA: local }, projectRoot: path.join(root, 'project') });
  assert.ok(directory.startsWith(path.join(tempAlias, 'nested'))); await rm(directory, { recursive: true }); await assert.rejects(lstat(directory), { code: 'ENOENT' });
});

test('simulated Windows layout on macOS accepts an in-HOME custom LOCALAPPDATA Temp', async t => {
  const { createNpmWorkspace } = await import('../../src/lib/update.mjs');
  const root = await realpath(await makeWorkDir('ake-win-custom-localappdata-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), local = path.join(home, 'Local'), tempRoot = path.join(local, 'Temp'); await mkdir(tempRoot, { recursive: true });
  const directory = await createNpmWorkspace(home, { platform: 'win32', tempRoot, env: { LOCALAPPDATA: local }, projectRoot: path.join(root, 'project') });
  await rm(directory, { recursive: true }); await assert.rejects(lstat(directory), { code: 'ENOENT' });
});
