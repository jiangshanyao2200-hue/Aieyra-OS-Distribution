// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; OFFICIAL_HOST; num; readLedger; sessionsRoot; allRows; summarize; group; local; session; scoped; forWorkspace
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/request-records.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 设置 · 请求记录：本机账本是 Core 为每个请求追加的 usage.jsonl，只含 Aieyra OS 自己发出的请求。
// 账号站日志覆盖整个账号（其他 Key、其他设备），只作参考，不计入这里的任何统计。
const fs=require('node:fs'),path=require('node:path');
const OFFICIAL_HOST=new URL(require('../../../Contracts/official-services.json').gateway).hostname,MAX_FILE=16<<20;
const num=v=>Number.isFinite(Number(v))?Number(v):0;
function readLedger(dir,session){
 const rows=[];
 for(const name of ['usage.old.jsonl','usage.jsonl']){
  const file=path.join(dir,name);let text='';
  try{if(fs.statSync(file).size>MAX_FILE)continue;text=fs.readFileSync(file,'utf8');}catch{continue;}
  for(const line of text.split('\n')){
   if(!line.trim())continue;let v;try{v=JSON.parse(line);}catch{continue;}const u=v?.usage;if(!u||!u.at)continue;
   rows.push({session:String(v.session||session),task:String(v.task||''),role:String(v.role||''),at:String(u.at),host:String(u.host||''),model:String(u.model||''),kind:String(u.kind||''),input:num(u.input_tokens),output:num(u.output_tokens),cached:u.cached_tokens==null?null:num(u.cached_tokens),reasoning:u.reasoning_tokens==null?null:num(u.reasoning_tokens),reported:u.usage_reported===true,estimated:u.usage_estimated===true,duration_ms:num(u.duration_ms)});
  }
 }
 return rows;
}
function sessionsRoot(dataDir){return path.join(require('../../../Contracts/storage/paths.cjs').root(dataDir,'tasks'),'os-tasks');}
function allRows(dataDir,includeConversations=true){
 const root=sessionsRoot(dataDir);let names=[];try{names=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);}catch{}
 return [...names.flatMap(name=>readLedger(path.join(root,name),name)),...(includeConversations?readLedger(require('../../../Contracts/storage/paths.cjs').root(dataDir,'conversations'),'unattributed'):[])];
}
function summarize(rows){
 const s={requests:rows.length,samples:rows.length,input:0,output:0,cached:0,cacheReported:0,cacheInput:0,estimated:0,reported:0,unknown:0,reasoning:null,reasoningComplete:false};
 const chat=rows.filter(r=>r.kind!=='image_gen');
 for(const r of rows){if(r.reported||r.estimated){s.input+=r.input;s.output+=r.output;}if(r.estimated)s.estimated++;if(r.reported)s.reported++;if(!r.reported&&!r.estimated)s.unknown++;
  if(r.kind!=='image_gen'&&r.reported&&r.cached!=null){s.cached+=r.cached;s.cacheReported++;s.cacheInput+=r.input;}
  if(r.kind!=='image_gen'&&r.reported&&r.reasoning!=null)s.reasoning=(s.reasoning||0)+r.reasoning;
 }
 s.complete=!!rows.length&&s.reported===rows.length;s.cacheComplete=!!chat.length&&chat.every(r=>r.reported&&r.cached!=null);s.reasoningComplete=!!chat.length&&chat.every(r=>r.reported&&r.reasoning!=null);
 s.cacheRate=s.cacheInput>0?Math.min(100,Math.round(s.cached/s.cacheInput*100)):null;return s;
}
function group(rows,key){
 const map=new Map();
 for(const r of rows){const k=r[key]||'';if(!map.has(k))map.set(k,[]);map.get(k).push(r);}
 return [...map].map(([name,list])=>({name,...summarize(list)})).sort((a,b)=>b.requests-a.requests);
}
// 分页前先按模型、角色筛选；总计与分组始终覆盖整个 OS，命中率只用报告了缓存的请求做分母。
function local(dataDir,{page=1,page_size=50,model='',role='',start=0,end=0}={}){
 const from=Number(start)*1000,to=Number(end)*1000;
 const all=allRows(dataDir).filter(r=>{const at=Date.parse(r.at);return (!from||at>=from)&&(!to||at<=to);}),rows=all.filter(r=>(!model||r.model===model)&&(!role||r.role===role)).sort((a,b)=>b.at.localeCompare(a.at));
 const size=Math.min(200,Math.max(1,Math.floor(page_size)||50)),offset=(Math.max(1,Math.floor(page)||1)-1)*size;
 return {ok:true,total:rows.length,page:Math.floor(offset/size)+1,page_size:size,summary:summarize(all),filtered:summarize(rows),models:group(all,'model'),roles:group(all,'role'),rows:rows.slice(offset,offset+size)};
}
// 用量信息窗：只读当前会话一个目录，不扫全部历史。
function session(dataDir,{session:id=''}={}){
 const name=String(id);if(!name||name!==path.basename(name)||name==='.'||name==='..')throw Error('会话编号无效');
 const rows=readLedger(path.join(sessionsRoot(dataDir),name),name).sort((a,b)=>a.at.localeCompare(b.at));
 return {ok:true,summary:summarize(rows),models:group(rows,'model'),roles:group(rows,'role'),recent:rows.slice(-200)};
}
module.exports={OFFICIAL_HOST,readLedger,summarize,local,session};

// Detail-only scan. Legacy rows are attributed through Core's durable membership;
// unrecoverable old ownership is kept explicitly unknown, never guessed by role.
function scoped(dataDir,{session:id='*'}={},catalog=[]){
 const tasks=new Map(catalog.flatMap(s=>(s.roles||[]).map(r=>[r.id,{id:s.id,name:r.name}])));
 const conversations=readLedger(require('../../../Contracts/storage/paths.cjs').root(dataDir,'conversations'),'').map(r=>({...r,session:r.session||tasks.get(r.task)?.id||'unattributed',role:tasks.get(r.task)?.name||r.role}));
 const homeRows=allRows(dataDir,false),homeScopes=new Set(homeRows.map(r=>r.session));
 const all=[...homeRows,...conversations].sort((a,b)=>a.at.localeCompare(b.at));
 const labels=new Map(catalog.map(s=>[s.id,s.title]));
 const sessions=group(all,'session').map(s=>({...s,id:s.name,title:s.name==='unattributed'?'早期未归属记录':(labels.get(s.name)||(homeScopes.has(s.name)?'Eyra':'已删除会话'))+' · '+s.name.slice(0,8)}));
 for(const s of catalog)if(!sessions.some(row=>row.id===s.id))sessions.push({id:s.id,title:s.title+' · '+s.id.slice(0,8),...summarize([])});
 const rows=id==='*'?all:all.filter(r=>r.session===id);
 return {ok:true,session:id,summary:summarize(rows),sessions,models:group(rows,'model'),roles:group(rows,'role'),recent:rows.slice(-200)};
}
module.exports.scoped=scoped;

// Only the request may use the current runtime alias. Historical ledger rows
// keep their recorded owner, including old runtime scopes we cannot recover.
function forWorkspace(dataDir,params={},catalog=[],current={}){
 const requested=String(params.session||'*'),scope=current.link?.scope;
 const id=scope&&requested===current.session_id?scope:requested;
 const sessions=[...catalog];
 if(scope&&!sessions.some(s=>s.id===scope))sessions.push({id:scope,title:'Eyra',roles:[]});
 return {...scoped(dataDir,{session:id},sessions),session:requested,scope:id};
}
module.exports.forWorkspace=forWorkspace;
