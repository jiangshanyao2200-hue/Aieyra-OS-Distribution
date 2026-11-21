// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; deferred
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/memory-records.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 const nodes=new Map();let count=0;
 const make=()=>({value:'',textContent:'',hidden:false,disabled:false,scrollTop:0,children:[],events:{},setAttribute(){},addEventListener(k,f){this.events[k]=f;},focus(){this.focused=true;},replaceChildren(...items){this.children=items;},get firstElementChild(){return this.children[0];}});
 const area={...make(),querySelector(s){if(!nodes.has(s))nodes.set(s,make());return nodes.get(s);},querySelectorAll(){return [...nodes.values()];}};
 const doc={getElementById:()=>({append(){}}),createElement:()=>++count===1?area:make()};
 return {doc,$:s=>area.querySelector(s)};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('failed search retains the original row action and successful query cursor',async()=>{
 const {setupMemoryRecords}=await import('../ui/memory-records.mjs'),f=fixture(),calls=[];
 setupMemoryRecords({context:async p=>{calls.push(p);if(p.memory_action==='history')return {records:[{key:'session',position:2,excerpt:'用户具体原话'}],next_cursor:'history-page2'};if(p.memory_action==='packets')throw Error('read failed');return {content:'original',format:'legacy_text'};}},{doc:f.doc});
 f.$('select').value='history';await f.$('.memory-search').onclick();assert.match(f.$('.memory-record-list').children[0].textContent,/用户具体原话/);
 f.$('select').value='packets';await f.$('.memory-search').onclick();await f.$('.memory-record-list').children[0].onclick();assert.equal(calls.at(-1).memory_action,'original');assert.equal(calls.at(-1).position,2);
 await f.$('.memory-more').onclick();assert.equal(calls.at(-1).memory_action,'history');assert.equal(calls.at(-1).cursor,'history-page2');
});
test('failed original continuation can retry exactly without duplicating content',async()=>{
 const {setupMemoryRecords}=await import('../ui/memory-records.mjs'),f=fixture();let attempts=0;
 setupMemoryRecords({context:async p=>{if(p.memory_action==='history')return {records:[{key:'s',position:0,excerpt:'head'}]};if(!p.cursor)return {content:'first 🪶\n',next_cursor:'0:8',format:'legacy_text'};assert.equal(p.cursor,'0:8');if(++attempts===1)throw Error('temporary');return {content:'last',format:'legacy_text'};}},{doc:f.doc});
 f.$('select').value='history';await f.$('.memory-search').onclick();await f.$('.memory-record-list').children[0].onclick();await f.$('.memory-detail-next').onclick();assert.match(f.$('pre').textContent,/first 🪶/);assert.equal(f.$('.memory-detail-next').hidden,false);
 await f.$('.memory-detail-next').onclick();assert.equal(f.$('pre').textContent.split('first 🪶').length,2);assert.match(f.$('pre').textContent,/first 🪶\nlast/);assert.equal(f.$('.memory-detail-next').hidden,true);
});
test('save keeps edits typed in flight and advances revision for the next save',async()=>{
 const {setupMemoryRecords}=await import('../ui/memory-records.mjs'),f=fixture(),pending=deferred(),calls=[];let updates=0;
 setupMemoryRecords({context:async p=>{calls.push(p);if(p.memory_action==='search')return {records:[{id:'one',title:'record'}]};if(p.memory_action==='read')return {record:{id:'one',revision:1,content:'old\r\nline'}};if(++updates===1)return pending.promise;return {record:{id:'one',revision:3,content:p.content}};}},{doc:f.doc});
 f.$('select').value='search';await f.$('.memory-search').onclick();await f.$('.memory-record-list').children[0].onclick();assert.equal(f.$('.memory-record-save').disabled,true);assert.equal(f.$('textarea').value,'old\nline');
 f.$('textarea').value='submitted';const saving=f.$('.memory-record-save').onclick();assert.equal(f.$('textarea').readOnly,false);f.$('textarea').value='new typing';pending.resolve({record:{id:'one',revision:2,content:'submitted'}});await saving;
 assert.equal(f.$('textarea').value,'new typing');assert.equal(f.$('.memory-record-save').disabled,false);await f.$('.memory-record-save').onclick();assert.equal(calls.at(-1).expected_revision,2);assert.equal(calls.at(-1).content,'new typing');
});
test('composition Enter does not search or consume the candidate confirmation',async()=>{
 const {setupMemoryRecords}=await import('../ui/memory-records.mjs'),f=fixture();let calls=0,prevented=false;
 setupMemoryRecords({context:async()=>{calls++;return {records:[]};}},{doc:f.doc});f.$('input').onkeydown({key:'Enter',isComposing:true,preventDefault(){prevented=true;}});await Promise.resolve();assert.equal(calls,0);assert.equal(prevented,false);
});
test('loading a replacement keeps the old editor read-only until failure settles',async()=>{
 const {setupMemoryRecords}=await import('../ui/memory-records.mjs'),f=fixture(),pending=deferred();let searches=0;
 setupMemoryRecords({context:async p=>{if(p.memory_action==='search')return ++searches===1?{records:[{id:'one'}]}:pending.promise;return {record:{id:'one',revision:1,content:'old'}};}},{doc:f.doc});
 f.$('select').value='search';await f.$('.memory-search').onclick();await f.$('.memory-record-list').children[0].onclick();const loading=f.$('.memory-search').onclick();assert.equal(f.$('textarea').readOnly,true);await Promise.resolve();pending.reject(Error('temporary'));await loading;assert.equal(f.$('textarea').readOnly,false);assert.equal(f.$('textarea').value,'old');
});
