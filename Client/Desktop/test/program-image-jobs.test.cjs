// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: load; settle; element; doc; buttons
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-image-jobs.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.join(__dirname,'../ui/program-image-jobs.mjs')).href);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function element(){return {children:[],hidden:false,append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};}
const doc={createElement:element},frame={program:'workspace',expanded:true,ready:true,task_id:'session',core_epoch:'epoch'};
const buttons=root=>root.children.flatMap(row=>row.children).filter(n=>n.type==='button');

test('a background image appears and can be stopped without another chat frame',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {setupProgramImageJobs}=await load(),root=element(),calls=[];let jobs=[];
 const view=setupProgramImageJobs({root,onError:assert.fail,read:async(action,args)=>{
  calls.push([action,args]);if(action==='job_control'){jobs=[{id:args.jobId,status:'cancelled'}];return {};}
  return {jobs};
 }},doc);t.after(()=>view.close());
 view.paint(frame);await settle();assert.equal(root.hidden,true);assert.equal(calls.length,1);
 jobs=[{id:'single',status:'running'}];t.mock.timers.tick(1499);await settle();assert.equal(calls.length,1);
 t.mock.timers.tick(1);await settle();assert.equal(root.hidden,false);
 const stop=buttons(root).find(b=>b.textContent==='停止绘图');assert.ok(stop,'the independent job reader exposes the real stop action');
 await stop.onclick();assert.deepEqual(calls.find(c=>c[0]==='job_control'),['job_control',{jobId:'single',operation:'cancel'}]);assert.equal(root.hidden,true);
 view.hidden();const count=calls.length;t.mock.timers.tick(6000);await settle();assert.equal(calls.length,count,'hidden native views do not keep reading');
 view.paint(frame);await settle();assert.equal(calls.length,count+1,'reopening reads immediately');
 view.close();t.mock.timers.tick(6000);await settle();assert.equal(calls.length,count+1);
});

test('late job reads and errors cannot enter a replacement task, epoch or hidden surface',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {setupProgramImageJobs}=await load(),root=element(),errors=[],waiting=[],calls=[];
 const view=setupProgramImageJobs({root,onError:e=>errors.push(e.message),read:action=>{
  calls.push(action);return new Promise((resolve,reject)=>waiting.push({resolve,reject}));
 }},doc);t.after(()=>view.close());
 view.paint(frame);view.paint({...frame,task_id:'replacement'});assert.equal(calls.length,1,'reads remain serialized while switching tasks');
 waiting.shift().resolve({jobs:[{id:'old',status:'running'}]});await settle();assert.equal(root.hidden,true);assert.equal(buttons(root).length,0);
 t.mock.timers.tick(0);await settle();assert.equal(calls.length,2);
 view.paint({...frame,task_id:'replacement',core_epoch:'restarted'});waiting.shift().reject(Error('old epoch failure'));await settle();assert.deepEqual(errors,[]);
 t.mock.timers.tick(0);await settle();assert.equal(calls.length,3);
 view.hidden();waiting.shift().resolve({jobs:[{id:'hidden',status:'running'}]});await settle();t.mock.timers.tick(6000);await settle();assert.equal(calls.length,3);assert.equal(root.hidden,true);
 view.paint({...frame,program:'browser'});view.paint({...frame,expanded:false});view.paint({...frame,ready:false});await settle();assert.equal(calls.length,3);
});

test('unchanged paints do not starve refreshes and retired controls cannot stop a new session',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {setupProgramImageJobs}=await load(),root=element(),calls=[],errors=[];let fail=false;
 const view=setupProgramImageJobs({root,onError:e=>errors.push(e.message),read:async(action,args)=>{
  calls.push([action,args]);if(fail)throw Error('job storage unavailable');return {jobs:[{id:'paused',status:'paused',unknown:1}]};
 }},doc);t.after(()=>view.close());
 view.paint(frame);await settle();const retired=buttons(root).find(b=>b.textContent==='停止绘图');
 assert.equal(buttons(root).find(b=>b.textContent==='继续绘图').disabled,true,'unknown accepted requests cannot be resubmitted');
 for(let i=0;i<3;i++){t.mock.timers.tick(500);view.paint(frame);await settle();}
 assert.equal(calls.length,2,'identical frames do not postpone the next read');
 view.paint({...frame,core_epoch:'replacement'});await settle();const count=calls.length;await retired.onclick();assert.equal(calls.length,count,'retired row commands are fenced');
 fail=true;t.mock.timers.tick(1500);await settle();assert.deepEqual(errors,['job storage unavailable']);
 fail=false;t.mock.timers.tick(1500);await settle();assert.equal(calls.length,count+2,'a read failure leaves the next visible retry scheduled');
 view.paint({...frame,expanded:false});const closed=calls.length;t.mock.timers.tick(6000);await settle();assert.equal(calls.length,closed);assert.equal(root.hidden,true);
});
