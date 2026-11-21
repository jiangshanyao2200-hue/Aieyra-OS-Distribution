/* @file-map:start
文件: link/agent/appcontainer-aidebug.cjs
位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
下游: 无已解析的项目内静态导入
上游: link/agent/appcontainer-fs.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  add | function
  contents | function
  run | function
  node | function
  dispatch | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// An on-demand bridge inside the OS lowbox. Link controls only this OS through
// files in its own sandbox; no network listener, account token or host API.
const fs=require('node:fs'),path=require('node:path');
const root=process.env.AIEYRA_APPCONTAINER_DRIVE,session=process.env.AIEYRA_AIDEBUG_SESSION;
if(root&&session&&process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE&&!process.argv.some(a=>a.startsWith('--type=')))setImmediate(()=>{
 const {app,BrowserWindow,webContents}=require('electron');
 const directory=path.join(root,'diagnostics','os'),commandFile=path.join(directory,'command.json');
 fs.mkdirSync(directory,{recursive:true});let busy=false;const events=[];
 const /* @chain-region add | calls: events.push, toISOString, Date, events.shift */ add=(kind,data)=>{events.push({kind,...data,at:new Date().toISOString()});if(events.length>200)events.shift();};
 app.on('browser-window-created',(_e,w)=>{for(const kind of ['close','closed','unresponsive','responsive'])w.on(kind,()=>add(kind,{window:w.id}));});
 app.on('web-contents-created',(_e,wc)=>{
  wc.on('render-process-gone',(_e,detail)=>add('renderer-exit',{contents:wc.id,...detail}));
  wc.on('did-fail-load',(_e,code,description)=>add('load-failed',{contents:wc.id,code,description}));
 });
 const /* @chain-region contents | calls: webContents.fromId, Number, BrowserWindow.getAllWindows, wc.isDestroyed, Error */ contents=cmd=>{const wc=cmd.contents?webContents.fromId(Number(cmd.contents)):BrowserWindow.getAllWindows()[0]?.webContents;if(!wc||wc.isDestroyed())throw Error('os_contents_not_found');return wc;};
 const /* @chain-region run | calls: wc.executeJavaScript */ run=(wc,expression)=>wc.executeJavaScript(expression);
 const /* @chain-region node | calls: run, JSON.stringify */ node=(wc,selector)=>run(wc,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('os_element_not_found');const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()`);
 /* @chain-region dispatch | calls: map, BrowserWindow.getAllWindows, toString, readBigUInt64LE, w.getNativeWindowHandle, w.getBounds, w.isVisible, filter … */ async function dispatch(cmd){
  if(cmd.action==='windows')return {windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,hwnd:w.getNativeWindowHandle().readBigUInt64LE().toString(),bounds:w.getBounds(),visible:w.isVisible(),contents:w.webContents.id})),contents:webContents.getAllWebContents().filter(wc=>!wc.isDestroyed()).map(wc=>({id:wc.id,type:wc.getType(),url:wc.getURL().replace(/[?#].*$/,'')})),events};
  const wc=contents(cmd);
  if(cmd.action==='inspect')return run(wc,`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(cmd.selector||'body')})].slice(0,80);return {ready:document.readyState,inert:document.body.inert,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},focus:document.activeElement?.id,nodes:nodes.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {tag:n.tagName,id:n.id,text:n.innerText?.slice(0,12000),rect:{x:r.x,y:r.y,width:r.width,height:r.height},display:s.display,visibility:s.visibility,overflow:n.scrollWidth>n.clientWidth+1};})};})()`);
  if(cmd.action==='actions')return run(wc,`(()=>{const selector=n=>{if(n.id)return '#'+CSS.escape(n.id);const parts=[];for(let p=n;p&&p.tagName!=='HTML';p=p.parentElement){if(p.id){parts.unshift('#'+CSS.escape(p.id));break;}const peers=p.parentElement?[...p.parentElement.children].filter(v=>v.tagName===p.tagName):[p];parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(p)+1)+')');}return parts.join('>');};return [...document.querySelectorAll('button,a,input,textarea,select,summary,[role=button]')].filter(n=>n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).slice(0,300).map(n=>({selector:selector(n),label:n.ariaLabel||n.innerText||n.placeholder||n.name,disabled:!!n.disabled}));})()`);
  if(cmd.action==='evaluate'){if(typeof cmd.expression!=='string'||cmd.expression.length>32000)throw Error('invalid_expression');return run(wc,cmd.expression);}
  if(cmd.action==='click'){
   const p=cmd.selector?await node(wc,cmd.selector):cmd;
   if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.width===0||p.height===0)throw Error('invalid_os_click');
   const point={x:Math.round(p.x*wc.getZoomFactor()),y:Math.round(p.y*wc.getZoomFactor()),button:cmd.button||'left',clickCount:1};
   wc.sendInputEvent({type:'mouseMove',...point});wc.sendInputEvent({type:'mouseDown',...point});wc.sendInputEvent({type:'mouseUp',...point});return {dispatched:true};
  }
  if(cmd.action==='input')return run(wc,`(()=>{const n=document.querySelector(${JSON.stringify(cmd.selector)});if(!n)throw Error('os_element_not_found');const set=Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set;if(!set)throw Error('os_input_required');set.call(n,${JSON.stringify(String(cmd.text||'').slice(0,100000))});n.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));n.dispatchEvent(new Event('change',{bubbles:true}));return {length:n.value.length};})()`);
  if(cmd.action==='key'){const keyCode=String(cmd.key||'Escape'),modifiers=cmd.modifiers||[];wc.sendInputEvent({type:'keyDown',keyCode,modifiers});if(/^(enter|return)$/i.test(keyCode)&&!modifiers.some(v=>/^(control|ctrl|meta|command|alt)$/i.test(v)))wc.sendInputEvent({type:'char',keyCode:'\r',modifiers});wc.sendInputEvent({type:'keyUp',keyCode,modifiers});return {dispatched:true};}
  if(cmd.action==='capture'||cmd.action==='filmstrip'){
   const frames=[],duration=cmd.action==='filmstrip'?Math.min(6000,Math.max(200,Number(cmd.duration)||1200)):0,start=Date.now();
   do{const file=cmd.id+'-'+frames.length+'.png';fs.writeFileSync(path.join(directory,file),(await wc.capturePage()).toPNG());frames.push({relative:'diagnostics/os/'+file,at:Date.now()-start});if(duration)await new Promise(r=>setTimeout(r,100));}while(Date.now()-start<duration);
   return {surface:'os-renderer',contents:wc.id,frames};
  }
  if(cmd.action==='close'){const w=cmd.window?BrowserWindow.fromId(Number(cmd.window)):BrowserWindow.getAllWindows()[0];if(!w)throw Error('os_window_not_found');setTimeout(()=>w.close(),150);return {requested:true};}
  throw Error('unknown_os_diagnostic_operation');
 }
 const timer=setInterval(async()=>{
  if(busy||!fs.existsSync(commandFile))return;busy=true;let cmd;
  try{
   cmd=JSON.parse(fs.readFileSync(commandFile,'utf8'));fs.unlinkSync(commandFile);
   if(cmd.session!==session||!/^[a-f0-9]{32}$/.test(cmd.id||''))return;
   const value=await dispatch(cmd),file=path.join(directory,cmd.id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify({id:cmd.id,value:value??null}));fs.renameSync(file+'.tmp',file);
  }catch(error){if(cmd?.session===session&&/^[a-f0-9]{32}$/.test(cmd.id||''))fs.writeFileSync(path.join(directory,cmd.id+'.json'),JSON.stringify({id:cmd.id,error:error.message.slice(0,1000)}));}
  finally{busy=false;}
 },125);timer.unref();
});
