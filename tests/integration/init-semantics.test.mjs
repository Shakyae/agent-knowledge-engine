import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repo, 'scripts/ake.mjs');
async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ake-init-semantics-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function gitInit(dir) {
  const result = spawnSync('git', ['init', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
function run(args, cwd) {
  return spawnSync(process.execPath, [cli, 'init', ...args], { cwd, encoding: 'utf8' });
}

test('init help documents optional --dir and --merge-agents remains accepted', async t => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--dir is optional/);
  assert.match(help.stdout, /current working directory by default/);
  const dir = await temp(t); gitInit(dir);
  const result = run(['--dir', dir, '--merge-agents', '--dry-run'], dir);
  assert.equal(result.status, 0, result.stderr);
});

test('omitted --dir initializes exactly the current Git work tree directory', async t => {
  const dir = await temp(t); gitInit(dir);
  const result = run([], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(path.join(dir, '.ake/config.json'), 'utf8')).version, '0.1.0');
});

test('Git subdirectory remains the target and does not redirect to repository root', async t => {
  const root = await temp(t); gitInit(root);
  const subdir = path.join(root, 'nested', 'project'); await mkdir(subdir, { recursive: true });
  const result = run([], subdir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(subdir, '.ake/config.json'), 'utf8').then(() => true), true);
  await assert.rejects(readFile(path.join(root, '.ake/config.json')),{code:'ENOENT'});
});

test('explicit --dir is used regardless of caller cwd', async t => {
  const cwd = await temp(t), target = await temp(t); gitInit(target);
  const result = run(['--dir', target], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(target, '.ake/config.json'), 'utf8').then(() => true), true);
  await assert.rejects(readFile(path.join(cwd, '.ake/config.json')),{code:'ENOENT'});
});

test('non-Git target reports the exact work-tree failure and writes nothing', async t => {
  const dir = await temp(t), before = await readdir(dir);
  const result = run(['--dir', dir], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not a valid Git work tree/);
  assert.deepEqual(await readdir(dir), before);
});

test('existing differing project files are not overwritten', async t => {
  const dir = await temp(t); gitInit(dir);
  const config = path.join(dir, '.ake/config.json'); await mkdir(path.dirname(config), { recursive: true });
  await writeFile(config, '{"keep":"mine"}\n');
  const result = run(['--dir', dir], dir);
  assert.equal(result.status, 1);
  assert.equal(await readFile(config, 'utf8'), '{"keep":"mine"}\n');
});

test('dry-run plans initialization but leaves target unchanged', async t => {
  const dir = await temp(t); gitInit(dir);
  const before = await readdir(dir);
  const result = run(['--dir', dir, '--dry-run'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(dir), before);
  assert.equal(run(['--dir', dir], dir).status, 0);
  const identical = run(['--dir', dir], dir);
  assert.equal(identical.status, 0, identical.stderr);
  assert.match(identical.stdout, /identical|skip/);
});

test('AKE source directory is not substituted for an external project target', async t => {
  const target = await temp(t); gitInit(target);
  const before = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout;
  const result = run(['--dir', target], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(target, '.ake/config.json'), 'utf8').then(() => true), true);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout, before);
});

// Real Git integration tests above use only isolated temporary directories; no user-level Skill is touched.