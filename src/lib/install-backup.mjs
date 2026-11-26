import { randomBytes, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile, realpath, writeFile, mkdir, copyFile, symlink, readlink, chmod, unlink, rmdir, open } from 'node:fs/promises';

const MARKER = 'ake-skill-backup';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Windows exposes the read-only flag, not POSIX permission classes; retain writable/read-only validation there.
function normalizeBackupMode(mode, platform = process.platform) {
  return platform === 'win32' ? Number(Boolean(mode & 0o200)) : mode;
}
export function backupModesMatch(expected, actual, platform = process.platform) {
  return normalizeBackupMode(expected, platform) === normalizeBackupMode(actual, platform);
}
const exists = async p => { try { return await lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
async function ensureDirectory(target, { create = false } = {}) {
  const info = await exists(target);
  if (info) { if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe non-directory or symlink: ${target}`); return; }
  if (!create) throw new Error(`required directory is missing: ${target}`);
  await mkdir(target, { mode: 0o700 });
  const created = await lstat(target);
  if (!created.isDirectory() || created.isSymbolicLink()) throw new Error(`unsafe directory creation: ${target}`);
}

export async function acquireLock(agentsHome) {
  await ensureDirectory(agentsHome);
  const directory = path.join(agentsHome, 'ake');
  await ensureDirectory(directory, { create: true });
  const lockPath = path.join(directory, 'update.lock');
  const token = randomBytes(24).toString('hex');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ schema: 1, pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), token }));
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error.code === 'EEXIST') throw Object.assign(new Error(`update lock already exists: ${lockPath}; inspect and remove it manually only after confirming no update is running`), { code: 'LOCKED' });
    throw Object.assign(new Error(`cannot create update lock: ${error.message}`), { code: 'LOCKED' });
  }
  await handle.close();
  return { lockPath, token, async release() {
    try { const record = JSON.parse(await readFile(lockPath, 'utf8')); if (record.token === token) await unlink(lockPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } };
}

async function snapshotTree(root) {
  const entries = [];
  async function walk(current, relative = '') {
    const names = (await readdir(current)).sort();
    for (const name of names) {
      const rel = relative ? `${relative}/${name}` : name;
      const full = path.join(current, name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) entries.push({ relativePath: rel, type: 'symlink', mode: info.mode & 0o777, sha256: null, linkTarget: await readlink(full) });
      else if (info.isDirectory()) { entries.push({ relativePath: rel, type: 'directory', mode: info.mode & 0o777, sha256: null, linkTarget: null }); await walk(full, rel); }
      else if (info.isFile()) entries.push({ relativePath: rel, type: 'file', mode: info.mode & 0o777, sha256: sha256(await readFile(full)), linkTarget: null });
      else throw Object.assign(new Error(`unsupported filesystem entry: ${full}`), { code: 'BACKUP' });
    }
  }
  await walk(root);
  return entries;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function diffPaths(left, right, prefix = '') {
  if (JSON.stringify(stable(left)) === JSON.stringify(stable(right))) return [];
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return [prefix || '<root>'];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(key => diffPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}
async function copyTree(source, target, entries, rootMode = 0o755) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const directories = entries.filter(entry => entry.type === 'directory');
  for (const entry of directories) await mkdir(path.join(target, ...entry.relativePath.split('/')), { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    if (entry.type === 'directory') continue;
    const from = path.join(source, ...entry.relativePath.split('/'));
    const to = path.join(target, ...entry.relativePath.split('/'));
    if (entry.type === 'symlink') await symlink(entry.linkTarget, to);
    else { await copyFile(from, to); await chmod(to, entry.mode); }
  }
  for (const entry of directories.sort((a, b) => b.relativePath.split('/').length - a.relativePath.split('/').length)) await chmod(path.join(target, ...entry.relativePath.split('/')), entry.mode);
  await chmod(target, rootMode);
}

async function validateBackupEntries(directory) {
  const rootInfo = await lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('backup directory is not a real directory');
  const manifestPath = path.join(directory, 'manifest.json');
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('backup manifest is not a regular file');
  const marker = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (marker.format !== MARKER || marker.schemaVersion !== 1 || !Array.isArray(marker.entries) || !marker.backupId || !Number.isFinite(Date.parse(marker.createdAt)) || new Date(marker.createdAt).toISOString() !== marker.createdAt) throw new Error('invalid AKE backup manifest');
  if (!path.isAbsolute(marker.agentsHome ?? '') || !path.isAbsolute(marker.loadPath ?? '') || marker.canonicalPath !== path.join(marker.agentsHome, 'skills', 'ake') || marker.originalPath !== marker.canonicalPath || marker.lockPath !== path.join(marker.agentsHome, '.skill-lock.json') || !['user'].includes(marker.scope) || marker.mode !== 'canonical') throw new Error('backup paths do not match the canonical AKE layout');
  const allowedLinks = new Set([marker.canonicalPath, ...['.claude', '.codebuddy'].map(agent => path.join(path.dirname(marker.agentsHome), agent, 'skills', 'ake'))]);
  if (!Array.isArray(marker.agentLinks) || new Set(marker.agentLinks.map(item => item.path)).size !== marker.agentLinks.length || marker.agentLinks.some(item => !allowedLinks.has(item.path) || typeof item.existed !== 'boolean' || (item.existed && (!['symlink', 'directory', 'file'].includes(item.type) || (item.type === 'symlink' ? typeof item.linkTarget !== 'string' || !item.linkTarget || item.linkTarget.includes('\0') : item.linkTarget !== null))) || (!item.existed && (item.type !== null || item.linkTarget !== null)))) throw new Error('backup contains an unsupported agent path');
  const allowedSkillsDirectories = new Set([path.join(marker.agentsHome, 'skills'), ...['.claude', '.codebuddy'].flatMap(agent => [path.join(path.dirname(marker.agentsHome), agent, 'skills'), path.join(path.dirname(marker.agentsHome), agent)])]);
  if (!Array.isArray(marker.skillsDirectories) || new Set(marker.skillsDirectories.map(item => item.path)).size !== marker.skillsDirectories.length || marker.skillsDirectories.some(item => !allowedSkillsDirectories.has(item.path) || typeof item.existed !== 'boolean' || (item.existed ? !Array.isArray(item.entries) || new Set(item.entries).size !== item.entries.length || item.entries.some(name => typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) : item.entries !== null))) throw new Error('backup contains invalid skills directory snapshots');
  if (path.basename(directory) !== marker.backupId || !marker.entries.some(item => item.relativePath === 'canonical' && item.type === 'directory') || Boolean(marker.entries.some(item => item.relativePath === 'lock.json' && item.type === 'file')) !== marker.lockExisted || marker.entries.some(item => item.relativePath.startsWith('lock.json/'))) throw new Error('backup identity or required entries are inconsistent');
  const canonicalLink = marker.agentLinks.find(item => item.path === marker.canonicalPath);
  if (!canonicalLink?.existed || canonicalLink.type !== 'directory') throw new Error('backup does not record the canonical directory');
  const seen = new Set();
  for (const entry of marker.entries) {
    const segments = entry.relativePath?.split(/[\\/]/) ?? [];
    if (!entry.relativePath || path.isAbsolute(entry.relativePath) || /^[A-Za-z]:/.test(entry.relativePath) || segments.includes('..') || segments.some(part => !part || part === '.') || !['canonical', 'lock.json'].includes(segments[0]) || seen.has(entry.relativePath) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('unsafe or duplicate backup entry');
    seen.add(entry.relativePath);
    if (!['file', 'directory', 'symlink'].includes(entry.type)) throw new Error(`unsupported backup entry type: ${entry.relativePath}`);
    const parts = ['data', ...entry.relativePath.split('/')];
    let parent = directory;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      const parentInfo = await lstat(parent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error(`unsafe backup parent: ${parent}`);
    }
    const item = path.join(directory, ...parts);
    const info = await lstat(item);
    if ((entry.type === 'file' && !info.isFile()) || (entry.type === 'directory' && !info.isDirectory()) || (entry.type === 'symlink' && !info.isSymbolicLink())) throw new Error(`backup entry type mismatch: ${entry.relativePath}`);
    if (!backupModesMatch(entry.mode, info.mode & 0o777)) throw new Error(`backup mode mismatch: ${entry.relativePath}`);
    if (entry.type === 'file' && sha256(await readFile(item)) !== entry.sha256) throw new Error(`backup checksum mismatch: ${entry.relativePath}`);
    if (entry.type === 'symlink' && await readlink(item) !== entry.linkTarget) throw new Error(`backup link mismatch: ${entry.relativePath}`);
  }
  const dataDirectory = path.join(directory, 'data');
  const dataInfo = await lstat(dataDirectory);
  if (!dataInfo.isDirectory() || dataInfo.isSymbolicLink()) throw new Error('backup data is not a real directory');
  const actualEntries = await snapshotTree(dataDirectory);
  const normalize = entries => entries.map(({ relativePath, type, mode, sha256: digest = null, linkTarget = null }) => [relativePath, type, normalizeBackupMode(mode), digest, linkTarget]).sort((a, b) => a[0].localeCompare(b[0]));
  if (JSON.stringify(normalize(actualEntries)) !== JSON.stringify(normalize(marker.entries))) throw new Error('backup data tree does not exactly match manifest entries');
  return marker;
}

export async function validateBackup(directory) {
  try { return await validateBackupEntries(directory); }
  catch (error) {
    if (error.code === 'BACKUP') throw error;
    throw Object.assign(new Error(`invalid AKE backup: ${error.message}`), { code: 'BACKUP', cause: error });
  }
}

async function snapshotSkillsDirectories(agentsHome) {
  const claudePath = path.join(path.dirname(agentsHome), '.claude', 'skills');
  const snapshots = [];
  for (const directoryPath of [path.join(agentsHome, 'skills'), claudePath, path.dirname(claudePath), path.join(path.dirname(agentsHome), '.codebuddy', 'skills'), path.join(path.dirname(agentsHome), '.codebuddy')]) {
    const info = await exists(directoryPath);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw Object.assign(new Error(`unsafe agent skills directory: ${directoryPath}`), { code: 'BACKUP' });
    snapshots.push({ path: directoryPath, existed: Boolean(info), entries: info ? (await readdir(directoryPath)).sort() : null });
  }
  return snapshots;
}
async function snapshotAgentLinks(paths) {
  const snapshots = [];
  for (const linkPath of paths) {
    const info = await exists(linkPath);
    snapshots.push({ path: linkPath, existed: Boolean(info), type: info?.isSymbolicLink() ? 'symlink' : info?.isDirectory() ? 'directory' : info?.isFile() ? 'file' : null, linkTarget: info?.isSymbolicLink() ? await readlink(linkPath) : null });
  }
  return snapshots;
}

export function rollbackAnchorIdentity(info) {
  const fields = ['dev', 'ino', 'birthtimeNs'];
  if (fields.some(key => typeof info?.[key] !== 'bigint' || info[key] <= 0n)) throw new Error('rollback ancestor identity is unavailable or unreliable');
  return Object.fromEntries(fields.map(key => [key, info[key].toString()]));
}

async function captureRollbackAnchors(agentsHome) {
  const home = path.dirname(agentsHome);
  const paths = [home, agentsHome, path.join(agentsHome, 'skills'), path.join(agentsHome, 'ake'), path.join(agentsHome, 'ake', 'backups')];
  const optionalPaths = ['.claude', '.codebuddy'].flatMap(agent => [path.join(home, agent), path.join(home, agent, 'skills')]);
  const anchors = [];
  for (const directory of [...paths, ...optionalPaths]) {
    let info;
    try { info = await lstat(directory, { bigint: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!info && optionalPaths.includes(directory)) { anchors.push({ path: directory, exists: false }); continue; }
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe rollback ancestor: ${directory}`);
    let identity;
    try { identity = rollbackAnchorIdentity(info); }
    catch (error) { throw new Error(`cannot verify rollback ancestor identity: ${directory}: ${error.message}`); }
    anchors.push({ path: directory, exists: true, realPath: await realpath(directory), ...identity });
  }
  return anchors;
}

export async function verifyRollbackAnchors(backup) {
  const agentsHome = backup.manifest?.agentsHome;
  if (!path.isAbsolute(agentsHome ?? '') || !Array.isArray(backup.anchors)) throw new Error('rollback ancestor identity is unavailable');
  const current = await captureRollbackAnchors(agentsHome);
  if (JSON.stringify(current) !== JSON.stringify(backup.anchors)) {
    const changed = current.filter((item, index) => JSON.stringify(item) !== JSON.stringify(backup.anchors[index])).map(item => item.path);
    throw new Error(`rollback ancestor identity changed: ${changed.join(', ') || agentsHome}`);
  }
  const backupPath = backup.backupPath, expected = backup.backupIdentity;
  if (!path.isAbsolute(backupPath ?? '') || !expected || path.dirname(backupPath) !== path.join(agentsHome, 'ake', 'backups')) throw new Error('backup directory identity is unavailable');
  const info = await lstat(backupPath, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || JSON.stringify(rollbackAnchorIdentity(info)) !== JSON.stringify(expected.identity) || await realpath(backupPath) !== expected.realPath) throw new Error(`backup directory identity changed: ${backupPath}`);
}

export async function createBackup({ agentsHome, installation, lockPath, targetCommit }) {
  const canonicalPath = installation.canonicalPath;
  const lockInfo = await exists(lockPath);
  if (lockInfo && (!lockInfo.isFile() || lockInfo.isSymbolicLink())) throw Object.assign(new Error('Skills lock is not a regular file'), { code: 'BACKUP' });
  const lockBytes = lockInfo ? await readFile(lockPath) : null;
  const tree = await snapshotTree(canonicalPath);
  const canonicalInfo = await lstat(canonicalPath);
  if (!canonicalInfo.isDirectory() || canonicalInfo.isSymbolicLink()) throw Object.assign(new Error('canonical installation is not a real directory'), { code: 'BACKUP' });
  const rootMode = canonicalInfo.mode & 0o777;
  const entries = [{ relativePath: 'canonical', type: 'directory', mode: rootMode, sha256: null, linkTarget: null }, ...tree.map(entry => ({ ...entry, relativePath: `canonical/${entry.relativePath}` }))];
  if (lockBytes) entries.push({ relativePath: 'lock.json', type: 'file', mode: 0o600, sha256: sha256(lockBytes), linkTarget: null });
  const claudePath = path.join(path.dirname(agentsHome), '.claude', 'skills', 'ake');
  const buddyPath = path.join(path.dirname(agentsHome), '.codebuddy', 'skills', 'ake');
  const linkPaths = [...new Set([canonicalPath, claudePath, buddyPath, ...(installation.agentPaths ?? []).map(item => item.path)])];
  const skillsDirectories = await snapshotSkillsDirectories(agentsHome);
  const agentLinks = await snapshotAgentLinks(linkPaths);
  const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
  await ensureDirectory(agentsHome);
  const updateDirectory = path.join(agentsHome, 'ake'); await ensureDirectory(updateDirectory, { create: true });
  const root = path.join(updateDirectory, 'backups'); await ensureDirectory(root, { create: true });
  let anchors;
  try { anchors = await captureRollbackAnchors(agentsHome); }
  catch (error) { throw Object.assign(new Error(`backup ancestor verification failed: ${error.message}; management directories may already exist`), { code: 'BACKUP', cause: error }); }
  const directory = path.join(root, backupId);
  await mkdir(directory, { mode: 0o700 });
  try {
    const info = await lstat(directory, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe backup directory');
    const backupIdentity = { identity: rollbackAnchorIdentity(info), realPath: await realpath(directory) };
    await mkdir(path.join(directory, 'data'));
    await copyTree(canonicalPath, path.join(directory, 'data', 'canonical'), tree, rootMode);
    if (lockBytes) { await writeFile(path.join(directory, 'data', 'lock.json'), lockBytes, { mode: 0o600 }); }
  const manifest = { format: MARKER, schemaVersion: 1, backupId, createdAt: new Date().toISOString(), originalPath: canonicalPath, loadPath: installation.loadPath, agentsHome, canonicalPath, scope: installation.scope, mode: installation.mode, source: installation.source, sourceType: installation.sourceType, commit: installation.commit, targetCommit, agentPaths: installation.agentPaths, agentLinks, skillsDirectories, lockPath, lockExisted: lockBytes !== null, entries };
    await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await validateBackup(directory);
    const after = await snapshotTree(canonicalPath);
    const lockAfterInfo = await exists(lockPath);
    if (lockAfterInfo && (!lockAfterInfo.isFile() || lockAfterInfo.isSymbolicLink())) throw new Error('Skills lock changed type during backup');
    const lockAfter = lockAfterInfo ? await readFile(lockPath) : null;
    const linksAfter = await snapshotAgentLinks(linkPaths);
    const skillsAfter = await snapshotSkillsDirectories(agentsHome);
    if (JSON.stringify(tree) !== JSON.stringify(after) || !Buffer.from(lockBytes ?? []).equals(Buffer.from(lockAfter ?? [])) || JSON.stringify(agentLinks) !== JSON.stringify(linksAfter) || JSON.stringify(skillsDirectories) !== JSON.stringify(skillsAfter)) throw new Error('installation/lock/agent paths changed during backup');
    await verifyRollbackAnchors({ backupPath: directory, backupIdentity, manifest, anchors });
    return { backupPath: directory, backupIdentity, manifest, originalLockBytes: lockBytes, originalTree: tree, anchors };
  } catch (error) {
    throw Object.assign(new Error(`backup creation/verification failed: ${error.message}`), { code: 'BACKUP' });
  }
}

async function rmTree(target) {
  const info = await exists(target);
  if (!info) return;
  if (info.isSymbolicLink() || info.isFile()) { await unlink(target); return; }
  for (const name of await readdir(target)) await rmTree(path.join(target, name));
  await rmdir(target);
}

export async function cleanupBackups(agentsHome, { now = Date.now(), currentBackup = null } = {}) {
  const updateDirectory = path.join(agentsHome, 'ake');
  const updateStat = await exists(updateDirectory);
  if (updateStat?.isSymbolicLink() || (updateStat && !updateStat.isDirectory())) return ['backup parent is unsafe; cleanup skipped'];
  const root = path.join(updateDirectory, 'backups');
  const rootStat = await exists(root);
  if (rootStat?.isSymbolicLink() || (rootStat && !rootStat.isDirectory())) return ['backup root is not a real directory; cleanup skipped'];
  const dirs = await readdir(root, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const valid = [];
  const warnings = [];
  for (const dir of dirs) {
    const full = path.join(root, dir.name);
    try { const info = await lstat(full); if (!info.isDirectory() || info.isSymbolicLink()) continue; const manifest = await validateBackup(full); const time = Date.parse(manifest.createdAt); if (time > now) warnings.push(`retained future-dated backup ${manifest.backupId}`); valid.push({ full, id: manifest.backupId, time }); }
    catch (error) { warnings.push(`retained unverified backup ${dir.name}: ${error.message}`); }
  }
  valid.sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
  const byId = new Map();
  for (const item of valid) byId.set(item.id, [...(byId.get(item.id) ?? []), item]);
  const keep = new Set(valid.slice(0, 3).map(x => x.full));
  for (const [id, items] of byId) if (items.length > 1) { warnings.push(`duplicate backup id ${id}; retained all matching directories`); for (const item of items) keep.add(item.full); }
  for (const item of valid) if (now - item.time <= 30 * 86400_000 || item.full === currentBackup) keep.add(item.full);
  for (const item of valid) if (!keep.has(item.full)) { try { await rmTree(item.full); } catch (error) { warnings.push(`could not remove ${item.id}: ${error.message}`); } }
  return warnings;
}

export { snapshotTree, sha256 };
