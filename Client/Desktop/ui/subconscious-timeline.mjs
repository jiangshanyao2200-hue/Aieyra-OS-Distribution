// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: millis; subconsciousFrame; SubconsciousTimeline
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/subconscious-timeline.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const millis=v=>typeof v==='number'?v:Date.parse(v)||0;
export function subconsciousFrame(snapshot){
 if(snapshot?.subconscious?.retired)return null;
 const rows=(snapshot?.subconscious?.activities||[]).filter(a=>a.actor!=='eyra'&&a.state==='running');
 const a=rows.findLast(a=>a.phase==='body'||a.phase==='thinking')||rows.findLast(a=>a.waiting)||rows.at(-1);
 if(!a)return null;
 const phase=a.phase||'tool',thought=phase==='thinking',text=thought?a.thought||'':phase==='body'?a.body||'':a.tool||a.steps?.at(-1)||a.title||'';
 return {id:a.message_id||'sub:'+a.started+':'+a.id,role:'subconscious',from:'subconscious',at:millis(a.started),text:String(text),title:a.title||'',phase,thought,subprocess:true,streaming:true,state:'running'};
}
// Presentation only. Finished summaries use the same ID as their durable host
// receipt; none of these messages is added to Eyra's model context.
export class SubconsciousTimeline{
 constructor(){this.scope='';this.rows=new Map();this.active=null;}
 ingest(snapshot){
  if(snapshot?.subconscious?.retired){this.rows.clear();this.active=null;return;}
  const scope=JSON.stringify([snapshot?.core_epoch,snapshot?.session_id]);if(scope!==this.scope){this.scope=scope;this.rows.clear();}
  for(const [id,row]of this.rows)if(row.subprocess)this.rows.delete(id);
  this.active=subconsciousFrame(snapshot);
  for(const a of snapshot?.subconscious?.activities||[]){
   if(a.actor==='eyra'||a.state==='running'||!a.finished)continue;
   const id=a.message_id||'sub:'+a.started+':'+a.id,text=a.summary||a.title||'';if(!text)continue;
   this.rows.set(id,{id,role:'subconscious',from:'subconscious',at:millis(a.started||a.finished),text,state:a.state,streaming:false,subprocess:false});
  }
  if(this.active)this.rows.set(this.active.id,this.active);
  while(this.rows.size>32){const first=[...this.rows.values()].find(x=>!x.subprocess);if(!first)break;this.rows.delete(first.id);}
 }
 entries(base){
  const rows=base.slice();
  for(const row of this.rows.values()){
   if(rows.some(e=>e.id===row.id))continue;
   let index=rows.findIndex(e=>millis(e.at)>row.at);if(index<0)index=rows.length;rows.splice(index,0,row);
  }
  return rows;
 }
}
