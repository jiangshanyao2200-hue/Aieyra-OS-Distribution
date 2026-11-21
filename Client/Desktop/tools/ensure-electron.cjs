// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/tools/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; directory; executable; valid; main
// Impact: python -B scripts/code-atlas.py show Client/Desktop/tools/ensure-electron.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 只使用当前锁定 Electron 的官方安装器和包内校验和。
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const directory=path.resolve(__dirname,'../node_modules/electron');
const executable=process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron';
function valid(version){
 try{return fs.existsSync(path.join(directory,'dist',executable))&&fs.readFileSync(path.join(directory,'path.txt'),'utf8').trim()===executable&&fs.readFileSync(path.join(directory,'dist/version'),'utf8').trim().replace(/^v/,'')===version;}catch{return false;}
}
function main(){
 if(!fs.existsSync(path.join(directory,'package.json')))throw Error('未找到 Electron，请先执行 npm ci');
 const version=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')).version;
 if(!valid(version)){
  const env={...process.env};delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  execFileSync(process.execPath,[path.join(directory,'install.js')],{env,stdio:'inherit',windowsHide:true});
 }
 if(!valid(version))throw Error('Electron 二进制未通过版本检查，请查看安装器错误后重新安装');
 console.log('Electron '+version+' 已就位');
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
