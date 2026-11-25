import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
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

  const copiedCli = path.join(target, '.ake/tools/scripts/ake.mjs');
  const status = spawnSync(process.execPath, [copiedCli, 'status', '--json'], { cwd: work, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).project, target);
  await writeFile(path.join(target, 'docs/cookbook/child-sentinel.md'), '# Child sentinel one\n\nchild-only-needle\n');
  await writeFile(path.join(target, 'docs/cookbook/child-sentinel-2.md'), '# Child sentinel two\n\nchild-only-needle\n');
  const taskEnv = { ...process.env, AKE_PREFLIGHT_CONTEXT: 'unchanged-context' };
  const preflightStatus = runPreflight(preflight, target, taskEnv);
  assert.equal(preflightStatus.status, 0, preflightStatus.stderr);
  assert.match(preflightStatus.stdout, /PROJECT_OK/);
  assert.doesNotMatch(preflightStatus.stdout, /installation version/);
  const childSearch = runProjectCli(target, ['search', 'child-only-needle', '--limit', '1', '--type', 'cookbook', '--include-candidates', '--json'], taskEnv);
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
  assert.equal(notDirectoryResult.status, 1);
  assert.match(notDirectoryResult.stderr, /^EXISTING_PATH_INVALID:/);
  assert.equal(await readFile(path.join(blockedAncestor, '.ake/tools'), 'utf8'), 'not a directory');
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

test('bootstrap refuses a partial existing project without initializing over it', async (t) => {
  const { root, bootstrap } = await fixture(t);
  const target = path.join(root, 'partial project');
  await mkdir(path.join(target, '.ake'), { recursive: true });
  await writeFile(path.join(target, '.ake/config.json'), '{"version":"0.1.0"}\n');
  gitInit(target);
  const before = await readFile(path.join(target, '.ake/config.json'));
  const result = run(bootstrap, target, root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^PARTIAL_INITIALIZATION:/);
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

async function preflightProject(root, source) {
  const target = path.join(root, 'preflight project');
  const cli = path.join(target, '.ake/tools/scripts/ake.mjs');
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(path.join(target, '.ake/config.json'), '{}\n');
  await writeFile(cli, source);
  return target;
}

function runPreflight(preflight, target, env = process.env) {
  return spawnSync(process.execPath, [preflight, '--dir', target], { cwd: os.tmpdir(), env, encoding: 'utf8' });
}

async function sentinelGit(root) {
  const bin = path.join(root, 'sentinel-git-bin');
  const sentinel = path.join(root, 'git-inspector-called');
  await mkdir(bin);
  const fakeGit = path.join(bin, 'git');
  await writeFile(fakeGit, `#!/bin/sh\nprintf x >> "$SENTINEL_FILE"\nif [ "$1" = "--version" ]; then echo "git version sentinel"; exit 0; fi\nif [ "$1" = "-C" ]; then shift 2; if [ "$1" = "rev-parse" ]; then echo "fatal: not a git repository" >&2; exit 128; fi; fi\nexit 91\n`);
  await chmod(fakeGit, 0o755);
  return { sentinel, env: { ...process.env, PATH: bin, SENTINEL_FILE: sentinel } };
}

function runProjectCli(target, args, env = process.env) {
  return spawnSync(process.execPath, [path.join(target, '.ake/tools/scripts/ake.mjs'), ...args], { cwd: target, env, encoding: 'utf8' });
}

test('Skill preflight checks status once in the canonical target cwd and inherited environment', async (t) => {
  const { root, preflight } = await fixture(t);
  const log = path.join(root, 'invocation.json');
  const source = `const {writeFile,mkdir}=await import('node:fs/promises'); await mkdir('nested'); await writeFile(process.env.PREFLIGHT_LOG, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),context:process.env.PREFLIGHT_CONTEXT})); console.log(JSON.stringify({project:process.cwd()+'/nested/..'}));`;
  const target = await preflightProject(root, source);
  const env = { ...process.env, PREFLIGHT_LOG: log, PREFLIGHT_CONTEXT: 'same-context' };
  const result = runPreflight(preflight, target, env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PROJECT_OK/);
  assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), { cwd: await realpath(target), args: ['status', '--json'], context: 'same-context' });
});

test('Skill preflight rejects an existing CLI that reports a parent project', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.log(JSON.stringify({project:${JSON.stringify(root)}}));\n`);
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^PROJECT_MISMATCH:/);
  assert.match(result.stderr, /stop before any write/);
});

test('Skill preflight rejects a relative project value', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.log(JSON.stringify({project:'.'}));`);
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^PROJECT_PATH_RELATIVE:/);
});

test('Skill preflight rejects an unresolvable absolute project path', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.log(JSON.stringify({project:${JSON.stringify(path.join(root, 'missing project'))}}));`);
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^PROJECT_PATH_UNRESOLVABLE:/);
});

test('Skill preflight accepts legacy help differences; the actual unsupported task reports its error', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `if(process.argv[2]==='status') console.log(JSON.stringify({project:process.cwd()})); else if(process.argv[2]==='--help') console.log('Legacy AKE commands: status, init, validate'); else { console.error('unknown command: search'); process.exitCode=2; }`);
  const preflightResult = runPreflight(preflight, target);
  assert.equal(preflightResult.status, 0, preflightResult.stderr);
  const help = runProjectCli(target, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Legacy AKE commands/);
  const actualTask = runProjectCli(target, ['search', 'query', '--json']);
  assert.equal(actualTask.status, 2);
  assert.match(actualTask.stderr, /unknown command: search/);
});

test('Skill preflight canonicalizes a real symlink target', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.log(JSON.stringify({project:process.cwd()}));`);
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

test('Skill preflight rejects a sibling path sharing the target prefix', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, '');
  const sibling = `${target}-other`;
  await mkdir(sibling);
  await writeFile(path.join(target, '.ake/tools/scripts/ake.mjs'), `console.log(JSON.stringify({project:${JSON.stringify(sibling)}}));\n`);
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^PROJECT_MISMATCH:/);
});

test('Skill preflight classifies unsupported status, malformed JSON, and missing project identity', async (t) => {
  const { root, preflight } = await fixture(t);
  const cases = [
    [`console.error('unknown command: status'); process.exitCode=2;\n`, 'STATUS_FAILED'],
    [`console.log('{not-json');\n`, 'STATUS_INVALID_JSON'],
    [`console.log(JSON.stringify({version:'0.1.0'}));\n`, 'PROJECT_FIELD_MISSING'],
  ];
  for (const [source, code] of cases) {
    const target = await preflightProject(root, source);
    const result = runPreflight(preflight, target);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.startsWith(`${code}:`), result.stderr);
  }
});

test('legacy CLI no-Git diagnostic requires independent trusted Git confirmation', async t => {
  const { root, preflight } = await fixture(t);
  const legacyCli = `const {spawnSync}=await import('node:child_process');const r=spawnSync('git',['-C',process.cwd(),'rev-parse','--is-inside-work-tree'],{encoding:'utf8'});if(r.error||r.status!==0||r.stdout.trim()!=='true'){console.error('not a AKE project: no .git repository found');process.exitCode=1}else console.log(JSON.stringify({project:process.cwd()}));`;
  const target = await preflightProject(root, legacyCli);
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^NOT_GIT_WORKTREE:/);
  assert.match(result.stderr, /independent Git inspection confirmed no repository/);
});

test('current and legacy structured no-Git diagnostics recover only after independent inspect', async t => {
  const { root, preflight } = await fixture(t);
  const messages = [
    'NOT_GIT_WORKTREE: not a AKE project: no .git repository found',
    'not a AKE project: no .git repository found',
  ];
  for (const message of messages) {
    const source = `console.log(JSON.stringify({ok:false,error:${JSON.stringify(message)},errors:1,warnings:0}));process.exitCode=1;`;
    const target = await preflightProject(root, source);
    const result = runPreflight(preflight, target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^NOT_GIT_WORKTREE:/);
    assert.match(result.stderr, /independent Git inspection confirmed no repository/);
  }
});

test('arbitrary status error-code token injection never triggers or invokes Git inspection', async t => {
  if (process.platform === 'win32') return t.skip('POSIX fake-Git sentinel unavailable');
  const { root, preflight } = await fixture(t);
  const { sentinel, env } = await sentinelGit(root);
  const source = `console.error('permission denied; NOT_GIT_WORKTREE: not a AKE project: no .git repository found');process.exitCode=1;`;
  const target = await preflightProject(root, source);
  const result = runPreflight(preflight, target, env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^STATUS_FAILED:/);
  assert.match(result.stderr, /independent Git inspection was not run/);
  assert.doesNotMatch(result.stderr, /^NOT_GIT_WORKTREE:/);
  await assert.rejects(access(sentinel), { code: 'ENOENT' }, 'untrusted token must not start the inspector or Git binary');
});

test('mixed stdout/stderr diagnostics fail closed without launching Git inspection', async t => {
  if (process.platform === 'win32') return t.skip('POSIX fake-Git sentinel unavailable');
  const { root, preflight } = await fixture(t);
  const { sentinel, env } = await sentinelGit(root);
  const current = 'NOT_GIT_WORKTREE: not a AKE project: no .git repository found';
  const cases = [
    `console.error('not a AKE project: no .git repository found');console.log('permission denied reading status');process.exitCode=1;`,
    `console.error('permission denied reading status');console.log(JSON.stringify({ok:false,error:${JSON.stringify(current)},errors:1,warnings:0}));process.exitCode=1;`,
  ];
  for (const source of cases) {
    await rm(sentinel, { force: true });
    const target = await preflightProject(root, source);
    const result = runPreflight(preflight, target, env);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^STATUS_FAILED:/);
    assert.match(result.stderr, /independent Git inspection was not run/);
    await assert.rejects(access(sentinel), { code: 'ENOENT' }, 'mixed channels must not invoke the inspector');
  }
});

test('only expected status exit and exact no-Git text may launch the Git inspector', async t => {
  if (process.platform === 'win32') return t.skip('POSIX fake-Git sentinel unavailable');
  const { root, preflight } = await fixture(t);
  const { sentinel, env } = await sentinelGit(root);
  const target = await preflightProject(root, `console.error('not a AKE project: no .git repository found');process.exitCode=1;`);
  const result = runPreflight(preflight, target, env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^NOT_GIT_WORKTREE:/);
  assert.ok((await readFile(sentinel, 'utf8')).length > 0, 'inspector must call the fake Git executable after exact status failure');
});

test('signal and unexpected status exit codes stop before invoking any inspector', async t => {
  if (process.platform === 'win32') return t.skip('POSIX signals and fake-Git sentinel unavailable');
  const { root, preflight } = await fixture(t);
  const { sentinel, env } = await sentinelGit(root);
  const legacy = 'not a AKE project: no .git repository found';
  const cases = [
    [`console.error(${JSON.stringify(legacy)});process.exitCode=2;`, /exit code 2/],
    [`const {writeSync}=await import('node:fs');writeSync(2,${JSON.stringify(`${legacy}\n`)});process.kill(process.pid,'SIGTERM');`, /signal SIGTERM/],
  ];
  for (const [source, expected] of cases) {
    await rm(sentinel, { force: true });
    const target = await preflightProject(root, source);
    const result = runPreflight(preflight, target, env);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^STATUS_FAILED:/);
    assert.match(result.stderr, expected);
    await assert.rejects(access(sentinel), { code: 'ENOENT' }, 'signal/non-1 exit must not launch Git inspection');
  }
});

test('status CLI read denial stops without invoking any inspector', async t => {
  if (process.platform === 'win32') return t.skip('chmod mode bits do not model Windows ACL denial');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can read mode-000 status CLI');
  const { root, preflight } = await fixture(t);
  const { sentinel, env } = await sentinelGit(root);
  const source = `console.error('not a AKE project: no .git repository found');process.exitCode=1;`;
  const target = await preflightProject(root, source);
  const cli = path.join(target, '.ake/tools/scripts/ake.mjs');
  await chmod(cli, 0o000);
  let result;
  try { result = runPreflight(preflight, target, env); }
  finally { await chmod(cli, 0o644); }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^STATUS_FAILED:/);
  assert.doesNotMatch(result.stderr, /^NOT_GIT_WORKTREE:/);
  await assert.rejects(access(sentinel), { code: 'ENOENT' }, 'permission-denied CLI must not launch Git inspection');
});

test('exact legacy no-Git text is vetoed when trusted inspection finds a real worktree', async t => {
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.error('not a AKE project: no .git repository found');process.exitCode=1;`);
  gitInit(target);
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^STATUS_FAILED:/);
  assert.match(result.stderr, /independent Git inspection found a valid already-worktree/i);
});

test('independent Git inspection refuses missing Git and damaged metadata', async t => {
  const { root, preflight } = await fixture(t);
  const legacy = `console.error('not a AKE project: no .git repository found');process.exitCode=1;`;
  const noGitTarget = await preflightProject(root, legacy);
  const emptyPath = path.join(root, 'empty PATH');
  await mkdir(emptyPath);
  const noGit = runPreflight(preflight, noGitTarget, { ...process.env, PATH: emptyPath });
  assert.equal(noGit.status, 1);
  assert.match(noGit.stderr, /^GIT_UNAVAILABLE:/);
  assert.doesNotMatch(noGit.stderr, /^NOT_GIT_WORKTREE:/);

  const damagedTarget = await preflightProject(root, legacy);
  await mkdir(path.join(damagedTarget, '.git'));
  await writeFile(path.join(damagedTarget, '.git', 'partial'), 'keep');
  const damaged = runPreflight(preflight, damagedTarget);
  assert.equal(damaged.status, 1);
  assert.match(damaged.stderr, /^GIT_METADATA_INVALID:/);
  assert.doesNotMatch(damaged.stderr, /^NOT_GIT_WORKTREE:/);
});

test('denied trusted-inspector execution cannot become a no-Git prompt', async t => {
  if (process.platform === 'win32') return t.skip('chmod mode bits do not model Windows ACL denial');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can read mode-000 helper files');
  const { root, installedSkill, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.error('not a AKE project: no .git repository found');process.exitCode=1;`);
  const helper = path.join(installedSkill, 'init-git.mjs');
  await chmod(helper, 0o000);
  let result;
  try { result = runPreflight(preflight, target); }
  finally { await chmod(helper, 0o644); }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^GIT_INSPECT_FAILED:/);
  assert.doesNotMatch(result.stderr, /^NOT_GIT_WORKTREE:/);
});

test('permission denied inspecting Git metadata cannot become a no-Git prompt', async t => {
  if (process.platform === 'win32') return t.skip('chmod mode bits do not model Windows ACL denial');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can inspect mode-000 Git metadata');
  const { root, preflight } = await fixture(t);
  const target = await preflightProject(root, `console.error('not a AKE project: no .git repository found');process.exitCode=1;`);
  const gitMarker = path.join(target, '.git');
  await mkdir(gitMarker);
  await chmod(gitMarker, 0o000);
  let result;
  try { result = runPreflight(preflight, target); }
  finally { await chmod(gitMarker, 0o700); }
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /^NOT_GIT_WORKTREE:/);
  assert.match(result.stderr, /GIT_METADATA_INVALID|GIT_PROBE_FAILED|GIT_INSPECT_FAILED/);
});

test('existing AKE files with deleted Git metadata are classified for recovery', async t => {
  const { root, bootstrap, preflight } = await fixture(t);
  const target = path.join(root, 'existing AKE without git');
  await mkdir(target);
  gitInit(target);
  const initialized = run(bootstrap, target, root);
  assert.equal(initialized.status, 0, initialized.stderr);
  await rm(path.join(target, '.git'), { recursive: true, force: true });
  const result = runPreflight(preflight, target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^NOT_GIT_WORKTREE:/);
  assert.match(result.stderr, /existing AKE files remain untouched/);
  await access(path.join(target, '.ake/config.json'));
  await access(path.join(target, '.ake/tools/scripts/ake.mjs'));
});

test('Skill preflight rejects an uninitialized target before invoking its CLI', async (t) => {
  const { root, preflight } = await fixture(t);
  const target = path.join(root, 'uninitialized');
  await mkdir(target);
  const result = runPreflight(preflight, target);
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
