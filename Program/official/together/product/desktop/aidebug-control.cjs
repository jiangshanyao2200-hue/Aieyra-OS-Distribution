/* @file-map:start
文件: link/desktop/aidebug-control.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/control.test.cjs, link/desktop/aidebug-live.cjs, link/desktop/visible-aidebug.cjs
链路: observation
验证: AIDEBUG/control.test.cjs, AIDEBUG/observe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  canonical | function
  failure | function
  startControl | function
  startControl.persist | function
  startControl.reply | function
  startControl.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Loopback control shared by isolated tests and the user's development diagnostics.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const /* @chain-region canonical | calls: Array.isArray, value.map, Object.fromEntries, map, sort, Object.keys, canonical */ canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const /* @chain-region failure | calls: Object.assign, Error */ failure = (message, status = 400) => Object.assign(Error(message), {status});
/* @chain-region startControl | calls: toString, crypto.randomBytes, Map, path.join, fs.mkdirSync, fs.existsSync, filter, split … */ async function startControl({output, dispatch, status}) {
  const token = crypto.randomBytes(32).toString('base64url'), receipts = new Map();
  const journal = path.join(output, 'control-receipts.jsonl');
  fs.mkdirSync(output, {recursive:true});
  if (fs.existsSync(journal)) for (const line of fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean)) {
    const receipt = JSON.parse(line);
    if (receipt.state === 'accepted' || receipt.state === 'running') receipt.state = 'unknown';
    receipts.set(receipt.request_id, receipt);
  }
  let queue = Promise.resolve(), pending = 0, closing = false;
  const /* @chain-region startControl.persist | calls: fs.appendFileSync, JSON.stringify */ persist = receipt => fs.appendFileSync(journal, JSON.stringify(receipt) + '\n', {mode:0o600});
  const /* @chain-region startControl.reply | calls: res.writeHead, res.end, JSON.stringify */ reply = (res, code, body) => {res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== '127.0.0.1:' + server.address().port || req.headers.origin || req.headers['sec-fetch-site']) throw failure('local_client_required', 403);
      const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + token);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw failure('credential_required', 401);
      if (req.method === 'GET' && req.url === '/status') return reply(res, 200, {...status(), pending, receipts:receipts.size});
      const receiptId = /^\/receipts\/([A-Za-z0-9_.:-]{1,100})$/.exec(req.url);
      if (req.method === 'GET' && receiptId) return reply(res, receipts.has(receiptId[1]) ? 200 : 404, receipts.get(receiptId[1]) || {error:'receipt_not_found'});
      if (req.method !== 'POST' || req.url !== '/commands') throw failure('route_not_found', 404);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw failure('json_required', 415);
      if (Number(req.headers['content-length']) > 65536) throw failure('body_too_large', 413);
      let size = 0; const chunks = [];
      for await (const chunk of req) {size += chunk.length;if (size > 65536) throw failure('body_too_large', 413);chunks.push(chunk);}
      let command;try {command = JSON.parse(Buffer.concat(chunks));} catch {throw failure('invalid_json');}
      if (!command || Array.isArray(command) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(command.request_id || '') || typeof command.op !== 'string') throw failure('invalid_command');
      const digest = crypto.createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex');
      const previous = receipts.get(command.request_id);
      if (previous) {
        if (previous.digest !== digest) throw failure('request_id_conflict', 409);
        return reply(res, ['accepted','running'].includes(previous.state) ? 202 : 200, previous);
      }
      if (closing || pending >= 16 || receipts.size >= 4000) throw failure('control_busy', 429);
      const receipt = {request_id:command.request_id, digest, op:command.op, state:'accepted', at:new Date().toISOString()};
      persist(receipt);receipts.set(receipt.request_id, receipt);pending++;
      queue = queue.then(async () => {
        receipt.state = 'running';persist(receipt);
        try {receipt.result = JSON.parse(JSON.stringify(await dispatch(command) ?? null));receipt.state = 'completed';}
        catch (error) {receipt.state = error.outcomeUnknown ? 'unknown' : 'failed';receipt.error = {message:error.message,status:error.status || 0,...(error.diagnostic?{diagnostic:error.diagnostic}:{})};}
        receipt.finished_at = new Date().toISOString();persist(receipt);pending--;
      }).catch(() => {pending--;});
      return reply(res, 202, receipt);
    } catch (error) {reply(res, error.status || 500, {error:error.status ? error.message : 'control_error'});}
  });
  server.requestTimeout = 10000;server.headersTimeout = 10000;server.maxHeadersCount = 24;
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  const discovery = {protocol:'aieyra-aidebug/1',origin:'http://127.0.0.1:' + server.address().port,token,pid:process.pid};
  fs.writeFileSync(path.join(output,'control.json'), JSON.stringify(discovery), {mode:0o600});
  return {discovery, /* @chain-region startControl.close | calls: server.closeAllConnections, Promise, server.close */ async close() {closing = true;server.closeAllConnections();await new Promise(resolve => server.close(resolve));await queue;}};
}
module.exports = {startControl};
