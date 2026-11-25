import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv, tempRoot } from '../helpers/test-env.mjs';
import { nodeVersionFailure } from '../../src/lib/runtime.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const cli = path.join(root, 'scripts', 'ake.mjs');
const skill = path.join(root, 'skills', 'ake');
const supported = nodeVersionFailure() === null;
if (process.env.AKE_EXPECT_RUNTIME_SUPPORTED !== undefined) {
  assert.equal(supported, process.env.AKE_EXPECT_RUNTIME_SUPPORTED === 'true', `unexpected gate decision for real Node.js ${process.versions.node}`);
}

function run(entry, args, env = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: cleanTestEnv(env),
  });
}

function assertVersionFailure(result) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Unsupported Node\.js version/);
  assert.match(result.stderr, /requires Node\.js >=22\.20\.0/);
}

test('CLI and standalone Skill helpers enforce the runtime before task work', async t => {
  const temp = await tempRoot('ake-runtime-gate-');
  t.after(() => rm(temp, { recursive: true, force: true }));

  const cliHelp = run(cli, ['--help']);
  if (supported) {
    assert.equal(cliHelp.status, 0, cliHelp.stderr);
    assert.match(cliHelp.stdout, /ake init/);
  } else assertVersionFailure(cliHelp);

  const bundledCli = path.join(skill, 'resources', 'ake-source', 'scripts', 'ake.mjs');
  const bundledHelp = run(bundledCli, ['--help']);
  if (supported) assert.equal(bundledHelp.status, 0, bundledHelp.stderr);
  else assertVersionFailure(bundledHelp);

  const target = path.join(temp, 'project-with-copied-cli');
  const tools = path.join(target, '.ake', 'tools');
  const copiedCli = path.join(tools, 'scripts', 'ake.mjs');
  await mkdir(path.dirname(copiedCli), { recursive: true });
  await cp(cli, copiedCli);
  await cp(path.join(root, 'src', 'lib'), path.join(tools, 'src', 'lib'), { recursive: true });
  const appPackage = path.join(target, 'package.json');
  await writeFile(appPackage, '{"name":"unrelated-app","engines":{"node":">=18"}}\n');
  const packageBefore = await readFile(appPackage);
  const copiedHelp = run(copiedCli, ['--help']);
  if (supported) assert.equal(copiedHelp.status, 0, copiedHelp.stderr);
  else assertVersionFailure(copiedHelp);
  assert.deepEqual(await readFile(appPackage), packageBefore);

  const skillCopy = path.join(temp, 'skill-with-missing-runtime');
  await cp(skill, skillCopy, { recursive: true });
  const missingRuntime = path.join(skillCopy, 'resources', 'ake-source', 'src', 'lib', 'runtime.mjs');
  await rm(missingRuntime);

  const project = path.join(temp, 'existing-project');
  const config = path.join(project, '.ake');
  const projectCli = path.join(config, 'tools', 'scripts', 'ake.mjs');
  const marker = path.join(temp, 'project-cli-ran');
  await mkdir(path.dirname(projectCli), { recursive: true });
  await writeFile(path.join(config, 'config.json'), '{"version":"0.1.0"}\n');
  await writeFile(projectCli, "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.AKE_RUNTIME_MARKER, 'ran'); console.log(JSON.stringify({project:process.env.AKE_RUNTIME_PROJECT}));\n");
  const preflight = run(path.join(skillCopy, 'preflight.mjs'), ['--dir', project], {
    AKE_RUNTIME_MARKER: marker,
    AKE_RUNTIME_PROJECT: project,
  });
  if (supported) {
    assert.equal(preflight.status, 0, preflight.stderr);
    assert.match(preflight.stdout, /PROJECT_OK/);
    assert.equal(await readFile(marker, 'utf8'), 'ran');
  } else {
    assertVersionFailure(preflight);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  }

  const empty = path.join(temp, 'empty-target');
  await mkdir(empty);
  const initGit = run(await realpath(path.join(skillCopy, 'init-git.mjs')), ['--dir', empty, '--inspect']);
  if (supported) {
    assert.equal(initGit.status, 0, initGit.stderr);
    assert.equal(JSON.parse(initGit.stdout).status, 'non-repository');
  } else assertVersionFailure(initGit);
  await assert.rejects(access(path.join(empty, '.git')), { code: 'ENOENT' });

  const bootstrapTarget = path.join(temp, 'bootstrap-target');
  await mkdir(bootstrapTarget);
  const gitInit = spawnSync('git', ['init', '--quiet', bootstrapTarget], { encoding: 'utf8', env: cleanTestEnv() });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const bootstrap = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', bootstrapTarget, '--dry-run']);
  if (supported) {
    assert.equal(bootstrap.status, 1);
    assert.match(bootstrap.stderr, /Skill bootstrap resources are incomplete/);
    assert.ok(bootstrap.stderr.includes(missingRuntime), bootstrap.stderr);
    assert.match(bootstrap.stderr, /Restore\/update the ake Skill/);
  } else assertVersionFailure(bootstrap);
  await assert.rejects(access(path.join(bootstrapTarget, '.ake')), { code: 'ENOENT' });
});

test('unsupported runtime keeps CLI JSON failure contracts and avoids update work', () => {
  if (supported) return;

  const status = run(cli, ['status', '--json']);
  assert.equal(status.status, 1, status.stderr);
  const statusResult = JSON.parse(status.stdout);
  assert.match(statusResult.error, /NODE_VERSION:.*>=22\.20\.0/);
  assert.deepEqual(statusResult, { ok: false, error: statusResult.error, errors: 1, warnings: 0 });

  const sync = run(path.join(root, 'scripts', 'sync-skill-bundle.mjs'), ['--check']);
  assertVersionFailure(sync);
  const benchmark = run(path.join(root, 'scripts', 'benchmark-search.mjs'), []);
  assertVersionFailure(benchmark);

  const update = run(cli, ['update', '--json']);
  assert.equal(update.status, 1, update.stderr);
  const result = JSON.parse(update.stdout);
  assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'preflight');
  assert.equal(result.errorCode, 'NODE_VERSION');
  assert.match(result.message, /Unsupported Node\.js version.*>=22\.20\.0/);
  assert.equal(result.rollback, 'not_needed');
  assert.equal(result.targetCommit, null);
});
