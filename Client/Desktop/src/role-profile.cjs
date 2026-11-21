// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cfg; MEDIA_TARGETS; ROLES; createRoleProfile
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/role-profile.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Both settings and contacts use the existing role prompt/profile stores and
// the same model bindings as model connections. No contact-owned copy exists.
const cfg=require('./config.cjs'),resources=require('./resources.cjs');
const {promptSections,joinPromptSections,editPromptSection}=require('../ui/prompt-sections.mjs');
const MEDIA_TARGETS={eyra:'eyraAvatar',cota:'cotaAvatar',vaya:'vayaAvatar'};
const ROLES={eyra:{role:'matrix',name:'Eyra',ring:'pulse',model:'matrix_profile'},cota:{role:'execution',name:'Cota',ring:'pulse',file:'Cota/提示词.txt',model:'execution_profile'},vaya:{role:'project',name:'Vaya',ring:'pulse',file:'Vaya/提示词.txt',model:'vision_profile'}};
function createRoleProfile(config){
 const profile=require('../host/profile.cjs').createProfileStore(config);
 function editors(builtin){
  const role=ROLES[builtin];if(!role)throw Error('未知内置主体');
  if(role.file){
   const editor=require('../host/runtime-prompts.cjs').createRuntimePromptEditor(resources.root());
   const read=()=>editor.call({action:'read',file:role.file});
   return {rows(){const p=read(),official=require('node:path').join(resources.root(),resources.promptIndex(resources.root()).lookup(role.file).path);return promptSections(p.text).map(row=>({...p,exists:true,source:p.path===official?'default':'custom',id:row.id,title:row.title,text:row.text}));},
    commit(changes,written){if(!changes.length)return;const p=read(),rows=promptSections(p.text);
     for(const change of changes){if(change.version!==p.version)throw Error('提示词已变化，请重新读取');editPromptSection(rows.find(r=>r.id===change.id),change.text);}
     const saved=editor.saveForTransaction({action:'save',file:role.file,text:joinPromptSections(rows),version:p.version});
     written.push({title:role.name+'提示词',restore:saved.rollback});
    }};
  }
  const dir=require('./paths.cjs').resolvePromptDir(cfg.load(config).settings.prompt_dir),editor=require('../host/prompts.cjs').createPromptEditor(dir);
  return {rows:()=>editor.list().layers,commit(changes,written){for(const p of changes){const before=editor.list().layers.find(r=>r.id===p.id),saved=editor.saveForTransaction({directory:dir,id:p.id,text:p.text,version:p.version});if(saved.result.ok===false)throw Error(saved.result.error||'提示词保存失败');written.push({title:before.title,restore:saved.rollback});}}};
 }
 function read(builtin){
  const def=ROLES[builtin];if(!def)throw Error('未知内置主体');
  const current=profile.read();if(current.warning)throw Error(current.warning);
  const loaded=cfg.load(config),settings=require('./model-pool.cjs').migrate(loaded.settings);
  const row=current.roles[def.role]||{},name=builtin==='eyra'?current.eyraName:row.name;
  return {ok:true,builtin,role:def.role,profile_version:current.version,model_version:loaded.version,model_id:settings[def.model]||settings.matrix_profile||settings.active_profile||'',model_binding:settings[def.model]||'',name:name&&name!==({cota:'Nova',vaya:'莹'})[builtin]?name:def.name,avatar:builtin==='eyra'?current.eyraAvatar:row.avatar||'',avatar_rotation:current.mediaRotation?.[MEDIA_TARGETS[builtin]]||null,ring:row.ring||def.ring,description:row.description||'',prompt_directory:def.file?null:require('./paths.cjs').resolvePromptDir(loaded.settings.prompt_dir),prompts:editors(builtin).rows()};
 }
 return {call(p={}){
  if(p.builtin==='user'){
   const current=profile.read();if(current.warning)throw Error(current.warning);
   if(p.action==='read')return {ok:true,builtin:'user',name:current.name||'我',avatar:current.avatar,avatar_rotation:current.mediaRotation?.avatar,user_ring_color:current.userRingColor,palette:resources.read('运行参数.json').identity_palette,profile_version:current.version,prompts:[]};
   if(p.action!=='save'||Object.keys(p).some(k=>!['action','builtin','profile_version','avatar','avatar_rotation','user_ring_color'].includes(k)))throw Error('用户头像资料操作无效');
   const patch={};
   if(Object.hasOwn(p,'avatar'))patch.avatar=p.avatar;
   if(Object.hasOwn(p,'user_ring_color'))patch.userRingColor=p.user_ring_color;
   if(Object.hasOwn(p,'avatar_rotation'))patch.mediaRotation={avatar:require('../../../Theme/runtime/media-preferences.cjs').selection(p.avatar_rotation)};
   if(Object.keys(patch).length)profile.update(patch,p.profile_version);
   return {ok:true};
  }
  if(!Object.hasOwn(ROLES,p.builtin))throw Error('未知内置主体');
  if(p.action==='read')return read(p.builtin);
  if(p.action!=='save'||Object.keys(p).some(k=>!['action','builtin','profile_version','name','ring','avatar','avatar_rotation','description','prompts','model_id','model_version'].includes(k)))throw Error('角色资料操作无效');
  const def=ROLES[p.builtin],before=profile.read(),editor=editors(p.builtin),rows=editor.rows(),changes=p.prompts||[],ids=new Set();
  // Prompt CAS belongs to its prompt file. Background/appearance/media saves
  // must not veto an otherwise valid prompt-only commit.
  const editsProfile=['name','ring','avatar','description','avatar_rotation'].some(key=>Object.hasOwn(p,key));
  if(before.warning||editsProfile&&before.version!==p.profile_version)throw Error('角色资料已变化，请重新读取后保存');
  if(!Array.isArray(changes)||changes.length>4)throw Error('提示词修改无效');
  for(const change of changes){const old=rows.find(r=>r.id===change.id);if(!old||ids.has(change.id)||old.version!==change.version||typeof change.text!=='string'||Buffer.byteLength(change.text)>262144)throw Error('提示词已变化或内容无效，请重新读取');ids.add(change.id);}
  let modelSettings=null;
  if(Object.hasOwn(p,'model_id')){
   const loaded=cfg.load(config);if(typeof p.model_version!=='string'||loaded.version!==p.model_version)throw Error('模型连接已变化，请重新读取后保存');
   modelSettings=require('./model-setup.cjs').setRoles(require('./model-pool.cjs').migrate(loaded.settings),{[def.model]:p.model_id});
  }
  const patch={};for(const key of ['name','ring','avatar','description'])if(Object.hasOwn(p,key))patch[key]=p[key];
  const mediaPatch=Object.hasOwn(p,'avatar_rotation')?{mediaRotation:{[MEDIA_TARGETS[p.builtin]]:require('../../../Theme/runtime/media-preferences.cjs').selection(p.avatar_rotation)}}:{};
  const next=profile.merge({roles:{[def.role]:patch},...mediaPatch}),written=[];let saved;
  try{
   if(Object.keys(patch).length||Object.keys(mediaPatch).length)saved=profile.save(next,before.version);
   editor.commit(changes,written);
   if(modelSettings){const result=cfg.save(config,modelSettings,p.model_version);if(result?.ok===false)throw Error(result.errors?.join('；')||result.error||'模型连接已变化');}
  }catch(error){
   const failed=[];for(const row of written.reverse())try{const result=row.restore();if(result?.ok===false)throw Error(result.error||'恢复失败');}catch{failed.push(row.title);}
   if(saved)try{profile.save(before,saved.version);}catch{failed.push('角色资料');}
   if(failed.length)throw Error(error.message+'；部分恢复未完成，原备份保留：'+failed.join('、'));
   throw error;
  }
  return read(p.builtin);
 }};
}
module.exports={createRoleProfile};
