import path from 'node:path';
import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { parseFrontmatter } from './frontmatter.mjs';
import { loadConfig } from './config.mjs';

function configuredPath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw Error(`configured knowledge root must be project-relative: ${relative}`);
  const resolved = path.resolve(root, relative), rel = path.relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error(`configured knowledge root escapes project: ${relative}`);
  return resolved;
}
const words = s => (s.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? []);
const hasCjk = s => /[\u3400-\u9fff]/.test(s);
function matchesWord(word, term) { return hasCjk(word) || hasCjk(term) ? word.includes(term) || term.includes(word) : word === term; }
function termMatch(text, term) { return words(text).some(word => matchesWord(word, term)); }
function scoreField(text, term) { return Math.min(3, words(text).filter(word => matchesWord(word, term)).length); }

async function collect(dir, files, fail, readDirectory = readdir) {
  let entries;
  try { entries = await readDirectory(dir, { withFileTypes: true }); }
  catch (error) { fail(`${dir}: cannot read directory: ${error.message}`); return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(file, files, fail, readDirectory);
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') files.push(file);
    else if (entry.isSymbolicLink()) fail(`${file}: skipped symbolic link`);
  }
}
function documentStatus(type, metadata, body, candidate) {
  if (candidate) return candidate.status ?? 'unknown';
  if (type === 'note') return body.match(/^Status: ([^\n—]+)/m)?.[1]?.trim() ?? 'unknown';
  if (type === 'postmortem') return body.match(/^Status:\s*([^\n]+)$/m)?.[1]?.trim() ?? 'unknown';
  return metadata.status ?? 'unknown';
}
function payloadBytes(results) {
  return results.reduce((bytes, result, index) => bytes + (index ? 1 : 0) + Buffer.byteLength(JSON.stringify(result), 'utf8'), 0);
}

export async function search(projectRoot, query, opts = {}) {
  const root = path.resolve(projectRoot), config = await loadConfig(root);
  // Narrow I/O seam for deterministic EACCES coverage tests; CLI callers use the real filesystem.
  const roots = Object.entries(config.knowledgeRoots), terms = words(query), results = [], coverageReasons = [], searchedRoots = roots.map(([, relative]) => relative);
  let incomplete = false;
  const fail = reason => { incomplete = true; coverageReasons.push(reason); };
  async function scan(base, source, configuredKind) {
    const files = [];
    try {
      const info = await lstat(base);
      if (!info.isDirectory()) { fail(`${base}: root is not a directory`); return; }
      const [realRoot, realBase] = await Promise.all([realpath(root), realpath(base)]);
      const realRel = path.relative(realRoot, realBase);
      if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) { fail(`${base}: root resolves outside project`); return; }
      await collect(base, files, fail, opts.readDirectory ?? readdir);
    } catch (error) {
      if (error.code === 'ENOENT') { coverageReasons.push(`${path.relative(root, base).split(path.sep).join('/')}: root not installed (treated as confirmed empty)`); return; }
      fail(`${base}: cannot inspect root: ${error.message}`); return;
    }
    for (const file of files) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      try {
        const text = (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n');
        const parsed = text.startsWith('---\n') ? parseFrontmatter(text) : { data: {}, body: text };
        if (parsed.error) { fail(`${relative}: parse error: ${parsed.error}`); continue; }
        const metadata = parsed.data?.ake ?? {};
        const candidate = source === 'candidate' ? parsed.data?.akeCandidate ?? {} : null;
        const body = parsed.body ?? text;
        const type = source === 'candidate' ? 'candidate' : configuredKind;
        if (opts.type && opts.type !== type) continue;
        const status = documentStatus(type, metadata, body, candidate);
        if (opts.status && opts.status !== status) continue;
        const title = body.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(file, '.md');
        const filename = path.basename(file), frontmatter = parsed.raw ?? '', headings = (body.match(/^#{1,6}\s+.+$/gm) ?? []).join('\n');
        let relevance = 0;
        const matched = [];
        for (const term of terms) {
          const total = scoreField(title, term) * 6 + scoreField(filename, term) * 4 + scoreField(frontmatter, term) * 3 + scoreField(headings, term) * 2 + scoreField(body, term);
          if (total) { relevance += total; matched.push(term); }
        }
        if (!relevance) continue;
        const lines = text.split('\n'), snippets = [];
        for (let index = 0; index < lines.length && snippets.length < 3; index++) {
          if (matched.some(term => termMatch(lines[index], term))) snippets.push({ line: index + 1, text: lines[index] });
        }
        if (!snippets.length) snippets.push({ line: 1, text: lines[0] ?? title });
        const result = { path: relative, type, status, scope: candidate?.scope ?? metadata.scope ?? 'unknown', verified: metadata.verified ?? 'unknown', relevance, snippets };
        if (source) result.source = source;
        results.push(result);
      } catch (error) { fail(`${relative}: cannot read/parse: ${error.message}`); }
    }
  }
  for (const [kind, relative] of roots) {
    try { await scan(configuredPath(root, relative), undefined, kind); }
    catch (error) { fail(`${relative}: ${error.message}`); }
  }
  if (opts.includeCandidates) {
    const candidateRoot = config.candidatesDir ?? '.ake/candidates';
    searchedRoots.push(candidateRoot);
    try { await scan(configuredPath(root, candidateRoot), 'candidate'); }
    catch (error) { fail(`${candidateRoot}: ${error.message}`); }
  }
  results.sort((a, b) => b.relevance - a.relevance || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const limit = Math.max(0, Number.isFinite(Number(opts.limit)) ? Number(opts.limit) : 10);
  let selected = results.slice(0, limit);
  let truncated = results.length > limit;
  if (truncated) { incomplete = true; coverageReasons.push(`results truncated by limit ${limit}; more matches may exist`); }
  if (opts.budgetBytes !== undefined) {
    const budget = opts.budgetBytes;
    while (selected.length && payloadBytes(selected) > budget) selected.pop();
    if (selected.length < Math.min(results.length, limit)) {
      truncated = true;
      incomplete = true;
      coverageReasons.push(`results truncated by output budget ${budget} UTF-8 bytes; some matches may be omitted`);
    }
  }
  return { query: { raw: query, terms }, filters: { type: opts.type ?? null, status: opts.status ?? null }, searchedRoots, coverage: incomplete ? 'incomplete' : 'complete', coverageReasons, truncated, results: selected };
}
