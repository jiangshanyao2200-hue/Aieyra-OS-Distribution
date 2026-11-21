// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: crypto; update; remove; edit
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/agent-connections.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const crypto=require('node:crypto'),pool=require('./model-pool.cjs'),providers=require('./provider-settings.cjs');
function update(s,p,editExisting=false){
 const patch=p.patch||{},requested=p.connection_id||p.id;
 if(editExisting&&(!patch||typeof patch!=='object'||Array.isArray(patch)))throw Error('连接编辑内容无效');
 let prior=requested?s.provider_connections.find(c=>c.id===requested):s.provider_connections.find(c=>c.id===p.provider);
 if(editExisting&&(!requested||!prior))throw Error('原连接已不存在，请重新读取');
 const fields=editExisting?['name','api_key','base_url']:['name','api_key','api_key_history','request_timeout_seconds','base_url'];
 for(const k of Object.keys(patch))if(!fields.includes(k))throw Error(editExisting?'不支持的连接编辑字段':'不可修改的连接字段：'+k);
 const provider=p.provider||prior?.provider||'custom',fixed=providers.PROVIDERS.find(c=>c.id===provider);
 if(!fixed&&provider!=='custom')throw Error('未知供应商');
 if(editExisting&&Object.hasOwn(patch,'base_url')&&typeof patch.base_url!=='string')throw Error('接口地址无效');
 const base=require('./system-settings.cjs').baseURL(editExisting&&Object.hasOwn(patch,'base_url')?patch.base_url:patch.base_url||prior?.base_url||fixed?.base_url);
 const id=requested||(provider==='bailian'?pool.connectionID({base_url:base}):fixed?.id)||'connection-'+crypto.randomUUID();if(!/^[A-Za-z0-9_.-]{1,80}$/.test(id))throw Error('连接标识格式无效');
 prior||=s.provider_connections.find(c=>c.id===id);
 if(provider==='bailian')require('./bailian.cjs').assertEndpoint(base);
 else if(fixed&&base!==fixed.base_url)throw Error('官方供应商地址不能修改');
 if(!editExisting&&prior&&(prior.provider!==provider||prior.base_url!==base)&&s.api_profiles.some(m=>m.connection_id===id))throw Error('此连接已有模型；请新建连接后重新验证模型');
 if(!editExisting&&prior&&base!==prior.base_url&&!patch.api_key)throw Error('新地址需要对应密钥');
 if(editExisting&&Object.hasOwn(patch,'api_key')&&typeof patch.api_key!=='string')throw Error('新 Key 格式无效');
 const supplied=editExisting?String(patch.api_key??'').trim():'';
 if(editExisting&&supplied&&p.replace_key!==true)throw Error('请明确确认替换 Key');
 const key=editExisting&&!supplied?prior.api_key:editExisting?supplied:String(patch.api_key??prior?.api_key??'').trim();
 if(!key||key.length>4096||/[\r\n]/.test(key)||editExisting&&supplied&&/[\s\x00-\x1f]/.test(key))throw Error('请输入有效密钥');
 // A deliberate replacement cannot silently fall back to the previous credential.
 const history=editExisting?(supplied?[key]:structuredClone(prior.api_key_history||[])):patch.api_key_history||[...new Set([key,...prior?.api_key_history||[],prior?.api_key].filter(Boolean))];
 if(!Array.isArray(history)||history.length>8)throw Error('每个连接最多8把历史密钥；更多密钥请建立独立连接');
 if(editExisting&&Object.hasOwn(patch,'name')&&(typeof patch.name!=='string'||!patch.name.trim()||patch.name.trim().length>80||/[\x00-\x1f]/.test(patch.name)))throw Error('名称需为 1–80 个有效字符');
 if(editExisting&&(supplied||base!==prior.base_url||provider!==prior.provider)&&s.provider_connections.some(c=>c.id!==id&&String(c.base_url||'').replace(/\/+$/,'')===base&&(c.api_key===key||c.api_key_history?.includes(key))))throw Error('相同地址的这把 Key 已存在，请编辑原连接');
 const name=editExisting?(Object.hasOwn(patch,'name')?patch.name.trim():prior.name):String(patch.name??prior?.name??fixed?.name??'第三方').slice(0,80);
 const connection={...prior,id,name,provider,base_url:base,api_key:key,api_key_history:history,request_timeout_seconds:patch.request_timeout_seconds??prior?.request_timeout_seconds??300};
 if(editExisting){
  // Keep every model identity, selection, disabled flag and user parameter.
  // New requests resolve the same IDs against this one updated connection.
  const models=s.api_profiles.map(m=>m.connection_id===id?{...m,provider,base_url:base}:m);
  return pool.synchronize({...s,api_profiles:models,provider_connections:s.provider_connections.map(c=>c.id===id?connection:c)});
 }
 return pool.synchronize({...s,provider_connections:s.provider_connections.filter(c=>c.id!==id).concat(connection)});
}
function remove(s,p){
 const id=p.connection_id||p.id,c=s.provider_connections.find(c=>c.id===id);if(!c)throw Error('连接不存在');
 const linked=s.api_profiles.filter(m=>m.connection_id===id);
 if(linked.length)throw Error('请先移除此连接的模型池条目，再删除连接');
 return {...s,provider_connections:s.provider_connections.filter(c=>c.id!==id),user_connections:Object.fromEntries(Object.entries(s.user_connections||{}).filter(([,v])=>v!==id))};
}
function edit(s,p){return update(s,p,true);}
module.exports={update,edit,remove};
