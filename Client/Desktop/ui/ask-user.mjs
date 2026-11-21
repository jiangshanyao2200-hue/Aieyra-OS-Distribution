// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: node; decisionRequests; createDecisionPanel; createDecisionSession; setupAskUser; setupPendingSupplements
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/ask-user.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {activeStates} from './model.mjs';
import {syncProperty,syncAttribute} from './interaction.mjs';
import {animateUI,cancelMotion,motionAllowed} from './motion.mjs';

const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};

// Two Core question protocols, one presentation and the original reply paths.
// Keys include every immutable origin field; no view owns a second work queue.
export function decisionRequests(snapshot){
 const key=(kind,q)=>JSON.stringify([snapshot?.core_epoch,snapshot?.session_id,kind,q.agent_id||'',q.generation||0,q.id,q.version||1]);
 return [
  ...(snapshot?.ask_requests||[]).filter(q=>q.state==='pending').map(q=>({...q,key:key('ask',q),kind:'ask',recommendation:q.assumption,options:(q.options||[]).map((o,i)=>({...o,id:String(i+1),detail:o.description,recommended:q.recommended===i+1}))})),
  ...(snapshot?.roles||[]).flatMap(r=>(r.human_requests||[]).filter(q=>q.state==='waiting_user').map(q=>({...q,key:key('human',q),kind:'human',options:(q.options||[]).map(o=>({...o,detail:o.impact}))}))),
 ];
}

// The same view mounts above the existing composer in Home and its native layer.
// It only reports intent. Rendering, choosing and minimizing never submit.
export function createDecisionPanel(parent,{doc=parent.ownerDocument,onAction=()=>{}}={}){
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 const panel=make('section','ask-user'),head=make('nav','ask-head'),pages=make('span','ask-pages'),count=make('span'),title=make('h3','ask-question'),recommendation=make('p','ask-recommendation'),options=make('div','ask-options'),facts=make('details','ask-context'),error=make('p','ask-error'),foot=make('div','ask-foot');
 panel.id='ask-user';panel.hidden=true;panel.setAttribute('aria-label','待回答的问题');title.id='ask-question';options.setAttribute('role','group');options.setAttribute('aria-labelledby',title.id);error.setAttribute('role','alert');
 let current=null,signature='',layoutSignature='',revision=0,animation=null,editorAnimation=null,editorBefore=null,editorTarget=null;
 const button=(label,action,cls='quiet')=>{const b=make('button',cls,label);b.type='button';b.onclick=()=>onAction(action,'',current?.key);return b;};
 const prev=button('‹','prev'),next=button('›','next'),later=button('稍后','later'),skip=button('跳过','skip'),confirm=button('确认','submit','ask-confirm ui-outline');prev.setAttribute('aria-label','上一个问题');next.setAttribute('aria-label','下一个问题');pages.append(prev,count,next);head.append(pages,later,skip);
 const summary=make('summary','','查看依据与影响'),context=make('div'),content=make('div','ask-content'),layout=make('div','ask-layout');facts.append(summary,context);foot.append(confirm);content.append(title,recommendation,options,facts,error);layout.append(head,content,foot);panel.append(layout);parent.prepend(panel);
 // Keep the real composer at its natural size. Only this small layout sleeve
 // changes height, so textarea auto-sizing never feeds back on every frame.
 const editor=parent.querySelector('#composer'),editorLayout=editor?make('div','ask-editor-layout'):null;
 if(editor){parent.insertBefore(editorLayout,editor);editorLayout.append(editor);}
 const captureEditor=()=>{if(!editorLayout?.getBoundingClientRect)return;if(editorBefore===null)editorBefore=editorLayout.getBoundingClientRect().height;cancelMotion(editorLayout,'decision-editor-layout');editorAnimation?.cancel();editorAnimation=null;};
 // Reserve the real space while revealing an unscaled inner layout. Capture
 // interrupted geometry before cancelling; task state never waits for motion.
 const zero=()=>({height:'0px',marginBottom:'0px',opacity:0});
 const geometry=()=>{if(panel.hidden)return zero();const s=doc.defaultView.getComputedStyle(panel);return {height:panel.getBoundingClientRect().height+'px',marginBottom:s.marginBottom,opacity:s.opacity};};
 const release=()=>{animation?.cancel();editorAnimation?.cancel();animation=editorAnimation=null;editorBefore=editorTarget=null;layout.style.height='';layout.style.flex='';panel.hidden=!current;parent.classList.toggle('decision-composer',!!current);};
 const settle=()=>{revision++;cancelMotion(panel,'decision-layout');if(editorLayout)cancelMotion(editorLayout,'decision-editor-layout');release();};
 const transition=before=>{
  panel.inert=!current;syncAttribute(panel,'aria-hidden',!current);
  if((!before&&editorBefore===null)||!motionAllowed(parent)){release();return;}
  const oldEditor=editorBefore;editorBefore=null;
  panel.hidden=false;const target=current?geometry():zero(),height=layout.getBoundingClientRect().height,newEditor=editor?.getBoundingClientRect().height;
  editorTarget=newEditor;
  const token=revision;
  if(before&&!Object.keys(target).every(k=>target[k]===before[k])){layout.style.height=height+'px';layout.style.flex='none';animation=animateUI(panel,[before,target],{kind:'move',key:'decision-layout',fill:'both'});}
  // Even equal-height drafts need a stable sleeve while the panel moves:
  // typing can grow the real editor before ResizeObserver has delivered.
  if(editorLayout&&oldEditor!==null&&(Math.abs(oldEditor-newEditor)>.1||animation))editorAnimation=animateUI(editorLayout,[{height:oldEditor+'px',overflow:'clip'},{height:newEditor+'px',overflow:'clip'}],{kind:'move',key:'decision-editor-layout',fill:'both'});
  const active=[animation,editorAnimation].filter(Boolean);
  if(!active.length){release();return;}
  // Resolve both dimensions on one timeline; their sum then follows the same
  // easing even when restoring the composer makes it taller than before.
  const start=doc.timeline?.currentTime;if(Number.isFinite(start))for(const a of active)a.startTime=start;
  const done=()=>{if(token!==revision||retargetEditor())return;cancelMotion(panel,'decision-layout');if(editorLayout)cancelMotion(editorLayout,'decision-editor-layout');release();};
  void Promise.allSettled(active.map(a=>a.finished)).then(done);
 };
 // Typing can change the natural editor size while its sleeve is moving. Read
 // both current dimensions before cancelling, then resume the shared motion.
 // The finish guard also covers input arriving before ResizeObserver delivery.
 const retargetEditor=()=>{
  if(!editorAnimation||editorBefore!==null||Math.abs(editor.getBoundingClientRect().height-editorTarget)<.1)return false;
  const before=geometry();captureEditor();revision++;
  cancelMotion(panel,'decision-layout');animation?.cancel();animation=null;
  layout.style.height='';layout.style.flex='';transition(before);return true;
 };
 const editorObserver=editor&&doc.defaultView?.ResizeObserver?new doc.defaultView.ResizeObserver(retargetEditor):null;editorObserver?.observe(editor);
 const resized=()=>{if(animation||editorAnimation)settle();};doc.defaultView?.addEventListener('resize',resized);
 return {element:panel,captureEditor,paint(value){
  const shape=value?JSON.stringify([value.key,value.question,value.recommendation,value.options,value.facts,value.impact,value.error,value.count]):'';
  const changed=shape!==layoutSignature,before=changed&&panel.getBoundingClientRect?geometry():null;
  if(changed){if(editorAnimation)captureEditor();revision++;cancelMotion(panel,'decision-layout');animation?.cancel();animation=null;layout.style.height='';layout.style.flex='';layoutSignature=shape;}
  current=value;if(!value){if(changed||editorBefore!==null)transition(before);else if(!animation&&!editorAnimation)release();return;}panel.hidden=false;parent.classList.toggle('decision-composer',true);
  panel.dataset.questionKey=value.key;syncAttribute(panel,'aria-busy',!!value.busy);
  syncProperty(title,'textContent',value.question);syncProperty(recommendation,'textContent',value.recommendation||'');recommendation.hidden=!value.recommendation;
  syncProperty(count,'textContent',`${value.index+1} / ${value.count}`);pages.hidden=value.count<2;skip.hidden=value.kind!=='ask';skip.disabled=!!value.locked;prev.disabled=!!value.busy||value.index===0;next.disabled=!!value.busy||value.index===value.count-1;
  const key=JSON.stringify([value.key,value.options]);if(signature!==key){signature=key;options.replaceChildren();facts.open=false;
   for(const o of value.options||[]){const b=make('button','ask-option'),label=make('strong','',o.label),detail=make('span','',o.detail);b.type='button';b.dataset.option=o.id;b.setAttribute('aria-pressed','false');b.append(label);if(o.recommended)b.append(make('small','ask-suggestion','推荐'));if(o.detail)b.append(detail);b.onclick=()=>onAction('choose',o.id,current?.key);options.append(b);}
  }
  for(const b of options.children){syncAttribute(b,'aria-pressed',b.dataset.option===value.selected);b.disabled=!!value.locked;}
  options.hidden=!options.childElementCount;syncProperty(context,'textContent',[value.facts,value.impact].filter(Boolean).join('\n\n'));facts.hidden=!context.textContent;
  syncProperty(error,'textContent',value.error||'');error.hidden=!value.error;
  const recommended=value.kind==='ask'&&!value.selected&&!value.hasText&&!value.skipped;
  syncProperty(confirm,'textContent',value.busy?'正在提交':value.retry?'重试提交':value.index<value.count-1?(recommended?'采用推荐并继续':'下一题'):value.count>1?(recommended?'采用推荐并提交':'提交全部'):(recommended?'采用推荐':'确认回答'));confirm.disabled=!!value.busy;
  if(changed||editorBefore!==null)transition(before);
 },close(){editorObserver?.disconnect();current=null;settle();doc.defaultView?.removeEventListener('resize',resized);if(editorLayout){parent.insertBefore(editor,editorLayout);editorLayout.remove();}panel.remove();}};
}

// Shared decision state for OS and program sessions. The host owns replies;
// each surface supplies its existing editor, focus and retained presentation.
export function createDecisionSession(api,{check,onError=()=>{},onReply,openChat=()=>{},openInput=()=>{},getEditor,setEditor,readText,isComposing=()=>false,beforeEditor=()=>{},onFrame=()=>{},focusInput=()=>{},focusLater=()=>{},available=()=>true,ownsTarget=()=>true,hasInput=()=>!!getEditor().value,storage=globalThis.sessionStorage}){
 const drafts=new Map(),closed=new Set();let scope='',snapshot=null,pending=[],requests=[],current=0,minimized=false,disposed=false,bound='',normal=null,projected=null,nativeComposing=false,batch=null;
 const question=()=>requests[current];
 const draft=q=>{if(!drafts.has(q.key)){let saved;try{saved=JSON.parse(storage.getItem('decision:'+q.key)||'null');}catch{}drafts.set(q.key,{editor:{value:'',pastes:'',selection:[0,0,'none']},selected:'',text:'',ready:false,action:'answer',request_id:crypto.randomUUID(),...saved,busy:false,error:''});}return drafts.get(q.key);};
 const store=q=>{try{storage.setItem('decision:'+q.key,JSON.stringify(draft(q)));}catch{}};
 const saveCurrent=()=>{const q=requests.find(q=>q.key===bound);if(q){const d=draft(q);if(d.submission)return;d.editor=getEditor();try{d.text=readText().trim();d.readError='';}catch(e){d.readError=e.message;}store(q);}};
 const changeEditor=(value,active)=>{beforeEditor();setEditor(value,active);};
 const restore=()=>{if(!bound)return;saveCurrent();bound='';const saved=normal;normal=null;if(saved)changeEditor(saved,false);};
 function paint(){
  if(disposed)return;requests=(batch?batch.rows.filter(r=>batch.busy||!r.done).map(r=>r.q):pending.filter(q=>!closed.has(q.key)));current=Math.min(current,Math.max(0,requests.length-1));const q=question(),show=!!q&&!minimized&&available();
  if(bound&&(!show||bound!==q.key))restore();
  if(show&&!bound){normal=getEditor();bound=q.key;changeEditor(draft(q).editor,true);openInput();}
  const d=q&&draft(q);projected=show?{...q,index:current,count:requests.length,selected:d.selected,busy:!!batch?.busy||d.busy,locked:!!batch||d.busy||!!d.submission,retry:!!batch&&!batch.busy||!!d.submission&&!d.busy,error:d.error,hasText:!!d.editor.value.trim(),skipped:d.action==='skip'}:null;onFrame(projected,{count:requests.length,pending:!!q});

 }
 const invalid=q=>{const d=draft(q),text=d.text||'';if(d.submission||d.action==='skip')return '';if(d.readError)return d.readError;if(q.kind==='human'&&q.input_schema?.required&&!text)return '请在输入框填写回答。';if(!d.selected&&!text&&!d.ready)return '请选择一个选项，或在输入框回答。';return '';};
 const problem=(q,message)=>{current=requests.findIndex(r=>r.key===q.key);draft(q).error=message;paint();focusInput();};
 async function sendBatch(own){
  if(own.busy)return true;own.busy=true;for(const r of own.rows)if(!r.done){r.d.busy=true;r.d.error='';}paint();
  try{
   for(const r of own.rows){
    // Do not continue an old group into another task, including after a late
    // success. Each original Core receipt keeps its own immutable identity.
    if(disposed||scope!==own.scope||batch!==own)return true;if(r.done)continue;
    check(await (r.q.kind==='ask'?api.askReply(r.d.submission):api.humanReply(r.d.submission)));
    if(disposed||scope!==own.scope||batch!==own)return true;
    r.done=true;closed.add(r.q.key);storage.removeItem('decision:'+r.q.key);
   }
  }catch(e){if(scope===own.scope&&batch===own){const row=own.rows.find(r=>!r.done);if(row){row.d.error=e.message||'提交尚未确认，请重试。';store(row.q);onError(row.d.error);}}}
  finally{
   own.busy=false;for(const r of own.rows)r.d.busy=false;
   if(!disposed&&scope===own.scope&&batch===own){const failed=own.rows.find(r=>!r.done);if(!failed)batch=null;else current=0;paint();}
  }
  if(!disposed&&scope===own.scope&&!batch)await onReply?.();return true;
 }
 async function submit(action='answer'){
  const q=question();if(!q||!bound)return false;if(isComposing()||nativeComposing)return true;
  if(batch)return action==='answer'?sendBatch(batch):true;
  const d=draft(q);if(d.busy)return true;saveCurrent();
  if(!d.submission){
   if(action==='skip'&&q.kind!=='ask')return true;
   if(action!=='skip'&&d.readError){problem(q,d.readError);return true;}
   if(action!=='skip'&&q.kind==='human'&&((q.options.length&&!d.selected&&!d.text)||(q.input_schema?.required&&!d.text))){problem(q,q.input_schema?.required&&!d.text?'请在输入框填写回答。':'请选择一个选项，或在输入框回答。');return true;}
   d.ready=true;if(action==='skip')d.action='skip';d.error='';store(q);
  }
  // Pages stage answers only. Even skipping the last page does not submit.
  if(current<requests.length-1){current++;paint();focusInput();return true;}
  if(action==='skip'){paint();return true;}
  const missing=requests.find(q=>invalid(q));if(missing){problem(missing,invalid(missing));return true;}
  const rows=requests.map(q=>{const d=draft(q);d.submissionAction=d.action;
   d.submission||=q.kind==='ask'?{task_id:snapshot.session_id,id:q.id,request_id:d.request_id,action:d.action,option:d.action==='skip'?0:Number(d.selected)||0,text:d.action==='skip'?'':d.text}:{task_id:snapshot.session_id,session_id:q.session_id,agent_id:q.agent_id,generation:q.generation,human_id:q.id,expected_request_version:q.version,request_token_sha256:q.request_token_sha256,request_id:d.request_id,decision:{option_id:d.selected,text:d.text}};
   store(q);return {q,d,done:false};
  });
  batch={scope,rows,busy:false};return sendBatch(batch);
 }
 async function action(kind,value='',key=question()?.key){
  const q=question();if(!q||key!==q.key)return false;
  if(kind==='submit')return submit();if(kind==='skip')return submit('skip');
  if(kind==='later'){restore();minimized=true;paint();focusLater();return true;}
  if(batch?.busy||draft(q).busy)return false;saveCurrent();
  if(kind==='prev'||kind==='next')current=Math.max(0,Math.min(requests.length-1,current+(kind==='prev'?-1:1)));
  else if(kind==='choose'&&!batch&&!draft(q).submission){const d=draft(q);d.selected=d.selected===value?'':value;d.action='answer';d.ready=false;d.error='';store(q);}
  paint();return true;
 }
 function reveal(key){if(key){const index=requests.findIndex(q=>q.key===key);if(index<0)return;saveCurrent();current=index;}minimized=false;openChat();paint();focusInput();}
 const close=()=>{if(disposed)return;restore();disposed=true;drafts.clear();};
 return {prepare(next){if(scope!==JSON.stringify([next.core_epoch,next.session_id])){restore();batch=null;}},update(next){const own=JSON.stringify([next.core_epoch,next.session_id]);if(scope!==own){restore();scope=own;current=0;minimized=false;batch=null;drafts.clear();closed.clear();}else saveCurrent();snapshot=next;const old=question()?.key;pending=decisionRequests(next);if(!old&&!bound&&pending.length&&(isComposing()||nativeComposing||hasInput()))minimized=true;if(old&&!batch){const index=pending.findIndex(q=>q.key===old);if(index>=0)current=index;}paint();},
  composition(value){nativeComposing=!!value;},
  input(){if(bound){saveCurrent();const q=question(),d=q&&draft(q);if(d&&!d.submission&&!batch){d.action='answer';d.ready=false;d.error='';store(q);}paint();return true;}return false;},submit,action,reveal,repaint:paint,get active(){return !!bound;},get normalDraft(){return normal;},get frame(){return projected;},
  escape(e){if(e.isComposing||e.keyCode===229||e.key!=='Escape'||!bound||!ownsTarget(e.target))return false;e.preventDefault();void action('later');return true;},close};
}

export function setupAskUser(api,{check,onError,onReply,openChat=()=>{},openInput=()=>{},getEditor,setEditor,readText,isComposing=()=>false,onChange=()=>{},away=()=>!!document.body.dataset.desktopPage&&document.body.dataset.desktopPage!=='home',doc=document}){
 const input=doc.getElementById('message'),orb=doc.createElement('button');orb.className='ask-orb';orb.textContent='?';orb.id='ask-orb';orb.type='button';orb.hidden=true;orb.setAttribute('aria-controls','ask-user');(doc.getElementById('status-rail')||doc.body).append(orb);
 let session;const view=createDecisionPanel(doc.getElementById('input-dock'),{doc,onAction:(...a)=>void session.action(...a)});
 session=createDecisionSession(api,{check,onError,onReply,openChat,openInput,getEditor,setEditor,readText,isComposing,available:()=>!away(),hasInput:()=>!!input.value,beforeEditor:()=>view.captureEditor(),focusInput:()=>input.focus({preventScroll:true}),focusLater:()=>orb.focus({preventScroll:true}),ownsTarget:target=>view.element.contains(target)||target===input,
  onFrame(value,{pending,count}){view.paint(value);const show=!!value;
   doc.body.classList.toggle('has-pending-ask',pending);doc.body.dataset.decisionActive=String(show);
   input.readOnly=!!value?.locked;input.maxLength=value?.kind==='human'?8000:64000;input.placeholder=show?'选择上方选项，或在这里回答…':'在这里输入…';input.setAttribute('aria-label',show?'回答当前问题':'在画布上写下消息');
   const add=doc.getElementById('add-attachment');if(add)add.disabled=show;
   orb.hidden=!pending||show&&doc.body.dataset.chatExpanded!=='false';syncAttribute(orb,'data-count',count);syncAttribute(orb,'aria-label',`${count} 个问题，查看提问`);syncAttribute(orb,'aria-expanded',show);onChange();
  }});
 orb.onclick=()=>session.reveal();const opened=e=>session.reveal(e.detail?.key),paint=()=>session.repaint();
 doc.addEventListener('eyra:decision-open',opened);doc.addEventListener('workspace-view-change',paint);doc.addEventListener('workspace-chat-layer-change',paint);
 let disposed=false;const close=()=>{if(disposed)return;disposed=true;session.close();doc.removeEventListener('eyra:decision-open',opened);doc.removeEventListener('workspace-view-change',paint);doc.removeEventListener('workspace-chat-layer-change',paint);view.close();orb.remove();};doc.defaultView?.addEventListener?.('pagehide',close,{once:true});
 return {prepare:session.prepare,update:session.update,composition:session.composition,input:session.input,submit:session.submit,action:session.action,get active(){return session.active;},get normalDraft(){return session.normalDraft;},get frame(){return session.frame;},escape:session.escape,close};
}

export function setupPendingSupplements(api,{check,onError,onChange}){
 const root=node('section','pending-supplements');root.id='pending-supplements';root.hidden=true;root.setAttribute('aria-label','待送达的补充');
 const title=node('small','supplement-title'),toggle=node('button','supplement-toggle'),list=node('div','supplement-list');
 list.id='supplement-list';toggle.type='button';toggle.setAttribute('aria-controls',list.id);toggle.setAttribute('aria-expanded','false');
 root.dataset.expanded='false';root.append(title,toggle,list);
 const fold=()=>{root.dataset.expanded='false';toggle.setAttribute('aria-expanded','false');};
 toggle.onclick=()=>{const open=root.dataset.expanded!=='true';root.dataset.expanded=String(open);toggle.setAttribute('aria-expanded',String(open));};
 const compact=matchMedia('(max-height:480px)');compact.addEventListener('change',fold);
 document.getElementById('bottom-bar').prepend(root);
 let scope='',rows=new Map(),snapshot=null,pendingCount=0;
 const withdrawn=new Set();
 function paintCount(){syncProperty(title,'textContent',pendingCount?`将随下一次请求送达 · ${pendingCount} 条`:'');syncProperty(toggle,'textContent',pendingCount?`待送达 ${pendingCount} 条`:'');syncProperty(root,'hidden',!rows.size);}
 function update(next,transport=[]){
  const own=JSON.stringify([next.core_epoch,next.session_id]);if(scope!==own){scope=own;for(const row of rows.values())clearTimeout(row.timer);rows.clear();withdrawn.clear();list.replaceChildren();fold();}
  snapshot=next;const working=next.roles?.some(r=>activeStates.has(r.state)),messages=new Map((next.messages||[]).map(m=>[m.id,m]));
  const pending=(next.messages||[]).filter(m=>m.from==='user'&&m.to==='matrix'&&['queued','context'].includes(m.state)&&!withdrawn.has(m.id));
  if(working)for(const e of transport)if(e.session_id===next.session_id&&!e.rejection&&!messages.has(e.request_id))pending.push({id:e.request_id,text:e.text,attachments:e.attachments,transport:true});
  const ids=new Set(pending.map(m=>m.id));
  pendingCount=pending.length;
  for(const [id,row] of rows){if(ids.has(id))continue;clearTimeout(row.timer);row.el.remove();rows.delete(id);}
  if(working||rows.size)for(const m of pending){
   let row=rows.get(m.id);if(!row){const el=node('div','pending-supplement'),dot=node('i','supplement-dot'),text=node('span','supplement-text'),button=node('button','','×');dot.setAttribute('aria-hidden','true');button.type='button';button.setAttribute('aria-label','撤回这条补充');el.append(dot,text,button);row={el,text,button};rows.set(m.id,row);list.append(el);}
   row.text.textContent=(m.display_text||m.text||'')+((m.attachments||[]).length?' · '+m.attachments.map(a=>a.name).join('、'):'');row.el.title=m.transport?'等待接收确认':row.text.textContent;row.button.disabled=!!m.transport;
   row.button.onclick=async()=>{const ticket=scope,keyboard=document.activeElement===row.button;row.button.disabled=true;try{check(await api.withdraw({task_id:snapshot.session_id,request_id:m.id}));if(ticket===scope){const near=row.el.nextElementSibling||row.el.previousElementSibling;withdrawn.add(m.id);row.el.remove();rows.delete(m.id);if(keyboard){const target=near?.querySelector('button:not([hidden]):not(:disabled)')||document.getElementById('message');target?.focus({preventScroll:false});}await onChange?.();}}catch(e){if(ticket===scope){onError(e.message);await onChange?.();}}finally{row.button.disabled=false;}};
  }
  paintCount();
 }
 return {update};
}
