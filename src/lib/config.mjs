import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const defaultConfig = {
  version: '0.1.0',
  knowledgeRoots: { note: '.agents/notes', 'defensive-pattern': 'docs/defensive-patterns', postmortem: 'docs/postmortem', cookbook: 'docs/cookbook' },
  candidatesDir: '.ake/candidates', publishLog: '.ake/publish-log.jsonl',
};
export const kindRoot = kind => defaultConfig.knowledgeRoots[kind];
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
  const result = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() === 'true';
}
export async function resolveProjectRoot(cwd = process.cwd(), explicit) {
  const start = path.resolve(cwd, explicit ?? '.');
  const result = spawnSync('git', ['-C', start, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    if (explicit) throw Error(`not a AKE project: ${start} is not a valid Git work tree`);
    throw Error('not a AKE project: no .git repository found');
  }
  const top = spawnSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0 || !top.stdout.trim()) throw Error(`not a AKE project: cannot resolve Git work tree root from ${start}`);
  return path.resolve(top.stdout.trim());
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
