import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv } from '../helpers/test-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillSource = path.join(repoRoot, 'skills', 'ake');

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-skill-bootstrap-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installedSkill = path.join(root, 'installed-skills', 'ake');
  await mkdir(path.dirname(installedSkill), { recursive: true });
  await cp(skillSource, installedSkill, { recursive: true });
  return { root, installedSkill, bootstrap: path.join(installedSkill, 'bootstrap.mjs'), preflight: path.join(installedSkill, 'preflight.mjs') };
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
  assert.ok(!plan.plan.some((item) => item.path.startsWith('.ake/tools/')));
  assert.ok(plan.plan.some((item) => item.path === 'AGENTS.md' && item.status === 'created'));
  await assert.rejects(readFile(path.join(target, '.ake/tools/scripts/ake.mjs')), { code: 'ENOENT' });

  const copiedCli = path.join(bootstrap, '..', 'resources', 'ake-source', 'scripts', 'ake.mjs');
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
  const dryRun = run(bootstrap, nonGit, root, '--dry-run');
  assert.equal(dryRun.status, 1);
  assert.match(dryRun.stderr, /^NOT_GIT_WORKTREE:/);
  assert.deepEqual(await readdir(nonGit), [], 'dry-run must not invoke git init');
  const absent = run(bootstrap, nonGit, root);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /^NOT_GIT_WORKTREE:/);
  assert.deepEqual(await readdir(nonGit), [], 'bootstrap apply must not implicitly invoke git init');
});

test('damaged .git metadata is not classified as an initializable non-repository', async t => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'damaged git');
  await mkdir(path.join(target, '.git'), { recursive: true });
  await writeFile(path.join(target, '.git', 'partial-marker'), 'preserve');
  const before = (await readdir(path.join(target, '.git'))).sort();
  const result = run(bootstrap, target, root, '--dry-run');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^GIT_METADATA_INVALID:/);
  assert.doesNotMatch(result.stderr, /NOT_GIT_WORKTREE/);
  assert.deepEqual((await readdir(path.join(target, '.git'))).sort(), before);
  assert.deepEqual((await readdir(target)).sort(), ['.git']);
});

test('copied Skill CLI writes only to a bootstrapped AKE subproject in a parent work tree', async (t) => {
  const { root, bootstrap, preflight } = await fixture(t);
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

  const copiedCli = path.join(bootstrap, '..', 'resources', 'ake-source', 'scripts', 'ake.mjs');
  const status = spawnSync(process.execPath, [copiedCli, 'status', '--json', '--project', target], { cwd: work, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).project, target);
  await writeFile(path.join(target, 'docs/cookbook/child-sentinel.md'), '# Child sentinel one\n\nchild-only-needle\n');
  await writeFile(path.join(target, 'docs/cookbook/child-sentinel-2.md'), '# Child sentinel two\n\nchild-only-needle\n');
  const taskEnv = { ...process.env, AKE_PREFLIGHT_CONTEXT: 'unchanged-context' };
  const preflightStatus = runPreflight(preflight, target, taskEnv);
  assert.equal(preflightStatus.status, 0, preflightStatus.stderr);
  assert.match(preflightStatus.stdout, /PROJECT_OK/);
  assert.doesNotMatch(preflightStatus.stdout, /installation version/);
  const childSearch = spawnSync(process.execPath, [copiedCli, 'search', 'child-only-needle', '--limit', '1', '--type', 'cookbook', '--include-candidates', '--json', '--project', target], { cwd: work, env: taskEnv, encoding: 'utf8' });
  assert.equal(childSearch.status, 0, childSearch.stderr);
  const searchResult = JSON.parse(childSearch.stdout);
  assert.equal(searchResult.query.raw, 'child-only-needle');
  assert.equal(searchResult.coverage, 'incomplete');
  assert.ok(searchResult.coverageReasons.some((reason) => reason.includes('results truncated by limit 1')));
  assert.equal(searchResult.truncated, true);
  assert.ok(searchResult.searchedRoots.includes('.ake/candidates'));
  assert.equal(searchResult.results.length, 1);
  assert.ok(searchResult.results.every((result) => result.type === 'cookbook'));
  assert.ok(searchResult.results[0].path.startsWith('docs/cookbook/child-sentinel'));
  assert.doesNotMatch(childSearch.stdout, /parent-sentinel\.md/);
  const parentSearch = spawnSync(process.execPath, [copiedCli, 'search', 'parent-only-needle', '--project', parent], { cwd: work, encoding: 'utf8' });
  assert.equal(parentSearch.status, 0, parentSearch.stderr);
  assert.match(parentSearch.stdout, /parent-sentinel\.md/);

  const body = path.join(work, 'candidate.md');
  await writeFile(body, '# Subproject candidate\n\nCandidate body.\n');
  const candidate = spawnSync(process.execPath, [copiedCli, 'candidate', 'new', '--kind', 'cookbook', '--title', 'Subproject candidate', '--author', 'test', '--target', 'docs/cookbook/child-candidate.md', '--body', body, '--project', target], { cwd: work, encoding: 'utf8' });
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
  assert.match(result.stderr, /^NOT_GIT_WORKTREE:/);
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

  const bundledMetadata = JSON.parse(await readFile(path.join(installedSkill, 'resources/ake-source/package.json'), 'utf8'));
  assert.notEqual(bundledMetadata.version, '0.0.9');
  const result = run(bootstrap, target, root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`config version 0.0.9 differs from bundled metadata version ${bundledMetadata.version}`), result.stdout);
  assert.match(result.stdout, /shared CLI is supplied by the Skill/);
  assert.deepEqual(await readFile(path.join(target, '.ake/config.json')), config);
  assert.deepEqual(await readFile(path.join(target, '.ake/tools/scripts/ake.mjs')), cli);

  await rm(path.join(installedSkill, 'resources/ake-source/package.json'));
  const unknown = run(bootstrap, target, root);
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.match(unknown.stdout, /Cannot determine whether the project config matches/);
  assert.match(unknown.stdout, /Project-local CLI copies are ignored/);
  assert.deepEqual(await readFile(path.join(target, '.ake/config.json')), config);
  assert.deepEqual(await readFile(path.join(target, '.ake/tools/scripts/ake.mjs')), cli);
  assert.deepEqual((await readdir(target)).sort(), ['.ake', '.git']);
});

test('bootstrap refuses non-file project entries and ENOTDIR before applying init', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const nonFile = path.join(root, 'non-file project');
  await mkdir(path.join(nonFile, '.ake/config.json'), { recursive: true });
  gitInit(nonFile);
  const nonFileResult = run(bootstrap, nonFile, root);
  assert.equal(nonFileResult.status, 1);
  assert.match(nonFileResult.stderr, /^EXISTING_PATH_INVALID:/);
  assert.deepEqual((await readdir(nonFile)).sort(), ['.ake', '.git']);

  const blockedAncestor = path.join(root, 'not-directory project');
  await mkdir(path.join(blockedAncestor, '.ake'), { recursive: true });
  await writeFile(path.join(blockedAncestor, '.ake/tools'), 'not a directory');
  gitInit(blockedAncestor);
  const notDirectoryResult = run(bootstrap, blockedAncestor, root);
  assert.equal(notDirectoryResult.status, 0, notDirectoryResult.stderr);
  assert.equal(await readFile(path.join(blockedAncestor, '.ake/tools'), 'utf8'), 'not a directory');
  await access(path.join(blockedAncestor, '.ake/config.json'));
});

test('bootstrap refuses a symlinked project config', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'symlink config project');
  await mkdir(path.join(target, '.ake'), { recursive: true });
  gitInit(target);
  const external = path.join(root, 'external-config.json');
  await writeFile(external, '{"version":"0.1.0"}\n');
  try { await symlink(external, path.join(target, '.ake/config.json')); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`file symlink unavailable: ${error.code}`);
    throw error;
  }
  const result = run(bootstrap, target, root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^EXISTING_PATH_INVALID:/);
  assert.equal(await readFile(external, 'utf8'), '{"version":"0.1.0"}\n');
  assert.deepEqual((await readdir(target)).sort(), ['.ake', '.git']);
});

test('config-only initialized projects are preserved without reinstalling a project CLI', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'partial project');
  await mkdir(path.join(target, '.ake'), { recursive: true });
  await writeFile(path.join(target, '.ake/config.json'), '{"version":"0.1.0"}\n');
  gitInit(target);
  const before = await readFile(path.join(target, '.ake/config.json'));
  const result = run(bootstrap, target, root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AKE config already exists/);
  assert.deepEqual(await readFile(path.join(target, '.ake/config.json')), before);
  assert.deepEqual((await readdir(target)).sort(), ['.ake', '.git']);
});

test('bootstrap reports permission-denied inspection instead of treating it as absent', async (t) => {
  if (process.platform === 'win32') return t.skip('chmod mode bits do not model Windows ACL denial');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can inspect mode-000 directories; permission-denied branch unavailable');
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'permission project');
  const akeDir = path.join(target, '.ake');
  await mkdir(akeDir, { recursive: true });
  gitInit(target);
  await chmod(akeDir, 0o000);
  let denied = false;
  try { await access(akeDir, constants.R_OK | constants.X_OK); }
  catch (error) { if (error.code === 'EACCES') denied = true; else throw error; }
  if (!denied) {
    await chmod(akeDir, 0o700);
    return t.skip('current filesystem/ACL still permits access after chmod 000');
  }
  const result = run(bootstrap, target, root);
  await chmod(akeDir, 0o700);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^EXISTING_PATH_UNAVAILABLE:/);
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

async function preflightProject(root) {
  const target = path.join(root, 'preflight project');
  await mkdir(path.join(target, '.ake'), { recursive: true });
  await writeFile(path.join(target, '.ake/config.json'), '{"version":"0.1.0"}\n');
  return target;
}

function runPreflight(preflight, target, env = process.env) {
  return spawnSync(process.execPath, [preflight, '--dir', target], { cwd: os.tmpdir(), env, encoding: 'utf8' });
}

function stubCliPath(installedSkill) {
  return path.join(installedSkill, 'resources', 'ake-source', 'scripts', 'ake.mjs');
}

async function installStatusStub(installedSkill) {
  const cli = stubCliPath(installedSkill);
  const source = `const CLI_VERSION = '0.3.0';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.PREFLIGHT_LOG) writeFileSync(process.env.PREFLIGHT_LOG, JSON.stringify({ cwd: process.cwd(), args, context: process.env.PREFLIGHT_CONTEXT }));
if (process.env.PREFLIGHT_SIGNAL) process.kill(process.pid, process.env.PREFLIGHT_SIGNAL);
if (process.env.PREFLIGHT_STDOUT !== undefined) process.stdout.write(process.env.PREFLIGHT_STDOUT);
else process.stdout.write(JSON.stringify({ project: process.env.PREFLIGHT_PROJECT ?? process.cwd() }));
if (process.env.PREFLIGHT_STDERR !== undefined) process.stderr.write(process.env.PREFLIGHT_STDERR);
if (process.env.PREFLIGHT_EXIT !== undefined) process.exitCode = Number(process.env.PREFLIGHT_EXIT);
`;
  await writeFile(cli, source);
  return cli;
}

async function sentinelGit(root) {
  const bin = path.join(root, 'sentinel-git-bin');
  const sentinel = path.join(root, 'git-inspector-called');
  await mkdir(bin);
  const fakeGit = path.join(bin, 'git');
  await writeFile(fakeGit, '#!/bin/sh\nprintf x >> "$SENTINEL_FILE"\nif [ "$1" = "--version" ]; then echo "git version sentinel"; exit 0; fi\nif [ "$1" = "-C" ]; then shift 2; if [ "$1" = "rev-parse" ]; then echo "fatal: not a git repository" >&2; exit 128; fi; fi\nexit 91\n');
  await chmod(fakeGit, 0o755);
  return { sentinel, env: { ...process.env, PATH: bin, SENTINEL_FILE: sentinel } };
}

function noGitStatusEnv(extra = {}) {
  return { ...process.env, ...extra, PREFLIGHT_STDOUT: '', PREFLIGHT_STDERR: 'not a AKE project: no .git repository found', PREFLIGHT_EXIT: '1' };
}

test('Skill preflight runs one bundled status stub in canonical cwd/env and ignores old project CLI', async t => {
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  const legacy = path.join(target, '.ake/tools/scripts/ake.mjs');
  await mkdir(path.dirname(legacy), { recursive: true });
  await writeFile(legacy, 'process.exitCode=71; console.error("must not execute");\n');
  const log = path.join(root, 'invocation.json');
  await installStatusStub(installedSkill);
  const result = runPreflight(preflight, target, { ...cleanTestEnv(), PREFLIGHT_LOG: log, PREFLIGHT_CONTEXT: 'same-context' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PROJECT_OK/);
  assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), { cwd: await realpath(target), args: ['status', '--json'], context: 'same-context' });
  assert.equal(await readFile(legacy, 'utf8'), 'process.exitCode=71; console.error("must not execute");\n');
});

test('Skill preflight rejects stubbed parent, relative, and unresolved project identities', async t => {
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const cases = [
    [root, 'PROJECT_MISMATCH'],
    ['.', 'PROJECT_PATH_RELATIVE'],
    [path.join(root, 'missing project'), 'PROJECT_PATH_UNRESOLVABLE'],
  ];
  for (const [project, code] of cases) {
    const result = runPreflight(preflight, target, { ...process.env, PREFLIGHT_PROJECT: project });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`^${code}:`), result.stderr);
  }
});

test('Skill preflight classifies malformed status JSON, missing identity, and unexpected commands', async t => {
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  for (const [env, code] of [
    [{ PREFLIGHT_STDOUT: '{not-json' }, 'STATUS_INVALID_JSON'],
    [{ PREFLIGHT_STDOUT: '{"version":"0.1.0"}' }, 'PROJECT_FIELD_MISSING'],
    [{ PREFLIGHT_STDOUT: '', PREFLIGHT_STDERR: 'unknown command: status', PREFLIGHT_EXIT: '2' }, 'STATUS_FAILED'],
  ]) {
    const result = runPreflight(preflight, target, { ...process.env, ...env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`^${code}:`), result.stderr);
  }
});

test('only exact single-channel no-Git diagnostics trigger independent Git inspection', async t => {
  if (process.platform === 'win32') return t.skip('POSIX fake-Git sentinel unavailable');
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const { sentinel, env } = await sentinelGit(root);
  for (const [stdout, stderr] of [
    ['', 'not a AKE project: no .git repository found'],
    [JSON.stringify({ ok: false, error: 'NOT_GIT_WORKTREE: not a AKE project: no .git repository found', errors: 1, warnings: 0 }), ''],
  ]) {
    const result = runPreflight(preflight, target, { ...env, PREFLIGHT_STDOUT: stdout, PREFLIGHT_STDERR: stderr, PREFLIGHT_EXIT: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^NOT_GIT_WORKTREE:/);
    assert.match(result.stderr, /independent Git inspection confirmed no repository/);
    assert.ok((await readFile(sentinel, 'utf8')).length > 0);
    await rm(sentinel, { force: true });
  }
});

test('arbitrary no-Git tokens and mixed output channels do not launch the Git inspector', async t => {
  if (process.platform === 'win32') return t.skip('POSIX fake-Git sentinel unavailable');
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const { sentinel, env } = await sentinelGit(root);
  const current = 'NOT_GIT_WORKTREE: not a AKE project: no .git repository found';
  const cases = [
    [`permission denied; ${current}`, ''],
    [current, 'permission denied while reading status'],
    ['', 'not a AKE project: no .git repository found\nextra output'],
  ];
  for (const [stdout, stderr] of cases) {
    await rm(sentinel, { force: true });
    const result = runPreflight(preflight, target, { ...env, PREFLIGHT_STDOUT: stdout, PREFLIGHT_STDERR: stderr, PREFLIGHT_EXIT: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^STATUS_FAILED:/);
    assert.doesNotMatch(result.stderr, /^NOT_GIT_WORKTREE:/);
    await assert.rejects(access(sentinel), { code: 'ENOENT' });
  }
});

test('signal and unexpected status exit codes stop before any Git inspection', async t => {
  if (process.platform === 'win32') return t.skip('POSIX signals and fake-Git sentinel unavailable');
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const { sentinel, env } = await sentinelGit(root);
  const cases = [
    [{ PREFLIGHT_STDERR: 'not a AKE project: no .git repository found', PREFLIGHT_EXIT: '2' }, /exit code 2/],
    [{ PREFLIGHT_STDERR: 'not a AKE project: no .git repository found', PREFLIGHT_EXIT: undefined, PREFLIGHT_SIGNAL: 'SIGTERM' }, /signal SIGTERM/],
  ];
  for (const [vars, expected] of cases) {
    await rm(sentinel, { force: true });
    const result = runPreflight(preflight, target, { ...env, PREFLIGHT_STDOUT: '', ...vars });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^STATUS_FAILED:/);
    assert.match(result.stderr, expected);
    await assert.rejects(access(sentinel), { code: 'ENOENT' });
  }
});

test('no-Git status cannot hide missing Git or damaged metadata', async t => {
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const emptyPath = path.join(root, 'empty PATH');
  await mkdir(emptyPath);
  const unavailable = runPreflight(preflight, target, noGitStatusEnv({ PATH: emptyPath }));
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /^GIT_UNAVAILABLE:/);
  assert.doesNotMatch(unavailable.stderr, /^NOT_GIT_WORKTREE:/);

  await mkdir(path.join(target, '.git'));
  await writeFile(path.join(target, '.git/partial'), 'preserve');
  const damaged = runPreflight(preflight, target, noGitStatusEnv());
  assert.equal(damaged.status, 1);
  assert.match(damaged.stderr, /^GIT_METADATA_INVALID:/);
  assert.doesNotMatch(damaged.stderr, /^NOT_GIT_WORKTREE:/);
  assert.equal(await readFile(path.join(target, '.git/partial'), 'utf8'), 'preserve');
});

test('no-Git status fails closed when the trusted inspector is missing or unreadable', async t => {
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) return t.skip('permission/exec denial cannot be reliably modeled here');
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const helper = path.join(installedSkill, 'init-git.mjs');
  const helperBytes = await readFile(helper);
  await chmod(helper, 0);
  try {
    const unreadable = runPreflight(preflight, target, noGitStatusEnv());
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stderr, /^GIT_INSPECT_FAILED:/);
    assert.doesNotMatch(unreadable.stderr, /^NOT_GIT_WORKTREE:/);
  } finally {
    await chmod(helper, 0o600);
    await writeFile(helper, helperBytes);
  }
  await rm(helper);
  const missing = runPreflight(preflight, target, noGitStatusEnv());
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^GIT_INSPECT_HELPER_UNAVAILABLE:/);
  assert.doesNotMatch(missing.stderr, /^NOT_GIT_WORKTREE:/);
});

test('no-Git status with unreadable Git metadata remains fail-closed', async t => {
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) return t.skip('chmod mode bits do not reliably deny Git metadata access here');
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await installStatusStub(installedSkill);
  const gitMarker = path.join(target, '.git');
  await mkdir(gitMarker);
  await chmod(gitMarker, 0);
  let result;
  try { result = runPreflight(preflight, target, noGitStatusEnv()); }
  finally { await chmod(gitMarker, 0o700); }
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /^NOT_GIT_WORKTREE:/);
  assert.match(result.stderr, /GIT_METADATA_INVALID|GIT_METADATA_UNAVAILABLE|GIT_PROBE_FAILED|GIT_INSPECT_FAILED/);
});

test('preflight corroborates no-Git status against an existing worktree before stopping', async t => {
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  gitInit(target);
  await installStatusStub(installedSkill);
  const result = runPreflight(preflight, target, noGitStatusEnv());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^STATUS_FAILED:/);
  assert.match(result.stderr, /independent Git inspection found a valid already-worktree/);
  await access(path.join(target, '.ake/config.json'));
});

test('preflight failure with missing shared Skill resource stops before project CLI dispatch', async t => {
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await writeFile(path.join(target, '.ake/tools-sentinel'), 'leave untouched');
  await rm(path.join(installedSkill, 'resources/ake-source/src/lib/runtime.mjs'));
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^SHARED_CLI_UNAVAILABLE:/);
  assert.equal(await readFile(path.join(target, '.ake/tools-sentinel'), 'utf8'), 'leave untouched');
});

test('Skill preflight canonicalizes an alias of a real config-only project', async t => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root);
  gitInit(target);
  const alias = path.join(root, 'target alias');
  try { await symlink(target, alias, 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`directory symlink unavailable: ${error.code}`);
    throw error;
  }
  const result = runPreflight(preflight, alias);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`PROJECT_OK: existing CLI status --json resolved to the requested project ${await realpath(target)}`));
});

test('Skill preflight refuses damaged Git metadata and missing project config', async t => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root);
  await mkdir(path.join(target, '.git'), { recursive: true });
  await writeFile(path.join(target, '.git/partial-marker'), 'preserve');
  const damaged = runPreflight(preflight, target);
  assert.equal(damaged.status, 1);
  assert.match(damaged.stderr, /^GIT_METADATA_INVALID:/);
  assert.doesNotMatch(damaged.stderr, /^NOT_GIT_WORKTREE:/);
  assert.equal(await readFile(path.join(target, '.git/partial-marker'), 'utf8'), 'preserve');

  const missing = path.join(root, 'uninitialized');
  await mkdir(missing);
  const result = runPreflight(preflight, missing);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^NOT_INITIALIZED:/);
  assert.match(result.stderr, /bootstrap preview/);
});

test('bundle generation consistency check passes against the committed Skill payload', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/sync-skill-bundle.mjs'), '--check'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skill bundle is synchronized/);
});

// Skills CLI installation itself is not run here: this verifies only execution of a filesystem copy of skills/ake.
