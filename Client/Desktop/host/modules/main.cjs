// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; forwardToSharedCore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/modules/main.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Compatibility entry only. All new Link windows use the same Core, package
// admission and user-data services as OS, including packages without OS.exe.
const path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process');
const {moduleEnvironment}=require('../module-dock.cjs');
function forwardToSharedCore({root=path.resolve(__dirname,'../../../..'),args=process.argv.slice(2),env=process.env,launch=spawn,exists=fs.existsSync}={}){
 if(!args.includes('--module=link'))throw Error('此兼容入口只接受 --module=link');
 const executable=path.join(root,process.platform==='win32'?'Aieyra Link.exe':'Aieyra Link');
 if(!exists(executable))throw Error('共同 Core 启动器缺失，请修复 Aieyra Link 安装');
 const forwarded=args.filter(a=>/^--(?:config|page|at)=/.test(a)&&a.length<=4096);
 const clean=moduleEnvironment(env);
 const child=launch(executable,forwarded,{cwd:root,env:clean,detached:true,stdio:'ignore',shell:false,windowsHide:false});
 child.once('error',error=>process.stderr.write('Link 启动失败：'+error.message+'\n'));child.unref();return child;
}
if(require.main===module){const exit=code=>process.versions.electron?require('electron').app.exit(code):process.exitCode=code;try{const child=forwardToSharedCore();child.once('spawn',()=>exit(0));child.once('error',()=>exit(1));}catch(error){process.stderr.write(error.message+'\n');exit(1);}}
module.exports={forwardToSharedCore};
