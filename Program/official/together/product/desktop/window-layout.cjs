/* @file-map:start
文件: link/desktop/window-layout.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/aidebug-live.cjs, link/desktop/login-window.cjs, link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  contentBounds | function
  bindContentBounds | function
  bindContentBounds.layout | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// The main OS bar is 56 CSS pixels. Native child views consume physical DIPs.
const TITLEBAR = 56;
/* @chain-region contentBounds | calls: host.getContentSize, Math.round, host.webContents.getZoomFactor, Math.max */ function contentBounds(host, titlebar = TITLEBAR) {
  const [width, height] = host.getContentSize();
  const top = Math.round(titlebar * host.webContents.getZoomFactor());
  return { x: 0, y: top, width, height: Math.max(1, height - top) };
}
/* @chain-region bindContentBounds | calls: host.on, host.webContents.on, layout */ function bindContentBounds(host, view, titlebar = TITLEBAR) {
  const /* @chain-region bindContentBounds.layout | calls: host.isDestroyed, view.setBounds, contentBounds */ layout = () => { if (!host.isDestroyed()) view.setBounds(contentBounds(host, titlebar)); };
  host.on('resize', layout);
  host.webContents.on('zoom-changed', layout);
  layout();
  return layout;
}
module.exports = { TITLEBAR, contentBounds, bindContentBounds };
