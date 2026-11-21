// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: previewEnvironment; settled
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/session-preview.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('session previews read the addressed snapshot without opening or sending, including empty and pending cleanup',async()=>{
 const {readSessionPreview}=await import('../ui/session-preview.mjs'),calls=[];
 const api={snapshot:async p=>(calls.push(p),{messages:[{id:'u',from:'user',text:'主会话'}]}),conversation:async p=>(calls.push(p),{messages:[{from:'user',text:'独立正文'},{from:'eyra',text:'独立回答'}]})};
 assert.match(await readSessionPreview(api,{kind:'home',title:'Eyra'}),/主会话/);
 assert.match(await readSessionPreview(api,{kind:'session',id:'abc',title:'橘'}),/橘：独立回答/);
 assert.deepEqual(calls,[{cursor:0},{action:'snapshot',id:'abc'}]);
 assert.match(await readSessionPreview(api,{kind:'session',id:'abc',title:'橘',pending:'待清理 · 已完成 1/6'}),/1\/6/);assert.equal(calls.length,2);
});
test('home preview filters team process and limits long text; live conversation shows real progress',async()=>{
 const {sessionPreviewText}=await import('../ui/session-preview.mjs');
 const text=sessionPreviewText({kind:'home',title:'Eyra'},{messages:[{id:'u',from:'user',text:'你好'},{id:'a',from:'matrix',to:'user',text:'好'},{id:'internal',from:'matrix',to:'vaya',text:'内部协作'},{id:'comment',from:'matrix',to:'user',state:'commentary',text:'内部进度'}]});
 assert.match(text,/你：你好/);assert.doesNotMatch(text,/内部/);
 assert.match(sessionPreviewText({kind:'home',title:'Eyra'},{roles:[{id:'matrix',role:'matrix',state:'running'}],live:{matrix:{text:'主会话实时正文'}}}),/主会话实时正文/);
 const live=sessionPreviewText({kind:'session',title:'橘'},{agent:{state:'running'},messages:[{from:'user',text:'长'.repeat(10000)}],live:{text:'正在完成'}});assert.match(live,/正在完成/);assert.ok(live.length<4000);
 assert.match(sessionPreviewText({kind:'session',title:'橘'}),/还没有消息/);
});
test('late success or error cannot replace another session or reopen a dismissed preview',async()=>{
 const {previewController}=await import('../ui/session-preview.mjs');let finish,fail;const seen=[];
 const preview=previewController({read:t=>t.id==='slow'?new Promise((r,j)=>{finish=r;fail=j;}):Promise.resolve(t.id),show:t=>seen.push(t),hide:()=>seen.push('hide')});
 const first=preview.open({id:'slow'});await preview.open({id:'new'});finish('old');await first;assert.deepEqual(seen,['new']);
 const second=preview.open({id:'slow'});preview.close();fail(Error('late'));await second;assert.deepEqual(seen,['new','hide']);
 await preview.open({id:'removed'},()=>false);assert.deepEqual(seen,['new','hide']);
});
function previewEnvironment(){
 const bus=()=>({listeners:new Map(),addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(f);},removeEventListener(k,f){this.listeners.get(k)?.delete(f);},emit(k,e={}){for(const f of this.listeners.get(k)||[])f(e);}});
 const win=bus(),doc={...bus(),hidden:false,defaultView:win,activeElement:null},list=bus(),calls=[];
 function row(key){const value={dataset:{key},isConnected:true,getBoundingClientRect:()=>({left:20,top:40,width:180,height:45})};value.contains=n=>n===value||n===value.text;value.closest=s=>s==='.sd-row'?value:null;value.text={closest:s=>s==='.sd-row'?value:null};return value;}
 const first=row('group:one');let current=first,hit=first.text;list.contains=n=>current.contains(n);doc.elementFromPoint=()=>hit;
 const api={conversation:async()=>({messages:[{from:'member',name:'成员',text:'真实完成回执'}]}),tip:async p=>{calls.push(p);return {ok:true};}};
 return {doc,win,list,calls,first,api,resolve:r=>({kind:'group',id:r.dataset.key,title:r.dataset.key}),enter:()=>list.emit('pointerover',{target:current.text,clientX:80,clientY:60}),replace(){first.isConnected=false;current=row('group:one');hit=current.text;return current;},miss(){hit=null;}};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('pending hovered preview survives sidebar layout settling and uses the new anchor',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {setupSessionPreviews}=await import('../ui/session-preview.mjs'),e=previewEnvironment();
 const preview=setupSessionPreviews(e.api,e.list,e.resolve,{doc:e.doc});t.after(()=>preview.close());e.enter();t.mock.timers.tick(300);
 e.first.getBoundingClientRect=()=>({left:40,top:55,width:180,height:45});e.win.emit('resize');t.mock.timers.tick(500);await settled();
 const shown=e.calls.filter(p=>p.action==='show');assert.equal(shown.length,1);assert.equal(shown[0].x,40);assert.match(shown[0].text,/真实完成回执/);
});
test('replacing the same hovered row refreshes its preview without accepting detached pointer events',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {setupSessionPreviews}=await import('../ui/session-preview.mjs'),e=previewEnvironment();
 const preview=setupSessionPreviews(e.api,e.list,e.resolve,{doc:e.doc});t.after(()=>preview.close());e.enter();t.mock.timers.tick(500);await settled();
 e.replace();preview.reposition();e.list.emit('pointerout',{target:e.first.text,relatedTarget:null});t.mock.timers.tick(500);await settled();
 assert.equal(e.calls.filter(p=>p.action==='show').length,2);
 preview.hide();e.win.emit('resize');t.mock.timers.tick(2000);await settled();assert.equal(e.calls.at(-1).action,'hide');
});
test('resize cannot revive a preview after the pointer left its row or after close',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {setupSessionPreviews}=await import('../ui/session-preview.mjs'),e=previewEnvironment();
 const preview=setupSessionPreviews(e.api,e.list,e.resolve,{doc:e.doc});e.enter();e.miss();e.win.emit('resize');t.mock.timers.tick(500);await settled();assert.equal(e.calls.length,0);
 preview.close();e.enter();e.win.emit('resize');t.mock.timers.tick(500);await settled();assert.equal(e.calls.length,0);
});
