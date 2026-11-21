// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: terminalStates; second; addMonths; runForText; renderMessageMeta
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/message-time.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import { el } from './views.mjs';

const terminalStates=new Set(['completed','cancelled','failed','timed_out','interrupted','persistence_failed']);
const second=1000,minute=60*second,hour=60*minute,day=24*hour,week=7*day;

function addMonths(at,count){
  const date=new Date(at),result=new Date(at),wanted=date.getUTCDate();
  result.setUTCDate(1);result.setUTCMonth(date.getUTCMonth()+count);
  const end=new Date(result);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  result.setUTCDate(Math.min(wanted,end.getUTCDate()));return result.getTime();
}

// Calendar years/months are counted within each observed interval in UTC.
// Never join separated intervals: their intervening offline time is unknown.
export function runForText(message){
  if(message?.from==='user'||!terminalStates.has(message?.state))return '';
  const intervals=message.run_time?.intervals;
  if(!Array.isArray(intervals)||!intervals.length)return '';
  let months=0,remainder=0,previous=0;
  for(const interval of intervals){
    const start=interval.started_at,end=interval.finished_at;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||end<start||start<previous||!Number.isFinite(new Date(end).getTime()))return '';
    previous=end;const a=new Date(start),b=new Date(end);
    let count=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
    if(addMonths(start,count)>end)count--;
    months+=count;remainder+=end-addMonths(start,count);
  }
  const values=[[Math.floor(months/12),'year','years'],[months%12,'month','months']];
  for(const [size,singular,plural] of [[week,'week','weeks'],[day,'day','days'],[hour,'hour','hours'],[minute,'min','mins'],[second,'sec','secs']]){
    values.push([Math.floor(remainder/size),singular,plural]);remainder%=size;
  }
  const parts=values.filter(([n])=>n>0).slice(0,2).map(([n,one,many])=>`${n} ${n===1?one:many}`);
  return `Run for ${parts.join(' ')||'< 1 sec'}${message.run_time.incomplete?' · 已知时段':''}`;
}

export function renderMessageMeta(root,message){
  const signature=JSON.stringify([message?.from,message?.state,message?.at,message?.run_time]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;root.replaceChildren();
  const run=runForText(message);
  if(run){const duration=el('span',run,'message-run');duration.title=message.run_time.incomplete?'仅累计可核实的运行区间；离线未知时段未计入。':'从首次实际工具执行到本轮终态，包含期间等待；准备阶段未计入。';root.append(duration);}
  if(message?.at&&Number.isFinite(Date.parse(message.at))){const at=new Date(message.at),time=el('time',at.toLocaleString(), 'message-time');time.dateTime=message.at;time.title=at.toISOString();root.append(time);}
  root.hidden=!root.childNodes.length;
}
