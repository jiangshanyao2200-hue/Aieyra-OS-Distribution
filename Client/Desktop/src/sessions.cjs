// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; path; readline; validID; fileFor; active; describe; list; restore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/sessions.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const validID=/^[a-f0-9]{32}$/;

function fileFor(configFile,id){
 if(typeof id!=='string'||!validID.test(id))throw new Error('会话编号无效');
 return path.join(require('./paths.cjs').privatePath(configFile,'sessions'),id+'.jsonl');
}
function active(file){
 try{const fd=fs.openSync(file.replace(/\.jsonl$/,'.lock'),'r+');fs.closeSync(fd);return false;}
 catch(err){if(err.code==='ENOENT')return false;return true;}
}
async function describe(file,full=false){
 const stat=fs.statSync(file);
 const entry={id:path.basename(file,'.jsonl'),title:'未命名会话',updated_at:stat.mtime.toISOString(),active:active(file),messages:0,error:''};
 entry.display_time=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(stat.mtime);
 if(stat.size>256*1024*1024){entry.error='会话文件过大';return entry;}
 const stream=fs.createReadStream(file,{encoding:'utf8'});
 const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
 let lastBad=false;
 try{
  for await(const line of lines){
   if(lastBad){entry.error='会话记录损坏';break;}
   let record;try{record=JSON.parse(line);}catch{lastBad=true;continue;}
   if(record.kind==='message'){
    entry.messages++;
    const m=record.value;
    if(entry.title==='未命名会话'&&m.role==='user'&&!m.content.startsWith('以下是从此前记录检索出的原文摘录')){
     entry.title=Array.from(m.content.replace(/[\x00-\x1f\x7f-\x9f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,32).join('')||'未命名会话';
     if(!full)break;
    }
   }
   if(record.kind==='draft'){entry.hasDraft=Boolean(record.value);}
  }
 }finally{lines.close();stream.destroy();}
 return entry;
}
async function list(configFile){
 const dir=path.join(require('./paths.cjs').privatePath(configFile,'sessions'));
 let files;try{files=fs.readdirSync(dir);}catch(err){if(err.code==='ENOENT')return [];throw err;}
 const entries=[];
 for(const name of files){
  if(!/^[a-f0-9]{32}\.jsonl$/.test(name))continue;
  try{const entry=await describe(path.join(dir,name));if(entry.messages||entry.hasDraft)entries.push(entry);}catch{/* 不把正在创建或已移走的文件作为坏菜单项。 */}
 }
 return entries.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
}
async function restore(configFile,id){
 const file=fileFor(configFile,id);
 const entry=await describe(file,true);
 if(entry.active)throw new Error('会话正在其他窗口使用');
 if(entry.error)throw new Error(entry.error);
 // 宿主在当前窗口创建标签页；服务只校验可恢复性，不再启动另一个 OS 窗口。
 return {ok:true,id:entry.id,title:entry.title};
}
module.exports={list,restore,fileFor,describe};
