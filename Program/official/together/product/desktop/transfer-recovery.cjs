/* @file-map:start
文件: link/desktop/transfer-recovery.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/cloud-client.cjs, link/desktop/cocreation.cjs, link/desktop/development-download.cjs, link/desktop/official-tools.cjs
链路: source-transfer
验证: AIDEBUG/development-download.test.cjs, AIDEBUG/transfer-recovery.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  watchStall | function
  watchStall.arm | function
  watchStall.touch | method
  watchStall.close | method
  recover | function
  backoff | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Inactivity replaces a connection, never the download task. Active slow streams have no deadline.
/* @chain-region watchStall | calls: Date.now, arm */ function watchStall(controller,initialMs=60000){
 let timer,last=Date.now(),gap=0;
 const /* @chain-region watchStall.arm | calls: clearTimeout, setTimeout, controller.abort, Math.max */ arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),Math.max(initialMs,gap*6));};
 arm();return {/* @chain-region watchStall.touch | calls: Date.now, Math.max, arm */ touch(){const now=Date.now();gap=Math.max(now-last,gap*.8);last=now;arm();},/* @chain-region watchStall.close | calls: clearTimeout */ close(){clearTimeout(timer);}};
}
/* @chain-region recover | calls: active, sleep, Date.now, Promise, setTimeout, Math.min */ async function recover(ms,active,sleep){
 active();if(sleep){await sleep(ms);active();return;}
 const end=Date.now()+ms;
 while(Date.now()<end){await new Promise(resolve=>setTimeout(resolve,Math.min(250,end-Date.now())));active();}
}
const /* @chain-region backoff | calls: Math.max, Math.min, Number */ backoff=(failures,retryAfter=0)=>Math.max(Math.min(30000,1000*2**Math.min(5,Math.max(0,failures-1))),Math.min(3600000,Math.max(0,Number(retryAfter)||0)*1000));
module.exports={watchStall,recover,backoff};
