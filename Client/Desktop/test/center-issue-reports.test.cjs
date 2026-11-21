// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; fs; setup
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/center-issue-reports.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createIssueReports} = require('../../../Program/official/center/issue-reports.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'center-reports-'));
  let account = '1', listener, approved = false, at = Date.now(), failure;
  const calls = [], shown = [];
  const client = {
    status: () => ({signedIn: !!account, user: {id: account}}),
    subscribe(fn) { listener = fn; return () => { listener = null; }; },
    async reportIssue(owner, payload) {
      calls.push({owner,payload});
      if (failure) throw failure;
      return {requestId: payload.requestId, topic: randomUUID()};
    }
  };
  const q = createIssueReports({directory:root, root, version:'0.2.85', client, now:()=>at,
    confirm: async value => {shown.push(value);return approved;}});
  t.after(async () => {await q.close();fs.rmSync(root,{recursive:true,force:true});});
  return {q,calls,shown,approve(){approved=true;},sign(id){account=id;listener();},
    fail(error){failure=error;},advance(ms){at+=ms;}};
}

test('existing installation opts in, account-independent consent stops queued automatic data', async t => {
  const f=setup(t);
  assert.equal(f.q.preference(),false);
  f.q.system('child_crash'); await f.q.flush(); assert.equal(f.calls.length,0);
  f.q.preference(true); f.q.system('child_crash');f.q.system('child_crash');
  await f.q.flush();assert.equal(f.calls.length,1);
  assert.deepEqual(Object.keys(f.calls[0].payload).sort(),['category','requestId','source','version']);
  f.q.system('unexpected_exit');f.q.preference(false);await f.q.flush();assert.equal(f.calls.length,1);
  f.sign('');f.q.preference(true);f.q.system('renderer_crash');await f.q.flush();assert.equal(f.calls.length,1);
});

test('Eyra previews exact public text, rejects sensitive details and scopes replays to the same account', async t => {
  const f=setup(t), p={request_id:randomUUID(),category:'program_error',content:'打开工具后窗口空白。'};
  await assert.rejects(f.q.report({...p,confirmed:true},true),/确认/);
  assert.deepEqual(f.shown,[p.content]);
  await assert.rejects(f.q.report({...p,content:'联系 me@example.org'},true),/私人/);
  f.approve();
  const first=await f.q.report(p,true);
  assert.equal(first.state,'sent');
  assert.deepEqual(await f.q.report(p,true),first);
  assert.equal(f.calls.length,1);
  await assert.rejects(f.q.report({...p,content:'另一篇正文'},true),/编号/);
  f.sign('2');assert.throws(()=>f.q.receipt(p.request_id),/本账号/);
  const second=await f.q.report(p,true);
  assert.notEqual(second.topic,first.topic);
  assert.notEqual(f.calls[0].owner,f.calls[1].owner);
});

test('Retry-After survives new samples, confirmed reports stay queued across opt-out', async t => {
  const f=setup(t);f.q.preference(true);f.approve();
  const p={request_id:randomUUID(),content:'窗口未刷新。'};
  f.fail(Object.assign(Error('throttle'),{status:429,retryAfterMs:60000}));
  assert.equal((await f.q.report(p,true)).state,'pending');
  f.q.system('update_error');await f.q.flush();assert.equal(f.calls.length,1);
  f.q.preference(false);f.advance(59999);await f.q.flush();assert.equal(f.calls.length,1);
  f.fail(null);f.advance(2);await f.q.flush();
  assert.equal(f.q.receipt(p.request_id).state,'sent');
  assert.deepEqual(f.calls[0],f.calls[1]);
});
