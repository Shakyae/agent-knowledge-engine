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

test('Skill documents advisory choices, session deduplication and no unauthorized upgrade', async () => {
  const skill = await readFile(path.join(root, 'skills/ake/SKILL.md'), 'utf8');
  for (const marker of ['同一差异只提示一次', '审阅升级方案', '暂不升级', '不要在选择之前写项目', '取得对实际写入的明确授权', '不是宿主强制']) assert.ok(skill.includes(marker), marker);
});

test('real legacy project CLI remains unknown despite config and bundle versions', async t => {
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
  assert.equal(advisory.projectCliVersion, null);
  assert.equal(advisory.configVersion, '99.0.0');
  assert.equal(advisory.comparison, 'unknown');
  assert.deepEqual(await readFile(config), beforeConfig);
  assert.deepEqual(await readFile(cliPath), beforeCli);
});

test('preflight compares independent versions without writing project files', async t => {
  const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ake-version-advisory-')));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const skill = path.join(fixture, 'skill'), target = path.join(fixture, 'project');
  const source = path.join(skill, 'resources/ake-source');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await mkdir(path.join(target, '.ake/tools/scripts'), { recursive: true });
  await cp(preflight, path.join(skill, 'preflight.mjs'));
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: '8.0.0' }));
  await writeFile(path.join(source, 'scripts/ake.mjs'), `const CLI_VERSION = '3.2.1';\nthrow Error('must not execute');\n`);
  const config = path.join(target, '.ake/config.json');
  await writeFile(config, JSON.stringify({ version: '99.0.0' }));
  const projectCli = path.join(target, '.ake/tools/scripts/ake.mjs');
  const fixtureCli = version => `console.log(JSON.stringify({project:process.cwd()${version === null ? '' : `,cliVersion:${JSON.stringify(version)}`}}))`;
  for (const [version, comparison] of [['3.1.9', 'user-newer'], ['3.2.1', 'equal'], ['4.0.0', 'project-newer'], [null, 'unknown'], ['3.1.0-rc.1', 'unknown'], ['03.0.0', 'unknown']]) {
    const contents = fixtureCli(version);
    await writeFile(projectCli, contents);
    const before = await readFile(config);
    const result = run(path.join(skill, 'preflight.mjs'), ['--dir', target], target);
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.split('\n').find(item => item.startsWith('VERSION_ADVISORY: '));
    const report = JSON.parse(line.slice('VERSION_ADVISORY: '.length));
    assert.deepEqual(report, { project: target, bundleVersion: '8.0.0', userCliVersion: '3.2.1', projectCliVersion: version, configVersion: '99.0.0', comparison });
    assert.deepEqual(await readFile(config), before);
    assert.equal(await readFile(projectCli, 'utf8'), contents);
    assert.deepEqual(await readdir(path.join(target, '.ake')), ['config.json', 'tools']);
  }
  await writeFile(path.join(source, 'scripts/ake.mjs'), `process.exitCode=1`);
  const failed = run(path.join(skill, 'preflight.mjs'), ['--dir', target], target);
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(JSON.parse(failed.stdout.split('\n').find(x => x.startsWith('VERSION_ADVISORY: ')).slice(18)).comparison, 'unknown');
});
