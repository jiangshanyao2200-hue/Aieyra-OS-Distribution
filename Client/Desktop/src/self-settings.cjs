// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; cfg; appearance; hash; object; scopes; error; mergeObject; publicValue; createSelfSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/self-settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// A discoverable facade over the existing stores. It does not own a second set
// of preferences. Recovery records are private previous values, never prompts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cfg=require('./config.cjs'),spec=require('./spec.cjs'),pool=require('./model-pool.cjs'),resources=require('./resources.cjs');
const appearance=require('./os-appearance.cjs'),{validateType}=require('./settings-runtime.cjs');
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const scopes=['config','profile','appearance','interface','runtime','prompt','runtime_prompt'];
function error(message,code='invalid_settings'){return Object.assign(Error(message),{code});}
function mergeObject(base,patch){
 if(!object(patch))throw error('patch 必须为对象');const next=structuredClone(base);
 for(const [k,v]of Object.entries(patch)){
  if(['__proto__','prototype','constructor'].includes(k)||!Object.hasOwn(base,k))throw error('未知设置字段：'+k);
  next[k]=object(base[k])&&object(v)?mergeObject(base[k],v):v;
 }
 return next;
}
function publicValue(scope,value,redact){
 if(scope==='profile'){
  const clean=structuredClone(value);
  for(const key of ['avatar','eyraAvatar','background'])if(clean[key])clean[key]={present:true,bytes:Buffer.byteLength(clean[key]),sha256:hash(clean[key])};
  for(const row of Object.values(clean.roles||{}))if(row.avatar)row.avatar={present:true,bytes:Buffer.byteLength(row.avatar),sha256:hash(row.avatar)};
  return clean;
 }
 return scope==='config'?redact(value):value;
}
function createSelfSettings({file,save,redact,onWrite=()=>{}}){
 const profile=require('../host/profile.cjs').createProfileStore(file),look=appearance.createAppearanceStore(file),runtime=require('./settings-runtime.cjs').createRuntimeStore();
 const history=require('./paths.cjs').privatePath(file,'settings_revisions');
 function effect(scope,keys){
  if(scope==='config')return {when:'next_request',status:'saved',consumer:'Core Settings at the next request boundary'};
  if(scope==='prompt'||scope==='runtime_prompt')return {when:'next_request',status:'saved',consumer:'external prompt loader'};
  if(scope==='profile'||scope==='interface')return {when:'live',status:'pending_observation',consumer:'OS and conversation renderers; file watcher ≤ 500 ms'};
  if(scope==='appearance')return {when:keys.includes('window')?'mixed':'live',status:'pending_observation',consumer:'OS appearance watcher; window dimensions on next open',next_open:keys.includes('window')?['window']:[]};
  return {when:'per_field',status:'saved',fields:Object.fromEntries(keys.map(k=>[k,runtime.fields[k]?.effect||'restart']))};
 }
 function configMerge(current,patch){
  if(!object(patch))throw error('patch 必须为对象');const defaults=spec.defaults();
  for(const [k,v]of Object.entries(patch)){
   if(!Object.hasOwn(defaults,k))throw error('未知配置字段：'+k);
   const type=Array.isArray(defaults[k])?'array':typeof defaults[k];validateType(v,{type},k);
  }
  let next={...current,...patch};
  for(const [k,v]of Object.entries(patch))if(typeof defaults[k]==='number'&&!['temperature','top_p'].includes(k)&&!Number.isSafeInteger(v))throw error(k+' 必须为整数');
  if(current.model_pool_version===1&&!patch.api_profiles&&!patch.provider_connections){
   for(const k of [...pool.PARAM_KEYS,'model','adapter','model_context_window','model_vision','base_url','api_key','api_key_history','api_protocol'])if(Object.hasOwn(patch,k)&&JSON.stringify(patch[k])!==JSON.stringify(current[k]))throw error(k+' 属于模型池或连接，请使用 model_update / connection_update','managed_model_field');
  }
  pool.validate(next);if(next.model_pool_version===1)next=pool.synchronize(next);
  const errors=spec.validate(next,{requireKey:false});if(errors.length)throw error(errors.join('\n'));
  return next;
 }
 function adapter(scope,p){
  if(scope==='config')return {read:()=>{const r=cfg.load(file);return {version:r.version,settings:r.settings};},merge:configMerge,write:(v,e)=>save(v,e)};
  if(scope==='profile')return {read:()=>{const r=profile.read();if(r.warning)throw error(r.warning,'profile_invalid');const {version,...settings}=r;return {version,settings};},restore:profile.validate,merge:(_v,patch)=>profile.merge(patch),write:(v,e)=>({ok:true,settings:profile.save(v,e),version:cfg.version(profile.file)})};
  if(scope==='appearance')return {read:()=>{const r=look.read();if(!r.ok)throw error(r.error,r.code);return r;},merge:appearance.merge,write:(v,e)=>look.update(v,e)};
  if(scope==='runtime')return {read:runtime.read,merge:runtime.merge,write:(v,e)=>runtime.update(v,e)};
  if(scope==='interface'){
   const zoom=require('./interface-zoom.cjs'),target=zoom.preferenceFile(file);
   return {read:()=>({version:cfg.version(target),settings:{zoom:zoom.readPreference(target)}}),merge:(v,patch)=>{const next=mergeObject(v,patch);validateType(next.zoom,{type:'number',minimum:zoom.MIN,maximum:zoom.MAX},'zoom');if(Math.abs(next.zoom/zoom.STEP-Math.round(next.zoom/zoom.STEP))>1e-7)throw error('zoom 的步长为 '+zoom.STEP);return next;},write:(v,e)=>{zoom.writePreference(target,v.zoom,e);return {ok:true};}};
  }
  if(scope==='prompt'){
   const dir=require('./paths.cjs').resolvePromptDir(cfg.load(file).settings.prompt_dir),editor=require('../host/prompts.cjs').createPromptEditor(dir);
   if(!cfg.PROMPT_FILES.some(x=>x.id===p.resource))throw error('resource 须为 self / work / boundary / thinking');
   return {read:()=>{const row=editor.list().layers.find(x=>x.id===p.resource);return {version:row.version,settings:{text:row.text}};},merge:(v,patch)=>{const next=mergeObject(v,patch);validateType(next.text,{type:'string',maxLength:262144},'text');return next;},write:(v,e)=>{const r=editor.save({directory:dir,id:p.resource,text:v.text,version:e});return {ok:r.ok,version:r.layer.version};}};
  }
  if(scope==='runtime_prompt'){
   const editor=require('../host/runtime-prompts.cjs').createRuntimePromptEditor(resources.root());
   return {read:()=>{const row=editor.call({action:'read',file:p.resource});return {version:row.version,settings:{text:row.text}};},merge:(v,patch)=>{const next=mergeObject(v,patch);validateType(next.text,{type:'string',maxLength:262144},'text');return next;},write:(v,e)=>editor.call({action:'save',file:p.resource,text:v.text,version:e})};
  }
  throw error('未知设置 scope：'+scope);
 }
 function schema(p){
  if(!p.scope)return {ok:true,schema_version:1,scopes:scopes.map(scope=>({scope,...effect(scope,[])})),related:[{scope:'workspace',tool:'settings',actions:['schema','inspect','validate','apply','restore'],effect:'live',recovery:'previous theme, returned recovery_id',fields:{background:'color',foreground:'color',accent:'color',surface:'color',scale:{min:.85,max:1.4},reduced_motion:'boolean'}},{scope:'terminal',actions:['appearance_read','appearance_update'],effect:'next_open'},{scope:'models',actions:['pool','model_update','model_diagnostics','connections','connection_update','response_test','response_save','connection_recovery','connection_restore']},{scope:'context',tool:'memory',actions:['sessions','new_session','clean_context'],owner:'Eyra'}]};
  let fields;
  if(p.scope==='config')fields=Object.fromEntries(Object.entries(spec.defaults()).map(([k,v])=>[k,{type:Array.isArray(v)?'array':typeof v,...(spec.FIELD_MAP[k]||{}),effect:'next_request'}]));
  else if(p.scope==='profile'){
   const current=profile.validate({});fields=Object.fromEntries(Object.entries(current).map(([k,v])=>[k,{type:typeof v,effect:'live'}]));
   fields.chatLayout={type:'object',fields:require('../ui/chat-layout-schema.mjs').default.filter(f=>!f.legacy)};fields.roles={type:'object',roles:['matrix','project','execution','subconscious'],fields:['name','avatar','ring'],rings:require('../../../Halo/official/effects.mjs').effectIDs};
   fields.eyraAvatar.format=fields.avatar.format='small PNG data URL; profile_image accepts a local image path';fields.background.format='JPEG data URL';
  }else if(p.scope==='appearance')return {ok:true,scope:p.scope,...look.read(),effect:effect(p.scope,['window'])};
  else if(p.scope==='interface')fields={zoom:{type:'number',minimum:.8,maximum:1.75,step:.05,effect:'live',note:'小窗口按实际可读尺寸限制当前缩放；保存的是偏好'}};
  else if(p.scope==='runtime')fields=runtime.fields;
  else if(p.scope==='prompt')return {ok:true,scope:p.scope,resources:cfg.PROMPT_FILES.map(x=>({id:x.id,title:x.title})),fields:{text:{type:'string',maxBytes:262144}},effect:effect(p.scope,[])};
  else if(p.scope==='runtime_prompt')return {ok:true,scope:p.scope,resources:require('../host/runtime-prompts.cjs').createRuntimePromptEditor(resources.root()).call({action:'list'}).files,fields:{text:{type:'string',maxBytes:262144}},effect:effect(p.scope,[])};
  else throw error('未知设置 scope：'+p.scope);
  const entries=Object.entries(fields).filter(([k])=>!p.query||k.toLowerCase().includes(String(p.query).toLowerCase())),offset=Math.max(0,Number(p.offset)||0),limit=Math.max(1,Math.min(100,Number(p.limit)||100));
  return {ok:true,scope:p.scope,total:entries.length,offset,fields:Object.fromEntries(entries.slice(offset,offset+limit))};
 }
 function writeRecovery(scope,p,before,keys){
  fs.mkdirSync(history,{recursive:true,mode:0o700});const id=crypto.randomUUID(),target=path.join(history,id+'.json');
  const row={schema:1,id,scope,resource:p.resource||'',at:new Date().toISOString(),before,fields:keys};
  const text=JSON.stringify(row);if(Buffer.byteLength(text)>8*1024*1024)throw error('设置恢复记录超过 8 MiB');
  fs.writeFileSync(target,text,{flag:'wx',mode:0o600});return id;
 }
 async function call(action,p={}){
  if(action==='schema')return schema(p);
  if(action==='diagnostics'){
   const checks=[];for(const scope of scopes.filter(s=>!s.includes('prompt')))try{const a=adapter(scope,p),r=a.read();a.merge(r.settings,{});checks.push({scope,ok:true,version:r.version,source:r.version==='missing'?'defaults':'stored'});}catch(e){checks.push({scope,ok:false,code:e.code||'invalid_settings',error:e.message});}
   const revisions=fs.existsSync(history)?fs.readdirSync(history).filter(n=>/^[\da-f-]{36}\.json$/.test(n)).map(n=>{try{const row=JSON.parse(fs.readFileSync(path.join(history,n),'utf8'));return {id:row.id,scope:row.scope,resource:row.resource,at:row.at,fields:row.fields};}catch(e){checks.push({scope:'recovery',id:n.slice(0,-5),ok:false,error:e.message});return null;}}).filter(Boolean).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,30):[];
   return {ok:true,checks,healthy:checks.every(c=>c.ok),revisions,network_requests:0};
  }
  const scope=p.scope||'config',a=adapter(scope,p),current=a.read();
  if(action==='inspect')return {ok:true,scope,resource:p.resource||'',version:current.version,application:require('./settings-observation.cjs').observed(file,scope,current.version),settings:publicValue(scope,current.settings,redact)};
  if(!['validate','apply','restore'].includes(action))throw error('未知自配置操作');
  if(typeof p.expected_version!=='string'||p.expected_version!==current.version)return {ok:false,code:'version_conflict',error:'设置已变化，请重新读取后修改',version:current.version};
  let patch=p.patch,restoredFrom='';
  if(action==='restore'){
   if(!/^[\da-f-]{36}$/.test(p.recovery_id||''))throw error('恢复记录标识无效');
   const target=path.join(history,p.recovery_id+'.json'),st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)throw error('恢复记录无效');
   const row=JSON.parse(fs.readFileSync(target,'utf8'));if(row.scope!==scope||row.resource!==(p.resource||''))throw error('恢复记录不属于当前设置');patch=row.before.settings;restoredFrom=row.id;
  }
  const next=restoredFrom&&a.restore?a.restore(patch):a.merge(current.settings,patch),keys=Object.keys(patch),changed=JSON.stringify(next)!==JSON.stringify(current.settings);
  const preview={ok:true,scope,resource:p.resource||'',version:current.version,changed,fields:keys,effect:effect(scope,keys)};
  if(action==='validate')return {...preview,validated:true,saved:false,settings:publicValue(scope,next,redact)};
  if(!changed)return {...preview,saved:true,effect:{...preview.effect,status:'unchanged'}};
  const recovery_id=writeRecovery(scope,p,current,keys),saved=await a.write(next,p.expected_version);
  if(saved.ok===false)return {...saved,recovery_id,saved:false};
  onWrite(cfg.mtime(file));const actual=a.read();
  return {...preview,version:actual.version,saved:true,recovery_id,...(restoredFrom?{restored_from:restoredFrom}:{}),settings:publicValue(scope,actual.settings,redact)};
 }
 return {async call(action,p){try{return await call(action,p);}catch(e){return {ok:false,code:e.code||'invalid_settings',error:e.message,saved:false};}}};
}
module.exports={createSelfSettings,mergeObject,publicValue};
