// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: USAGE; REPORT_ID; REPORT_VIEW_STATES; documentID; documentState; validID; reportFileName; createReportHandle; reportHandleState; reportReadRequest; setupReportCircles; setupReports
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/reports.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {renderMarkdown} from './markdown.mjs';
import {refreshHTMLAppearance,reportAppearance} from './html-document.mjs';
import {trimScrollFragments} from './scroll-edges.mjs';
import {paintUsage,usageScope,usageReport} from './usage-view.mjs';
import {setupSystemNotices,redactNoticeText,createNoticeInteraction,createNoticeCopy} from './system-notices.mjs';
import {failureNoticeID,summarizeNoticeText,isPermanentNoticeError} from './failure-notice.mjs';
import {feedbackContent} from './feedback.mjs';
import {
  REPORT_FORMATS,
  REPORT_FORMAT,
  REPORT_MAX_BYTES,
  normalizeReportFormat,
  reportByteLength,
  validateReportPayload
} from './document-template.mjs';

export {
  REPORT_FORMATS,
  REPORT_FORMAT,
  REPORT_MAX_BYTES,
  normalizeReportFormat,
  reportByteLength,
  validateReportPayload
};

const USAGE='@usage';

const REPORT_ID=/^[a-f0-9]{32}$/;
export const REPORT_VIEW_STATES=Object.freeze(['available','open','minimized','closed']);

function documentID(document){return document?.id??document?.document_id??'';}
function documentState(document,view){
  if(document?.dismissed||view==='closed')return 'closed';
  return REPORT_VIEW_STATES.includes(view)?view:'available';
}
function validID(id){
  const value=String(id||'').trim().toLowerCase();
  if(!REPORT_ID.test(value))throw new TypeError('报告编号无效');
  return value;
}

// A handle is deliberately a protocol-relative reference.  It contains no
// local filesystem path; CORE remains the authority that maps this name to
// reports/documents/<id>.<format> and reads the bounded file.
export function reportFileName(id,format){
  return 'documents/'+validID(id)+'.'+normalizeReportFormat(format);
}

export function createReportHandle(document,taskId='',view){
  const id=validID(documentID(document)),format=normalizeReportFormat(document?.format);
  const task=taskId===''||taskId==null?document?.task_id??'':taskId;
  const revision=Number.isSafeInteger(Number(document?.revision))&&Number(document.revision)>=0?Number(document.revision):0;
  const state=documentState(document,view);
  const file=reportFileName(id,format);
  const handle={
    kind:'report',
    key:(task?String(task)+':':'')+id,
    id,
    document_id:id,
    task_id:String(task||''),
    title:String(document?.title||'报告'),
    format,
    file,
    path:file,
    revision,
    state,
    read:Boolean(document?.read),
    pinned:Boolean(document?.pinned),
    dismissed:state==='closed',
    request:Object.freeze({task_id:String(task||''),id})
  };
  return Object.freeze(handle);
}

export function reportHandleState(handle,action){
  if(!handle||typeof handle!=='object')throw new TypeError('需要报告句柄');
  const next={...handle};
  if((handle.dismissed||handle.state==='closed')&&(action==='open'||action==='minimize')){
    return Object.freeze({...next,state:'closed',dismissed:true,pinned:false});
  }
  if(action==='open'){next.state='open';next.dismissed=false;}
  else if(action==='minimize'){next.state='minimized';next.dismissed=false;}
  else if(action==='close'){next.state='closed';next.dismissed=true;next.pinned=false;}
  else if(action==='recall'||action==='recall_report'){next.state='available';next.dismissed=false;next.read=false;}
  else throw new TypeError('未知报告视图动作');
  return Object.freeze(next);
}

export function reportReadRequest(handle){
  if(!handle||typeof handle!=='object')throw new TypeError('需要有效报告句柄');
  const id=validID(handle.id);
  return Object.freeze({task_id:String(handle.task_id||''),id});
}

// 报告入口（用户 2026-10-15）：和计划一样，左侧状态栏只有一个圆；悬停露出最新一份的标题，点开是报告列表弹窗。
export function setupReportCircles(openDocument,{onError}={}){
  const rail=document.getElementById('status-rail');
  const root=document.createElement('div'),ball=document.createElement('button'),pill=document.createElement('div'),pop=document.createElement('section');
  root.id='report-orb';root.className='rail-orb report-orb';root.dataset.pill='hover';root.hidden=true;
  ball.id='report-ball';ball.type='button';ball.className='plan-ball report-ball';ball.setAttribute('aria-expanded','false');ball.setAttribute('aria-controls','report-pop');
  // Keep the report orb on the exact same rail geometry as the update-plan
  // orb: 44px ring, glyph layer, spark layer, pill and the same hover/expand
  // state.  Only the glyph and list action differ.
  ball.innerHTML='<svg class="plan-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="plan-track" cx="22" cy="22" r="20"/><circle class="plan-arc" cx="22" cy="22" r="20" pathLength="100"/></svg><svg class="plan-glyph report-glyph" viewBox="0 0 24 24" aria-hidden="true"><path class="l1" d="M7 3.5h7l3.5 3.5v13.5H7z"/><path class="l2" d="M14 3.5V7h3.5"/><path class="l3" d="M9.5 11.5h5M9.5 14.5h5M9.5 17.5h3"/></svg><span class="plan-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><b class="report-count" aria-hidden="true"></b>';
  pill.className='plan-pill';pill.innerHTML='<span class="plan-track-text"><span class="plan-line"></span></span><small></small>';
  root.append(ball,pill);
  pop.id='report-pop';pop.setAttribute('aria-label','报告');pop.hidden=true;
  (rail||document.body).prepend(root);document.body.append(pop);
  let scope='',handles=[],byKey=new Map(),signature='',open=false,closed=false,previousUnread=0;
  // Themes may move the original rail. Publish its actual visibility on the
  // retained reader instead of making every unrelated DOM edit recheck :has().
  const reader=document.getElementById('document-viewer');
  const reserveEntry=visible=>{if(reader&&reader.hasAttribute('data-report-entry')!==visible)reader.toggleAttribute('data-report-entry',visible);};
  reserveEntry(false);
  function activate(key){
    const handle=byKey.get(key);if(!handle)return;close();
    try{Promise.resolve(openDocument(handle)).catch(error=>onError?.(error?.message||String(error)));}
    catch(error){onError?.(error?.message||String(error));}
  }
  function close(focus=false){if(!open)return;open=false;pop.hidden=true;ball.setAttribute('aria-expanded','false');if(focus)ball.focus({preventScroll:true});}
  function renderList(){
    const head=document.createElement('header');head.className='plan-head';
    const h=document.createElement('h2');h.textContent='报告';
    const meta=document.createElement('p');meta.className='plan-progress-text';meta.textContent=handles.length+' 份 · 关闭后会从这里消失';
    head.append(h,meta);
    const list=document.createElement('ol');list.className='report-list';
    for(const handle of handles){
      const item=document.createElement('li'),b=document.createElement('button');
      b.type='button';b.className='report-item';b.dataset.reportKey=handle.key;b.dataset.state=handle.state;
      b.setAttribute('aria-pressed',String(handle.state==='open'));
      const tag=document.createElement('span');tag.className='report-format';tag.textContent=handle.format==='html'?'HTML':'MD';
      const title=document.createElement('strong');title.textContent=handle.title;
      const state=document.createElement('small');state.textContent=handle.state==='open'?'正在阅读':handle.state==='minimized'?'已最小化':handle.read?'已读':'未读';
      b.append(tag,title,state);b.onclick=()=>activate(handle.key);item.append(b);list.append(item);
    }
    pop.replaceChildren(head,list);
  }
  function paint(){
    const hidden=!handles.length;if(root.hidden!==hidden)root.hidden=hidden;
    reserveEntry(!hidden);
    if(!handles.length){close();signature='';return;}
    const next=JSON.stringify([scope,handles.map(h=>[h.key,h.title,h.format,h.state,h.read])]);
    if(next===signature)return;signature=next;
    const latest=handles[0],unread=handles.filter(h=>!h.read&&h.state!=='open').length;
    ball.querySelector('.report-count').textContent=handles.length>1?String(handles.length):'';
    root.dataset.unread=String(unread>0);
    root.dataset.active=String(unread>0);
    root.style.setProperty('--dash',handles.length?String(Math.max(8,Math.round((handles.length-unread)/handles.length*100))+' 100'):'0 100');
    ball.setAttribute('aria-label','报告，共 '+handles.length+' 份');ball.title=latest.title;
    pill.querySelector('.plan-line').textContent=latest.title;pill.querySelector('small').textContent=handles.length+' 份';
    if(previousUnread!==0&&unread>previousUnread){root.classList.remove('pop');void root.offsetWidth;root.classList.add('pop');}
    previousUnread=unread;
    if(open)renderList();
  }
  // 点圆直接打开最新一篇（优先未读）；篇与篇之间用阅读器里的 ← → 切换，不再弹列表（用户 2026-10-16）。
  ball.onclick=()=>{const target=handles.find(h=>!h.read&&h.state!=='open')||handles[0];if(target)activate(target.key);};
  function receive(event){
    const detail=event.detail;if(!detail||!Array.isArray(detail.handles))return;
    if(scope!==detail.scope){scope=detail.scope;close();signature='';}
    byKey=new Map(detail.handles.filter(h=>h?.kind==='report'&&h.task_id===detail.task_id&&!h.dismissed&&h.state!=='closed').map(h=>[h.key,h]));
    handles=[...byKey.values()].reverse();paint();// CORE 按时间从旧到新给出；圆上只关心最新的。
  }
  const outside=event=>{if(open&&!pop.contains(event.target)&&!root.contains(event.target))close();};
  const escape=event=>{if(event.key==='Escape'&&open&&!event.isComposing){event.preventDefault();event.stopImmediatePropagation();close(true);}};
  document.addEventListener('workspace-report-handles-change',receive);
  document.addEventListener('pointerdown',outside,true);
  window.addEventListener('keydown',escape,{capture:true});
  return {close(){
    if(closed)return;closed=true;
    document.removeEventListener('workspace-report-handles-change',receive);
    document.removeEventListener('pointerdown',outside,true);
    window.removeEventListener('keydown',escape,{capture:true});
    reserveEntry(false);
    root.remove();pop.remove();
  }};
}

export function setupReports(api,check,renderHTML,navigation){
  const $=id=>document.getElementById(id),viewer=$('document-viewer'),listeners=[];
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  // Reports are a page in the shared OS surface.  Keep the visibility check
  // independent of HTMLDialogElement so the renderer cannot accidentally
  // reintroduce a modal popup for a document.
  const viewerVisible=()=>!viewer.hidden;
  const confirmed=new Map(),overrides=new Map(),positions=new Map(),chains=new Map(),local=new Map(),noticeKeys=new Map(),awaitingSnapshot=new Map(),viewStates=new Map();
  let documents=[],snapshot={},scope='',scopeRevision=0,selected='',request=0,loaded=false,usageSignature='',handleSignature='',retryTimer=0,cancelHTML=null;
  const systemNotices=$('system-slot')?setupSystemNotices({onOpen:()=>dismissToasts(),nativeOpen:api.systemNoticeSurface?value=>api.systemNoticeSurface(value):null,markRead:id=>change(id,'read'),dismiss:id=>change(id,'close'),load:async doc=>{
    const entry=local.get(doc.id),target=scopeRevision,task_id=snapshot.session_id;
    const result=entry?{document:entry,content:entry.content+(entry.saveError?'\n\n系统信息尚未保存：'+entry.saveError+'。本条仅在当前窗口保留，请复制需要的内容。':'')}:check(await api.document({task_id,id:doc.id}));
    if(target!==scopeRevision)throw Error('已切换任务');return result;
  }}):{paint(){},show(){}};
  const accept=doc=>{
    const old=confirmed.get(doc.id);
    if(!old||Number(doc.revision||0)>=Number(old.revision||0)){
      if(old?.dismissed&&!doc.dismissed&&Number(doc.revision||0)>Number(old.revision||0))viewStates.delete(doc.id);
      confirmed.set(doc.id,doc);return doc;
    }
    return old;
  };
  const safeHandle=(doc,state=viewStates.get(doc?.id))=>{
    try{return createReportHandle(doc,snapshot.session_id,state);}catch{return null;}
  };
  const getHandle=id=>safeHandle(documents.find(doc=>doc.id===id));
  // 报告圆只收 Eyra 用 report 发布的文档。长回复的自动副本（kind=record，旧版本里是标题为「这次的记录」的 report）不是报告。
  const isReport=doc=>(doc?.kind==='report'||doc?.kind==null)&&!(doc?.title==='这次的记录'&&doc?.format==='md');
  const getHandles=()=>documents.filter(doc=>isReport(doc)&&!doc.dismissed).map(doc=>safeHandle(doc)).filter(Boolean);
  const setViewState=(id,state)=>{if(id&&id!==USAGE)viewStates.set(id,state);};
  function refresh(){
    // Report handles have their own rail; only system notices use the topbar.
    systemNotices.paint(scope,documents);
    if(scope!==(snapshot.core_epoch||'')+':'+snapshot.session_id)return;
    const handles=Object.freeze(getHandles()),signature=JSON.stringify({scope,handles});
    if(signature!==handleSignature){
      handleSignature=signature;
      document.dispatchEvent(new CustomEvent('workspace-report-handles-change',{detail:Object.freeze({scope,task_id:String(snapshot.session_id??''),core_epoch:snapshot.core_epoch||'',handles})}));
    }
  }
  function replace(doc){
    if(doc?.dismissed)setViewState(doc.id,'closed');
    documents=documents.some(d=>d.id===doc.id)?documents.map(d=>d.id===doc.id?doc:d):[...documents,doc];refresh();
  }
  function change(id,action){
    const doc=documents.find(d=>d.id===id);if(!doc)return Promise.resolve(false);
    const priorViewState=viewStates.get(id);
    if(action==='close')setViewState(id,'closed');
    const value={...doc,read:true,...(action==='close'?{dismissed:true,pinned:false}:{})};
    overrides.set(id,value);replace(value);
    if(local.has(id)){Object.assign(local.get(id),value);return Promise.resolve(true);}
    const targetRevision=scopeRevision,task_id=snapshot.session_id,previous=chains.get(id)||Promise.resolve();
    const current=()=>scopeRevision===targetRevision;
    const pending=previous.catch(()=>{}).then(async()=>{
      if(!current())return;
      const base=confirmed.get(id)||doc;
      try{
        let result;
        try{result=check(await api.documentState({task_id,id,action,expected_revision:base.revision||0}));}
        catch(error){
          // 另一窗口可能先保存；重读当前修订再提交同一用户动作。
          if(!current())return;
          const latest=check(await api.document({task_id,id}));if(!current())return;accept(latest.document);
          result=check(await api.documentState({task_id,id,action,expected_revision:confirmed.get(id)?.revision||0}));
        }
        if(!current())return;const saved=accept(result.document);
        if(overrides.get(id)===value){overrides.delete(id);replace(saved);}
        return true;
      }catch(error){
        if(!current())return;
        if(action==='close')setViewState(id,priorViewState||'available');
        if(overrides.get(id)===value){overrides.delete(id);replace(confirmed.get(id)||doc);}
        addNotice('消息状态未保存：'+error.message,true);
        return false;
      }
    });
    chains.set(id,pending);pending.finally(()=>{if(chains.get(id)===pending)chains.delete(id);});return pending;
  }
  let viewedUsage=null,usageRead=0;
  listen(document,'aieyra:session-status',event=>{const previous=usageScope(viewedUsage||snapshot);viewedUsage=event.detail;if(previous!==usageScope(viewedUsage)){usageRead++;usageLedger=null;usageLoading=false;usageLoadedAt=0;usageLedgerError='';}if(selected===USAGE&&loaded&&viewerVisible()){paintUsageView();void loadUsageLedger();}});
  function usageData(){
    const {summary:u,context}=usageReport(viewedUsage||snapshot,usageLedger),n=v=>Number(v||0).toLocaleString('zh-CN');
    const notes=u.samples?[]:['尚未发起模型请求。'];
    if(u.image)notes.push('图片接口已包含在累计用量中：'+n(u.image.samples)+' 次请求，'+n(u.image.reported)+' 次有完整收据，'+n(u.image.unknown)+' 次用量未知；已报告输入 '+n(u.image.input)+' / 输出 '+n(u.image.output)+' tokens。图片用量不进入聊天缓存命中率分母。');
    return {summary:u,context,notes};
  }
  function usageContent(){return JSON.stringify(usageData());}
  let usageLedger=null,usageLedgerError='',usageLoading=false;
  let usagePaintSignature='';
  function paintUsageView(force=false){
    const root=$('document-content'),ledger=usageLedger?.session===usageScope(viewedUsage||snapshot)?usageLedger:null,data={...usageData(),ledger,ledgerError:usageLedgerError},signature=JSON.stringify(data);
    if(!force&&signature===usagePaintSignature)return;
    usagePaintSignature=signature;
    paintUsage(root,data);
  }
  let usageLoadedAt=0;
  async function loadUsageLedger(force=false){
    const session=usageScope(viewedUsage||snapshot);if(!session||!api.account)return;
    if(!force&&(usageLoading||Date.now()-usageLoadedAt<1500))return;
    usageLoading=true;const mine=++usageRead;
    try{const result=check(await api.account({action:'requests_sessions',session}));if(mine!==usageRead)return;usageLedger=result;usageLedgerError='';usageLoadedAt=Date.now();}
    catch(error){if(mine===usageRead)usageLedgerError=error.message;}
    finally{if(mine===usageRead)usageLoading=false;}
    if(selected===USAGE&&loaded&&viewerVisible())paintUsageView();
  }
  function documentMeta(d,id){
    if(id===USAGE)return '';
    const at=new Date(d?.updated_at||d?.created_at||d?.at||''),time=Number.isFinite(at.getTime())?at.toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    return [d?.format&&normalizeReportFormat(d.format)==='html'?'网页报告':'报告',time].filter(Boolean).join(' · ');
  }
  // HTML 报告禁止脚本（CSP + sandbox 无 allow-scripts），同源只用于读写滚动位置，让重开和 MD 一样回到上次阅读处。
  function htmlScroller(){try{return $('document-html').contentDocument?.scrollingElement||null;}catch{return null;}}
  let historyRead=false,selectedTask='';
  function rememberPosition(){
    if(selected&&loaded&&viewerVisible())positions.set(selected,$('document-html').hidden?$('document-content').scrollTop:htmlScroller()?.scrollTop||0);
  }
  listen(document,'workspace-view-before-change',rememberPosition);
  function leave(dismiss,{keepPage=false}={}){
    const id=selected;rememberPosition();
    if(id&&id!==USAGE&&!historyRead)setViewState(id,'minimized');
    selected='';loaded=false;request++;cancelHTML?.();const saved=dismiss&&id&&id!==USAGE&&!historyRead?change(id,'close'):Promise.resolve(true);
    historyRead=false;selectedTask='';
    if(!keepPage&&viewerVisible()){if(navigation?.is('document-viewer'))navigation.home();else viewer.hidden=true;}$('document-html').hidden=true;$('document-html').srcdoc='';viewer.setAttribute('aria-busy','false');refresh();
    return saved;
  }
  function loadHTML(content,current,position=0){
    const iframe=$('document-html'),source=renderHTML(content);
    return new Promise((resolve,reject)=>{
      let frame=0,timer=0;
      const finish=(ready,error)=>{
        iframe.removeEventListener('load',onLoad);cancelAnimationFrame(frame);clearTimeout(timer);
        if(cancelHTML===cancel)cancelHTML=null;
        if(error)reject(error);else resolve(ready);
      };
      const cancel=()=>finish(false);
      const onLoad=()=>{
        if(!current()){finish(false);return;}
        // Sandboxed HTML must finish navigation before its display state is exposed.
        frame=requestAnimationFrame(()=>{
          if(!current()){finish(false);return;}
          refreshHTMLAppearance(iframe.contentDocument);iframe.hidden=false;const scroller=htmlScroller();if(scroller)scroller.scrollTop=position;finish(true);
        });
      };
      cancelHTML=cancel;iframe.hidden=true;iframe.addEventListener('load',onLoad,{once:true});
      timer=setTimeout(()=>finish(false,current()?Error('报告页面加载超时，请重试'):null),15000);
      iframe.srcdoc=source;
    });
  }
  function refreshReadingAppearance(){
    $('document-viewer').style.setProperty('--doc-left-room',reportAppearance()['--report-left-room']);
    const iframe=$('document-html');if(!iframe.hidden)refreshHTMLAppearance(iframe.contentDocument);
  }
  listen(document,'workspace-theme-change',refreshReadingAppearance);
  listen(window,'resize',refreshReadingAppearance);
  refreshReadingAppearance();
  function openTarget(target,taskId){
    const handle=target&&typeof target==='object'?target:null;
    return {
      id:String(handle?.id??handle?.document_id??target??''),
      task_id:String(handle?.task_id??taskId??'')
    };
  }
  async function open(target,fallback,task_id=snapshot.session_id){
    const requested=openTarget(target,task_id),id=requested.id,requestTask=requested.task_id;
    const fromHistory=target?.history===true;
    if(requestTask!==String(snapshot.session_id??'')&&!fromHistory)throw Error('文档所属任务已切换，请从历史中重新打开');
    const currentDoc=requestTask===String(snapshot.session_id??'')?documents.find(d=>d.id===id):null;
    if(currentDoc?.dismissed&&!fromHistory)return;
    if(!fromHistory&&!currentDoc&&target&&typeof target==='object'&&(target.dismissed||target.state==='closed'))return;
    if(currentDoc?.kind==='system'){systemNotices.show(id);return;}
    if(selected===id&&selectedTask===requestTask&&loaded&&viewerVisible())return;
    // Retire the old read/request without leaving the reader. A same-page
    // document switch must not visit Home and relocate the shared halo twice.
    if(selected)leave(false,{keepPage:viewerVisible()&&(!navigation||navigation.is('document-viewer'))});
    const ticket=++request,targetScope=scope;selected=id;selectedTask=requestTask;historyRead=fromHistory;loaded=false;if(!historyRead)setViewState(id,'open');refresh();
    $('document-title').textContent=id===USAGE?'本次用量':currentDoc?.title||'报告';viewer.dataset.kind=id===USAGE?'usage':'report';$('document-meta').hidden=true;
    refreshReadingAppearance();viewer.setAttribute('aria-busy','true');$('document-status').textContent='正在读取…';$('document-status').hidden=false;$('document-content').hidden=true;$('document-html').hidden=true;
    if(navigation)navigation.open('document-viewer',$('document-title').textContent,{viewKey:id});else viewer.hidden=false;
    try{
      const readHandle=currentDoc&&!fromHistory?safeHandle(currentDoc):null;
      const entry=requestTask===snapshot.session_id?local.get(id):null,result=id===USAGE?{document:{title:'本次用量',format:'md'},content:usageContent()}:entry?{document:entry,content:entry.content}:fallback?{document:{id,title:'报告',format:'md'},content:fallback}:check(await api.document(readHandle?reportReadRequest({...readHandle,task_id:requestTask}):{task_id:requestTask,id}));
      if(ticket!==request||scope!==targetScope||!viewerVisible())return;
      if(id!==USAGE&&documentID(result.document)!==id)throw Error('报告编号不匹配，请重试');
      if(id!==USAGE&&!entry&&!fallback&&!fromHistory){
        const saved=accept(result.document);replace(saved);
        if(saved.dismissed){leave(false);return;}
        if(!currentDoc)awaitingSnapshot.set(id,saved.revision||0);
      }
      $('document-title').textContent=result.document.title;$('document-meta').textContent=documentMeta(result.document,id);$('document-meta').hidden=id===USAGE;
      navigation?.title(result.document.title);
      const format=normalizeReportFormat(result.document.format),html=format==='html';$('document-content').hidden=html;
      if(html){if(!await loadHTML(result.content,()=>ticket===request&&scope===targetScope&&selected===id&&viewerVisible(),positions.get(id)||0))return;}
      else{$('document-html').srcdoc='';if(id===USAGE){usagePaintSignature='';usageRead++;usageLoading=false;usageLoadedAt=0;usageLedger=null;usageLedgerError='';paintUsageView();}else renderMarkdown($('document-content'),result.content);}
      loaded=true;$('document-status').hidden=true;$('document-content').scrollTop=positions.get(id)||0;
      requestAnimationFrame(()=>trimScrollFragments($('document-content')));
      if(id!==USAGE&&!fromHistory){setViewState(id,'open');void change(id,'read');}else if(id===USAGE){usageSignature=result.content;void loadUsageLedger();}refresh();paintSteps();
    }catch(error){if(ticket===request){const status=$('document-status'),retry=document.createElement('button');retry.type='button';retry.className='hx-page';retry.textContent='重新读取';retry.onclick=()=>void open({id,task_id:requestTask,history:fromHistory},fallback);status.hidden=false;status.textContent=error.message+' ';status.append(retry);}}
    finally{if(ticket===request)viewer.setAttribute('aria-busy','false');}
  }
  // 一闪而过的提示（用户 2026-10-13：“已保存”之类不必作为系统信息去看）：非错误只在顶栏下方闪一下，不进系统信息；
  // 错误既闪一下，也留在系统信息里，方便事后查。
  let toastTimer=0,toastNode,toastText,toastCopy,toastInteraction,toastRemaining=0,toastDeadline=0,toastFullText='',toastReturnFocus=null;
  const toastQueue=[];
  function dismissToasts(){
    clearTimeout(toastTimer);toastQueue.length=0;toastDeadline=0;toastRemaining=0;
    if(toastNode)toastNode.hidden=true;
  }
  const pauseToast=()=>{
    clearTimeout(toastTimer);
    if(toastDeadline)toastRemaining=Math.max(0,toastDeadline-performance.now());
    toastDeadline=0;toastNode.classList.remove('away');
  };
  function resumeToast(){
    clearTimeout(toastTimer);if(toastNode.hidden||toastInteraction.locked)return;
    toastDeadline=performance.now()+toastRemaining;
    toastTimer=setTimeout(()=>{
      toastDeadline=0;toastRemaining=0;
      if(toastInteraction.locked)return;
      toastNode.classList.add('away');
      toastTimer=setTimeout(()=>{
        if(toastInteraction.locked)return;
        if(toastQueue.length)showToast(toastQueue.shift());else toastNode.hidden=true;
      },260);
    },toastRemaining);
  }
  function showToast({text,error}){
    clearTimeout(toastTimer);
    if(!toastNode.contains(document.activeElement))toastReturnFocus=document.activeElement;
    if(toastFullText!==text){toastFullText=text;toastText.replaceChildren(feedbackContent(text));}
    toastCopy.textContent='复制';toastCopy.title='复制完整提示';
    toastNode.classList.toggle('error',error);toastNode.hidden=false;toastNode.classList.remove('away');
    toastRemaining=error?4200:2200;toastDeadline=0;toastInteraction.refresh();resumeToast();
  }
  function toast(text,error){
    if(error&&systemNotices.visible)return;
    if(!toastNode){
      toastNode=document.getElementById('toast')||document.createElement('div');
      toastNode.id='toast';toastNode.classList.add('ui-feedback');toastNode.setAttribute('role','status');toastNode.hidden=true;
      toastText=document.createElement('div');toastText.className='ui-feedback-body';
      toastInteraction=createNoticeInteraction(toastNode,locked=>{
        if(locked)pauseToast();
        else if(toastQueue.length)showToast(toastQueue.shift());else resumeToast();
      });
      toastCopy=createNoticeCopy(()=>toastFullText,toastInteraction);
      const close=document.createElement('button');close.type='button';close.className='quiet ui-feedback-close';close.textContent='×';close.setAttribute('aria-label','收起提示');
      close.onclick=()=>{clearTimeout(toastTimer);const focused=toastNode.contains(document.activeElement);toastNode.hidden=true;if(toastQueue.length)showToast(toastQueue.shift());else if(focused&&toastReturnFocus?.isConnected)toastReturnFocus.focus({preventScroll:true});};
      toastNode.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();close.click();}});
      toastNode.replaceChildren(toastText,toastCopy,close);if(!toastNode.isConnected)document.body.append(toastNode);
    }
    const notice={text:redactNoticeText(text),error:!!error};
    if(toastInteraction.locked){
      const last=toastQueue.at(-1);if(last?.text!==notice.text||last?.error!==notice.error)toastQueue.push(notice);
    }else showToast(notice);
  }
  function localNoticeState(entry){
    return {...(entry.read?{read:true}:{}),...(entry.dismissed?{dismissed:true,pinned:false}:{})};
  }
  function queueNotice(id,text,error,deferred=false,detailSource){
    const entry={id,kind:'system',title:error?'需要留意':'系统信息',format:'md',content:summarizeNoticeText(text,detailSource),at:new Date().toISOString(),revision:0,error,scope,retryAt:0,attempts:0,deferred};
    local.set(id,entry);if(!deferred)replace(entry);void persistNotice(entry);
    return entry;
  }
  async function addFailureNotice(text,eventKey,quiet){
    if(!scope)return;
    const key='event:'+eventKey,prior=noticeKeys.get(key);if(prior)return prior.id;
    const targetRevision=scopeRevision,entry={at:Date.now(),toasted:false};noticeKeys.set(key,entry);
    if(noticeKeys.size>128)noticeKeys.delete(noticeKeys.keys().next().value);
    try{
      const id=await failureNoticeID(eventKey);
      if(targetRevision!==scopeRevision)return;
      entry.id=id;
      if(confirmed.has(id)||local.has(id)||documents.some(doc=>doc.id===id))return id;
      if(!quiet){toast(text,true);entry.toasted=true;}
      // Core may already hold a read/dismissed event not yet in this snapshot.
      // Publish only its confirmed metadata, never an optimistic unread copy.
      queueNotice(id,text,true,true,eventKey.startsWith('["agent-failure",')?'本轮任务的“查看错误详情”':undefined);return id;
    }catch{
      // The visible failure remains intact. A later paint may retry ID creation.
      if(targetRevision===scopeRevision&&noticeKeys.get(key)===entry)noticeKeys.delete(key);
    }
  }
  function addNotice(text,error=false,{quiet=false,eventKey=''}={}){
    text=redactNoticeText(String(text||'').trim());if(!text)return;
    if(!error){if(!quiet)toast(text,false);return;}
    if(eventKey)return addFailureNotice(text,eventKey,quiet);
    const key=String(error)+':'+text,prior=noticeKeys.get(key);
    if(prior&&Date.now()-prior.at<60000){if(!quiet&&!prior.toasted){toast(text,true);prior.toasted=true;}return;}
    if(!quiet)toast(text,true);
    const id=crypto.randomUUID().replaceAll('-','');
    noticeKeys.set(key,{id,at:Date.now(),toasted:!quiet});if(noticeKeys.size>128)noticeKeys.delete(noticeKeys.keys().next().value);
    queueNotice(id,text,error);
  }
  function retryNotices(){
    if(retryTimer)clearTimeout(retryTimer);retryTimer=0;
    const pending=[...local.values()].filter(entry=>entry.scope===scope&&!entry.saving&&!entry.blocked);
    if(!pending.length||!api.notice)return;
    const delay=Math.max(0,Math.min(...pending.map(entry=>entry.retryAt||0))-Date.now());
    retryTimer=setTimeout(()=>{retryTimer=0;for(const entry of local.values())if(entry.scope===scope&&!entry.saving&&!entry.blocked&&entry.retryAt<=Date.now())void persistNotice(entry);},delay);
  }
  async function persistNotice(entry){
    if(!api.notice||entry.saving||entry.blocked||!scope||entry.scope!==scope||local.get(entry.id)!==entry)return;
    const targetRevision=scopeRevision,task_id=snapshot.session_id,current=()=>targetRevision===scopeRevision&&local.get(entry.id)===entry;entry.saving=true;
    let response;
    try{
      response=await api.notice({task_id,id:entry.id,text:entry.content,error:entry.error});if(!current())return;const result=check(response);
      const desired=local.get(entry.id);local.delete(entry.id);const saved=accept(result.document);awaitingSnapshot.set(saved.id,saved.revision||0);overrides.delete(entry.id);replace({...saved,...localNoticeState(desired)});
      if(desired.dismissed)void change(entry.id,'close');else if(desired.read)void change(entry.id,'read');
    }catch(error){
      if(!current())return;entry.attempts++;
      const failure=response?.ok===false?response:error;
      if(isPermanentNoticeError(failure)){
        entry.blocked=true;entry.deferred=false;entry.title='需要留意 · 尚未保存';
        entry.saveError=redactNoticeText(failure?.message||failure?.error?.message||failure?.error||'保存参数未被接受');replace(entry);
      }else entry.retryAt=Date.now()+Math.min(30000,2000*2**Math.min(entry.attempts,4));
    }
    finally{entry.saving=false;if(targetRevision===scopeRevision)retryNotices();}
  }
  const toggleUsage=()=>selected===USAGE&&viewerVisible()?leave(false):open(USAGE);
  if($('usage-anchor'))$('usage-anchor').onclick=()=>toggleUsage();
  // 展示台里生成文档的“打开文档”。
  listen(document,'aieyra:open-document',event=>{Promise.resolve(open(event.detail?.id)).catch(error=>event.detail?.fail?.(error?.message||'打不开'));});
  $('minimize-document').onclick=()=>leave(false);$('close-document').onclick=()=>leave(true);
  // 快速阅读（用户 2026-10-15）：最小化和关闭左边是 ← →，在报告之间切换；翻走的那份已读过，随即收起消失。
  // 顺序与右侧报告列表一致（最新在前）；读完最后一份回到首页，报告圆随之消失。最小化表示"待会再看"，保留。
  const readable=()=>getHandles().filter(h=>h.kind==='report').reverse();
  function step(delta){
    const list=readable(),at=list.findIndex(h=>h.id===selected);
    if(historyRead||!selected||selected===USAGE||at<0)return;
    const rest=list.filter(h=>h.id!==selected);
    if(!rest.length){void leave(true);return;}
    const target=list[(at+delta+list.length)%list.length],from=selected;
    void change(from,'close');setViewState(from,'closed');void open(target);
  }
  function paintSteps(){
    const many=!historyRead&&!!selected&&selected!==USAGE&&readable().length>1;
    $('previous-document').hidden=!many;$('next-document').hidden=!many;
  }
  $('previous-document').onclick=()=>step(-1);$('next-document').onclick=()=>step(1);
  listen(viewer,'keydown',event=>{
    if(event.isComposing||event.altKey||event.ctrlKey||event.metaKey||!viewerVisible())return;
    if(event.target.closest?.('input,textarea,[contenteditable=true]'))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);}
  });
  listen(document,'workspace-report-handles-change',paintSteps);
  return {
    open,
    openHandle:open,
    dispose(){request++;scopeRevision++;cancelHTML?.();clearTimeout(retryTimer);clearTimeout(toastTimer);toastInteraction?.dispose();for(const remove of listeners)remove();toastNode?.remove();$('document-html').srcdoc='';},
    handle:getHandle,
    handles:getHandles,
    minimize:()=>leave(false),
    close:()=>leave(true),
    notice:addNotice,
    paint(next){
    const nextScope=(next.core_epoch||'')+':'+next.session_id;snapshot=next;
    if(scope!==nextScope){const initial=!scope;scopeRevision++;leave(false);scope=nextScope;positions.clear();overrides.clear();confirmed.clear();chains.clear();awaitingSnapshot.clear();noticeKeys.clear();viewStates.clear();if(retryTimer)clearTimeout(retryTimer);retryTimer=0;for(const [id,entry] of local){if(initial){entry.scope=scope;entry.saving=false;}else local.delete(id);}retryNotices();}
    documents=(next.documents||[]).map(d=>overrides.get(d.id)||accept(d));
    for(const doc of documents)if(doc.dismissed)setViewState(doc.id,'closed');
    for(const d of next.documents||[])if((d.revision||0)>=(awaitingSnapshot.get(d.id)??Infinity))awaitingSnapshot.delete(d.id);
    for(const id of awaitingSnapshot.keys())if(!documents.some(d=>d.id===id)){const saved=overrides.get(id)||confirmed.get(id);if(saved)documents.push(saved);}
    for(const d of local.values()){if(d.deferred)continue;const index=documents.findIndex(item=>item.id===d.id);if(index<0)documents.push(d);else documents[index]={...documents[index],...localNoticeState(d)};}
    refresh();
    if(viewerVisible()&&selected===USAGE&&loaded){const content=usageContent();if(content!==usageSignature){usageSignature=content;paintUsageView();void loadUsageLedger();trimScrollFragments($('document-content'));}}
    }
  };
}
