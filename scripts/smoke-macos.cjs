// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: scripts/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; app; binary; sleep; core
// Impact: python -B scripts/code-atlas.py show scripts/smoke-macos.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const app=path.resolve(process.argv[2]),root=path.join(app,'Contents/Resources/product'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-smoke-'));
const binary=path.join(root,'Aieyra OS'),config=path.join(tmp,'config.json');
fs.writeFileSync(config,'{}');
fs.writeFileSync(path.join(tmp,'companion-profile.json'),JSON.stringify({name:'',avatar:'',initialized:true}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let core,ui,socket,stderr='';
(async()=>{
 const release=JSON.parse(fs.readFileSync(path.join(root,'Config/release.json')));
 assert.equal(execFileSync(binary,['-version'],{encoding:'utf8'}).trim(),'Aieyra OS '+release.version);
 assert.equal(execFileSync(path.join(app,'Contents/MacOS/AieyraOS'),['-version'],{encoding:'utf8'}).trim(),'Aieyra OS '+release.version);
 core=spawn(binary,['-workspace-core','-config',config,'-workdir',tmp],{env:{...process.env,AIEYRA_ROOT:root},stdio:['pipe','pipe','pipe']});core.stderr.on('data',b=>stderr+=b);
 const descriptor=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Core descriptor timeout '+stderr)),30000);core.stdout.on('data',b=>{text+=b;if(text.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(text.split('\n')[0]));}catch(e){reject(e);}}});core.once('error',reject);});
 descriptor.root=root;descriptor.config=config;descriptor.executable=binary;
 const {requestCore}=require(path.join(root,'Client/Desktop/host/bridge.cjs'));
 const settings=await requestCore(descriptor,'settings',{action:'read'});assert.notEqual(settings.ok,false,'Native settings service failed');
 const snapshot=await requestCore(descriptor,'workspace.snapshot');assert.ok(snapshot.session_id||snapshot.session,'Workspace state missing');
 const electron=path.join(root,'Client/Desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
 const env={...process.env,AIEYRA_ROOT:root,AIEYRA_WORKSPACE_BRIDGE:JSON.stringify(descriptor)};delete env.ELECTRON_RUN_AS_NODE;
 ui=spawn(electron,[path.join(root,'Client/Desktop/host/main.cjs'),'--remote-debugging-port=19346'],{env,stdio:['ignore','pipe','pipe']});ui.stderr.on('data',b=>stderr+=b);
 let target;for(let n=0;n<100;n++){await sleep(150);try{target=(await(await fetch('http://127.0.0.1:19346/json/list')).json()).find(t=>t.type==='page'&&t.url.includes('/ui/index.html'));if(target)break;}catch{}}
 assert.ok(target,'Real workspace window did not open: '+stderr.slice(-4000));socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let seq=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const waiter=pending.get(m.id);pending.delete(m.id);m.error?waiter.reject(Error(m.error.message)):waiter.resolve(m.result);}};
 const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 let state;for(let n=0;n<60;n++){const r=await send('Runtime.evaluate',{expression:'document.body && JSON.stringify({title:document.title,text:document.body.innerText,ready:document.readyState,halo:!!document.querySelector(".halo"),width:innerWidth,scroll:document.documentElement.scrollWidth})',returnByValue:true});if(typeof r.result?.value==='string')state=JSON.parse(r.result.value);if(state?.ready==='complete'&&state.halo)break;await sleep(200);}
 assert.ok(state?.halo,'OS halo absent');assert.ok(state.width>=state.scroll,'Workspace horizontal overflow');assert.ok(!/启动失败|TypeError:|ReferenceError:/.test(state.text),'Workspace startup error');
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(path.dirname(app),'macos-smoke.png'),Buffer.from(shot.data,'base64'));
 // 后台启动不会挡住空连接配置；从已可用的画布打开设置。
 let startup;for(let n=0;n<100;n++){
  const r=await send('Runtime.evaluate',{expression:'(()=>{const e=document.querySelector("#api-bubble"),s=e&&getComputedStyle(e),r=e&&e.getBoundingClientRect(),input=document.querySelector("#message"),ir=input&&input.getBoundingClientRect(),screen=document.querySelector("#screen"),bar=document.querySelector("#bottom-bar"),x=r?.x+r?.width/2,y=r?.y+r?.height/2;return {visible:!!r?.width&&!!r?.height&&s.visibility!=="hidden"&&s.display!=="none"&&!e.disabled,shown:document.querySelector("#startup")?.hidden===false,open:document.querySelector("#onboarding")?.open,interactive:!!screen&&!screen.inert&&!!bar&&!bar.inert,input:!!ir?.width&&!!ir?.height&&!input.disabled,hit:!!e&&e.contains(document.elementFromPoint(x,y)),x,y};})()',returnByValue:true});
  startup=r.result?.value;if(startup?.visible&&!startup.shown&&!startup.open&&startup.interactive&&startup.input&&startup.hit)break;await sleep(100);
 }
 assert.ok(startup?.visible&&!startup.shown&&!startup.open&&startup.interactive&&startup.input&&startup.hit,'Background startup must expose the composer and clickable API settings: '+JSON.stringify(startup));
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:startup.x,y:startup.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:startup.x,y:startup.y,button:'left',clickCount:1});await sleep(300);
 const details=await send('Runtime.evaluate',{expression:'JSON.stringify({open:document.querySelector("#onboarding").open,model:document.querySelector("#model").tagName,appearance:getComputedStyle(document.querySelector("#model")).appearance,outline:getComputedStyle(document.querySelector("#model")).outlineOffset,input:document.querySelector("#input-count").textContent,context:document.querySelector("#compression-count").textContent,overflow:document.documentElement.scrollWidth>innerWidth})',returnByValue:true});
 const settingsUI=JSON.parse(details.result.value);assert.equal(settingsUI.open,true);assert.equal(settingsUI.model,'SELECT');assert.equal(settingsUI.appearance,'base-select');assert.equal(settingsUI.overflow,false);assert.equal(settingsUI.input,'输入 0.00M');assert.equal(settingsUI.context,'上下文 0.00%');
 const settingsShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(path.dirname(app),'macos-settings.png'),Buffer.from(settingsShot.data,'base64'));
 const beforeZoom=await send('Runtime.evaluate',{expression:'({width:innerWidth,dpr:devicePixelRatio})',returnByValue:true});
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:180,y:150,deltaX:0,deltaY:-120,modifiers:2});await sleep(180);
 const afterZoom=await send('Runtime.evaluate',{expression:'({width:innerWidth,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth})',returnByValue:true});
 assert.ok(Math.abs(afterZoom.result.value.dpr/beforeZoom.result.value.dpr-1.05)<.02,'Ctrl+wheel must re-rasterize at 105%');assert.equal(afterZoom.result.value.overflow,false);
 const zoomShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(path.dirname(app),'macos-zoom.png'),Buffer.from(zoomShot.data,'base64'));
 fs.writeFileSync(path.join(path.dirname(app),'macos-smoke.json'),JSON.stringify({ok:true,platform:process.platform,arch:process.arch,core:true,workspace:true,halo:state.halo,width:state.width,startup,settingsUI,zoom:{before:beforeZoom.result.value,after:afterZoom.result.value}},null,2));
 console.log('Native macOS core + real Electron workspace smoke passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{socket?.close();ui?.kill();core?.stdin.end();await sleep(500);core?.kill();fs.rmSync(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:250});});
