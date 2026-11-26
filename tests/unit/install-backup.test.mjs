import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, readlink, lstat, rm, cp, symlink, chmod, rename } from 'node:fs/promises';
import { acquireLock, backupModesMatch, createBackup, validateBackup, cleanupBackups, snapshotTree, rollbackAnchorIdentity } from '../../src/lib/install-backup.mjs';
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
  await cleanupBackups(agentsHome); assert.equal((await validateBackup(backup.backupPath)).schemaVersion, 1);
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

test('backup preserves absent lock state and cleanup keeps recent three plus all within 30 days', async t => {
  const home = await fixture(t); const agentsHome = path.join(home, '.agents'); const canonical = path.join(agentsHome, 'skills', 'ake'); await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'x');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'b'.repeat(40) });
  const root = path.join(agentsHome, 'ake', 'backups'); await mkdir(root, { recursive: true });
  // Actual valid backup is retained; malformed user directory must never be deleted.
  await mkdir(path.join(root, 'manual')); await writeFile(path.join(root, 'manual', 'keep'), 'manual');
  const outside = path.join(home, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'keep'), 'outside'); await symlink(outside, path.join(root, 'linked-backup'));
  const warnings = await cleanupBackups(agentsHome, { now: Date.now() + 40 * 86400_000, currentBackup: backup.backupPath });
  assert.ok(warnings.some(x => x.includes('manual')));
  assert.equal(await readFile(path.join(root, 'manual', 'keep'), 'utf8'), 'manual');
  assert.equal(await readFile(path.join(outside, 'keep'), 'utf8'), 'outside');
  const seedManifestPath = path.join(backup.backupPath, 'manifest.json');
  const seedManifest = JSON.parse(await readFile(seedManifestPath, 'utf8'));
  const now = Date.now(); seedManifest.createdAt = new Date(now - 40 * 86400_000).toISOString(); await writeFile(seedManifestPath, JSON.stringify(seedManifest));
  for (const [id, ageDays] of [['recent-1', 1], ['recent-2', 2], ['recent-3', 3], ['in-age', 20], ['expired', 45]]) {
    const destination = path.join(root, id); await cp(backup.backupPath, destination, { recursive: true });
    const manifestPath = path.join(destination, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.backupId = id; manifest.createdAt = new Date(now - ageDays * 86400_000).toISOString(); await writeFile(manifestPath, JSON.stringify(manifest));
  }
  await cleanupBackups(agentsHome, { now });
  for (const id of ['recent-1', 'recent-2', 'recent-3', 'in-age']) assert.equal(await lstat(path.join(root, id)).then(info => info.isDirectory()), true);
  for (const id of [path.basename(backup.backupPath), 'expired']) await assert.rejects(lstat(path.join(root, id)), { code: 'ENOENT' });
});
