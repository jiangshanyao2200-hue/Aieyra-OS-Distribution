// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; dial; tempDir
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-registry.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {openLease,ownerEnvironment,ACK}=require('../host/modules/lease.cjs');
const {publish,connect,readRecord,recordFile}=require('../host/modules/registry.cjs');

function dial(port,line){
 return new Promise(resolve=>{
  const socket=net.connect(port,'127.0.0.1');let data='';
  socket.setEncoding('utf8');socket.on('error',()=>{});
  socket.on('connect',()=>socket.write(line));
  socket.on('data',chunk=>{data+=chunk;});
  socket.on('close',()=>resolve({data,socket}));
  setTimeout(()=>resolve({data,socket,open:!socket.destroyed}),300);
 });
}
function tempDir(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-modules-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('lease acknowledges only the exact token and releases peers on close',async()=>{
 const lease=await openLease();
 const wrong=await dial(lease.port,'0'.repeat(64)+'\n');
 assert.equal(wrong.data,'');
 const right=await dial(lease.port,lease.token+'\n');
 assert.equal(right.data,ACK);assert.equal(right.open,true);
 const closed=new Promise(resolve=>right.socket.once('close',resolve));
 await lease.close();await closed;
 assert.equal(lease.peers(),0);
});

test('owner environment replaces inherited owner proof',()=>{
 const env=ownerEnvironment({PATH:'x',AIEYRA_OS_OWNER_PORT:'1',AIEYRA_OS_OWNER_TOKEN:'old',AIEYRA_OS_OWNER_STDIN:'1'},4321,'a'.repeat(64));
 assert.deepEqual(env,{PATH:'x',AIEYRA_OS_OWNER_PORT:'4321',AIEYRA_OS_OWNER_TOKEN:'a'.repeat(64)});
});

test('registry publishes, answers requests, broadcasts and removes its record',async t=>{
 const dir=tempDir(t);
 const published=await publish({id:'link',configDir:dir,version:'1.0.0',handlers:{focus:p=>({focused:p.page}),broken:()=>{throw Error('坏了');}}});
 assert.ok(readRecord(dir,'link').record);
 const client=await connect(dir,'link');
 assert.equal(client.info.pid,process.pid);
 assert.deepEqual(await client.request('ping'),{module:'link',pid:process.pid,version:'1.0.0'});
 assert.deepEqual(await client.request('focus',{page:'link'}),{focused:'link'});
 await assert.rejects(client.request('broken'),/坏了/);
 await assert.rejects(client.request('unknown'),/不支持/);
 const event=new Promise(resolve=>client.on('event',(name,payload)=>resolve([name,payload])));
 published.broadcast('state',{docked:false});
 assert.deepEqual(await event,['state',{docked:false}]);
 const gone=new Promise(resolve=>client.on('close',resolve));
 await published.close();await gone;
 assert.equal(fs.existsSync(recordFile(dir,'link')),false);
 assert.equal(await connect(dir,'link'),null);
});

test('a full-size public avatar crosses the registry without reconnecting while oversized requests are rejected',async t=>{
 const dir=tempDir(t),avatar='data:image/png;base64,'+'A'.repeat(175000);let reached=false;
 const published=await publish({id:'os',configDir:dir,handlers:{presence:()=>({frame:{instrument:{avatar}}}),large:()=>{reached=true;return {};}}});t.after(()=>published.close());
 const client=await connect(dir,'os');t.after(()=>client.close());assert.equal((await client.request('presence')).frame.instrument.avatar,avatar);assert.equal((await client.request('ping')).module,'os');
 await assert.rejects(client.request('large',{text:'x'.repeat(70000)}),/连接已断开/);assert.equal(reached,false);
});

test('registry rejects a wrong token and keeps a live owner record',async t=>{
 const dir=tempDir(t);
 const published=await publish({id:'os',configDir:dir});t.after(()=>published.close());
 const record=readRecord(dir,'os').record;
 const reply=await dial(record.port,JSON.stringify({type:'hello',token:'f'.repeat(64)})+'\n');
 assert.equal(reply.data,'');
 // Tampered file pointing to the right port with a wrong token: not online, but the live pid keeps it.
 fs.writeFileSync(recordFile(dir,'os'),JSON.stringify({...record,token:'e'.repeat(64)}));
 assert.equal(await connect(dir,'os'),null);
 assert.ok(fs.existsSync(recordFile(dir,'os')));
});

test('registry removes crash leftovers whose process is gone',async t=>{
 const dir=tempDir(t);
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;await new Promise(r=>server.close(r));
 fs.mkdirSync(path.dirname(recordFile(dir,'link')),{recursive:true});
 fs.writeFileSync(recordFile(dir,'link'),JSON.stringify({protocol:'aieyra-module/1',id:'link',pid:2147483646,port,token:'a'.repeat(64),started_at:new Date().toISOString()}));
 assert.equal(await connect(dir,'link'),null);
 assert.equal(fs.existsSync(recordFile(dir,'link')),false);
 fs.writeFileSync(recordFile(dir,'link'),'not json');
 assert.equal(await connect(dir,'link'),null);
 assert.equal(fs.existsSync(recordFile(dir,'link')),false);
 assert.throws(()=>recordFile(dir,'editor'),/未知模块/);
 // Workspace 已移除（最终搬家 R25，2026-10-18），不再是合法模块。
 assert.throws(()=>recordFile(dir,'workspace'),/未知模块/);
});
