// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; status
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-status.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const status = () => import('../ui/status.mjs');

test('public reasoning expires only in UI projection without changing core receipts', async () => {
  const { projectLive } = await status();
  const at = 1800000000000;
  const live = Object.freeze({ phase: 'body', thought: '**核对回执**', thought_at: at, text: '正文', revision: 7 });
  assert.equal(projectLive(live, at + 3999), live);
  for (const now of [at + 4000, at + 9000]) {
    assert.deepEqual(projectLive(live, now), { ...live, thought: '' });
    assert.equal(live.thought, '**核对回执**');
    assert.equal(live.revision, 7);
  }
  const thinking = Object.freeze({ ...live, phase: 'thinking' });
  assert.equal(projectLive(thinking, at + 9000), thinking);
  assert.equal(projectLive(live, at - 1), live);
  const untimed = Object.freeze({ ...live, thought_at: 0 });
  assert.equal(projectLive(untimed, at + 9000), untimed);
});

test('compact usage uses fixed millions and context precision including missing values',async()=>{
 const {formatTokens,formatContext}=await status();
 for(const value of [undefined,null,NaN,Infinity,-1,0])assert.equal(formatTokens(value),'0.00M');
 assert.equal(formatTokens(1234567),'1.23M');assert.equal(formatTokens(999999),'1.00M');assert.equal(formatTokens(5000),'0.01M');
 assert.equal(formatContext(), '—');assert.equal(formatContext({tokens:99,window:0}),'—');
 assert.equal(formatContext({tokens:NaN,window:100}),'—');assert.equal(formatContext({tokens:12345,window:100000}),'12.35%');
 assert.equal(formatContext({tokens:110,window:100}),'110.00%');
 assert.equal(formatContext({tokens:30000,window:6000,model_window:200000}),'15.00%');
 assert.equal(formatContext({tokens:34000,window:200000,model_window:1000000,target:200000}),'17.00%');
 assert.equal(formatContext({tokens:34000,window:6000,model_window:64000,target:200000}),'17.00%');
});

test('usage keeps missing cache and partial reports unknown; compression uses committed estimates', async () => {
  const { usageSummary } = await status();
  assert.equal(usageSummary([]).cacheRate, null);
  assert.equal(usageSummary([]).complete, false);
  const roles = [{ usage: { samples: 2, reported: 2, complete: true, input_tokens: 100, output_tokens: 20, cached_tokens: 60, cached_known: true }, compression: { before_tokens: 1000, after_tokens: 400 } }];
  assert.deepEqual(usageSummary(roles), { input: 100, output: 20, complete: true, reported: 2, samples: 2, estimated:0,unknown:0,cached:60,cacheReported:2,cacheComplete:true,cacheRate: 60, compression: 60, reasoning:null, reasoningComplete:false });
  roles.push({ usage: { samples: 1, reported: 0, complete: false, cached_known: false } });
  assert.equal(usageSummary(roles).cacheRate, 60);
  assert.equal(usageSummary(roles).cacheComplete, false);
  assert.equal(usageSummary(roles).complete, false);
  assert.equal(usageSummary([{ compression: { before_tokens: 0, after_tokens: 400 } }]).compression, null);
});

test('partial cache divides only by paired known request inputs',async()=>{
 const {usageSummary}=await status();
 const r=usageSummary([{usage:{samples:3,reported:2,complete:false,input_tokens:900,output_tokens:20,cached_tokens:60,cached_known:false,cache_input_tokens:100,cache_reported:1}}]);
 assert.equal(r.cacheRate,60);assert.equal(r.cacheComplete,false);assert.equal(r.cached,60);assert.equal(r.cacheReported,1);
 assert.equal(usageSummary([{usage:{samples:2,reported:1,input_tokens:100,cached_known:false}}]).cacheRate,null);
});

test('title reflects waiting, cancellation, errors and real reasoning without invented progress', async () => {
  const { workspaceStatus, ThoughtSampler } = await status();
  const base = { ready: true, roles: [{ state: 'running' }], live: { matrix: { phase: 'thinking' } } };
  assert.equal(workspaceStatus(base).title, '收到，我们现在开始工作。');
  for (const state of ['waiting_user', 'cancelling']) {
    assert.equal(workspaceStatus({ ...base, roles: [{ state }] }).phase, state);
  }
  assert.equal(workspaceStatus({ ...base, roles: [{ state: 'failed' }] }).phase, 'error');
  assert.equal(workspaceStatus(base, true).title, '连接暂时中断');
  assert.equal(workspaceStatus({ ...base, roles: [{ state: 'completed' }] }).title, 'Aieyra');
  const sampler = new ThoughtSampler();
  const first = sampler.sample({ phase: 'thinking', thought: '先核对这次任务的实际要求。' }, 0);
  assert.notEqual(sampler.sample({ phase: 'thinking', thought: '现在检查文件中的真实实现。' }, 100), first);
  assert.equal(sampler.sample({ phase: 'thinking', thought: '现在检查文件中的真实实现。' }, 2300), '现在检查文件中的真实实现。');
  assert.equal(sampler.sample({ phase: 'tool', thought: '旧文字' }, 2400), '');
  assert.equal(sampler.sample({ phase: 'thinking', thought: '' }, 2500), '');
});

test('a new turn cannot duplicate old receipts; settled scenes never replay', async () => {
  const { WorkspacePresentation } = await import('../ui/model.mjs');
  const view = new WorkspacePresentation();
  const item = { id: 'actual-call', tool: 'exec_command', state: 'completed', revision: 1 };
  const ingest = (generation, items, now) => view.ingest({ roles: [{ id: 'executor', role: 'execution', generation, state: 'completed', activity: { items } }] }, now);
  ingest(1, [item], 0);
  ingest(2, [item], 50);
  assert.equal(view.history().length, 1);
  view.tick(10000);
  assert.equal(view.scene, null);
});


test('current operation replaces previous work immediately and history never pins the main screen', async () => {
  const { WorkspacePresentation } = await import('../ui/model.mjs');
  const view = new WorkspacePresentation();
  const ingest = (rows, state = 'running', generation = 1) => view.ingest({ roles: [{ role: 'execution', id: 'executor', generation, state, activity: { items: rows } }] });
  const call = (id, tool, state = 'completed') => ({ id, tool, state, revision: 1 });
  ingest([call('shell1', 'exec_command'), call('shell2', 'exec_command', 'running')]);
  assert.deepEqual(view.current().map((row) => row.id), ['shell1', 'shell2']);
  ingest([call('shell2', 'exec_command'), call('edit', 'apply_patch', 'running')]);
  assert.equal(view.scene.kind, 'multi');
  assert.deepEqual(view.current().map((row) => row.id), ['shell1', 'shell2', 'edit']);
  ingest([call('edit', 'apply_patch'), call('shell3', 'exec_command', 'running')]);
  assert.deepEqual(view.current().map((row) => row.id), ['shell2', 'edit', 'shell3']);
  ingest([call('shell3', 'exec_command')]);
  assert.equal(view.current().length, 3, 'latest results disappeared before narration finished');
  ingest([], 'completed');
  assert.equal(view.scene, null);
  assert.equal(view.history().length, 4);
  ingest([], 'running', 2);
  assert.equal(view.scene, null, 'new generation replayed previous tools');
});

test('restoring idle activity never displays previous work; live role beats a stale archive from another role', async () => {
  const { WorkspacePresentation } = await import('../ui/model.mjs');
  const view = new WorkspacePresentation();
  view.ingest({ roles: [
    { role: 'matrix', state: 'running', activity: { items: [{ id: 'wait', tool: 'team', state: 'running' }] } },
    { role: 'project', state: 'completed', activity: { items: [{ id: 'old', tool: 'project', state: 'completed' }] } },
    { role: 'execution', state: 'running', activity: { items: [{ id: 'shell', tool: 'exec_command', state: 'running' }] } },
  ] });
  assert.equal(view.current().at(-1).id, 'shell');
  const idle = new WorkspacePresentation();
  idle.ingest({ roles: [{ role: 'execution', state: 'completed', activity: { items: view.history() } }] });
  assert.equal(idle.scene, null);
});


test('image usage contributes to totals but unknown image receipts do not dilute chat cache',async()=>{
 const {usageSummary}=await status();
 const u=usageSummary([{usage:{samples:3,reported:2,complete:false,unknown:1,input_tokens:139,output_tokens:535,cached_tokens:60,cached_known:true,cache_input_tokens:100,cache_reported:1,image_samples:2,image_reported:1,image_unknown:1,image_input_tokens:39,image_output_tokens:515}}]);
 assert.equal(u.cacheRate,60);assert.equal(u.cacheComplete,true);assert.equal(u.complete,false);assert.equal(u.input,139);assert.equal(u.output,535);
 assert.deepEqual(u.image,{samples:2,reported:1,unknown:1,input:39,output:515});
});

test('rotating usage preserves unknown and partial accounting and the current context target',async()=>{
 const {usageReadouts,usageSummary}=await status();
 const empty=usageReadouts(usageSummary([]));assert.equal(empty.total,'0.00M');assert.equal(empty.items[2].value,'—');
 const unknown=usageReadouts(usageSummary([{usage:{samples:1,unknown:1}}]));assert.equal(unknown.total,'—');assert.match(unknown.items[0].tip,/未报告/);
 const partial=usageReadouts(usageSummary([{usage:{samples:2,reported:1,input_tokens:20000,output_tokens:5000,cache_reported:1,cache_input_tokens:20000,cached_tokens:10000}}]),{tokens:50000,target:200000,model_window:1000000});
 assert.equal(partial.total,'0.03M');assert.equal(partial.tip,'累计　0.025M');assert.equal(partial.items[2].value,'50%');assert.equal(partial.items[2].tip,'缓存命中　50%');assert.equal(partial.items[3].value,'25.00%');assert.equal(partial.items[3].tip,'上下文　25.00%');
});
