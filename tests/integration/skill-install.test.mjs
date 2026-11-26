import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),cli=path.join(root,'scripts/ake.mjs'),sharedCli=path.join(root,'skills/ake/resources/ake-source/scripts/ake.mjs');
test('AKE Skill instructs visible retrieval/capture and structured final report',async()=>{const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8');for(const phrase of ['用户可见通知','同一阶段连续进行的多次搜索/候选命令合并','Agent Teams 由 Lead/任务 owner 统一发用户通知','AKE · 本次无新增知识','用户可见最终报告','Agent Note','Defensive Pattern','Postmortem','Cookbook','授权/发布','验证：','禁止盲目重试','candidate show <id>','.ake/publish-log.jsonl','publish <id> --reconcile','参数解析阶段拒绝'])assert.ok(skill.includes(phrase),phrase);assert.doesNotMatch(skill,/知识目录、配置、项目内 CLI/);assert.doesNotMatch(skill,/会执行既有项目代码的 preflight/);assert.doesNotMatch(skill,/AKE 源码 checkout CLI（开发\/初始化时）/);assert.match(skill,/项目操作统一使用 Skill 随附共享 CLI/);assert.match(skill,/不作为目标项目操作入口/)});
test('AKE Skill handles unknown publish results with configured ledger and refuses unsafe recovery',async()=>{
 const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8');
 for(const phrase of ['读取项目 `.ake/config.json` 的 `publishLog`','仅当有效配置中该字段不存在时才使用默认 `.ake/publish-log.jsonl`','旧版 CLI 不支持 reconcile','状态不符或任何状态无法确认时','停止并报告需人工处理','publish <id> --reconcile','参数解析阶段拒绝'])assert.ok(skill.includes(phrase),phrase);
});
// Static prompt-contract checks only; these assertions do not exercise DSH host UI or real user interaction.
test('static AKE Skill contract requires exact-target consent and Lead text fallback',async()=>{
 const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8'),architecture=await readFile(path.join(root,'docs/architecture.md'),'utf8'),cookbook=await readFile(path.join(root,'docs/cookbook/installing-knowledge-ops.md'),'utf8'),readme=await readFile(path.join(root,'README.md'),'utf8');
 for(const phrase of ['NOT_GIT_WORKTREE','GIT_UNAVAILABLE','BARE_REPOSITORY','STATUS_FAILED','init-git.mjs --inspect --dir','ask_user_question','exact canonical 路径','只有 Lead 可以向用户发起询问','子 Agent 不得调用用户交互工具、自行询问用户或执行 `init-git.mjs`','Lead 必须由自己直接调用该 helper','Lead 必须自行重新 inspect 当前 canonical 目标并使用新取得的 identity','不得将用户答复或 helper 执行转交给子 Agent','普通文本消息中展示同一 canonical 路径','1 — 只在此目标运行 Git init','2 — 暂不初始化','只有对当前展示路径的明确回复 `1` 才授权继续','原生流程仅用户选择对应选项构成授权；文本回退仅针对当前 exact canonical 路径的明确回复 `1` 构成授权','而不是因宿主/系统策略或权限明确拒绝交互','不得改用文本渠道绕过拒绝','回复 `2`、拒绝、空/缺失/含糊答复或任何其他答复均不得运行 helper','暂不初始化','本任务不再询问','选择另一个目标','--expected-identity','不是授权凭据','目录被替换/身份不可用/已经变化，不运行 `git init`，不自动重问','Git `init` 没有跨平台原子“仅首次创建、已存在即失败”操作','单写者','`git init` 可能创建 `.git` 内的默认配置、模板文件及其他 Git 初始化产物','bootstrap dry-run','任何 `conflict` 都停止','不 add/commit/push','结果不确定时，保留 `.git` 与模板/配置等盘面','unborn HEAD'])assert.ok(skill.includes(phrase),phrase);
 for(const phrase of ['Lead-mediated plain-text options','Only the user\'s explicit reply `1` to that prompt authorizes the helper','only the Lead invokes the helper after the user\'s explicit target-specific choice','without transferring consent or execution to a child Agent','A child Agent neither asks the user nor invokes `init-git.mjs`','lacks native-choice capability','explicit policy/permission denial of user interaction is not a fallback trigger','do not prove real DSH native-choice or Lead text-fallback behavior'])assert.ok(architecture.includes(phrase),phrase);
 for(const phrase of ['plain-text options `1 — initialize this target and continue` / `2 — do not initialize yet`','Only the user\'s explicit reply `1` to that path-specific prompt authorizes initialization','Child Agents neither ask the user nor run `init-git.mjs`','The Lead freshly inspects the target and directly runs the helper','An explicit host/system policy or permission denial of user interaction is not a fallback trigger','Optional, after initialization','This is not a prerequisite for initialization; an unborn branch is valid'])assert.ok(cookbook.includes(phrase),phrase);
 for(const phrase of ['only the Lead asks the user and runs `init-git.mjs`','the Lead freshly inspects the target and uses that inspection identity','Only the user\'s explicit reply `1` to that path-specific prompt authorizes the Lead','consent and execution are not relayed to a child Agent','A child Agent neither asks the user nor runs the helper'])assert.ok(readme.includes(phrase),phrase);
});
test('installing Cookbook distinguishes unborn initialization from optional later commit',async()=>{
 const cookbook=await readFile(path.join(root,'docs/cookbook/installing-knowledge-ops.md'),'utf8');
 assert.match(cookbook,/No prior\/first commit is required to initialize it/);
 assert.match(cookbook,/Optional, after initialization/);
 assert.match(cookbook,/This is not a prerequisite for initialization; an unborn branch is valid/);
});
test('AKE completion routing, reviewer rubric and explicit authorization are prompt-level contracts',async()=>{
 const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8'),agents=await readFile(path.join(root,'templates/project/AGENTS.md'),'utf8'),architecture=await readFile(path.join(root,'docs/architecture.md'),'utf8'),readme=await readFile(path.join(root,'README.md'),'utf8'),cookbook=await readFile(path.join(root,'docs/cookbook/agent-task-knowledge-workflow.md'),'utf8');
 for(const [text,phrase] of [[skill,'普通问答'],[skill,'验证 ok'],[skill,'宿主硬触发'],[skill,'PASS WITH LIMITATIONS'],[skill,'approve|request-changes|reject'],[skill,'A（强直接证据）'],[skill,'B（当前上下文中的可用证据）'],[skill,'C（核心证据缺失）'],[skill,'不要求持久化材料、独立证据文件、session/event ID'],[skill,'当前运行/系统状态'],[skill,'实际浏览器检查'],[skill,'此 Session Agent 的直接验证'],[skill,'用户对其意图/验收的确认'],[skill,'可读取的配置、安装脚本、系统状态'],[skill,'不要求把会话内直接观察再包装成独立佐证'],[skill,'按阶段应用触发并只执行当前阶段适用的步骤'],[skill,'任务前触发只做检索与适用性判断，不启动候选捕获'],[skill,'仅在任务后评估确认有据、可复用且未被覆盖的结果时'],[skill,'不要在检索、适用性判断、价值/证据评估、查重或合格候选的准备/提交/reviewer 请求之间额外询问“是否继续”'],[skill,'自动完成语句路由的条件仅适用于这一个额外的自动信号'],[skill,'源代码/差异、实际测试日志、可复现结果'],[skill,'潜在知识待补证据'],[skill,'最多自动修订一次'],[skill,'等待用户明确授权发布'],[skill,'合成回归例（不是已观察事实）'],[skill,'PASS WITH LIMITATIONS'],[skill,'Tampermonkey 目标页面的按钮文字'],[agents,'Triggers are stage-specific: task-before triggers retrieve/applicability only'],[agents,'candidate creation/review happens only for supported, reusable knowledge with sufficient relevant evidence'],[agents,'Automatic completion-phrase routing applies only after substantive engineering work'],[agents,'wait for its actual result'],[agents,'explicit user authorization'],[agents,'pending evidence'],[architecture,'Triggers are stage-specific: task-before retrieval triggers search/applicability only'],[architecture,'only for sufficiently evidenced, supported, reusable knowledge'],[architecture,'Ordinary language cannot guarantee Skill loading'],[architecture,'at most one automatic revision'],[readme,'not automatically upgraded'],[readme,'manually review/merge'],[readme,'potential knowledge pending evidence'],[readme,'A task-before trigger performs retrieval/applicability judgment only'],[readme,'Candidate deduplication/creation/review happens only if task-after assessment finds supported, reusable, not-already-covered knowledge'],[readme,'not the AKE Skill workflow default'],[cookbook,'permission to publish knowledge does not itself authorize a commit']])assert.ok(text.includes(phrase),phrase);
 assert.match(skill,/缺少 session ID、事件号、独立证据文件或不相关主题本身不降级证据等级，也不构成 BLOCK/);
 assert.match(architecture,/Missing session IDs, event numbers, standalone evidence files, or unrelated topics alone do not lower evidence level or block/);
 assert.match(architecture,/CLI verdicts/);
  assert.match(architecture,/`resourcesComplete` requires each optional helper \(`preflight\.mjs`, `init-git\.mjs`\) only when the installed `SKILL\.md` literally contains that helper's filename; this is a byte\/text-presence heuristic, not semantic parsing or authentication/);
 assert.doesNotMatch(readme,/Automatic local authorization is the default|default local automatic authorization/);
});
// Synthetic reviewer case files only: none of the assumed browser observations below were executed in this test session.
const syntheticReviewerCases=[
 {id:'TM-pseudo-menu-limited',title:'Tampermonkey menu button and dropdown',claim:'The target page renders the expected button text and background/border; its pseudo-element layers stack as intended; computed styles match the inspected UI; and dropdown interaction behaves as observed.',observations:['button text','background and border','::before/::after layer order','actual computed styles','dropdown interaction'],positiveEvidence:[{level:'B',kind:'current browser inspection + this-session Agent verification + user confirmation',assumption:'Synthetic input only: assume the Agent inspected the actual rendered page, read computed styles, checked pseudo-element stacking, exercised the dropdown, and the user confirmed these observations.',persistedArtifact:null,sessionId:null,eventNumber:null}],negativeEvidence:['No browser was launched and no real page was inspected by this test.','No source code, test log, persistent screenshot, session ID, or event number is included in this synthetic case.'],limitations:['Other pages and unrelated menu topics were not checked and are explicitly out of scope.'],expected:{label:'PASS WITH LIMITATIONS',verdict:'approve'}},
 {id:'TM-pseudo-menu-no-core-evidence',title:'Tampermonkey menu pseudo-element',claim:'The menu item is rendered through a CSS pseudo-element.',positiveEvidence:[],negativeEvidence:['Synthetic case contains no browser observation, source code, test log, user confirmation, readable configuration, or system-state evidence for the core claim.'],limitations:['Core behavior has no basic support.'],expected:{label:'BLOCK',verdict:'request-changes'}},
];
test('synthetic case vectors cover B-context and C-missing-evidence examples without claiming behavior',async()=>{
 const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8'),limited=syntheticReviewerCases[0],unsupported=syntheticReviewerCases[1];
 assert.match(limited.claim,/button text and background\/border/);assert.equal(limited.positiveEvidence[0].level,'B');
 assert.deepEqual(limited.observations,['button text','background and border','::before/::after layer order','actual computed styles','dropdown interaction']);
 assert.match(limited.positiveEvidence[0].kind,/browser inspection.*Agent verification.*user confirmation/);
 assert.match(limited.positiveEvidence[0].assumption,/Synthetic input only/);assert.match(limited.negativeEvidence[0],/No browser was launched/);
 assert.equal(limited.positiveEvidence[0].persistedArtifact,null);assert.equal(limited.positiveEvidence[0].sessionId,null);assert.equal(limited.positiveEvidence[0].eventNumber,null);
 assert.equal(limited.expected.label,'PASS WITH LIMITATIONS');assert.equal(limited.expected.verdict,'approve');
 assert.equal(limited.negativeEvidence.length,2);assert.match(limited.limitations[0],/Other pages and unrelated menu topics were not checked/);
 assert.equal(unsupported.positiveEvidence.length,0);assert.equal(unsupported.expected.label,'BLOCK');assert.equal(unsupported.expected.verdict,'request-changes');
 assert.match(skill,/PASS WITH LIMITATIONS.*限制已明确写入候选，也映射 `approve`/);
 assert.match(skill,/B（当前上下文中的可用证据）.*实际浏览器检查/);
 assert.match(skill,/不要求持久化材料、独立证据文件、session\/event ID/);
 assert.match(skill,/缺少 session ID、事件号、独立证据文件或不相关主题本身不降级证据等级，也不构成 BLOCK/);
 assert.match(skill,/合成回归例（不是已观察事实）：假设本 Session Agent 实际检查 Tampermonkey 目标页面的按钮文字与背景\/边框、`::before`\/`::after` 伪元素层叠、真实计算样式和下拉交互/);
});
test('init preserves existing Skills and isolates project knowledge',async t=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'ake-scopes-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const home=path.join(base,'home'),env={...process.env,HOME:home,USERPROFILE:home,DSH_AGENTS_HOME:path.join(home,'.agents')};
 const run=(cwd,...args)=>spawnSync(process.execPath,[cli,...args],{cwd,env,encoding:'utf8'});
 const shared=path.join(home,'.agents/skills/ake/SKILL.md'),old=path.join(home,'.agents/skills/knowledge-ops/SKILL.md');
 for(const file of [shared,old]){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'user custom');}
 let x=run(root,'skill','install','--user');assert.equal(x.status,2);assert.match(x.stderr,/npx skills add/);assert.equal(await readFile(shared,'utf8'),'user custom');
 for(const name of ['one','two']){
  const project=path.join(base,name);await mkdir(project);assert.equal(spawnSync('git',['init',project]).status,0);
  const legacy=path.join(project,'.agents/skills/knowledge-ops/SKILL.md');await mkdir(path.dirname(legacy),{recursive:true});await writeFile(legacy,'legacy custom');
  const existing=path.join(project,'.agents/skills/ake/SKILL.md');if(name==='two'){await mkdir(path.dirname(existing),{recursive:true});await writeFile(existing,'project custom');}
  x=run(root,'init','--dir',project,...(name==='two'?['--skill-scope','user']:[]));assert.equal(x.status,0,x.stderr+' '+x.stdout);assert.match(x.stdout,/Install the ake Skill separately/);
  assert.equal(await readFile(legacy,'utf8'),'legacy custom');if(name==='two')assert.equal(await readFile(existing,'utf8'),'project custom');else await assert.rejects(access(existing));
   await assert.rejects(access(path.join(project,'.ake/tools/scripts/ake.mjs')),{code:'ENOENT'});
   const result=spawnSync(process.execPath,[sharedCli,'status','--json','--project',project],{cwd:project,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).project,await realpath(project));
  await writeFile(path.join(project,'docs/cookbook',`${name}.md`),`# uniquely${name}token\n`);
 }
  const one=path.join(base,'one');
  const search=spawnSync(process.execPath,[sharedCli,'search','uniquelytwotoken','--json','--project',one],{cwd:one,env,encoding:'utf8'});assert.equal(search.status,0,search.stderr);assert.equal(JSON.parse(search.stdout).results.length,0);
 x=run(root,'init','--dir',one,'--skill-scope','project');assert.equal(x.status,2);assert.match(x.stderr,/npx skills add/);
 assert.equal(await readFile(old,'utf8'),'user custom');assert.equal(await readFile(shared,'utf8'),'user custom');
});
