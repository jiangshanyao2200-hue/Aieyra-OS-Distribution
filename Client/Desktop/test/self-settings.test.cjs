// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; resources; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/self-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const resources=require('../src/resources.cjs'),cfg=require('../src/config.cjs');
function fixture(t){
 const original=resources.root(),oldEnv=process.env.AIEYRA_RESOURCE_ROOT,dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-self-settings-'));
 fs.mkdirSync(path.join(dir,'Config'));for(const name of ['默认设置.json','运行参数.json','模型目录.json','模型资料.json','提示词索引.json'])fs.copyFileSync(path.join(original,'Config',name),path.join(dir,'Config',name));
 for(const name of ['Matrix/默认/自我.txt','Matrix/默认/工作.txt','Matrix/默认/边界.txt','Matrix/默认/思考方式.txt','Matrix/记忆/上下文清洗.txt']){const source=resources.promptPath(name,original),dest=path.join(dir,path.relative(original,source));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}
 process.env.AIEYRA_RESOURCE_ROOT=dir;t.after(()=>{if(oldEnv===undefined)delete process.env.AIEYRA_RESOURCE_ROOT;else process.env.AIEYRA_RESOURCE_ROOT=oldEnv;fs.rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'Config/config.json'),spec=require('../src/spec.cjs');
 fs.writeFileSync(file,JSON.stringify({...spec.defaults(),prompt_dir:path.join(dir,'PersonalPrompt'),extra_preserved:{value:61}}));
 const profile=require('../host/profile.cjs').createProfileStore(file);profile.save({name:'用户',eyraName:'Eyra',chatLayout:{textSize:17,left:60},initialized:true});
 const api=require('../src/system-settings.cjs').createSystemSettings(file);
 return {dir,file,profile,call:(action,p={})=>api.call(action,p,'test61')};
}
test('self configuration discovers the existing stores and config fields without changing them',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.file),all=await f.call('schema');assert.equal(all.ok,true);
 assert.deepEqual(all.scopes.map(s=>s.scope),['config','profile','appearance','interface','runtime','prompt','runtime_prompt']);
 const catalog=await f.call('schema',{scope:'config'});assert.deepEqual(Object.keys(catalog.fields).sort(),Object.keys(require('../src/spec.cjs').defaults()).sort());
 assert.equal((await f.call('inspect')).settings.extra_preserved.value,61);assert.deepEqual(fs.readFileSync(f.file),before);
});
test('profile update validates the same layout, uses CAS against UI saves, restores aliases and preserves unrelated values',async t=>{
 const f=fixture(t),read=await f.call('inspect',{scope:'profile'}),patch={eyraName:'星澜',chatLayout:{textSize:20}};
 const preview=await f.call('validate',{scope:'profile',expected_version:read.version,patch});assert.equal(preview.ok,true);assert.equal(f.profile.read().eyraName,'Eyra');
 const saved=await f.call('apply',{scope:'profile',expected_version:read.version,patch});assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.effect.status,'pending_observation');
 assert.equal(f.profile.read().name,'用户');assert.equal(f.profile.read().chatLayout.left,60);
 assert.equal((await f.call('apply',{scope:'profile',expected_version:read.version,patch})).code,'version_conflict');
 assert.throws(()=>f.profile.save({...read.settings,version:read.version,eyraName:'stale UI'}),e=>e.code==='version_conflict');
 const restored=await f.call('restore',{scope:'profile',expected_version:saved.version,recovery_id:saved.recovery_id});assert.equal(restored.ok,true,JSON.stringify(restored));assert.equal(f.profile.read().eyraName,'Eyra');
 const alias=await f.call('apply',{scope:'profile',expected_version:restored.version,patch:{roles:{matrix:{name:'E61'}}}});assert.equal(alias.ok,true,JSON.stringify(alias));assert.equal(f.profile.read().eyraName,'E61');
});
test('invalid values and active write locks do not replace configuration',async t=>{
 const f=fixture(t),read=await f.call('inspect',{scope:'profile'}),raw=fs.readFileSync(f.profile.file);
 for(const patch of [{chatLayout:{textSize:48}},{chatLayout:4},{roles:null},{eyraName:61},{chatLayout:{unknown:20}}]){const r=await f.call('apply',{scope:'profile',expected_version:read.version,patch});assert.equal(r.ok,false,JSON.stringify(patch));assert.deepEqual(fs.readFileSync(f.profile.file),raw);}
 fs.writeFileSync(f.profile.file+'.write-lock',JSON.stringify({pid:process.pid}));t.after(()=>fs.rmSync(f.profile.file+'.write-lock',{force:true}));
 const busy=await f.call('apply',{scope:'profile',expected_version:read.version,patch:{eyraName:'blocked'}});assert.equal(busy.code,'config_busy');assert.deepEqual(fs.readFileSync(f.profile.file),raw);
});
test('appearance, native zoom, runtime and external prompt use existing consumers and explicit effect timing',async t=>{
 const f=fixture(t);
 for(const [scope,patch]of [['appearance',{regions:{thinking:{size:19}},window:{width:980}}],['interface',{zoom:1.1}],['runtime',{startup_reopen:{window_seconds:120}}],['prompt',{text:'用户自定说明61'}],['runtime_prompt',{text:'用户自定清洗说明61'}]]){
  const resource=scope==='prompt'?'self':scope==='runtime_prompt'?'Matrix/记忆/上下文清洗.txt':undefined;
  const before=await f.call('inspect',{scope,resource});assert.equal(before.ok,true,JSON.stringify(before));
  const after=await f.call('apply',{scope,resource,expected_version:before.version,patch});assert.equal(after.ok,true,JSON.stringify(after));assert.equal(after.saved,true);
  const current=await f.call('inspect',{scope,resource});assert.equal(current.version,after.version);assert.notEqual(current.version,before.version);
  const restored=await f.call('restore',{scope,resource,expected_version:after.version,recovery_id:after.recovery_id});assert.equal(restored.ok,true,JSON.stringify(restored));
 }
 const diagnostic=await f.call('diagnostics');assert.equal(diagnostic.healthy,true,JSON.stringify(diagnostic));assert.equal(diagnostic.network_requests,0);assert.ok(diagnostic.revisions.length>=10);
});
test('saved settings are observed only after a renderer acknowledgement for that exact version',async t=>{
 const f=fixture(t),p=await f.call('inspect',{scope:'profile'}),observation=require('../src/settings-observation.cjs');
 assert.equal(p.application.state,'pending_observation');observation.acknowledge(f.file,'profile',p.version,61);
 assert.equal((await f.call('inspect',{scope:'profile'})).application.state,'observed');
 const changed=await f.call('apply',{scope:'profile',expected_version:p.version,patch:{eyraName:'new'}});assert.equal(changed.ok,true);
 assert.equal((await f.call('inspect',{scope:'profile'})).application.state,'pending_observation');assert.equal(observation.acknowledge(f.file,'profile',p.version,61).observed,false);
});
