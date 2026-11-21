// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/subconscious.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 屏幕上的潜意识（README.md 记忆系统 §5、§7）：显示哪条活动、标签怎么写、日记的日期说明。
const test=require('node:test'),assert=require('node:assert/strict');

test('running work wins, waiting first; finished work folds and leaves after 25s (failed 90s)', async()=>{
 const m=await import('../ui/subconscious.mjs');
 const now=1_000_000;
 const done={id:1,state:'done',actor:'subconscious',finished:now-5000};
 const run={id:2,state:'running',actor:'subconscious'},wait={id:3,state:'running',actor:'subconscious',waiting:true};
 assert.equal(m.pickActivity({activities:[done,wait,run]},now).id,3);
 assert.equal(m.pickActivity({activities:[done,run]},now).id,2);
 assert.equal(m.pickActivity({activities:[done]},now).id,1);
 assert.equal(m.pickActivity({activities:[{...done,finished:now-26000}]},now),null);
 assert.equal(m.pickActivity({activities:[{...done,state:'failed',finished:now-60000}]},now).id,1);
 assert.equal(m.pickActivity({activities:[{...done,state:'failed',finished:now-91000}]},now),null);
 assert.equal(m.pickActivity(undefined,now),null);
 assert.equal(m.activityTag(run),'潜意识已介入');
 assert.equal(m.activityTag(wait),'潜意识已介入 · Eyra 在等它');
 assert.equal(m.activityTag({state:'running',actor:'eyra'}),'Eyra 在整理记忆');
 assert.equal(m.activityTag({state:'failed',actor:'subconscious'}),'潜意识没做成');
});

test('diary meta says when it was written and which days it covers', async()=>{
 const m=await import('../ui/subconscious.mjs');
 const at=(d,h)=>new Date(2026,9,d,h,5).getTime();
 assert.equal(m.diaryMeta({created:at(10,23),first_at:at(9,8),last_at:at(10,22)}),'写于 10月10日 23:05 · 记的是 10月9日 – 10月10日 的事');
 assert.equal(m.diaryMeta({created:at(10,9),first_at:at(10,8),last_at:at(10,9)}),'写于 10月10日 09:05 · 记的是 10月10日 的事');
 assert.equal(m.diaryMeta({created:at(10,9)}),'写于 10月10日 09:05');
});
