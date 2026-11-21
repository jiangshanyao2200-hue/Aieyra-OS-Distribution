'use strict';
document.body.classList.toggle('embedded',new URLSearchParams(location.search).get('embedded')==='1');
const $=id=>document.getElementById(id),bridge=window.aieyraBrowser;
let activeDialog=null,pendingCookieClear=null,previousFocus,state={},tabSignature='',downloadSignature='',activeTab='';
function clearBackdrop(){const img=$('panel-backdrop');img.hidden=true;img.removeAttribute('src');delete img.dataset.identity;}
const hiddenDownloads=new Set();
const command=a=>bridge.command(a),en=()=>state.language==='en-US',navigation=globalThis.aieyraBrowserNavigation;
let panels,layoutSignature='',addressDirty=false;
$('address').addEventListener('input',()=>{addressDirty=true;});
function layout(){const top=Math.max(0,Math.ceil($('chrome').getBoundingClientRect().bottom)),tabs=0,bottom=($('downloads').hidden?0:$('downloads').getBoundingClientRect().height);document.documentElement.style.setProperty('--tabs-height',tabs+'px');document.documentElement.style.setProperty('--chrome-height',top+'px');document.documentElement.style.setProperty('--shelf-height',bottom+'px');const extra=panels?.geometry()||{right:0,overlay:false},value={top,bottom,...extra,overlay:extra.overlay||!!activeDialog},key=JSON.stringify(value);if(key!==layoutSignature){layoutSignature=key;bridge.layout?.(value);}}
let fittedRange='';
function fitTabs(force=false){
 const list=$('tabs'),stack=$('tab-stack'),rows=list.children;
 if(list.style.getPropertyValue('--tab-count')!==String(rows.length))list.style.setProperty('--tab-count',String(rows.length));
 if(!rows.length||!list.parentElement.clientWidth)return;
 const rowGap=parseFloat(getComputedStyle(list.parentElement).columnGap)||0;
 const tabGap=parseFloat(getComputedStyle(list).columnGap)||0;
 const minTab=112; // Icon, readable title and close target in CSS pixels.
 const available=list.parentElement.clientWidth-$('new-tab').offsetWidth-rowGap;
 const overflow=rows.length*minTab+(rows.length-1)*tabGap>available;
 const restoreFocus=document.activeElement===stack&&!overflow;
 if(stack.hidden===overflow)stack.hidden=!overflow;
 const capacity=Math.max(1,Math.floor((list.clientWidth+tabGap)/(minTab+tabGap)));
 const selected=state.tabs?.findIndex(tab=>tab.active)??0;
 const first=Math.max(0,selected-capacity+1),end=Math.min(rows.length,first+capacity);
 const range=first+'-'+end;
 if(force||range!==fittedRange){
  for(let i=0;i<rows.length;i++)rows[i].classList.toggle('tab-extra',i<first||i>=end);
  fittedRange=range;
 }
 if(restoreFocus)list.querySelector('[aria-selected=true]')?.focus({preventScroll:true});
}
const resize=new ResizeObserver(entries=>{
 if(entries.some(entry=>entry.target===$('browser-tabs-bar')))fitTabs();
 layout();
});resize.observe($('chrome'));resize.observe($('downloads'));resize.observe($('browser-tabs-bar'));

function addressOpen(open){
 const form=$('navigate'),toggle=$('address-toggle');
 if(open&&form.hidden){addressDirty=false;$('address').value=state.url==='about:blank'?'':state.url||'';}
 form.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
 form.inert=!open;
 if(open){$('address').focus();$('address').select();}
}
function paintTabIcon(glyph,tab){
 const favicon=tab.favicon||'',key=favicon||'blank';
 if(glyph.dataset.icon===key)return;
 glyph.dataset.icon=key;
 const globe=()=>{glyph.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 5 5 11 0 16-5-5-5-11 0-16"/></svg>';};
 if(!favicon){globe();return;}
 const image=document.createElement('img');image.alt='';image.onerror=()=>{if(image.parentNode===glyph)globe();};image.src=favicon;glyph.replaceChildren(image);
}
$('address-toggle').onclick=()=>addressOpen($('navigate').hidden);
$('navigate').addEventListener('focusout',event=>{if(!$('navigate').contains(event.relatedTarget)&&event.relatedTarget!==$('address-toggle'))addressOpen(false);});
function shortcut(action){
 if(activeDialog){if(action==='stop')respond(false);return;}
 if(action==='downloads'){panels.open('downloads');}
 else if(action==='address'){addressOpen(true);}
 else if(action==='stop'&&!$('navigate').hidden){addressOpen(false);$('address-toggle').focus();}
 else if(action==='find_in_page'){openFind();}
 else if(action==='find_next'||action==='find_previous'){if($('find-bar').hidden)openFind();else find(action==='find_next',true);}
 else if(action==='stop'&&panels.active){panels.close();}
 else if(action==='stop'&&!$('find-bar').hidden){closeFind();}
 else if(action==='next_tab'||action==='previous_tab'||action.startsWith('tab_')){
  const tabs=state.tabs||[],index=tabs.findIndex(t=>t.active);if(!tabs.length)return;
  const next=action==='next_tab'?(index+1)%tabs.length:action==='previous_tab'?(index-1+tabs.length)%tabs.length:action==='tab_9'?tabs.length-1:Math.min(Number(action.slice(4))-1,tabs.length-1);
  command({action:'activate',tab_id:tabs[next].tab_id});
 }else if(action==='close')command({action,tab_id:state.tabs?.find(t=>t.active)?.tab_id});else command({action});
}
bridge.onShortcut?.(shortcut);
document.addEventListener('keydown',e=>{
 if(e.isComposing||e.keyCode===229)return;
 if(activeDialog){if(e.key==='Enter'&&document.activeElement===$('dialog-input')){e.preventDefault();respond(true);}return;}
 const action=navigation.shortcut(e);
 if(action){e.preventDefault();shortcut(action);}
});
for(const action of ['back','forward'])$(action).onclick=()=>command({action});
$('reload').onclick=()=>command({action:state.loading?'stop':'reload'});
$('new-tab').onclick=()=>command({action:'new_tab'});
$('bookmark').onclick=()=>command({action:'bookmark_toggle'});
function submitAddress(value){
 const query=value.trim();if(!query)return false;
 const url=navigation.address(query,'auto');
 command(url?{action:'navigate',url}:{action:'search',query});
 return true;
}

$('navigate').onsubmit=e=>{e.preventDefault();try{if(!submitAddress($('address').value))return;addressDirty=false;addressOpen(false);$('address-toggle').focus();}catch(error){$('notice').hidden=false;$('notice').textContent=error.message;}};
$('notice').onclick=()=>{if(!state.loadError)command({action:'dismiss_error'});};
let findTimer;
$('tab-stack').onclick=()=>panels.open('tabs');
$('tabs').onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;const tabs=[...$('tabs').querySelectorAll('[role=tab]')].filter(tab=>tab.getClientRects().length),index=tabs.indexOf(document.activeElement);if(index<0)return;let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;else if(e.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();tabs[next].focus();tabs[next].click();}};
function openFind(){$('find-bar').hidden=false;$('find-query').focus();$('find-query').select();layout();}
function closeFind(){clearTimeout(findTimer);$('find-bar').hidden=true;command({action:'stop_find'});$('address-toggle').focus();layout();}
function find(forward=true,next=false){const query=$('find-query').value;if(query.trim())command({action:'find_in_page',query,forward,next});else command({action:'stop_find'});}
$('find-query').oninput=()=>{clearTimeout(findTimer);findTimer=setTimeout(()=>find(),160);};
$('find-query').onkeydown=e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();find(!e.shiftKey,true);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFind();}};
$('find-next').onclick=()=>find(true,true);$('find-previous').onclick=()=>find(false,true);$('find-close').onclick=closeFind;
function confirmCookieClear(){
 if(activeDialog||!state.profile)return;
 pendingCookieClear={profile:state.profile,type:'cookies'};
 paintDialog();
 layout();
}
function confirmPasswordClear(origin){
 if(activeDialog||!state.passwords?.origins?.includes(origin))return;
 pendingCookieClear={profile:state.profile,type:'password',origin};
 paintDialog();layout();
}
function paintDialog(){
 const english=en(),box=$('dialog'),input=$('dialog-input'),cancel=$('dialog-cancel'),ok=$('dialog-accept');
 // A page or permission prompt takes precedence. A profile change invalidates an unanswered clear request.
 if(pendingCookieClear&&(state.profile!==pendingCookieClear.profile||state.permission||state.dialog||state.visible===false||
    pendingCookieClear.type==='password'&&!state.passwords?.origins?.includes(pendingCookieClear.origin)))pendingCookieClear=null;
 const item=state.permission?{...state.permission,type:'permission'}:state.dialog||pendingCookieClear;
 if(!item){
  if(box.open){box.close();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});else if(panels.active)$('panel-close').focus();}
  activeDialog=null;
  return;
 }
 const key=JSON.stringify([activeTab,item]);
 if(activeDialog===key)return;
 const cookies=item.type==='cookies',password=item.type==='password',permission=item.type==='permission',prompt=item.type==='prompt',alert=item.type==='alert';
 $('dialog-title').textContent=password?(english?'Delete the saved password?':'删除已保存的密码？'):cookies?(english?'Clear cookies and cache?':'清理此身份的 Cookie 和缓存？'):permission?(english?'Website permission':'网站权限'):(english?'Website message':'网站提示');
 $('dialog-message').textContent=password?item.origin:cookies?(english?'Sites signed in with this profile may ask you to sign in again.':'此身份已登录的网站可能需要重新登录。'):item.message||'';
 input.hidden=!prompt;input.value=item.defaultPrompt||'';input.setAttribute('aria-label',english?'Your response':'输入内容');
 cancel.hidden=alert;cancel.textContent=permission?(english?'Deny':'拒绝'):(english?'Cancel':'取消');
 ok.textContent=password?(english?'Delete password':'删除密码'):cookies?(english?'Clear cookies':'清理 Cookie'):permission?(english?'Allow this session':'本次允许'):(english?'OK':'确定');
 if(!box.open){previousFocus=document.activeElement;box.showModal();}
 activeDialog=key;
 (prompt?input:alert?ok:cancel).focus({preventScroll:true});
}
function respond(accept){
 if(!activeDialog)return;
 if(pendingCookieClear){
  const {profile,type,origin}=pendingCookieClear;
  pendingCookieClear=null;
  paintDialog();layout();
  if(accept&&state.profile===profile){
   if(type==='password')command({action:'password_clear',profile,origin});
   else command({action:'clear_browsing_data',profile});
  }
 }else command(state.permission?{action:'permission_response',request_id:state.permission.id,accept}:{action:'handle_dialog',tab_id:activeTab,accept,prompt_text:$('dialog-input').value});
}
$('dialog').oncancel=event=>{event.preventDefault();respond(false);};
$('dialog-cancel').onclick=()=>respond(false);$('dialog-accept').onclick=()=>respond(true);
function paint(s){
 if(!state.control)layoutSignature='';
 if(state.backdropIdentity!==s.backdropIdentity)clearBackdrop();
 state=s;document.documentElement.style.setProperty('--module-eyra-size',(s.presenceSize||64)+'px');const selectedTab=s.tabs?.find(t=>t.active)?.tab_id,changedTab=selectedTab!==activeTab;if(changedTab){addressDirty=false;activeTab=selectedTab;}const eng=en(),human=s.control==='human';document.body.dataset.control=s.control;document.body.classList.toggle('detached',s.detached===true);panels.update(s);document.body.dataset.uiHidden=String(s.visible===false);document.body.classList.toggle('reduce-motion',s.appearance?.reduced===true);if(s.appearance)for(const [key,value] of Object.entries(s.appearance.variables||{}))document.documentElement.style.setProperty(key,value);document.body.classList.toggle('loading',s.loading===true);document.documentElement.lang=s.language||'zh-CN';
 $('back').disabled=!s.canGoBack;$('forward').disabled=!s.canGoForward;$('bookmark').disabled=!/^https?:\/\//i.test(s.url||'');
 if($('reload').dataset.loading!==String(s.loading)){$('reload').dataset.loading=String(s.loading);$('reload').innerHTML=s.loading?'<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>':'<svg viewBox="0 0 24 24"><path d="M20 7v5h-5m5 0a8 8 0 1 0-2.3 5.7"/></svg>';}
 $('reload').setAttribute('aria-label',s.loading?(eng?'Stop loading':'停止加载'):(eng?'Reload':'刷新'));$('reload').title=s.loading?(eng?'Stop loading · Escape':'停止加载 · Esc'):(eng?'Reload · Ctrl+R':'刷新 · Ctrl+R');
 $('find-count').textContent=s.find?`${s.find.active} / ${s.find.matches}`:'';
 const isSaved=(s.bookmarks||[]).some(b=>b.url===s.url);$('bookmark').setAttribute('aria-pressed',String(isSaved));
 for(const [id,zh,english] of [['back','返回','Back'],['forward','前进','Forward'],['bookmarks-button','收藏夹','Bookmarks'],['bookmark',isSaved?'取消收藏 · Ctrl+D':'收藏此页 · Ctrl+D',isSaved?'Remove bookmark · Ctrl+D':'Bookmark · Ctrl+D']]){$(id).title=eng?english:zh;$(id).setAttribute('aria-label',eng?english:zh);}
 $('address').placeholder=eng?'Search or enter a URL':'搜索或输入网址';if(changedTab||!addressDirty&&document.activeElement!==$('address'))$('address').value=s.url==='about:blank'?'':s.url||'';
 const nextTabs=JSON.stringify([s.language,s.tabs]);if(nextTabs!==tabSignature){
  const container=$('tabs'),focused=document.activeElement?.dataset?.identity,existing=new Map([...container.children].map(row=>[row.dataset.tab,row]));container.setAttribute('aria-label',eng?'Tabs':'标签页');
  const rows=s.tabs||[];
  const menuLabel=eng?'All tabs':'全部标签页';
  $('tab-stack-count').textContent=String(rows.length);$('tab-stack').setAttribute('aria-label',menuLabel);$('tab-stack').title=menuLabel;
  for(const t of rows){
   let row=existing.get(t.tab_id);if(!row){row=document.createElement('div');row.className='tab';row.dataset.tab=t.tab_id;const select=document.createElement('button'),close=document.createElement('button');select.setAttribute('role','tab');select.dataset.identity=t.tab_id;select.onclick=()=>command({action:'activate',tab_id:t.tab_id});close.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';close.dataset.identity=t.tab_id+'-close';close.onclick=()=>command({action:'close',tab_id:t.tab_id});row.onauxclick=e=>{if(e.button===1){e.preventDefault();command({action:'close',tab_id:t.tab_id});}};row.append(select,close);container.append(row);}
   existing.delete(t.tab_id);const [select,close]=row.children,label=t.url==='about:blank'?(eng?'Loading page':'正在加载'):t.title||t.url||(eng?'Loading page':'正在加载');
   row.classList.toggle('selected',t.active);row.classList.toggle('loading',t.loading);let glyph=select.querySelector('.tab-icon'),caption=select.querySelector('.tab-label');if(!glyph){glyph=document.createElement('span');glyph.className='tab-icon';glyph.setAttribute('aria-hidden','true');caption=document.createElement('span');caption.className='tab-label';select.replaceChildren(glyph,caption);}paintTabIcon(glyph,t);caption.textContent=label;select.title=label+(t.dialog?(eng?' · Waiting for dialog':' · 等待处理网页提示'):'')+(t.error?' · '+t.error:'');select.setAttribute('aria-selected',String(t.active));select.tabIndex=t.active?0:-1;close.tabIndex=t.active?0:-1;close.setAttribute('aria-label',(eng?'Close tab: ':'关闭标签：')+label);
  }
  for(const row of existing.values())row.remove();fitTabs(true);
  if(focused&&![...container.querySelectorAll('[data-identity]')].some(el=>el.dataset.identity===focused))container.querySelector('.selected button')?.focus();tabSignature=nextTabs;
 }
 const nextDownloads=JSON.stringify([s.language,s.downloads]);if(nextDownloads!==downloadSignature){const footer=$('downloads');footer.replaceChildren();const labels=eng?{completed:'Completed',progressing:'Downloading',cancelled:'Cancelled',interrupted:'Interrupted'}:{completed:'已完成',progressing:'下载中',cancelled:'已取消',interrupted:'已中断'};for(const d of (s.downloads||[]).filter(d=>!hiddenDownloads.has(d.download_id)).slice(-3)){const row=document.createElement('span');row.className='download';const name=document.createElement('span');name.className='filename';name.textContent=d.name;name.title=d.name;const status=document.createElement('span');status.textContent=(labels[d.state]||d.state)+' · '+Math.ceil(d.received_bytes/1024)+' KB';row.append(name,status);if(d.state==='completed'){const reveal=document.createElement('button');reveal.textContent=eng?'Show file':'查看文件';reveal.onclick=()=>command({action:'download_reveal',download_id:d.download_id});row.append(reveal);}else if(['progressing','interrupted'].includes(d.state)){const cancel=document.createElement('button');cancel.textContent=eng?'Cancel':'取消';cancel.onclick=()=>command({action:'download_cancel',download_id:d.download_id});row.append(cancel);}if(d.state!=='progressing'){const close=document.createElement('button');close.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';close.setAttribute('aria-label',eng?'Hide finished download':'收起已结束下载');close.onclick=()=>{hiddenDownloads.add(d.download_id);row.remove();footer.hidden=!footer.children.length;layout();};row.append(close);}footer.append(row);}footer.hidden=!footer.children.length;downloadSignature=nextDownloads;}

 $('page-placeholder').hidden=!s.loadError;
 $('notice').hidden=!s.error;$('notice').textContent=s.error||'';
 paintDialog();layout();
}
panels=globalThis.createBrowserPanels({command,openFind,layout,paintTabIcon,confirmCookieClear,confirmPasswordClear});
bridge.onAccess?.(value=>panels.receiveAccess(value));
$('retry-page').onclick=()=>command({action:'reload'});
bridge.onBackdrop?.(value=>{const img=$('panel-backdrop');if(value&&(panels.active||activeDialog)&&value.identity&&value.identity===state.backdropIdentity){img.src=value.data;img.dataset.identity=value.identity;img.hidden=false;}else if(!value)clearBackdrop();});
bridge.onState(paint);

const referenceNotice=document.createElement('div');referenceNotice.className='reference-notice';referenceNotice.hidden=true;referenceNotice.setAttribute('role','status');document.body.append(referenceNotice);let referenceTimer;
bridge.onReferenceNotice?.(text=>{clearTimeout(referenceTimer);referenceNotice.textContent=text;referenceNotice.hidden=false;referenceTimer=setTimeout(()=>referenceNotice.hidden=true,4200);});
