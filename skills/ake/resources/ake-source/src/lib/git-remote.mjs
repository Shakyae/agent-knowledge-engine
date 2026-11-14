import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/i;

export function resolveOfficialSource(repoUrl) {
  let url;
  try { url = new URL(repoUrl); } catch { throw new Error('repository URL is missing or invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('repository URL is not an official HTTPS GitHub URL');
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match || match[1].includes('..') || match[2].includes('..')) throw new Error('repository URL must identify one GitHub owner/repository');
  return { sourceUrl: `https://github.com/${match[1]}/${match[2]}.git`, repo: `${match[1]}/${match[2]}` };
}

function cleanGitEnv(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) if (key.startsWith('GIT_')) delete result[key];
  Object.assign(result, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_ALLOW_PROTOCOL: 'https:file',
  });
  return result;
}

async function git(args, options = {}) {
  const { env = process.env, ...execOptions } = options;
  return execFileAsync('git', ['-c', 'http.followRedirects=false', '-c', 'credential.helper=', '-c', 'credential.interactive=never', ...args], {
    ...execOptions, cwd: os.tmpdir(), env: cleanGitEnv(env), timeout: execOptions.timeout ?? 60_000,
    maxBuffer: execOptions.maxBuffer ?? 8 * 1024 * 1024, windowsHide: execOptions.windowsHide ?? true,
  });
}

export async function resolveRemote({ repoUrl, gitRunner = git, tempDirectory = os.tmpdir() } = {}) {
  const { sourceUrl, repo } = resolveOfficialSource(repoUrl);
  let head;
  try { ({ stdout: head } = await gitRunner(['ls-remote', '--symref', sourceUrl, 'HEAD'])); }
  catch (error) { throw Object.assign(new Error(`cannot resolve remote HEAD: ${error.message}`), { code: 'REMOTE' }); }
  const lines = head.trim().split(/\r?\n/).filter(Boolean);
  const symbolic = lines.filter(line => line.startsWith('ref: '));
  const hashes = lines.filter(line => !line.startsWith('ref: '));
  const refMatch = symbolic.length === 1 && symbolic[0].match(/^ref: refs\/heads\/([^\s]+)\s+HEAD$/);
  const shaMatch = hashes.length === 1 && hashes[0].match(/^([0-9a-f]{40})\s+HEAD$/i);
  if (!refMatch || !shaMatch) throw Object.assign(new Error('remote HEAD response is ambiguous or invalid'), { code: 'REMOTE' });
  const defaultBranch = refMatch[1];
  const targetCommit = shaMatch[1].toLowerCase();
  const tempRoot = await mkdtemp(path.join(tempDirectory, 'ake-update-'));
  const bare = path.join(tempRoot, 'remote.git');
  try {
    await gitRunner(['init', '--bare', bare]);
    await gitRunner(['--git-dir', bare, 'fetch', '--no-tags', '--no-recurse-submodules', sourceUrl, targetCommit]);
    let fetched;
    ({ stdout: fetched } = await gitRunner(['--git-dir', bare, 'rev-parse', 'FETCH_HEAD^{commit}']));
    if (!SHA.test(fetched.trim()) || fetched.trim().toLowerCase() !== targetCommit) throw new Error('fetched object does not match advertised commit');
    let listing;
    ({ stdout: listing } = await gitRunner(['--git-dir', bare, 'ls-tree', '-r', '-z', '--full-tree', targetCommit, '--', 'skills/ake']));
    const entries = [];
    for (const record of listing.split('\0').filter(Boolean)) {
      const tab = record.indexOf('\t');
      const [mode, type, object] = record.slice(0, tab).split(' ');
      const relativePath = record.slice(tab + 1).replace(/^skills\/ake\//, '');
      let bytes = null;
      if (type === 'blob') ({ stdout: bytes } = await gitRunner(['--git-dir', bare, 'cat-file', 'blob', object], { encoding: 'buffer' }));
      entries.push({ relativePath, mode, type, object, bytes });
    }
    return { sourceUrl, repo, defaultBranch, targetCommit, entries }; 
  } catch (error) {
    throw Object.assign(new Error(`cannot fetch or verify remote commit: ${error.message}`), { code: 'REMOTE' });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export { SHA as FULL_SHA };
export async function runGit(args, options) { return git(args, options); }
export async function withGitTempDirectory(fn) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ake-git-'));
  try { return await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
