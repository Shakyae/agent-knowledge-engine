import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceCli = path.join(repo, 'scripts/ake.mjs');
const sharedCli = path.join(repo, 'skills/ake/resources/ake-source/scripts/ake.mjs');
const note = `# Agent Note: E2E retrieval\n\nStatus: proposed\n\n## Problem\nA durable search example is useful.\n\n## Proposal\nRecord the tested workflow.\n\n## Alternatives considered\nDo not add a duplicate.\n\n## Acceptance criteria\nA later search finds it.\n\n## Risks\nThis is only a fixture.\n`;
function run(cli, args, cwd) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }
function runProject(args, cwd, project) { return run(sharedCli, [...args, '--project', project], cwd); }

test('shared Skill CLI publishes project data and later retrieves it from another cwd', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ake-e2e-'));
  try {
    const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    const initialized = run(sourceCli, ['init', '--dir', root], repo);
    assert.equal(initialized.status, 0, initialized.stderr + initialized.stdout);
    await assert.rejects(readFile(path.join(root, '.ake/tools/scripts/ake.mjs')), { code: 'ENOENT' });
    await mkdir(path.join(root, 'tmp-work'), { recursive: true });
    await writeFile(path.join(root, 'note.md'), note);
    let result = runProject(['candidate', 'new', '--kind', 'note', '--title', 'E2E retrieval', '--author', 'writer', '--target', '.agents/notes/proposed/process/2026-11-09-e2e-retrieval.md', '--body', 'note.md'], root, root);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const id = result.stdout.match(/C-\d+/)?.[0];
    assert.ok(id);
    for (const args of [
      ['candidate', 'submit', id],
      ['review', id, '--reviewer', 'reviewer', '--verdict', 'approve', '--notes', 'verified format and evidence'],
      ['approve', id, '--by', 'human', '--confirm'],
      ['publish', id],
    ]) {
      result = runProject(args, root, root);
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    assert.match(await readFile(path.join(root, '.agents/notes/proposed/process/2026-11-09-e2e-retrieval.md'), 'utf8'), /E2E retrieval/);
    const work = path.join(root, 'tmp-work');
    const status = runProject(['status', '--json'], work, root);
    assert.equal(status.status, 0, status.stderr + status.stdout);
    assert.ok(JSON.parse(status.stdout).project.endsWith(path.basename(root)));
    result = runProject(['search', 'E2E retrieval'], work, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /e2e-retrieval\.md/);
    result = runProject(['validate'], os.tmpdir(), root);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    await writeFile(path.join(root, 'package.json'), '{"type":"commonjs"}\n');
    result = runProject(['search', 'E2E retrieval'], work, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /e2e-retrieval\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
