#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const cases = [
  { query: 'connection timeout retry', goldPath: '.agents/notes/implemented/architecture/0000.md' },
  { query: 'unicode 中文检索', goldPath: 'docs/defensive-patterns/0001.md' },
  { query: 'budget output truncation', goldPath: 'docs/postmortem/0002.md' },
  { query: 'postmortem root cause', goldPath: 'docs/cookbook/0003.md' },
  { query: 'socket leak', goldPath: '.agents/notes/implemented/architecture/0000.md', knownLexicalGap: true },
  { query: 'windows node portability', goldPath: 'docs/cookbook/0003.md' },
  { query: 'canonical', options: { type: 'postmortem' }, expectedPaths: ['docs/postmortem/0002.md'], goldPath: 'docs/postmortem/0002.md' },
  { query: 'canonical', options: { status: 'draft' }, expectedPaths: ['docs/defensive-patterns/0001.md'], goldPath: 'docs/defensive-patterns/0001.md' },
  { query: 'canonical', options: { type: 'defensive-pattern', status: 'draft' }, expectedPaths: ['docs/defensive-patterns/0001.md'], goldPath: 'docs/defensive-patterns/0001.md' },
  { query: 'unmatchable sentinel', expectedPaths: [], goldPath: null },
];
const rounds = 21;
const sizes = [100, 500, 1000];
const defaults = { note: '.agents/notes', 'defensive-pattern': 'docs/defensive-patterns', postmortem: 'docs/postmortem', cookbook: 'docs/cookbook' };
const measurementDefinitions = {
  timing: 'performance.now around search() only; hot same-process calls; cold one new Node process per sample, OS caches not cleared',
  percentile: 'nearest-rank percentile, p = ceil(n * p) - 1 in ascending samples',
  memory: 'process.memoryUsage().rss once after a cold-process search; not peak RSS or retained heap',
  reads: 'instrumented fs.promises.readFile calls for Markdown and JSON files, including one config read',
  bytes: 'UTF-8 Buffer.byteLength(JSON.stringify(searchResult)); compact result object, not CLI stdout',
};
const benchmarkSpecFingerprint = createHash('sha256').update(JSON.stringify({ cases, rounds, sizes, corpusVersion: 1, measurementDefinitions })).digest('hex');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compareIndex = process.argv.indexOf('--compare');
const compareFile = compareIndex < 0 ? undefined : process.argv[compareIndex + 1];
if (compareIndex >= 0 && (!compareFile || compareFile.startsWith('--'))) throw Error('--compare requires a previous benchmark JSON file');
const readCounter = { count: 0 };
const originalReadFile = fs.readFile;
fs.readFile = async function(file, ...args) {
  if (typeof file === 'string' && /\.(md|json)$/.test(file)) readCounter.count++;
  return originalReadFile.call(this, file, ...args);
};
syncBuiltinESMExports();
const { search } = await import('../src/lib/search.mjs');

function percentile(values, p) { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]; }
function summary(values) { return { medianMs: percentile(values, .5), p95Ms: percentile(values, .95) }; }
async function corpus(root, count) {
  const corpusRecords = [];
  for (const dir of Object.values(defaults)) await mkdir(path.join(root, dir), { recursive: true });
  const words = [
    ['connection timeout retry', 'connection', 'timeout', 'retry'],
    ['unicode 中文检索', 'unicode', '中文检索', '汉字'],
    ['budget output truncation', 'budget', 'output', 'truncation'],
    ['postmortem root cause', 'postmortem', 'root cause', 'guardrails'],
  ];
  for (let i = 0; i < count; i++) {
    const kind = Object.keys(defaults)[i % 4];
    const rootDir = defaults[kind];
    const [label, a, b, c] = words[i % words.length];
    const title = i < 4 ? `${label} canonical ${i}` : `synthetic document ${String(i).padStart(4, '0')}`;
    const status = kind === 'postmortem' ? (i === 2 ? 'open' : 'resolved') : kind === 'note' ? 'implemented' : i === 1 ? 'draft' : 'active';
    const metadata = kind === 'defensive-pattern' || kind === 'cookbook' ? `---\nake:\n  type: ${kind}\n  status: ${status}\n---\n` : '';
    const platform = i === 3 ? 'windows node portability cross-platform path' : '';
    const body = `${metadata}# ${title}\n\nStatus: ${status}\n\n${a} ${b} ${c} ${platform} synthetic sample ${i}.\n`;
    let relative;
    if (kind === 'note') relative = `.agents/notes/implemented/architecture/${String(i).padStart(4, '0')}.md`;
    else relative = `${rootDir}/${String(i).padStart(4, '0')}.md`;
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), body);
    corpusRecords.push(`${relative}\0${body}`);
  }
  return createHash('sha256').update(corpusRecords.join('\n')).digest('hex');
}
async function runChild(root, testCase) {
  const startReads = readCounter.count;
  const start = performance.now();
  const result = await search(root, testCase.query, { limit: 10, ...testCase.options });
  const elapsedMs = performance.now() - start;
  return { elapsedMs, readCount: readCounter.count - startReads, serializedResultBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'), result };
}
function compareResults(previous, current, currentMetadata) {
  if (!previous.runtime || !previous.measurementDefinitions || !previous.benchmarkSpecFingerprint) return { unavailable: 'historical report lacks runtime/measurement/spec fingerprints; manual values are not an automatically validated comparison' };
  if (JSON.stringify(previous.runtime) !== JSON.stringify(currentMetadata.runtime)) return { unavailable: 'runtime version/platform/architecture differs' };
  if (previous.rounds !== currentMetadata.rounds) return { unavailable: 'sample round count differs' };
  if (previous.benchmarkSpecFingerprint !== currentMetadata.benchmarkSpecFingerprint) return { unavailable: 'benchmark cases/corpus-generation/measurement spec differs' };
  const previousBySize = new Map(previous.results.map(row => [row.documentCount, row]));
  for (const row of current) {
    const prior = previousBySize.get(row.documentCount);
    if (!prior || prior.corpusFingerprint !== row.corpusFingerprint) return { unavailable: `corpus fingerprint differs or is missing for ${row.documentCount} documents` };
  }
  return current.map(row => {
    const oldRow = previousBySize.get(row.documentCount);
    if (!oldRow) return { documentCount: row.documentCount, unavailable: 'no matching historical corpus size' };
    return { documentCount: row.documentCount, cases: row.cases.map(testCase => {
      const old = oldRow.cases.find(item => item.query === testCase.query && JSON.stringify(item.options ?? {}) === JSON.stringify(testCase.options ?? {}));
      if (!old) return { query: testCase.query, unavailable: 'no matching historical query/options' };
      const oldBytes = old.serializedResultBytes ?? old.outputBytes;
      return { query: testCase.query,
        hotMedianMs: { before: old.hot.medianMs, after: testCase.hot.medianMs },
        hotP95Ms: { before: old.hot.p95Ms, after: testCase.hot.p95Ms },
        coldMedianMs: { before: old.coldProcess?.medianMs ?? old.coldProcessMs, after: testCase.coldProcess.medianMs },
        coldP95Ms: { before: old.coldProcess?.p95Ms, after: testCase.coldProcess.p95Ms },
        readsPerSearch: { before: old.readsPerSearch, after: testCase.readsPerSearch },
        serializedResultBytes: { before: oldBytes, after: testCase.serializedResultBytes },
        postSearchRssBytes: { before: old.rssAfterColdMedianBytes, after: testCase.rssAfterColdMedianBytes },
      };
    }) };
  });
}

if (process.env.AKE_BENCH_CHILD) {
  const root = process.env.AKE_BENCH_ROOT;
  const testCase = JSON.parse(process.env.AKE_BENCH_CASE);
  const beforeRss = process.memoryUsage().rss;
  const measured = await runChild(root, testCase);
  console.log(JSON.stringify({ ...measured, rssBeforeBytes: beforeRss, rssAfterBytes: process.memoryUsage().rss }));
} else {
  await mkdir(path.join(repoRoot, '.ake-tmp'), { recursive: true });
  const base = await mkdtemp(path.join(repoRoot, '.ake-tmp', 'search-bench-'));
  try {
    const rows = [];
    for (const size of sizes) {
      const root = path.join(base, String(size));
      await mkdir(root, { recursive: true });
      const corpusFingerprint = await corpus(root, size);
      const caseResults = [];
      for (const testCase of cases) {
        const hotTimes = [], coldTimes = [], readCounts = [], outputSizes = [], rssAfter = [];
        for (let i = 0; i < rounds; i++) {
          const measured = await runChild(root, testCase);
          hotTimes.push(measured.elapsedMs);
          readCounts.push(measured.readCount);
          outputSizes.push(measured.serializedResultBytes);
          const cold = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
            encoding: 'utf8', env: { ...process.env, AKE_BENCH_CHILD: '1', AKE_BENCH_ROOT: root, AKE_BENCH_CASE: JSON.stringify(testCase) },
          });
          if (cold.status !== 0) throw Error(`cold child failed: ${cold.stderr}`);
          const coldResult = JSON.parse(cold.stdout);
          coldTimes.push(coldResult.elapsedMs);
          rssAfter.push(coldResult.rssAfterBytes);
        }
        const last = await runChild(root, testCase);
        const actualPaths = last.result.results.map(hit => hit.path);
        let goldPass;
        if (testCase.knownLexicalGap) {
          goldPass = actualPaths.length === 0;
          assert.equal(goldPass, true, `known lexical gap unexpectedly matched: ${testCase.query}`);
        } else if (testCase.expectedPaths) {
          goldPass = JSON.stringify([...actualPaths].sort()) === JSON.stringify([...testCase.expectedPaths].sort());
          assert.equal(goldPass, true, `filtered/no-match gold set differs for ${testCase.query}: ${JSON.stringify(actualPaths)}`);
        } else {
          goldPass = actualPaths.includes(testCase.goldPath);
          assert.equal(goldPass, true, `gold path was not recalled for ${testCase.query}: ${testCase.goldPath}`);
        }
        caseResults.push({ ...testCase, expectedOutcome: testCase.knownLexicalGap ? 'known lexical gap: expected no result' : testCase.expectedPaths ? `exact result set (${testCase.expectedPaths.length} paths)` : 'expected gold path in top 10', goldPass, expectedPaths: testCase.expectedPaths ?? (testCase.knownLexicalGap || !testCase.goldPath ? [] : [testCase.goldPath]), actualPaths, hot: summary(hotTimes), coldProcess: summary(coldTimes), readsPerSearch: readCounts[0], serializedResultBytes: outputSizes[0], rssAfterColdMedianBytes: percentile(rssAfter, .5) });
      }
      rows.push({ documentCount: size, corpusFingerprint, rounds, cases: caseResults });
    }
    const runMetadata = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, rounds, benchmarkSpecFingerprint, measurementDefinitions };
    const comparison = compareFile ? compareResults(JSON.parse(await readFile(compareFile, 'utf8')), rows, runMetadata) : undefined;
    const report = { generatedCorpus: 'deterministic synthetic Markdown; no project knowledge is copied', corpusLimitations: 'Synthetic corpus deliberately repeats four topic patterns across all sizes; query/gold cases validate lexical retrieval and filters only, not representative real engineering knowledge or semantic recall.', ...runMetadata, seed: 0, coldDefinition: measurementDefinitions.timing, hotDefinition: 'Hot samples repeat search calls in the same Node process over the same corpus.', memoryDefinition: measurementDefinitions.memory, outputDefinition: measurementDefinitions.bytes, readDefinition: measurementDefinitions.reads, goldQueries: cases, results: rows };
    if (comparison) report.comparison = { source: compareFile, metrics: comparison };
    console.log(JSON.stringify(report, null, 2));
  } finally { await rm(base, { recursive: true, force: true }); }
}
