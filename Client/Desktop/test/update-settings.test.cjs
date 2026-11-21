// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: id; ui; feedUI
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/update-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSettingsUpdates}=require('../host/settings-updates.cjs');
const id='12345678-1234-1234-1234-123456789abc';
test('settings updates keep installation authority in the manager and bind user work to the actual mother',async()=>{
 let state={ok:true,phase:'reviewed',release:{id:'r2',version:'0.2.2'}},session='mother-one';
 const calls=[],sends=[],home=()=>({session_id:session,token:'private-bridge-token'});
 const updates={status:()=>state,call:async p=>{calls.push(p);if(p.action==='decide')state={...state,phase:'deferred'};return state;}};
 const call=createSettingsUpdates({updates,version:'0.2.1',home,send:async(target,args)=>{sends.push({target,args});return {ok:true};}});
 assert.equal((await call({action:'status'})).currentVersion,'0.2.1');
 assert.equal(JSON.stringify(await call({action:'status'})).includes('private-bridge-token'),false);
 for(const action of ['handoff','prepare','verify','decide','read_file','resolve_file'])await assert.rejects(call({action}),/不支持/);
 await call({action:'check',candidate_digest:'injected'});assert.deepEqual(calls,[{action:'check'}]);
 await assert.rejects(call({action:'defer',release_id:'r1'}),/变化/);
 await call({action:'assist',request_id:id,session_id:session,task_id:'cota',message:'injected'});
 assert.equal(sends[0].target.session_id,'mother-one');assert.deepEqual(Object.keys(sends[0].args).sort(),['message','request_id']);
 assert.equal(sends[0].args.request_id,'settings-update-'+id);assert.doesNotMatch(sends[0].args.message,/injected/);
 session='mother-two';await assert.rejects(call({action:'assist',request_id:id,session_id:'mother-one'}),{code:'update_session_changed'});assert.equal(sends.length,1);
 await call({action:'defer',release_id:'r2'});assert.equal(calls.at(-1).decision,'defer');
 state={...state,phase:'handoff'};await assert.rejects(call({action:'defer',release_id:'r2'}),/不能延期/);
 state={ok:true,phase:'login_required'};await assert.rejects(call({action:'assist',request_id:id,session_id:session}),/登录/);assert.equal(sends.length,1);
 const disabled=createSettingsUpdates({updates:null,version:'dev',home,send:()=>assert.fail('disabled instance dispatched work')});
 assert.equal((await disabled({action:'status'})).phase,'disabled');await assert.rejects(disabled({action:'check'}),/未启用/);
});

function ui(){
 const nodes=new Map(),timers=new Map(),values=new Map();let seq=0;
 const doc={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:false});return nodes.get(id);}};
 return {doc,$:doc.getElementById,timers,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},setTimer:fn=>{timers.set(++seq,fn);return seq;},clearTimer:id=>timers.delete(id),uuid:()=>id};
}
test('a lost update task reply retains its original request through settings reload without an automatic resend',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=ui(),calls=[];
 const state={ok:true,enabled:true,currentVersion:'0.2.1',phase:'reviewed',homeSession:'mother-one',release:{id:'r2',version:'0.2.2'},nextRelease:{id:'r4',version:'0.2.4'},conflicts:2,localChanges:3};
 let fail=true,stops=0;
 const api={onAccountChanged:()=>()=>stops++,updates:async p=>{calls.push(p);if(p.action==='assist'&&fail)throw Error('reply lost');return {...state,accepted:p.action==='assist'};}};
 const first=setupUpdateSettings(api,f);first.initialize(state);
 await f.$('update-assist').onclick();assert.match(f.$('update-status').textContent,/reply lost/);assert.equal(calls.length,1);assert.equal(f.timers.size,0);
 first.close();const second=setupUpdateSettings(api,f);second.initialize(state);assert.equal(calls.length,1);
 assert.equal(f.$('update-assist').textContent,'重试交给 Eyra');fail=false;
 await f.$('update-assist').onclick();assert.deepEqual(calls[0],calls[1]);assert.equal(f.$('update-assist').textContent,'让 Eyra 处理');
 assert.match(f.$('update-status').textContent,/已交给 Eyra/);
 assert.match(f.$('update-changes').textContent,/冲突 2 项/);assert.equal(f.$('update-next').textContent,'0.2.4');
 second.close();assert.equal(stops,2);
});
test('update observation pauses when hidden and late replies cannot schedule work after close',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=ui();let resolve,calls=0;
 const controller=setupUpdateSettings({updates:()=>{calls++;return new Promise(r=>{resolve=r;});}},f);
 controller.initialize({enabled:false,phase:'disabled',currentVersion:'dev'});
 assert.equal(f.$('update-check').disabled,true);assert.equal(f.$('update-assist').disabled,true);
 controller.visibility(true);assert.equal(calls,1);controller.visibility(false);assert.equal(f.timers.size,0);
 controller.close();resolve({ok:true,enabled:true,phase:'idle',currentVersion:'late'});await new Promise(r=>setImmediate(r));
 assert.equal(f.timers.size,0);assert.equal(f.$('update-current').textContent,'dev');
});

test('one-click update starts while a status refresh is pending and keeps the newer reply',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=ui();
 const state={enabled:true,phase:'available',release:{version:'0.2.86'}};
 let finishStatus;const actions=[];
 const controller=setupUpdateSettings({updates:async({action})=>{
  actions.push(action);
  if(action==='status')return new Promise(resolve=>{finishStatus=resolve;});
  return {...state,quick:{running:true,text:'正在检查更新'}};
 }},f);
 controller.initialize(state);controller.visibility(true);
 await f.$('update-now').onclick();
 finishStatus(state);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(actions,['status','quick']);
 assert.equal(f.$('update-now').disabled,true);
 assert.equal(f.$('update-now').textContent,'正在检查更新');
 controller.close();
});

test('settings release feed is read only, filters unofficial updates, and integrity works without update installation',async()=>{
 const calls=[],community={status:()=>({signedIn:true}),call:async p=>{calls.push(p);return p.action==='topics'?{items:[{id,type:'update',official:true,title:'OS release'},{id:'other',type:'discussion',official:true},{id:'fake',type:'update',official:false}]}:{item:{id,type:'update',official:true,content:'Published changes'}};}};
 const integrity={status:()=>({phase:'checked',consistent:3,different:1}),check:async()=>calls.push('integrity')};
 const api=createSettingsUpdates({updates:null,version:'dev',home:()=>({}),community,integrity});
 assert.deepEqual((await api({action:'posts'})).items.map(r=>r.id),[id]);assert.equal(calls[0].type,'update');assert.equal(calls[0].sort,'latest');assert.equal((await api({action:'post',id})).content,'Published changes');
 assert.equal((await api({action:'integrity'})).integrity.different,1);assert.equal(calls.at(-1),'integrity');
 community.status=()=>({signedIn:false});assert.equal((await api({action:'posts'})).signedIn,false);
});

function feedUI(){
 const f=ui();
 const node=()=>({textContent:'',hidden:false,disabled:false,children:[],setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
 f.doc.createElement=node;
 Object.assign(f.$('update-posts'),node());Object.assign(f.$('update-integrity-modules'),node());
 return f;
}
test('integrity differences permit review, while unresolved conflicts disable safe update',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=ui();
 const state={enabled:true,phase:'available',integrity:{phase:'checked',version:'0.2.85',checkedFiles:12,checkedAt:Date.now(),consistent:2,different:1}};
 const controller=setupUpdateSettings({updates:async()=>state},f);controller.initialize(state);
 assert.equal(f.$('update-now').disabled,false);assert.match(f.$('update-integrity-note').textContent,/保留没有冲突的本地改动/);
 controller.initialize({...state,phase:'reviewed',conflicts:1});
 assert.equal(f.$('update-now').disabled,true);assert.equal(f.$('update-now').textContent,'等待解决冲突');controller.close();
});
test('release feed switches accounts during a pending request and rejects retired posts',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=feedUI();let change,oldReply,count=0;
 const state={enabled:false,phase:'disabled',integrity:{phase:'unavailable'}};
 const controller=setupUpdateSettings({onAccountChanged:fn=>{change=fn;return()=>{};},updates:async p=>p.action==='posts'?(++count===1?new Promise(r=>{oldReply=r;}):{items:[{id,title:'new account release',summary:''}]}):state},f);
 controller.initialize(state);controller.visibility(true);change();await new Promise(r=>setImmediate(r));
 assert.equal(count,2,'new account must load even when previous request has not returned');
 oldReply({items:[{id,title:'retired release',summary:''}]});await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.$('update-posts').children.map(n=>n.children[0].textContent),['new account release']);controller.close();
});
test('hidden release feed drops pending work and reloads on return',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=feedUI();let oldReply,count=0;
 const state={enabled:false,phase:'disabled',integrity:{phase:'unavailable'}};
 const controller=setupUpdateSettings({updates:async p=>p.action==='posts'?(++count===1?new Promise(r=>{oldReply=r;}):{items:[{id,title:'visible release',summary:''}]}):state},f);
 controller.initialize(state);controller.visibility(true);controller.visibility(false);oldReply({items:[{id,title:'hidden reply',summary:''}]});await new Promise(r=>setImmediate(r));
 assert.equal(f.$('update-posts').children.length,0);controller.visibility(true);await new Promise(r=>setImmediate(r));
 assert.equal(count,2);assert.equal(f.$('update-posts').children[0].children[0].textContent,'visible release');controller.visibility(false);controller.visibility(true);await new Promise(r=>setImmediate(r));assert.equal(count,3,'returning to a completed feed must refresh retired detail handlers');controller.close();
});

test('one-click update runs the signed review chain in order, then hands off without waiting for polling',async()=>{
 const flow={check:{phase:'available',release:{id:'r3',version:'0.2.3'}},review:{phase:'reviewed',conflicts:0},prepare:{phase:'prepared'},verify:{phase:'validated',candidateDigest:'d1'},decide:{phase:'waiting_idle'}};
 let state={ok:true,phase:'idle',release:null};const calls=[];let approved=0;
 const updates={status:()=>state,call:async p=>{calls.push(p);state={...state,...flow[p.action]};return state;}};
 const call=createSettingsUpdates({updates,version:'0.2.2',home:()=>({session_id:'s'}),onApproved:()=>approved++});
 const first=await call({action:'quick'});assert.equal(first.quick.running,true);
 assert.equal((await call({action:'quick'})).quick.running,true,'a second click joins the running update');
 while((await call({action:'status'})).quick.running)await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls.map(c=>c.action),['check','review','prepare','verify','decide']);
 assert.deepEqual(calls.at(-1),{action:'decide',decision:'apply',candidate_digest:'d1',reason:'用户在更新程序中一键更新'});
 assert.equal(approved,1);assert.equal((await call({action:'status'})).quick.step,'done');
});
test('one-click update stops on local conflicts and reports latest when nothing is newer',async()=>{
 let state={ok:true,phase:'idle',release:null};const calls=[];
 const updates={status:()=>state,call:async p=>{calls.push(p.action);if(p.action==='check')state={...state,phase:'available',release:{id:'r3',version:'0.2.3'}};if(p.action==='review')state={...state,phase:'reviewed',conflicts:2};return state;}};
 const call=createSettingsUpdates({updates,version:'0.2.2',home:()=>({session_id:'s'}),onApproved:()=>assert.fail('conflicts must not hand off')});
 await call({action:'quick'});while((await call({action:'status'})).quick.running)await new Promise(r=>setImmediate(r));
 const failed=(await call({action:'status'})).quick;assert.equal(failed.code,'update_conflicts');assert.match(failed.text,/2 个文件/);assert.deepEqual(calls,['check','review']);
 const latest=createSettingsUpdates({updates:{status:()=>({ok:true,phase:'idle',release:null}),call:async()=>({ok:true,phase:'idle',release:null})},version:'0.2.3',home:()=>({session_id:'s'})});
 await latest({action:'quick'});await new Promise(r=>setImmediate(r));assert.equal((await latest({action:'status'})).quick.text,'已是最新版本');
 const committed=createSettingsUpdates({updates:{status:()=>({ok:true,phase:'committed',release:{id:'r3',version:'0.2.3'}}),call:async()=>({ok:true,phase:'committed',release:{id:'r3',version:'0.2.3'}})},version:'0.2.3',home:()=>({session_id:'s'})});
 await committed({action:'quick'});await new Promise(r=>setImmediate(r));assert.equal((await committed({action:'status'})).quick.text,'已是最新版本','a finished update is not reviewed again');
});
test('settings shows the one-click button with the target version and progress text',async()=>{
 const {setupUpdateSettings}=await import('../ui/update-settings.mjs'),f=ui(),calls=[];
 const state={ok:true,enabled:true,currentVersion:'0.2.2',phase:'available',homeSession:'s',release:{id:'r3',version:'0.2.3'}};
 const controller=setupUpdateSettings({updates:async p=>{calls.push(p.action);return {...state,quick:{running:true,step:'review',text:'正在下载并核对'}};}},f);controller.initialize(state);
 assert.equal(f.$('update-now').textContent,'安全更新到 0.2.3');assert.equal(f.$('update-now').disabled,false);
 await f.$('update-now').onclick();assert.deepEqual(calls,['quick']);assert.equal(f.$('update-now').textContent,'正在下载并核对');assert.equal(f.$('update-now').disabled,true);
 controller.close();
});
