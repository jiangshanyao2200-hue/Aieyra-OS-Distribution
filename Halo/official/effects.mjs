// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: EFFECTS; effectIDs; effect; presenceCode; presenceLabels; signals; signalText; PresenceWait; haloState
// Impact: python -B scripts/code-atlas.py show Halo/official/effects.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Stable legacy preference IDs. New author motion belongs to Halo packages.
export const EFFECTS=Object.freeze({pulse:'脉冲',orbit:'轨道',wave:'涟漪',spark:'星点'});
export const effectIDs=Object.freeze(Object.keys(EFFECTS));
export const effect=(value,fallback='pulse')=>effectIDs.includes(value)?value:fallback;
export function presenceCode(now,reduced=false){return reduced?'>_01':['>_01','{ }/','01_/','[_]'][Math.floor(now/180)%4];}

export const presenceLabels={boot:'正在醒来',connecting:'正在连接',compacting:'正在整理上下文',offline:'离线',thinking:'思考中',body:'正在回应',tool:'正在操作',preparing:'正在准备工作',waiting:'等待模型响应',queued:'消息尚未发送',confirming:'等待接收确认',idle:'',cancelling:'正在停止',waiting_user:'等你回复',error:'需要留意'};
const signals={terminal:'输入命令',reader:'读取文件',search:'查找内容',editor:'写入内容',typing:'正在输入',browser:'查看页面',map:'查看项目',generic:'正在准备工作'};
export function signalText(effect){return signals[effect]||signals.generic;}
export class PresenceWait {
 constructor(){this.key='';this.since=0;this.effect='generic';}
 project(state,effect,now){
  const tracked=['waiting','connecting','thinking','tool','compacting'].includes(state),key=tracked?state+':'+(state==='tool'?effect:''):'';
  if(key!==this.key){this.key=key;this.since=now;}
  if(state==='tool')this.effect=effect;
  else if(!['waiting','connecting'].includes(state))this.effect='generic';
  const longWait=tracked&&now-this.since>=5000;
  const waiting=['waiting','connecting'].includes(state);
  const title=longWait?({waiting:'仍在等待模型回应',connecting:'仍在等待连接',thinking:'仍在思考',compacting:'仍在整理上下文',tool:'仍在'+signalText(effect).replace(/^正在/,'')})[state]:state==='tool'?signalText(effect):presenceLabels[state];
  return {title,longWait,effect:waiting?this.effect:effect,carry:waiting&&this.effect!=='generic'};
 }
}

// Core instances and chat streams use different names for the same visual state.
export function haloState(value){
 const aliases={retry:'connecting',settled:'idle',stopped:'idle',running:'waiting',working:'waiting',replying:'body',failed:'error',timed_out:'error',interrupted:'error',persistence_failed:'error',completed:'idle',cancelled:'idle'};
 return Object.hasOwn(presenceLabels,value)?value:aliases[value]||'idle';
}
