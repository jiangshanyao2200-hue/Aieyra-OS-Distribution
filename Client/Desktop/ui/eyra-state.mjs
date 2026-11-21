// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: latestParagraph; roleLive; RoleState; EyraState; bindEyraGesture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/eyra-state.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// A projection of the original CORE session. Timers never change execution.
import {activeStates,attentionStates} from './model.mjs';
import {stageActivityVisible} from './stage-layout.mjs';
import {messageInTurn,liveInTurn,turnInput,turnInputs} from './turn-scope.mjs';
import {connectionGuidance} from './setup-guidance.mjs';

export function latestParagraph(value,limit=520){
  const full=String(value||'').trim(),paragraphs=full.split(/\n\s*\n/u).filter(s=>s.trim());
  const paragraph=(paragraphs.at(-1)||'').trim(),chars=Array.from(paragraph);
  return {text:chars.length>limit?'…'+chars.slice(-limit).join(''):paragraph,details:paragraph!==full||chars.length>limit};
}

export function roleLive(snapshot,name='matrix'){
  const row=snapshot?.roles?.find(r=>r.role===name),live=snapshot?.live?.[name]||{};
  return liveInTurn(live,row)?live:{};
}

// Each role has one projection shared by its home, folded and native surfaces.
// A theme consumes these facts; it never reconstructs request identity itself.
export class RoleState{
  constructor({role='matrix',ttl=10000,storage=null}={}){this.role=role;this.storageKey=role==='matrix'?'eyra-preview':'role-preview:'+role;this.ttl=ttl;this.storage=storage;this.scope='';this.worked=false;this.preview=null;this.thoughtFloor=0;this.invalidBodies=new Set();this.lastThought='';this.savedPreview=null;}
  restore(scope){
    this.scope=scope;this.worked=false;this.preview=null;this.thoughtFloor=0;this.invalidBodies.clear();this.lastThought='';this.savedPreview=null;
    try{const saved=JSON.parse(this.storage?.getItem(this.storageKey)||'null');if(saved?.scope===scope){this.thoughtFloor=Number(saved.thoughtFloor)||0;this.lastThought=saved.lastThought||'';this.invalidBodies=new Set((saved.invalidBodies||[]).slice(-64));this.savedPreview=saved.preview;}}catch{}
  }
  invalidate(id){if(id)this.invalidBodies.add(id);while(this.invalidBodies.size>64)this.invalidBodies.delete(this.invalidBodies.values().next().value);}
  persist(){try{const value=JSON.stringify({scope:this.scope,thoughtFloor:this.thoughtFloor,lastThought:this.lastThought,invalidBodies:[...this.invalidBodies],preview:this.savedPreview});if(value!==this.persisted){this.storage?.setItem(this.storageKey,value);this.persisted=value;}}catch{}}
  project(snapshot,{items=[],workItems=items,disconnected=false,pending=[],now=Date.now(),toolRunning=false}={}){
    const primary=this.role==='matrix',role=snapshot.roles?.find(r=>r.role===this.role)||{},live=roleLive(snapshot,this.role);
    const input=activeStates.has(role.state)&&live.turn_id?turnInputs(snapshot.messages,role).find(m=>m.id===live.turn_id)||turnInput(snapshot.messages,role):turnInput(snapshot.messages,role);
    const scope=[snapshot.core_epoch,snapshot.session_id,role.id,role.generation||0,input?.id||''].join(':');
    if(scope!==this.scope)this.restore(scope);
    const active=activeStates.has(role.state),executed=typeof role.execution_started==='boolean'?role.execution_started:items.some(i=>i.generation===role.generation&&(!i.agent||i.agent===role.id)&&i.tool&&!['update_plan','memory','compact','toolbox','team','exec','wait'].includes(i.tool)&&['running','completed'].includes(i.state));
    // 做计划也算开始工作（UI设计知识库 形态 §1：本轮第一次调用工具或做计划时进入工作形态）；CORE 的 execution_started 不把计划算作执行，所以只认已经生效的计划。
    const planned=items.some(i=>i.generation===role.generation&&(!i.agent||i.agent===role.id)&&i.tool==='update_plan'&&i.state==='completed');
    // Direct memory calls have inspectable receipts even though Core accounts
    // them as preparation. Subconscious maintenance has its own chat timeline.
    const receiptShown=items.some(i=>i.generation===role.generation&&(!i.agent||i.agent===role.id)&&stageActivityVisible(i));
    // 派工也是 Eyra 调用了工具。只发消息、Eyra 还没动作时不算。
    const dispatched=items.some(i=>i.generation===role.generation&&(!i.agent||i.agent===role.id)&&i.tool==='team'&&['running','completed'].includes(i.state));
    if(executed||planned||receiptShown||dispatched)this.worked=true;
    const valid=(snapshot.messages||[]).filter(m=>m.from===this.role&&(!primary||m.to==='user')&&messageInTurn(m,role,snapshot.messages)&&!['cancelled','failed','timed_out','interrupted','persistence_failed'].includes(m.state));
    const archived=valid.at(-1),liveBody=!!live.text&&!live.new_body;
    const final=!active&&archived&&archived.state!=='commentary';
    const archivedBody=archived?{id:archived.id,text:archived.text,at:Date.parse(archived.at)||0}:null;
    let body=final?archivedBody:liveBody?{id:live.body_id||'live',text:live.text,at:Number(live.body_at)/1000||0,updatedAt:Number(live.body_updated_at)||0}:archivedBody;
    const thinking=live.phase==='thinking',thoughtToken=[live.body_id,live.reasoning_started_at||live.thought_at||0].join(':');
    if(thinking&&thoughtToken!==this.lastThought){
      this.lastThought=thoughtToken;this.thoughtFloor=Math.max(this.thoughtFloor,Number(live.reasoning_started_at)||Number(live.thought_at)||now);
      this.invalidate(this.preview?.id);this.invalidate(body?.id);
      this.preview=null;
    }
    // A carried thought from the previous request is not a new event. A current
    // reasoning receipt, however, invalidates an older body even if polling
    // missed the entire thinking phase.
    const reasoning=[...(live.reasoning_history||[])].at(-1);
    if(reasoning?.started_at>this.thoughtFloor){
      this.thoughtFloor=reasoning.started_at;
      if(this.preview&&this.preview.at<=this.thoughtFloor){this.invalidate(this.preview.id);this.preview=null;}
    }
    // Core keeps one body ID across multiple output parts in a request. A
    // later reasoning part retires the old text, not the new body that follows
    // it. Only an actual newer live body can reopen this identity.
    if(active&&liveBody&&live.phase==='body'&&this.thoughtFloor>0&&body?.at>this.thoughtFloor)this.invalidBodies.delete(body.id);
    if(body&&(thinking||this.invalidBodies.has(body.id)||this.thoughtFloor>0&&(!body.at||body.at<=this.thoughtFloor)))body=null;
    if(primary&&!role.generation&&!pending.length&&!body&&['online','local'].includes(snapshot.greeting?.state))body={id:'greeting:'+snapshot.core_epoch,text:snapshot.greeting.text,at:0};
    // Acknowledging transport does not mean the execution has started. The
    // durable queue owns this boundary after the local outbox disappears.
    const submitted=[...(snapshot.messages||[]).filter(m=>m.from==='user'&&(!m.to||m.to===this.role)&&['queued','context'].includes(m.state)),...pending];
    // A supplement belongs to the input queue; it does not retire an active response.
    if(submitted.length&&!active){this.invalidate(this.preview?.id);this.invalidate(body?.id);this.preview=null;body=null;}
    if(disconnected)body=null;
    if(body?.text){
      const kind=final?'final':'progress',signature=JSON.stringify([body.id,body.text,kind]);
      if(this.preview?.signature!==signature){
        // 轮询与重载不续期，实际新分块才续期。到达时间来自 CORE，不能用首分块冒充最后更新。
        let hash=2166136261;for(const char of body.text)hash=Math.imul(hash^char.codePointAt(0),16777619)>>>0;
        const key=JSON.stringify([body.id,body.text.length,hash,kind]);
        let expires=this.savedPreview?.key===key?Number(this.savedPreview.expires):
          this.preview?.id===body.id?now+this.ttl:(body.updatedAt||body.at||now)+this.ttl;
        if(!Number.isFinite(expires))expires=now+this.ttl;
        this.savedPreview={key,expires};
        this.preview={...body,...latestParagraph(body.text),full:body.text,kind,signature,expires};
      }
    }
    if(disconnected)this.preview=null;
    this.persist();
    let state='idle';
    if(disconnected)state='offline';
    else if(role.state==='cancelling')state='cancelling';
    else if(role.state==='waiting_user')state='waiting_user';
    else if(attentionStates.has(role.state))state='error';
    // 长命令执行期间 CORE 的 live 阶段是 settled（模型这一段已经说完、在等工具返回），不是 tool；
    // 只要有工具正在跑，就按“正在操作”显示，光圈不会因为落进 waiting 而看起来卡住（用户 2026-10-16 夜）。
    else if(active)state=live.phase==='compacting'?'compacting':thinking?'thinking':live.phase==='tool'||toolRunning&&live.phase!=='body'?(executed||toolRunning?'tool':'preparing'):live.phase==='body'?'body':'waiting';
    else if(submitted.length)state=submitted.every(m=>m.rejected)?'queued':'confirming';
    else if(primary&&snapshot.ready===false)state='offline';
    else if(primary&&snapshot.greeting?.state==='connecting')state='connecting';
    else if(primary&&snapshot.greeting?.state==='offline'&&!role.generation)state='offline';
    // 正文不再按展示期消散（用户 2026-10-10）：一直留到新思考、新正文、用户发出或换轮次时才让位。
    // expires 只保留给旧调用方读取，不再决定显示。
    const preview=this.preview&&!thinking?this.preview:null;
    const user=[...(snapshot.messages||[]),...pending].findLast(m=>m.from==='user');
    // 工作形态的正文条（UI设计知识库 形态 §6）：正文停留到下一次思考；新思考开始时 this.preview 已被清掉。
    const workBody=preview&&!disconnected?preview:null;
    const connection=connectionGuidance(state==='offline'?snapshot.greeting:{},disconnected,state==='offline'&&primary?snapshot.ready:undefined);
    // A submitted input owns a fresh reader immediately, before Core advances
    // its generation. Retained live tails belong to the previous execution;
    // they are history, never the contents of this confirming reader.
    const displayInput=active?input:submitted[0]||input;
    const turnID=displayInput?.id||'';
    const workKey=JSON.stringify([snapshot.core_epoch,snapshot.session_id,this.role,turnID||'generation:'+(role.generation||0)]);
    const workLive=active&&(!live.turn_id||!turnID||live.turn_id===turnID)?live:{};
    const shownItems=active?workItems.filter(i=>(i.generation===undefined||i.generation===role.generation)&&(!i.agent||!role.id||i.agent===role.id)&&(!i.turn_id||!turnID||i.turn_id===turnID)):[];
    return {state,active,turnID,workKey,live:workLive,workItems:shownItems,submitted:submitted.length>0,thought:state==='thinking'?String(workLive.thought||'').trim():'',worked:this.worked,mode:active&&this.worked?'work':'chat',compact:false,preview,body:workBody,user,caption:connection?.title||(state==='error'?role.failure?.title||'工作中断，记录已保留。':''),captionReason:connection?.reason||'',connectionAction:connection?.action||'',needsSetup:connection?.needsSetup===true};
  }
}

export class EyraState extends RoleState{
  constructor(options={}){super({...options,role:'matrix'});}
}

// Pointer clicks need a short ambiguity window; keyboard actions are immediate.
// 按住移动超过阈值即为拖动：取消待定的单击，松手后的 click 不再触发输入。
export function bindEyraGesture(node,{input,history,drag=null,delay=500,threshold=6},win=window){
  let timer=0,press=null,dragged=false;
  const cancel=()=>{win.clearTimeout(timer);timer=0;};
  const click=e=>{if(dragged){dragged=false;e.preventDefault();return;}if(e.detail===0){cancel();input();return;}if(e.detail>1){cancel();return;}cancel();timer=win.setTimeout(()=>{timer=0;input();},delay);};
  const double=e=>{e.preventDefault();cancel();history();};
  const down=e=>{if(drag&&e.button===0&&e.isPrimary!==false)press={id:e.pointerId,x:e.clientX,y:e.clientY,moving:false};};
  const move=e=>{
    if(!press||e.pointerId!==press.id)return;
    const dx=e.clientX-press.x,dy=e.clientY-press.y;
    if(!press.moving&&Math.hypot(dx,dy)>threshold){press.moving=true;cancel();try{node.setPointerCapture?.(e.pointerId);}catch{}drag.start?.(e);}
    if(press.moving)drag.move?.(e,dx,dy);
  };
  const up=e=>{
    if(!press||e.pointerId!==press.id)return;
    const moved=press.moving;press=null;try{node.releasePointerCapture?.(e.pointerId);}catch{}
    if(moved){dragged=true;drag.end?.(e);win.setTimeout(()=>{dragged=false;},0);}
  };
  node.addEventListener('click',click);node.addEventListener('dblclick',double);
  node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);
  return ()=>{cancel();node.removeEventListener('click',click);node.removeEventListener('dblclick',double);node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',up);};
}
