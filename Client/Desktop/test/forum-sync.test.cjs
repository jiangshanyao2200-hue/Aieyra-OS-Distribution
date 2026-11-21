// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/forum-sync.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createForumSync}=require('../host/forum-sync.cjs');
test('Matrix HOME sync is bounded, durable and isolated on account switch',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-sync-'));let who='a',calls=[],waiter;const listeners=new Set(),id='a0000000-0000-0000-0000-000000000001';
 const client={status:()=>({signedIn:!!who,user:who?{id:who}:null}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},call:async p=>{calls.push(p);if(waiter)return await waiter;return {events:p.after?[]:[{seq:1,topic:id,kind:'created',revision:1,created:1}],nextCursor:1,hasMore:false};}};
 let sync=createForumSync({client,directory:dir});t.after(()=>{sync.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal((await sync.refresh()).events.length,1);assert.equal(calls[0].after,0);sync.close();sync=createForumSync({client,directory:dir});assert.equal(sync.digest().cursor,1);
 assert.throws(()=>sync.preferences({preferences:{participation:'contribute'}}),/授权/);sync.preferences({preferences:{participation:'contribute'},confirmed:true});assert.equal(sync.digest().preferences.participation,'contribute');
 let resolve;waiter=new Promise(r=>resolve=r);const running=sync.refresh();who='b';for(const fn of listeners)fn(true);assert.equal(sync.digest().cursor,0);assert.equal(sync.digest().preferences.participation,'read_only');resolve({events:[],nextCursor:1,hasMore:false});await assert.rejects(running,/账号/);await new Promise(r=>setImmediate(r));waiter=null;
 who=null;for(const fn of listeners)fn(false);assert.equal(sync.digest().signedIn,false);who='a';for(const fn of listeners)fn(true);await new Promise(r=>setImmediate(r));sync.preferences({preferences:{sync:false}});const count=calls.length;await sync.refresh();assert.equal(calls.length,count);
});
test('preferences changed during sync cannot be overwritten by stale result',async()=>{
 let resolve;const client={status:()=>({signedIn:true,user:{id:'a'}}),subscribe:()=>()=>{},call:()=>new Promise(r=>resolve=r)};const sync=createForumSync({client});
 try{const running=sync.refresh();sync.preferences({preferences:{sync:false}});resolve({events:[],nextCursor:4});await assert.rejects(running,/账号/);assert.equal(sync.digest().preferences.sync,false);assert.equal(sync.digest().cursor,0);}finally{sync.close();}
});

test('server cursor reset replaces old metadata; malformed streams cannot move cursor',async()=>{
 const event=(seq,kind='created')=>({seq,topic:'a0000000-0000-0000-0000-000000000001',kind,revision:1,created:1});let answer={events:[event(9)],nextCursor:9},reset=false,calls=[];
 const client={status:()=>({signedIn:true,user:{id:'a'}}),subscribe:()=>()=>{},call:async p=>{calls.push(p.after);if(reset&&p.after>0)throw Object.assign(Error('reset'),{status:409});return answer;}};const sync=createForumSync({client});
 try{await sync.refresh();reset=true;answer={events:[event(1,'imported')],nextCursor:1};await sync.refresh();assert.deepEqual(calls,[0,9,0]);assert.deepEqual(sync.digest().events.map(e=>[e.seq,e.kind]),[[1,'imported']]);reset=false;
  for(const invalid of [{events:[],nextCursor:0},{events:[event(1)],nextCursor:1},{events:[],nextCursor:2},{events:[event(3),event(2)],nextCursor:2},{events:[],nextCursor:1,hasMore:true}]){answer=invalid;await assert.rejects(sync.refresh(),/顺序/);assert.equal(sync.digest().cursor,1);}
 }finally{sync.close();}
});

test('read-only policy guards mutations and closing rejects late sync without restart',async()=>{
 let resolve,calls=0,subscribed=true;const client={status:()=>({signedIn:true,user:{id:'a'}}),subscribe:()=>()=>{subscribed=false;},call:()=>{calls++;return new Promise(r=>resolve=r);}};const sync=createForumSync({client,interval:1000});
 for(const action of ['topic_publish','reply','topic_state','topic_withdraw','reply_withdraw','moderate','import_feedback','publish','withdraw']){assert.throws(()=>sync.authorize({action}),/只读/);sync.authorize({action,confirmed:true});}
 sync.authorize({action:'topic_read'});sync.preferences({preferences:{participation:'contribute'},confirmed:true});sync.authorize({action:'reply'});
 const running=sync.refresh();sync.close();resolve({events:[],nextCursor:0});await assert.rejects(running,/账号/);await assert.rejects(sync.refresh(),/关闭/);assert.equal(subscribed,false);assert.equal(calls,1);
});

test('work boundaries bound requests, failures back off, idle and logout stop timers',async()=>{
 let tick=0,who='a',calls=0,fail=false;const timers=new Map(),listeners=new Set();let serial=0;
 const client={status:()=>({signedIn:!!who,user:who?{id:who}:null}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},call:async()=>{calls++;if(fail)throw Error('offline');return {events:[],nextCursor:0,hasMore:false};}};
 const sync=createForumSync({client,now:()=>tick,interval:10000,setTimer:(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:tick+delay});return id;},clearTimer:id=>timers.delete(id)});
 const settle=()=>new Promise(r=>setImmediate(r));const advance=async n=>{tick+=n;for(const [id,t] of [...timers])if(t.at<=tick){timers.delete(id);t.fn();}await settle();};
 try{
  assert.equal(timers.size,0);sync.setWorking(true);await settle();assert.equal(calls,1);for(let i=0;i<20;i++)sync.boundary();await settle();assert.equal(calls,1);assert.equal(timers.size,1);
  fail=true;await advance(10000);assert.equal(calls,2);assert.equal([...timers.values()][0].at,tick+5000);sync.boundary();await settle();assert.equal(calls,2);await advance(5000);assert.equal(calls,3);assert.equal([...timers.values()][0].at,tick+10000);
  sync.setWorking(false);assert.equal(timers.size,0);await advance(60000);assert.equal(calls,3);fail=false;sync.setWorking(true);await settle();assert.equal(calls,4);assert.equal([...timers.values()][0].at,tick+10000);
  who=null;for(const fn of listeners)fn(false);assert.equal(timers.size,0);await advance(60000);assert.equal(calls,4);who='b';for(const fn of listeners)fn(true);await settle();assert.equal(calls,5);sync.setWorking(false);assert.equal(timers.size,0);
  sync.close();sync.boundary();sync.setWorking(true);await advance(60000);assert.equal(calls,5);assert.equal(timers.size,0);
 }finally{sync.close();}
});
