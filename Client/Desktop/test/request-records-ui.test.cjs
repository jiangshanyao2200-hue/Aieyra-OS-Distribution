// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; flush; deferred; documentFixture; result; harness
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/request-records-ui.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function documentFixture(){
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.hidden=false;this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(n=>n.textContent).join('');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  querySelectorAll(tag){return this.children.filter(n=>n.tagName===tag);}
 }
 const nodes=new Map(),doc={createElement:tag=>new Element(tag),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}};
 for(const source of ['local','official']){const b=new Element('button');b.dataset.source=source;doc.getElementById('request-sources').append(b);}
 for(const days of [3,7,0]){const b=new Element('button');b.dataset.days=String(days);doc.getElementById('request-range').append(b);}
 return {doc,node:id=>doc.getElementById(id),range:days=>doc.getElementById('request-range').children.find(b=>b.dataset.days===String(days)),source:key=>doc.getElementById('request-sources').children.find(b=>b.dataset.source===key)};
}
function result(model,total=151){return {ok:true,total,summary:{requests:total,input:1000,output:10,cacheRate:95},filtered:{requests:1},models:[{name:model,requests:total,cacheRate:95}],roles:[],rows:[{at:'2026-11-09T00:00:00Z',model,role:'matrix',input:1000,output:10,cached:950}]};}
async function harness(account){const {setupRequestRecords}=await import('../ui/request-records.mjs'),f=documentFixture(),controller=setupRequestRecords({account},{doc:f.doc,check:r=>{if(r?.ok===false)throw Error(r.error);return r;}});return {...f,controller};}

test('failed time-range selection clears old summary, tags, rows and totals, then retries the actual selected range',async()=>{
 let fail=false;const calls=[],f=await harness(async p=>{calls.push(p);return fail?{ok:false,error:'range unavailable'}:result(p.start?'recent':'old');});
 await f.controller.open();f.range(0).onclick();await flush();assert.match(f.node('request-rows').textContent,/old/);assert.equal(f.node('request-next').disabled,false);
 fail=true;f.range(3).onclick();await flush();assert.equal(f.range(3).getAttribute('aria-selected'),'true');assert.equal(f.node('request-summary').children.length,0);assert.equal(f.node('request-breakdown').children.length,0);assert.equal(f.node('request-rows').children.length,0);assert.equal(f.node('request-next').disabled,true);assert.equal(f.node('request-prev').disabled,true);assert.match(f.node('request-status').textContent,/range unavailable/);assert.equal(f.node('request-empty').hidden,true);
 fail=false;f.node('request-reload').onclick();await flush();assert.match(f.node('request-summary').textContent,/近 3 天请求/);assert.match(f.node('request-rows').textContent,/recent/);assert.equal(calls.at(-1).end-calls.at(-1).start,3*86400);assert.equal(calls.at(-1).page,1);
});

test('late success or failure cannot refill a newer failed range or unlock its pagination',async()=>{
 let request=async()=>result('initial');const f=await harness(p=>request(p));await f.controller.open();const old=deferred(),current=deferred();
 request=p=>p.start===0?old.promise:current.promise;f.range(0).onclick();f.range(7).onclick();assert.equal(f.node('request-next').disabled,true);
 old.resolve(result('stale'));await flush();assert.equal(f.node('request-rows').children.length,0);assert.equal(f.node('request-next').disabled,true);assert.match(f.node('request-status').textContent,/正在读取/);
 current.reject(Error('seven-day failure'));await flush();assert.equal(f.range(7).getAttribute('aria-selected'),'true');assert.equal(f.node('request-rows').children.length,0);assert.match(f.node('request-status').textContent,/seven-day failure/);
 const older=deferred();request=()=>older.promise;f.range(0).onclick();request=async()=>result('newest',1);f.range(3).onclick();await flush();older.reject(Error('stale rejection'));await flush();assert.match(f.node('request-rows').textContent,/newest/);assert.doesNotMatch(f.node('request-status').textContent,/stale rejection/);
});

test('switching source invalidates pending account status before it can query the wrong ledger',async()=>{
 const status=deferred(),calls=[];const f=await harness(async p=>{calls.push(p);if(p.action==='status')return status.promise;return result('local',1);});await f.controller.open();
 f.source('official').onclick();assert.equal(f.source('official').getAttribute('aria-selected'),'true');assert.equal(f.node('request-rows').children.length,0);f.source('local').onclick();await flush();status.resolve({signedIn:true,user:{}});await flush();
 assert.equal(calls.filter(p=>p.action==='requests_official').length,0);assert.match(f.node('request-rows').textContent,/local/);assert.equal(f.node('request-extra-head').textContent,'线路');assert.equal(f.node('request-role-head').hidden,false);
});
