/* @file-map:start
文件: link/desktop/workspace-aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/aidebug-native-hit.ps1, link/desktop/aidebug.cjs, link/desktop/cloud-client.cjs, link/desktop/readability-aidebug.cjs
上游: link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  delay | function
  verifyWorkspace | function
  verifyWorkspace.run | function
  verifyWorkspace.check | function
  verifyWorkspace.settleQuota | function
  verifyWorkspace.wait | function
  verifyWorkspace.click | function
  verifyWorkspace.type | function
  verifyWorkspace.capture | function
  verifyWorkspace.checkSurface | function
  verifyWorkspace.checkWelcome | function
  verifyWorkspace.closeDetail | function
  verifyWorkspace.nativeHit | function
  verifyWorkspace.cli | function
  verifyWorkspace.login | function
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.clipboard.writeText | handler
  verifyWorkspace.clipboard.writeText | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.httpCall | function
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.onboarding.local | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.engineering | function
  verifyWorkspace.live | function
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.finishWorkflowDecision | function
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.dialog.showSaveDialog | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.cloud.fetch | handler
  verifyWorkspace.navigateHome | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {CloudClient}=require('./cloud-client.cjs');
const {measureReadability}=require('./readability-aidebug.cjs');
const {safeStorage,dialog}=require('electron');
const /* @chain-region delay | calls: Promise, setTimeout */ delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/* @chain-region verifyWorkspace | calls: promisify, require, path.dirname, path.join, test, path.isAbsolute, fs.existsSync, Error … */ async function verifyWorkspace({window,officeView,cloud,host,onboarding,output,profile,setTab}){
 const checks=[],timings={},/* @chain-region verifyWorkspace.run | calls: window.webContents.executeJavaScript, fs.writeFileSync, path.join, toPNG, window.webContents.capturePage */ run=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch(error){fs.writeFileSync(path.join(output,'failed-expression.txt'),code);fs.writeFileSync(path.join(output,'failed-expression.png'),(await window.webContents.capturePage()).toPNG());throw error;}},/* @chain-region verifyWorkspace.check | calls: assert.ok, checks.push, fs.writeFileSync, path.join, JSON.stringify */ check=(name,value)=>{assert.ok(value,name);checks.push(name);fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({checks,timings}));};
 const /* @chain-region verifyWorkspace.settleQuota | calls: delay, Math.max, Date.now */ settleQuota=async()=>{if(cloud.gate)await delay(Math.max(0,(24-cloud.gate.tokens)/3*1000,cloud.gate.retryAt-Date.now())+150);};
 const /* @chain-region verifyWorkspace.wait | calls: run, delay, fs.writeFileSync, path.join, JSON.stringify, Date.now, Error */ wait=async (expression,attempts=100)=>{for(let i=0;i<attempts;i++){if(await run("Boolean("+expression+")"))return;await delay(100);}fs.writeFileSync(path.join(output,'timeout-context.json'),JSON.stringify({expression,text:await run("document.getElementById('workspace').textContent"),gate:{tokens:cloud.gate?.tokens,retryAt:cloud.gate?.retryAt,now:Date.now()}},null,2));throw Error('workspace_timeout: '+expression);};
 const /* @chain-region verifyWorkspace.click | calls: wait, JSON.stringify, run, Math.round, window.webContents.getZoomFactor, window.webContents.sendInputEvent, delay */ click=async selector=>{
  await wait(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().width>0`);
  const point=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  point.x=Math.round(point.x*window.webContents.getZoomFactor());point.y=Math.round(point.y*window.webContents.getZoomFactor());
  window.webContents.sendInputEvent({type:'mouseMove',...point});window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await delay(70);
 };
 const /* @chain-region verifyWorkspace.type | calls: click, window.webContents.sendInputEvent, run, JSON.stringify, delay, window.webContents.insertText */ type=async(selector,text)=>{await click(selector);window.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
  for(let i=0;i<25;i++){if(await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return document.activeElement===n&&n.selectionStart===0&&n.selectionEnd===n.value.length;})()`))break;await delay(20);}
  await window.webContents.insertText(text);};
 const readability=[];
 const /* @chain-region verifyWorkspace.capture | calls: run, delay, fs.writeFileSync, path.join, toPNG, window.webContents.capturePage, measureReadability, readability.push … */ capture=async name=>{await run("document.getElementById('notice').hidden=true");await delay(350);fs.writeFileSync(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());const measured=await measureReadability(window.webContents);readability.push({name,...measured});fs.writeFileSync(path.join(output,'readability.json'),JSON.stringify(readability,null,2));check(name+' has readable text and named controls',!measured.smallText.length&&!measured.unnamedControls.length);};
 const welcomeGeometry=[];
 const surfaceGeometry=[];
 const /* @chain-region verifyWorkspace.checkSurface | calls: window.setSize, window.webContents.setZoomFactor, delay, run, JSON.stringify, surfaceGeometry.push, fs.writeFileSync, path.join … */ checkSurface=async(name,selectors)=>{
  for(const [width,height] of [[1280,720],[900,700],[700,540]])for(const zoom of [1,1.25,1.5,2]){
   window.setSize(width,height);window.webContents.setZoomFactor(zoom);await delay(160);
   const measured=await run(`(()=>{const surface=document.querySelector('.surface'),content=document.querySelector('#content,#chat-log'),controls=[...surface.querySelectorAll(${JSON.stringify(selectors)})].filter(n=>!n.disabled&&n.checkVisibility({visibilityProperty:true}));const targets=controls.map(n=>{n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:n.textContent.slice(0,60)||n.ariaLabel,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hittable:n===hit||n.contains(hit)};});const navigationTargets=[...document.querySelectorAll('.rail button')].filter(n=>!n.disabled&&n.checkVisibility()).map(n=>{n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:n.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hittable:n===hit||n.contains(hit)};});const barTargets=[...document.querySelectorAll('.titlebar button:not([hidden])')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,hittable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===n};});return {navigationTargets,barTargets,viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,surfaceWidth:surface.clientWidth,surfaceScrollWidth:surface.scrollWidth,content:content?{width:content.clientWidth,scrollWidth:content.scrollWidth,height:content.clientHeight}:null,targets};})()`);
   surfaceGeometry.push({name,width,height,zoom,...measured});fs.writeFileSync(path.join(output,'surface-geometry.json'),JSON.stringify(surfaceGeometry,null,2));
   check(`${name} content and actions fit ${width}x${height} at ${zoom*100}%`,measured.documentWidth<=measured.viewport[0]+1&&measured.surfaceScrollWidth<=measured.surfaceWidth+1&&measured.content?.height>0&&(!name.startsWith('chat')||measured.content.height>=96)&&measured.navigationTargets.every(r=>r.left>=0&&r.right<=measured.viewport[0]+1&&r.top>=56&&r.bottom<=measured.viewport[1]+1&&r.hittable)&&measured.targets.length>0&&measured.barTargets.every(r=>r.left>=0&&r.right<=measured.viewport[0]+1&&r.top>=0&&r.bottom<=56&&r.hittable)&&measured.targets.every(r=>r.left>=0&&r.right<=measured.viewport[0]+1&&r.top>=56&&r.bottom<=measured.viewport[1]+1&&r.hittable));
   if(width===700&&zoom===1.5){await run("document.querySelector('#content,#chat-log').scrollTop=0;document.querySelector('.rail')?.scrollTo(0,0);document.querySelector('.surface').scrollTop=0");await capture('global-'+name+'-150');}
  }
  window.webContents.setZoomFactor(1);window.setSize(1280,720);await delay(180);
 };
 const /* @chain-region verifyWorkspace.checkWelcome | calls: window.setSize, window.webContents.setZoomFactor, delay, run, welcomeGeometry.push, fs.writeFileSync, path.join, JSON.stringify … */ checkWelcome=async phase=>{
  for(const [width,height] of [[1280,720],[900,700],[700,540]])for(const zoom of [1,1.25,1.5,2]){
   window.setSize(width,height);window.webContents.setZoomFactor(zoom);await delay(140);
   const measured=await run(`(()=>{const stage=document.querySelector('.welcome-stage'),content=document.querySelector('#content'),rect=stage.getBoundingClientRect();const controls=[...stage.querySelectorAll('button')].map(n=>{if(${zoom===2})n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:n.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hittable:hit===n||n.contains(hit)};});return {viewport:[innerWidth,innerHeight],stage:{top:rect.top,bottom:rect.bottom,scrollHeight:stage.scrollHeight,height:stage.clientHeight,scrollWidth:stage.scrollWidth,width:stage.clientWidth},content:content?{height:content.clientHeight,scrollHeight:content.scrollHeight}:null,controls,scrollbar:getComputedStyle(stage).scrollbarWidth};})()`);
   welcomeGeometry.push({phase,width,height,zoom,...measured});fs.writeFileSync(path.join(output,'welcome-geometry.json'),JSON.stringify(welcomeGeometry,null,2));
   check(`welcome ${phase} fits ${width}x${height} at ${zoom*100}%`,(zoom===2||measured.stage.scrollHeight<=measured.stage.height+1&&(!measured.content||measured.content.scrollHeight<=measured.content.height+1))&&measured.stage.scrollWidth<=measured.stage.width+1&&measured.controls.every(r=>r.left>=0&&r.right<=measured.viewport[0]+1&&r.top>=56&&r.bottom<=measured.viewport[1]+1&&r.hittable)&&measured.scrollbar==='none');
   if(width===700&&zoom===1.5)await capture('welcome-'+phase+'-150');
   if(width===700&&zoom===2)await capture('welcome-'+phase+'-200');
  }
  window.webContents.setZoomFactor(1);window.setSize(1280,720);await delay(150);
 };
 const /* @chain-region verifyWorkspace.closeDetail | calls: window.webContents.sendInputEvent, wait */ closeDetail=async()=>{window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait("!document.querySelector('#detail-dialog').open");};
 const /* @chain-region verifyWorkspace.nativeHit | calls: run, JSON.stringify, window.getNativeWindowHandle, toString, handle.readBigUInt64LE, String, handle.readUInt32LE, promisify … */ nativeHit=async(selector)=>{
  const point=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect(),last=n.id==='tabs'?[...n.querySelectorAll('button:not([hidden])')].at(-1)?.getBoundingClientRect().right:r.x;return {x:((last??r.x)+r.right)/2/innerWidth,y:r.y+r.height/2,height:innerHeight};})()`);
  const handle=window.getNativeWindowHandle(),hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
  const exec=require('node:util').promisify(require('node:child_process').execFile);
  const result=await exec('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'aidebug-native-hit.ps1'),'-WindowHandle',hwnd,'-TaskProcessId',String(process.pid),'-X',String(point.x),'-Y',String(point.y),'-LogicalHeight',String(point.height)],{windowsHide:true,timeout:15000});
  return JSON.parse(result.stdout);
 };
 const execFile=require('node:util').promisify(require('node:child_process').execFile);
 const packaged=path.dirname(process.execPath),python=path.join(packaged,'resources/link/runtime/python/python.exe'),agentScript=path.join(packaged,'Agent/proposal.py');
 const together=process.env.AIEYRA_AIDEBUG_TOGETHER,fixtureDir=process.env.AIEYRA_AIDEBUG_FIXTURE_DIR;
 if(!/^http:\/\/127\.0\.0\.1:\d+\/together$/.test(together||'')||!path.isAbsolute(fixtureDir||'')||!fs.existsSync(python)||!fs.existsSync(agentScript))throw Error('Isolated Agent CLI fixture is unavailable');
 const /* @chain-region verifyWorkspace.cli | calls: path.join, execFile, JSON.parse */ cli=async(keyFile,...args)=>{
  const options={windowsHide:true,timeout:30000,maxBuffer:1024*1024,env:{...process.env,LOCALAPPDATA:path.join(profile,'local')}};
  const result=await execFile(python,['-B',agentScript,'--server',together,...(keyFile?['--key-file',keyFile]:[]),...args],options);
  return JSON.parse(result.stdout);
 };
 const /* @chain-region verifyWorkspace.login | calls: URL, client.beginLogin, fetch, url.searchParams.get, assert.equal, response.headers.get, client.completeLogin */ login=async(client,id)=>{
  const url=new URL(await client.beginLogin());
  const response=await fetch(cloud.origin+'/aieyra/os/authorize?flow='+url.searchParams.get('flow'),{headers:{'x-os-auth-bridge':'fixture-auth-bridge',cookie:'session=fixture-'+id},redirect:'manual'});
  assert.equal(response.status,302);const callback=new URL(response.headers.get('location'));
  await client.completeLogin(new URL(callback.pathname+callback.search,cloud.origin).href);
 };
 await wait("document.querySelector('[data-action=login]')");
 fs.writeFileSync(path.join(output,'window-geometry.json'),JSON.stringify({bounds:window.getBounds(),content:window.getContentSize(),display:require('electron').screen.getPrimaryDisplay()},null,2));
 await capture('workspace-startup');
 check('OS main titlebar geometry and SVG hit areas',await run("document.querySelector('.titlebar').getBoundingClientRect().height===56 && document.querySelector('[data-tab=home]').getBoundingClientRect().height===36 && document.querySelectorAll('.window-actions svg').length===3"));
 const hit=await nativeHit('#tabs');fs.writeFileSync(path.join(output,'native-caption.json'),JSON.stringify(hit,null,2));check('OS recognizes blank dock as native drag region',hit.caption);
 const buttonHit=await nativeHit('[data-tab=home]');check('OS recognizes navigation as native client region',buttonHit.hit===1);
 check('720p default window',window.getBounds().width<=1284&&window.getBounds().height<=724&&window.getBounds().width>=700);
 check('anonymous tabs and Node isolation',await run("document.querySelectorAll('[data-tab]:not([hidden])').length===1 && typeof require==='undefined' && typeof process==='undefined'"));
 await capture('workspace-anonymous');await checkWelcome('login');
 check('disclosure state and keyboard focus follow identity through insertion and reordering',await run(`(async()=>{const {project}=await import('./surfaces.mjs'),root=document.createElement('section');root.style.cssText='position:fixed;top:80px;left:100px;width:240px;height:160px;overflow:auto';document.body.append(root);try{project(root,'<details data-details-key="rules"><summary>规则</summary>正文</details><details data-details-key="records"><summary>记录</summary>正文</details>');root.querySelector('[data-details-key=records]').open=true;root.querySelector('[data-details-key=records]>summary').focus();project(root,'<details data-details-key="new"><summary>新说明</summary>正文</details><details data-details-key="records"><summary>记录</summary>更新正文</details><details data-details-key="rules"><summary>规则</summary>更新正文</details>');return root.querySelector('[data-details-key=records]').open&&!root.querySelector('[data-details-key=rules]').open&&!root.querySelector('[data-details-key=new]').open&&document.activeElement===root.querySelector('[data-details-key=records]>summary');}finally{root.remove();}})()`));
 if(!cloud.origin.startsWith('http://127.0.0.1:'))throw Error('Workspace fixture must be loopback; no production writes');
 const root=new CloudClient({directory:path.join(profile,'root-fixture'),safeStorage,origin:cloud.origin});
 const second=new CloudClient({directory:path.join(profile,'peer-fixture'),safeStorage,origin:cloud.origin});
 try{
  await login(root,100);await root.verify({password:'fixture-password'});
  await login(cloud,1);await wait("document.querySelector('[data-welcome-phase=connect]')");
  check('signed-in welcome keeps one copy action and the engineer greeting',await run("document.querySelector('.welcome-stage h1').textContent==='欢迎您，亲爱的工程师。'&&document.querySelectorAll('.welcome-stage button').length===1"));
  await checkWelcome('connect');
  check('nonmember repository hidden',await run("document.querySelector('[data-tab=repository]').hidden"));await capture('workspace-applicant');
  await click('[data-tab=agents]');await wait("document.querySelector('.onboarding-stage')");
  const applicantTicket=await onboarding.issue();
  applicantTicket.ticket='-'+applicantTicket.ticket.slice(1);
  const applicantRecord=onboarding.read(cloud.cachedAccess().user.id);applicantRecord.ticket=applicantTicket.ticket;onboarding.save(applicantRecord);
  const applicantJoin=await cli(null,'join','--discovery',applicantTicket.discovery,'--ticket',applicantTicket.ticket,'--name','隔离验证 Agent');
  check('actual packaged CLI accepts a valid ticket beginning with a dash',applicantJoin.local_connected);
  await wait("document.querySelector('[data-welcome-phase=checking]')");await checkWelcome('checking-applicant');
  await click('[data-action=welcome-qualification]');await wait("document.querySelector('#action-form')");check('qualification form remains accessible from compact self-check',true);await click('#dialog .dialog-top button');
  const applicantFinish=await cli(null,'finish','--connection',applicantJoin.connection_file,'--accept-guide',applicantJoin.guide.sha256);
  check('unapproved engineer can connect and receive application guidance without proposal access',applicantFinish.connected&&!applicantFinish.ready&&!applicantFinish.context.access.member&&applicantFinish.context.available_after_ready.length===1);
  await capture('workspace-agent-applicant');
  await click('[data-tab=home]');await wait("document.querySelector('[data-action=apply]')");
  await click('[data-action=apply]');await run("document.querySelector('[name=about]').value='我会开发可靠的工程师协作界面，维护公开的测试与设计文档。';document.querySelector('[name=participation]').value='围绕阶段议程改进目录树与群聊，逐项验证权限、回归和实际界面。';document.querySelector('#action-form').requestSubmit()");
  await wait("document.querySelector('#workspace').textContent.includes('正在审核')");
  const app=(await root.call('/admin/applications')).applications.find(a=>a.status==='pending');assert.ok(app);
  await root.call('/admin/applications/review',{id:app.id,decision:'approved'});await cloud.refresh();await wait("document.querySelector('.mission')");
  check('approval opens developer home',await run("!document.querySelector('[data-tab=repository]').hidden && document.querySelector('[data-tab=management]').hidden"));await capture('workspace-developer-goals');
  check('human proposal controls are absent',await run("!document.querySelector('[data-action=nominate]')&&!document.querySelector('[data-action=agenda-new]')"));
  const ordinaryFetch=cloud.fetch;let accessReads=0;
  cloud.accessAt=Date.now()-11000;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, ordinaryFetch */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/access')){accessReads++;await delay(700);}return ordinaryFetch(url,options);};
  let started=Date.now();await click('[data-tab=repository]');await wait("document.querySelector('[data-tab=repository]').getAttribute('aria-current')==='page'");
  timings.tabResponseMs=Date.now()-started;
  check('verified tab responds before slow access check',timings.tabResponseMs<600);
  await wait("document.querySelector('.repository-await')");
  check('co-creation source remains empty and separate from reference source',await run("document.querySelector('.engineering').textContent.includes('等待第一份共创源码')"));
  await capture('workspace-cloud-pending');await click('[data-repo=code]');
  await wait("document.querySelector('#source-text')?.textContent.includes('Aieyra')");
  if(cloud.refreshFlight)await cloud.refreshFlight;
  cloud.fetch=ordinaryFetch;
  check('stale access recheck shares one request',accessReads===1);
  await click('[data-tab=home]');await wait("document.querySelector('.mission')");
  let homeReads=0;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: some, pathname.endsWith, URL, delay, ordinaryFetch */ cloud.fetch=async(url,options)=>{if(['/goals','/agendas'].some(route=>new URL(url).pathname.endsWith(route))&&options.method==='GET'){homeReads++;await delay(700);}return ordinaryFetch(url,options);};
  started=Date.now();await click('[data-home=agendas]');await wait("document.querySelector('.lanes')");
  timings.homeResponseMs=Date.now()-started;
  check('cached home data appears before slow cloud update',timings.homeResponseMs<600);
  await click('[data-lane=voting]');await click('[data-lane=approved]');
  await delay(750);cloud.fetch=ordinaryFetch;check('home refresh still requests both live resources',homeReads===2);
  await click('[data-home=goals]');await wait("document.querySelector('.mission')");
  await click('[data-tab=agents]');await wait("document.querySelector('.onboarding-stage')");
  check('minimal admission has no technical checklist or manual confirmation',await run("!document.querySelector('.checks')&&!document.querySelector('[data-agent-local]')&&!document.querySelector('[data-action=agent-refresh]')"));
  const beforeCopyFetch=cloud.fetch;/* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, beforeCopyFetch */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/access'))await delay(700);return beforeCopyFetch(url,options);};
  let instructions='';const clipboard=require('electron').clipboard,originalWrite=clipboard.writeText;
  /* @chain-region verifyWorkspace.clipboard.writeText */ clipboard.writeText=value=>{instructions=value;};
  started=Date.now();try{await click('[data-action=agent-copy]');timings.copyFeedbackMs=Date.now()-started;
    check('copy keeps one stable action',await run("document.querySelectorAll('[data-action=agent-copy]').length===1&&document.querySelector('[data-action=agent-copy]').textContent.includes('复制接入信息')&&!document.querySelector('[data-action=agent-resume-help]')"));
    await wait("!document.querySelector('[data-action=agent-copy]').disabled");}finally{clipboard.writeText=originalWrite;cloud.fetch=beforeCopyFetch;}
  check('copy responds immediately under slow network',timings.copyFeedbackMs<600);
  const issued=await onboarding.issue();
  fs.writeFileSync(path.join(output,'copy-check.json'),JSON.stringify({ticket:instructions.includes(issued.ticket),python:instructions.includes(python),join:instructions.includes('join --discovery'),progressive:instructions.includes('handbook.path'),length:instructions.length}));
  check('copied instructions contain executable paths and autonomous guidance',instructions.includes(issued.ticket)&&instructions.includes(python)&&instructions.includes('join --discovery')&&instructions.includes('guide.prompt')&&instructions.includes('handbook.path')&&instructions.length<1600&&!instructions.includes('亲爱的工程师'));
  check('ticket is encrypted and discovery is public metadata only',!fs.readFileSync(onboarding.file(cloud.cachedAccess().user.id)).includes(Buffer.from(issued.ticket))&&!fs.readFileSync(issued.discovery).includes(Buffer.from(issued.ticket)));
  await capture('workspace-agent-empty');
  let joined=await cli(null,'join','--discovery',issued.discovery,'--ticket',issued.ticket,'--name','隔离验证 Agent');
  let keyFile=joined.key_file,connectionFile=joined.connection_file;
  check('join automatically creates its own station and returns rules to read',joined.local_connected&&joined.guide.prompt&&joined.next.argv.includes('finish')&&joined.handbook.required&&fs.existsSync(joined.handbook.path)&&fs.readFileSync(joined.handbook.path,'utf8').includes('reset_required'));
  await wait("document.querySelector('[data-welcome-phase=checking]')");await checkWelcome('checking-member');
  const timedOutKey=keyFile,timedOutConnection=connectionFile,timedOutAgent=JSON.parse(fs.readFileSync(keyFile,'utf8')).id;
  await execFile(python,['-B','-c','import sqlite3,time,sys;db=sqlite3.connect(sys.argv[1]);db.execute("UPDATE proposal_agents SET admission_started=?,admission_completed=NULL WHERE id=?",(time.time()-1801,sys.argv[2]));db.commit();db.close()',path.join(fixtureDir,'together','together.sqlite'),timedOutAgent],{windowsHide:true,timeout:15000});
  const expiredEnrollment=onboarding.read(cloud.cachedAccess().user.id);expiredEnrollment.admission_deadline=Date.now()-1000;onboarding.save(expiredEnrollment);onboarding.workSnapshot=null;
  await click('[data-tab=home]');await click('[data-tab=agents]');await wait("document.querySelector('[data-welcome-phase=expired]')");
  check('expired admission stops checking and offers one reconnect action',await run("document.querySelectorAll('.welcome-stage button').length===1&&!document.querySelector('#agent-flow')&&document.querySelector('.welcome-stage').textContent.includes('30分钟')"));
  await capture('workspace-agent-timeout');await checkWelcome('expired');
  let timeoutFailure;try{await cli(null,'finish','--connection',timedOutConnection,'--accept-guide',joined.guide.sha256);}catch(error){timeoutFailure=JSON.parse(error.stderr);}
  check('actual packaged CLI rejects expired resume and explains fresh onboarding',timeoutFailure?.status===410&&timeoutFailure.reconnect_required===true);
  let replacementInstructions='';const beforeReplacementCopy=clipboard.writeText;/* @chain-region verifyWorkspace.clipboard.writeText */ clipboard.writeText=value=>{replacementInstructions=value;};
  try{await click('[data-action=agent-copy]');await wait("!document.querySelector('[data-action=agent-copy]').disabled");}finally{clipboard.writeText=beforeReplacementCopy;}
  const fresh=await onboarding.issue();
  check('timeout reconnect issues fresh material and remains stable on copy retry',fresh.ticket!==issued.ticket&&replacementInstructions.includes(fresh.ticket)&&(await onboarding.issue()).ticket===fresh.ticket);
  joined=await cli(null,'join','--discovery',fresh.discovery,'--ticket',fresh.ticket,'--name','隔离验证 Agent');keyFile=joined.key_file;connectionFile=joined.connection_file;
  // The CLI status command restores the local lease. Observe fresh checks before
  // that legitimate verification so the assertion detects inherited checks.
  const freshKey=JSON.parse(fs.readFileSync(keyFile,'utf8'));
  const freshResponse=await fetch(together+'/api/agent/status',{headers:{Authorization:'Bearer '+freshKey.key}});
  assert.equal(freshResponse.status,200);const freshStatus=await freshResponse.json();
  fs.writeFileSync(path.join(output,'fresh-admission-status.json'),JSON.stringify(freshStatus,null,2));
  check('reconnect creates a new identity and repeats all six checks',keyFile!==timedOutKey&&connectionFile!==timedOutConnection&&Object.values(freshStatus.checks).every(v=>!v));
  let staleKeyRejected=false;try{await cli(timedOutKey,'check-api');}catch(error){staleKeyRejected=JSON.parse(error.stderr).status===401;}
  check('old unfinished cloud credential is rejected after reconnect',staleKeyRejected);
  issued.ticket=fresh.ticket;
  await click('[data-tab=home]');await click('[data-tab=agents]');await wait("document.querySelector('[data-welcome-phase=checking]')");
  const wrong=await cli(null,'finish','--connection',connectionFile,'--accept-guide','0'.repeat(64));
  check('unread or stale guide digest never completes admission',wrong.requires_read&&!wrong.ready);
  let lostProof=false;const slowFetch=cloud.fetch;/* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, slowFetch, Error */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/agents/local-challenge'))await delay(700);const result=await slowFetch(url,options);if(!lostProof&&new URL(url).pathname.endsWith('/agents/local-confirm')&&result.ok){lostProof=true;throw Error('isolated lost proof response');}return result;};
  const finishing=cli(null,'finish','--connection',connectionFile,'--accept-guide',joined.guide.sha256);
  await wait("document.querySelector('#agent-flow')?.classList.contains('agent-busy')&&document.querySelector('#agent-flow')?.classList.contains('api-busy')");
  check('connected Agent shows actual self-check progress',await run("document.querySelectorAll('[data-check]').length===6&&!document.querySelector('.work-status')"));
  check('actual request drives Agent and API activity',await run("getComputedStyle(document.querySelector('.agent-wire i')).animationName==='request-transit'"));
  await capture('workspace-agent-activity');
  const finished=await finishing;cloud.fetch=slowFetch;
  check('lost proof reply is automatically recovered with the same identity',lostProof);
  check('one copied instruction completes all six checks without manual configuration',finished.ready&&Object.values(finished.checks).every(Boolean));
  check('onboarding reads real membership phase participants and capabilities',finished.context.access.member&&finished.context.participants.total>=1&&finished.context.engineering.capabilities.local_vm_protocol===2&&finished.context.engineering.repository.vm_ready===null);
  check('Agent receives situation and role without the human operation timeline',finished.context.situation.identity.role==='engineer'&&finished.context.situation.references.brief&&!('operations' in finished.context));
  await click('[data-tab=home]');await click('[data-tab=agents]');await wait("document.querySelector('.personal-desk')");
  check('admission opens live working context automatically',await run("!!document.querySelector('.work-status')&&document.querySelector('.work-status').textContent.includes('等待下一项任务')&&!document.querySelector('.station-heading')&&!document.querySelector('.station-agendas')&&document.querySelector('.station-manage').textContent.includes('工程师资格已批准')&&!document.querySelector('.station-manage').open"));
  await delay(3700);check('ordinary admission feedback disappears',await run("document.querySelector('#notice').hidden&&document.querySelector('#work-activity').hidden"));
  await click('[data-tab=home]');await click('[data-tab=agents]');await wait("document.querySelector('.work-status')");check('returning to work does not repeat admission feedback',await run("document.querySelector('#notice').hidden"));
  await capture('workspace-agent-ready');
  await new Promise(resolve=>{window.webContents.once('did-finish-load',resolve);window.webContents.reload();});await wait("document.querySelector('.work-status')");check('restored admitted session opens working status by default',true);
  check('idle view does not animate fake traffic',await run("!document.querySelector('#agent-flow').classList.contains('agent-busy')&&!document.querySelector('#agent-flow').classList.contains('api-busy')"));
  const again=await cli(null,'join','--discovery',issued.discovery,'--ticket',issued.ticket,'--name','隔离验证 Agent');
  check('same copied instruction recovers the same identity',again.key_file===keyFile&&again.connection_file===connectionFile&&(await cloud.call('/agents')).agents.filter(a=>!a.revoked).length===1);
  await settleQuota();
  const ownConfig=JSON.parse(fs.readFileSync(connectionFile,'utf8'));
  const /* @chain-region verifyWorkspace.httpCall | calls: Promise, request, require, response.on, chunks.push, resolve, JSON.parse, Buffer.concat … */ httpCall=(route,body,token=ownConfig.resume,headers={})=>new Promise((resolve,reject)=>{
    const req=require('node:http').request(onboarding.origin+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,value:JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
  check('browser Origin cannot redeem tickets',(await httpCall('/context',{},ownConfig.resume,{Origin:'https://attacker.invalid'})).status===403);
  check('DNS rebinding Host is rejected',(await httpCall('/context',{},ownConfig.resume,{Host:'attacker.invalid'})).status===403);
  check('unknown context fields are rejected',(await httpCall('/context',{path:'/admin/overview'})).status===400);
  check('oversized broker payload is rejected',(await httpCall('/context',{padding:'x'.repeat(17000)})).status===413);
  check('broker rejects generic signed routes',(await httpCall('/admin/overview',{})).status===404);
  check('foreign resume credential cannot read project context',(await httpCall('/context',{},'x'.repeat(43))).status===401);
  check('ticket cannot be rebound to another Agent',(await httpCall('/prepare',{request_id:ownConfig.request_id,resume:ownConfig.resume,token:ownConfig.token,name:'Other Agent'},issued.ticket)).status===409);
  check('unreported foreign Agent cannot receive a local proof',(await httpCall('/confirm',{id:'f'.repeat(32),session_id:ownConfig.session_id})).status===409);
  const partial=await httpCall('/prepare',{request_id:ownConfig.request_id,resume:ownConfig.resume,token:ownConfig.token,name:ownConfig.name},issued.ticket);
  check('lost prepare reply can be retried without duplicating the credential',partial.status===200&&partial.value.local.actor_id===ownConfig.actor_id);
  await settleQuota();
  await execFile(python,['-B','-c','import sqlite3,time,sys;db=sqlite3.connect(sys.argv[1]);db.execute("UPDATE agent_sessions SET lease_until=? WHERE id=?",(time.time()-1,sys.argv[2]));db.commit();db.close()',path.join(host.dataRoot,'shared','control.sqlite'),ownConfig.session_id],{windowsHide:true,timeout:15000});
  const expired=await httpCall('/confirm',{id:JSON.parse(fs.readFileSync(keyFile)).id,session_id:ownConfig.session_id});
  check('expired real local lease cannot pass a desktop admission proof',expired.status===409);
  const recovered=await cli(null,'finish','--connection',connectionFile,'--accept-guide',joined.guide.sha256);
  const afterRecovery=JSON.parse(fs.readFileSync(connectionFile));
  check('finish automatically reconnects expired lease and returns to six checks',recovered.ready&&afterRecovery.session_id!==ownConfig.session_id&&afterRecovery.actor_id===ownConfig.actor_id&&afterRecovery.key_file===keyFile);
  await settleQuota();
  const oldPort=onboarding.origin;
  await onboarding.close();onboarding.closed=false;await onboarding.start();
  const resumed=await cli(null,'context','--connection',connectionFile);
  check('broker restart discovers new endpoint and retains the same identity',resumed.ready&&fs.existsSync(issued.discovery)&&JSON.parse(fs.readFileSync(connectionFile)).agent_id===ownConfig.agent_id);
  await settleQuota();
  await window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const beforeMotion=cloud.fetch;/* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, beforeMotion */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/goals'))await delay(700);return beforeMotion(url,options);};
  const pendingContext=cli(null,'context','--connection',connectionFile);
  await wait("document.querySelector('#agent-flow').classList.contains('agent-busy')");
  check('reduced motion keeps activity visible without movement',await run("getComputedStyle(document.querySelector('.agent-wire i')).animationName==='none'"));
  await pendingContext;cloud.fetch=beforeMotion;await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});window.webContents.debugger.detach();
  await click('.station-manage summary');
  window.setSize(900,700);window.webContents.setZoomFactor(1.25);await delay(300);
  await run("document.querySelector('[data-action=agent-copy]').scrollIntoView({block:'nearest'})");
  check('onboarding primary action fits at 125 percent',await run("(()=>{const r=document.querySelector('[data-action=agent-copy]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()"));
  check('working dashboard has no horizontal overflow at 125 percent',await run("document.querySelector('#content').scrollWidth<=document.querySelector('#content').clientWidth+1"));
  await run("document.querySelector('#content').scrollTop=0");await capture('workspace-agent-125');window.webContents.setZoomFactor(1);window.setSize(1280,720);
  // Real packaged CLI -> local service -> personal station; no synthetic state is injected into the renderer.
  const reportFile=path.join(output,'own-work-report.json');
  const reportBody={request_id:'desktop-own-report',state:'running',task:'验证自己的工位',summary:'正在核对工作状态与公开投票回执。'};
  fs.writeFileSync(reportFile,JSON.stringify(reportBody));
  const firstReport=await cli(null,'report','--connection',connectionFile,'--body-file',reportFile);
  check('packaged report command records actual work',firstReport.reported&&!firstReport.replayed);
  await wait("document.querySelector('.station-report')?.textContent.includes('正在核对')");
  const firstStation=await onboarding.personalStation();
  check('personal station uses the same live office actor and report',firstStation.actor===ownConfig.actor_id&&firstStation.snapshot.agents[0].runtime.work_report.task===reportBody.task);
  check('personal desk reflects current runtime without unrelated stations',await run("document.querySelector('.personal-desk').dataset.state==='working'&&document.querySelectorAll('.personal-desk .floor-seat').length===1"));
  const repeatedReport=await cli(null,'report','--connection',connectionFile,'--body-file',reportFile);
  check('report replay preserves timestamp and does not repeat work',repeatedReport.replayed&&(await onboarding.personalStation()).snapshot.agents[0].runtime.work_report.at===firstStation.snapshot.agents[0].runtime.work_report.at);
  fs.writeFileSync(reportFile,JSON.stringify({...reportBody,request_id:'desktop-own-wait',state:'waiting_user',summary:'等待工程师确认下一项任务。'}));
  await cli(null,'report','--connection',connectionFile,'--body-file',reportFile);
  await wait("document.querySelector('.personal-desk')?.dataset.state==='waiting'");
  await capture('workspace-station-waiting');
  fs.writeFileSync(reportFile,JSON.stringify({...reportBody,request_id:'desktop-own-done',state:'idle',summary:'已完成工位状态和汇报验证。'}));
  await cli(null,'report','--connection',connectionFile,'--body-file',reportFile);
  await wait("document.querySelector('.station-report')?.textContent.includes('已完成工位')");
  check('completed work has an idle state and retained result',await run("document.querySelector('.personal-desk').dataset.state==='idle'"));
  const preExpiry=JSON.parse(fs.readFileSync(connectionFile));
  await execFile(python,['-B','-c','import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);db.execute("UPDATE agent_sessions SET lease_until=0 WHERE id=?",(sys.argv[2],));db.commit();db.close()',path.join(host.dataRoot,'shared','control.sqlite'),preExpiry.session_id],{windowsHide:true,timeout:15000});
  fs.writeFileSync(reportFile,JSON.stringify({...reportBody,request_id:'desktop-own-reconnect',state:'running',summary:'重新连接后继续验证参与流程。'}));
  await settleQuota();await cli(null,'report','--connection',connectionFile,'--body-file',reportFile);
  const reconnected=JSON.parse(fs.readFileSync(connectionFile)),verified=await cli(keyFile,'status');
  check('work report reconnects expired lease and synchronizes the verified cloud session',reconnected.session_id!==preExpiry.session_id&&verified.ready&&verified.local_session_id===reconnected.session_id);
  await wait("document.querySelector('.station-report')?.textContent.includes('重新连接后')");
  await capture('workspace-personal-station');
  await click('.station-report-meta [data-read-body]');
  check('work report opens its complete text in a reading dialog',await run("document.querySelector('#detail-dialog').open&&document.querySelector('.detail-content').textContent==='重新连接后继续验证参与流程。'"));
  await capture('workspace-report-detail');await closeDetail();
  check('closing work detail restores keyboard focus',await run("document.activeElement.matches('.station-report-meta [data-read-body]')"));
  const headerPoint=await run("(()=>{const r=document.querySelector('#situation-title').getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)};})()");
  window.webContents.sendInputEvent({type:'mouseMove',...headerPoint});
  const hoveredTitle=await run("document.querySelector('#situation-title').textContent");await delay(9500);
  check('situation carousel pauses while the engineer reads under the pointer',await run("document.querySelector('#situation-title').textContent")===hoveredTitle);
  await window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click('[data-carousel="situation:next"]');
  check('reduced motion removes the title transition but retains manual navigation',await run("getComputedStyle(document.querySelector('#situation-title')).animationName==='none'"));
  window.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});const reducedTitle=await run("document.querySelector('#situation-title').textContent");await delay(9500);
  check('reduced motion disables automatic title rotation',await run("document.querySelector('#situation-title').textContent")===reducedTitle);
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});window.webContents.debugger.detach();

  const personalBefore=onboarding.local;
  /* @chain-region verifyWorkspace.onboarding.local | calls: Error, personalBefore.call */ onboarding.local=async route=>{if(route==='/api/snapshot')throw Error('isolated station interruption');return personalBefore.call(onboarding,route);};
  await wait("document.querySelector('.station-work .station-warning')");
  check('station failure retains history without claiming current work',await run("document.querySelector('.personal-desk').dataset.state!=='working'&&document.querySelector('.station-report').textContent.includes('重新连接后')"));
  onboarding.local=personalBefore;await wait("!document.querySelector('.station-work .station-warning')&&document.querySelector('.personal-desk')?.dataset.state==='working'");
  window.setSize(700,540);window.webContents.setZoomFactor(1.25);await delay(250);
  check('personal station fits a narrow 125 percent window',await run("document.querySelector('#content').scrollWidth<=document.querySelector('#content').clientWidth+1"));
  await run("document.querySelector('#content').scrollTop=0");await capture('workspace-personal-narrow');
  await click('.station-report-meta [data-read-body]');
  check('reading dialog fits narrow 125 percent viewport',await run("(()=>{const n=document.querySelector('#detail-dialog'),r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&n.scrollWidth<=n.clientWidth+1;})()"));
  await capture('workspace-detail-narrow');await click('#detail-dialog .dialog-top button');
  window.webContents.setZoomFactor(1);window.setSize(1280,720);
  await require('./aidebug.cjs').fixture(host,profile);
  const localRequest=require('./aidebug.cjs').request,currentConnection=JSON.parse(fs.readFileSync(connectionFile));
  for(let i=0;i<2;i++){
    const sent=await localRequest(host.origin,'/api/agent/v1/center/message',{request_id:'own-conversation-'+i,session_id:currentConnection.session_id,project:'os',kind:'discussion',body:i?'验证结果：工作状态与汇报已同步。':'工作进展：正在检查自己的工位。'},{Authorization:'Bearer '+currentConnection.token});
    check('own Agent posts a related local exchange '+i,sent.status===200);
  }
  await wait("document.querySelector('#link-activity-list')?.textContent.includes('工作进展')&&document.querySelector('#link-activity-list')?.textContent.includes('验证结果')&&document.querySelectorAll('[data-activity-id^=message-]').length===2");
  check('Link activity contains own exchanges and excludes unrelated chatter',await run("!document.querySelector('#link-activity-list').textContent.includes('独立验收')&&document.querySelectorAll('[data-activity-id^=message-]').length===2"));
  check('Link operation feed contains real server actions',await run("document.querySelector('#link-activity-list').textContent.includes('已读取')"));
  await capture('workspace-related-conversation');
  await checkSurface('station','.station-report-meta [data-read-body],.activity-footer button,.station-manage>summary');
  await click('[data-activity-id^=message-] [data-read-body]');
  check('exchange activity opens the original full message',await run("document.querySelector('.detail-content').textContent.includes('工作进展')||document.querySelector('.detail-content').textContent.includes('验证结果')"));
  await closeDetail();
  const carouselReading=await run("(()=>{const scroller=document.querySelector('#link-activity-scroll'),top=scroller.getBoundingClientRect().top;document.querySelector('[data-carousel=\"situation:next\"]').click();return {before:top,after:scroller.getBoundingClientRect().top};})()");
  fs.writeFileSync(path.join(output,'carousel-reading-position.json'),JSON.stringify(carouselReading,null,2));
  check('situation rotation keeps the reading area in place',Math.abs(carouselReading.after-carouselReading.before)<2);
  const logAnchor=await run("(()=>{const s=document.querySelector('#link-activity-scroll');s.scrollTop=60;const a=[...s.querySelectorAll('[data-activity-id]')].find(n=>n.getBoundingClientRect().bottom>s.getBoundingClientRect().top);return {id:a.dataset.activityId,top:a.getBoundingClientRect().top,scrollTop:s.scrollTop,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,scrollerTop:s.getBoundingClientRect().top,contentTop:document.querySelector('#content').scrollTop};})()");
  await localRequest(host.origin,'/api/agent/v1/center/message',{request_id:'own-conversation-reading',session_id:currentConnection.session_id,project:'os',kind:'discussion',body:'新增协作消息：保留工程师正在阅读的位置。'},{Authorization:'Bearer '+currentConnection.token});
  await wait("document.querySelector('#link-activity-list')?.textContent.includes('新增协作消息')");
  const logAfter=await run(`(()=>{const s=document.querySelector('#link-activity-scroll'),a=document.querySelector('[data-activity-id="${logAnchor.id}"]');return {top:a.getBoundingClientRect().top,scrollTop:s.scrollTop,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,scrollerTop:s.getBoundingClientRect().top,contentTop:document.querySelector('#content').scrollTop,rows:[...s.querySelectorAll('[data-activity-id]')].map(n=>({id:n.dataset.activityId,top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height}))};})()`);
  fs.writeFileSync(path.join(output,'activity-reading-position.json'),JSON.stringify({before:logAnchor,after:logAfter},null,2));
  check('new Link activity preserves the engineers current reading position',await run(`Math.abs(document.querySelector('[data-activity-id="${logAnchor.id}"]').getBoundingClientRect().top-${logAnchor.top})<2`));

  // The fault suite intentionally exhausts the shared quota. Respect refill before the business UI suite.
  await delay(Math.max(0,(40-cloud.gate.tokens)/3*1000,cloud.gate.retryAt-Date.now())+100);
  const goalFile=path.join(output,'agent-goal.json');fs.writeFileSync(goalFile,JSON.stringify({request_id:'workspace-goal-1',title:'完善工程师协作工作台',summary:'让工程师通过公开的议程协作推进下一阶段开发。',acceptance:'目录、群聊和权限全部通过可复现验收。'}));
  const proposed=await cli(keyFile,'nominate','--body-file',goalFile);
  check('Agent proposal retry preserves original candidate',(await cli(keyFile,'nominate','--body-file',goalFile)).id===proposed.id);
  check('local Agent history remains available to the Agent',(await cli(keyFile,'memory')).events.some(item=>item.action==='nominate'));
  await click('[data-tab=home]');await wait("document.querySelector('.goal-candidates')?.textContent.includes('完善工程师协作工作台')");
  const nominated=await root.call('/goals'),candidate=nominated.candidates.find(c=>c.id===proposed.id);
  const detailFetch=cloud.fetch;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, detailFetch */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/goals')&&options.method==='GET')await delay(700);return detailFetch(url,options);};
  started=Date.now();await click('[data-goal="'+candidate.id+'"]');await wait("document.querySelector('#dialog').open&&document.querySelector('#dialog-title').textContent.includes('完善工程师协作工作台')");
  timings.goalPreviewMs=Date.now()-started;check('cached goal detail opens before slow cloud response',timings.goalPreviewMs<600);
  await wait("document.querySelector('#comment-form')");cloud.fetch=detailFetch;
  const fullComment='目标讨论使用真实键盘输入，保留公开协作意见。'+('完整回应应保留上下文与公开理由。'.repeat(20))+'回应全文结束。';await type('#comment-form textarea',fullComment);await click('#comment-form button');
  await wait("document.querySelector('#discussion-comments')?.textContent.includes('真实键盘输入')");
  await click('[data-like]');await wait("document.querySelector('[data-like]')?.getAttribute('aria-pressed')==='true'");
  check('goal comments and likes persist independently of ballots', (await cloud.call('/discussions?kind=goal&id='+candidate.id)).likes===1);
  await capture('workspace-goal-discussion');
  await type('#comment-form textarea','保留未提交的回应草稿');
  check('discussion body scrolls below a fixed reachable dialog header',await run("(()=>{const d=document.querySelector('#dialog'),b=document.querySelector('#dialog-body'),h=d.querySelector('.dialog-top'),top=h.getBoundingClientRect().top;b.scrollTop=b.scrollHeight;const r=h.getBoundingClientRect();return b.scrollTop>0&&d.scrollTop===0&&Math.abs(r.top-top)<1&&r.bottom<=b.getBoundingClientRect().top+1&&r.top>=0&&r.bottom<innerHeight;})()"));
  await click('#discussion-comments [data-read-body]');
  const discussionScroll=await run("document.querySelector('#dialog-body').scrollTop");
  check('folded comment opens complete text while preserving parent and draft',await run("document.querySelector('#dialog').open&&document.querySelector('.detail-content').textContent.endsWith('回应全文结束。')&&document.querySelector('#comment-form textarea').value==='保留未提交的回应草稿'"));
  await capture('workspace-comment-detail');await closeDetail();
  check('Escape closes only the reading layer and preserves parent scroll and focus',await run("document.querySelector('#dialog').open&&document.querySelector('#dialog-body').scrollTop==="+discussionScroll+"&&document.activeElement.matches('#discussion-comments [data-read-body]')&&document.querySelector('#comment-form textarea').value==='保留未提交的回应草稿'"));
  await click('[data-read-title="验收标准"]');
  check('goal acceptance opens in its own reading dialog',await run("document.querySelector('#detail-title').textContent==='验收标准'&&document.querySelector('.detail-content').textContent.length>0"));await closeDetail();
  await click('#dialog .dialog-top button');
  const electionFile=path.join(output,'agent-election.json');fs.writeFileSync(electionFile,JSON.stringify({request_id:'workspace-election-1',role:'manager',goal_id:candidate.id,statement:'我会组织透明且可复验的阶段开发，认真处理其他候选人的方案。',commitment:'每天投入一小时，及时公开进度和阻塞。',agenda:{title:'验证可靠的协作通信',summary:'为不同工程师建立可复现的协作通信验证。',plan:'**开发计划**\n先读取接口，再进行完整验证。\n'+('验证完整计划。'.repeat(900))+'\n计划全文结束。<img src=x onerror=alert(1)>',acceptance:'断线恢复与权限隔离检查通过，证据可追溯。',target:'next'}}));
  const nomination=await cli(keyFile,'election','--action','nominate','--body-file',electionFile);
  check('packaged Agent CLI can nominate for leadership',(await cli(keyFile,'election','--action','nominate','--body-file',electionFile)).id===nomination.id);
  const nominationContext=(await cli(null,'context','--connection',connectionFile)).context;
  check('member context reports its own nomination and real human voting eligibility',nominationContext.cycle.eligible&&nominationContext.leadership.candidacy.id===nomination.id&&!nominationContext.available_after_ready.some(action=>action.includes('报名')));
  await settleQuota();
  await click('[data-tab=agents]');await wait("document.querySelector('.station-identity')?.textContent.includes('参选中')");
  check('own identity separates goal and role votes from the project carousel',await run("document.querySelector('.station-identity').textContent.includes('职位支持 0')&&document.querySelector('.station-identity').textContent.includes('目标支持 0')"));
  await capture('workspace-working-nomination');
  if(await run("document.querySelector('.station-manage').open"))await click('.station-manage summary');
  const beforeOffline=cloud.fetch;onboarding.workSnapshot.next_at=0;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: Error */ cloud.fetch=async()=>{throw Error('isolated offline dashboard');};
  await wait("document.querySelector('#station-warning')&&!document.querySelector('#station-warning').hidden",350);
  check('stale warning remains visible outside collapsed management',await run("document.querySelector('#station-warning').textContent.includes('上次态势')&&!document.querySelector('.station-manage').open"));
  const offline=onboarding.workSnapshot.value;check('offline work snapshot retains timestamp and is explicitly stale',offline.stale&&!!offline.observed_at&&offline.context.leadership.candidacy.id===nomination.id);await capture('workspace-working-offline');
  cloud.fetch=beforeOffline;
  await wait("document.querySelector('.work-sync')?.textContent.includes('已同步')",350);
  await wait("document.querySelector('#station-warning').hidden");
  await delay(3700);check('sync recovery feedback disappears',await run("document.querySelector('#notice').hidden"));
  check('work snapshot resumes automatically without new identity',(await onboarding.workStatus()).agents[0].id===ownConfig.agent_id);
  await click('[data-tab=home]');await settleQuota();
  const third=new CloudClient({directory:path.join(profile,'third-account'),safeStorage,origin:cloud.origin});await login(third,3);
  const thirdAbout='I validate collaboration with independent local fixtures.';
  await third.call('/apply',{about:thirdAbout,participation:thirdAbout});const thirdApp=(await third.refresh()).access.application.id;
  await root.call('/admin/applications/review',{id:thirdApp,decision:'approved'});const thirdId=(await third.refresh()).access.user.id;
  await click('[data-home=goals]');await wait("document.querySelector('.election-candidate')");check('leadership voting is embedded in goals without a separate navigation item',await run("!!document.querySelector('.mission')&&!document.querySelector('[data-home=elections]')&&document.querySelector('.election-records').open"));await capture('workspace-election-candidates');
  const healthyHomeFetch=cloud.fetch;let failedHomeReads=0;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, Response, JSON.stringify, healthyHomeFetch */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/elections')){failedHomeReads++;return new Response(JSON.stringify({error:'隔离验证：负责人资料暂不可用。'}),{status:500,headers:{'content-type':'application/json'}});}return healthyHomeFetch(url,options);};
  await click('[data-tab=repository]');await wait("document.querySelector('[data-repo]')");await click('[data-tab=home]');
  await wait("document.querySelector('.surface')?.dataset.syncState==='stale'&&!document.querySelector('#surface-status').hidden");
  check('failed leadership update retains previous proposals and public voting controls',await run("document.querySelector('.election-candidate')?.textContent.includes('透明且可复验')&&!!document.querySelector('[data-election-vote]')&&document.querySelector('#surface-status').textContent.includes('正在显示上次内容')"));
  await delay(3700);check('update failure persists beyond transient feedback',await run("!document.querySelector('#surface-status').hidden"));await capture('workspace-global-stale');
  await checkSurface('goals-stale','#surface-status button,.election-records>summary,[data-goal]');
  const failedBeforeRetry=failedHomeReads;await click('#surface-status [data-action=refresh]');
  for(let i=0;i<100&&failedHomeReads===failedBeforeRetry;i++)await delay(50);
  await delay(180);
  check('unsuccessful manual retry never claims the page is updated',failedHomeReads>failedBeforeRetry&&await run("document.querySelector('.surface').dataset.syncState==='stale'&&!document.querySelector('#surface-status').hidden&&(document.querySelector('#notice').hidden||!document.querySelector('#notice').textContent.includes('已更新'))"));
  const failedBeforePulse=failedHomeReads;await run("document.dispatchEvent(new Event('visibilitychange'))");
  for(let i=0;i<100&&failedHomeReads===failedBeforePulse;i++)await delay(50);
  check('automatic update also retains stale data until the failing resource recovers',failedHomeReads>failedBeforePulse&&await run("document.querySelector('.surface').dataset.syncState==='stale'&&!!document.querySelector('.election-candidate')"));
  cloud.fetch=healthyHomeFetch;await click('#surface-status [data-action=refresh]');
  await wait("document.querySelector('.surface')?.dataset.syncState==='current'&&document.querySelector('#surface-status').hidden");
  check('successful retry restores the existing view and clears its persistent warning',await run("document.querySelector('.election-records').open&&!!document.querySelector('[data-election-vote]')"));
  await delay(3700);check('successful manual feedback disappears',await run("document.querySelector('#notice').hidden"));
  await click('.election-candidate>.read-detail');
  check('candidate commitment opens from its compact card',await run("document.querySelector('.detail-content').textContent.includes('每天投入一小时')"));await closeDetail();
  await click('[data-candidate]');await wait("document.querySelector('#dialog-body').textContent.includes('公开职位票')");await capture('workspace-election-plan');
  await click('[data-read-title="配套议程 · 开发计划"]');
  check('full plan beyond six thousand characters remains readable and HTML inert',await run("document.querySelector('.detail-content').textContent.includes('计划全文结束。<img')&&!document.querySelector('.detail-content img')&&document.querySelector('.detail-content strong')?.textContent==='开发计划'"));
  await delay(350);
  const longReader=await run("(()=>{const nodes=[document.querySelector('#detail-dialog'),...document.querySelectorAll('#detail-dialog *')];const n=nodes.find(n=>n.scrollHeight>n.clientHeight+20&&['auto','scroll'].includes(getComputedStyle(n).overflowY));if(!n)return null;return {tag:n.className||n.id,top:n.scrollTop,focused:n===document.activeElement,header:document.querySelector('#detail-dialog .dialog-top').getBoundingClientRect().top,hidden:getComputedStyle(n).scrollbarWidth==='none'};})()");
  check('long reading view keeps a scroll container with hidden scrollbar',longReader?.hidden);
  check('reading opens with keyboard focus in the scrollable text',longReader?.focused);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'PageDown'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'PageDown'});await delay(300);
  check('long reading view scrolls by keyboard',await run("document.activeElement.scrollTop>0"));
  const readerGeometry=await run(`(()=>{const d=document.querySelector('#detail-dialog'),h=d.querySelector('.dialog-top'),b=d.querySelector('.detail-content');return {before:${longReader.header},headerTop:h.getBoundingClientRect().top,headerBottom:h.getBoundingClientRect().bottom,bodyTop:b.getBoundingClientRect().top,outerScroll:d.scrollTop,bodyScroll:b.scrollTop};})()`);
  fs.writeFileSync(path.join(output,'reader-scroll-geometry.json'),JSON.stringify(readerGeometry,null,2));
  check('reading title stays fixed outside the scrolling text',Math.abs(readerGeometry.headerTop-readerGeometry.before)<1&&readerGeometry.headerBottom<=readerGeometry.bodyTop+1&&readerGeometry.outerScroll===0);

  await capture('workspace-plan-detail');await closeDetail();await click('#dialog .dialog-top button');
  let lostVote=false,voteWrites=0;const beforeVote=cloud.fetch;/* @chain-region verifyWorkspace.cloud.fetch | calls: beforeVote, pathname.endsWith, URL, Error */ cloud.fetch=async(url,options)=>{const response=await beforeVote(url,options);if(new URL(url).pathname.endsWith('/elections/vote')&&options.method==='POST'){voteWrites++;if(!lostVote&&response.ok){lostVote=true;throw Error('isolated committed ballot reply lost');}}return response;};
  await click('[data-election-vote]');await type('#action-form [name=reason]','愿意由这位工程师组织透明且可验证的工作。');await click('#action-form button');await wait("!document.querySelector('#dialog').open");
  cloud.fetch=beforeVote;check('committed human ballot recovers from lost reply without resubmission',lostVote&&voteWrites===1);
  for(const voter of [root,third])await voter.call('/elections/vote',{cycle_id:nominated.cycle.id,role:'manager',candidate_id:nomination.id,reason:'隔离验收：支持公开责任与协作安排。'});
  check('leadership votes do not add goal ballots',(await cloud.call('/goals')).candidates.find(c=>c.id===candidate.id).votes.support===0);
  await root.call('/goals/vote',{cycle_id:nominated.cycle.id,candidate_id:candidate.id,choice:'support',reason:'隔离验收：确认本阶段目标。'});
  const dbPath=path.join(fixtureDir,'together','together.sqlite');
  await execFile(python,['-B','-c','import sqlite3,time,sys;db=sqlite3.connect(sys.argv[1]);db.execute("UPDATE goal_cycles SET closes=? WHERE id=?",(time.time()-1,sys.argv[2]));db.commit();db.close()',dbPath,nominated.cycle.id],{windowsHide:true,timeout:15000});
  const pool=await cloud.call('/elections');check('24 hour closure freezes high vote pool and elects manager',pool.pool[0].candidate_id===candidate.id&&pool.roles.manager.user_id===cloud.cachedAccess().user.id&&!pool.selected);
  const closedContext=(await cli(null,'context','--connection',connectionFile)).context;
  check('closed election context does not advertise another nomination or closed goal votes',!closedContext.available_after_ready.some(action=>action.includes('报名')||action.includes('目标页')));
  await settleQuota();
  await click('[data-home=agendas]');await click('[data-home=goals]');await wait("document.querySelector('[data-action=election-select]')");await capture('workspace-election-pool');
  await click('[data-action=election-select]');await wait("document.querySelector('#selection-form')");await type('#selection-form [name=reason]','本轮先完成范围清晰且可复验的协作目标。');await click('#selection-form button');await wait("document.querySelector('#decision-instructions')");
  const decisionText=await run("document.querySelector('#decision-instructions').textContent"),authorizationId=decisionText.match(/授权 ID：([a-f0-9]{32})/)[1];
  const decisionFile=path.join(output,'agent-decision.json');fs.writeFileSync(decisionFile,JSON.stringify({request_id:'workspace-execute-decision',authorization_id:authorizationId}));
  await cli(keyFile,'election','--resource','authorization','--id',authorizationId);await cli(keyFile,'election','--action','execute','--body-file',decisionFile);
  check('authorized Agent selects a goal from the frozen pool',(await cloud.call('/goals')).cycle.adoptions[0].candidate_id===candidate.id);await click('[data-decision-check]');await wait("document.querySelector('#decision-status')?.textContent.includes('Agent 已执行')");check('authorization result can be reconciled in the UI',true);await capture('workspace-election-authorized');await click('.dialog-top button');await wait("document.querySelector('.election-records')?.dataset.phase==='settled'");check('adopted stage collapses election records while keeping its leaders visible',await run("!document.querySelector('.election-records').open&&document.querySelector('.election-roles').textContent.includes('已当选')"));await capture('workspace-stage-selected');
  const agendaFile=path.join(output,'agent-agenda.json');fs.writeFileSync(agendaFile,JSON.stringify({request_id:'workspace-agenda-1',goal_candidate_id:candidate.id,title:'检验协作目录与聊天',summary:'验证云端目录定位和开发者聊天能够协同使用。',plan:'先提交详细开发计划，再验证登录、目录定位、代码显示和安全聊天，记录每一步的实际结果。',acceptance:'全部权限与协作场景通过，保留可复现证据。',target:'next'}));
  const agenda=await cli(keyFile,'agenda','--body-file',agendaFile);await cli(keyFile,'publish','--id',agenda.id,'--request-id','workspace-publish-1');
  await click('[data-home=agendas]');await wait("document.querySelector('[data-lane=voting]')");await click('[data-lane=voting]');
  await wait("document.querySelector('[data-agenda]')");
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, detailFetch */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/agendas/'+agenda.id)&&options.method==='GET')await delay(700);return detailFetch(url,options);};
  started=Date.now();await click('[data-agenda]');await wait("document.querySelector('#dialog').open&&document.querySelector('#dialog-title').textContent.includes('检验协作目录与聊天')");
  timings.agendaPreviewMs=Date.now()-started;check('cached agenda detail opens before slow cloud response',timings.agendaPreviewMs<600);
  await wait("document.querySelector('[data-vote^=\"agenda:\"]')");cloud.fetch=detailFetch;
  await click('[data-vote$=support]');await run("document.querySelector('[name=reason]').value='计划边界清晰，验收标准可以复现。';document.querySelector('#action-form').requestSubmit()");
  await wait("!document.querySelector('#dialog').open");await click('[data-lane=voting]');await wait("document.querySelector('[data-agenda]')");await click('[data-agenda]');await wait("document.querySelector('#comment-form')");
  await run("document.querySelector('#comment-form [name=body]').value='我会补充目录树的键盘定位验收。';document.querySelector('#comment-form').requestSubmit()");await wait("document.querySelector('#discussion-comments')?.textContent.includes('键盘定位验收')");
  check('agenda draft publication public support reason and discussion persist',true);await capture('workspace-agenda');
  await click('.dialog-top button');
  await click('[data-tab=repository]');await click('[data-repo=code]');await wait("document.querySelector('#source-text')?.textContent.includes('Aieyra')");
  await click('[data-tab=home]');await click('[data-home=blueprint]');await wait("document.querySelector('.engineering-empty')");
  check('blueprint has real empty state and local validation boundary available on demand',await run("document.querySelector('.engineering-empty').textContent.includes('从第一项获准议程开始')&&!!document.querySelector('[data-details-key=engineering-capabilities]')&&!document.querySelector('[data-details-key=engineering-capabilities]').open"));
  await click('[data-details-key=engineering-capabilities]>summary');
  check('expanded validation context separates the local environment from verification evidence',await run("document.querySelector('[data-details-key=engineering-capabilities]').open&&document.querySelector('[data-details-key=engineering-capabilities]').textContent.includes('普通工程使用本地运行器，系统实验可选 VM')&&document.querySelector('[data-details-key=engineering-capabilities]').textContent.includes('未获得验证的成果不能作为已通过')"));
  await click('[data-details-key=engineering-capabilities]>summary');
  await capture('workspace-blueprint-empty');
  await root.call('/agendas/'+agenda.id+'/vote',{choice:'support',reason:'隔离验收：共同确认施工范围。'});
  await third.call('/agendas/'+agenda.id+'/vote',{choice:'support',reason:'隔离验收：支持可复验任务。'});third.close();
  const reviewAgenda=(await cloud.call('/agendas/'+agenda.id)).agenda;
  check('three supports start a two hour confirmation window',reviewAgenda.status==='voting'&&reviewAgenda.review.review_until>Date.now()/1000+7100);
  const reviewAuth=await cloud.call('/elections/authorize',{cycle_id:nominated.cycle.id,version:(await cloud.call('/elections')).version,action:'confirm-agenda',payload:{agenda_id:agenda.id,version:reviewAgenda.version}});
  fs.writeFileSync(decisionFile,JSON.stringify({request_id:'workspace-confirm-agenda',authorization_id:reviewAuth.authorization_id}));await cli(keyFile,'election','--action','execute','--body-file',decisionFile);
  check('manager authorizes Agent before agenda work begins',(await cloud.call('/agendas/'+agenda.id)).agenda.status==='approved');
  const taskFile=path.join(output,'engineering-task.json');fs.writeFileSync(taskFile,JSON.stringify({request_id:'workspace-task-create',agenda_id:agenda.id,title:'实现可靠的任务消息收件',domain:'消息与协作',scope:['Core/messages'],interfaces:['message/v1'],acceptance:'断网恢复后消息不丢失，同一请求不重复执行。',dependencies:[]}));
  const task=await cli(keyFile,'engineering','--action','tasks/create','--body-file',taskFile);
  await settleQuota();
  await click('[data-home=blueprint]');await wait("document.querySelector('[data-task]')");
  check('Agent-created task appears in construction lane',await run("document.querySelector('.construction-task').textContent.includes('实现可靠的任务消息收件')"));
  check('the first engineering task is visible before stage explanations',await run("(()=>{const task=document.querySelector('.construction-task'),r=task.getBoundingClientRect();return r.top>=56&&r.bottom<=innerHeight;})()"));
  await capture('workspace-blueprint-task');await click('[data-task]');await wait("document.querySelector('.task-detail')");
  check('task details expose scoped files and acceptance',await run("document.querySelector('.task-detail').textContent.includes('Core/messages')"));
  await capture('workspace-blueprint-detail');await click('.dialog-top button');
  const brief=await cli(keyFile,'engineering','--resource','brief','--id',task.task.id);
  check('Agent receives scoped brief without unrelated history',brief.task.id===task.task.id&&brief.rules.length===4&&!brief.history&&brief.source_pending);
  const seedFile=path.join(output,'cocreation-fixture.json'),seedText='Synthetic initial source only\n';
  fs.writeFileSync(seedFile,JSON.stringify({project:'Aieyra OS 共创版',files:[{path:'Core/messages/example.py',content:seedText,sha256:require('node:crypto').createHash('sha256').update(seedText).digest('hex')}]}));
  const sourceRoot=process.env.AIEYRA_AIDEBUG_SOURCE_ROOT;if(!path.isAbsolute(sourceRoot||''))throw Error('Owned source fixture root is required');
  const imported=await execFile(python,['-B','-c','import sys,json;sys.path.insert(0,sys.argv[1]);from server.store import Store;print(json.dumps(Store(sys.argv[2]).engineering_import(json.load(open(sys.argv[3],encoding="utf-8")))))',sourceRoot,path.join(fixtureDir,'together'),seedFile],{windowsHide:true,timeout:15000});
  const base=JSON.parse(imported.stdout).revision;
  const /* @chain-region verifyWorkspace.engineering | calls: path.join, action.replaceAll, fs.writeFileSync, JSON.stringify, cli */ engineering=async(action,body)=>{const file=path.join(output,'engineering-'+action.replaceAll('/','-')+'.json');fs.writeFileSync(file,JSON.stringify(body));return cli(keyFile,'engineering','--action',action,'--body-file',file);};
  await engineering('tasks/update',{request_id:'workspace-task-base',task_id:task.task.id,version:1,state:'working',base});
  const candidateText='print("Synthetic candidate")\n# <img src=x onerror=alert(1)>\n',candidateBytes=Buffer.from(candidateText),candidateSha=require('node:crypto').createHash('sha256').update(candidateBytes).digest('hex');
  await engineering('upload',{request_id:'workspace-source-upload',task_id:task.task.id,version:2,sha256:candidateSha,size:candidateBytes.length,offset:0,data:candidateBytes.toString('base64')});
  const snapshot=await engineering('snapshots/create',{request_id:'workspace-source-candidate',task_id:task.task.id,version:2,base,message:'验证消息模块的候选成果',changes:[{path:'Core/messages/example.py',sha256:candidateSha}]});
  await click('[data-tab=repository]');await click('[data-repo=cloud]');await wait("document.querySelector('.snapshot-row')");
  check('candidate is listed separately from authoritative cloud head',(await cloud.call('/engineering/repository')).repository.cloud===base);
  await capture('workspace-cloud-candidate');await click('[data-snapshot="'+snapshot.revision+'"]');await wait("document.querySelector('[data-snapshot-file]')");await click('#dialog-body details:has([data-snapshot-file]) > summary');await click('[data-snapshot-file]');await wait("document.querySelector('.snapshot-source')");
  check('candidate source is read as escaped text',await run("document.querySelector('.snapshot-source').textContent.includes('<img')&&!document.querySelector('#dialog-body img')"));await capture('workspace-cloud-source');await click('.dialog-top button');
  const savedCheckpoint=await engineering('tasks/checkpoint',{request_id:'workspace-task-checkpoint',task_id:task.task.id,version:3,completed:'消息接口已完成，隔离候选已保存。',next_step:'验证真实调用方与断线恢复。',blockers:'等待独立工程师复验。',evidence_refs:['logs/receipt-fixture.json']});
  check('checkpoint persists exact task version and evidence references',savedCheckpoint.task.version===4&&savedCheckpoint.task.checkpoint.payload.evidence_refs[0]==='logs/receipt-fixture.json');
  const inboxFirst=await cli(keyFile,'receive'),inboxAgain=await cli(keyFile,'receive');
  check('actual CLI receive persists without automatically acknowledging',inboxFirst.persisted_before_output&&!inboxFirst.automatically_acknowledged&&inboxFirst.pending===inboxAgain.pending&&inboxFirst.pending>=4);
  const envelope=inboxFirst.events.find(v=>v.kind==='checkpoint');
  check('checkpoint event binds its immutable task and checkpoint digest',envelope.version===4&&envelope.payload.checkpoint_sha256===savedCheckpoint.task.checkpoint.digest);
  await cli(keyFile,'ack-event','--seq',String(envelope.seq),'--sha256',envelope.sha256);
  await cli(keyFile,'ack-event','--seq',String(envelope.seq),'--sha256',envelope.sha256);
  const afterAck=await cloud.call('/engineering/events?view=inbox&state=all');
  check('explicit Agent acknowledgement survives retry without claiming completed work',afterAck.events.find(v=>v.seq===envelope.seq).state==='acknowledged'&&afterAck.pending===inboxFirst.pending-1);
  onboarding.workSnapshot=null;
  await click('[data-tab=agents]');await wait("document.querySelector('.activity-footer')?.textContent.includes('待确认')");
  check('personal station shows actual pending collaboration count',await run("document.querySelector('.activity-footer').textContent.includes('待确认')"));await capture('workspace-collaboration-station');
  await click('[data-station-brief]');await wait("document.querySelector('.task-brief')");
  check('independent task brief explains scope acceptance and checkpoint in human language',await run("document.querySelector('.task-brief').textContent.includes('验收要求')&&document.querySelector('.task-brief').textContent.includes('消息接口已完成')&&!document.querySelector('.task-brief pre')"));
  await capture('workspace-task-brief');await click('#dialog .dialog-top button');
  await click('[data-inbox-page]');await wait("document.querySelector('.inbox-detail')");
  check('human inbox viewing does not acknowledge Agent events',(await cloud.call('/engineering/events?view=inbox')).pending===afterAck.pending);await capture('workspace-collaboration-inbox');
  await click('[data-inbox-event="'+envelope.seq+'"]');await wait("document.querySelector('#dialog-body').textContent.includes('已显式确认')");
  await click('#dialog-body [data-task]');await wait("document.querySelector('.checkpoint')");
  check('task detail presents completed next step blockers and evidence',await run("['消息接口已完成','验证真实调用方','等待独立工程师','logs/receipt-fixture.json'].every(t=>document.querySelector('.checkpoint').textContent.includes(t))"));await capture('workspace-collaboration-checkpoint');await click('.dialog-top button');
  const continuation=await engineering('tasks/resume',{request_id:'workspace-task-continue',task_id:task.task.id,version:4,checkpoint_sha256:savedCheckpoint.task.checkpoint.digest});
  check('continuation uses current version and exact checkpoint',continuation.task.version===5&&continuation.task.checkpoint.digest===savedCheckpoint.task.checkpoint.digest);
  // Real bundled Windows CLI -> WSL -> KVM, with a tiny synthetic source tree.
  // The separate public-OS experiment supplies the actual OS build evidence.
  const localWork=await cli(keyFile,'work','checkout','--revision',snapshot.revision);
  const fixedLocal=await cli(keyFile,'work','snapshot','--id',localWork.id);
  const vmScript=path.join(output,'vm-ui-check.sh'),artifactNames=path.join(output,'vm-ui-artifacts.json');
  fs.writeFileSync(vmScript,"python3 - <<'PY'\nfrom pathlib import Path\nassert Path('Core/messages/example.py').is_file()\nPath('build').mkdir()\nPath('build/ui-check.txt').write_text('Actual local VM UI verification artifact\\n')\nprint('Actual local VM: fixed source read, artifact produced, no candidate code executed on host.')\nPY\n");
  fs.writeFileSync(artifactNames,JSON.stringify(['build/ui-check.txt']));
  let actualRun=await cli(keyFile,'vm','run','--snapshot',fixedLocal.id,'--script-file',vmScript,'--request-id','workspace-real-vm','--timeout','30','--artifacts-file',artifactNames);
  for(let attempt=0;attempt<600&&!['passed','failed','cancelled','interrupted'].includes(actualRun.state);attempt++){await delay(1000);actualRun=await cli(keyFile,'vm','status','--id',actualRun.id);}
  fs.writeFileSync(path.join(output,'actual-local-vm-state.json'),JSON.stringify(actualRun,null,2));
  check('bundled Windows CLI actually executes in the offline local KVM',actualRun.state==='passed'&&actualRun.actual_vm&&actualRun.vm_observation.kvm.enabled);
  const actualEvidence=await cli(keyFile,'vm','evidence','--id',actualRun.id,'--revision',snapshot.revision);
  const actualEvidenceFile=path.join(output,'actual-local-vm-evidence.json');fs.writeFileSync(actualEvidenceFile,JSON.stringify(actualEvidence));
  const actualReport=await cli(keyFile,'vm','report','--id',actualRun.id,'--revision',snapshot.revision,'--summary','实际本机 VM 验证了合成输入和产物传输；不代表公开 OS 或独立多机验证。');
  check('VM report renews the bound identity and binds the exact cloud manifest',!!actualReport.id);
  const exportedFile=path.join(output,'actual-vm-artifact.txt'),actualArtifact=actualEvidence.execution.artifacts[0];
  const exported=await cli(keyFile,'vm','export','--id',actualRun.id,'--artifact',actualArtifact.path,'--file',exportedFile);
  check('Windows export bridge preserves the exact VM artifact and never executes it',exported.verified&&!exported.executed&&fs.readFileSync(exportedFile,'utf8')==='Actual local VM UI verification artifact\n');
  const uploadedArtifact=await cli(keyFile,'artifact','upload','--file',exportedFile,'--sha256',actualArtifact.sha256);
  check('bundled CLI uploads the actual exported artifact by digest',uploadedArtifact.uploaded&&uploadedArtifact.sha256===actualArtifact.sha256);
  await click('[data-tab=home]');await click('[data-home=blueprint]');await wait("document.querySelector('[data-action=local-engineering]')");
  await click('[data-action=local-engineering]');await wait("document.querySelector('.run-heading')",600);
  check('local overview reads the current account workspace and actual VM record',await run(`document.querySelector('#dialog-body').textContent.includes('1 个本机工作区')&&!!document.querySelector('[data-local-run="${actualRun.id}"]')`));
  await capture('workspace-local-environment');await click('[data-local-run="'+actualRun.id+'"]');await wait("document.querySelector('.local-run-log')",600);
  check('actual EXE displays real VM output and the verified guest console image',await run("document.querySelector('.local-run-log').textContent.includes('Actual local VM:')&&!!document.querySelector('.vm-console-preview img')"));
  await wait("document.querySelector('.vm-console-preview img')?.complete&&document.querySelector('.vm-console-preview img').naturalWidth>0");
  window.setSize(700,540);window.webContents.setZoomFactor(1.5);await delay(250);
  check('VM output and console preview fit the narrow enlarged dialog',await run("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#dialog-body').scrollWidth<=document.querySelector('#dialog-body').clientWidth+1"));
  await capture('workspace-local-vm-150');window.webContents.setZoomFactor(1);window.setSize(1280,720);await click('#dialog .dialog-top button');
  check('desktop rejects paths in place of an execution identity',await run("window.linkHost.localEngineeringInspect('../private').then(result=>!result.ok&&result.error.includes('执行编号无效'))"));
  // Actual bundled local process and scoped live operations. All identities here
  // belong to this isolated fixture; no real engineer station receives messages.
  const /* @chain-region verifyWorkspace.live | calls: path.join, action.replaceAll, fs.writeFileSync, JSON.stringify, cli */ live=async(action,body)=>{const file=path.join(output,'live-'+action.replaceAll('/','-')+'.json');fs.writeFileSync(file,JSON.stringify({request_id:'ui-live-'+action.replaceAll('/','-'),...body}));return cli(keyFile,'live','--action',action,'--body-file',file);};
  const runPlan=path.join(output,'local-process-plan.json');fs.writeFileSync(runPlan,JSON.stringify({commands:[['$PYTHON','-B','Core/messages/example.py']],timeout:20,artifacts:[]}));
  let processRun=(await cli(keyFile,'local','run','--snapshot',fixedLocal.id,'--plan',runPlan,'--request-id','workspace-real-local-process')).run;
  for(let i=0;i<60&&!['passed','failed','interrupted','cancelled'].includes(processRun.state);i++){await delay(250);processRun=(await cli(keyFile,'local','status','--id',processRun.id)).run;}
  fs.writeFileSync(path.join(output,'actual-local-process.json'),JSON.stringify(processRun,null,2));
  check('bundled Windows local runner executes the actual fixed source',processRun.state==='passed'&&processRun.kind==='local-process'&&processRun.environment.os_sandbox===false);
  const processLogs=await cli(keyFile,'local','logs','--id',processRun.id);check('actual local process output is retained',processLogs.text.includes('Synthetic candidate'));
  const previewRoot=path.join(localWork.path,'Core/messages/web-notebook');fs.mkdirSync(previewRoot);
  const notebookPrefix='SDK/examples/program-notebook/';
  const publicNotebook=JSON.parse(fs.readFileSync(path.join(sourceRoot,'catalog/source-bundle.json'),'utf8'));
  for(const file of publicNotebook.files.filter(f=>f.path.startsWith(notebookPrefix)))fs.writeFileSync(path.join(previewRoot,file.path.slice(notebookPrefix.length)),file.content);
  const previewPage=path.join(previewRoot,'index.html'),previewApp=path.join(previewRoot,'app.js');
  const webPreview=(await cli(keyFile,'preview','start','--workspace',localWork.id,'--root','Core/messages/web-notebook','--entry','index.html','--interval','2')).preview;
  try{
   await click('[data-action=local-engineering]');await wait(`document.querySelector('[data-local-preview="${webPreview.id}"]')`,600);
   check('actual EXE presents the current account web preview separately from verification',await run("document.querySelector('.local-web-previews').textContent.includes('验证结果以执行记录为准')"));
   await capture('workspace-web-preview');await click('[data-local-preview="'+webPreview.id+'"]');
   const {BrowserWindow}=require('electron');let viewer;
   for(let attempt=0;attempt<100;attempt++){viewer=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(webPreview.url+'s/'));if(viewer&&!viewer.webContents.isLoading())break;await delay(100);}
   if(!viewer)throw Error('Actual preview window did not open');
   check('actual project page executes without the privileged Link bridge',await viewer.webContents.executeJavaScript("document.querySelector('h1').textContent==='共用便签'&&typeof window.linkHost==='undefined'&&typeof require==='undefined'&&typeof process==='undefined'"));
   check('actual public notebook saves Unicode text through its real program API',await viewer.webContents.executeJavaScript("aieyraProgram.invoke('set_text',{text:'你好🙂'});document.querySelector('#note').value==='你好🙂'&&localStorage.getItem('note')==='你好🙂'"));
   fs.writeFileSync(path.join(output,'actual-web-preview-before.png'),(await viewer.webContents.capturePage()).toPNG());
   fs.writeFileSync(previewApp,fs.readFileSync(previewApp,'utf8').replace("status.textContent='已保存';","status.textContent='已保存';document.querySelector('#count').textContent=Array.from(note.value).length+' 字';")+"\ndocument.querySelector('#count').textContent=Array.from(note.value).length+' 字';\n");
   fs.writeFileSync(previewPage,fs.readFileSync(previewPage,'utf8').replace('<p id="status"','<output id="count" aria-live="polite">0 字</output><p id="status"'));
   fs.appendFileSync(path.join(previewRoot,'style.css'),'\noutput{display:block;text-align:right;margin-top:1rem;color:#b9cbf5}\n');
   let refreshed=false;
   for(let attempt=0;attempt<150;attempt++){try{refreshed=await viewer.webContents.executeJavaScript("document.querySelector('#count')?.textContent==='3 字'");}catch{}if(refreshed)break;await delay(100);}
   check('actual preview refreshes after a source edit with a different immutable version',refreshed&&!viewer.webContents.getURL().includes(webPreview.snapshot));
   check('actual notebook preserves the saved text across source refresh',await viewer.webContents.executeJavaScript("document.querySelector('#note').value==='你好🙂'&&document.querySelector('#count').textContent==='3 字'"));
   check('actual preview blocks other origins from receiving project requests',await viewer.webContents.executeJavaScript("fetch('http://127.0.0.1:1/private').then(()=>false,()=>true)"));
   viewer.setSize(700,540);viewer.webContents.setZoomFactor(1.5);await delay(200);
   check('actual local preview remains readable in a narrow enlarged window',await viewer.webContents.executeJavaScript("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#count').getBoundingClientRect().width>0"));
   fs.writeFileSync(path.join(output,'actual-web-preview-after-150.png'),(await viewer.webContents.capturePage()).toPNG());
   viewer.close();
   check('desktop rejects arbitrary URLs as preview identities',await run("window.linkHost.localPreviewOpen('http://127.0.0.1/private').then(result=>!result.ok&&result.error.includes('预览编号无效'))"));
   await click('#dialog .dialog-top button');
  }finally{await cli(keyFile,'preview','stop','--id',webPreview.id);fs.rmSync(previewRoot,{recursive:true});}
  const definition=await cli(null,'context','--connection',connectionFile);check('onboarding recovery injects current durable working rules',definition.working_definition.available&&definition.working_definition.rules.length>4);
  const currentTask=(await cloud.call('/engineering/task?id='+task.task.id)).task;
  await live('plan/save',{task_id:currentTask.id,version:currentTask.version,plan_version:0,steps:['核对源码','运行真实本地测试','完成独立复验'],progress:'当前固定源码已实际运行。',next_step:'继续核对协作结论。'});
  const meeting=(await live('rooms/create',{agenda_id:agenda.id,tasks:[currentTask.id],title:'消息接口与复验边界'})).room;
  const meetingPosted=await live('rooms/message',{id:meeting.id,room_version:meeting.version,message:'<img src=x onerror=alert(1)> 请核对消息边界，普通注释保持。'});
  const conclusion=(await live('rooms/close',{id:meeting.id,room_version:meetingPosted.room_version,summary:'确认消息接口的责任范围，保留独立复验要求并持续保存进展。',actions:[{owner:currentTask.owner,task_id:currentTask.id,action:'核对源码、实际测试并明确确认行动项。'}]})).room;
  await live('pheromones/save',{task_id:currentTask.id,version:currentTask.version,revision:snapshot.revision,path:'Core/messages/example.py',kind:'finding',message:'<script> 临时消息边界线索，请核对源码。',ttl:600,evidence_refs:[]});
  const queued=await live('queue/submit',{task_id:currentTask.id,version:currentTask.version,revision:snapshot.revision,complete_task:false});
  await click('[data-action=live-overview]');await wait("document.querySelector('[data-live-room]')");
  check('actual EXE presents fusion queue and related meeting',await run("document.querySelector('#dialog-body').textContent.includes('等待组合')&&document.querySelector('[data-live-room]').textContent.includes('消息接口与复验边界')"));await capture('workspace-live-overview');
  const liveHealthyFetch=cloud.fetch;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, Response, JSON.stringify, liveHealthyFetch */ cloud.fetch=async(url,options)=>new URL(url).pathname.endsWith('/engineering/live/queue')?new Response(JSON.stringify({error:'fixture_live_connection_unavailable'}),{status:503,headers:{'content-type':'application/json'}}):liveHealthyFetch(url,options);
  await wait("document.querySelector('.live-status')?.hidden===false",450);
  check('failed live refresh preserves results with a persistent human warning',await run("document.querySelector('[data-live-room]').textContent.includes('消息接口与复验边界')&&document.querySelector('.live-status').textContent.includes('正在显示上次记录')"));await capture('workspace-live-stale');
  cloud.fetch=liveHealthyFetch;
  await wait("document.querySelector('.live-status')?.hidden===true",450);
  check('unchanged live data clears a recovered warning without repeating success text',await run("document.querySelector('.live-status').textContent===''&&!!document.querySelector('[data-live-room]')"));await capture('workspace-live-restored');
  await click('[data-live-room]');await wait("document.querySelector('#dialog-body').textContent.includes('会议结论')");
  check('meeting messages escape HTML and do not accept actions by viewing',await run("document.querySelector('#dialog-body').textContent.includes('<img')&&!document.querySelector('#dialog-body img')&&document.querySelector('#dialog-body').textContent.includes('待确认更新')&&!document.querySelector('#dialog-body').textContent.includes('已接受行动项')"));await capture('workspace-live-room');
  await delay(10500);check('real time meeting refresh preserves the current dialog',await run("document.querySelector('#dialog-title').textContent==='消息接口与复验边界'&&document.querySelector('#dialog-body').textContent.includes('会议结论')"));
  window.setSize(700,540);window.webContents.setZoomFactor(1.5);await delay(200);check('live meeting fits narrow enlarged viewport',await run("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#dialog-body').scrollWidth<=document.querySelector('#dialog-body').clientWidth+1"));await capture('workspace-live-room-150');window.webContents.setZoomFactor(1);window.setSize(1280,720);await click('#dialog .dialog-top button');
  await live('rooms/ack',{id:meeting.id,room_version:conclusion.version,accept_actions:true});
  await click('[data-task="'+currentTask.id+'"]');await wait("document.querySelector('[data-live-context]')");check('task detail includes durable plan',await run("document.querySelector('#dialog-body').textContent.includes('持久计划与进展')"));await click('[data-live-context]');await wait("document.querySelector('.work-rules')");check('task context restores plan and relevant conclusion',await run("document.querySelector('#dialog-body').textContent.includes('继续核对协作结论')&&document.querySelector('[data-live-room]')"));await capture('workspace-live-context');await click('#dialog .dialog-top button');
  await click('[data-action=local-engineering]');await wait(`document.querySelector('[data-local-run="${processRun.id}"]')`,600);await click('[data-local-run="'+processRun.id+'"]');await wait("document.querySelector('.local-run-log')");check('actual EXE distinguishes local process output from VM output',await run("document.querySelector('.local-run-log').textContent.includes('Synthetic candidate')&&document.querySelector('#dialog-body').textContent.includes('本地工程运行')&&!document.querySelector('.vm-console-preview')"));await capture('workspace-local-process');await click('#dialog .dialog-top button');
  const queue=(await cli(keyFile,'live','--resource','queue','--id',queued.id)).queue[0];await live('queue/cancel',{task_id:currentTask.id,version:currentTask.version,id:queued.id,queue_version:queue.version});
  await click('[data-tab=repository]');await click('[data-repo=cloud]');await wait("document.querySelector('[data-snapshot]')");await click('[data-snapshot="'+snapshot.revision+'"]');await wait("document.querySelector('[data-snapshot-file]')");await click('#dialog-body details:has([data-snapshot-file]) > summary');await click('[data-snapshot-file]');await wait("document.querySelector('.code-pheromones')");check('current pheromones render separately without changing source comments',await run("document.querySelector('.code-pheromones').textContent.includes('<script>')&&!document.querySelector('.code-pheromones script')&&document.querySelector('.snapshot-source').textContent.includes('# <img')"));await capture('workspace-live-pheromones');await click('#dialog .dialog-top button');
  await click('[data-tab=home]');await click('[data-home=blueprint]');await wait("document.querySelector('[data-action=local-engineering]')");
  await cli(null,'context','--connection',connectionFile);
  const fixtureResult=await execFile(python,['-B',path.join(sourceRoot,'AIDEBUG/workflow-fixture.py'),'--data',path.join(fixtureDir,'together'),'--key-file',keyFile,'--evidence',actualEvidenceFile,'--revision',snapshot.revision],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(output,'workflow-fixture-scope.json'),fixtureResult.stdout);
  await click('[data-tab=repository]');await click('[data-repo=cloud]');await wait("document.querySelector('[data-snapshot]')");
  await click('[data-snapshot="'+snapshot.revision+'"]');await wait("document.querySelector('[data-engineering-integrate]')");
  check('precise quorum enables only the candidate reviewed by author and protocol peer',await run("!document.querySelector('[data-engineering-integrate]').disabled&&document.querySelector('#dialog-body').textContent.includes('作者与独立工程师的精确复验条件已满足')"));
  await click('[data-verification-page]');await wait("document.querySelector('.verification-row')");await click('[data-verification-page="20"]');await wait("document.querySelector('#dialog-body').textContent.includes('历史记录')");
  check('verification history pagination retains the old failure',await run(`document.querySelector('#dialog-body').textContent.includes('发现问题')&&document.querySelector('[data-verification-page="0"]')`));
  await capture('workspace-verification-history');await click('#dialog .dialog-top button');
  await click('[data-action=engineering-handoffs]');await wait("document.querySelector('#dialog-body').textContent.includes('等待自愿接续')");
  check('handoff view preserves tasks checkpoints and explicit acceptance instructions',await run("document.querySelector('#dialog-body').textContent.includes('1 项交接任务')&&document.querySelector('#dialog-body').textContent.includes('所有权在接受成功后才转移')"));await capture('workspace-handoff');await click('#dialog .dialog-top button');
  let workflowDecision=0;
  const /* @chain-region verifyWorkspace.finishWorkflowDecision | calls: wait, run, text.match, fs.writeFileSync, JSON.stringify, cli, click, check */ finishWorkflowDecision=async()=>{await wait("document.querySelector('#decision-instructions')");const text=await run("document.querySelector('#decision-instructions').textContent"),id=text.match(/授权 ID：([a-f0-9]{32})/)[1];fs.writeFileSync(decisionFile,JSON.stringify({request_id:'workspace-workflow-'+(++workflowDecision),authorization_id:id}));const grant=await cli(keyFile,'election','--resource','authorization','--id',id);await cli(keyFile,'election','--action','execute','--body-file',decisionFile);await click('[data-decision-check]');await wait("document.querySelector('#dialog-title').textContent==='Agent 已完成授权操作'");check('workflow decision '+workflowDecision+' reconciles its actual Agent execution receipt',true);await click('#dialog .dialog-top button');return grant;};
  await click('[data-snapshot="'+snapshot.revision+'"]');await wait("document.querySelector('[data-engineering-integrate]:not(:disabled)')");await click('[data-engineering-integrate]');await wait("document.querySelector('#action-form')");await type('#action-form [name=reason]','隔离界面验收：核对精确源码和实际本机执行记录，独立身份为协议夹具。');await click('#action-form button');await finishWorkflowDecision();
  await click('[data-tab=home]');await click('[data-home=blueprint]');await wait("document.querySelector('[data-accept-goal]')");await click('[data-accept-goal]');await wait("document.querySelector('#action-form')");await type('#action-form [name=summary]','隔离界面验收：任务成果已整合，当前目标验收只针对本轮合成输入。');await click('#action-form button');await finishWorkflowDecision();
  await wait("document.querySelector('[data-engineering-freeze]:not(:disabled)')");await click('[data-engineering-freeze]');await wait("document.querySelector('#action-form')");await type('#action-form [name=reason]','隔离界面验收：冻结已经验收的精确版本，验证进入集中 Debug。');await click('#action-form button');await finishWorkflowDecision();
  await wait("document.querySelector('.workflow-overview h2')?.textContent==='集中 Debug'");check('actual EXE advances to debug only through precise engineer authorization',true);await capture('workspace-workflow-debug');
  await click('[data-engineering-release=development]');await wait("document.querySelector('[data-release-build]')");check('release picker finds the current build despite more than twenty historical reports',true);await capture('workspace-release-build');await click('[data-release-build]');await wait("document.querySelector('#action-form [name=notes]')");await type('#action-form [name=notes]','隔离界面验收开发版：使用实际 VM 生成的文本产物，不是公开 OS 发行。');await click('#action-form button');const developmentGrant=await finishWorkflowDecision();
  await wait("document.querySelector('[data-engineering-release=stable]')");await click('[data-engineering-release=stable]');await wait("document.querySelector('#action-form [name=notes]')");await type('#action-form [name=notes]','隔离界面验收：明确确认同一开发版文本产物的试用结论，公开下载仍暂停。');await click('#action-form button');const stableGrant=await finishWorkflowDecision();
  const releasedFlow=await cloud.call('/engineering/workflow');
  check('stable authorization preserves the exact tested development artifact',releasedFlow.phase.phase==='stable'&&JSON.stringify(stableGrant.payload.artifacts)===JSON.stringify(developmentGrant.payload.artifacts)&&stableGrant.payload.revision===developmentGrant.payload.revision);
  const versions=await cloud.call('/engineering/releases'),stableVersion=versions.releases.find(r=>r.channel==='stable');
  const downloadedFile=path.join(output,'downloaded-actual-vm-artifact.txt');const downloadedArtifact=await cli(keyFile,'artifact','download','--release-id',stableVersion.id,'--sha256',actualArtifact.sha256,'--file',downloadedFile);
  check('bundled CLI downloads the exact authorized artifact without execution',downloadedArtifact.verified&&!downloadedArtifact.executed&&fs.readFileSync(downloadedFile).equals(fs.readFileSync(exportedFile)));
  await click('[data-tab=repository]');await click('[data-repo=cloud]');await wait("document.querySelector('[data-engineering-release-id]')");await click('[data-engineering-release-id="'+stableVersion.id+'"]');await wait("document.querySelector('.artifact-digest')");
  check('released artifact view keeps provenance and paused public downloads explicit',await run(`document.querySelector('#dialog-body').textContent.includes('${actualArtifact.sha256}')&&document.querySelector('#dialog-body').textContent.includes('公网安装包下载仍暂停')`));await capture('workspace-workflow-stable');await click('#dialog .dialog-top button');
  await click('[data-tab=home]');await click('[data-home=goals]');await wait("document.querySelector('.mission')?.dataset.phase==='awaiting_goal'&&!document.querySelector('.election-records')");
  check('stable milestone closes its active goal and invites the next Agent proposal',(await cloud.call('/goals')).cycle===null&&await run("document.querySelector('.election-summary').textContent.includes('Agent 准备目标与配套方案')"));
  await click('[data-action=milestones]');await wait("document.querySelector('#dialog-body').textContent.includes('完善工程师协作工作台')");check('completed milestone remains available after stable release',true);await capture('workspace-completed-milestone');await click('#dialog .dialog-top button');
  await click('[data-tab=repository]');await click('[data-repo=cloud]');await wait("document.querySelector('.snapshot-row')");
  await click('[data-repo=code]');
  await click('[data-tab=repository]');await wait("document.querySelector('#source-text')");
  check('nested directory tree',await run("document.querySelectorAll('[role=treeitem][aria-expanded]').length>0"));
  await run("document.querySelector('#source-filter').value='README';document.querySelector('#source-filter').dispatchEvent(new Event('input',{bubbles:true}))");
  check('tree search keeps folders',await run("document.querySelector('#tree').textContent.includes('README')"));await capture('workspace-repository');
  await run("window.__sourceNode=document.querySelector('#source-text');document.querySelector('.source pre').scrollTop=120;window.__sourceScroll=document.querySelector('.source pre').scrollTop");
  await click('[data-tab=home]');await wait("document.querySelector('[data-home]')");await click('[data-tab=repository]');await wait("document.querySelector('#source-text')");
  check('repository node scroll and filter survive navigation',await run("window.__sourceNode===document.querySelector('#source-text') && document.querySelector('#source-filter').value==='README' && Math.abs(document.querySelector('.source pre').scrollTop-window.__sourceScroll)<2"));
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'F',modifiers:['control']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'F',modifiers:['control']});
  await wait("document.activeElement.id==='file-find'");await type('#file-find','Aieyra');
  check('native Ctrl F finds source lines',await run("document.querySelectorAll('.code-line.current-line').length>0"));await click('[data-action=find-close]');
  const originalFetch=cloud.fetch;let failFile=2;/* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, Error, originalFetch */ cloud.fetch=async(url,opt)=>{if(failFile>0&&new URL(url).pathname.endsWith('/code/file')){failFile--;throw Error('isolated offline injection');}return originalFetch(url,opt);};
  await click('[data-file]');await wait("document.querySelector('[data-action=file-retry]')");
  check('source failure exposes local retry',true);await capture('workspace-source-error');await delay(3000);await click('[data-action=file-retry]');await wait("document.querySelector('.code-line')");cloud.fetch=originalFetch;
  check('source recovers without resetting directory selection',await run("document.querySelector('#source-filter').value==='README'"));

  const revision=(await cloud.call('/code')).current.revision;const source=await cloud.source(revision);
  check('real revision ZIP and digest verified',source.bytes[0]===80&&source.bytes[1]===75&&source.revision===revision);
  const saved=path.join(output,'source-save.zip'),oldSave=dialog.showSaveDialog;let saveDialogAt=0;
  /* @chain-region verifyWorkspace.dialog.showSaveDialog | calls: Date.now */ dialog.showSaveDialog=async()=>{saveDialogAt=Date.now();return {canceled:false,filePath:saved};};
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, delay, detailFetch */ cloud.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/access'))await delay(700);return detailFetch(url,options);};
  try{started=Date.now();await click('[data-action=source]');for(let i=0;i<100&&!fs.existsSync(saved);i++)await delay(100);timings.sourceDialogMs=saveDialogAt-started;check('save dialog opens before redundant access round trip',timings.sourceDialogMs>=0&&timings.sourceDialogMs<600);check('native save path writes verified ZIP',fs.existsSync(saved));}finally{dialog.showSaveDialog=oldSave;cloud.fetch=detailFetch;}
  await click('[data-repo=download]');await wait("document.querySelector('.download-row')");check('OS download truthfully unavailable',await run("document.querySelector('.download-row button').disabled"));await capture('workspace-os-download');
  await click('[data-tab=chat]');await wait("document.querySelector('#chat-input')");
  await run("document.querySelector('#chat-input').value='## 开发进展\\n```js\\nconsole.log(\"Eyra\");\\n```\\n<img src=x onerror=window.__unsafe=1>';document.querySelector('#chat-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composer').requestSubmit()");
  await wait("document.querySelector('.markdown pre')");check('Markdown code renders and HTML stays text',await run("document.querySelectorAll('.markdown img').length===0 && window.__unsafe===undefined"));
  const png=fs.readFileSync(path.join(__dirname,'icon.png')).toString('base64');
  await run(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'fixture.png',{type:'image/png'}));document.querySelector('#image-input').files=data.files;document.querySelector('#image-input').dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait("document.querySelector('#attachment-preview img')");await run("document.querySelector('#composer').requestSubmit()");await wait("document.querySelector('.message-images img')?.complete");check('real image upload and authenticated rendering',true);await capture('workspace-chat');
  await login(second,100);await second.call('/chat/messages',{body:'另一位工程师的真实隔离测试回应。',request_id:'workspace-peer-message-00001',attachments:[]});await click('[data-action=chat-refresh]');await wait("document.querySelector('#chat-log').textContent.includes('另一位工程师')");check('second account message reaches actual client',true);
  await type('#chat-input','切页后继续编辑的草稿');
  await run("window.__chatInput=document.querySelector('#chat-input');window.__messageNode=document.querySelector('.message');document.querySelector('#chat-log').scrollTop=0;window.__chatScroll=document.querySelector('#chat-log').scrollTop");
  await cloud.refresh();await click('[data-action=chat-refresh]');
  check('refresh preserves composing focus nodes and decoded messages',await run("window.__chatInput===document.querySelector('#chat-input') && window.__messageNode===document.querySelector('.message') && document.querySelector('#chat-input').value==='切页后继续编辑的草稿'"));
  await click('[data-tab=home]');await wait("document.querySelector('[data-home]')");await click('[data-tab=chat]');await wait("document.querySelector('#chat-input')");
  check('chat navigation keeps draft and reading position',await run("window.__chatInput===document.querySelector('#chat-input') && document.querySelector('#chat-input').value==='切页后继续编辑的草稿' && Math.abs(document.querySelector('#chat-log').scrollTop-window.__chatScroll)<2"));
  const healthyChatFetch=cloud.fetch;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: pathname.endsWith, URL, Response, JSON.stringify, healthyChatFetch */ cloud.fetch=async(url,options)=>new URL(url).pathname.endsWith('/chat/messages')&&options.method==='GET'?new Response(JSON.stringify({error:'隔离验证：聊天暂不可更新。'}),{status:500,headers:{'content-type':'application/json'}}):healthyChatFetch(url,options);
  await click('[data-action=chat-refresh]');await wait("document.querySelector('.surface')?.dataset.syncState==='stale'");
  check('chat read failure keeps decoded messages and the composing draft with a persistent retry',await run("window.__chatInput===document.querySelector('#chat-input')&&window.__messageNode===document.querySelector('.message')&&document.querySelector('#chat-input').value==='切页后继续编辑的草稿'&&!document.querySelector('#surface-status').hidden"));
  await checkSurface('chat-stale','#surface-status button,#chat-input,#send,[data-action=preview]');
  cloud.fetch=healthyChatFetch;await click('[data-action=chat-refresh]');await wait("document.querySelector('.surface')?.dataset.syncState==='current'");
  check('chat retry clears its warning while preserving the draft',await run("document.querySelector('#surface-status').hidden&&document.querySelector('#chat-input').value==='切页后继续编辑的草稿'"));
  await type('#chat-input','延迟发送的原始内容');
  let releasePost,posted=false;const gate=new Promise(resolve=>releasePost=resolve),normalFetch=cloud.fetch;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: normalFetch, pathname.endsWith, URL */ cloud.fetch=async(url,opt)=>{const response=await normalFetch(url,opt);if(new URL(url).pathname.endsWith('/chat/messages')&&opt.method==='POST'){posted=true;await gate;}return response;};
  await click('#send');for(let i=0;i<100&&!posted;i++)await delay(50);assert.ok(posted);
  await type('#chat-input','发送过程中开始撰写的下一条');releasePost();await wait("!document.querySelector('#send').disabled");cloud.fetch=normalFetch;
  check('late send acknowledgement preserves newly edited draft',await run("document.querySelector('#chat-input').value==='发送过程中开始撰写的下一条'"));
  check('send uses immutable submitted text',(await cloud.call('/chat/messages')).messages.some(m=>m.body==='延迟发送的原始内容'));
  await delay(Math.max(0,(12-cloud.gate.tokens)/3*1000,cloud.gate.retryAt-Date.now())+100);
  await type('#chat-input','回执丢失后重试仍只有一条');let lost=false;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: normalFetch, pathname.endsWith, URL, Error */ cloud.fetch=async(url,opt)=>{const response=await normalFetch(url,opt);if(!lost&&new URL(url).pathname.endsWith('/chat/messages')&&opt.method==='POST'){lost=true;throw Error('isolated response loss after acceptance');}return response;};
  await click('#send');await wait("document.querySelector('#chat-error').textContent.length>0");await capture('workspace-send-recovery');cloud.fetch=normalFetch;
  check('uncertain write is retained during bounded recovery',cloud.gate.retryAt>Date.now()&&await run("document.querySelector('#chat-input').value==='回执丢失后重试仍只有一条'"));
  await delay(Math.max(0,cloud.gate.retryAt-Date.now())+100);
  await click('#send');await wait("!document.querySelector('#send').disabled && document.querySelector('#chat-input').value===''");
  check('uncertain send retry is idempotent',(await cloud.call('/chat/messages')).messages.filter(m=>m.body==='回执丢失后重试仍只有一条').length===1);
  await type('#chat-input','## 代码预览\n```js\nconst eyra = true;\n```');await click('[data-action=preview]');await wait("!document.querySelector('#chat-preview').hidden");
  check('Markdown preview retains editable draft',await run("!!document.querySelector('#chat-preview pre code') && document.querySelector('#chat-input').value.includes('const eyra')"));await click('[data-action=preview]');
  await capture('workspace-chat-refined');

  check('desktop revokes the paired agent',await run("window.linkHost.call('/agents/revoke', {id:"+JSON.stringify(JSON.parse(fs.readFileSync(keyFile)).id)+"}).then(result=>result.ok)"));
  check('explicit revoke invalidates the automatic broker credential',(await httpCall('/context',{})).status===401);
  await root.call('/admin/users/disable',{id:app.user_id,reason:'隔离验收：验证 New API 与开发资格联动禁用。',request_id:'workspace-disable-user-00001'});
  cloud.accessAt=Date.now()-11000;
  await click('[data-tab=repository]');await wait("document.querySelector('[data-tab=chat]').hidden");
  check('background recheck clears protected surfaces and cached access after disable',await run("!document.querySelector('.message')&&!document.querySelector('#source-text')")&&cloud.cachedAccess()===null);

  const reloginFetch=cloud.fetch;
  /* @chain-region verifyWorkspace.cloud.fetch | calls: reloginFetch, fs.writeFileSync, path.join, JSON.stringify, URL, text, response.clone */ cloud.fetch=async(url,opt)=>{const response=await reloginFetch(url,opt);if(!response.ok)fs.writeFileSync(path.join(output,'cloud-relogin-error.json'),JSON.stringify({route:new URL(url).pathname,status:response.status,body:await response.clone().text()},null,2));return response;};
  await cloud.logout();await login(cloud,100);cloud.fetch=reloginFetch;await wait("!document.querySelector('[data-tab=management]').hidden");
  await click('[data-tab=management]');await wait("document.querySelector('[data-action=unlock]')");check('new root login has no inherited grant',cloud.grant===null);
  await click('[data-action=unlock]');await run("document.querySelector('[name=password]').value='fixture-password';document.querySelector('#action-form').requestSubmit()");
  await wait("document.querySelector('[data-action=lock]')");check('password unlocks ten minute management',cloud.grant?.expiresAt>Date.now());await capture('workspace-management');
  await checkSurface('management','[data-action=lock],.admin-list details>summary,[data-review]');
  await click('[data-admin-tab=audit]');await wait("document.querySelector('.audit')");await checkSurface('audit','[data-action=lock]');
  await click('[data-tab=chat]');await wait("document.querySelector('#chat-input')");await checkSurface('chat','#chat-input,#send,[data-action=preview]');
  await click('[data-tab=repository]');await click('[data-repo=code]');await wait("document.querySelector('#source-filter')");await checkSurface('reference','[data-action=source],#source-filter,[data-file]');
  await click('[data-repo=cloud]');await wait("document.querySelector('.version-track')");await checkSurface('cloud','.context-details>summary,[data-snapshot]');
  await click('[data-tab=home]');await click('[data-home=members]');await wait("document.querySelector('.member')");await checkSurface('members','[data-member]');
  await click('[data-home=blueprint]');await wait("document.querySelector('.construction-board')");await checkSurface('blueprint','[data-task],.context-details>summary,[data-action=engineering-copy]');
  await click('[data-home=agendas]');await wait("document.querySelector('.lanes')");await checkSurface('agendas','.lanes button,[data-agenda]');
  await click('[data-home=goals]');await wait("document.querySelector('.election-summary')");await checkSurface('goals','[data-action=milestones],.election-records>summary,[data-goal]');
  await click('[data-tab=management]');await wait("document.querySelector('[data-action=lock]')");
  await click('[data-action=lock]');await wait("document.querySelector('[data-action=unlock]')");check('explicit lock clears management grant',cloud.grant===null);
  await navigateHome();window.setSize(700,570);await delay(350);
  check('narrow window no document overflow',await run('document.documentElement.scrollWidth<=innerWidth'));await capture('workspace-narrow');
  window.webContents.setZoomFactor(1.25);window.setSize(720,600);await delay(350);
  check('125 percent compact bar controls remain visible and hittable',await run("[...document.querySelectorAll('.titlebar button:not([hidden])')].every(n=>{const r=n.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=56&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===n;})"));
  const scaledHit=await nativeHit('#tabs');check('native drag region remains correct at 125 percent',scaledHit.caption);
  await click('[data-tab=repository]');await wait("document.querySelector('[data-repo=code]')");await click('[data-repo=code]');await wait("document.querySelector('#source-text')");await capture('workspace-125-repository');
  await click('[data-repo=cloud]');await wait("document.querySelector('.version-track')");
  check('cloud repository fits compact 125 percent window',await run("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.version-track').getBoundingClientRect().right<=innerWidth"));await capture('workspace-125-cloud');
  await click('[data-tab=home]');await click('[data-home=blueprint]');await wait("document.querySelector('.construction-board')");
  check('blueprint lanes fit compact 125 percent window',await run("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.construction-board').getBoundingClientRect().right<=innerWidth"));await capture('workspace-125-blueprint');
  await click('[data-home=goals]');await wait("document.querySelector('.election-summary')");await run("document.querySelector('.stage-leadership').scrollIntoView({block:'start'})");check('stage leadership fits compact 125 percent goals surface',await run("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.stage-leadership').getBoundingClientRect().right<=innerWidth+1"));await capture('workspace-125-elections');check('completed stage shows a next-proposal invitation without obsolete voting controls',await run("!document.querySelector('.election-records')&&!document.querySelector('[data-election-vote]')&&document.querySelector('.election-summary').textContent.includes('Agent 准备目标与配套方案')"));await capture('workspace-125-next-stage');
  await click('[data-tab=office]');await delay(200);check('scaled native office view aligns below bar',officeView.getBounds().y===70);
  await click('[data-tab=home]');await click('[data-home=goals]');await wait("document.querySelector('.halo')");
  const firstTransform=await run("getComputedStyle(document.querySelector('.orbit-runner')).transform");await capture('workspace-motion-1');await delay(700);await capture('workspace-motion-2');
  check('halo animation advances over real frames',firstTransform!==await run("getComputedStyle(document.querySelector('.orbit-runner')).transform"));
  const debuggerAPI=window.webContents.debugger;debuggerAPI.attach('1.3');
  await debuggerAPI.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  check('reduced motion stops decorative animation',await run("getComputedStyle(document.querySelector('.orbit-runner')).animationName==='none'"));
  await capture('workspace-reduced-motion');await debuggerAPI.sendCommand('Emulation.setEmulatedMedia',{features:[]});debuggerAPI.detach();
  await run("document.documentElement.dataset.hidden='true'");check('hidden surface pauses decorative work',await run("getComputedStyle(document.querySelector('.orbit-runner')).animationPlayState==='paused'"));await run("document.documentElement.dataset.hidden='false'");
  window.webContents.setZoomFactor(1);window.setSize(1080,740);setTab('office');await delay(350);
  check('native office starts beneath OS topbar',officeView.getBounds().y===56);
  check('real local office remains sandboxed',await officeView.webContents.executeJavaScript("!!document.querySelector('[data-panel=stations]') && typeof require==='undefined'"));
  const pngOffice=await officeView.webContents.capturePage();fs.writeFileSync(path.join(output,'workspace-office.png'),pngOffice.toPNG());setTab('home');
  /* @chain-region verifyWorkspace.cloud.fetch | calls: reloginFetch, pathname.endsWith, URL, fs.writeFileSync, path.join, JSON.stringify, text, response.clone */ cloud.fetch=async(url,opt)=>{const response=await reloginFetch(url,opt);if(!response.ok&&new URL(url).pathname.endsWith('/access'))fs.writeFileSync(path.join(output,'cloud-account-switch-error.json'),JSON.stringify({route:new URL(url).pathname,status:response.status,body:await response.clone().text()},null,2));return response;};
  await run("import('./detail-view.mjs').then(({detailButton})=>document.querySelector('#workspace').insertAdjacentHTML('beforeend',detailButton('当前账号详情','待清理的上一账号正文')))");
  await click('[data-read-title="当前账号详情"]');
  await cloud.logout();await login(cloud,2);cloud.fetch=reloginFetch;await wait("document.querySelector('[data-welcome-phase=connect]')");
  check('account switch closes and clears full text reading layer',await run("!document.querySelector('#detail-dialog').open&&!document.querySelector('.detail-content').textContent&&!document.querySelector('#detail-title').textContent"));
  check('switching account removes prior chat and source',await run("!document.querySelector('.message')&&!document.querySelector('#source-text')"));
  check('old Agent broker credential is rejected after account switch',(await httpCall('/context',{})).status===401);
  const secondTicket=await onboarding.issue(),secondJoin=await cli(null,'join','--discovery',secondTicket.discovery,'--ticket',secondTicket.ticket,'--name','申请验证 Agent');
  const applicationFile=path.join(output,'agent-application.json');fs.writeFileSync(applicationFile,JSON.stringify({about:'我会维护可复验的协作工具并记录设计和测试证据。',participation:'计划完善工程师接入体验，验证权限和恢复边界并公开结果。'}));
  let intentRejected=false;try{await cli(null,'apply','--connection',secondJoin.connection_file,'--body-file',applicationFile);}catch(error){intentRejected=error.stderr.includes('engineer_intent_and_application_required');}
  check('Agent application requires explicit engineer intent',intentRejected);
  const submitted=await cli(null,'apply','--connection',secondJoin.connection_file,'--body-file',applicationFile,'--engineer-intent');
  const repeated=await cli(null,'apply','--connection',secondJoin.connection_file,'--body-file',applicationFile,'--engineer-intent');
  check('authorized application submits once and reconciles a lost reply',submitted.context.access.application.status==='pending'&&repeated.application.already_submitted);
  await root.verify({password:'fixture-password'});await root.call('/admin/applications/review',{id:submitted.context.access.application.id,decision:'rejected',reason:'隔离验收：请补充具体工程方向。'});
  const rejected=await cli(null,'context','--connection',secondJoin.connection_file);
  check('rejected applicant receives the real reason without proposal promises',!rejected.ready&&rejected.context.access.application.status==='rejected'&&rejected.context.access.application.reason.includes('具体工程方向'));
  const secondConfig=JSON.parse(fs.readFileSync(secondJoin.connection_file));
  await settleQuota();if(onboarding.contextFlight)await onboarding.contextFlight.promise;
  const beforeSwitch=cloud.fetch;let contextStarted=false,releaseContext,startedContext;
  const contextBarrier=new Promise(resolve=>{releaseContext=resolve;}),contextEntry=new Promise(resolve=>{startedContext=resolve;});
  /* @chain-region verifyWorkspace.cloud.fetch | calls: some, pathname.endsWith, URL, startedContext, beforeSwitch */ cloud.fetch=async(url,options)=>{if(['/goals','/board'].some(route=>new URL(url).pathname.endsWith(route))){contextStarted=true;startedContext('started');await contextBarrier;}return beforeSwitch(url,options);};
  const inflight=httpCall('/context',{},secondConfig.resume);
  const overlap=await Promise.race([contextEntry,inflight.then(value=>'early_'+value.status),delay(5000).then(()=>'timeout')]);
  try{await cloud.logout();}finally{releaseContext();}
  const interrupted=await inflight;cloud.fetch=beforeSwitch;
  fs.writeFileSync(path.join(output,'context-isolation.json'),JSON.stringify({overlap,contextStarted,status:interrupted.status,hasAccess:!!interrupted.value.access,error:interrupted.value.error||null},null,2));
  check('in-flight context cannot cross an account session change',overlap==='started'&&contextStarted&&[401,503].includes(interrupted.status)&&!interrupted.value.access);
  await login(cloud,2);
  check('same account fresh login cannot reuse an old desktop session ticket',(await httpCall('/context',{},secondConfig.resume)).status===401);
  await cloud.logout();
  fs.writeFileSync(path.join(output,'workspace.json'),JSON.stringify({automaticPassed:true,checks,timings,executable:process.execPath,profile,servicePid:host.child.pid,scope:'Actual EXE, synthetic New API/Python cloud, isolated profiles; source Save dialog replaced with owned output path; no production writes',screenshotsRequireVisualReview:true},null,2));
 }finally{await root.logout();root.close();await second.logout();second.close();}
 /* @chain-region verifyWorkspace.navigateHome | calls: click, wait */ async function navigateHome(){await click('[data-tab=home]');await click('[data-home=goals]');await wait("document.querySelector('.mission')");}
}
module.exports={verifyWorkspace};
