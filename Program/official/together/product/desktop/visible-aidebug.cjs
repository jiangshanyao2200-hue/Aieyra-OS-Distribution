/* @file-map:start
文件: link/desktop/visible-aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/aidebug-control.cjs, link/desktop/cloud-client.cjs, link/desktop/onboarding.cjs
上游: link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  delay | function
  startVisible | function
  startVisible.run | function
  startVisible.notify | function
  startVisible.login | function
  startVisible.person | function
  startVisible.selector | function
  startVisible.click | function
  startVisible.capture | function
  startVisible.controls | function
  startVisible.status | method
  startVisible.dispatch | method
  startVisible.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const {safeStorage, ipcMain, app, nativeImage} = require('electron');
const {CloudClient} = require('./cloud-client.cjs');
const {Onboarding} = require('./onboarding.cjs');
const {startControl} = require('./aidebug-control.cjs');
const /* @chain-region delay | calls: Promise, setTimeout */ delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const methods = new Set(['state','refresh','call','workStatus','personalStation','lock']);
/* @chain-region startVisible | calls: Map, ipcMain.handle, Error, controls, officeView.getVisible, officeView.setVisible, state.history.find, toString … */ async function startVisible({window, officeView, cloud, host, onboarding, output, profile, shellURL}) {
  const state = {mode:'visible-isolated',title:'准备可见测试',detail:'六名模拟工程师 · 独立测试数据',paused:false,delayMs:7000,step:0,advance:0,done:false,history:[]};
  const peers = new Map(), brokers = new Map();
  let reviewOffice = false;
  const /* @chain-region startVisible.run | calls: contents.executeJavaScript, Error */ run = async (code, contents = window.webContents) => {
    const result = await contents.executeJavaScript(`(async()=>{try{return {ok:true,value:await (${code})};}catch(error){return {ok:false,error:error.message};}})()`,true);
    if (!result.ok) throw Error(result.error);
    return result.value;
  };
  const /* @chain-region startVisible.notify | calls: window.isDestroyed, window.webContents.send, fs.writeFileSync, path.join, JSON.stringify */ notify = () => {if (!window.isDestroyed()) window.webContents.send('link:aidebug-state', state);fs.writeFileSync(path.join(output,'visible-state.json'),JSON.stringify(state,null,2));};
  const /* @chain-region startVisible.login | calls: includes, Error, URL, client.beginLogin, fetch, url.searchParams.get, AbortSignal.timeout, response.headers.get … */ login = async (client, id) => {
    if (![1,2,3,4,5,6,100].includes(id)) throw Error('fixture_user_required');
    const url = new URL(await client.beginLogin());
    const response = await fetch(cloud.origin + '/aieyra/os/authorize?flow=' + url.searchParams.get('flow'), {headers:{'x-os-auth-bridge':'fixture-auth-bridge',cookie:'session=fixture-' + id},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if (response.status !== 302) throw Error('fixture_login_failed');
    const callback = new URL(response.headers.get('location'));
    return client.completeLogin(new URL(callback.pathname + callback.search, cloud.origin).href);
  };
  const /* @chain-region startVisible.person | calls: includes, Error, peers.has, CloudClient, path.join, login, peers.set, peers.get */ person = async id => {
    if (id === 1) return cloud;
    if (![2,3,4,5,6,100].includes(id)) throw Error('fixture_user_required');
    if (!peers.has(id)) {const client = new CloudClient({directory:path.join(profile,'engineer-' + id),safeStorage,origin:cloud.origin});await login(client,id);peers.set(id,client);}
    return peers.get(id);
  };
  const /* @chain-region startVisible.selector | calls: Error, JSON.stringify */ selector = value => {if (typeof value !== 'string' || !value || value.length > 500) throw Error('invalid_selector');return JSON.stringify(value);};
  const /* @chain-region startVisible.click | calls: run, selector, Math.round, window.webContents.getZoomFactor, window.webContents.sendInputEvent, delay */ click = async value => {
    const point = await run(`(()=>{const n=document.querySelector(${selector(value)});if(!n||n.disabled)throw Error('element_unavailable');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();if(!r.width||!r.height)throw Error('element_hidden');const x=r.x+r.width/2,y=r.y+r.height/2;if(!n.contains(document.elementFromPoint(x,y)))throw Error('element_occluded');return {x,y};})()`);
    point.x = Math.round(point.x * window.webContents.getZoomFactor());point.y = Math.round(point.y * window.webContents.getZoomFactor());
    for (const type of ['mouseMove','mouseDown','mouseUp']) window.webContents.sendInputEvent({type,button:'left',clickCount:1,...point});
    await delay(100);return {clicked:true};
  };
  const /* @chain-region startVisible.capture | calls: test, Error, path.join, window.webContents.capturePage, officeView.getVisible, window.getContentSize, officeView.getBounds, toBitmap … */ capture = async name => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name || '')) throw Error('invalid_capture_name');
    const file = path.join(output,name + '.png');
    let captured = await window.webContents.capturePage();
    const layers=['shell'];
    // Electron captures each WebContents separately. Composite the actual office pixels
    // at their native child bounds, otherwise its region is blank in shell captures.
    if (officeView.getVisible()) {
      const [width,height]=window.getContentSize(),bounds=officeView.getBounds();
      const bitmap=captured.resize({width,height}).toBitmap();
      const office=await officeView.webContents.capturePage();
      const child=office.resize({width:bounds.width,height:bounds.height}).toBitmap();
      for(let y=0;y<bounds.height&&y+bounds.y<height;y++)child.copy(bitmap,((y+bounds.y)*width+bounds.x)*4,y*bounds.width*4,(y+1)*bounds.width*4);
      captured=nativeImage.createFromBitmap(bitmap,{width,height,scaleFactor:1});layers.push('office');
    }
    fs.writeFileSync(file,captured.toPNG());fs.writeFileSync(path.join(output,name+'-capture.json'),JSON.stringify({layers,visible:window.isVisible(),at:new Date().toISOString()}));return file;
  };
  const /* @chain-region startVisible.controls | calls: includes, notify */ controls = body => {
    if (typeof body.paused === 'boolean') state.paused = body.paused;
    if ([2000,7000,15000].includes(body.delayMs)) state.delayMs = body.delayMs;
    if (body.next) {state.paused = true;state.advance++;}
    notify();return state;
  };
  ipcMain.handle('link:aidebug', async (event, command) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== shellURL) throw Error('invalid_debug_sender');
    if (command?.op === 'state') return state;
    if (command?.op === 'controls') return controls(command);
    if (command?.op === 'review') {
      if (command.open) {reviewOffice=officeView.getVisible();officeView.setVisible(false);}
      else if (reviewOffice) {officeView.setVisible(true);reviewOffice=false;}
      return {open:!!command.open};
    }
    if (command?.op === 'image') {
      const entry = state.history.find(item => item.id === command.id);
      if (!entry?.capture) throw Error('capture_not_found');
      return 'data:image/png;base64,' + fs.readFileSync(entry.capture).toString('base64');
    }
    throw Error('invalid_debug_action');
  });
  const control = await startControl({output,/* @chain-region startVisible.status | calls: window.isVisible */ status:() => ({...state,office:host.origin,visible:window.isVisible()}),/* @chain-region startVisible.dispatch | calls: methods.has, Array.isArray, Error, run, JSON.stringify, Object.assign, login, cloud.state … */ dispatch:async command => {
    const {op} = command;
    if (op === 'frontend') {
      if (!methods.has(command.method) || !Array.isArray(command.args) || command.args.length > 2) throw Error('frontend_method_denied');
      const result = await run(`window.linkHost[${JSON.stringify(command.method)}](...${JSON.stringify(command.args)})`);
      if (!result.ok) throw Object.assign(Error(result.error),{status:result.status,code:result.code,retryAfter:result.retryAfter,outcomeUnknown:result.outcomeUnknown});
      return result.data;
    }
    if (op === 'login') {await login(cloud,1);return cloud.state();}
    if (op === 'person') {const client = await person(command.user);if (command.verify) await client.verify({password:'fixture-password'});return command.route ? client.call(command.route,command.body) : client.refresh();}
    if (op === 'issue') {
      const id = command.user;
      if (id === 1) return onboarding.issue();
      const client = await person(id);if (id === 100) throw Error('engineer_required');
      if (!brokers.has(id)) {const broker = new Onboarding({cloud:client,host,directory:path.join(profile,'engineer-' + id),discovery:path.join(profile,'engineer-' + id,'onboarding.json'),safeStorage,python:onboarding.python,cli:onboarding.cli,proposalServer:onboarding.proposalServer});await broker.start();brokers.set(id,broker);}
      return brokers.get(id).issue();
    }
    if (op === 'click') return click(command.selector);
    if (op === 'scroll') return run(`(()=>{const n=document.querySelector(${selector(command.selector)});if(!n)throw Error('element_unavailable');n.scrollIntoView({block:'start'});return {scrolled:true};})()`);
    if (op === 'viewport') {
      if(!Number.isInteger(command.width)||command.width<700||command.width>1600||!Number.isInteger(command.height)||command.height<540||command.height>1000||![1,1.25].includes(command.zoom))throw Error('invalid_viewport');
      window.setSize(command.width,command.height);window.webContents.setZoomFactor(command.zoom);officeView.webContents.setZoomFactor(command.zoom);
      const [width,height]=window.getContentSize(),top=Math.round(136*command.zoom);officeView.setBounds({x:0,y:top,width,height:Math.max(1,height-top)});
      return {bounds:window.getBounds(),content:window.getContentSize(),zoom:command.zoom};
    }
    if (op === 'input') {
      if (typeof command.text !== 'string' || command.text.length > 8000) throw Error('invalid_input');
      await click(command.selector);
      if (!await run(`document.activeElement===document.querySelector(${selector(command.selector)})`)) throw Error('input_not_focused');
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
      await window.webContents.insertText(command.text);return {typed:true};
    }
    if (op === 'key') {if (!['Escape','Enter','Tab'].includes(command.key)) throw Error('invalid_key');for (const type of ['keyDown','keyUp']) window.webContents.sendInputEvent({type,keyCode:command.key});return {sent:true};}
    if (op === 'read') {
      const contents = command.view === 'office' ? officeView.webContents : window.webContents;
      return run(`Array.from(document.querySelectorAll(${selector(command.selector || '#workspace')})).slice(0,100).map(n=>{const r=n.getBoundingClientRect();return {text:(n.innerText||n.textContent)?.slice(0,30000),value:n.type==='password'?undefined:n.value,open:typeof n.open==='boolean'?n.open:undefined,disabled:n.disabled,hidden:n.hidden,attributes:Object.fromEntries(Array.from(n.attributes).filter(a=>!['data-read-body','value','src'].includes(a.name)).map(a=>[a.name,a.value])),image:n.tagName==='IMG'?{complete:n.complete,width:n.naturalWidth,height:n.naturalHeight}:undefined,rect:{x:r.x,y:r.y,width:r.width,height:r.height},overflow:n.scrollWidth>n.clientWidth+1};})`,contents);
    }
    if (op === 'capture') return {path:await capture(command.name)};
    if (op === 'stage') {
      if (!/^[a-z0-9_-]{1,60}$/.test(command.id || '') || typeof command.title !== 'string' || command.title.length > 100 || typeof command.detail !== 'string' || command.detail.length > 400 || state.history.some(item => item.id === command.id)) throw Error('invalid_stage');
      state.step++;state.title=command.title;state.detail=command.detail;notify();await delay(500);
      state.history.push({id:command.id,title:command.title,detail:command.detail,at:new Date().toISOString(),capture:await capture(command.id)});notify();return state;
    }
    if (op === 'controls') return controls(command);
    if (op === 'complete') {state.done=true;state.paused=true;state.title='流程已完成 · 可自由查看';state.detail='打开「阶段回看」查看每一步；当前窗口保留最终真实状态。';notify();return state;}
    if (op === 'quit') {setTimeout(()=>app.quit(),300);return {closing:true};}
    throw Error('operation_denied');
  }});
  window.webContents.on('did-finish-load', notify);
  window.setTitle('Aieyra 众创 Link · AIDEBUG 隔离测试');window.show();notify();
  return {/* @chain-region startVisible.close | calls: ipcMain.removeHandler, brokers.values, broker.close, peers.values, client.close, control.close */ async close(){ipcMain.removeHandler('link:aidebug');for(const broker of brokers.values())await broker.close();for(const client of peers.values())client.close();await control.close();}};
}
module.exports = {startVisible};
