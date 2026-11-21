/* @file-map:start
文件: link/agent/appcontainer-fs.cjs
位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
下游: link/agent/appcontainer-aidebug.cjs
上游: link/agent/appcontainer.py
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  pipe | function
  owner.method | handler
  nullPath | function
  fs.openSync | handler
  fs.open | handler
  fs.promises.open | handler
  local | function
  sync | function
  fs.realpath | handler
  fs.promises.realpath | handler
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// A mapped drive presents only the container directory. Windows denies volume
// enumeration to lowbox tokens, which makes libuv realpath fail. Resolve each
// component without following any junction/symlink instead of enumerating the
// host volume. The AppContainer token still enforces every filesystem access.
const fs=require('node:fs'),path=require('node:path');
const root=process.env.AIEYRA_APPCONTAINER_DRIVE;
if(process.platform==='win32'&&/^[D-Z]:\\$/i.test(root||'')){
 // AppContainer named pipes belong to its LOCAL namespace. A host-wide pipe
 // returns EADDRINUSE/EACCES even when it does not exist, which otherwise makes
 // draft locks report busy forever and prevents the OS from saving or closing.
 const net=require('node:net');
 /* @chain-region pipe | calls: value.replace, Array.isArray, pipe, Object.assign */ function pipe(value){
  if(typeof value==='string')return value.replace(/^\\\\\.\\pipe\\(?!LOCAL\\)/i,'\\\\.\\pipe\\LOCAL\\');
  if(Array.isArray(value)){
   const first=pipe(value[0]);return first===value[0]?value:Object.assign([...value],value,{0:first});
  }
  if(value&&typeof value==='object'&&typeof value.path==='string'){
   const mapped=pipe(value.path);if(mapped!==value.path)return {...value,path:mapped};
  }
  return value;
 }
 for(const [owner,method] of [[net.Server.prototype,'listen'],[net.Socket.prototype,'connect'],[net,'connect'],[net,'createConnection']]){
  const original=owner[method];/* @chain-region owner.method | calls: pipe, original.apply */ owner[method]=function(...args){if(args.length)args[0]=pipe(args[0]);return original.apply(this,args);};
 }
 const nullFile=root+'null-device';
 const /* @chain-region nullPath | calls: test */ nullPath=file=>typeof file==='string'&&/^(?:.*[\\/])?nul(?::)?$/i.test(file)?nullFile:file;
 const openSync=fs.openSync,open=fs.open,promiseOpen=fs.promises.open;
 /* @chain-region fs.openSync | calls: openSync, nullPath */ fs.openSync=(file,...args)=>openSync(nullPath(file),...args);
 /* @chain-region fs.open | calls: open, nullPath */ fs.open=(file,...args)=>open(nullPath(file),...args);
 /* @chain-region fs.promises.open | calls: promiseOpen, nullPath */ fs.promises.open=(file,...args)=>promiseOpen(nullPath(file),...args);
 const original=fs.realpathSync,asyncOriginal=fs.realpath,promiseOriginal=fs.promises.realpath;
 /* @chain-region local | calls: fileURLToPath, require, Buffer.isBuffer, file.toString, String, path.resolve, startsWith, absolute.toLowerCase … */ function local(file,options){
  const input=file instanceof URL?require('node:url').fileURLToPath(file):Buffer.isBuffer(file)?file.toString():String(file);
  const absolute=path.resolve(input);
  if(!absolute.toLowerCase().startsWith(root.toLowerCase()))return null;
  const relative=path.relative(root,absolute);let current=root;
  for(const part of relative.split(path.sep).filter(Boolean)){
   current=path.join(current,part);const stat=fs.lstatSync(current);
   if(stat.isSymbolicLink())throw Object.assign(Error('Redirected sandbox path: '+input),{code:'EPERM'});
  }
  return (options==='buffer'||options?.encoding==='buffer')?Buffer.from(absolute):absolute;
 }
 const /* @chain-region sync | calls: local, original */ sync=(file,options)=>local(file,options)??original(file,options);
 sync.native=sync;fs.realpathSync=sync;
 /* @chain-region fs.realpath | calls: local, queueMicrotask, callback, asyncOriginal */ fs.realpath=function(file,options,callback){if(typeof options==='function'){callback=options;options=undefined;}try{const value=local(file,options);if(value!==null){queueMicrotask(()=>callback(null,value));return;}}catch(error){queueMicrotask(()=>callback(error));return;}return asyncOriginal(file,options,callback);};
 fs.realpath.native=fs.realpath;
 /* @chain-region fs.promises.realpath | calls: local, promiseOriginal */ fs.promises.realpath=async(file,options)=>local(file,options)??promiseOriginal(file,options);
 require('node:module').syncBuiltinESMExports();
 require('./appcontainer-aidebug.cjs');
}
