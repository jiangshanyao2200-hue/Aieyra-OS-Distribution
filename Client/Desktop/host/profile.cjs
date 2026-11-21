// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; cfg; identityPalette; createProfileStore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/profile.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cfg=require('../src/config.cjs'),layoutFields=require('../ui/chat-layout-schema.mjs').default;
const identityPalette=()=>require('../src/resources.cjs').read('运行参数.json').identity_palette;

// 用户主动保存的独立资料，不修改模型配置。头像仅接受已重编码的小PNG。
function createProfileStore(config) {
  const file = path.join(path.dirname(config), 'companion-profile.json');
  function read() {
    try {
      if (fs.statSync(file).size > 4000000) throw Error('profile size');
      return {...validate(JSON.parse(fs.readFileSync(file, 'utf8'))),version:cfg.version(file)};
    } catch (e) {
      // 新安装用推荐资料（用户名 User、排版与随机轮换）；图片由轮换从内置或官方图库填充。
      if (e.code === 'ENOENT') return {...validate({ ...require('../../../Theme/official/default/profile.json').profile, initialized: false }),version:'missing'};
      // 可选资料损坏不能阻断连接；不自动补写，也不弹出首次设置覆盖原文件。
      return { ...validate({ initialized: true }),version:cfg.version(file), warning: '个人资料暂时无法读取，原文件已保留。可在设置中重新保存。' };
    }
  }
  function validate(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('个人资料格式不正确');
    const name = String(p.name || '').trim(), avatar = String(p.avatar || ''), eyraName=String(p.eyraName||'').trim(), eyraAvatar=String(p.eyraAvatar||''), background=String(p.background||'');
    const userRingColor=p.userRingColor||identityPalette()[0].color;
    if(!identityPalette().some(row=>row.color===userRingColor))throw Error('请选择预设光圈颜色');
    for(const value of [name,eyraName])if ([...value].length > 40 || /[\x00-\x1f\x7f]/.test(value)) throw Error('名字最多40个字符，不能包含控制字符');
    for(const value of [avatar,eyraAvatar])if (value && (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value) || value.length > 180000 || Buffer.from(value.split(',')[1], 'base64').subarray(0,8).toString('hex') !== '89504e470d0a1a0a')) throw Error('请选择有效的小尺寸头像');
    if(background){
      if(background.length>2800000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(background))throw Error('请选择有效的背景图片');
      const bytes=Buffer.from(background.split(',')[1],'base64');
      if(bytes.subarray(0,3).toString('hex')!=='ffd8ff'||bytes.subarray(-2).toString('hex')!=='ffd9')throw Error('背景图片格式不正确');
    }
    const backgroundBlur = p.backgroundBlur ?? 0, backgroundOpacity = p.backgroundOpacity ?? 0,chatBlur=p.chatBlur??12,chatOpacity=p.chatOpacity??.18;
    if (!Number.isFinite(backgroundBlur) || backgroundBlur < 0 || backgroundBlur > 32) throw Error('背景模糊请设为 0 到 32');
    if (!Number.isFinite(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 1) throw Error('背景遮罩请设为 0% 到 100%');
    if(!Number.isFinite(chatBlur)||chatBlur<0||chatBlur>32)throw Error('聊天模糊请设为 0 到 32');
    if(!Number.isFinite(chatOpacity)||chatOpacity<0||chatOpacity>1)throw Error('聊天遮罩请设为 0% 到 100%');
    // 聊天排版（个人设置）：只收已知形状的数值，范围由界面 chat-layout.mjs 夹取。
    const chatLayout = {};
    if (p.chatLayout != null) {
      if (typeof p.chatLayout !== 'object' || Array.isArray(p.chatLayout)) throw Error('聊天排版格式不正确');
      for (const [key, value] of Object.entries(p.chatLayout).slice(0, 24))
        if (/^[A-Za-z]{1,24}$/.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 4000) chatLayout[key] = value;
    }
    const roles={};
    if(p.roles!=null){
      if(typeof p.roles!=='object'||Array.isArray(p.roles))throw Error('角色资料格式不正确');
      for(const role of ['matrix','project','execution','subconscious']){
        const row=p.roles[role];if(row==null)continue;
        if(typeof row!=='object'||Array.isArray(row))throw Error('角色资料格式不正确');
        const roleName=String(row.name||'').trim(),roleAvatar=String(row.avatar||''),ring=String(row.ring||'pulse');
        if([...roleName].length>40||/[\x00-\x1f\x7f]/.test(roleName))throw Error('角色名字最多40个字符');
        if(roleAvatar&&(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(roleAvatar)||roleAvatar.length>180000||Buffer.from(roleAvatar.split(',')[1],'base64').subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))throw Error('请选择有效的角色头像');
        if(!require('../../../Halo/official/effects.mjs').effectIDs.includes(ring))throw Error('角色光圈样式无效');
        const description=String(row.description||'').trim();
        if([...description].length>1000)throw Error('角色简介最多1000个字符');
        roles[role]={name:roleName,avatar:roleAvatar,ring,...(description?{description}:{})};
      }
    }
    const mediaRotation=p.mediaRotation===undefined?{}:{mediaRotation:require('../../../Theme/runtime/media-preferences.cjs').preferences(p.mediaRotation)};
    return { name, avatar, eyraName, eyraAvatar, userRingColor, roles,background, backgroundBlur, backgroundOpacity,chatBlur,chatOpacity, chatLayout,...mediaRotation, initialized: p.initialized === true };
  }
  function validatePatch(p){
    if(!p||typeof p!=='object'||Array.isArray(p))throw Error('个人资料修改须为对象');
    const allowed=[...Object.keys(validate({})),'mediaRotation'];
    for(const key of Object.keys(p))if(!allowed.includes(key))throw Error('未知个人资料字段：'+key);
    for(const key of ['chatLayout','roles'])if(Object.hasOwn(p,key)&&(!p[key]||typeof p[key]!=='object'||Array.isArray(p[key])))throw Error(key+' 必须为对象');
    if(p.chatLayout)for(const [key,value]of Object.entries(p.chatLayout)){
      const field=layoutFields.find(f=>f.key===key&&!f.legacy);
      if(!field)throw Error('不可修改的排版字段：'+key);
      if(!Number.isFinite(value)||value<field.min||value>field.max)throw Error(key+' 必须在 '+field.min+'–'+field.max+' 之间');
      if(field.step&&field.step<1&&Math.abs(value/field.step-Math.round(value/field.step))>1e-7)throw Error(key+' 的步长为 '+field.step);
    }
    for(const key of ['name','eyraName','avatar','eyraAvatar','background','userRingColor'])if(Object.hasOwn(p,key)&&typeof p[key]!=='string')throw Error(key+' 必须为文本');
    if(Object.hasOwn(p,'initialized')&&typeof p.initialized!=='boolean')throw Error('initialized 必须为开关');
    if(p.roles)for(const [role,row]of Object.entries(p.roles)){
      if(!['matrix','project','execution','subconscious'].includes(role)||!row||typeof row!=='object'||Array.isArray(row))throw Error('角色资料无效');
      for(const [key,value]of Object.entries(row))if(!['name','avatar','ring','description'].includes(key)||typeof value!=='string')throw Error('角色字段无效：'+key);
    }
    return p;
  }
  function save(p,expected=p.version,{initialize=true}={}) {
    const value = validate({ ...p, initialized: initialize || p.initialized === true });
    return cfg.withWriteLock(file,expected,()=>{
      const temp = file + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
      finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
      return {...value,version:cfg.version(file)};
    });
  }
  function merge(p){
    validatePatch(p);const current=read();if(current.warning)throw Error(current.warning);
    const roles=structuredClone(current.roles);
    for(const [role,row]of Object.entries(p.roles||{}))roles[role]={...roles[role],...row};
    const aliases={};
    for(const [key,target]of [['name','eyraName'],['avatar','eyraAvatar']])if(Object.hasOwn(p.roles?.matrix||{},key)){
      if(Object.hasOwn(p,target)&&p[target]!==p.roles.matrix[key])throw Error('Eyra 身份字段不一致：'+target);
      aliases[target]=p.roles.matrix[key];
    }
    const media=require('../../../Theme/runtime/media-preferences.cjs'),mediaRotation={...current.mediaRotation,...p.mediaRotation};
    for(const target of media.TARGETS){
      const role=media.ROLE_TARGETS[target],edited=role?Object.hasOwn(p.roles?.[role]||{},'avatar'):Object.hasOwn(p,target)||Object.hasOwn(aliases,target);
      if(edited&&!Object.hasOwn(p.mediaRotation||{},target)&&current.mediaRotation?.[target]?.mode==='random')mediaRotation[target]={...mediaRotation[target],mode:'custom',nextAt:0,id:'',digest:''};
    }
    return validate({...current,...p,...aliases,...(Object.keys(mediaRotation).length?{mediaRotation}:{}),chatLayout:{...current.chatLayout,...p.chatLayout},roles});
  }
  return {file,read,save,validate,validatePatch,merge,initializeMedia(p,expected){if(expected!=='missing'||read().version!=='missing')throw Error('初始资料已变化');return save(merge(p),expected,{initialize:false});},update(p,expected){if(typeof expected!=='string'||!expected)throw Error('请先读取个人资料版本');return save(merge(p),expected);}};
}
module.exports = { createProfileStore,identityPalette };
