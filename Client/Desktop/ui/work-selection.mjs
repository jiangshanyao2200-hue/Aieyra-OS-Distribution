// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: WORK_LIMIT; workingState; attentionLabels; workNeedsAttention; workVisible; workPhase; workText; workPriority; WorkSelection
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/work-selection.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation only: the selected set never controls dispatch or cancellation.
export const WORK_LIMIT=6;
export const workingState=state=>['queued','running','cancelling','replying','working'].includes(state);
const attentionLabels={failed:'任务失败',timed_out:'任务超时',interrupted:'执行已中断',persistence_failed:'结果保存失败',waiting_user:'等待你补充信息'};
export const workNeedsAttention=item=>!!item?.attention||Object.hasOwn(attentionLabels,item?.state);
export const workVisible=item=>workingState(item?.state)||workNeedsAttention(item);
// A completed model stream can still have a tool running. Use execution facts
// before its stale terminal phase on every work surface.
export function workPhase(item){
 if(workNeedsAttention(item)||item?.state==='cancelling')return item.state;
 if(item?.activity?.items?.some(a=>a.state==='running'))return 'tool';
 if(item?.phase&&!['settled','idle','completed','stopped'].includes(item.phase))return item.phase;
 return item?.state==='replying'&&item?.text?'body':item?.state==='queued'?'queued':workingState(item?.state)?'waiting':item?.state||'idle';
}
export function workText(item,compact=false){
 if(workNeedsAttention(item))return [attentionLabels[item.state]||'需要处理',item.error||''].filter(Boolean).join('：');
 return !compact&&item.thought&&item.phase==='thinking'?item.thought:item.text||item.task||item.error||'正在处理…';
}
export function workPriority(item){
 if(item.focused)return 4;
 if(workNeedsAttention(item))return 3;
 if(workingState(item.state))return 2;
 return 1;
}
export class WorkSelection {
 constructor(){this.keys=[];this.changedAt=-Infinity;}
 clear(){this.keys=[];this.changedAt=-Infinity;}
 select(items,{limit=WORK_LIMIT,ceiling=WORK_LIMIT,now=Date.now(),hold=4000,expanded=false}={}){
  const unique=[...new Map(items.filter(x=>x?.id).map(x=>[x.id,x])).values()];
  const capacity=expanded?unique.length:Math.max(0,Math.min(Math.max(WORK_LIMIT,Math.min(12,ceiling)),Math.floor(limit)||0));
  const previous=new Map(this.keys.map((key,i)=>[key,i])),stable=now-this.changedAt<hold;
  const ranked=unique.map((item,index)=>({item,index})).sort((a,b)=>{
   const priority=workPriority(b.item)-workPriority(a.item);if(priority)return priority;
   if(stable&&previous.has(a.item.id)!==previous.has(b.item.id))return previous.has(a.item.id)?-1:1;
   return (Number(b.item.updated)||0)-(Number(a.item.updated)||0)||a.index-b.index;
  }).slice(0,capacity).map(x=>x.item);
  // An update replaces a slot, not the ordering of all retained panes.
  ranked.sort((a,b)=>(previous.get(a.id)??Infinity)-(previous.get(b.id)??Infinity));
  const keys=ranked.map(x=>x.id);
  if(JSON.stringify(keys)!==JSON.stringify(this.keys)){this.keys=keys;this.changedAt=now;}
  return {items:ranked,hidden:unique.length-ranked.length,total:unique.length};
 }
}
