// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fakeDoc; tick
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/contacts.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');

function fakeDoc(){const listeners={};return {hidden:false,addEventListener:(t,f)=>{(listeners[t]??=[]).push(f);},removeEventListener(){},fire:t=>{for(const f of listeners[t]||[])f();}};}
const tick=()=>new Promise(r=>setTimeout(r,0));

test('relative time reads like a chat list',async()=>{
 const {relativeTime}=await import('../ui/contacts.mjs'),now=Date.parse('2026-10-26T12:00:00');
 assert.equal(relativeTime('2026-10-26T11:59:40',now),'刚刚');
 assert.equal(relativeTime('2026-10-26T11:15:00',now),'45 分钟前');
 assert.equal(relativeTime('2026-10-26T08:05:00',now),'08:05');
 assert.equal(relativeTime('2026-10-25T21:00:00',now),'昨天');
 assert.equal(relativeTime('2026-10-02T21:00:00',now),'10/2');
 assert.equal(relativeTime('',now),'');
});

test('contact identity uses the shared Halo without initials and preserves the avatar',async()=>{
 const {contactIdentity}=await import('../ui/contacts.mjs');
 assert.deepEqual(contactIdentity({name:'小橘'},'data:x'),{role:'conversation',name:'小橘',ring:'orbit',avatar:'data:x',glyph:''});
 assert.equal(contactIdentity({}).name,'智能体');
});

test('store loads contacts, caches avatars by revision and stops on an old core',async()=>{
 const {createContactStore}=await import('../ui/contacts.mjs');
 const calls=[];let rev=1;
 const api={conversation:async p=>{calls.push(p.action);if(p.action==='contacts')return [{id:'a'.repeat(32),name:'甲',avatar_rev:rev,sessions:[{id:'a'.repeat(32)}]}];if(p.action==='contact_avatar')return {ok:true,avatar:'data:image/png;base64,AA',avatar_rev:rev};return {ok:true};}};
 const doc=fakeDoc(),store=createContactStore(api,{doc});await tick();await tick();
 assert.equal(store.contacts.length,1);assert.equal(store.avatar('a'.repeat(32)),'data:image/png;base64,AA');
 assert.equal(store.find('a'.repeat(32)).name,'甲');
 await store.refresh();await tick();
 assert.equal(calls.filter(a=>a==='contact_avatar').length,1,'same revision is not fetched again');
 rev=2;await store.refresh();await tick();await tick();
 assert.equal(calls.filter(a=>a==='contact_avatar').length,2,'new revision refetches');
 store.close();
 const old=createContactStore({conversation:async()=>({ok:false,error:'未知的对话智能体操作'})},{doc:fakeDoc()});await tick();await tick();
 assert.equal(old.unsupported,true);old.close();
});

test('store mutations carry fresh request ids and refresh',async()=>{
 const {createContactStore}=await import('../ui/contacts.mjs');const seen=[];
 const api={conversation:async p=>{seen.push(p);if(p.action==='contacts')return [];return {ok:true,id:'x'};},conversationOpen:async p=>({ok:true,...p})};
 const store=createContactStore(api,{doc:fakeDoc()});await tick();
 await store.create({name:'乙'});await store.newSession('c');await store.remove('c');
 const create=seen.find(p=>p.action==='contact_create'),session=seen.find(p=>p.action==='session_create');
 assert.match(create.request_id,/^[0-9a-f-]{36}$/);assert.equal(session.contact_id,'c');assert.match(session.request_id,/^[0-9a-f-]{36}$/);
 assert.ok(seen.some(p=>p.action==='contact_delete'&&p.id==='c'));
 assert.deepEqual(await store.open('s1',{detached:true}),{ok:true,id:'s1',detached:true});
 store.close();
});

test('failed deletion keeps cleanup receipt and refreshes pending state for retry',async()=>{
 const {createContactStore,cleanupSummary}=await import('../ui/contacts.mjs');let failed=false;
 const cleanup={state:'failed',steps:[{state:'completed'},{state:'failed'},{state:'pending'}]};
 const api={conversation:async p=>p.action==='contacts'?[{id:'one',name:'one',sessions:[{id:'one',deletion_pending:failed,cleanup:failed?cleanup:undefined}]}]:p.action==='session_delete'?(failed=true,{ok:false,error:'cleanup incomplete',cleanup,retryable:true}):{ok:true}};
 const store=createContactStore(api,{doc:fakeDoc()});try{
  await tick();await assert.rejects(()=>store.deleteSession('one'),e=>e.retryable&&e.cleanup===cleanup);
  assert.equal(store.find('one').sessions[0].deletion_pending,true);
  assert.equal(cleanupSummary(store.find('one').sessions[0]),'待清理 · 已完成 1/3');
 }finally{store.close();}
});

test('group read failure retains the confirmed list while contacts and error state update independently',async t=>{
 const {createContactStore}=await import('../ui/contacts.mjs');let fail=false,contactName='before';const errors=[],group={id:'g',name:'kept',members:[]};
 const store=createContactStore({conversation:async p=>p.action==='contacts'?[{id:'c',name:contactName}]:p.action==='groups'?fail?{ok:false,error:'group storage unavailable'}:[group]:{ok:true}},{doc:fakeDoc(),onError:e=>errors.push(e)});t.after(()=>store.close());await tick();
 assert.equal(store.groupsLoaded,true);assert.equal(store.groups[0],group);const confirmed=store.groups;
 fail=true;contactName='after';await store.refresh();assert.equal(store.groups,confirmed);assert.equal(store.contacts[0].name,'after');assert.match(store.groupError,/group storage unavailable/);assert.equal(store.groupsUnsupported,false);assert.equal(errors.length,1);
 await store.refresh();assert.equal(errors.length,1,'polling does not repeat the same error notice');assert.match(store.groupError,/group storage unavailable/);
 fail=false;await store.refresh();assert.equal(store.groupError,'');assert.equal(store.groupsLoaded,true);assert.equal(store.groups[0],group);
});

test('initial group errors and malformed replies remain failures, rather than confirmed empty groups',async t=>{
 const {createContactStore}=await import('../ui/contacts.mjs');let reply={ok:false,error:'access denied',code:'forbidden'};
 const store=createContactStore({conversation:async p=>p.action==='contacts'?[]:reply},{doc:fakeDoc()});t.after(()=>store.close());await tick();
 assert.equal(store.loaded,true);assert.equal(store.groupsLoaded,false);assert.equal(store.groupsUnsupported,false);assert.match(store.groupError,/access denied/);
 reply={ok:true};await store.refresh();assert.equal(store.groupsLoaded,false);assert.match(store.groupError,/格式无效/);
 reply=[];await store.refresh();assert.equal(store.groupsLoaded,true);assert.equal(store.groupError,'');assert.deepEqual(store.groups,[]);
});

test('only explicit unsupported group actions permit the old Core fallback',async t=>{
 const {createContactStore}=await import('../ui/contacts.mjs');let reply={ok:false,error:'未知的对话智能体操作'};
 const store=createContactStore({conversation:async p=>p.action==='contacts'?[{id:'c',name:'available'}]:reply},{doc:fakeDoc()});t.after(()=>store.close());await tick();
 assert.equal(store.unsupported,false);assert.equal(store.contacts.length,1);assert.equal(store.groupsUnsupported,true);assert.equal(store.groupsLoaded,true);assert.equal(store.groupError,'');
 reply={ok:false,error:'unknown disk error'};await store.refresh();assert.match(store.groupError,/unknown disk error/);assert.equal(store.groups.length,0);
 reply=[];await store.refresh();assert.equal(store.groupsUnsupported,false);assert.equal(store.groupError,'');
});

test('contact polling drops late shutdown reads, resumes immediately and stays closed after late failure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {createContactStore}=await import('../ui/contacts.mjs'),requests=[],errors=[];
 const api={conversation:p=>p.action==='contacts'?new Promise((resolve,reject)=>requests.push({resolve,reject})):Promise.resolve([])};
 const store=createContactStore(api,{doc:fakeDoc(),onError:e=>errors.push(e)}),flush=()=>new Promise(resolve=>setImmediate(resolve));t.after(()=>store.close());
 assert.equal(requests.length,1);store.suspend();requests[0].reject(Error('对话智能体当前不可用'));await flush();t.mock.timers.tick(5000);await flush();await store.refresh();assert.equal(requests.length,1);assert.deepEqual(errors,[]);assert.equal(store.loaded,false);
 store.resume();assert.equal(requests.length,2);requests[1].resolve([{id:'c',name:'fresh'}]);await flush();assert.equal(store.contacts[0].name,'fresh');
 const late=store.refresh();assert.equal(requests.length,3);store.close();requests[2].reject(Error('closed core'));await late;t.mock.timers.tick(5000);await flush();store.resume();assert.equal(requests.length,3);assert.deepEqual(errors,[]);
});

test('contact avatar reads keep their generation across pause and cannot erase a resumed in-flight fetch',async t=>{
 const {createContactStore}=await import('../ui/contacts.mjs'),images=[],errors=[];let rev=1;
 const api={conversation:async p=>p.action==='contacts'?[{id:'c',name:'contact',avatar_rev:rev}]:p.action==='groups'?[]:new Promise((resolve,reject)=>images.push({resolve,reject}))};
 const store=createContactStore(api,{doc:fakeDoc(),onError:e=>errors.push(e)});t.after(()=>store.close());await tick();assert.equal(images.length,1);
 store.suspend();rev=2;store.resume();await tick();assert.equal(images.length,2);images[0].resolve({avatar:'old',avatar_rev:1});await tick();await store.refresh();assert.equal(images.length,2,'old finally cannot clear the new pending owner');
 images[1].resolve({avatar:'fresh',avatar_rev:2});await tick();assert.equal(store.avatar('c'),'fresh');assert.equal(store.avatarRev('c'),2);
 rev=3;await store.refresh();assert.equal(images.length,3);store.close();images[2].reject(Error('avatar after close'));await tick();assert.deepEqual(errors,[]);assert.equal(store.avatar('c'),'fresh');
});

test('contact suspension does not cancel an accepted user mutation or start background refresh while paused',async t=>{
 const {createContactStore}=await import('../ui/contacts.mjs');let complete,reads=0;
 const api={conversation:async p=>p.action==='contact_create'?new Promise(resolve=>complete=resolve):p.action==='contacts'?(reads++,[]):[]};
 const store=createContactStore(api,{doc:fakeDoc()});t.after(()=>store.close());await tick();const before=reads,write=store.create({name:'accepted'});store.suspend();complete({ok:true,id:'created'});
 assert.deepEqual(await write,{ok:true,id:'created'});assert.equal(reads,before);store.resume();await tick();assert.equal(reads,before+1);
});
