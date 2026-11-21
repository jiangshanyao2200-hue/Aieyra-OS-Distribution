/* @file-map:start
文件: link/desktop/preview-window.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/preview-window.test.cjs, link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/preview-window.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  previewURL | function
  createPreviewWindow | function
  createPreviewWindow.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const crypto=require('node:crypto');

/* @chain-region previewURL | calls: URL, Number, test, Error */ function previewURL(value){
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||Number(url.port)<1||Number(url.port)>65535||url.username||url.password||url.search||url.hash||!/^\/[a-f0-9]{48}\/$/.test(url.pathname))throw Error('本地预览地址无效。');
 return url;
}

/* @chain-region createPreviewWindow | calls: includes, Error, previewURL, crypto.randomUUID, electron.session.fromPartition, sandbox.setPermissionRequestHandler, callback, sandbox.setPermissionCheckHandler … */ function createPreviewWindow({electron,parent,preview,hidden=false}){
 if(!['running','waiting_resources','waiting_workspace','blocked'].includes(preview.state))throw Error('本地预览已停止，请通过 Agent 重新启动。');
 const url=previewURL(preview.url);
 const partition='link-preview-'+crypto.randomUUID();
 const sandbox=electron.session.fromPartition(partition,{cache:false});
 sandbox.setPermissionRequestHandler((contents,permission,callback)=>callback(false));
 sandbox.setPermissionCheckHandler(()=>false);
 sandbox.on('will-download',event=>event.preventDefault());
 sandbox.webRequest.onBeforeRequest((details,callback)=>{
  try{const target=new URL(details.url);callback({cancel:target.origin!==url.origin&&target.protocol!=='data:'&&target.protocol!=='blob:'});}
  catch{callback({cancel:true});}
 });
 const window=new electron.BrowserWindow({parent,width:1000,height:720,minWidth:420,minHeight:320,show:false,
  title:'本地网页预览',backgroundColor:'#17191e',webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false}});
 window.setMenuBarVisibility(false);
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 for(const event of ['will-navigate','will-redirect'])window.webContents.on(event,(e,value)=>{try{if(new URL(value).origin!==url.origin)e.preventDefault();}catch{e.preventDefault();}});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 if(!hidden)window.once('ready-to-show',()=>window.showInactive());
 const loaded=window.loadURL(url.href);
 return {window,loaded,/* @chain-region createPreviewWindow.close | calls: window.isDestroyed, window.close */ close:()=>{if(!window.isDestroyed())window.close();}};
}
module.exports={previewURL,createPreviewWindow};
