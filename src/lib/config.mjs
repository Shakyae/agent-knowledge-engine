import path from 'node:path';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const defaultConfig = {
  version: '0.1.0',
  knowledgeRoots: { note: '.agents/notes', 'defensive-pattern': 'docs/defensive-patterns', postmortem: 'docs/postmortem', cookbook: 'docs/cookbook' },
  candidatesDir: '.ake/candidates', publishLog: '.ake/publish-log.jsonl',
};
export const kindRoot = kind => defaultConfig.knowledgeRoots[kind];

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return env;
}

function runGit(dir, args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: cleanGitEnv() });
}

function lineValue(stdout) {
  return stdout.replace(/\r?\n$/, '');
}

async function assertSafeProjectPath(root, relative, label) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw Error(`${label} must be a non-empty project-relative path`);
  }
  const absolute = path.resolve(root, relative);
  if (!inside(root, absolute)) throw Error(`${label} escapes project root: ${relative}`);
  const realRoot = await realpath(root);
  let cursor = absolute;
  while (inside(root, cursor)) {
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info?.isSymbolicLink()) {
      const real = await realpath(cursor);
      if (!inside(realRoot, real)) throw Error(`${label} escapes project root through symlink: ${relative}`);
    }
    if (cursor === root) break;
    cursor = path.dirname(cursor);
  }
  let existing = path.dirname(absolute);
  while (true) {
    try { existing = await realpath(existing); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  if (!inside(realRoot, existing)) throw Error(`${label} escapes project root through symlink: ${relative}`);
  return absolute;
}

async function validateConfig(root, config, configPath) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error(`config must be a JSON object: ${configPath}`);
  if (Object.hasOwn(config, 'version') && (typeof config.version !== 'string' || !config.version.trim())) {
    throw Error(`config version must be a non-empty string: ${configPath}`);
  }
  if (Object.hasOwn(config, 'knowledgeRoots') && (!config.knowledgeRoots || typeof config.knowledgeRoots !== 'object' || Array.isArray(config.knowledgeRoots))) {
    throw Error(`config knowledgeRoots must be an object: ${configPath}`);
  }
  const effective = {
    ...defaultConfig,
    ...config,
    knowledgeRoots: { ...defaultConfig.knowledgeRoots, ...config.knowledgeRoots },
  };
  for (const [kind, relative] of Object.entries(effective.knowledgeRoots)) {
    if (typeof relative !== 'string' || !relative.trim()) throw Error(`config knowledgeRoots.${kind} must be a non-empty string: ${configPath}`);
    await assertSafeProjectPath(root, relative, `config knowledgeRoots.${kind}`);
  }
  for (const field of ['candidatesDir', 'publishLog']) {
    if (typeof effective[field] !== 'string' || !effective[field].trim()) throw Error(`config ${field} must be a non-empty string: ${configPath}`);
    await assertSafeProjectPath(root, effective[field], `config ${field}`);
  }
}

async function inspectAkeMarker(root, { allowMissingConfig = false } = {}) {
  const marker = path.join(root, '.ake');
  try { await lstat(marker); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw Error(`cannot inspect AKE marker ${marker}: ${error.message}`);
  }
  try { await assertSafeProjectPath(root, '.ake', 'AKE marker'); }
  catch (error) { throw Error(`unsafe AKE marker at ${marker}: ${error.message}; refusing parent-project fallback`); }
  let markerInfo;
  try { markerInfo = await stat(marker); }
  catch (error) { throw Error(`invalid AKE marker at ${marker}: ${error.message}; refusing parent-project fallback`); }
  if (!markerInfo.isDirectory()) throw Error(`invalid AKE marker at ${marker}: expected a directory; refusing parent-project fallback`);

  const configPath = path.join(marker, 'config.json');
  try { await assertSafeProjectPath(root, '.ake/config.json', 'AKE config'); }
  catch (error) { throw Error(`invalid AKE config at ${configPath}: ${error.message}; refusing parent-project fallback`); }
  let configInfo;
  try { configInfo = await stat(configPath); }
  catch (error) {
    if (error.code === 'ENOENT' && allowMissingConfig) return false;
    throw Error(`incomplete AKE marker at ${marker}: ${error.message}; refusing parent-project fallback`);
  }
  if (!configInfo.isFile()) throw Error(`invalid AKE config at ${configPath}: expected a regular file; refusing parent-project fallback`);
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { throw Error(`invalid AKE config at ${configPath}: ${error.message}; refusing parent-project fallback`); }
  try { await validateConfig(root, config, configPath); }
  catch (error) { throw Error(`invalid AKE config at ${configPath}: ${error.message}; refusing parent-project fallback`); }
  return true;
}

export async function loadConfig(root) {
  const file = path.resolve(root, '.ake/config.json');
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { ...defaultConfig, ...parsed, knowledgeRoots: { ...defaultConfig.knowledgeRoots, ...parsed.knowledgeRoots }, source: file, fallback: false };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...defaultConfig, source: file, fallback: true };
    throw Error(`invalid config ${file}: ${error.message}`);
  }
}

export function isGitWorkTree(dir) {
  const result = runGit(dir, ['rev-parse', '--is-inside-work-tree']);
  return result.status === 0 && result.stdout.trim() === 'true';
}

export async function resolveProjectRoot(cwd = process.cwd(), explicit) {
  let start;
  try { start = await realpath(path.resolve(cwd, explicit ?? '.')); }
  catch (error) { throw Error(`not a AKE project: cannot resolve project directory ${path.resolve(cwd, explicit ?? '.')}: ${error.message}`); }
  let workTree;
  const insideResult = runGit(start, ['rev-parse', '--is-inside-work-tree']);
  if (insideResult.status !== 0 || insideResult.stdout.trim() !== 'true') {
    if (explicit) throw Error(`not a AKE project: ${start} is not a valid Git work tree`);
    throw Error('not a AKE project: no .git repository found');
  }
  const topResult = runGit(start, ['rev-parse', '--show-toplevel']);
  if (topResult.status !== 0 || !topResult.stdout.trim()) throw Error(`not a AKE project: cannot resolve Git work tree root from ${start}`);
  try { workTree = await realpath(lineValue(topResult.stdout)); }
  catch (error) { throw Error(`not a AKE project: cannot resolve Git work tree root from ${start}: ${error.message}`); }
  if (!inside(workTree, start)) throw Error(`not a AKE project: Git reported a work tree root outside ${start}`);

  if (explicit) {
    const hasConfig = await inspectAkeMarker(start, { allowMissingConfig: true });
    if (!hasConfig) await validateConfig(start, {}, path.join(start, '.ake', 'config.json'));
    return start;
  }

  let candidate = start;
  while (inside(workTree, candidate)) {
    if (await inspectAkeMarker(candidate, { allowMissingConfig: candidate === workTree })) return candidate;
    if (candidate === workTree) break;
    candidate = path.dirname(candidate);
  }
  await validateConfig(workTree, {}, path.join(workTree, '.ake', 'config.json'));
  return workTree;
}

export function resolveKindTarget(root, config, kind, target, noteStatus) {
  const base = config.knowledgeRoots[kind];
  if (!base) throw Error(`unsupported knowledge kind: ${kind}`);
  const absolute = path.resolve(root, target);
  const rel = path.relative(path.resolve(root, base), absolute);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error(`target ${target} is outside configured ${kind} root ${base}`);
  if (!rel || path.basename(target) === 'README.md' || !target.toLowerCase().endsWith('.md')) throw Error(`target is not a knowledge document: ${target}`);
  if (kind === 'note') {
    const parts = rel.split(path.sep);
    if (parts.length < 3 || !['proposed', 'implemented', 'rejected'].includes(parts[0])) throw Error(`note target must be under ${base}/{lifecycle}/{class}/`);
    if (noteStatus && parts[0] !== noteStatus) throw Error(`note target lifecycle ${parts[0]} does not match body Status ${noteStatus}`);
    if (!['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'].includes(parts[1])) throw Error(`invalid Agent Note class: ${parts[1]}`);
  }
  return absolute;
}
