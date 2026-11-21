// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: GreetingPresentation; StartupGate; nonChatStates; pendingChatStates; recentChatMessages; ConversationView; currentMessages; workingBody; reasoningDuration; workGroups; workHistory; currentToolGroup; terminalSummary
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/experience.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {sceneKind} from './model.mjs';

// A delayed startup greeting must not insert a row above an active reader.
// Keep the already visible value for that work; Core retains the actual reply.
export class GreetingPresentation {
  constructor(){this.scope=null;this.value=null;}
  project(value,{scope='',working=false}={}){
    if(this.scope!==scope){this.scope=scope;this.value=null;}
    if(!working)this.value=value;
    return this.value;
  }
}

// Projection only: startup and reading never manufacture execution progress.
export class StartupGate {
  constructor(){this.epoch='';this.opened=false;}
  project(snapshot){
    const epoch=snapshot.core_epoch||snapshot.session_id;
    if(this.epoch!==epoch){this.epoch=epoch;this.opened=false;}
    const greeting=snapshot.greeting||{};
    if(greeting.state==='skipped'||['online','local'].includes(greeting.state)&&String(greeting.text||'').trim())this.opened=true;
    return {visible:false,failed:greeting.state==='offline',phase:greeting.phase||greeting.state||'boot',error:[greeting.error,greeting.detail].filter(Boolean).join('\n')};
  }
}

const nonChatStates=new Set(['commentary','cancelled','failed','timed_out','interrupted','persistence_failed']);
const pendingChatStates=new Set(['queued','context','delivered','waiting_human','waiting_user','running','cancelling']);

// A turn is a user submission, not a model generation: steering can add several
// submissions to one run. Process text never consumes the ordinary-chat budget.
export function recentChatMessages(messages=[],pending=[],limit=50){
  const confirmed=new Map();
  for(const m of messages)if(m.from==='user'||m.from==='matrix'&&m.to==='user'&&!nonChatStates.has(m.state))confirmed.set(m.id,m);
  for(const m of Array.isArray(pending)?pending:pending?[pending]:[])if(!confirmed.has(m.id))confirmed.set(m.id,m);
  const rows=[...confirmed.values()],users=rows.filter(m=>m.from==='user'),recent=new Set(users.slice(-limit).map(m=>m.id));
  const retained=users.filter(m=>recent.has(m.id)||pendingChatStates.has(m.state));
  const ids=new Set(retained.map(m=>m.id)),generations=new Set(retained.map(m=>m.generation).filter(n=>n>0));
  const start=users.length>limit?rows.indexOf(retained[0]):0;
  return rows.filter((m,i)=>{
    if(m.from==='user')return ids.has(m.id);
    if(m.turn_id)return ids.has(m.turn_id);
    return i>=start&&(users.length<=limit||generations.has(m.generation));
  });
}

// Actual receipts select work mode; completion restores the same fifty turns.
export class ConversationView {
  constructor(){this.epoch='';this.turn='';this.worked=false;}
  project(snapshot,{turn,active=false,items=[],plan=null,pending=null,current=''}={}){
    const epoch=(snapshot.core_epoch||'')+':'+snapshot.session_id;
    if(epoch!==this.epoch){this.epoch=epoch;this.turn='';this.worked=false;}
    const matrix=snapshot.roles?.find(r=>r.role==='matrix'),generation=matrix?.generation||0;
    const task=(matrix?.id||'')+':'+generation;
    if(task!==this.turn){this.turn=task;this.worked=false;}
    // New cores expose actual dispatch, including nested execution, directly.
    // Older cores may prove it with a running/successful concrete receipt, but
    // neither a plan nor a queued intent (even with started_at) is execution.
    const workItems=[...(matrix?.activity?.items||[]),...items].filter(item=>item.tool&&!['memory','compact','toolbox','update_plan','team','exec','wait'].includes(item.tool)&&!item.hidden);
    const executed=typeof matrix?.execution_started==='boolean'?matrix.execution_started:workItems.some(item=>item.generation===generation&&(!item.agent||item.agent===matrix?.id)&&['running','completed'].includes(item.state));
    if(executed)this.worked=true;
    const rows=recentChatMessages(snapshot.messages||[],pending);
    const user=rows.findLast(m=>m.from==='user');
    const mode=active&&this.worked?'work':'chat';
    return {mode,rows:mode==='work'?[]:rows.filter(m=>m.id!==current),user};
  }
}

// Only the latest user request and newest reply belong on the live surface.
export function currentMessages(messages,floor,limit=1){
  const recent=(messages||[]).filter(m=>Number(m.generation)>floor&&m.state!=='commentary'&&(m.from==='user'||m.from==='matrix'&&m.to==='user'));
  const turns=[...new Set(recent.map(m=>m.generation))].sort((a,b)=>b-a).slice(0,limit);
  const visible=recent.filter(m=>turns.includes(m.generation));
  if(limit!==1)return visible;
  const user=visible.findLast(m=>m.from==='user'),reply=visible.findLast(m=>m.from==='matrix');
  return [user,reply].filter(Boolean);
}

// Only the current prose occupies the detail surface. Earlier bodies belong to
// the independently scrollable work history; a request gap keeps the last body.
export function workingBody(messages,live,generation){
  const progress=(messages||[]).filter(m=>m.from==='matrix'&&m.state==='commentary'&&m.generation===generation&&m.text);
  if(live?.text&&!live.new_body)return live.text;
  return progress.at(-1)?.text||'';
}

export function reasoningDuration(entry){
  const ms=Number(entry.finished_at)-Number(entry.started_at);
  if(!(entry.started_at>0)||!Number.isFinite(ms)||ms<0)return '';
  const seconds=Math.floor(ms/1000),minutes=Math.floor(seconds/60);
  return seconds<1?'思考了不到 1 秒':'思考了 '+(minutes?minutes+' 分 ':'')+(seconds%60||!minutes?(seconds%60)+' 秒':'').trim();
}

// Every row comes from a core receipt. Missing timestamps never turn a browser
// poll into an invented start time. No process text enters ordinary chat.
export function workGroups(messages,live,generation,items=[]){
  const progress=(messages||[]).filter(m=>m.from==='matrix'&&m.state==='commentary'&&m.generation===generation&&m.text);
  const runningTool=items.some(item=>['queued','running'].includes(item.state));
  const visibleBody=!runningTool&&['body','waiting','settled'].includes(live?.phase)?(live?.text&&!live.new_body?live.body_id:progress.at(-1)?.id):'';
  const rows=items.map(item=>({id:'tool:'+(item.key||item.id),kind:'tool',state:item.state,item,at:Number(item.started_at)||0}));
  for(const message of progress)rows.push({id:'body:'+message.id,kind:'body',state:'completed',text:message.text,message,at:Date.parse(message.at)*1000||0,current:message.id===visibleBody});
  for(const entry of live?.reasoning_history||[]){const text=reasoningDuration(entry);if(text)rows.push({id:'thinking:'+entry.id,kind:'thinking',state:'completed',text,at:entry.started_at*1000});}
  const groups=[];
  for(const row of rows.sort((a,b)=>a.at-b.at)){
    const kind=row.item&&sceneKind(row.item),family=kind==='terminal'?'shell':['reader','search','map'].includes(kind)?'explore':'';
    const previous=groups.at(-1),sameScope=previous?.item&&previous.item.agent===row.item?.agent&&previous.item.generation===row.item?.generation;
    // Unknown timestamps cannot prove adjacency across process prose/thinking.
    // Keep such legacy receipts separate instead of inventing an order.
    if(family&&row.at>0&&previous?.at>0&&previous.family===family&&sameScope){previous.items.push(row.item);previous.state=row.state;}
    else groups.push({...row,family,items:row.item?[row.item]:undefined});
  }
  return groups;
}

export function workHistory(messages,live,generation,items=[]){
  return workGroups(messages,live,generation,items).filter(row=>!row.current&&!row.items?.some(item=>['queued','running'].includes(item.state)));
}

export function currentToolGroup(messages,live,generation,items=[]){
  return workGroups(messages,live,generation,items).filter(row=>row.items?.some(item=>['queued','running'].includes(item.state))).flatMap(row=>row.items);
}

export function terminalSummary(item){
  const tool=item.tool,action=item.action||'',kind=sceneKind(item);
  const category=tool==='update_plan'?'计划':tool==='compact'?'整理':({search:'搜索',reader:'读取',map:'目录',editor:'编辑',browser:'浏览器',terminal:'终端'}[kind]||'工具');
  const title=String(item.title||item.description||action||tool||'操作').replace(/\s+/g,' ').trim();
  return category+' · '+title;
}
