// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PHASES; ACTIONS; DEFER; setupUpdateSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/update-settings.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import official from '../../../Contracts/official-services.mjs';

const PHASES={disabled:'尚未启用',login_required:'需要登录',idle:'尚无待更新版本',available:'发现新版本',reviewed:'已核对文件',needs_build:'正在等待编译',prepared:'等待验证',validated:'验证通过',waiting_idle:'等待任务空闲',handoff:'正在交接更新',committed:'更新完成',rolled_back:'已恢复上一版本',deferred:'已暂缓',rejected:'本次不采用'};
const ACTIONS={check:'正在检查更新',review:'正在下载并核对',read_file:'正在读取变更',resolve_file:'正在处理冲突',prepare:'正在准备更新',verify:'正在验证',decide:'正在保存决定',handoff:'正在交接更新'};
const DEFER=new Set(['available','reviewed','needs_build','prepared','validated','waiting_idle']);
export function setupUpdateSettings(api,{doc=document,storage=globalThis.sessionStorage,uuid=()=>crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout,assistant='Eyra',assistWhenUnmanaged=false,requestKey='aieyra.settings.update-request',onReleaseThread,reviewOnCheck=false}={}){
 const $=id=>doc.getElementById(id);
 if(!api?.updates||!$('update-settings'))return {initialize(){},visibility(){},check(){},close(){}};
 const assist=$('update-assist');
 let state=null,visible=false,closed=false,busy=false,timer=null,notice='',pending=null,feedEpoch=0,feedBusy=false,feedLoaded=false,feedCursor=null,integrityBusy=false,integrityStarted=false,integrityKey='';
 let refreshing=false,actionRevision=0;
 const key=requestKey;
 try{pending=JSON.parse(storage?.getItem(key)||'null');}catch{}
 const remember=value=>{pending=value;try{if(value)storage?.setItem(key,JSON.stringify(value));else storage?.removeItem(key);}catch{}};
 function paint(){
  if(closed||!state)return;
  $('update-current').textContent=state.currentVersion||'未知';
  $('update-phase').textContent=state.operation?(ACTIONS[state.operation.action]||'正在处理'):PHASES[state.phase]||state.phase;
  $('update-release').textContent=state.release?.version||'—';
  const publication=$('update-publication');
  if(publication){
   publication.hidden=!state.release?.sequence;
   publication.textContent=state.release?.sequence?['发布序列 '+state.release.sequence,state.release.sourceCommit?'Git '+state.release.sourceCommit.slice(0,12):''].filter(Boolean).join(' · '):'';
   publication.title=state.release?.sourceCommit||'';
  }
  $('update-next-row').hidden=!state.nextRelease;$('update-next').textContent=state.nextRelease?.version||'';
  $('update-reason').textContent=state.reason||'';
  $('update-changes').textContent=state.release?`本地修改 ${state.localChanges||0} 项 · 待处理冲突 ${state.conflicts||0} 项`:'';
  const progress=state.operation?.total?`${Math.min(100,Math.floor(state.operation.received/state.operation.total*100))}%`:'';
  $('update-progress').textContent=progress;
  $('update-checked').textContent=state.checkedAt?'上次检查 '+new Date(state.checkedAt).toLocaleString():'';
  const last=state.lastResult;$('update-last').textContent=last?`${last.version||''} · ${PHASES[last.phase]||last.phase}${last.reason?' · '+last.reason:''}`:'';
  $('update-last-row').hidden=!last;
  const unavailable=!state.enabled||state.phase==='login_required';
  $('update-check').disabled=busy||unavailable||!!state.operation;
  if(assist){
   assist.disabled=busy||!state.homeSession||state.phase==='handoff'||!assistWhenUnmanaged&&(unavailable||state.manual===true);
   assist.textContent=pending?'重试交给 '+assistant:'让 '+assistant+' 处理';
  }
  const quick=state.quick,now=$('update-now');
  if(now){
   now.disabled=busy||unavailable||state.manual===true||!!state.operation||!!quick?.running||['waiting_idle','handoff','needs_build'].includes(state.phase)||state.conflicts>0;
   now.textContent=quick?.running?(quick.text||'正在更新…'):state.conflicts>0?'等待解决冲突':state.release?.version&&state.phase!=='committed'?'安全更新到 '+state.release.version:'安全更新';
  }
  $('update-defer').disabled=busy||unavailable||!!state.operation||!state.release||!DEFER.has(state.phase);
  $('update-download').hidden=!state.manual;
  $('update-status').textContent=notice||(state.conflicts>0?'发现更新冲突，请交给 '+assistant+' 核对合并。':quick&&!quick.running?quick.text||'':'');
  const integrity=state.integrity||{phase:'unchecked'},summary=$('update-integrity');
  if(summary)summary.textContent=integrity.phase==='checked'?`${integrity.consistent} 模块一致 · ${integrity.different} 模块不一致${integrity.unknown?' · '+integrity.unknown+' 模块未能检查':''}`:({unchecked:'尚未检查',checking:'正在检查…',unavailable:'尚不能判断',error:'检查未完成'}[integrity.phase]||'尚未检查');
  if($('update-integrity-note'))$('update-integrity-note').textContent=integrity.reason||(integrity.phase==='checked'?`基于官方 ${integrity.version} · ${integrity.checkedFiles} 个文件 · ${new Date(integrity.checkedAt).toLocaleString()}${integrity.different?'。保留没有冲突的本地改动。':''}`:'');
  if($('update-integrity-check'))$('update-integrity-check').disabled=integrityBusy||integrity.phase==='checking';
  const moduleList=$('update-integrity-modules');
  if(moduleList?.replaceChildren&&integrityKey!==JSON.stringify(integrity)){integrityKey=JSON.stringify(integrity);moduleList.replaceChildren(...(integrity.modules||[]).map(row=>{const li=doc.createElement('li');li.textContent=row.name+' · '+({consistent:'一致',different:'不一致',unknown:'未能检查'}[row.state])+(row.state==='different'?`（修改 ${row.changed} / 缺失 ${row.missing} / 新增 ${row.added}）`:'');return li;}));$('update-integrity-details').hidden=!integrity.modules?.length;}

 }
 async function loadPosts(more=false){
  if(closed||!visible||feedBusy)return;feedBusy=true;const mine=feedEpoch;
  const holder=$('update-posts');if(!holder?.replaceChildren){feedBusy=false;return;}
  $('update-posts-status').textContent='正在同步…';
  try{
   const result=await api.updates({action:'posts',...(more&&feedCursor?{cursor:feedCursor}:{})});if(result?.ok===false)throw Error(result.error);
   if(closed||mine!==feedEpoch)return;if(!more)holder.replaceChildren();
   for(const item of result.items||[]){
    const article=doc.createElement('article'),title=doc.createElement('button'),summary=doc.createElement('p'),body=doc.createElement('p');article.className='update-post';title.type='button';title.className='update-post-title';title.textContent=item.title;title.setAttribute('aria-expanded','false');summary.textContent=item.summary;body.hidden=true;
    title.onclick=async()=>{if(!body.hidden){body.hidden=true;title.setAttribute('aria-expanded','false');return;}title.disabled=true;try{const value=await api.updates({action:'post',id:item.id});if(value?.ok===false)throw Error(value.error);if(closed||mine!==feedEpoch)return;body.textContent=value.content;body.hidden=false;title.setAttribute('aria-expanded','true');}catch(e){if(!closed&&mine===feedEpoch)$('update-posts-status').textContent=e.message;}finally{title.disabled=false;}};
    article.append(title,summary,body);holder.append(article);
    if(onReleaseThread){const feedback=doc.createElement('button');feedback.type='button';feedback.className='quiet';feedback.textContent='版本反馈';feedback.onclick=()=>onReleaseThread(item);article.append(feedback);}
   }
   feedLoaded=true;feedCursor=result.nextCursor;$('update-posts-more').hidden=!feedCursor;$('update-posts-status').textContent=result.reason||(holder.children.length?'':'暂无 OS 发布帖子');
  }catch(e){if(!closed&&mine===feedEpoch)$('update-posts-status').textContent=e.message;}
  finally{if(mine===feedEpoch)feedBusy=false;}
 }
 async function checkIntegrity(){
  if(closed||integrityBusy)return;integrityBusy=true;integrityStarted=true;if(state)state={...state,integrity:{...state.integrity,phase:'checking'}};paint();
  try{const value=await api.updates({action:'integrity'});if(value?.ok===false)throw Error(value.error);if(!closed)state=value;}
  catch(e){if(!closed&&state)state={...state,integrity:{phase:'error',reason:e.message}};}
  finally{integrityBusy=false;paint();}
 }
 if($('update-posts-refresh'))$('update-posts-refresh').onclick=()=>loadPosts();
 if($('update-posts-more'))$('update-posts-more').onclick=()=>loadPosts(true);
 if($('update-integrity-check'))$('update-integrity-check').onclick=checkIntegrity;
 function schedule(){clearTimer(timer);timer=null;if(visible&&!closed)timer=setTimer(()=>void refresh(),2000);}
 async function refresh(){
  if(closed||busy||refreshing){schedule();return;}
  refreshing=true;const revision=actionRevision;
  try{const value=await api.updates({action:'status'});if(value?.ok===false)throw Error(value.error);if(!closed&&revision===actionRevision)state=value;}
  catch(error){if(!closed&&revision===actionRevision)notice=error.message;}
  finally{refreshing=false;paint();schedule();}
 }
 async function act(action){
  if(busy||closed)return;
  busy=true;actionRevision++;notice=action==='check'?'正在检查…':action==='quick'?'正在更新…':action==='assist'?'正在交给 '+assistant+'…':'正在暂缓…';paint();
  let args={action:action==='check'&&reviewOnCheck?'review_update':action};
  if(action==='assist'){
   if(!pending)remember({request_id:uuid(),session_id:state.homeSession});
   args={...args,...pending};
  }
  if(action==='defer')args.release_id=state.release?.id;
  try{
   const value=await api.updates(args);if(value?.ok===false)throw Object.assign(Error(value.error),{code:value.code});
   if(closed)return;state=value;
   if(action==='assist'){remember(null);notice='已交给 '+assistant+'，可在对话中查看进展。';}
   else notice=action==='check'?(state.enabled&&state.phase!=='login_required'?'检查完成':''):action==='quick'?'':'已暂缓更新';
  }catch(error){if(error.code==='update_session_changed')remember(null);if(!closed)notice=error.message;}
  finally{busy=false;paint();schedule();}
 }
 $('update-check').onclick=()=>act('check');if($('update-now'))$('update-now').onclick=()=>act('quick');if(assist)assist.onclick=()=>act('assist');$('update-defer').onclick=()=>act('defer');
 $('update-download').onclick=()=>Promise.resolve(api.openLink({url:state?.downloadUrl||official.download})).catch(error=>{notice=error.message;paint();});
 const stop=api.onAccountChanged?.(()=>{feedEpoch++;feedBusy=false;feedLoaded=false;feedCursor=null;$('update-posts-status').textContent='';$('update-posts-more').hidden=true;$('update-posts')?.replaceChildren?.();if(visible){void refresh();void loadPosts();}});
 return {initialize(value){state=value;paint();},check:()=>act('check'),visibility(value){visible=value===true;clearTimer(timer);timer=null;if(!visible){feedEpoch++;feedLoaded=false;feedBusy=false;}if(visible){void refresh();if(!feedLoaded)void loadPosts();if(!integrityStarted&&doc.createElement)void checkIntegrity();}},close(){closed=true;feedEpoch++;clearTimer(timer);stop?.();}};
}
