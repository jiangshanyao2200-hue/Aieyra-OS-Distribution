// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/living-presence.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
test('five-second feedback describes real state and carries only a visual memory of the prior tool',async()=>{
 const {PresenceWait}=await import('../ui/presence.mjs');const p=new PresenceWait();
 assert.equal(p.project('tool','editor',0).longWait,false);
 assert.equal(p.project('tool','editor',4999).longWait,false);
 assert.equal(p.project('tool','editor',5000).title,'仍在写入内容');
 const wait=p.project('waiting','generic',5100);assert.equal(wait.title,'等待模型响应');assert.equal(wait.carry,true);assert.equal(wait.effect,'editor');
 assert.equal(p.project('waiting','generic',10100).title,'仍在等待模型回应');
 assert.equal(p.project('thinking','generic',10200).carry,false);
 assert.equal(p.project('thinking','generic',15200).title,'仍在思考');
 assert.equal(p.project('idle','generic',16000).longWait,false);
});
test('presence transitions preserve current state, feathered signals contain no vertical sweep',async()=>{
 const {TerminalContinuity,signalText}=await import('../ui/presence.mjs');const c=new TerminalContinuity(),rows=[{id:'shell',state:'completed'}];
 assert.equal(c.project(rows,'one',true,false,0),rows);assert.equal(c.project([],'one',false,false,10),rows);assert.equal(c.closing,true);assert.equal(c.project([],'one',false,false,269),rows);assert.deepEqual(c.project([],'one',false,false,270),[]);
 c.project(rows,'two',true,false,300);assert.deepEqual(c.project([],'two',false,true,301),[]);assert.equal(c.closing,false);
 assert.deepEqual(c.project(rows,'two',false,true,302),[],'cancel immediately clears even retained current activity');
 c.project(rows,'two',true,false,400);assert.deepEqual(c.project([],'three',true,false,401),[]);
 for(const kind of ['terminal','reader','editor','search','browser','map'])for(let tick=0;tick<30;tick++){assert.ok(!/[|│┃a-f0-9]/i.test(signalText(kind,tick)));assert.equal(signalText(kind,tick),signalText(kind,0),'real operation labels do not invent changing telemetry');}
});
test('Responses failure leaves saved state intact; explicit alternate response can be saved and recovered',async t=>{
 const spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs'),{createSystemSettings}=require('../src/system-settings.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-protocol-')),file=path.join(dir,'config.json'),endpoints=[];
 const server=http.createServer(async(req,res)=>{for await(const _ of req){}endpoints.push(req.url);res.setHeader('Content-Type','application/json');if(req.url==='/responses'){res.writeHead(404);res.end('{"error":{"message":"unsupported protocol"}}');return;}res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Ready'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;fs.writeFileSync(file,JSON.stringify({...spec.defaults(),base_url:base,api_key:'synthetic-protocol-key'}));const before=fs.readFileSync(file),service=createSystemSettings(file);
 const failed=await service.call('response_test',{base_url:base,api_key:'synthetic-protocol-key',model:'fixture'},'matrix');assert.equal(failed.ok,false);assert.equal(failed.status,404);assert.deepEqual(fs.readFileSync(file),before);assert.equal((await service.call('connection_recovery')).available,false);
 const proof=await service.call('response_test',{base_url:base,api_key:'synthetic-protocol-key',model:'fixture',api_protocol:'chat_completions'},'matrix');assert.equal(proof.ok,true);assert.deepEqual(endpoints,['/responses','/chat/completions']);const saved=await service.call('response_save',{test_id:proof.test_id,expected_version:proof.version},'matrix');assert.equal(saved.ok,true);assert.equal(cfg.load(file).settings.api_protocol,'chat_completions');assert.equal(endpoints.length,2);
});
test('last verified connection survives restart and restores without a model request or prompt changes',async t=>{
 const spec=require('../src/spec.cjs'),cfg=require('../src/config.cjs'),{createSystemSettings}=require('../src/system-settings.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-recovery-')),file=path.join(dir,'config.json');let requests=0;
 const server=http.createServer(async(req,res)=>{for await(const _ of req){}requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Ready'}]}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;fs.writeFileSync(file,JSON.stringify({...spec.defaults(),base_url:base,api_key:'synthetic-secret-for-test',system_prompt:'personal unchanged'}));
 let service=createSystemSettings(file),proof=await service.call('response_test',{base_url:base,api_key:'synthetic-secret-for-test',model:'test-model'},'matrix');let saved=await service.call('response_save',{test_id:proof.test_id,expected_version:proof.version},'matrix');assert.equal(saved.ok,true);assert.equal(saved.recovery_saved,true);assert.equal(requests,1);
 const checkpoint=fs.readFileSync(file+'.connection-recovery.json','utf8');assert.ok(!checkpoint.includes('synthetic-secret-for-test'));assert.ok(!checkpoint.includes('personal unchanged'));
 let current=cfg.load(file).settings;current.api_profiles.find(p=>p.id===saved.model_id).parameters.max_tokens=77;current.max_tokens=77;fs.writeFileSync(file,JSON.stringify(current));service=createSystemSettings(file);
 const stale=await service.call('connection_restore',{expected_version:saved.version},'matrix');assert.equal(stale.code,'version_conflict');
 const status=await service.call('connection_recovery',{},'matrix');assert.equal(status.available,true);const result=await service.call('connection_restore',{expected_version:status.version},'matrix');assert.equal(result.ok,true,result.errors?.join());assert.equal(result.network_requests,0);assert.equal(requests,1);
 const restored=cfg.load(file).settings,restoredProfile=restored.api_profiles.find(p=>p.id===saved.model_id);
 assert.equal(restoredProfile.parameters.max_tokens,0,'restore preserves the automatic output setting in the profile');
 assert.equal(restoredProfile.context_window,8192);assert.equal(restoredProfile.output_limit,2048);
 assert.equal(restored.max_tokens,0,'restoring automatic output must not set a wire cap');
 assert.equal(require('../src/model-catalog.cjs').outputReservation(restoredProfile),2048,'local context still reserves output room');
 assert.equal(Object.hasOwn(spec.buildRequest(restored,[{role:'user',content:'restored fixture'}],false),'max_output_tokens'),false);
 assert.equal(restored.system_prompt,'personal unchanged');
 // A learned descriptor must reach the real request; generic draft fields
 // cannot reject a previously saved endpoint/model/protocol definition.
 current=cfg.load(file).settings;const learned=current.api_profiles.find(p=>p.id===saved.model_id);learned.parameter_specs.push({key:'test_depth',type:'integer',min:1,max:8,wire_path:['test_depth'],source:'https://example.test/parameters'});fs.writeFileSync(file,JSON.stringify(current));
 const learnedProof=await service.call('response_test',{profile_id:saved.model_id,api_protocol:'responses',parameters:{test_depth:3}},'matrix');assert.equal(learnedProof.ok,true);assert.equal(requests,2);
 current=cfg.load(file).settings;current.provider_connections[0].api_key='new-secret';current.provider_connections[0].api_key_history=['new-secret'];fs.writeFileSync(file,JSON.stringify(current));const missing=await service.call('connection_restore',{expected_version:cfg.version(file)},'matrix');assert.equal(missing.ok,false);assert.equal(requests,2);
});
