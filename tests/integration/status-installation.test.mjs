import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv, tempRoot } from '../helpers/test-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repo, 'scripts/ake.mjs');
const official = 'https://github.com/Shakyae/agent-knowledge-engine.git';
async function temp(t) { const dir = await tempRoot('ake-status-install-'); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function fixture(t, { lock, withLink = false } = {}) {
  const home = await temp(t), skill = path.join(home, '.agents', 'skills', 'ake'), bundle = path.join(skill, 'resources', 'ake-source');
  await mkdir(path.join(bundle, 'scripts'), { recursive: true });
  await mkdir(path.join(skill, 'resources'), { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), '# Skill\n\nRun `preflight.mjs --dir <target>` before using the project CLI. On native user selection, run `init-git.mjs --dir <canonical-target>`.');
  await writeFile(path.join(skill, 'bootstrap.mjs'), '');
  await writeFile(path.join(skill, 'preflight.mjs'), '');
  await writeFile(path.join(skill, 'init-git.mjs'), '');
  await writeFile(path.join(bundle, 'package.json'), JSON.stringify({ name: 'agent-knowledge-engine', version: '0.1.0', repository: { url: official } }));
  await writeFile(path.join(bundle, 'scripts', 'ake.mjs'), '');
  await mkdir(path.join(home, '.agents'), { recursive: true });
  if (lock !== undefined) await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ skills: { ake: lock } }));
  if (withLink) { await mkdir(path.join(home, '.claude', 'skills'), { recursive: true }); await symlink(skill, path.join(home, '.claude', 'skills', 'ake')); }
  return { home, skill, entry: path.join(bundle, 'scripts', 'ake.mjs') };
}
function runStatus(cwd) {
  return spawnSync(process.execPath, [cli, 'status', '--json'], { cwd, encoding: 'utf8', env: cleanTestEnv({ HOME: cwd, DSH_AGENTS_HOME: path.join(cwd, '.agents') }) });
}

test('status JSON and text first line match pre-change HEAD on a populated project', async t => {
  const root = await temp(t), project = path.join(root, 'project'), oldCheckout = path.join(root, 'head-cli'); await mkdir(project, { recursive: true });
  const headPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'scripts', 'src', 'package.json'], { cwd: repo, encoding: 'utf8', env: cleanTestEnv() }).split(/\r?\n/).filter(file => file === 'package.json' || file.endsWith('.mjs'));
  for (const file of headPaths) {
    const destination = path.join(oldCheckout, file); await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, execFileSync('git', ['show', `HEAD:${file}`], { cwd: repo, env: cleanTestEnv() }));
  }
  const oldCli = path.join(oldCheckout, 'scripts', 'ake.mjs');
  const init = spawnSync('git', ['init', '--quiet', project], { encoding: 'utf8', env: cleanTestEnv() }); assert.equal(init.status, 0, init.stderr);
  await mkdir(path.join(project, '.ake', 'candidates'), { recursive: true });
  await mkdir(path.join(project, '.agents', 'notes', 'proposed', 'process'), { recursive: true }); await mkdir(path.join(project, 'docs', 'cookbook'), { recursive: true });
  await writeFile(path.join(project, '.ake', 'config.json'), JSON.stringify({ version: '0.1.0', knowledgeRoots: { note: '.agents/notes', 'defensive-pattern': 'docs/defensive-patterns', postmortem: 'docs/postmortem', cookbook: 'docs/cookbook' }, candidatesDir: '.ake/candidates', publishLog: '.ake/publish-log.jsonl' }));
  await writeFile(path.join(project, '.agents', 'notes', 'proposed', 'process', '2026-11-14-note.md'), '---\nake:\n  type: note\n  status: proposed\n  verified: pending\n---\n# Proposed note\n');
  await writeFile(path.join(project, 'docs', 'cookbook', 'active.md'), '---\nake:\n  type: cookbook\n  status: active\n  verified: unknown\n---\n# Active cookbook\n');
  await writeFile(path.join(project, '.ake', 'candidates', '001-draft.md'), '---\nakeCandidate:\n  id: C-DRAFT\n  status: draft\n---\n# Draft\n');
  await writeFile(path.join(project, '.ake', 'candidates', '002-submitted.md'), '---\nakeCandidate:\n  id: C-SUBMITTED\n  status: submitted\n---\n# Submitted\n');
  const env = cleanTestEnv({ HOME: root, DSH_AGENTS_HOME: path.join(root, '.agents') });
  const currentJson = spawnSync(process.execPath, [cli, 'status', '--json'], { cwd: project, encoding: 'utf8', env });
  const headJson = spawnSync(process.execPath, [oldCli, 'status', '--json'], { cwd: project, encoding: 'utf8', env });
  assert.equal(currentJson.status, 0, currentJson.stderr); assert.equal(headJson.status, 0, headJson.stderr);
  const current = JSON.parse(currentJson.stdout), baseline = JSON.parse(headJson.stdout); delete current.installation; delete baseline.installation;
  assert.deepEqual(current, baseline); assert.equal(current.knowledgeDocuments, 2); assert.equal(current.candidates, 2);
  assert.equal(current.byTypeAndStatus['note/proposed'], 1); assert.equal(current.byTypeAndStatus['cookbook/active'], 1);
  assert.deepEqual(current.pendingCandidates, ['C-DRAFT', 'C-SUBMITTED']); assert.deepEqual(current.verified, { unknown: 1, pending: 1 });
  const currentText = spawnSync(process.execPath, [cli, 'status'], { cwd: project, encoding: 'utf8', env });
  const headText = spawnSync(process.execPath, [oldCli, 'status'], { cwd: project, encoding: 'utf8', env });
  assert.equal(currentText.status, 0, currentText.stderr); assert.equal(headText.status, 0, headText.stderr);
  assert.equal(currentText.stdout.split(/\r?\n/)[0], headText.stdout.split(/\r?\n/)[0]);
});

test('status preserves all legacy JSON fields and adds installation only', async t => {
  const work = await temp(t), g = spawnSync('git', ['init', '--quiet', work]); assert.equal(g.status, 0);
  const result = spawnSync(process.execPath, [cli, 'status', '--json'], { cwd: work, encoding: 'utf8', env: cleanTestEnv({ HOME: work, DSH_AGENTS_HOME: path.join(work, '.agents') }) });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed).sort(), ['project', 'knowledgeDocuments', 'byTypeAndStatus', 'candidates', 'pendingCandidates', 'verified', 'installation'].sort());
  assert.equal(parsed.project, await realpath(work));
  assert.equal(typeof parsed.knowledgeDocuments, 'number'); assert.equal(typeof parsed.byTypeAndStatus, 'object');
  assert.equal(typeof parsed.candidates, 'number'); assert.ok(Array.isArray(parsed.pendingCandidates));
  assert.deepEqual(Object.keys(parsed.verified).sort(), ['pending', 'unknown']);
  assert.equal(parsed.installation.remote, 'unavailable');
});

test('status reports unknown commit for local source and absent lock ref', async t => {
  const home = await temp(t), skill = path.join(home, '.agents', 'skills', 'ake'), bundle = path.join(skill, 'resources', 'ake-source');
  await mkdir(path.join(bundle, 'scripts'), { recursive: true }); await mkdir(path.join(skill, 'resources'), { recursive: true });
  await writeFile(path.join(bundle, 'package.json'), JSON.stringify({ version: '0.1.0', repository: { url: official } }));
  await writeFile(path.join(bundle, 'scripts', 'ake.mjs'), '');
  await writeFile(path.join(skill, 'SKILL.md'), ''); await writeFile(path.join(skill, 'bootstrap.mjs'), '');
  await mkdir(path.join(home, '.agents'), { recursive: true });
  await writeFile(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ skills: { ake: { source: repo, sourceType: 'local' } } }));
  const { readInstallation } = await import('../../src/lib/installation.mjs');
  const result = await readInstallation({ entry: path.join(bundle, 'scripts', 'ake.mjs'), home, env: { DSH_AGENTS_HOME: path.join(home, '.agents') } });
  assert.equal(result.version, '0.1.0'); assert.equal(result.commit, null); assert.equal(result.source, repo); assert.equal(result.resourcesComplete, true);
});

test('installation resource completeness uses literal helper markers and preserves legacy status', async t => {
  const f = await fixture(t);
  const { readInstallation } = await import('../../src/lib/installation.mjs');
  const options = { entry: f.entry, home: f.home, env: { DSH_AGENTS_HOME: path.join(f.home, '.agents') } };
  assert.equal((await readInstallation(options)).resourcesComplete, true);
  await rm(path.join(f.skill, 'preflight.mjs'));
  assert.equal((await readInstallation(options)).resourcesComplete, false, 'literal preflight marker requires its helper');
  await writeFile(path.join(f.skill, 'preflight.mjs'), '');
  await rm(path.join(f.skill, 'init-git.mjs'));
  assert.equal((await readInstallation(options)).resourcesComplete, false, 'literal init-git marker requires its helper');
  await writeFile(path.join(f.skill, 'SKILL.md'), '# Legacy Skill without preflight or init-git markers');
  await rm(path.join(f.skill, 'preflight.mjs'));
  assert.equal((await readInstallation(options)).resourcesComplete, true, 'a legacy Skill without either helper marker remains complete');
});

test('valid official ref and canonical plus matching Claude symlink are identified', async t => {
  const sha = 'A'.repeat(40), f = await fixture(t, { lock: { source: 'Shakyae/agent-knowledge-engine', sourceType: 'github', sourceUrl: official, ref: sha }, withLink: true });
  const { readInstallation } = await import('../../src/lib/installation.mjs');
  const result = await readInstallation({ entry: f.entry, home: f.home, env: { DSH_AGENTS_HOME: path.join(f.home, '.agents') } });
  assert.equal(result.commit, sha.toLowerCase()); assert.equal(result.mode, 'canonical'); assert.equal(result.scope, 'user');
  assert.deepEqual(result.agentPaths.map(x => x.mode), ['canonical', 'symlink']);
  assert.equal(result.resourcesComplete, true);
});

test('missing and malformed lock produce warnings and unknown commit', async t => {
  const f = await fixture(t);
  const { readInstallation } = await import('../../src/lib/installation.mjs');
  const result = await readInstallation({ entry: f.entry, home: f.home, env: { DSH_AGENTS_HOME: path.join(f.home, '.agents') } });
  assert.equal(result.commit, null); assert.ok(result.warnings.length); assert.equal(result.agentPaths[0].mode, 'canonical');
  await writeFile(path.join(f.home, '.agents', '.skill-lock.json'), '{bad');
  const malformed = await readInstallation({ entry: f.entry, home: f.home, env: { DSH_AGENTS_HOME: path.join(f.home, '.agents') } });
  assert.equal(malformed.commit, null); assert.match(malformed.warnings.join(' '), /malformed/);
});

test('project copied CLI and source checkout are never claimed as installed Skill load paths', async t => {
  const home = await temp(t), { readInstallation } = await import('../../src/lib/installation.mjs');
  const projectEntry = path.join(home, '.ake', 'tools', 'scripts', 'ake.mjs');
  await mkdir(path.dirname(projectEntry), { recursive: true }); await writeFile(projectEntry, '');
  const project = await readInstallation({ entry: projectEntry, home, env: { DSH_AGENTS_HOME: path.join(home, '.agents') } });
  assert.equal(project.loadPath, null); assert.equal(project.scope, 'project');
  assert.match(project.warnings.join(' '), /不能证明 Skill 加载位置/);
  const development = await readInstallation({ entry: path.join(repo, 'scripts', 'ake.mjs'), home, env: { DSH_AGENTS_HOME: path.join(home, '.agents') } });
  assert.equal(development.loadPath, null); assert.equal(development.scope, 'development'); assert.equal(development.mode, 'development');
  assert.match(development.warnings.join(' '), /开发版/);
});

test('status text preserves original first line and never claims remote latest', async t => {
  const work = await temp(t); assert.equal(spawnSync('git', ['init', '--quiet', work]).status, 0);
  const result = spawnSync(process.execPath, [cli, 'status'], { cwd: work, encoding: 'utf8', env: cleanTestEnv({ HOME: work, DSH_AGENTS_HOME: path.join(work, '.agents') }) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.split(/\r?\n/)[0], /^\d+ knowledge documents; \d+ type\/status groups; \d+ pending candidates; verified unknown=\d+, pending=\d+$/);
  assert.match(result.stdout, /远程: 无法检查（status 不访问网络）/); assert.doesNotMatch(result.stdout, /最新/);
});

// These integration tests use only temporary HOME and Git projects; they do not invoke network or Skills CLI.
