import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'scripts/ake.mjs');

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-config-path-safety-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function gitInit(directory) {
  const result = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

async function linkOutside(t, target, link) {
  try { await symlink(target, link, 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(`directory symlink unavailable: ${error.code}; merged/default path escape is unverified on this platform`);
      return false;
    }
    throw error;
  }
  return true;
}

test('partial config validates inherited default roots and rejects symlink escape', async (t) => {
  const root = await fixture(t);
  const project = path.join(root, 'partial project');
  const outside = path.join(root, 'outside notes');
  await mkdir(project);
  await mkdir(outside);
  gitInit(project);
  await mkdir(path.join(project, '.ake'));
  await writeFile(path.join(project, '.ake/config.json'), JSON.stringify({ knowledgeRoots: { note: '.agents/notes-custom' } }));
  await mkdir(path.join(project, 'docs'));
  await writeFile(path.join(outside, 'secret.md'), '# External secret\n\nforbidden-sentinel\n');
  if (!await linkOutside(t, outside, path.join(project, 'docs/cookbook'))) return;

  const result = run(['search', 'forbidden-sentinel'], project);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /knowledgeRoots\.cookbook escapes project root through symlink/);
  assert.doesNotMatch(result.stdout + result.stderr, /forbidden-sentinel/);
});

test('missing-config fallback validates defaults for implicit root and explicit subdirectory', async (t) => {
  const root = await fixture(t);
  const project = path.join(root, 'fallback project');
  const subproject = path.join(project, 'explicit target');
  const outside = path.join(root, 'outside docs');
  await mkdir(subproject, { recursive: true });
  await mkdir(outside);
  gitInit(project);
  await writeFile(path.join(outside, 'secret.md'), '# External secret\n\nforbidden-sentinel\n');
  await mkdir(path.join(project, 'docs'));
  if (!await linkOutside(t, outside, path.join(project, 'docs/cookbook'))) return;
  await mkdir(path.join(subproject, 'docs'));
  if (!await linkOutside(t, outside, path.join(subproject, 'docs/cookbook'))) return;

  const implicit = run(['search', 'forbidden-sentinel'], project);
  assert.equal(implicit.status, 1);
  assert.match(implicit.stderr, /knowledgeRoots\.cookbook escapes project root through symlink/);
  assert.doesNotMatch(implicit.stdout + implicit.stderr, /forbidden-sentinel/);

  const explicit = run(['search', 'forbidden-sentinel', '--project', subproject], project);
  assert.equal(explicit.status, 1);
  assert.match(explicit.stderr, /knowledgeRoots\.cookbook escapes project root through symlink/);
  assert.doesNotMatch(explicit.stdout + explicit.stderr, /forbidden-sentinel/);
});
