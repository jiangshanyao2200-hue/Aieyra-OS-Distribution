'use strict';
// Shared browser executor. Mounting never changes page trust or tool ownership.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const control=require('./browser-control.cjs');
const {AsyncLocalStorage}=require('node:async_hooks');
const {isIP}=require('node:net');
const semantics=require('./browser-semantics.cjs');
const navigation=require('../ui/browser-navigation.js');
const {profileId,createProfiles}=require('./browser-profiles.cjs');
const {createBrowserPasswords,credentialOrigin}=require('./browser-passwords.cjs');
const {startSocksProxy}=require('./browser-socks-proxy.cjs');
const {dropListURL,readDropList}=require('./browser-proxy-reputation.cjs');
const {permissionKeys}=require('./browser-permissions.cjs');
const DEFAULT_SITE='https://aieyra.cn/';
function createBrowserRuntime({electron,presentation,zoomService,atomicWriteJson,preloadDir,storage,interfaceConfig,language='zh-CN',legacyHomepage,mount,connectSocks,credentialStorage=electron.safeStorage,onInteract=()=>{},onChange=()=>{},onArtifactPage=()=>{},accountSession=()=>null}){
const {BrowserWindow,WebContentsView,session,ipcMain,shell,Menu}=electron;
if(!storage||!path.isAbsolute(storage))throw Error('Missing browser storage');
const releaseStorage=require('./browser-storage-lease.cjs').acquireBrowserStorage(storage);
const listeners=[];let closed=false,closePromise;
const listen=(name,fn)=>{ipcMain.on(name,fn);listeners.push([name,fn]);};
const tabs=new Map(),profiles=new Map(),downloads=new Map(),configuredSessions=new Map(),downloadListeners=new Map();const execution=new AsyncLocalStorage(),queues=new Map(),operations=new Map();
const chromeHeight=88;
const preferences=require('./browser-preferences.cjs').createBrowserPreferences(storage,{atomicWriteJson,legacyHome:legacyHomepage});
const identities=createProfiles(storage,session.defaultSession.getUserAgent().replace(/ Electron\/[^ ]+/g,''),credentialStorage);
const passwords=createBrowserPasswords(storage,credentialStorage,atomicWriteJson);
const socksProxies=new Map();
const proxyDropLists=new Map();
const shellURL=pathToFileURL(path.join(__dirname,'../ui/browser-shell.html')).href;
const shellSource=(event,group)=>event.sender===group.shell&&event.senderFrame===group.shell.mainFrame&&event.senderFrame.url===shellURL+(group.embedded?'?embedded=1':'');
let bookmarks,bookmarkError='';try{bookmarks=require('./browser-bookmarks.cjs').createBookmarks(storage);}catch(e){bookmarkError=e.message;}
const permissionGrants=new Map();
const progress=phase=>execution.getStore()?.onProgress?.(phase);
function serial(key,fn){const task=(queues.get(key)||Promise.resolve()).then(fn);const tail=task.catch(()=>{});queues.set(key,tail);void tail.then(()=>{if(queues.get(key)===tail)queues.delete(key);});return task;}
const sessionFor=profile=>(profile==='aieyra-account'&&accountSession())||(mount?session.fromPath(path.join(storage,'Partitions','agent-'+profile.toLowerCase())):session.fromPartition('persist:agent-'+profile));
async function clearCookies(network){
 await network.clearStorageData({storages:['cookies']});
 await network.cookies.flushStore();
}
async function browserSettings(tab,a){
 requireLiveTab(tab);
 if(tab.group.active!==tab.id||mode(tab.group)!=='interactive')throw Error('Browser settings require the active interactive tab');
 if(!a.settings||typeof a.settings!=='object'||Array.isArray(a.settings))throw Error('无效的浏览器设置');
 const {cookie_policy,password_save,...shared}=a.settings;
 if(a.clear_cookies!==undefined&&a.clear_cookies!==true)throw Error('清理 Cookie 需要确认');
 if((cookie_policy!==undefined||a.clear_cookies)&&!preferences.cookiePolicy(tab.profile).available)throw Error('此身份无法管理 Cookie');
 if(cookie_policy!==undefined&&Object.keys(shared).length)throw Error('请单独保存 Cookie 设置');
 if(a.clear_cookies&&(cookie_policy!==undefined||Object.keys(shared).length))throw Error('请单独清理 Cookie');
 if(password_save!==undefined){
  if(a.clear_cookies||cookie_policy!==undefined||Object.keys(shared).length)throw Error('请单独保存密码设置');
  passwords.setSaving(tab.profile,password_save);
 }
 if(Object.keys(shared).length)preferences.update(shared);
 if(cookie_policy!==undefined)preferences.setCookiePolicy(tab.profile,cookie_policy);
 if(a.clear_cookies){await clearCookies(tab.wc.session);tab.group.cookieCleared=tab.profile;}
 return {preferences:preferences.read(),cookies:preferences.cookiePolicy(tab.profile),cookie_cleared:a.clear_cookies===true};
}
const iconData=/^data:image\/(?:png|gif|webp|jpeg|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i;
async function readFavicon(tab,value,signal){
 if(typeof value!=='string'||value.length>180000)return '';
 if(iconData.test(value))return value;
 const address=new URL(value),page=new URL(tab.wc.getURL());
 if(!['https:','http:'].includes(address.protocol)||address.origin!==page.origin||address.username||address.password||!tab.wc.session.fetch)return '';
 const response=await tab.wc.session.fetch(address.href,{signal,redirect:'error',credentials:'omit'});
 const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
 if(!response.ok||!type||!iconData.test('data:'+type+';base64,AA==')||!response.body){await response.body?.cancel();return '';}
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>131072){await reader.cancel();return '';}chunks.push(value);}
 }finally{reader.releaseLock();}
 return length?'data:'+type+';base64,'+Buffer.concat(chunks,length).toString('base64'):'';
}
const artifactOrigins=require('./browser-artifacts.cjs').createArtifactOrigins(sessionFor);
const visible=group=>group.visible?group.visible():group.win.isVisible();
const mode=group=>group.embedded?'interactive':group.win.aieyraPresentation;
function applyPresentation(group,value){if(!group.embedded)presentation.apply(group.win,value);}
function changed(){if(!closed)onChange(status());}
function status(){
 const groups=new Map();let faults=0;
 for(const tab of tabs.values()){
  const group=tab.group;
  let item=groups.get(group);
  if(!item){
   item={id:group.id,owner:group.owner,profile:group.profile,profile_label:group.profileLabel||group.profile,count:0,faults:0,
    detached:!!group.detached,control:group.control,busy:false,visible:visible(group),title:tabs.get(group.active)?.wc.getTitle()||'',active_tab_id:group.active};
   groups.set(group,item);
  }
  item.count++;
  item.busy ||= !!tab.busy;
  if(tab.crashed||tab.initializationError||tab.loadError||tab.error){item.faults++;faults++;}
 }
 return {groups:[...groups.values()],count:tabs.size,faults};
}
const downloadFile=path.join(storage,'download-history.json');
function saveDownloads(){const rows=[...downloads.values()].map(({item,...d})=>d);fs.mkdirSync(storage,{recursive:true});fs.writeFileSync(downloadFile+'.tmp',JSON.stringify(rows));fs.renameSync(downloadFile+'.tmp',downloadFile);}
try{for(const d of JSON.parse(fs.readFileSync(downloadFile,'utf8'))){if(!d||!/^([a-f0-9]{16})$/.test(d.id)||typeof d.owner!=='string')continue;const folder=path.join(storage,'downloads',d.id)+path.sep;if(typeof d.path!=='string'||!path.resolve(d.path).startsWith(folder))continue;if(d.state==='progressing')d.state='interrupted';downloads.set(d.id,d);}}catch(e){if(e.code!=='ENOENT')downloads.clear();}
const pause=ms=>new Promise(r=>setTimeout(r,ms)),newId=()=>crypto.randomBytes(8).toString('hex');
const tabInfo=t=>({tab_id:t.id,group_id:t.group.id,profile:t.profile,title:t.wc.getTitle(),url:t.wc.getURL(),navigation_sequence:t.navigationSequence||0,opener_tab_id:t.opener||null,active:t.group.active===t.id,loading:t.wc.isLoadingMainFrame(),dialog:t.dialog?{type:t.dialog.type,message:t.dialog.message}:null,error:t.loadError||t.error||null,control:t.group.control,can_go_back:t.wc.navigationHistory.canGoBack(),can_go_forward:t.wc.navigationHistory.canGoForward(),fingerprint:t.fp});
function isLiveTab(tab){return !closed&&!!tab&&tabs.get(tab.id)===tab&&!tab.group.closed&&!tab.win.isDestroyed()&&!tab.group.shell.isDestroyed()&&!tab.wc.isDestroyed();}
function requireLiveTab(tab){if(!isLiveTab(tab))throw Object.assign(Error('Browser tab closed'),{code:'browser_operation_cancelled'});}
function requireRenderer(tab,epoch){requireLiveTab(tab);if((tab.crashEpoch||0)!==epoch)throw Error('Page renderer changed during operation; reload or navigate to recover');}
// A backdrop is a snapshot of one settled viewport, not a cache for the group.
// Clear it before publishing a new identity; both ends reject late captures.
function refreshBackdrop(group){
 if(closed||group.closed||group.shell.isDestroyed())return false;
 const tab=tabs.get(group.active),ready=group.panelOverlay&&isLiveTab(tab)&&tab.initialized&&!tab.backdropNavigating&&!tab.wc.isLoadingMainFrame()&&!tab.loadError&&tab.wc.getURL()!=='about:blank';
 const key=ready?tab.id+':'+(tab.navigationSequence||0)+':'+tab.viewportKey:'';
 if(key===(group.backdropKey||''))return false;
 group.backdropKey=key;const epoch=group.backdropEpoch=(group.backdropEpoch||0)+1;
 const identity=group.backdropIdentity=key?key+':'+epoch:null;
 group.backdropRequest=key?{tab,identity}:null;
 group.shell.send('agent-browser:backdrop',null);
 captureBackdrop(group);
 return true;
}
function captureBackdrop(group){
 if(group.backdropPending||!group.backdropRequest||closed||group.closed)return;
 const request=group.backdropRequest,{tab,identity}=request;group.backdropPending=true;
 const current=()=>isLiveTab(tab)&&group.panelOverlay&&group.active===tab.id&&group.backdropIdentity===identity&&!tab.backdropNavigating&&!tab.wc.isLoadingMainFrame();
 Promise.resolve(tab.viewportReady).then(()=>current()?tab.wc.capturePage(undefined,{stayHidden:true,stayAwake:true}):null).then(image=>{
  if(!current()||!image||image.isEmpty())return;
  const size=image.getSize();group.shell.send('agent-browser:backdrop',{identity,tab_id:tab.id,navigation_sequence:tab.navigationSequence||0,data:(size.width>1280?image.resize({width:1280}):image).toDataURL()});
 }).catch(()=>{}).finally(()=>{group.backdropPending=false;if(group.backdropRequest!==request)captureBackdrop(group);});
}
function layout(group){if(closed||group.closed||group.win.isDestroyed()||group.shell.isDestroyed())return;const {width,height}=group.container.getBounds(),zoom=group.shell.getZoomFactor(),top=Math.ceil((group.chromeHeight||chromeHeight)*zoom),bounds={x:0,y:top,width:Math.max(1,width-Math.ceil((group.panelWidth||0)*zoom)),height:Math.max(1,height-top-Math.ceil((group.shelfHeight||0)*zoom))};for(const t of tabs.values())if(t.group===group&&!t.wc.isDestroyed()){t.view.setBounds(bounds);syncViewport(t);}group.guard?.setBounds(bounds);if(refreshBackdrop(group)){const tab=tabs.get(group.active);if(tab)publish(tab);}}
function syncViewport(tab){
 if(!tab.initialized||tab.wc.isDestroyed())return;
 const bounds=tab.view.getBounds(),key=bounds.width+':'+bounds.height;
 if(tab.viewportKey===key)return;tab.viewportKey=key;
 // 虚拟视口必须与真正可见的页面区域一致，否则iframe坐标会落到窗口外。
 tab.viewportReady=(tab.viewportReady||Promise.resolve()).catch(()=>{}).then(()=>!tab.wc.isDestroyed()&&tab.wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:bounds.width,height:bounds.height,deviceScaleFactor:tab.fp.device_scale_factor,mobile:false}));
 tab.viewportReady.catch(()=>{});
}
function setControl(group,human){
 if(closed||group.closed)return Promise.resolve();
 clearTimeout(group.inputTimer);
 if(human){
  group.releasePending=false;
  group.inputTimer=setTimeout(()=>{if(!closed&&!group.closed&&group.control==='human')void setControl(group,false);},3000);
  if(group.control==='human')return group.controlReady;
 }
 if(!human&&group.humanPending){group.releasePending=true;return group.controlReady;}group.releasePending=false;
 if(human)control.take(group);else control.release(group);group.switchingControl=true;
 const members=[...tabs.values()].filter(t=>t.group===group);for(const t of members)t.revision=null;
 group.controlReady=(group.controlReady||Promise.resolve()).catch(()=>{}).then(async()=>{for(const t of members){if(t.wc.isDestroyed()||!t.wc.debugger.isAttached())continue;for(const id of [undefined,...t.targets.keys()])await t.wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:group.control!=='human'},id);}}).catch(e=>{const active=tabs.get(group.active);if(active)active.error=String(e.message);}).finally(()=>{group.switchingControl=false;const tab=tabs.get(group.active);if(tab){publish(tab);}});
 const tab=tabs.get(group.active);if(tab)publish(tab);return group.controlReady;
}
function finishPermission(tab,accept){const pending=tab.permission;if(!pending)return;clearTimeout(pending.timer);tab.permission=null;if(accept)for(const key of pending.keys)permissionGrants.set(key,true);pending.respond(!!accept);publish(tab);}
function shortcut(tab,event,input){if(input.type!=='keyDown'||mode(tab.group)!=='interactive')return;const action=navigation.shortcut(input);if(action){event.preventDefault();tab.group.shell.focus();tab.group.shell.send('agent-browser:shortcut',action);}}
function beginOperation(tab,a,actor='agent'){
 const group=tab.group,id=newId(),sequence=++group.operationSequence;
 const target=a.url||a.query||(a.element_id!==undefined?language==='en-US'?'Element '+a.element_id:'元素 '+a.element_id:tab.wc.getURL());
 const item={id,sequence,revision:++group.operationRevision,tool:'browser',action:a.action,targets:target?[String(target).slice(0,500)]:[],state:'running',actor};
 group.operations.push(item);if(group.operations.length>200)group.operations.shift();publish(tab);return item;
}
function finishOperation(tab,item,error){if(!tab||!item)return;item.state=error?'failed':'completed';if(error){item.detail=String(error.message||error).slice(0,800);if(item.detail.startsWith('human_control:')){item.state='handed_over';item.detail_code='human_control';}else if(item.detail.startsWith('snapshot_required:'))item.detail_code='snapshot_required';}item.revision=++tab.group.operationRevision;if(!error&&item.action==='snapshot')for(const prior of tab.group.operations)if(prior.detail_code==='snapshot_required'){prior.state='superseded';prior.detail_code='observed_again';prior.revision=++tab.group.operationRevision;}publish(tab);}
const downloadInfo=d=>({download_id:d.id,tab_id:d.tabId,name:d.name,url:d.url,state:d.state,received_bytes:d.received,total_bytes:d.total,path:d.state==='completed'?d.path:null,started_at:d.started,finished_at:d.finished||null});
function publish(tab,error=''){
 if(closed||tab.group.closed||tab.win.isDestroyed()||tab.group.shell.isDestroyed())return;if(error)tab.error=error;
 const group=tab.group,active=tabs.get(group.active);if(!active||active.wc.isDestroyed())return;
 refreshBackdrop(group);
 group.modalSource?.set(!!(group.panelOverlay||active.dialog||active.permission));
 for(const t of tabs.values())if(t.group===group){const visible=t===active&&!active.dialog&&!active.permission&&!active.loadError&&!group.panelOverlay&&!group.settingsPage&&active.wc.getURL()!=='about:blank';if(t.visible!==visible){t.view.setVisible(visible);t.visible=visible;}}
 group.guard?.setVisible(!!active.visible&&group.switchingControl===true);
 const history=active.wc.navigationHistory,profileRows=identities.list();
 group.profileLabel=profileRows.find(p=>p.id===group.profile)?.label||group.profile;
 group.shell.send('agent-browser:state',{backdropIdentity:group.backdropIdentity||null,language,presenceSize:group.presenceSize||64,eyra:group.eyra?.(),busy:[...tabs.values()].some(t=>t.group===group&&t.busy),proxyTest:group.proxyTest||null,preferences:preferences.read(),cookies:{...preferences.cookiePolicy(active.profile),cleared:group.cookieCleared===active.profile},passwords:passwords.status(active.profile,active.wc.getURL()),profile:active.profile,profiles:profileRows,startPending:active.startPending===true,url:active.wc.getURL(),title:active.wc.getTitle(),canGoBack:history.canGoBack(),canGoForward:history.canGoForward(),error:active.loadError||active.error||bookmarkError||preferences.read().error,loadError:!!active.loadError,loading:active.wc.isLoadingMainFrame(),find:active.find||null,visible:visible(group),appearance:group.appearance||null,totalTabs:tabs.size,dialog:active.dialog||null,permission:active.permission?{id:active.permission.id,message:active.permission.message}:null,bookmarks:bookmarks?.list(active.profile)||[],tabs:[...tabs.values()].filter(t=>t.group===group).map(t=>({...tabInfo(t),favicon:t.favicon||undefined})),downloads:[...downloads.values()].filter(d=>d.owner===active.owner&&d.profile===active.profile).map(downloadInfo),control:group.control,presentation:mode(group),embedded:!!group.embedded,detached:!!group.detached,canDetach:typeof group.place==='function'});changed();
}
function activate(tab){requireLiveTab(tab);tab.group.active=tab.id;if(!tab.group.embedded&&!tab.win.isVisible())tab.win.showInactive();publish(tab);}
async function referenceAt(tab,point,mode){
 if(!tab.group.canReference?.())throw Error('Eyra OS会话当前不可用');
 const sequence=tab.navigationSequence||0;
 const hit=await cdp(tab,'DOM.getNodeForLocation',{x:Math.round(point.x),y:Math.round(point.y),includeUserAgentShadowDOM:false});
 const ctx=await frameContext(tab,hit.frameId),resolved=await cdp(tab,'DOM.resolveNode',{backendNodeId:hit.backendNodeId,executionContextId:ctx.contextId},ctx.sessionId);
 const id=newId();let result;
 try{result=await cdp(tab,'Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:semantics.referenceRegion.toString(),arguments:[{value:mode},{value:id}],returnByValue:true},ctx.sessionId);}
 finally{await cdp(tab,'Runtime.releaseObject',{objectId:resolved.object.objectId},ctx.sessionId).catch(()=>{});}
 if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||'无法引用这个区域');
 if(sequence!==(tab.navigationSequence||0))throw Error('页面已跳转，请重新引用');
 const reference={...result.result.value,tab_id:tab.id,frame_id:ctx.frame_id,navigation:sequence,captured_at:new Date().toISOString()};
 if(Buffer.byteLength(JSON.stringify(reference))>60000)throw Error('区域内容过多，请选择较小范围');
 await tab.group.onReference(reference);
 groupToast(tab.group,'已加入 Eyra 输入框');return reference;
}
function groupToast(group,text){group.shell.send('agent-browser:referenceNotice',text);}
function contextMenu(tab,params){
 const items=[];
 if(tab.group.canReference?.())for(const [scope,label]of [['element','@ 此区域'],['block','@ 所在段落或卡片'],['table','@ 所在表格']])items.push({label,click:()=>void referenceAt(tab,params,scope).catch(e=>groupToast(tab.group,e.message))});
 if(items.length)items.push({type:'separator'});
 if(params.selectionText)items.push({role:'copy',label:'复制'});
 if(params.isEditable)items.push({role:'cut',label:'剪切'},{role:'paste',label:'粘贴'});
 if(/^https?:/.test(params.linkURL||''))items.push({label:'在新标签页打开链接',click:()=>void user(tab.owner,{action:'open',group_id:tab.group.id,url:params.linkURL}).catch(e=>groupToast(tab.group,e.message))});
 items.push({label:'重新加载',click:()=>tab.wc.reload()});
 Menu.buildFromTemplate(items).popup({window:tab.win});
}
async function revealReference(owner,reference){
 const tab=get(owner,reference.tab_id);
 if(!tab.group.canReference?.()||reference.navigation!==(tab.navigationSequence||0))return {ok:false,error:'原页面已跳转，引用快照仍保留。'};
 const result=await evalPage(tab,'('+semantics.revealReference.toString()+')('+JSON.stringify(reference.id)+')',reference.frame_id);
 if(result?.ok){activate(tab);tab.group.showReference?.();}return result;
}
function closeTab(tab){
 if(!tabs.has(tab.id))return;if(tab.permission)finishPermission(tab,false);
 clearPasswordCandidate(tab);
 tab.passwordFill?.finish(false);
 if(tab.promptReply){tab.promptReply(null);tab.promptReply=null;}
 for(const d of downloads.values())if(d.tabId===tab.id&&['progressing','interrupted'].includes(d.state)&&d.item)d.item.cancel();
 const group=tab.group,index=[...tabs.values()].filter(t=>t.group===group).indexOf(tab);tabs.delete(tab.id);if(!group.win.isDestroyed())group.container.removeChildView(tab.view);if(!tab.wc.isDestroyed())tab.wc.close();
 const remaining=[...tabs.values()].filter(t=>t.group===group);
 if(!remaining.length){group.externalAccess?.close();group.dispose();}else if(group.active===tab.id){const next=remaining[Math.min(index,remaining.length-1)];group.active=next.id;publish(next);}else publish(remaining[0]);
 if(![...tabs.values()].some(t=>t.profile===tab.profile)){
  profiles.delete(tab.profile);
  const route=socksProxies.get(tab.profile);
  if(route){socksProxies.delete(tab.profile);route.bridge.close();}
 }
 changed();
}
function url(value){if(value==='about:blank')return value;const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw Error('Only HTTP(S) URLs supported');return u.href;}
function configureSession(ses){
 if(configuredSessions.has(ses))return;
 const origin=value=>{try{return new URL(value).origin;}catch{return '';}};
 ses.setPermissionCheckHandler((wc,p,site,details)=>{const tab=[...tabs.values()].find(t=>t.wc===wc);if(!tab)return false;const keys=permissionKeys(tab.profile,p,site,details);return keys.length>0&&keys.every(key=>permissionGrants.get(key)===true);});
 ses.setPermissionRequestHandler((wc,p,respond,details)=>{
  const tab=[...tabs.values()].find(t=>t.wc===wc),labels={media:'摄像头或麦克风',geolocation:'位置信息','geolocation-approximate':'大致位置',notifications:'通知','clipboard-read':'读取剪贴板','clipboard-sanitized-write':'写入剪贴板',fullscreen:'全屏',persistentStorage:'本地存储','persistent-storage':'本地存储'};
  if(!tab||mode(tab.group)!=='interactive'||!labels[p]){respond(false);return;}
  const site=origin(details.requestingUrl);if(!/^https?:\/\//.test(site)){respond(false);return;}
  const keys=permissionKeys(tab.profile,p,site,details);if(!keys.length){respond(false);return;}if(keys.every(key=>permissionGrants.get(key))){respond(true);return;}
  if(tab.permission){respond(false);return;}setControl(tab.group,true);activate(tab);
  const message=language==='en-US'?site+' requests '+p+'. Allow for this browser session?':site+' 请求使用'+labels[p]+'。是否在本次浏览器会话中允许？';
  tab.permission={id:newId(),keys,message,respond,timer:setTimeout(()=>finishPermission(tab,false),120000)};publish(tab);
 });
 const willDownload=(_event,item,wc)=>{
  const tab=[...tabs.values()].find(t=>t.wc===wc);
  if(!tab){item.cancel();return;}
  if(downloads.size>=200){const finished=[...downloads.values()].find(d=>!d.item||['completed','cancelled'].includes(d.state));if(finished)downloads.delete(finished.id);else{item.cancel();publish(tab,language==='en-US'?'Too many active downloads':'进行中的下载过多');return;}}
  // Chromium写入独立随机目录，网站文件名不能逃逸或覆盖用户现有文件。
  const id=newId(),folder=path.join(storage,'downloads',id),raw=item.getFilename();
  let name=path.basename(raw).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,150)||'download';
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
  fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,name);item.setSavePath(file);
  const d={id,owner:tab.owner,profile:tab.profile,tabId:tab.id,name,url:item.getURL(),path:file,state:'progressing',received:0,total:item.getTotalBytes(),started:new Date().toISOString(),item};downloads.set(id,d);saveDownloads();
  const changed=()=>{d.received=item.getReceivedBytes();d.total=item.getTotalBytes();publish(tab);};
  const updated=(_e,state)=>{d.state=state;changed();};
  const done=(_e,state)=>{d.state=state;d.finished=new Date().toISOString();changed();detachDownload(item);d.item=null;saveDownloads();};
  downloadListeners.set(item,{updated,done});item.on('updated',updated);item.once('done',done);publish(tab);
 };
 configuredSessions.set(ses,willDownload);ses.on('will-download',willDownload);
}
function detachDownload(item){const handlers=downloadListeners.get(item);if(!handlers)return;item.removeListener('updated',handlers.updated);item.removeListener('done',handlers.done);downloadListeners.delete(item);}
async function cdp(tab,name,args={},sessionId){
 requireLiveTab(tab);
 control.assert(tab.group);
 const epoch=tab.crashEpoch||0;
 progress(name);const debug=tab.wc.debugger,command=async()=>{const input=name.startsWith('Input.');if(input)tab.agentInputDepth=(tab.agentInputDepth||0)+1;try{const result=await debug.sendCommand(name,args,sessionId||undefined);requireRenderer(tab,epoch);return result;}finally{if(input)tab.agentInputDepth--;}};
 if(!name.startsWith('Input.')&&name!=='Runtime.evaluate')return command();
 let listener;const dialog=new Promise(resolve=>{listener=(_e,method)=>{if(method==='Page.javascriptDialogOpening')resolve({dialog_pending:true});};debug.on('message',listener);});
 try{return await Promise.race([command(),dialog]);}finally{debug.removeListener('message',listener);}
}
async function frames(tab){
 const rows=new Map();
 const read=async sessionId=>{try{const data=await cdp(tab,'Page.getFrameTree',{},sessionId);const walk=(node,parent)=>{const f=node.frame;rows.set(f.id,{frame_id:f.id,parent_frame_id:f.parentId||parent||null,name:f.name||'',url:f.url,sessionId});for(const child of node.childFrames||[])walk(child,f.id);};walk(data.frameTree);}catch(e){if(!sessionId)throw e;}};
 await read(undefined);for(const id of tab.targets.keys())await read(id);return rows;
}
async function frameContext(tab,frameId){
 for(const ready of tab.targetReady.values())await ready;
 const all=await frames(tab),f=frameId?all.get(frameId):[...all.values()].find(f=>!f.parent_frame_id);
 if(!f)throw Error('Unknown or detached frame; take a main-page snapshot and use frames[].frame_id');
 const world=await cdp(tab,'Page.createIsolatedWorld',{frameId:f.frame_id,worldName:'aieyra-agent',grantUniveralAccess:false},f.sessionId);
 return {...f,contextId:world.executionContextId,all};
}
async function evalContext(tab,expression,ctx,returnByValue=true){
 const r=await cdp(tab,'Runtime.evaluate',{expression,contextId:ctx.contextId,returnByValue,awaitPromise:true,timeout:12000},ctx.sessionId);
 if(r.dialog_pending)return {dialog_pending:true};if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return returnByValue?r.result.value:r.result;
}
async function evalPage(tab,expression,frameId){return evalContext(tab,expression,await frameContext(tab,frameId));}
async function snapshot(tab,a={}){
 const epoch=tab.crashEpoch||0;
 const offset=a.offset??0,limit=a.limit??100,textOffset=a.text_offset??0,textLimit=a.text_limit??16000;
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid page range');
 if(!Number.isInteger(textOffset)||textOffset<0||!Number.isInteger(textLimit)||textLimit<1||textLimit>32000)throw Error('Invalid text range');
 const ctx=await frameContext(tab,a.frame_id),revision=newId();
 if(a.role!==undefined&&typeof a.role!=='string'||a.name!==undefined&&typeof a.name!=='string')throw Error('Invalid semantic locator');
 const data=await evalContext(tab,'('+semantics.observe.toString()+')('+JSON.stringify({revision,offset,limit,text_offset:textOffset,text_limit:textLimit,role:a.role,name:a.name,exact:a.exact===true})+')',ctx);
 requireRenderer(tab,epoch);control.assert(tab.group);tab.revision=revision;tab.snapshotFrame=ctx.frame_id;if(control.actor()==='agent')tab.group.needsSnapshot=false;
 return {...data,loading:tab.wc.isLoadingMainFrame(),page_error:tab.loadError||null,group_id:tab.group.id,tab_id:tab.id,frame_id:ctx.frame_id,frames:[...ctx.all.values()].map(({sessionId,...f})=>f),revision,fingerprint:tab.fp,window_pid:process.pid,content_trust:'untrusted_page_data',presentation:mode(tab.group),control:tab.group.control,tabs:[...tabs.values()].filter(t=>t.owner===tab.owner).map(tabInfo),downloads:[...downloads.values()].filter(d=>d.owner===tab.owner).slice(-10).map(downloadInfo)};
}
async function identityOverride(tab,sessionId){
 const epoch=tab.crashEpoch||0,debug=tab.wc.debugger,send=async(method,args)=>{requireRenderer(tab,epoch);const result=await debug.sendCommand(method,args,sessionId);requireRenderer(tab,epoch);return result;};
 const version=/Chrome\/([\d.]+)/.exec(tab.fp.user_agent)?.[1];
 const native=await send('Runtime.evaluate',{expression:"navigator.userAgentData?.getHighEntropyValues(['architecture','bitness','model','platformVersion','wow64']).then(v=>JSON.stringify(v))",returnByValue:true,awaitPromise:true});
 const hints=native.result?.value?JSON.parse(native.result.value):{platform:({win32:'Windows',darwin:'macOS',linux:'Linux'})[process.platform]||process.platform,platformVersion:require('node:os').release().split('.').slice(0,3).join('.'),architecture:process.arch.startsWith('arm')?'arm':'x86',bitness:process.arch.includes('64')?'64':'32',model:'',wow64:false};
 const metadata=version&&hints?{platform:hints.platform,platformVersion:hints.platformVersion,architecture:hints.architecture,bitness:hints.bitness,model:hints.model,mobile:false,wow64:!!hints.wow64,brands:[{brand:'Chromium',version:version.split('.')[0]}],fullVersionList:[{brand:'Chromium',version}],fullVersion:version}:undefined;
 await send('Emulation.setUserAgentOverride',{userAgent:tab.fp.user_agent,acceptLanguage:tab.fp.locale,...metadata?{userAgentMetadata:metadata}:{}});
 try{await send('Emulation.setLocaleOverride',{locale:tab.fp.locale});}catch(e){
  if(!String(e.message).includes('Another locale override is already in effect'))throw e;
  const actual=await send('Runtime.evaluate',{expression:'new Intl.DateTimeFormat().resolvedOptions().locale',returnByValue:true,timeout:3000});
  if(actual.result?.value!==new Intl.DateTimeFormat(tab.fp.locale).resolvedOptions().locale)throw e;
 }
 await send('Emulation.setTimezoneOverride',{timezoneId:tab.fp.timezone});
}
async function configureProxy(tab,force=false){
 if(tab.profile==='aieyra-account')return;
 await serial('proxy:'+tab.profile,async()=>{
  if(!isLiveTab(tab))return;
  const identity=identities.read(tab.profile),proxy=identity?.proxy;
  if(!proxy&&!force)return;
  const network=tab.wc.session;
  if(!network.setProxy)throw Error('当前浏览会话不支持代理');
  const previous=socksProxies.get(tab.profile);
  const authenticated=proxy?.startsWith('socks5://')&&(identity.proxy_auth||identity.proxy_auth_encrypted);
  let route;
  if(authenticated){
   if(!identity.proxy_auth||!connectSocks)throw Error('SOCKS5 代理认证不可用，请重新保存认证凭据');
   const {username,password}=identity.proxy_auth;
   if(previous?.proxy===proxy&&previous.username===username&&previous.password===password)return;
   const bridge=await startSocksProxy(identity,connectSocks);
   route={proxy,username,password,bridge};
  }
  try{
   if(!isLiveTab(tab))return;
   await network.setProxy(proxy?{mode:'fixed_servers',proxyRules:route?.bridge.rules||proxy}:{mode:'system'});
   if(!isLiveTab(tab))return;
   if(route)socksProxies.set(tab.profile,route);
   else socksProxies.delete(tab.profile);
   previous?.bridge.close();
   if(force)await network.closeAllConnections?.();
  }finally{
   if(route&&socksProxies.get(tab.profile)!==route)route.bridge.close();
  }
 });
}
function matchingProxyAuth(profile,auth,profileId){
 if(!auth.isProxy)return null;
 const bridge=socksProxies.get(profileId)?.bridge;
 if(bridge)return auth.host==='127.0.0.1'&&Number(auth.port)===bridge.port?bridge.auth:null;
 if(!profile?.proxy_auth||!/^https?:\/\//.test(profile.proxy))return null;
 const proxy=new URL(profile.proxy),port=Number(proxy.port||(proxy.protocol==='https:'?443:80));
 return proxy.hostname.toLowerCase()===String(auth.host).toLowerCase()&&port===Number(auth.port)?profile.proxy_auth:null;
}
function proxyLogin(event,contents,_request,auth,callback){
 const tab=[...tabs.values()].find(t=>t.wc===contents);
 if(!tab||!auth.isProxy)return;
 const credentials=matchingProxyAuth(identities.read(tab.profile),auth,tab.profile);
 if(!credentials)return;
 event.preventDefault();callback(credentials.username,credentials.password);
}
electron.app.on('login',proxyLogin);
function probeProxy(network,target,profile,bodyType){
 return new Promise((resolve,reject)=>{
  const request=electron.net.request({method:bodyType?'GET':'HEAD',url:target,session:network,redirect:'error',useSessionCookies:false});
  const finish=(error,result)=>{clearTimeout(timer);if(error)reject(error);else resolve(result);};
  const timer=setTimeout(()=>{request.abort();finish(Error('代理检测超时'));},8000);
  if(bodyType){request.setHeader('Accept',bodyType==='drop'?'application/x-ndjson':'application/json');request.setHeader('Cache-Control','no-cache');}
  let tried=false;
  request.on('login',(auth,callback)=>{
   const credentials=!tried&&matchingProxyAuth(profile,auth,profile?.id);
   tried=true;
   if(credentials)callback(credentials.username,credentials.password);else callback();
  });
  request.once('response',response=>{
   response.once('error',finish);
   const status=response.statusCode;
   if(!bodyType||status<200||status>=300){
    response.resume();finish(null,{status});return;
   }
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{
    bytes+=chunk.length;
    const limit=bodyType==='drop'?512*1024:4096;
    if(bytes>limit){request.abort();finish(Error('代理查询响应过大'));return;}
    chunks.push(chunk);
   });
   response.once('end',()=>{
    try{
     const body=Buffer.concat(chunks).toString('utf8');
     if(bodyType==='drop'){finish(null,{status,body});return;}
     const {ip}=JSON.parse(body);
     if(typeof ip!=='string'||!isIP(ip))throw Error('无效的出口 IP');
     finish(null,{status,ip});
    }catch(error){finish(error);}
   });
  });
  request.once('error',finish);
  request.end();
 });
}
async function initialize(tab,blank){
 await configureProxy(tab);
 requireLiveTab(tab);const epoch=tab.crashEpoch||0,wc=tab.wc;if(blank){await wc.loadURL('about:blank');requireRenderer(tab,epoch);tab.bootstrapRequired=false;}requireRenderer(tab,epoch);if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
 if(!tab.debugListener){tab.debugListener=true;wc.debugger.on('message',(_event,method,params,sessionId)=>{
  if(method==='Target.attachedToTarget'&&params.targetInfo.type==='iframe'){
   const targetEpoch=tab.crashEpoch||0;
   tab.targets.set(params.sessionId,params.targetInfo.targetId);
   const ready=Promise.all([wc.debugger.sendCommand('Page.enable',{},params.sessionId),wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:tab.group.control!=='human'},params.sessionId),wc.debugger.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},params.sessionId),identityOverride(tab,params.sessionId)]);tab.targetReady.set(params.sessionId,ready);ready.catch(e=>{if(!isLiveTab(tab)||(tab.crashEpoch||0)!==targetEpoch||tab.targetReady.get(params.sessionId)!==ready)return;tab.initializationError=e.message;publish(tab,e.message);});
  }
  if(method==='Target.detachedFromTarget'){tab.targets.delete(params.sessionId);tab.targetReady.delete(params.sessionId);}
  if(method==='Page.frameNavigated'||method==='Page.frameDetached')tab.revision=null;
  if(method==='Page.javascriptDialogOpening'){tab.dialog={...params,sessionId};publish(tab);}
  if(method==='Page.javascriptDialogClosed'){tab.dialog=null;publish(tab);}
  if(method==='Page.fileChooserOpened'){tab.upload={state:'awaiting_files'};publish(tab);}
 });}
 await cdp(tab,'Page.enable');await cdp(tab,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
 await cdp(tab,'Page.setInterceptFileChooserDialog',{enabled:tab.group.control!=='human'});
 await identityOverride(tab);
 requireRenderer(tab,epoch);tab.initialized=true;syncViewport(tab);await tab.viewportReady;requireRenderer(tab,epoch);
}
function makeTab(owner,profile,fp,opener,displayMode='display',popupOptions,instance,background=false){
 if(closed)throw Error('Browser host closed');
 let group=instance===undefined?selectInstance(owner,profile,{}):instance;
 if(!group){
  if(mount){group=mount({owner,profile,fp,displayMode});}
  else{
   const win=new BrowserWindow({width:fp.width,height:fp.height+chromeHeight,useContentSize:true,minWidth:480,minHeight:380,show:false,focusable:false,backgroundColor:'#161616',title:language==='en-US'?'Aieyra · Browser':'Aieyra · 浏览器',autoHideMenuBar:true,titleBarStyle:'hidden',titleBarOverlay:{color:'#101319',symbolColor:'#cbd5e1',height:44},webPreferences:{preload:path.join(preloadDir,'browser-shell-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
   presentation.apply(win,displayMode);win.showInactive();win.setMenu(null);
   group={win,shell:win.webContents,container:win.contentView,ready:win.loadFile(path.join(__dirname,'../ui/browser-shell.html')),dispose(){if(!win.isDestroyed())win.destroy();}};
  }
  // Identity metadata is refreshed when browser chrome is published. The OS
  // status poll must not enumerate and revalidate every saved profile on disk.
  Object.assign(group,{id:newId(),owner,profile,profileLabel:identities.read(profile)?.label||profile,active:null,chromeHeight:group.embedded?44:chromeHeight,shelfHeight:0,operations:[],operationSequence:0,operationRevision:0});control.initialize(group);
  let boundWindow;
  const guard=new WebContentsView({webPreferences:{preload:path.join(preloadDir,'browser-guard-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});guard.setBackgroundColor('#00000000');group.guard=guard;group.container.addChildView(guard);guard.webContents.setWindowOpenHandler(()=>({action:'deny'}));guard.webContents.on('will-navigate',e=>e.preventDefault());
  const zoom=zoomService.forConfig(interfaceConfig);
  if(!group.embedded)zoom.attach(group.win,{minimum:[400,380],overlay:true,overlayHeight:44,changed:z=>{if(!guard.webContents.isDestroyed())guard.webContents.setZoomFactor(z);layout(group);}});
  zoom.input(guard.webContents,()=>group.win);if(group.embedded)zoom.input(group.shell,()=>group.win);
  group.refreshChrome=()=>{const active=tabs.get(group.active);if(active)publish(active);};
  group.relayout=()=>{if(group.shell.isDestroyed())return;const z=group.win.webContents.getZoomFactor();if(group.embedded)group.shell.setZoomFactor(z);guard.webContents.setZoomFactor(z);layout(group);};
  guard.webContents.on('did-finish-load',()=>guard.webContents.setZoomFactor(group.shell.getZoomFactor()));
  guard.webContents.loadFile(path.join(__dirname,'../ui/browser-guard.html'),{query:{language}}).catch(()=>{});
  group.shell.setWindowOpenHandler(()=>({action:'deny'}));group.shell.on('will-navigate',e=>e.preventDefault());
  const resize=()=>group.relayout(),refresh=()=>{const tab=tabs.get(group.active);if(tab)publish(tab);};
  const detachListeners=()=>{if(!boundWindow)return;boundWindow.removeListener('resize',resize);for(const event of ['show','hide','minimize','restore'])boundWindow.removeListener(event,refresh);boundWindow.removeListener('closed',close);};
  const close=()=>{for(const t of [...tabs.values()])if(t.group===group)closeTab(t);group.dispose();};
  group.bindWindow=next=>{detachListeners();group.win=boundWindow=next;for(const t of tabs.values())if(t.group===group)t.win=next;next.on('resize',resize);for(const event of ['show','hide','minimize','restore'])next.on(event,refresh);next.once('closed',close);group.relayout();refresh();};
  const dispose=group.dispose;let disposed=false;
  group.dispose=()=>{if(disposed)return;disposed=true;group.closed=true;clearTimeout(group.inputTimer);group.backdropKey='';group.backdropIdentity=null;group.backdropRequest=null;detachListeners();if(!guard.webContents.isDestroyed())guard.webContents.close();dispose();};
  group.bindWindow(group.win);
 }
 const view=new WebContentsView({...popupOptions?.webContents?{webContents:popupOptions.webContents}:{},webPreferences:{...popupOptions?.webPreferences,session:sessionFor(profile),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,preload:path.join(preloadDir,'browser-page-preload.cjs')}});
 const artifact=artifactOrigins.source(profile);if(artifact)onArtifactPage(view.webContents,artifact.origin);
 group.container.addChildView(view);const {width,height}=group.container.getBounds();const inset=group.chromeHeight;view.setBounds({x:0,y:inset,width,height:Math.max(1,height-inset)});
 const tab={id:newId(),owner,profile,fp,opener,group,win:group.win,view,wc:view.webContents,targets:new Map(),targetReady:new Map(),revision:null};tabs.set(tab.id,tab);if(!group.active||!background&&control.actor()!=='agent')group.active=tab.id;profiles.set(profile,fp);
 group.container.addChildView(group.guard);layout(group);
 view.webContents.setWindowOpenHandler(details=>{
  try{url(details.url);}
  catch(e){publish(tab,e.message);return {action:'deny'};}
  // Chromium负责导航及opener关系；新标签仍使用同一隔离配置与安全偏好。
  return {action:'allow',createWindow:options=>{const child=makeTab(owner,profile,fp,tab.id,mode(group),options,group);child.ready=new Promise(resolve=>setImmediate(resolve)).then(()=>control.run({actor:'human'},()=>initialize(child,false))).then(()=>group.ready).then(()=>publish(child)).catch(e=>{child.initializationError=e.message;publish(child,e.message);});return child.wc;}};
 });
 const humanInput=input=>{if(!tab.agentInputDepth&&mode(group)==='interactive'&&visible(group)&&['keyDown','mouseDown','mouseWheel'].includes(input.type))void setControl(group,true);};
 view.webContents.on('before-input-event',(event,input)=>{humanInput(input);shortcut(tab,event,input);});
 view.webContents.on('before-mouse-event',(_event,input)=>humanInput(input));
 view.webContents.on('context-menu',(_event,params)=>{if(mode(tab.group)==='interactive')contextMenu(tab,params);});
 // 保留webContents引用：销毁后WebContentsView.webContents已为空，不能再取这个getter。
 view.webContents.on('destroyed',()=>closeTab(tab));
 view.webContents.on('will-navigate',(e,u)=>{try{url(u);}catch{e.preventDefault();}});
 view.webContents.on('will-redirect',(e,u)=>{try{url(u);}catch{e.preventDefault();}if(tab.passwordCandidate&&credentialOrigin(u)!==tab.passwordCandidate.origin)clearPasswordCandidate(tab);});
 view.webContents.on('did-start-navigation',(_e,target,inPlace,isMain)=>{
  const candidate=tab.passwordCandidate;
  if(!candidate||!isMain||inPlace)return;
  if(candidate.started||candidate.action!==target||candidate.startBy<Date.now())clearPasswordCandidate(tab);
  else candidate.started=true;
 });
 view.webContents.on('did-navigate',(_e,target,status)=>{
  const candidate=tab.passwordCandidate;
  if(!candidate)return;
  if(!candidate.started||credentialOrigin(target)!==candidate.origin||status<200||status>=400)clearPasswordCandidate(tab);
  else candidate.committed=true;
 });
 view.webContents.on('did-start-navigation',(_e,_u,inPlace,isMain)=>{if(isMain){if(!inPlace){tab.faviconRequest?.abort();tab.favicon='';}tab.navigationSequence=(tab.navigationSequence||0)+1;tab.backdropNavigating=true;tab.revision=null;tab.loadError='';tab.error='';if(tab.permission)finishPermission(tab,false);publish(tab);}});
 view.webContents.on('page-favicon-updated',(_event,candidates)=>{
  if(!isLiveTab(tab)||!Array.isArray(candidates))return;
  tab.faviconRequest?.abort();
  const controller=new AbortController();tab.faviconRequest=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(3500)]),sequence=tab.navigationSequence;
  void (async()=>{for(const candidate of candidates.slice(0,4)){
   let image;try{image=await readFavicon(tab,candidate,signal);}catch{if(signal.aborted)return;continue;}
   if(signal.aborted||!isLiveTab(tab)||sequence!==tab.navigationSequence)return;
   if(image){if(tab.favicon!==image){tab.favicon=image;publish(tab);}return;}
  }})();
 });
 view.webContents.on('did-stop-loading',()=>{tab.backdropNavigating=false;publish(tab);});
 view.webContents.on('did-navigate-in-page',(_e,_u,isMain)=>{if(isMain!==false)tab.backdropNavigating=false;publish(tab);});
 for(const event of ['did-navigate','page-title-updated','did-start-loading'])view.webContents.on(event,()=>publish(tab));
 view.webContents.on('did-fail-load',(_e,code,message,failedURL,isMainFrame)=>{if(code===-3||!isMainFrame)return;const sequence=tab.navigationSequence;setTimeout(()=>{if(!tabs.has(tab.id)||tab.wc.isDestroyed()||sequence!==tab.navigationSequence||sequence===tab.stoppedNavigation)return;if(![...downloads.values()].some(d=>d.tabId===tab.id&&Date.now()-Date.parse(d.started)<1500)){tab.loadError=message+' · '+failedURL;publish(tab);}},100);});
 view.webContents.on('render-process-gone',(_e,details)=>{const current=tab.wc.getURL();tab.crashEpoch=(tab.crashEpoch||0)+1;tab.revision=null;tab.crashed=true;tab.bootstrapRequired=true;tab.recoverURL=current&&current!=='about:blank'?current:tab.recoverURL||current||'about:blank';tab.initialized=false;tab.viewportKey=null;tab.targets.clear();tab.targetReady.clear();tab.initializationError='Page renderer '+details.reason;tab.loadError=tab.initializationError;publish(tab);});
 view.webContents.on('found-in-page',(_e,result)=>{tab.find={query:tab.find?.query||'',matches:result.matches,active:result.activeMatchOrdinal};publish(tab);});
 return tab;
}
function stopLoading(tab){
 clearPasswordCandidate(tab);
 tab.stoppedNavigation=tab.navigationSequence;
 if(tab.pendingNavigation)tab.pendingNavigation.cancelled=true;
 tab.wc.stop();tab.revision=null;
}
async function navigate(tab,target,options={},timeout=0){
 requireLiveTab(tab);
 control.assert(tab.group);
 const epoch=tab.crashEpoch||0;
 url(target);tab.error='';tab.loadError='';let listener;const debug=tab.wc.debugger,request={cancelled:false};tab.pendingNavigation=request;
 const dialog=new Promise(resolve=>{listener=(_e,method)=>{if(method==='Page.javascriptDialogOpening')resolve();};debug.on('message',listener);});
 let timer;
 const timeoutResult=timeout?new Promise((_,reject)=>{timer=setTimeout(()=>{
  reject(Object.assign(Error('Search navigation timed out'),{code:'browser_search_timeout'}));tab.wc.stop();
 },timeout);}):new Promise(()=>{});
 try{await Promise.race([tab.wc.loadURL(target,options),dialog,timeoutResult]);}catch(e){
  await pause(80);
  if(request.cancelled)throw Object.assign(Error('Navigation stopped'),{code:'browser_navigation_cancelled'});
  if(![...downloads.values()].some(d=>d.tabId===tab.id&&d.url===target&&Date.now()-Date.parse(d.started)<5000))throw e;
 }finally{clearTimeout(timer);if(tab.pendingNavigation===request)tab.pendingNavigation=null;debug.removeListener('message',listener);}
 requireRenderer(tab,epoch);control.assert(tab.group);
 if(tab.recoverURL&&!tab.dialog)tab.recoverURL=tab.wc.getURL()||target;
 publish(tab);const result=tab.dialog?{tab_id:tab.id,dialog:tab.dialog,next:'handle_dialog'}:await snapshot(tab);
 requireRenderer(tab,epoch);control.assert(tab.group);if(!result.dialog)tab.recoverURL=null;return result;
}
function selectInstance(owner,profile,a){
 if(a.new_instance!==undefined&&typeof a.new_instance!=='boolean')throw Error('new_instance must be a boolean');
 if(a.new_instance&&a.group_id)throw Error('Choose group_id or new_instance');
 if(a.group_id){const group=[...tabs.values()].find(t=>t.group.id===a.group_id)?.group;
  if(!group||group.owner!==owner||group.profile!==profile)throw Error('Unknown browser instance for this session');return group;}
 if(a.new_instance)return null;
 const candidates=[...new Set([...tabs.values()].filter(t=>t.owner===owner&&t.profile===profile).map(t=>t.group))];
 if(candidates.length>1)throw Error('Multiple browser instances: choose group_id from tabs or use new_instance:true');
 return candidates[0]||null;
}
async function open(owner,a,searchQuery=''){
 const displayMode=presentation.mode(a.presentation);
 const requested=a.group_id?[...tabs.values()].find(t=>t.group.id===a.group_id)?.group:null;
 if(a.group_id&&(!requested||requested.owner!==owner))throw Error('Unknown browser instance for this session');
 progress('profile');url(a.url||'about:blank');const identity=identities.ensure({...a,...(requested&&a.profile===undefined?{profile:requested.profile}:{})}),profile=identity.id,fp=identity.fingerprint;
 const existing=selectInstance(owner,profile,a);
 if(a.reuse===true&&existing){const target=url(a.url||'about:blank'),prior=[...tabs.values()].find(t=>t.group===existing&&t.wc.getURL()===target);if(prior)return serial(existing.id,async()=>{control.dispatch(existing,'snapshot');activate(prior);prior.group.showReference?.();return {...await snapshot(prior),profile};});}
 if(existing){control.dispatch(existing,'open');if(a.presentation!==undefined)applyPresentation(existing,displayMode);}
 const ses=sessionFor(profile);ses.setUserAgent(fp.user_agent,fp.locale);configureSession(ses);const tab=makeTab(owner,profile,fp,undefined,displayMode,undefined,existing,!!existing);progress('window');
 tab.startPending=!!searchQuery||!!a.url&&a.url!=='about:blank';
 const previous=tab.group.active;
 return serial(tab.group.id,async()=>{
 const operation=beginOperation(tab,{action:'open',url:a.url||'about:blank'});
 try{await tab.group.ready;requireLiveTab(tab);control.assert(tab.group);publish(tab);tab.ready=initialize(tab,true);await tab.ready;progress('navigate');const page=searchQuery?await searchTab(tab,searchQuery):await navigate(tab,a.url||'about:blank');
  if(page.ok===false){closeTab(tab);return page;}
  finishOperation(tab,operation);
  tab.startPending=false;
  if(!tab.group.active||tab.group.active===tab.id||control.actor()==='human'&&tab.group.active===previous)activate(tab);else publish(tab);return {...page,profile,visible:visible(tab.group),presentation:mode(tab.group),bounds:tab.group.embedded?tab.group.container.getBounds():tab.win.getBounds()};
 }catch(e){
  tab.startPending=false;
  finishOperation(tab,operation,e);
  // The user can enter an address as soon as the first shell is visible.
  // Its newer navigation may replace the initial homepage load. The tab was
  // opened, but that cancelled load is never recorded as a successful visit.
  if(control.actor()==='human'&&isLiveTab(tab)&&tab.group.control==='human'&&(e.code==='ERR_ABORTED'||e.errno===-3||e.code==='browser_navigation_cancelled'))return {tab_id:tab.id,profile,navigation_cancelled:true};
  if(control.actor()==='human'&&owner==='program/browser'&&isLiveTab(tab)&&tab.initialized&&a.url&&
     (/^ERR_[A-Z_]+$/.test(e.code)||Number.isInteger(e.errno)&&e.errno<0)&&e.code!=='ERR_ABORTED'){
   tab.loadError=String(e.message);activate(tab);publish(tab);
   return {tab_id:tab.id,group_id:tab.group.id,profile,navigation_error:tab.loadError};
  }
  if(tab.group.control!=='human'&&!String(e.message).includes('cancelled'))closeTab(tab);throw e;
 }
 });
}
async function waitFor(tab,a){
 const timeout=a.timeout_ms??8000;if(!Number.isInteger(timeout)||timeout<0||timeout>12000)throw Error('Invalid wait timeout (0..12000)');
 const kinds=['selector','text','url','name'].filter(k=>a[k]!==undefined);if(kinds.length!==1||typeof a[kinds[0]]!=='string'||!a[kinds[0]]||a[kinds[0]].length>1000)throw Error('Provide exactly one wait condition: selector, text, url, or name (with optional role)');
 if(a.state!==undefined&&!['visible','hidden'].includes(a.state))throw Error('Wait state must be visible or hidden');const until=Date.now()+timeout;
 do{if(tab.dialog)return {tab_id:tab.id,dialog:tab.dialog,next:'handle_dialog'};
  const found=a.name?(await snapshot(tab,{...a,limit:1})).total>0:await evalPage(tab,'('+semantics.condition.toString()+')('+JSON.stringify(a)+')',a.frame_id);
  if(found!==(a.state==='hidden'))return {condition_met:true,...await snapshot(tab,a)};
  if(Date.now()>=until)break;await pause(150);
 }while(true);return {condition_met:false,wait_timed_out:true,...await snapshot(tab,a)};
}

function get(owner,id){const tab=tabs.get(id);if(!tab||tab.owner!==owner||tab.win.isDestroyed())throw Error('Unknown tab for this session');return tab;}
// 把子frame内坐标转换成主视口坐标，同时核对每层frame是否被遮挡。
async function rootPoint(tab,ctx,point){
 let f=ctx,p={...point};while(f.parent_frame_id){
  const parent=ctx.all.get(f.parent_frame_id);if(!parent)throw Error('Frame ancestry unavailable; snapshot again');
  const owner=await cdp(tab,'DOM.getFrameOwner',{frameId:f.frame_id},parent.sessionId);
  const obj=await cdp(tab,'DOM.resolveNode',{backendNodeId:owner.backendNodeId},parent.sessionId);
  try{const result=await cdp(tab,'Runtime.callFunctionOn',{objectId:obj.object.objectId,functionDeclaration:'function(){this.scrollIntoView({block:"center",inline:"center"});const b=this.getBoundingClientRect(),h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {x:b.x+this.clientLeft,y:b.y+this.clientTop,width:this.clientWidth,height:this.clientHeight,scaleX:b.width/this.offsetWidth,scaleY:b.height/this.offsetHeight,visible:h===this};}',returnByValue:true},parent.sessionId);const b=result.result.value;
   if(!b?.visible||Math.abs(b.scaleX-1)>.01||Math.abs(b.scaleY-1)>.01)throw Error('Frame obscured or transformed; inspect before retrying');
   if(p.x<0||p.y<0||p.x>b.width||p.y>b.height)throw Error('Target outside frame viewport');p={x:p.x+b.x,y:p.y+b.y};
  }finally{await cdp(tab,'Runtime.releaseObject',{objectId:obj.object.objectId},parent.sessionId).catch(()=>{});}f=parent;
 }return p;
}
async function upload(tab,a,ctx,object){
 if(!Array.isArray(a.files)||a.files.length>16||!a.files.every(f=>typeof f==='string'&&path.isAbsolute(f)))throw Error('upload requires files: absolute local paths (maximum 16); [] clears the selection');
 const files=a.files.map(f=>{const p=fs.realpathSync(f),s=fs.statSync(p);if(!s.isFile()||s.size>64*1024*1024)throw Error('Upload requires regular files up to 64 MiB each');return p;});
 const meta=await cdp(tab,'Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return {type:this.type,multiple:this.multiple,directory:this.webkitdirectory};}',returnByValue:true},ctx.sessionId);
 if(meta.result.value.type!=='file'||meta.result.value.directory)throw Error('upload requires a non-directory file input');if(files.length>1&&!meta.result.value.multiple)throw Error('File input does not allow multiple files');
 await cdp(tab,'DOM.setFileInputFiles',{files,objectId:object.objectId},ctx.sessionId);tab.upload={state:'selected',count:files.length};publish(tab);
}
function searchTab(tab,query,engine='auto'){
 return require('./browser-preferences.cjs').searchEngines(query,engine,(target,timeout)=>navigate(tab,target,{},timeout),selector=>waitFor(tab,{selector,timeout_ms:8000}));
}
async function call(owner,a){
 if(!owner)throw Error('Missing session identity');if(a.action==='settings'){const result=a.settings===undefined?preferences.read():preferences.update(a.settings);for(const group of new Set([...tabs.values()].map(t=>t.group))){const tab=tabs.get(group.active);if(tab)publish(tab);}return {settings:result};}if(a.action==='profiles')return {profiles:identities.list()};if(a.action==='profile_create')return {profile:identities.publicProfile(identities.create(a))};if(a.action==='open')return open(owner,a);
 if(a.action==='tabs'){if(a.group_id&&! [...tabs.values()].some(t=>t.owner===owner&&t.group.id===a.group_id))throw Error('Unknown browser instance for this session');return {tabs:[...tabs.values()].filter(t=>t.owner===owner&&(!a.group_id||t.group.id===a.group_id)).map(tabInfo)};}
 if(a.action==='downloads')return {downloads:[...downloads.values()].filter(d=>d.owner===owner).map(downloadInfo)};
 if(a.action==='download_cancel'){const d=downloads.get(a.download_id);if(!d||d.owner!==owner||(a.tab_id&&d.profile!==get(owner,a.tab_id).profile))throw Error('Unknown download for this session');const target=tabs.get(d.tabId);if(target)control.dispatch(target.group,a.action);if(['progressing','interrupted'].includes(d.state)){if(d.item)d.item.cancel();else{d.state='cancelled';d.finished=new Date().toISOString();saveDownloads();}}if(a.tab_id)publish(get(owner,a.tab_id));return {download:downloadInfo(d)};}
 const tab=get(owner,a.tab_id);
 if(a.action==='presentation') {const value=presentation.mode(a.presentation);applyPresentation(tab.group,value);if(!tab.group.embedded&&value==='display'&&tab.group.control==='human')setControl(tab.group,false);publish(tab);return {tab_id:tab.id,presentation:mode(tab.group),visible:visible(tab.group)};}
 control.dispatch(tab.group,a.action);
 if(a.action==='close'){closeTab(tab);return {closed:true};}
 // Handback/stop still require a fresh observation. Recreate only the renderer
 // when needed for that observation; the saved page waits for an explicit load.
 const observeRecovery=tab.group.needsSnapshot&&['snapshot','find'].includes(a.action);
 try{await tab.ready;}catch(e){if(!['navigate','reload'].includes(a.action)&&!observeRecovery)throw e;tab.initializationError=e.message;}
 control.assert(tab.group);
 if(tab.crashed){
  if(!['navigate','reload'].includes(a.action)&&!observeRecovery)throw Error(tab.initializationError+'; reload or navigate to recover');
  const epoch=tab.crashEpoch||0;tab.ready=initialize(tab,!observeRecovery||tab.bootstrapRequired);try{await tab.ready;requireRenderer(tab,epoch);}catch(e){tab.ready=Promise.resolve();throw e;}tab.crashed=false;tab.initializationError=null;
 }
 await tab.viewportReady;control.assert(tab.group);if(tab.initializationError){if(a.action==='navigate'||a.action==='reload'){if(!tab.wc.debugger.isAttached()||!tab.initialized)await initialize(tab,false);tab.initializationError=null;}else throw Error(tab.initializationError);}
 if(a.action==='activate'){activate(tab);return tab.dialog?{tab_id:tab.id,dialog:tab.dialog,next:'handle_dialog'}:snapshot(tab,a);}
 if(a.action==='handle_dialog'){
  if(!tab.dialog)throw Error('No pending page dialog');const epoch=tab.crashEpoch||0;
  if(tab.promptReply){const respond=tab.promptReply;tab.promptReply=null;respond(a.accept===true?String(a.prompt_text||''):null);}else await cdp(tab,'Page.handleJavaScriptDialog',{accept:a.accept===true,promptText:String(a.prompt_text||'')},tab.dialog.sessionId);
  tab.dialog=null;publish(tab);const result=await snapshot(tab,a);requireRenderer(tab,epoch);control.assert(tab.group);
  if(tab.recoverURL&&result.url&&result.url!=='about:blank'&&!tab.dialog)tab.recoverURL=null;return result;
 }
 if(tab.dialog)return {tab_id:tab.id,dialog:tab.dialog,next:'handle_dialog before further page interaction'};
 if(a.action==='clear_site_data'){
  const address=new URL(tab.wc.getURL());
  if(!['https:','http:'].includes(address.protocol)||a.origin!==address.origin||
     !preferences.cookiePolicy(tab.profile).available||a.profile!==undefined&&a.profile!==tab.profile)
   throw Error('当前网站或浏览身份已变化');
  const types=a.data_types??['cookies','cache'];
  if(!Array.isArray(types)||!types.length||types.length>2||types.some(type=>!['cookies','cache'].includes(type)))
   throw Error('仅支持清理网站 Cookie 和 HTTP 缓存');
  const dataTypes=[...new Set(types)];
  await tab.wc.session.clearData({origins:[address.origin],dataTypes,originMatchingMode:'origin-in-all-contexts'});
  if(dataTypes.includes('cookies'))await tab.wc.session.cookies.flushStore();
  return {tab_id:tab.id,profile:tab.profile,origin:address.origin,cleared:dataTypes};
 }
 if(a.action==='reload'){if(tab.recoverURL)return navigate(tab,tab.recoverURL);tab.error='';tab.loadError='';tab.revision=null;tab.wc.reload();publish(tab);return {tab_id:tab.id,next:'wait_for or snapshot after load'};}
 if(a.action==='stop'){stopLoading(tab);publish(tab);return {tab_id:tab.id,stopped:true,next:'snapshot before further page actions'};}
 if(a.action==='navigate'){const target=url(a.url);if(onInteract(tab.group))activate(tab);return navigate(tab,target);}
 if(a.action==='search'){
  return searchTab(tab,a.query,a.engine??'auto');
 }
 if(a.action==='back'||a.action==='forward'){tab.error='';tab.loadError='';tab.revision=null;const h=tab.wc.navigationHistory;if(a.action==='back'&&h.canGoBack())h.goBack();else if(a.action==='forward'&&h.canGoForward())h.goForward();else throw Error('No history entry');await pause(250);return snapshot(tab);}
 if(a.action==='snapshot'||a.action==='find')return snapshot(tab,a);if(a.action==='wait_for')return waitFor(tab,a);
 if(a.action==='screenshot'){let image,lastError;for(let attempt=0;attempt<10;attempt++){try{image=await tab.wc.capturePage(undefined,{stayHidden:true,stayAwake:true});if(!image.isEmpty())break;}catch(e){lastError=e;}await pause(100);}if(!image||image.isEmpty())throw Error((lastError?.message||'Page capture unavailable')+'; visible='+tab.visible+'; minimized='+tab.win.isMinimized()+'; bounds='+JSON.stringify(tab.view.getBounds())+'; page_error='+(tab.error||'none'));const folder=path.join(storage,'captures');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,newId()+'.png');fs.writeFileSync(file,image.toPNG());return {path:file,...image.getSize(),tab_id:tab.id,window_pid:process.pid};}
 if(a.action==='evaluate') {if(typeof a.script!=='string'||a.script.length>20000)throw Error('Invalid page script');return {value:await evalPage(tab,a.script,a.frame_id),content_trust:'untrusted_page_data'};}
 if(!a.revision||a.revision!==tab.revision||(a.frame_id&&a.frame_id!==tab.snapshotFrame))throw Error('stale_snapshot: use the latest result revision and frame_id; perform dependent actions sequentially.');
 if(!['click','fill','select','upload','key','scroll','hover'].includes(a.action))throw Error('Unknown action');
 if(a.action==='click'&&onInteract(tab.group))activate(tab);
 if(a.action==='select'&&typeof a.value!=='string'&&!(Array.isArray(a.value)&&a.value.every(v=>typeof v==='string')))throw Error('select requires value:string or value:string[] for a multiple select; use elements[].options[].value');
 if(a.action==='fill'&&(typeof a.value!=='string'||a.value.length>20000))throw Error('fill requires arguments.value as text (maximum 20000 characters)');
 const ctx=await frameContext(tab,a.frame_id||tab.snapshotFrame);let inputSensitive=true;
 if(a.action==='scroll'){
  const dx=a.delta_x??0,dy=a.delta_y??0;if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>10000||Math.abs(dy)>10000)throw Error('Invalid scroll delta');
  const id=a.element_id;if(id!==undefined&&!/^\d+$/.test(String(id)))throw Error('Invalid scroll element_id');
  await evalContext(tab,`(()=>{const target=${id===undefined?'window':'globalThis.__aieyraValidate('+Number(id)+','+JSON.stringify(a.revision)+')'};target.scrollBy({left:${dx},top:${dy},behavior:'instant'});return true;})()`,ctx);
 }else if(a.action==='key'){
  const spec=navigation.keySpec(a.key);await evalContext(tab,'window.focus();true',ctx);await cdp(tab,'Input.dispatchKeyEvent',{type:'keyDown',...spec});if(!(spec.modifiers&7)&&(spec.key.length===1||spec.key==='Enter'))await cdp(tab,'Input.dispatchKeyEvent',{type:'char',text:spec.key==='Enter'?'\r':spec.key,...spec});await cdp(tab,'Input.dispatchKeyEvent',{type:'keyUp',...spec});
 }else{
  if(!/^\d+$/.test(String(a.element_id)))throw Error('element_id required');const args={id:Number(a.element_id),revision:a.revision,action:a.action,value:a.value};
  const pos=await evalContext(tab,`(()=>{const a=${JSON.stringify(args)};if(globalThis.__aieyraRevision!==a.revision)throw Error('stale_snapshot');const e=globalThis.__aieyraValidate(a.id,a.revision);e.scrollIntoView({block:'center',inline:'center'});const b=e.getBoundingClientRect();if(!b.width||!b.height||getComputedStyle(e).visibility==='hidden')throw Error('Element hidden');if(!globalThis.__aieyraHit(e,b.x+b.width/2,b.y+b.height/2))throw Error('Element obscured; inspect page before retrying');if(a.action==='click'&&e.type==='file')throw Error('Use upload with explicit files instead of opening a system picker');if(a.action==='fill'){if(e.readOnly)throw Error('Input is read only');if(e.tagName==='INPUT'&&['date','time','datetime-local','month','week','color','range'].includes(e.type)){const old=e.value;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,a.value);if(e.value!==a.value){e.value=old;throw Error('Invalid value for input type '+e.type);}e.dispatchEvent(new Event('input',{bubbles:true,composed:true}));e.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return {structured:true,sensitive:false,x:b.x+b.width/2,y:b.y+b.height/2};}if((!['INPUT','TEXTAREA'].includes(e.tagName)&&!e.isContentEditable)||e.tagName==='INPUT'&&!['text','search','email','url','tel','password','number'].includes(e.type))throw Error('Not a supported text input');e.focus();if(e.isContentEditable){const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);}else e.select();}if(a.action==='select'){const values=Array.isArray(a.value)?a.value:[a.value];if(e.tagName!=='SELECT'||!e.multiple&&values.length!==1||values.some(v=>![...e.options].some(o=>o.value===v&&!o.disabled&&!o.closest('optgroup[disabled]'))))throw Error('Invalid or disabled option');for(const o of e.options)o.selected=values.includes(o.value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}return {x:b.x+b.width/2,y:b.y+b.height/2,sensitive:e.type==='password'||/password|one-time-code/.test(e.autocomplete||'')||/(?:^|[_-])(token|secret|api[_-]?key|credential)(?:$|[_-])/i.test(e.name||e.id||'')};})()`,ctx);
  inputSensitive=pos.sensitive!==false;
  if(a.action==='click'){await rootPoint(tab,ctx,pos);await evalContext(tab,'new Promise(resolve=>{const timer=setTimeout(()=>resolve(true),120);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve(true)}));})',ctx);const stable=await evalContext(tab,`(()=>{const e=globalThis.__aieyraValidate(${Number(a.element_id)},${JSON.stringify(a.revision)}),b=e.getBoundingClientRect();if(!b.width||!b.height||getComputedStyle(e).visibility==='hidden'||!globalThis.__aieyraHit(e,b.x+b.width/2,b.y+b.height/2))throw Error('Target moved or obscured; observe again');return {x:b.x+b.width/2,y:b.y+b.height/2};})()`,ctx);const point=await rootPoint(tab,ctx,stable);await cdp(tab,'Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp(tab,'Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp(tab,'Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
  else if(a.action==='hover'){const point=await rootPoint(tab,ctx,pos);await cdp(tab,'Input.dispatchMouseEvent',{type:'mouseMoved',...point});}
  else if(a.action==='fill'&&!pos.structured)await cdp(tab,'Input.insertText',{text:a.value});
  else if(a.action==='upload'){const obj=await evalContext(tab,`globalThis.__aieyraElements[${Number(a.element_id)}]`,ctx,false);try{await upload(tab,a,ctx,obj);}finally{await cdp(tab,'Runtime.releaseObject',{objectId:obj.objectId},ctx.sessionId).catch(()=>{});}}
 }
 tab.revision=null;await pause(180);if(tab.dialog)return {tab_id:tab.id,dialog:tab.dialog,next:'handle_dialog'};
 // 主frame跨导航后旧ID可能消失；子frame消失明确要求重新检查，而不误投主页面。
 const result=await snapshot(tab,{frame_id:ctx.parent_frame_id?ctx.frame_id:undefined});
 return a.action==='fill'?{...result,input_sensitive:inputSensitive,...(!inputSensitive?{input_value:a.value}:{})}:result;
}
function clearPasswordCandidate(tab){
 clearTimeout(tab.passwordCandidate?.timer);
 tab.passwordCandidate=null;
}
function passwordTab(event){
 const tab=[...tabs.values()].find(t=>t.wc===event.sender);
 if(!isLiveTab(tab)||event.senderFrame!==tab.wc.mainFrame||tab.group.active!==tab.id||
    tab.group.control!=='human'||tab.busy||tab.agentInputDepth||
    mode(tab.group)!=='interactive'||!visible(tab.group))return null;
 return tab;
}
listen('agent-browser:password-candidate',(event,value)=>{
 event.returnValue=null;
 const tab=passwordTab(event);
 if(!tab||typeof value?.username!=='string'||value.username.length>320||
    typeof value.action!=='string'||value.action.length>4096||
    typeof value.password!=='string'||!value.password||value.password.length>4096)return;
 const state=passwords.status(tab.profile,event.senderFrame.url);
 if(!state.available||!state.save||!state.origin||credentialOrigin(value.action)!==state.origin)return;
 clearPasswordCandidate(tab);
 tab.passwordCandidate={origin:state.origin,action:value.action,credentials:{username:value.username,password:value.password},
  started:false,committed:false,startBy:Date.now()+1000,timer:setTimeout(()=>clearPasswordCandidate(tab),15000)};
});
listen('agent-browser:password-page',event=>{
 const tab=passwordTab(event),candidate=tab?.passwordCandidate;
 if(!candidate?.committed||credentialOrigin(event.senderFrame.url)!==candidate.origin)return;
 clearPasswordCandidate(tab);
 try{if(passwords.save(tab.profile,candidate.origin,candidate.credentials))publish(tab);}
 catch{publish(tab,language==='en-US'?'Could not save the website password':'无法保存网站密码');}
});
listen('agent-browser:password-fill-complete',(event,value)=>{
 const tab=passwordTab(event), pending=tab?.passwordFill;
 if(pending&&pending.id===value?.id&&pending.frame===event.senderFrame)pending.finish(value.submitted===true);
});
listen('agent-browser:page-prompt',(event,value)=>{
 const tab=[...tabs.values()].find(t=>t.wc===event.sender);
 if(!tab||!event.senderFrame||tab.promptReply||tab.dialog||typeof value?.message!=='string'||typeof value?.defaultPrompt!=='string'){event.returnValue=null;return;}
 let finished=false;const timer=setTimeout(()=>{if(tab.promptReply){tab.promptReply(null);tab.promptReply=null;tab.dialog=null;publish(tab);}},120000);
 tab.promptReply=result=>{if(finished)return;finished=true;clearTimeout(timer);event.returnValue=result;};
 tab.dialog={type:'prompt',message:value.message.slice(0,8000),defaultPrompt:value.defaultPrompt.slice(0,4000)};
 // 同步网页被暂停时CDP没有原生事件，用相同内部信号解除当前工具等待。
 tab.wc.debugger.emit('message',{},'Page.javascriptDialogOpening',tab.dialog);
 publish(tab);
});
function externalGuide(group,action){
 const alive=()=>!closed&&!group.win.isDestroyed()&&[...tabs.values()].some(t=>t.group===group);
 const scope=()=>({group_id:group.id,profile:group.profile,control:group.control,tabs:[...tabs.values()].filter(t=>t.group===group&&!t.wc.isDestroyed()).map(tabInfo)});
 const reply=value=>{if(alive()&&!group.shell.isDestroyed())group.shell.send('agent-browser:access',value);};
 if(action==='access_revoke'){group.externalAccess?.close();group.externalAccess=null;reply({protocol:'aieyra-browser/1',enabled:false,scope:scope()});return;}
 if(action!=='access_enable'){reply(group.externalAccess?.guide()||{protocol:'aieyra-browser/1',enabled:false,scope:scope()});return;}
 if(!group.externalAccess||!group.externalAccess.summary().enabled&&!group.externalAccess.summary().starting){
  group.externalAccess?.close();
  group.externalAccess=require('./browser-external-access.cjs').createBrowserExternalAccess({alive,describe:scope,
   onChange:()=>reply(group.externalAccess?.guide()||{enabled:false,scope:scope()}),
   execute:(args,signal)=>{
    if(!alive())throw Error('Browser group closed');
    const tabId=args.tab_id||group.active;
    if(args.action!=='tabs'&&tabs.get(tabId)?.group!==group)throw Error('Unknown tab for this access');
    const arguments_={...args,...(args.action==='tabs'?{}:{tab_id:tabId}),...(args.action==='open'?{profile:group.profile,group_id:group.id}:{})};
    return execute(group.owner,arguments_,signal).then(result=>{
     const scoped={...result};
     if(Array.isArray(scoped.tabs))scoped.tabs=scoped.tabs.filter(t=>t.group_id===group.id);
     if(Array.isArray(scoped.downloads))scoped.downloads=scoped.downloads.filter(d=>tabs.get(d.tab_id)?.group===group);
     return scoped;
    });
   }});
 }
 const access=group.externalAccess;
 void access.start().then(value=>{if(group.externalAccess===access)reply(value);}).catch(error=>reply({enabled:false,error:error.message,scope:scope()}));
}
listen('agent-browser:command',(event,a)=>{
 const source=[...tabs.values()].find(t=>t.group.shell===event.sender);if(!source||!shellSource(event,source.group)||source.group.embedded&&!visible(source.group)||!['settings','clear_browsing_data','password_use','password_clear','proxy_test','proxy_exit','proxy_reputation','profile_update','takeover','release','navigate','search','back','forward','reload','handle_dialog','activate','close','download_cancel','download_reveal','new_tab','new_instance','bookmark_toggle','bookmark_remove','permission_response','placement','stop','dismiss_error','find_in_page','stop_find','profile_select','profile_create','eyra','access_guide','access_enable','access_revoke'].includes(a?.action))return;
 const tab=tabs.get(source.group.active);if(!tab)return;
 if(['access_guide','access_enable','access_revoke'].includes(a.action)){externalGuide(source.group,a.action);return;}
 if(mode(tab.group)!=='interactive')return;
 if(['proxy_test','proxy_exit','proxy_reputation'].includes(a.action)){
  if(tab.group.proxyTest?.state==='pending')return;
  const readIP=a.action==='proxy_exit',readDrop=a.action==='proxy_reputation',network=tab.wc.session,group=tab.group;
  const knownIP=readDrop&&group.proxyTest?.profile===tab.profile?group.proxyTest.ip:null;
  if(readDrop&&!isIP(knownIP||''))return;
  const wording=(zh,en)=>language==='en-US'?en:zh;
  const result={profile:tab.profile,state:'pending',ip:knownIP,message:readDrop?wording('正在查询出口路由名单','Checking the exit route list'):
   readIP?wording('正在查询出口 IP','Checking exit IP'):wording('正在测试代理','Testing proxy')};
  group.proxyTest=result;publish(tab);
  const report=(state,message)=>{
   const active=tabs.get(group.active);
   if(isLiveTab(active)&&group.proxyTest===result){Object.assign(result,{state,message});publish(active);}
  };
  void serial('proxy:'+tab.profile,async()=>{
   if(!isLiveTab(tabs.get(group.active))||group.proxyTest!==result)return;
   const profile=identities.read(tab.profile),proxy=profile?.proxy;
   if(!proxy||tab.profile==='aieyra-account'||!electron.net?.request||!network.resolveProxy){
    report('failed',wording('此身份没有可测试的自定义代理','This profile has no custom proxy'));return;
   }
   const homepage=preferences.read().homepage;
   const target=readDrop?dropListURL(knownIP):readIP?'https://api64.ipify.org/?format=json':
    (/^https?:\/\//i.test(homepage)?homepage:'https://www.baidu.com/');
   const expected=new URL(socksProxies.get(tab.profile)?.bridge.rules||proxy);
   const port=expected.port||({ 'http:':'80','https:':'443' })[expected.protocol];
   const route=String(await network.resolveProxy(target)).trim().toLowerCase();
   if(route.includes(';')||!route.endsWith(' '+expected.hostname.toLowerCase()+':'+port))throw Error('Unexpected proxy route');
   if(readDrop){
    const version=isIP(knownIP);
    let cached=proxyDropLists.get(version);
    if(!cached||Date.now()-cached.retrievedAt>=86400000){
     const {status,body}=await probeProxy(network,target,profile,'drop');
     if(status!==200||!body)throw Error('Could not load the exit route list');
     cached={list:readDropList(body,version),retrievedAt:Date.now()};
     proxyDropLists.set(version,cached);
    }
    const listed=cached.list.has(knownIP),published=cached.list.publishedAt.slice(0,10);
    report('passed',knownIP+' · '+wording(listed?'出口路由名单命中':'出口路由名单未列出',listed?'Listed on the exit route list':'Unlisted on the exit route list')+' · '+published+' · www.spamhaus.org');
    return;
   }
   const {status,ip}=await probeProxy(network,target,profile,readIP?'ip':null);
   if(status<200||status>=300||readIP&&!ip)throw Error('Proxy request failed');
   if(ip)result.ip=ip;
   report('passed',readIP?wording('出口 IP ','Exit IP ')+ip+' · '+new URL(target).hostname:wording('代理连通','Proxy connected')+' · '+new URL(target).hostname);
  }).catch(()=>report('failed',readDrop?wording('查询出口路由名单失败','Could not check the exit route list'):
   readIP?wording('查询出口 IP 失败','Could not check the proxy exit IP'):wording('代理测试失败，请检查地址、认证和连接','Proxy test failed. Check the address, credentials, and connection.')));
  return;
 }
 if(a.action==='settings'){
  if(a.clear_cookies&&a.profile&&a.profile!==tab.profile)return;
  void applySettings(tab,a).catch(e=>publish(tab,e.message));
  return;
 }
 if(a.action==='eyra'){tab.group.openEyra?.();return;}
 if(a.action==='dismiss_error'){tab.error='';publish(tab);return;}
 if(a.action==='stop'){if(tab.group.control!=='human')setControl(tab.group,true);stopLoading(tab);publish(tab);return;}
 if(a.action==='find_in_page'){if(typeof a.query==='string'&&a.query.trim()&&a.query.length<=1000){if(tab.group.control!=='human')setControl(tab.group,true);tab.find={query:a.query,matches:0,active:0};tab.wc.findInPage(a.query,{forward:a.forward!==false,findNext:a.next!==true});publish(tab);}return;}
 if(a.action==='stop_find'){tab.wc.stopFindInPage('clearSelection');tab.find=null;publish(tab);return;}
 if(a.action==='placement'){try{tab.group.place?.(!tab.group.detached);publish(tab);}catch(e){publish(tab,e.message);}return;}
 if(a.action==='takeover'||a.action==='release'){setControl(tab.group,a.action==='takeover');return;}
 if(a.tab_id&&tabs.get(a.tab_id)?.group!==tab.group)return;
 if(a.action==='permission_response'){if(tab.permission?.id===a.request_id)finishPermission(tab,a.accept===true);return;}
 if(a.action==='handle_dialog'&&tab.promptReply){
  // 页面正同步等待prompt结果，先释放它，随后才能发送接管用的CDP命令。
  const respond=tab.promptReply;tab.promptReply=null;tab.dialog=null;respond(a.accept===true?String(a.prompt_text||''):null);setControl(tab.group,true);publish(tab);return;
 }
 setControl(tab.group,true);
 const group=tab.group;group.humanPending=(group.humanPending||0)+1;group.humanQueue=(group.humanQueue||Promise.resolve()).then(()=>control.run({actor:'human'},async()=>{let operation;try{
  if(!isLiveTab(tab))return;
  await group.controlReady;
  if(!isLiveTab(tab))return;
  if(a.action==='clear_browsing_data'){
   if(a.profile!==tab.profile||!preferences.cookiePolicy(tab.profile).available)throw Error('浏览身份已变化');
   await clearCookies(tab.wc.session);await tab.wc.session.clearCache();
   group.cookieCleared=tab.profile;publish(tab,language==='en-US'?'Cookies and cache cleared':'Cookie 和缓存已清理');return;
  }
  if(a.action==='password_clear'){
   if(tab.id!==group.active||a.profile!==tab.profile||!passwords.status(tab.profile,tab.wc.getURL()).origins?.includes(a.origin))return;
   passwords.clear(tab.profile,a.origin);publish(tab);return;
  }
  if(a.action==='password_use'){
   const frame=tab.wc.mainFrame,origin=credentialOrigin(frame.url);
   if(!origin||a.origin!==origin||tab.id!==group.active||a.profile!==tab.profile){
    publish(tab,language==='en-US'?'The active login page has changed':'当前登录页面已变化');return;
   }
   const credential=passwords.get(tab.profile,origin);
   if(!credential){publish(tab,language==='en-US'?'Could not read the saved password':'无法读取已保存的密码');return;}
   const submitted=await new Promise(resolve=>{
    const id=newId(),finish=result=>{clearTimeout(timer);tab.passwordFill=null;resolve(result);};
    const timer=setTimeout(()=>finish(false),1000);
    tab.passwordFill={id,frame,finish};
    try{frame.send('agent-browser:password-fill',{id,origin,...credential});}catch{finish(false);}
   });
   if(!submitted&&isLiveTab(tab))publish(tab,language==='en-US'?'No supported sign-in form is available':'当前页面没有可用的登录表单');
   return;
  }
  if(a.action==='profile_update'){
   if(a.profile!==tab.profile)throw Error('当前浏览身份已切换');
   identities.update(tab.profile,a);
   const targets=[...tabs.values()].filter(t=>t.profile===tab.profile);
   for(const target of targets)target.group.proxyTest=null;
   for(const target of new Map(targets.map(t=>[t.wc.session,t])).values())await configureProxy(target,true);
   for(const target of targets)if(target.group.active===target.id)publish(target);
   return;
  }
  if(a.action==='bookmark_toggle'||a.action==='bookmark_remove'){if(!bookmarks)throw Error(bookmarkError);if(a.action==='bookmark_toggle')bookmarks.toggle(tab.profile,tab.wc.getURL(),tab.wc.getTitle());else bookmarks.remove(tab.profile,a.bookmark_id);publish(tab);return;}
  if(a.action==='download_reveal'){const d=downloads.get(a.download_id);if(!d||d.owner!==tab.owner||d.profile!==tab.profile||d.state!=='completed'||!fs.existsSync(d.path))throw Error('Downloaded file is unavailable');shell.showItemInFolder(d.path);return;}
  if(a.action==='profile_select'||a.action==='profile_create'){
   const identity=a.action==='profile_create'?identities.create(a):identities.ensure({profile:a.profile});
   let target=[...tabs.values()].find(t=>t.owner===tab.owner&&t.profile===identity.id);
   if(target){target=tabs.get(target.group.active)||target;await setControl(target.group,true);if(!isLiveTab(tab)||!isLiveTab(target))return;activate(target);}
   else {const result=await user(tab.owner,{action:'open',profile:identity.id});target=tabs.get(result.tab_id);}
   if(target&&isLiveTab(tab)&&isLiveTab(target)){group.selectGroup?.(target.group);publish(target);}return;
  }
  if(a.action==='new_instance'){const result=await user(tab.owner,{action:'open',profile:tab.profile,new_instance:true});const child=tabs.get(result.tab_id);if(child){group.selectGroup?.(child.group);publish(child);}return;}
  if(a.action==='close'){
   const target=get(tab.owner,a.tab_id||tab.id);
   if(target.group!==group)return;
   if(tab.owner==='program/browser'&&![...tabs.values()].some(t=>t.group===group&&t!==target)){
    control.dispatch(group,'close');
    const replacement=makeTab(target.owner,target.profile,target.fp,undefined,mode(group),undefined,group,true);
    replacement.startPending=true;closeTab(target);
    try{replacement.ready=initialize(replacement,true);await replacement.ready;await navigate(replacement,DEFAULT_SITE);}
    catch(error){if(isLiveTab(replacement))publish(replacement,error.message);}
    finally{if(isLiveTab(replacement)){replacement.startPending=false;publish(replacement);}}
    return;
   }
  }
  if(a.action==='new_tab'){
   const destination=DEFAULT_SITE;
   const child=makeTab(tab.owner,tab.profile,tab.fp,undefined,mode(tab.group),undefined,tab.group,true);
   try{child.ready=initialize(child,true);await child.ready;if(!isLiveTab(child))return;
    await navigate(child,destination);
   }finally{if(isLiveTab(child)&&group.active===tab.id)activate(child);}
   return;
  }
  operation=beginOperation(tab,a,'human');const result=await call(tab.owner,{...a,tab_id:a.tab_id||tab.id});finishOperation(tab,operation);
  if(a.action==='search'&&result.ok===false)publish(tab,language==='en-US'?'Search engines could not be reached':'无法连接所用搜索引擎');
 }catch(e){
  finishOperation(tab,operation,e);
  // Chromium also rejects loadURL when navigation is stopped or replaced.
  // Match did-fail-load: keep the failed operation, without a stale error banner.
  publish(tab,e.code==='ERR_ABORTED'||e.errno===-3||e.code==='browser_navigation_cancelled'||e.code==='browser_operation_cancelled'?'':e.message);
 }finally{group.humanPending--;if(!group.humanPending&&group.releasePending&&isLiveTab(tab))setControl(group,false);}}));
});
listen('agent-browser:takeover',event=>{const tab=[...tabs.values()].find(t=>t.group.guard?.webContents===event.sender);if(tab&&mode(tab.group)==='interactive'&&(!tab.group.embedded||visible(tab.group))&&event.senderFrame===event.sender.mainFrame)setControl(tab.group,true);});
listen('agent-browser:layout',(event,value)=>{const source=[...tabs.values()].find(t=>t.group.shell===event.sender);if(!isLiveTab(source)||!shellSource(event,source.group)||!Number.isFinite(value?.top)||!Number.isFinite(value?.bottom))return;const group=source.group,tab=tabs.get(group.active)||source;group.chromeHeight=Math.max(6,Math.min(300,Math.ceil(value.top)));group.shelfHeight=Math.max(0,Math.min(180,Math.ceil(value.bottom)));group.panelWidth=Number.isFinite(value.right)?Math.max(0,Math.min(400,Math.ceil(value.right))):0;const overlay=value.overlay===true,page=value.page===true,changedOverlay=group.panelOverlay!==overlay||group.settingsPage!==page;group.panelOverlay=overlay;group.settingsPage=page;layout(group);group.presence?.refresh();if(changedOverlay)publish(tab);});

function execute(owner,args,signal,onProgress){
 if(closed)return Promise.reject(Error('Browser host closed'));
 if(signal?.aborted)return Promise.reject(Error('Browser operation cancelled before dispatch'));
 if(args?.action==='stop')return control.run(control.lease(tabs.get(args.tab_id)?.group),async()=>{try{const tab=get(owner,args.tab_id);control.assert(tab.group);for(const op of operations.values())if(op.owner===owner&&op.scope.epochs.has(tab.group)){op.cancelled=true;op.scope.cancelled=true;}stopLoading(tab);tab.group.needsSnapshot=true;for(const t of tabs.values())if(t.group===tab.group)t.revision=null;publish(tab);return {ok:true,tab_id:tab.id,stopped:true,next:'snapshot before further page actions'};}catch(e){return {ok:false,error:e.message};}});
 if(operations.size>=16)return Promise.reject(Error('Too many browser requests'));
 const id=newId(),scope=control.lease(tabs.get(args?.tab_id)?.group),op={owner,cancelled:false,scope};operations.set(id,op);
 const abort=()=>{op.cancelled=true;scope.cancelled=true;if(op.dispatched){const tab=tabs.get(args?.tab_id);if(tab?.owner===owner){tab.wc.stop();tab.revision=null;tab.group.needsSnapshot=true;}}};
 signal?.addEventListener('abort',abort,{once:true});
 const run=()=>execution.run({onProgress,op},()=>control.run(scope,async()=>{let tab,operation;
  try{if(closed||op.cancelled)throw Error('Browser operation cancelled before dispatch');op.dispatched=true;progress('received');tab=tabs.get(args?.tab_id);if(tab?.owner===owner){tab.busy=true;operation=beginOperation(tab,args||{});publish(tab);}else tab=null;
   const result=await call(owner,args||{});if(op.cancelled)throw Error('Browser operation cancelled; outcome unknown, inspect before retry');if(tab&&args?.action!=='presentation')control.assert(tab.group);finishOperation(tab,operation);return {ok:true,...result};
  }catch(e){if(op.cancelled)e=Error('operation_cancelled: browser operation interrupted; dispatched effects may have occurred, inspect the preserved page before retrying');finishOperation(tab,operation,e);return {ok:false,error:String(e.message).slice(0,1500)};}
  finally{operations.delete(id);signal?.removeEventListener('abort',abort);if(tab){tab.busy=false;publish(tab);}changed();}
 }));
 const group=args?.action!=='open'&&tabs.get(args?.tab_id)?.group;
 return group?serial(group.id,run):run();
}
async function applySettings(tab,a){
 const result=await serial('settings:'+tab.profile,()=>browserSettings(tab,a));
 tab.error='';for(const group of new Set([...tabs.values()].map(t=>t.group))){const active=tabs.get(group.active);if(active)publish(active);}
 return result;
}
function close(){
 electron.app.removeListener('login',proxyLogin);
 if(closed)return closePromise;closed=true;for(const op of operations.values())op.cancelled=true;
 for(const t of [...tabs.values()])closeTab(t);
 for(const [ses,handler] of configuredSessions){ses.removeListener('will-download',handler);ses.setPermissionCheckHandler(null);ses.setPermissionRequestHandler(null);}configuredSessions.clear();permissionGrants.clear();
 for(const d of downloads.values())if(d.item){detachDownload(d.item);if(['progressing','interrupted'].includes(d.state)){d.item.cancel();d.state='cancelled';d.finished=new Date().toISOString();}d.item=null;}
 for(const [name,fn] of listeners)ipcMain.removeListener(name,fn);
 try{artifactOrigins.close();saveDownloads();}catch(error){releaseStorage();throw error;}
 const pending=[...queues.entries()].filter(([key])=>key.startsWith('settings:')).map(([,task])=>task);
 if(!pending.length){releaseStorage();return;}
 closePromise=Promise.allSettled(pending).finally(releaseStorage);
 return closePromise;
}
async function user(owner,a){
 if(closed)throw Error('Browser host closed');
 if(a?.action==='start_page')return {ok:true,bookmarks:bookmarks?.list('default')||[]};
 if(a?.action==='start_submit'){
  const value=typeof a.value==='string'?a.value.trim():'';
  if(!value||value.length>4096)throw Error('无效的搜索内容或网址');
  const target=navigation.address(value,'auto');
  if(!target&&value.length>2000)throw Error('搜索内容过长');
  return control.run({actor:'human'},async()=>{const result=await open(owner,{url:target||undefined},target?'':value);if(result.ok===false)return result;await setControl(get(owner,result.tab_id).group,true);return {ok:true,...result};});
 }
 if(a?.action==='open'&&a.url===undefined)a={...a,url:DEFAULT_SITE};
 if(!['profiles','profile_create','open','activate','placement','settings'].includes(a?.action))throw Error('Unknown browser user action');
 if(a.action==='settings'){
  const tab=get(owner,a.tab_id);
  if(tab.group.active!==tab.id||mode(tab.group)!=='interactive'||!visible(tab.group))throw Error('Browser settings require the active interactive tab');
  return {ok:true,...await applySettings(tab,a)};
 }
 if(a.action==='placement'){const group=[...tabs.values()].find(t=>t.group.id===a.group_id)?.group;if(!group||!group.place)throw Error('Unknown browser group');group.place(a.detached===true);const tab=tabs.get(group.active);if(tab)publish(tab);return {ok:true,...status()};}
 const work=control.run({actor:'human'},async()=>{const result=await call(owner,a);return {ok:true,...result};});return work;
}
function closeGroup(id){for(const tab of [...tabs.values()])if(tab.group.id===id)closeTab(tab);}
async function resume(owner){for(const group of new Set([...tabs.values()].filter(t=>t.owner===owner).map(t=>t.group)))if(group.control==='human')await setControl(group,false);}
// Only the active surface of the requested group is previewed. Hidden windows
// keep their page; overlays, new tabs and errors belong to the browser shell.
function previewTarget(groupId){
 const group=[...tabs.values()].find(t=>t.group.id===groupId)?.group,tab=tabs.get(group?.active);
 if(closed||!tab||tab.wc.isDestroyed())return null;
 const page=tab.visible===true,contents=page?tab.wc:group.shell;
 if(contents.isDestroyed())return null;
 return {contents,ready:tab.viewportReady,identity:tab.id+':'+(tab.navigationSequence||0)+':'+(page?'page':'shell')};
}
return {execute,status,close,user,closeGroup,revealReference,resume,previewTarget,async openArtifact(owner,file){const source=await artifactOrigins.authorize(file);return user(owner,{action:'open',url:source.url,profile:source.profile,label:source.label,reuse:true});}};
}
module.exports={createBrowserRuntime};
