// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/computer-presentation.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{Writable}=require('node:stream');
function fixture(failPipe=false){
 const calls=[],pending=[],identity={pid:77,handle:'12',path:'C:\\fixture.exe',started:'1'};
 const spawn=()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  const finish=data=>{if(child.done)return;child.done=true;child.stdout.emit('data',Buffer.from(JSON.stringify(data)));child.emit('close',0);};
  child.kill=()=>{child.killed=true;setImmediate(()=>{if(!child.done){child.done=true;child.emit('close',1);}});};
  child.stdin=new Writable({write(raw,_encoding,done){if(failPipe){failPipe=false;done(Object.assign(Error('closed pipe'),{code:'EPIPE'}));return;}const a=JSON.parse(raw);calls.push(a);if(a.action==='list')setImmediate(()=>finish({ok:true,windows:[identity]}));else if(a.action==='inspect')setImmediate(()=>finish({ok:true,elements:[]}));else pending.push({child,finish,args:a});done();}});
  return child;
 };
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/agent-computer.cjs'),'utf8'),{module,require:name=>name==='node:child_process'?{spawn}:name.startsWith('./')?require('../src/'+name.slice(2)):require(name),__dirname:path.join(__dirname,'../src'),process:{platform:'win32',env:{}},AbortSignal,AbortController,setTimeout,clearTimeout},{filename:'agent-computer.cjs'});
 return {computer:module.exports.createComputer('C:\\fixture-config.json'),calls,pending,identity};
}
test('desktop presentation gates dispatch, consumes observations before async input, and revokes pending input',async()=>{
 const f=fixture(),call=a=>f.computer.call('owner',a);try{
  const attached=await call({action:'attach',...f.identity}),window_id=attached.window_id;assert.equal(attached.presentation,'display');
  let observation=await call({action:'inspect',window_id});const before=f.calls.length;
  for(const action of ['click','set_value','keypress'])await assert.rejects(()=>call({action,window_id,revision:observation.revision,value:'a'}),/display_only/);
  assert.equal(f.calls.length,before,'display input reached the OS executor');
  await call({action:'presentation',window_id,presentation:'interactive'});
  await assert.rejects(()=>call({action:'click',window_id,revision:observation.revision}),/stale_snapshot/);
  observation=await call({action:'inspect',window_id});
  const first=call({action:'set_value',window_id,revision:observation.revision,value:'a'});const cancelled=assert.rejects(first,/cancelled/);
  await assert.rejects(()=>call({action:'click',window_id,revision:observation.revision}),/stale_snapshot/);assert.equal(f.pending.length,1);
  await call({action:'presentation',window_id,presentation:'display'});await cancelled;assert.equal(f.pending[0].child.killed,true);
  observation=await call({action:'inspect',window_id});assert.equal(observation.presentation,'display');
  await assert.rejects(()=>f.computer.call('other',{action:'presentation',window_id,presentation:'interactive'}),/Unknown window/);
 }finally{f.computer.close();}
});

test('a closed computer request pipe reports failure without crashing and a later request still works',async()=>{
 const f=fixture(true);
 try{
  await assert.rejects(()=>f.computer.call('owner',{action:'list'}),/pipe closed; outcome unknown/);
  const next=await f.computer.call('owner',{action:'list'});
  assert.equal(next.ok,true);assert.equal(next.windows[0].pid,f.identity.pid);assert.equal(f.calls.length,1);
 }finally{f.computer.close();}
});
