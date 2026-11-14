import test from 'node:test';
import { rm } from 'node:fs/promises';
import { tempRoot } from '../helpers/test-env.mjs';
import assert from 'node:assert/strict';
import { resolveOfficialSource, resolveRemote } from '../../src/lib/git-remote.mjs';

test('official source accepts only a single HTTPS GitHub repository', () => {
  assert.deepEqual(resolveOfficialSource('https://github.com/Acme/ake.git'), { sourceUrl: 'https://github.com/Acme/ake.git', repo: 'Acme/ake' });
  for (const url of ['http://github.com/a/b', 'https://evil.example/a/b', 'https://user@github.com/a/b', 'https://github.com/a/b?x=1', 'file:///tmp/repo']) assert.throws(() => resolveOfficialSource(url));
});

test('resolveRemote rejects ambiguous HEAD and remote errors', async () => {
  const runner = async args => {
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\n' };
    throw new Error('must not fetch ambiguous result');
  };
  await assert.rejects(resolveRemote({ repoUrl: 'https://github.com/a/b.git', gitRunner: runner }), { code: 'REMOTE' });
  await assert.rejects(resolveRemote({ repoUrl: 'https://github.com/a/b.git', gitRunner: async () => { throw Error('offline'); } }), { code: 'REMOTE' });
});

test('resolveRemote dynamically reads branch and captures target tree', async t => {
  const sha = 'a'.repeat(40); const calls = [];
  const runner = async args => {
    calls.push(args);
    if (args[0] === 'ls-remote') return { stdout: `ref: refs/heads/trunk\tHEAD\n${sha}\tHEAD\n` };
    if (args.includes('rev-parse')) return { stdout: `${sha}\n` };
    if (args.includes('ls-tree')) return { stdout: '100644 blob deadbeef\tskills/ake/SKILL.md\0' };
    if (args.includes('cat-file')) return { stdout: 'content' };
    return { stdout: '' };
  };
  const tempDirectory = await tempRoot('ake-git-remote-'); t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const result = await resolveRemote({ repoUrl: 'https://github.com/a/b', gitRunner: runner, tempDirectory });
  assert.equal(result.defaultBranch, 'trunk');
  assert.equal(result.targetCommit, sha);
  assert.equal(result.entries[0].relativePath, 'SKILL.md');
  assert.ok(calls.some(x => x[0] === 'init' && x[1] === '--bare'));
});
