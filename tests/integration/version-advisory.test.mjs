import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preflight = path.join(root, 'skills/ake/preflight.mjs');
const cli = path.join(root, 'scripts/ake.mjs');
const run = (file, args, cwd) => spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8' });

test('CLI reports its own version without project and matches release metadata', async () => {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const result = run(cli, ['version', '--json'], os.tmpdir());
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { cliVersion: metadata.version });
  const bundled = run(path.join(root, 'skills/ake/resources/ake-source/scripts/ake.mjs'), ['version', '--json'], os.tmpdir());
  assert.equal(bundled.status, 0, bundled.stderr);
  assert.deepEqual(JSON.parse(bundled.stdout), { cliVersion: metadata.version });
});

test('Skill documents a single shared CLI and no per-project upgrade path', async () => {
  const skill = await readFile(path.join(root, 'skills/ake/SKILL.md'), 'utf8');
  for (const marker of ['所有项目共享同一 Skill CLI', '移除逐项目升级机制', '更新期间停用', '更新替换 Skill 资源时非原子', '不能为其他会话/进程提供读写隔离']) assert.ok(skill.includes(marker), marker);
});

test('preflight ignores legacy CLI copies and reports the shared CLI/config versions', async t => {
  const target = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-version-legacy-')));
  t.after(() => rm(target, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', '--quiet', target], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const tools = path.join(target, '.ake/tools');
  await mkdir(tools, { recursive: true });
  const legacy = path.join(root, 'tests/fixtures/legacy-ake-cli-720b2e8');
  await cp(path.join(legacy, 'scripts'), path.join(tools, 'scripts'), { recursive: true });
  await cp(path.join(legacy, 'src'), path.join(tools, 'src'), { recursive: true });
  const config = path.join(target, '.ake/config.json');
  await writeFile(config, JSON.stringify({ version: '99.0.0' }));
  const cliPath = path.join(tools, 'scripts/ake.mjs');
  const beforeConfig = await readFile(config), beforeCli = await readFile(cliPath);
  const result = run(preflight, ['--dir', target], target);
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split('\n').find(x => x.startsWith('VERSION_ADVISORY: '));
  const advisory = JSON.parse(line.slice('VERSION_ADVISORY: '.length));
  assert.equal(advisory.sharedCliVersion, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
  assert.equal(advisory.configVersion, '99.0.0');
  assert.equal(advisory.projectCliVersion, undefined);
  assert.deepEqual(await readFile(config), beforeConfig);
  assert.deepEqual(await readFile(cliPath), beforeCli);
});

test('preflight fails closed when the bundled shared CLI is missing', async t => {
  const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-version-advisory-')));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const skill = path.join(fixture, 'skill'), target = path.join(fixture, 'project');
  await mkdir(path.join(skill, 'resources/ake-source/scripts'), { recursive: true });
  await mkdir(path.join(target, '.ake/tools/scripts'), { recursive: true });
  const init = spawnSync('git', ['init', '--quiet', target], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  await cp(preflight, path.join(skill, 'preflight.mjs'));
  await writeFile(path.join(target, '.ake/config.json'), JSON.stringify({ version: '99.0.0' }));
  const projectCli = path.join(target, '.ake/tools/scripts/ake.mjs');
  const legacy = 'process.exitCode=71; console.error("must not execute");';
  await writeFile(projectCli, legacy);
  const result = run(path.join(skill, 'preflight.mjs'), ['--dir', target], target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^SHARED_CLI_UNAVAILABLE:/);
  assert.equal(await readFile(projectCli, 'utf8'), legacy);
  assert.deepEqual((await readdir(path.join(target, '.ake'))).sort(), ['config.json', 'tools']);
});
