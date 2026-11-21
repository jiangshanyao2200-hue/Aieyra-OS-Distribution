// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; workspace; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/settings-rework.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const {createService}=require('../src/service.cjs'),spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs');
const {withLegacyProfiles}=require('./pool-fixture.cjs');
function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-rework-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(t,extra={}){const file=path.join(workspace(t),'config.json');fs.writeFileSync(file,JSON.stringify(withLegacyProfiles({...spec.defaults(),api_key:'sk-original-test',...extra})));const service=createService(file);return {file,service,call:(action,args)=>service.call('system:settings',{action,arguments:args,session_id:'test-session'})};}
test('stored credential cannot follow a supplied foreign origin',async t=>{
 let requests=0;const server=http.createServer((_,res)=>{requests++;res.end('{}')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const {call}=fixture(t);
 const r=await call('probe',{profile_id:'deepseek-flash',base_url:`http://127.0.0.1:${server.address().port}`});
 assert.equal(r.code,'credential_origin_mismatch');assert.equal(requests,0);
});
test('profiles retain their parameters and key histories, native identity edits rejected',async t=>{
 const {file,call,service}=fixture(t,{max_tokens:8192,api_key_history:['sk-original-test']});
 let state=await call('read');state=await call('switch',{scope:'global',id:'deepseek-v4-pro',expected_version:state.version});
 state=await call('model_update',{id:'deepseek-v4-pro',parameters:{max_tokens:65536},expected_version:state.version});
 state=await call('switch',{scope:'global',id:'deepseek-flash',expected_version:state.version});assert.equal(state.settings.max_tokens,8192);
 const boot=service.call('config:bootstrap');
 assert.equal(service.call('config:save',{settings:{...boot.settings,model:'deepseek-v4-pro'},expected_version:boot.version}).ok,false);
 state=await call('switch',{scope:'global',id:'deepseek-v4-pro',expected_version:state.version});assert.equal(state.settings.max_tokens,65536);
 assert.deepEqual(JSON.parse(fs.readFileSync(file)).api_key_history,['sk-original-test']);
});
test('cross-process versioned writers cannot both overwrite the same revision',async t=>{
 const {file}=fixture(t);const expected=cfg.version(file);
 const code=`const fs=require('node:fs'),cfg=require(process.argv[1]);process.stdin.once('data',()=>{try{const s=cfg.load(process.argv[2]).settings;s.user_id=process.argv[4];cfg.save(process.argv[2],s,process.argv[3]);process.stdout.write('saved');}catch(e){process.stdout.write(e.code||'unexpected');}});process.stdout.write('ready\\n');`;
 const children=[0,1].map(i=>spawn(process.execPath,['-e',code,require.resolve('../src/config.cjs'),file,expected,'writer'+i],{windowsHide:true,stdio:['pipe','pipe','pipe']}));
 const ready=children.map(c=>new Promise(resolve=>c.stdout.once('data',resolve)));await Promise.all(ready);
 const completed=children.map(c=>new Promise((resolve,reject)=>{let out='';c.stdout.on('data',b=>out+=b);c.once('error',reject);c.once('exit',n=>n===0?resolve(out):reject(Error('writer exited '+n)));}));
 children.forEach(c=>c.stdin.end('go'));const results=await Promise.all(completed);
 assert.equal(results.filter(x=>x==='saved').length,1);assert(results.every(x=>['saved','version_conflict','config_busy'].includes(x)),results.join(','));
});
for(const failure of ['incomplete','extra_calls','prompt_echo'])test('probe rejects '+failure,async t=>{
 const {call}=fixture(t);const server=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'test'}]}));let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),token=b.tools[0].parameters.properties.token.enum[0];
  if(b.input.at(-1)?.type==='function_call_output')return res.end(JSON.stringify({id:'r2',status:'completed',output:[{type:'message',content:[{type:'output_text',text:failure==='prompt_echo'?token:b.input.at(-1).output}]}]}));
  const item={type:'function_call',call_id:'c1',name:'aieyra_probe',arguments:JSON.stringify({token})};
  res.end(JSON.stringify({id:'r1',status:failure==='incomplete'?'incomplete':'completed',output:failure==='extra_calls'?[item,{...item,call_id:'c2'}]:[item]}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const r=await call('probe',{base_url:`http://127.0.0.1:${server.address().port}/v1`,api_key:'sk-test-probe',model:'test',api_protocol:'responses'});assert.equal(r.ok,false);assert.equal(r.probe_id,undefined);
});
test('appearance reads actual profile, parses JSONC, validates and preserves unknowns',t=>{
 const root=workspace(t),old=process.env.AIEYRA_ROOT;process.env.AIEYRA_ROOT=root;t.after(()=>{if(old===undefined)delete process.env.AIEYRA_ROOT;else process.env.AIEYRA_ROOT=old;});
 const file=path.join(root,'Terminal','runtime','settings','settings.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,'{ // comment\n"profiles":{"defaults":{"font":{"size":12}},"list":[{"guid":"{97cbf814-1256-4f28-9e68-74edfa013e7c}","font":{"size":18},},]},"custom":"https://example/a,}",}');
 const api=require('../src/appearance-settings.cjs');const initial=api.read();assert.equal(initial.settings.font_size,18);
 const result=api.update({font_size:22,cursor_shape:'emptyBox',background:'#123456'},initial.version);assert.equal(result.ok,true);assert.equal(result.settings.font_size,22);
 assert.equal(JSON.parse(fs.readFileSync(file)).custom,'https://example/a,}');assert.equal(api.update({font_size:10},initial.version).code,'version_conflict');
 assert.throws(()=>api.update({language:'en-US'},result.version));assert.throws(()=>api.update({opacity:200},result.version));
 assert.ok(result.schemes.some(s=>s.name==='Campbell'));
 const builtin=api.update({color_scheme:'Campbell',adjust_colors:'automatic'},result.version);
 assert.equal(builtin.settings.color_scheme,'Campbell');assert.equal(builtin.settings.adjust_colors,'automatic');
});
