import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUpdateArgs, resolveInstallSource, updateExitCode, runUpdate, detectCustomization, resolveInstallation, verifyInstalled } from '../../src/lib/update.mjs';
import { mkdir, writeFile, readFile, readdir, lstat, rm, symlink, cp, utimes } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { runGit, resolveRemote } from '../../src/lib/git-remote.mjs';
import { assertOutsideGitWorkTree, cleanTestEnv, tempRoot } from '../helpers/test-env.mjs';

const sha = 'a'.repeat(40);
async function makeWorkDir(prefix) { return tempRoot(prefix); }
async function makeCachedSkillsCli(home, hash, version, binTarget = '../skills/bin/cli.mjs') {
  const nodeModules = path.join(home, '.npm', '_npx', hash, 'node_modules');
  const packageRoot = path.join(nodeModules, 'skills'), cliPath = path.join(packageRoot, 'bin', 'cli.mjs');
  await mkdir(path.dirname(cliPath), { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'skills', version, bin: { skills: 'bin/cli.mjs' } }));
  await writeFile(cliPath, `import fs from 'node:fs'; if (process.argv[2] === '--version') process.stdout.write(${JSON.stringify(version)} + '\\n'); else fs.appendFileSync(process.env.AKE_CACHE_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');`);
  await mkdir(path.join(nodeModules, '.bin'), { recursive: true });
  await symlink(binTarget, path.join(nodeModules, '.bin', 'skills'));
  return cliPath;
}
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

test('missing PATH skills falls back to npx --no-install using a staged local cache', async t => {
  const root = await makeWorkDir('ake-staged-npx-cache-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), cached = path.join(home, '.npm', '_npx', 'local-skills', 'marker'); await mkdir(path.dirname(cached), { recursive: true }); await writeFile(cached, 'cached package');
  const env = cleanTestEnv({ HOME: home }); let stagedCache;
  const installation = { agentsHome: '/fake/.agents', canonicalPath: '/fake/.agents/skills/ake', loadPath: '/fake/.agents/skills/ake', scope: 'user', mode: 'canonical', sourceType: 'local', agentPaths: [], lockPath: '/fake/.agents/.skill-lock.json', lock: { skills: { ake: { sourceType: 'local' } } } };
  const probes = [], invocations = [];
  const result = await runUpdate({ home, env, flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args, probeEnv) => { probes.push([command, args]); if (command === 'skills') throw Object.assign(new Error('spawn skills ENOENT'), { code: 'ENOENT' }); assert.equal(command, 'npx'); assert.deepEqual(args, ['--no-install', 'skills', '--version']); stagedCache = probeEnv.npm_config_cache; assert.equal(await readFile(path.join(stagedCache, '_npx', 'local-skills', 'marker'), 'utf8'), 'cached package'); assert.notEqual(path.dirname(stagedCache), path.join(home, '.npm')); },
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha, entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'baseline', createBackup: async () => ({ backupPath: '/tests/.work/fake-backup' }),
    runSkillsAdd: async (command, args, installOptions) => { assert.equal(command, 'npx'); assert.equal(installOptions.env.npm_config_cache, stagedCache); invocations.push([command, args]); }, verifyInstalled: async () => {}, readAfter: async () => installation, cleanupBackups: async () => [] });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.deepEqual(probes, [['skills', ['--version']], ['npx', ['--no-install', 'skills', '--version']]]);
  assert.equal(invocations[0][0], 'npx'); assert.deepEqual(invocations[0][1].slice(0, 3), ['--no-install', 'skills', 'add']);
  assert.ok(result.warnings.some(warning => warning.includes('不证明其版本或完整性')));
});

test('missing PATH skills and unavailable npx cache remain PREFLIGHT failures', async t => {
  const root = await makeWorkDir('ake-empty-npx-cache-'); t.after(() => rm(root, { recursive: true, force: true })); const home = path.join(root, 'home'); await mkdir(home);
  const calls = []; let installed = false; const homeBefore = await readdir(home);
  const result = await runUpdate({ home, env: cleanTestEnv({ HOME: home }), flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async command => { calls.push(command); throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }); },
    resolveInstallation: async () => { throw new Error('identity should not be read'); }, runSkillsAdd: async () => { installed = true; } });
  assert.deepEqual(calls, ['skills', 'npx']); assert.equal(result.errorCode, 'PREFLIGHT'); assert.equal(updateExitCode(result), 1);
  assert.match(result.message, /npx --no-install fallback was attempted/); assert.match(result.message, /Vercel Skills CLI/); assert.match(result.message, /本次未自动下载/); assert.equal(installed, false);
  assert.deepEqual(await readdir(home), homeBefore);
});

test('customization compares installed tree with old pinned ref, not new target', async t => {
  const root = await makeWorkDir('ake-customization-'); t.after(() => rm(root, { recursive: true, force: true }));
  const bare = path.join(root, 'repo.git'), work = path.join(root, 'work'), canonical = path.join(root, 'installed');
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' }); execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
  await mkdir(path.join(work, 'skills', 'ake'), { recursive: true }); await writeFile(path.join(work, 'skills', 'ake', 'SKILL.md'), '# old');
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
  execFileSync('git', ['-C', work, 'add', '.']); execFileSync('git', ['-C', work, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'binary target'], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, 'push', 'origin', 'HEAD:refs/heads/main'], { stdio: 'ignore' }); execFileSync('git', ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const targetCommit = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const gitRunner = (args, options) => runGit(args.map(arg => arg === official ? bare : arg), options);
  const remote = await resolveRemote({ repoUrl: official, gitRunner, tempDirectory: root });
  assert.equal(remote.targetCommit, targetCommit); const binaryEntry = remote.entries.find(item => item.relativePath === 'binary.dat');
  assert.ok(Buffer.isBuffer(binaryEntry.bytes)); assert.deepEqual(binaryEntry.bytes, binary);
  const canonicalPath = path.join(root, 'installed'); await cp(path.join(work, 'skills', 'ake'), canonicalPath, { recursive: true });
  const lockPath = path.join(root, 'skills-lock.json'), lock = { skills: { ake: { sourceType: 'github', source: 'o/r', sourceUrl: official, ref: targetCommit, skillPath: 'skills/ake/SKILL.md' } } };
  await writeFile(lockPath, JSON.stringify(lock));
  const installation = { canonicalPath, lockPath, lock, sourceInfo: { sourceUrl: official, repo: 'o/r' } };
  assert.equal(await detectCustomization(installation, remote, { gitRunner, tempDirectory: root }), 'clean');
  await verifyInstalled(installation, remote);
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
  await writeFile(path.join(sourceSkill, 'SKILL.md'), '# official'); await writeFile(path.join(sourceSkill, 'extra.txt'), 'same');
  execFileSync('git', ['init', source], { stdio: 'ignore' }); execFileSync('git', ['-C', source, 'add', '.']); execFileSync('git', ['-C', source, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'source'], { stdio: 'ignore' });
  await mkdir(path.dirname(canonicalPath), { recursive: true }); await cp(sourceSkill, canonicalPath, { recursive: true });
  const lockPath = path.join(root, 'home', '.agents', '.skill-lock.json'); await writeFile(lockPath, JSON.stringify({ skills: { ake: { sourceType: 'local', source } } }));
  const installation = { agentsHome: path.join(root, 'home', '.agents'), canonicalPath, loadPath: canonicalPath, scope: 'user', mode: 'canonical', sourceType: 'local', agentPaths: [{ path: canonicalPath, mode: 'canonical' }], lockPath, lock: { skills: { ake: { sourceType: 'local', source } } } };
  const details = {}; assert.equal(await detectCustomization(installation, {}, { report: details }), 'clean'); assert.equal(details.baseline, `local-source:${sourceRealPath}`);
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

test('custom/unknown local state refuses by default and install error invokes rollback', async () => {
  const installation = { agentsHome: '/tmp/fake', lockPath: '/tmp/lock', agentPaths: [], lock: { skills: { ake: { ref: sha } } } };
  let rollback = false, installArgs;
  const base = { probeSkillsCli: async () => {}, snapshotInstallEffects: async () => 'same', acquireLock: async () => ({ release: async () => {} }), flags: { dryRun: false, json: false, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } }, installationOptions: {},
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'modified',
    createBackup: async () => { throw new Error('must not backup until accepted'); } };
  const refused = await runUpdate(base);
  assert.equal(refused.errorCode, 'CUSTOMIZED_CONFIRMATION_REQUIRED');
  const accepted = await runUpdate({ ...base, flags: { ...base.flags, acceptCustomized: true }, detectCustomization: async () => 'clean', createBackup: async () => ({ backupPath: '/tmp/backup', manifest: {}, originalTree: [], originalLockBytes: null }),
    runSkillsAdd: async (_cmd, args) => { installArgs = args; throw Object.assign(new Error('stub partial failure'), { code: 'INSTALL' }); },
    restoreBackup: async () => { rollback = true; }, verifyInstalled: async () => {} });
  assert.equal(accepted.errorCode, 'INSTALL'); assert.equal(accepted.rollback, 'succeeded'); assert.equal(rollback, true);
  assert.ok(installArgs.includes(`o/r@${'b'.repeat(40)}`)); assert.ok(installArgs.includes('--skill')); assert.ok(installArgs.includes('ake'));
});

test('latest verified installation short-circuits without lock or backup', async () => {
  let touched = false;
  const result = await runUpdate({ probeSkillsCli: async () => {}, flags: { dryRun: false, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => ({ lock: { skills: { ake: { sourceType: 'github', ref: sha } } } }),
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'trunk', targetCommit: sha }), isCurrent: async () => true,
    acquireLock: async () => { touched = true; }, createBackup: async () => { touched = true; }, runSkillsAdd: async () => { touched = true; } });
  assert.equal(result.status, 'up_to_date'); assert.equal(touched, false);
});

test('rollback failure is surfaced and backup path retained', async () => {
  const result = await runUpdate({ probeSkillsCli: async () => {}, flags: { dryRun: false, json: false, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    resolveInstallation: async () => ({ agentsHome: '/tmp/fake', lockPath: '/tmp/lock', lock: { skills: { ake: { ref: sha } } }, agentPaths: [] }),
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'b'.repeat(40), entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'baseline', createBackup: async () => ({ backupPath: '/tmp/keep-backup', manifest: {}, originalTree: [], originalLockBytes: null }),
    runSkillsAdd: async () => { throw new Error('install broke'); }, restoreBackup: async () => { throw new Error('restore broken'); } });
  assert.equal(result.errorCode, 'ROLLBACK_FAILED'); assert.equal(result.backupPath, '/tmp/keep-backup'); assert.equal(result.rollback, 'failed');
});

test('cached npx Skills CLI is discovered read-only, sorted by version, and invoked through node', async t => {
  const root = await makeWorkDir('ake-cached-cli-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), capture = path.join(root, 'install-argv.json'); await mkdir(home);
  const olderCli = await makeCachedSkillsCli(home, 'cache-a', '1.8.1');
  const newerCli = await makeCachedSkillsCli(home, 'cache-b', '1.9.0');
  const beforeCli = await readFile(newerCli);
  const installation = { agentsHome: path.join(home, '.agents'), canonicalPath: path.join(home, '.agents/skills/ake'), loadPath: path.join(home, '.agents/skills/ake'), scope: 'user', mode: 'canonical', sourceType: 'local', agentPaths: [], lockPath: path.join(home, '.agents/.skill-lock.json'), lock: { skills: { ake: { sourceType: 'local' } } } };
  const probes = [], invocations = []; let isolatedCache;
  const env = cleanTestEnv({ HOME: home, AKE_CACHE_CAPTURE: capture });
  const result = await runUpdate({ home, env, flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args, probeEnv) => {
      probes.push([command, args]);
      if (command === 'skills') throw Object.assign(new Error('spawn skills ENOENT'), { code: 'ENOENT' });
      if (command === 'npx') throw Object.assign(new Error('npx canceled due to missing packages'), { code: 'INSTALL' });
      assert.equal(command, process.execPath);
      const response = spawnSync(command, args, { encoding: 'utf8', env: probeEnv });
      if (response.error) throw response.error;
      if (response.status !== 0) throw Object.assign(new Error(response.stderr), { code: 'INSTALL', stderr: response.stderr });
      return response;
    },
    resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha, entries: [] }),
    acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'baseline', createBackup: async () => ({ backupPath: '/tests/.work/fake-backup' }),
    runSkillsAdd: async (command, args, options) => {
      invocations.push([command, args]); isolatedCache = options.env.npm_config_cache;
      const response = spawnSync(command, args, { encoding: 'utf8', env: options.env });
      if (response.error) throw response.error;
      if (response.status !== 0) throw Object.assign(new Error(response.stderr), { code: 'INSTALL', stderr: response.stderr });
    }, verifyInstalled: async () => {}, readAfter: async () => installation, cleanupBackups: async () => [] });
  assert.equal(result.status, 'updated', JSON.stringify(result));
  assert.deepEqual(probes.map(p => p[0]), ['skills', 'npx', process.execPath, process.execPath]);
  assert.equal(await realpath(probes[2][1][0]), await realpath(olderCli)); assert.equal(await realpath(probes[3][1][0]), await realpath(newerCli));
  assert.equal(invocations.length, 1); assert.equal(invocations[0][0], process.execPath);
  assert.equal(await realpath(invocations[0][1][0]), await realpath(newerCli)); assert.equal(invocations[0][1][1], 'add');
  assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')), invocations[0][1].slice(1));
  assert.match(result.warnings.join(' '), /使用本机 npx 缓存中的 Skills CLI（只读发现）/);
  assert.doesNotMatch(result.warnings.join(' '), /已验证版本|完整性已验证/);
  assert.deepEqual(await readFile(newerCli), beforeCli);
  await assert.rejects(lstat(path.dirname(isolatedCache)), { code: 'ENOENT' });
});

test('cached Skills CLI discovery rejects escaped and non-cli symlinks and anomalous timestamps', async t => {
  const root = await makeWorkDir('ake-cached-cli-invalid-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), outside = path.join(root, 'outside.mjs'); await mkdir(home); await writeFile(outside, 'process.exit(0);');
  const cliPath = await makeCachedSkillsCli(home, 'evil', '1.8.1', outside);
  const binPath = path.join(home, '.npm', '_npx', 'evil', 'node_modules', '.bin', 'skills');
  const { discoverCachedSkillsCli } = await import('../../src/lib/update.mjs');
  assert.deepEqual(await discoverCachedSkillsCli(home), []);
  await rm(binPath); await writeFile(path.join(path.dirname(cliPath), 'not-cli.mjs'), 'process.exit(0);');
  await symlink('../skills/bin/not-cli.mjs', binPath);
  assert.deepEqual(await discoverCachedSkillsCli(home), []);
  await rm(binPath); await symlink('../skills/bin/cli.mjs', binPath);
  const future = new Date(Date.now() + 10 * 60_000); await utimes(cliPath, future, future);
  assert.deepEqual(await discoverCachedSkillsCli(home), []);
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

test('simulated Windows layout on macOS refuses workspace under non-Temp HOME paths before CLI work', async t => {
  const root = await makeWorkDir('ake-win-temp-reject-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(home, 'Documents'); await mkdir(tempRoot, { recursive: true });
  let probed = false, backed = false;
  const result = await runUpdate({ home, env: cleanTestEnv({ HOME: home }), platform: 'win32', tempRoot, flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async () => { probed = true; }, createBackup: async () => { backed = true; } });
  assert.equal(result.errorCode, 'PREFLIGHT'); assert.match(result.message, /^cannot create controlled temporary npm workspace:/); assert.equal(probed || backed, false);
});

test('simulated Windows layout on macOS discovers .cmd cached Skills CLI from LOCALAPPDATA cache', async t => {
  const root = await realpath(await makeWorkDir('ake-win-cache-')); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), cache = path.join(root, 'local', 'npm-cache'), nodeModules = path.join(cache, '_npx', 'hash', 'node_modules');
  const pkg = path.join(nodeModules, 'skills'); await mkdir(path.join(pkg, 'bin'), { recursive: true }); await mkdir(path.join(nodeModules, '.bin'), { recursive: true });
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'skills', bin: { skills: 'bin/cli.mjs' } })); await writeFile(path.join(pkg, 'bin', 'cli.mjs'), ''); await writeFile(path.join(nodeModules, '.bin', 'skills.cmd'), '@echo off');
  const { discoverCachedSkillsCli } = await import('../../src/lib/update.mjs');
  assert.deepEqual(await discoverCachedSkillsCli(home, { platform: 'win32', env: { LOCALAPPDATA: path.dirname(cache) } }), [path.join(pkg, 'bin', 'cli.mjs')]);
  await rm(path.join(nodeModules, '.bin', 'skills.cmd')); await writeFile(path.join(nodeModules, '.bin', 'skills'), 'ordinary shim');
  assert.deepEqual(await discoverCachedSkillsCli(home, { platform: 'win32', env: { LOCALAPPDATA: path.dirname(cache) } }), [path.join(pkg, 'bin', 'cli.mjs')]);
  const custom = path.join(root, 'cache with spaces'), customModules = path.join(custom, '_npx', 'custom-hash', 'node_modules'), customPkg = path.join(customModules, 'skills');
  await mkdir(path.join(customPkg, 'bin'), { recursive: true }); await mkdir(path.join(customModules, '.bin'), { recursive: true });
  await writeFile(path.join(customPkg, 'package.json'), JSON.stringify({ name: 'skills', bin: { skills: 'bin/cli.mjs' } })); await writeFile(path.join(customPkg, 'bin', 'cli.mjs'), ''); await writeFile(path.join(customModules, '.bin', 'skills.cmd'), 'shim');
  assert.deepEqual(await discoverCachedSkillsCli(home, { platform: 'win32', env: { NPM_CONFIG_CACHE: custom, LOCALAPPDATA: path.dirname(cache) } }), [path.join(customPkg, 'bin', 'cli.mjs')]);
  const missing = path.join(root, 'missing cache');
  assert.deepEqual(await discoverCachedSkillsCli(home, { platform: 'win32', env: { NPM_CONFIG_CACHE: missing, LOCALAPPDATA: path.dirname(cache) } }), []);
});

test('simulated Windows layout on macOS resolves global skills.cmd to node and never executes the shim', async t => {
  const root = await makeWorkDir('ake-win-skills-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(root, 'temp'), bin = path.join(root, 'bin'); await mkdir(tempRoot); await mkdir(bin);
  const pkg = path.join(bin, 'node_modules', 'skills'); await mkdir(path.join(pkg, 'bin'), { recursive: true });
  await writeFile(path.join(bin, 'skills.cmd'), '@echo off'); await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'skills', bin: { skills: 'bin/cli.mjs' } })); await writeFile(path.join(pkg, 'bin', 'cli.mjs'), '');
  let invocation;
  const result = await runUpdate({ home, env: { HOME: home, PATH: `${bin};`, PATHEXT: '.CMD' }, platform: 'win32', tempRoot, projectRoot: path.join(root, 'project'), flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args) => { invocation = [command, args]; return { stdout: '1.8.0' }; }, resolveInstallation: async () => ({ lock: { skills: { ake: { sourceType: 'local' } } } }),
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha }) });
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.equal(invocation[0], process.execPath); assert.equal(invocation[1][0], await realpath(path.join(pkg, 'bin', 'cli.mjs')));
});

test('simulated Windows layout on macOS skills.cmd probe and install share the node CLI prefix', async t => {
  const root = await makeWorkDir('ake-win-skills-install-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(root, 'temp'), bin = path.join(root, 'bin'); await mkdir(tempRoot); await mkdir(bin);
  const pkg = path.join(bin, 'node_modules', 'skills'); await mkdir(path.join(pkg, 'bin'), { recursive: true });
  await writeFile(path.join(bin, 'skills.cmd'), '@echo off'); await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'skills', bin: { skills: 'bin/cli.mjs' } })); await writeFile(path.join(pkg, 'bin', 'cli.mjs'), '');
  const probes = [], installs = [], installation = { agentsHome: path.join(root, 'agents'), lockPath: path.join(root, 'lock'), lock: { skills: { ake: { sourceType: 'local' } } }, agentPaths: [] };
  const result = await runUpdate({ home, env: { HOME: home, PATH: `${bin};`, PATHEXT: '.CMD' }, platform: 'win32', tempRoot, projectRoot: path.join(root, 'project'), flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args) => { probes.push([command, args]); return { stdout: '1.8.0' }; }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha }), acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'same', createBackup: async () => ({ backupPath: '/fake' }), runSkillsAdd: async (command, args, options) => installs.push([command, args, options]), verifyInstalled: async () => {}, readAfter: async () => installation, cleanupBackups: async () => [] });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.equal(probes[0][0], process.execPath); assert.equal(installs[0][0], process.execPath); assert.equal(probes[0][1][0], installs[0][1][0]); assert.equal(installs[0][1][1], 'add');
  assert.equal(installs[0][2].shell, false); assert.ok(!installs[0][0].toLowerCase().includes('cmd.exe'));
});

test('simulated Windows layout on macOS npx.cmd install retains node CLI prefix without shell', async t => {
  const root = await makeWorkDir('ake-win-npx-install-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(root, 'temp'), bin = path.join(root, 'bin'); await mkdir(tempRoot); await mkdir(bin);
  const npm = path.join(bin, 'node_modules', 'npm'); await mkdir(path.join(npm, 'bin'), { recursive: true });
  await writeFile(path.join(bin, 'npx.cmd'), '@echo off'); await writeFile(path.join(npm, 'package.json'), JSON.stringify({ name: 'npm', bin: { npx: 'bin/npx-cli.js' } })); await writeFile(path.join(npm, 'bin', 'npx-cli.js'), '');
  const probes = [], installs = [], installation = { agentsHome: path.join(root, 'agents'), lockPath: path.join(root, 'lock'), lock: { skills: { ake: { sourceType: 'local' } } }, agentPaths: [] };
  const result = await runUpdate({ home, env: { HOME: home, PATH: `${bin};`, PATHEXT: '.CMD' }, platform: 'win32', tempRoot, projectRoot: path.join(root, 'project'), flags: { dryRun: false, json: true, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args, options) => { probes.push([command, args, options]); return command === process.execPath ? { stdout: '1.8.0' } : (() => { throw Object.assign(new Error('npx absent'), { code: 'ENOENT' }); })(); }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha }), acquireLock: async () => ({ release: async () => {} }), detectCustomization: async () => 'clean', snapshotInstallEffects: async () => 'same', createBackup: async () => ({ backupPath: '/fake' }), runSkillsAdd: async (command, args, options) => installs.push([command, args, options]), verifyInstalled: async () => {}, readAfter: async () => installation, cleanupBackups: async () => [] });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.equal(probes[0][0], process.execPath); assert.equal(installs[0][0], process.execPath);
  assert.deepEqual(installs[0][1].slice(0, 4), [await realpath(path.join(npm, 'bin', 'npx-cli.js')), '--no-install', 'skills', 'add']); assert.equal(installs[0][2].shell, false); assert.ok(!installs[0][0].toLowerCase().includes('cmd.exe'));
});

test('simulated Windows layout on macOS dry-run uses node-resolved npx.cmd without shell', async t => {
  const root = await makeWorkDir('ake-win-npx-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(root, 'temp'), bin = path.join(root, 'bin'); await mkdir(tempRoot); await mkdir(bin);
  const npm = path.join(bin, 'node_modules', 'npm'); await mkdir(path.join(npm, 'bin'), { recursive: true });
  await writeFile(path.join(bin, 'npx.cmd'), '@echo off'); await writeFile(path.join(npm, 'package.json'), JSON.stringify({ name: 'npm', bin: { npx: 'bin/npx-cli.js' } })); await writeFile(path.join(npm, 'bin', 'npx-cli.js'), '');
  const calls = [];
  const result = await runUpdate({ home, env: { HOME: home, PATH: `${bin};`, PATHEXT: '.CMD' }, platform: 'win32', tempRoot, projectRoot: path.join(root, 'project'), flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args, options) => { calls.push([command, args, options]); return { stdout: '1.8.0' }; },
    resolveInstallation: async () => ({ lock: { skills: { ake: { sourceType: 'local' } } } }), resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha }) });
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.equal(calls[0][0], process.execPath); assert.equal(calls[0][1][0], await realpath(path.join(npm, 'bin', 'npx-cli.js'))); assert.equal(calls[0][2].shell, undefined);
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
