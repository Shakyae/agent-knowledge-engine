import path from 'node:path';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { atomicWrite, assertRealInside, inside, normalize, readText, sha256 } from './fsx.mjs';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';
import { validateDocument } from './documents.mjs';
import { kindRoot, loadConfig, resolveKindTarget } from './config.mjs';
export const bindingFields = ['contentHash', 'target', 'targetHash', 'operation'];
export function bindingOf(meta) { return Object.fromEntries(bindingFields.map(k => [k, meta[k]])); }
export function sameBinding(a, b) { return bindingFields.every(k => a?.[k] === b?.[k]); }
export function parseCandidate(text) { const p = parseFrontmatter(text); if (p.error || !p.data.pkoCandidate) throw Error(p.error ?? 'missing pkoCandidate'); return { meta: p.data.pkoCandidate, body: p.body.replace(/^<!-- body -->\n/, '') }; }
export function renderCandidate(meta, body) { return stringifyFrontmatter({ pkoCandidate: meta }, `<!-- body -->\n${normalize(body)}`); }
export async function candidatePath(root, id) { const dir = path.resolve(root, (await loadConfig(root)).candidatesDir); if (!inside(root, dir)) throw Error(`candidate directory escapes project root: ${dir}`); await assertRealInside(root, dir); for (const f of await readdir(dir).catch(() => [])) if (f.startsWith(`${id}-`) && f.endsWith('.md')) return assertRealInside(root, path.join(dir, f)); throw Error(`candidate ${id} not found in ${dir}`); }
export async function loadCandidate(root, id) { const file = await candidatePath(root, id); return { file, ...parseCandidate(await readText(file)) }; }
export async function saveCandidate(file, meta, body) { await atomicWrite(file, renderCandidate(meta, body)); }
function metadata(body) { const p = parseFrontmatter(body); const m = p.data?.pko; return { scope: m?.scope ?? 'unknown', evidence: m?.evidence ?? 'unknown' }; }
export async function newCandidate(root, { kind, title, author, target, body = '' }) {
  const config = await loadConfig(root); if (!kindRoot(kind)) throw Error(`unsupported knowledge kind: ${kind}`);
  const targetPath = resolveKindTarget(root, config, kind, target); await assertRealInside(root, targetPath);
  const dir = path.resolve(root, config.candidatesDir); if (!inside(root, dir)) throw Error(`candidate directory escapes project root: ${dir}`); await assertRealInside(root, dir); await mkdir(dir, { recursive: true });
  const files = await readdir(dir); let max = 0; for (const f of files) { const m = f.match(/^C-(\d+)/); if (m) max = Math.max(max, Number(m[1])); }
  const id = `C-${String(max + 1).padStart(4, '0')}`, slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate', file = path.join(dir, `${id}-${slug}.md`);
  let targetHash = 'absent'; try { targetHash = sha256(await readFile(targetPath)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const bodyLF = normalize(body), exists = targetHash !== 'absent', { scope, evidence } = metadata(bodyLF);
  const meta = { id, revision: 1, kind, title, author, created: new Date().toISOString().slice(0, 10), status: 'draft', target: path.relative(root, targetPath).split(path.sep).join('/'), operation: exists ? 'update' : 'create', targetHash, contentHash: sha256(bodyLF), scope, evidence, reviews: [], approval: null, publication: null, supersededBy: null };
  await saveCandidate(file, meta, bodyLF); return { file, meta, body: bodyLF };
}
export async function reviseCandidate(root, id, body) {
  const c = await loadCandidate(root, id); if (c.meta.status === 'published') throw Error('published candidate cannot be revised; create a new candidate');
  const bodyLF = normalize(body), { scope, evidence } = metadata(bodyLF), config = await loadConfig(root), target = resolveKindTarget(root, config, c.meta.kind, c.meta.target);
  await assertRealInside(root, target); let targetHash = 'absent'; try { targetHash = sha256(await readFile(target)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  c.meta.revision = (c.meta.revision ?? 1) + 1; c.meta.status = 'draft'; c.meta.contentHash = sha256(bodyLF); c.meta.targetHash = targetHash; c.meta.operation = targetHash === 'absent' ? 'create' : 'update'; c.meta.scope = scope; c.meta.evidence = evidence; c.meta.reviews = []; c.meta.approval = null; c.meta.publication = null;
  await saveCandidate(c.file, c.meta, bodyLF); return { ...c, body: bodyLF };
}
async function listMarkdown(dir) { const out=[]; for (const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])) { if(e.name.startsWith('.'))continue;const f=path.join(dir,e.name);if(e.isDirectory())out.push(...await listMarkdown(f));else if(e.isFile()&&e.name.endsWith('.md')&&e.name!=='README.md')out.push(f); } return out; }
export async function invalidateObservedDrift(c,{reason,observed}){const meta=c.meta;if(meta.status==='published'||!c.file)return false;const observedShort=Object.fromEntries(Object.entries(observed).map(([k,v])=>[k,String(v).slice(0,16)]));meta.invalidations??=[];const recorded=meta.invalidations.some(x=>Object.entries(observedShort).every(([k,v])=>x.observed?.[k]===v));const rawReviews=meta.reviews??[],needsSave=!recorded||rawReviews.length>0||Boolean(meta.approval)||(meta.status!=='rejected'&&meta.status!=='submitted');if(!recorded)meta.invalidations.push({reason,at:new Date().toISOString(),observed:observedShort});meta.reviews=[];meta.approval=null;if(meta.status!=='rejected')meta.status='submitted';if(needsSave)await saveCandidate(c.file,meta,c.body);return true}
export async function checkCandidate(root, c) {
  const meta=c.meta,config=await loadConfig(root),errors=[],target=path.resolve(root,meta.target),bodyHash=sha256(normalize(c.body));
  try{resolveKindTarget(root,config,meta.kind,meta.target);await assertRealInside(root,target)}catch(e){errors.push(e.message)}
  let targetHash='absent';try{targetHash=sha256(await readFile(target))}catch(e){if(e.code!=='ENOENT')errors.push(`cannot read target: ${e.message}`)}
  const expectedOperation=meta.status==='published'||meta.pendingPublication?meta.operation:(targetHash==='absent'?'create':'update'),expectedTargetHash=meta.status==='published'?(meta.publication?.contentHash??meta.targetHash):meta.pendingPublication?([meta.pendingPublication.contentHash,meta.pendingPublication.previousTargetHash].includes(targetHash)?targetHash:meta.targetHash):meta.targetHash,binding=bindingOf({...meta,contentHash:bodyHash}),rawReviews=meta.reviews??[],reviews=rawReviews.map(r=>({...r,bound:sameBinding(r,binding),stale:!sameBinding(r,binding)})),approval=meta.approval?{...meta.approval,bound:sameBinding(meta.approval,binding),stale:!sameBinding(meta.approval,binding)}:null;
  const observed={contentHash:bodyHash,target:meta.target,targetHash,operation:expectedOperation},drift=[];
  if(bodyHash!==meta.contentHash)drift.push(`contentHash ${String(meta.contentHash).slice(0,12)} -> ${bodyHash.slice(0,12)}`);
  if(targetHash!==expectedTargetHash)drift.push(`targetHash ${String(expectedTargetHash).slice(0,12)} -> ${targetHash.slice(0,12)}`);
  if(meta.operation!==expectedOperation)drift.push(`operation ${meta.operation} -> ${expectedOperation}`);
  if(reviews.some(r=>r.stale)||approval?.stale)drift.push('candidate binding differs from recorded review or approval');
  let invalidated=false;
  if(drift.length&&meta.status!=='published'&&!meta.pendingPublication&&c.file){const reason=`observed drift: ${drift.join('; ')}`;await invalidateObservedDrift(c,{reason,observed});invalidated=true;errors.push('previous review/approval invalidated by observed drift; re-review required')}
  if(meta.pendingPublication)errors.push('publish result unknown from previous attempt; reconcile manually or run publish --reconcile');
  if(bodyHash!==meta.contentHash&&!invalidated)errors.push('content binding drift');
  if(targetHash!==expectedTargetHash&&!invalidated)errors.push('targetHash binding drift');
  if(meta.operation!==expectedOperation&&!invalidated)errors.push('operation binding drift');
  const validation=validateDocument(c.body,meta.target,{knowledgeRoots:config.knowledgeRoots,projectRoot:root});errors.push(...validation.map(e=>`${e.path}:${e.line} ${e.message}`));
  const bodyP=parseFrontmatter(c.body),docId=bodyP.data?.pko?.id,bodyText=bodyP.error?c.body:bodyP.body,title=bodyText?.match(/^# (.+)$/m)?.[1]?.trim().toLowerCase()??meta.title.toLowerCase(),tokens=s=>new Set(s.toLowerCase().match(/[a-z0-9]+/g)??[]),similarities=[];
  for(const base of Object.values(config.knowledgeRoots))for(const f of await listMarkdown(path.resolve(root,base))){if(path.resolve(f)===target)continue;const text=await readText(f),p=parseFrontmatter(text),docBody=p.error?text:p.body,id=p.data?.pko?.id,otherTitle=docBody?.match(/^# (.+)$/m)?.[1]?.trim().toLowerCase();if(docId&&id===docId)errors.push(`id collision ${docId}: ${path.relative(root,f)}`);const a=tokens(title),b=tokens(otherTitle??''),overlap=a.size&&b.size?[...a].filter(x=>b.has(x)).length/Math.min(a.size,b.size):0;if(otherTitle&&otherTitle===title||overlap>=0.6)similarities.push({path:path.relative(root,f).split(path.sep).join('/'),overlap,advice:'Advisory similarity only; review manually and consider updating this target instead of creating a duplicate.'})}
  const currentBinding=bindingOf({...meta,contentHash:bodyHash}),currentReviews=(meta.reviews??[]).map(r=>({...r,bound:sameBinding(r,currentBinding),stale:!sameBinding(r,currentBinding)})),currentApproval=meta.approval?{...meta.approval,bound:sameBinding(meta.approval,currentBinding),stale:!sameBinding(meta.approval,currentBinding)}:null;
  return {errors,targetHashDrift:targetHash!==expectedTargetHash,bindingDrift:Boolean(drift.length),invalidated,invalidations:meta.invalidations??[],reviews:invalidated?reviews:currentReviews,approval:invalidated?approval:currentApproval,similarities,advisory:'Similarity is advisory; it does not automatically detect or merge duplicates.'};
}
