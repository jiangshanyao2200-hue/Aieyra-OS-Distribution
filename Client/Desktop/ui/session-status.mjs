// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupStatusIndicators; setupSessionStatus
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/session-status.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {programForView} from './program-agent-surface.mjs';
import {bindDialog,bindMenuKeys,bindMenuPointerFocus,positionTopbarMenu,topbarMenuGeometry} from './interaction.mjs';
import {displayModelName} from './model-ui.mjs';
import {usageReadouts} from './status.mjs';
import {animateUI,cancelMotion,motionAllowed,observeMotion} from './motion.mjs';
import {setModelTooltip,setTooltipRows,hideModelTooltip} from './tooltip.mjs';
import {modelCardData} from './model-card.mjs';

// Measure the four readouts together: stable rotation without an oversized blank slot.
export function setupStatusIndicators(doc=document){
 const win=doc.defaultView,root=doc.getElementById('session-indicators'),usage=doc.getElementById('usage-anchor'),model=doc.getElementById('model-display');
 const emptyOrbit=doc.createElementNS('http://www.w3.org/2000/svg','circle');emptyOrbit.setAttribute('class','model-empty-orbit');emptyOrbit.setAttribute('cx','12');emptyOrbit.setAttribute('cy','12');emptyOrbit.setAttribute('r','8');model.querySelector('svg')?.append(emptyOrbit);
 const total=doc.getElementById('usage-total'),current=doc.getElementById('usage-current'),name=doc.getElementById('model-name');
 // DOM shaping includes tabular digits, font features and spacing that canvas
 // font shorthand cannot represent. Re-measure only when text or type changes.
 const measure=doc.createElement('span');measure.className='status-readout-measure';measure.setAttribute('aria-hidden','true');root.append(measure);
 const typography=['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontVariant','fontFeatureSettings','fontVariationSettings','letterSpacing','wordSpacing','textTransform'];
 const textWidth=(texts,style)=>{for(const key of typography)measure.style[key]=style[key];measure.textContent=texts.join('\n');return Math.ceil(measure.getBoundingClientRect().width);};
 let measured='',usageWidth=110,modelWidth=176;
 let data=null,values=null,contentKey='',index=0,timer=0,fitFrame=0,closed=false,held=false,expanded=false,wide=false,scope='';
 const shown=()=>!closed&&!doc.hidden&&doc.body.dataset.visible!=='false';
 const visible=()=>!closed&&!doc.hidden&&doc.body.dataset.visible!=='false'&&(!root.checkVisibility||root.checkVisibility({checkVisibilityCSS:true}));
 function measureWidths(){
  const textStyle=win.getComputedStyle(current),modelStyle=win.getComputedStyle(name),modelText=displayModelName(data.model),labels=values.items.map(v=>v.label+' '+v.value);
  const signature=JSON.stringify([labels,modelText,...typography.map(k=>[textStyle[k],modelStyle[k]])]);
  if(signature!==measured){measured=signature;usageWidth=textWidth(labels,textStyle)+34;modelWidth=Math.min(210,textWidth([modelText],modelStyle)+52);root.style.setProperty('--usage-width',Math.max(86,Math.min(156,usageWidth))+'px');root.style.setProperty('--model-width',Math.max(64,modelWidth)+'px');}
 }
 function paintLayout(){
  model.dataset.wide=model.parentElement.dataset.wide=String(wide);model.dataset.expanded=String(wide&&(expanded||!motionAllowed(doc)));
 }
 function paint(animate=false){
  if(!data)return;
  root.dataset.unconfigured=String(!!data.unconfigured);model.disabled=false;usage.disabled=!!data.unconfigured;
  const item=values.items[index];
  total.textContent='';total.hidden=true;delete total.dataset.tip;
  current.textContent=item.label+' '+item.value;delete current.dataset.tip;current.dataset.metric=item.key;
  setTooltipRows(usage,values.rows);usage.setAttribute('aria-label',(data.title||'当前会话')+' · '+values.total+' · '+current.textContent+'；用量详情');
  usage.dataset.active=model.dataset.active=String(!!data.active);
  for(const [i,id] of ['input-count','output-count','cache-count','compression-count'].entries()){const node=doc.getElementById(id);node.textContent=['输入','输出','缓存','上下文'][i]+' '+values.items[i].value;node.dataset.tip=values.items[i].tip.replace(/^(IN|OUT) /,'');}
  name.textContent=data.unconfigured?'选择模型':displayModelName(data.model);name.hidden=false;name.setAttribute('aria-hidden','true');
  model.dataset.tip=data.model||'选择模型';model.setAttribute('aria-label',(data.model||'选择模型')+'；切换当前会话模型');
  paintLayout();
  if(animate)animateUI(current,[{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{key:'usage-readout'});
 }
 function stop(){win.clearTimeout(timer);timer=0;cancelMotion(current);}
 function schedule(){
  if(timer||!data||data.unconfigured||!visible()||held||!motionAllowed(doc))return;
  timer=win.setTimeout(()=>{timer=0;if(data?.unconfigured||!visible()||held||!motionAllowed(doc))return;index=(index+1)%4;expanded=!expanded;paint(true);schedule();},4000);
 }
 function fit(){
  if(!data||!visible())return;
  const bar=root.parentElement,style=win.getComputedStyle(bar),gap=parseFloat(style.columnGap)||0;
  const peers=[...bar.children].filter(n=>n!==root&&!n.hidden&&win.getComputedStyle(n).display!=='none');
  const width=n=>{
   if(n.id!=='desktop-dock')return n.getBoundingClientRect().width;
   const children=[...n.children].filter(c=>!c.hidden&&win.getComputedStyle(c).display!=='none'),space=parseFloat(win.getComputedStyle(n).columnGap)||0;
   return Math.max(124,children.reduce((sum,c)=>sum+c.getBoundingClientRect().width,0)+space*Math.max(0,children.length-1));
  };
  const occupied=peers.reduce((sum,n)=>sum+width(n),0)+gap*peers.length+(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
  // Reserve only the measured label and readout while deciding whether to expand.
  const available=bar.clientWidth-occupied;
  measureWidths();
  wide=win.innerWidth>=1050&&available>=Math.min(156,usageWidth)+modelWidth+16;
  root.dataset.compact=String(win.innerWidth<800||available<180);
  paintLayout();schedule();
 }
 // Core snapshots update the readouts immediately. Their layout reads belong
 // to one frame after the snapshot's DOM writes, not its receiving task.
 function requestFit(){if(!fitFrame&&shown())fitFrame=win.requestAnimationFrame(()=>{fitFrame=0;fit();});}
 function cancelFit(){win.cancelAnimationFrame(fitFrame);fitFrame=0;}
 function resume(){if(closed)return;stop();paintLayout();if(shown())requestFit();else cancelFit();}
 const invalidate=()=>{measured='';resume();};
 const enter=()=>{held=true;stop();},leave=()=>{held=root.contains(doc.activeElement);if(!held)schedule();};
 const focus=()=>{held=true;stop();},blur=()=>win.queueMicrotask(()=>{held=root.matches(':hover')||root.contains(doc.activeElement);if(!held)schedule();});
 root.addEventListener('pointerenter',enter);root.addEventListener('pointerleave',leave);root.addEventListener('focusin',focus);root.addEventListener('focusout',blur);
 const resize=win.ResizeObserver?new win.ResizeObserver(requestFit):null;resize?.observe(root.parentElement);const dock=doc.getElementById('desktop-dock');if(dock)resize?.observe(dock);
 win.addEventListener('resize',resume);doc.addEventListener('visibilitychange',resume);doc.addEventListener('workspace-theme-change',invalidate);doc.fonts?.addEventListener('loadingdone',invalidate);const stopMotion=observeMotion(doc,resume);
 return {update(value){
  if(closed)return;
  const changed=scope!==value.scope,next=usageReadouts(value.usage,value.context),key=JSON.stringify([value.model||'',value.title||'当前会话',!!value.active,!!value.unconfigured,next]);
  scope=value.scope;data=value;values=next;
  if(changed){index=0;expanded=false;stop();}else if(value.unconfigured)stop();
  // Stream phases can refresh the titlebar while every displayed metric stays
  // unchanged. Geometry is invalidated separately by size, theme and font events.
  if(changed||key!==contentKey){contentKey=key;paint();requestFit();}
 },close(){closed=true;stop();cancelFit();stopMotion();measure.remove();resize?.disconnect();win.removeEventListener('resize',resume);doc.removeEventListener('visibilitychange',resume);doc.removeEventListener('workspace-theme-change',invalidate);doc.fonts?.removeEventListener('loadingdone',invalidate);root.removeEventListener('pointerenter',enter);root.removeEventListener('pointerleave',leave);root.removeEventListener('focusin',focus);root.removeEventListener('focusout',blur);}};
}

// The title bar follows the viewed conversation. Background activity never
// selects another conversation, and an asynchronous read cannot change ownership.
export function setupSessionStatus(api,navigation,{doc=document,home=()=>null,changed=()=>{},notice=()=>{}}={}){
 const win=doc.defaultView,button=doc.getElementById('model-display');
 let scope={kind:'home',id:home()?.session_id||''},view=null,children=null,epoch=0,timer=0,closed=false,paused=false,loading=false,pending=false,lastError='';
 let modelPool=null,poolRead=null,poolRetry=0,poolEpoch=0;
 const currentModel=()=>{const current=scope.kind==='home'?home():view;return modelPool?.find(m=>m.id===current?.model_id)||{name:current?.model_name||'选择模型'};};
 setModelTooltip(button,currentModel);
 async function refreshModels(){
  if(closed||paused||poolRead||modelPool||Date.now()<poolRetry||!api.onboard)return;
  const mine=poolEpoch;poolRead=api.onboard({action:'pool',op:'view'});
  try{const result=check(await poolRead);if(!closed&&!paused&&mine===poolEpoch){modelPool=result.models||[];setModelTooltip(button,currentModel);}}
  catch{if(!closed&&!paused&&mine===poolEpoch)poolRetry=Date.now()+30000;}finally{poolRead=null;}
 }
 const check=r=>{if(r?.ok===false)throw Error(r.error||'读取失败');return r;};
 const key=s=>s.kind+':'+s.id;
 function publish(){
  if(closed||paused)return;
  if(scope.kind==='home'){const h=home();if(!h||h.session_id!==scope.id)return;view={...h,id:h.session_id,title:'Eyra',kind:'home',roles:[...(h.roles||[]),...(children?.id===(h.link?.scope||scope.id)?children.roles:[])],context:h.roles?.find(r=>r.role==='matrix')?.context,model_target:h.session_id};}
  const value=view||{id:scope.id,session_id:scope.id,kind:scope.kind,title:'会话',roles:[],model_name:'',ready:false,configured:false};
  changed(value);setModelTooltip(button,currentModel);void refreshModels();doc.dispatchEvent(new win.CustomEvent('aieyra:session-status',{detail:value}));
 }
 function select(next){if(closed||!next?.id)return;if(key(next)!==key(scope)){scope=next;epoch++;cancelOpening();view=null;children=null;if(dialog.open)dialog.close();publish();}void refresh();}
 function navigate(){if(programForView(navigation.current)){select({kind:'program',id:programForView(navigation.current)});return;}if(!navigation.current)select({kind:'home',id:home()?.session_id});else if(navigation.is('conversation-view'))select({kind:'conversation',id:doc.body.dataset.conversationId});}
 async function refresh(){
  clearTimeout(timer);timer=0;if(closed||paused||!scope.id||doc.hidden||scope.kind==='program'&&scope.id!=='coding'&&(!view?.configured||!view?.model_target))return;if(loading){pending=true;return;}loading=true;
  const mine=epoch,selected={...scope},accountingId=scope.kind==='home'?(home()?.link?.scope||scope.id):scope.id;
  try{
   if(selected.kind==='program'&&selected.id==='coding'){
    const binding=check(await api.conversation({action:'program',program:'coding'}));if(mine!==epoch||closed||paused)return;
    view={id:binding.binding.scope_id,session_id:binding.binding.scope_id,kind:'group',program:'coding',title:'Coding',configured:binding.configured,ready:binding.configured,roles:[],model_name:''};
    if(binding.binding.host_session_id){const usage=check(await api.conversation({action:'session_usage',id:binding.binding.scope_id}));if(mine!==epoch||closed||paused)return;const row=usage.sessions.find(s=>s.id===binding.binding.scope_id);if(row)view={...view,...row,kind:'group',program:'coding',configured:binding.configured,ready:binding.configured};}
   }else{const result=check(await api.conversation({action:'session_usage',id:accountingId}));if(mine!==epoch||closed||paused||selected.kind==='home'&&accountingId!==(home()?.link?.scope||scope.id))return;const row=result.sessions.find(s=>s.id===accountingId);if(selected.kind==='home')children=row;else view=row?{...view,...row,kind:selected.kind,ready:true}:null;}
   lastError='';publish();
  }
  catch(e){if(mine===epoch&&!closed&&!paused){view=null;publish();if(e.message!==lastError)notice(e.message);lastError=e.message;}}
  finally{loading=false;if(!closed&&!paused){timer=setTimeout(refresh,pending?0:1500);pending=false;}}
 }
 const dialog=doc.createElement('dialog');dialog.className='session-model-menu ui-menu ui-topbar-menu';dialog.setAttribute('aria-label','切换当前会话模型');doc.body.append(dialog);
 let opening=false,saving=false,openEpoch=0,nativeRequest='';
 function cancelOpening(){openEpoch++;opening=false;if(nativeRequest){void api.sessionModelMenu?.({action:'dismiss',request_id:nativeRequest}).catch(()=>{});nativeRequest='';button.setAttribute('aria-expanded','false');}}
 button.classList.add('ui-topbar-trigger');button.setAttribute('aria-expanded','false');
 const dialogLife=bindDialog(dialog,{opener:button,onClose:()=>button.setAttribute('aria-expanded','false')});
 const stopMenu=bindMenuKeys(dialog,{items:()=>dialog.querySelectorAll('button')});
 const stopPointer=bindMenuPointerFocus(dialog);
 const positionModels=()=>{if(dialog.open)positionTopbarMenu(dialog,button,{region:doc.getElementById('session-indicators')||button.parentElement||button,minWidth:280});};
 win.addEventListener('resize',positionModels);win.visualViewport?.addEventListener('resize',positionModels);win.visualViewport?.addEventListener('scroll',positionModels);
 const menuSize=win.ResizeObserver?new win.ResizeObserver(positionModels):null;menuSize?.observe(doc.getElementById('session-indicators')||button);
 async function presentModels(mine,request){
  hideModelTooltip(doc);
  if(!api.sessionModelMenu){dialogLife.show();positionModels();button.setAttribute('aria-expanded','true');dialog.querySelector('[aria-pressed=true]')?.focus({preventScroll:true});hideModelTooltip(doc);return;}
  // Menus own a native top layer. A DOM modal would hide the entire program
  // WebContentsView, including its IDE and live chat, to make room for it.
  const box=topbarMenuGeometry(button,{region:doc.getElementById('session-indicators')||button,minWidth:280,maxHeight:800}),options=[...dialog.querySelectorAll('button')],id='model:'+request+':'+Date.now();
  nativeRequest=id;button.setAttribute('aria-expanded','true');
  try{
   const result=await api.sessionModelMenu({request_id:id,x:box.left,y:box.top,attachment:{kind:'topbar',width:box.width,maxHeight:box.maxHeight},title:dialog.querySelector('p')?.textContent||'选择模型',items:options.map((option,index)=>({id:String(index),label:option.textContent,selected:option.getAttribute('aria-pressed')==='true',model:option.modelCard||null}))});
   if(nativeRequest!==id||closed||paused||mine!==epoch||request!==openEpoch)return;
   nativeRequest='';button.setAttribute('aria-expanded','false');
   if(result!==null&&result!==undefined&&options[Number(result)])await options[Number(result)].onclick();
  }finally{if(nativeRequest===id){nativeRequest='';button.setAttribute('aria-expanded','false');}}
 }
 async function openModels(){
  if(closed||paused||saving||!scope.id)return;if(opening){cancelOpening();return;}if(dialog.open){dialog.close();return;}opening=true;
  const mine=epoch,request=++openEpoch,program=scope.kind==='program'?programForView(navigation.current):'',owner=program==='coding'?{kind:'group',id:view?.id||scope.id}:{...scope};
  try{
   const [models,status,pool]=await Promise.all([api.conversation({action:'models'}),api.conversation(program?{action:'program',program}:{action:'session_usage',id:owner.id}),api.onboard?api.onboard({action:'pool',op:'view'}):null]);if(mine!==epoch||request!==openEpoch||closed||paused)return;check(models);check(status);
   if(pool?.models){modelPool=pool.models;setModelTooltip(button,currentModel);}
   let current=program?status.contact:owner.kind==='home'?home():status.sessions?.find(s=>s.id===owner.id),roleDefault=null;
   if(program==='coding'){
    owner.id=status.binding.scope_id;
    if(status.binding.host_session_id){const usage=check(await api.conversation({action:'session_usage',id:owner.id}));current=usage.sessions?.find(s=>s.id===owner.id);}
    else if(api.builtinRole){roleDefault=check(await api.builtinRole({action:'read',builtin:'cota'}));current={...status.contact,model_id:roleDefault.model_id,model_inherited:!roleDefault.model_binding};}
    else current=null;
    if(mine!==epoch||request!==openEpoch||closed||paused)return;
   }if(!current){dialog.replaceChildren(modelSettingsButton('配置模型连接'));await presentModels(mine,request);return;}
   const active=current.model_id,binding={...owner,target:current.model_target||owner.id,revision:current.revision,expected_model:active};
   const title=doc.createElement('p');title.textContent=roleDefault?'Cota 默认模型 · 可在会话建立后单独切换':'当前会话 · 下一次请求生效';dialog.replaceChildren(title);
   for(const model of [...(owner.kind==='home'?[]:[{id:'',name:program&&program!=='coding'||roleDefault?'跟随 Eyra':'使用角色默认模型'}]),...models.filter(m=>{const p=pool?.models?.find(p=>p.id===m.id);return !p||p.kind==='chat'&&p.enabled!==false;})]){const option=doc.createElement('button');option.type='button';option.textContent=model.name||model.model||model.id;option.setAttribute('aria-pressed',String(model.id===((program!=='coding'||roleDefault)&&current.model_inherited||(!program||program==='coding'&&!roleDefault)&&current.model_override===false?'':active)));
    option.onclick=async()=>{if(saving||mine!==epoch||closed||paused)return;saving=true;for(const b of dialog.querySelectorAll('button'))b.disabled=true;
     try{if(roleDefault){check(await api.builtinRole({action:'save',builtin:'cota',profile_version:roleDefault.profile_version,model_version:roleDefault.model_version,model_id:model.id}));check(await api.conversation({action:'program_open',program:'coding'}));}
      else check(await (program&&program!=='coding'?api.conversation({action:'contact_update',id:current.id,model_id:model.id,model_unconfigured:model.id==='',expected_model_revision:current.model_revision||0}):api.sessionModel({...binding,model_id:model.id}))); if(mine===epoch&&!closed&&!paused){dialog.close();await refresh();if(mine===epoch&&!closed&&!paused)doc.dispatchEvent(new win.CustomEvent('aieyra:model-changed'));}}
     catch(e){if(mine===epoch&&!closed&&!paused){dialog.close();notice(e.message);void refresh();}}finally{saving=false;if(mine===epoch&&!closed&&!paused)for(const b of dialog.querySelectorAll('button'))b.disabled=false;}
    };if(model.id){option.modelCard=modelCardData(pool?.models?.find(m=>m.id===model.id)||model);setModelTooltip(option,option.modelCard);}dialog.append(option);
   }
   if(!models.length)dialog.append(modelSettingsButton('添加模型'));
   await presentModels(mine,request);
  }catch(e){if(mine===epoch&&request===openEpoch&&!closed&&!paused)notice(e.message);}finally{if(request===openEpoch)opening=false;}
 }
 function modelSettingsButton(label){
  const button=doc.createElement('button');button.type='button';button.textContent=label;
  button.onclick=async()=>{
   dialog.close();
   try{if(api.openModelSettings)await api.openModelSettings();else doc.getElementById('api-bubble')?.click();}
   catch(error){if(!closed&&!paused)notice(error.message);}
  };
  return button;
 }
 button.onclick=e=>{e.stopPropagation();void openModels();};
 const cancelPending=event=>{if(opening&&(event.type==='keydown'?event.key==='Escape':!button.contains(event.target)))cancelOpening();};
 doc.addEventListener('pointerdown',cancelPending,true);doc.addEventListener('keydown',cancelPending,true);
 // Keep keyboard events bubbling: closing the menu restores focus here, and
 // the workspace still needs Ctrl+Enter to open the composer.
 const programChanged=event=>{
  const p=event.detail;if(!p||p.program!==programForView(navigation.current))return;
  const next={kind:'program',id:p.session?.id||p.contact.id};
  if(key(next)!==key(scope)){scope=next;epoch++;cancelOpening();children=null;if(dialog.open)dialog.close();}
  const snap=p.snapshot,contact=p.contact;
  view={id:scope.id,session_id:scope.id,kind:'program',program:p.program,title:contact.name,configured:p.configured,ready:p.configured,model_id:contact.model_id,model_name:modelPool?.find(m=>m.id===contact.model_id)?.name||contact.model_id||'',revision:p.session?.revision,model_target:p.session?.id,context:snap?.context,roles:p.session?[{...p.session,usage:snap?.usage}]:[]};
  publish();if(p.configured)void refresh();
 };
 doc.addEventListener('aieyra:program-agent',programChanged);
 const focus=api.onSessionFocus?.(value=>{if(!closed&&!paused&&value?.kind==='group'&&navigation.is('contacts-module-view'))select(value);});
 const stopSettings=api.onSettingsChanged?.(()=>{modelPool=null;poolRetry=0;poolEpoch++;void refreshModels();});
 doc.addEventListener('workspace-view-change',navigate);doc.addEventListener('visibilitychange',refresh);
 return {update(){if(scope.kind==='home'&&home()?.session_id!==scope.id)select({kind:'home',id:home()?.session_id});publish();},refresh,
  suspend(){if(closed||paused)return;paused=true;epoch++;poolEpoch++;cancelOpening();pending=false;clearTimeout(timer);timer=0;if(dialog.open)dialog.close();},
  resume(){if(closed||!paused)return;paused=false;poolRetry=0;publish();void refresh();},
  close(){if(closed)return;closed=true;paused=true;epoch++;poolEpoch++;cancelOpening();pending=false;clearTimeout(timer);focus?.();stopSettings?.();doc.removeEventListener('aieyra:program-agent',programChanged);doc.removeEventListener('workspace-view-change',navigate);doc.removeEventListener('visibilitychange',refresh);doc.removeEventListener('pointerdown',cancelPending,true);doc.removeEventListener('keydown',cancelPending,true);win.removeEventListener('resize',positionModels);win.visualViewport?.removeEventListener('resize',positionModels);win.visualViewport?.removeEventListener('scroll',positionModels);menuSize?.disconnect();button.onclick=null;button.onkeydown=null;button.setAttribute('aria-expanded','false');stopMenu();stopPointer();dialogLife.destroy();dialog.remove();},start(){if(!closed&&!paused){navigate();void refresh();}}};
}
