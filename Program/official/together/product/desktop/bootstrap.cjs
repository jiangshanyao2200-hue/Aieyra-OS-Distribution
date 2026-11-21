/* @file-map:start
文件: link/desktop/bootstrap.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/main.cjs, link/desktop/startup-diagnostics.cjs
上游: 入口/动态加载；参阅链路与目录地图
链路: startup
验证: AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Keep this entry small: application/module-load and pre-window failures must
// reach the same persistent startup journal as later runtime failures.
let diagnostics;
try{
 diagnostics=require('./startup-diagnostics.cjs');
 const startup=diagnostics.start();
 startup.phase('loading-application');require('./main.cjs').startDesktop();
}catch(error){
 if(diagnostics?.current)void diagnostics.current.fail(error);
 else{
  // Last resort if the diagnostics module itself could not load.
  const fs=require('original-fs'),path=require('node:path'),os=require('node:os');
  const requested=process.argv.find(v=>v.startsWith('--aidebug-startup-output='))?.split('=').slice(1).join('=');
  const directory=requested&&path.isAbsolute(requested)?requested:path.join(os.tmpdir(),'Aieyra Together Link','startup','emergency-'+process.pid);
  try{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'startup.json'),JSON.stringify({state:'failed',phase:'diagnostics-bootstrap',pid:process.pid,exit_code:1,error:{message:error.message,stack:error.stack}}));}catch{}
  require('electron').app.exit(1);
 }
}
