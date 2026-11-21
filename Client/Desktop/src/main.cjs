// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: path; styledDialog; cfg; paths; parseConfigArg; explicitConfig; configFile; interfaceLanguage; showError; knownMtime; win; watcher; confirmedClose; quitting; gotSingleInstance; createWindow; startWatcher; service
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/main.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Electron 主进程。
//
// 职责边界：窗口与 IPC。真正的配置语义在 spec.cjs / config.cjs，
// 主进程只把它们暴露给渲染层，不自己做业务判断。
//
// 安全基线：contextIsolation 开启、nodeIntegration 关闭，
// 渲染层只能通过 preload 暴露的白名单方法访问系统能力。

'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const styledDialog=require('./styled-dialog.cjs');

const cfg = require('./config.cjs');
const paths = require('./paths.cjs');

/** 命令行 --config <path> 覆盖配置文件位置。 */
function parseConfigArg(argv) {
  const i = argv.indexOf('--config');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const prefixed = argv.find((a) => a.startsWith('--config='));
  if (prefixed) return prefixed.slice('--config='.length);
  return '';
}

const explicitConfig = parseConfigArg(process.argv);

/** 当前生效的配置文件路径（首次加载后固定，避免保存到别处）。 */
let configFile = paths.resolveConfigPath(explicitConfig);
require('../../../Contracts/storage/profile.cjs').use(configFile);
app.setPath('userData',paths.privatePath(configFile,'desktop_profile'));
function interfaceLanguage(){try{return cfg.load(configFile).settings.language==='en-US'?'en-US':'zh-CN';}catch{return 'zh-CN';}}
function showError(zh,en,message){const language=interfaceLanguage();return styledDialog.show(null,{title:language==='en-US'?en:zh,message,language,buttons:[language==='en-US'?'OK':'知道了']});}

/** 外部变更轮询的已知时间戳。 */
let knownMtime = cfg.mtime(configFile);

let win = null;
let watcher = null;
const confirmedClose = new WeakSet();

/** 正在退出：用于区分「应用自己要关」和「渲染进程崩了」。 */
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
});

/**
 * 单实例锁。
 *
 * Aieyra Config.exe 每点一次就拉起一个 Electron 进程；没有这道锁，点几次就会
 * 堆出几个配置窗口。第二个实例直接退出，改为把已有窗口提到前台。
 */
if (process.platform === 'win32') app.setAppUserModelId('cn.aieyra.config');

const gotSingleInstance = app.requestSingleInstanceLock();
if (!gotSingleInstance) app.quit();

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    show: false,
    frame: false,
    backgroundColor: '#05070d',
    title: interfaceLanguage()==='en-US'?'Aieyra · Settings':'Aieyra · 设置',
    icon: path.join(__dirname, '..', 'assets', 'config.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需要 require 本地模块
      spellcheck: false,
    },
  });

  require('./interface-zoom.cjs').forConfig(configFile).attach(win,{minimum:[480,360]});
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // 无边框窗口没有系统关闭按钮，所以「界面挂了」的后果特别严重：
  // 用户会面对一个既点不动也关不掉的窗口。这里保证渲染层出问题时
  // 给出原生提示并退出，绝不留下死窗口。
  win.webContents.on('did-fail-load', async (_e, code, desc) => {
    if (quitting) return;
    quitting = true;
    confirmedClose.add(win);
    await showError('界面加载失败','Interface failed to load',`${desc} (${code})`);
    app.quit();
  });
  win.webContents.on('render-process-gone', async (_e, details) => {
    if (quitting || details.reason === 'clean-exit') return;
    quitting = true;
    confirmedClose.add(win);
    await showError('界面进程已退出','Interface stopped',details.reason);
    app.quit();
  });

  // 外链一律交给系统浏览器，不在应用内开新窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 顶层导航守卫：只防弹窗不够，location 跳转会把远程内容载入特权窗口
  //（携带 IPC 桥 + 任意 base_url 发 Key = Key 外带，见 S3/G5）。一律拦截。
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('closed', () => {
    win = null;
  });
  win.on('close', event => {
    if(confirmedClose.has(win)||win.webContents.isCrashed())return;
    event.preventDefault();
    win.webContents.send('win:request-close');
  });
}

/**
 * 轮询配置文件时间戳，检测外部改动。
 *
 * 这是「反向热重载」：主程序是 TUI，可能有人直接手改 config.json，
 * 或者用别的工具改了。GUI 若不跟着更新，用户会看到过期数据并在保存时
 * 把别人的改动覆盖掉——这类数据丢失最难发现。
 *
 * 与主程序一样用轮询而不是 fs.watch：跨平台一致，且配置改动是低频事件。
 */
function startWatcher() {
  if (watcher) clearInterval(watcher);
  watcher = setInterval(() => {
    const now = cfg.mtime(configFile);
    if (now !== 0 && now !== knownMtime) {
      knownMtime = now;
      if (win && !win.isDestroyed()) {
        win.webContents.send('config:changed-externally');
      }
    }
  }, 2000);
}

// —— IPC ——

const service = require('./service.cjs').createService(configFile, stamp => {knownMtime=stamp;});
app.on('will-quit',()=>service.close());
ipcMain.handle('win:close-confirmed', event => {
  const parent=BrowserWindow.fromWebContents(event.sender);if(!parent)return false;
  confirmedClose.add(parent);parent.close();return true;
});
ipcMain.handle('win:confirm-discard', async (event, language) => {
  const parent=BrowserWindow.fromWebContents(event.sender);if(!parent)return false;
  const en=language==='en-US';
  const result=await styledDialog.show(parent,{title:en?'Unsaved changes':'未保存的修改',message:en?'You have unsaved changes. Leave and discard them?':'有未保存的修改，确认离开吗？',buttons:en?['Keep editing','Discard and leave']:['继续编辑','放弃修改并离开'],defaultId:0,cancelId:0,language});
  return result.response===1;
});
for (const method of service.methods) {
  ipcMain.handle(method, (_event, payload) => service.call(method, payload));
}

/**
 * 无边框窗口的自定义标题栏：最小化 / 最大化 / 关闭。
 *
 * 这一条不能少。窗口是 frame:false 的、没有系统标题栏，所以界面上的 ✕
 * 是用户唯一看得见的关闭方式；处理器一旦缺失，按钮全部静默失效，
 * 用户就会面对一个既点不动也关不掉的窗口。
 *
 * 用 fromWebContents 而不是模块级的 win：多窗口时后者可能指向别的窗口。
 */
ipcMain.handle('win:action', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return false;
  switch (action) {
    case 'minimize':
      w.minimize();
      return true;
    case 'maximize':
      if (w.isMaximized()) w.unmaximize();
      else w.maximize();
      return true;
    case 'close':
      w.close();
      return true;
    default:
      return false;
  }
});



/** 启动时若配置文件损坏，给出可读提示而不是白屏。 */
app.on('ready', async () => {
  if (!gotSingleInstance) return;
  try {
    cfg.load(configFile);
  } catch (err) {
    await showError('配置文件无法解析','Configuration could not be read',`${err.message}\n\n${configFile}`);
  }
  createWindow();
  startWatcher();
});

app.on('window-all-closed', () => {
  if (watcher) clearInterval(watcher);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
