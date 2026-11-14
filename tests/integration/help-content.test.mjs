import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skill = path.join(repo, 'skills/ake/SKILL.md');
const cli = path.join(repo, 'scripts/ake.mjs');

function helpSection(markdown) {
  const start = markdown.indexOf('# AKE 使用帮助与入口路由');
  assert.notEqual(start, -1, 'SKILL.md must contain the Chinese help section');
  const end = markdown.indexOf('# AKE knowledge operations', start);
  assert.ok(end > start, 'help section must end before the knowledge-operations section');
  return markdown.slice(start, end);
}

function usageSubcommands() {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const commands = new Set();
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^ake ([a-z][a-z-]*)/);
    if (match) commands.add(match[1]);
  }
  return commands;
}

test('help shows the supported status JSON form', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ake status \[--json\]$/m);
});

test('/ake and /ake help both display help instead of starting knowledge capture', async () => {
  const section = helpSection(await readFile(skill, 'utf8'));
  assert.match(section, /`\/ake`[^\n]*显示使用帮助/);
  assert.match(section, /`\/ake help`[^\n]*显示使用帮助/);
  assert.match(section, /不解释为知识沉淀任务/);
  assert.match(section, /不扫描当前 Session/);
  assert.match(section, /不自动检索/);
  assert.match(section, /不创建候选/);
});

test('help separates Skill commands from terminal CLI commands', async () => {
  const section = helpSection(await readFile(skill, 'utf8'));
  assert.match(section, /## A\. Skill 日常命令/);
  assert.match(section, /## B\. CLI 安装与项目初始化/);
  assert.match(section, /## C\. 知识管理能力/);
  assert.match(section, /在对话中使用/);
  assert.match(section, /在终端使用/);
  assert.match(section, /宿主只把 `\/ake` token 交给本 Skill/);
});

test('help documents ake init as current-directory initialization with optional --dir', async () => {
  const section = helpSection(await readFile(skill, 'utf8'));
  assert.match(section, /`ake init`\s*\|\s*初始化当前工作目录/);
  assert.match(section, /`ake init --dir <project>`\s*\|\s*初始化指定目录/);
  assert.doesNotMatch(section, /`ake init --dir <project>`[^|\n]*（必填）|--dir 为必填/);
});

test('help keeps the existing install/link/doctor commands out of the command tables', async () => {
  const section = helpSection(await readFile(skill, 'utf8'));
  const commandLines = section.split('\n').filter((line) => /^\|\s*`|^-\s*`/.test(line));
  for (const line of commandLines) {
    assert.doesNotMatch(line, /`ake (install|link|doctor)\b/, `help must not advertise a nonexistent command: ${line}`);
    assert.doesNotMatch(line, /`\/ake (install|link|doctor)\b/, `help must not advertise a nonexistent Skill entry: ${line}`);
  }
  assert.match(section, /npx skills add Shakyae\/agent-knowledge-engine@<完整commit> --skill ake -g/);
});

test('every ake subcommand named in the help exists in the real CLI usage', async () => {
  const section = helpSection(await readFile(skill, 'utf8'));
  const commands = usageSubcommands();
  const named = new Set([...section.matchAll(/`ake ([a-z][a-z-]*)/g)].map((match) => match[1]));
  assert.ok(named.size >= 3, `expected several documented subcommands, got ${[...named].join(', ')}`);
  for (const command of named) {
    assert.ok(commands.has(command), `help documents "ake ${command}" but the CLI does not implement it`);
  }
  assert.ok(commands.has('update'), 'CLI usage must include update');
  assert.ok(commands.has('status'), 'CLI usage must include status');
  assert.ok(commands.has('init'), 'CLI usage must include init');
});

test('help explains the update entry point, reload behavior and the install/init/daily distinction', async () => {
  const section = helpSection(await readFile(skill, 'utf8'));
  assert.match(section, /resources\/ake-source\/scripts\/ake\.mjs/);
  assert.match(section, /不得\*\*由模型自行拼 shell/);
  assert.match(section, /本 Session 已注入的旧内容不会自动刷新/);
  assert.match(section, /无需\*\*重启整个 DSH/);
  assert.match(section, /安装.*每台机器|每台机器\/每个用户一次/);
  assert.match(section, /初始化.*每个项目一次/);
  assert.match(section, /日常使用/);
});
