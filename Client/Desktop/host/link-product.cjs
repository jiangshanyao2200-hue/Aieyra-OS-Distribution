// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; regular; discoverLink; createLinkLauncher
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/link-product.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
function regular(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('OS 内置 Link 程序入口无效');
 for(let parent=path.dirname(path.resolve(file));;parent=path.dirname(parent)){
  if(fs.lstatSync(parent).isSymbolicLink())throw Error('Link 程序路径包含重定向，请修复 OS 安装');
  if(path.dirname(parent)===parent)break;
 }
 return file;
}
function discoverLink({root,platform=process.platform}={}){
 const product=path.join(root,'Link'),app=path.join(product,'app');
 const cli=path.join(app,'runtime','link',platform==='win32'?'aieyra-link.exe':'aieyra-link');
 if(fs.existsSync(cli))return {installed:true,directory:path.dirname(cli),executable:regular(cli),product,app,embedded:true,independent:false,reused:true};
 return {installed:false,embedded:true,independent:false};
}
function createLinkLauncher({navigate}={}){
 return {async open(){if(typeof navigate!=='function')throw Error('请在 Aieyra OS 中打开 Link');return navigate('link');}};
}
module.exports={discoverLink,createLinkLauncher};
