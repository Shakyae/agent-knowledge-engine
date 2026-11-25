import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, cp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv, tempRoot } from '../helpers/test-env.mjs';
import { samePath } from '../../skills/ake/init-git.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillSource = path.join(repoRoot, 'skills', 'ake');

async function fixture(t) {
  const root = await realpath(await tempRoot('ake-git-init-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = path.join(root, 'installed-skills', 'ake');
  await mkdir(path.dirname(skill), { recursive: true });
  await cp(skillSource, skill, { recursive: true });
  return {
    root,
    target: path.join(root, 'target'),
    helper: path.join(skill, 'init-git.mjs'),
    bootstrap: path.join(skill, 'bootstrap.mjs'),
  };
}

function runNode(script, args, cwd, env = cleanTestEnv()) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
}

function runHelper(helper, target, cwd, args = [], env = cleanTestEnv()) {
  return runNode(helper, ['--dir', target, ...args], cwd, env);
}

function identityArgs(identity) {
  return ['--expected-identity', `${identity.device}:${identity.inode}:${identity.birthtimeNs}`];
}

function git(args, cwd, env = cleanTestEnv()) {
  return spawnSync('git', args, { cwd, env, encoding: 'utf8' });
}

function gitInit(target, cwd) {
  const result = git(['init', '--quiet', target], cwd);
  assert.equal(result.status, 0, result.stderr);
}

function runCli(target, args, env) {
  return runNode(path.join(target, '.ake/tools/scripts/ake.mjs'), args, target, env);
}

test('Windows path equality does not fold case; separator variants remain normalized', () => {
  assert.equal(samePath(String.raw`C:\Work\Repo`, String.raw`C:/Work/Repo`, 'win32'), true);
  assert.equal(samePath(String.raw`C:\Work\Repo`, String.raw`c:\work\repo`, 'win32'), false, 'case-sensitive Windows directories must not be merged');
  assert.equal(samePath('/tmp/Repo', '/tmp/repo', 'linux'), false);
});

test('explicit-selection workflow helper initializes exact non-repo and full AKE flow works unborn', async t => {
  const { root, target, helper, bootstrap } = await fixture(t);
  await mkdir(target);

  const inspect = runHelper(helper, target, root, ['--inspect']);
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspected = JSON.parse(inspect.stdout);
  assert.equal(inspected.status, 'non-repository');
  assert.equal(inspected.target, target);
  assert.deepEqual(await readdir(target), [], '--inspect must be read-only');

  // Test harness only: this models the helper path after selection, not an actual host prompt or human consent.
  // The helper itself accepts no authorization flag and never treats arguments as consent.
  const pollutedEnv = { ...cleanTestEnv(), GIT_DIR: path.join(root, 'wrong.git'), GIT_WORK_TREE: root, GIT_INDEX_FILE: path.join(root, 'wrong.index') };
  const initialized = runHelper(helper, inspected.target, root, identityArgs(inspected.identity), pollutedEnv);
  assert.equal(initialized.status, 0, initialized.stderr);
  const result = JSON.parse(initialized.stdout);
  assert.deepEqual(result, { status: 'initialized', target, workTreeRoot: target, identity: inspected.identity, unborn: true, gitInitRan: true });
  assert.equal(git(['rev-parse', '--show-toplevel'], target).stdout.trim(), target);
  const beforeCommit = git(['rev-parse', '--verify', 'HEAD'], target);
  assert.notEqual(beforeCommit.status, 0, 'git init must leave HEAD unborn');

  const dryRun = runNode(bootstrap, ['--dir', target, '--dry-run'], root);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).conflicts.length, 0);
  assert.deepEqual((await readdir(target)).sort(), ['.git']);

  const applied = runNode(bootstrap, ['--dir', target], root);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(await readFile(path.join(target, '.ake/tools/scripts/ake.mjs'), 'utf8'), /candidate new/);
  const env = cleanTestEnv({ HOME: root, DSH_AGENTS_HOME: path.join(root, '.agents') });
  const status = runCli(target, ['status', '--json'], env);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).project, target);
  const search = runCli(target, ['search', 'unborn-flow', '--json'], env);
  assert.equal(search.status, 0, search.stderr);
  assert.equal(JSON.parse(search.stdout).coverage, 'complete');

  const body = `---\nake:\n  type: cookbook\n  id: CB-unborn-flow\n  status: active\n  created: 2026-11-25\n  scope:\n    - "tests/**"\n  evidence:\n    - "tests/integration/skill-git-init.test.mjs"\n---\n# Unborn Git workflow\n\n## When to use\nUse the isolated setup flow.\n\n## Steps\n1. Run the check.\n\n## Verification\nConfirm the result.\n`;
  const bodyPath = path.join(target, 'candidate-body.md');
  await writeFile(bodyPath, body);
  const created = runCli(target, ['candidate', 'new', '--kind', 'cookbook', '--title', 'Unborn Git workflow', '--author', 'author', '--target', 'docs/cookbook/unborn-flow.md', '--body', bodyPath], env);
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const id = created.stdout.match(/C-\d+/)?.[0];
  assert.ok(id, created.stdout);
  for (const args of [
    ['candidate', 'submit', id],
    ['review', id, '--reviewer', 'reviewer', '--verdict', 'approve', '--notes', 'Reviewed the bound content and target.'],
    ['approve', id, '--by', 'human', '--confirm'],
    ['publish', id],
  ]) {
    const step = runCli(target, args, env);
    assert.equal(step.status, 0, step.stderr + step.stdout);
  }
  assert.match(await readFile(path.join(target, 'docs/cookbook/unborn-flow.md'), 'utf8'), /Unborn Git workflow/);
  assert.ok((await readFile(path.join(target, '.ake/publish-log.jsonl'), 'utf8')).includes(id));
  assert.notEqual(git(['rev-parse', '--verify', 'HEAD'], target).status, 0, 'AKE writes must not create a first commit');
});

// Static prompt-contract assertions only; this does not invoke a host prompt or simulate real human consent.
test('static Skill contract specifies Lead-mediated exact-target text fallback', async () => {
  const skill = await readFile(path.join(skillSource, 'SKILL.md'), 'utf8');
  const architecture = await readFile(path.join(repoRoot, 'docs/architecture.md'), 'utf8');
  const cookbook = await readFile(path.join(repoRoot, 'docs/cookbook/installing-knowledge-ops.md'), 'utf8');
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
  for (const phrase of [
    '只有 Lead 可以向用户发起询问',
    '子 Agent 不得调用用户交互工具、自行询问用户或执行 `init-git.mjs`',
    'Lead 才必须在普通文本消息中展示同一 canonical 路径及选项',
    'Lead 必须由自己直接调用该 helper',
    'Lead 必须自行重新 inspect 当前 canonical 目标并使用新取得的 identity',
    '不得将用户答复或 helper 执行转交给子 Agent',
    '原生流程仅用户选择对应选项构成授权；文本回退仅针对当前 exact canonical 路径的明确回复 `1` 构成授权',
    '1 — 只在此目标运行 Git init',
    '2 — 暂不初始化',
    '只有对当前展示路径的明确回复 `1` 才授权继续',
    '文本回退中，只有用户针对当前展示路径明确回复 `1` 才构成授权',
    '回复 `2`、拒绝、空/缺失/含糊答复或任何其他答复均不得运行 helper',
    '而不是因宿主/系统策略或权限明确拒绝交互',
    '若用户交互工具被宿主/系统策略或权限明确拒绝，不得改用文本渠道绕过拒绝',
    '子 Agent 不得把未收到的答复视为同意，也不得执行 helper',
  ]) assert.ok(skill.includes(phrase), phrase);
  for (const phrase of [
    '若使用既有项目 CLI 且项目根需要确认，先用本 Skill 的 `preflight.mjs --dir <absolute-target>` 核验一次',
    '在同一真实 cwd/env 直接运行一次 `node .ake/tools/scripts/ake.mjs search <terms> [options] --json`',
    '原始 JSON 的 query、filters、searchedRoots、coverage、coverageReasons、truncated 和 results',
    '精确的 `--type`、`--status` 和 `--limit`',
    '默认不设输出预算；确需 `--budget-bytes N`',
    '只约束 UTF-8 编码的命中 payload，不是完整 stdout/JSON 硬上限',
    '检查 `coverage`、`truncated` 和 `coverageReasons`',
  ]) assert.ok(skill.includes(phrase), phrase);
  assert.match(architecture, /Lead-mediated plain-text options/);
  assert.match(architecture, /only the Lead invokes the helper after the user's explicit target-specific choice/);
  assert.match(architecture, /Only the user's explicit reply `1` to that prompt authorizes the helper/);
  assert.match(architecture, /without transferring consent or execution to a child Agent/);
  assert.match(architecture, /do not prove real DSH native-choice or Lead text-fallback behavior/);
  assert.match(cookbook, /The Lead freshly inspects the target and directly runs the helper/);
  assert.match(readme, /only the Lead asks the user and runs `init-git\.mjs`/);
  assert.match(readme, /the Lead freshly inspects the target and uses that inspection identity/);
  assert.match(readme, /consent and execution are not relayed to a child Agent/);
});

test('directory replacement after inspect is refused before any Git command', async t => {
  const { root, target, helper } = await fixture(t);
  const emptyPath = path.join(root, 'empty-path'), displaced = path.join(root, 'original-directory');
  await mkdir(target);
  await mkdir(emptyPath);
  const inspect = runHelper(helper, target, root, ['--inspect']);
  assert.equal(inspect.status, 0, inspect.stderr);
  const identity = JSON.parse(inspect.stdout).identity;
  await rename(target, displaced);
  await mkdir(target);
  const result = runHelper(helper, target, root, identityArgs(identity), cleanTestEnv({ PATH: emptyPath }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TARGET_IDENTITY_CHANGED/);
  assert.doesNotMatch(result.stderr, /GIT_UNAVAILABLE/);
  await assert.rejects(access(path.join(target, '.git')));
  await assert.rejects(access(path.join(displaced, '.git')));
});

test('read-only inspect returns a canonical path and init rejects the symlink alias', async t => {
  if (process.platform === 'win32') return t.skip('directory symlink privilege varies on Windows');
  const { root, target, helper } = await fixture(t);
  const alias = path.join(root, 'target-alias');
  await mkdir(target);
  await symlink(target, alias, 'dir');
  const inspect = runHelper(helper, alias, root, ['--inspect']);
  assert.equal(inspect.status, 0, inspect.stderr);
  const state = JSON.parse(inspect.stdout);
  assert.equal(state.status, 'non-repository');
  assert.equal(state.target, target);
  const direct = runHelper(helper, alias, root, identityArgs(state.identity));
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /NON_CANONICAL_TARGET/);
  assert.deepEqual(await readdir(target), []);
});

test('bootstrap conflict after Git initialization prevents every AKE apply write', async t => {
  const { root, target, helper, bootstrap } = await fixture(t);
  await mkdir(target);
  const inspected = JSON.parse(runHelper(helper, target, root, ['--inspect']).stdout);
  const initialized = runHelper(helper, target, root, identityArgs(inspected.identity));
  assert.equal(initialized.status, 0, initialized.stderr);
  const conflict = path.join(target, 'docs/cookbook/README.md');
  await mkdir(path.dirname(conflict), { recursive: true });
  await writeFile(conflict, 'keep user content\\n');
  const preview = runNode(bootstrap, ['--dir', target, '--dry-run'], root);
  assert.equal(preview.status, 1);
  assert.ok(JSON.parse(preview.stdout).conflicts.some(item => item.path === 'docs/cookbook/README.md'));
  const apply = runNode(bootstrap, ['--dir', target], root);
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /resolve every reported init conflict/);
  assert.equal(await readFile(conflict, 'utf8'), 'keep user content\\n');
  await assert.rejects(readFile(path.join(target, '.ake/config.json')), { code: 'ENOENT' });
  assert.notEqual(git(['rev-parse', '--verify', 'HEAD'], target).status, 0);
});

test('exact, parent, and linked worktrees are reused without nested git init', async t => {
  const { root, target, helper, bootstrap } = await fixture(t);
  await mkdir(target);
  gitInit(target, root);
  const exactInspect = runHelper(helper, target, root, ['--inspect']);
  assert.equal(exactInspect.status, 0, exactInspect.stderr);
  const exactIdentity = JSON.parse(exactInspect.stdout).identity;
  const exact = runHelper(helper, target, root, identityArgs(exactIdentity));
  assert.equal(exact.status, 0, exact.stderr);
  assert.deepEqual(JSON.parse(exact.stdout), { status: 'already-worktree', target, workTreeRoot: target, identity: exactIdentity, gitInitRan: false });
  assert.notEqual(git(['rev-parse', '--verify', 'HEAD'], target).status, 0, 'an existing unborn branch is valid');

  const linkedParent = path.join(root, 'linked-parent'), linked = path.join(root, 'linked-worktree');
  await mkdir(linkedParent);
  gitInit(linkedParent, root);
  const commit = git(['-c', 'user.name=AKE Test', '-c', 'user.email=ake@example.invalid', 'commit', '--allow-empty', '-m', 'seed'], linkedParent);
  assert.equal(commit.status, 0, commit.stderr);
  const linkedAdd = git(['worktree', 'add', '--quiet', '--detach', linked, 'HEAD'], linkedParent);
  assert.equal(linkedAdd.status, 0, linkedAdd.stderr);
  const linkedInspect = runHelper(helper, linked, root, ['--inspect']);
  assert.equal(linkedInspect.status, 0, linkedInspect.stderr);
  const linkedIdentity = JSON.parse(linkedInspect.stdout).identity;
  const linkedResult = runHelper(helper, linked, root, identityArgs(linkedIdentity));
  assert.equal(linkedResult.status, 0, linkedResult.stderr);
  assert.deepEqual(JSON.parse(linkedResult.stdout), { status: 'already-worktree', target: linked, workTreeRoot: linked, identity: linkedIdentity, gitInitRan: false });

  const parent = path.join(root, 'parent');
  const subproject = path.join(parent, 'subproject');
  await mkdir(subproject, { recursive: true });
  gitInit(parent, root);
  const parentInspect = runHelper(helper, subproject, root, ['--inspect']);
  assert.equal(parentInspect.status, 0, parentInspect.stderr);
  const parentIdentity = JSON.parse(parentInspect.stdout).identity;
  const child = runHelper(helper, subproject, root, identityArgs(parentIdentity));
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { status: 'already-parent-worktree', target: subproject, workTreeRoot: parent, identity: parentIdentity, gitInitRan: false });
  await assert.rejects(readFile(path.join(subproject, '.git')), { code: 'ENOENT' });
  const dryRun = runNode(bootstrap, ['--dir', subproject, '--dry-run'], root);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).conflicts.length, 0);
  assert.notEqual(git(['rev-parse', '--verify', 'HEAD'], parent).status, 0);
});

test('bare, damaged metadata, and missing Git fail closed without cleanup', async t => {
  const { root, helper } = await fixture(t);
  const bare = path.join(root, 'bare.git');
  const initBare = git(['init', '--bare', '--quiet', bare], root);
  assert.equal(initBare.status, 0, initBare.stderr);
  const bareBefore = (await readdir(bare)).sort();
  const bareResult = runHelper(helper, bare, root, ['--inspect']);
  assert.equal(bareResult.status, 1);
  assert.match(bareResult.stderr, /BARE_REPOSITORY/);
  assert.deepEqual((await readdir(bare)).sort(), bareBefore);

  const damaged = path.join(root, 'damaged');
  await mkdir(path.join(damaged, '.git'), { recursive: true });
  await writeFile(path.join(damaged, '.git', 'partial-marker'), 'preserve');
  const damagedBefore = (await readdir(path.join(damaged, '.git'))).sort();
  const damagedResult = runHelper(helper, damaged, root, ['--inspect']);
  assert.equal(damagedResult.status, 1);
  assert.match(damagedResult.stderr, /GIT_METADATA_INVALID/);
  assert.deepEqual((await readdir(path.join(damaged, '.git'))).sort(), damagedBefore);

  const noGitPath = path.join(root, 'empty-path');
  await mkdir(noGitPath);
  const noGitTarget = path.join(root, 'no-git');
  await mkdir(noGitTarget);
  const missingGit = runHelper(helper, noGitTarget, root, ['--inspect'], cleanTestEnv({ PATH: noGitPath }));
  assert.equal(missingGit.status, 1);
  assert.match(missingGit.stderr, /GIT_UNAVAILABLE/);
  assert.deepEqual(await readdir(noGitTarget), []);
});

test('unknown Git-init failure preserves partial metadata and is never retried (POSIX stub)', async t => {
  if (process.platform === 'win32') return t.skip('POSIX executable stub is unavailable');
  const { root, target, helper } = await fixture(t);
  const bin = path.join(root, 'fake-git-bin'), countFile = path.join(root, 'git-init-count');
  await mkdir(bin);
  await mkdir(target);
  const fakeGit = path.join(bin, 'git');
  await writeFile(fakeGit, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "git version test"; exit 0; fi
if [ "$1" = "-C" ]; then
  target="$2"; shift 2
  if [ "$1" = "rev-parse" ]; then echo "fatal: not a git repository" >&2; exit 128; fi
  if [ "$1" = "init" ]; then printf x >> "$FAKE_GIT_COUNT"; "$FAKE_NODE" -e 'const fs=require("fs"),p=require("path"),d=p.join(process.argv[1],".git");fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,"partial"),"partial")' "$target"; exit 9; fi
fi
exit 41
`);
  await chmod(fakeGit, 0o755);
  const env = cleanTestEnv({ PATH: bin, FAKE_GIT_COUNT: countFile, FAKE_NODE: process.execPath });
  const inspect = runHelper(helper, target, root, ['--inspect'], env);
  assert.equal(inspect.status, 0, inspect.stderr);
  const identity = JSON.parse(inspect.stdout).identity;
  const result = runHelper(helper, target, root, identityArgs(identity), env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GIT_INIT_RESULT_UNKNOWN/);
  assert.equal(await readFile(countFile, 'utf8'), 'x', 'the failed git init must not be retried');
  assert.equal(await readFile(path.join(target, '.git/partial'), 'utf8'), 'partial', 'partial metadata must be preserved');
  assert.equal(await access(path.join(target, '.ake')).then(() => true, () => false), false);
});

test('reported reinitialization is a stop signal, never a success proof', async t => {
  if (process.platform === 'win32') return t.skip('POSIX executable stub is unavailable');
  const { root, target, helper } = await fixture(t);
  const bin = path.join(root, 'fake-git-bin'), countFile = path.join(root, 'git-init-count');
  await mkdir(bin);
  await mkdir(target);
  const fakeGit = path.join(bin, 'git');
  await writeFile(fakeGit, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "git version test"; exit 0; fi
if [ "$1" = "-C" ]; then
  target="$2"; shift 2
  if [ "$1" = "rev-parse" ]; then echo "fatal: not a git repository" >&2; exit 128; fi
  if [ "$1" = "init" ]; then printf x >> "$FAKE_GIT_COUNT"; "$FAKE_NODE" -e 'const fs=require("fs"),p=require("path"),d=p.join(process.argv[1],".git");fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,"race"),"preserve")' "$target"; echo "Reinitialized existing Git repository in $target/.git/" >&2; exit 0; fi
fi
exit 41
`);
  await chmod(fakeGit, 0o755);
  const env = cleanTestEnv({ PATH: bin, FAKE_GIT_COUNT: countFile, FAKE_NODE: process.execPath });
  const inspect = runHelper(helper, target, root, ['--inspect'], env);
  assert.equal(inspect.status, 0, inspect.stderr);
  const identity = JSON.parse(inspect.stdout).identity;
  const result = runHelper(helper, target, root, identityArgs(identity), env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GIT_INIT_RESULT_UNKNOWN/);
  assert.equal(await readFile(countFile, 'utf8'), 'x');
  assert.equal(await readFile(path.join(target, '.git/race'), 'utf8'), 'preserve');
  assert.equal(await access(path.join(target, '.ake')).then(() => true, () => false), false);
});

test('Git-init permission failure stops without applying AKE or retrying', async t => {
  if (process.platform === 'win32') return t.skip('chmod mode bits do not model Windows ACL denial');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root can write mode-0555 directories; permission failure unavailable');
  const { root, target, helper } = await fixture(t);
  await mkdir(target);
  await chmod(target, 0o555);
  let denied = false;
  try { await access(target, constants.W_OK); }
  catch (error) { if (error.code === 'EACCES') denied = true; else throw error; }
  if (!denied) {
    await chmod(target, 0o755);
    return t.skip('current filesystem/ACL permits writes after chmod 0555');
  }
  const inspect = runHelper(helper, target, root, ['--inspect']);
  assert.equal(inspect.status, 0, inspect.stderr);
  const identity = JSON.parse(inspect.stdout).identity;
  let result;
  try { result = runHelper(helper, target, root, identityArgs(identity)); }
  finally { await chmod(target, 0o755); }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GIT_INIT_RESULT_UNKNOWN/);
  assert.match(result.stderr, /do not retry automatically/i);
  assert.equal(await access(path.join(target, '.ake')).then(() => true, () => false), false, 'AKE apply must not follow failed Git init');
});

// These tests use isolated temporary directories only; helper calls simulate the Skill invoking it after native selection.
