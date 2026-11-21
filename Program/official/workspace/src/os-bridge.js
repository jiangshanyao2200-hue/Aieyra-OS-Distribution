// The original renderer API is transported through the authenticated OS Program bridge.
import {createCanvasHealth} from './canvas-health.js';
const bridge = window.aieyraApp;
const reportError=(stage,error)=>{
    void bridge.invoke({scope:'workspace',channel:'aieyra:canvas:diagnostic',payload:{stage,error:{name:error?.name,code:error?.code,stack:String(error?.stack||'').slice(0,24000)}}}).catch(()=>{});
};
const onError=event=>reportError('error',event.error);
const onRejection=event=>reportError('rejection',event.reason);
const onWorkspaceError=event=>reportError(event.detail?.stage,event.detail?.error);
window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onRejection);window.addEventListener('workspace-error',onWorkspaceError);
window.addEventListener('pagehide',()=>{window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);window.removeEventListener('workspace-error',onWorkspaceError);},{once:true});
const sendMetric=(stage,metrics)=>{void bridge.invoke({scope:'workspace',channel:'aieyra:canvas:diagnostic',payload:{stage,metrics}}).catch(()=>{});};
const health=createCanvasHealth({send:sendMetric,heap:()=>performance.memory?.usedJSHeapSize/1048576});
const visibility=()=>health.visible(!document.hidden&&document.body.dataset.visible!=='false');
const onMetric=event=>{sendMetric(event.detail?.stage,event.detail?.metrics);if(event.detail?.stage==='first-frame'){visibility();health.ready();}};
window.addEventListener('workspace-metric',onMetric);window.addEventListener('workspace-visibility',visibility);document.addEventListener('visibilitychange',visibility);
window.addEventListener('pagehide',()=>{health.close();window.removeEventListener('workspace-metric',onMetric);window.removeEventListener('workspace-visibility',visibility);document.removeEventListener('visibilitychange',visibility);},{once:true});
const modalChanged=event=>{void bridge.modalSurface(event.detail?.open===true).catch(()=>{});};
window.addEventListener('workspace-modal-change',modalChanged);
window.addEventListener('pagehide',()=>window.removeEventListener('workspace-modal-change',modalChanged),{once:true});
const listeners = new Map();
let activeOperations=0;
const invoke=async(channel,payload)=>{const keep=/generate-image|save-session|import|export/.test(channel);if(keep){activeOperations++;bridge.keepAwake(true);}try{return await bridge.invoke({scope:'workspace',channel,payload});}finally{if(keep&&! --activeOperations)bridge.keepAwake(false);}};
const stopVisibility=bridge.onVisibility?.(value=>{document.body.dataset.visible=String(value.visible);window.dispatchEvent(new Event('workspace-visibility'));});
const ipcRenderer = {
 invoke,
 send: (channel, payload) => { void invoke(channel,payload).catch(error=>reportError('rejection',error)); },
 on(channel, listener) { if(!listeners.has(channel)) listeners.set(channel,new Set()); listeners.get(channel).add(listener); },
 removeListener(channel, listener) { listeners.get(channel)?.delete(listener); }
};
const unsubscribe=bridge.on(event=>{if(event.type==='workspace')for(const listener of listeners.get(event.channel)||[]) listener(null,event.payload);});
window.addEventListener('pagehide',()=>{unsubscribe();stopVisibility?.();listeners.clear();},{once:true});
const contextBridge={exposeInMainWorld(name, value){Object.defineProperty(window,name,{value});}};
const webUtils={getPathForFile: file=>bridge.pathForFile(file)};

contextBridge.exposeInMainWorld("aieyraGoals", {
    execute: payload => ipcRenderer.invoke("aieyra:goals", payload)
});

contextBridge.exposeInMainWorld("aieyraMatrix", {
    workspace: payload => ipcRenderer.invoke("aieyra:matrix:workspace", payload),
    execute: payload => ipcRenderer.invoke("aieyra:matrix:execute", payload),
    tools: payload => ipcRenderer.invoke("aieyra:matrix:tools", payload),
    transfer: payload => ipcRenderer.invoke("aieyra:matrix:transfer", payload),
    references: payload => ipcRenderer.invoke("aieyra:matrix:references", payload),
    styles: () => ipcRenderer.invoke("aieyra:matrix:styles"),
    onRequest: handler => {
        const listener = async (_event, request) => {
            try {
                ipcRenderer.send("aieyra:matrix:reply", {
                    id: request.id,
                    result: await handler(request)
                });
            } catch (error) {
                ipcRenderer.send("aieyra:matrix:reply", {
                    id: request.id,
                    error: String(error?.message || error || "工作台操作失败")
                });
            }
        };
        ipcRenderer.on("aieyra:matrix:request", listener);
        void ipcRenderer.invoke("aieyra:canvas:ready").catch(error=>reportError('render',error));
        return () => ipcRenderer.removeListener("aieyra:matrix:request", listener);
    },
    onChanged: handler => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:matrix:changed", listener);
        return () => ipcRenderer.removeListener("aieyra:matrix:changed", listener);
    }
});

contextBridge.exposeInMainWorld("aieyraModules", {
    status: () => ipcRenderer.invoke("aieyra:modules:status"),
    install: () => ipcRenderer.invoke("aieyra:modules:install"),
    remove: () => ipcRenderer.invoke("aieyra:modules:remove"),
    entry: () => ipcRenderer.invoke("aieyra:modules:entry")
});

const aieyraConfigBridge = {
    loadCanvas: () => ipcRenderer.invoke("aieyra:canvas:load"),
    studioDocuments: payload => ipcRenderer.invoke("aieyra:studio:documents", payload),
    listStyles: () => ipcRenderer.invoke("aieyra:styles:list"),
    mutateStyles: payload => ipcRenderer.invoke("aieyra:styles:mutate", payload),
    referenceStyle: payload => ipcRenderer.invoke("aieyra:styles:reference", payload),
    projectStorage: () => ipcRenderer.invoke("aieyra:project:storage-status"),
    chooseProjectStorage: () => ipcRenderer.invoke("aieyra:project:choose-storage-root"),
    moveProjectStorage: root => ipcRenderer.invoke("aieyra:project:move-storage-root", {
        root: root
    }),
    cancelProjectStorageMove: () => ipcRenderer.invoke("aieyra:project:cancel-storage-move"),
    onProjectStorageProgress: handler => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:project:storage-progress", listener);
        return () => ipcRenderer.removeListener("aieyra:project:storage-progress", listener);
    },
    loadSettings: () => ipcRenderer.invoke("aieyra:config:load-settings"),
    saveSettings: settings => ipcRenderer.invoke("aieyra:config:save-settings", settings),
    loadSession: payload => ipcRenderer.invoke("aieyra:config:load-session", payload),
    trashProjectContent: payload => ipcRenderer.invoke("aieyra:asset:trash-project-content", payload),
    restoreProjectContent: payload => ipcRenderer.invoke("aieyra:asset:restore-project-content", payload),
    forgetProjectContent: payload => ipcRenderer.invoke("aieyra:asset:forget-project-content", payload),
    saveSession: (session, options = {}) => ipcRenderer.invoke("aieyra:config:save-session", Number.isSafeInteger(options?.revision) ? {
        ...session || {},
        revision: options.revision
    } : session),
    newWindow: () => ipcRenderer.invoke("aieyra:window:new"),
    windowControl: payload => ipcRenderer.invoke("aieyra:window:control", payload),
    onWindowCloseRequest: handler => {
        const listener = async (_event, request) => {
            try {
                await handler();
                ipcRenderer.send("aieyra:window:drafts-saved", {
                    ok: !0, id: request.id
                });
            } catch {
                ipcRenderer.send("aieyra:window:drafts-saved", {
                    ok: !1, id: request.id
                });
            }
        };
        ipcRenderer.on("aieyra:window:save-drafts", listener);
        ipcRenderer.send("aieyra:window:draft-guard", !0);
        return () => {
            ipcRenderer.removeListener("aieyra:window:save-drafts", listener);
            ipcRenderer.send("aieyra:window:draft-guard", !1);
        };
    },
    listProjects: () => ipcRenderer.invoke("aieyra:project:list"),
    assessProjectRecovery: () => ipcRenderer.invoke("aieyra:project:reconciliation:assess"),
    recoverProjects: payload => ipcRenderer.invoke("aieyra:project:reconciliation:recover", payload),
    rollbackProjectRecovery: payload => ipcRenderer.invoke("aieyra:project:reconciliation:rollback", payload),
    createProject: payload => ipcRenderer.invoke("aieyra:project:create", payload),
    createProjectFolder: payload => ipcRenderer.invoke("aieyra:project:create-folder", payload),
    switchProject: payload => ipcRenderer.invoke("aieyra:project:switch", payload),
    renameProject: payload => ipcRenderer.invoke("aieyra:project:rename", payload),
    openProject: payload => ipcRenderer.invoke("aieyra:project:open", payload),
    openCurrentProjectFolder: payload => ipcRenderer.invoke("aieyra:project:open-current-folder", payload),
    exportProject: () => ipcRenderer.invoke("aieyra:project:export"),
    importProject: payload => ipcRenderer.invoke("aieyra:project:import", payload),
    archiveProject: payload => ipcRenderer.invoke("aieyra:project:archive", payload),
    cleanupEmptyProjects: payload => ipcRenderer.invoke("aieyra:project:cleanup-empty", payload),
    deleteProject: payload => ipcRenderer.invoke("aieyra:project:delete", payload),
    deleteProjectFolder: payload => ipcRenderer.invoke("aieyra:project:delete-folder", payload),
    resetProjectData: payload => ipcRenderer.invoke("aieyra:project:reset-data", payload),
    pickReferenceImage: () => ipcRenderer.invoke("aieyra:asset:pick-reference-image"),
    pickReferenceImages: payload => ipcRenderer.invoke("aieyra:asset:pick-reference-images", payload),
    pickLocalImages: payload => ipcRenderer.invoke("aieyra:asset:pick-local-images", payload),
    pickAgentFiles: payload => ipcRenderer.invoke("aieyra:asset:pick-agent-files", payload),
    pathForDroppedFile: file => webUtils.getPathForFile(file),
    readAssetDataUrl: payload => ipcRenderer.invoke("aieyra:asset:read-data-url", payload),
    thumbnailStats: payload => ipcRenderer.invoke("aieyra:asset:thumbnail-stats", payload),
    imageImportStatus: payload => ipcRenderer.invoke("aieyra:asset:image-import-status", payload),
    cancelImageImports: () => ipcRenderer.invoke("aieyra:asset:cancel-image-imports"),
    importLocalImage: payload => ipcRenderer.invoke("aieyra:asset:import-local-image", payload),
    importLocalImages: payload => ipcRenderer.invoke("aieyra:asset:import-local-images", payload),
    importCanvasAssets: payload => ipcRenderer.invoke("aieyra:asset:import-canvas-assets", payload),
    importClipboardImage: payload => ipcRenderer.invoke("aieyra:asset:import-clipboard-image", payload),
    importAgentFiles: payload => ipcRenderer.invoke("aieyra:asset:import-agent-files", payload),
    saveOutputImage: payload => ipcRenderer.invoke("aieyra:asset:save-output-image", payload),
    saveAssetAs: payload => ipcRenderer.invoke("aieyra:asset:save-as", payload),
    exportAssetsToFolder: payload => ipcRenderer.invoke("aieyra:asset:export-folder", payload),
    openAssetFolder: payload => ipcRenderer.invoke("aieyra:asset:open-folder", payload),
    openAssetInSystemViewer: payload => ipcRenderer.invoke("aieyra:asset:open-default", payload),
    copyAssetImage: payload => ipcRenderer.invoke("aieyra:asset:copy-image", payload)
};

contextBridge.exposeInMainWorld("aieyraConfig", aieyraConfigBridge);

contextBridge.exposeInMainWorld("aieyraWriting", {
    openOffice: payload => ipcRenderer.invoke("aieyra:writing:office-open", payload),
    officePreview: payload => ipcRenderer.invoke("aieyra:writing:office-preview", payload),
    illustrations: payload => ipcRenderer.invoke("aieyra:writing:illustrations", payload),
    novel: payload => ipcRenderer.invoke("aieyra:writing:novel", payload),
    review: payload => ipcRenderer.invoke("aieyra:writing:review", payload),
    editText: payload => ipcRenderer.invoke("aieyra:writing:edit-text", payload),
    refresh: payload => ipcRenderer.invoke("aieyra:writing:refresh", payload),
    updateLayout: payload => ipcRenderer.invoke("aieyra:writing:update-layout", payload),
    importDocuments: payload => ipcRenderer.invoke("aieyra:writing:import", payload),
    createArtifact: payload => ipcRenderer.invoke("aieyra:writing:create", payload),
    connectArtifacts: payload => ipcRenderer.invoke("aieyra:writing:connect", payload),
    readArtifact: payload => ipcRenderer.invoke("aieyra:writing:read", payload),
    readPdfWindow: payload => ipcRenderer.invoke("aieyra:writing:read-pdf-window", payload),
    patchArtifact: payload => ipcRenderer.invoke("aieyra:writing:patch", payload),
    acceptAgentPatch: payload => ipcRenderer.invoke("aieyra:writing:agent-patch:accept", payload),
    rejectAgentPatch: payload => ipcRenderer.invoke("aieyra:writing:agent-patch:reject", payload),
    updateReviewFindingStatus: payload => ipcRenderer.invoke("aieyra:writing:review-finding-status", payload),
    restoreArtifact: payload => ipcRenderer.invoke("aieyra:writing:restore", payload),
    exportArtifact: payload => ipcRenderer.invoke("aieyra:writing:export", payload),
    resetProject: payload => ipcRenderer.invoke("aieyra:writing:reset", payload)
});

const aieyraLineageBridge = {
    refresh: payload => ipcRenderer.invoke("aieyra:lineage:refresh", payload),
    updateLayout: payload => ipcRenderer.invoke("aieyra:lineage:update-layout", payload),
    importData: payload => ipcRenderer.invoke("aieyra:lineage:import", payload),
    refreshDataRoot: payload => ipcRenderer.invoke("aieyra:lineage:refresh-source", payload),
    recoverDataStale: payload => ipcRenderer.invoke("aieyra:lineage:recover-stale", payload),
    createWritingSnapshot: payload => ipcRenderer.invoke("aieyra:lineage:create-writing-snapshot", payload),
    deriveArtifact: payload => ipcRenderer.invoke("aieyra:lineage:derive", payload),
    editStructure: payload => ipcRenderer.invoke("aieyra:lineage:edit-structure", payload),
    readArtifact: payload => ipcRenderer.invoke("aieyra:lineage:read", payload),
    readTableWindow: payload => ipcRenderer.invoke("aieyra:lineage:read-table-window", payload),
    exportArtifact: payload => ipcRenderer.invoke("aieyra:lineage:export", payload),
    cancel: payload => ipcRenderer.invoke("aieyra:lineage:cancel", payload),
    resetProject: payload => ipcRenderer.invoke("aieyra:lineage:reset", payload)
};

contextBridge.exposeInMainWorld("aieyraLineage", aieyraLineageBridge);

contextBridge.exposeInMainWorld("aieyraConnection", {
    adapter: payload => ipcRenderer.invoke("aieyra:connection:adapter", payload),
    status: () => ipcRenderer.invoke("aieyra:connection:status"),
    selectMode: payload => ipcRenderer.invoke("aieyra:connection:select-mode", payload),
    testCustom: payload => ipcRenderer.invoke("aieyra:connection:test-custom", payload),
    saveCustom: payload => ipcRenderer.invoke("aieyra:connection:save-custom", payload),
    disconnect: () => ipcRenderer.invoke("aieyra:connection:disconnect"),
    refreshModels: payload => ipcRenderer.invoke("aieyra:connection:refresh-models", payload),
    selectModels: payload => ipcRenderer.invoke("aieyra:connection:select-models", payload),
    cancel: () => ipcRenderer.invoke("aieyra:connection:cancel"),
    onChanged: handler => {
        if (typeof handler !== "function") return () => {};
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:connection:changed", listener);
        return () => ipcRenderer.removeListener("aieyra:connection:changed", listener);
    }
});

contextBridge.exposeInMainWorld("aieyraExternalApi", {
    session: () => ipcRenderer.invoke("aieyra:external-api:session"),
    status: () => ipcRenderer.invoke("aieyra:external-api:status"),
    copyPrompt: () => ipcRenderer.invoke("aieyra:external-api:copy-prompt"),
    exportSkill: () => ipcRenderer.invoke("aieyra:external-api:export-skill")
});

contextBridge.exposeInMainWorld("aieyraWorkspace", {
    status: () => ipcRenderer.invoke("aieyra:workspace:status"),
    retry: () => ipcRenderer.invoke("aieyra:workspace:retry"),
    onChanged: handler => {
        if (typeof handler !== "function") return () => {};
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:workspace:changed", listener);
        return () => ipcRenderer.removeListener("aieyra:workspace:changed", listener);
    }
});

contextBridge.exposeInMainWorld("aieyraServer", {
    openPortal: payload => ipcRenderer.invoke("aieyra:server:open-portal", payload),
    logout: () => ipcRenderer.invoke("aieyra:server:logout"),
    me: () => ipcRenderer.invoke("aieyra:server:me"),
    officialTokens: payload => ipcRenderer.invoke("aieyra:server:official-tokens", payload),
    selectOfficialToken: payload => ipcRenderer.invoke("aieyra:server:select-official-token", payload),
    logs: () => ipcRenderer.invoke("aieyra:server:logs"),
    models: payload => ipcRenderer.invoke("aieyra:server:models", payload),
    recharge: payload => ipcRenderer.invoke("aieyra:server:recharge", payload),
    generateImage: payload => ipcRenderer.invoke("aieyra:server:generate-image", payload),
    onAccountChanged: handler => {
        if (typeof handler !== "function") return () => {};
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:server:account-changed", listener);
        return () => ipcRenderer.removeListener("aieyra:server:account-changed", listener);
    }
});

contextBridge.exposeInMainWorld("aieyraUpdater", {
    status: () => ipcRenderer.invoke("aieyra:update:status"),
    ready: () => ipcRenderer.invoke("aieyra:update:renderer-ready"),
    check: () => ipcRenderer.invoke("aieyra:update:check"),
    downloadRestart: () => ipcRenderer.invoke("aieyra:update:download-restart"),
    downloadInstaller: confirmation => ipcRenderer.invoke("aieyra:update:download-installer", {
        confirmation: confirmation
    }),
    applyRestart: () => ipcRenderer.invoke("aieyra:update:apply-restart"),
    launchInstaller: confirmation => ipcRenderer.invoke("aieyra:update:launch-installer", {
        confirmation: confirmation
    }),
    onProgress: handler => {
        if (typeof handler !== "function") return () => {};
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:update:progress", listener);
        return () => ipcRenderer.removeListener("aieyra:update:progress", listener);
    }
});

contextBridge.exposeInMainWorld("aieyraAgent", {
    tools: payload => ipcRenderer.invoke("aieyra:agent:tools", payload),
    foundation: payload => ipcRenderer.invoke("aieyra:agent:foundation", payload),
    coding: payload => ipcRenderer.invoke("aieyra:coding:execute", payload),
    welcome: payload => ipcRenderer.invoke("aieyra:matrix:welcome", payload),
    onCodingEvent: handler => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:coding:event", listener);
        return () => ipcRenderer.removeListener("aieyra:coding:event", listener);
    },
    listModels: payload => ipcRenderer.invoke("aieyra:agent:list-models", payload),
    runTool: payload => ipcRenderer.invoke("aieyra:agent:run-tool", payload),
    composeImagePrompt: payload => ipcRenderer.invoke("aieyra:agent:compose-image-prompt", payload),
    chat: payload => ipcRenderer.invoke("aieyra:agent:chat", payload),
    steer: payload => ipcRenderer.invoke("aieyra:agent:steer", payload),
    cancelRun: payload => ipcRenderer.invoke("aieyra:agent:cancel-run", payload),
    exportKnowledgeBase: payload => ipcRenderer.invoke("aieyra:agent:export-knowledge", payload),
    imageJobs: payload => ipcRenderer.invoke("aieyra:agent:image-jobs", payload),
    observeCanvas: payload => ipcRenderer.invoke("aieyra:agent:canvas-observation", payload),
    getPromptLibrary: (payload = {}) => ipcRenderer.invoke("aieyra:agent:prompt-library:get", payload),
    updatePromptLibrary: payload => ipcRenderer.invoke("aieyra:agent:prompt-library:update", payload),
    readKnowledgeDocument: payload => ipcRenderer.invoke("aieyra:agent:knowledge-document:read", payload),
    getMainPrompt: () => ipcRenderer.invoke("aieyra:agent:main-prompt:get"),
    saveMainPrompt: payload => ipcRenderer.invoke("aieyra:agent:main-prompt:save", payload),
    resetMainPrompt: () => ipcRenderer.invoke("aieyra:agent:main-prompt:reset"),
    getKnowledgeBase: () => ipcRenderer.invoke("aieyra:agent:knowledge-base:get"),
    saveKnowledgeBase: payload => ipcRenderer.invoke("aieyra:agent:knowledge-base:save", payload),
    resetKnowledgeBase: () => ipcRenderer.invoke("aieyra:agent:knowledge-base:reset"),
    getFastMemory: payload => ipcRenderer.invoke("aieyra:agent:fast-memory:get", payload),
    saveFastMemory: payload => ipcRenderer.invoke("aieyra:agent:fast-memory:save", payload),
    resetFastMemory: payload => ipcRenderer.invoke("aieyra:agent:fast-memory:reset", payload),
    clearConversation: payload => ipcRenderer.invoke("aieyra:agent:clear-conversation", payload),
    cancelPendingExecution: payload => ipcRenderer.invoke("aieyra:agent:cancel-pending-execution", payload),
    onProgress: handler => {
        if (typeof handler !== "function") return () => {};
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on("aieyra:agent:progress", listener);
        return () => ipcRenderer.removeListener("aieyra:agent:progress", listener);
    }
});
