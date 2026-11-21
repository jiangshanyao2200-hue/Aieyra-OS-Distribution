// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createFileDropRouter
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/file-drop-router.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Only registered native surfaces may relay file drops into the main draft.
function createFileDropRouter({ipcMain,send}){
 const targets=new Map();
 ipcMain.handle('workspace:dropFiles',(event,p={})=>{
  try{
   const allowed=targets.get(event.sender);
   if(!allowed||event.senderFrame!==event.sender.mainFrame||!allowed(event.senderFrame.url))throw Error('此页面不能添加附件');
   const paths=p.paths||[],files=p.files||[];
   if(!Array.isArray(paths)||!Array.isArray(files)||!paths.length&&!files.length||paths.length+files.length>10||paths.some(x=>typeof x!=='string'||x.length>32768))throw Error('每次最多拖入 10 个文件');
   let total=0;
   for(const f of files){if(!f||typeof f.name!=='string'||f.name.length>255||!(f.bytes instanceof Uint8Array)||f.bytes.byteLength>32*1024*1024)throw Error('文件内容无效或超过 32 MiB');total+=f.bytes.byteLength;}
   if(total>64*1024*1024)throw Error('附件合计最多 64 MiB');
   send({paths,files});return {ok:true};
  }catch(e){return {ok:false,error:e.message};}
 });
 return {register(wc,allowed){targets.set(wc,allowed);wc.once('destroyed',()=>targets.delete(wc));},close(){targets.clear();ipcMain.removeHandler('workspace:dropFiles');}};
}
module.exports={createFileDropRouter};
