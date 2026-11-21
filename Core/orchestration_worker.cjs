// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Core/orchestration_worker.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Go 持有进程、取消与日志；此桥仅运行 JavaScript 并交换有界 JSON 消息。
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
if (isMainThread) {
  const lines = require('node:readline').createInterface({ input: process.stdin });
  let worker;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  lines.on('line', line => {
    try {
      const value = JSON.parse(line);
      if (!worker) {
        worker = new Worker(__filename, { workerData: value, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
        worker.on('message', send);
        worker.on('error', err => send({ type: 'done', error: String(err.message) }));
        worker.on('exit', code => { if (code) send({ type: 'done', error: 'JavaScript worker exited: ' + code }); lines.close(); });
      } else worker.postMessage(value);
    } catch (err) { send({ type: 'done', error: String(err.message) }); lines.close(); }
  });
  lines.on('close', () => { if (worker) worker.terminate(); });
} else {
  const vm = require('node:vm');
  const bridge = Object.setPrototypeOf(function (line) {
    if (typeof line !== 'string' || line.length > 600000) return false;
    try { parentPort.postMessage(JSON.parse(line)); return true; } catch { return false; }
  }, null);
  const scope = vm.createContext({ __bridge: bridge }, { codeGeneration: { strings: false, wasm: false } });
  // 不把宿主 Promise、对象或 Error 注入上下文；响应通过 JSON 原文重建。
  vm.runInContext(`
    'use strict';
    const pending = new Map();
    let sequence = 0, finished = false;
    const send = value => { if (!__bridge(JSON.stringify(value))) throw new Error('Tool/output message too large or invalid'); };
    const tools = Object.freeze(Object.fromEntries(${JSON.stringify(workerData.names)}.map(name => [name, args => {
      if (finished) return Promise.reject(new Error('Execution cell has finished'));
      const id = ++sequence;
      if (id > 128) return Promise.reject(new Error('Maximum 128 nested tool calls per cell'));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { send({ type:'call', id, name, args }); } catch (e) { pending.delete(id); reject(e); }
      });
    }])));
    const text = value => send({ type:'text', text: typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined') });
    const image = value => {
      if (!value || typeof value.image_id !== 'string') throw new Error('image() requires the result of tools.view_image');
      send({ type:'image', image_id:value.image_id });
    };
    const saved = new Map(Object.entries(${JSON.stringify(workerData.store || {})}));
    const store = (key, value) => {
      if (typeof key !== 'string' || key.length > 256) throw new Error('store key must be a string of at most 256 characters');
      const copy = JSON.parse(JSON.stringify(value));
      saved.set(key, copy); send({ type:'store', key, value:copy });
    };
    const load = key => saved.get(key);
    const exit = () => { throw new Error('__AIEYRA_EXIT__'); };
    globalThis.__accept = raw => {
      const item = JSON.parse(raw), p = pending.get(item.id);
      if (!p) return;
      pending.delete(item.id);
      if (item.error) p.reject(new Error(item.error)); else p.resolve(item.value);
    };
    globalThis.__run = async () => {
      let error = '';
      try { await (async () => {\n${workerData.code}\n})(); }
      catch (e) { error = String(e && e.message || e); if (error === '__AIEYRA_EXIT__') error = ''; }
      finished = true;
      send({ type:'done', error });
    };
  `, scope, { timeout: 2000 });
  parentPort.on('message', item => {
    try { vm.runInContext(`__accept(${JSON.stringify(JSON.stringify(item))})`, scope, { timeout: 2000 }); }
    catch (err) { parentPort.postMessage({ type:'done', error:String(err.message) }); }
  });
  try { vm.runInContext('__run()', scope, { timeout: 2000 }); }
  catch (err) { parentPort.postMessage({ type:'done', error:String(err.message) }); }
}
