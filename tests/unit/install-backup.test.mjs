import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, readlink, readdir, lstat, rm, unlink, symlink, chmod, rename } from 'node:fs/promises';
import { acquireLock, backupModesMatch, createBackup, validateBackup, snapshotTree, rollbackAnchorIdentity } from '../../src/lib/install-backup.mjs';
import { tempRoot } from '../helpers/test-env.mjs';

async function fixture(t) { const home = await tempRoot('ake-backup-test-'); t.after(() => rm(home, { recursive: true, force: true })); return home; }

test('exclusive lock rejects a second writer and only owner removes it', async t => {
  const home = await fixture(t); const lock = await acquireLock(home);
  await assert.rejects(acquireLock(home), { code: 'LOCKED' });
  await lock.release();
  const lock2 = await acquireLock(home); await lock2.release();
});

test('backup schema rejects duplicate and malformed agent snapshots while accepting legacy schema', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills/ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'original'); await writeFile(lockPath, '{"skills":{"ake":{}}}');
  const backup = await createBackup({ agentsHome, installation: { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] }, lockPath, targetCommit: 'a'.repeat(40) });
  const manifestPath = path.join(backup.backupPath, 'manifest.json'), base = JSON.parse(await readFile(manifestPath, 'utf8'));
  const cases = [m => m.agentLinks.push(m.agentLinks[0]), m => { m.agentLinks[0].linkTarget = 'unexpected'; }, m => { m.agentLinks[0].type = 'symlink'; m.agentLinks[0].linkTarget = 42; }, m => { m.agentLinks[0].type = 'symlink'; m.agentLinks[0].linkTarget = 'bad\0target'; }, m => { m.agentLinks.push({ path: path.join(home, '.other/skills/ake'), existed: false, type: null, linkTarget: null }); }, m => m.skillsDirectories.push(m.skillsDirectories[0]), m => { m.skillsDirectories[0].existed = 'yes'; }, m => { m.skillsDirectories[0].entries = ['../bad']; }, m => { m.skillsDirectories[0].entries = ['dup', 'dup']; }];
  for (const mutate of cases) { const m = structuredClone(base); mutate(m); await writeFile(manifestPath, JSON.stringify(m)); await assert.rejects(validateBackup(backup.backupPath), /unsupported agent path|invalid skills directory/); }
  const legacy = structuredClone(base); legacy.agentLinks = legacy.agentLinks.filter(x => !x.path.includes('.codebuddy')); legacy.skillsDirectories = legacy.skillsDirectories.filter(x => !x.path.includes('.codebuddy'));
  await writeFile(manifestPath, JSON.stringify(legacy)); assert.equal((await validateBackup(backup.backupPath)).schemaVersion, 1);
});

test('rollback anchors require positive bigint identities without numeric precision loss', () => {
  const large = 9007199254740993123n;
  assert.deepEqual(rollbackAnchorIdentity({ dev: 1n, ino: large, birthtimeNs: large }), { dev: '1', ino: String(large), birthtimeNs: String(large) });
  for (const invalid of [{ dev: 0n, ino: 1n, birthtimeNs: 1n }, { dev: 1n, ino: 0n, birthtimeNs: 1n }, { dev: 1n, ino: 1n, birthtimeNs: 0n }, { dev: 1, ino: Number.MAX_SAFE_INTEGER + 1, birthtimeNs: 1 }, { dev: 1n, ino: 1n }, { dev: -1n, ino: 1n, birthtimeNs: 1n }]) {
    assert.throws(() => rollbackAnchorIdentity(invalid), /unavailable or unreliable/);
  }
});

test('backup mode comparison preserves POSIX mode checks and normalizes Windows writable state', () => {
  assert.equal(backupModesMatch(0o600, 0o666, 'win32'), true);
  assert.equal(backupModesMatch(0o600, 0o444, 'win32'), false);
  assert.equal(backupModesMatch(0o600, 0o666, 'linux'), false);
});

test('backup validation rejects read-only mode drift', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), '# ake'); await writeFile(lockPath, '{"skills":{"ake":{"sourceType":"local"}}}');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath, targetCommit: 'd'.repeat(40) });
  assert.equal((await validateBackup(backup.backupPath)).lockExisted, true);
  const backedUpLock = path.join(backup.backupPath, 'data', 'lock.json');
  await chmod(backedUpLock, 0o444);
  await assert.rejects(validateBackup(backup.backupPath), error => error.code === 'BACKUP' && /backup mode mismatch: lock\.json/.test(error.message));
});

test('backup validation rejects unlisted and missing data-tree entries', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), '# ake'); await writeFile(path.join(canonical, 'keep.txt'), 'keep');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'c'.repeat(40) });
  const canonicalData = path.join(backup.backupPath, 'data', 'canonical');
  await writeFile(path.join(canonicalData, 'unlisted.txt'), 'not in manifest');
  await assert.rejects(validateBackup(backup.backupPath), error => error.code === 'BACKUP' && /exactly match manifest/.test(error.message));
  await rm(path.join(canonicalData, 'unlisted.txt'));
  await rm(path.join(canonicalData, 'keep.txt'));
  await assert.rejects(validateBackup(backup.backupPath), error => error.code === 'BACKUP');
});

test('backup validates canonical tree, exact lock bytes, and Claude/CodeBuddy link snapshots', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'original');
  const lockPath = path.join(agentsHome, '.skill-lock.json'), lockBytes = Buffer.from('{ "skills": { "ake": { "ref": "old" } } }\\n');
  await writeFile(lockPath, lockBytes);
  const links = ['.claude', '.codebuddy'].map(agent => path.join(home, agent, 'skills', 'ake'));
  for (const link of links) { await mkdir(path.dirname(link), { recursive: true }); await symlink(path.relative(path.dirname(link), canonical), link); }
  const backup = await createBackup({ agentsHome, installation: { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', version: '0.2.0', agentPaths: links.map(path => ({ path, mode: 'symlink' })) }, lockPath, targetCommit: 'd'.repeat(40) });
  assert.deepEqual(await readFile(path.join(backup.backupPath, 'data', 'lock.json')), lockBytes);
  const manifest = await validateBackup(backup.backupPath);
  for (const link of links) assert.deepEqual(manifest.agentLinks.find(item => item.path === link), { path: link, existed: true, type: 'symlink', linkTarget: await readlink(link) });
  await unlink(path.join(backup.backupPath, 'data', 'lock.json'));
  await assert.rejects(validateBackup(backup.backupPath), { code: 'BACKUP' });
});

test('backup uses unknown for invalid, malformed, or symlinked canonical package metadata', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake');
  const packageDir = path.join(canonical, 'resources', 'ake-source'), packagePath = path.join(packageDir, 'package.json');
  await mkdir(packageDir, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'x');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', version: 'untrusted-checkout-version', agentPaths: [] };
  const options = { agentsHome, installation, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'f'.repeat(40) };
  await writeFile(packagePath, JSON.stringify({ name: 'not-ake', version: '9.9.9' }));
  assert.match((await createBackup(options)).backupPath, /[\\/]unknown-/);
  await writeFile(packagePath, '{broken');
  assert.match((await createBackup(options)).backupPath, /[\\/]unknown-/);
  const external = path.join(home, 'package.json'); await writeFile(external, JSON.stringify({ name: 'agent-knowledge-engine', version: '9.9.9' }));
  await rm(packagePath); await symlink(external, packagePath);
  assert.match((await createBackup(options)).backupPath, /[\\/]unknown-/);
});

test('backup refuses symlink roots and leaves external target untouched', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'x');
  const outside = path.join(home, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'keep'), 'safe');
  await symlink(outside, path.join(agentsHome, 'skills-backups'));
  await assert.rejects(createBackup({ agentsHome, installation: { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] }, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'e'.repeat(40) }), /unsafe non-directory or symlink/);
  assert.deepEqual(await readdir(outside), ['keep']);
  await rm(path.join(agentsHome, 'skills-backups'));
  await mkdir(path.join(agentsHome, 'skills-backups'));
  await symlink(outside, path.join(agentsHome, 'skills-backups', 'ake'));
  await assert.rejects(createBackup({ agentsHome, installation: { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] }, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'e'.repeat(40) }), /unsafe non-directory or symlink/);
  await rm(path.join(agentsHome, 'skills-backups', 'ake'));
  await writeFile(path.join(agentsHome, 'skills-backups', 'ake'), 'not a directory');
  await assert.rejects(createBackup({ agentsHome, installation: { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] }, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'e'.repeat(40) }), /unsafe non-directory or symlink/);
  assert.deepEqual(await readdir(outside), ['keep']);
});

test('backup path uses safe installed version and each backup is unique without pruning legacy data', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake');
  await mkdir(path.join(canonical, 'resources', 'ake-source'), { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'x');
  await writeFile(path.join(canonical, 'resources', 'ake-source', 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine', version: '../v 1.2' }));
  const legacyRoot = path.join(agentsHome, 'ake', 'backups'); await mkdir(legacyRoot, { recursive: true });
  await writeFile(path.join(legacyRoot, 'legacy'), 'untouched');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', version: 'checkout-version-9.9.9', agentPaths: [] };
  const options = { agentsHome, installation, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'b'.repeat(40) };
  const first = await createBackup(options), second = await createBackup(options);
  assert.notEqual(first.backupPath, second.backupPath);
  assert.match(first.backupPath, /skills-backups[\\/]ake[\\/]\.\.-v-1\.2-/);
  assert.equal(await readFile(path.join(legacyRoot, 'legacy'), 'utf8'), 'untouched');
  assert.equal((await validateBackup(first.backupPath)).lockExisted, false);
  assert.equal((await validateBackup(second.backupPath)).lockExisted, false);
  await writeFile(path.join(canonical, 'resources', 'ake-source', 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine' }));
  const missingVersion = await createBackup(options);
  assert.match(missingVersion.backupPath, /skills-backups[\\/]ake[\\/]unknown-/);
  assert.equal((await validateBackup(missingVersion.backupPath)).lockExisted, false);
});
