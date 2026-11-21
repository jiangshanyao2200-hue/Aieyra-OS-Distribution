// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; op; load
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-tray.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const op=(extra={})=>({key:'eyra:1',id:'1',role:'matrix',generation:1,state:'running',tool:'exec_command',command:'rg secret-token src',...extra});
const load=()=>import('../ui/tool-tray.mjs');

test('a running tool opens the tray in plain words and never shows the raw command',async()=>{
 const {ToolTray}=await load(),view=new ToolTray().project([op()],{turn:'t1',state:'tool',now:1000});
 assert.equal(view.open,true);assert.equal(view.rows.length,1);assert.equal(view.rows[0].state,'running');assert.equal(view.rows[0].text,'在代码里找东西');
 assert.ok(!JSON.stringify(view).includes('secret-token'),'the command text is not a human sentence');
});

test('a finished call stays readable, then folds when thinking or body begins and never reopens',async()=>{
 const {ToolTray,TRAY}=await load(),tray=new ToolTray(),done=op({state:'completed'});
 tray.project([op()],{turn:'t1',state:'tool',now:1000});
 let view=tray.project([done],{turn:'t1',state:'tool',now:2000});
 assert.equal(view.open,true);assert.equal(view.rows[0].text,'找完了');assert.ok(view.wake>0,'a timer is needed to enforce the hold limit');
 view=tray.project([done],{turn:'t1',state:'thinking',now:2200});assert.equal(view.open,true,'a short hold keeps the receipt readable');
 view=tray.project([done],{turn:'t1',state:'thinking',now:2000+TRAY.yieldMs});assert.equal(view.open,false);
 view=tray.project([done],{turn:'t1',state:'tool',now:2000+TRAY.yieldMs+10});assert.equal(view.open,false,'a folded call does not reopen');
 view=tray.project([done,op({key:'eyra:2',id:'2'})],{turn:'t1',state:'tool',now:5000});
 assert.equal(view.open,true);assert.equal(view.rows.length,1,'only the new call is shown');
});

test('a finished call folds by itself after the hold limit even if nothing else happens',async()=>{
 const {ToolTray,TRAY}=await load(),tray=new ToolTray(),done=op({state:'completed'});
 tray.project([done],{turn:'t2',state:'tool',now:0});
 assert.equal(tray.project([done],{turn:'t2',state:'tool',now:TRAY.maxHoldMs-1}).open,true);
 assert.equal(tray.project([done],{turn:'t2',state:'tool',now:TRAY.maxHoldMs}).open,false);
});

test('a failure never folds by itself, hides its raw command and can be dismissed',async()=>{
 const {ToolTray}=await load(),tray=new ToolTray(),bad=op({key:'eyra:9',id:'9',state:'failed',command:'rm -rf secret-dir'});
 let view=tray.project([bad],{turn:'t3',state:'body',now:0});assert.equal(view.open,true);
 view=tray.project([bad],{turn:'t3',state:'body',now:60000});assert.equal(view.open,true,'failures are not swallowed by the fold');
 assert.ok(view.rows[0].text.startsWith('没做成'));assert.ok(!JSON.stringify(view).includes('secret-dir'));assert.deepEqual(view.failedIds,['eyra:9']);
 tray.dismiss(view.failedIds);
 assert.equal(tray.project([bad],{turn:'t3',state:'body',now:60001}).open,false);
});

test('waiting for the user keeps the tray open with an answer entry',async()=>{
 const {ToolTray}=await load(),tray=new ToolTray();
 let view=tray.project([],{turn:'t4',state:'waiting_user',now:0});
 assert.equal(view.open,true);assert.equal(view.waiting,true);assert.equal(view.rows[0].id,'waiting-user');
 view=tray.project([],{turn:'t4',state:'waiting_user',now:99999});assert.equal(view.open,true);
 assert.equal(tray.project([],{turn:'t4',state:'tool',now:100000}).open,false,'the entry leaves when the question is answered');
});

test('tools that have their own presentation, hidden calls and an unset list never open the tray',async()=>{
 const {ToolTray}=await load(),tray=new ToolTray();
 const view=tray.project([op({tool:'update_plan'}),op({tool:'ask_user',key:'a'}),op({hidden:true,key:'h'})],{turn:'t5',state:'tool',now:0});
 assert.equal(view.open,false);
 assert.equal(tray.project(undefined,{turn:'t5',state:'tool',now:1}).open,false);
});

test('a new turn starts clean: the same call key may show again',async()=>{
 const {ToolTray,TRAY}=await load(),tray=new ToolTray(),done=op({state:'completed'});
 tray.project([done],{turn:'a',state:'tool',now:0});tray.project([done],{turn:'a',state:'tool',now:TRAY.maxHoldMs});
 assert.equal(tray.project([done],{turn:'a',state:'tool',now:TRAY.maxHoldMs+1}).open,false);
 assert.equal(tray.project([done],{turn:'b',state:'tool',now:TRAY.maxHoldMs+2}).open,true);
});
