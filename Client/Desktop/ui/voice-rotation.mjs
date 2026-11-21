// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ROLES; STATES; VOICE_DWELL; helperState; helperView; workingVoices; VoiceRotation; paintVoiceTabs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/voice-rotation.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 其他页面左下角只有一个位置：把工作中的角色挪过来，样式和首页工作时一样。
// 协同时轮流显示：正在思考或写正文的角色优先，点名字可以固定在某个角色上，再点一下取消。
import {activeStates} from './model.mjs';
import {roleLive} from './eyra-state.mjs';

const ROLES=['matrix','project','execution'],PHASE={thinking:'思考中',body:'在写结果',tool:'执行中',waiting:'等待中',compacting:'在整理上下文'};
const STATES=new Set(['thinking','tool','body','waiting','compacting','preparing']);
export const VOICE_DWELL=5000;

export function helperState(live={},running=null){return STATES.has(live.phase)?live.phase:running?'tool':'thinking';}
export function helperView({active,phase='',thought='',body='',newBody=false,label=''}){
 const words=String(thought||'').trim(),text=String(body||'').trim();
 if(active&&phase==='thinking')return words?{kind:'thinking',thought:words}:{kind:'progress',label:PHASE.thinking};
 if(text&&!newBody)return {kind:'progress',body:text,done:!active||phase!=='body'};
 return {kind:'progress',label:active?label||PHASE[phase]||'工作中':'做完了'};
}
export function workingVoices(snapshot,flows={}){
 return ROLES.flatMap(role=>{
  const row=snapshot?.roles?.find(r=>r.role===role);if(!row||!activeStates.has(row.state))return [];
  const live=roleLive(snapshot,role),flow=flows[role],phase=flow?.state||live.phase||'';
  const thought=flow?flow.thought:live.thought,body=flow?flow.body?.text:live.new_body?'':live.text;
  return [{role,phase,speaking:phase==='thinking'&&!!String(thought||'').trim()||phase==='body'&&!!String(body||'').trim()}];
 });
}
export class VoiceRotation{
 constructor({dwell=VOICE_DWELL}={}){this.dwell=dwell;this.current='';this.since=0;this.pinned='';}
 pin(role){this.pinned=this.pinned===role?'':role;if(this.pinned){this.current=role;this.since=0;}}
 pick(voices,now){
  if(!voices.length){this.current='';return null;}
  const pinned=voices.find(v=>v.role===this.pinned);if(pinned)return pinned;
  this.pinned='';
  const speaking=voices.filter(v=>v.speaking),pool=speaking.length?speaking:voices,held=pool.find(v=>v.role===this.current);
  if(held&&(pool.length===1||now-this.since<this.dwell))return held;
  const at=pool.findIndex(v=>v.role===this.current),next=pool[(at+1)%pool.length];
  this.current=next.role;this.since=now;return next;
 }
}
export function paintVoiceTabs(root,voices,current,{pinned='',onPick,doc=document}){
 root.hidden=voices.length<2;
 if(root.hidden){root.replaceChildren();delete root.dataset.key;return;}
 const key=voices.map(v=>v.role+':'+v.name).join('|');
 if(root.dataset.key!==key){
  root.dataset.key=key;
  root.replaceChildren(...voices.map(v=>{const b=doc.createElement('button');b.type='button';b.className='voice-tab';b.dataset.role=v.role;b.textContent=v.name;b.onclick=e=>{e.stopPropagation();onPick(v.role);};return b;}));
 }
 for(const b of root.children){b.dataset.current=String(b.dataset.role===current);b.dataset.pinned=String(b.dataset.role===pinned);}
}
