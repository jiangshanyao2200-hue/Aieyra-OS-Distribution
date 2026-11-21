// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createThemeAssets
// Impact: python -B scripts/code-atlas.py show Theme/runtime/assets.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// The adapter supplies only admitted immutable package bytes. This resource
// server owns no filesystem access, renderer IPC, execution or network grants.
const {validateTheme}=require('../contract/definition.mjs');
function createThemeAssets({resolve,readPackage,current}){
 let closed=false,cache=null,generation=0;
 const same=(selected,id,digest)=>selected?.id===id&&selected.digest===digest;
 async function serve(request){
  try{
   if(closed)return new Response('',{status:410});
   const url=new URL(request.url),match=/^\/([a-z][a-z0-9_.-]{1,127})\/([a-f0-9]{64})\/([a-z][a-z0-9-]{0,47})$/.exec(url.pathname);
   if(url.protocol!=='aieyra-theme:'||url.host!=='assets'||url.username||url.password||url.search||url.hash||request.method!=='GET'||!match)return new Response('',{status:400});
   const [,id,digest,name]=match,epoch=generation;
   if(!same(current(),id,digest))return new Response('',{status:410});
   const item=await resolve(id);
   if(closed||epoch!==generation||!same(current(),id,digest)||item?.digest!==digest||item.manifest?.kind!=='theme'||!item.enabled)return new Response('',{status:410});
   if(cache?.digest!==digest||cache.id!==id){
    const files=readPackage(item),definition=validateTheme(JSON.parse(files[item.manifest.entrypoints.theme]));
    const assets=new Map();let total=0;
    for(const [key,a]of Object.entries(definition.assets||{})){
     const bytes=files[a.path];total+=bytes?.length||0;
     if(!bytes?.length||bytes.length>8*1024*1024||total>24*1024*1024)throw Error('Theme asset missing or exceeds byte budget');
     assets.set(key,{mime:a.mime,bytes});
    }
    cache={id,digest,assets};
   }
   const asset=cache.assets.get(name);if(!asset)return new Response('',{status:404});
   return new Response(asset.bytes,{headers:{'content-type':asset.mime,'content-length':String(asset.bytes.length),'cache-control':'no-store','access-control-allow-origin':'*','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
  }catch{return new Response('',{status:404});}
 }
 return {serve,invalidate(){cache=null;generation++;},close(){closed=true;cache=null;generation++;}};
}
module.exports={createThemeAssets};
