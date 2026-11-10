import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),cli=path.join(root,'scripts/ake.mjs');
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
  x=run(root,'init','--dir',project,...(name==='two'?['--skill-scope','user']:[]));assert.equal(x.status,0,x.stderr+' '+x.stdout);
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
