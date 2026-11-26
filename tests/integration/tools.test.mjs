import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceCli = path.join(root, 'scripts/ake.mjs');
const sharedCli = path.join(root, 'skills/ake/resources/ake-source/scripts/ake.mjs');
async function project(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ake-shared-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = spawnSync('git', ['init', '--quiet', dir], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const init = spawnSync(process.execPath, [sourceCli, 'init', '--dir', dir], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr + init.stdout);
  return dir;
}
function run(projectDir, ...args) {
  return spawnSync(process.execPath, [sharedCli, ...args, '--project', projectDir], { cwd: projectDir, encoding: 'utf8' });
}

test('Skill-bundled shared CLI operates config-only projects without relying on package type', async t => {
  const first = await project(t), second = await project(t);
  for (const dir of [first, second]) {
    await assert.rejects(readFile(path.join(dir, '.ake/tools/scripts/ake.mjs')), { code: 'ENOENT' });
    const result = run(dir, 'status', '--json');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).project, await realpath(dir));
  }
  await writeFile(path.join(second, 'package.json'), '{"type":"commonjs"}\n');
  const configPath = path.join(second, '.ake/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.knowledgeRoots.cookbook = 'custom/knowledge';
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  await mkdir(path.join(second, 'custom/knowledge'), { recursive: true });
  const oneDoc = path.join(first, 'docs/cookbook/first.md');
  const twoDoc = path.join(second, 'custom/knowledge/second.md');
  await writeFile(oneDoc, '# firstprojecttoken');
  await writeFile(twoDoc, '# secondprojecttoken');
  assert.ok(JSON.parse(run(first, 'search', 'firstprojecttoken', '--json').stdout).results.some(item => item.path === 'docs/cookbook/first.md'));
  assert.ok(JSON.parse(run(second, 'search', 'secondprojecttoken', '--json').stdout).results.some(item => item.path === 'custom/knowledge/second.md'));
  assert.equal(JSON.parse(run(first, 'search', 'secondprojecttoken', '--json').stdout).results.length, 0);
});

test('shared CLI preserves older config/candidates and publishes/reconciles through custom paths', async t => {
  const dir = await project(t);
  const configPath = path.join(dir, '.ake/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.version = '0.0.9';
  config.knowledgeRoots.cookbook = 'custom/knowledge';
  config.candidatesDir = '.ake/archive/candidates';
  config.publishLog = '.ake/audit/events.jsonl';
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const configBefore = await readFile(configPath);
  const candidateDir = path.join(dir, config.candidatesDir);
  await mkdir(candidateDir, { recursive: true });
  const oldCandidate = path.join(candidateDir, 'C-0007-legacy-draft.md');
  const oldCandidateBytes = Buffer.from('---\nakeCandidate:\n  id: "C-0007"\n  kind: "cookbook"\n  title: "Legacy draft"\n  author: "previous-agent"\n  created: "2025-01-01"\n  status: "draft"\n---\n<!-- body -->\n# Legacy draft\n');
  await writeFile(oldCandidate, oldCandidateBytes);
  const listed = run(dir, 'candidate', 'list', '--json');
  assert.equal(listed.status, 0, listed.stderr + listed.stdout);
  assert.ok(JSON.parse(listed.stdout).summaries.some(entry => entry.id === 'C-0007' && entry.status === 'draft'));
  const shown = run(dir, 'candidate', 'show', 'C-0007', '--json');
  assert.equal(shown.status, 0, shown.stderr + shown.stdout);
  assert.equal(JSON.parse(shown.stdout).meta.id, 'C-0007');

  const bodyPath = path.join(dir, 'custom-cookbook.md');
  await writeFile(bodyPath, `---\nake:\n  type: cookbook\n  id: CB-shared-custom-reconcile\n  status: active\n  created: 2026-11-26\n  scope:\n    - "tests/**"\n  evidence:\n    - "tests/integration/tools.test.mjs"\n  verified: 2026-11-26\n---\n# Shared CLI custom path recovery\n\n## When to use\nUse an isolated project configuration with custom paths.\n\n## Steps\n1. Invoke the shared CLI with an explicit project.\n\n## Verification\nConfirm the custom publish ledger records the recovered result.\n`);
  const created = run(dir, 'candidate', 'new', '--kind', 'cookbook', '--title', 'Shared CLI custom path recovery', '--author', 'writer', '--target', 'custom/knowledge/shared-cli-recovery.md', '--body', bodyPath, '--json');
  assert.equal(created.status, 0, created.stderr + created.stdout);
  const id = JSON.parse(created.stdout).data.id;
  assert.equal(id, 'C-0008', 'new candidate numbering includes the existing candidate in the custom directory');
  for (const args of [
    ['candidate', 'submit', id],
    ['review', id, '--reviewer', 'independent-reviewer', '--verdict', 'approve', '--notes', 'validated custom-root format and current evidence'],
    ['approve', id, '--by', 'human', '--confirm'],
  ]) {
    const result = run(dir, ...args);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  }
  const customLedger = path.join(dir, config.publishLog);
  await mkdir(customLedger, { recursive: true });
  const unknown = run(dir, 'publish', id);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /publish result unknown/);
  const pending = JSON.parse(run(dir, 'candidate', 'show', id, '--json').stdout);
  assert.ok(pending.meta.pendingPublication);
  assert.equal(await readFile(path.join(dir, config.knowledgeRoots.cookbook, 'shared-cli-recovery.md'), 'utf8').then(text => text.includes('Shared CLI custom path recovery')), true);
  await rm(customLedger, { recursive: true, force: true });
  const reconciled = run(dir, 'publish', id, '--reconcile');
  assert.equal(reconciled.status, 0, reconciled.stderr + reconciled.stdout);
  assert.match(reconciled.stdout, /reconciled publication/);
  const ledger = (await readFile(customLedger, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].reconciled, true);
  assert.equal(JSON.parse(run(dir, 'candidate', 'show', id, '--json').stdout).meta.status, 'published');
  await assert.rejects(readFile(path.join(dir, '.ake/publish-log.jsonl')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(oldCandidate), oldCandidateBytes);
  assert.deepEqual(await readFile(configPath), configBefore);
});

test('old project-local CLI copies are ignored by the shared CLI path and kept byte-for-byte', async t => {
  const dir = await project(t);
  const oldCli = path.join(dir, '.ake/tools/scripts/ake.mjs');
  const oldModule = path.join(dir, '.ake/tools/src/lib/old.mjs');
  await mkdir(path.dirname(oldCli), { recursive: true });
  await mkdir(path.dirname(oldModule), { recursive: true });
  await writeFile(oldCli, 'console.error("legacy CLI must not execute"); process.exit(9);\n');
  await writeFile(oldModule, 'legacy module sentinel\n');
  const beforeCli = await readFile(oldCli), beforeModule = await readFile(oldModule);
  const status = run(dir, 'status', '--json');
  assert.equal(status.status, 0, status.stderr + status.stdout);
  assert.deepEqual(await readFile(oldCli), beforeCli);
  assert.deepEqual(await readFile(oldModule), beforeModule);
});

// These tests use temporary Git projects only; no user-level Skill is touched.
