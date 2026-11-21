/* @file-map:start
文件: link/desktop/aidebug-screen.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/aidebug-live.cjs
链路: observation
验证: AIDEBUG/control.test.cjs, AIDEBUG/observe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  sampleDesktop | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {nativeImage}=require('electron');

/* @chain-region sampleDesktop | calls: window.isVisible, window.isMinimized, Error, window.getNativeWindowHandle, toString, handle.readBigUInt64LE, String, handle.readUInt32LE … */ async function sampleDesktop({window,python,script,directory,duration=0,action}){
 if(process.platform!=='win32'||!window.isVisible()||window.isMinimized())throw Error('visible_windows_client_required');
 const handle=window.getNativeWindowHandle(),hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
 const child=spawn(python,['-X','utf8','-B',script,'--window',hwnd,'--output',directory,'--duration',String(duration)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='',stdout='',readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.includes('\n')){try{readyResolve(JSON.parse(stdout.split('\n')[0]));}catch(error){readyReject(error);}}});
 child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-4000));
 const exited=new Promise((resolve,reject)=>{child.once('error',error=>{readyReject(error);reject(error);});child.once('exit',code=>{if(code!==0){const error=Error('desktop_capture_failed: '+stderr);readyReject(error);reject(error);}else resolve();});});
 let actionError;
 try{await ready;if(action)try{await action();}catch(error){actionError=error;}}finally{await exited;}
 const result=JSON.parse(fs.readFileSync(path.join(directory,'samples.json'),'utf8'));
 const frames=result.frames.map(frame=>{
  if(!/^\d{3}\.bgra$/.test(frame.file))throw Error('invalid_desktop_frame');
  const file=path.join(directory,frame.file),pixels=fs.readFileSync(file);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  const image=nativeImage.createFromBitmap(pixels,{width:result.width,height:result.height,scaleFactor:1});fs.unlinkSync(file);
  return {at:frame.at,image,visibility:{visibleSamples:frame.visible_samples,totalSamples:frame.total_samples,insideScreen:result.inside_screen,compositionSync:result.composition_sync}};
 });
 if(actionError)throw actionError;
 return frames;
}
module.exports={sampleDesktop};
