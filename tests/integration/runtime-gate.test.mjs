import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

function identityPath(value) {
  const info = statSync(value, { bigint: true });
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
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
  const bootstrapChild = path.join(bootstrapTarget, 'nested-project'); await mkdir(bootstrapChild);
  const childBootstrap = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', bootstrapChild, '--dry-run']);
  if (supported) { assert.equal(childBootstrap.status, 1, childBootstrap.stdout); assert.match(childBootstrap.stderr, /Skill bootstrap resources are incomplete/); }
  else assertVersionFailure(childBootstrap);
  await assert.rejects(access(path.join(bootstrapChild, '.ake')), { code: 'ENOENT' });
  const aliasDirectory = path.join(temp, 'bootstrap-skill-alias');
  if (process.platform === 'win32') await symlink(skillCopy, aliasDirectory, 'junction'); else await symlink(skillCopy, aliasDirectory, 'dir');
  const aliasEntry = path.join(aliasDirectory, 'bootstrap.mjs');
  assert.equal(realpathSync.native(aliasEntry), realpathSync.native(path.join(skillCopy, 'bootstrap.mjs')));
  const aliasBootstrap = run(aliasEntry, ['--dir', bootstrapTarget, '--dry-run']);
  if (supported) { assert.equal(aliasBootstrap.status, 1, aliasBootstrap.stdout); assert.match(aliasBootstrap.stderr, /Skill bootstrap resources are incomplete/); }
  else assertVersionFailure(aliasBootstrap);
  await assert.rejects(access(path.join(bootstrapTarget, '.ake')), { code: 'ENOENT' });

  const priorExitCode = process.exitCode, importMessages = [], oldLog = console.log, oldError = console.error;
  console.log = (...args) => importMessages.push(args.join(' ')); console.error = (...args) => importMessages.push(args.join(' '));
  let bootstrapModule;
  try { bootstrapModule = await import('../../skills/ake/bootstrap.mjs'); }
  finally { console.log = oldLog; console.error = oldError; }
  assert.equal(process.exitCode, priorExitCode, 'importing the helper does not run its CLI main');
  assert.deepEqual(importMessages, [], 'importing the helper has no CLI output side effects');
  const { isDirectoryAncestor } = bootstrapModule;
  const canonicalRoot = realpathSync.native(bootstrapTarget), canonicalChild = realpathSync.native(bootstrapChild);
  assert.equal(isDirectoryAncestor(canonicalRoot, canonicalRoot), true, 'identical directory objects are accepted');
  assert.equal(isDirectoryAncestor(canonicalRoot, canonicalChild), true, 'real child directories are accepted');
  assert.equal(isDirectoryAncestor(canonicalRoot, path.join(canonicalRoot, 'missing-child')), false, 'unresolvable paths fail closed');
  const outsideRoot = path.join(temp, 'bootstrap-outside'); await mkdir(outsideRoot);
  const outsideLink = path.join(bootstrapTarget, 'outside-junction');
  if (process.platform === 'win32') await symlink(outsideRoot, outsideLink, 'junction'); else await symlink(outsideRoot, outsideLink, 'dir');
  assert.equal(isDirectoryAncestor(canonicalRoot, realpathSync.native(outsideLink)), false, 'resolved junction targets outside the root are rejected');

  const siblingTarget = path.join(temp, 'bootstrap-target-sibling'); await mkdir(siblingTarget);
  const gitDirectory = path.join(bootstrapTarget, '.git');
  await writeFile(path.join(siblingTarget, '.git'), `gitdir: ${gitDirectory.replaceAll('\\', '/')}\n`);
  const worktreeConfig = spawnSync('git', ['config', '--file', path.join(gitDirectory, 'config'), 'core.worktree', bootstrapTarget], { encoding: 'utf8', env: cleanTestEnv() });
  assert.equal(worktreeConfig.status, 0, worktreeConfig.stderr);
  const siblingGitRoot = spawnSync('git', ['-C', siblingTarget, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: cleanTestEnv() });
  assert.equal(siblingGitRoot.status, 0, siblingGitRoot.stderr);
  assert.equal(identityPath(siblingGitRoot.stdout.trim()), identityPath(bootstrapTarget), 'fixture Git metadata must report the distinct same-prefix sibling root');
  assert.equal(isDirectoryAncestor(canonicalRoot, realpathSync.native(siblingTarget)), false, 'same-prefix siblings are not descendants by directory identity');
  const siblingBootstrap = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', siblingTarget, '--dry-run']);
  if (supported) { assert.equal(siblingBootstrap.status, 1, siblingBootstrap.stdout); assert.match(siblingBootstrap.stderr, /GIT_METADATA_INVALID:/); }
  else assertVersionFailure(siblingBootstrap);
  await assert.rejects(access(path.join(siblingTarget, '.ake')), { code: 'ENOENT' });

  if (process.platform === 'win32' && supported) {
    const identity = value => { const info = statSync(value, { bigint: true }); return `${info.dev}:${info.ino}:${info.birthtimeNs}`; };
    const shortPathScript = path.join(temp, 'print-8dot3-path.cmd');
    await writeFile(shortPathScript, '@echo off\r\nfor %%I in ("%~1") do @echo %%~sI\r\n');
    const shortPathFor = directory => {
      const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', shortPathScript, directory], { cwd: temp, encoding: 'utf8', env: cleanTestEnv() });
      assert.equal(result.status, 0, result.stderr);
      const lines = result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      assert.equal(lines.length, 1, `short-path command must emit exactly one path: ${JSON.stringify({ stdout: result.stdout, stderr: result.stderr })}`);
      const value = lines[0];
      assert.ok(path.win32.isAbsolute(value), `short-path command returned a non-absolute path for ${directory}: ${JSON.stringify(value)}`);
      assert.doesNotMatch(value, /["\r\n]/, `short-path command returned quotes or line breaks: ${JSON.stringify(value)}`);
      assert.equal(identity(value), identity(directory), `short-path output does not identify the requested directory: ${JSON.stringify({ directory, value })}`);
      const requestedComponents = path.win32.normalize(directory).split('\\'), returnedComponents = path.win32.normalize(value).split('\\');
      const hasShortName = returnedComponents.some((component, index) => /~[0-9]+$/i.test(component) && component.toLowerCase() !== requestedComponents[index]?.toLowerCase());
      return { value, hasShortName };
    };
    const injectionSentinel = path.join(temp, 'ake-cmd-injection-sentinel');
    await assert.rejects(access(injectionSentinel), { code: 'ENOENT' });
    const hostileDirectory = path.join(temp, 'space & mkdir ake-cmd-injection-sentinel percent%TEMP% bang! caret^ parentheses(1)'); await mkdir(hostileDirectory);
    shortPathFor(hostileDirectory);
    await assert.rejects(access(injectionSentinel), { code: 'ENOENT' }, 'cmd metacharacters must not create the isolated injection sentinel');
    const gitRootResult = spawnSync('git', ['-C', bootstrapTarget, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: cleanTestEnv() });
    assert.equal(gitRootResult.status, 0, gitRootResult.stderr);
    const gitRoot = gitRootResult.stdout.trim(), shortTargetInfo = shortPathFor(bootstrapTarget), shortTarget = shortTargetInfo.value;
    if (shortTargetInfo.hasShortName) {
      const diagnostics = {
        requested: shortTarget,
        targetRealpath: realpathSync(shortTarget),
        targetNativeRealpath: realpathSync.native(shortTarget),
        gitRoot,
        gitRootRealpath: realpathSync(gitRoot),
        gitRootNativeRealpath: realpathSync.native(gitRoot),
        targetIdentity: identity(shortTarget),
        gitRootIdentity: identity(gitRoot),
        relative: path.win32.relative(realpathSync.native(gitRoot), realpathSync.native(shortTarget)),
      };
      console.log(`Windows short-path bootstrap probe: ${JSON.stringify(diagnostics)}`);
      assert.equal(identity(shortTarget), identity(gitRoot), 'short target and Git root must be the same directory object');
      const shortBootstrap = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', shortTarget, '--dry-run']);
      assert.equal(shortBootstrap.status, 1, shortBootstrap.stdout);
      assert.match(shortBootstrap.stderr, /Skill bootstrap resources are incomplete/);
      assert.doesNotMatch(shortBootstrap.stderr, /inconsistent work-tree root/);
      const shortChildInfo = shortPathFor(bootstrapChild), shortChild = shortChildInfo.value;
      assert.notEqual(identity(shortChild), identity(gitRoot), 'nested target must be a distinct directory object');
      console.log(`Windows short-path parent probe: ${JSON.stringify({ requested: shortChild, targetIdentity: identity(shortChild), gitRoot, gitRootIdentity: identity(gitRoot), relative: path.win32.relative(realpathSync.native(gitRoot), realpathSync.native(shortChild)) })}`);
      const nestedResult = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', shortChild, '--dry-run']);
      assert.equal(nestedResult.status, 1, nestedResult.stdout);
      assert.match(nestedResult.stderr, /Skill bootstrap resources are incomplete/);
      assert.doesNotMatch(nestedResult.stderr, /inconsistent work-tree root/);
      await assert.rejects(access(path.join(bootstrapChild, '.ake')), { code: 'ENOENT' });
    } else {
      console.log(`Windows 8.3 short names unavailable; validating equivalent project junction paths instead: ${JSON.stringify({ requested: bootstrapTarget, commandPath: shortTarget })}`);
      const projectAlias = path.join(temp, 'bootstrap-project-alias'); await symlink(bootstrapTarget, projectAlias, 'junction');
      const aliasedRoot = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', projectAlias, '--dry-run']);
      assert.equal(aliasedRoot.status, 1, aliasedRoot.stdout); assert.match(aliasedRoot.stderr, /Skill bootstrap resources are incomplete/); assert.doesNotMatch(aliasedRoot.stderr, /inconsistent work-tree root/);
      const aliasedChild = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', path.join(projectAlias, 'nested-project'), '--dry-run']);
      assert.equal(aliasedChild.status, 1, aliasedChild.stdout); assert.match(aliasedChild.stderr, /Skill bootstrap resources are incomplete/); assert.doesNotMatch(aliasedChild.stderr, /inconsistent work-tree root/);
      await assert.rejects(access(path.join(bootstrapTarget, '.ake')), { code: 'ENOENT' });
      await assert.rejects(access(path.join(bootstrapChild, '.ake')), { code: 'ENOENT' });
    }

    const tempVolume = path.win32.parse(temp).root, checkoutVolume = path.win32.parse(root).root;
    if (tempVolume.toUpperCase() !== checkoutVolume.toUpperCase()) {
      const workArea = path.join(root, 'tests', '.work'); await mkdir(workArea, { recursive: true });
      const crossVolumeRepo = await mkdtemp(path.join(workArea, 'ake-cross-volume-root-')); t.after(() => rm(crossVolumeRepo, { recursive: true, force: true }));
      const crossVolumeTarget = path.join(temp, 'ake-cross-volume-target'); await mkdir(crossVolumeTarget);
      const crossGitDir = path.join(crossVolumeRepo, '.git');
      const crossGitInit = spawnSync('git', ['init', '--quiet', crossVolumeRepo], { encoding: 'utf8', env: cleanTestEnv() }); assert.equal(crossGitInit.status, 0, crossGitInit.stderr);
      await writeFile(path.join(crossVolumeTarget, '.git'), `gitdir: ${crossGitDir.replaceAll('\\', '/')}\n`);
      const crossConfig = spawnSync('git', ['config', '--file', path.join(crossGitDir, 'config'), 'core.worktree', crossVolumeRepo], { encoding: 'utf8', env: cleanTestEnv() }); assert.equal(crossConfig.status, 0, crossConfig.stderr);
      const crossGitRoot = spawnSync('git', ['-C', crossVolumeTarget, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: cleanTestEnv() }); assert.equal(crossGitRoot.status, 0, crossGitRoot.stderr);
      assert.equal(identityPath(crossGitRoot.stdout.trim()), identityPath(crossVolumeRepo), 'cross-volume Git fixture must point to the other volume root');
      assert.equal(isDirectoryAncestor(realpathSync.native(crossVolumeRepo), realpathSync.native(crossVolumeTarget)), false, 'different-volume paths cannot be parent and child');
      const crossBootstrap = run(path.join(skillCopy, 'bootstrap.mjs'), ['--dir', crossVolumeTarget, '--dry-run']);
      assert.equal(crossBootstrap.status, 1, crossBootstrap.stdout); assert.match(crossBootstrap.stderr, /GIT_METADATA_INVALID:|inconsistent work-tree root/);
      await assert.rejects(access(path.join(crossVolumeTarget, '.ake')), { code: 'ENOENT' });
    } else console.log(`Windows cross-volume bootstrap probe unavailable: TEMP and checkout are both on ${tempVolume}`);
  }
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
