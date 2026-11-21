// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: invoke; listen
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = (name) => (payload) =>
  ipcRenderer.invoke('workspace:' + name, payload);
const listen = channel => callback => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld(
  'aieyra',
  Object.freeze(
    {onSessionFocus:listen('workspace:sessionFocus'),onAppsChanged:listen('workspace:appsChanged'),onBrowserChanged:listen('workspace:browserChanged'),onQuickInput:listen('workspace:quickInput'),onComposeDraft:listen('workspace:composeDraft'),onProgramSidebar:listen('workspace:programSidebar'),onBrowserReference:listen('workspace:browserReference'),pathsForFiles:files=>Array.from(files).map(file=>webUtils.getPathForFile(file)),onAttachmentDrop:listen('workspace:attachmentDrop'),onSurfaceVisibility:listen('extension:visibility'),onFoldedReady:listen('workspace:foldedReady'),onFoldedAction:listen('workspace:foldedAction'),onSelectTask:listen('workspace:selectTask'),onNavigate:listen('workspace:navigate'),onDesktopMode:listen('workspace:desktopMode'),onUpdatePrepare:listen('workspace:updatePrepare'),onUpdateResume:listen('workspace:updateResume'),onComposerPrepareClose:listen('workspace:composerPrepareClose'),onComposerCloseResume:listen('workspace:composerCloseResume'),onNotice:listen('workspace:notice'),onAccountChanged:listen('workspace:accountChanged'),onModuleState:listen('workspace:moduleState'),onExitAsk:listen('workspace:exitAsk'),onSettingsChanged:listen('workspace:settingsChanged'),onExtensionState:listen('workspace:extensionState'),workspaceOnPrepareClose:listen('workspace:workspacePrepareClose'), ...Object.fromEntries(
      [
        'bootstrap','saveComposerDraft','groupDraft','composerCloseReady','moduleState','moduleDetach','moduleAction','moduleOrder','moduleDragPreview','moduleMenu','moduleExit','pagesReady','workspaceShift','foldedSurface','sessionModel','sessionModelMenu','conversation','conversationAttachment','conversationOpen','conversationMenu',
        'context','runtimePrompts','builtinRole','apps','appsMenu','tip','chatLayerPreference',
        'extensionOpen','extensionDetach','extensionDock','extensionState','extensionCatalog','extensionSurface','extensionContext',
        'openHome','openEyra','collapseEyra','desktopMode','deskPreview','programProjection','openLinkApp',
        'linkDeviceCode',
        'updateReady',
        'updateAcknowledge',
        'account',
        'remoteLink',
        'feedback',
        'profile',
        'settingsObserved',
        'appearance','halo',
        'saveProfile',
        'chooseAvatar',
        'chooseBackground','themeLibrary',
        'chooseAttachments',
        'copyText',
        'stageAttachmentPaths',
        'stageAttachmentBytes',
        'stageFileBytes',
        'imageLibrary',
        'attachmentMedia',
        'attachmentReferences',
        'greet',
        'document',
        'diary',
        'documentState',
        'notice',
        'snapshot',
        'messages',
        'history',
        'receipt',
        'terminals',
        'terminalRead',
        'toolImage',
        'artifact',
        'terminalInput',
        'terminalResize',
        'systemNoticeSurface','browserReference','browserStatus',
        'browserSurface',
        'browserUser',
        'humanReply',
        'askReply',
        'withdraw',
        'send',
        'sendReceipt',
        'retryChat',
        'cancel',
        'prompts',
        'savePrompt',
        'restorePrompt',
        'restoreAllPrompts',
        'undoPrompt',
        'onboard',
        'selfcheck',
        'sessions',
        'openSession',
        'pickProject',
        'activity',
        'acknowledge',
        'control',
        'controlStatus',
        'controlSurface',
        'linkStatus',
        'reload',
        'openLink',
        'minimizeWindow',
        'toggleMaximize',
        'closeWindow',
      ].map((name) => [name, invoke(name)]),
    ),onRemoteLinkChanged:listen('workspace:remoteLinkChanged'),onLinkRequest:listen('workspace:linkRequest')},
  ),
);
