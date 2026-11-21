/* @file-map:start
文件: link/desktop/aidebug-live.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/aidebug-control.cjs, link/desktop/aidebug-images.cjs, link/desktop/aidebug-layout.cjs, link/desktop/aidebug-network.cjs, link/desktop/aidebug-observe.cjs, link/desktop/aidebug-screen.cjs, link/desktop/window-layout.cjs
上游: link/desktop/main.cjs
链路: observation
验证: AIDEBUG/control.test.cjs, AIDEBUG/observe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  delay | function
  bounded | function
  redact | function
  startLive | function
  startLive.log | function
  startLive.flush | function
  startLive.contents | function
  startLive.run | function
  startLive.install | function
  startLive.attach | function
  startLive.attach.on | function
  startLive.onCreated | function
  startLive.drain | function
  startLive.cloud.onDiagnostic | handler
  startLive.owner.key | handler
  startLive.composite | function
  startLive.capture | function
  startLive.safeName | function
  startLive.inspect | function
  startLive.actions | function
  startLive.waitFor | function
  startLive.click | function
  startLive.filmstrip | function
  startLive.filmstrip.read | function
  startLive.filmstrip.add | function
  startLive.status | function
  startLive.health | function
  startLive.audit | function
  startLive.checkpoint | function
  startLive.bundle | function
  startLive.bundle.write | function
  startLive.dispatch | function
  startLive.dispatch.case:status | case
  startLive.dispatch.case:os | case
  startLive.dispatch.case:health | case
  startLive.dispatch.case:fault | case
  startLive.dispatch.case:audit | case
  startLive.dispatch.case:checkpoint | case
  startLive.dispatch.case:review | case
  startLive.dispatch.case:observe | case
  startLive.dispatch.case:observations | case
  startLive.dispatch.case:observation | case
  startLive.dispatch.case:finding | case
  startLive.dispatch.case:actions | case
  startLive.dispatch.case:wait | case
  startLive.dispatch.case:inspect | case
  startLive.dispatch.case:evaluate | case
  startLive.dispatch.case:click | case
  startLive.dispatch.case:pointer | case
  startLive.dispatch.case:input | case
  startLive.dispatch.case:key | case
  startLive.dispatch.case:scroll | case
  startLive.dispatch.case:capture | case
  startLive.dispatch.case:filmstrip | case
  startLive.dispatch.case:startup | case
  startLive.dispatch.case:close | case
  startLive.dispatch.case:logs | case
  startLive.dispatch.case:snapshot | case
  startLive.dispatch.case:bundle | case
  startLive.dispatch.case:batch | case
  startLive.dispatch.case:viewport | case
  startLive.dispatch.case:tab | case
  startLive.dispatch.case:trace-start | case
  startLive.dispatch.case:trace-stop | case
  startLive.settleViewport | function
  startLive.logs | method
  startLive.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Local development diagnostics for the actual running client, including its child view.
const fs=require('node:fs'),path=require('node:path');
const {app,nativeImage,contentTracing,webContents}=require('electron');
const {startControl}=require('./aidebug-control.cjs');
const {NetworkProbe}=require('./aidebug-network.cjs');
const {layoutProbe,markImage,writeReview}=require('./aidebug-layout.cjs');
const /* @chain-region delay | calls: Promise, setTimeout */ delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const /* @chain-region bounded | calls: Promise.race, Promise, setTimeout, reject, Object.assign, Error, timer.unref, clearTimeout */ bounded=async(promise,ms=8000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('renderer_response_timeout'),{outcomeUnknown:true})),ms);timer.unref();})]);}finally{clearTimeout(timer);}};
const rendererProbe=`(()=>{
 if(window.__linkDiagnostics)return;
 let sequence=0;const events=[],add=(kind,data)=>{events.push({sequence:++sequence,at:Date.now(),kind,...data});if(events.length>500)events.shift();};
 window.__linkDiagnostics={events};
 addEventListener('error',e=>add('error',{message:e.message,source:e.filename,line:e.lineno}));
 addEventListener('unhandledrejection',e=>add('rejection',{message:String(e.reason?.message||e.reason)}));
 document.addEventListener('click',e=>{const n=e.target.closest('button,a,summary,[role=option]');if(n){const r=n.getBoundingClientRect();add('click',{selector:n.id?'#'+n.id:n.dataset.action?'[data-action="'+n.dataset.action+'"]':n.tagName,text:(n.innerText||n.ariaLabel||'').slice(0,100),point:{x:e.clientX,y:e.clientY},rect:{x:r.x,y:r.y,width:r.width,height:r.height}});}},true);
 document.addEventListener('close',e=>{if(e.target.tagName==='DIALOG')add('dialog-close',{id:e.target.id,open:e.target.open,display:getComputedStyle(e.target).display});},true);
 const observer=new MutationObserver(records=>{for(const r of records)if(r.target.tagName==='DIALOG'&&r.attributeName==='open')add('dialog-state',{id:r.target.id,open:r.target.open});});observer.observe(document,{subtree:true,attributes:true,attributeFilter:['open']});
 try{new PerformanceObserver(list=>{for(const v of list.getEntries())add('longtask',{duration:v.duration,start:v.startTime});}).observe({type:'longtask',buffered:true});}catch{}
 try{new PerformanceObserver(list=>{for(const v of list.getEntries())if(v.value>.002)add('layout-shift',{value:v.value,recentInput:v.hadRecentInput,sources:v.sources?.map(s=>({tag:s.node?.tagName,id:s.node?.id,previous:s.previousRect,current:s.currentRect})).slice(0,5)});}).observe({type:'layout-shift',buffered:true});}catch{}
 addEventListener('resize',()=>add('resize',{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
})()`;
/* @chain-region redact | calls: Array.isArray, value.map, Object.fromEntries, map, Object.entries, test, redact, value.replace */ function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/token|ticket|password|secret|authorization|cookie|private.?key/i.test(k)?'<redacted>':redact(v)]));
 return typeof value==='string'?value.replace(/Bearer\s+[A-Za-z0-9_.-]+/g,'Bearer <redacted>'):value;
}
/* @chain-region startLive | calls: fs.mkdirSync, Map, path.join, webContents.getAllWebContents, attach, app.on, listeners.push, app.removeListener … */ async function startLive({window,officeView,cloud,host,onboarding,development=()=>null,startup=()=>null,directory,runtime}){
 fs.mkdirSync(directory,{recursive:true});const events=[],listeners=[],wraps=[],attached=new Map(),journal=path.join(directory,'events.jsonl');let pendingEvents=[];
 const /* @chain-region startLive.log | calls: redact, toISOString, Date, events.push, pendingEvents.push, events.shift */ log=(kind,value)=>{const event=redact({at:new Date().toISOString(),kind,...value});events.push(event);pendingEvents.push(event);if(events.length>1000)events.shift();};
 const /* @chain-region startLive.flush | calls: fs.existsSync, fs.statSync, fs.unlinkSync, fs.renameSync, fs.appendFileSync, join, rows.map, JSON.stringify … */ flush=()=>{if(pendingEvents.length){const rows=pendingEvents;pendingEvents=[];try{if(fs.existsSync(journal)&&fs.statSync(journal).size>8*1024*1024){if(fs.existsSync(journal+'.1'))fs.unlinkSync(journal+'.1');fs.renameSync(journal,journal+'.1');}fs.appendFileSync(journal,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');}catch{pendingEvents.unshift(...rows);pendingEvents=pendingEvents.slice(-1000);}}};
 const /* @chain-region startLive.contents | calls: test, webContents.fromId, Number, view.slice, wc.isDestroyed, Error */ contents=view=>{if(!view||view==='shell')return window.webContents;if(view==='office')return officeView.webContents;if(/^contents:\d+$/.test(view)){const wc=webContents.fromId(Number(view.slice(9)));if(wc&&!wc.isDestroyed())return wc;}throw Error('diagnostic_view_unavailable');};
 const /* @chain-region startLive.run | calls: bounded, executeJavaScript, contents */ run=(code,view)=>bounded(contents(view).executeJavaScript(`(async()=>{return await (${code});})()`,true));
 const /* @chain-region startLive.install | calls: catch, wc.executeJavaScript */ install=wc=>void wc.executeJavaScript(rendererProbe).catch(()=>{});
 /* @chain-region startLive.attach | calls: attached.has, attached.set, on, attached.get, install, log */ function attach(wc){
  if(attached.has(wc.id))return;const view=wc===window.webContents?'shell':wc===officeView.webContents?'office':'contents:'+wc.id;attached.set(wc.id,{wc,view,sequence:0});
  const /* @chain-region startLive.attach.on | calls: wc.on, listeners.push, wc.isDestroyed, wc.removeListener */ on=(event,fn)=>{wc.on(event,fn);listeners.push(()=>{if(!wc.isDestroyed())wc.removeListener(event,fn);});};
  on('did-finish-load',()=>{attached.get(wc.id).sequence=0;install(wc);});install(wc);
  on('console-message',(_event,...args)=>{const d=typeof args[0]==='object'?args[0]:{level:args[0],message:args[1],lineNumber:args[2],sourceId:args[3]};log('console',{view,...d});});
  on('render-process-gone',(_e,details)=>log('renderer-exit',{view,...details}));
  on('did-fail-load',(_e,code,message,url)=>log('load-error',{view,code,message,url}));
  on('unresponsive',()=>log('unresponsive',{view}));on('responsive',()=>log('responsive',{view}));
 }
 for(const wc of webContents.getAllWebContents())attach(wc);
 const /* @chain-region startLive.onCreated | calls: attach */ onCreated=(_event,wc)=>attach(wc);app.on('web-contents-created',onCreated);listeners.push(()=>app.removeListener('web-contents-created',onCreated));
 let draining=false;
 const /* @chain-region startLive.drain | calls: attached.values, state.wc.isDestroyed, bounded, state.wc.executeJavaScript, log, flush */ drain=async()=>{if(draining)return;draining=true;try{for(const state of attached.values())if(!state.wc.isDestroyed()){try{const rows=await bounded(state.wc.executeJavaScript('window.__linkDiagnostics?.events||[]'),2000);for(const row of rows)if(row.sequence>state.sequence){state.sequence=row.sequence;log('renderer',{view:state.view,...row});}}catch{}}flush();}finally{draining=false;}};
 const journalTimer=setInterval(()=>void drain(),2000);journalTimer.unref();
 const network=new NetworkProbe(cloud,log);wraps.push(()=>network.close());
 const previousDiagnostic=cloud.onDiagnostic;/* @chain-region startLive.cloud.onDiagnostic | calls: previousDiagnostic, log */ cloud.onDiagnostic=row=>{previousDiagnostic?.(row);log('cloud-request-complete',row);};wraps.push(()=>cloud.onDiagnostic=previousDiagnostic);
 for(const [owner,key,label] of [[onboarding,'local','office-http']]){
  const original=owner[key];/* @chain-region startLive.owner.key | calls: Date.now, original.apply, String, URL, log, split */ owner[key]=async function(...args){const start=Date.now();try{const value=await original.apply(this,args);let route=String(args[0]);try{const u=new URL(route);route=u.origin+u.pathname;}catch{}log(label,{route,method:label==='office-http'?(args[1]?'POST':'GET'):(args[1]?.method||'GET'),duration:Date.now()-start,status:value?.status});return value;}catch(error){log(label,{route:String(args[0]).split('?')[0],duration:Date.now()-start,error:error.message});throw error;}};
  wraps.push(()=>owner[key]=original);
 }
 /* @chain-region startLive.composite | calls: window.getContentSize, officeView.getBounds, officeView.getVisible, shell.resize, toBitmap, office.resize, overlayBitmap, require … */ function composite(shell,office){
  const [width,height]=window.getContentSize(),bounds=officeView.getBounds();
  if(!officeView.getVisible()||!office||!bounds.width||!bounds.height)return shell.resize({width,height});
  const bitmap=shell.resize({width,height}).toBitmap(),child=office.resize({width:bounds.width,height:bounds.height}).toBitmap();
  require('./aidebug-images.cjs').overlayBitmap(bitmap,width,height,child,bounds);
  return nativeImage.createFromBitmap(bitmap,{width,height,scaleFactor:1});
 }
 const /* @chain-region startLive.capture | calls: composite, bounded, window.webContents.capturePage, officeView.getVisible, officeView.webContents.capturePage */ capture=async()=>composite(await bounded(window.webContents.capturePage()),officeView.getVisible()?await bounded(officeView.webContents.capturePage()):null);
 const /* @chain-region startLive.safeName | calls: test, Error */ safeName=value=>{if(!/^[a-zA-Z0-9_-]{1,80}$/.test(value||''))throw Error('invalid_capture_name');return value;};
 const /* @chain-region startLive.inspect | calls: run, JSON.stringify, Math.min, Math.max, Number */ inspect=async(command={})=>run(`(()=>{
  const nodes=[...document.querySelectorAll(${JSON.stringify(command.selector||'dialog,[popover],#workspace')})].slice(0,${Math.min(400,Math.max(1,Number(command.limit)||80))});
  return {url:location.href,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},focus:document.activeElement?.id,events:window.__linkDiagnostics?.events||[],nodes:nodes.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {tag:n.tagName,id:n.id,role:n.getAttribute('role'),text:(n.innerText||'').slice(0,12000),open:n.open,hidden:n.hidden,rect:{x:r.x,y:r.y,width:r.width,height:r.height},display:s.display,visibility:s.visibility,opacity:s.opacity,backdropFilter:s.backdropFilter,transition:s.transition,animations:n.getAnimations().map(a=>({playState:a.playState,currentTime:a.currentTime})),overflow:n.scrollWidth>n.clientWidth+1,children:n.children.length};})};
 })()`,command.view);
 const /* @chain-region startLive.actions | calls: run */ actions=async(command={})=>run(`(()=>{const selector=n=>{if(n.id)return '#'+CSS.escape(n.id);for(const attr of ['data-action','data-tab','data-dialog-close','data-window','data-background-mode','aria-label','name']){if(!n.hasAttribute(attr))continue;const value=n.tagName.toLowerCase()+'['+attr+'='+JSON.stringify(n.getAttribute(attr))+']';if(document.querySelectorAll(value).length===1)return value;}const parts=[];for(let p=n;p&&p.tagName!=='HTML';p=p.parentElement){if(p.id){parts.unshift('#'+CSS.escape(p.id));break;}const peers=p.parentElement?[...p.parentElement.children].filter(v=>v.tagName===p.tagName):[p];parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(p)+1)+')');}return parts.join('>');};return [...document.querySelectorAll('button,a,input,textarea,select,summary,[role=button],[role=option]')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);if(!r.width||!r.height||s.visibility==='hidden'||n.checkVisibility&&!n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return null;const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector:selector(n),label:n.ariaLabel||n.innerText||n.placeholder||n.name||'',role:n.getAttribute('role')||n.tagName.toLowerCase(),disabled:!!n.disabled,occluded:!n.contains(top),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};}).filter(Boolean).slice(0,400);})()`,command.view);
 /* @chain-region startLive.waitFor | calls: Date.now, Math.min, Math.max, Number, run, JSON.stringify, result.text.includes, delay … */ async function waitFor(command){
  const deadline=Date.now()+Math.min(15000,Math.max(100,Number(command.timeout)||5000));
  while(Date.now()<deadline){const result=await run(`(()=>{const n=document.querySelector(${JSON.stringify(command.selector)}),r=n?.getBoundingClientRect(),s=n&&getComputedStyle(n),visible=!!(r?.width&&r?.height&&s.visibility!=='hidden'&&s.display!=='none'&&(!n.checkVisibility||n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})));return {exists:!!n,visible,animating:!!n?.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity),text:(n?.innerText||'').slice(0,1000)};})()`,command.view);const ready=command.state==='hidden'?!result.visible:command.state==='absent'?!result.exists:command.state==='attached'?result.exists:result.visible;if(ready&&(!command.settled||!result.animating)&&(!command.text||result.text.includes(command.text)))return result;await delay(50);}throw Error('element_wait_timeout: '+command.selector);
 }
 /* @chain-region startLive.click | calls: run, JSON.stringify, contents, wc.getZoomFactor, Math.round, officeView.getVisible, Error, officeView.getBounds … */ async function click(command){
  const point=await run(`(async()=>{const n=document.querySelector(${JSON.stringify(command.selector)});if(!n||n.disabled)throw Error('element_unavailable');n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!r.width||!r.height||!n.contains(document.elementFromPoint(x,y)))throw Error('element_hidden_or_occluded');return {x,y};})()`,command.view);
  const wc=contents(command.view),zoom=wc.getZoomFactor();point.x=Math.round(point.x*zoom);point.y=Math.round(point.y*zoom);
  if(wc===officeView.webContents&&!officeView.getVisible())throw Error('native_view_hidden');
  if(wc===window.webContents&&officeView.getVisible()){const b=officeView.getBounds();if(point.x>=b.x&&point.x<b.x+b.width&&point.y>=b.y&&point.y<b.y+b.height)throw Error('element_occluded_by_native_view');}
  for(const type of ['mouseMove','mouseDown','mouseUp'])wc.sendInputEvent({type,...point,button:command.button||'left',clickCount:command.clickCount||1});
  return {clicked:true};
 }
 /* @chain-region startLive.filmstrip | calls: safeName, Date.now, Math.min, Math.max, Number, window.getContentSize, sampleDesktop, require … */ async function filmstrip(command){
  const name=safeName(command.name||'close-'+Date.now()),duration=Math.min(4000,Math.max(250,Number(command.duration)||750)),frames=[],captureErrors=[],start=Date.now(),frameWidth=Math.min(2560,Math.max(480,Number(command.width)||window.getContentSize()[0]));
  if(command.surface==='desktop'){
   const native=await require('./aidebug-screen.cjs').sampleDesktop({window,python:onboarding.python,script:path.join(path.dirname(onboarding.cli),'aidebug_screen.py'),directory:path.join(directory,name,'native'),duration,action:command.selector?()=>click(command):undefined});frames.push(...native);
  }else{
   const /* @chain-region startLive.filmstrip.read | calls: bounded, wc.capturePage, captureErrors.push, Date.now */ read=async(wc,view)=>{
    try{return await bounded(wc.capturePage(undefined,{stayAwake:true,stayHidden:true}));}
    catch(error){captureErrors.push({view,at:Date.now()-start,message:error.message});return null;}
   };
   const shellContents=window.webContents,officeContents=officeView.webContents;
   let [shell,office]=await Promise.all([read(shellContents,'shell'),officeView.getVisible()?read(officeContents,'office'):null]),last=0;
   const /* @chain-region startLive.filmstrip.add | calls: Date.now, officeView.getVisible, frames.push, resize, composite */ add=(force=false)=>{
    const at=Date.now()-start;
    if(!shell||officeView.getVisible()&&!office||!force&&at-last<24&&frames.length)return;
    last=at;frames.push({at,image:composite(shell,office).resize({width:frameWidth})});
   };
   add();const subscribed=[];
   try{
    for(const [view,wc] of [['shell',window.webContents],['office',officeView.webContents]]){
     wc.beginFrameSubscription(false,image=>{if(image.isEmpty())return;if(view==='shell')shell=image;else office=image;add();});subscribed.push(wc);
    }
    if(command.selector)await click(command);
    await delay(duration);
   }finally{for(const wc of subscribed)if(!wc.isDestroyed())wc.endFrameSubscription();}
   const [finalShell,finalOffice]=await Promise.all([read(shellContents,'shell'),officeView.getVisible()?read(officeContents,'office'):null]);
   if(finalShell&&(!officeView.getVisible()||finalOffice)){shell=finalShell;office=finalOffice;add(true);}
  }
  if(!frames.length)throw Error('no_filmstrip_frames');
  const width=480,height=frames[0].image.resize({width}).getSize().height,columns=4,rows=Math.ceil(frames.length/columns),pixels=Buffer.alloc(width*height*columns*rows*4,18);
  for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  const directoryOut=path.join(directory,name);fs.mkdirSync(directoryOut,{recursive:true});
  const writer=new (require('./aidebug-images.cjs').ImageWriter)(),records=[];let sheet;
  try{for(const [i,frame]of frames.entries()){
   const file=path.join(directoryOut,String(i).padStart(3,'0')+'.png');await writer.write(frame.image,file);
   const bytes=frame.image.resize({width,height}).toBitmap(),x=i%columns*width,y=Math.floor(i/columns)*height;
   for(let row=0;row<height;row++)bytes.copy(pixels,((y+row)*width*columns+x)*4,row*width*4,(row+1)*width*4);
   records.push({index:i,at:frame.at,path:file,...(frame.visibility?{visibility:frame.visibility}:{})});
  }
  sheet=path.join(directoryOut,'filmstrip.png');await writer.write(nativeImage.createFromBitmap(pixels,{width:width*columns,height:height*rows,scaleFactor:1}),sheet);
  }finally{await writer.close();}
  const timeline=records.map(frame=>({index:frame.index,at:frame.at,src:path.basename(frame.path)}));
  const viewer=path.join(directoryOut,'viewer.html');
  fs.writeFileSync(viewer,`<!doctype html><meta charset="utf-8"><title>AIDEBUG · ${name}</title><style>body{margin:0;background:#10131a;color:#dde5f1;font:16px system-ui}header{position:sticky;top:0;padding:16px 24px;background:#171d29;display:flex;align-items:center;gap:16px}button{background:#2a3549;color:inherit;border:0;border-radius:8px;padding:8px 16px;cursor:pointer}#time{min-width:150px}#range{flex:1}#main{display:block;width:min(1280px,100%);margin:20px auto}#grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:20px}figure{margin:0;cursor:pointer}figure img{width:100%;border:1px solid #ffffff20}figcaption{padding:6px;color:#a9b9cf}</style><header><strong>AIDEBUG · ${name}</strong><button id="prev">上一帧</button><button id="play">播放</button><button id="next">下一帧</button><span id="time"></span><input id="range" type="range" min="0" max="${frames.length-1}" value="0"></header><img id="main"><div id="grid"></div><script>const frames=${JSON.stringify(timeline)};let index=0,timer;const show=i=>{index=Math.max(0,Math.min(frames.length-1,i));document.getElementById('main').src=frames[index].src;document.getElementById('time').textContent='帧 '+index+' · '+frames[index].at+' ms';document.getElementById('range').value=index;};document.getElementById('prev').onclick=()=>show(index-1);document.getElementById('next').onclick=()=>show(index+1);document.getElementById('range').oninput=e=>show(+e.target.value);document.getElementById('play').onclick=()=>{if(timer){clearInterval(timer);timer=null;return;}timer=setInterval(()=>{show(index===frames.length-1?0:index+1);},100);};for(const f of frames){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=f.src;caption.textContent='帧 '+f.index+' · '+f.at+' ms';figure.append(img,caption);figure.onclick=()=>show(f.index);document.getElementById('grid').append(figure);}addEventListener('keydown',e=>{if(e.key==='ArrowLeft')show(index-1);if(e.key==='ArrowRight')show(index+1);});show(0);</script>`);
  const result={sheet,viewer,surface:command.surface==='desktop'?'windows-desktop':'renderer-composite',resolution:frames[0].image.getSize(),selector:command.selector,view:command.view||'shell',frames:records,captureErrors,after:await inspect({view:command.view,selector:'dialog,[popover]'})};fs.writeFileSync(path.join(directoryOut,'frames.json'),JSON.stringify(result,null,2));return result;
 }
 let tracing=false;
 const checkpoints=[];
 const /* @chain-region startLive.status | calls: app.getVersion, officeView.getVisible, window.isVisible, window.getBounds, window.webContents.getZoomFactor, map, filter, attached.values … */ status=()=>({protocol:'aieyra-aidebug-live/1',version:app.getVersion(),executable:process.execPath,app:__dirname,officeVisible:officeView.getVisible(),window:{visible:window.isVisible(),bounds:window.getBounds(),zoom:window.webContents.getZoomFactor()},views:[...attached.values()].filter(s=>!s.wc.isDestroyed()).map(({wc,view})=>({view,id:wc.id,type:wc.getType(),title:wc.getTitle(),url:wc.getURL().split('?')[0],zoom:wc.getZoomFactor(),loading:wc.isLoading()})),service:{origin:host.origin,pid:host.child?.pid},network:network.state(),checkpoints:checkpoints.length,capabilities:['observe','observations','observation','finding','startup','close','inspect','actions','evaluate','click','pointer','input','key','scroll','wait','capture','filmstrip','logs','snapshot','bundle','health','batch','viewport','trace-start','trace-stop','tab','fault','audit','checkpoint','review'],output:directory});
 const /* @chain-region startLive.health | calls: app.getAppMetrics, development, status, process.memoryUsage, app.getGPUFeatureStatus, redact, map, filter … */ health=async()=>{const processes=app.getAppMetrics(),dev=development();return {status:status(),processes,mainMemory:process.memoryUsage(),gpu:app.getGPUFeatureStatus(),serviceLog:redact(host.diagnostics||''),requests:cloud.diagnostics,development:dev?redact({...dev.value,workerPid:dev.child?.pid}):null,rendererMemory:[...attached.values()].filter(s=>!s.wc.isDestroyed()).map(({wc,view})=>({view,pid:wc.getOSProcessId(),memory:processes.find(p=>p.pid===wc.getOSProcessId())?.memory}))};};
 /* @chain-region startLive.audit | calls: officeView.getVisible, run, layoutProbe.toString, JSON.stringify */ async function audit(command={}){
  const view=command.view||(officeView.getVisible()?'office':'shell');
  const measured=await run('('+layoutProbe.toString()+')('+JSON.stringify({selector:command.selector})+')',view);
  return {view,...measured};
 }
 /* @chain-region startLive.checkpoint | calls: Error, safeName, Date.now, path.join, fs.existsSync, fs.mkdirSync, drain, audit … */ async function checkpoint(command){
  if(checkpoints.length>=200)throw Error('checkpoint_limit');
  const name=safeName(command.name||'checkpoint-'+Date.now()),folder=path.join(directory,name);
  if(fs.existsSync(folder))throw Error('checkpoint_name_exists');
  fs.mkdirSync(folder);await drain();
  const measured=await audit(command),view=measured.view;
  let picture,visibility,surface='renderer-composite';
  if(command.surface==='desktop'){
   // A static checkpoint waits for the renderer frame before synchronizing DWM.
   // The desktop pixels remain native; filmstrip keeps the transition itself.
   await bounded(contents(view).capturePage());
   const frame=(await require('./aidebug-screen.cjs').sampleDesktop({window,python:onboarding.python,script:path.join(path.dirname(onboarding.cli),'aidebug_screen.py'),directory:path.join(folder,'native')}))[0];picture=frame.image;visibility=frame.visibility;surface='windows-desktop';
  }else picture=command.view?await contents(view).capturePage():await capture();
  const file=path.join(folder,'screen.png');fs.writeFileSync(file,picture.toPNG());
  const auditImage=command.view||view==='shell'?picture:await contents(view).capturePage();
  fs.writeFileSync(path.join(folder,'marked.png'),markImage(auditImage,measured.issues,nativeImage,auditImage.getSize().width/measured.viewport.width).toPNG());
  const entry={name,image:file,surface,visibility,audit:measured,note:String(command.note||'').slice(0,2000),at:new Date().toISOString()};checkpoints.push(entry);
  fs.writeFileSync(path.join(folder,'checkpoint.json'),JSON.stringify(redact({...entry,health:await health(),events:events.slice(-80)}),null,2));
  fs.writeFileSync(path.join(directory,'checkpoints.json'),JSON.stringify(checkpoints,null,2));
  return {name,image:file,marked:path.join(folder,'marked.png'),audit:measured,review:writeReview(directory,checkpoints)};
 }
 /* @chain-region startLive.bundle | calls: path.join, safeName, Date.now, fs.mkdirSync, drain, write, health, attached.values … */ async function bundle(command){
  const folder=path.join(directory,safeName(command.name||'issue-'+Date.now()));fs.mkdirSync(folder,{recursive:true});await drain();
  const /* @chain-region startLive.bundle.write | calls: fs.writeFileSync, path.join, JSON.stringify, redact */ write=(name,value)=>fs.writeFileSync(path.join(folder,name),JSON.stringify(redact(value),null,2));write('health.json',await health());
  write('events.json',events);const documents=[];
  for(const {wc,view} of attached.values())if(!wc.isDestroyed()){try{documents.push({view,dom:await inspect({view,selector:'dialog,[popover],main,header',limit:30}),actions:await actions({view})});}catch(error){documents.push({view,error:error.message});}}
  write('interface.json',documents);let screenshot;try{fs.writeFileSync(path.join(folder,'screen.png'),(await capture()).toPNG());screenshot=path.join(folder,'screen.png');}catch(error){write('capture-error.json',{error:error.message});}
  write('index.json',{created:new Date().toISOString(),files:fs.readdirSync(folder),status:status()});return {directory:folder,index:path.join(folder,'index.json'),screenshot};
 }
 const /* @chain-region startLive.dispatch | calls: status, development, Error, os.command, health, network.configure, audit, checkpoint … */ dispatch=async command=>{
  switch(command.op){
   /* @chain-region startLive.dispatch.case:status */ case 'status':return status();
   /* @chain-region startLive.dispatch.case:os */ case 'os':{const os=development();if(!os)throw Error('众创 OS 未运行');return os.command('debug',command.command||{action:'windows'});}
   /* @chain-region startLive.dispatch.case:health */ case 'health':return health();
   /* @chain-region startLive.dispatch.case:fault */ case 'fault':return network.configure(command);
   /* @chain-region startLive.dispatch.case:audit */ case 'audit':return audit(command);
   /* @chain-region startLive.dispatch.case:checkpoint */ case 'checkpoint':return checkpoint(command);
   /* @chain-region startLive.dispatch.case:review */ case 'review':return {path:writeReview(directory,checkpoints),count:checkpoints.length};
   /* @chain-region startLive.dispatch.case:observe */ case 'observe':return observer.observe(command);
   /* @chain-region startLive.dispatch.case:observations */ case 'observations':return observer.list();
   /* @chain-region startLive.dispatch.case:observation */ case 'observation':return observer.read(command);
   /* @chain-region startLive.dispatch.case:finding */ case 'finding':return observer.finding(command);
   /* @chain-region startLive.dispatch.case:actions */ case 'actions':return actions(command);
   /* @chain-region startLive.dispatch.case:wait */ case 'wait':return waitFor(command);
   /* @chain-region startLive.dispatch.case:inspect */ case 'inspect':return inspect(command);
   /* @chain-region startLive.dispatch.case:evaluate */ case 'evaluate':if(typeof command.expression!=='string'||command.expression.length>32000)throw Error('invalid_expression');return redact(await run(command.expression,command.view));
   /* @chain-region startLive.dispatch.case:click */ case 'click':return click(command);
   /* @chain-region startLive.dispatch.case:pointer */ case 'pointer':{const wc=contents(command.view);if(!Number.isFinite(command.x)||!Number.isFinite(command.y))throw Error('pointer_coordinates_required');const event={type:command.type||'mouseMove',x:Math.round(command.x*wc.getZoomFactor()),y:Math.round(command.y*wc.getZoomFactor()),button:command.button||'left',clickCount:command.clickCount||1};if(!['mouseMove','mouseDown','mouseUp','mouseWheel'].includes(event.type))throw Error('invalid_pointer_type');if(event.type==='mouseWheel')Object.assign(event,{deltaX:Number(command.deltaX)||0,deltaY:Number(command.deltaY)||0});wc.sendInputEvent(event);return {sent:true};}
   /* @chain-region startLive.dispatch.case:input */ case 'input':{await click(command);const wc=contents(command.view);for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'A',modifiers:['control']});await wc.insertText(String(command.text||''));return {typed:true};}
   /* @chain-region startLive.dispatch.case:key */ case 'key':{const wc=contents(command.view),keyCode=command.key,modifiers=command.modifiers||[];wc.sendInputEvent({type:'keyDown',keyCode,modifiers});if(/^(enter|return)$/i.test(keyCode)&&!modifiers.some(v=>/^(control|ctrl|meta|command|alt)$/i.test(v)))wc.sendInputEvent({type:'char',keyCode:'\r',modifiers});wc.sendInputEvent({type:'keyUp',keyCode,modifiers});return {sent:true};}
   /* @chain-region startLive.dispatch.case:scroll */ case 'scroll':return run(`(()=>{const n=document.querySelector(${JSON.stringify(command.selector)});if(!n)throw Error('element_unavailable');n.scrollBy({top:${Number(command.y)||0},left:${Number(command.x)||0},behavior:'instant'});return {top:n.scrollTop,left:n.scrollLeft};})()`,command.view);
   /* @chain-region startLive.dispatch.case:capture */ case 'capture':{const name=safeName(command.name||'capture-'+Date.now()),file=path.join(directory,name+'.png');let image;if(command.surface==='desktop'){const frames=await require('./aidebug-screen.cjs').sampleDesktop({window,python:onboarding.python,script:path.join(path.dirname(onboarding.cli),'aidebug_screen.py'),directory:path.join(directory,name+'-native')});image=frames[0].image;}else image=command.view?await bounded(contents(command.view).capturePage()):await capture();fs.writeFileSync(file,image.toPNG());return {path:file,surface:command.surface==='desktop'?'windows-desktop':'renderer-composite',officeComposited:!command.view&&officeView.getVisible()};}
   /* @chain-region startLive.dispatch.case:filmstrip */ case 'filmstrip':return filmstrip(command);
   /* @chain-region startLive.dispatch.case:startup */ case 'startup':return redact(startup());
   /* @chain-region startLive.dispatch.case:close */ case 'close':setTimeout(()=>{if(!window.isDestroyed())window.close();},100);return {requested:true};
   /* @chain-region startLive.dispatch.case:logs */ case 'logs':await drain();return {startup:redact(startup()),events:events.slice(-Math.min(1000,command.limit||200)),requests:cloud.diagnostics,network:network.state(),service:redact(host.diagnostics||''),development:development()?redact(await development().command('logs',command.developmentOffset||0).catch(error=>({error:error.message}))):null,shell:await run('window.__linkDiagnostics?.events||[]'),office:await run('window.__linkDiagnostics?.events||[]','office')};
   /* @chain-region startLive.dispatch.case:snapshot */ case 'snapshot':{const result={status:status(),shell:await inspect(),office:await inspect({view:'office',selector:'dialog,#main'}),events:events.slice(-200)};const file=path.join(directory,safeName(command.name||'snapshot-'+Date.now())+'.json');fs.writeFileSync(file,JSON.stringify(redact(result),null,2));return {path:file};}
   /* @chain-region startLive.dispatch.case:bundle */ case 'bundle':return bundle(command);
   /* @chain-region startLive.dispatch.case:batch */ case 'batch':{if(!Array.isArray(command.steps)||command.steps.length>50)throw Error('invalid_batch');const results=[];for(const [index,step] of command.steps.entries()){try{if(step.op==='batch')throw Error('nested_batch');results.push(await dispatch(step));}catch(error){error.diagnostic={step:index,operation:step.op,completed:results};throw error;}}return results;}
   /* @chain-region startLive.dispatch.case:viewport */ case 'viewport':{const width=Math.min(3840,Math.max(700,Number(command.width)||1280)),height=Math.min(2160,Math.max(540,Number(command.height)||720));window.setSize(width,height);if(Number.isFinite(command.x)&&Number.isFinite(command.y))window.setPosition(Math.round(command.x),Math.round(command.y));if(typeof command.onTop==='boolean')window.setAlwaysOnTop(command.onTop);if(command.visible===true)window.showInactive();if(command.zoom){const zoom=Math.min(2,Math.max(.75,Number(command.zoom)||1));window.webContents.setZoomFactor(zoom);officeView.webContents.setZoomFactor(zoom);}officeView.setBounds(require('./window-layout.cjs').contentBounds(window));await settleViewport();return status();}
   /* @chain-region startLive.dispatch.case:tab */ case 'tab':if(!['agents','home','repository','office','chat','management'].includes(command.tab))throw Error('invalid_tab');await waitFor({selector:'[data-tab="'+command.tab+'"]'});await click({selector:'[data-tab="'+command.tab+'"]'});await waitFor({selector:'[data-tab="'+command.tab+'"][aria-current="page"]'});return {tab:command.tab};
   /* @chain-region startLive.dispatch.case:trace-start */ case 'trace-start':if(!tracing){await contentTracing.startRecording({included_categories:['devtools.timeline','blink','cc','gpu','viz','toplevel','disabled-by-default-devtools.screenshot']});tracing=true;}return {recording:true};
   /* @chain-region startLive.dispatch.case:trace-stop */ case 'trace-stop':{if(!tracing)throw Error('trace_not_running');const file=await contentTracing.stopRecording(path.join(directory,safeName(command.name||'trace-'+Date.now())+'.json'));tracing=false;return {path:file};}
   default:throw Error('unknown_diagnostic_operation');
  }
 };
 // Shell and office receive resize/zoom independently. Native bounds and each
 // visible renderer must agree before subsequent geometry or input is trusted.
 /* @chain-region startLive.settleViewport | calls: window.getContentSize, officeView.getBounds, officeView.getVisible, wc.getZoomFactor, run */ async function settleViewport(){
  const [width,height]=window.getContentSize(),bounds=officeView.getBounds();
  for(const [view,wc,w,h] of [['shell',window.webContents,width,height],...(officeView.getVisible()?[['office',officeView.webContents,bounds.width,bounds.height]]:[])]){
   const zoom=wc.getZoomFactor();
   await run(`new Promise((resolve,reject)=>{let previous='',stable=0,active=true;const timeout=setTimeout(()=>{active=false;reject(Error('viewport_not_settled: ${view}'));},2000);const check=()=>{if(!active)return;const current=innerWidth+','+innerHeight+','+devicePixelRatio,matched=Math.abs(innerWidth*${zoom}-${w})<=4&&Math.abs(innerHeight*${zoom}-${h})<=4;stable=matched&&current===previous?stable+1:0;previous=current;if(stable>=2){active=false;clearTimeout(timeout);return resolve({settled:true});}requestAnimationFrame(check);};requestAnimationFrame(check);})`,view);
  }
 }
 const observer=require('./aidebug-observe.cjs').createObserver({directory,dispatch,checkpoint,health,/* @chain-region startLive.logs | calls: dispatch */ logs:()=>dispatch({op:'logs',limit:200}),redact});
 const control=await startControl({output:directory,status,dispatch}),discoveryFile=path.join(runtime,'aidebug.json');
 fs.mkdirSync(runtime,{recursive:true});fs.writeFileSync(discoveryFile,JSON.stringify({...control.discovery,protocol:'aieyra-aidebug-live/1',version:app.getVersion(),output:directory}),{mode:0o600});
 return {dispatch,status,/* @chain-region startLive.close | calls: clearInterval, off, restore, flush, contentTracing.stopRecording, path.join, fs.writeFileSync, JSON.stringify … */ async close(){clearInterval(journalTimer);for(const off of listeners)off();for(const restore of wraps)restore();flush();if(tracing)await contentTracing.stopRecording(path.join(directory,'trace-shutdown.json'));fs.writeFileSync(path.join(directory,'events.json'),JSON.stringify(events,null,2));await control.close();try{const active=JSON.parse(fs.readFileSync(discoveryFile));if(active.pid===process.pid)fs.unlinkSync(discoveryFile);}catch{}}};
}
module.exports={startLive,redact};
