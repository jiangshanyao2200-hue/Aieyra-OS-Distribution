// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: tmp; office
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/round82-plugins.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {parseSSHConfig,createServers,PROBE}=require('../../../Program/official/servers/service.cjs');
const {createLinkAgent}=require('../host/link-agent.cjs');
const {createPlugins,MODULE_SUMMARY}=require('../host/plugins.cjs');
const {MODULES}=require('../host/module-catalog.cjs');
const tmp=t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-r82-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 return root;
};
test('SSH 配置：多别名、跳过通配，跳板机标记出来',()=>{
 const rows=parseSSHConfig('Host a b\n HostName 192.0.2.10\n User u\n Port 2222\n IdentityFile ~/k\nHost *\n User z\nHost j\n ProxyJump x\n','/home/example');
 assert.deepEqual(rows.map(r=>r.alias),['a','b','j']);assert.equal(rows[0].port,2222);assert.equal(rows[0].key_path,path.join('/home/example','k'));assert.equal(rows[2].proxy,true);
});
test('服务器：密码不落明文也不进列表，工具传不了密码和终端',async t=>{
 const dataDir=tmp(t),safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('enc:'+s),decryptString:b=>b.toString().slice(4)};
 const s=createServers({dataDir,safeStorage,configFiles:()=>[]});
 const {server}=await s.call({action:'add',name:'n',host:'192.0.2.10',user:'root',password:'hunter2-secret'});
 assert.equal(server.auth,'password');assert.ok(!JSON.stringify(server).includes('hunter2'));
 assert.ok(!fs.readFileSync(path.join(dataDir,'servers','servers.json'),'utf8').includes('hunter2'));
 assert.ok(!fs.readFileSync(path.join(dataDir,'servers','secrets.json'),'utf8').includes('hunter2'));
 await assert.rejects(()=>s.call({action:'add',host:'192.0.2.10',user:'root',password:'x'}),/已经在列表/);
 for(const bad of [{host:'-oProxyCommand=x',user:'root'},{host:'a b',user:'root'},{host:'h',user:'-x'}])await assert.rejects(()=>s.call({action:'add',...bad}),/不允许|无效/);
 assert.throws(()=>s.agentCall({action:'add',host:'192.0.2.20',user:'u',password:'p'}),/不能直接传密码/);
 assert.throws(()=>s.agentCall({action:'terminal_open',id:server.id}),/未知/);
 await s.call({action:'remove',id:server.id});assert.equal((await s.call({action:'list'})).servers.length,0);
 assert.ok(!fs.readFileSync(path.join(dataDir,'servers','secrets.json'),'utf8').includes(server.id));
});
test('探针：只读，不开端口不要 root，输出合法 JSON 的结构',()=>{
 assert.ok(!/\b(sudo|systemctl|crontab|nc |curl|wget)\b/.test(PROBE));
 assert.match(PROBE,/mem_total_kb/);assert.match(PROBE,/disk_used_kb/);
});
test('服务器指纹：第一次记住，变了就拒绝',async t=>{
 const {EventEmitter}=require('node:events');
 const dataDir=tmp(t),safeStorage={isEncryptionAvailable:()=>false};let verify;
 class Fake extends EventEmitter{connect(o){verify=o.hostVerifier;if(verify('abc'))this.emit('ready');else this.emit('error',Error('拒绝'));}exec(c,cb){const st=new EventEmitter();st.stderr=new EventEmitter();st.end=()=>{st.emit('data','{"cpu":1,"cores":2,"mem_total_kb":100,"mem_avail_kb":50,"disk_total_kb":10,"disk_used_kb":5,"load":"0 0 0","uptime_s":9,"net_rx":1,"net_tx":1,"containers":"","host":"h","kernel":"k"}\n');st.emit('close',0);};cb(null,st);}end(){this.emit('close');}}
 const s=createServers({dataDir,safeStorage,Client:()=>new Fake(),configFiles:()=>[]});
 t.after(()=>s.close());
 const {server}=await s.call({action:'add',host:'192.0.2.10',user:'root'});
 const out=await s.call({action:'connect',id:server.id});assert.equal(out.server.fingerprint,'abc');assert.equal(out.sample.mem_used_pct,50);assert.equal(out.sample.disk_used_pct,50);
 assert.equal(verify('abc'),true);assert.equal(verify('changed'),false);
 s.close();
});
function office(routes){return new Promise(resolve=>{const server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{const key=req.method+' '+req.url.split('?')[0],fn=routes[key];if(!fn){res.statusCode=404;return res.end('{}');}const out=fn(req,body&&JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify(out));});});server.listen(0,'127.0.0.1',()=>resolve(server));});}
test('Link 工具：第一次登记，之后带凭据读频道和发言',async t=>{
 const seen={};
 const server=await office({
  'GET /api/session':()=>({csrf:'c'}),
  'POST /api/agent-access/enroll':(req,body)=>{seen.enroll=body;seen.csrf=req.headers['x-control-csrf'];return {actor_id:'agent-1'};},
  'GET /api/agent/v1/seats':req=>{seen.auth=req.headers.authorization;return {actor_id:'agent-1',seats:[{id:'s',project:'os',name:'Eyra'}]};},
  'GET /api/agent/v1/center/inbox':()=>({messages:[{seq:9,sender_name:'Claude',kind:'handoff',project:'os',body:'hi',created:1}],next_cursor:9,has_more:false}),
  'POST /api/agent/v1/center/message':(req,body)=>{seen.post=body;return {seq:10,id:'m'};},
  'GET /api/office':()=>({adapters:[{name:'Claude',actor_id:'a',state:'registered'}]}),
  'GET /api/registry':()=>({projects:[{id:'os'}]}),
 });t.after(()=>server.close());
 const dataDir=tmp(t),link=createLinkAgent({dataDir,port:()=>server.address().port});
 await assert.rejects(()=>link.call({action:'inbox'}),/还没有加入/);
 const joined=await link.call({action:'join'});assert.equal(joined.joined,true);assert.equal(seen.csrf,'c');assert.equal(seen.enroll.name,'Eyra');
 assert.equal(seen.auth,'Bearer '+seen.enroll.token);
 assert.ok(!JSON.stringify(joined).includes(seen.enroll.token));
 const again=await link.call({action:'join'});assert.equal(again.actor_id,'agent-1');
 const inbox=await link.call({action:'inbox'});assert.equal(inbox.messages[0].from,'Claude');assert.equal(inbox.next_cursor,9);
 const post=await link.call({action:'post',body:'收到',kind:'progress'});assert.equal(post.seq,10);assert.equal(seen.post.kind,'progress');
 await assert.rejects(()=>link.call({action:'post',body:''}),/body/);await assert.rejects(()=>link.call({action:'post',body:'x',kind:'decision'}),/kind/);
 const status=await link.call({action:'status'});assert.equal(status.joined,true);assert.equal(status.stations[0].name,'Claude');
});
test('自我认知是制度：每个模块都要有说明，清单随安装变化',async t=>{
 for(const m of MODULES)assert.ok(MODULE_SUMMARY[m.id]?.[1],'模块缺少说明：'+m.id);
 const dataDir=tmp(t);let items=[];
 const plugins=createPlugins({dataDir,modules:MODULES,resources:{call:async()=>({items})},window:()=>{throw Error('no');}});
 plugins.changed();await new Promise(r=>setTimeout(r,60));
 const read=()=>JSON.parse(fs.readFileSync(path.join(dataDir,'runtime','capabilities.json'),'utf8')).items.map(i=>i.name);
 for(const name of ['服务器','Link'])assert.ok(read().includes(name),name);assert.ok(read().includes('浏览器'));assert.ok(!read().includes('主题'),'retired theme app must not return');
 const link=JSON.parse(fs.readFileSync(path.join(dataDir,'runtime','capabilities.json'),'utf8')).items.find(i=>i.name==='Link');assert.match(link.summary,/办公室/);assert.match(link.use,/arguments.id=aieyra\.link/);
 items=[{manifest:{id:'u1.x',name:'新工具',kind:'tool',summary:'s'}}];plugins.changed();await new Promise(r=>setTimeout(r,60));assert.ok(read().includes('新工具'));
 items=[];plugins.changed();await new Promise(r=>setTimeout(r,60));assert.ok(!read().includes('新工具'));
});
test('应用菜单：钉到顶栏的状态能保存，模块也能隐藏',async t=>{
 const dataDir=tmp(t),plugins=createPlugins({dataDir,modules:MODULES,resources:{call:async()=>({items:[{manifest:{id:'u.p',name:'P',kind:'program',summary:''}}]})},window:()=>{}});
 const list=await plugins.call({action:'list'});assert.equal(list.apps.find(a=>a.id==='module:servers').pinned,true);assert.equal(list.apps.find(a=>a.id==='center:u.p').pinned,false);assert.ok(!list.apps.some(a=>a.id==='module:home'));
 await plugins.call({action:'pin',id:'module:browser',pinned:false});await plugins.call({action:'pin',id:'center:u.p',pinned:true});
 const next=createPlugins({dataDir,modules:MODULES,resources:{call:async()=>({items:[{manifest:{id:'u.p',name:'P',kind:'program',summary:''}}]})},window:()=>{}});
 const after=await next.call({action:'list'});assert.equal(after.apps.find(a=>a.id==='module:browser').pinned,false);assert.equal(after.apps.find(a=>a.id==='center:u.p').pinned,true);
});
test('brief 停留：字越多停越久，积压时缩短但不消失',async()=>{
 const {BriefPacer,briefDwell}=await import('../ui/pacing.mjs');
 assert.ok(briefDwell('短')>=1400);assert.ok(briefDwell('长'.repeat(30))>briefDwell('短'));assert.ok(briefDwell('长'.repeat(200))<=4200);assert.ok(briefDwell('x',3)<briefDwell('x',0));
 let t=0;const shown=[],timers=[];const p=new BriefPacer(x=>shown.push(x),{now:()=>t,later:(fn,ms)=>{timers.push({fn,at:t+ms});return timers.length;},cancel:()=>{}});
 p.push('一');p.push('一');p.push('二');p.push('三');
 assert.deepEqual(shown,['一']);assert.equal(p.dwelling,true);
 for(let i=0;i<5&&timers.length;i++){const next=timers.shift();t=next.at;next.fn();}
 assert.deepEqual(shown,['一','二','三']);
 t+=10000;assert.equal(p.dwelling,false);p.close();
});
test('Link 排布：七个以内一行，放不下才均分换行',async()=>{
 const {homeLayout}=await import('../../../Control/app/web/office-home-model.js');
 assert.equal(homeLayout(4,1100,700).columns,4);assert.equal(homeLayout(7,1200,700).columns,7);
 assert.equal(homeLayout(8,1200,700).columns,4);assert.equal(homeLayout(14,1400,700).columns,7);assert.equal(homeLayout(1,1200,700).columns,1);
 assert.ok(homeLayout(7,1200,700).size<homeLayout(2,1200,700).size);
 const g=homeLayout(7,1200,700);assert.ok(g.columns*g.size+(g.columns-1)*g.gap<=1200);
 assert.ok(homeLayout(7,560,700).columns<7);
});
test('密码本：加密保存，Agent 只读允许的条目、只删自己记的，加服务器用 vault_id 引用',async t=>{
 const dataDir=tmp(t),safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('enc:'+s),decryptString:b=>b.toString().slice(4)};
 const s=createServers({dataDir,safeStorage,configFiles:()=>[]});
 const mine=(await s.call({action:'vault_save',title:'主机',account:'root',secret:'p4ss-user',agent:false})).entry;
 const shared=(await s.call({action:'vault_save',title:'共享',account:'root',secret:'p4ss-shared',agent:true})).entry;
 const disk=fs.readFileSync(path.join(dataDir,'servers','vault.json'),'utf8');assert.ok(!disk.includes('p4ss-'),'密码不落明文');
 const listed=JSON.stringify((await s.agentCall({action:'vault_list'})).entries);assert.ok(!listed.includes('p4ss-'),'列表不带密码');
 await assert.rejects(()=>s.agentCall({action:'vault_read',id:mine.id}),/没有允许 Agent 读取/);
 assert.equal((await s.agentCall({action:'vault_read',id:shared.id})).secret,'p4ss-shared');
 await assert.rejects(()=>s.agentCall({action:'vault_remove',id:shared.id}),/./,'用户记的条目 Agent 删不了');
 const own=(await s.agentCall({action:'vault_save',title:'Agent 记的',secret:'p4ss-agent'})).entry;await s.agentCall({action:'vault_remove',id:own.id});
 const {server}=await s.call({action:'add',name:'v',host:'192.0.2.30',user:'root',vault_id:shared.id});assert.equal(server.auth,'password');
 await assert.rejects(()=>s.call({action:'add',name:'w',host:'192.0.2.31',user:'root',vault_id:mine.id}),/./,'不允许 Agent 读取的条目不能被引用');
});
