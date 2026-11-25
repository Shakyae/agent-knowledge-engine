#!/usr/bin/env node
import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function nodeVersionFailure(value = process.versions.node) {
  const version = value;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  const current = match ? match.slice(1, 4).map(Number) : null;
  let supported = Boolean(current && current.every(Number.isSafeInteger) && !match[4]);
  if (supported) {
    const minimum = [22, 20, 0];
    for (let index = 0; index < minimum.length; index++) {
      if (current[index] !== minimum[index]) { supported = current[index] > minimum[index]; break; }
    }
  }
  return supported ? null : `Unsupported Node.js version ${version}; AKE requires Node.js >=22.20.0. Upgrade the Node.js runtime used by AKE and rerun. No AKE operation was started.`;
}

function fail(code, message) {
  console.error(`${code}: ${message}`);
  return 1;
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return env;
}

function runGit(target, args, env) {
  return spawnSync('git', ['-C', target, ...args], { encoding: 'utf8', env });
}

export function samePath(left, right, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const normalize = value => pathApi.resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
  // Never case-fold: Windows directories may have case-sensitive semantics enabled.
  return normalize(left) === normalize(right);
}

function directoryIdentity(target) {
  const info = lstatSync(target, { bigint: true });
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`target is not a real directory: ${target}`);
  const identity = {
    device: info.dev.toString(),
    inode: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
  if (identity.device === '0' || identity.inode === '0' || identity.birthtimeNs === '0') throw new Error('filesystem does not expose a usable directory device/inode/birthtime identity');
  return identity;
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs);
}

function parseIdentity(value) {
  if (typeof value !== 'string') return null;
  const [device, inode, birthtimeNs, extra] = value.split(':');
  if (extra !== undefined || !/^\d+$/.test(device ?? '') || !/^\d+$/.test(inode ?? '') || !/^\d+$/.test(birthtimeNs ?? '') || device === '0' || inode === '0' || birthtimeNs === '0') return null;
  return { device, inode, birthtimeNs };
}

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function findGitMarker(target) {
  let current = target;
  while (true) {
    const marker = path.join(current, '.git');
    try { lstatSync(marker); return { path: marker }; }
    catch (error) {
      if (error.code !== 'ENOENT') return { path: marker, error };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function inspectGit(target, env) {
  const version = spawnSync('git', ['--version'], { encoding: 'utf8', env });
  if (version.error) return { error: { code: 'GIT_UNAVAILABLE', message: version.error.message } };
  if (version.status !== 0) return { error: { code: 'GIT_UNAVAILABLE', message: version.stderr.trim() || `git --version exited ${version.status}` } };

  const inside = runGit(target, ['rev-parse', '--is-inside-work-tree'], env);
  if (inside.error) return { error: { code: 'GIT_PROBE_FAILED', message: inside.error.message } };
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    const bare = runGit(target, ['rev-parse', '--is-bare-repository'], env);
    if (bare.error || bare.status !== 0 || bare.stdout.trim() !== 'false') {
      return { error: { code: 'GIT_PROBE_FAILED', message: bare.error?.message ?? bare.stderr.trim() ?? 'cannot confirm non-bare work tree' } };
    }
    const top = runGit(target, ['rev-parse', '--show-toplevel'], env);
    if (top.error || top.status !== 0 || !top.stdout.trim()) {
      return { error: { code: 'GIT_ROOT_UNRESOLVED', message: top.error?.message ?? top.stderr.trim() ?? 'git returned no work-tree root' } };
    }
    let root;
    try { root = realpathSync(top.stdout.trim()); }
    catch (error) { return { error: { code: 'GIT_ROOT_UNRESOLVED', message: error.message } }; }
    if (!within(root, target)) return { error: { code: 'GIT_ROOT_MISMATCH', message: `Git root ${root} does not contain ${target}` } };
    return { kind: samePath(root, target) ? 'worktree' : 'parent-worktree', root };
  }

  const bare = runGit(target, ['rev-parse', '--is-bare-repository'], env);
  if (bare.status === 0 && bare.stdout.trim() === 'true') return { error: { code: 'BARE_REPOSITORY', message: `target belongs to bare repository: ${target}` } };
  if (bare.error) return { error: { code: 'GIT_PROBE_FAILED', message: bare.error.message } };

  const insideGitDir = runGit(target, ['rev-parse', '--is-inside-git-dir'], env);
  if (insideGitDir.status === 0 && insideGitDir.stdout.trim() === 'true') {
    return { error: { code: 'GIT_METADATA_INVALID', message: `target is inside Git metadata, not a work tree: ${target}` } };
  }
  if (insideGitDir.error) return { error: { code: 'GIT_PROBE_FAILED', message: insideGitDir.error.message } };

  const marker = findGitMarker(target);
  if (marker?.error) return { error: { code: 'GIT_METADATA_UNAVAILABLE', message: `cannot inspect ${marker.path}: ${marker.error.message}` } };
  if (marker) return { error: { code: 'GIT_METADATA_INVALID', message: `${marker.path} exists but Git could not verify a work tree; inspect it manually` } };
  if (inside.status !== 0 && /not a git repository/i.test(inside.stderr ?? '')) return { kind: 'non-repository' };
  return { error: { code: 'GIT_VERIFY_FAILED', message: inside.stderr.trim() || `git rev-parse exited ${inside.status}` } };
}

function parseArgs(args) {
  let target;
  let inspectOnly = false;
  let expectedIdentity;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dir' && args[index + 1]) target = args[++index];
    else if (args[index] === '--inspect') inspectOnly = true;
    else if (args[index] === '--expected-identity' && args[index + 1]) expectedIdentity = parseIdentity(args[++index]);
    else throw new Error(`unknown or incomplete argument: ${args[index]}`);
  }
  if (!target || !path.isAbsolute(target)) throw new Error('usage: node <absolute-skill-path>/init-git.mjs --dir <absolute-target> [--inspect] [--expected-identity <device:inode:birthtimeNs>]');
  if (inspectOnly && expectedIdentity) throw new Error('--inspect is read-only and does not accept an expected identity');
  if (!inspectOnly && !expectedIdentity) throw new Error('initialization requires --expected-identity copied from a fresh --inspect result; this is a path-binding check, not authorization');
  return { target, inspectOnly, expectedIdentity };
}

function main() {
  const versionError = nodeVersionFailure();
  if (versionError) return fail('NODE_VERSION', versionError);
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { return fail('USAGE', error.message); }

  let target;
  let observedIdentity;
  try {
    target = realpathSync(options.target);
    if (!options.inspectOnly && !samePath(target, options.target)) return fail('NON_CANONICAL_TARGET', `pass the canonical target path exactly: ${target}`);
    observedIdentity = directoryIdentity(target);
  } catch (error) {
    return fail('TARGET_UNAVAILABLE', `cannot resolve target ${options.target}: ${error.message}`);
  }
  if (!options.inspectOnly && !sameIdentity(observedIdentity, options.expectedIdentity)) {
    return fail('TARGET_IDENTITY_CHANGED', `the canonical target directory no longer has the identity returned by the preceding inspect; no Git command or write was attempted: ${target}`);
  }

  const env = cleanGitEnv();
  const state = inspectGit(target, env);
  let identityAfterProbe;
  try { identityAfterProbe = directoryIdentity(target); }
  catch (error) { return fail('TARGET_IDENTITY_CHANGED', `cannot revalidate the inspected directory: ${error.message}`); }
  if (!sameIdentity(observedIdentity, identityAfterProbe)) {
    return fail('TARGET_IDENTITY_CHANGED', `target directory changed during Git inspection; no git init was attempted: ${target}`);
  }
  if (state.error) return fail(state.error.code, state.error.message);
  if (state.kind !== 'non-repository') {
    console.log(JSON.stringify({ status: `already-${state.kind}`, target, workTreeRoot: state.root, identity: observedIdentity, gitInitRan: false }));
    return 0;
  }
  if (options.inspectOnly) {
    console.log(JSON.stringify({ status: 'non-repository', target, identity: observedIdentity, gitInitRan: false }));
    return 0;
  }

  const beforeInit = inspectGit(target, env);
  if (beforeInit.error) return fail(beforeInit.error.code, `state changed before git init: ${beforeInit.error.message}`);
  let identityBeforeSpawn;
  try { identityBeforeSpawn = directoryIdentity(target); }
  catch (error) { return fail('TARGET_IDENTITY_CHANGED', `cannot revalidate target immediately before git init: ${error.message}`); }
  if (!sameIdentity(observedIdentity, identityBeforeSpawn)) {
    return fail('TARGET_IDENTITY_CHANGED', `target directory changed before git init; no git init was attempted: ${target}`);
  }
  if (beforeInit.kind !== 'non-repository') {
    console.log(JSON.stringify({ status: `already-${beforeInit.kind}`, target, workTreeRoot: beforeInit.root, identity: observedIdentity, gitInitRan: false }));
    return 0;
  }

  // This final probe narrows, but cannot eliminate, an external TOCTOU race. Git init has no
  // atomic create-only mode; only one writer may operate on this target during this interval.
  let identityAtSpawn;
  try { identityAtSpawn = directoryIdentity(target); }
  catch (error) { return fail('TARGET_IDENTITY_CHANGED', `cannot revalidate target immediately before git init: ${error.message}`); }
  if (!sameIdentity(observedIdentity, identityAtSpawn)) {
    return fail('TARGET_IDENTITY_CHANGED', `target directory changed immediately before git init; no git init was attempted: ${target}`);
  }
  const initialized = spawnSync('git', ['-C', target, 'init'], { encoding: 'utf8', env });
  const initOutput = `${initialized.stdout ?? ''}\n${initialized.stderr ?? ''}`;
  if (initialized.error || initialized.status !== 0 || /reinitializ(?:ed|ing).*existing git repository/i.test(initOutput)) {
    const detail = initialized.error?.message ?? (initOutput.trim() || `git init exited ${initialized.status}`);
    return fail('GIT_INIT_RESULT_UNKNOWN', `${detail}; preserve the current .git state, do not retry automatically, and do not apply AKE files.`);
  }

  let identityAfterInit;
  try { identityAfterInit = directoryIdentity(target); }
  catch (error) { return fail('GIT_INIT_VERIFY_FAILED', `target identity could not be rechecked after git init: ${error.message}; preserve .git and stop.`); }
  if (!sameIdentity(observedIdentity, identityAfterInit)) {
    return fail('GIT_INIT_VERIFY_FAILED', `target identity changed during git init; preserve .git and stop without AKE bootstrap: ${target}`);
  }
  const verified = inspectGit(target, env);
  if (verified.error || verified.kind !== 'worktree') {
    return fail('GIT_INIT_VERIFY_FAILED', `${verified.error?.message ?? `Git root is ${verified.root}, not the exact target`}; preserve the current .git state and stop without AKE bootstrap.`);
  }
  const symbolic = runGit(target, ['symbolic-ref', '--quiet', 'HEAD'], env);
  const branch = symbolic.stdout.trim();
  const head = runGit(target, ['rev-parse', '--verify', 'HEAD'], env);
  const branchRef = /^refs\/heads\/[^\s]+$/.test(branch)
    ? runGit(target, ['show-ref', '--verify', '--quiet', branch], env)
    : null;
  if (symbolic.error || symbolic.status !== 0 || !branchRef || branchRef.error || branchRef.status !== 1 || head.error || head.status === 0) {
    return fail('GIT_INIT_VERIFY_FAILED', 'new repository is not in the expected unborn-branch state; preserve the current .git state and stop without AKE bootstrap.');
  }

  console.log(JSON.stringify({ status: 'initialized', target, workTreeRoot: verified.root, identity: observedIdentity, unborn: true, gitInitRan: true }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
