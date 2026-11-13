import path from 'node:path';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { atomicWrite, assertRealInside, normalize, readText, sha256 } from './fsx.mjs';
import { validateDocument, linksIn } from './documents.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { loadCandidate, saveCandidate, bindingOf, sameBinding, hasBoundApproveReview, checkCandidate, invalidateObservedDrift } from './candidates.mjs';
import { loadConfig, resolveKindTarget } from './config.mjs';

async function filesBelow(dir) { const out=[];for(const e of await readdir(dir,{withFileTypes:true}).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))){if(e.name.startsWith('.'))continue;const f=path.join(dir,e.name);if(e.isDirectory())out.push(...await filesBelow(f));else if(e.isFile()&&e.name.endsWith('.md')&&e.name!=='README.md')out.push(f)}return out; }
async function ledgerHasPublication(logPath,record){let text;try{text=await readFile(logPath,'utf8')}catch(e){if(e.code==='ENOENT')return false;throw e}for(const line of text.split('\n').filter(Boolean)){let entry;try{entry=JSON.parse(line)}catch{throw Error('cannot reconcile malformed publish ledger')}if(entry.id===record.id&&entry.target===record.target&&entry.contentHash===record.contentHash&&(entry.revision===undefined||entry.revision===record.revision))return true}return false}
function publicationReviewAllowed(meta,binding){const mode=meta.approval?.mode;if(mode!==undefined&&mode!=='human'&&mode!=='automatic')return false;return hasBoundApproveReview(meta,binding,{allowSelf:mode==='automatic'})}
async function reconcile(root,c,config,read){
  const m=c.meta,pending=m.pendingPublication;if(!pending)throw Error('no pending publication to reconcile');
  const body=normalize(c.body),contentHash=sha256(body),binding=bindingOf({...m,contentHash});
  if(m.status!=='approved'||pending.contentHash!==contentHash||m.contentHash!==contentHash||pending.previousTargetHash!==m.targetHash)throw Error('pending publication bindings changed; reconcile manually');
  if(!sameBinding(m.approval,binding)||!publicationReviewAllowed(m,binding))throw Error('pending publication review/approval binding is stale; reconcile manually');
  let target;try{target=resolveKindTarget(root,config,m.kind,m.target,parseFrontmatter(body).body?.match(/^Status: (proposed|implemented|rejected)/m)?.[1])}catch(e){throw Error(`cannot reconcile illegal target: ${e.message}`)}await assertRealInside(root,target);
  const logPath=path.resolve(root,config.publishLog);await assertRealInside(root,logPath);const record={at:new Date().toISOString(),id:m.id,revision:m.revision,target:m.target,contentHash,previousTargetHash:pending.previousTargetHash};
  const alreadyRecorded=await ledgerHasPublication(logPath,record);
  let current='absent';try{current=sha256(await read(target))}catch(e){if(e.code!=='ENOENT')throw e}if(current!==contentHash)throw Error('publish result unknown from previous attempt; target does not match pending contentHash; reconcile manually');
  try{
    if(!alreadyRecorded){await mkdir(path.dirname(logPath),{recursive:true});await appendFile(logPath,`${JSON.stringify({...record,reconciled:true})}\n`,'utf8')}
    m.status='published';m.publication={at:pending.at??record.at,contentHash,target:m.target,previousTargetHash:pending.previousTargetHash};delete m.pendingPublication;await saveCandidate(c.file,m,c.body);
  }catch(e){throw Error(`publish result unknown: target written, ledger not updated; reconcile manually (${e.message})`)}
  return{published:true,reconciled:!alreadyRecorded,repaired:alreadyRecorded,target:m.target,contentHash,kind:m.kind,authorizationMode:m.approval?.mode??'human'};
}
export async function publish(root, id, { dryRun = false, reconcile: doReconcile = false, readFileImpl, atomicWriteImpl, saveCandidateImpl } = {}) {
  const read = readFileImpl ?? readFile,write = atomicWriteImpl ?? atomicWrite,save = saveCandidateImpl ?? saveCandidate;
  const c=await loadCandidate(root,id),m=c.meta,config=await loadConfig(root),body=normalize(c.body),contentHash=sha256(body),binding=bindingOf({...m,contentHash});
  if(dryRun&&doReconcile)throw Error('--dry-run and --reconcile are mutually exclusive');
  if(m.pendingPublication&&!doReconcile)throw Error('publish result unknown from previous attempt; reconcile manually or run publish --reconcile');
  if(doReconcile)return reconcile(root,c,config,read);
  if(m.status!=='approved')throw Error('candidate status must be approved');
  const observed=await checkCandidate(root,c);if(observed.invalidated)throw Error('previous review/approval invalidated by observed drift; re-review required');
  if(contentHash!==m.contentHash)throw Error('contentHash mismatch; re-submit and re-review');
  if(!m.approval)throw Error('approval record is missing');
  if(!sameBinding(m.approval,binding))throw Error('approval binding is stale or incomplete');
  if(!publicationReviewAllowed(m,binding))throw Error(m.approval.mode==='automatic'?'automatic publish requires a current bound approve review':'publish requires a current approve review from a reviewer different from author');
  let target;try{target=resolveKindTarget(root,config,m.kind,m.target,parseFrontmatter(body).body?.match(/^Status: (proposed|implemented|rejected)/m)?.[1])}catch(e){throw Error(`illegal publish target: ${e.message}`)}
  await assertRealInside(root,target);
  let previous='absent',existing;try{existing=await read(target);previous=sha256(existing)}catch(e){if(e.code!=='ENOENT')throw Error(`cannot read target ${m.target}: ${e.message}`)}
  if(m.targetHash==='absent'&&previous!=='absent'||m.targetHash!=='absent'&&previous!==m.targetHash){const operation=previous==='absent'?'create':'update';await invalidateObservedDrift(c,{reason:`observed target drift: targetHash ${String(m.targetHash).slice(0,12)} -> ${previous.slice(0,12)}`,observed:{contentHash,target:m.target,targetHash:previous,operation}});throw Error('target changed since candidate creation; re-review required; previous review/approval invalidated by observed drift')}
  const errors=validateDocument(body,m.target,{knowledgeRoots:config.knowledgeRoots,projectRoot:root});if(errors.length)throw Error(errors.map(x=>`${x.path}:${x.line} ${x.message}`).join('; '));
  for(const href of linksIn(body)){const dest=path.resolve(path.dirname(target),href);await assertRealInside(root,dest);try{await readFile(dest)}catch{throw Error(`dangling relative link ${href}`)}}
  const idValue=parseFrontmatter(body).data?.ake?.id;
  for(const [kind,base]of Object.entries(config.knowledgeRoots))for(const f of await filesBelow(path.resolve(root,base))){if(path.resolve(f)===target)continue;const p=parseFrontmatter(await readText(f));if(idValue&&p.data?.ake?.id===idValue)throw Error(`target id collision: ${idValue} at ${path.relative(root,f)}`)}
  const checked=await checkCandidate(root,c);if(checked.errors.length)throw Error(`candidate check failed: ${checked.errors.join('; ')}`);
  const logPath=path.resolve(root,config.publishLog);await assertRealInside(root,logPath);
  if(dryRun)return {dryRun:true,target:m.target,contentHash,previousTargetHash:previous,kind:m.kind,authorizationMode:m.approval.mode??'human'};
  // Re-read immediately before rename: this detects observed drift but is not an exclusive lock.
  let now='absent';try{now=sha256(await read(target))}catch(e){if(e.code!=='ENOENT')throw e}
  if(now!==m.targetHash){const operation=now==='absent'?'create':'update';await invalidateObservedDrift(c,{reason:`observed final target drift: targetHash ${String(m.targetHash).slice(0,12)} -> ${now.slice(0,12)}`,observed:{contentHash,target:m.target,targetHash:now,operation}});throw Error('target changed since candidate creation; re-review required; previous review/approval invalidated by observed drift')}
  const pending={at:new Date().toISOString(),contentHash,previousTargetHash:previous};m.pendingPublication=pending;await save(c.file,m,body);
  try {
    await write(target,body);
    const written=sha256(await read(target));if(written!==contentHash)throw Error('published target hash mismatch after atomic write');
    const logPath=path.resolve(root,config.publishLog);await mkdir(path.dirname(logPath),{recursive:true});await appendFile(logPath,`${JSON.stringify({at:pending.at,id:m.id,revision:m.revision,target:m.target,contentHash,previousTargetHash:previous})}\n`,'utf8');
    m.status='published';m.publication={at:pending.at,contentHash,target:m.target,previousTargetHash:previous};delete m.pendingPublication;await save(c.file,m,body);
  } catch(e) { throw Error(`publish result unknown: target written, ledger not updated; reconcile manually (${e.message})`); }
  return {published:true,target:m.target,contentHash,kind:m.kind,authorizationMode:m.approval.mode??'human'};
}
