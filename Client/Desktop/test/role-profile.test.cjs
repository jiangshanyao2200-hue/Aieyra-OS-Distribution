// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: resources; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/role-profile.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const resources=require('../src/resources.cjs'),storage=require('../../../Contracts/storage/profile.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-role-profile-')),source=resources.root(),previous=process.env.AIEYRA_RESOURCE_ROOT;
 const put=(name,text)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 for(const name of ['默认设置.json','运行参数.json','提示词索引.json','模型目录.json','模型资料.json'])put('Config/'+name,fs.readFileSync(path.join(source,'Config',name)));
 for(const name of ['Cota/提示词.txt','Vaya/提示词.txt',...['自我','工作','边界','思考方式'].map(n=>'Matrix/默认/'+n+'.txt')]){const file=resources.promptPath(name,source);put(path.relative(source,file),fs.readFileSync(file));}
 const file=put('user/Config/config.json',JSON.stringify({...require('../src/spec.cjs').defaults(),prompt_dir:path.join(dir,'user/Agents/Eyra/prompts')}));
 put('user/.aieyra-userdata.json',JSON.stringify({schema:storage.schema,id:crypto.randomBytes(16).toString('hex'),state:'ready',config:'Config/config.json'}));
 process.env.AIEYRA_RESOURCE_ROOT=dir;const release=storage.use(file);
 t.after(()=>{release();if(previous===undefined)delete process.env.AIEYRA_RESOURCE_ROOT;else process.env.AIEYRA_RESOURCE_ROOT=previous;fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,file,put,service:require('../src/role-profile.cjs').createRoleProfile(file),profile:require('../host/profile.cjs').createProfileStore(file)};
}

test('saving the displayed system default keeps its default source and creates no override',t=>{
 const f=fixture(t);
 for(const builtin of ['eyra','cota','vaya']){
  const before=f.service.call({action:'read',builtin}),layer=before.prompts[0];
  const saved=f.service.call({action:'save',builtin,profile_version:before.profile_version,prompts:[{id:layer.id,version:layer.version,text:layer.text}]});
  assert.equal(saved.prompts[0].source,'default',builtin);assert.equal(saved.prompts[0].version,layer.version,builtin);assert.equal(saved.prompts[0].text,layer.text,builtin);
 }
});

test('unrelated profile changes cannot veto a prompt-only save, while identity changes retain CAS',t=>{
 const f=fixture(t);
 for(const builtin of ['eyra','cota','vaya']){
  const before=f.service.call({action:'read',builtin}),layer=before.prompts[0],current=f.profile.read();
  f.profile.save(f.profile.merge({name:'concurrent '+builtin}),current.version);
  const saved=f.service.call({action:'save',builtin,profile_version:before.profile_version,prompts:[{id:layer.id,version:layer.version,text:'explicit saved '+builtin}]});
  assert.equal(saved.prompts[0].text.trim(),'explicit saved '+builtin);assert.equal(f.profile.read().name,'concurrent '+builtin);
  assert.throws(()=>f.service.call({action:'save',builtin,profile_version:before.profile_version,name:'stale identity'}),/已变化/);
 }
});
test('built-in model selection shares the connection bindings and stale writes cannot change prompts or identity',t=>{
 const f=fixture(t),cfg=require('../src/config.cjs'),pool=require('../src/model-pool.cjs'),spec=require('../src/spec.cjs');
 const initial=JSON.parse(fs.readFileSync(f.file));Object.assign(initial,{model_pool_version:1,api_profiles:['one','two'].map(id=>({id,name:id,model:id,enabled:true,api_base:'https://fixture.invalid/v1',api_key:'synthetic',api_protocol:'responses',parameters:pool.parameters(spec.defaults())})),matrix_profile:'one',active_profile:'one',execution_profile:'one',vision_profile:'one',collaboration_enabled:false,private_extension:{keep:true}});fs.writeFileSync(f.file,JSON.stringify(initial));
 for(const [builtin,binding]of [['cota','execution_profile'],['vaya','vision_profile'],['eyra','matrix_profile']]){
  const read=f.service.call({action:'read',builtin});assert.equal(read.model_id,'one');
  const saved=f.service.call({action:'save',builtin,profile_version:read.profile_version,model_version:read.model_version,model_id:'two'});
  assert.equal(saved.model_id,'two');const settings=cfg.load(f.file).settings;assert.equal(settings[binding],'two');assert.equal(settings.collaboration_enabled,false);assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).private_extension,{keep:true});
  const text=resources.prompt('Cota/提示词.txt'),profile=f.profile.read();
  assert.throws(()=>f.service.call({action:'save',builtin,profile_version:saved.profile_version,model_version:read.model_version,model_id:'one',name:'stale',prompts:[{id:saved.prompts[0].id,version:saved.prompts[0].version,text:'stale'}]}),/模型连接已变化/);
  assert.equal(resources.prompt('Cota/提示词.txt'),text);assert.deepEqual(f.profile.read(),profile);
 }
});
test('model persistence failure rolls back prompt and identity changes with original content intact',t=>{
 const f=fixture(t),cfg=require('../src/config.cjs'),initial=JSON.parse(fs.readFileSync(f.file));Object.assign(initial,{model_pool_version:1,api_profiles:[{id:'one',model:'one',enabled:true}],matrix_profile:'one',active_profile:'one',execution_profile:'one'});fs.writeFileSync(f.file,JSON.stringify(initial));
 const before=f.service.call({action:'read',builtin:'cota'}),original=resources.prompt('Cota/提示词.txt'),save=cfg.save;cfg.save=()=>{throw Error('injected write failure');};t.after(()=>{cfg.save=save;});
 assert.throws(()=>f.service.call({action:'save',builtin:'cota',profile_version:before.profile_version,model_version:before.model_version,model_id:'one',name:'changed',prompts:[{id:'self',text:'changed prompt',version:before.prompts[0].version}]}),/injected write failure/);
 assert.equal(resources.prompt('Cota/提示词.txt'),original);assert.equal(f.service.call({action:'read',builtin:'cota'}).name,before.name);assert.equal(JSON.parse(fs.readFileSync(f.file)).execution_profile,'one');
});
test('builtin editor shares identity and writes role-owned prompt overrides without changing packages',t=>{
 const f=fixture(t),read=f.service.call({action:'read',builtin:'cota'}),p=read.prompts[0],official=fs.readFileSync(p.path);
 const saved=f.service.call({action:'save',builtin:'cota',profile_version:read.profile_version,name:'工程师',description:'编程执行',prompts:[{id:p.id,version:p.version,text:'用户的执行提示词'}]});
 assert.equal(f.profile.read().roles.execution.name,'工程师');assert.equal(saved.description,'编程执行');
 assert.deepEqual(fs.readFileSync(p.path),official);
 assert.ok(saved.prompts[0].path.startsWith(path.join(f.dir,'user/Overrides/Agent/official/Cota/prompts')));
 assert.deepEqual(saved.prompts.map(p=>p.id),['self','work','boundary','thinking']);
 assert.equal(saved.prompts[0].text.trim(),'用户的执行提示词');
 assert.equal(saved.prompts.find(p=>p.id==='work').text,read.prompts.find(p=>p.id==='work').text);
 assert.match(resources.prompt('Cota/提示词.txt'),/用户的执行提示词\r?\n## 协定/);
 assert.deepEqual(fs.readFileSync(saved.prompts[0].path+'.backup.'+p.content_version),official);
 assert.throws(()=>f.service.call({action:'save',builtin:'cota',profile_version:read.profile_version,name:'过期写入'}),/已变化/);
 assert.equal(f.profile.read().roles.execution.name,'工程师');
 assert.throws(()=>f.service.call({action:'save',builtin:'cota',profile_version:saved.profile_version,model_id:'other'}),/模型/);
 const latest=f.service.call({action:'read',builtin:'cota'});
 assert.throws(()=>f.service.call({action:'save',builtin:'cota',profile_version:latest.profile_version,name:'不可部分保存',prompts:[{id:p.id,version:p.version,text:'过期文本'}]}),/已变化/);
 assert.equal(f.profile.read().roles.execution.name,'工程师');
});
test('Eyra editor uses the four existing private layers and synchronizes identity aliases',t=>{
 const f=fixture(t),before=f.service.call({action:'read',builtin:'eyra'});assert.equal(before.prompts.length,4);
 const boundary=before.prompts.find(p=>p.id==='boundary');
 const after=f.service.call({action:'save',builtin:'eyra',profile_version:before.profile_version,name:'母体',prompts:[{id:'work',version:before.prompts.find(p=>p.id==='work').version,text:'用户自定工作方式'}]});
 assert.equal(f.profile.read().eyraName,'母体');assert.equal(f.profile.read().roles.matrix.name,'母体');
 assert.equal(after.prompts.find(p=>p.id==='work').text,'用户自定工作方式');
 assert.deepEqual(after.prompts.find(p=>p.id==='boundary'),boundary);
});
test('legacy private runtime overrides remain readable and migrate on edit',t=>{
 const f=fixture(t);f.put('user/Overrides/Prompt/Vaya/提示词.txt','旧私人覆盖');
 const editor=require('../host/runtime-prompts.cjs').createRuntimePromptEditor(f.dir),read=editor.call({action:'read',file:'Vaya/提示词.txt'});
 assert.equal(read.text,'旧私人覆盖');
 const saved=editor.call({action:'save',file:read.file,version:read.version,text:'新私人覆盖'});
 assert.equal(saved.text,'新私人覆盖');assert.ok(saved.path.includes(path.join('Agent','official','Vaya','prompts')));
 assert.equal(fs.readFileSync(path.join(f.dir,'user/Overrides/Prompt/Vaya/提示词.txt'),'utf8'),'旧私人覆盖');
 assert.throws(()=>editor.call({action:'save',file:read.file,version:read.version,text:'迟到修改'}),/已变化/);
});

test('runtime role editor refuses redirected private override directories',t=>{
 const f=fixture(t),target=path.join(f.dir,'redirected'),link=path.join(f.dir,'user/Overrides/Agent/official/Cota');
 fs.mkdirSync(target,{recursive:true});fs.mkdirSync(path.dirname(link),{recursive:true});
 fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 const read=f.service.call({action:'read',builtin:'cota'}),p=read.prompts[0];
 assert.throws(()=>f.service.call({action:'save',builtin:'cota',profile_version:read.profile_version,prompts:[{id:p.id,version:p.version,text:'do not redirect'}]}),/链接/);
 assert.deepEqual(fs.readdirSync(target),[]);
});

for(const builtin of ['eyra','cota','vaya'])test(builtin+' failed model save restores default ownership, not just prompt text',t=>{
 const f=fixture(t),cfg=require('../src/config.cjs'),initial=JSON.parse(fs.readFileSync(f.file));
 Object.assign(initial,{model_pool_version:1,api_profiles:[{id:'one',model:'one',enabled:true}],matrix_profile:'one',active_profile:'one',execution_profile:'one',vision_profile:'one'});fs.writeFileSync(f.file,JSON.stringify(initial));
 const before=f.service.call({action:'read',builtin}),save=cfg.save;cfg.save=()=>{throw Error('injected write failure');};
 try{assert.throws(()=>f.service.call({action:'save',builtin,profile_version:before.profile_version,model_version:before.model_version,model_id:'one',prompts:before.prompts.map(p=>({id:p.id,version:p.version,text:'temporary '+p.id}))}),/injected write failure/);}finally{cfg.save=save;}
 const after=f.service.call({action:'read',builtin});
 assert.deepEqual(after.prompts,before.prompts,'failed save must leave future default updates and original ownership intact');
});

test('failed role save resumes the legacy private override without migrating it',t=>{
 const f=fixture(t),cfg=require('../src/config.cjs'),legacy=f.put('user/Overrides/Prompt/Vaya/提示词.txt','旧私人覆盖\r\n');
 const initial=JSON.parse(fs.readFileSync(f.file));Object.assign(initial,{model_pool_version:1,api_profiles:[{id:'one',model:'one',enabled:true}],matrix_profile:'one',active_profile:'one',vision_profile:'one'});fs.writeFileSync(f.file,JSON.stringify(initial));
 const before=f.service.call({action:'read',builtin:'vaya'}),save=cfg.save;cfg.save=()=>{throw Error('injected write failure');};
 try{assert.throws(()=>f.service.call({action:'save',builtin:'vaya',profile_version:before.profile_version,model_version:before.model_version,model_id:'one',prompts:[{id:'self',version:before.prompts[0].version,text:'new'}]}),/injected write failure/);}finally{cfg.save=save;}
 assert.deepEqual(f.service.call({action:'read',builtin:'vaya'}).prompts,before.prompts);assert.equal(fs.readFileSync(legacy,'utf8'),'旧私人覆盖\r\n');
});

test('transaction rollback cannot erase a later prompt edit',t=>{
 const f=fixture(t),editor=require('../host/runtime-prompts.cjs').createRuntimePromptEditor(f.dir),p=editor.call({action:'read',file:'Cota/提示词.txt'});
 const transaction=editor.saveForTransaction({action:'save',file:p.file,version:p.version,text:'transaction'});
 editor.call({action:'save',file:p.file,version:transaction.result.version,text:'later user edit'});
 assert.throws(()=>transaction.rollback(),/已变化/);assert.equal(editor.call({action:'read',file:p.file}).text,'later user edit');
 const dir=path.join(f.dir,'user/Agents/Eyra/prompts'),layers=require('../host/prompts.cjs').createPromptEditor(dir),work=layers.list().layers.find(p=>p.id==='work');
 const layerTransaction=layers.saveForTransaction({directory:dir,id:'work',version:work.version,text:'transaction'});
 layers.save({directory:dir,id:'work',version:layerTransaction.result.layer.version,text:'later work edit'});
 assert.throws(()=>layerTransaction.rollback(),/已变化/);assert.equal(layers.list().layers.find(p=>p.id==='work').text,'later work edit');
});

test('contact editor rotation shares built-in profile preferences and rejects stale saves',t=>{
 const f=fixture(t),pref={mode:'random',intervalSeconds:300,nextAt:123456,id:'',digest:''};
 for(const [builtin,target]of [['eyra','eyraAvatar'],['cota','cotaAvatar'],['vaya','vayaAvatar']]){
  const before=f.service.call({action:'read',builtin});
  const saved=f.service.call({action:'save',builtin,profile_version:before.profile_version,avatar_rotation:pref});
  assert.deepEqual(saved.avatar_rotation,pref);assert.deepEqual(f.profile.read().mediaRotation[target],pref);
  assert.throws(()=>f.service.call({action:'save',builtin,profile_version:before.profile_version,avatar_rotation:{...pref,intervalSeconds:600}}),/已变化/);
  const off=f.service.call({action:'save',builtin,profile_version:saved.profile_version,avatar_rotation:{...pref,mode:'off'}});
  assert.equal(off.avatar_rotation.mode,'off');assert.equal(off.avatar_rotation.nextAt,0);
 }
});
