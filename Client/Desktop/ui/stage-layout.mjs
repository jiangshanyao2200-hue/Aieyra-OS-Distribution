// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PANE; stageCapacity; stageColumns; STAGE_ROOM; stagePlacement; stageYields; OFF_STAGE; stageActivityVisible; stageProcessVisible; stageKind
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/stage-layout.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared preview geometry; selection and dwell policy belong to work-selection.mjs.
// Every presentation mode shares the same ceiling: three rows, at most two
// readable columns. Ordinary windows may use both columns when there is room.
const PANE={minHeight:150,minWidth:320,gap:14};
export function stageCapacity({width=0,height=0}={}){
 const rows=Math.max(1,Math.min(3,Math.floor((height+PANE.gap)/(PANE.minHeight+PANE.gap))));
 const columns=width>=PANE.minWidth*2+PANE.gap?2:1;
 return {columns,rows,max:columns*rows};
}
// 一列放得下就不分两列。
export function stageColumns(count,{columns=1,rows=3}={}){return columns>1&&count>rows?2:1;}
// 先扣除侧栏与相册占用；足够宽时并排，窄窗上下，无法保持可读时才收起。
export const STAGE_ROOM={chat:320,stage:320,gap:16,edge:16};
export function stagePlacement({width=0,height=800,pushLeft=0,pushRight=0,chatMin=STAGE_ROOM.chat}={}){
 const left=Math.max(0,pushLeft),right=Math.max(0,pushRight),available=Math.max(0,width-left-right),inner=Math.max(0,available-2*STAGE_ROOM.edge);
 const side=inner>=2*Math.max(STAGE_ROOM.chat,STAGE_ROOM.stage,chatMin)+STAGE_ROOM.gap;
 const mode=side?'side':inner>=280&&height>=420?'stack':'hidden';
 const chat=side?(inner-STAGE_ROOM.gap)/2:inner;
 return {mode,chat,left:left+STAGE_ROOM.edge+(side?chat+STAGE_ROOM.gap:0),right:right+STAGE_ROOM.edge};
}
export const stageYields=options=>stagePlacement(options).mode==='hidden';
// Preparation tools still have real receipts. Execution/accounting flags must
// never suppress them in the presentation.
export const OFF_STAGE=new Set(['update_plan','ask_user','ask_subconscious','share_diary','team','exec','wait','compact']);
export const stageActivityVisible=item=>!!item?.tool&&!item.hidden&&!OFF_STAGE.has(item.tool);
// Keep alternative surfaces for human/team/compaction. A single-role view has
// no home plan orb; textual executor results and rejected waits need an outlet.
export function stageProcessVisible(item,{plan=false}={}){
 if(!item?.tool||item.hidden)return false;
 if(item.tool==='update_plan')return plan;
 if(item.tool==='exec'||item.tool==='wait'){
  let data=item.preview;if(typeof data==='string')try{data=JSON.parse(data);}catch{data={};}
  const failed=['failed','timed_out','interrupted','interrupted_unknown','persistence_failed','cancelled'].includes(item.state)||data?.ok===false||!!data?.error;
  return failed||item.tool==='exec'&&(Array.isArray(data?.output)&&data.output.length>0||typeof data?.output==='string'&&!!data.output);
 }
 return stageActivityVisible(item);
}

export function stageKind(tool=''){
 if(['exec_command','write_stdin','read_shell_output'].includes(tool))return 'terminal';
 if(tool==='apply_patch')return 'patch';
 if(tool==='view_image')return 'image';
 if(tool.startsWith('mod:'))return tool;
 if(/search/i.test(tool))return 'search';
 return tool||'other';
}

