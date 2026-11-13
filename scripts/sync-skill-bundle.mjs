#!/usr/bin/env node
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'skills', 'ake', 'resources', 'ake-source');
const checkOnly = process.argv.includes('--check');
const packageMetadata = {
  name: 'agent-knowledge-engine',
  version: JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version,
  private: true,
  type: 'module',
  engines: { node: '>=20' },
};

async function filesBelow(directory, prefix = '') {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

const expected = new Map([['package.json', Buffer.from(`${JSON.stringify(packageMetadata, null, 2)}\n`)]]);
for (const directory of ['scripts', 'src/lib', 'templates/project']) {
  for (const file of await filesBelow(path.join(repoRoot, directory))) {
    if (directory === 'scripts' && file !== 'ake.mjs') continue;
    if (directory === 'src/lib' && !file.endsWith('.mjs')) continue;
    if (directory === 'templates/project' && !file.endsWith('.md')) continue;
    const relative = path.posix.join(directory, file);
    expected.set(relative, await readFile(path.join(repoRoot, relative)));
  }
}

const problems = [];
let existing = [];
try { existing = await filesBelow(outputRoot); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const expectedNames = [...expected.keys()].sort();
for (const relative of expectedNames) {
  const target = path.join(outputRoot, relative);
  let actual;
  try { actual = await readFile(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    problems.push(`missing ${path.relative(repoRoot, target)}`);
    continue;
  }
  if (!actual.equals(expected.get(relative))) problems.push(`different ${path.relative(repoRoot, target)}`);
}
for (const relative of existing) {
  if (!expected.has(relative)) problems.push(`unexpected ${path.relative(repoRoot, path.join(outputRoot, relative))}`);
}

if (checkOnly) {
  if (problems.length) {
    console.error(`Skill bundle is out of sync:\n${problems.map((item) => `- ${item}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Skill bundle is synchronized (${expected.size} files).`);
} else {
  for (const [relative, content] of expected) {
    const target = path.join(outputRoot, relative);
    let current;
    try { current = await readFile(target); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current?.equals(content)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const stale = existing.filter((relative) => !expected.has(relative));
  console.log(`Generated ${expected.size} Skill bundle files under ${path.relative(repoRoot, outputRoot)}.`);
  if (stale.length) console.warn(`Unexpected files were left untouched; remove or review them before --check:\n${stale.map((file) => `- ${file}`).join('\n')}`);
}
