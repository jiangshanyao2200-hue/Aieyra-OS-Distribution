// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TaskView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/task-view.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 选择仅属于当前窗口；异步响应必须同时匹配任务和本次选择版本。
export class TaskView {
  constructor(){this.id='';this.epoch=0;}
  select(id){this.id=id;this.epoch++;return this.ticket();}
  ticket(){return {id:this.id,epoch:this.epoch};}
  accepts(ticket,snapshot){return ticket.epoch===this.epoch&&ticket.id===this.id&&(!snapshot||snapshot.session_id===this.id);}
}
