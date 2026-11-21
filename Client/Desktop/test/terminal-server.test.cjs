// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; fs; os; path; spec
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/terminal-server.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {startServer}=require('../src/terminal-server.cjs');
const spec=require('../src/spec.cjs');
const {withLegacyProfiles}=require('./pool-fixture.cjs');

test('parent EOF releases the owned settings server even with an unfinished client request',async()=>{
 const {spawn}=require('node:child_process'),net=require('node:net'),{once}=require('node:events');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-terminal-eof-')),file=path.join(dir,'config.json');
 fs.writeFileSync(file,JSON.stringify(spec.defaults()));
 const child=spawn(process.execPath,[path.join(__dirname,'../src/terminal-server.cjs'),'--config',file],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const exit=once(child,'exit');let socket;
 try{
  const [line]=await once(child.stdout,'data'),ready=JSON.parse(String(line)),url=new URL(ready.url);
  socket=net.connect(Number(url.port),'127.0.0.1');await once(socket,'connect');
  socket.write('POST '+url.pathname.replace('renderer/index.html','rpc')+' HTTP/1.1\r\nHost: '+url.host+'\r\nContent-Type: application/json\r\nContent-Length: 10000\r\n\r\n{');
  await new Promise(r=>setTimeout(r,40));child.stdin.end();
  let timer;const result=await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);clearTimeout(timer);
  assert.deepEqual(result,[0,null],'EOF must close outstanding owned HTTP connections before the parent shutdown deadline');
 }finally{
  socket?.destroy();child.stdin.end();await exit;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('Terminal 内嵌配置：保存、模型切换、热重载与访问边界',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-terminal-test-'));
 const file=path.join(dir,'config.json');
 let server;
 try{
  fs.writeFileSync(file,JSON.stringify(withLegacyProfiles({...spec.defaults(),api_key:'sk-fake-integration',prompt_dir:path.join(dir,'Prompt'),custom_future:{retain:true}})));
  const started=await startServer(file);server=started.server;
  const call=(method,payload,headers={})=>fetch(started.rpc,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({method,payload})});
  const page=await fetch(started.url);assert.equal(page.status,200);assert.match(await page.text(),/terminal-bridge.js/);
  const bootstrap=await(await call('config:bootstrap')).json();assert.equal(bootstrap.settings.compact_percent,90);
  const fields=structuredClone(bootstrap.nativeFields);
  assert.equal(fields.find(f=>f.key==='api_key').secret,true);
  assert(!fields.some(f=>['thinking_type','reasoning_effort','max_tokens'].includes(f.key)));
  const editor=await(await call('pool:edit',{settings:bootstrap.settings,id:'deepseek-flash'})).json();assert.equal(editor.ok,true);
  assert.equal(editor.nativeFields.find(f=>f.key==='__param_thinking_type').options.length,2);
  assert(!editor.nativeFields.some(f=>f.key==='__param_context_window'));
  assert(editor.nativeFields.find(f=>f.key==='__param_compact_at_tokens'));
  assert(!editor.nativeFields.some(f=>['__param_temperature','__param_top_p','__param_max_tokens'].includes(f.key)));
  const saved=await(await call('config:save',{settings:{...bootstrap.settings,compact_percent:65,compact_keep_turns:8}})).json();
  assert.equal(saved.ok,true);assert.equal(saved.settings.compact_percent,65);
  const switched=await(await call('config:model','deepseek-v4-pro')).json();assert.equal(switched.ok,true);
  const disk=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(disk.model,'deepseek-v4-pro');assert.equal(disk.api_key,'sk-fake-integration');assert.deepEqual(disk.custom_future,{retain:true});assert.equal(disk.compact_keep_turns,8);
  assert.equal((await(await call('config:stamp')).json()).mtime,fs.statSync(file).mtimeMs);
  const latest=await(await call('config:bootstrap')).json();
  const removed=await(await call('config:save',{settings:{...latest.settings,api_key:'',api_key_history:[]}})).json();
  assert.equal(removed.ok,true);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).api_key,'');
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).api_key_history,[]);
  const emptyPing=await(await call('api:ping',{...disk,api_key:''})).json();assert.equal(emptyPing.ok,false);
  await call('config:save',{settings:disk});
  assert.equal((await call('config:bootstrap',null,{Origin:'https://example.org'})).status,403);
  assert.equal((await call('config:bootstrap',null,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await fetch(new URL('/rpc',started.url))).status,404);
  assert.equal((await fetch(new URL('../src/config.cjs',started.url))).status,404);
  assert.equal((await call('not:allowed')).status,400);
  const sessionDir=path.join(dir,'sessions');fs.mkdirSync(sessionDir);
  const sessionID='a'.repeat(32);
  fs.writeFileSync(path.join(sessionDir,sessionID+'.jsonl'),JSON.stringify({kind:'message',value:{role:'user',content:'历史任务\n精确路径'}})+'\n');
  const sessions=await(await call('session:list')).json();
  assert.equal(sessions.ok,true);assert.equal(sessions.sessions.length,1);
  assert.equal(sessions.sessions[0].title,'历史任务 精确路径');assert.equal(sessions.sessions[0].active,false);
  const restored=await(await call('session:restore',sessionID)).json();
  assert.deepEqual(restored,{ok:true,id:sessionID,title:'历史任务 精确路径'});
  const invalidSession=await call('session:restore','../config');assert.equal(invalidSession.status,400);
  assert.equal((await call('session:restore','b'.repeat(32))).status,400);
  const invalid=await(await call('config:model','unknown')).json();assert.equal(invalid.ok,false);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).model,'deepseek-v4-pro');
 }finally{
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
