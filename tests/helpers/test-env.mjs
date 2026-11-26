import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const CONTROLLED_ENV_KEYS = /^(DSH_AGENTS_HOME|GIT_.*|npm_config_.*|CLAUDE_CONFIG_DIR|CODEX_HOME|VIBE_HOME|HERMES_HOME|AUTOHAND_HOME|GROK_HOME|SARVAM_HOME|REASONIX_HOME|FLATPAK_XDG_CONFIG_HOME|XDG_CONFIG_HOME)$/i;

export function cleanTestEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (CONTROLLED_ENV_KEYS.test(key)) delete env[key];
  return { ...env, ...overrides };
}

export function assertOutsideGitWorkTree(directory) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory, encoding: 'utf8', env: cleanTestEnv() });
  if (result.status === 0 && result.stdout.trim() === 'true') throw new Error(`test fixture unexpectedly belongs to a Git work tree: ${directory}`);
}

export async function tempRoot(prefix = 'ake-test-') {
  const temp = await realpath(os.tmpdir());
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: temp, encoding: 'utf8', env: cleanTestEnv() });
  if (probe.status === 0 && probe.stdout.trim() === 'true') throw new Error('TMPDIR points inside a Git work tree; unset TMPDIR or point it outside any repository');
  const directory = await mkdtemp(path.join(temp, prefix));
  assertOutsideGitWorkTree(directory);
  return realpath(directory);
}

// Keep the runner and every inherited CLI child isolated from caller-specific routing/config state.
for (const key of Object.keys(process.env)) if (CONTROLLED_ENV_KEYS.test(key)) delete process.env[key];
const temp = await realpath(os.tmpdir());
const tmpProbe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: temp, encoding: 'utf8', env: cleanTestEnv() });
if (tmpProbe.status === 0 && tmpProbe.stdout.trim() === 'true') throw new Error('TMPDIR points inside a Git work tree; unset TMPDIR or point it outside any repository');
