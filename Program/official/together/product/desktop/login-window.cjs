/* @file-map:start
文件: link/desktop/login-window.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/cloud-client.cjs, link/desktop/preload.cjs, link/desktop/ui/login.cjs, link/desktop/ui/login.html, link/desktop/window-layout.cjs
上游: link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  createLoginWindow | function
  createLoginWindow.navigate | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ACCOUNT, ORIGIN } = require('./cloud-client.cjs');
const { bindContentBounds } = require('./window-layout.cjs');

// Same OS architecture: local titlebar + an unprivileged remote content view.
/* @chain-region createLoginWindow | calls: session.fromPartition, partition.setPermissionRequestHandler, callback, partition.setPermissionCheckHandler, partition.on, event.preventDefault, BrowserWindow, path.join … */ function createLoginWindow({ electron, parent, url, completed, cancelled }) {
  const { BrowserWindow, WebContentsView, session } = electron;
  const partition = session.fromPartition('persist:together-newapi');
  partition.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  if (!partition.__togetherDownloadsBlocked) { partition.on('will-download', event => event.preventDefault()); partition.__togetherDownloadsBlocked = true; }
  const host = new BrowserWindow({ parent, width: 520, height: 720, minWidth: 380, minHeight: 480, frame: false, show: false,
    icon: path.join(__dirname, 'icon.ico'), backgroundColor: '#0b0d12', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const view = new WebContentsView({ webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  host.contentView.addChildView(view);
  bindContentBounds(host, view);
  const shellURL = pathToFileURL(path.join(__dirname, 'ui/login.html')).href;
  host.webContents.on('will-navigate', event => event.preventDefault());
  host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let done = false;
  const /* @chain-region createLoginWindow.navigate | calls: URL, event.preventDefault, finally, completed, host.isDestroyed, host.close */ navigate = (event, target) => {
    try {
      const next = new URL(target);
      if (next.origin === ORIGIN && next.pathname === '/auth/desktop-callback') {
        event.preventDefault();
        if (!done) { done = true; completed(next.href).finally(() => { if (!host.isDestroyed()) host.close(); }); }
        return;
      }
      if (next.origin !== ACCOUNT || next.username || next.password) event.preventDefault();
    } catch { event.preventDefault(); }
  };
  view.webContents.on('will-navigate', navigate); view.webContents.on('will-redirect', navigate);
  view.webContents.on('will-attach-webview', event => event.preventDefault());
  host.on('closed', () => { if (!view.webContents.isDestroyed()) view.webContents.close(); if (!done) cancelled(); });
  void host.loadFile(path.join(__dirname, 'ui/login.html')).then(() => view.webContents.loadURL(url)).then(() => host.show()).catch(() => { if (!host.isDestroyed()) host.close(); });
  return { host, shellURL };
}
module.exports = { createLoginWindow };
