import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../../src/lib/documents.mjs';
import { parseFrontmatter } from '../../src/lib/frontmatter.mjs';
import { sha256 } from '../../src/lib/fsx.mjs';

test('frontmatter parses nested lists and body',()=>{const x=parseFrontmatter('---\npko:\n  type: cookbook\n  scope:\n    - "src/**"\n---\n# title');assert.equal(x.data.pko.type,'cookbook');assert.deepEqual(x.data.pko.scope,['src/**']);assert.match(x.body,/# title/)});
test('document gate rejects missing metadata and sections',()=>{assert.ok(validateDocument('# recipe','docs/cookbook/a.md').length);assert.ok(validateDocument('---\npko:\n  type: cookbook\n  id: CB-a\n  status: active\n  created: 2026-11-09\n  scope: ["src/**"]\n  evidence: ["tests/a.test.mjs"]\n---\n# title','docs/cookbook/a.md').length)});
test('hash is deterministic',()=>assert.equal(sha256('abc'),sha256('abc')));
