import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, readlink, lstat, rm, cp, symlink, chmod } from 'node:fs/promises';
import { acquireLock, backupModesMatch, createBackup, restoreBackup, validateBackup, cleanupBackups } from '../../src/lib/install-backup.mjs';
import { tempRoot } from '../helpers/test-env.mjs';

async function fixture(t) { const home = await tempRoot('ake-backup-test-'); t.after(() => rm(home, { recursive: true, force: true })); return home; }

test('exclusive lock rejects a second writer and only owner removes it', async t => {
  const home = await fixture(t); const lock = await acquireLock(home);
  await assert.rejects(acquireLock(home), { code: 'LOCKED' });
  await lock.release();
  const lock2 = await acquireLock(home); await lock2.release();
});

test('backup restores snapshotted files and links while preserving post-snapshot additions', async t => {
  const home = await fixture(t); const agentsHome = path.join(home, '.agents'); const canonical = path.join(agentsHome, 'skills', 'ake');
  await mkdir(path.join(canonical, 'sub'), { recursive: true }); await writeFile(path.join(canonical, 'sub', 'custom.txt'), 'private customization');
  await writeFile(path.join(canonical, 'link-target.txt'), 'target'); await import('node:fs/promises').then(fs => fs.symlink('link-target.txt', path.join(canonical, 'link')));
  const claudePath = path.join(home, '.claude', 'skills', 'ake'); await mkdir(path.dirname(claudePath), { recursive: true }); await import('node:fs/promises').then(fs => fs.symlink(path.relative(path.dirname(claudePath), canonical), claudePath));
  const lockPath = path.join(agentsHome, '.skill-lock.json'); const lockBytes = Buffer.from('{"skills":{"ake":{"sourceType":"local"}}}\n'); await writeFile(lockPath, lockBytes);
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', source: 'local', sourceType: 'local', commit: null, agentPaths: [{ path: canonical, mode: 'canonical' }, { path: claudePath, mode: 'symlink' }] };
  const backup = await createBackup({ agentsHome, installation, lockPath, targetCommit: 'a'.repeat(40) });
  await assert.equal((await validateBackup(backup.backupPath)).lockExisted, true);
  await rm(canonical, { recursive: true }); await mkdir(canonical); await writeFile(path.join(canonical, 'oops'), 'half-written'); await writeFile(lockPath, '{"skills":{"ake":{"sourceType":"github","ref":"new"}}}');
  await assert.rejects(restoreBackup(backup), error => error.code === 'ROLLBACK_FAILED' && error.warnings?.some(warning => warning.includes(path.join(canonical, 'oops'))));
  assert.equal(await readFile(path.join(canonical, 'oops'), 'utf8'), 'half-written');
  assert.equal(await readFile(path.join(canonical, 'sub', 'custom.txt'), 'utf8'), 'private customization');
  assert.equal(await readlink(path.join(canonical, 'link')), 'link-target.txt');
  assert.equal(await readlink(claudePath), path.relative(path.dirname(claudePath), canonical));
  assert.deepEqual(await readFile(lockPath), lockBytes);
  await writeFile(path.join(backup.backupPath, 'data', 'canonical', 'sub', 'custom.txt'), 'tampered');
  await assert.rejects(validateBackup(backup.backupPath), /checksum mismatch/);
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

test('rollback refuses to overwrite concurrent non-AKE lock updates', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'before');
  const before = Buffer.from('{"skills":{"ake":{"sourceType":"local"},"other":{"ref":"one"}}}'); await writeFile(lockPath, before);
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath, targetCommit: 'e'.repeat(40) });
  await writeFile(path.join(canonical, 'SKILL.md'), 'changed'); await writeFile(lockPath, '{"skills":{"ake":{"sourceType":"github"},"other":{"ref":"two"}}}');
  await assert.rejects(restoreBackup(backup), error => error.code === 'ROLLBACK_FAILED' && /lock\.skills\.other/.test(error.message));
  assert.equal(await readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'before');
  assert.equal(await lstat(backup.backupPath).then(info => info.isDirectory()), true);
});

test('rollback detects top-level lock drift and preserves external bytes', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'before');
  const originalLock = Buffer.from(JSON.stringify({ version: 1, dismissed: {}, lastSelectedAgents: ['codex'], skills: { ake: { sourceType: 'local' }, other: { ref: 'one' } } })); await writeFile(lockPath, originalLock);
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath, targetCommit: 'f'.repeat(40) });
  await writeFile(path.join(canonical, 'SKILL.md'), 'half-installed');
  const concurrentLock = Buffer.from(JSON.stringify({ version: 1, dismissed: { other: 'new user state' }, lastSelectedAgents: ['claude-code'], skills: { ake: { sourceType: 'github' }, other: { ref: 'one' } } })); await writeFile(lockPath, concurrentLock);
  await assert.rejects(restoreBackup(backup), error => error.code === 'ROLLBACK_FAILED' && error.warnings?.some(warning => /lock\.dismissed|lock\.lastSelectedAgents/.test(warning)));
  assert.equal(await readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'before');
  assert.deepEqual(await readFile(lockPath), concurrentLock);
  await writeFile(path.join(canonical, 'SKILL.md'), 'half-written again'); const primitiveLock = Buffer.from('null'); await writeFile(lockPath, primitiveLock);
  await assert.rejects(restoreBackup(backup), error => error.code === 'ROLLBACK_FAILED' && /lock\.<root>/.test(error.message));
  assert.equal(await readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'before'); assert.deepEqual(await readFile(lockPath), primitiveLock);
  assert.equal((await lstat(backup.backupPath)).isDirectory(), true);
});

test('restore keeps lock-appeared fail closed when original lock was absent', async t => {
  const home = await fixture(t), agentsHome = path.join(home, '.agents'), canonical = path.join(agentsHome, 'skills', 'ake'), lockPath = path.join(agentsHome, '.skill-lock.json');
  await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'before');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath, targetCommit: '1'.repeat(40) });
  await writeFile(path.join(canonical, 'SKILL.md'), 'changed'); const appearedLock = Buffer.from('external lock'); await writeFile(lockPath, appearedLock);
  await assert.rejects(restoreBackup(backup), error => error.code === 'ROLLBACK_FAILED' && error.message.includes('lock (appeared'));
  assert.equal(await readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'before'); assert.deepEqual(await readFile(lockPath), appearedLock);
});

test('backup preserves absent lock state and cleanup keeps recent three plus all within 30 days', async t => {
  const home = await fixture(t); const agentsHome = path.join(home, '.agents'); const canonical = path.join(agentsHome, 'skills', 'ake'); await mkdir(canonical, { recursive: true }); await writeFile(path.join(canonical, 'SKILL.md'), 'x');
  const installation = { canonicalPath: canonical, loadPath: canonical, scope: 'user', mode: 'canonical', agentPaths: [] };
  const backup = await createBackup({ agentsHome, installation, lockPath: path.join(agentsHome, '.skill-lock.json'), targetCommit: 'b'.repeat(40) });
  await restoreBackup(backup); await assert.rejects(lstat(path.join(agentsHome, '.skill-lock.json')), { code: 'ENOENT' });
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
