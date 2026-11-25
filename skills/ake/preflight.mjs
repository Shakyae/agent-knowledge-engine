#!/usr/bin/env node
import path from 'node:path';
import { lstatSync, realpathSync, statSync } from 'node:fs';
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

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--dir' || !path.isAbsolute(args[1])) {
    throw new Error('usage: node <absolute-skill-path>/preflight.mjs --dir <absolute-project-directory>');
  }
  return args[1];
}

function inspectProjectFile(root, relative) {
  const parts = relative.split(/[\\/]/);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); }
    catch (error) {
      if (error.code === 'ENOENT') return { kind: 'missing', path: current };
      if (error.code === 'ENOTDIR') return { kind: 'invalid', path: current, reason: 'an ancestor is not a directory' };
      return { kind: 'error', path: current, reason: error.message };
    }
    if (stat.isSymbolicLink()) return { kind: 'invalid', path: current, reason: 'symbolic links are not accepted for project config/CLI paths' };
    const last = index === parts.length - 1;
    if (!last && !stat.isDirectory()) return { kind: 'invalid', path: current, reason: 'an ancestor is not a directory' };
    if (last && !stat.isFile()) return { kind: 'invalid', path: current, reason: 'entry is not a regular file' };
  }
  return { kind: 'present', path: current };
}

const LEGACY_NO_GIT_ERROR = 'not a AKE project: no .git repository found';
const CURRENT_NO_GIT_ERROR = `NOT_GIT_WORKTREE: ${LEGACY_NO_GIT_ERROR}`;

function knownNoGitStatusFailure(result) {
  const stderr = (result.stderr ?? '').replace(/\r\n/g, '\n').trim();
  const stdout = (result.stdout ?? '').replace(/\r\n/g, '\n').trim();
  if (stderr && stdout) return false;
  if (stderr) return stderr === LEGACY_NO_GIT_ERROR || stderr === CURRENT_NO_GIT_ERROR;
  if (!stdout) return false;
  try {
    const parsed = JSON.parse(stdout);
    const keys = Object.keys(parsed ?? {}).sort();
    const exactShape = keys.join(',') === 'error,errors,ok,warnings' && parsed.ok === false && parsed.errors === 1 && parsed.warnings === 0;
    return exactShape && (parsed.error === LEGACY_NO_GIT_ERROR || parsed.error === CURRENT_NO_GIT_ERROR);
  } catch {
    return stdout === LEGACY_NO_GIT_ERROR || stdout === CURRENT_NO_GIT_ERROR;
  }
}

function inspectGitIndependently(target) {
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'init-git.mjs');
  try {
    const helperInfo = lstatSync(helper);
    if (!helperInfo.isFile() || helperInfo.isSymbolicLink()) return { error: { code: 'GIT_INSPECT_HELPER_UNAVAILABLE', message: 'trusted Skill Git inspector is not a regular file' } };
  } catch (error) {
    return { error: { code: 'GIT_INSPECT_HELPER_UNAVAILABLE', message: error.message } };
  }

  const result = spawnSync(process.execPath, [helper, '--dir', target, '--inspect'], {
    cwd: target,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024,
    timeout: 30_000,
  });
  if (result.error) return { error: { code: 'GIT_INSPECT_FAILED', message: result.error.message } };
  if (result.status !== 0) {
    const message = (result.stderr ?? '').trim();
    const code = message.match(/^([A-Z][A-Z0-9_]+):/)?.[1] ?? 'GIT_INSPECT_FAILED';
    return { error: { code, message: message || `trusted Git inspector exited ${result.status}` } };
  }

  let report;
  try { report = JSON.parse(result.stdout); }
  catch { return { error: { code: 'GIT_INSPECT_FAILED', message: 'trusted Git inspector returned invalid JSON' } }; }
  if (!report || typeof report !== 'object' || Array.isArray(report) || report.target !== target || !['non-repository', 'already-worktree', 'already-parent-worktree'].includes(report.status)) {
    return { error: { code: 'GIT_INSPECT_FAILED', message: 'trusted Git inspector returned an unexpected target or status' } };
  }
  return { status: report.status, root: report.workTreeRoot };
}

function main() {
  const versionError = nodeVersionFailure();
  if (versionError) return fail('NODE_VERSION', versionError);
  let requested;
  try { requested = parseArgs(process.argv.slice(2)); }
  catch (error) { return fail('USAGE', error.message); }

  let target;
  try {
    target = realpathSync(requested);
    if (!statSync(target).isDirectory()) return fail('TARGET_NOT_DIRECTORY', `target is not a directory: ${requested}`);
  } catch (error) {
    return fail('TARGET_UNAVAILABLE', `cannot resolve target directory ${requested}: ${error.message}`);
  }

  const configState = inspectProjectFile(target, '.ake/config.json');
  const cliState = inspectProjectFile(target, '.ake/tools/scripts/ake.mjs');
  for (const state of [configState, cliState]) {
    if (state.kind === 'invalid') return fail('PROJECT_FILE_INVALID', `refusing preflight because ${state.path} is unsafe or not a regular project file (${state.reason}).`);
    if (state.kind === 'error') return fail('PROJECT_FILE_UNAVAILABLE', `cannot inspect ${state.path} (${state.reason}).`);
  }
  if (configState.kind === 'missing' && cliState.kind === 'missing') return fail('NOT_INITIALIZED', `project config and CLI are missing under ${target}; use the Skill bootstrap preview.`);
  if (configState.kind !== cliState.kind) return fail('PARTIAL_INITIALIZATION', `${configState.path} is ${configState.kind} and ${cliState.path} is ${cliState.kind}; review the existing project before proceeding.`);
  const cli = cliState.path;

  // Keep the target fixed and pass one inherited environment snapshot to status.
  const env = { ...process.env };
  const result = spawnSync(process.execPath, [cli, 'status', '--json'], {
    cwd: target,
    env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') return fail('STATUS_TIMEOUT', 'existing project CLI status --json exceeded the 30-second limit.');
    if (result.error.code === 'ENOBUFS') return fail('STATUS_OUTPUT_TOO_LARGE', 'existing project CLI status --json exceeded the 1 MiB output limit.');
    return fail('STATUS_LAUNCH_FAILED', `could not run the existing project CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const rawDetail = (result.stderr || result.stdout || '').replace(/\r\n/g, '\n').trim();
    const detail = rawDetail.slice(0, 500);
    const exit = result.status === null ? `by signal ${result.signal ?? 'unknown'}` : `with exit code ${result.status}`;
    if (result.signal || result.status !== 1) {
      return fail('STATUS_FAILED', `existing project CLI status --json exited ${exit}${detail ? `: ${detail}` : ''}; independent Git inspection was not run because this was not the expected ordinary status failure. Do not initialize Git.`);
    }
    if (!knownNoGitStatusFailure(result)) {
      return fail('STATUS_FAILED', `existing project CLI status --json exited ${exit}${detail ? `: ${detail}` : ''}; output did not exactly match a supported legacy/current no-Git diagnostic, so independent Git inspection was not run. Do not initialize Git.`);
    }
    const git = inspectGitIndependently(target);
    if (git.error) {
      const next = git.error.code === 'GIT_UNAVAILABLE'
        ? 'Git is unavailable; restore/install Git and rerun preflight. Do not offer initialization.'
        : 'Independent Git inspection failed or found abnormal metadata; do not offer initialization.';
      return fail(git.error.code, `existing project CLI status --json exited ${exit}${detail ? `: ${detail}` : ''}. Trusted Git inspection: ${git.error.message}. ${next}`);
    }
    if (git.status === 'non-repository') {
      return fail('NOT_GIT_WORKTREE', `existing AKE files remain untouched; status matched a supported legacy/current no-Git diagnostic and independent Git inspection confirmed no repository at ${target}. Use the Skill Git-selection flow only if the user chooses it; after success, rerun preflight, not bootstrap apply.`);
    }
    return fail('STATUS_FAILED', `existing project CLI status --json exited ${exit}${detail ? `: ${detail}` : ''}; independent Git inspection found a valid ${git.status} (${git.root}), contradicting the no-Git diagnostic. Do not initialize Git.`);
  }

  let report;
  try { report = JSON.parse(result.stdout); }
  catch { return fail('STATUS_INVALID_JSON', 'existing project CLI status --json did not return valid JSON on stdout.'); }
  if (!report || typeof report !== 'object' || Array.isArray(report)) return fail('STATUS_INVALID_JSON', 'existing project CLI status --json did not return a JSON object.');
  if (typeof report.project !== 'string' || !report.project.trim()) return fail('PROJECT_FIELD_MISSING', 'status JSON has no non-empty project path; target identity cannot be checked.');
  if (!path.isAbsolute(report.project)) return fail('PROJECT_PATH_RELATIVE', `status reported a relative project path ${JSON.stringify(report.project)}; an absolute path is required.`);

  let reportedProject;
  try {
    reportedProject = realpathSync(report.project);
    if (!statSync(reportedProject).isDirectory()) throw new Error('reported project is not a directory');
  } catch (error) {
    return fail('PROJECT_PATH_UNRESOLVABLE', `status reported project ${JSON.stringify(report.project)}, but it cannot be resolved: ${error.message}`);
  }
  if (reportedProject !== target) return fail('PROJECT_MISMATCH', `status resolved to ${reportedProject}, not the requested target ${target}; stop before any write.`);
  console.log(`PROJECT_OK: existing CLI status --json resolved to the requested project ${target}. This verifies project selection only; it does not verify any task command.`);
  return 0;
}

process.exitCode = main();
