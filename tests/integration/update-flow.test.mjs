import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, chmod, rm, readFile, readdir, cp, lstat, symlink, readlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBackup, restoreBackup } from '../../src/lib/install-backup.mjs';
import { runUpdate, updateExitCode } from '../../src/lib/update.mjs';
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
      entries.push([name, item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'symlink' : 'file']);
      if (item.isDirectory()) await walk(path.join(current, item.name), name);
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

test('real network update remains opt-in and skipped by default', { skip: 'requires explicit network authorization and a disposable user-level install' }, () => {});

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

test('dry-run failed npx probe writes only to controlled temp and leaves HOME unchanged', async t => {
  const root = await makeWorkDir('ake-npm-isolation-'); t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), bin = path.join(root, 'bin'), capture = path.join(root, 'npx-env.json'); await mkdir(home, { recursive: true }); await mkdir(bin);
  const npx = path.join(bin, 'npx'); await writeFile(npx, `#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path'); const logDir=process.env.npm_config_logs_dir; fs.mkdirSync(logDir,{recursive:true}); const log=path.join(logDir,'eresolve-report.txt'); fs.writeFileSync(log,'raw npm log'); fs.writeFileSync(process.env.AKE_NPX_CAPTURE,JSON.stringify({cache:process.env.npm_config_cache,logs:logDir,log})); process.stderr.write('npm ERR! logfile '+log); process.exit(1);\n`); await chmod(npx, 0o755);
  const before = await treeSnapshot(home); let stderr = '';
  const env = cleanTestEnv({ HOME: home, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, AKE_NPX_CAPTURE: capture });
  const result = await runUpdate({ home, env, flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args, probeEnv) => { const response = spawnSync(command, args, { encoding: 'utf8', env: probeEnv }); if (response.error) throw response.error; if (response.status !== 0) throw Object.assign(new Error(response.stderr), { code: 'INSTALL', stderr: response.stderr }); return response; },
    writeStderr: message => { stderr += message; }, resolveInstallation: async () => { throw new Error('identity should not run after preflight failure'); } });
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'PREFLIGHT'); assert.equal(updateExitCode(result), 1);
  const after = await treeSnapshot(home); assert.deepEqual(after, before);
  const diagnostics = JSON.parse(await readFile(capture, 'utf8')); assert.ok(diagnostics.cache.startsWith(os.tmpdir())); assert.ok(diagnostics.logs.startsWith(os.tmpdir()));
  await assert.rejects(lstat(path.dirname(diagnostics.cache)), { code: 'ENOENT' });
  assert.ok(stderr.includes(diagnostics.log)); assert.ok(!result.message.includes(diagnostics.log)); assert.ok(!JSON.stringify(result).includes(path.join(home, '.npm')));
});

test('PATH without skills uses a local npx stub only with --no-install', async t => {
  const root = await makeWorkDir('ake-npx-fallback-'); t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'), capture = path.join(root, 'npx-args.json'); await mkdir(bin);
  const npx = path.join(bin, 'npx'); await writeFile(npx, `#!/usr/bin/env node\nimport fs from 'node:fs'; fs.writeFileSync(process.env.NPX_CAPTURE, JSON.stringify(process.argv.slice(2))); process.stdout.write('1.8.1\\n');\n`); await chmod(npx, 0o755);
  const installation = { agentsHome: path.join(root, '.agents'), canonicalPath: path.join(root, '.agents', 'skills', 'ake'), lockPath: path.join(root, '.agents', '.skill-lock.json'), lock: { skills: { ake: { sourceType: 'local' } } } };
  const result = await runUpdate({ flags: { dryRun: true, json: true, acceptCustomized: false }, package: { repository: { url: 'https://github.com/o/r.git' } },
    probeSkillsCli: async (command, args) => { const response = spawnSync(command, args, { encoding: 'utf8', env: cleanTestEnv({ PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, HOME: root, NPX_CAPTURE: capture }) }); if (response.error) throw response.error; if (response.status !== 0) throw Object.assign(new Error(response.stderr), { code: 'INSTALL' }); return response; },
    resolveInstallation: async () => installation, resolveRemote: async () => ({ sourceUrl: 'https://github.com/o/r.git', repo: 'o/r', defaultBranch: 'main', targetCommit: 'f'.repeat(40), entries: [] }) });
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')), ['--no-install', 'skills', '--version']);
  assert.ok(result.warnings.some(warning => warning.includes('不证明其版本或完整性')));
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
  assert.equal(result.status, 'dry_run', JSON.stringify(result)); assert.equal(seen[0][0], process.execPath); assert.match(seen[0][1][0], /npx-cli\.js$/);
  await assert.rejects(lstat(path.join(home, '.agents', 'ake', 'update.lock')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(home, '.agents', 'ake', 'backups')), { code: 'ENOENT' });
});
