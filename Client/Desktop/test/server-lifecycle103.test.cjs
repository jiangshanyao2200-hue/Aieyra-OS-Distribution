// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: flush; deferred; Stream; fixture; pageFixture; terminalPage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/server-lifecycle103.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {createServersProgram}=require('../../../Program/official/servers/desktop.cjs');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Stream extends EventEmitter{
 constructor(){super();this.stderr=new EventEmitter();this.closed=false;}
 close(){this.closed=true;this.emit('close',0);}
 end(){}
 write(){}
 setWindow(){}
}
function fixture(t,{ready=true}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-server103-')),clients=[],shells=[],commands=[];let encrypted=true;
 class SSH extends EventEmitter{
  connect(options){this.options=options;if(ready)this.emit('ready');}
  shell(options,callback){shells.push({client:this,options,callback});}
  exec(command,callback){const stream=new Stream();commands.push({client:this,command,stream});callback(null,stream);}
  end(){this.ended=true;this.emit('close');}
 }
 const storage={isEncryptionAvailable:()=>encrypted,encryptString:value=>Buffer.from('fixture:'+value),decryptString:value=>value.toString().slice(8)};
 const program=createServersProgram({dataDir:directory,safeStorage:storage,configFiles:()=>[],Client:()=>{const client=new SSH();clients.push(client);return client;},pickImage:async()=>({canceled:true})});
 t.after(()=>{program.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {program,clients,shells,commands,directory,setEncrypted:value=>encrypted=value,add:()=>program.agentCall({action:'add',confirmed:true,name:'fixture',host:'192.0.2.103',user:'fixture'})};
}
test('native servers can be disabled and enabled again with the same server and vault records',async t=>{
 const f=fixture(t),server=(await f.add()).server;
 const saved=(await f.program.user({action:'vault_save',title:'retained',note:'retained note',agent:true})).entry;
 const catalog=require('../../../Program/official/catalog.cjs'),own=catalog.find('servers'),{createNativePrograms}=require('../../../Program/runtime/native.cjs');let enabled=true;
 const row={manifest:own.manifest,directory:own.root,origin:'official',enabled:true,digest:'fixture-servers'};
 const native=createNativePrograms({resolve:async id=>{if(id!==own.packageID||!enabled)throw Error('not enabled');return row;},readPackage:item=>Object.fromEntries(Object.keys(item.manifest.files).map(name=>[name,fs.readFileSync(path.join(item.directory,name))])),adapters:{servers:{open:()=>f.program.user({action:'list'}),snapshot:()=>f.program.agentCall({action:'list'}),close:()=>f.program.suspend()}}});
 t.after(()=>native.shutdown());
 assert.equal((await native.call(row,'open')).servers[0].id,server.id);
 enabled=false;await native.reconcile([]);await assert.rejects(native.call(row,'open'),/not enabled/);
 enabled=true;assert.equal((await native.call(row,'open')).servers[0].id,server.id);
 assert.equal((await native.call(row,'snapshot')).servers[0].id,server.id);
 assert.equal((await f.program.user({action:'vault_reveal',id:saved.id})).note,'retained note');
 f.program.close();await assert.rejects(f.program.user({action:'list'}),/关闭/);await assert.rejects(f.program.agentCall({action:'list'}),/关闭/);
});
test('suspending an SSH connection rejects its waiter and a late old ready cannot replace a fresh connection',async t=>{
 const f=fixture(t,{ready:false}),server=(await f.add()).server;
 const first=f.program.user({action:'terminal_open',id:server.id});const rejected=assert.rejects(first,/关闭/);
 const old=f.clients[0];f.program.suspend();await rejected;
 assert.equal(old.ended,true);assert.equal(old.options.hostVerifier('late-fingerprint'),false);old.emit('ready');assert.equal(f.shells.length,0);
 const second=f.program.user({action:'terminal_open',id:server.id});const fresh=f.clients[1];fresh.emit('ready');await flush();
 old.emit('close');const stream=new Stream();f.shells[0].callback(null,stream);const opened=await second;
 assert.equal(fresh.ended,undefined);await f.program.user({action:'terminal_close',key:opened.key});assert.equal(stream.closed,true);
});
test('a shell callback delivered after suspension is closed and never registered',async t=>{
 const f=fixture(t),server=(await f.add()).server,opening=f.program.user({action:'terminal_open',id:server.id});await flush();
 assert.equal(f.shells.length,1);f.program.suspend();await assert.rejects(opening,/关闭/);const stream=new Stream();f.shells[0].callback(null,stream);assert.equal(stream.closed,true);
 assert.equal((await f.program.user({action:'list'})).servers[0].id,server.id);
});
test('owner destruction releases its shell and late shell callbacks cannot revive a destroyed owner',async t=>{
 const f=fixture(t),server=(await f.add()).server,owner=new EventEmitter();let destroyed=false;owner.isDestroyed=()=>destroyed;
 const opening=f.program.user({action:'terminal_open',id:server.id},owner);await flush();const stream=new Stream();f.shells[0].callback(null,stream);await opening;
 assert.equal(owner.listenerCount('destroyed'),1);destroyed=true;owner.emit('destroyed');assert.equal(stream.closed,true);assert.equal(owner.listenerCount('destroyed'),0);
 destroyed=false;const next=f.program.user({action:'terminal_open',id:server.id},owner);await flush();destroyed=true;const late=new Stream();f.shells[1].callback(null,late);await assert.rejects(next,/页面已关闭/);assert.equal(late.closed,true);
});
test('owner destruction cancels a pending shell without waiting for the channel callback',async t=>{
 const f=fixture(t),server=(await f.add()).server,owner=new EventEmitter();owner.isDestroyed=()=>false;
 const opening=f.program.user({action:'terminal_open',id:server.id},owner);await flush();owner.emit('destroyed');await assert.rejects(opening,/页面已关闭/);assert.equal(owner.listenerCount('destroyed'),0);
 const late=new Stream();f.shells[0].callback(null,late);assert.equal(late.closed,true);
});
test('final shutdown prevents a queued Agent vault write from completing afterward',async t=>{
 const f=fixture(t),writing=f.program.agentCall({action:'vault_save',title:'must not be saved'});f.program.close();await assert.rejects(writing,/关闭/);
 assert.equal(fs.existsSync(path.join(f.directory,'servers','vault.json')),false);
});

for(const [label,code,signal,ok] of [['zero',0,undefined,true],['nonzero',2,undefined,false],['signal',null,'SIGTERM',false],['missing status',undefined,undefined,false],['signal with zero',0,'SIGTERM',false]])test('SSH command status requires a confirmed zero exit: '+label,async t=>{
 const f=fixture(t),server=(await f.add()).server,pending=f.program.user({action:'status',id:server.id});await flush();
 assert.equal(f.commands.length,1);const {stream}=f.commands[0];
 stream.emit('data',Buffer.from(JSON.stringify({host:'fixture',kernel:'fixture',cores:1,os:'fixture',model:'fixture',mem_total_kb:1,mem_avail_kb:1,swap_total_kb:0,swap_free_kb:0,disk_total_kb:1,disk_used_kb:0,net_rx:0,net_tx:0,io_read:0,io_write:0})));
 stream.emit('close',code,signal);const result=await pending;
 assert.equal(result.ok,ok);
 if(ok)assert.equal(result.sample.host,'fixture');else assert.match(result.error,signal?/信号/:Number.isInteger(code)?/退出码 2/:/未返回退出码/);
});
test('an SSH stream error settles the request and a later successful close cannot overwrite it',async t=>{
 const f=fixture(t),server=(await f.add()).server,pending=f.program.user({action:'status',id:server.id});await flush();
 const {stream}=f.commands[0];assert.doesNotThrow(()=>stream.emit('error',Error('fixture transport stopped')));stream.emit('close',0);
 assert.equal((await pending).ok,false);assert.match((await f.program.user({action:'list'})).servers[0].error,/fixture transport stopped/);
});
test('a signalled probe deployment is rejected without recording the probe as installed',async t=>{
 const f=fixture(t),server=(await f.add()).server,pending=f.program.agentCall({action:'probe',id:server.id,confirmed:true}),rejected=assert.rejects(pending,/信号/);await flush();
 f.commands[0].stream.emit('close',null,'SIGTERM');await rejected;
 assert.equal(f.commands.length,1);assert.equal((await f.program.user({action:'list'})).servers[0].probe,false);
});
test('an SSH error still rejects and releases its connection when recording the error fails',async t=>{
 const f=fixture(t,{ready:false}),server=(await f.add()).server,file=path.join(f.directory,'servers','servers.json'),original=fs.readFileSync(file,'utf8'),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',function(source,target){if(target===file)throw Object.assign(Error('fixture disk full'),{code:'ENOSPC'});return rename.call(fs,source,target);});
 const opening=f.program.user({action:'terminal_open',id:server.id}),rejected=assert.rejects(opening,error=>error instanceof AggregateError&&/连接被拒绝/.test(error.message)&&/保存失败/.test(error.message));
 const client=f.clients[0];assert.doesNotThrow(()=>client.emit('error',Object.assign(Error('refused'),{code:'ECONNREFUSED'})));await rejected;
 assert.equal(client.ended,true);assert.equal(fs.readFileSync(file,'utf8'),original);assert.doesNotThrow(()=>client.emit('error',Error('late old error')));
 const next=f.program.user({action:'terminal_open',id:server.id}),stopped=assert.rejects(next,/关闭/);assert.equal(f.clients.length,2);f.program.suspend();await stopped;
});
test('a changed SSH fingerprint rejects and releases even if its failure cannot be saved',async t=>{
 const f=fixture(t,{ready:false}),server=(await f.add()).server;
 const first=f.program.user({action:'terminal_open',id:server.id}),client=f.clients[0];assert.equal(client.options.hostVerifier('known-fingerprint'),true);client.emit('ready');await flush();
 f.shells[0].callback(null,new Stream());await first;f.program.suspend();
 const file=path.join(f.directory,'servers','servers.json'),original=fs.readFileSync(file,'utf8'),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',function(source,target){if(target===file)throw Error('fixture disk full');return rename.call(fs,source,target);});
 const opening=f.program.user({action:'terminal_open',id:server.id}),rejected=assert.rejects(opening,/指纹变了.*保存失败/),fresh=f.clients[1];
 assert.doesNotThrow(()=>assert.equal(fresh.options.hostVerifier('changed-fingerprint'),false));await rejected;
 assert.equal(fresh.ended,true);assert.equal(fs.readFileSync(file,'utf8'),original);
});

function pageFixture(invoke){
 const nodes=new Map(),notices=[],events={},windowEvents={},awake=[],terms=[],observers=[],timers=new Map();let nextTimer=0;
 class Node{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.style={setProperty(){}};this.hidden=false;this.value='';this.textContent='';this.open=false;this.listeners=new Map();this.classList={add(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  remove(){}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  querySelector(selector){return this.children.find(child=>child.tagName===selector)||null;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  focus(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.listeners.get('close')?.();}
 }
 const $=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 class Terminal{
  constructor(){this.cols=80;this.rows=24;this.disposed=false;terms.push(this);}
  loadAddon(){}onData(fn){this.input=fn;}onResize(fn){this.resize=fn;}focus(){this.focused=true;}write(){}dispose(){this.disposed=true;}
 }
 const app={invoke,on:fn=>events.message=fn,onVisibility:fn=>events.visibility=fn,keepAwake:value=>awake.push(value)};
 const call=async p=>{const result=await invoke(p);if(result?.ok===false)throw Error(result.error);return result;};
 const context={app,$,call,say:(message,error)=>notices.push({message,error}),setupShell(){},setupRail:()=>({select(){},setVisible(){}}),orb:()=>new Node('button'),el:(tag,cls,text)=>Object.assign(new Node(tag),{className:cls||'',textContent:text||''}),Terminal,FitAddon:class{fit(){}},mountTerminal:(_term,host)=>host,cropImage:async()=>null,ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},navigator:{clipboard:{writeText:async()=>{}}},document:{createElementNS:(_ns,tag)=>new Node(tag),querySelector:()=>null,addEventListener(){}},window:{addEventListener:(type,fn)=>windowEvents[type]=fn},setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++nextTimer,matchMedia:()=>({matches:false})};
 const source=fs.readFileSync(path.resolve(__dirname,'../../../Program/official/servers/ui/app-servers.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(source+'\nglobalThis.testPage={editEntry,openDetail,openTerminal,closeTerminal,show};',context,{timeout:1000});
 return {api:context.testPage,$,notices,events,windowEvents,awake,terms,observers};
}
test('a failed vault note load keeps the original encrypted note and does not offer an empty edit form',async t=>{
 const f=fixture(t),entry=(await f.program.user({action:'vault_save',title:'original',note:'do not erase'})).entry;
 const before=fs.readFileSync(path.join(f.directory,'servers','vault.json'),'utf8');f.setEncrypted(false);
 const page=pageFixture(p=>f.program.user(p));await flush();await page.api.editEntry(entry);
 assert.equal(page.$('vault-dialog').open,false);assert.match(page.notices.at(-1).message,/备注读取失败/);
 page.$('v-title').value='renamed';await page.$('vault-form').onsubmit({preventDefault(){}});
 assert.equal(fs.readFileSync(path.join(f.directory,'servers','vault.json'),'utf8'),before);
 f.setEncrypted(true);assert.equal((await f.program.user({action:'vault_reveal',id:entry.id})).note,'do not erase');
});
test('a successfully loaded note can be deliberately cleared and another edit cannot be overwritten by a late read',async t=>{
 const f=fixture(t),entry=(await f.program.user({action:'vault_save',title:'original',note:'clear me'})).entry;
 const page=pageFixture(p=>f.program.user(p));await flush();await page.api.editEntry(entry);assert.equal(page.$('v-note').value,'clear me');
 page.$('v-note').value='';await page.$('vault-form').onsubmit({preventDefault(){}});assert.equal((await f.program.user({action:'vault_reveal',id:entry.id})).note,'');
 const waiting=deferred(),other=pageFixture(p=>p.action==='vault_reveal'?waiting.promise:f.program.user(p));await flush();
 const old=other.api.editEntry({...entry,has_note:true});await other.api.editEntry(null);other.$('v-title').value='new draft';other.$('v-note').value='new note';waiting.resolve({ok:true,note:'old reply'});await old;
 assert.equal(other.$('v-title').value,'new draft');assert.equal(other.$('v-note').value,'new note');
});
test('a late vault save receipt cannot close or clear a newer edit after cancellation',async()=>{
 const waiting=deferred(),page=pageFixture(p=>p.action==='vault_save'?waiting.promise:Promise.resolve({ok:true,servers:[],entries:[]}));await flush();
 await page.api.editEntry(null);page.$('v-title').value='first';const saving=page.$('vault-form').onsubmit({preventDefault(){}});
 page.events.visibility({visible:false});page.events.visibility({visible:true});page.$('v-cancel').onclick();await page.api.editEntry(null);page.$('v-title').value='second';page.$('v-note').value='keep new draft';waiting.resolve({ok:true});await saving;
 assert.equal(page.$('vault-dialog').open,true);assert.equal(page.$('v-title').value,'second');assert.equal(page.$('v-note').value,'keep new draft');assert.equal(page.$('v-save').disabled,false);
});
test('hiding and returning during a vault save preserves its successful or failed receipt without locking the editor',async()=>{
 for(const failed of [false,true]){
  const waiting=deferred(),page=pageFixture(p=>p.action==='vault_save'?waiting.promise:Promise.resolve({ok:true,servers:[],entries:[]}));await flush();
  await page.api.editEntry(null);page.$('v-title').value='saved draft';page.$('v-note').value='retained note';const saving=page.$('vault-form').onsubmit({preventDefault(){}});
  assert.equal(page.$('v-save').disabled,true);page.events.visibility({visible:false});page.events.visibility({visible:true});
  if(failed)waiting.reject(Error('fixture save rejected'));else waiting.resolve({ok:true});await saving;
  assert.equal(page.$('vault-dialog').open,failed);
  if(failed){assert.equal(page.$('v-save').disabled,false);assert.match(page.$('v-status').textContent,/fixture save rejected/);assert.equal(page.$('v-note').value,'retained note');page.$('v-cancel').onclick();}
  await page.api.editEntry(null);assert.equal(page.$('v-save').disabled,false);assert.equal(page.$('vault-dialog').open,true);page.$('v-title').value='next edit';assert.equal(page.$('v-title').value,'next edit');
 }
});
function terminalPage(){
 const opens=[],closed=[],server={id:'fixture-server',name:'fixture',host:'192.0.2.103',user:'fixture',port:22};
 const page=pageFixture(async p=>{if(p.action==='list')return {ok:true,servers:[server]};if(p.action==='status')return {ok:false,error:'offline fixture'};if(p.action==='terminal_open'){const pending=deferred();opens.push(pending);return pending.promise;}if(p.action==='terminal_close'){closed.push(p.key);return {ok:true};}return {ok:true};});
 return {...page,opens,closed};
}
test('closing before terminal_open returns reclaims the late shell without reviving the panel or keepAwake',async()=>{
 const page=terminalPage();await flush();page.api.openDetail('fixture-server');const opening=page.api.openTerminal();assert.equal(page.opens.length,1);page.$('t-close').onclick();
 page.opens[0].resolve({ok:true,key:'late-shell'});await opening;
 assert.deepEqual(page.closed,['late-shell']);assert.deepEqual(page.awake,[]);assert.equal(page.$('terminal').hidden,true);assert.equal(page.terms[0].disposed,true);assert.equal(page.notices.length,0);
});
test('a cancelled old terminal cannot overwrite or close a newer terminal and duplicate clicks share one opening',async()=>{
 const page=terminalPage();await flush();page.api.openDetail('fixture-server');const first=page.api.openTerminal();await page.api.openTerminal();assert.equal(page.opens.length,1);
 page.api.closeTerminal();const second=page.api.openTerminal();assert.equal(page.opens.length,2);page.opens[1].resolve({ok:true,key:'new-shell'});await second;
 page.opens[0].resolve({ok:true,key:'old-shell'});await first;assert.deepEqual(page.closed,['old-shell']);assert.deepEqual(page.awake,[true]);assert.equal(page.terms[1].disposed,false);assert.equal(page.$('terminal').hidden,false);
 page.api.closeTerminal();await flush();assert.deepEqual(page.closed,['old-shell','new-shell']);assert.deepEqual(page.awake,[true,false]);assert.equal(page.observers[0].disconnected,true);
});
test('leaving server detail and unloading during an opening both reclaim their late shell',async()=>{
 for(const leave of [page=>page.api.show('list'),page=>page.windowEvents.beforeunload()]){
  const page=terminalPage();await flush();page.api.openDetail('fixture-server');const opening=page.api.openTerminal();leave(page);page.opens[0].resolve({ok:true,key:'released'});await opening;
  assert.deepEqual(page.closed,['released']);assert.deepEqual(page.awake,[]);assert.equal(page.terms[0].disposed,true);
 }
});
test('a failed cancelled opening cannot close a newer live terminal or report it as failed',async()=>{
 const page=terminalPage();await flush();page.api.openDetail('fixture-server');const first=page.api.openTerminal();page.api.closeTerminal();const next=page.api.openTerminal();
 page.opens[1].resolve({ok:true,key:'current'});await next;page.opens[0].reject(Error('old connection cancelled'));await first;
 assert.equal(page.$('terminal').hidden,false);assert.equal(page.terms[1].disposed,false);assert.equal(page.notices.length,0);page.api.closeTerminal();
});
