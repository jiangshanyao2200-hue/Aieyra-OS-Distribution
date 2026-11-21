/* @file-map:start
文件: link/desktop/session-aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  delay | function
  verifySession | function
  verifySession.check | function
  verifySession.run | function
  verifySession.wait | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {safeStorage}=require('electron');
const /* @chain-region delay | calls: Promise, setTimeout */ delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/* @chain-region verifySession | calls: check, URL, path.isAbsolute, cloud.state, cloud.beginLogin, fetch, url.searchParams.get, assert.equal … */ async function verifySession({window,cloud,output,mode}){
 const checks=[],/* @chain-region verifySession.check | calls: assert.ok, checks.push */ check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
 const /* @chain-region verifySession.run | calls: window.webContents.executeJavaScript */ run=code=>window.webContents.executeJavaScript(code,true);
 const /* @chain-region verifySession.wait | calls: run, delay, Error */ wait=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await delay(100);}throw Error('session UI timeout: '+code);};
 check('fixture uses loopback and isolated output',new URL(cloud.origin).hostname==='127.0.0.1'&&path.isAbsolute(output));
 if(mode==='login'){
  check('first launch starts signed out',!cloud.state().signedIn);
  const url=new URL(await cloud.beginLogin());
  const response=await fetch(cloud.origin+'/aieyra/os/authorize?flow='+url.searchParams.get('flow'),{headers:{'x-os-auth-bridge':'fixture-auth-bridge',cookie:'session=fixture-100'},redirect:'manual'});
  assert.equal(response.status,302);const callback=new URL(response.headers.get('location'));
  await cloud.completeLogin(new URL(callback.pathname+callback.search,cloud.origin).href);
  await cloud.verify({password:'fixture-password'});
  check('login completed and a management grant was explicitly issued',cloud.state().signedIn&&cloud.grant?.expiresAt>Date.now());
  const bytes=fs.readFileSync(cloud.file),saved=JSON.parse(safeStorage.decryptString(bytes));
  check('Windows encrypted session excludes plaintext token and private key',!bytes.includes(Buffer.from(cloud.session.accessToken))&&!bytes.includes(Buffer.from('PRIVATE KEY')));
  check('management grant is not persisted',!JSON.stringify(saved).includes(cloud.grant.token));
 }else if(mode==='loggedout'){
  check('explicit logout survives another process launch',!cloud.state().signedIn&&!fs.existsSync(cloud.file));
 }else{
  check('new process restored a valid encrypted login',cloud.state().signedIn);
  check('management grant is locked on every new process',cloud.grant===null);
  if(mode==='offline'){
   // Startup already performs the live check; avoid a second request during backoff.
   await wait("document.querySelector('h1')?.textContent==='暂时无法验证登录'");
   check('temporary upstream failure preserves the saved login',cloud.state().signedIn&&fs.existsSync(cloud.file));
   check('offline restoration offers retry without a new login',await run("!!document.querySelector('[data-action=refresh]')&&!document.querySelector('[data-action=login]')"));
  }else{
   await cloud.refresh();check('restored session passes live account verification',cloud.cachedAccess()?.member);
   if(mode==='restore'){
    await cloud.verify({password:'fixture-password'});check('restored root may request a fresh password grant',!!cloud.grant);
   }else if(mode==='logout'){
    await cloud.logout();check('logout removes the encrypted credential',!cloud.state().signedIn&&!fs.existsSync(cloud.file));
   }else throw Error('Unknown session test mode');
  }
 }
 if(mode==='loggedout'||mode==='logout')await wait("!!document.querySelector('[data-action=login]')");
 else if(mode!=='offline')await wait("!!document.querySelector('[data-welcome-phase=connect]')");
 fs.writeFileSync(path.join(output,'session.png'),(await window.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(output,'session.json'),JSON.stringify({passed:true,mode,checks,executable:process.execPath,scope:'Isolated fixture and Windows safeStorage; no real account access'},null,2));
}
module.exports={verifySession};
