// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// preload：渲染层唯一能碰到的系统能力白名单。
//
// 渲染层没有 Node 权限，也不直接读写文件。所有落盘与网络请求
// 都经过这里转发给主进程，参数在两侧都做校验。

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aieyra', {
  /** 启动数据：字段规范、当前配置、提示词状态、官方限制值。 */
  bootstrap: () => ipcRenderer.invoke('config:bootstrap'),

  /** 保存配置。返回 { ok, settings, prompt, errors, warnings }。 */
  save: (settings, expected_version) => ipcRenderer.invoke('config:save', { settings, expected_version }),
  draftState:(settings,baseline)=>ipcRenderer.invoke('config:draft-state',{settings,baseline}),
  confirmDiscard:language=>ipcRenderer.invoke('win:confirm-discard',language),
  closeWindow:()=>ipcRenderer.invoke('win:close-confirmed'),
  onCloseRequested:cb=>{const h=()=>cb();ipcRenderer.on('win:request-close',h);return()=>ipcRenderer.removeListener('win:request-close',h);},
  providerAction:(action,settings,id)=>ipcRenderer.invoke(({select:'provider:select',discover:'provider:discover',choose:'provider:choose',add:'provider:add',filter:'provider:filter'})[action],{settings,id}),
  poolAction:(action,settings,id)=>ipcRenderer.invoke(({select:'pool:select',toggle:'pool:toggle',remove:'pool:remove',test:'pool:test'})[action],{settings,id}),
  draftProfile: (settings,id) => ipcRenderer.invoke('config:draft-profile',{settings,id}),

  /** 实时校验，不落盘。 */
  validate: (settings) => ipcRenderer.invoke('config:validate', settings),

  /** 请求体预览：界面上「会发什么」那一块。 */
  preview: (settings) => ipcRenderer.invoke('config:preview', settings),

  /** 测试连接。 */
  ping: (settings) => ipcRenderer.invoke('api:ping', settings),

  /** 列出模型。 */
  listModels: (settings) => ipcRenderer.invoke('api:models', settings),

  /** 重新读取提示词各层。 */
  reloadPrompt: (dir) => ipcRenderer.invoke('prompt:reload', dir),



  /** 恢复出厂设置。 */
  reset: (current) => ipcRenderer.invoke('config:reset', current),

  /** 窗口控制（无边框窗口的自定义标题栏用）。 */
  win: (action) => ipcRenderer.invoke('win:action', action),

  /** 外部改动通知：主程序或别的工具改了 config.json。 */
  onExternalChange: (cb) => {
    const h = () => cb();
    ipcRenderer.on('config:changed-externally', h);
    return () => ipcRenderer.removeListener('config:changed-externally', h);
  },
});
