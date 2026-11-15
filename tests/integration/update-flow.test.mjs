import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, chmod, rm, readFile, readdir, cp, lstat, symlink, readlink, realpath } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createBackup, restoreBackup } from '../../src/lib/install-backup.mjs';
import { acquirePinnedSkillsCli, makeSkillsEnvironment, runUpdate, updateExitCode } from '../../src/lib/update.mjs';
import { resolveRemote, runGit } from '../../src/lib/git-remote.mjs';
import { cleanTestEnv, tempRoot } from '../helpers/test-env.mjs';

const run = (bin, args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', ...opts });
async function makeWorkDir(prefix) { return tempRoot(prefix); }
async function rollbackFixture(t, prefix, lockValue = { skills: { ake: { sourceType: 'local', source: '/legacy' }, other: { ref: 'keep' } } }) {
  const root = await makeWorkDir(prefix); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), '---\\nname: ake\\n---\\n# old\\n'); await writeFile(path.join(canonical, 'custom.txt'), 'preserve');
  const lockBytes = Buffer.from(JSON.stringify(lockValue)); await writeFile(lockPath, lockBytes);
  const installation = { agentsHome, canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', source: 'local', sourceType: 'local', commit: null, agentPaths: [{ path: canonical, mode: 'canonical' }], lockPath, lock: lockValue, lockBytes };
  return { root, home, agentsHome, canonical, lockPath, lockBytes, installation };
}
async function treeSnapshot(root) {
  const entries = [];
  async function walk(current, relative = '') {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      const full = path.join(current, item.name), info = await lstat(full), mode = info.mode & 0o777;
      if (info.isSymbolicLink()) entries.push([name, 'symlink', mode, await readlink(full)]);
      else if (info.isDirectory()) { entries.push([name, 'directory', mode]); await walk(full, name); }
      else if (info.isFile()) entries.push([name, 'file', mode, createHash('sha256').update(await readFile(full)).digest('hex')]);
      else entries.push([name, 'other', mode]);
    }
  }
  await walk(root); return entries.sort((a, b) => a[0].localeCompare(b[0]));
}

test('rollback preserves concurrent non-snapshot skill entries and retains backup with exact warnings', async t => {
  const f = await rollbackFixture(t, 'ake-rollback-preserve-', { skills: { ake: { sourceType: 'local', source: '/legacy' }, other: { ref: 'keep' } } });
  const userNote = path.join(f.agentsHome, 'skills', 'user-note.txt'), otherSkill = path.join(f.agentsHome, 'skills', 'other-skill');
  const result = await runUpdate({ home: f.home, package: { repository: { url: 'https://github.com/o/r.git' } }, flags: { dryRun: false, json: true, acceptCustomized: true },
    probeSkillsCli: async () => {}, resolveInstallation: async () => f.installation, detectCustomization: async () => 'clean',
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: '2'.repeat(40), entries: [] }),
    runSkillsAdd: async () => { await writeFile(path.join(f.canonical, 'SKILL.md'), '---\\nname: ake\\n---\\n# half-installed\\n'); await writeFile(path.join(f.canonical, 'new.txt'), 'installer'); await writeFile(path.join(f.lockPath), JSON.stringify({ skills: { ake: { sourceType: 'github', ref: '2'.repeat(40) }, other: { ref: 'keep' } } })); await writeFile(userNote, 'user content'); await mkdir(otherSkill); await writeFile(path.join(otherSkill, 'SKILL.md'), '---\\nname: other-skill\\n---\\n'); throw Object.assign(new Error('stub install failed'), { code: 'INSTALL' }); } });
  assert.equal(result.rollback, 'failed'); assert.equal(result.errorCode, 'ROLLBACK_FAILED'); assert.ok(result.backupPath); assert.equal(await readFile(path.join(f.canonical, 'custom.txt'), 'utf8'), 'preserve');
  assert.match(await readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), /# old/); assert.deepEqual(await readFile(f.lockPath), f.lockBytes);
  assert.equal(await readFile(path.join(f.canonical, 'new.txt'), 'utf8'), 'installer'); assert.equal(await readFile(userNote, 'utf8'), 'user content'); assert.match(await readFile(path.join(otherSkill, 'SKILL.md'), 'utf8'), /name: other-skill/);
  assert.ok(result.warnings.some(w => w.includes('AKE 文件已恢复；以下非快照条目未删除，请人工确认') && w.includes(path.join(f.canonical, 'new.txt')) && w.includes(userNote) && w.includes(otherSkill)));
  await lstat(result.backupPath).then(info => assert.equal(info.isDirectory(), true));
});

test('rollback preserves a concurrent AKE symlink absent from the snapshot', async t => {
  const f = await rollbackFixture(t, 'ake-rollback-symlink-');
  const claudeSkills = path.join(f.home, '.claude', 'skills'), claudeAke = path.join(claudeSkills, 'ake'); await mkdir(claudeSkills, { recursive: true });
  const target = path.relative(path.dirname(claudeAke), f.canonical);
  const result = await runUpdate({ home: f.home, package: { repository: { url: 'https://github.com/o/r.git' } }, flags: { dryRun: false, json: true, acceptCustomized: true }, probeSkillsCli: async () => {},
    resolveInstallation: async () => f.installation, detectCustomization: async () => 'clean', resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: '3'.repeat(40), entries: [] }),
    runSkillsAdd: async () => { await writeFile(path.join(f.canonical, 'SKILL.md'), '---\\nname: ake\\n---\\n# half-installed\\n'); await writeFile(f.lockPath, JSON.stringify({ skills: { ake: { sourceType: 'github', ref: '3'.repeat(40) }, other: { ref: 'keep' } } })); await symlink(target, claudeAke); throw Object.assign(new Error('stub install failed'), { code: 'INSTALL' }); } });
  assert.equal(result.rollback, 'failed'); assert.equal(result.errorCode, 'ROLLBACK_FAILED'); assert.ok(result.backupPath); assert.match(await readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), /# old/);
  assert.equal((await lstat(claudeAke)).isSymbolicLink(), true); assert.equal(await readlink(claudeAke), target);
  assert.ok(result.warnings.some(w => w.includes('以下非快照条目未删除') && w.includes(`${claudeAke} (symlink -> ${target})`)));
  await lstat(result.backupPath).then(info => assert.equal(info.isDirectory(), true));
});

test('rollback restores an explicitly snapshotted existing AKE symlink', async t => {
  const f = await rollbackFixture(t, 'ake-rollback-existing-link-');
  const claudeSkills = path.join(f.home, '.claude', 'skills'), claudeAke = path.join(claudeSkills, 'ake'); await mkdir(claudeSkills, { recursive: true });
  const target = path.relative(path.dirname(claudeAke), f.canonical); await symlink(target, claudeAke);
  const backup = await createBackup({ agentsHome: f.agentsHome, installation: f.installation, lockPath: f.lockPath, targetCommit: '4'.repeat(40) });
  await rm(claudeAke); await writeFile(path.join(f.canonical, 'SKILL.md'), 'half-installed');
  assert.equal(await restoreBackup(backup), true); assert.equal((await lstat(claudeAke)).isSymbolicLink(), true);
  assert.equal(await readlink(claudeAke), target);
});

test('rollback rejects top-level lock drift without overwriting user state and keeps backup', async t => {
  const original = { version: 1, dismissed: {}, lastSelectedAgents: ['codex'], skills: { ake: { sourceType: 'local', source: '/legacy' }, other: { ref: 'keep' } } };
  const f = await rollbackFixture(t, 'ake-rollback-lock-drift-', original);
  const concurrent = Buffer.from(JSON.stringify({ ...original, dismissed: { other: 'new user state' }, lastSelectedAgents: ['claude-code'], skills: { ake: { sourceType: 'github', ref: '2'.repeat(40) }, other: { ref: 'keep' } } }));
  const result = await runUpdate({ home: f.home, package: { repository: { url: 'https://github.com/o/r.git' } }, flags: { dryRun: false, json: true, acceptCustomized: true }, probeSkillsCli: async () => {},
    resolveInstallation: async () => f.installation, detectCustomization: async () => 'clean', resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: '2'.repeat(40), entries: [] }),
    runSkillsAdd: async () => { await writeFile(path.join(f.canonical, 'SKILL.md'), '---\\nname: ake\\n---\\n# half-installed\\n'); await writeFile(f.lockPath, concurrent); throw Object.assign(new Error('stub install failed'), { code: 'INSTALL' }); } });
  assert.equal(result.rollback, 'failed'); assert.equal(result.errorCode, 'ROLLBACK_FAILED'); assert.ok(result.backupPath);
  assert.equal(await readFile(path.join(f.canonical, 'custom.txt'), 'utf8'), 'preserve'); assert.match(await readFile(path.join(f.canonical, 'SKILL.md'), 'utf8'), /# old/);
  assert.deepEqual(await readFile(f.lockPath), concurrent); assert.ok(result.warnings.some(w => /lock\.dismissed|lock\.lastSelectedAgents/.test(w)));
  await lstat(result.backupPath).then(info => assert.equal(info.isDirectory(), true));
});

test('real Skills CLI 1.8.1 copy mode preserves lock semantics and is isolated', { skip: process.env.AKE_RUN_REAL_SKILLS_CLI_TEST !== '1' && 'set AKE_RUN_REAL_SKILLS_CLI_TEST=1 for isolated npm/Skills CLI network verification' }, async t => {
  const root = await makeWorkDir('ake-real-skills-cli-'); t.after(() => rm(root, { recursive: true, force: true }));
  const npmDirectory = path.join(root, 'npm-work'); await mkdir(npmDirectory);
  const cli = await acquirePinnedSkillsCli({ npmDirectory, baseEnvironment: cleanTestEnv({ HOME: path.join(root, 'untrusted-host-home') }) });
  assert.equal(cli.version, '1.8.1');
  const source = path.join(root, 'source'); await mkdir(path.join(source, 'skills', 'ake'), { recursive: true });
  await writeFile(path.join(source, 'skills', 'ake', 'SKILL.md'), '---\nname: ake\ndescription: isolated real Skills CLI fixture\n---\n# AKE fixture\n');
  run('git', ['init', '-b', 'main', source]); run('git', ['-C', source, 'add', '.']); run('git', ['-C', source, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
  for (const copy of [false, true]) {
    const home = path.join(root, copy ? 'home-copy' : 'home-default'); await mkdir(home);
    const args = [...cli.prefix, 'add', source, '--skill', 'ake', '-g', '-y', '-a', 'codex', '-a', 'claude-code', '--json', ...(copy ? ['--copy'] : [])];
    const installEnv = makeSkillsEnvironment(cli.env, home, npmDirectory);
    const result = spawnSync(cli.command, args, { cwd: root, encoding: 'utf8', env: installEnv });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const canonical = path.join(home, '.agents', 'skills', 'ake'), claude = path.join(home, '.claude', 'skills', 'ake');
    const canonicalStat = await lstat(canonical), claudeStat = await lstat(claude);
    assert.equal(canonicalStat.isDirectory(), true); assert.equal(claudeStat.isSymbolicLink(), !copy);
    const lock = JSON.parse(await readFile(path.join(home, '.agents', '.skill-lock.json'), 'utf8'));
    assert.equal(lock.skills.ake.installMode, copy ? 'copy' : undefined);
    assert.equal((await realpath(canonical)).startsWith(await realpath(root)), true);
    if (copy) { assert.notEqual(await realpath(claude), await realpath(canonical)); assert.equal(await readFile(path.join(claude, 'SKILL.md'), 'utf8'), await readFile(path.join(canonical, 'SKILL.md'), 'utf8')); }
    else {
      assert.equal(await realpath(claude), await realpath(canonical));
      const lockPath = path.join(home, '.agents', '.skill-lock.json'), beforeLock = await readFile(lockPath);
      const mixedLock = JSON.parse(beforeLock); mixedLock.skills.ake.installMode = 'copy'; await writeFile(lockPath, JSON.stringify(mixedLock));
      const copyLockBytes = await readFile(lockPath); let acquired = false, backed = false;
      const refused = await runUpdate({ entry: fileURLToPath(new URL('../../scripts/ake.mjs', import.meta.url)), installationOptions: { entry: fileURLToPath(new URL('../../scripts/ake.mjs', import.meta.url)), home, env: cleanTestEnv({ HOME: home }) }, home,
        env: cleanTestEnv({ HOME: home }), projectRoot: root, flags: { dryRun: false, json: true, acceptCustomized: true },
        resolveRemote: async () => ({ sourceUrl: 'https://github.com/Shakyae/agent-knowledge-engine.git', repo: 'Shakyae/agent-knowledge-engine', defaultBranch: 'master', targetCommit: 'f'.repeat(40), entries: [] }),
        acquireSkillsCli: async () => { acquired = true; return cli; }, createBackup: async () => { backed = true; } });
      assert.equal(refused.errorCode, 'IDENTITY_AMBIGUOUS'); assert.equal(acquired || backed, false);
      assert.equal((await lstat(claude)).isSymbolicLink(), true); assert.deepEqual(await readFile(lockPath), copyLockBytes);
      await writeFile(lockPath, beforeLock);
      const mixedUpdate = spawnSync(cli.command, [...cli.prefix, 'add', source, '--skill', 'ake', '-g', '-y', '-a', 'codex', '-a', 'claude-code', '--copy', '--json'], { cwd: root, encoding: 'utf8', env: installEnv });
      assert.equal(mixedUpdate.status, 0, mixedUpdate.stderr || mixedUpdate.stdout);
      assert.equal((await lstat(claude)).isSymbolicLink(), false);
      assert.equal(JSON.parse(await readFile(path.join(home, '.agents', '.skill-lock.json'), 'utf8')).skills.ake.installMode, 'copy');
    }
  }
});

test('real official old SHA updates to current HEAD with copy and preserves unrelated skills', { skip: process.env.AKE_RUN_REAL_OLD_TO_NEW_UPDATE !== '1' && 'set AKE_RUN_REAL_OLD_TO_NEW_UPDATE=1 for isolated old-SHA-to-HEAD verification' }, async t => {
  const oldSha = '450d2a711a5a3ac806bff532d03b969b6c45c2fb';
  const root = await makeWorkDir('ake-real-old-to-new-'); t.after(() => rm(root, { recursive: true, force: true }));
  const homeRequested = path.join(root, 'home'); await mkdir(homeRequested); const home = await realpath(homeRequested);
  const npmDirectory = path.join(root, 'initial-cli'); await mkdir(npmDirectory);
  const cli = await acquirePinnedSkillsCli({ npmDirectory, baseEnvironment: cleanTestEnv({ HOME: path.join(root, 'host-home') }) });
  const installEnv = makeSkillsEnvironment(cli.env, home, npmDirectory);
  const oldInstall = spawnSync(cli.command, [...cli.prefix, 'add', `Shakyae/agent-knowledge-engine@${oldSha}`, '--skill', 'ake', '-g', '-y', '-a', 'codex', '--copy', '--json'], { cwd: root, encoding: 'utf8', env: installEnv });
  assert.equal(oldInstall.status, 0, oldInstall.stderr || oldInstall.stdout);
  const agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  let lock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lock.skills.ake.ref, oldSha); assert.equal(lock.skills.ake.installMode, 'copy'); assert.equal((await lstat(canonical)).isDirectory(), true);
  const entry = path.join(canonical, 'resources', 'ake-source', 'scripts', 'ake.mjs'); assert.equal((await lstat(entry)).isFile(), true);
  const otherSkill = path.join(agentsHome, 'skills', 'other-skill'); await mkdir(otherSkill, { recursive: true }); await writeFile(path.join(otherSkill, 'SKILL.md'), 'keep this non-AKE skill');
  const otherRecord = { sourceType: 'local', source: 'test-fixture', skillPath: 'skills/other-skill/SKILL.md' }; lock.skills.other = otherRecord; await writeFile(lockPath, JSON.stringify(lock));
  const calls = [];
  const result = await runUpdate({ entry, installationOptions: { entry, home, env: cleanTestEnv({ HOME: home }) }, home, env: cleanTestEnv({ HOME: home }), projectRoot: root,
    package: JSON.parse(await readFile(path.join(fileURLToPath(new URL('../..', import.meta.url)), 'package.json'), 'utf8')),
    flags: { dryRun: false, json: true, acceptCustomized: false },
    runSkillsAdd: async (command, args, options) => {
      calls.push({ command, args, home: options.env.HOME, userprofile: options.env.USERPROFILE });
      const installed = spawnSync(command, args, { encoding: 'utf8', env: options.env, cwd: root, shell: false });
      if (installed.error || installed.status !== 0) throw Object.assign(new Error(installed.stderr || installed.error?.message || `skills exited ${installed.status}`), { code: 'INSTALL', stderr: installed.stderr });
    } });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.equal(result.oldCommit, oldSha); assert.notEqual(result.targetCommit, oldSha);
  assert.equal(result.installationBefore.agentPaths.length, 1); assert.ok(calls[0].args.includes('--copy')); assert.ok(calls[0].args.includes('-a') && calls[0].args.includes('codex'));
  assert.equal(calls[0].args.includes('claude-code'), false); assert.equal(calls[0].home, home); assert.equal(calls[0].userprofile, home);
  lock = JSON.parse(await readFile(lockPath, 'utf8')); assert.equal(lock.skills.ake.ref, result.targetCommit); assert.equal(lock.skills.ake.installMode, 'copy'); assert.deepEqual(lock.skills.other, otherRecord);
  assert.equal(await readFile(path.join(otherSkill, 'SKILL.md'), 'utf8'), 'keep this non-AKE skill');
  assert.equal(await lstat(result.backupPath).then(info => info.isDirectory()), true); assert.equal(result.backupPath.startsWith(home), true);
  assert.equal((await realpath(canonical)).startsWith(await realpath(root)), true);
  t.diagnostic(`verified official Skills CLI update ${oldSha} -> ${result.targetCommit}; copy mode and non-AKE sibling preserved`);
});

test('real isolated update runs the verified Skills CLI without touching the user install', { skip: process.env.AKE_RUN_REAL_SKILLS_UPDATE !== '1' && 'set AKE_RUN_REAL_SKILLS_UPDATE=1 for isolated GitHub update verification' }, async t => {
  const root = await makeWorkDir('ake-real-update-'); t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = fileURLToPath(new URL('../..', import.meta.url)), checkout = path.join(root, 'checkout');
  run('git', ['clone', '--quiet', sourceRoot, checkout]);
  run('git', ['-C', checkout, 'remote', 'set-url', 'origin', 'https://github.com/Shakyae/agent-knowledge-engine.git']);
  await cp(path.join(sourceRoot, 'src', 'lib', 'update.mjs'), path.join(checkout, 'src', 'lib', 'update.mjs'));
  const requestedHome = path.join(root, 'home'); await mkdir(requestedHome);
  const home = await realpath(requestedHome), canonical = path.join(home, '.agents', 'skills', 'ake'); await mkdir(path.dirname(canonical), { recursive: true });
  await cp(path.join(checkout, 'skills', 'ake'), canonical, { recursive: true });
  const claude = path.join(home, '.claude', 'skills', 'ake'); await mkdir(path.dirname(claude), { recursive: true }); await symlink(path.relative(path.dirname(claude), canonical), claude);
  await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills: { ake: { sourceType: 'local', source: checkout } }, dismissed: {} }));
  const entry = path.join(checkout, 'scripts', 'ake.mjs');
  const result = await runUpdate({ entry, installationOptions: { entry, home, env: cleanTestEnv({ HOME: home }) }, home,
    env: cleanTestEnv({ HOME: home }), projectRoot: root, flags: { dryRun: false, json: true, acceptCustomized: true } });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.equal(result.rollback, 'not_needed'); assert.equal(result.installationAfter.scope, 'user');
  assert.equal((await lstat(canonical)).isDirectory(), true); assert.equal((await lstat(claude)).isSymbolicLink(), true); assert.equal(await realpath(claude), await realpath(canonical));
  const lock = JSON.parse(await readFile(path.join(home, '.agents', '.skill-lock.json'), 'utf8'));
  assert.equal(lock.skills.ake.ref, result.targetCommit); assert.equal(lock.skills.ake.skillPath, 'skills/ake/SKILL.md');
  assert.equal(await lstat(result.backupPath).then(info => info.isDirectory()), true);
  const beforeRepeat = await treeSnapshot(home);
  const repeated = await runUpdate({ entry, installationOptions: { entry, home, env: cleanTestEnv({ HOME: home }), allowCompletedBootstrap: true }, home,
    env: cleanTestEnv({ HOME: home }), projectRoot: root, flags: { dryRun: false, json: true, acceptCustomized: true }, acquireSkillsCli: async () => { throw new Error('idempotent check must not acquire CLI'); } });
  assert.equal(repeated.status, 'up_to_date', JSON.stringify(repeated)); assert.equal(repeated.backupPath, null);
  assert.deepEqual(await treeSnapshot(home), beforeRepeat);

});

test('installed entry updates to a bare-repo commit without repository.url and reports source unknown', async t => {
  const root = await makeWorkDir('ake-installed-entry-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), canonical = path.join(home, '.agents', 'skills', 'ake'), entry = path.join(canonical, 'resources', 'ake-source', 'scripts', 'ake.mjs');
  const official = 'https://github.com/Shakyae/agent-knowledge-engine.git', repo = path.join(root, 'remote.git'), work = path.join(root, 'work');
  const targetFiles = { 'SKILL.md': '# target', 'bootstrap.mjs': 'export {};', 'resources/ake-source/package.json': JSON.stringify({ name: 'agent-knowledge-engine', version: '0.2.0' }), 'resources/ake-source/scripts/ake.mjs': '// target CLI' };
  run('git', ['init', '--bare', repo]); run('git', ['init', '-b', 'main', work]);
  await run('git', ['-C', work, 'remote', 'add', 'origin', repo]);
  for (const [relativePath, bytes] of Object.entries(targetFiles)) { const full = path.join(work, 'skills', 'ake', ...relativePath.split('/')); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, bytes); }
  run('git', ['-C', work, 'add', '.']); run('git', ['-C', work, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'target without repository url']);
  run('git', ['-C', work, 'push', 'origin', 'HEAD:refs/heads/main']); run('git', ['--git-dir', repo, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  const targetCommit = run('git', ['-C', work, 'rev-parse', 'HEAD']).trim();
  const localRunner = (args, options) => runGit(args.map(arg => arg === official ? repo : arg), options);
  const oldFiles = { ...targetFiles, 'SKILL.md': '# old', 'resources/ake-source/package.json': JSON.stringify({ name: 'agent-knowledge-engine', version: '0.1.0', repository: { url: official } }), 'resources/ake-source/scripts/ake.mjs': '// old CLI' };
  for (const [relativePath, bytes] of Object.entries(oldFiles)) { const full = path.join(canonical, ...relativePath.split('/')); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, bytes); }
  const lockPath = path.join(home, '.agents', '.skill-lock.json'); await writeFile(lockPath, JSON.stringify({ skills: { ake: { sourceType: 'local', source: '/legacy' }, other: { sourceType: 'github', ref: 'preserve' } } }));
  const resolveLocalRemote = ({ repoUrl }) => resolveRemote({ repoUrl, gitRunner: localRunner, tempDirectory: root });
  const result = await runUpdate({ entry, installationOptions: { entry, home, env: {} }, home, flags: { dryRun: false, json: true, acceptCustomized: true }, probeSkillsCli: async () => {}, resolveRemote: resolveLocalRemote,
    detectCustomization: async () => 'clean', runSkillsAdd: async (_command, args) => { assert.ok(args.includes(`Shakyae/agent-knowledge-engine@${targetCommit}`)); for (const [relativePath, bytes] of Object.entries(targetFiles)) await writeFile(path.join(canonical, ...relativePath.split('/')), bytes); const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.skills.ake = { sourceType: 'github', source: 'Shakyae/agent-knowledge-engine', sourceUrl: official, ref: targetCommit, skillPath: 'skills/ake/SKILL.md' }; await writeFile(lockPath, JSON.stringify(lock)); } });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.equal(result.rollback, 'not_needed'); assert.ok(result.installationAfter, JSON.stringify(result));
  assert.equal(result.installationAfter.canonicalPath, await import('node:fs/promises').then(fs => fs.realpath(canonical)));
  assert.equal(result.installationAfter.source, null); assert.equal(result.installationAfter.sourceType, 'github'); assert.equal(result.installationAfter.commit, null);
  assert.ok(result.warnings.some(warning => warning === '已安装版本未声明 repository.url；下次更新需要包含该字段的版本，否则将因无法确认来源而拒绝'));
  const badEntry = path.join(root, 'missing', 'ake.mjs');
  const rejected = await runUpdate({ entry: badEntry, installationOptions: { entry: badEntry, home, env: {} }, home, flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: official } }, probeSkillsCli: async () => {} });
  assert.equal(rejected.errorCode, 'IDENTITY_AMBIGUOUS'); assert.equal(rejected.status, 'failed');
});

test('dry-run skips npm/Skills CLI entirely and leaves HOME unchanged', async t => {
  const root = await makeWorkDir('ake-dry-run-no-npm-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'); await mkdir(home);
  const before = await treeSnapshot(home); let probed = false, acquired = false;
  const installation = { lock: { skills: { ake: { sourceType: 'local' } } } };
  const result = await runUpdate({ home, env: cleanTestEnv({ HOME: home }), flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async () => { probed = true; }, acquireSkillsCli: async () => { acquired = true; }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'f'.repeat(40), entries: [] }) });
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.equal(probed || acquired, false); assert.deepEqual(await treeSnapshot(home), before);
});

test('trusted checkout bootstrap migrates temp local install to exact remote SHA lock', async t => {
  const root = await makeWorkDir('ake-bootstrap-flow-'); t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout'), home = path.join(root, 'home'), canonical = path.join(home, '.agents', 'skills', 'ake'), targetSha = 'd'.repeat(40);
  await mkdir(path.join(checkout, 'skills', 'ake'), { recursive: true }); await mkdir(path.join(checkout, 'scripts'), { recursive: true });
  await writeFile(path.join(checkout, 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine', repository: { url: 'https://github.com/Shakyae/agent-knowledge-engine.git' } }));
  await writeFile(path.join(checkout, 'skills', 'ake', 'SKILL.md'), '# source payload'); await writeFile(path.join(checkout, 'scripts', 'ake.mjs'), '');
  run('git', ['init', checkout]); run('git', ['-C', checkout, 'add', '.']); run('git', ['-C', checkout, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'checkout']);
  run('git', ['-C', checkout, 'remote', 'add', 'origin', 'https://github.com/Shakyae/agent-knowledge-engine.git']);
  await mkdir(path.join(canonical, 'resources', 'ake-source', 'scripts'), { recursive: true });
  const targetFiles = { 'SKILL.md': '# remote target', 'bootstrap.mjs': 'export {};', 'resources/ake-source/package.json': '{"version":"0.2.0"}', 'resources/ake-source/scripts/ake.mjs': '// CLI' };
  for (const [relative, contents] of Object.entries(targetFiles)) await writeFile(path.join(canonical, ...relative.split('/')), '# old');
  const lockPath = path.join(home, '.agents', '.skill-lock.json'), originalLock = { skills: { ake: { sourceType: 'local', source: checkout }, other: { sourceType: 'github', ref: 'keep' } } };
  await writeFile(lockPath, JSON.stringify(originalLock));
  const result = await runUpdate({ entry: path.join(checkout, 'scripts', 'ake.mjs'), installationOptions: { entry: path.join(checkout, 'scripts', 'ake.mjs'), home, env: {} }, home,
    flags: { dryRun: false, json: true, acceptCustomized: true }, probeSkillsCli: async () => {},
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/Shakyae/agent-knowledge-engine.git', repo: 'Shakyae/agent-knowledge-engine', defaultBranch: 'main', targetCommit: targetSha, entries: Object.entries(targetFiles).map(([relativePath, bytes]) => ({ relativePath, bytes, mode: '100644', type: 'blob' })) }),
    detectCustomization: async () => 'unknown', runSkillsAdd: async (_command, args) => {
      assert.ok(args.includes(`Shakyae/agent-knowledge-engine@${targetSha}`));
      for (const [relative, contents] of Object.entries(targetFiles)) await writeFile(path.join(canonical, ...relative.split('/')), contents);
      await writeFile(lockPath, JSON.stringify({ skills: { ake: { sourceType: 'github', source: 'Shakyae/agent-knowledge-engine', sourceUrl: 'https://github.com/Shakyae/agent-knowledge-engine.git', ref: targetSha, skillPath: 'skills/ake/SKILL.md' }, other: originalLock.skills.other } }));
    } });
  assert.equal(result.status, 'updated', JSON.stringify(result)); assert.ok(result.installationAfter, JSON.stringify(result)); assert.equal(result.bootstrap, true); assert.equal(result.initiatedBy, 'checkout'); assert.equal(result.scopeBefore, 'development');
  assert.ok(result.warnings.some(warning => warning.includes('源码 checkout 引导')));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lock.skills.ake.sourceType, 'github'); assert.equal(lock.skills.ake.ref, targetSha); assert.deepEqual(lock.skills.other, originalLock.skills.other);
});

test('copied user-level CLI dry-run emits one JSON report without installation writes', async t => {
  const root = await makeWorkDir('ake-update-cli-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), canonical = path.join(home, '.agents', 'skills', 'ake'), bundle = path.join(canonical, 'resources', 'ake-source'), bin = path.join(root, 'bin');
  await mkdir(path.join(bundle, 'src'), { recursive: true }); await mkdir(path.join(bundle, 'scripts'), { recursive: true }); await mkdir(bin, { recursive: true });
  await cp(fileURLToPath(new URL('../../src/lib', import.meta.url)), path.join(bundle, 'src', 'lib'), { recursive: true });
  await cp(fileURLToPath(new URL('../../scripts/ake.mjs', import.meta.url)), path.join(bundle, 'scripts', 'ake.mjs'));
  await cp(fileURLToPath(new URL('../../package.json', import.meta.url)), path.join(bundle, 'package.json'));
  await writeFile(path.join(canonical, 'SKILL.md'), '# isolated'); await writeFile(path.join(canonical, 'bootstrap.mjs'), '');
  await mkdir(path.join(bundle, 'resources', 'ake-source', 'scripts'), { recursive: true });
  await writeFile(path.join(bundle, 'resources', 'ake-source', 'package.json'), JSON.stringify({ version: '0.1.0', repository: { url: 'https://github.com/Shakyae/agent-knowledge-engine.git' } }));
  await writeFile(path.join(bundle, 'resources', 'ake-source', 'scripts', 'ake.mjs'), '');
  const lockPath = path.join(home, '.agents', '.skill-lock.json'); await writeFile(lockPath, JSON.stringify({ skills: { ake: { sourceType: 'local', source: 'local' } } }));
  const sha = 'c'.repeat(40);
  const gitStub = path.join(bin, 'git');
  await writeFile(gitStub, ['#!/usr/bin/env node', `const a=process.argv.slice(2); if(a.includes('ls-remote')) process.stdout.write('ref: refs/heads/trunk\\tHEAD\\n${sha}\\tHEAD\\n'); else if(a.includes('rev-parse')) process.stdout.write('${sha}\\n'); else if(a.includes('ls-tree')) process.stdout.write('');`].join('\n')); await chmod(gitStub, 0o755);
  const skillsStub = path.join(bin, 'skills'); await writeFile(skillsStub, ['#!/bin/sh', 'echo 1.8.1'].join('\n')); await chmod(skillsStub, 0o755);
  const result = spawnSync(process.execPath, [path.join(bundle, 'scripts', 'ake.mjs'), 'update', '--dry-run', '--json'], { encoding: 'utf8', env: cleanTestEnv({ HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` }) });
  assert.equal(result.status, 0, result.stderr + result.stdout); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout); assert.equal(report.status, 'dry_run'); assert.equal(report.targetCommit, sha);
  const dryText = spawnSync(process.execPath, [path.join(bundle, 'scripts', 'ake.mjs'), 'update', '--dry-run'], { encoding: 'utf8', env: cleanTestEnv({ HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}` }) });
  assert.equal(dryText.status, 0, dryText.stderr); assert.match(dryText.stdout, /状态: dry_run/);
  assert.equal(await readFile(path.join(canonical, 'SKILL.md'), 'utf8'), '# isolated');
  await assert.rejects(readFile(path.join(home, '.agents', 'ake', 'update.lock')), { code: 'ENOENT' });
  const customAgentsHome = path.join(home, 'custom-agents'), customSkill = path.join(customAgentsHome, 'skills', 'ake');
  await mkdir(path.dirname(customSkill), { recursive: true }); await cp(canonical, customSkill, { recursive: true });
  await writeFile(path.join(customAgentsHome, '.skill-lock.json'), JSON.stringify({ skills: { ake: { sourceType: 'local', source: 'local' } } }));
  const customCli = path.join(customSkill, 'resources', 'ake-source', 'scripts', 'ake.mjs');
  const customUpdate = spawnSync(process.execPath, [customCli, 'update', '--dry-run', '--json'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)), env: cleanTestEnv({ HOME: home, DSH_AGENTS_HOME: customAgentsHome, PATH: `${bin}${path.delimiter}${process.env.PATH}` }) });
  assert.equal(customUpdate.status, 1); const rejected = JSON.parse(customUpdate.stdout); assert.equal(rejected.errorCode, 'IDENTITY_AMBIGUOUS');
  assert.ok(rejected.message.includes('Skills CLI is only verified to write HOME/.agents'));
  const customText = spawnSync(process.execPath, [customCli, 'update'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)), env: cleanTestEnv({ HOME: home, DSH_AGENTS_HOME: customAgentsHome, PATH: `${bin}${path.delimiter}${process.env.PATH}` }) });
  assert.equal(customText.status, 1); assert.match(customText.stdout, /错误码: IDENTITY_AMBIGUOUS/);
  const customJson = spawnSync(process.execPath, [customCli, 'update', '--json'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)), env: cleanTestEnv({ HOME: home, DSH_AGENTS_HOME: customAgentsHome, PATH: `${bin}${path.delimiter}${process.env.PATH}` }) });
  assert.equal(customJson.status, 1); assert.equal(JSON.parse(customJson.stdout).errorCode, 'IDENTITY_AMBIGUOUS');
  await assert.rejects(readFile(path.join(customAgentsHome, 'ake', 'update.lock')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(customAgentsHome, 'ake', 'backups')), { code: 'ENOENT' });
  const status = spawnSync(process.execPath, [customCli, 'status', '--json'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../..', import.meta.url)), env: cleanTestEnv({ HOME: home, DSH_AGENTS_HOME: customAgentsHome }) });
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).installation.canonicalPath, await import('node:fs/promises').then(fs => fs.realpath(customSkill)));
});

test('isolated bare repository fixture and PATH Skills stub exercise update dispatch and rollback', async t => {
  const root = await makeWorkDir('ake-update-flow-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), repo = path.join(root, 'repo'), bin = path.join(root, 'bin');
  await mkdir(home, { recursive: true }); await mkdir(bin);
  run('git', ['init', '--bare', repo]);
  const work = path.join(root, 'work'); run('git', ['clone', repo, work]);
  await mkdir(path.join(work, 'skills', 'ake'), { recursive: true });
  await writeFile(path.join(work, 'skills', 'ake', 'SKILL.md'), '# skill');
  run('git', ['-C', work, 'add', '.']); run('git', ['-C', work, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
  run('git', ['-C', work, 'push', 'origin', 'HEAD:refs/heads/main']);
  const sha = run('git', ['-C', work, 'rev-parse', 'HEAD']).trim();
  const install = path.join(home, '.agents', 'skills', 'ake');
  const targetFiles = { 'SKILL.md': '# skill', 'bootstrap.mjs': 'export {};', 'resources/ake-source/package.json': '{}', 'resources/ake-source/scripts/ake.mjs': '// cli' };
  await mkdir(install, { recursive: true });
  for (const [relativePath, contents] of Object.entries({ ...targetFiles, 'SKILL.md': '# old' })) { const full = path.join(install, ...relativePath.split('/')); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, contents); }
  let stubBehavior = 'ok'; let captured;
  const stubPath = path.join(bin, 'skills');
  await writeFile(stubPath, `#!/usr/bin/env node\nimport fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(${JSON.stringify(path.join(root, 'captured.json'))}, JSON.stringify(process.argv.slice(2))); const mode=process.env.STUB_MODE; if(mode==='half') fs.writeFileSync(path.join(process.env.AKE_TEST_CANONICAL,'SKILL.md'),'half'); if(mode==='ok'||mode==='wrong-ref') { for(const [name,data] of Object.entries(JSON.parse(process.env.AKE_TEST_TARGETS))) { const file=path.join(process.env.AKE_TEST_CANONICAL,...name.split('/')); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); } const lock=JSON.parse(fs.readFileSync(process.env.AKE_TEST_LOCK,'utf8')); lock.skills.ake={sourceType:'github',source:'o/r',sourceUrl:'https://github.com/o/r.git',ref:mode==='wrong-ref'?'0'.repeat(40):process.env.AKE_TEST_TARGET,skillPath:'skills/ake/SKILL.md'}; fs.writeFileSync(process.env.AKE_TEST_LOCK,JSON.stringify(lock)); } if(mode==='extra') { fs.mkdirSync(path.join(process.env.AKE_TEST_AGENTS,'skills','unrelated'),{recursive:true}); fs.writeFileSync(path.join(process.env.AKE_TEST_AGENTS,'skills','unrelated','generated'),'x'); } if(mode==='mutate-sibling') fs.writeFileSync(path.join(process.env.AKE_TEST_AGENTS,'skills','other','keep'),'changed'); if(mode==='link') { const link=path.join(path.dirname(process.env.AKE_TEST_AGENTS),'.claude','skills','ake'); fs.mkdirSync(path.dirname(link),{recursive:true}); fs.symlinkSync(path.relative(path.dirname(link),process.env.AKE_TEST_CANONICAL),link); } process.exit(['ok','extra','wrong-ref','link','mutate-sibling'].includes(mode)?0:1);\n`);
  await chmod(stubPath, 0o755);
  const agentsHome = path.join(home, '.agents'), lockPath = path.join(home, '.agents', '.skill-lock.json');
  const siblingSkill = path.join(agentsHome, 'skills', 'other'); await mkdir(siblingSkill, { recursive: true }); await writeFile(path.join(siblingSkill, 'keep'), 'original'); await mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
  const originalLock = Buffer.from('{"skills":{"ake":{"sourceType":"local","source":"local"},"other":{"sourceType":"github"}}}\n'); await writeFile(lockPath, originalLock);
  const installation = { agentsHome, canonicalPath: install, loadPath: install, scope: 'user', mode: 'canonical', source: 'local', sourceType: 'local', commit: null, agentPaths: [{ path: install, mode: 'canonical' }], lockPath, lock: { skills: { ake: { sourceType: 'local' } } } };
  const options = { probeSkillsCli: async () => {}, flags: { dryRun: false, json: false, acceptCustomized: true }, package: { repository: { url: 'https://github.com/o/r.git' } }, home,
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: sha, entries: Object.entries(targetFiles).map(([relativePath, bytes]) => ({ relativePath, bytes, mode: '100644', type: 'blob' })) }),
    detectCustomization: async () => 'clean', acquireLock: async () => ({ release: async () => {} }),
    createBackup: args => createBackup(args),
    restoreBackup: (backup, args) => restoreBackup(backup, args),
    skillsCli: stubPath, runSkillsAdd: async (cmd, args) => { captured = args; await import('node:child_process').then(({ spawnSync }) => { const result = spawnSync(cmd, args, { env: cleanTestEnv({ HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_MODE: stubBehavior, AKE_TEST_CANONICAL: install, AKE_TEST_AGENTS: agentsHome, AKE_TEST_TARGET: sha, AKE_TEST_TARGETS: JSON.stringify(targetFiles), AKE_TEST_LOCK: lockPath }) }); if (result.status !== 0) throw Object.assign(new Error(`stub failed after possible partial write (status=${result.status}, error=${result.error?.message ?? ''}, stderr=${result.stderr?.toString() ?? ''})`), { code: 'INSTALL' }); }); },
    verifyInstalled: async () => { throw new Error('verification deliberately fails after successful install'); } };
  const result = await runUpdate(options);
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'VERIFY', result.message); assert.equal(result.rollback, 'succeeded');
  assert.equal(await readFile(path.join(install, 'SKILL.md'), 'utf8'), '# old');
  assert.deepEqual(await readFile(lockPath), originalLock);
  assert.deepEqual(captured, ['add', `o/r@${sha}`, '--skill', 'ake', '-g', '-y', '-a', 'codex']);
  assert.deepEqual(await readFile(path.join(root, 'captured.json'), 'utf8').then(JSON.parse), captured);
  const success = await runUpdate({ ...options, verifyInstalled: undefined, readAfter: async () => ({ ...installation, lock: JSON.parse(await readFile(lockPath, 'utf8')) }), cleanupBackups: async () => [] });
  assert.equal(success.status, 'updated'); assert.match(success.message, /non-atomic/); assert.ok(success.reloadNotice);
  const lockBeforeBadRef = await readFile(lockPath); stubBehavior = 'wrong-ref';
  const wrongRef = await runUpdate({ ...options, verifyInstalled: undefined });
  assert.equal(wrongRef.errorCode, 'VERIFY'); assert.match(wrongRef.message, /lock does not identify/); assert.equal(wrongRef.rollback, 'succeeded');
  assert.deepEqual(await readFile(lockPath), lockBeforeBadRef);
  stubBehavior = 'half';
  const failedInstall = await runUpdate({ ...options, verifyInstalled: async () => {} });
  assert.equal(failedInstall.errorCode, 'INSTALL'); assert.equal(failedInstall.rollback, 'succeeded');
  assert.equal(await readFile(path.join(install, 'SKILL.md'), 'utf8'), '# skill');
  stubBehavior = 'extra';
  const sideEffect = await runUpdate({ ...options, verifyInstalled: async () => {} });
  assert.equal(sideEffect.errorCode, 'ROLLBACK_FAILED'); assert.equal(sideEffect.rollback, 'failed'); assert.ok(sideEffect.backupPath);
  assert.equal(await readFile(path.join(agentsHome, 'skills', 'unrelated', 'generated'), 'utf8'), 'x');
  assert.ok(sideEffect.warnings.some(w => w.includes('AKE 文件已恢复；以下非快照条目未删除，请人工确认') && w.includes(path.join(agentsHome, 'skills', 'unrelated'))));
  stubBehavior = 'link';
  const addedLink = await runUpdate({ ...options, verifyInstalled: async () => {} });
  const claudeAke = path.join(home, '.claude', 'skills', 'ake'), expectedLinkTarget = path.relative(path.dirname(claudeAke), install);
  assert.equal(addedLink.errorCode, 'ROLLBACK_FAILED'); assert.equal(addedLink.rollback, 'failed'); assert.ok(addedLink.backupPath);
  assert.equal((await lstat(claudeAke)).isSymbolicLink(), true); assert.equal(await readlink(claudeAke), expectedLinkTarget);
  assert.ok(addedLink.warnings.some(w => w.includes(`${claudeAke} (symlink -> ${expectedLinkTarget})`)));
  stubBehavior = 'mutate-sibling';
  const siblingMutation = await runUpdate({ ...options, verifyInstalled: async () => {} });
  assert.equal(siblingMutation.errorCode, 'ROLLBACK_FAILED'); assert.equal(siblingMutation.rollback, 'failed'); assert.ok(siblingMutation.backupPath);
  assert.equal(await readFile(path.join(siblingSkill, 'keep'), 'utf8'), 'changed');
});

test('Windows native W1-W4 pinned-commit Skills CLI update acceptance', { skip: process.env.AKE_RUN_WINDOWS_UPDATE_ACCEPTANCE !== '1' && 'set AKE_RUN_WINDOWS_UPDATE_ACCEPTANCE=1 on Windows CI for official network acceptance' }, async t => {
  const crossPlatformSmoke = process.env.AKE_ALLOW_CROSS_PLATFORM_UPDATE_ACCEPTANCE === '1';
  assert.ok(process.platform === 'win32' || crossPlatformSmoke, `native acceptance requires Windows (got ${process.platform}); explicitly set AKE_ALLOW_CROSS_PLATFORM_UPDATE_ACCEPTANCE=1 only for a non-native smoke run`);
  const oldSha = 'e6a90216d5c2f6b406fde9597e77eea5d1d7e326';
  const newSha = '578ef7d7b4104d52764f029bf924f0664ed58bd0';
  const official = 'https://github.com/Shakyae/agent-knowledge-engine.git';
  const root = await makeWorkDir('ake-win-update-acceptance-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = await mkdir(path.join(root, 'home'), { recursive: true }).then(() => realpath(path.join(root, 'home')));
  const npmDirectory = path.join(root, 'initial-cli'); await mkdir(npmDirectory);
  const tempRoot = path.join(root, 'temp'); await mkdir(tempRoot);
  const checkout = path.join(root, 'updater-source');
  const env = cleanTestEnv({ HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: tempRoot, TMP: tempRoot });
  const started = Date.now();
  t.diagnostic(`PLATFORM process.platform=${process.platform} native_windows=${process.platform === 'win32'} cross_platform_smoke=${crossPlatformSmoke}`);
  run('git', ['clone', '--quiet', '--no-checkout', official, checkout], { env });
  run('git', ['-C', checkout, 'fetch', '--quiet', 'origin', newSha], { env });
  run('git', ['-C', checkout, 'checkout', '--quiet', '--detach', newSha], { env });
  const checkedOut = run('git', ['-C', checkout, 'rev-parse', 'HEAD'], { env }).trim();
  assert.equal(checkedOut, newSha, 'updater checkout must be the exact release commit, never the CI HEAD');
  assert.equal(run('git', ['-C', checkout, 'status', '--porcelain', '--', 'src/lib/update.mjs', 'src/lib/git-remote.mjs', 'scripts/ake.mjs', 'skills/ake'], { env }).trim(), '');
  const updaterModule = await import(pathToFileURL(path.join(checkout, 'src', 'lib', 'update.mjs')).href);
  const remoteModule = await import(pathToFileURL(path.join(checkout, 'src', 'lib', 'git-remote.mjs')).href);
  assert.equal(run('git', ['-C', checkout, 'hash-object', 'src/lib/update.mjs'], { env }).trim(), run('git', ['-C', checkout, 'rev-parse', `${newSha}:src/lib/update.mjs`], { env }).trim());
  const targetMirror = path.join(root, 'official-target.git');
  run('git', ['init', '--bare', targetMirror], { env });
  run('git', ['-C', targetMirror, 'fetch', '--quiet', official, `${newSha}:refs/heads/acceptance-target`], { env });
  run('git', ['--git-dir', targetMirror, 'symbolic-ref', 'HEAD', 'refs/heads/acceptance-target'], { env });
  const gitRunner = async (args, options = {}) => remoteModule.runGit(args.map(arg => arg === official ? targetMirror : arg), { ...options, env });
  const resolvePinnedRemote = async ({ repoUrl }) => {
    const resolved = await remoteModule.resolveRemote({ repoUrl, gitRunner, tempDirectory: tempRoot });
    assert.equal(resolved.targetCommit, newSha, 'resolved tree must be the pinned official target commit');
    return resolved;
  };
  const cli = await acquirePinnedSkillsCli({ npmDirectory, baseEnvironment: env });
  assert.equal(cli.version, '1.8.1');
  const canonical = path.join(home, '.agents', 'skills', 'ake');
  assert.equal(env.HOME, home); assert.equal(env.USERPROFILE, home);
  const lockPath = path.join(home, '.agents', '.skill-lock.json');
  const addStart = Date.now();
  const oldInstall = spawnSync(cli.command, [...cli.prefix, 'add', `Shakyae/agent-knowledge-engine@${oldSha}`, '--skill', 'ake', '-g', '-y', '-a', 'codex', '--copy', '--json'], { cwd: root, encoding: 'utf8', env: makeSkillsEnvironment(cli.env, home, npmDirectory) });
  t.diagnostic(`W1 old-copy-install exit=${oldInstall.status ?? 'spawn-error'} elapsed_ms=${Date.now() - addStart}; stdout=${oldInstall.stdout.trim()} stderr=${oldInstall.stderr.trim()}`);
  assert.equal(oldInstall.status, 0, oldInstall.stderr || oldInstall.stdout);
  let lock = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.equal(lock.skills.ake.ref, oldSha); assert.equal(lock.skills.ake.installMode, 'copy');
  assert.equal((await lstat(canonical)).isDirectory(), true);
  assert.equal((await lstat(path.join(home, '.claude', 'skills', 'ake')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))), null);
  const sentinel = path.join(home, '.agents', 'skills', 'sentinel'); await mkdir(sentinel, { recursive: true }); await writeFile(path.join(sentinel, 'keep.txt'), 'preserve');
  const entry = path.join(canonical, 'resources', 'ake-source', 'scripts', 'ake.mjs');
  assert.equal((await lstat(entry)).isFile(), true, 'old installation must provide the updater resource');
  const baseOptions = { entry, installationOptions: { entry, home, env }, home, env, projectRoot: checkout, tempRoot,
    package: JSON.parse(await readFile(path.join(checkout, 'package.json'), 'utf8')), flags: { dryRun: false, json: true, acceptCustomized: true },
    resolveRemote: resolvePinnedRemote, gitRunner };
  const inheritedCacheSource = path.join(root, 'synthetic-untrusted-npm-cache'), inheritedNpmrc = path.join(root, 'synthetic-untrusted-user.npmrc');
  await mkdir(inheritedCacheSource); await writeFile(path.join(inheritedCacheSource, 'fixture-marker'), 'must remain untouched');
  const syntheticCacheBefore = await treeSnapshot(inheritedCacheSource);
  const isolatedNpmHome = path.join(root, 'expected-isolated-npm-home'), isolatedNpmWorkspace = path.join(tempRoot, 'expected-ake-npm-workspace');
  assert.deepEqual(Object.keys(env).filter(key => /^npm_config_/i.test(key)), [], 'clean test environment must not inherit caller npm cache/config');
  const isolatedNpmEnv = makeSkillsEnvironment({ ...env, npm_config_cache: inheritedCacheSource, npm_config_userconfig: inheritedNpmrc }, isolatedNpmHome, isolatedNpmWorkspace);
  assert.equal(isolatedNpmEnv.HOME, isolatedNpmHome); assert.equal(isolatedNpmEnv.USERPROFILE, isolatedNpmHome);
  assert.equal(isolatedNpmEnv.TEMP, isolatedNpmWorkspace); assert.equal(isolatedNpmEnv.TMP, isolatedNpmWorkspace);
  assert.equal(isolatedNpmEnv.npm_config_cache, path.join(isolatedNpmWorkspace, 'cache'));
  assert.equal(isolatedNpmEnv.npm_config_userconfig, undefined);
  const beforeDryRun = await treeSnapshot(home), beforeDryTemp = await readdir(tempRoot), dryStart = Date.now();
  const dryEnv = { ...env, npm_config_cache: inheritedCacheSource, npm_config_userconfig: inheritedNpmrc };
  let dryAcquisitionCalled = false;
  const dry = await updaterModule.runUpdate({ ...baseOptions, env: dryEnv, installationOptions: { ...baseOptions.installationOptions, env: dryEnv }, flags: { ...baseOptions.flags, dryRun: true }, acquireSkillsCli: async () => { dryAcquisitionCalled = true; throw new Error('W2 must not acquire Skills CLI'); } });
  t.diagnostic(`W2 dry-run exit=${updaterModule.updateExitCode(dry)} elapsed_ms=${Date.now() - dryStart}; status=${dry.status} target=${dry.targetCommit}; source_HOME=${home} source_USERPROFILE=${home} synthetic_cache_source=${inheritedCacheSource} isolated_TEMP_destination=${isolatedNpmWorkspace} isolated_npm_cache_destination=${isolatedNpmEnv.npm_config_cache} acquisition_called=${dryAcquisitionCalled} temp_workspace_residue=false cache_fixture_snapshot_unchanged=true`);
  assert.equal(dry.status, 'dry_run'); assert.equal(dry.targetCommit, newSha); assert.equal(updaterModule.updateExitCode(dry), 0);
  assert.equal(dryAcquisitionCalled, false, 'dry-run must return before Skills CLI acquisition');
  assert.deepEqual(await treeSnapshot(home), beforeDryRun, 'dry-run must leave isolated HOME unchanged');
  assert.deepEqual(await readdir(tempRoot), beforeDryTemp, 'dry-run must not create a persistent npm temp workspace');
  assert.deepEqual(await treeSnapshot(inheritedCacheSource), syntheticCacheBefore, 'synthetic source cache must remain unchanged');
  await assert.rejects(lstat(path.join(isolatedNpmWorkspace, 'cache')), { code: 'ENOENT' });
  const failedAcquireStart = Date.now(), beforeAcquireFailure = { install: await treeSnapshot(canonical), lock: await readFile(lockPath), sentinel: await treeSnapshot(sentinel) };
  let failedAcquisitionCalled = false;
  const failedAcquire = await updaterModule.runUpdate({ ...baseOptions, acquireSkillsCli: async () => { failedAcquisitionCalled = true; throw new Error('intentional isolated acquisition failure'); } });
  t.diagnostic(`W4 injected-acquisition-preflight exit=${updaterModule.updateExitCode(failedAcquire)} elapsed_ms=${Date.now() - failedAcquireStart}; status=${failedAcquire.status} stage=${failedAcquire.stage} error=${failedAcquire.errorCode}`);
  assert.equal(failedAcquisitionCalled, true, 'W4 must reach the intentional acquisition-failure seam');
  assert.equal(failedAcquire.status, 'failed'); assert.equal(failedAcquire.stage, 'preflight'); assert.equal(failedAcquire.errorCode, 'PREFLIGHT'); assert.match(failedAcquire.message, /intentional isolated acquisition failure/); assert.equal(failedAcquire.rollback, 'not_needed');
  assert.deepEqual(await treeSnapshot(canonical), beforeAcquireFailure.install, 'failed CLI acquisition must preserve the old skill tree');
  assert.deepEqual(await readFile(lockPath), beforeAcquireFailure.lock, 'failed CLI acquisition must preserve the Skills lock');
  assert.deepEqual(await treeSnapshot(sentinel), beforeAcquireFailure.sentinel, 'failed CLI acquisition must preserve unrelated sentinel skill');
  const updateStart = Date.now();
  const updated = await updaterModule.runUpdate(baseOptions);
  t.diagnostic(`W3 real-update exit=${updaterModule.updateExitCode(updated)} elapsed_ms=${Date.now() - updateStart}; status=${updated.status} old=${updated.oldCommit} target=${updated.targetCommit} rollback=${updated.rollback}`);
  assert.equal(updated.status, 'updated', JSON.stringify(updated)); assert.equal(updated.oldCommit, oldSha); assert.equal(updated.targetCommit, newSha);
  assert.equal(updated.installationBefore.commit, oldSha); assert.equal(updated.installationAfter.commit, newSha);
  assert.equal(updated.installationAfter.mode, 'canonical'); assert.equal(updated.rollback, 'not_needed'); assert.ok(updated.backupPath);
  assert.equal(await lstat(updated.backupPath).then(info => info.isDirectory()), true);
  lock = JSON.parse(await readFile(lockPath, 'utf8')); assert.equal(lock.skills.ake.ref, newSha); assert.equal(lock.skills.ake.installMode, 'copy');
  assert.equal(await readFile(path.join(sentinel, 'keep.txt'), 'utf8'), 'preserve');
  assert.equal((await lstat(path.join(home, '.claude', 'skills', 'ake')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))), null, 'copy mode must not be conflated with symlink mode');
  assert.equal((await lstat(canonical)).isDirectory(), true);
  const afterUpdate = await treeSnapshot(home), repeatStart = Date.now();
  const repeated = await updaterModule.runUpdate(baseOptions);
  t.diagnostic(`W3 repeat-up-to-date exit=${updaterModule.updateExitCode(repeated)} elapsed_ms=${Date.now() - repeatStart}; status=${repeated.status}`);
  assert.equal(repeated.status, 'up_to_date'); assert.equal(repeated.targetCommit, newSha); assert.equal(repeated.backupPath, null);
  assert.deepEqual(await treeSnapshot(home), afterUpdate, 'repeat up_to_date must not mutate isolated HOME');
  t.diagnostic(`PINNED-UPDATER source_commit=${checkedOut} source=${path.join(checkout, 'src/lib/update.mjs')}; remote=real Git fetch/tree via temporary mirror, target=${newSha}; Skills CLI=real pinned ${cli.version}; CI checkout HEAD is not used as updater source; total_elapsed_ms=${Date.now() - started}`);
});

test('simulated Windows layout on macOS; not a real Windows run: dry-run uses isolated temp and leaves installation untouched', async t => {
  const root = await makeWorkDir('ake-win-dry-run-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), tempRoot = path.join(root, 'temp'), bin = path.join(root, 'bin'); await mkdir(home); await mkdir(tempRoot); await mkdir(bin);
  const npm = path.join(bin, 'node_modules', 'npm'); await mkdir(path.join(npm, 'bin'), { recursive: true });
  await writeFile(path.join(bin, 'npx.cmd'), '@echo off'); await writeFile(path.join(npm, 'package.json'), JSON.stringify({ name: 'npm', bin: { npx: 'bin/npx-cli.js' } })); await writeFile(path.join(npm, 'bin', 'npx-cli.js'), '');
  const installation = { agentsHome: path.join(home, '.agents'), lockPath: path.join(home, '.agents', '.skill-lock.json'), lock: { skills: { ake: { sourceType: 'local' } } } };
  const seen = [];
  const result = await runUpdate({ home, env: { HOME: home, PATH: `${bin};`, PATHEXT: '.CMD' }, platform: 'win32', tempRoot, projectRoot: path.join(root, 'project'), flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args) => { seen.push([command, args]); return { stdout: '1.8.0' }; }, resolveInstallation: async () => installation,
    resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'a'.repeat(40) }) });
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.deepEqual(seen, []);
  await assert.rejects(lstat(path.join(home, '.agents', 'ake', 'update.lock')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(home, '.agents', 'ake', 'backups')), { code: 'ENOENT' });
});
