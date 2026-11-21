// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; MAX; ordinary; exportAgentTemplate
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/agent-template-export.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX=2*1024*1024;
function ordinary(file){
 for(let p=path.resolve(file);;p=path.dirname(p)){
  let st;try{st=fs.lstatSync(p);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(st&&(st.isSymbolicLink()||st.isFile()&&st.nlink!==1))throw Error('导出路径不能经过链接');
  if(path.dirname(p)===p)break;
 }
}
async function exportAgentTemplate({core,dialog,parent,id}){
 const out=await core('workspace.agents',{action:'export',id});
 if(!out||typeof out.filename!=='string'||!/^[a-z0-9_.+-]+\.zip$/.test(out.filename)||out.filename.length>240||typeof out.archive!=='string'||out.archive.length>Math.ceil(MAX/3)*4)throw Error('公开模板回执无效');
 const bytes=Buffer.from(out.archive,'base64');
 if(bytes.length>MAX||bytes.toString('base64')!==out.archive||crypto.createHash('sha256').update(bytes).digest('hex')!==out.sha256)throw Error('公开模板校验失败');
 const picked=await dialog.showSaveDialog(parent,{title:'导出公开模板',defaultPath:out.filename,filters:[{name:'Agent 模板',extensions:['zip']}],properties:['showOverwriteConfirmation']});
 if(picked.canceled||!picked.filePath)return {ok:true,cancelled:true};
 const target=path.resolve(picked.filePath);ordinary(target);
 const temp=path.join(path.dirname(target),'.agent-export-'+crypto.randomUUID()+'.tmp');let handle;
 try{
  handle=await fs.promises.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  ordinary(target);await fs.promises.rename(temp,target);
 }finally{if(handle)await handle.close();await fs.promises.rm(temp,{force:true});}
 return {ok:true,package:out.package,sha256:out.sha256,filename:path.basename(target)};
}
module.exports={exportAgentTemplate};
