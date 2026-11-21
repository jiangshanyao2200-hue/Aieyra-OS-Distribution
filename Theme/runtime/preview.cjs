// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; createThemePreviews
// Impact: python -B scripts/code-atlas.py show Theme/runtime/preview.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Only host-admitted immutable bytes enter a preview. A capability expires and
// is revoked on close, replacement, crash or owner destruction. No saved state.
const crypto=require('node:crypto');
const {validateTheme}=require('../contract/definition.mjs');
function createThemePreviews({load,now=()=>Date.now(),lifetime=300000}){
 const owners=new Map(),leases=new Map();let closed=false;
 function release(owner,previewId){
  const row=owners.get(owner);if(!row||previewId!==undefined&&row.id!==previewId)return;
  owners.delete(owner);if(row.token)leases.delete(row.token);clearTimeout(row.timer);
  owner.removeListener('destroyed',row.stop);owner.removeListener('render-process-gone',row.stop);
 }
 async function open(owner,request){
  if(closed||!owner||owner.isDestroyed?.()||typeof owner.once!=='function')throw Error('预览窗口已关闭');
  release(owner);
  if(owners.size>=4)throw Error('同时最多打开四个主题预览');
  const row={id:request.preview_id,expires:now()+lifetime,stop:()=>release(owner)};owners.set(owner,row);owner.once('destroyed',row.stop);owner.once('render-process-gone',row.stop);
  row.timer=setTimeout(row.stop,lifetime);row.timer.unref?.();
  try{
   const {id,digest,version,name,definition,files}=await load(request);
   if(closed||owners.get(owner)!==row||owner.isDestroyed?.()||now()>=row.expires)throw Error('预览已取消');
   validateTheme(definition);
   if(!/^[a-z][a-z0-9_.-]{1,127}$/.test(id)||!/^[a-f0-9]{64}$/.test(digest))throw Error('预览身份不完整');
   const assets=new Map();let bytes=0;
   for(const [key,asset]of Object.entries(definition.assets||{})){
    const data=files[asset.path];bytes+=data?.length||0;
    if(!data?.length||data.length>8*1024*1024||bytes>24*1024*1024)throw Error('预览资源超出限制');
    assets.set(key,{mime:asset.mime,data:Buffer.from(data)});
   }
   row.token=crypto.randomBytes(32).toString('hex');row.assets=assets;leases.set(row.token,row);
   return {ok:true,name,expires_at:row.expires,selection:{id,digest,version,definition:structuredClone(definition),preview_token:row.token}};
  }catch(error){if(owners.get(owner)===row)release(owner);throw error;}
 }
 function serve(request){
  try{
   const u=new URL(request.url),match=/^\/([a-f0-9]{64})\/([a-z][a-z0-9-]{0,47})$/.exec(u.pathname);
   if(request.method!=='GET'||!match||request.url!=='aieyra-theme://preview/'+match[1]+'/'+match[2])return new Response('',{status:400});
   const row=leases.get(match[1]);if(closed||!row||now()>=row.expires){if(row)row.stop();return new Response('',{status:410});}
   const asset=row.assets.get(match[2]);if(!asset)return new Response('',{status:404});
   return new Response(asset.data,{headers:{'content-type':asset.mime,'content-length':String(asset.data.length),'cache-control':'no-store','access-control-allow-origin':'*','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
  }catch{return new Response('',{status:400});}
 }
 return {open,release,serve,close(){closed=true;for(const owner of [...owners.keys()])release(owner);}};
}
module.exports={createThemePreviews};
