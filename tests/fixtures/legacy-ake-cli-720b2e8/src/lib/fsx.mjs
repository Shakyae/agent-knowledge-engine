import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalize = value => value.replace(/\r\n?/g, '\n');
export function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
export async function assertRealInside(root, target) {
  const realRoot = await realpath(root); const absolute = path.resolve(target);
  let cursor = absolute;
  while (!inside(root, cursor)) throw Error(`path escapes project root: ${target}`);
  const projectPath = path.resolve(root);
  while (inside(projectPath, cursor)) {
    try { const stat = await lstat(cursor); if (stat.isSymbolicLink()) { const resolved = await realpath(cursor); if (!inside(realRoot, resolved)) throw Error(`path escapes project root through symlink: ${target}`); } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cursor === projectPath) break;
    cursor = path.dirname(cursor);
  }
  const parent = path.dirname(absolute);
  let existing = parent;
  while (true) { try { existing = await realpath(existing); break; } catch (e) { if (e.code !== 'ENOENT') throw e; const up = path.dirname(existing); if (up === existing) throw e; existing = up; } }
  if (!inside(realRoot, existing)) throw Error(`path escapes project root through symlink: ${target}`);
  return absolute;
}
export async function atomicWrite(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try { await writeFile(tmp, typeof data === 'string' ? normalize(data) : data); await rename(tmp, file); }
  catch (error) { try { await unlink(tmp); } catch {} throw error; }
}
export async function readText(file) { return normalize(await readFile(file, 'utf8')); }
export function relativePath(root, target) { return path.relative(root, target).split(path.sep).join('/'); }
