/* @file-map:start
文件: link/desktop/desktop-session.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/restart-session.test.cjs, link/desktop/onboarding.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/restart-session.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  DesktopSession | class
  DesktopSession.constructor | method
  DesktopSession.write | method
  DesktopSession.start | method
  DesktopSession.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const RESTART_GRACE_MS=5*60*1000;
/* @chain-region DesktopSession */ class DesktopSession{
 /* @chain-region DesktopSession.constructor | calls: Date.now, fs.statSync, JSON.parse, fs.readFileSync, Number.isFinite, crypto.randomUUID */ constructor(file){
  this.file=file;const now=Date.now();let previous;
  try{if(fs.statSync(file).size<4096)previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  const last=previous?.closed_at||previous?.seen_at;
  this.quickRestart=!!previous?.id&&Number.isFinite(last)&&now>=last&&now-last<=RESTART_GRACE_MS;
  this.id=this.quickRestart?previous.id:crypto.randomUUID();
 }
 /* @chain-region DesktopSession.write | calls: fs.mkdirSync, path.dirname, fs.writeFileSync, JSON.stringify, Date.now, fs.renameSync */ write(closed=false){
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const temporary=this.file+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify({id:this.id,seen_at:Date.now(),closed_at:closed?Date.now():null}));
  fs.renameSync(temporary,this.file);
 }
 /* @chain-region DesktopSession.start | calls: write, setInterval, timer.unref */ start(){this.write();this.timer=setInterval(()=>{try{this.write();}catch{}},15000);this.timer.unref();}
 /* @chain-region DesktopSession.close | calls: clearInterval, write */ close(){clearInterval(this.timer);this.write(true);}
}
module.exports={DesktopSession,RESTART_GRACE_MS};
