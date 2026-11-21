// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createModuleRuntime
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-runtime.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {MODULES,moduleSpec}=require('./module-catalog.cjs');
// Adapters own their views. This manager owns the common lifecycle contract.
function createModuleRuntime({adapters,showMain,hideMain,shutdown,notify=()=>{},auxiliary=()=>[],mainOpen=true}){
 let open=mainOpen,closed=false,pending=new Map(),settle=null;
 const state=()=>({ok:true,main_open:open,catalog:MODULES,modules:Object.fromEntries(MODULES.map(s=>[s.id,{...adapters[s.id].state(),starting:pending.has(s.id)}]))});
 const independent=()=>[...MODULES.filter(s=>adapters[s.id].state().detached).map(s=>s.id),...auxiliary()];
 function changed(){if(closed)return;notify(state());clearTimeout(settle);if(!open&&!independent().length&&!pending.size)settle=setTimeout(()=>{if(!closed&&!open&&!independent().length&&!pending.size)void shutdown();},250);}
 async function action({module:id,action='open',...args}){
  const spec=moduleSpec(id);if(closed)throw Error('运行时正在退出');
  if(spec.detachable===false&&['detach','close'].includes(action))throw Error('首页固定在 OS 主窗口');
  if(!['open','detach','dock','close'].includes(action))throw Error('无效模块操作');
  const prior=pending.get(id),key=JSON.stringify([action,args]);
  if(prior?.key===key){await prior.promise;return state();}
  const adapter=adapters[id];
  const work=Promise.resolve(prior?.promise).catch(()=>{}).then(async()=>{
   if(closed)throw Error('运行时正在退出');
   if(spec.detachable===false){open=true;await showMain();await adapter.open(args);}
   else if(action==='dock'){open=true;await showMain();await adapter.dock(args);}
   else if(action==='close')await adapter.close(args);
   else if(action==='detach'||!open)await adapter.detach(args);
   else await adapter.open(args);
   return state();
  });
  const entry={key,promise:work};pending.set(id,entry);changed();
  try{await work;}finally{if(pending.get(id)===entry)pending.delete(id);changed();}
  // Respond after clearing pending; a late IPC reply must not overwrite the
  // already-published detached state with starting:true.
  return state();
 }
 async function closeMain(){open=false;await hideMain();changed();return state();}
 async function reopen(){open=true;await showMain();changed();return state();}
 return {state,action,changed,independent,closeMain,reopen,get mainOpen(){return open;},close(){closed=true;clearTimeout(settle);}};
}
module.exports={createModuleRuntime};
