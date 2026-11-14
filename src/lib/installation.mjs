import path from 'node:path';
import os from 'node:os';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HEX_SHA = /^[0-9a-f]{40}$/i;

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return null; }
}

async function classify(p) {
  try {
    const info = await lstat(p);
    if (info.isSymbolicLink()) return { mode: 'symlink', canonical: await realpath(p) };
    if (info.isDirectory()) return { mode: 'canonical', canonical: await realpath(p) };
    return { mode: 'copy', canonical: await realpath(p) };
  } catch { return null; }
}

async function resourcesComplete(root) {
  try {
    for (const relative of ['SKILL.md', 'bootstrap.mjs', 'resources/ake-source/package.json', 'resources/ake-source/scripts/ake.mjs']) {
      await readFile(path.join(root, relative));
    }
    return true;
  } catch { return false; }
}

export async function readInstallation({ entry = fileURLToPath(import.meta.url), env = process.env, home = os.homedir() } = {}) {
  const absoluteEntry = path.resolve(entry);
  const warnings = [];
  const homeAgents = (() => {
    const configured = env.DSH_AGENTS_HOME;
    return configured && path.isAbsolute(configured) ? path.resolve(configured) : path.join(home, '.agents');
  })();
  const userCanonical = path.join(homeAgents, 'skills', 'ake');
  if (homeAgents !== path.join(home, '.agents')) warnings.push('DSH_AGENTS_HOME 指向自定义 agents 根；ake update 仅支持 HOME/.agents 下的用户级安装');
  const entryParts = absoluteEntry.split(path.sep);
  let loadPath = null, canonicalPath = null, mode = null, scope = null, skillRoot = null;
  const sourceIndex = entryParts.lastIndexOf('ake-source');
  if (sourceIndex >= 0 && entryParts[sourceIndex - 1] === 'resources') {
    skillRoot = entryParts.slice(0, sourceIndex - 1).join(path.sep) || path.parse(absoluteEntry).root;
    const detected = await classify(skillRoot);
    const userCanonicalInfo = await classify(userCanonical);
    if (detected) {
      canonicalPath = detected.canonical;
      mode = detected.mode;
      if (userCanonicalInfo?.mode === 'canonical' && detected.canonical === userCanonicalInfo.canonical) {
        scope = 'user';
        loadPath = skillRoot;
        warnings.push('loadPath 由 CLI 位置推断，非宿主加载证明');
      } else if (entryParts.includes('.ake') && entryParts.includes('tools')) {
        scope = 'project';
        warnings.push('CLI 路径不能证明 Skill 加载位置');
      } else {
        warnings.push('Skill CLI 路径与用户级 canonical 不匹配，加载身份未知');
      }
    }
  } else if (entryParts.includes('.ake') && entryParts.includes('tools')) {
    // A project-local copied CLI is not evidence of the loaded Skill.
    scope = 'project';
    warnings.push('CLI 路径不能证明 Skill 加载位置');
  } else {
    let directory = path.dirname(absoluteEntry);
    while (true) {
      const pkg = await readJson(path.join(directory, 'package.json'));
      if (pkg?.name === 'agent-knowledge-engine') {
        scope = 'development'; mode = 'development';
        warnings.push('当前运行来自 AKE 源码开发版；CLI 路径不能证明 Skill 加载位置');
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  let version = null;
  const bundlePackage = skillRoot ? await readJson(path.join(skillRoot, 'resources/ake-source/package.json')) : null;
  if (typeof bundlePackage?.version === 'string') version = bundlePackage.version;
  const lockPath = path.join(homeAgents, '.skill-lock.json');
  const lockBytes = scope === 'user' ? await readFile(lockPath).catch(() => null) : null;
  let lock = null;
  if (scope === 'user' && lockBytes) {
    try { lock = JSON.parse(lockBytes.toString('utf8')); }
    catch { warnings.push('Skills lock is malformed'); }
  } else if (scope === 'user') warnings.push('Skills lock is missing or unreadable');
  const locked = lock?.skills?.ake;
  const source = typeof locked?.source === 'string' ? locked.source : null;
  const sourceType = typeof locked?.sourceType === 'string' ? locked.sourceType : null;
  if (lock && !locked) warnings.push('AKE entry is missing from Skills lock');
  const repositoryUrl = typeof bundlePackage?.repository?.url === 'string' ? bundlePackage.repository.url : null;
  const sourceMatches = sourceType === 'github' && repositoryUrl !== null && typeof locked?.sourceUrl === 'string' && locked.sourceUrl.replace(/\/$/, '') === repositoryUrl.replace(/\/$/, '');
  const commit = sourceMatches && typeof locked?.ref === 'string' && HEX_SHA.test(locked.ref) ? locked.ref.toLowerCase() : null;
  const canonicalInfo = scope === 'user' ? await classify(userCanonical) : null;
  let agentPaths = null;
  if (canonicalInfo?.mode === 'canonical') {
    agentPaths = [{ path: userCanonical, mode: 'canonical' }];
    for (const candidate of [path.join(home, '.claude', 'skills', 'ake')]) {
      const linked = await classify(candidate);
      if (linked?.mode === 'symlink' && linked.canonical === canonicalInfo.canonical) agentPaths.push({ path: candidate, mode: 'symlink' });
    }
  } else if (canonicalInfo) warnings.push('User Skill path is not a canonical directory');
  const resolved = {
    os: process.platform,
    loadPath,
    canonicalPath,
    scope,
    mode,
    version,
    source,
    sourceType,
    commit,
    resourcesComplete: skillRoot ? await resourcesComplete(skillRoot) : null,
    agentPaths,
    remote: 'unavailable',
    warnings,
  };
  return resolved;
}

export function installationText(installation) {
  const scope = installation.scope === 'user' ? '用户级' : installation.scope === 'project' ? '项目级' : installation.scope === 'development' ? '开发版' : '未知';
  const mode = ({ canonical: '独立目录', symlink: '软链接', copy: '拷贝', development: '开发版' })[installation.mode] ?? '未知';
  return [
    `安装: ${scope} | 模式: ${mode} | 加载路径: ${installation.loadPath ?? '未知'}`,
    `版本: ${installation.version ?? '未知'} | 来源: ${installation.source ?? '未知'} | Commit: ${installation.commit ?? '未知'}`,
    `资源: ${installation.resourcesComplete === true ? '完整' : installation.resourcesComplete === false ? '不完整' : '未知'} | 远程: 无法检查（status 不访问网络）`,
  ];
}

