import { normalize } from './fsx.mjs';
function scalar(value) {
  const v=value.trim();
  if(v==='null'||v==='~')return null;if(v==='true')return true;if(v==='false')return false;if(/^-?\d+$/.test(v))return Number(v);
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))){const decoded=v[0]==='"'?JSON.parse(v):v.slice(1,-1);if(typeof decoded==='string'&&(/^[\[{]/.test(decoded))){try{return JSON.parse(decoded)}catch{}}return decoded}
  if((v.startsWith('{')&&v.endsWith('}'))||(v.startsWith('[')&&v.endsWith(']'))){try{return JSON.parse(v)}catch{if(v.startsWith('['))return v.slice(1,-1).split(',').map(x=>scalar(x)).filter(x=>x!=='')}}
  return v;
}
export function parseFrontmatter(input){
 const text=normalize(input);if(!text.startsWith('---\n'))return{error:'missing YAML frontmatter'};const end=text.indexOf('\n---\n',4);if(end<0)return{error:'unterminated YAML frontmatter'};const data={};let section=null;
 for(const line of text.slice(4,end).split('\n')){const nested=line.match(/^  ([\w-]+):\s*(.*)$/);if(nested&&section){if(!data[section]||typeof data[section]!=='object'||Array.isArray(data[section]))return{error:`invalid nested frontmatter key: ${line}`};data[section][nested[1]]=nested[2]?scalar(nested[2]):{};continue}const child=line.match(/^    -\s*(.*)$/);if(child&&section){const key=Object.keys(data[section]??{}).at(-1);if(!key)return{error:`orphan frontmatter array item: ${line}`};if(!Array.isArray(data[section][key]))data[section][key]=[];data[section][key].push(scalar(child[1]));continue}const item=line.match(/^  -\s*(.*)$/);if(item&&section){if(!Array.isArray(data[section]))data[section]=[];data[section].push(scalar(item[1]));continue}const top=line.match(/^([\w-]+):\s*(.*)$/);if(!top)return{error:`invalid frontmatter line: ${line}`};section=top[1];data[section]=top[2]?scalar(top[2]):{}}
 return{data,body:text.slice(end+5),raw:text.slice(0,end+1)};
}
export function quote(value){return JSON.stringify(value)}
export function stringifyFrontmatter(data,body){const lines=['---'];for(const[key,value]of Object.entries(data)){if(value&&typeof value==='object'&&!Array.isArray(value)){lines.push(`${key}:`);for(const[k,v]of Object.entries(value))lines.push(`  ${k}: ${v&&typeof v==='object'?JSON.stringify(v):v===null?'null':quote(v)}`)}else lines.push(`${key}: ${value&&typeof value==='object'?JSON.stringify(value):value===null?'null':quote(value)}`)}return`${lines.join('\n')}\n---\n${normalize(body).replace(/^\n+/,'')}`}
