#!/usr/bin/env node
import path from 'node:path';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const bundledRoot = path.join(skillDir, 'resources', 'ake-source');
const bundledCli = path.join(bundledRoot, 'scripts', 'ake.mjs');
const requiredResources = [
  'package.json',
  'scripts/ake.mjs',
  'templates/project/AGENTS.md',
  'templates/project/notes/README.md',
  'templates/project/defensive-patterns/README.md',
  'templates/project/postmortem/README.md',
  'templates/project/cookbook/README.md',
  'src/lib/candidates.mjs',
  'src/lib/config.mjs',
  'src/lib/documents.mjs',
  'src/lib/frontmatter.mjs',
  'src/lib/fsx.mjs',
  'src/lib/init.mjs',
  'src/lib/publish.mjs',
  'src/lib/report.mjs',
  'src/lib/search.mjs',
];

function fail(message) {
  console.error(message);
  return 1;
}

function parseArgs(args) {
  let target;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--dir' && args[i + 1]) target = args[++i];
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!target) throw new Error('usage: node <absolute-skill-path>/bootstrap.mjs --dir <absolute-target> [--dry-run]');
  if (!path.isAbsolute(target)) throw new Error('--dir must be an absolute path; resolve it before invoking the Skill bootstrap');
  return { target, dryRun };
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return env;
}

function runGit(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanGitEnv() });
}

function findGitMarker(target) {
  let current = target;
  while (true) {
    const marker = path.join(current, '.git');
    try { return { path: marker, info: lstatSync(marker) }; }
    catch (error) {
      if (error.code !== 'ENOENT') return { path: marker, error };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [bundledCli, ...args], { encoding: 'utf8' });
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

function existingVersionMessage(configPath) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const bundled = JSON.parse(readFileSync(path.join(bundledRoot, 'package.json'), 'utf8'));
    if (typeof config.version !== 'string' || typeof bundled.version !== 'string') {
      return 'Cannot determine whether the installed AKE version matches the offline bundle: config or bundle metadata has no version. The project CLI was not executed; preserving existing files.';
    }
    if (config.version !== bundled.version) {
      return `Existing config version ${config.version} differs from bundled metadata version ${bundled.version}. The project CLI was not executed, so its own version cannot be determined; preserving existing config and CLI without reinstalling or upgrading.`;
    }
    return `Existing config version ${config.version} matches bundled metadata version ${bundled.version}; the project CLI version cannot be independently verified without executing it. Preserving existing config and CLI without reinstalling or upgrading.`;
  } catch {
    return 'Cannot determine whether the installed AKE version matches the offline bundle: config or bundle metadata is unavailable or invalid. The project CLI was not executed; preserving existing files.';
  }
}

function reportChild(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    return fail(error.message);
  }

  let target;
  try {
    target = realpathSync(options.target);
    if (!statSync(target).isDirectory()) return fail(`target is not a directory: ${options.target}`);
  } catch (error) {
    return fail(`target directory is unavailable: ${options.target} (${error.message})`);
  }

  // Refuse before inspecting or writing project files unless target belongs to a valid work tree.
  const gitVersion = runGit(['--version']);
  if (gitVersion.error || gitVersion.status !== 0) {
    return fail(`Git is unavailable; cannot verify ${target}. No files were written and bootstrap will not initialize a repository.`);
  }
  const inside = runGit(['-C', target, 'rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    const bare = runGit(['-C', target, 'rev-parse', '--is-bare-repository']);
    if (bare.status === 0 && bare.stdout.trim() === 'true') {
      return fail(`BARE_REPOSITORY: target is a bare Git repository, not a work tree: ${target}. Select a non-bare work tree; no files were written.`);
    }
    const marker = findGitMarker(target);
    if (marker?.error) return fail(`GIT_METADATA_UNAVAILABLE: cannot inspect ${marker.path} (${marker.error.message}); no files were written.`);
    if (marker) return fail(`GIT_METADATA_INVALID: ${marker.path} exists but Git could not verify a work tree; inspect it manually; no files were written.`);
    if (inside.status !== 0 && /not a git repository/i.test(inside.stderr ?? '')) {
      return fail(`NOT_GIT_WORKTREE: ${target} is not inside a Git work tree. Bootstrap did not run git init and wrote no project files.`);
    }
    return fail(`GIT_VERIFY_FAILED: Git could not verify ${target} as a work tree (rev-parse failed or reported no work tree). Do not treat this as a new project; no files were written.`);
  }
  const rootResult = runGit(['-C', target, 'rev-parse', '--show-toplevel']);
  if (rootResult.status !== 0 || !rootResult.stdout.trim()) {
    return fail(`Git could not resolve the work-tree root for ${target}; no files were written.`);
  }
  let gitRoot;
  try { gitRoot = realpathSync(rootResult.stdout.replace(/\r?\n$/, '')); }
  catch { return fail(`cannot resolve Git work-tree root for ${target}; no files were written.`); }
  const relativeToRoot = path.relative(gitRoot, target);
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    return fail(`Git reported an inconsistent work-tree root for ${target}; no files were written.`);
  }

  const configPath = path.join(target, '.ake', 'config.json');
  const cliPath = path.join(target, '.ake', 'tools', 'scripts', 'ake.mjs');
  const configState = inspectProjectFile(target, '.ake/config.json');
  const cliState = inspectProjectFile(target, '.ake/tools/scripts/ake.mjs');
  for (const state of [configState, cliState]) {
    if (state.kind === 'invalid') return fail(`EXISTING_PATH_INVALID: refusing to initialize because ${state.path} is unsafe or not a regular project file (${state.reason}); no project files were written.`);
    if (state.kind === 'error') return fail(`EXISTING_PATH_UNAVAILABLE: cannot inspect ${state.path} (${state.reason}); no project files were written.`);
  }
  if (configState.kind === 'present' && cliState.kind === 'present') {
    console.log(`AKE bootstrap already exists in ${target}. ${existingVersionMessage(configPath)}`);
    return 0;
  }
  if (configState.kind !== cliState.kind) {
    return fail(`PARTIAL_INITIALIZATION: ${configState.path} is ${configState.kind} and ${cliState.path} is ${cliState.kind}; back up and review this project before initializing; no project files were written.`);
  }

  const missing = requiredResources.filter((relative) => {
    try { return !statSync(path.join(bundledRoot, relative)).isFile(); }
    catch { return true; }
  });
  if (missing.length) {
    return fail(`Skill bootstrap resources are incomplete; missing files:\n${missing.map((file) => `  ${path.join(bundledRoot, file)}`).join('\n')}\nRestore/update the ake Skill from an official AKE source checkout using the README installation instructions, then retry. No project files were written.`);
  }

  const preview = runCli(['init', '--dir', target, '--dry-run', '--json']);
  if (preview.error) {
    reportChild(preview);
    return fail(`bundled AKE init dry-run failed: ${preview.error.message}; no project files were written.`);
  }
  let plan;
  try { plan = JSON.parse(preview.stdout); }
  catch {
    reportChild(preview);
    return fail('bundled AKE init returned invalid dry-run JSON; no project files were written.');
  }
  console.log(JSON.stringify(plan, null, 2));
  if (plan.conflicts?.length) return fail('bootstrap stopped: resolve every reported init conflict before retrying; no project files were written.');
  if (preview.status !== 0) return fail('bundled AKE init dry-run failed; no project files were written.');
  if (options.dryRun) return 0;

  const applied = runCli(['init', '--dir', target, '--json']);
  reportChild(applied);
  return applied.error ? fail(`bundled AKE init failed: ${applied.error.message}`) : (applied.status ?? 1);
}

process.exitCode = await main();
