/* @file-map:start
文件: link/desktop/modal-aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  verifyModals | function
  verifyModals.run | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
/* @chain-region verifyModals | calls: window.webContents.setBackgroundThrottling, window.webContents.setFrameRate, run, diagnostics.dispatch, window.webContents.sendInputEvent, assert.ok, assert.equal, samples.push … */ async function verifyModals({window,officeView,output,diagnostics}){
 const /* @chain-region verifyModals.run | calls: window.webContents.executeJavaScript */ run=code=>window.webContents.executeJavaScript(code,true);
 window.webContents.setBackgroundThrottling(false);window.webContents.setFrameRate(60);
 await run(`new Promise(resolve=>{const ready=()=>document.getElementById('system-settings')?.onclick||document.querySelector('[data-action=login]');if(ready())resolve();else{const timer=setInterval(()=>{if(ready()){clearInterval(timer);resolve();}},50);}})`);
 await run(`document.querySelector('#desktop-background').classList.add('enabled','has-image');document.querySelector('.background-layer').src='./backgrounds/fallback.webp';document.querySelector('.background-layer').classList.add('visible');`);
 const samples=[];
 for(const type of ['settings','form','detail'])for(let i=0;i<3;i++){
  await run(type==='settings'?`document.getElementById('system-settings').click();`:
   type==='form'?`document.getElementById('dialog-title').textContent='资料';document.getElementById('dialog-body').innerHTML='<form><label>内容<input value="保留草稿"></label><textarea>原始工作正文</textarea></form>';document.getElementById('dialog').showModal();`:
   `(()=>{const button=document.createElement('button');button.dataset.readTitle='工作详情';button.dataset.readBody='完整工作正文。'.repeat(400);document.body.append(button);button.click();button.remove();})()`);
  const id=type==='detail'?'detail-dialog':'dialog';
  const point=await run(`new Promise(resolve=>setTimeout(()=>{const d=document.getElementById('${id}'),b=d.querySelector('[data-dialog-close]'),r=b.getBoundingClientRect();window.__closeProbe={id:'${id}',frames:[],start:0};const frame=t=>{const p=window.__closeProbe;if(!p)return;p.frames.push(t);if(p.frames.length<50)requestAnimationFrame(frame);};requestAnimationFrame(frame);b.addEventListener('pointerdown',()=>window.__closeProbe.start=performance.now(),{capture:true,once:true});resolve({x:r.x+r.width/2,y:r.y+r.height/2});},350))`);
  if(diagnostics&&i===0){
   await diagnostics.dispatch({op:'capture',name:type+'-open'});
   await diagnostics.dispatch({op:'filmstrip',name:type+'-close',selector:'#'+id+' [data-dialog-close]',duration:500});
  }else{
   window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
   window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
  }
  const result=await run(`new Promise(resolve=>setTimeout(()=>{const p=window.__closeProbe,d=document.getElementById(p.id),after=p.frames.filter(t=>t>=p.start),gaps=p.frames.slice(1).map((t,i)=>({t,gap:t-p.frames[i]})).filter(v=>v.t>=p.start&&v.t<p.start+250);resolve({start:p.start,open:d.open,display:getComputedStyle(d).display,firstFrame:after[0]-p.start,maxGap:Math.max(...gaps.map(v=>v.gap)),backdropFilter:getComputedStyle(d,'::backdrop').backdropFilter});window.__closeProbe=null;},320))`);
  assert.ok(result.start>0,'real pointer input must reach X');assert.equal(result.open,false);assert.equal(result.display,'none');samples.push({type,iteration:i,...result});
 }
 const office=await officeView.webContents.executeJavaScript(`(()=>{const d=document.createElement('dialog');d.innerHTML='<p>本机工位详情</p>';document.body.append(d);d.showModal();d.close();const s=getComputedStyle(d);return {display:s.display,backdropFilter:getComputedStyle(d,'::backdrop').backdropFilter};})()`,true);
 assert.equal(office.display,'none');
 if(diagnostics){
  officeView.setVisible(true);
  try{
   await officeView.webContents.executeJavaScript(`(()=>{const d=document.createElement('dialog');d.id='diagnostic-office-dialog';d.innerHTML='<form method="dialog"><h2>本机工位详情</h2><p>实际子视图弹窗关闭检查</p><button id="diagnostic-office-close">关闭</button></form>';document.body.append(d);d.showModal();})()`,true);
   await diagnostics.dispatch({op:'capture',name:'office-open'});
   await diagnostics.dispatch({op:'filmstrip',name:'office-close',view:'office',selector:'#diagnostic-office-close',duration:500});
  }finally{officeView.setVisible(false);}
  await diagnostics.dispatch({op:'snapshot',name:'final-snapshot'});
  await diagnostics.dispatch({op:'trace-start'});await run(`document.getElementById('system-settings').click()`);
  await diagnostics.dispatch({op:'click',selector:'#background-mode'});
  await new Promise(resolve=>setTimeout(resolve,200));await diagnostics.dispatch({op:'capture',name:'settings-menu'});
  await diagnostics.dispatch({op:'click',selector:'#dialog [data-dialog-close]'});
  await diagnostics.dispatch({op:'trace-stop',name:'close-trace'});
 }
 fs.writeFileSync(path.join(output,'modal-performance.json'),JSON.stringify({passed:true,version:require('./package.json').version,samples,office},null,2));
 fs.writeFileSync(path.join(output,'settings.png'),(await window.webContents.capturePage()).toPNG());
}
module.exports={verifyModals};
