import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatePath } from '../../src/lib/candidates.mjs';
import { tempRoot } from '../helpers/test-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(t) {
  const root = await tempRoot('ake-candidate-path-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.ake'), { recursive: true });
  await writeFile(path.join(root, '.ake/config.json'), '{}\n');
  return { root, dir: path.join(root, '.ake/candidates') };
}

test('missing candidate directory means not found but other inspection errors are explicit', async t => {
  const { root, dir } = await fixture(t);
  await assert.rejects(candidatePath(root, 'C-0001'), /candidate C-0001 not found/);
  await writeFile(dir, 'not a directory');
  await assert.rejects(candidatePath(root, 'C-0001'), error => error.message.includes('cannot inspect candidate directory') && error.code === undefined);
});

test('candidate lookup does not misreport EACCES as a missing candidate', async t => {
  if (process.platform === 'win32') return t.skip('chmod mode bits do not model Windows ACL denial');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can read mode-000 directories; permission denial unavailable');
  const { root, dir } = await fixture(t);
  await mkdir(dir);
  await chmod(dir, 0o000);
  let denied = false;
  try { await access(dir, constants.R_OK | constants.X_OK); }
  catch (error) { if (error.code === 'EACCES') denied = true; else throw error; }
  if (!denied) {
    await chmod(dir, 0o700);
    return t.skip('current filesystem/ACL permits access after chmod 000');
  }
  let failure;
  try { await assert.rejects(candidatePath(root, 'C-0001'), /cannot inspect candidate directory.*EACCES/); }
  catch (error) { failure = error; }
  finally { await chmod(dir, 0o700); }
  if (failure) throw failure;
});
