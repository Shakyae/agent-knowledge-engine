import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),cli=path.join(root,'scripts/ake.mjs');
test('AKE Skill instructs visible retrieval/capture and structured final report',async()=>{const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8');for(const phrase of ['用户可见通知','同一阶段连续进行的多次搜索/候选命令合并','Agent Teams 由 Lead/任务 owner 统一发用户通知','AKE · 本次无新增知识','用户可见最终报告','Agent Note','Defensive Pattern','Postmortem','Cookbook','授权/发布','验证：'])assert.ok(skill.includes(phrase),phrase)});
test('AKE completion routing, reviewer rubric and explicit authorization are prompt-level contracts',async()=>{
 const skill=await readFile(path.join(root,'skills/ake/SKILL.md'),'utf8'),agents=await readFile(path.join(root,'templates/project/AGENTS.md'),'utf8'),architecture=await readFile(path.join(root,'docs/architecture.md'),'utf8'),readme=await readFile(path.join(root,'README.md'),'utf8'),cookbook=await readFile(path.join(root,'docs/cookbook/agent-task-knowledge-workflow.md'),'utf8');
 for(const [text,phrase] of [[skill,'普通问答'],[skill,'验证 ok'],[skill,'宿主硬触发'],[skill,'PASS WITH LIMITATIONS'],[skill,'approve|request-changes|reject'],[skill,'A（强直接证据）'],[skill,'B（当前上下文中的可用证据）'],[skill,'C（核心证据缺失）'],[skill,'不要求持久化材料、独立证据文件、session/event ID'],[skill,'当前运行/系统状态'],[skill,'实际浏览器检查'],[skill,'此 Session Agent 的直接验证'],[skill,'用户对其意图/验收的确认'],[skill,'可读取的配置、安装脚本、系统状态'],[skill,'不要求把会话内直接观察再包装成独立佐证'],[skill,'按阶段应用触发并只执行当前阶段适用的步骤'],[skill,'任务前触发只做检索与适用性判断，不启动候选捕获'],[skill,'仅在任务后评估确认有据、可复用且未被覆盖的结果时'],[skill,'不要在检索、适用性判断、价值/证据评估、查重或合格候选的准备/提交/reviewer 请求之间额外询问“是否继续”'],[skill,'自动完成语句路由的条件仅适用于这一个额外的自动信号'],[skill,'源代码/差异、实际测试日志、可复现结果'],[skill,'潜在知识待补证据'],[skill,'最多自动修订一次'],[skill,'等待用户明确授权发布'],[skill,'合成回归例（不是已观察事实）'],[skill,'PASS WITH LIMITATIONS'],[skill,'Tampermonkey 目标页面的按钮文字'],[agents,'Triggers are stage-specific: task-before triggers retrieve/applicability only'],[agents,'candidate creation/review happens only for supported, reusable knowledge with sufficient relevant evidence'],[agents,'Automatic completion-phrase routing applies only after substantive engineering work'],[agents,'wait for its actual result'],[agents,'explicit user authorization'],[agents,'pending evidence'],[architecture,'Triggers are stage-specific: task-before retrieval triggers search/applicability only'],[architecture,'only for sufficiently evidenced, supported, reusable knowledge'],[architecture,'Ordinary language cannot guarantee Skill loading'],[architecture,'at most one automatic revision'],[readme,'not automatically upgraded'],[readme,'manually review/merge'],[readme,'potential knowledge pending evidence'],[readme,'A task-before trigger performs retrieval/applicability judgment only'],[readme,'Candidate deduplication/creation/review happens only if task-after assessment finds supported, reusable, not-already-covered knowledge'],[readme,'not the AKE Skill workflow default'],[cookbook,'permission to publish knowledge does not itself authorize a commit']])assert.ok(text.includes(phrase),phrase);
 assert.match(skill,/缺少 session ID、事件号、独立证据文件或不相关主题本身不降级证据等级，也不构成 BLOCK/);
 assert.match(architecture,/Missing session IDs, event numbers, standalone evidence files, or unrelated topics alone do not lower evidence level or block/);
 assert.match(architecture,/CLI verdicts/);
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
  const local=path.join(project,'.ake/tools/scripts/ake.mjs');
  const result=spawnSync(process.execPath,[local,'status','--json'],{cwd:project,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).project,await realpath(project));
  await writeFile(path.join(project,'docs/cookbook',`${name}.md`),`# uniquely${name}token\n`);
 }
 const one=path.join(base,'one'),local=path.join(one,'.ake/tools/scripts/ake.mjs');
 const search=spawnSync(process.execPath,[local,'search','uniquelytwotoken','--json'],{cwd:one,env,encoding:'utf8'});assert.equal(search.status,0,search.stderr);assert.equal(JSON.parse(search.stdout).results.length,0);
 x=run(root,'init','--dir',one,'--skill-scope','project');assert.equal(x.status,2);assert.match(x.stderr,/npx skills add/);
 assert.equal(await readFile(old,'utf8'),'user custom');assert.equal(await readFile(shared,'utf8'),'user custom');
});
