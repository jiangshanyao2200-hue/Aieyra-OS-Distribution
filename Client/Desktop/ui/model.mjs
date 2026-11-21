// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: roles; activeStates; attentionStates; shellSceneKind; sceneKind; brief; WorkspacePresentation
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/model.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {planData,activityData,activityLabel,actionName,isInternalId} from './activity.mjs';
export const roles = {
  matrix: 'Eyra',
  project: 'Vaya',
  execution: 'Cota',
};
export const activeStates = new Set([
  'queued',
  'running',
  'cancelling',
  'waiting_user',
]);
export const attentionStates = new Set([
  'failed',
  'timed_out',
  'interrupted',
  'interrupted_unknown',
  'persistence_failed',
]);
// A display classification, never an execution permission. Only recognize an
// unambiguous single read command; shell programs and uncertain syntax retain
// their terminal view, even when their first command happens to be a search.
export function shellSceneKind(command) {
  const text=String(command||'').trim();
  if(!text||/[\r\n;|&<>`$(){}]/.test(text))return 'terminal';
  let quote='';
  for(const c of text){if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;}
  if(quote)return 'terminal';
  const name=text.match(/^([a-z][a-z0-9-]*)(?:\s|$)/i)?.[1]?.toLowerCase();
  if(['rg','grep','findstr','select-string'].includes(name)){
    if(name==='rg'&&/(?:^|\s)--pre(?:=|\s|$)/i.test(text))return 'terminal';
    return 'search';
  }
  if(['cat','head','tail','get-content','gc','type'].includes(name))return 'reader';
  if(['ls','dir','get-childitem','gci'].includes(name))return 'map';
  return 'terminal';
}
export function sceneKind(item) {
  if (['load_tool', 'unload_tool'].includes(item.action)) return 'toolbox';
  if(item.tool==='exec_command')return shellSceneKind(item.command||activityData(item).cmd);
  if(['write_stdin','read_shell_output'].includes(item.tool))return 'terminal';
  if (
    [
      'terminal',
      'reader',
      'search',
      'editor',
      'browser',
      'toolbox',
      'table',
      'cards',
    ].includes(item.presentation?.kind)
  )
    return item.presentation.kind;
  if (['terminal', 'exec_command', 'write_stdin', 'read_shell_output'].includes(item.tool))
    return 'terminal';
  if (item.tool === 'apply_patch') return 'editor';
  if (item.tool === 'project')
    return item.action === 'search'
      ? 'search'
      : item.action === 'read'
        ? 'reader'
        : 'map';
  if (item.tool === 'browser') return 'browser';
  return 'toolbox';
}
export function brief(item) {
  if (item.title?.trim()) return item.title.trim();
  if (item.command?.trim()) return item.command.trim().split(/\r?\n/)[0];
  const target = item.targets?.find((t) => !isInternalId(t)) || '';
  const verbs = {
    terminal:'终端',exec_command: '执行命令',
    write_stdin: '继续输入',
    read_shell_output: '读取输出',
    apply_patch: '修改文件',
    project:
      {
        read: '读取项目',
        search: '搜索项目',
        list: '列出项目',
        memory_read: '读取记忆',
        memory_write: '写入记忆',
      }[item.action] || '处理项目',
    browser: '查看页面',
    team: '团队任务',
    workspace: '调整工作区',
    settings: '调整设置',
    tool_factory: '创建工具',
    update_plan: '更新计划',
    exec: '并行执行',
    wait: '等待',
    compact: '压缩上下文',
  };
  if(!verbs[item.tool])return activityLabel(item);
  const verb = actionName(item.tool, item.action) || verbs[item.tool];
  if (item.tool === 'apply_patch')
    return verb + (target ? ' · ' + target : '');
  return (
    verb + (item.title ? ' · ' + item.title : target ? ' · ' + target : '')
  );
}

// 大屏是实时投影，不排队回放旧收据；历史与当前连续终端分别保留。
export class WorkspacePresentation {
  constructor() {
    this.items = new Map();
    this.order = [];
    this.scene = null;
    this.sequence = 0;
    this.busy = false;
    this.roleStates = new Map();
    this.terminalFloor = 0;
    this.terminalTurn = '';
    this.terminalItems = [];
  }
  ingest(snapshot) {
    if(this.session!==snapshot.session_id){this.session=snapshot.session_id;this.savedPlan=null;this.savedPlanScope=null;this.items.clear();this.order=[];this.roleStates.clear();this.sequence=0;this.terminalTurn='';this.terminalFloor=0;this.lastBodyStage='';}
    if(Object.hasOwn(snapshot,'plan')){this.savedPlan=snapshot.plan;this.savedPlanScope=snapshot.plan_scope;}
    this.busy = (snapshot.roles || []).some((role) => activeStates.has(role.state));
    for (const role of snapshot.roles || []) {
      this.roleStates.set(role.role, role);
      for (const raw of role.activity?.items || []) {
        const key = (role.id || role.role) + ':' + raw.id;
        const old = this.items.get(key);
        const item = { ...raw, key, agent: role.id || role.role, role: role.role,
          generation: raw.generation ?? old?.generation ?? role.generation,
          order: old?.order ?? ++this.sequence };
        this.items.set(key, item);
        if (!old) this.order.push(key);
      }
    }
    const live=snapshot.live?.matrix,role=this.roleStates.get('matrix');
    const turn=role?.id+':'+role?.generation;
    if(turn!==this.terminalTurn){this.terminalTurn=turn;this.terminalFloor=0;this.terminalStage=turn;this.bodyAt=0;}
    const stage=(role?.id||'')+':'+role?.generation+':'+(live?.body_id||'');
    if(live?.body_at&&live.body_at!==this.bodyAt){this.bodyAt=live.body_at;this.lastBodyStage=stage;this.terminalStage=stage;}
    else if(!live?.body_at&&live?.phase==='body'&&live.text&&stage!==this.lastBodyStage){this.lastBodyStage=stage;this.terminalFloor=this.sequence;this.terminalStage=stage;}
    const visible = this.order.map((key) => this.items.get(key)).filter((item) => {
      const role = this.roleStates.get(item.role);
      return !item.hidden && !['team', 'wait'].includes(item.tool) && activeStates.has(role?.state) &&
        item.key.startsWith((role.id||role.role)+':')&&role.generation === item.generation&&this.afterBody(item);
    });
    // Retain the newest three concrete operations while Matrix continues working.
    // A new generation and a settled task clear the live projection immediately.
    const items = visible.slice(-3);
    this.scene = items.length ? { kind: 'multi', keys: items.map((item) => item.key) } : null;
    this.tick();
    if (this.order.length > 4096) {
      const keep = new Set([...this.order.slice(-4096), ...(this.scene?.keys || [])]);
      for (const key of this.order) if (!keep.has(key)) this.items.delete(key);
      this.order = this.order.filter((key) => keep.has(key));
    }
    this.terminalItems = this.projectTerminal();
  }
  tick() {
    const rows = this.current();
    if (!this.busy || !rows.some((item) => {
      const role = this.roleStates.get(item.role);
      return activeStates.has(role?.state) && role.generation === item.generation;
    })) this.scene = null;
    return this.scene;
  }
  history() {
    return this.order.map((key) => this.items.get(key)).filter((item) => item && !item.hidden).slice(-10);
  }
  current() {
    return (this.scene?.keys || []).map((key) => this.items.get(key)).filter((item) => item && !item.hidden);
  }
  // 团队协同时 Vaya（project）与 Cota（execution）各有自己的一列，取法相同（最终搬家 P6）。
  liveActivities(name='matrix',{process=false,plan=false}={}){
    const role=this.roleStates.get(name);
    const rows=this.order.map(key=>this.items.get(key)).filter(item=>item&&item.role===name&&item.key.startsWith((role?.id||role?.role)+':')&&item.generation===role?.generation&&!item.hidden&&item.tool!=='team'&&(plan||item.tool!=='update_plan')&&(process||!['exec','wait'].includes(item.tool)));
    // 按 CORE 的 sequence 排（增量页按修订号到达，首次到达顺序不可靠，Codex X1-01）；缺字段时才用到达顺序。
    if(rows.every(item=>item.sequence>0))rows.sort((a,b)=>a.sequence-b.sequence);
    // 只裁已经结束的旧调用；还在等待或执行的永远保留。
    const cut=rows.length-80;
    return cut>0?rows.filter((item,i)=>i>=cut||['queued','running'].includes(item.state)):rows;
  }
  terminal() {
    return this.terminalItems;
  }
  afterBody(item){return this.bodyAt&&item.started_at?item.started_at>this.bodyAt:item.order>this.terminalFloor;}
  planFeedback(visible=()=>true) {
    const role=this.roleStates.get('matrix');if(!role)return '';
    const item=[...this.order].reverse().map(key=>this.items.get(key)).find(x=>x.role==='matrix'&&x.key.startsWith((role.id||role.role)+':')&&x.generation===role.generation&&!x.hidden&&x.tool==='update_plan');
    if(!item||!visible(item))return '';
    if(['queued','running'].includes(item.state))return '正在更新计划…';
    const data=activityData(item);
    if(item.state==='failed'||data.ok===false)return '计划未变更：'+(data.error?.message||(typeof data.error==='string'?data.error:'')||item.detail||'修改未获确认，请核对回执。');
    return '';
  }
  plan() {
    const role=this.roleStates.get('matrix');
    if(!role)return null;
    if(this.savedPlan&&this.savedPlanScope?.agent===role.id&&this.savedPlanScope?.generation===role.generation)return {id:this.savedPlan.id,key:'plan:'+this.savedPlan.id,tool:'update_plan',state:'completed',revision:this.savedPlan.revision,generation:role.generation,preview:{ok:true,state:this.savedPlan}};
    return [...this.order].reverse().map(key=>this.items.get(key)).find(item=>
      item.role==='matrix'&&item.key.startsWith((role.id||role.role)+':')&&
      item.generation===role.generation&&!item.hidden&&item.tool==='update_plan'&&item.state==='completed'&&
      activityData(item).ok!==false&&planData(item).steps.length)||null;
  }
  projectTerminal() {
    const role = this.roleStates.get('matrix');
    const turn = role?.id + ':' + role?.generation;
    if (turn !== this.terminalTurn) { this.terminalTurn = turn; this.terminalFloor = 0;this.terminalStage=turn; }
    // Every call kind participates; archived generations never return to the live transcript.
    return this.order.map(key=>this.items.get(key)).filter(item=>item&&item.role==='matrix'&&item.key.startsWith((role?.id||role?.role)+':')&&item.generation===role?.generation&&!item.hidden);
  }
}

export {cleanTerminal} from '../../../Tool/base/official/terminal/presentation/text.mjs';
