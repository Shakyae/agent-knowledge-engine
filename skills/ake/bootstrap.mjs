#!/usr/bin/env node
import path from 'node:path';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  if (!target) throw new Error('usage: node <absolute-skill-path>/bootstrap.mjs --dir <absolute-Git-project> [--dry-run]');
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

function runCli(args) {
  return spawnSync(process.execPath, [bundledCli, ...args], { encoding: 'utf8' });
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
      return fail(`target is a bare Git repository, not a work tree: ${target}. Select a non-bare work tree; no files were written.`);
    }
    if (inside.status !== 0 && /not a git repository/i.test(inside.stderr ?? '')) {
      return fail(`not a Git work tree: ${target}. Ask the user to select or initialize a Git project; bootstrap performs zero writes and never runs git init.`);
    }
    return fail(`Git could not verify ${target} as a work tree (rev-parse failed or reported no work tree). Do not treat this as a new project; no files were written.`);
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
  const hasConfig = existsSync(configPath) && statSync(configPath).isFile();
  const hasCli = existsSync(cliPath) && statSync(cliPath).isFile();
  if (hasConfig && hasCli) {
    console.log(`AKE bootstrap already exists in ${target}. ${existingVersionMessage(configPath)}`);
    return 0;
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
