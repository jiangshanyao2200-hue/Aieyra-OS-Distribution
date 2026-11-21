/* @file-map:start
文件: link/desktop/os-aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/aidebug-layout.cjs
上游: link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  inspectView | function
  inspectTogether | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';

const {setTimeout:delay}=require('node:timers/promises');
const {layoutProbe}=require('./aidebug-layout.cjs');

// The host only requests a fixed measurement of the two Together views.
const measureLayout=`(() => {
  const report=(${layoutProbe.toString()})({
    selector:document.querySelector('dialog[open]')?undefined:'body',
  });
  const {viewport,palette,issues,controls,alignments,dialogs}=report;
  return {
    viewport,palette,dialogs:dialogs.slice(0,16),
    issues:issues.slice(0,80).map(({text,...issue})=>issue),
    controls:controls.slice(0,80).map(({label,...control})=>control),
    alignments:alignments.slice(0,80),
  };
})()`;

/* @chain-region inspectView | calls: Boolean, contents.isDestroyed, contents.isCrashed, contents.isLoading, contents.getURL, view.getBounds, contents.getZoomFactor, Promise.race … */ async function inspectView(name,view,url,visible){
  const contents=view.webContents;
  const ready=Boolean(url)&&!contents.isDestroyed()&&!contents.isCrashed()
    &&!contents.isLoading()&&contents.getURL()===url;
  const result={name,visible,ready,bounds:view.getBounds()};
  if(!visible||!ready)return result;
  result.zoom=contents.getZoomFactor();
  try{
    const layout=await Promise.race([
      contents.executeJavaScript(measureLayout),
      delay(4500,null,{ref:false}),
    ]);
    if(!layout)result.error='layout_timeout';
    else if(contents.isDestroyed()||contents.getURL()!==url)result.error='view_changed';
    else result.layout=layout;
  }catch{
    result.error='layout_unavailable';
  }
  return result;
}

/* @chain-region inspectTogether | calls: window.isVisible, owner.isVisible, owner.isMinimized, Promise.all, inspectView, officeView.getVisible */ async function inspectTogether({window,officeView,shellURL,officeURL,mode,tab,localReady,localError}){
  const owner=window.host||window.owner;
  const visible=window.isVisible()&&owner.isVisible()&&!owner.isMinimized();
  const shell=window.view;
  const views=await Promise.all([
    inspectView('shell',shell,shellURL,visible),
    inspectView('office',officeView,officeURL,visible&&officeView.getVisible()),
  ]);
  return {protocol:'aieyra-together-aidebug/1',mode,tab,serviceReady:localReady,serviceError:localError,views};
}

module.exports={inspectTogether};
