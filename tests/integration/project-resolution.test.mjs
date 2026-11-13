import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'scripts/ake.mjs');

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-project-resolution-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function gitInit(directory) {
  const result = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function run(args, cwd, env = process.env) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
}

function jsonCommand(args, cwd, env) {
  const result = run([...args, '--json'], cwd, env);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

async function initProject(target, cwd) {
  const result = run(['init', '--dir', target], cwd);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test('nearest AKE subproject owns status, search, and candidate writes across cwd changes', async (t) => {
  const root = await fixture(t);
  const parent = path.join(root, 'parent repo');
  const child = path.join(parent, 'child project');
  const work = path.join(child, 'nested', 'work');
  await mkdir(work, { recursive: true });
  gitInit(parent);
  await initProject(parent, root);
  await initProject(child, root);

  await writeFile(path.join(parent, 'docs/cookbook/parent-sentinel.md'), '# Parent sentinel\n\nparent-only-needle\n');
  await writeFile(path.join(child, 'docs/cookbook/child-sentinel.md'), '# Child sentinel\n\nchild-only-needle\n');
  const note = path.join(work, 'candidate.md');
  await writeFile(note, '# Child candidate\n\nThis candidate is scoped to the nested project.\n');

  const status = jsonCommand(['status'], work);
  assert.equal(status.project, child);
  const childSearch = run(['search', 'child-only-needle'], work);
  assert.equal(childSearch.status, 0, childSearch.stderr);
  assert.match(childSearch.stdout, /child-sentinel\.md/);
  assert.doesNotMatch(childSearch.stdout, /parent-sentinel\.md/);
  const parentSearch = run(['search', 'parent-only-needle', '--project', parent], work);
  assert.equal(parentSearch.status, 0, parentSearch.stderr);
  assert.match(parentSearch.stdout, /parent-sentinel\.md/);
  assert.doesNotMatch(parentSearch.stdout, /child-sentinel\.md/);

  const candidate = run([
    'candidate', 'new', '--kind', 'cookbook', '--title', 'Child-only candidate', '--author', 'test',
    '--target', 'docs/cookbook/child-candidate.md', '--body', note,
  ], work);
  assert.equal(candidate.status, 0, candidate.stderr + candidate.stdout);
  assert.equal((await readdir(path.join(child, '.ake/candidates'))).length, 1);
  assert.equal((await readdir(path.join(parent, '.ake/candidates'))).length, 0);

  const childOverride = jsonCommand(['status', '--project', child], parent);
  assert.equal(childOverride.project, child);
});

test('explicit unmarked subdirectory and empty root .ake preserve default-config behavior', async (t) => {
  const root = await fixture(t);
  const parent = path.join(root, 'parent repo');
  const child = path.join(parent, 'child');
  const plain = path.join(child, 'plain');
  await mkdir(plain, { recursive: true });
  gitInit(parent);
  await initProject(parent, root);

  const implicit = jsonCommand(['status'], plain);
  assert.equal(implicit.project, parent);
  const explicit = jsonCommand(['status', '--project', plain], child);
  assert.equal(explicit.project, plain);
  const explicitSearch = run(['search', 'parent-only-needle', '--project', plain], child);
  assert.equal(explicitSearch.status, 0, explicitSearch.stderr);
  assert.match(explicitSearch.stdout, /No matching knowledge found/);
  const explicitBody = path.join(plain, 'candidate.md');
  await writeFile(explicitBody, '# Explicit candidate\n\nCandidate in exact unmarked target.\n');
  const explicitCreate = run([
    'candidate', 'new', '--kind', 'cookbook', '--title', 'Exact project candidate', '--author', 'test',
    '--target', 'docs/cookbook/exact-candidate.md', '--body', explicitBody, '--project', plain,
  ], child);
  assert.equal(explicitCreate.status, 0, explicitCreate.stderr + explicitCreate.stdout);
  const explicitList = run(['candidate', 'list', '--project', plain], child);
  assert.equal(explicitList.status, 0, explicitList.stderr + explicitList.stdout);
  assert.match(explicitList.stdout, /C-0001/);
  assert.equal((await readdir(path.join(plain, '.ake/candidates'))).length, 1);
  assert.equal((await readdir(path.join(parent, '.ake/candidates'))).length, 0);
  assert.equal(jsonCommand(['status', '--project', plain], parent).project, plain);

  const emptyRoot = path.join(root, 'unmarked worktree');
  const subdir = path.join(emptyRoot, 'deep', 'subdir');
  await mkdir(subdir, { recursive: true });
  gitInit(emptyRoot);
  await mkdir(path.join(emptyRoot, '.ake'));
  const fallback = jsonCommand(['status'], subdir);
  assert.equal(fallback.project, emptyRoot);

  const candidateBody = path.join(subdir, 'candidate.md');
  await writeFile(candidateBody, '# Fallback candidate\n\nBody with enough content to create a candidate.\n');
  const created = run([
    'candidate', 'new', '--kind', 'cookbook', '--title', 'Fallback candidate', '--author', 'test',
    '--target', 'docs/cookbook/fallback-candidate.md', '--body', candidateBody,
  ], subdir);
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const listed = run(['candidate', 'list'], subdir);
  assert.equal(listed.status, 0, listed.stderr + listed.stdout);
  assert.match(listed.stdout, /C-0001/);
  await assert.rejects(readFile(path.join(emptyRoot, '.ake/config.json')), { code: 'ENOENT' });
});

test('project discovery follows a linked Git worktree containing an AKE project', async (t) => {
  const root = await fixture(t);
  const main = path.join(root, 'main');
  const linked = path.join(root, 'linked');
  await mkdir(main);
  gitInit(main);
  await writeFile(path.join(main, 'seed.txt'), 'seed\n');
  let git = spawnSync('git', ['-C', main, 'add', 'seed.txt'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  git = spawnSync('git', ['-C', main, '-c', 'user.name=AKE Test', '-c', 'user.email=ake@example.invalid', 'commit', '-m', 'seed'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  git = spawnSync('git', ['-C', main, 'worktree', 'add', '--detach', linked, 'HEAD'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  await initProject(linked, root);
  await writeFile(path.join(linked, 'docs/cookbook/linked-sentinel.md'), '# Linked sentinel\n\nlinked-worktree-needle\n');
  const work = path.join(linked, 'nested');
  await mkdir(work);

  const status = jsonCommand(['status'], work);
  assert.equal(status.project, linked);
  const search = run(['search', 'linked-worktree-needle'], work);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /linked-sentinel\.md/);
});

test('broken or unsafe inner AKE markers refuse parent fallback', async (t) => {
  const root = await fixture(t);
  const parent = path.join(root, 'parent');
  const child = path.join(parent, 'child');
  const nested = path.join(child, 'work');
  await mkdir(nested, { recursive: true });
  gitInit(parent);
  await initProject(parent, root);

  await mkdir(path.join(child, '.ake'));
  let result = run(['search', 'anything'], nested);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /incomplete AKE marker/);
  assert.match(result.stderr, /refusing parent-project fallback/);

  await writeFile(path.join(child, '.ake/config.json'), JSON.stringify({ knowledgeRoots: { note: '.agents/notes-custom' } }));
  result = run(['search', 'anything', '--json'], nested);
  assert.equal(result.status, 0, result.stderr);
  const partial = JSON.parse(result.stdout);
  assert.ok(partial.searchedRoots.includes('.agents/notes-custom'));
  assert.ok(partial.searchedRoots.includes('docs/cookbook'));

  await writeFile(path.join(child, '.ake/config.json'), '{"knowledgeRoots":"malformed"}');
  result = run(['search', 'anything'], nested);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config knowledgeRoots must be an object/);
  assert.match(result.stderr, /refusing parent-project fallback/);

  await rm(path.join(child, '.ake'), { recursive: true, force: true });
  const outside = path.join(root, 'outside .ake');
  await mkdir(path.join(outside, '.ake'), { recursive: true });
  await writeFile(path.join(outside, '.ake/config.json'), await readFile(path.join(parent, '.ake/config.json')));
  try { await symlink(path.join(outside, '.ake'), path.join(child, '.ake')); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`directory symlink unavailable: ${error.code}`);
    throw error;
  }
  result = run(['search', 'anything'], nested);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe AKE marker/);
  assert.match(result.stderr, /refusing parent-project fallback/);
});

test('invalid config paths and GIT_DIR overrides do not redirect project selection', async (t) => {
  const root = await fixture(t);
  const parent = path.join(root, 'parent');
  const child = path.join(parent, 'child');
  const work = path.join(child, 'work');
  await mkdir(work, { recursive: true });
  gitInit(parent);
  await initProject(parent, root);
  await initProject(child, root);

  const valid = JSON.parse(await readFile(path.join(child, '.ake/config.json'), 'utf8'));
  valid.knowledgeRoots.note = '../../outside-notes';
  await writeFile(path.join(child, '.ake/config.json'), JSON.stringify(valid));
  let result = run(['status'], work);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /knowledgeRoots\.note escapes project root/);
  assert.match(result.stderr, /refusing parent-project fallback/);

  await writeFile(path.join(child, '.ake/config.json'), await readFile(path.join(parent, '.ake/config.json')));
  const polluted = { ...process.env, GIT_DIR: path.join(parent, '.git'), GIT_WORK_TREE: parent };
  const status = jsonCommand(['status'], work, polluted);
  assert.equal(status.project, child);
  const parentStatus = jsonCommand(['status', '--project', parent], work, polluted);
  assert.equal(parentStatus.project, parent);
});
