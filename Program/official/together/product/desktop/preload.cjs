/* @file-map:start
文件: link/desktop/preload.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/login-window.cjs, link/desktop/main.cjs
链路: governance
验证: tests/test_u81_runtime.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  invoke | function
  mode | method
  office | method
  toolbar | method
  onVisibility | method
  onVisibility.listener | function
  retry | method
  state | method
  login | method
  logout | method
  refresh | method
  verify | method
  lock | method
  call | method
  source | method
  copy | method
  agentMemory | method
  pairing | method
  onboardingCopy | method
  workStatus | method
  backgrounds | method
  backgroundState | method
  personalStation | method
  localActivity | method
  officeOverlay | method
  officeMotion | method
  localEngineering | method
  localEngineeringInspect | method
  development | method
  releaseDownload | method
  cancelReleaseDownload | method
  revealReleaseDownload | method
  onReleaseDownload | method
  onReleaseDownload.listener | function
  onDevelopment | method
  onDevelopment.listener | function
  localPreviewOpen | method
  agentLocalConfirm | method
  tab | method
  window | method
  onState | method
  onState.listener | function
  command | method
  onState | method
  onState.listener | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const /* @chain-region invoke | calls: ipcRenderer.invoke */ invoke = (method, ...args) =>
  ipcRenderer.invoke('link:workspace', { method, args });
if(process.argv.includes('--together-os'))contextBridge.exposeInMainWorld('linkInOS',Object.freeze({
  /* @chain-region mode | calls: invoke */ mode:mode=>invoke('mode',mode),
  /* @chain-region office | calls: invoke */ office:action=>invoke('office-action',action),
  /* @chain-region toolbar | calls: invoke */ toolbar:height=>invoke('toolbar',height),
  /* @chain-region onVisibility | calls: ipcRenderer.on, ipcRenderer.removeListener */ onVisibility:callback=>{
    const /* @chain-region onVisibility.listener | calls: callback */ listener=(_event,value)=>callback(value.visible===true);
    ipcRenderer.on('extension:visibility',listener);
    return ()=>ipcRenderer.removeListener('extension:visibility',listener);
  },
}));
contextBridge.exposeInMainWorld('linkHost', Object.freeze({
  /* @chain-region retry | calls: ipcRenderer.invoke */ retry: () => ipcRenderer.invoke('link:retry'),
  /* @chain-region state | calls: invoke */ state: () => invoke('state'), /* @chain-region login | calls: invoke */ login: () => invoke('login'), /* @chain-region logout | calls: invoke */ logout: () => invoke('logout'),
  /* @chain-region refresh | calls: invoke */ refresh: () => invoke('refresh'), /* @chain-region verify | calls: invoke */ verify: payload => invoke('verify', payload), /* @chain-region lock | calls: invoke */ lock: () => invoke('lock'),
  /* @chain-region call | calls: invoke */ call: (route, payload) => invoke('call', route, payload), /* @chain-region source | calls: invoke */ source: revision => invoke('source', revision),
  /* @chain-region copy | calls: invoke */ copy: value => invoke('copy', value), /* @chain-region agentMemory | calls: invoke */ agentMemory: () => invoke('agent-memory'),
  /* @chain-region pairing | calls: invoke */ pairing: value => invoke('pairing', value),
  /* @chain-region onboardingCopy | calls: invoke */ onboardingCopy: value => invoke('onboarding-copy', value),
  /* @chain-region workStatus | calls: invoke */ workStatus: force => invoke('work-status',force===true),
  /* @chain-region backgrounds | calls: invoke */ backgrounds: () => invoke('backgrounds'),
  /* @chain-region backgroundState | calls: invoke */ backgroundState: options => invoke('background-state', options),
  /* @chain-region personalStation | calls: invoke */ personalStation: () => invoke('personal-station'),
  /* @chain-region localActivity | calls: invoke */ localActivity: before => invoke('local-activity',before),
  /* @chain-region officeOverlay | calls: invoke */ officeOverlay: (action,generation) => invoke('office-overlay',action,generation),
  /* @chain-region officeMotion | calls: invoke */ officeMotion: enabled => invoke('office-motion',enabled),
  /* @chain-region localEngineering | calls: invoke */ localEngineering: () => invoke('local-engineering'),
  /* @chain-region localEngineeringInspect | calls: invoke */ localEngineeringInspect: (id,offset=0) => invoke('local-engineering-inspect',id,offset),
  /* @chain-region development | calls: invoke */ development: (action='status',offset=0) => invoke('development',action,offset),
  /* @chain-region releaseDownload | calls: invoke */ releaseDownload: (id,sha) => invoke('release-download',id,sha),
  /* @chain-region cancelReleaseDownload | calls: invoke */ cancelReleaseDownload: () => invoke('release-download-cancel'),
  /* @chain-region revealReleaseDownload | calls: invoke */ revealReleaseDownload: (id,sha) => invoke('release-download-reveal',id,sha),
  /* @chain-region onReleaseDownload | calls: ipcRenderer.on, ipcRenderer.removeListener */ onReleaseDownload: callback => {
    const /* @chain-region onReleaseDownload.listener | calls: callback */ listener=(_event,value)=>callback(value);
    ipcRenderer.on('link:release-download',listener);
    return ()=>ipcRenderer.removeListener('link:release-download',listener);
  },
  /* @chain-region onDevelopment | calls: ipcRenderer.on, ipcRenderer.removeListener */ onDevelopment: callback => {const /* @chain-region onDevelopment.listener | calls: callback */ listener=(_event,value)=>callback(value);ipcRenderer.on('link:development',listener);return()=>ipcRenderer.removeListener('link:development',listener);},
  /* @chain-region localPreviewOpen | calls: invoke */ localPreviewOpen: id => invoke('local-preview-open',id),
  /* @chain-region agentLocalConfirm | calls: invoke */ agentLocalConfirm: value => invoke('agent-local-confirm', value),
  /* @chain-region tab | calls: invoke */ tab: name => invoke('tab', name), /* @chain-region window | calls: invoke */ window: action => invoke('window', action),
  /* @chain-region onState | calls: ipcRenderer.on, ipcRenderer.removeListener */ onState: callback => { const /* @chain-region onState.listener | calls: callback */ listener = (_event, state) => callback(state); ipcRenderer.on('link:state', listener); return () => ipcRenderer.removeListener('link:state', listener); },
}));
if (process.argv.includes('--aidebug-visible')) contextBridge.exposeInMainWorld('linkDebug', Object.freeze({
  /* @chain-region command | calls: ipcRenderer.invoke */ command: value => ipcRenderer.invoke('link:aidebug', value),
  /* @chain-region onState | calls: ipcRenderer.on, ipcRenderer.removeListener */ onState: callback => {const /* @chain-region onState.listener | calls: callback */ listener = (_event, state) => callback(state);ipcRenderer.on('link:aidebug-state',listener);return () => ipcRenderer.removeListener('link:aidebug-state',listener);},
}));
