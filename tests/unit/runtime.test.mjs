import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { MINIMUM_NODE_VERSION, compareNodeVersions, nodeVersionFailure, nodeVersionIsSupported } from '../../src/lib/runtime.mjs';

test('AKE runtime floor compares numeric Node versions against 22.20.0', () => {
  assert.equal(MINIMUM_NODE_VERSION, '22.20.0');
  for (const version of ['20.20.2', '22.19.0', '22.19.99', '22.20.0-rc.1', '23.0.0-beta.1', 'not-a-version']) {
    assert.equal(nodeVersionIsSupported(version), false, `${version} must be rejected`);
    assert.ok(nodeVersionFailure(version).includes(version));
    assert.match(nodeVersionFailure(version), />=22\.20\.0/);
  }
  for (const version of ['22.20.0', '22.20.1', '22.21.0', '23.0.0', '26.13.0', 'v22.20.0+build.1']) {
    assert.equal(nodeVersionIsSupported(version), true, `${version} must be accepted`);
    assert.equal(nodeVersionFailure(version), null);
  }
  assert.equal(compareNodeVersions('22.19.99', '22.20.0'), -1);
  assert.equal(compareNodeVersions('22.20.0', '22.20.0'), 0);
  assert.equal(compareNodeVersions('22.20.1', '22.20.0'), 1);
});

test('all standalone Skill entrypoint gates match shared prerelease and boundary rules', async () => {
  const paths = ['bootstrap.mjs', 'preflight.mjs', 'init-git.mjs'].map(name => new URL(`../../skills/ake/${name}`, import.meta.url));
  const functions = await Promise.all(paths.map(async file => {
    const source = await readFile(file, 'utf8');
    const start = source.indexOf('function nodeVersionFailure(');
    const end = source.indexOf('\n}\n', start) + 2;
    assert.ok(start >= 0 && end > start, `missing inline gate in ${file.pathname}`);
    return source.slice(start, end);
  }));
  assert.equal(functions[1], functions[0]);
  assert.equal(functions[2], functions[0]);
  const check = runInNewContext(`(${functions[0]})`);
  for (const version of ['20.20.2', '22.19.0', '22.20.0-rc.1', '23.0.0-beta.1', 'invalid']) {
    assert.ok(check(version).includes(`Unsupported Node.js version ${version}`));
  }
  for (const version of ['22.20.0', '22.21.0', '23.0.0']) assert.equal(check(version), null);
});
