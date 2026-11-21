// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: message
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/message-time.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const message=(start,end,extra={})=>({from:'matrix',state:'completed',run_time:{intervals:[{started_at:Date.parse(start),finished_at:Date.parse(end)}],...extra}});
test('Run for needs real execution intervals and a final assistant message',async()=>{
 const {runForText}=await import('../ui/message-time.mjs');
 for(const m of [{},{from:'matrix',state:'completed',at:'2026-10-02T00:00:00Z'}, {...message('2026-10-01','2026-10-02'),state:'commentary'},{...message('2026-10-01','2026-10-02'),from:'user'}])assert.equal(runForText(m),'');
 assert.equal(runForText(message('2026-10-02T00:00:00Z','2026-10-02T00:00:00.050Z')),'Run for < 1 sec');
 assert.equal(runForText(message('2026-10-02T00:00:00Z','2026-10-02T01:02:03Z')),'Run for 1 hour 2 mins');
 assert.equal(runForText(message('2026-10-02T00:00:00Z','2026-10-02T00:00:05Z')),'Run for 5 secs');
});
test('Run for uses UTC calendar months and no more than two nonzero units',async()=>{
 const {runForText}=await import('../ui/message-time.mjs');
 assert.equal(runForText(message('2024-02-29','2025-02-28')),'Run for 1 year');
 assert.equal(runForText(message('2026-01-31','2026-02-28')),'Run for 1 month');
 assert.equal(runForText(message('2026-01-31','2026-02-27')),'Run for 3 weeks 6 days');
 assert.equal(runForText(message('2024-01-01','2026-04-12')),'Run for 2 years 3 months');
 assert.equal(runForText(message('2026-10-01','2026-10-09')),'Run for 1 week 1 day');
});
test('Run for never fills an offline gap or accepts invalid interval metadata',async()=>{
 const {runForText}=await import('../ui/message-time.mjs');
 const m=message('2026-10-01T00:00:00Z','2026-10-01T00:02:00Z',{incomplete:true});
 m.run_time.intervals.push({started_at:Date.parse('2026-10-02T00:00:00Z'),finished_at:Date.parse('2026-10-02T00:03:00Z')});
 assert.equal(runForText(m),'Run for 5 mins · 已知时段');
 m.run_time.intervals[1].started_at=1;assert.equal(runForText(m),'');
 assert.equal(runForText(message('invalid','2026-10-02')),'');
 assert.equal(runForText(message('2026-10-02','2026-10-01')),'');
});
