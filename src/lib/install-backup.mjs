import { randomBytes, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile, writeFile, mkdir, copyFile, symlink, readlink, chmod, unlink, rmdir, open } from 'node:fs/promises';

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

async function restoreCanonicalSnapshot(source, targetRoot, entries) {
  const preservedPaths = [], blockedPaths = [];
  const canonicalEntries = entries.filter(entry => entry.relativePath === 'canonical' || entry.relativePath.startsWith('canonical/'))
    .sort((a, b) => a.relativePath.split('/').length - b.relativePath.split('/').length || a.relativePath.localeCompare(b.relativePath));
  for (const entry of canonicalEntries) {
    const suffix = entry.relativePath === 'canonical' ? '' : entry.relativePath.slice('canonical/'.length);
    const target = suffix ? path.join(targetRoot, ...suffix.split('/')) : targetRoot;
    const current = await exists(target);
    if (entry.type === 'directory') {
      if (current && !current.isDirectory()) {
        if (current.isSymbolicLink() || current.isFile()) await unlink(target);
        else { blockedPaths.push(target); preservedPaths.push(target); continue; }
      }
      await mkdir(target, { recursive: true, mode: 0o700 }); await chmod(target, 0o700);
    } else if (entry.type === 'file') {
      if (current?.isDirectory() && !current.isSymbolicLink()) { blockedPaths.push(target); preservedPaths.push(target); continue; }
      if (current) {
        if (!current.isFile() && !current.isSymbolicLink()) { blockedPaths.push(target); preservedPaths.push(target); continue; }
        await unlink(target);
      }
      const backupFile = path.join(source, ...entry.relativePath.split('/'));
      await copyFile(backupFile, target); await chmod(target, entry.mode);
    } else {
      if (current?.isDirectory() && !current.isSymbolicLink()) { blockedPaths.push(target); preservedPaths.push(target); continue; }
      if (current) {
        if (!current.isFile() && !current.isSymbolicLink()) { blockedPaths.push(target); preservedPaths.push(target); continue; }
        await unlink(target);
      }
      const backupLink = path.join(source, ...entry.relativePath.split('/'));
      await symlink(await readlink(backupLink), target);
    }
  }

  const children = new Map();
  for (const entry of canonicalEntries) {
    if (entry.relativePath === 'canonical') continue;
    const segments = entry.relativePath.split('/');
    const parent = segments.slice(0, -1).join('/');
    children.set(parent, [...(children.get(parent) ?? []), segments.at(-1)]);
  }
  const directoryEntries = canonicalEntries.filter(item => item.type === 'directory');
  for (const entry of directoryEntries) {
    const suffix = entry.relativePath === 'canonical' ? '' : entry.relativePath.slice('canonical/'.length);
    const directory = suffix ? path.join(targetRoot, ...suffix.split('/')) : targetRoot;
    const expected = children.get(entry.relativePath) ?? [];
    for (const name of await readdir(directory).catch(error => ['ENOENT', 'ENOTDIR'].includes(error.code) ? [] : Promise.reject(error))) {
      if (!expected.includes(name)) preservedPaths.push(path.join(directory, name));
    }
  }
  for (const entry of directoryEntries.sort((a, b) => b.relativePath.split('/').length - a.relativePath.split('/').length)) {
    const suffix = entry.relativePath === 'canonical' ? '' : entry.relativePath.slice('canonical/'.length);
    const directory = suffix ? path.join(targetRoot, ...suffix.split('/')) : targetRoot;
    if (!blockedPaths.includes(directory)) await chmod(directory, entry.mode);
  }
  return { preservedPaths: [...new Set(preservedPaths)].sort(), blockedPaths: [...new Set(blockedPaths)].sort() };
}

async function describePreservedPath(fullPath) {
  const info = await exists(fullPath);
  if (info?.isSymbolicLink()) return `${fullPath} (symlink -> ${await readlink(fullPath)})`;
  return fullPath;
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
  const allowedLinks = new Set([marker.canonicalPath, path.join(path.dirname(marker.agentsHome), '.claude', 'skills', 'ake')]);
  if (!Array.isArray(marker.agentLinks) || marker.agentLinks.some(item => !allowedLinks.has(item.path) || typeof item.existed !== 'boolean' || (item.existed && !['symlink', 'directory', 'file'].includes(item.type)) || (!item.existed && (item.type !== null || item.linkTarget !== null)))) throw new Error('backup contains an unsupported agent path');
  const allowedSkillsDirectories = new Set([path.join(marker.agentsHome, 'skills'), path.join(path.dirname(marker.agentsHome), '.claude', 'skills'), path.join(path.dirname(marker.agentsHome), '.claude')]);
  if (!Array.isArray(marker.skillsDirectories) || marker.skillsDirectories.some(item => !allowedSkillsDirectories.has(item.path) || (item.existed ? !Array.isArray(item.entries) : item.entries !== null))) throw new Error('backup contains invalid skills directory snapshots');
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
  for (const directoryPath of [path.join(agentsHome, 'skills'), claudePath, path.dirname(claudePath)]) {
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
  const linkPaths = [...new Set([canonicalPath, claudePath, ...(installation.agentPaths ?? []).map(item => item.path)])];
  const skillsDirectories = await snapshotSkillsDirectories(agentsHome);
  const agentLinks = await snapshotAgentLinks(linkPaths);
  const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
  await ensureDirectory(agentsHome);
  const updateDirectory = path.join(agentsHome, 'ake'); await ensureDirectory(updateDirectory, { create: true });
  const root = path.join(updateDirectory, 'backups'); await ensureDirectory(root, { create: true });
  const directory = path.join(root, backupId);
  await mkdir(directory, { mode: 0o700 });
  try {
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
    return { backupPath: directory, manifest, originalLockBytes: lockBytes, originalTree: tree };
  } catch (error) {
    throw Object.assign(new Error(`backup creation/verification failed: ${error.message}`), { code: 'BACKUP' });
  }
}

export async function restoreBackup(backup, { lockPath = backup.manifest.lockPath } = {}) {
  const manifest = await validateBackup(backup.backupPath);
  const root = manifest.canonicalPath;
  const liveRoot = await exists(root);
  if (liveRoot && (!liveRoot.isDirectory() || liveRoot.isSymbolicLink())) throw new Error('canonical path is not a real directory; refusing unsafe restore');
  const currentInfo = await exists(lockPath);
  if (currentInfo && (!currentInfo.isFile() || currentInfo.isSymbolicLink())) throw new Error('current lock is not a regular file; refusing unsafe restore');
  const currentLock = currentInfo ? await readFile(lockPath) : null;
  const lockDrift = [];
  if (manifest.lockExisted && currentLock) {
    const original = JSON.parse(await readFile(path.join(backup.backupPath, 'data', 'lock.json'), 'utf8'));
    let current, currentParsed = false;
    try { current = JSON.parse(currentLock.toString('utf8')); currentParsed = true; }
    catch { lockDrift.push('lock (current JSON is invalid)'); }
    if (currentParsed) {
      const withoutAke = value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const copy = { ...value };
        if (value.skills && typeof value.skills === 'object' && !Array.isArray(value.skills)) {
          copy.skills = { ...value.skills };
          delete copy.skills.ake;
        }
        return copy;
      };
      lockDrift.push(...diffPaths(withoutAke(original), withoutAke(current)).map(field => `lock.${field}`));
    }
  } else if (manifest.lockExisted) lockDrift.push('lock (disappeared after backup)');
  else if (currentLock) lockDrift.push('lock (appeared after initially absent snapshot)');

  const canonicalRestore = await restoreCanonicalSnapshot(path.join(backup.backupPath, 'data'), root, manifest.entries);
  const nonSnapshotPaths = [...canonicalRestore.preservedPaths];
  for (const link of manifest.agentLinks ?? []) {
    if (link.path === root) continue;
    const current = await exists(link.path);
    if (!link.existed) {
      if (current) nonSnapshotPaths.push(link.path);
      continue;
    }
    if (link.type === 'symlink') {
      if (current?.isSymbolicLink() && await readlink(link.path) === link.linkTarget) continue;
      if (current && !current.isSymbolicLink()) { nonSnapshotPaths.push(link.path); continue; }
      if (current) await unlink(link.path);
      await mkdir(path.dirname(link.path), { recursive: true }); await symlink(link.linkTarget, link.path);
    } else {
      if (!current || (link.type === 'directory' ? !current.isDirectory() || current.isSymbolicLink() : !current.isFile() || current.isSymbolicLink())) throw new Error(`unsupported agent path type during restore: ${link.path}`);
      nonSnapshotPaths.push(link.path);
    }
  }

  for (const snapshot of manifest.skillsDirectories) {
    const current = await exists(snapshot.path);
    if (current && (!current.isDirectory() || current.isSymbolicLink())) throw new Error(`agent skills directory changed type during install: ${snapshot.path}`);
    if (!snapshot.existed) {
      if (current) {
        nonSnapshotPaths.push(snapshot.path);
        for (const name of await readdir(snapshot.path)) nonSnapshotPaths.push(path.join(snapshot.path, name));
      }
      continue;
    }
    if (!current) throw new Error(`agent skills directory disappeared during install: ${snapshot.path}`);
    const names = await readdir(snapshot.path);
    const missing = snapshot.entries.filter(name => !names.includes(name));
    if (missing.length) throw new Error(`pre-existing agent skills entries disappeared during install: ${missing.map(name => path.join(snapshot.path, name)).join(', ')}`);
    for (const name of names) if (!snapshot.entries.includes(name)) nonSnapshotPaths.push(path.join(snapshot.path, name));
  }

  const warnings = [];
  if (nonSnapshotPaths.length) {
    const paths = (await Promise.all([...new Set(nonSnapshotPaths)].sort().map(describePreservedPath))).join(', ');
    warnings.push(canonicalRestore.blockedPaths.length
      ? `AKE 文件未能完整恢复；以下快照路径存在类型冲突，且非快照条目未删除，请人工确认：${paths}`
      : `AKE 文件已恢复；以下非快照条目未删除，请人工确认：${paths}`);
  }
  if (lockDrift.length) {
    warnings.push(`lock 外部漂移未覆盖：${lockDrift.join(', ')}；请保留备份并人工协调 lock 后恢复。`);
    throw Object.assign(new Error(`rollback left external changes untouched: ${[...new Set([...lockDrift, ...nonSnapshotPaths])].join(', ')}`), { code: 'ROLLBACK_FAILED', warnings });
  }
  if (manifest.lockExisted) await writeFile(lockPath, await readFile(path.join(backup.backupPath, 'data', 'lock.json')));
  else await unlink(lockPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
  if (nonSnapshotPaths.length) throw Object.assign(new Error(`rollback left non-snapshot entries untouched: ${[...new Set(nonSnapshotPaths)].join(', ')}`), { code: 'ROLLBACK_FAILED', warnings });
  const restored = await snapshotTree(root);
  if (JSON.stringify(restored) !== JSON.stringify(backup.originalTree)) throw new Error('restored installation does not match backup snapshot');
  const restoredLock = manifest.lockExisted ? await readFile(lockPath) : null;
  if (String(restoredLock) !== String(backup.originalLockBytes)) throw new Error('restored lock differs from original bytes');
  return true;
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
