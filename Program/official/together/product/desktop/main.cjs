/* @file-map:start
文件: link/desktop/main.cjs
位置: 三环·桌面入口编排 | 组装窗口、迁移、本机服务、IPC与诊断能力。
约束: bootstrap负责最早错误记录；单实例锁先于迁移；第二次诊断启动不恢复、激活或强退已有用户实例
下游: link/desktop/aidebug-live.cjs, link/desktop/aidebug.cjs, link/desktop/cloud-client.cjs, link/desktop/cocreation.cjs, link/desktop/local-engineering.cjs, link/desktop/login-window.cjs, link/desktop/modal-aidebug.cjs, link/desktop/office-preload.cjs, link/desktop/offline.cjs, link/desktop/offline.html, link/desktop/onboarding.cjs, link/desktop/os-account.cjs, link/desktop/os-aidebug.cjs, link/desktop/portable.cjs, link/desktop/preload.cjs, link/desktop/preview-window.cjs, link/desktop/service-host.cjs, link/desktop/session-aidebug.cjs, link/desktop/startup-diagnostics.cjs, link/desktop/ui/index.html, link/desktop/visible-aidebug.cjs, link/desktop/wallpapers.cjs, link/desktop/window-layout.cjs, link/desktop/workspace-aidebug.cjs
上游: link/desktop/bootstrap.cjs
链路: startup, modal, governance
验证: AIDEBUG/live-review.cjs, AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py, link/desktop/modal-aidebug.cjs, tests/test_u81_runtime.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  startDesktop | function
  startDesktop.value | function
  startDesktop.ownerWindow | function
  startDesktop.officeReadiness | function
  startDesktop.closePreviews | function
  startDesktop.save | function
  startDesktop.external | function
  startDesktop.allowed | function
  startDesktop.clipboardPermission | function
  startDesktop.notify | function
  startDesktop.setTab | function
  startDesktop.publishOfficePresentation | function
  startDesktop.failed | function
  startDesktop.startOffice | function
  startDesktop.startOffice.onExit | method
  startDesktop.startOffice.setSize | method
  startDesktop.onProgress | method
  startDesktop.denyDownload | function
  startDesktop.activity | method
  startDesktop.completed | method
  startDesktop.cancelled | method
  startDesktop.changed | method
  startDesktop.active | function
  startDesktop.publish | function
  startDesktop.origin | method
  startDesktop.child | method
  startDesktop.diagnostics | method
  startDesktop.local | method
  startDesktop.development | method
  startDesktop.startup | method
  startDesktop.inspectOS | method
  startDesktop.origin | method
  startDesktop.accountChanged | method
  startDesktop.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const electron = require('electron');
const { app, BrowserWindow, WebContentsView, shell, session, ipcMain, safeStorage, dialog, screen, clipboard } = electron;
const { CloudClient } = require('./cloud-client.cjs');
const { createLoginWindow } = require('./login-window.cjs');
const { bindContentBounds } = require('./window-layout.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ServiceHost } = require('./service-host.cjs');
const { Onboarding } = require('./onboarding.cjs');

/* @chain-region startDesktop | calls: require, startup.phase, app.setName, app.setAppUserModelId, process.argv.slice, value, args.includes, Boolean … */ function startDesktop(embedded) {
const startup=require('./startup-diagnostics.cjs').current;
startup?.phase('configuration');

if (!embedded) {
  app.setName('Aieyra Together Link');
  app.setAppUserModelId('cn.aieyra.together.link');
}
const args = embedded ? [] : process.argv.slice(1);
const /* @chain-region startDesktop.value | calls: args.find, arg.startsWith, assigned.slice, args.indexOf */ value = key => {
  const assigned = args.find(arg => arg.startsWith(key + '='));
  if (assigned) return assigned.slice(key.length + 1);
  const i = args.indexOf(key);
  return i < 0 ? '' : args[i + 1] || '';
};
const testOutput = value('--aidebug-output');
const testProfile = value('--aidebug-profile');
const visibleTest = args.includes('--aidebug-visible');
const liveTest = args.includes('--aidebug-live');
const noActivate=args.includes('--aidebug-no-activate');
if (Boolean(testOutput) !== Boolean(testProfile) ||
    (testOutput && (!path.isAbsolute(testOutput) || !path.isAbsolute(testProfile)))) {
  throw new Error('AIDEBUG requires absolute output and isolated profile paths');
}
if (visibleTest || liveTest) {
  const relative = testOutput && path.relative(path.resolve(testOutput), path.resolve(testProfile));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(value('--aidebug-cloud')) ||
      process.env.AIEYRA_AIDEBUG_TOGETHER !== value('--aidebug-cloud') + '/together') {
    throw new Error('Visible AIDEBUG requires a profile inside its output and an explicit isolated Cloud');
  }
}
const legacyProfile=startup?.scope?.legacyProfile||path.join(app.getPath('appData'),'Aieyra Together Link');
const legacyBase=startup?.scope?.legacyBase||path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'Aieyra Together Link');
const privateBase=embedded?.privateBase||(testOutput?path.join(testProfile,'local','Aieyra Together Link'):startup?.scope?.base||path.join(app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'../..'),'Local'));
const profile=testProfile||path.join(privateBase,'profile');
// Acquire the existing installation's lock before migrating its inactive files.
// Future starts use the same lock so an older client cannot write during migration.
if (!embedded) app.setPath('userData',testProfile||legacyProfile);
let wallpapers;
const linkRoot = embedded || !app.isPackaged ? path.resolve(__dirname, '..') : path.join(process.resourcesPath, 'link');
const proposalCLI = !embedded && app.isPackaged ? path.join(path.dirname(process.execPath),'Agent','proposal.py') : path.join(linkRoot,'agent','proposal.py');
const shellURL = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const errorURL = pathToFileURL(path.join(__dirname, 'offline.html')).href;
let tabEpoch = 0, onboarding, visibleControl, diagnostics;
let window, officeView, loginWindow, cloud, development, tab = embedded ? 'office' : 'home', host, starting = false, quitting = false, stopped = false, exitCode = 0;
let mode = embedded ? 'local' : 'cloud', closing, startFlight, handlersReady = false, localReady=false, localError=false;
let localCloud='unknown',setOfficeInset;
let cloudPosition={tab:'home',generation:null};
let osAccount;
const /* @chain-region startDesktop.ownerWindow */ ownerWindow = () => embedded ? (window.host || window.owner) : window;
let homeReads = new AbortController();
let releaseDownload, releaseTransfer, savedRelease;
let officeMotion=true;
let nativeOverlay=false,nativeOverlayEpoch=0;
/* @chain-region startDesktop.officeReadiness | calls: Promise, promise.catch */ function officeReadiness() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Startup can fail before a renderer has requested its workstation.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
let officeReady = officeReadiness();
const previewWindows=new Set();
/* @chain-region startDesktop.closePreviews | calls: value.close, previewWindows.clear */ function closePreviews(){for(const value of previewWindows)value.close();previewWindows.clear();}

/* @chain-region startDesktop.save | calls: fs.mkdirSync, fs.writeFileSync, path.join, JSON.stringify */ function save(name, value) {
  if (!testOutput) return;
  fs.mkdirSync(testOutput, { recursive: true });
  fs.writeFileSync(path.join(testOutput, name), JSON.stringify(value, null, 2));
}
/* @chain-region startDesktop.external | calls: URL, shell.openExternal */ function external(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) void shell.openExternal(url);
  } catch {}
}
/* @chain-region startDesktop.allowed */ function allowed(url) {
  try { return url === errorURL || url === shellURL; }
  catch { return false; }
}
/* @chain-region startDesktop.clipboardPermission | calls: URL, contents.getURL */ function clipboardPermission(contents, permission, origin) {
  try {
    return permission === 'clipboard-sanitized-write' && contents === officeView?.webContents &&
      host?.origin && new URL(contents.getURL()).origin === host.origin &&
      (!origin || new URL(origin).origin === host.origin);
  } catch { return false; }
}
/* @chain-region startDesktop.notify | calls: development.close, closePreviews, viewer.close, window.isDestroyed, window.webContents.send, cloud.state, osAccount.status, setTab */ function notify(value) {
  if(quitting)return;
  if(development&&(value?.signedIn===false||cloud?.generation!==development.generation||value?.access&&!value.access.member)){
    development.close();development=null;
  }
  if(value?.signedIn===false||value?.access&&!value.access.member)closePreviews();
  if(value?.access?.user?.id)for(const viewer of previewWindows)if(viewer.account!==value.access.user.id)viewer.close();
  if (window && !window.isDestroyed()) window.webContents.send('link:state', { ...cloud?.state(), ...value, mode, hostAuth:osAccount?.status() });
  if (mode==='cloud' && (value?.signedIn === false || value?.access && !value.access.member && tab !== 'agents')) setTab('home');
}
/* @chain-region startDesktop.setTab | calls: officeView.setVisible, publishOfficePresentation, window.isDestroyed, window.webContents.send */ function setTab(next) {
  const entering=next==='office'&&tab!==next;
  tabEpoch++; tab = next;
  if(embedded&&mode==='cloud')cloudPosition={tab,generation:cloud.generation};
  if(next!=='office'){nativeOverlay=false;nativeOverlayEpoch++;}
  if(officeView){
    officeView.setVisible(next==='office'&&!nativeOverlay);
    publishOfficePresentation(entering);
  }
  if (window && !window.isDestroyed()) window.webContents.send('link:tab', next);
}
/* @chain-region startDesktop.publishOfficePresentation | calls: contents.isDestroyed, window.isDestroyed, officeView.getVisible, window.isVisible, window.isMinimized, contents.send */ function publishOfficePresentation(enter=false){
  const contents=officeView.webContents;
  if(contents.isDestroyed()||window.isDestroyed())return;
  const visible=officeView.getVisible()&&window.isVisible()&&!window.isMinimized();
  contents.send('link:office-presentation',{visible,motion:officeMotion,enter:visible&&enter});
}
/* @chain-region startDesktop.failed | calls: startup.error, window.isDestroyed, startup.fail, app.exit, test, toISOString, Date, path.join … */ async function failed(error) {
  if (quitting) return;
  startup?.error(error,'service-failure');
  if(!window||window.isDestroyed()){if(embedded)return;if(startup)await startup.fail(error);else app.exit(1);return;}
  const code = /^[a-z_]+$/.test(error.message) ? error.message : 'local_service_unavailable';
  const diagnostics = { code, at: new Date().toISOString(), diagnostics: host?.diagnostics || '' };
  try {
    const logs = path.join(privateBase, 'data', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, 'desktop-error.json'), JSON.stringify(diagnostics, null, 2));
  } catch {}
  if (testOutput) {
    exitCode = 1;
    save('failure.json', { ...diagnostics, testError: error.message, testStack: error.stack });
    if(window&&!window.isDestroyed())try{fs.writeFileSync(path.join(testOutput,'failure.png'),(await window.webContents.capturePage()).toPNG());}catch{}
    app.quit();
  } else if (embedded) {
    localReady=false;
    localError=true;
    officeView?.setVisible(false);
    notify({localReady,localError});
  } else if (window && !window.isDestroyed()) {
    await window.webContents.loadURL(errorURL);
    if(!embedded)noActivate?window.showInactive():window.show();
    startup?.phase('degraded');
  }
}
/* @chain-region startDesktop.startOffice | calls: notify, startup.phase, officeReadiness, onboarding.close, host.stop, ServiceHost, path.join, host.start … */ async function startOffice() {
  if (starting || quitting) return;
  starting = true;
  localReady=false;
  localError=false;
  localCloud='unknown';
  if(embedded)notify({localReady,localError,localCloud});
  startup?.phase('service-start');
  const readiness = host ? (officeReady = officeReadiness()) : officeReady;
  try {
    if (onboarding) await onboarding.close();
    if (host) await host.stop();
    host = new ServiceHost({
      linkRoot, dataRoot: path.join(privateBase, 'data'), runtimeRoot: path.join(privateBase, 'runtime'),
      nodeExecutable: process.execPath,
      legacyOffice: embedded?.legacyOffice,
      /* @chain-region startDesktop.startOffice.onExit | calls: failed, Error */ onExit: () => { if (!starting) void failed(new Error('local_service_exited')); },
    });
    const origin = await host.start();
    onboarding = new Onboarding({cloud, host, directory:path.join(privateBase,'account'),
      discovery:path.join(privateBase,'runtime','onboarding.json'), legacyDiscovery:testOutput?null:path.join(legacyBase,'runtime','onboarding.json'), safeStorage,
      python:path.join(linkRoot,'runtime','python','python.exe'),
      cli:proposalCLI,
      changed:notify,...(startup?.scope?.cloud?{proposalServer:startup.scope.cloud+'/together'}:testOutput&&process.env.AIEYRA_AIDEBUG_TOGETHER?{proposalServer:process.env.AIEYRA_AIDEBUG_TOGETHER}:{})});
    await onboarding.start();
    readiness.resolve(onboarding);
    if (quitting) return;
    if (!embedded && window.webContents.getURL() !== shellURL) await window.webContents.loadURL(shellURL);
    await officeView.webContents.loadURL(origin + '/');
    if (embedded) {
      localReady=true;
      setTab(mode==='local' ? 'office' : tab);
      notify({localReady,localError});
      return;
    }
    if (visibleTest) {
      const {startVisible} = require('./visible-aidebug.cjs');
      visibleControl = await startVisible({window,officeView,cloud,host,onboarding,output:testOutput,profile,shellURL});
      return;
    }
    startup?.phase('ready',{diagnostics:path.join(privateBase,'runtime','aidebug.json'),servicePid:host.child?.pid});
    if(liveTest){
      if(visibleTest)throw Error('Choose one AIDEBUG mode');
      const fixtureUser=Number(value('--aidebug-user'));
      if(fixtureUser){
        if(![1,2,3,100].includes(fixtureUser))throw Error('fixture_user_required');
        const flow=new URL(await cloud.beginLogin()).searchParams.get('flow');
        const response=await fetch(cloud.origin+'/aieyra/os/authorize?flow='+flow,{headers:{'x-os-auth-bridge':'fixture-auth-bridge',cookie:'session=fixture-'+fixtureUser},redirect:'manual',signal:AbortSignal.timeout(10000)});
        if(response.status!==302)throw Error('fixture_login_failed');
        const callback=new URL(response.headers.get('location'));
        await cloud.completeLogin(new URL(callback.pathname+callback.search,cloud.origin).href);
        if(args.includes('--aidebug-agent'))save('fixture-onboarding.json',await onboarding.issue());
      }
      window.showInactive();save('live-ready.json',{...diagnostics.status(),profile});return;
    }
    if (testOutput) {
      if (args.includes('--aidebug-modal')) {
        await require('./modal-aidebug.cjs').verifyModals({window,officeView,output:testOutput,diagnostics});
      } else if (value('--aidebug-session')) {
        const { verifySession } = require('./session-aidebug.cjs');
        await verifySession({ window, cloud, output: testOutput, mode: value('--aidebug-session') });
      } else if (args.includes('--aidebug-workspace')) {
        const { verifyWorkspace } = require('./workspace-aidebug.cjs');
        await verifyWorkspace({ window, officeView, cloud, host, onboarding, output: testOutput, profile, setTab });
      } else {
        setTab('office');
        const { verifyDesktop } = require('./aidebug.cjs');
        await verifyDesktop({ window: { webContents: officeView.webContents, /* @chain-region startDesktop.startOffice.setSize | calls: window.setSize */ setSize: (...size) => window.setSize(...size) }, host, output: testOutput, profile, version: app.getVersion(), fixtures: args.includes('--aidebug-fixture') });
      }
      app.quit();
    } else { noActivate?window.showInactive():window.show(); }
  } catch (error) { readiness.reject(new Error('本机 Link 启动未完成，请重试连接。')); await failed(error); }
  finally { starting = false; }
}

// A failed lock exits before scheduling a window or starting a local office.
if (!embedded && !app.requestSingleInstanceLock({ product: 'Aieyra Together Link' })) {
  startup?.phase('existing-instance');
  app.quit();
} else {
  startup?.phase('instance-locked');
  if(!embedded&&!testOutput){
    startup?.phase('migration-start',{base:privateBase});let lastProgress=0;
    const migrated=require('./portable.cjs').migrate({base:privateBase,legacyBase,legacyProfile,/* @chain-region startDesktop.onProgress | calls: Date.now, startup.phase */ onProgress:progress=>{if(Date.now()-lastProgress>=500){lastProgress=Date.now();startup?.phase('migrating',progress);}}});
    startup?.phase('migration-complete',migrated);
  }
  if(!embedded)app.setPath('userData',profile);
  startup?.point(path.join(privateBase,'runtime'));
  wallpapers=new (require('./wallpapers.cjs').WallpaperCache)({directory:path.join(privateBase,'cache','backgrounds')});
  if(!embedded)app.on('second-instance', (_event,argv) => {
    if(argv?.some(v=>v==='--aidebug-no-activate'||v.startsWith('--aidebug-startup-output=')))return;
    if (window && !window.isDestroyed() && !testOutput) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }
  });
  startFlight=app.whenReady().then(async () => {
    if(quitting)return;
    startup?.phase('electron-ready');
    const workspaceSession=embedded?.window.webContents.session || session.defaultSession;
    workspaceSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(Boolean(details.isMainFrame !== false && clipboardPermission(contents, permission, details.requestingUrl))));
    workspaceSession.setPermissionCheckHandler((contents, permission, origin) =>
      Boolean(clipboardPermission(contents, permission, origin)));
    const /* @chain-region startDesktop.denyDownload | calls: event.preventDefault */ denyDownload=event=>event.preventDefault();
    workspaceSession.on('will-download',denyDownload);
    embedded?.window.once('closed',()=>workspaceSession.removeListener('will-download',denyDownload));
    window = embedded?.window || new BrowserWindow({
      width: Math.min(1280, screen.getPrimaryDisplay().workAreaSize.width - 16), height: Math.min(720, screen.getPrimaryDisplay().workAreaSize.height - 16), minWidth: 700, minHeight: 540, frame: false,
      title: 'Aieyra 众创 Link', icon: path.join(__dirname, 'icon.ico'),
      backgroundColor: '#08090b', show: false, autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        preload: path.join(__dirname, 'preload.cjs'), offscreen: Boolean(testOutput) && !visibleTest && !liveTest, spellcheck: false,
        additionalArguments: visibleTest ? ['--aidebug-visible'] : [] },
    });
    window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => {
      if (!allowed(url)) { event.preventDefault(); external(url); }
    });
    window.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('page-title-updated', event => event.preventDefault());
    if(!embedded)window.webContents.on('render-process-gone', () => void failed(new Error('renderer_exited')));
    ipcMain.handle('link:retry', event => {
      if (quitting || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== (embedded?shellURL:errorURL)) return false;
      void startOffice(); return true;
    });
    officeView = new WebContentsView({ webPreferences: { session:workspaceSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, preload:path.join(__dirname,'office-preload.cjs'), offscreen: Boolean(testOutput) && !visibleTest && !liveTest, spellcheck: false, additionalArguments:embedded?['--together-os']:[] } });
    (embedded ? window.view : window.contentView).addChildView(officeView); officeView.setBackgroundColor('#00000000'); officeView.setVisible(false);
    if(embedded)setOfficeInset=embedded.bindOffice(officeView);
    else bindContentBounds(window, officeView, visibleTest ? 136 : 56);
    officeView.webContents.on('did-finish-load',()=>publishOfficePresentation(tab==='office'&&!nativeOverlay));
    for(const name of ['minimize','restore','show','hide'])window.on(name,()=>publishOfficePresentation());
    for(const name of ['minimize','hide'])window.on(name,()=>{
      homeReads.abort(new Error('窗口已隐藏。'));homeReads=new AbortController();
    });
    officeView.webContents.setWindowOpenHandler(({url}) => { external(url); return {action:'deny'}; });
    for (const name of ['will-navigate','will-redirect']) officeView.webContents.on(name,(event,url) => { try { if (new URL(url).origin !== host?.origin) event.preventDefault(); } catch { event.preventDefault(); } });
    officeView.webContents.on('will-attach-webview',event=>event.preventDefault());
    let cloudOrigin;
    if(startup?.scope?.cloud)cloudOrigin=startup.scope.cloud;
    if (testOutput && value('--aidebug-cloud')) {
      const fixtureURL = new URL(value('--aidebug-cloud'));
      if (fixtureURL.protocol !== 'http:' || fixtureURL.hostname !== '127.0.0.1' || fixtureURL.pathname !== '/' || fixtureURL.search || fixtureURL.hash) throw Error('invalid_fixture_origin');
      cloudOrigin = fixtureURL.origin;
    }
    cloud = new CloudClient({ directory:path.join(privateBase,'account'),safeStorage,changed:notify,ephemeral:!!embedded,
      /* @chain-region startDesktop.activity | calls: onboarding.activity */ activity:delta=>onboarding?.activity('api',delta),...(cloudOrigin?{origin:cloudOrigin}:{}) });
    if(embedded)osAccount=require('./os-account.cjs').bindOSAccount({account:embedded.account,cloud,changed:notify});
    ipcMain.handle('link:workspace', async (event, value) => {
      try {
        const isMain = !quitting && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === shellURL;
        const isLogin = loginWindow && !loginWindow.host.isDestroyed() && event.sender === loginWindow.host.webContents && event.senderFrame === loginWindow.host.webContents.mainFrame && event.senderFrame.url === loginWindow.shellURL;
        const isOffice = embedded && !quitting && host?.origin && event.sender === officeView.webContents
          && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === host.origin + '/';
        if ((!isMain && !isLogin && !isOffice) || !value || !Array.isArray(value.args) || value.args.length > 2) throw Error('请求来源无效。');
        const [first,second] = value.args; let data;
        if (isOffice && value.method === 'office-status') {
          if (!['unknown','online','offline','unavailable'].includes(first)) throw Error('连接状态无效。');
          if (localCloud !== first) {
            localCloud=first;
            window.webContents.send('link:state',{localCloud});
          }
          return {ok:true};
        }
        if (value.method === 'copy' && (isMain || (isOffice && mode==='local' && localReady && officeView.getVisible()))) {
          if (typeof first !== 'string' || first.length > 6000) throw Error('复制内容无效。');
          clipboard.writeText(first);
          return {ok:true,data:{copied:true}};
        }
        if (value.method === 'window') {
          if (!isMain && !isLogin) throw Error('请求来源无效。');
          const target = isLogin ? loginWindow.host : ownerWindow();
          if (first === 'minimize') target.minimize();
          else if (first === 'maximize') target.isMaximized()?target.unmaximize():target.maximize();
          else if (first === 'close') target.close();
          else throw Error('窗口操作无效。');
          return {ok:true};
        }
        if (!isMain) throw Error('请求来源无效。');
        if (value.method === 'state') data={...cloud.state(),mode,localReady,localError,localCloud,hostAuth:osAccount?.status(),releaseTransfer:releaseTransfer?.generation===cloud.generation?releaseTransfer:null};
        else if (value.method==='toolbar' && embedded && Number.isInteger(first) && first>=0 && first<=160)setOfficeInset?.(first);
        else if (value.method === 'office-action' && embedded) {
          if (!['connections','guide','stations','chat','tasks'].includes(first)) throw Error('工位操作无效。');
          if (mode!=='local' || !localReady || !officeView.getVisible()) throw Error('本地工位暂不可用。');
          officeView.webContents.send('link:office-action',first);
        }
        else if (value.method==='mode' && embedded) {
          if(!['local','cloud'].includes(first))throw Error('协作模式无效。');
          mode=first;
          const saved=cloudPosition;
          const access=cloud.cachedAccess();
          const sameAccount=saved.generation===cloud.generation&&cloud.state().signedIn;
          const allowed=saved.tab==='agents'||(access?.member&&(saved.tab!=='management'||access.admin));
          setTab(mode==='local'?'office':(sameAccount&&allowed?saved.tab:'home'));
          data={mode,tab,hostAuth:osAccount.status()};
          if(mode==='cloud')void osAccount.sync({refresh:true}).catch(()=>{});
        }
        else if (value.method === 'backgrounds') data=await wallpapers.catalog();
        else if (value.method === 'background-state') data=await wallpapers.state(first||{});
        else if (value.method === 'login') {
          if(osAccount)throw Error('请使用 OS 顶栏的账号入口');
          if (testOutput) throw Error('离屏验收不打开真实账号窗口。');
          if (loginWindow && !loginWindow.host.isDestroyed()) { loginWindow.host.show(); loginWindow.host.focus(); return {ok:true}; }
          const url=await cloud.beginLogin();
          loginWindow=createLoginWindow({electron,parent:ownerWindow(),url,/* @chain-region startDesktop.completed | calls: catch, cloud.completeLogin, notify */ completed:location=>cloud.completeLogin(location).catch(error=>notify({error:error.message})),/* @chain-region startDesktop.cancelled | calls: cloud.cancelLogin */ cancelled:()=>cloud.cancelLogin()});
        } else if (value.method === 'logout') {
          if(osAccount)throw Error('请从 OS 顶栏退出账号');
          data=await cloud.logout();setTab('home');
        }
        else if (value.method === 'refresh') {
          if(osAccount&&mode==='cloud')await osAccount.sync({refresh:true});
          data={...await cloud.refresh(tab==='home'?homeReads.signal:undefined),hostAuth:osAccount?.status()};
        }
        else if (value.method === 'work-status') data=await (await officeReady.promise).workStatus(first===true);
        else if (value.method === 'personal-station') data=await (await officeReady.promise).personalStation();
        else if (value.method === 'local-activity') data=await (await officeReady.promise).localActivity(first);
        else if (value.method==='office-motion'){
          if(typeof first!=='boolean')throw Error('动效设置无效。');
          officeMotion=first;publishOfficePresentation();
        }
        else if(value.method==='office-overlay'){
          if(first==='capture'){
            const generation=++nativeOverlayEpoch;
            const frame=tab==='office'?await officeView.webContents.capturePage().catch(()=>null):null;
            data={generation,image:frame?.isEmpty()===false?frame.toDataURL():null};
          }else if(first==='commit'){
            if(second===nativeOverlayEpoch&&tab==='office'){nativeOverlay=true;officeView.setVisible(false);publishOfficePresentation();}
            data={active:nativeOverlay&&tab==='office'};
          }else if(first==='restore'){
            nativeOverlayEpoch++;nativeOverlay=false;officeView.setVisible(tab==='office');publishOfficePresentation();data={active:false};
          }else throw Error('弹层操作无效。');
        }
        else if (value.method === 'local-preview-open') {
          if(!/^[a-f0-9]{32}$/.test(first||''))throw Error('预览编号无效。');
          const broker=await officeReady.promise,binding=broker.binding(),access=await broker.access();
          if(!access.member)throw Error('需要已批准的工程师资格。');
          const preview=await require('./local-engineering.cjs').preview({python:broker.python,cli:broker.cli,
            server:broker.proposalServer,account:access.user.id,directory:path.join(privateBase,'data'),id:first});
          if(binding!==broker.binding())throw Error('账号已变化，请重新读取。');
          if(previewWindows.size>=4)throw Error('请先关闭一个预览窗口。');
          const viewer=require('./preview-window.cjs').createPreviewWindow({electron,parent:ownerWindow(),preview,hidden:!!testOutput});
          viewer.account=access.user.id;
          previewWindows.add(viewer);viewer.window.once('closed',()=>previewWindows.delete(viewer));
          try{await viewer.loaded;if(binding!==broker.binding()){viewer.close();throw Error('账号已变化，请重新读取。');}}
          catch(error){viewer.close();throw error;}
          data={opened:true,id:preview.id,snapshot:preview.snapshot};
        }
        else if (value.method === 'local-engineering'||value.method === 'local-engineering-inspect') {
          if(value.method==='local-engineering-inspect'&&!/^[a-f0-9]{32}$/.test(first||''))throw Error('执行编号无效。');
          if(second!==undefined&&(!Number.isSafeInteger(second)||second<0||second>32*1024*1024))throw Error('日志位置无效。');
          const broker=await officeReady.promise,binding=broker.binding(),access=await broker.access();
          if(!access.member)throw Error('需要已批准的工程师资格。');
          data=await require('./local-engineering.cjs').dashboard({python:broker.python,cli:broker.cli,server:broker.proposalServer,
            account:access.user.id,directory:path.join(privateBase,'data'),...(value.method==='local-engineering-inspect'?{id:first,offset:second||0}: {})});
          if(binding!==broker.binding())throw Error('账号已变化，请重新读取。');
          if(testOutput&&value.method==='local-engineering')fs.writeFileSync(path.join(testOutput,'local-engineering-overview.json'),JSON.stringify(data,null,2));
        }
        else if(value.method==='development'){
          const broker=await officeReady.promise,binding=broker.binding(),access=['status','logs','stop','open-source'].includes(first)?cloud.cachedAccess()||await broker.access():await broker.access();
          if(!access.member)throw Error('需要已批准的工程师资格。');
          if(development&&(development.account!==access.user.id||development.generation!==cloud.generation)){development.close();development=null;}
          if(!development)development=new (require('./cocreation.cjs').Development)({python:broker.python,cli:broker.cli,cloud,
            account:access.user.id,server:broker.proposalServer,directory:path.join(privateBase,'data','cocreation',access.user.id),
            /* @chain-region startDesktop.changed | calls: window.isDestroyed, window.webContents.send */ changed:status=>{if(window&&!window.isDestroyed())window.webContents.send('link:development',status);}});
          if(first==='open-source'){
            const current=await development.command('status');
            if(!current.source_path)throw Error('请先下载源码。');
            const error=await shell.openPath(current.source_path);if(error)throw Error(error);data={opened:true};
          }else data=await development.command(first,second);
          if(binding!==broker.binding())throw Error('账号已变化，请重新读取。');
        }
        else if (value.method === 'verify') data=await cloud.verify(first);
        else if (value.method === 'lock') data=await cloud.lock();
        else if (value.method === 'call') {
          const signal=tab==='home'&&second===undefined?homeReads.signal:undefined;
          data=await cloud.call(first,second,{signal});
          if(second!==undefined&&onboarding)onboarding.workSnapshot=null;
          if(first==='/agents/revoke')onboarding?.invalidate(second?.id);
        }
        else if (value.method === 'onboarding-copy') {
          const broker=await officeReady.promise;
          const binding=broker.binding(),issued=await broker.copyTicket(first||{});
          if(binding!==broker.binding())throw Error('账号已变化，请重新复制。');
          clipboard.writeText(broker.instructions(issued));data={copied:true};
        }
        else if (value.method === 'pairing') data=await cloud.pairing(first);
        else if (value.method === 'agent-memory') {
          const access=cloud.cachedAccess() || (await cloud.refresh()).access;if(!access?.member)throw Error('需要已批准的开发者资格。');
          const id=access.user.id;
          if (!/^[a-f0-9]{32}$/.test(id)) throw Error('账号身份无效。');
          const file=path.join(privateBase,'data','agent-memory',id+'.json');
          try { const source=fs.readFileSync(file,'utf8');if(source.length>200000)throw Error();data=JSON.parse(source); }
          catch { data={version:1,account_id:id,events:[]}; }
          if (!Array.isArray(data.events))data.events=[];
          data={events:data.events.slice(-80).map(({at,agent_id,action,detail})=>({at,agent_id,action,detail}))};
        } else if (value.method === 'agent-local-confirm') {
          const access=cloud.cachedAccess() || (await cloud.refresh()).access;if(!access?.member)throw Error('需要已批准的开发者资格。');
          if (!/^[a-f0-9]{32}$/.test(first?.id||'') || !/^[A-Za-z0-9_.:-]{8,100}$/.test(first?.actor_id||''))throw Error('Agent 身份无效。');
          if(!host?.origin)throw Error('本机 Link 尚未启动。');
          data=await cloud.confirmLocal({id:first.id,actor_id:first.actor_id},async()=>{
            const response=await fetch(host.origin+'/api/agent-access',{redirect:'error',signal:AbortSignal.timeout(8000)});
            if(!response.ok)throw Error('本机 Agent 工位不可用。');
            const local=await response.json();
            const credential=local.credentials?.some(item=>item.actor_id===first.actor_id&&!item.revoked);
            const connected=local.sessions?.find(item=>item.actor_id===first.actor_id&&item.state==='connected'&&item.lease_until>Date.now()/1000);
            if(!credential||!connected)throw Error('该 Agent 尚未在本机 Link 工位建立有效连接。');
            return connected;
          });
          onboarding?.markConnected(first.id,first.actor_id);
        }
        else if (value.method === 'tab') {
          if (!['agents','home','repository','office','chat','management'].includes(first)) throw Error('页面不存在。');
          const epoch=++tabEpoch;
          if (embedded && mode==='local' && first==='office') {
            setTab(first);
            return {ok:true,data:{tab}};
          }
          if (first === 'agents') {
            if (!cloud.state().signedIn) throw Error('请先登录。');
          } else if (first !== 'home') {
            const access=cloud.cachedAccess() || (await cloud.refresh()).access;
            if (!access?.member || first==='management' && !access.admin) throw Error('需要已批准的开发者资格。');
            if (Date.now()-cloud.accessAt>10000) void cloud.refresh().catch(error => notify({error:{message:error.message,status:error.status,code:error.code,retryAfter:error.retryAfter}}));
          }
          if (epoch!==tabEpoch) throw Error('页面切换已取消。');
          setTab(first);data={tab};
        } else if (value.method === 'release-download-cancel') {
          releaseDownload?.abort();
          data={cancelled:true};
        } else if (value.method === 'release-download-reveal') {
          if(savedRelease?.generation!==cloud.generation||savedRelease.id!==first||savedRelease.sha!==second)throw Error('下载记录已变化。');
          shell.showItemInFolder(savedRelease.file);
          data={opened:true};
        } else if (value.method === 'release-download') {
          if(!/^[a-f0-9]{64}$/.test(first)||!/^[a-f0-9]{64}$/.test(second))throw Error('版本产物无效。');
          if(releaseDownload)throw Error('已有版本产物正在下载。');
          const controller=new AbortController(),{signal}=controller,generation=cloud.generation;
          releaseDownload=controller;
          releaseTransfer=null;
          const /* @chain-region startDesktop.active | calls: signal.throwIfAborted, Error */ active=()=>{
            signal.throwIfAborted();
            if(generation!==cloud.generation)throw Error('账号已切换。');
          };
          const /* @chain-region startDesktop.publish | calls: window.isDestroyed, window.webContents.send */ publish=state=>{
            if(generation!==cloud.generation)return;
            releaseTransfer={...releaseTransfer,id:first,sha:second,generation,...state};
            if(!window.isDestroyed())window.webContents.send('link:release-download',releaseTransfer);
          };
          let staged,ready,progressAt=0;
          try{
            publish({state:'preparing'});
            const access=cloud.cachedAccess()||(await cloud.refresh(signal)).access;
            if(!access?.member)throw Error('需要已批准的开发者资格。');
            const value=await cloud.call('/engineering/release?id='+first,undefined,{signal});
            const item=value.release?.id===first&&value.release.artifacts.find(artifact=>artifact.sha256===second);
            if(!item)throw Error('此版本未发布该产物。');
            const leaf=item.path.split('/').at(-1);
            const file=/^[\p{L}\p{N}._ -]{1,180}$/u.test(leaf)&&!/[. ]$/.test(leaf)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(leaf)?leaf:second+'.artifact';
            ready=path.join(privateBase,'data','release-downloads',access.user.id,second);
            active();
            publish({state:'downloading',name:file,received:0,total:item.bytes});
            await cloud.downloadReleasedArtifact(first,{file,size:item.bytes,sha256:second},ready,(received,total,{retrying,status})=>{
              if(!received||received===total||retrying||Date.now()-progressAt>200){
                progressAt=Date.now();
                publish({state:retrying?'retrying':received===total?'verifying':'downloading',received,total,status});
              }
            },signal);
            active();
            const directory=testOutput?path.join(testOutput,'downloads'):app.getPath('downloads');
            await fs.promises.mkdir(directory,{recursive:true});
            staged=path.join(directory,'.aieyra-'+require('node:crypto').randomUUID()+'.part');
            await fs.promises.copyFile(ready,staged,fs.constants.COPYFILE_EXCL);
            active();
            const extension=path.extname(file),stem=path.basename(file,extension);
            let target;
            for(let index=1;;index++){
              target=path.join(directory,index===1?file:stem+' ('+index+')'+extension);
              try{fs.linkSync(staged,target);break;}catch(error){if(error.code!=='EEXIST')throw error;}
            }
            savedRelease={generation,id:first,sha:second,file:target};
            data={name:path.basename(target),verified:true};
            publish({state:'saved',...data});
          }catch(error){
            if(signal.aborted){
              data={cancelled:true};publish({state:'cancelled'});
            }else{
              publish({state:'failed',message:error.message});throw error;
            }
          }finally{
            if(staged)await fs.promises.unlink(staged).catch(()=>{});
            if(ready)await fs.promises.unlink(ready).catch(()=>{});
            releaseDownload=null;
          }
        } else if (value.method === 'source') {
          const access=cloud.cachedAccess() || (await cloud.refresh()).access;
          if(!access?.member)throw Error('需要已批准的开发者资格。');
          const picked=await dialog.showSaveDialog(ownerWindow(),{title:'保存 OS 源码',defaultPath:'Aieyra-OS-source.zip',filters:[{name:'ZIP',extensions:['zip']}]});
          if(picked.canceled||!picked.filePath)return {ok:true,data:{cancelled:true}};
          const generation=cloud.generation,result=await cloud.source(first);if(generation!==cloud.generation)throw Error('账号已切换。');
          const temporary=picked.filePath+'.'+require('node:crypto').randomUUID()+'.part';
          try { fs.writeFileSync(temporary,result.bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,picked.filePath); } finally {try{fs.unlinkSync(temporary);}catch{}}
          data={saved:true,name:path.basename(picked.filePath)};
        } else throw Error('请求入口无效。');
        return {ok:true,data};
      } catch(error) {return {ok:false,error:error.message,status:error.status||0,code:error.code,retryAfter:error.retryAfter||0,outcomeUnknown:!!error.outcomeUnknown};}
    });
    handlersReady=true;
    if(embedded) {
      await startOffice();
      return;
    }
    const diagnosticHost={/* @chain-region startDesktop.origin */ get origin(){return host?.origin||'';},/* @chain-region startDesktop.child */ get child(){return host?.child;},/* @chain-region startDesktop.diagnostics */ get diagnostics(){return host?.diagnostics||'';}};
    diagnostics=await require('./aidebug-live.cjs').startLive({window,officeView,cloud,host:diagnosticHost,
      onboarding:{python:path.join(linkRoot,'runtime','python','python.exe'),cli:proposalCLI,/* @chain-region startDesktop.local | calls: Error, onboarding.local */ local(...params){if(!onboarding)throw Error('local_service_unavailable');return onboarding.local(...params);}},
      /* @chain-region startDesktop.development */ development:()=>development,/* @chain-region startDesktop.startup */ startup:()=>startup?.state||null,
      directory:testOutput?path.join(testOutput,'diagnostics'):path.join(privateBase,'diagnostics',new Date().toISOString().replace(/[:.]/g,'-')),
      runtime:path.join(privateBase,'runtime'),setTab});
    await window.loadFile(path.join(__dirname,'ui/index.html'));
    startup?.phase('shell-ready');
    if (!testOutput) noActivate?window.showInactive():window.show();
    await startOffice();
  }).catch(error => void failed(error));
  if(!embedded)app.on('window-all-closed', () => app.quit());
  if(!embedded)app.on('before-quit', event => {
    if (stopped) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    startup?.phase('stopping');
    closePreviews();
    development?.close();development=null;
    releaseDownload?.abort();
    cloud?.close(); if (loginWindow && !loginWindow.host.isDestroyed()) loginWindow.host.close();
    if (window && !window.isDestroyed()) window.hide();
    (async () => {
      await visibleControl?.close();
      await diagnostics?.close();
      await onboarding?.close();
      const result = host ? await host.stop() : { code: 0, signal: null };
      if (result.code !== 0) exitCode = 1;
      save('shutdown.json', { ...result, servicePid: host?.child?.pid,
        officeRecordRemoved: !fs.existsSync(path.join(privateBase, 'runtime', 'office.json')) });
      stopped = true;
      startup?.event('shutdown-complete',{exitCode});
      app.exit(exitCode);
    })().catch(error => { startup?.error(error,'shutdown-failed');save('shutdown-failed.json', { code: 'shutdown_unconfirmed' });stopped=true;app.exit(1); });
  });
}

return {
  ready: startFlight,
  /* @chain-region startDesktop.inspectOS | calls: window.isDestroyed, Error, inspectTogether, require */ async inspectOS(){
    await startFlight;
    if(!embedded||quitting||!window||window.isDestroyed()||!officeView)throw Error('Together 工作区尚未就绪。');
    return require('./os-aidebug.cjs').inspectTogether({
      window,officeView,shellURL,officeURL:host?.origin?host.origin+'/':'',
      mode,tab,localReady,localError,
    });
  },
  /* @chain-region startDesktop.origin */ get origin(){return host?.origin||'';},
  /* @chain-region startDesktop.accountChanged | calls: osAccount.invalidate, catch, osAccount.sync */ accountChanged(){
    osAccount?.invalidate();
    if(mode==='cloud')void osAccount?.sync().catch(()=>{});
  },
  /* @chain-region startDesktop.close | calls: ipcMain.removeHandler, homeReads.abort, releaseDownload.abort, closePreviews, development.close, osAccount.close, cloud.close, loginWindow.host.isDestroyed … */ close() {
    if(closing)return closing;
    quitting=true;
    closing=(async()=>{
      if(handlersReady){ipcMain.removeHandler('link:workspace');ipcMain.removeHandler('link:retry');}
      homeReads.abort();
      releaseDownload?.abort();
      closePreviews();
      development?.close();
      if(osAccount)osAccount.close();else cloud?.close();
      if(loginWindow&&!loginWindow.host.isDestroyed())loginWindow.host.close();
      const stop=host?.stop();
      await startFlight;
      await onboarding?.close();
      await stop;
      if(officeView&&!officeView.webContents.isDestroyed())officeView.webContents.close();
    })();
    return closing;
  },
};
}

module.exports={startDesktop};
