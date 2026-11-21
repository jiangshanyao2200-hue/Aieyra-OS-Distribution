// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createModuleDragPreview
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-drag-preview.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {moduleSpec}=require('./module-catalog.cjs');
// Native views occlude DOM ghosts. This noninteractive owned window keeps the
// marker visible above pages and outside the main window without taking focus.
function createModuleDragPreview({electron,win,offscreen=false}){
 let preview=null,current=null,ready=false,closed=false,timer=null;
 const icons={"browser": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><ellipse cx=\"12\" cy=\"12\" rx=\"4\" ry=\"9\"/><path d=\"M3 12h18M5 6.5h14M5 17.5h14\"/></svg>", "settings": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z\"/></svg>", "link": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m9 15 6-6M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2\"/></svg>", "contacts": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"9.5\" cy=\"8.5\" r=\"3.2\"/><path d=\"M3.8 19.2a5.7 5.7 0 0 1 11.4 0\"/><path d=\"M15.6 5.6a3 3 0 0 1 0 5.8M17.6 13.9a5.7 5.7 0 0 1 2.9 5.3\"/></svg>"};
 const labels={browser:'浏览器',contacts:'联系人',settings:'设置',link:'Link'};
 function end(){clearTimeout(timer);timer=null;current=null;ready=false;const old=preview;preview=null;if(old&&!old.isDestroyed())old.destroy();}
 function paint(){if(!preview||preview.isDestroyed()||!current)return;preview.setPosition(Math.round(current.x+14),Math.round(current.y+16),false);if(ready&&!offscreen&&!preview.isVisible())preview.showInactive();}
 function call(p={}){
  if(closed)return {ok:false};
  if(p.action==='end'){if(current?.id===p.id)end();return {ok:true};}
  if(!['begin','move'].includes(p.action)||!Number.isSafeInteger(p.id)||!['x','y'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<100000))throw Error('拖动坐标无效');
  if(p.action==='begin'){
   if(moduleSpec(p.module).detachable===false)throw Error('首页不可拖出');end();current={...p};
   preview=new electron.BrowserWindow({parent:win,width:150,height:66,frame:false,transparent:true,hasShadow:false,focusable:false,skipTaskbar:true,resizable:false,movable:false,show:false,backgroundColor:'#00000000',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen}});
   preview.setIgnoreMouseEvents(true);const target=preview;
   const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent;color:#eef1f7;font:13px 'Segoe UI',sans-serif}div{margin:6px;padding:10px 14px;border:1px solid #d9e6ff70;border-radius:22px;background:#202735ef;box-shadow:0 4px 10px #0004;display:flex;align-items:center;gap:10px}svg{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(-4px 2px 0 #cfdbed25)}</style><div>${icons[p.module]}${labels[p.module]}</div>`;
   target.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   void target.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).then(()=>{if(preview===target){ready=true;paint();}}).catch(()=>{if(preview===target)end();});
  }else{if(current?.id!==p.id)return {ok:false};Object.assign(current,p);}
  clearTimeout(timer);timer=setTimeout(end,30000);timer.unref?.();paint();return {ok:true};
 }
 for(const name of ['blur','hide','minimize','closed'])win.on(name,end);
 return {call,close(){closed=true;end();for(const name of ['blur','hide','minimize','closed'])win.removeListener(name,end);}};
}
module.exports={createModuleDragPreview};
