// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: image; contents; park; windowFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/desk-park.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDeskPark}=require('../host/desk-park.cjs');
const image=value=>({isEmpty:()=>false,getSize:()=>({width:500,height:300}),toJPEG:()=>Buffer.from(value)});
const contents=value=>({isDestroyed:()=>false,getURL:()=>value,capturePage:async()=>image(value)});
const park=()=>createDeskPark({owner:()=>null});
const {EventEmitter}=require('node:events');
function windowFixture(){
 const host=new EventEmitter();let bounds={x:100,y:100,width:600,height:400},minimum=[400,300];
 Object.assign(host,{isDestroyed:()=>false,isMaximized:()=>false,getBounds:()=>({...bounds}),getMinimumSize:()=>[...minimum],setMinimumSize:(...v)=>{minimum=v;},setBounds:v=>{bounds={...v};},setOpacity:v=>{host.opacity=v;},hide(){host.hidden++;},hidden:0});
 return host;
}
test('repeated minimize and restore retain only one owned close listener',async()=>{
 const p=createDeskPark({owner:()=>null,motion:()=>false}),host=windowFixture();
 for(let i=0;i<25;i++){p.take('browser',host,{instant:true});p.restore('browser');}
 assert.equal(host.listenerCount('closed'),1);
 await p.preview('browser',contents('page'));host.emit('closed');
 assert.equal((await p.preview('browser',contents('page'),{cached:true})).available,false);
 assert.equal(host.listenerCount('closed'),0);
});
test('an old window closing cannot delete its replacement and forget detaches ownership',()=>{
 const p=createDeskPark({owner:()=>null,motion:()=>false}),old=windowFixture(),next=windowFixture();
 p.take('browser',old,{instant:true});p.restore('browser');p.take('browser',next,{instant:true});old.emit('closed');
 assert.equal(p.parked('browser'),true);assert.equal(old.listenerCount('closed'),0);
 p.forget('browser');assert.equal(next.listenerCount('closed'),0);assert.equal(p.parked('browser'),false);
});
test('restore and re-minimize cancel earlier animations without losing full bounds',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:0});
 const host=windowFixture(),bounds=host.getBounds(),p=createDeskPark({owner:()=>({getContentBounds:()=>({x:0,y:0})})});
 p.take('browser',host);t.mock.timers.tick(64);assert.notDeepEqual(host.getBounds(),bounds);
 p.restore('browser');t.mock.timers.tick(32);p.take('browser',host);t.mock.timers.tick(200);
 assert.equal(host.hidden,1);assert.equal(p.parked('browser'),true);assert.deepEqual(host.getBounds(),bounds);assert.deepEqual(host.getMinimumSize(),[400,300]);
 p.restore('browser');t.mock.timers.tick(200);assert.equal(p.parked('browser'),false);assert.deepEqual(host.getBounds(),bounds);assert.equal(host.opacity,1);
});
test('forget during a shrink prevents later callbacks and restores geometry',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:0});
 const host=windowFixture(),bounds=host.getBounds(),p=createDeskPark({owner:()=>({getContentBounds:()=>({x:0,y:0})})});
 p.take('browser',host);t.mock.timers.tick(64);p.forget('browser');t.mock.timers.tick(200);
 assert.deepEqual(host.getBounds(),bounds);assert.equal(host.opacity,1);assert.equal(host.hidden,0);assert.equal(host.listenerCount('closed'),0);
});
test('native border rounding never accumulates across repeated parked restores',()=>{
 const host=windowFixture(),bounds=host.getBounds(),set=host.setBounds,p=createDeskPark({owner:()=>null,motion:()=>false});
 host.setBounds=v=>set({...v,width:v.width+1,height:v.height+1});
 for(let i=0;i<12;i++){p.take('browser',host,{instant:true});p.restore('browser');assert.deepEqual(host.getBounds(),bounds);}
});
test('failed preview is cached only for the same live page and is marked stale',async()=>{
 const p=park(),a=contents('a'),b=contents('b');
 const first=await p.preview('browser',a);assert.equal(first.available,true);
 a.capturePage=async()=>{throw Error('capture failed');};
 const cached=await p.preview('browser',a);assert.equal(cached.url,first.url);assert.equal(cached.stale,true);
 b.capturePage=a.capturePage;assert.equal((await p.preview('browser',b)).available,false);
 assert.equal((await p.preview('browser',null)).available,false);
});
test('late captures cannot restore an old tab or resurrect a forgotten window',async()=>{
 const p=park(),a=contents('a'),b=contents('b');let finish;
 a.capturePage=()=>new Promise(r=>{finish=r;});const old=p.preview('browser',a);await Promise.resolve();
 const next=await p.preview('browser',b);finish(image('a'));
 assert.equal((await old).available,false);assert.equal((await p.preview('browser',b)).url,next.url);
 const forgotten=p.preview('browser',a);await Promise.resolve();p.forget('browser');finish(image('a'));assert.equal((await forgotten).available,false);
});
test('navigation, identity changes and destruction never reuse the old image',async()=>{
 const p=park(),a=contents('a');await p.preview('browser',a,{identity:'tab:1'});
 a.capturePage=async()=>{throw Error('capture failed');};
 assert.equal((await p.preview('browser',a,{identity:'tab:2'})).available,false);
 a.capturePage=async()=>image('a');await p.preview('browser',a);a.getURL=()=> 'new';a.capturePage=async()=>{throw Error('capture failed');};
 assert.equal((await p.preview('browser',a)).available,false);
 a.isDestroyed=()=>true;assert.equal((await p.preview('browser',a)).available,false);
});
test('a stalled native capture is bounded and subsequent requests share the pending capture',async()=>{
 const p=createDeskPark({owner:()=>null,captureTimeoutMs:15}),a=contents('a');let calls=0,finish;
 a.capturePage=()=>{calls++;return new Promise(r=>{finish=r;});};
 assert.equal((await p.preview('browser',a)).available,false);assert.equal((await p.preview('browser',a)).available,false);assert.equal(calls,1);
 p.forget('browser');finish(image('old'));assert.equal((await p.preview('browser',null)).available,false);
});
test('hidden previews retain only their own last visible page and never attempt capture',async()=>{
 const p=park(),a=contents('a');await p.preview('browser',a,{identity:'page:1'});a.capturePage=()=>{throw Error('must not capture');};
 const cached=await p.preview('browser',a,{identity:'page:1',cached:true});assert.equal(cached.available,true);assert.equal(cached.stale,true);
 assert.equal((await p.preview('browser',a,{identity:'page:2',cached:true})).available,false);
});
test('hovering the cache while the pre-hide capture is pending does not discard that frame',async()=>{
 const p=park(),a=contents('a');let finish;
 a.capturePage=()=>new Promise(r=>{finish=r;});
 const capture=p.preview('browser',a);await Promise.resolve();
 assert.equal((await p.preview('browser',a,{cached:true})).available,false);
 finish(image('a'));assert.equal((await capture).available,true);
 assert.equal((await p.preview('browser',a,{cached:true})).available,true);
});
test('a minimized transition frame never replaces the last real page',async()=>{
 const p=park(),a=contents('a'),first=await p.preview('browser',a);a.capturePage=async()=>({...image('tiny'),getSize:()=>({width:2,height:2})});
 const next=await p.preview('browser',a);assert.equal(next.url,first.url);assert.equal(next.stale,true);
});
test('waiting for a restored viewport is included in the capture deadline',async()=>{
 const p=createDeskPark({owner:()=>null,captureTimeoutMs:15}),a=contents('a');let captured=false,ready;
 a.capturePage=async()=>{captured=true;return image('a');};
 const value=await p.preview('browser',a,{ready:new Promise(r=>{ready=r;})});assert.equal(value.available,false);assert.equal(captured,false);ready();
});
test('restoring during the pre-hide snapshot cancels a late hide',async()=>{
 const p=createDeskPark({owner:()=>null,motion:()=>false});let finish,hidden=0;
 const host={isDestroyed:()=>false,isMaximized:()=>false,getBounds:()=>({x:0,y:0,width:500,height:400}),once(){},hide(){hidden++;},setOpacity(){},setBounds(){}};
 p.take('browser',host,{instant:true,beforeHide:()=>new Promise(r=>{finish=r;})});await Promise.resolve();assert.equal(p.restore('browser'),true);finish();await new Promise(r=>setImmediate(r));assert.equal(hidden,0);
});
