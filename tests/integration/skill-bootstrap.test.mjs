import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillSource = path.join(repoRoot, 'skills', 'ake');

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-skill-bootstrap-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installedSkill = path.join(root, 'installed-skills', 'ake');
  await mkdir(path.dirname(installedSkill), { recursive: true });
  await cp(skillSource, installedSkill, { recursive: true });
  return { root, installedSkill, bootstrap: path.join(installedSkill, 'bootstrap.mjs') };
}

function gitInit(directory) {
  const result = spawnSync('git', ['init', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function run(bootstrap, target, cwd, ...args) {
  return spawnSync(process.execPath, [bootstrap, '--dir', target, ...args], { cwd, encoding: 'utf8' });
}

function firstJson(text) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth++;
    } else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error('no complete JSON object in output');
}

test('copied Skill bootstraps offline from another cwd in a Unicode/spaced Git root', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, '项目 with spaces');
  await mkdir(target);
  gitInit(target);

  const result = run(bootstrap, target, root);
  assert.equal(result.status, 0, result.stderr);
  const plan = firstJson(result.stdout);
  assert.equal(plan.conflicts.length, 0);
  assert.ok(plan.plan.some((item) => item.path === '.ake/tools/scripts/ake.mjs' && item.status === 'created'));
  assert.ok(plan.plan.some((item) => item.path === 'AGENTS.md' && item.status === 'created'));
  assert.equal(await readFile(path.join(target, '.ake/tools/src/lib/init.mjs'), 'utf8'), await readFile(path.join(bootstrap, '..', 'resources', 'ake-source', 'src/lib/init.mjs'), 'utf8'));

  const copiedCli = path.join(target, '.ake/tools/scripts/ake.mjs');
  const validate = spawnSync(process.execPath, [copiedCli, 'validate', '--project', target], { cwd: root, encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /0 errors, 0 warnings/);
  const search = spawnSync(process.execPath, [copiedCli, 'search', 'offline', '--project', target], { cwd: root, encoding: 'utf8' });
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /No matching knowledge found/);
  assert.deepEqual((await readdir(target)).sort(), ['.agents', '.ake', 'AGENTS.md', 'docs', '.git'].sort());
});

test('dry-run displays plan without writes; conflicts stop before applying safe items', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'dry run');
  await mkdir(target);
  gitInit(target);
  const dry = run(bootstrap, target, root, '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(firstJson(dry.stdout).plan.some((item) => item.status === 'created'));
  assert.deepEqual((await readdir(target)).sort(), ['.git']);

  await mkdir(path.join(target, 'docs/cookbook'), { recursive: true });
  await writeFile(path.join(target, 'docs/cookbook/README.md'), 'preserve conflict\n');
  const applied = run(bootstrap, target, root);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /resolve every reported init conflict/);
  assert.equal(await readFile(path.join(target, 'docs/cookbook/README.md'), 'utf8'), 'preserve conflict\n');
  await assert.rejects(readFile(path.join(target, '.ake/config.json')), { code: 'ENOENT' });
});

test('non-Git targets are refused with zero writes', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const nonGit = path.join(root, 'not git');
  await mkdir(nonGit);
  const absent = run(bootstrap, nonGit, root);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /Ask the user/);
  assert.deepEqual(await readdir(nonGit), []);
});

test('copied Skill CLI writes only to a bootstrapped AKE subproject in a parent work tree', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const parent = path.join(root, 'parent repo');
  const target = path.join(parent, 'project subdir');
  const work = path.join(target, 'nested work');
  await mkdir(work, { recursive: true });
  gitInit(parent);
  await mkdir(path.join(parent, '.ake/candidates'), { recursive: true });
  await mkdir(path.join(parent, 'docs/cookbook'), { recursive: true });
  await writeFile(path.join(parent, '.ake/config.json'), JSON.stringify({
    version: '0.1.0',
    knowledgeRoots: { note: '.agents/notes', 'defensive-pattern': 'docs/defensive-patterns', postmortem: 'docs/postmortem', cookbook: 'docs/cookbook' },
    candidatesDir: '.ake/candidates', publishLog: '.ake/publish-log.jsonl',
  }));
  await writeFile(path.join(parent, 'docs/cookbook/parent-sentinel.md'), '# Parent sentinel\n\nparent-only-needle\n');

  const result = run(bootstrap, target, root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(await readFile(path.join(target, '.ake/config.json'), 'utf8')).version);
  assert.deepEqual((await readdir(target)).sort(), ['.agents', '.ake', 'AGENTS.md', 'docs', 'nested work'].sort());
  await assert.rejects(readFile(path.join(target, '.git')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(parent)).sort(), ['.ake', '.git', 'docs', 'project subdir']);

  const copiedCli = path.join(target, '.ake/tools/scripts/ake.mjs');
  const status = spawnSync(process.execPath, [copiedCli, 'status', '--json'], { cwd: work, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).project, target);
  await writeFile(path.join(target, 'docs/cookbook/child-sentinel.md'), '# Child sentinel\n\nchild-only-needle\n');
  const childSearch = spawnSync(process.execPath, [copiedCli, 'search', 'child-only-needle'], { cwd: work, encoding: 'utf8' });
  assert.equal(childSearch.status, 0, childSearch.stderr);
  assert.match(childSearch.stdout, /child-sentinel\.md/);
  assert.doesNotMatch(childSearch.stdout, /parent-sentinel\.md/);
  const parentSearch = spawnSync(process.execPath, [copiedCli, 'search', 'parent-only-needle', '--project', parent], { cwd: work, encoding: 'utf8' });
  assert.equal(parentSearch.status, 0, parentSearch.stderr);
  assert.match(parentSearch.stdout, /parent-sentinel\.md/);

  const body = path.join(work, 'candidate.md');
  await writeFile(body, '# Subproject candidate\n\nCandidate body.\n');
  const candidate = spawnSync(process.execPath, [copiedCli, 'candidate', 'new', '--kind', 'cookbook', '--title', 'Subproject candidate', '--author', 'test', '--target', 'docs/cookbook/child-candidate.md', '--body', body], { cwd: work, encoding: 'utf8' });
  assert.equal(candidate.status, 0, candidate.stderr + candidate.stdout);
  assert.equal((await readdir(path.join(target, '.ake/candidates'))).length, 1);
  assert.equal((await readdir(path.join(parent, '.ake/candidates'))).length, 0);
});

test('a linked worktree is accepted as its own target root', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const parent = path.join(root, 'main repo');
  const linked = path.join(root, 'linked worktree');
  await mkdir(parent);
  gitInit(parent);
  await writeFile(path.join(parent, 'seed.txt'), 'seed\n');
  let git = spawnSync('git', ['-C', parent, 'add', 'seed.txt'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  git = spawnSync('git', ['-C', parent, '-c', 'user.name=AKE Test', '-c', 'user.email=ake@example.invalid', 'commit', '-m', 'seed'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  git = spawnSync('git', ['-C', parent, 'worktree', 'add', '--detach', linked, 'HEAD'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);

  const result = run(bootstrap, linked, root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(await readFile(path.join(linked, '.ake/config.json'), 'utf8')).version);
  assert.equal((await readFile(path.join(linked, '.git'), 'utf8')).startsWith('gitdir:'), true);
});

test('missing Git and bare repositories fail closed', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'target');
  await mkdir(target);

  const missingGitPath = path.join(root, 'empty-path');
  await mkdir(missingGitPath);
  const noGit = spawnSync(process.execPath, [bootstrap, '--dir', target], { cwd: root, env: { ...process.env, PATH: missingGitPath }, encoding: 'utf8' });
  assert.equal(noGit.status, 1);
  assert.match(noGit.stderr, /Git is unavailable/);
  assert.deepEqual(await readdir(target), []);

  const bare = path.join(root, 'bare.git');
  const initBare = spawnSync('git', ['init', '--bare', bare], { encoding: 'utf8' });
  assert.equal(initBare.status, 0, initBare.stderr);
  const bareBefore = (await readdir(bare)).sort();
  const bareResult = run(bootstrap, bare, root);
  assert.equal(bareResult.status, 1);
  assert.match(bareResult.stderr, /bare Git repository/);
  assert.deepEqual((await readdir(bare)).sort(), bareBefore);
});

test('unexpected rev-parse failure fails closed (POSIX-only probe stub)', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable stub is unavailable; Windows rev-parse-error branch remains unverified');
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'target');
  const fakeGitDir = path.join(root, 'fake-git-bin');
  await mkdir(target);
  await mkdir(fakeGitDir);
  const fakeGit = path.join(fakeGitDir, 'git');
  await writeFile(fakeGit, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version test"; exit 0; fi\necho "forced rev-parse failure" >&2\nexit 42\n');
  await import('node:fs/promises').then(({ chmod }) => chmod(fakeGit, 0o755));
  const failedProbe = spawnSync(process.execPath, [bootstrap, '--dir', target], { cwd: root, env: { ...process.env, PATH: fakeGitDir }, encoding: 'utf8' });
  assert.equal(failedProbe.status, 1);
  assert.match(failedProbe.stderr, /rev-parse failed/);
  assert.deepEqual(await readdir(target), []);
});

test('Git selection environment cannot make a non-Git target appear initialized', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const parent = path.join(root, 'env source repo');
  const target = path.join(root, 'outside target');
  await mkdir(parent);
  await mkdir(target);
  gitInit(parent);
  const polluted = { ...process.env, GIT_DIR: path.join(parent, '.git'), GIT_WORK_TREE: parent };

  const result = spawnSync(process.execPath, [bootstrap, '--dir', target], { cwd: root, env: polluted, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ask the user/);
  assert.deepEqual(await readdir(target), []);

  const cli = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ake.mjs'), 'init', '--dir', target], { cwd: root, env: polluted, encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /valid Git work tree/);
  assert.deepEqual(await readdir(target), []);
});

test('existing project config and CLI are preserved without upgrade', async (t) => {
  const { root, installedSkill, bootstrap } = await fixture(t);
  const target = path.join(root, 'already initialized');
  await mkdir(path.join(target, '.ake/tools/scripts'), { recursive: true });
  gitInit(target);
  const config = Buffer.from('{"version":"0.0.9"}\n');
  const cli = Buffer.from('# project-owned CLI\n');
  await writeFile(path.join(target, '.ake/config.json'), config);
  await writeFile(path.join(target, '.ake/tools/scripts/ake.mjs'), cli);

  const result = run(bootstrap, target, root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /config version 0\.0\.9 differs from bundled metadata version 0\.1\.0/);
  assert.match(result.stdout, /project CLI was not executed/);
  assert.deepEqual(await readFile(path.join(target, '.ake/config.json')), config);
  assert.deepEqual(await readFile(path.join(target, '.ake/tools/scripts/ake.mjs')), cli);

  await rm(path.join(installedSkill, 'resources/ake-source/package.json'));
  const unknown = run(bootstrap, target, root);
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.match(unknown.stdout, /Cannot determine whether the installed AKE version matches/);
  assert.match(unknown.stdout, /project CLI was not executed/);
  assert.deepEqual(await readFile(path.join(target, '.ake/config.json')), config);
  assert.deepEqual(await readFile(path.join(target, '.ake/tools/scripts/ake.mjs')), cli);
  assert.deepEqual((await readdir(target)).sort(), ['.ake', '.git']);
});

test('incomplete Skill resources report exact missing files without writes', async (t) => {
  const { root, installedSkill, bootstrap } = await fixture(t);
  const missing = path.join(installedSkill, 'resources/ake-source/src/lib/search.mjs');
  await rm(missing);
  const target = path.join(root, 'target');
  await mkdir(target);
  gitInit(target);

  const result = run(bootstrap, target, root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr, /README installation instructions/);
  assert.deepEqual((await readdir(target)).sort(), ['.git']);
});

test('bundle generation consistency check passes against the committed Skill payload', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/sync-skill-bundle.mjs'), '--check'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skill bundle is synchronized/);
});

// Skills CLI installation itself is not run here: this verifies only execution of a filesystem copy of skills/ake.
