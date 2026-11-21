// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; theme; agent; checked; failure; state; paint; loadDocument
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/extension.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupAgentView} from './agent-view.mjs';
import {renderMarkdown} from './markdown.mjs';
import {isolatedHTML as renderHTML} from './html-document.mjs';
import {planModel,renderPlanPage} from './plan-view.mjs';
import {subscribeWindowTheme} from './window-theme.mjs';

const api=window.aieyraExtension,$=id=>document.getElementById(id),unsub=[];
const theme=subscribeWindowTheme(api,document.body);
let agent=null,descriptor=null,visible=true,closed=false,initialized=false,lastFrame=null,planSignature='',documentLoaded=false;
function checked(result){if(result?.ok===false)throw Error(result.error||'操作未完成');return result;}
function failure(error){$('extension-error').textContent=String(error.message||error);$('extension-error').hidden=false;}
function state(value){if(!value)return;descriptor={...descriptor,...value};document.title=value.title+' · Aieyra';$('extension-title').textContent=value.title;$('extension-position').textContent=value.placement==='detached'?'独立窗口':'随主界面';$('extension-placement').textContent=value.placement==='detached'?'放回':'独立';document.body.dataset.role=value.binding?.role||'matrix';}
function paint(frame){
 if(closed)return;lastFrame=frame;if(!visible||!initialized||!descriptor)return;
 if(agent){agent.paint(frame);return;}
 if(descriptor.kind==='plan'){
  if(frame?.error)failure(frame.error);else $('extension-error').hidden=true;
  if(frame?.status==='stale')return;
  const plan=frame?.projection?.plan,signature=JSON.stringify([frame?.status,frame?.error,plan]);if(signature===planSignature)return;planSignature=signature;
  if(plan)renderPlanPage($('extension-content'),planModel(plan));
  else $('extension-content').textContent=frame?.error||'计划正在更新…';
 }
}
async function loadDocument(){
 if(documentLoaded||closed||!visible)return;
 try{const result=checked(await api.document());if(closed||!visible)return;documentLoaded=true;const content=$('extension-content');
  if(result.document?.format==='html'){const iframe=document.createElement('iframe');iframe.title=result.document.title||'报告';iframe.className='extension-document';iframe.sandbox='';iframe.srcdoc=renderHTML(result.content);content.replaceChildren(iframe);}
  else{content.classList.add('extension-markdown');renderMarkdown(content,result.content||'');}
 }catch(error){failure(error);}
}
$('extension-placement').onclick=()=>Promise.resolve(descriptor?.placement==='detached'?api.dock():api.detach()).then(checked).then(state).catch(failure);
$('extension-home').onclick=()=>api.focusMain().then(checked).catch(failure);
$('extension-close').onclick=()=>api.hide().catch(failure);$('extension-minimize').onclick=()=>api.minimizeWindow().catch(failure);
$('extension-release').onclick=()=>api.release().then(checked).catch(failure);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();void api.hide();}});
unsub.push(api.onState(state),api.onFrame(paint),api.onVisibility(value=>{visible=value.visible===true;document.body.dataset.visible=String(visible);agent?.setVisible(visible);if(visible){if(lastFrame)paint(lastFrame);if(descriptor?.kind==='document')void loadDocument();}}));
window.addEventListener('beforeunload',()=>{closed=true;agent?.close();theme.close();for(const stop of unsub)stop();},{once:true});
try{
 state(checked(await api.describe()));
 if(descriptor.kind==='agent')agent=setupAgentView($('extension-content'),{api,role:descriptor.binding.role});
 initialized=true;
 if(descriptor.kind==='document')await loadDocument();else paint(await api.frame());
 await theme.refresh();
}catch(error){failure(error);}
