'use strict';
globalThis.createBrowserPanels=function({command,openFind,layout,paintTabIcon,confirmCookieClear,confirmPasswordClear}){
 const $=id=>document.getElementById(id),panel=$('browser-panel'),content=$('panel-content');
 let state={},current='',signature='',returnFocus,access=null,accessBusy=false,accessTimer,noticeTimer,copyButton,copyState='';
 const icons={settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',bookmark:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',window:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M11 8h5v5m0-5-8 8"/>',plus:'<path d="M12 5v14M5 12h14"/>'};
 const icon=name=>{const el=document.createElementNS('http://www.w3.org/2000/svg','svg');el.setAttribute('viewBox','0 0 24 24');el.setAttribute('aria-hidden','true');el.innerHTML=icons[name]||icons.window;return el;};
 const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const english=()=>state.language==='en-US';
 const text=(zh,en)=>english()?en:zh;
 function item(label,action,kind,shortcut){const b=node('button',undefined,'panel-item');b.type='button';if(kind)b.append(icon(kind));b.append(node('span',label,'item-label'));if(shortcut)b.append(node('span',shortcut,'item-meta'));b.onclick=action;content.append(b);return b;}
 function empty(message,kind){const el=node('div',undefined,'panel-empty');el.append(icon(kind),node('p',message));content.append(el);}
 function close(){if(!current)return;current='';signature='';panel.hidden=true;$('menu-shade').hidden=true;$('panel-backdrop').hidden=true;$('panel-backdrop').removeAttribute('src');document.body.classList.remove('panel-overlay');document.documentElement.style.setProperty('--panel-width','0px');for(const id of ['browser-menu','tab-stack','bookmarks-button'])$(id).setAttribute('aria-expanded','false');layout();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
 function open(name){if(name===current){close();return;}if(!current)returnFocus=document.activeElement;current=name;panel.dataset.kind=name;signature='';$('menu-shade').hidden=false;panel.hidden=false;paint();layout();(name==='tabs'?content.querySelector('[aria-current=true]')||$('panel-close'):$('panel-close')).focus({preventScroll:true});}
 function geometry(){
  const page=false,overlay=!!current;
  if(current==='tabs')panel.style.setProperty('--tab-menu-left',Math.round($('tab-stack').getBoundingClientRect().left)+'px');
  document.body.classList.toggle('panel-overlay',overlay);
  const right=current&&!overlay&&!page?320:0;
  document.documentElement.style.setProperty('--panel-width',right+'px');
  return {right,overlay,page};
 }
 const copyNotice=node('div',undefined,'reference-notice');copyNotice.hidden=true;copyNotice.setAttribute('role','status');document.body.append(copyNotice);
 function notifyCopy(message){clearTimeout(noticeTimer);copyNotice.textContent=message;copyNotice.hidden=false;noticeTimer=setTimeout(()=>copyNotice.hidden=true,4200);}
 function updateCopy(){
  if(!copyButton||current!=='menu')return;
  copyButton.disabled=accessBusy;
  copyButton.setAttribute('aria-busy',String(accessBusy));
  copyButton.setAttribute('data-copied',String(copyState==='copied'));
  copyButton.children[1].textContent=accessBusy?text('正在复制…','Copying…'):copyState==='copied'?text('已复制','Copied'):text('复制使用与接入说明','Copy help and access instructions');
 }
 function finishAccess(){clearTimeout(accessTimer);accessBusy=false;updateCopy();}
 function copyAccess(){
  if(accessBusy)return;accessBusy=true;copyState='';updateCopy();
  accessTimer=setTimeout(()=>{finishAccess();notifyCopy(text('接入说明暂不可用，请重试。','Access instructions are unavailable. Please retry.'));},12000);
  command({action:'access_enable'});
 }
 async function receiveAccess(value){
  access=value;signature='';paint();
  if(!accessBusy||!value?.enabled&&!value?.error)return;
  finishAccess();
  if(value.error||!value.token){notifyCopy(text('接入说明生成失败，请重试。','Could not prepare access instructions. Please retry.'));return;}
  try{await navigator.clipboard.writeText(accessText(value));
   copyState='copied';updateCopy();
   notifyCopy(text('已复制使用与接入说明。','Help and access instructions copied.'));}
  catch{notifyCopy(text('复制失败，请再次点击复制。','Copy failed. Click again to retry.'));}
 }
 function act(a){close();command(a);}
 function paint(){
  if(!current)return;
  const key=JSON.stringify([current,state.language,current==='tabs'?state.tabs?.map(t=>[t.tab_id,t.active,t.title,t.url,t.favicon]):null,current==='profiles'||current==='identity'?state.profiles:null,current==='profiles'?[state.profile,state.proxyTest]:null,current==='downloads'?state.downloads:null,current==='bookmarks'?[state.url,state.bookmarks]:null,current==='passwords'?[state.profile,state.passwords]:null,current==='menu'?[state.detached,state.control,access?.enabled,state.preferences?.homepage,state.passwords]:null]);if(signature===key)return;signature=key;
  const focusedTab=content.contains(document.activeElement)?document.activeElement.dataset.tabId:null;
  const titles={tabs:text('标签页','Tabs'),menu:text('浏览器','Browser'),passwords:text('登录密码','Saved passwords'),downloads:text('下载','Downloads'),bookmarks:text('收藏夹','Bookmarks'),profiles:text('浏览身份','Browser profiles'),identity:text('新建身份','New profile')};$('panel-title').textContent=titles[current];content.replaceChildren();
  for(const [id,name] of [['tab-stack','tabs'],['browser-menu','menu'],['bookmarks-button','bookmarks']])$(id).setAttribute('aria-expanded',String(current===name));
  if(current==='tabs'){
   for(const tab of state.tabs||[]){
    const label=tab.url==='about:blank'?text('正在加载','Loading page'):(tab.title||tab.url);
    const row=item(label,()=>act({action:'activate',tab_id:tab.tab_id}),null,tab.active?'✓':'');
    const glyph=node('span',undefined,'tab-icon panel-tab-icon');glyph.setAttribute('aria-hidden','true');paintTabIcon(glyph,tab);row.prepend(glyph);
    row.dataset.tabId=tab.tab_id;row.setAttribute('aria-current',String(!!tab.active));row.title=tab.url||label;
   }
   if(focusedTab)[...content.children].find(b=>b.dataset.tabId===focusedTab)?.focus({preventScroll:true});
  }else if(current==='menu'){
   item(text('在页面中查找','Find in page'),()=>{close();openFind();},'search','Ctrl F');
   item(text('新开浏览器','New browser window'),()=>act({action:'new_instance'}),'window');
   if(state.passwords?.available&&state.passwords.saved){
    item(text('使用已保存的密码登录','Sign in with saved password'),()=>act({action:'password_use',profile:state.profile,origin:state.passwords.origin})).id='browser-use-password';
   }
   item(text('登录密码','Saved passwords'),()=>open('passwords'),'profile');
   if(state.cookies?.available)item(text('清理 Cookie 和缓存','Clear cookies and cache'),confirmCookieClear,'window');
   item(text('收藏夹','Bookmarks'),()=>open('bookmarks'),'bookmark');item(text('下载','Downloads'),()=>open('downloads'),'download','Ctrl J');content.append(node('div',undefined,'panel-rule'));
   copyButton=item(text('复制使用与接入说明','Copy help and access instructions'),copyAccess,'window');copyButton.id='browser-copy-access';updateCopy();
   if(access?.enabled)item(text('撤销外部接入','Revoke external access'),()=>act({action:'access_revoke'}),'window');
   item(text('浏览身份','Browser profiles'),()=>open('profiles'),'profile');
  }else if(current==='passwords'){
   const origins=state.passwords?.origins||[];
   if(!origins.length)empty(text('暂无已保存的登录密码','No saved passwords'),'profile');
   for(const origin of origins){const line=node('div',undefined,'panel-record');line.append(node('strong',new URL(origin).host));const remove=node('button',text('删除','Delete'),'panel-item');remove.onclick=()=>confirmPasswordClear(origin);line.append(remove);content.append(line);}
  }else if(current==='bookmarks'){
   if(/^https?:\/\//i.test(state.url||'')){
    const saved=(state.bookmarks||[]).some(bookmark=>bookmark.url===state.url);
    item(saved?text('取消收藏此页','Remove current page from bookmarks'):text('收藏此页','Bookmark current page'),()=>command({action:'bookmark_toggle'}),'bookmark');
   }
   if(!state.bookmarks?.length)empty(text('收藏的网页会显示在这里。','Your saved pages will appear here.'),'bookmark');
   for(const b of state.bookmarks||[]){
    const row=node('div',undefined,'bookmark-row');
    const visit=node('button',undefined,'panel-item');visit.type='button';visit.title=b.url;
    visit.append(icon('bookmark'),node('span',b.title||b.url,'item-label'));visit.onclick=()=>act({action:'navigate',url:b.url});
    const remove=node('button',undefined,'icon-button');remove.type='button';remove.setAttribute('aria-label',text('移除收藏','Remove bookmark')+' '+(b.title||b.url));remove.title=text('移除收藏','Remove bookmark');
    remove.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';remove.onclick=()=>command({action:'bookmark_remove',bookmark_id:b.id});
    row.append(visit,remove);content.append(row);
   }
  }else if(current==='downloads'){
   const labels=english()?{completed:'Completed',progressing:'Downloading',cancelled:'Cancelled',interrupted:'Interrupted'}:{completed:'已完成',progressing:'下载中',cancelled:'已取消',interrupted:'已中断'};
   if(!state.downloads?.length)empty(text('下载的文件会显示在这里。','Your downloads will appear here.'),'download');
   for(const d of [...(state.downloads||[])].reverse()){const card=node('div',undefined,'panel-record');card.append(node('strong',d.name),node('p',(labels[d.state]||d.state)+' · '+Math.ceil(d.received_bytes/1024)+' KB'));const actions=node('div',undefined,'record-actions');if(d.state==='completed'){const reveal=node('button',text('在文件夹中显示','Show in folder'));reveal.onclick=()=>command({action:'download_reveal',download_id:d.download_id});actions.append(reveal);}else if(['progressing','interrupted'].includes(d.state)){const cancel=node('button',text('取消下载','Cancel'));cancel.onclick=()=>command({action:'download_cancel',download_id:d.download_id});actions.append(cancel);}card.append(actions);content.append(card);}
  }else if(current==='profiles'){
   content.append(node('p',text('每个身份分别保存 Cookie 和网站数据。','Each profile keeps its own cookies and site data.'),'panel-caption'));
   for(const p of state.profiles||[]){const b=item(p.id==='default'?text('默认身份','Default profile'):p.label||p.id,()=>act({action:'profile_select',profile:p.id}));b.dataset.profile=p.id;b.classList.toggle('selected',state.profile===p.id);b.prepend(node('span',(p.id==='default'?'A':p.label||p.id).slice(0,1).toUpperCase(),'profile-badge'));if(state.profile===p.id)b.append(node('span',text('当前','Current'),'item-meta'));}
   content.append(node('div',undefined,'panel-rule'));item(text('新建身份','New profile'),()=>open('identity'),'plus').id='browser-create';
   const active=state.profiles?.find(p=>p.id===state.profile);
   if(active&&active.id!=='aieyra-account')item(text('编辑当前身份','Edit current profile'),()=>open('edit_identity')).id='browser-edit-identity';
   if(active?.proxy&&active.id!=='aieyra-account'){
    const pending=state.proxyTest?.profile===active.id&&state.proxyTest.state==='pending';
    const testProxy=item(text('测试代理连接','Test proxy connection'),()=>command({action:'proxy_test'}));
    testProxy.id='browser-test-proxy';testProxy.disabled=pending;
    const exitIP=item(text('查询代理出口 IP','Check proxy exit IP'),()=>command({action:'proxy_exit'}));
    exitIP.id='browser-proxy-exit';exitIP.disabled=pending;
    if(state.proxyTest?.profile===active.id&&state.proxyTest.ip){
     const reputation=item(text('查询出口路由名单','Check the exit route list'),()=>command({action:'proxy_reputation'}));
     reputation.id='browser-proxy-reputation';reputation.disabled=pending;
    }
   }
   if(active&&state.proxyTest?.profile===active.id){const result=node('p',state.proxyTest.message);result.id='browser-proxy-result';result.setAttribute('role','status');content.append(result);}
  }else if(current==='identity'||current==='edit_identity'){
   const form=node('form');form.id='identity-form';
   const editing=current==='edit_identity',active=editing?state.profiles?.find(p=>p.id===state.profile):null;
   if(editing)$('panel-title').textContent=text('编辑浏览身份','Edit browser profile');
   const proxyInput=globalThis.aieyraBrowserProxyInput;
   for(const [id,label,value,placeholder] of [['browser-name',text('身份名称','Name'),' ',text('例如：工作、个人','For example: Work, Personal')],['browser-timezone',text('时区','Timezone'),'Asia/Shanghai','Asia/Shanghai']]){const l=node('label',label),input=node('input');input.id=id;input.required=true;input.maxLength=80;input.value=value.trim();input.placeholder=placeholder;l.append(input);form.append(l);}
   const l=node('label',text('语言','Language')),select=node('select');select.id='browser-locale';for(const [value,label] of [['zh-CN','简体中文'],['en-US','English (US)'],['ja-JP','日本語']]){const option=node('option',label);option.value=value;select.append(option);}l.append(select);form.insertBefore(l,form.children[1]);
   function proxyField(parent,label,id,tag='input'){
    const row=node('label',label),control=node(tag);
    control.id=id;control.autocomplete='off';control.spellcheck=false;
    row.append(control);parent.append(row);
    return control;
   }
   const saved=active?.proxy?proxyInput.parse(active.proxy):null;
   const network=node('fieldset',undefined,'identity-network');
   network.append(node('legend',text('代理（可选）','Proxy (optional)')));
   const routing=node('div',undefined,'identity-proxy-routing');
   const protocol=proxyField(routing,text('协议','Protocol'),'browser-proxy-protocol','select');
   for(const id of proxyInput.protocols){const option=node('option',id.toUpperCase());option.value=id;protocol.append(option);}
   const port=proxyField(routing,text('端口','Port'),'browser-proxy-port');
   port.inputMode='numeric';port.maxLength=5;
   network.append(routing);
   const host=proxyField(network,text('主机','Host'),'browser-proxy');
   host.placeholder='proxy.example.com';
   const username=proxyField(network,text('用户名','Username'),'browser-proxy-username');
   const password=proxyField(network,text('密码','Password'),'browser-proxy-password');
   password.type='password';password.autocomplete='new-password';
   if(active?.proxy_authenticated)password.placeholder=text('已保存','Saved');
   const clear=node('input');clear.type='checkbox';
   if(active?.proxy_authenticated){
    const clearLabel=node('label',text('清除已保存认证','Clear saved authentication'),'identity-clear-auth');
    clearLabel.prepend(clear);network.append(clearLabel);
   }
   const importBox=proxyField(network,text('粘贴代理配置','Paste proxy configuration'),'browser-proxy-import','textarea');
   importBox.rows=2;importBox.maxLength=4096;
   importBox.addEventListener('blur',()=>{if(!importBox.value.trim())importBox.removeAttribute('aria-invalid');});
   const imported=node('button',text('预览导入','Preview import'),'panel-item');imported.type='button';imported.id='browser-preview-proxy';
   const notice=node('small');notice.setAttribute('role','status');notice.hidden=true;
   network.append(imported,notice);form.append(network);
   const report=message=>{notice.hidden=!message;notice.textContent=message;};
   const fill=values=>{for(const [name,control] of Object.entries({protocol,host,port,username,password}))control.value=values[name];};
   if(saved)fill(saved);
   imported.onclick=()=>{
    try{
     const values=proxyInput.parse(importBox.value,protocol.value);
     fill(values);clear.checked=false;
     importBox.value='';importBox.removeAttribute('aria-invalid');
     report(text('已填入代理字段','Proxy fields filled'));
    }catch{
     importBox.setAttribute('aria-invalid','true');importBox.focus();
     report(text('无法识别代理配置','Could not read proxy configuration'));
    }
   };
   if(active){form.querySelector('#browser-name').value=active.label;select.value=active.fingerprint.locale;select.disabled=true;const zone=form.querySelector('#browser-timezone');zone.value=active.fingerprint.timezone;zone.disabled=true;}
   const submit=node('button',editing?text('保存','Save'):text('创建并打开','Create and open'),'primary');submit.type='submit';submit.id='browser-save-identity';form.append(submit);
   form.onsubmit=e=>{
    e.preventDefault();if(!form.reportValidity())return;
    if(importBox.value.trim()){
     report(text('请先预览粘贴的配置','Preview the pasted configuration first'));imported.focus();return;
    }
    let proxy;
    try{
     proxy=proxyInput.format({protocol:protocol.value,host:host.value.trim(),port:port.value.trim(),username:username.value,password:password.value});
    }catch{
     report(text('请检查代理主机、端口和凭据','Check the proxy host, port and credentials'));return;
    }
    if(username.value&&protocol.value==='socks4'){
     report(text('请为用户名和密码认证选择 SOCKS5','Choose SOCKS5 for username and password authentication'));return;
    }
    if(username.value&&protocol.value==='socks5'){
     const bytes=new TextEncoder();
     if(!password.value||bytes.encode(username.value).length>255||bytes.encode(password.value).length>255){
      report(text('SOCKS5 用户名和密码各须为 1–255 字节','SOCKS5 usernames and passwords must each be 1–255 bytes'));return;
     }
    }
    const value={label:$('browser-name').value.trim(),proxy};
    if(editing)act({action:'profile_update',profile:active.id,clear_proxy_auth:clear.checked,...value});
    else act({action:'profile_create',locale:select.value,timezone:$('browser-timezone').value.trim(),...value});
   };content.append(form);
  }
 }
 function accessText(value){
  const base=value.base_url+'/api/browser/v1',tab=value.scope?.tabs?.find(t=>t.active)?.tab_id||value.scope?.tabs?.[0]?.tab_id||'';
  const shellQuote=source=>"'"+source.replaceAll("'","'\\''")+"'";
  const powershell='$h = @{ Authorization = "Bearer '+value.token+'" }; $requestId = [guid]::NewGuid().ToString(); $body = @{request_id=$requestId; arguments=@{action="snapshot";tab_id="'+tab+'"}} | ConvertTo-Json -Depth 6; Invoke-RestMethod -Method Post -Uri "'+base+'/execute" -Headers $h -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 12';
  const wsl=value.wsl_client?['','WSL 无需 localhost 镜像，可用本机 Windows PowerShell 发起同一接口调用：',shellQuote(value.wsl_client)+' -NoProfile -NonInteractive -Command '+shellQuote(powershell),'保存回执中的 request_id；结果未知时，用相同 Authorization 查询 /requests/<request_id>。']:[];
  return ['Aieyra Browser · aieyra-browser/1','接入用户当前浏览器，沿用现有标签与登录状态。先读取 /status，再观察页面并完成用户任务。','有效期至 '+value.expires_at,'API: '+base,'Authorization: Bearer '+value.token,'导航栏左侧是标签页，右侧是地址输入；更多标签点击左侧堆叠按钮展开。Ctrl+L 输入网址，Ctrl+T 新建标签，Ctrl+Tab 切换。','若返回 human_control，请等待当前人工输入完成；授权范围和有效期以 /status 为准。用户可在菜单撤销接入。','','最小 Python 接入（在浏览器所在系统的 Python 运行，标准库）：','import json, uuid, urllib.request',`base = ${JSON.stringify(base)}`,`headers = {"Authorization": "Bearer ${value.token}", "Content-Type": "application/json"}`,'def call(path, body=None):','    data = None if body is None else json.dumps(body).encode("utf-8")','    req = urllib.request.Request(base + path, data=data, headers=headers)','    with urllib.request.urlopen(req, timeout=100) as response:','        return json.load(response)','print(call("/status"))','request_id = str(uuid.uuid4())',`print(call("/execute", {"request_id": request_id, "arguments": {"action": "snapshot", "tab_id": ${JSON.stringify(tab)}}}))`,'# 连接中断或返回 running：按原编号查询，切勿换编号重投。','print(call("/requests/" + request_id))',...wsl,'','POST /execute: {request_id, arguments:{action, tab_id?, ...}}','GET /status: 当前授权标签组；GET /requests/<request_id>: 原操作回执。','同一编号与相同参数只执行一次；编号参数冲突返回 409。每次授权最多保留 64 次操作，满后先撤销再生成。','可用动作及参数（tab_id 通用；省略时使用当前活动标签）：',JSON.stringify(value.actions,null,2),'','先 snapshot/find，随后依赖动作顺序执行。分页使用 offset/limit 与 text_offset/text_limit。','用户接管会返回 human_control；等输入结束后重新 snapshot。stale_snapshot 要重新观察。','未开放任意 JavaScript、本地文件上传、浏览身份/设置管理。HTTP 不接受网页 Origin/CORS。','完整动作参数以本说明下列接口目录为准；操作结果未知时查询原编号，避免重复执行。'].join('\n');
 }
 content.addEventListener('keydown',event=>{
  if(current!=='tabs'||!['Home','End','ArrowUp','ArrowDown'].includes(event.key))return;
  const rows=[...content.querySelectorAll('[data-tab-id]')];if(!rows.length)return;
  const index=rows.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
  event.preventDefault();rows[next].focus();
 });
 $('menu-shade').onclick=close;$('panel-backdrop').onclick=close;
 $('browser-menu').onclick=()=>open('menu');$('panel-close').onclick=close;$('bookmarks-button').onclick=()=>open('bookmarks');
 window.addEventListener('resize',()=>{geometry();layout();});
 return {update(s){state=s;paint();},receiveAccess,geometry,close,open,get active(){return !!current;}};
};
