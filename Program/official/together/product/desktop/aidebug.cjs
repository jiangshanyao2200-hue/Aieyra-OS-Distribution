/* @file-map:start
文件: link/desktop/aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/readability-aidebug.cjs
上游: link/desktop/main.cjs, link/desktop/workspace-aidebug.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  delay | function
  request | function
  fixture | function
  verifyDesktop | function
  verifyDesktop.check | function
  verifyDesktop.run | function
  verifyDesktop.waitFor | function
  verifyDesktop.capture | function
  verifyDesktop.compact | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Explicit isolated desktop acceptance. Nothing runs without --aidebug-output/profile.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {measureReadability}=require('./readability-aidebug.cjs');
const /* @chain-region delay | calls: Promise, setTimeout */ delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/* @chain-region request | calls: Promise, Buffer.from, JSON.stringify, http.request, res.on, chunks.push, toString, Buffer.concat … */ function request(origin, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(origin + route, { method: raw ? 'POST' : 'GET', timeout: 8000,
      headers: { ...headers, ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': raw.length } : {}) } }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let value; try { value = JSON.parse(text); } catch { value = text; }
        resolve({ status: res.statusCode, headers: res.headers, value });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('test_request_timeout')));
    req.end(raw);
  });
}

/* @chain-region fixture | calls: path.join, fs.existsSync, JSON.parse, fs.readFileSync, map, toString, crypto.randomBytes, fs.writeFileSync … */ async function fixture(host, profile, project='os') {
  const file = path.join(profile, 'aidebug-fixtures.json');
  const resumed = fs.existsSync(file);
  let peers;
  if (fs.existsSync(file)) peers = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    peers = ['界面工程师', '协作工程师', '协议工程师', '测试工程师', '组件工程师', '文档工程师'].map((name, i) => ({
      name, id: 'desktop-fixture-' + i, token: crypto.randomBytes(32).toString('base64url'), sid: 'debug-session-' + i,
    }));
    fs.writeFileSync(file, JSON.stringify(peers), { mode: 0o600 });
  }
  const session = await request(host.origin, '/api/session');
  const ownerHeaders = { Origin: host.origin, 'X-Control-CSRF': session.value.csrf };
  const ids = [];
  for (const [i, peer] of peers.entries()) {
    const enrollment = await request(host.origin, '/api/agent-access/enroll', {
      request_id: peer.id, name: peer.name, project, token: peer.token,
    }, ownerHeaders);
    assert.equal(enrollment.status, 200, JSON.stringify(enrollment.value));
    ids.push(enrollment.value.credential.actor_id);
    const headers = { Authorization: 'Bearer ' + peer.token };
    const seats = await request(host.origin, '/api/agent/v1/seats', undefined, headers);
    assert.equal(seats.status, 200);
    const seat = seats.value.seats[0];
    const previous = await request(host.origin, '/api/agent/v1/sessions/' + peer.sid, undefined, headers);
    const active = previous.status === 200 && previous.value.session.state === 'connected' &&
      previous.value.session.lease_until > Date.now() / 1000;
    if (!active) {
      peer.sid = 'debug-' + crypto.randomUUID();
      fs.writeFileSync(file, JSON.stringify(peers), { mode: 0o600 });
    }
    const connected = await request(host.origin, '/api/agent/v1/' + (active ? 'heartbeat' : 'connect'), active ? {
      request_id: 'heartbeat-' + crypto.randomUUID(), session_id: peer.sid, runtime_state: 'idle',
    } : {
      request_id: 'connect-' + crypto.randomUUID(), session_id: peer.sid, seat_id: seat.id,
      seat_epoch: seat.epoch, native_session_id: 'isolated-native-' + i,
    }, headers);
    assert.equal(connected.status, 200, JSON.stringify(connected.value));
    // On restart, read the original records; never replay prior work with new request IDs.
    if (resumed) continue;
    const message = await request(host.origin, '/api/agent/v1/center/message', {
      request_id: 'message-' + peer.id, session_id: peer.sid, project, kind: 'discussion',
      body: '独立验收：' + peer.name + '已接入本机 Link。',
    }, headers);
    assert.equal(message.status, 200, JSON.stringify(message.value));
    if (i === 0) {
      const task = await request(host.origin, '/api/agent/v1/center/task-create', {
        request_id: 'desktop-fixture-task', session_id: peer.sid, id: 'desktop-fixture-task', project,
        title: '验证独立 Link 工位与协作界面', scope: 'AIDEBUG / isolated local acceptance',
      }, headers);
      assert.equal(task.status, 200, JSON.stringify(task.value));
    }
  }
  return ids;
}

/* @chain-region verifyDesktop | calls: fs.mkdirSync, request, check, path.join, path.dirname, path.resolve, fs.existsSync, waitFor … */ async function verifyDesktop({ window, host, output, profile, version, fixtures }) {
  fs.mkdirSync(output, { recursive: true });
  const checks = [];
  const /* @chain-region verifyDesktop.check | calls: assert.ok, checks.push */ check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  const /* @chain-region verifyDesktop.run | calls: window.webContents.executeJavaScript */ run = code => window.webContents.executeJavaScript(code, true);
  const readability=[];
  /* @chain-region verifyDesktop.waitFor | calls: run, delay, Error */ async function waitFor(code) {
    for (let i = 0; i < 60; i++) { if (await run(code)) return; await delay(200); }
    throw new Error('desktop_render_timeout');
  }
  /* @chain-region verifyDesktop.capture | calls: run, delay, window.webContents.capturePage, fs.writeFileSync, path.join, image.toPNG, measureReadability, readability.push … */ async function capture(name) {
    await run('document.fonts.ready.then(() => true)');
    await delay(350);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
    const measured=await measureReadability(window.webContents);
    readability.push({name,...measured});
    fs.writeFileSync(path.join(output,'readability.json'),JSON.stringify(readability,null,2));
    check(name+' has readable text and named controls',!measured.smallText.length&&!measured.unnamedControls.length);
  }
  const compactGeometry=[];
  /* @chain-region verifyDesktop.compact | calls: window.setSize, window.webContents.setZoomFactor, delay, run, JSON.stringify, compactGeometry.push, fs.writeFileSync, path.join … */ async function compact(name,selectors){
    window.setSize(700,540);window.webContents.setZoomFactor(2);await delay(220);
    const measured=await run(`(()=>{const controls=[...document.querySelectorAll(${JSON.stringify(selectors)})].filter(n=>!n.disabled&&n.checkVisibility()).map(n=>{n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {name:n.ariaLabel||n.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,hittable:hit===n||n.contains(hit)};});return {viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,controls};})()`);
    compactGeometry.push({name,...measured});fs.writeFileSync(path.join(output,'office-compact-geometry.json'),JSON.stringify(compactGeometry,null,2));
    check(name+' keeps its controls reachable at 200%',measured.pageWidth<=measured.viewport[0]+1&&measured.controls.length>0&&measured.controls.every(r=>r.left>=0&&r.right<=measured.viewport[0]+1&&r.top>=0&&r.bottom<=measured.viewport[1]+1&&r.hittable));
    await capture(name+'-200');window.webContents.setZoomFactor(1);window.setSize(1280,720);await delay(220);
  }
  const health = await request(host.origin, '/api/health');
  check('local service owned by standalone Link', health.status === 200 && health.value.owner_kind === 'link');
  const guide = await request(host.origin, '/api/office/guide');
  const packagedLink=path.join(path.dirname(process.execPath),'resources/link');
  check('guide uses bundled Python and own scripts', guide.status === 200 && path.resolve(guide.value.python_executable)===path.join(packagedLink,'runtime/python/python.exe') && path.resolve(guide.value.station_script)===path.join(packagedLink,'office/scripts/agent-station.py') && fs.existsSync(guide.value.station_script));
  const denied = await request(host.origin, '/api/agent-access/enroll', {});
  check('unauthorized local writes rejected', denied.status === 403);
  const foreign = await request(host.origin, '/api/session', undefined, { Origin: 'https://example.invalid' });
  check('foreign origins rejected', foreign.status === 403);
  const native = await request(host.origin, '/api/link');
  check('native runtime included; automatic LAN not enabled', native.status === 200 && native.value.auto_lan?.auto_connect === false);
  for (const route of ['/ui-foundation.css','/ui-ticker.mjs','/motion.mjs','/tooltip.mjs','/model-card.mjs','/preview-card.mjs','/fonts/notosanssc-variable.woff2']) {
    const asset = await request(host.origin, route);
    check('bundled asset ' + route, asset.status === 200);
  }
  await waitFor("!!document.querySelector('[data-panel=stations]') && !document.querySelector('.boot')");
  check('renderer is sandboxed', await run("typeof require === 'undefined' && typeof process === 'undefined'"));
  await capture('desktop-empty');
  const actorIds = fixtures ? await fixture(host, profile) : [];
  if (fixtures) {
    window.webContents.reload();
    await waitFor("document.querySelectorAll('.home-seat').length === 6");
    check('six enrolled stations rendered', true);
    for (const width of [1360, 900, 700]) {
      window.setSize(width, 900);
      await delay(450);
      const layout = await run(`(() => {const nodes=[...document.querySelectorAll('.home-seat')];return {portraits:nodes.every(n=>n.querySelector('.portrait-sprite')&&getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)'),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      check('no page overflow at ' + width, !layout.overflow);
      check('six stations render transparent portrait rows at ' + width, layout.portraits);
      await capture('stations-' + width);
    }
    const geometry=[];
    for(const [width,height] of [[1280,720],[900,700],[700,540]])for(const zoom of [1,1.25,1.5,2]){
      window.setSize(width,height);window.webContents.setZoomFactor(zoom);await delay(220);
      const measured=await run(`(()=>{const seats=[...document.querySelectorAll('.home-seat')],view=document.querySelector('#link-view');return {viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,viewWidth:view.clientWidth,viewScrollWidth:view.scrollWidth,hiddenScrollbar:getComputedStyle(view).scrollbarWidth==='none',seats:seats.map(n=>{n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:hit===n||n.contains(hit)};})};})()`);
      geometry.push({width,height,zoom,...measured});fs.writeFileSync(path.join(output,'office-geometry.json'),JSON.stringify(geometry,null,2));
      if(width===700&&zoom===2)await capture('stations-compact-200');
      check(`six stations remain reachable at ${width}x${height} ${zoom*100}%`,measured.pageWidth<=measured.viewport[0]+1&&measured.viewScrollWidth<=measured.viewWidth+1&&measured.hiddenScrollbar&&measured.seats.length===6&&measured.seats.every(r=>r.left>=0&&r.right<=measured.viewport[0]+1&&r.top>=0&&r.bottom<=measured.viewport[1]+1&&r.reachable));
      if(width===700&&zoom===1.5)await capture('stations-compact-150');
    }
    window.webContents.setZoomFactor(1);window.setSize(1280,720);
    await run("document.querySelector('.home-seat').click()");await waitFor("!!document.querySelector('.station-detail')");
    check('ordinary connection diagnostics stay available without dominating station details',await run("!!document.querySelector('.connection-details')&&!document.querySelector('.connection-details').open&&document.querySelector('.station-detail').textContent.includes('最新动态')"));
    await capture('station-details');
    await compact('station-details','#link-back,.connection-details>summary,.station-detail [data-message]');
    await run("document.querySelector('.connection-details').open=true");await capture('station-connection-details');
    await run("document.querySelector('#link-back').click()");await waitFor("document.querySelectorAll('.home-seat').length===6");
    window.setSize(1360, 900);
    await run("document.querySelector('[data-panel=chat]').click()");
    await waitFor("document.querySelector('.group-messages')?.textContent.includes('独立验收')");
    check('real isolated messages rendered', true);
    await capture('chat');
    await compact('chat','[data-history],.group-original>summary');
    await run("document.querySelector('[data-panel=tasks]').click()");
    await waitFor("document.querySelector('.ticket')?.textContent.includes('验证独立 Link')");
    check('real isolated task rendered', true);
    await capture('tasks');
    await compact('tasks','[data-history],[data-show-chat],[data-task]');
    await run("document.querySelector('[data-panel=stations]').click(); document.querySelector('#link-connection').click()");
    await waitFor("document.querySelector('#link-connections').matches(':popover-open')");
    check('join popover opens', true);
    await capture('joining');
    await compact('joining','#link-join,#link-adapters summary');
    await run("const summary=document.querySelector('#link-adapters summary');summary.scrollIntoView({block:'nearest'});summary.click()");
    check('messaging checks explain unverified results and retain the original host type on demand',await run("document.querySelector('#link-adapters details').open&&document.querySelector('#link-adapters details').textContent.includes('未验证')&&document.querySelector('#link-adapters details').textContent.includes('generic')"));
    await capture('joining-checks');
  }
  fs.writeFileSync(path.join(output, 'desktop.json'), JSON.stringify({
    product: 'Aieyra Together Link', version, mode: 'local-os-link', url: window.webContents.getURL(),
    executable: process.execPath, profile, servicePid: host.child.pid, checks, actorIds,
    automaticPassed: true, screenshotsRequireVisualReview: true,
    scope: 'Isolated local fixtures only; no cloud membership or real host messages',
  }, null, 2));
}
module.exports = { verifyDesktop, request, fixture };
