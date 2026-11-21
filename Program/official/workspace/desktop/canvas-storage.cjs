// Canvas persistence, project and asset operations ported from Workspace 2.0.39 (MIT).
// OS injects the lifecycle, agent, model and image services. No standalone boot.
module.exports = function createCanvasStorage(host) {
const storageStarted = performance.now();
const {app, BrowserWindow, clipboard, dialog, nativeImage, nativeTheme, net, protocol, shell, utilityProcess} = host.electron;

const {modelRequestPolicy: modelRequestPolicy, modelRequestRateLimited: modelRequestRateLimited, withModelRequestRetry: withModelRequestRetry} = require("../shared/model-request-policy.cjs");
const {sanitizeVideoNode} = require("../shared/video-node.mjs");

const {IMAGE25_MODELS: IMAGE25_MODELS, imageModelFamily: imageModelFamily, isImage25Model: isImage25Model, imageQualityForModel: imageQualityForModel, resolveImageQuality: resolveImageQuality, validateImage25Size: validateImage25Size, imagePromptForSize: imagePromptForSize} = require("../shared/image-model-settings.mjs");

const {existingProjectRecords: existingProjectRecords, readProjectsRoot: readProjectsRoot, migrateProjectsRoot: migrateProjectsRoot, projectPathMappings: projectPathMappings, relocateStoredValue: relocateStoredValue} = require("./projects/project-storage.cjs");

const {isArchivedProject: isArchivedProject, assertProjectDirectory: assertProjectDirectory, archiveProjectDirectory: archiveProjectDirectory, isEmptyManagedProject: isEmptyManagedProject} = require("./projects/project-lifecycle.cjs");

const {AsyncLocalStorage: AsyncLocalStorage} = require("node:async_hooks");

const {closeSync: closeSync, copyFileSync: copyFileSync, createReadStream: createReadStream, createWriteStream: createWriteStream, existsSync: existsSync, fstatSync: fstatSync, lstatSync: lstatSync, mkdirSync: mkdirSync, openSync: openSync, readSync: readSync, readdirSync: readdirSync, readFileSync: readFileSync, realpathSync: realpathSync, renameSync: renameSync, rmdirSync: rmdirSync, rmSync: rmSync, statfsSync: statfsSync, statSync: statSync, writeFileSync: writeFileSync} = require("node:fs");

const {createHash: createHash, randomBytes: randomBytes, randomUUID: randomUUID, verify: verify} = require("node:crypto");

const path = require("node:path");

const {listGoals: listGoals, readGoal: readGoal, runGoalTool: runGoalTool, checkpointGoal: checkpointGoal, recordGoalFeedback: recordGoalFeedback, linkGoalNote: linkGoalNote, imageVersion: imageVersion, withGoalCommit: withGoalCommit, resolveGoalImages: resolveGoalImages} = require("./agent/workspace-goals.cjs");

const {sanitizeGoalFeedback: sanitizeGoalFeedback} = require("../shared/goal-feedback.mjs");

const {createThumbnailCache: createThumbnailCache} = require("./images/thumbnail-cache.cjs");

const {createImageImporter: createImageImporter, ImageImportError: ImageImportError, DEFAULT_MAX_FILES: maxImportedImageFiles, safeSourceRelativePath: safeImageSourceRelativePath, mimeTypeForPath: mimeTypeForPath, pngBufferHasTransparentPixel: pngBufferHasTransparentPixel} = require("./images/image-import.cjs");

const {downloadRemoteImage: downloadRemoteImage} = require("./images/remote-image-download.cjs");

const {CURRENT_PRODUCT_IDENTITY: CURRENT_PRODUCT_IDENTITY, LEGACY_PRODUCT_IDENTITIES: LEGACY_PRODUCT_IDENTITIES, TRANSITIONAL_PRODUCT_IDENTITIES: TRANSITIONAL_PRODUCT_IDENTITIES, isCurrentOrLegacyManagedTokenName: isCurrentOrLegacyManagedTokenName, isCurrentOrLegacyReleaseProduct: isCurrentOrLegacyReleaseProduct} = require("./core/product-identity.cjs");

const {atomicWriteJson: atomicWriteJson, backupSnapshot: backupSnapshot, inspectJson: inspectJson} = require("./core/json-storage.cjs");

const {OWNERSHIP_MARKER_NAME: projectImportOwnershipMarkerName, createProjectImportTransactionManager: createProjectImportTransactionManager} = require("./projects/project-import-transaction.cjs");

const {MIGRATION_DIRECTORY: projectMigrationDirectoryName, assessManagedProjects: assessManagedProjects, createProjectMigrationTransactionManager: createProjectMigrationTransactionManager} = require("./projects/project-reconciliation.cjs");

const {agentModelCapability: agentModelCapability, ConnectionSecurityError: ConnectionSecurityError, createConnectionRuntime: createConnectionRuntime, isImageGenerationModelId: isImageGenerationModelId, joinProviderEndpoint: joinProviderEndpoint, normalizeAgentProvider: normalizeAgentProvider, normalizeAgentRuntimeOptions: normalizeAgentRuntimeOptions, normalizeModelKeyBindings: normalizeModelKeyBindings, providerReasoningEffortForRequest: providerReasoningEffortForRequest, providerServiceTierForRequest: providerServiceTierForRequest, normalizeCustomBaseUrl: normalizeCustomBaseUrl, validateApiKey: validateApiKey, validatedHeaderEntries: validatedHeaderEntries, scrubExactCredentialText: scrubExactCredentialText, scrubExactCredentialValue: scrubExactCredentialValue} = require("./models/connection-runtime.cjs");

const packageMetadata = require("../package.json");

const officialService = require("../shared/config/official-service.json");

const writingTemplateRegistry = require("../shared/config/writing-template-registry.json");

const writingIllustrations = new Proxy({}, {
    get: (_, name) => workspaceModules.runtime("writing-illustrations.cjs")[name]
});

const {normalizedProjectKind: normalizedProjectKind, projectCapabilitiesByKind: projectCapabilitiesByKind, projectCapabilityIsVisible: projectCapabilityIsVisible, projectCapabilityRegistry: projectCapabilityRegistry, projectCreationCapability: projectCreationCapability, resolveProjectSurface: resolveProjectSurface} = require("./projects/project-capability-policy.cjs");

const defaultWritingSession = (...args) => workspaceModules.runtime("writing-runtime.cjs").defaultWritingSession(...args);

const dehydrateWritingSession = (...args) => workspaceModules.runtime("writing-runtime.cjs").dehydrateWritingSession(...args);

const hydrateWritingSession = (...args) => workspaceModules.runtime("writing-runtime.cjs").hydrateWritingSession(...args);

const recoverWritingMutationJournal = (...args) => workspaceModules.runtime("writing-runtime.cjs").recoverWritingMutationJournal(...args);

const sanitizeWritingSession = (...args) => workspaceModules.runtime("writing-runtime.cjs").sanitizeWritingSession(...args);

const stripWritingArtifactContent = (...args) => workspaceModules.runtime("writing-runtime.cjs").stripWritingArtifactContent(...args);

const writingCanvasRoleForKind = (...args) => workspaceModules.runtime("writing-runtime.cjs").writingCanvasRoleForKind(...args);

const writingSessionHasContent = (...args) => workspaceModules.runtime("writing-runtime.cjs").writingSessionHasContent(...args);

const assertPreparedDocxSourceStable = (...args) => workspaceModules.runtime("writing-docx-io.cjs").assertPreparedDocxSourceStable(...args);

const prepareDocxImport = (...args) => runWritingModuleProcess("docx-import", args);

const preparePdfImport = (...args) => runWritingModuleProcess("pdf-import", args);

// Legacy office engines are needed only by Data/Finance projects. Loading
// Excel/PPT/ZIP parsers here blocks the native OS event loop on cold starts.
const clearLineageMutationJournal = (...args) => require("./legacy/lineage-runtime.cjs").clearLineageMutationJournal(...args);
const createLineageArtifact = (...args) => require("./legacy/lineage-runtime.cjs").createLineageArtifact(...args);
const editLineageArtifactStructure = (...args) => require("./legacy/lineage-runtime.cjs").editLineageArtifactStructure(...args);
const dehydrateLineageSession = (...args) => require("./legacy/lineage-runtime.cjs").dehydrateLineageSession(...args);
const emptyLineageSession = (...args) => require("./legacy/lineage-runtime.cjs").emptyLineageSession(...args);
const exportLineageArtifact = (...args) => require("./legacy/lineage-runtime.cjs").exportLineageArtifact(...args);
const hydrateLineageSession = (...args) => require("./legacy/lineage-runtime.cjs").hydrateLineageSession(...args);
const importLineageArtifact = (...args) => require("./legacy/lineage-runtime.cjs").importLineageArtifact(...args);
const planLineageDataStaleRecovery = (...args) => require("./legacy/lineage-runtime.cjs").planLineageDataStaleRecovery(...args);
const refreshLineageDataRootArtifact = (...args) => require("./legacy/lineage-runtime.cjs").refreshLineageDataRootArtifact(...args);
const lineageSessionHasContent = (...args) => require("./legacy/lineage-runtime.cjs").lineageSessionHasContent(...args);
const lineageJournalSnapshotFromDescriptor = (...args) => require("./legacy/lineage-runtime.cjs").lineageJournalSnapshotFromDescriptor(...args);
const lineageJournalSourceHistoryFromDescriptor = (...args) => require("./legacy/lineage-runtime.cjs").lineageJournalSourceHistoryFromDescriptor(...args);
const lineageSessionWithArtifact = (...args) => require("./legacy/lineage-runtime.cjs").lineageSessionWithArtifact(...args);
const readArtifactContent = (...args) => require("./legacy/lineage-runtime.cjs").readArtifactContent(...args);
const readLineageArtifact = (...args) => require("./legacy/lineage-runtime.cjs").readLineageArtifact(...args);
const readLineageMutationJournal = (...args) => require("./legacy/lineage-runtime.cjs").readLineageMutationJournal(...args);
const readLineageTableWindow = (...args) => require("./legacy/lineage-runtime.cjs").readLineageTableWindow(...args);
const recoverLineageMutationJournal = (...args) => require("./legacy/lineage-runtime.cjs").recoverLineageMutationJournal(...args);
const removeLineageManagedData = (...args) => require("./legacy/lineage-runtime.cjs").removeLineageManagedData(...args);
const sanitizeLineageSession = (...args) => require("./legacy/lineage-runtime.cjs").sanitizeLineageSession(...args);
const canonicalScenarioWorkbookContentFromSources = (...args) => require("./legacy/lineage-runtime.cjs").canonicalScenarioWorkbookContentFromSources(...args);
const validateLineageStoredContent = (...args) => require("./legacy/lineage-runtime.cjs").validateLineageStoredContent(...args);
const writeLineageMutationJournal = (...args) => require("./legacy/lineage-runtime.cjs").writeLineageMutationJournal(...args);

const activeWritingMutationProjects = new Set;

const activeLineageMutationProjects = new Set;

function trustedOfficialOrigin(value, label) {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error(`Official service ${label} must be a credential-free HTTPS origin.`);
    return parsed.origin;
}

const displayApplicationName = String(packageMetadata.aieyraDisplayName || CURRENT_PRODUCT_IDENTITY.displayName).trim().slice(0, 80) || CURRENT_PRODUCT_IDENTITY.displayName;

const aieyraModelApiOrigin = trustedOfficialOrigin(officialService.apiOrigin, "apiOrigin");

const identityDataMigrationState = {status:"os-managed",migrated:false};

const rendererDevelopmentOverridesAllowed = !app.isPackaged;

const devUrl = rendererDevelopmentOverridesAllowed && process.env.AIEYRA_DEV_URL || "";

const projectRoot = path.resolve(__dirname, "..");

const desktopRoot = path.join(process.env.USERPROFILE || projectRoot, "Desktop");

const projectSurface = "unified";

const configDir = host.dataRoot;

let codingAgentManager = null;

function matrixBroadcast(kind,details={},exceptSender) { host.broadcast("aieyra:matrix:changed", {kind,...details},exceptSender); }

const workspaceModules = require("./modules/workspace-modules.cjs").createWorkspaceModuleManager({
    root: path.join(configDir, "modules"),
    cataloguePath: path.join(projectRoot, "desktop/modules/catalogue.json"),
    sourceRoot: projectRoot,
    development: Boolean(devUrl)
});

async function runWritingModuleProcess(operation, args) {
    return workspaceModules.use(() => require("./modules/workspace-module-process.cjs").runModuleProcess(utilityProcess, workspaceModules.processInput(operation, args)));
}

const agentWorkspaceRoot = host.dataRoot;

const debugDir = path.join(configDir, "diagnostics");

const electronLog = path.join(debugDir, "canvas.log");

const settingsPath = path.join(configDir, "app-settings.json");

const sessionPath = path.join(configDir, "session.json");

const projectListPath = path.join(configDir, "project-list.json");

let projectsDir = readProjectsRoot(configDir, projectListPath);

const referencesDir = path.join(configDir, "references");

const styleLibrary = require("./images/style-library.cjs").createStyleLibrary({
    root: path.join(referencesDir, "style-library"),
    resolveSource: resolveReadableImageAsset,
    assetUrlFor: assetUrlFor,
    importImages: importLocalImagesToProject,
    importFiles: importAgentFilesToProject
});

const studioDocuments = require("./work/studio-documents.cjs").createStudioDocuments({
    projectById: id => {
        const project = getProjectById(id, readProjectList());
        if (!project) throw Error("项目不存在。");
        assertProjectWritable(project, "办公文档");
        return project;
    },
    pdfImport: source => require("./work/writing-pdf-io.cjs").preparePdfImport(source),
    pdfExport: async html => {
        const win = new BrowserWindow({
            show: !1,
            webPreferences: {
                sandbox: !0,
                nodeIntegration: !1,
                contextIsolation: !0
            }
        });
        try {
            await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
            return await win.webContents.printToPDF({
                printBackground: !0,
                pageSize: "A4"
            });
        } finally {
            win.destroy();
        }
    }
});

const updatesDir = path.join(configDir, "updates");

let workspaceRuntimeFilesInitialized = !1;

let workspaceRuntimeReady = !1;

let workspaceRuntimeSuspended = !0;

let workspaceRuntimeInitializationError = "";

let workspaceRuntimeInitializationStage = "idle";

let workspaceRuntimeRevision = 0;

const projectImportTransactionManager = createProjectImportTransactionManager({
    configDir: configDir
});

let projectMigrationTransactionManager = createProjectMigrationTransactionManager({
    configDir: configDir,
    projectsDir: projectsDir,
    projectListPath: projectListPath
});

let projectStorageMoving = !1;

let projectStorageAbort = null;

let activeProjectStorageOperations = 0;

let projectReconciliationBusy = !1;

const projectRecoveryAssessmentCache = new Map;

const updateHealthDir = path.join(updatesDir, "health");

const projectMetaDirName = ".iiimage";

const projectManifestFileName = "project.json";

const projectPackageMaximumAgentFileBytes = 25165824;

const {officeRelativePath: officeRelativePath, controlledOfficeFile: controlledOfficeFile, OFFICE_FORMATS: OFFICE_FORMATS, OFFICE_MAX_BYTES: OFFICE_MAX_BYTES} = require("./work/writing-office-store.cjs");

let agentRuntime = null;

let quitting = !1;

const bootStartedAt = Date.now();

const providerRunStorage = new AsyncLocalStorage;

let thumbnailProjectRootsCache = null;

const activeAgentRunControllers = new Map;

let activeImageEditRequests = 0;

const queuedImageEditRequests = [];

function combineNewApiAbortSignals(...signals) {
    const activeSignals = signals.filter(signal => signal && typeof signal === "object");
    if (!activeSignals.length) return;
    if (activeSignals.length === 1) return activeSignals[0];
    if (typeof AbortSignal.any === "function") return AbortSignal.any(activeSignals);
    const controller = new AbortController;
    const abort = signal => {
        controller.signal.aborted || controller.abort(signal?.reason);
    };
    for (const signal of activeSignals) {
        if (signal.aborted) {
            abort(signal);
            break;
        }
        signal.addEventListener?.("abort", () => abort(signal), {
            once: !0
        });
    }
    return controller.signal;
}

let backgroundImageRuntime;

const projectAssetTrash = require("./projects/project-asset-trash.cjs").createProjectAssetTrash({
    trashItem: file => shell.trashItem(file)
});

function getBackgroundImageRuntime() { return host.images; }

const defaultSettings = {
    agentAccessMode: "full",
    petAgent: {
        enabled: !1,
        model: "",
        profileId: ""
    },
    agentProvider: "OPENAI",
    agentBaseUrl: "",
    agentApiKey: "",
    agentModel: "",
    agentModelPool: [],
    compactModel: "",
    reasoningEffort: "low",
    serviceTier: "standard",
    fastMode: !1,
    timeoutSeconds: 600,
    modelMaxRetries: 4,
    requestPolicyVersion: 1,
    imageBaseUrl: "",
    imageApiKey: "",
    imageModel: "",
    imageModelPool: [],
    imageModelNotes: {},
    imageCount: 1,
    imageSize: "1024x1024",
    imageQuality: "high",
    serverUrl: aieyraModelApiOrigin,
    theme: "system"
};

function uniqueImageModels(models = []) {
    return models.map(model => String(model || "").trim()).filter(Boolean).filter((model, index, list) => list.findIndex(item => item.toLowerCase() === model.toLowerCase()) === index);
}

const defaultSession = {
    schemaVersion: 3,
    projectKind: "image",
    sessionRevision: 0,
    nodeSequence: 0,
    messages: [],
    nodes: [],
    selectedNodeId: ""
};

function defaultSessionForProject(projectOrKind = "image") {
    const project = typeof projectOrKind === "object" && projectOrKind ? projectOrKind : null;
    const normalized = normalizedProjectKind(project?.kind || projectOrKind, project?.quarantine);
    if (normalized.supportedKind === "writing" && !normalized.quarantine && workspaceModules.status().state === "installed") return {
        ...defaultSession,
        ...defaultWritingSession(project?.id || ""),
        messages: [],
        conversations: [],
        nodes: [],
        layoutGroups: []
    };
    if ([ "data", "finance" ].includes(String(normalized.supportedKind)) && !normalized.quarantine) return {
        ...defaultSession,
        ...emptyLineageSession(normalized.supportedKind),
        sessionRevision: 0,
        messages: [],
        conversations: [],
        nodes: [],
        layoutGroups: [],
        selectedNodeId: ""
    };
    if (normalized.supportedKind !== "image") return {
        ...defaultSession,
        schemaVersion: 4,
        projectKind: normalized.kind,
        messages: [],
        nodes: [],
        selectedNodeId: ""
    };
    return {
        ...defaultSession,
        messages: [],
        nodes: [],
        selectedNodeId: ""
    };
}

function defaultProjectList() {
    const defaultSessionPath = path.join(projectsDir, "default", "session.json");
    return {
        activeProjectId: "default",
        projects: [ {
            schemaVersion: 4,
            id: "default",
            name: "默认项目",
            kind: "image",
            path: path.dirname(defaultSessionPath),
            sessionPath: defaultSessionPath,
            createdAt: (new Date).toISOString(),
            updatedAt: (new Date).toISOString(),
            external: !1
        } ]
    };
}

function ensureRuntimeDirectories() {
    mkdirSync(configDir, {
        recursive: !0
    });
    mkdirSync(debugDir, {
        recursive: !0
    });
    mkdirSync(path.dirname(electronLog), {
        recursive: !0
    });
}

function ensureRuntimeFiles() {
    if (workspaceRuntimeFilesInitialized) return;
    ensureRuntimeDirectories();
    mkdirSync(configDir, {
        recursive: !0
    });
    mkdirSync(agentWorkspaceRoot, {
        recursive: !0
    });
    mkdirSync(projectsDir, {
        recursive: !0
    });
    mkdirSync(referencesDir, {
        recursive: !0
    });
    mkdirSync(updatesDir, {
        recursive: !0
    });
    mkdirSync(updateHealthDir, {
        recursive: !0
    });
    existsSync(settingsPath) || writeJson(settingsPath, defaultSettings);
    const storedSettings = readJson(settingsPath, {});
    const migratedSettings = migrateSettings(storedSettings);
    JSON.stringify(storedSettings) !== JSON.stringify(migratedSettings) && writeJson(settingsPath, migratedSettings, {
        migrationReason: "settings-migration"
    });
    syncNativeThemeSource(migratedSettings);
    initializeConnectionRuntime();
    existsSync(sessionPath) || writeJson(sessionPath, defaultSession);
    if (!existsSync(projectListPath)) {
        const initialList = defaultProjectList();
        ensureProjectFiles(initialList.projects[0], defaultSessionForProject(initialList.projects[0]), !0);
        writeJson(projectListPath, initialList);
    }
    const storedProjectList = readJson(projectListPath, defaultProjectList());
    let list = normalizeProjectList(storedProjectList);
    JSON.stringify(storedProjectList) !== JSON.stringify(list) && writeJson(projectListPath, list, {
        migrationReason: "project-list-v4-migration"
    });
    const importRecovery = projectImportTransactionManager.recover(list);
    importRecovery.recovered && log(`project import recovery actions=${importRecovery.actions.map(action => `${action.transactionId}:${action.action}`).join(",")}`);
    const migrationDirectory = path.join(configDir, projectMigrationDirectoryName);
    if (existsSync(migrationDirectory)) {
        const migrationRecovery = projectMigrationTransactionManager.recover();
        if (migrationRecovery.recovered) {
            log(`project migration recovery actions=${migrationRecovery.actions.map(action => `${action.transactionId}:${action.action}`).join(",")}`);
            list = readProjectList();
        }
    }
    list = readProjectList();
    updateThumbnailProjectRootsCache(list);
    const activeProject = list.projects.find(project => project.id === list.activeProjectId && projectRecordVisibleOnCurrentSurface(project)) || list.projects.find(projectRecordVisibleOnCurrentSurface);
    activeProject && !existsSync(activeProject.sessionPath) && ensureProjectFiles(activeProject, defaultSessionForProject(activeProject));
    writeFileSync(electronLog, `[${(new Date).toISOString()}] ${displayApplicationName} electron boot\n`, "utf8");
    log(`identity data migration status=${identityDataMigrationState.status} migrated=${Boolean(identityDataMigrationState.migrated)} files=${Number(identityDataMigrationState.fileCount || 0)}`);
    workspaceRuntimeFilesInitialized = !0;
    logBoot("runtime files ready");
}

function workspaceRuntimeStatus() {
    return {
        state: workspaceRuntimeReady && !workspaceRuntimeSuspended ? "ready" : workspaceRuntimeInitializationError ? "error" : "starting",
        workspaceReady: workspaceRuntimeReady && !workspaceRuntimeSuspended,
        workspaceSuspended: workspaceRuntimeSuspended,
        runtimeStage: workspaceRuntimeInitializationStage,
        runtimeError: workspaceRuntimeInitializationError || void 0,
        revision: workspaceRuntimeRevision,
        distribution: "free-open-source"
    };
}

function assertWorkspaceAccessLease() { host.assertActive(); }

function assertWorkspaceRuntimeReady() {
    if (!workspaceRuntimeReady || workspaceRuntimeSuspended || quitting) throw workspaceRuntimeUnavailableError();
    assertWorkspaceAccessLease();
    return workspaceRuntimeStatus();
}

function migrateSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const next = {
        ...defaultSettings
    };
    for (const key of Object.keys(defaultSettings)) source[key] !== void 0 && (next[key] = source[key]);
    next.agentAccessMode = "full";
    next.petAgent = {
        enabled: source.petAgent?.enabled === !0,
        model: String(source.petAgent?.model || "").trim().slice(0, 180),
        profileId: String(source.petAgent?.profileId || "").trim().slice(0, 160),
        .../^\d{1,20}$/.test(String(source.petAgent?.tokenId || "")) ? {
            tokenId: String(source.petAgent.tokenId)
        } : {}
    };
    !source.agentBaseUrl && source.baseUrl && (next.agentBaseUrl = source.baseUrl);
    !source.agentApiKey && source.apiKey && (next.agentApiKey = source.apiKey);
    !source.agentModel && source.model && (next.agentModel = source.model);
    !source.imageBaseUrl && source.baseUrl && (next.imageBaseUrl = source.baseUrl);
    !source.imageApiKey && source.apiKey && (next.imageApiKey = source.apiKey);
    next.modelKeyBindings = normalizeModelKeyBindings(source.modelKeyBindings);
    next.agentModelPool = safeConnectionModels(Array.isArray(source.agentModelPool) ? source.agentModelPool : next.agentModelPool);
    !next.agentModel && next.agentModelPool.length && (next.agentModel = next.agentModelPool[0]);
    next.agentModel && (next.agentModelPool = safeConnectionModels([ next.agentModel, ...next.agentModelPool ]));
    next.imageModelPool = uniqueImageModels(Array.isArray(source.imageModelPool) ? source.imageModelPool : next.imageModelPool);
    !next.imageModel && next.imageModelPool.length && (next.imageModel = next.imageModelPool[0]);
    next.imageModel && (next.imageModelPool = uniqueImageModels([ next.imageModel, ...next.imageModelPool ]));
    next.imageModelNotes = safeImageModelNotes(source.imageModelNotes ?? next.imageModelNotes, next.imageModelPool);
    next.imageQuality = imageQualityForModel(next.imageModel, next.imageQuality);
    next.agentProvider = normalizeAgentProvider(next.agentProvider);
    const storedReasoningEffort = String(next.reasoningEffort);
    next.reasoningEffort = [ "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra" ].includes(storedReasoningEffort) ? storedReasoningEffort : "low";
    next.theme = normalizeThemeChoice(source.theme);
    Object.assign(next, modelRequestPolicy(source));
    const requestedReasoningEffort = next.reasoningEffort;
    const runtimeOptions = normalizeAgentRuntimeOptions(next, {
        agentModel: next.agentModel
    });
    next.reasoningEffort = next.agentModel ? runtimeOptions.reasoningEffort || "low" : requestedReasoningEffort;
    next.serviceTier = next.agentModel ? runtimeOptions.serviceTier : "standard";
    next.fastMode = next.serviceTier !== "standard";
    next.agentBaseUrl = "";
    next.agentApiKey = "";
    next.imageBaseUrl = "";
    next.imageApiKey = "";
    next.serverUrl = aieyraModelApiOrigin;
    delete next.baseUrl;
    delete next.apiKey;
    delete next.model;
    delete next.serverToken;
    delete next.serverSessionCookie;
    delete next.serverUserId;
    return next;
}

function normalizeThemeChoice(value) {
    return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function syncNativeThemeSource(settings) {}

function publicSettings(settings) {
    const next = {
        ...migrateSettings(settings)
    };
    next.agentBaseUrl = "";
    next.agentApiKey = "";
    next.imageBaseUrl = "";
    next.imageApiKey = "";
    delete next.serverToken;
    delete next.serverSessionCookie;
    delete next.serverUserId;
    return next;
}

function safeConnectionModels(value) {
    return uniqueModelIds(Array.isArray(value) ? value : []).slice(0, 1e4);
}

function safeImageModelNotes(value, allowedModels = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const availableByKey = new Map(safeConnectionModels(allowedModels).map(model => [ model.toLowerCase(), model ]));
    const notes = {};
    for (const [rawModel, rawNote] of Object.entries(value).slice(0, 100)) {
        const model = String(rawModel || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
        const canonicalModel = availableByKey.size ? availableByKey.get(model.toLowerCase()) : model;
        const note = String(rawNote || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
        canonicalModel && note && (notes[canonicalModel] = note);
    }
    return notes;
}

function initializeConnectionRuntime() {}

function providerPublicText(provider, value) {
    if (typeof provider?.scrubPublicText === "function") return provider.scrubPublicText(value);
    return String(value ?? "");
}

function workspaceRuntimeUnavailableError(message = "工作台尚未就绪，请重试。") {
    return Object.assign(new Error(message), {
        code: "WORKSPACE_RUNTIME_UNAVAILABLE"
    });
}

function redactSensitiveText(value) {
    return providerPublicText(providerRunStorage.getStore(), value).replace(/\bAYW-[A-Z2-9]{8}-[A-Z2-9]{8}-[A-Z2-9]{8}\b/gi, "AYW-[敏感信息已隐藏]").replace(/\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{8,})\b/g, "[敏感信息已隐藏]").replace(/((?:authorization|api[_-]?key|relay[_-]?token|access[_-]?token|refresh[_-]?token|token|session(?:id)?|cookie|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1[敏感信息已隐藏]").replace(/(?:^|[;\s])session=[^;\s]+/gi, " session=[敏感信息已隐藏]").replace(/([?&](?:token|key|secret|session|session_id)=)[^&\s]+/gi, "$1[敏感信息已隐藏]");
}

function log(message) {
    try {
        writeFileSync(electronLog, `[${(new Date).toISOString()}] ${redactSensitiveText(message)}\n`, {
            flag: "a",
            encoding: "utf8"
        });
    } catch {}
}

function logBoot(stage) {
    log(`boot +${Date.now() - bootStartedAt}ms ${stage}`);
}

function newProjectImageThumbnailCache() {
    return createThumbnailCache({
        workerPath: path.join(projectRoot, "desktop/images/image-thumbnail-worker.cjs"),
        log: message => log(`thumbnail ${message}`)
    });
}

let imageThumbnailCache = newProjectImageThumbnailCache();

let imageThumbnailCacheRecyclePromise = null;

async function currentImageThumbnailCache() {
    imageThumbnailCacheRecyclePromise && await imageThumbnailCacheRecyclePromise;
    assertWorkspaceAccessLease();
    if (!imageThumbnailCache) {
        if (quitting || workspaceRuntimeSuspended) {
            const error = new Error("工作台已停止，缩略图读取已停止。");
            error.code = "WORKSPACE_RUNTIME_UNAVAILABLE";
            throw error;
        }
        imageThumbnailCache = newProjectImageThumbnailCache();
    }
    return imageThumbnailCache;
}

function newProjectImageImporter() {
    return createImageImporter({
        workerPath: path.join(projectRoot, "desktop/images/image-import-worker.cjs"),
        maxConcurrentFiles: 4,
        log: message => log(`image-import ${message}`)
    });
}

let projectImageImporter = newProjectImageImporter();

let imageImporterRecyclePromise = null;

let imageImportCounters = {
    requests: 0,
    completed: 0,
    canceled: 0,
    errors: 0,
    active: 0,
    maxActiveRequests: 0,
    cancelRequests: 0,
    lastDurationMs: 0,
    lastSelectedCount: 0,
    lastImportedCount: 0,
    lastSkippedCount: 0,
    lastMaxActiveFiles: 0,
    lastWorkerPid: 0,
    lastErrorCode: ""
};

function imageImportStatus(reset = !1) {
    reset && imageImportCounters.active === 0 && (imageImportCounters = {
        requests: 0,
        completed: 0,
        canceled: 0,
        errors: 0,
        active: 0,
        maxActiveRequests: 0,
        cancelRequests: 0,
        lastDurationMs: 0,
        lastSelectedCount: 0,
        lastImportedCount: 0,
        lastSkippedCount: 0,
        lastMaxActiveFiles: 0,
        lastWorkerPid: 0,
        lastErrorCode: ""
    });
    return {
        ...imageImportCounters,
        maxConcurrentFiles: 4,
        mainProcessPid: process.pid,
        recycling: Boolean(imageImporterRecyclePromise),
        available: Boolean(projectImageImporter),
        quitting: quitting
    };
}

async function currentProjectImageImporter() {
    imageImporterRecyclePromise && await imageImporterRecyclePromise;
    assertWorkspaceAccessLease();
    if (!projectImageImporter) {
        if (quitting || workspaceRuntimeSuspended) throw new ImageImportError("IMAGE_IMPORT_CLOSED", "工作台已停止，图片导入已经关闭。");
        projectImageImporter = newProjectImageImporter();
    }
    return projectImageImporter;
}

function recycleProjectImageImporter(reopen = !0) {
    imageImportCounters.cancelRequests += 1;
    if (imageImporterRecyclePromise) return imageImporterRecyclePromise;
    const current = projectImageImporter;
    projectImageImporter = null;
    const closePromise = current ? current.close() : Promise.resolve();
    const task = Promise.resolve(closePromise).catch(error => log(`image-import close failed ${error instanceof Error ? error.message : String(error)}`)).then(() => {
        reopen && !quitting && (projectImageImporter = newProjectImageImporter());
    }).finally(() => {
        imageImporterRecyclePromise === task && (imageImporterRecyclePromise = null);
    });
    imageImporterRecyclePromise = task;
    return task;
}

function plainJsonObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonSnapshotHash(raw) {
    return createHash("sha256").update(raw).digest("hex");
}

function jsonBackupReason(value) {
    return String(value || "snapshot").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "snapshot";
}

function preserveJsonSnapshot(snapshot, reason = "snapshot") {
    if (!snapshot?.exists || !Buffer.isBuffer(snapshot.raw) || !snapshot.sha256) throw new Error("JSON 原始快照不可用，已停止覆盖。");
    const backupDir = path.join(path.dirname(snapshot.path), ".iiimage-json-backups");
    const stem = path.basename(snapshot.path).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 96) || "state.json";
    const baseName = `${stem}.${jsonBackupReason(reason)}.${snapshot.sha256}.bak`;
    let backupPath = path.join(backupDir, baseName);
    if (existsSync(backupPath)) {
        try {
            const existing = readFileSync(backupPath);
            if (existing.length === snapshot.raw.length && jsonSnapshotHash(existing) === snapshot.sha256) return {
                backupPath: backupPath,
                sha256: snapshot.sha256,
                byteLength: snapshot.raw.length,
                reused: !0
            };
        } catch {}
        backupPath = path.join(backupDir, `${baseName}.${randomBytes(6).toString("hex")}`);
    }
    const receipt = backupSnapshot(snapshot, backupPath);
    return {
        ...receipt,
        reused: !1
    };
}

function mergeJsonFallback(fallback, parsed) {
    if (plainJsonObject(fallback) && plainJsonObject(parsed)) return {
        ...fallback,
        ...parsed
    };
    return parsed === void 0 || parsed === null ? fallback : parsed;
}

function jsonWriteNeedsMigrationSnapshot(filePath, current, next) {
    if (!plainJsonObject(current) || !plainJsonObject(next)) return !1;
    const currentSchema = Number(current.schemaVersion || 0);
    const nextSchema = Number(next.schemaVersion || 0);
    if (Number.isFinite(nextSchema) && nextSchema > currentSchema) return !0;
    if (!String(current.projectKind || "").trim() && String(next.projectKind || "").trim()) return !0;
    if (plainJsonObject(current.project) && plainJsonObject(next.project)) {
        if (Number(next.project.schemaVersion || 0) > Number(current.project.schemaVersion || 0)) return !0;
        if (!String(current.project.kind || "").trim() && String(next.project.kind || "").trim()) return !0;
    }
    if (path.resolve(filePath) === path.resolve(projectListPath)) {
        const currentById = new Map((Array.isArray(current.projects) ? current.projects : []).map(project => [ String(project?.id || ""), project ]));
        return (Array.isArray(next.projects) ? next.projects : []).some(project => {
            const before = currentById.get(String(project?.id || ""));
            return before && (Number(project?.schemaVersion || 0) > Number(before?.schemaVersion || 0) || !String(before?.kind || "").trim() && String(project?.kind || "").trim());
        });
    }
    return !1;
}

function readJson(filePath, fallback) {
    assertWorkspaceAccessLease();
    const critical = [settingsPath, sessionPath, projectListPath].some(file => path.resolve(file) === path.resolve(filePath));
    const snapshot = inspectJson(filePath, critical ? { validate: plainJsonObject } : undefined);
    if (snapshot.status === "missing") {
        writeJson(filePath, fallback);
        return fallback;
    }
    if (snapshot.status === "valid") return mergeJsonFallback(fallback, snapshot.value);
    if (!critical && snapshot.status === "corrupt" && Buffer.isBuffer(snapshot.raw)) {
        const backup = preserveJsonSnapshot(snapshot, "corrupt-recovery");
        atomicWriteJson(filePath, fallback, {
            expectedInputSha256: snapshot.sha256
        });
        log(`read-json-recovered ${filePath} backup=${backup.backupPath} sha256=${snapshot.sha256}`);
        return fallback;
    }
    const error = new Error(`JSON 文件无法安全读取：${snapshot.error?.message || snapshot.status}`);
    error.code = snapshot.error?.code || "JSON_STORAGE_READ_FAILED";
    throw error;
}

function readStoredSession(filePath, fallback) {
    assertWorkspaceAccessLease();
    const snapshot = inspectJson(filePath, { validate: plainJsonObject });
    if (snapshot.status === "missing") return fallback;
    if (snapshot.status === "valid") return mergeJsonFallback(fallback, snapshot.value);
    const error = new Error(`画布资料暂时无法读取，原文件已保留：${filePath}`);
    error.code = snapshot.error?.code || "JSON_STORAGE_READ_FAILED";
    throw error;
}

function readJsonWithoutWrite(filePath, fallback) {
    assertWorkspaceAccessLease();
    const snapshot = inspectJson(filePath);
    if (snapshot.status === "missing") return fallback;
    if (snapshot.status === "valid") return snapshot.value && typeof snapshot.value === "object" ? snapshot.value : fallback;
    const code = snapshot.error?.code ? ` code=${snapshot.error.code}` : "";
    log(`read-json-readonly-failed ${filePath}:${code} ${snapshot.error?.message || snapshot.status}`);
    return fallback;
}

function writeJson(filePath, value, options = {}) {
    assertWorkspaceAccessLease();
    const snapshot = inspectJson(filePath);
    if (snapshot.status === "corrupt" || snapshot.status === "invalid") {
        const error = new Error(`JSON 文件已损坏或不可安全覆盖：${filePath}`);
        error.code = snapshot.error?.code || "JSON_STORAGE_WRITE_BLOCKED";
        throw error;
    }
    const shouldSnapshot = snapshot.status === "valid" && (Boolean(options.migrationReason) || jsonWriteNeedsMigrationSnapshot(filePath, snapshot.value, value));
    let backup = null;
    shouldSnapshot && (backup = preserveJsonSnapshot(snapshot, options.migrationReason || "schema-migration"));
    assertWorkspaceAccessLease();
    const receipt = atomicWriteJson(filePath, value, {
        expectedInputSha256: snapshot.status === "valid" ? snapshot.sha256 : null
    });
    backup && log(`json-migration-snapshot ${filePath} backup=${backup.backupPath} inputSha256=${backup.sha256} outputSha256=${receipt.outputSha256}`);
    return receipt;
}

function safeName(value, fallback = "项目") {
    const name = String(value || "").trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").slice(0, 48);
    return name || fallback;
}

function projectId() {
    return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const writingTemplateIds = new Set(Array.isArray(writingTemplateRegistry?.templates) ? writingTemplateRegistry.templates.map(template => String(template?.id || "").trim().toLowerCase()).filter(Boolean) : []);

const writingTemplateDefinitions = new Map(Array.isArray(writingTemplateRegistry?.templates) ? writingTemplateRegistry.templates.map(template => [ String(template?.id || "").trim().toLowerCase(), template ]).filter(([id]) => Boolean(id)) : []);

function normalizeWritingTemplate(value) {
    const template = String(value || "").trim().toLowerCase();
    return writingTemplateIds.has(template) ? template : "general";
}

function writingCanvasRoleForTemplate(kind, value, template, options = {}) {
    const role = writingCanvasRoleForKind(kind, value, options);
    if (role === "source-document") return role;
    const templateId = normalizeWritingTemplate(template);
    const allowedRoles = new Set(Array.isArray(writingTemplateDefinitions.get(templateId)?.canvasRoles) ? writingTemplateDefinitions.get(templateId).canvasRoles.map(String) : []);
    if (!allowedRoles.has(role)) {
        if (options.fallbackTemplateInvalid === !0) return writingCanvasRoleForKind(kind, "", {
            fallbackInvalid: !0
        });
        const error = new Error(`Writing ${templateId} 模板不允许 canvasRole=${role}。`);
        error.code = "WRITING_TEMPLATE_CANVAS_ROLE_INVALID";
        throw error;
    }
    return role;
}

function normalizedProjectExtensions(kind, value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? {
        ...value
    } : {};
    kind === "writing" ? source.writingTemplate = normalizeWritingTemplate(source.writingTemplate) : delete source.writingTemplate;
    return Object.keys(source).length ? source : void 0;
}

function normalizeProjectList(raw) {
    const base = defaultProjectList();
    const source = raw && typeof raw === "object" ? raw : {};
    const projects = Array.isArray(source.projects) ? source.projects : base.projects;
    const normalized = projects.map(item => {
        const id = String(item?.id || projectId());
        const external = Boolean(item?.external);
        const kindState = normalizedProjectKind(item?.kind, item?.quarantine);
        const projectPath = external ? String(item?.path || path.join(projectsDir, id)) : path.join(projectsDir, id);
        return {
            schemaVersion: 4,
            id: id,
            name: id === "default" && String(item?.name || "").trim() === "默认画布" ? "默认项目" : safeName(item?.name, id),
            kind: kindState.kind,
            path: projectPath,
            sessionPath: external ? String(item?.sessionPath || path.join(projectPath, "session.json")) : path.join(projectPath, "session.json"),
            createdAt: item?.createdAt || (new Date).toISOString(),
            updatedAt: item?.updatedAt || item?.createdAt || (new Date).toISOString(),
            external: external,
            ...kindState.quarantine ? {
                quarantine: kindState.quarantine
            } : {},
            ...normalizedProjectExtensions(kindState.kind, item?.extensions) ? {
                extensions: normalizedProjectExtensions(kindState.kind, item?.extensions)
            } : {}
        };
    }).filter(item => item.id && item.sessionPath);
    const activeProjectId = normalized.some(item => item.id === source.activeProjectId) ? source.activeProjectId : normalized[0]?.id || "";
    return {
        activeProjectId: activeProjectId,
        projects: normalized,
        projectsRoot: projectsDir,
        pathMappings: projectPathMappings({
            ...source,
            projects: normalized,
            projectsRoot: projectsDir
        })
    };
}

function readProjectList() {
    const list = normalizeProjectList(readJson(projectListPath, defaultProjectList()));
    if (!existsSync(projectListPath)) return list;
    const current = existingProjectRecords(list);
    if (current !== list) {
        writeJson(projectListPath, current);
        updateThumbnailProjectRootsCache(current);
    }
    return current;
}

function writeProjectList(list) {
    const next = normalizeProjectList(list);
    writeJson(projectListPath, next);
    updateThumbnailProjectRootsCache(next);
    return next;
}

function projectKindVisibleOnCurrentSurface(kind) {
    const capability = projectCapabilitiesByKind.get(String(kind || "").trim().toLowerCase());
    return capability ? projectCapabilityIsVisible(capability, projectSurface) : null;
}

function projectRecordVisibleOnCurrentSurface(project) {
    const visible = projectKindVisibleOnCurrentSurface(project?.kind);
    return visible === null ? Boolean(project?.quarantine?.readOnly) : visible;
}

function readMatrixWorkspaceBindings() {
    const file = path.join(configDir, "matrix", "workspace.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function projectListSnapshotForRenderer(list) {
    let bindings;
    try {
        bindings = readMatrixWorkspaceBindings();
    } catch {
        bindings = null;
    }
    const projects = (Array.isArray(list?.projects) ? list.projects : []).filter(projectRecordVisibleOnCurrentSurface).map(project => {
        const matrixProjectId = bindings?.projects?.[project.id]?.projectId;
        return {
            ...project,
            ...matrixProjectId ? {
                matrixProjectId: matrixProjectId
            } : {},
            empty: !matrixProjectId && bindings !== null && isEmptyManagedProject(project, projectsDir)
        };
    });
    const activeProjectId = projects.some(project => project.id === list?.activeProjectId) ? list.activeProjectId : projects[0]?.id || "";
    return {
        activeProjectId: activeProjectId,
        projects: projects,
        projectSurface: projectSurface
    };
}

function readProjectListForCurrentSurface() {
    const persistedList = readProjectList();
    const snapshot = projectListSnapshotForRenderer(persistedList);
    const list = snapshot.activeProjectId === persistedList.activeProjectId ? persistedList : {
        ...persistedList,
        activeProjectId: snapshot.activeProjectId
    };
    return {
        list: list,
        snapshot: snapshot
    };
}

function projectSurfaceUnavailableMessage(project) {
    const label = projectCapabilitiesByKind.get(String(project?.kind || "").trim().toLowerCase())?.label || "该项目类型";
    return `${label}未在当前产品版本开放。`;
}

let projectRegistryQueue = Promise.resolve();

function withProjectRegistryLock(operation) {
    if (typeof operation !== "function") return Promise.reject(new Error("项目索引操作无效。"));
    const task = projectRegistryQueue.catch(() => {}).then(operation);
    projectRegistryQueue = task;
    task.finally(() => {
        projectRegistryQueue === task && (projectRegistryQueue = Promise.resolve());
    }).catch(() => {});
    return task;
}

function publicProjectReconciliationError(error) {
    const code = String(error?.code || "");
    if (code.startsWith("AIEYRA_PROJECT_RECONCILIATION_")) return String(error?.message || "本地项目无法安全处理。").slice(0, 360);
    return "本地项目盘点失败，请稍后重试。";
}

function pruneProjectRecoveryAssessments(now = Date.now()) {
    for (const [assessmentId, entry] of projectRecoveryAssessmentCache) now - entry.createdAt > 6e5 && projectRecoveryAssessmentCache.delete(assessmentId);
    while (projectRecoveryAssessmentCache.size > 8) projectRecoveryAssessmentCache.delete(projectRecoveryAssessmentCache.keys().next().value);
}

function projectRecoveryAssessmentForRenderer() {
    const assessed = assessManagedProjects({
        projectsDir: projectsDir,
        projectListPath: projectListPath
    });
    const candidates = assessed.candidates.filter(candidate => projectKindVisibleOnCurrentSurface(candidate.kind) !== !1);
    const visibleCandidateIds = new Set(candidates.map(candidate => candidate.id));
    const assessmentId = randomBytes(12).toString("hex");
    const createdAt = Date.now();
    const internalCandidates = new Map(assessed.internalCandidates.filter(candidate => visibleCandidateIds.has(candidate.id)).map(candidate => [ candidate.id, candidate ]));
    projectRecoveryAssessmentCache.set(assessmentId, {
        createdAt: createdAt,
        internalCandidates: internalCandidates
    });
    pruneProjectRecoveryAssessments(createdAt);
    const displayNameById = new Map(candidates.map(candidate => [ candidate.id, candidate.name ]));
    const committedReceipts = projectMigrationTransactionManager.listReceipts().slice(-24).reverse().filter(entry => projectKindVisibleOnCurrentSurface(entry.receipt?.project?.kind) !== !1).map(entry => {
        const projectId = String(entry.receipt?.project?.id || "");
        return {
            transactionId: entry.transactionId,
            displayName: displayNameById.get(projectId) || "本地项目",
            completedAt: String(entry.receipt?.committedAt || entry.receipt?.createdAt || ""),
            rollbackAvailable: Boolean(entry.rollbackAvailable),
            summary: entry.rollbackAvailable ? "恢复完成，可安全回滚。" : "项目已有后续变化，回滚已锁定。"
        };
    });
    const statusCount = status => candidates.filter(candidate => candidate.status === status).length;
    const blocked = statusCount("unknown-kind") + statusCount("conflict") + statusCount("corrupt") + statusCount("unsafe");
    return {
        assessmentId: assessmentId,
        total: candidates.length,
        registered: statusCount("registered"),
        recoverable: statusCount("recoverable"),
        blocked: blocked,
        candidates: candidates.map(candidate => ({
            id: candidate.id,
            name: candidate.name,
            kind: candidate.kind,
            status: candidate.status,
            selectable: Boolean(candidate.selectable),
            fileCount: Number(candidate.fileCount || 0),
            byteLength: Number(candidate.byteLength || 0),
            risk: Array.isArray(candidate.risk) ? [ ...candidate.risk ] : []
        })),
        committedReceipts: committedReceipts
    };
}

function projectListAfterReconciliation() {
    const list = readProjectList();
    updateThumbnailProjectRootsCache(list);
    return list;
}

function updateThumbnailProjectRootsCache(list) {
    thumbnailProjectRootsCache = (Array.isArray(list?.projects) ? list.projects : []).filter(item => item?.path).map(item => ({
        projectPath: path.resolve(item.path),
        cacheRoot: path.join(path.resolve(item.path), projectMetaDirName, "thumbnails")
    }));
}

function thumbnailProjectRoots() {
    thumbnailProjectRootsCache || updateThumbnailProjectRootsCache(readProjectList());
    return thumbnailProjectRootsCache || [];
}

function getActiveProject(list = readProjectList()) {
    return list.projects.find(item => item.id === list.activeProjectId) || list.projects[0];
}

function getProjectById(projectId, list = readProjectList()) {
    const id = String(projectId || "");
    if (!id) return getActiveProject(list);
    return list.projects.find(item => item.id === id) || null;
}

function currentSessionPath() {
    return getActiveProject(readProjectList())?.sessionPath || sessionPath;
}

function createProjectRecord(name, externalPath = "", kind = "image", template = "general") {
    const id = projectId();
    const now = (new Date).toISOString();
    const projectPath = externalPath ? path.resolve(externalPath) : path.join(projectsDir, id);
    const kindState = normalizedProjectKind(kind);
    return {
        schemaVersion: 4,
        id: id,
        name: safeName(name, "未命名项目"),
        kind: kindState.kind,
        path: projectPath,
        sessionPath: path.join(projectPath, "session.json"),
        createdAt: now,
        updatedAt: now,
        external: Boolean(externalPath),
        ...kindState.kind === "writing" ? {
            extensions: {
                writingTemplate: normalizeWritingTemplate(template)
            }
        } : {},
        ...kindState.quarantine ? {
            quarantine: kindState.quarantine
        } : {}
    };
}

function projectReadOnlyReason(project) {
    if (!project?.quarantine?.readOnly) return "";
    if (project.quarantine.reason === "capability-disabled") return "该项目类型尚未开放，当前只能只读查看。";
    return `项目类型“${project.quarantine.originalKind || project.kind || "未知"}”不受当前版本支持，已进入只读隔离。`;
}

function assertProjectWritable(project, operation = "修改") {
    project?.kind === "writing" && workspaceModules.assertAvailable();
    if (!projectRecordVisibleOnCurrentSurface(project)) throw new Error(`${projectSurfaceUnavailableMessage(project)} 无法${operation}。`);
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    const effectiveProject = kindState.quarantine?.readOnly && !project?.quarantine?.readOnly ? {
        ...project,
        quarantine: kindState.quarantine
    } : project;
    const reason = projectReadOnlyReason(effectiveProject);
    if (!reason) return;
    throw new Error(`${reason} 无法${operation}。`);
}

function imageProjectForOperation(projectId, operation = "处理图片") {
    const list = readProjectList();
    const requestedProjectId = typeof projectId === "string" ? projectId.trim() : "";
    const project = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
    if (!project) throw new Error("图片目标项目不存在或已被移除。");
    assertProjectWritable(project, operation);
    if (normalizedProjectKind(project.kind, project.quarantine).supportedKind !== "image") throw new Error("当前项目不是图片项目，不能使用图片文件或执行链路。");
    return project;
}

function nextExternalProjectFolderPath(parentPath, name, list = readProjectList()) {
    const parent = path.resolve(parentPath);
    const baseName = safeName(name, "Aieyra Workspace 项目");
    const occupied = new Set((Array.isArray(list?.projects) ? list.projects : []).filter(item => item?.path).map(item => comparablePath(item.path)));
    for (let index = 1; index <= 9999; index += 1) {
        const folderName = index === 1 ? baseName : `${baseName} (${index})`;
        const candidate = path.join(parent, folderName);
        if (!existsSync(candidate) && !occupied.has(comparablePath(candidate))) return candidate;
    }
    throw new Error("所选目录下同名项目过多，请更换项目名称或保存位置。");
}

function projectForFolderOpen(list, projectId = "") {
    const requestedId = String(projectId || "").trim();
    return requestedId ? getProjectById(requestedId, list) : getActiveProject(list);
}

function projectManifestPath(projectOrPath) {
    const projectPath = typeof projectOrPath === "string" ? projectOrPath : projectOrPath?.path;
    return path.join(path.resolve(projectPath || projectRoot), projectMetaDirName, projectManifestFileName);
}

function readProjectManifest(projectOrPath) {
    const manifestPath = projectManifestPath(projectOrPath);
    const snapshot = inspectJson(manifestPath, {
        validate: plainJsonObject
    });
    if (snapshot.status === "missing") return null;
    if (snapshot.status === "valid") return snapshot.value;
    let backup = null;
    snapshot.exists && Buffer.isBuffer(snapshot.raw) && snapshot.sha256 && (backup = preserveJsonSnapshot(snapshot, "manifest-read-failure"));
    const error = new Error("项目清单损坏或无效，已停止把它当作缺失文件处理。" + (backup ? ` 原始字节已备份到 ${backup.backupPath}。` : ""));
    error.code = snapshot.status === "corrupt" ? "AIEYRA_PROJECT_MANIFEST_CORRUPT" : "AIEYRA_PROJECT_MANIFEST_INVALID";
    log(`project manifest read blocked ${manifestPath} status=${snapshot.status} sha256=${snapshot.sha256 || "unavailable"}`);
    throw error;
}

function projectRelativePath(projectPath, filePath) {
    if (!filePath || typeof filePath !== "string") return "";
    const resolvedProject = path.resolve(projectPath || projectRoot);
    const resolvedFile = path.resolve(filePath);
    if (!isPathInside(resolvedFile, resolvedProject)) return "";
    return path.relative(resolvedProject, resolvedFile).split(path.sep).join("/");
}

function normalizeFeedbackScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(-100, Math.round(number)));
}

function resolveProjectRelativePath(projectPath, relativePath) {
    if (!relativePath || typeof relativePath !== "string") return "";
    const resolvedProject = path.resolve(projectPath || projectRoot);
    const resolved = path.resolve(resolvedProject, relativePath);
    if (!isPathInside(resolved, resolvedProject)) return "";
    return resolved;
}

function collectAssetFiles(rootDir, maxFiles = 5e3) {
    const files = [];
    const imageExts = new Set([ ".png", ".jpg", ".jpeg", ".webp" ]);
    (function walk(dir) {
        if (files.length >= maxFiles || !existsSync(dir)) return;
        let entries = [];
        try {
            entries = readdirSync(dir, {
                withFileTypes: !0
            });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= maxFiles) break;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === ".git") continue;
                walk(fullPath);
            } else entry.isFile() && imageExts.has(path.extname(entry.name).toLowerCase()) && files.push(fullPath);
        }
    })(rootDir);
    return files;
}

function projectAssetRoots(projectPath) {
    const resolvedProject = path.resolve(projectPath || projectRoot);
    return [ path.join(resolvedProject, "output", "imagegen"), path.join(resolvedProject, "assets"), path.join(resolvedProject, projectMetaDirName, "assets"), path.join(resolvedProject, "output", "agent-attachments") ];
}

function projectAgentAttachmentRoot(projectPath) {
    return path.join(path.resolve(projectPath || projectRoot), "output", "agent-attachments");
}

function safeAgentPackageRelativePath(value) {
    const normalized = String(value || "").trim().replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) return "";
    const segments = normalized.split("/");
    if (segments.length !== 3 || segments[0] !== "output" || segments[1] !== "agent-attachments" || segments.some(segment => !segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f]/.test(segment))) return "";
    return normalized.slice(0, 1e3);
}

function controlledAgentAttachmentFile(filePath, projectPath) {
    if (!filePath || typeof filePath !== "string") return "";
    const resolvedProject = realPathIfPresent(projectPath || projectRoot);
    const root = projectAgentAttachmentRoot(projectPath);
    const candidate = path.resolve(filePath);
    if (!isComparablePathInside(candidate, root) || !existsSync(candidate)) return "";
    try {
        const rootInfo = existsSync(root) ? lstatSync(root) : null;
        if (rootInfo?.isSymbolicLink() || rootInfo && !rootInfo.isDirectory()) return "";
        const link = lstatSync(candidate);
        if (!link.isFile() || link.isSymbolicLink()) return "";
        const realRoot = realPathIfPresent(root);
        const realFile = realpathSync(candidate);
        if (!isComparablePathInside(realRoot, resolvedProject) || !isComparablePathInside(realFile, realRoot)) return "";
        return realFile;
    } catch {
        return "";
    }
}

function agentAttachmentPathFromReference(reference, projectPath) {
    if (!reference || typeof reference !== "object") return "";
    const absolute = typeof reference.path === "string" ? controlledAgentAttachmentFile(reference.path, projectPath) : "";
    if (absolute) return absolute;
    const relative = safeAgentPackageRelativePath(reference.relativePath);
    if (!relative) return "";
    return controlledAgentAttachmentFile(resolveProjectRelativePath(projectPath, relative), projectPath);
}

function sanitizedAgentAttachmentName(value, fallback = "attachment") {
    const source = path.basename(String(value || "").trim()).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 220);
    return source || fallback;
}

function agentAttachmentKindForPath(mimeType, filePath) {
    const mime = String(mimeType || "");
    if (/^image\//i.test(mime)) return "image";
    if (/^text\//i.test(mime)) return "text";
    const extension = path.extname(String(filePath || "")).toLowerCase();
    if ([ ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml", ".html", ".htm", ".yaml", ".yml" ].includes(extension)) return "text";
    if (/^(application\/pdf|application\/msword|application\/vnd\.)/i.test(mime)) return "document";
    return "other";
}

function normalizedAgentAttachmentForProject(reference, projectPath) {
    const filePath = agentAttachmentPathFromReference(reference, projectPath);
    if (!filePath) return null;
    try {
        const buffer = boundedImageRead(filePath, projectPackageMaximumAgentFileBytes, path.basename(filePath), "Agent 附件");
        if (!buffer.length) return null;
        path.extname(filePath).toLowerCase();
        const mimeType = String(reference?.mimeType || agentAttachmentMimeType(filePath)).trim().slice(0, 120) || "application/octet-stream";
        const contentHash = createHash("sha256").update(buffer).digest("hex");
        const item = {
            id: String(reference?.id || `file-${contentHash.slice(0, 24)}`).trim().slice(0, 160),
            name: sanitizedAgentAttachmentName(reference?.name, path.basename(filePath)),
            path: filePath,
            relativePath: projectRelativePath(projectPath, filePath),
            assetUrl: assetUrlFor(filePath),
            mimeType: mimeType,
            size: buffer.length,
            contentHash: contentHash,
            kind: [ "image", "text", "document", "other" ].includes(String(reference?.kind)) ? String(reference.kind) : agentAttachmentKindForPath(mimeType, filePath),
            ...typeof reference?.textPreview === "string" ? {
                textPreview: reference.textPreview.replace(/\u0000/g, "").slice(0, 12e3)
            } : {},
            ...reference?.textTruncated === !0 ? {
                textTruncated: !0
            } : {}
        };
        return item;
    } catch {
        return null;
    }
}

function mapSessionFileAttachments(session, mapper) {
    const mapMessages = messages => mapMessageAssetReferences(messages, item => item, mapper);
    return {
        ...session && typeof session === "object" ? session : {},
        messages: mapMessages(session?.messages),
        conversations: Array.isArray(session?.conversations) ? session.conversations.map(conversation => ({
            ...conversation,
            messages: mapMessages(conversation?.messages)
        })) : []
    };
}

function projectAssetValidation(projectPath) {
    const validation = {files: new Map, realProject: realPathIfPresent(projectPath), roots: []};
    for (const root of projectAssetRoots(projectPath)) try {
        validation.roots.push(realPathIfPresent(root));
    } catch { /* An unreadable optional asset root cannot authorize its files. */ }
    return validation;
}

function controlledProjectAssetFile(filePath, projectPath, validation) {
    if (!filePath || !existsSync(filePath)) return "";
    try {
        const stats = lstatSync(filePath);
        if (!stats.isFile() || stats.isSymbolicLink()) return "";
        const realProject = validation?.realProject ?? realPathIfPresent(projectPath);
        const realFile = realpathSync(filePath);
        const inside = realRoot => isComparablePathInside(realRoot, realProject) && isComparablePathInside(realFile, realRoot);
        const controlled = validation ? validation.roots.some(inside) : projectAssetRoots(projectPath).some(root => inside(realPathIfPresent(root)));
        return controlled ? realFile : "";
    } catch {
        return "";
    }
}

function controlledRecordedAssetUrl(asset = {}) {
    for (const value of [ asset.url, asset.assetUrl ]) {
        const source = typeof value === "string" ? value.trim() : "";
        if (/^https?:\/\//i.test(source) || /^data:image\/(?:png|jpe?g|webp);base64,/i.test(source)) return source;
    }
    return "";
}

function buildProjectAssetIndex(projectPath) {
    const roots = projectAssetRoots(projectPath);
    const files = roots.flatMap(root => collectAssetFiles(root));
    const byName = new Map;
    const byRunId = new Map;
    for (const filePath of files) {
        const basename = path.basename(filePath).toLowerCase();
        byName.has(basename) || byName.set(basename, []);
        byName.get(basename).push(filePath);
        const runMatch = basename.match(/(gen-[a-z0-9_-]+|cutout-[a-z0-9_-]+|agent-[a-z0-9_-]+|basic-[a-z0-9_-]+)/i);
        if (runMatch) {
            const runKey = runMatch[1].toLowerCase();
            byRunId.has(runKey) || byRunId.set(runKey, []);
            byRunId.get(runKey).push(filePath);
        }
    }
    return {
        files: files,
        byName: byName,
        byRunId: byRunId
    };
}

function hydrateAssetForProject(asset, project, assetIndex) {
    if (!asset || typeof asset !== "object") return null;
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    const next = {
        ...asset
    };
    const cache = project.assetHydrationCache;
    const controlledFile = filePath => {
        if (cache?.paths.has(filePath)) return cache.paths.get(filePath);
        const result = controlledProjectAssetFile(filePath, projectPath, cache?.validation);
        cache?.paths.set(filePath, result);
        return result;
    };
    const expectedHash = sessionAssetContentHash(next);
    const candidates = [];
    typeof next.relativePath === "string" && candidates.push({
        path: resolveProjectRelativePath(projectPath, next.relativePath),
        source: "relative"
    });
    typeof next.path === "string" && candidates.push({
        path: path.resolve(next.path),
        source: "recorded"
    });
    if (typeof next.fileName === "string") {
        const named = assetIndex?.byName?.get(String(next.fileName).toLowerCase());
        named?.length && (expectedHash || named.length === 1) && candidates.push(...named.map(filePath => ({
            path: filePath,
            source: "name"
        })));
    }
    if (next.runId) {
        const byRun = assetIndex?.byRunId?.get(String(next.runId).toLowerCase());
        if (byRun?.length) {
            const ordered = expectedHash ? byRun : [ byRun[Math.max(0, Number(next.index || 1) - 1)] || byRun[0] ];
            candidates.push(...ordered.map(filePath => ({
                path: filePath,
                source: "run"
            })));
        }
        const looseRun = assetIndex?.files?.filter(filePath => path.basename(filePath).toLowerCase().includes(String(next.runId).toLowerCase()));
        if (looseRun?.length) {
            const ordered = expectedHash ? looseRun : [ looseRun[Math.max(0, Number(next.index || 1) - 1)] || looseRun[0] ];
            candidates.push(...ordered.map(filePath => ({
                path: filePath,
                source: "run"
            })));
        }
    }
    const recordedControlledPath = typeof next.path === "string" ? controlledFile(next.path) : "";
    const seenCandidates = new Set;
    const found = candidates.map(candidate => {
        const controlled = controlledFile(candidate.path);
        if (!controlled) return "";
        const key = comparablePath(controlled);
        if (seenCandidates.has(key)) return "";
        seenCandidates.add(key);
        const needsHashVerification = Boolean(expectedHash && (candidate.source === "name" || candidate.source === "run" || !recordedControlledPath || comparablePath(recordedControlledPath) !== key));
        if (needsHashVerification) try {
            const actualHash = cache?.hashes.get(controlled) || createHash("sha256").update(boundedImageRead(controlled, maxExportImageBytes, path.basename(controlled), "项目图片")).digest("hex");
            cache?.hashes.set(controlled, actualHash);
            if (actualHash !== expectedHash) return "";
        } catch {
            return "";
        }
        return controlled;
    }).find(Boolean);
    if (found) {
        next.type = "file";
        next.path = found;
        next.relativePath = projectRelativePath(projectPath, found);
        next.fileName = path.basename(found);
        next.assetUrl = assetUrlFor(found);
        return next;
    }
    const recordedUrl = controlledRecordedAssetUrl(next);
    if (recordedUrl) {
        next.type = "url";
        /^https?:\/\//i.test(recordedUrl) ? next.url = recordedUrl : next.assetUrl = recordedUrl;
        return next;
    }
    return null;
}

function recoverNodeAssets(node, project, assetIndex) {
    const assets = Array.isArray(node.assets) ? node.assets.map(asset => hydrateAssetForProject(asset, project, assetIndex)).filter(Boolean) : [];
    if (assets.length > 0 || node.type !== "image") return assets;
    const runId = typeof node.generationRunId === "string" ? node.generationRunId.toLowerCase() : "";
    if (!runId || node.imageContainer || node.imageContainerSpec || node.imageCollection) return [];
    const byRun = runId ? assetIndex.byRunId.get(runId) : null;
    const escapedRunId = runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const generationFile = new RegExp(`^(?:(?:agent|basic)-)?${escapedRunId}(?:-\\d{2,3})?(?:-(?:\\d{1,3}|[a-f0-9]{16}))?\\.(?:png|jpe?g|webp)$`, "i");
    const files = byRun?.length ? byRun : assetIndex.files.filter(filePath => generationFile.test(path.basename(filePath)));
    return files.slice(0, Math.max(1, Number(node.outputs || 1))).map((filePath, index) => ({
        index: index + 1,
        type: "file",
        path: filePath,
        relativePath: projectRelativePath(project.path, filePath),
        fileName: path.basename(filePath),
        assetUrl: assetUrlFor(filePath),
        runId: node.generationRunId || ""
    }));
}

function mapMessageAssetReferences(messages, mapper, fileMapper) {
    return (Array.isArray(messages) ? messages : []).map(message => {
        if (!message || typeof message !== "object" || !message.attachments) return message;
        return {
            ...message,
            attachments: {
                ...message.attachments,
                sourceAssets: (Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets : []).map(mapper).filter(Boolean),
                referenceAssets: (Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets : []).map(mapper).filter(Boolean),
                contextAssets: (Array.isArray(message.attachments.contextAssets) ? message.attachments.contextAssets : []).map(mapper).filter(Boolean),
                fileAttachments: Array.isArray(message.attachments.fileAttachments) ? typeof fileMapper === "function" ? message.attachments.fileAttachments.map(fileMapper).filter(Boolean) : message.attachments.fileAttachments : []
            }
        };
    });
}

function mapNestedNodeAssetReferences(node, mapper) {
    return {
        ...node,
        imageParams: node.imageParams ? {
            ...node.imageParams,
            referenceImages: (Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages : []).map(mapper).filter(Boolean),
            maskImage: node.imageParams.maskImage ? mapper(node.imageParams.maskImage) || node.imageParams.maskImage : void 0
        } : node.imageParams,
        layerGroup: node.layerGroup ? {
            ...node.layerGroup,
            previewAsset: node.layerGroup.previewAsset && mapper(node.layerGroup.previewAsset) || void 0,
            mergedAsset: node.layerGroup.mergedAsset && mapper(node.layerGroup.mergedAsset) || void 0
        } : node.layerGroup,
        layerComposition: node.layerComposition ? {
            ...node.layerComposition,
            previewAsset: node.layerComposition.previewAsset && mapper(node.layerComposition.previewAsset) || void 0,
            mergedAsset: node.layerComposition.mergedAsset && mapper(node.layerComposition.mergedAsset) || void 0,
            layers: (Array.isArray(node.layerComposition.layers) ? node.layerComposition.layers : []).map(layer => ({
                ...layer,
                asset: layer?.asset && mapper(layer.asset) || void 0
            }))
        } : node.layerComposition
    };
}

function nestedSessionAssetReferences(session) {
    const references = [];
    for (const node of Array.isArray(session?.nodes) ? session.nodes : []) {
        references.push(...Array.isArray(node?.imageParams?.referenceImages) ? node.imageParams.referenceImages : []);
        node?.imageParams?.maskImage && references.push(node.imageParams.maskImage);
        node?.layerGroup?.previewAsset && references.push(node.layerGroup.previewAsset);
        node?.layerGroup?.mergedAsset && references.push(node.layerGroup.mergedAsset);
        node?.layerComposition?.previewAsset && references.push(node.layerComposition.previewAsset);
        node?.layerComposition?.mergedAsset && references.push(node.layerComposition.mergedAsset);
        for (const layer of Array.isArray(node?.layerComposition?.layers) ? node.layerComposition.layers : []) layer?.asset && references.push(layer.asset);
    }
    const messages = [ ...Array.isArray(session?.messages) ? session.messages : [], ...Array.isArray(session?.conversations) ? session.conversations.flatMap(conversation => Array.isArray(conversation?.messages) ? conversation.messages : []) : [] ];
    for (const message of messages) {
        references.push(...Array.isArray(message?.attachments?.sourceAssets) ? message.attachments.sourceAssets : []);
        references.push(...Array.isArray(message?.attachments?.referenceAssets) ? message.attachments.referenceAssets : []);
        references.push(...Array.isArray(message?.attachments?.contextAssets) ? message.attachments.contextAssets : []);
    }
    return references.filter(reference => reference && typeof reference === "object");
}

function sessionWithProjectAssets(session, project, options = {}) {
    const source = sanitizeSession(session);
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    const normalizedProject = {
        ...project,
        path: projectPath
    };
    Object.defineProperty(normalizedProject, "assetHydrationCache", {
        value: {
            paths: new Map,
            hashes: new Map,
            validation: projectAssetValidation(projectPath)
        }
    });
    const validatedNodes = source.nodes.map(node => {
        const recordedAssets = Array.isArray(node.assets) ? node.assets : [];
        const assets = recordedAssets.map(asset => hydrateAssetForProject(asset, normalizedProject, null));
        const missingRecordedAssets = assets.some(asset => !asset);
        const missingExpectedAssets = node.type === "image" && recordedAssets.length === 0 && !node.imageContainer && !node.imageContainerSpec && !node.imageCollection && typeof node.generationRunId === "string" && Boolean(node.generationRunId.trim()) && (Number(node.outputs || 0) > 0 || node.imageState === "done" || node.status === "done");
        return {
            node: node,
            recordedAssets: recordedAssets,
            assets: assets,
            needsRecovery: missingRecordedAssets || missingExpectedAssets
        };
    });
    const nestedReferences = nestedSessionAssetReferences(source);
    const nestedMissingCount = nestedReferences.filter(reference => !hydrateAssetForProject(reference, normalizedProject, null)).length;
    const needsRecovery = validatedNodes.some(item => item.needsRecovery) || nestedMissingCount > 0;
    const assetIndex = needsRecovery ? typeof options.buildAssetIndex === "function" ? options.buildAssetIndex(projectPath) : buildProjectAssetIndex(projectPath) : null;
    options.onAssetIndex?.({
        projectPath: projectPath,
        scanned: Boolean(assetIndex),
        missingNodeCount: validatedNodes.filter(item => item.needsRecovery).length + nestedMissingCount
    });
    const hydrateReference = reference => hydrateAssetForProject(reference, normalizedProject, assetIndex);
    const hydrateFileAttachment = reference => normalizedAgentAttachmentForProject(reference, projectPath);
    const nodes = validatedNodes.map(({node: node, recordedAssets: recordedAssets, assets: validatedAssets, needsRecovery: nodeNeedsRecovery}) => {
        let assets = validatedAssets.filter(Boolean);
        nodeNeedsRecovery && assetIndex && (assets = recordedAssets.length > 0 ? recordedAssets.map((asset, index) => validatedAssets[index] || hydrateAssetForProject(asset, normalizedProject, assetIndex)).filter(Boolean) : recoverNodeAssets({
            ...node,
            assets: []
        }, normalizedProject, assetIndex));
        if (node.type !== "image") return mapNestedNodeAssetReferences({
            ...node,
            assets: assets
        }, hydrateReference);
        const done = assets.length > 0;
        return mapNestedNodeAssetReferences({
            ...node,
            assets: assets,
            imageState: done ? "done" : node.imageState,
            status: done ? "done" : node.status,
            outputs: Math.max(Number(node.outputs || 0), assets.length)
        }, hydrateReference);
    });
    const messages = mapMessageAssetReferences(source.messages, hydrateReference, hydrateFileAttachment);
    const conversations = Array.isArray(source.conversations) ? source.conversations.map(conversation => ({
        ...conversation,
        messages: mapMessageAssetReferences(conversation.messages, hydrateReference, hydrateFileAttachment)
    })) : [];
    return sanitizeSession({
        ...source,
        nodes: nodes,
        messages: messages,
        conversations: conversations
    });
}

function assetForProjectSave(asset, projectPath, validation) {
    if (!asset || typeof asset !== "object") return asset;
    const next = {
        ...asset
    };
    const controlledFile = filePath => {
        if (validation?.files.has(filePath)) return validation.files.get(filePath);
        const resolved = controlledProjectAssetFile(filePath, projectPath, validation);
        validation?.files.set(filePath, resolved);
        return resolved;
    };
    const controlledCurrent = typeof next.path === "string" ? controlledFile(next.path) : "";
    const safeRelativeTarget = typeof next.relativePath === "string" ? resolveProjectRelativePath(projectPath, next.relativePath) : "";
    const controlledRelative = safeRelativeTarget ? controlledFile(safeRelativeTarget) : "";
    const resolved = controlledCurrent || controlledRelative;
    if (resolved) {
        next.path = resolved;
        next.relativePath = projectRelativePath(projectPath, resolved);
        next.fileName = path.basename(resolved);
        next.assetUrl = assetUrlFor(resolved);
    } else {
        typeof next.path === "string" && next.path.trim() && (next.path = path.resolve(next.path));
        safeRelativeTarget ? next.relativePath = projectRelativePath(projectPath, safeRelativeTarget) : delete next.relativePath;
        typeof next.assetUrl === "string" && next.assetUrl.startsWith("iiimage-asset:") && delete next.assetUrl;
    }
    return next;
}

function writingArtifactsAreFileBacked(session) {
    const artifacts = Array.isArray(session?.artifacts) ? session.artifacts : [];
    return artifacts.every(artifact => typeof artifact?.relativePath === "string" && artifact.relativePath.startsWith(".iiimage/writing/artifacts/"));
}

function writingSessionForProject(session, project, mode = "save") {
    const source = session && typeof session === "object" ? session : {};
    const base = sanitizeSession({
        ...source,
        nodes: [],
        layoutGroups: [],
        selectedNodeId: ""
    });
    const projectTemplate = normalizeWritingTemplate(project?.extensions?.writingTemplate);
    const applyTemplateRolePolicy = current => ({
        ...current,
        artifacts: (Array.isArray(current?.artifacts) ? current.artifacts : []).map(artifact => ({
            ...artifact,
            attributes: {
                ...artifact.attributes && typeof artifact.attributes === "object" && !Array.isArray(artifact.attributes) ? artifact.attributes : {},
                canvasRole: writingCanvasRoleForTemplate(artifact.kind, artifact.attributes?.canvasRole, normalizeWritingTemplate(artifact.attributes?.writingTemplate || projectTemplate), {
                    fallbackTemplateInvalid: !0
                }),
                writingTemplate: normalizeWritingTemplate(artifact.attributes?.writingTemplate || projectTemplate)
            }
        }))
    });
    const sanitizedWriting = applyTemplateRolePolicy(sanitizeWritingSession(source, project));
    if (!writingArtifactsAreFileBacked(sanitizedWriting)) {
        const error = new Error("Writing session 包含未托管在受控文件中的正文；当前版本拒绝继续内联保存，请从可校验的项目包或备份迁移。");
        error.code = "WRITING_FILE_BACKING_REQUIRED";
        throw error;
    }
    const writing = applyTemplateRolePolicy(sanitizedWriting.artifacts.length ? mode === "load" ? hydrateWritingSession(sanitizedWriting, project.path, project) : dehydrateWritingSession(sanitizedWriting, project.path, project) : sanitizedWriting);
    return {
        ...base,
        ...writing,
        schemaVersion: 4,
        projectKind: "writing",
        sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || base.sessionRevision || 0))),
        canvasRevision: Math.max(0, Math.floor(Number(source.canvasRevision || base.canvasRevision || 0))),
        nodeSequence: 0,
        nodes: [],
        layoutGroups: [],
        selectedNodeId: ""
    };
}

function lineageSessionForProject(session, project, mode = "save") {
    const source = session && typeof session === "object" ? session : {};
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    const projectKind = kindState.supportedKind;
    if (![ "data", "finance" ].includes(String(projectKind))) throw new Error("当前项目不是 Data/Finance 项目。");
    const base = sanitizeSession({
        ...source,
        nodes: [],
        layoutGroups: [],
        selectedNodeId: ""
    });
    const sanitized = sanitizeLineageSession(source, project);
    const lineage = sanitized.lineageArtifacts.length ? mode === "load" ? hydrateLineageSession(sanitized, project.path, project) : dehydrateLineageSession(sanitized, project) : sanitized;
    return {
        ...base,
        ...lineage,
        schemaVersion: 4,
        projectKind: projectKind,
        sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || base.sessionRevision || 0))),
        canvasRevision: 0,
        nodeSequence: 0,
        nodes: [],
        layoutGroups: [],
        selectedNodeId: ""
    };
}

function sessionForProjectSave(session, project) {
    assertProjectWritable(project, "保存");
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    if (kindState.supportedKind === "writing") return writingSessionForProject(session, project);
    if ([ "data", "finance" ].includes(String(kindState.supportedKind))) return lineageSessionForProject(session, project);
    if (![ "image", "agent" ].includes(kindState.supportedKind)) throw new Error(`项目类型“${kindState.kind}”尚无可用保存器。`);
    const source = sanitizeSession(session);
    const projectPath = path.resolve(project?.path || path.dirname(project?.sessionPath || sessionPath));
    // A snapshot can contain thousands of references to the same file. Share
    // validation only within this synchronous normalization; recheck next save.
    const validation = projectAssetValidation(projectPath);
    const normalizeAsset = asset => assetForProjectSave(asset, projectPath, validation);
    const normalizeFileAttachment = attachment => normalizedAgentAttachmentForProject(attachment, projectPath);
    return {
        ...source,
        ...kindState.supportedKind === "agent" ? {
            schemaVersion: 4,
            projectKind: "agent"
        } : {},
        nodes: source.nodes.map(node => mapNestedNodeAssetReferences({
            ...node,
            assets: Array.isArray(node.assets) ? node.assets.map(normalizeAsset).filter(Boolean) : []
        }, normalizeAsset)),
        messages: mapMessageAssetReferences(source.messages, normalizeAsset, normalizeFileAttachment),
        conversations: Array.isArray(source.conversations) ? source.conversations.map(conversation => ({
            ...conversation,
            messages: mapMessageAssetReferences(conversation.messages, normalizeAsset, normalizeFileAttachment)
        })) : []
    };
}

function writeProjectManifest(project, session) {
    if (!project?.path) return;
    const normalizedSession = project?.quarantine?.readOnly ? session && typeof session === "object" ? session : defaultSessionForProject(project) : sessionForProjectSave(session, project);
    writeNormalizedManifest(project, normalizedSession);
}

// Only consume a snapshot prepared for this project in the current operation.
// Raw callers keep the normalization and validation in writeProjectManifest.
function writeNormalizedManifest(project, normalizedSession) {
    if (!project?.path) return;
    const projectPath = path.resolve(project.path);
    const assets = [];
    for (const node of Array.isArray(normalizedSession.nodes) ? normalizedSession.nodes : []) for (const asset of node.assets || []) assets.push({
        nodeId: node.id,
        assetId: asset.assetId || "",
        displayCode: asset.displayCode || "",
        contentHash: asset.contentHash || "",
        index: asset.index,
        type: asset.type,
        path: asset.relativePath || projectRelativePath(projectPath, asset.path),
        fileName: asset.fileName || (asset.path ? path.basename(asset.path) : ""),
        runId: asset.runId || "",
        revisedPrompt: asset.revisedPrompt || ""
    });
    const manifest = {
        format: "iiimage-project",
        version: 2,
        updatedAt: (new Date).toISOString(),
        project: {
            schemaVersion: 4,
            id: project.id,
            name: project.name,
            kind: project.kind || "image",
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            ...project.extensions && typeof project.extensions === "object" ? {
                extensions: project.extensions
            } : {}
        },
        sessionRevision: Math.max(0, Math.floor(Number(normalizedSession.sessionRevision || 0))),
        assets: assets
    };
    writeJson(projectManifestPath(projectPath), manifest);
}

function writingMutationProjectKey(project) {
    return path.resolve(String(project?.path || ""));
}

function lineageMutationProjectKey(project) {
    return path.resolve(String(project?.path || ""));
}

function writingTransactionActiveError(projectId) {
    const error = new Error(`Writing 项目 ${projectId || ""} 正在提交事务，已停止并发读取或恢复。`);
    error.code = "WRITING_TRANSACTION_ACTIVE";
    return error;
}

function lineageTransactionActiveError(projectId) {
    const error = new Error(`Data/Finance 项目 ${projectId || ""} 正在提交事务，已停止并发读取或恢复。`);
    error.code = "LINEAGE_TRANSACTION_ACTIVE";
    return error;
}

function writingModuleUnavailable(project) {
    return project?.kind === "writing" && workspaceModules.status().state !== "installed";
}

function projectSessionFromDisk(project) {
    if (writingModuleUnavailable(project)) return {
        ...readJsonWithoutWrite(project.sessionPath, {}),
        projectKind: "writing",
        projectReadOnly: !0,
        moduleUnavailable: !0
    };
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    if (!kindState.quarantine?.readOnly) {
        const resetRecovery = recoverProjectManagedDataReset(project);
        resetRecovery.recovered && log(`project managed reset recovery project=${project.id} actions=${resetRecovery.actions.join(",")}`);
    }
    const projectDefaultSession = defaultSessionForProject(project);
    if (kindState.quarantine?.readOnly) {
        const opaque = readJsonWithoutWrite(project.sessionPath, projectDefaultSession);
        return {
            ...opaque,
            projectKind: project.kind,
            projectReadOnly: !0,
            projectQuarantine: kindState.quarantine
        };
    }
    const hasSessionFile = existsSync(project.sessionPath);
    const rawSession = hasSessionFile ? readStoredSession(project.sessionPath, projectDefaultSession) : projectDefaultSession;
    if (kindState.supportedKind === "writing") {
        if (activeWritingMutationProjects.has(writingMutationProjectKey(project))) throw writingTransactionActiveError(project.id);
        const recovery = recoverWritingMutationJournal(project.path, rawSession, project);
        recovery.recovered && log(`writing journal recovery project=${project.id} action=${recovery.action} mutations=${recovery.mutationCount}`);
        const normalizedWritingSession = writingSessionForProject(rawSession, project, "load");
        if (!hasSessionFile) {
            writeJson(project.sessionPath, normalizedWritingSession);
            writeProjectManifest(project, normalizedWritingSession);
        }
        return normalizedWritingSession;
    }
    if ([ "data", "finance" ].includes(String(kindState.supportedKind))) {
        if (activeLineageMutationProjects.has(lineageMutationProjectKey(project))) throw lineageTransactionActiveError(project.id);
        const recovery = recoverLineageMutationJournal(project.path, rawSession, project);
        recovery.recovered && log(`lineage journal recovery project=${project.id} action=${recovery.action} mutations=${recovery.mutationCount}`);
        const normalizedLineageSession = lineageSessionForProject(rawSession, project, "load");
        if (!hasSessionFile) {
            writeJson(project.sessionPath, lineageSessionForProject(normalizedLineageSession, project, "save"));
            writeProjectManifest(project, normalizedLineageSession);
        }
        return normalizedLineageSession;
    }
    const manifest = readProjectManifest(project);
    const legacyManifestSession = Number(manifest?.version || 1) < 2 && manifest?.session && typeof manifest.session === "object" ? manifest.session : null;
    const shouldMigrateLegacySession = Boolean(legacyManifestSession && !sessionHasContent(rawSession) && sessionHasContent(legacyManifestSession));
    const sourceSession = shouldMigrateLegacySession ? legacyManifestSession : rawSession;
    const sourceRevision = shouldMigrateLegacySession || hasSessionFile ? sourceSession?.sessionRevision ?? manifest?.sessionRevision : manifest?.sessionRevision;
    const sessionRevision = Math.max(0, Math.floor(Number(sourceRevision ?? 0) || 0));
    const hydratedSession = sessionWithProjectAssets({
        ...sourceSession,
        sessionRevision: sessionRevision
    }, project);
    if (shouldMigrateLegacySession || !hasSessionFile) {
        const normalizedSession = sessionForProjectSave(hydratedSession, project);
        writeJson(project.sessionPath, normalizedSession, shouldMigrateLegacySession ? {
            migrationReason: "legacy-manifest-session-migration"
        } : void 0);
        writeProjectManifest(project, normalizedSession);
    }
    return kindState.supportedKind === "agent" ? {
        ...hydratedSession,
        schemaVersion: 4,
        projectKind: "agent"
    } : hydratedSession;
}

function normalizeSessionRevision(value) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function projectSessionRevisionFromDisk(project) {
    if (!project) return 0;
    const hasSessionFile = existsSync(project.sessionPath);
    const rawSession = hasSessionFile ? project.quarantine?.readOnly ? readJsonWithoutWrite(project.sessionPath, defaultSessionForProject(project)) : readStoredSession(project.sessionPath, defaultSessionForProject(project)) : null;
    const sessionRevision = normalizeSessionRevision(rawSession?.sessionRevision);
    if (hasSessionFile && sessionRevision !== null) return sessionRevision;
    return normalizeSessionRevision(readProjectManifest(project)?.sessionRevision) ?? 0;
}

const writingProjectOperationQueues = new Map;

function withWritingProjectLock(projectId, operation) {
    const key = String(projectId || "").trim();
    if (!key) return Promise.reject(new Error("Writing 操作缺少 projectId。"));
    const previous = writingProjectOperationQueues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    writingProjectOperationQueues.set(key, task);
    task.finally(() => {
        writingProjectOperationQueues.get(key) === task && writingProjectOperationQueues.delete(key);
    }).catch(() => {});
    return task;
}

const lineageProjectOperationQueues = new Map;

function withLineageProjectLock(projectId, operation) {
    const key = String(projectId || "").trim();
    if (!key) return Promise.reject(new Error("Data/Finance 操作缺少 projectId。"));
    const previous = lineageProjectOperationQueues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    lineageProjectOperationQueues.set(key, task);
    task.finally(() => {
        lineageProjectOperationQueues.get(key) === task && lineageProjectOperationQueues.delete(key);
    }).catch(() => {});
    return task;
}

function resolveAgentProjectScope(payload = {}, operation = "Agent 执行") {
    const projectId = String(payload?.projectId || "").trim();
    const conversationId = String(payload?.conversationId || "").trim();
    if (!projectId || projectId.length > 160 || projectId.includes("\0")) throw new Error("Agent 请求必须提供有效 projectId。");
    if (!conversationId || conversationId.length > 160 || conversationId.includes("\0")) throw new Error("Agent 请求必须提供有效 conversationId。");
    const project = getProjectById(projectId, readProjectList());
    if (!project) throw new Error("Agent 目标项目不存在或已被移除。");
    assertProjectWritable(project, operation);
    const kindState = normalizedProjectKind(project.kind, project.quarantine);
    const kind = kindState.supportedKind;
    const capability = kind ? projectCapabilitiesByKind.get(kind) : null;
    if (!kind || !capability || capability.status !== "available") throw new Error("Agent 目标项目类型尚未开放或无法识别。");
    return Object.freeze({
        projectId: project.id,
        projectName: String(project.name || "项目").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 160) || "项目",
        conversationId: conversationId,
        kind: kind,
        writingTemplate: kind === "writing" ? normalizeWritingTemplate(project.extensions?.writingTemplate) : void 0,
        projectPath: path.resolve(project.path),
        ...kind === "agent" ? (() => {
            const owner = Object.entries(readMatrixWorkspaceBindings().projects || {}).find(([, binding]) => binding.projectId === project.id);
            return owner ? {
                canvasProjectId: owner[0]
            } : {};
        })() : {},
        agentAccessMode: "full",
        capabilityRevision: String(projectCapabilityRegistry.capabilityRevision || ""),
        allowedTools: Object.freeze((Array.isArray(capability.allowedTools) ? capability.allowedTools : []).map(String)),
        defaultPromptOverlay: String(capability.defaultPromptOverlay || "")
    });
}

function projectForTrustedAgentScope(scope, operation = "Agent 执行") {
    if (!scope || typeof scope !== "object") throw new Error("Agent 项目作用域缺失。");
    const project = getProjectById(String(scope.projectId || ""), readProjectList());
    if (!project) throw new Error("Agent 目标项目在执行期间已被移除。");
    assertProjectWritable(project, operation);
    const kindState = normalizedProjectKind(project.kind, project.quarantine);
    if (kindState.supportedKind !== scope.kind || path.resolve(project.path) !== path.resolve(String(scope.projectPath || ""))) throw new Error("Agent 目标项目类型或路径在执行期间发生变化，已停止写入。");
    return project;
}

function writingRendererSession(session) {
    if (!session || typeof session !== "object") return session;
    if (session.moduleUnavailable) return {
        ...session,
        artifacts: []
    };
    return {
        ...session,
        artifacts: (Array.isArray(session.artifacts) ? session.artifacts : []).map(artifact => {
            if (!isPdfWritingSourceArtifact(artifact)) return artifact;
            return {
                ...stripWritingArtifactContent(artifact),
                paragraphs: [],
                revisions: [],
                reviewFindings: []
            };
        })
    };
}

function isPdfWritingSourceArtifact(artifact) {
    return artifact?.kind === "source-document" && artifact?.provenance?.source?.format === "pdf";
}

function projectPackageFailure(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function validateProjectPackageImportOwnershipBoundary(packageData) {
    const reserved = String(projectImportOwnershipMarkerName || "").toLowerCase();
    const claimsReservedMarker = value => typeof value === "string" && value.trim().replace(/\\/g, "/").split("/").some(segment => segment.toLowerCase() === reserved);
    const pending = [ packageData ];
    const visited = new WeakSet;
    while (pending.length) {
        const current = pending.pop();
        if (!current || typeof current !== "object" || visited.has(current)) continue;
        visited.add(current);
        for (const [key, value] of Object.entries(current)) {
            if (claimsReservedMarker(key) || claimsReservedMarker(value)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_RESERVED_PATH", `portable 项目包不得携带或声明保留的导入 ownership marker：${projectImportOwnershipMarkerName}`);
            value && typeof value === "object" && pending.push(value);
        }
    }
}

function validateProjectPackageSessionShape(session) {
    if (!session || typeof session !== "object" || Array.isArray(session)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "项目包缺少有效会话数据。");
    const nodes = Array.isArray(session.nodes) ? session.nodes : [];
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const conversations = Array.isArray(session.conversations) ? session.conversations : [];
    const artifacts = Array.isArray(session.artifacts) ? session.artifacts : [];
    const lineageArtifacts = Array.isArray(session.lineageArtifacts) ? session.lineageArtifacts : [];
    if (nodes.length > 5e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "画布节点超过 5000 个，无法安全导入或导出。");
    if (artifacts.length > 1e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "写作 artifact 超过 1000 个，无法安全导入或导出。");
    if (lineageArtifacts.length > 2e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Data/Finance artifact 超过 2000 个，无法安全导入或导出。");
    if (messages.length > 1e4 || conversations.length > 1e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "画布会话或消息数量过多，无法安全导入或导出。");
    let conversationMessages = 0;
    for (const conversation of conversations) {
        conversationMessages += Array.isArray(conversation?.messages) ? conversation.messages.length : 0;
        if (conversationMessages > 1e4) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "画布历史消息数量过多，无法安全导入或导出。");
    }
    let serialized;
    try {
        serialized = JSON.stringify(session);
    } catch {
        throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "画布会话无法序列化。");
    }
    if (Buffer.byteLength(serialized, "utf8") > 16777216) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "画布会话数据超过 16MB，无法安全导入或导出。");
}

function estimatedBase64DecodedBytes(value) {
    const data = String(value || "");
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return -1;
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return data.length / 4 * 3 - padding;
}

function safeWritingPackageRelativePath(value) {
    const normalized = String(value || "").trim().replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) return "";
    const segments = normalized.split("/");
    if (segments.some(segment => !segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f]/.test(segment))) return "";
    if (segments[0] !== ".iiimage" || segments[1] !== "writing") return "";
    const extension = path.extname(segments.at(-1) || "").toLowerCase();
    const sourceFile = segments.length === 5 && segments[2] === "sources" && [ ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xlsx", ".doc", ".docx", ".ppt", ".pptx", ".pdf", ".html", ".htm" ].includes(extension);
    const pdfIndexFile = segments.length === 5 && segments[2] === "sources" && segments[4] === "page-index.v1.json";
    const currentFile = segments.length === 5 && segments[2] === "artifacts" && /^current\.(?:txt|md)$/i.test(segments[4]);
    const revisionFile = segments.length === 5 && segments[2] === "revisions" && /^\d{8}\.json$/.test(segments[4]);
    return sourceFile || pdfIndexFile || currentFile || revisionFile || officeRelativePath(normalized) || writingIllustrations.relativePath(normalized) ? normalized : "";
}

function maximumWritingPackageFileBytes(relativePath) {
    if (writingIllustrations.relativePath(relativePath)) return writingIllustrations.MAX_BYTES;
    if (officeRelativePath(relativePath) || /\/sources\/[^/]+\/[^/]+\.(?:docx?|pptx?)$/i.test(relativePath)) return OFFICE_MAX_BYTES;
    if (/\/sources\/[^/]+\/[^/]+\.pdf$/i.test(relativePath)) return 67108864;
    if (/\/sources\/[^/]+\/page-index\.v1\.json$/.test(relativePath)) return 25165824;
    return 33554432;
}

function validateWritingPackageFiles(packageData, kindState) {
    const files = Array.isArray(packageData.writingFiles) ? packageData.writingFiles : [];
    const artifacts = Array.isArray(packageData?.session?.artifacts) ? packageData.session.artifacts : [];
    if (files.length > 4e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Writing 项目文件超过 4000 个，无法安全导入。");
    if (files.length && kindState.supportedKind !== "writing") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "非 Writing 项目包不能包含 writingFiles。");
    if (kindState.supportedKind === "writing") {
        if (artifacts.some(artifact => artifact && typeof artifact === "object" && (Object.hasOwn(artifact, "paragraphs") || Object.hasOwn(artifact, "revisions")))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INLINE_WRITING_REJECTED", "Writing 项目包包含内联正文或 revision；当前版本只接受带 SHA-256 的受控 writingFiles。");
        if (artifacts.length && !files.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_WRITING_FILES_REQUIRED", "Writing 项目包缺少受控 writingFiles，已拒绝把 JSON 描述当作正文导入。");
        if (!artifacts.length && files.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Writing 项目包包含没有 artifact 描述的孤立文件。");
    }
    const seen = new Set;
    const fileHashes = new Map;
    let decodedBytes = 0;
    for (const file of files) {
        if (!file || typeof file !== "object" || typeof file.data !== "string") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Writing 项目包包含缺失数据的文件。");
        const relativePath = safeWritingPackageRelativePath(file.relativePath);
        if (!relativePath || seen.has(relativePath.toLowerCase())) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Writing 项目包包含越界或重复路径。");
        seen.add(relativePath.toLowerCase());
        const estimatedBytes = estimatedBase64DecodedBytes(file.data);
        if (estimatedBytes < 0 || estimatedBytes > maximumWritingPackageFileBytes(relativePath)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Writing 项目包单文件无效或超过对应格式限制。");
        const buffer = Buffer.from(file.data, "base64");
        const declaredHash = String(file.sha256 || "").toLowerCase();
        const actualHash = createHash("sha256").update(buffer).digest("hex");
        if (!/^[a-f0-9]{64}$/.test(declaredHash) || declaredHash !== actualHash || buffer.length !== estimatedBytes) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Writing 项目包文件 SHA-256 校验失败。");
        fileHashes.set(relativePath.toLowerCase(), actualHash);
        decodedBytes += buffer.length;
        if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Writing 项目包文件总量超过 128 MiB。");
    }
    if (kindState.supportedKind === "writing") for (const artifact of artifacts) {
        const relativePath = safeWritingPackageRelativePath(artifact?.relativePath);
        const revision = Math.max(1, Math.floor(Number(artifact?.revision) || 1));
        const artifactId = String(artifact?.id || "").trim();
        const revisionPath = `.iiimage/writing/revisions/${artifactId}/${String(revision).padStart(8, "0")}.json`;
        if (!relativePath || !seen.has(relativePath.toLowerCase()) || !seen.has(revisionPath.toLowerCase())) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_WRITING_FILES_REQUIRED", `Writing artifact“${artifactId || "未命名"}”缺少 current 或当前 revision 文件。`);
        const sourcePath = safeWritingPackageRelativePath(artifact?.provenance?.source?.relativePath);
        if (sourcePath && !seen.has(sourcePath.toLowerCase())) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_WRITING_FILES_REQUIRED", `Writing artifact“${artifactId || "未命名"}”缺少只读导入源副本。`);
        const source = artifact?.provenance?.source;
        const pdfIndexPath = `.iiimage/writing/sources/${artifactId}/page-index.v1.json`;
        if (source?.format === "pdf") {
            const expectedIndexSha256 = String(source?.pdf?.indexSha256 || "").toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(expectedIndexSha256) || fileHashes.get(pdfIndexPath.toLowerCase()) !== expectedIndexSha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_WRITING_FILES_REQUIRED", `Writing PDF artifact“${artifactId || "未命名"}”缺少匹配的页索引。`);
        } else if (seen.has(pdfIndexPath.toLowerCase())) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `非 PDF Writing artifact“${artifactId || "未命名"}”包含 PDF 页索引。`);
    }
    return {
        files: files,
        decodedBytes: decodedBytes
    };
}

function collectWritingPackageFiles(projectPath) {
    const root = path.join(path.resolve(projectPath), projectMetaDirName, "writing");
    if (!existsSync(root)) return [];
    const files = [];
    const officeFiles = new Set;
    const revisionsRoot = path.join(root, "revisions");
    if (existsSync(revisionsRoot)) for (const directory of readdirSync(revisionsRoot, {
        withFileTypes: !0
    })) {
        if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
        for (const revision of readdirSync(path.join(revisionsRoot, directory.name))) {
            if (!/^\d{8}\.json$/.test(revision)) continue;
            const record = JSON.parse(readFileSync(path.join(revisionsRoot, directory.name, revision), "utf8"));
            for (const image of record.provenance?.illustrations || []) officeFiles.add(image.relativePath);
            if (record.provenance?.office) {
                officeFiles.add(record.provenance.office.relativePath);
                officeFiles.add(record.provenance.office.previewRelativePath);
            }
        }
    }
    (function walk(directory) {
        for (const entry of readdirSync(directory, {
            withFileTypes: !0
        })) {
            if (entry.isSymbolicLink()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Writing 受控目录包含符号链接，已停止导出。");
            const candidate = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (path.resolve(candidate) === path.resolve(root, "exports")) continue;
                walk(candidate);
                continue;
            }
            if (!entry.isFile()) continue;
            if (path.resolve(directory) === path.resolve(root) && (entry.name === "mutation-journal.json" || /^\.mutation-journal\.json\.(?:0|[1-9]\d*)\.[a-f0-9]{16}\.tmp$/i.test(entry.name))) continue;
            if (files.length >= 4e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Writing 受控文件过多，已停止导出。");
            const relativePath = path.relative(projectPath, candidate).split(path.sep).join("/");
            if ((officeRelativePath(relativePath) || writingIllustrations.relativePath(relativePath)) && !officeFiles.has(relativePath)) continue;
            if (/^\.iiimage\/writing\/illustrations\/[a-f0-9]{64}\.png\.[a-f0-9-]+\.tmp$/.test(relativePath)) continue;
            if (/^\.iiimage\/writing\/office\/[a-f0-9]{64}\.(?:docx?|pptx?|png)\.\d+\.tmp$/.test(relativePath)) continue;
            if (!safeWritingPackageRelativePath(relativePath)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Writing 受控目录出现未知文件：${entry.name}`);
            const info = lstatSync(candidate);
            if (info.isSymbolicLink() || !info.isFile() || info.size > maximumWritingPackageFileBytes(relativePath)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", `Writing 文件无效或过大：${entry.name}`);
            const buffer = readFileSync(candidate);
            files.push({
                relativePath: relativePath,
                byteLength: buffer.length,
                sha256: createHash("sha256").update(buffer).digest("hex"),
                data: buffer.toString("base64")
            });
        }
    })(root);
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function portableLineageArtifactId(value) {
    const raw = String(value || "");
    if (raw.length < 1 || raw.length > 180) return "";
    return /^[a-zA-Z0-9_](?:[a-zA-Z0-9._-]{0,178}[a-zA-Z0-9_])?$/.test(raw) ? raw : "";
}

function portableLineageSourceName(value) {
    const fileName = String(value || "");
    if (!fileName || fileName.length > 220 || fileName !== path.basename(fileName) || /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/.test(fileName) || /[. ]$/.test(fileName)) return null;
    const match = /^([a-f0-9]{12})-(.+)$/.exec(fileName);
    const extension = path.extname(fileName).toLowerCase();
    if (!match || ![ ".csv", ".tsv", ".json", ".xlsx" ].includes(extension)) return null;
    return {
        fileName: fileName,
        hashPrefix: match[1],
        extension: extension
    };
}

function lineagePackagePathInfo(value) {
    const raw = String(value || "");
    if (!raw || raw !== raw.trim() || raw.includes("\\") || raw.startsWith("/") || /^[a-z]:/i.test(raw)) return null;
    const segments = raw.split("/");
    if (segments.some(segment => !segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f-\u009f]/.test(segment))) return null;
    if (segments[0] !== ".iiimage" || segments[1] !== "lineage") return null;
    if (segments.length === 4 && segments[2] === "sources") {
        const source = portableLineageSourceName(segments[3]);
        return source ? {
            relativePath: raw,
            type: "source",
            ...source
        } : null;
    }
    const artifactId = portableLineageArtifactId(segments[3]);
    if (segments[2] !== "artifacts" || !artifactId) return null;
    if (segments.length === 5 && segments[4] === "current.json") return {
        relativePath: raw,
        type: "current",
        artifactId: artifactId
    };
    const revisionMatch = segments.length === 6 && segments[4] === "revisions" ? /^r([1-9]\d{0,8})\.json$/.exec(segments[5]) : null;
    if (!revisionMatch) return null;
    const revision = Number(revisionMatch[1]);
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    return {
        relativePath: raw,
        type: "revision",
        artifactId: artifactId,
        revision: revision
    };
}

function lineagePackageRelativeDirectoryAllowed(relativePathInput) {
    const relativePath = String(relativePathInput || "").replace(/\\/g, "/");
    if ([ ".iiimage/lineage", ".iiimage/lineage/sources", ".iiimage/lineage/artifacts" ].includes(relativePath)) return !0;
    const segments = relativePath.split("/");
    if (segments.length === 4 && segments[0] === ".iiimage" && segments[1] === "lineage" && segments[2] === "artifacts" && portableLineageArtifactId(segments[3])) return !0;
    return Boolean(segments.length === 5 && segments[0] === ".iiimage" && segments[1] === "lineage" && segments[2] === "artifacts" && segments[4] === "revisions" && portableLineageArtifactId(segments[3]));
}

function lineagePackageDirectoryAllowed(projectPath, candidate) {
    return lineagePackageRelativeDirectoryAllowed(path.relative(projectPath, candidate).split(path.sep).join("/"));
}

function lineagePathInsideRealRoot(candidate, realRoot) {
    const resolved = realpathSync(candidate);
    if (!isComparablePathInside(resolved, realRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 受控路径经解析后越过项目边界。");
    return resolved;
}

function stableLineagePackageFileRead(candidate, realRoot, maximum, label) {
    const before = lstatSync(candidate);
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > maximum) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", `Lineage 文件无效或过大：${label}`);
    const realBefore = lineagePathInsideRealRoot(candidate, realRoot);
    const buffer = readFileSync(candidate);
    const after = lstatSync(candidate);
    const realAfter = lineagePathInsideRealRoot(candidate, realRoot);
    if (after.isSymbolicLink() || !after.isFile() || buffer.length !== before.size || after.size !== before.size || realBefore !== realAfter || before.mtimeMs !== after.mtimeMs) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 文件读取期间发生变化：${label}`);
    return buffer;
}

function collectLineagePackageFiles(projectPath) {
    const projectRoot = path.resolve(projectPath);
    const root = path.join(projectRoot, projectMetaDirName, "lineage");
    if (!existsSync(root)) return [];
    const rootInfo = lstatSync(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 受控根目录不是普通目录，已停止导出。");
    const realRoot = realpathSync(root);
    const files = [];
    let decodedBytes = 0;
    (function walk(directory) {
        const directoryInfo = lstatSync(directory);
        if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 受控目录包含链接或非目录条目，已停止导出。");
        lineagePathInsideRealRoot(directory, realRoot);
        for (const entry of readdirSync(directory, {
            withFileTypes: !0
        })) {
            const candidate = path.join(directory, entry.name);
            const relativeFromLineageRoot = path.relative(root, candidate).split(path.sep).join("/");
            if (path.resolve(directory) === path.resolve(root) && (entry.name === "mutation-journal.json" || /^mutation-journal\.json\.tmp-(?:0|[1-9]\d*)-[a-f0-9-]{36}$/i.test(entry.name))) continue;
            if (entry.isSymbolicLink()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 受控目录包含符号链接，已停止导出。");
            if (entry.isDirectory()) {
                if (!lineagePackageDirectoryAllowed(projectRoot, candidate)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 受控目录出现未知目录：${relativeFromLineageRoot}`);
                walk(candidate);
                continue;
            }
            if (!entry.isFile()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 受控目录出现非普通文件：${relativeFromLineageRoot}`);
            if (files.length >= 12e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Lineage 受控文件过多，已停止导出。");
            const relativePath = path.relative(projectRoot, candidate).split(path.sep).join("/");
            const pathInfo = lineagePackagePathInfo(relativePath);
            if (!pathInfo) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 受控目录出现未知文件：${relativeFromLineageRoot}`);
            const maximum = pathInfo.type === "source" ? 33554432 : 50331648;
            const buffer = stableLineagePackageFileRead(candidate, realRoot, maximum, relativePath);
            decodedBytes += buffer.length;
            if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Lineage 受控文件总量超过 128 MiB。");
            files.push({
                relativePath: relativePath,
                byteLength: buffer.length,
                sha256: createHash("sha256").update(buffer).digest("hex"),
                data: buffer.toString("base64")
            });
        }
    })(root);
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function canonicalProjectPackageValue(value) {
    if (Array.isArray(value)) return value.map(canonicalProjectPackageValue);
    if (!value || typeof value !== "object") return value;
    const output = {};
    for (const key of Object.keys(value).sort()) value[key] !== void 0 && (output[key] = canonicalProjectPackageValue(value[key]));
    return output;
}

function canonicalProjectPackageEqual(left, right) {
    return JSON.stringify(canonicalProjectPackageValue(left)) === JSON.stringify(canonicalProjectPackageValue(right));
}

function lineageSessionDescriptorShape(session) {
    const source = session && typeof session === "object" ? session : {};
    return {
        schemaVersion: source.schemaVersion,
        projectKind: source.projectKind,
        lineageRevision: source.lineageRevision,
        lineageArtifacts: source.lineageArtifacts,
        lineageEdges: source.lineageEdges,
        lineageLayout: source.lineageLayout,
        lineageViewport: source.lineageViewport,
        selectedLineageArtifactId: source.selectedLineageArtifactId
    };
}

function validateCanonicalLineageSessionDescriptor(session, projectKind, projectId) {
    if (!session || typeof session !== "object" || Array.isArray(session) || session.projectKind !== projectKind || !Array.isArray(session.lineageArtifacts) || !Array.isArray(session.lineageEdges) || !Array.isArray(session.lineageLayout) || Array.isArray(session.nodes) && session.nodes.length || Array.isArray(session.artifacts) && session.artifacts.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Data/Finance session descriptor 缺失或混入其他项目类型数据。");
    let canonical;
    try {
        canonical = dehydrateLineageSession(sanitizeLineageSession(session, {
            id: projectId,
            kind: projectKind
        }), {
            id: projectId,
            kind: projectKind
        });
    } catch (error) {
        const failure = projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage session descriptor 校验失败：${error instanceof Error ? error.message : String(error)}`);
        failure.cause = error;
        throw failure;
    }
    if (!canonicalProjectPackageEqual(lineageSessionDescriptorShape(session), lineageSessionDescriptorShape(canonical))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage session descriptor 不是规范结构，已拒绝静默修剪或迁移。");
    return canonical;
}

function strictLineagePackageStoredArtifact(entry, descriptor, sourceProjectId, projectKind) {
    let stored;
    try {
        stored = JSON.parse(entry.buffer.toString("utf8"));
    } catch {
        throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage artifact JSON 损坏：${entry.relativePath}`);
    }
    const expectedRevision = entry.pathInfo.type === "current" ? Number(descriptor.revision) : entry.pathInfo.revision;
    if (!stored || typeof stored !== "object" || Array.isArray(stored) || Number(stored.formatVersion) !== 1 || stored.artifactId !== descriptor.id || stored.projectId !== sourceProjectId || stored.projectKind !== projectKind || stored.kind !== descriptor.kind || Number(stored.revision) !== expectedRevision || !Number.isFinite(Date.parse(String(stored.generatedAt || ""))) || !stored.content || typeof stored.content !== "object" || Array.isArray(stored.content)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage artifact 元数据不一致：${entry.relativePath}`);
    const canonicalBytes = Buffer.from(`${JSON.stringify(stored, null, 2)}\n`, "utf8");
    if (!canonicalBytes.equals(entry.buffer)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage artifact 文件不是规范 JSON：${entry.relativePath}`);
    try {
        validateLineageStoredContent(stored.content, descriptor.kind, projectKind, entry.pathInfo.type === "current" ? descriptor.finance : void 0);
    } catch (error) {
        const failure = projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage artifact 内容无效：${entry.relativePath}：${error instanceof Error ? error.message : String(error)}`);
        failure.cause = error;
        throw failure;
    }
    return stored;
}

function validateLineagePackageFiles(packageData, kindState) {
    const files = Array.isArray(packageData.lineageFiles) ? packageData.lineageFiles : [];
    const artifacts = Array.isArray(packageData?.session?.lineageArtifacts) ? packageData.session.lineageArtifacts : [];
    const edges = Array.isArray(packageData?.session?.lineageEdges) ? packageData.session.lineageEdges : [];
    const layout = Array.isArray(packageData?.session?.lineageLayout) ? packageData.session.lineageLayout : [];
    const projectKind = String(kindState.supportedKind || "");
    const lineageKind = [ "data", "finance" ].includes(projectKind);
    if (files.length > 12e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Lineage 项目文件超过 12000 个，无法安全导入。");
    if (!lineageKind) {
        if (files.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "非 Data/Finance 项目包不能包含 lineageFiles。");
        if ([ "image", "writing" ].includes(projectKind) && (artifacts.length || edges.length || layout.length)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "非 Data/Finance 项目包不能包含 lineage descriptor。");
        return {
            files: [],
            entries: [],
            decodedBytes: 0
        };
    }
    if (Number(packageData.version) !== 3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_UNSUPPORTED", "Data/Finance portable 项目只支持带完整性清单的 v3 包。");
    if (artifacts.length > 2e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Lineage artifact 数量超过安全限制。");
    if (artifacts.some(artifact => artifact && typeof artifact === "object" && Object.hasOwn(artifact, "payload"))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INLINE_LINEAGE_REJECTED", "Lineage 项目包不能把受控内容内联到 session descriptor。");
    if (artifacts.length && !files.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_LINEAGE_FILES_REQUIRED", "Lineage 项目包缺少 current、revision 或 source 受控文件。");
    if (!artifacts.length && files.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 项目包包含没有 artifact descriptor 的孤立文件。");
    const rawSourceProjectId = String(packageData?.project?.id || "");
    const sourceProjectId = rawSourceProjectId.trim();
    if (!sourceProjectId || rawSourceProjectId !== sourceProjectId || sourceProjectId.length > 180 || /[\u0000-\u001f\u007f-\u009f]/.test(sourceProjectId)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 项目包缺少合法 source projectId。");
    const canonicalSession = validateCanonicalLineageSessionDescriptor(packageData.session, projectKind, sourceProjectId);
    const entries = [];
    const entryByPath = new Map;
    let decodedBytes = 0;
    for (const file of files) {
        if (!file || typeof file !== "object" || typeof file.data !== "string") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 项目包包含缺失数据的文件。");
        const pathInfo = lineagePackagePathInfo(file.relativePath);
        const lookupKey = pathInfo?.relativePath.toLowerCase() || "";
        if (!pathInfo || entryByPath.has(lookupKey)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage 项目包包含越界或重复路径。");
        const estimatedBytes = estimatedBase64DecodedBytes(file.data);
        const maximum = pathInfo.type === "source" ? 33554432 : 50331648;
        if (estimatedBytes <= 0 || estimatedBytes > maximum || !Number.isSafeInteger(file.byteLength) || file.byteLength !== estimatedBytes) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Lineage 项目包单文件大小无效或超过限制。");
        const buffer = Buffer.from(file.data, "base64");
        const actualHash = createHash("sha256").update(buffer).digest("hex");
        if (buffer.length !== estimatedBytes || buffer.toString("base64") !== file.data || !/^[a-f0-9]{64}$/.test(String(file.sha256 || "")) || actualHash !== file.sha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 文件 SHA-256 或 Base64 校验失败：${pathInfo.relativePath}`);
        if (pathInfo.type === "source" && pathInfo.hashPrefix !== actualHash.slice(0, 12)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage source 文件名与 SHA-256 身份不一致：${pathInfo.relativePath}`);
        decodedBytes += buffer.length;
        if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Lineage 项目包文件总量超过 128 MiB。");
        const entry = {
            relativePath: pathInfo.relativePath,
            pathInfo: pathInfo,
            buffer: buffer,
            sha256: actualHash,
            byteLength: buffer.length
        };
        entries.push(entry);
        entryByPath.set(lookupKey, entry);
    }
    const capability = projectCapabilitiesByKind.get(projectKind);
    const allowedArtifactKinds = new Set(Array.isArray(capability?.allowedArtifactKinds) ? capability.allowedArtifactKinds : []);
    const descriptorById = new Map;
    for (const artifact of canonicalSession.lineageArtifacts) {
        const id = String(artifact?.id || "");
        if (!portableLineageArtifactId(id) || descriptorById.has(id)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage artifactId 无效或重复。");
        const revision = Number(artifact.revision);
        const contentSha256 = String(artifact.contentSha256 || "").toLowerCase();
        const relativePath = String(artifact.relativePath || "");
        if (artifact.projectId !== sourceProjectId || artifact.projectKind !== projectKind || !allowedArtifactKinds.has(artifact.kind) || !Number.isSafeInteger(revision) || revision < 1 || revision > 12e3 || !/^[a-f0-9]{64}$/.test(contentSha256) || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 2 || artifact.byteLength > 50331648 || artifact.mimeType !== "application/vnd.iiimage.lineage+json" || !Number.isFinite(Date.parse(String(artifact.createdAt || ""))) || !Number.isFinite(Date.parse(String(artifact.updatedAt || ""))) || relativePath !== `.iiimage/lineage/artifacts/${id}/current.json`) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage artifact descriptor 无效：${id || "unknown"}`);
        descriptorById.set(id, artifact);
    }
    const expectedPaths = new Set;
    const revisionHashByArtifact = new Map;
    const storedRevisionByArtifact = new Map;
    const referencedSources = new Map;
    for (const descriptor of descriptorById.values()) {
        const currentPath = `.iiimage/lineage/artifacts/${descriptor.id}/current.json`;
        const currentEntry = entryByPath.get(currentPath.toLowerCase());
        if (!currentEntry) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_LINEAGE_FILES_REQUIRED", `Lineage artifact 缺少 current：${descriptor.id}`);
        strictLineagePackageStoredArtifact(currentEntry, descriptor, sourceProjectId, projectKind);
        if (currentEntry.sha256 !== String(descriptor.contentSha256).toLowerCase() || currentEntry.byteLength !== Number(descriptor.byteLength)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage current 与 descriptor SHA/size 不一致：${descriptor.id}`);
        expectedPaths.add(currentPath.toLowerCase());
        const revisionHashes = new Map;
        const storedRevisions = new Map;
        for (let revision = 1; revision <= Number(descriptor.revision); revision += 1) {
            const revisionPath = `.iiimage/lineage/artifacts/${descriptor.id}/revisions/r${revision}.json`;
            const revisionEntry = entryByPath.get(revisionPath.toLowerCase());
            if (!revisionEntry) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_LINEAGE_FILES_REQUIRED", `Lineage artifact 缺少 revision ${revision}：${descriptor.id}`);
            const storedRevision = strictLineagePackageStoredArtifact(revisionEntry, descriptor, sourceProjectId, projectKind);
            revisionHashes.set(revision, revisionEntry.sha256);
            storedRevisions.set(revision, storedRevision);
            expectedPaths.add(revisionPath.toLowerCase());
            if (revision === Number(descriptor.revision) && (!revisionEntry.buffer.equals(currentEntry.buffer) || revisionEntry.sha256 !== currentEntry.sha256)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage current 与最新 revision 不一致：${descriptor.id}`);
        }
        revisionHashByArtifact.set(descriptor.id, revisionHashes);
        storedRevisionByArtifact.set(descriptor.id, storedRevisions);
        const provenance = descriptor.provenance && typeof descriptor.provenance === "object" ? descriptor.provenance : {};
        if (String(provenance.outputSha256 || "") !== currentEntry.sha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage provenance output SHA 不一致：${descriptor.id}`);
        const sourceIds = Array.isArray(descriptor.sourceArtifactIds) ? descriptor.sourceArtifactIds.map(String) : [];
        const source = provenance.source;
        const sourceHistory = Array.isArray(provenance.sourceHistory) ? provenance.sourceHistory : source && typeof source === "object" ? [ {
            artifactRevision: Number(descriptor.revision),
            ...source
        } ] : [];
        const importableRootKinds = projectKind === "data" ? new Set([ "dataset" ]) : new Set([ "market-data", "financial-statement", "portfolio" ]);
        if (!sourceIds.length && (!source || typeof source !== "object" || !importableRootKinds.has(descriptor.kind))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 根 artifact 缺少匹配的只读 source：${descriptor.id}`);
        if (sourceIds.length && (source && typeof source === "object" || sourceHistory.length)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 派生 artifact 不能冒充外部导入源：${descriptor.id}`);
        if (source && typeof source === "object") {
            if (!sourceHistory.length || sourceHistory.length > 256 || sourceHistory.length > Number(descriptor.revision)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 根 artifact 的 source history 数量无效：${descriptor.id}`);
            const latestHistory = sourceHistory[sourceHistory.length - 1];
            const {artifactRevision: _artifactRevision, ...latestSource} = latestHistory;
            if (Number(latestHistory.artifactRevision) !== Number(descriptor.revision) || !canonicalProjectPackageEqual(latestSource, source)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage current source 与 source history 尾项不一致：${descriptor.id}`);
            let previousSourceRevision = 0;
            const historyPaths = new Set;
            const historyShas = new Set;
            for (const historySource of sourceHistory) {
                const historyRevision = Number(historySource.artifactRevision);
                const originalName = String(historySource.originalName || "");
                const importedAt = String(historySource.importedAt || "");
                if (!Number.isSafeInteger(historyRevision) || historyRevision <= previousSourceRevision || historyRevision > Number(descriptor.revision) || !originalName || originalName.length > 240 || path.basename(originalName) !== originalName || /[\u0000-\u001f\u007f]/.test(originalName) || Number.isNaN(Date.parse(importedAt))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage source history 条目无效：${descriptor.id}`);
                const sourceInfo = lineagePackagePathInfo(historySource.relativePath);
                if (!sourceInfo || sourceInfo.type !== "source") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage provenance source history 路径无效：${descriptor.id}`);
                const historyPathKey = sourceInfo.relativePath.toLowerCase();
                const historySha = String(historySource.sha256 || "");
                if (historyPaths.has(historyPathKey) || historyShas.has(historySha)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage source history 包含重复来源：${descriptor.id}`);
                const sourceEntry = entryByPath.get(sourceInfo.relativePath.toLowerCase());
                if (!sourceEntry || sourceInfo.hashPrefix !== sourceEntry.sha256.slice(0, 12) || sourceEntry.sha256 !== String(historySource.sha256 || "") || !Number.isSafeInteger(historySource.byteLength) || sourceEntry.byteLength !== historySource.byteLength) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_LINEAGE_FILES_REQUIRED", `Lineage artifact 缺少匹配的历史 source：${descriptor.id} r${historySource.artifactRevision}`);
                expectedPaths.add(sourceInfo.relativePath.toLowerCase());
                referencedSources.set(sourceInfo.relativePath.toLowerCase(), sourceEntry);
                previousSourceRevision = historyRevision;
                historyPaths.add(historyPathKey);
                historyShas.add(historySha);
            }
        }
    }
    for (const descriptor of descriptorById.values()) {
        const sourceIds = Array.isArray(descriptor.sourceArtifactIds) ? descriptor.sourceArtifactIds.map(String) : [];
        const inputs = Array.isArray(descriptor?.provenance?.inputs) ? descriptor.provenance.inputs : [];
        if (new Set(sourceIds).size !== sourceIds.length || inputs.length !== sourceIds.length || inputs.some((input, index) => String(input?.artifactId || "") !== sourceIds[index])) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage provenance inputs 与 sourceArtifactIds 不一致：${descriptor.id}`);
        for (const input of inputs) {
            const sourceDescriptor = descriptorById.get(String(input.artifactId || ""));
            const inputRevision = Number(input.revision);
            const inputSha256 = String(input.sha256 || "").toLowerCase();
            if (!sourceDescriptor || !Number.isSafeInteger(inputRevision) || inputRevision < 1 || inputRevision > Number(sourceDescriptor.revision) || !/^[a-f0-9]{64}$/.test(inputSha256) || revisionHashByArtifact.get(sourceDescriptor.id)?.get(inputRevision) !== inputSha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage provenance input revision/SHA 无效：${descriptor.id}`);
        }
    }
    const embeddedRevisionSha = (artifactId, revision, label) => {
        const sourceDescriptor = descriptorById.get(String(artifactId || ""));
        const numericRevision = Number(revision);
        const sha256 = revisionHashByArtifact.get(sourceDescriptor?.id)?.get(numericRevision);
        if (!sourceDescriptor || !Number.isSafeInteger(numericRevision) || numericRevision < 1 || numericRevision > Number(sourceDescriptor.revision) || !sha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} 指向不存在的 artifact revision。`);
        return {
            sourceDescriptor: sourceDescriptor,
            sha256: sha256
        };
    };
    const scenarioOptionsFromStoredContent = content => {
        const workbook = content?.workbook;
        const assumptions = new Map((Array.isArray(workbook?.assumptions) ? workbook.assumptions : []).map(item => [ item?.id, item ]));
        return {
            title: workbook?.title,
            metricKey: workbook?.metric?.key,
            upsidePercent: assumptions.get("upside")?.adjustmentPercent,
            stressPercent: assumptions.get("stress")?.adjustmentPercent
        };
    };
    for (const descriptor of descriptorById.values()) for (const [revision, stored] of storedRevisionByArtifact.get(descriptor.id) || []) {
        if (descriptor.kind === "scenario-workbook") {
            const snapshots = Array.isArray(stored.content?.workbook?.sources) ? stored.content.workbook.sources : [];
            const boundSources = [];
            for (const snapshot of snapshots) {
                const expected = embeddedRevisionSha(snapshot?.artifactId, snapshot?.revision, `Finance scenario workbook ${descriptor.id} r${revision} source`);
                if (![ "valuation", "portfolio" ].includes(expected.sourceDescriptor.kind) || snapshot.kind !== expected.sourceDescriptor.kind || snapshot.sha256 !== expected.sha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Finance scenario workbook ${descriptor.id} r${revision} 内嵌 source revision/SHA 无效。`);
                const sourceStored = storedRevisionByArtifact.get(expected.sourceDescriptor.id)?.get(Number(snapshot.revision));
                if (!sourceStored || sourceStored.kind !== snapshot.kind || !sourceStored.content || typeof sourceStored.content !== "object") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Finance scenario workbook ${descriptor.id} r${revision} 缺少历史 source payload。`);
                boundSources.push({
                    id: expected.sourceDescriptor.id,
                    kind: sourceStored.kind,
                    title: snapshot.title,
                    revision: Number(snapshot.revision),
                    sha256: expected.sha256,
                    finance: sourceStored.content.finance,
                    content: sourceStored.content
                });
            }
            let canonicalContent;
            try {
                canonicalContent = canonicalScenarioWorkbookContentFromSources(boundSources, scenarioOptionsFromStoredContent(stored.content));
            } catch (error) {
                const failure = projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Finance scenario workbook ${descriptor.id} r${revision} 历史 canonical source binding 失败：${error instanceof Error ? error.message : String(error)}`);
                failure.cause = error;
                throw failure;
            }
            if (JSON.stringify(stored.content) !== JSON.stringify(canonicalContent)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Finance scenario workbook ${descriptor.id} r${revision} content 未逐字绑定历史 canonical source。`);
            if (revision === Number(descriptor.revision)) {
                const inputs = Array.isArray(descriptor.provenance?.inputs) ? descriptor.provenance.inputs : [];
                if (JSON.stringify(snapshots.map(source => ({
                    artifactId: source.artifactId,
                    revision: source.revision,
                    sha256: source.sha256
                }))) !== JSON.stringify(inputs)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Finance scenario workbook ${descriptor.id} current source 快照与 provenance 不一致。`);
            }
        }
        if (descriptor.kind === "presentation") for (const [slideIndex, slide] of (Array.isArray(stored.content?.slides) ? stored.content.slides : []).entries()) for (const [kind, reference] of [ [ "citation", slide?.citation ], [ "table", slide?.table ] ]) {
            if (!reference || !reference.reportArtifactId) continue;
            const expected = embeddedRevisionSha(reference.reportArtifactId, reference.reportRevision, `Presentation ${descriptor.id} r${revision} slide ${slideIndex + 1} ${kind}`);
            if (expected.sourceDescriptor.kind !== "report" || reference.reportSha256 !== expected.sha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Presentation ${descriptor.id} r${revision} slide ${slideIndex + 1} ${kind} SHA 无效。`);
        }
    }
    for (const entry of entries) if (!expectedPaths.has(entry.relativePath.toLowerCase())) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage 项目包包含孤立文件：${entry.relativePath}`);
    return {
        files: files,
        entries: entries,
        decodedBytes: decodedBytes,
        descriptorById: descriptorById,
        revisionHashByArtifact: revisionHashByArtifact,
        referencedSources: referencedSources,
        canonicalSession: canonicalSession
    };
}

function validateProjectPackageData(packageData) {
    if (!packageData || typeof packageData !== "object" || Array.isArray(packageData)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "画布文件格式无效。");
    validateProjectPackageImportOwnershipBoundary(packageData);
    if (packageData.format !== "iiimage-project-package" || ![ 1, 2, 3 ].includes(Number(packageData.version))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_UNSUPPORTED", "这不是受支持的 Aieyra Workspace 项目包。");
    validateProjectPackageSessionShape(packageData.session);
    const declaredKind = packageData.project?.kind || packageData.session?.projectKind || "image";
    const kindState = normalizedProjectKind(declaredKind, packageData.project?.quarantine);
    if (kindState.supportedKind !== "image" && packageData.studioFiles?.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "办公文档只能归入统一画布项目。");
    const studioValidation = require("./work/studio-documents.cjs").studioPackage({
        path: projectRoot
    }, packageData.studioFiles || []);
    const agentFileValidation = validateAgentPackageFiles(packageData);
    const writingValidation = validateWritingPackageFiles(packageData, kindState);
    const lineageValidation = validateLineagePackageFiles(packageData, kindState);
    const assets = Array.isArray(packageData.assets) ? packageData.assets : [];
    if (assets.length > 1e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "项目包图片超过 1000 张，无法安全导入。");
    let decodedBytes = 0;
    for (const asset of assets) {
        if (!asset || typeof asset !== "object" || typeof asset.data !== "string") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "项目包包含缺失图片数据的资产。");
        const estimatedBytes = estimatedBase64DecodedBytes(asset.data);
        if (estimatedBytes <= 0 || estimatedBytes > 33554432) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_ASSET_TOO_LARGE", "项目包中的单张图片无效或超过 32MB。");
        decodedBytes += estimatedBytes;
        if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "项目包图片总量超过 128MB，无法安全导入。");
    }
    if (decodedBytes + agentFileValidation.decodedBytes + writingValidation.decodedBytes + lineageValidation.decodedBytes + studioValidation.decodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "项目包资产总量超过 128 MiB，无法安全导入。");
    if ([ "data", "finance" ].includes(String(kindState.supportedKind)) && (assets.length || writingValidation.files.length)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Data/Finance 项目包不能混入 Image/Writing 受控文件。");
    return {
        assets: assets,
        agentFiles: agentFileValidation.files,
        decodedBytes: decodedBytes + agentFileValidation.decodedBytes + writingValidation.decodedBytes + lineageValidation.decodedBytes + studioValidation.decodedBytes,
        kindState: kindState,
        writingFiles: writingValidation.files,
        lineageFiles: lineageValidation.files,
        lineageEntries: lineageValidation.entries
    };
}

function validateProjectPackageImageBuffer(buffer, label) {
    const format = detectImageFormat(buffer);
    const dimensions = encodedImageDimensions(buffer);
    if (!format || !dimensions) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”不是真实的 PNG、JPEG 或 WebP。`);
    assertSafeEncodedImageDimensions(buffer, label);
    const decoded = nativeImage.createFromBuffer(buffer);
    if (decoded.isEmpty()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”已经损坏或无法解码。`);
    const decodedSize = decoded.getSize();
    if (decodedSize.width !== dimensions.width || decodedSize.height !== dimensions.height) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${label}”的尺寸信息不一致。`);
    return {
        ...format,
        width: dimensions.width,
        height: dimensions.height
    };
}

function validateAgentPackageFiles(packageData) {
    const rawFiles = packageData?.agentFiles;
    if (rawFiles === void 0) return {
        files: [],
        decodedBytes: 0
    };
    if (!Array.isArray(rawFiles)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Agent 附件清单格式无效。");
    if (rawFiles.length > 24) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Agent 附件超过 24 个，无法安全导入。");
    const seen = new Set;
    let decodedBytes = 0;
    for (const file of rawFiles) {
        if (!file || typeof file !== "object" || typeof file.data !== "string") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Agent 附件缺少数据。");
        const relativePath = safeAgentPackageRelativePath(file.relativePath);
        const lookupKey = relativePath.toLowerCase();
        if (!relativePath || seen.has(lookupKey)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Agent 附件包含越界或重复路径。");
        seen.add(lookupKey);
        const estimatedBytes = estimatedBase64DecodedBytes(file.data);
        if (estimatedBytes <= 0 || estimatedBytes > projectPackageMaximumAgentFileBytes || !Number.isSafeInteger(file.byteLength) || file.byteLength !== estimatedBytes) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Agent 附件单文件大小无效或超过 24MB。");
        const buffer = Buffer.from(file.data, "base64");
        const actualHash = createHash("sha256").update(buffer).digest("hex");
        const declaredHash = String(file.sha256 || "").trim().toLowerCase();
        if (buffer.length !== estimatedBytes || buffer.toString("base64") !== file.data || !/^[a-f0-9]{64}$/.test(declaredHash) || declaredHash !== actualHash) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Agent 附件 SHA-256 或 Base64 校验失败：${relativePath}`);
        const name = sanitizedAgentAttachmentName(file.name, path.basename(relativePath));
        if (!name || /[\u0000-\u001f\u007f]/.test(String(file.name || ""))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Agent 附件名称无效：${relativePath}`);
        const mimeType = String(file.mimeType || "").trim().slice(0, 120);
        if (!mimeType || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Agent 附件 MIME 类型无效：${relativePath}`);
        if (![ "image", "text", "document", "other" ].includes(String(file.kind || ""))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Agent 附件类型无效：${relativePath}`);
        if (typeof file.textPreview === "string" && file.textPreview.length > 12e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", `Agent 附件预览过长：${relativePath}`);
        decodedBytes += buffer.length;
        if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 100663296) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Agent 附件总量超过 96MB。");
    }
    return {
        files: rawFiles,
        decodedBytes: decodedBytes
    };
}

function createAgentFilePackage(session, projectPath) {
    const records = [];
    const byPath = new Map;
    let decodedBytes = 0;
    const messages = [ ...Array.isArray(session?.messages) ? session.messages : [], ...Array.isArray(session?.conversations) ? session.conversations.flatMap(conversation => Array.isArray(conversation?.messages) ? conversation.messages : []) : [] ];
    const references = messages.flatMap(message => Array.isArray(message?.attachments?.fileAttachments) ? message.attachments.fileAttachments : []);
    for (const reference of references) {
        const filePath = agentAttachmentPathFromReference(reference, projectPath);
        if (!filePath) continue;
        const key = comparablePath(filePath);
        if (byPath.has(key)) continue;
        if (records.length >= 24) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "Agent 附件超过 24 个，无法安全导出。");
        const buffer = boundedImageRead(filePath, projectPackageMaximumAgentFileBytes, path.basename(filePath), "Agent 附件");
        if (!buffer.length) continue;
        decodedBytes += buffer.length;
        if (decodedBytes > 100663296) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "Agent 附件总量超过 96MB，请减少附件后再导出。");
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        const relativePath = safeAgentPackageRelativePath(projectRelativePath(projectPath, filePath));
        if (!relativePath) continue;
        const extension = path.extname(filePath).toLowerCase();
        const mimeType = String(reference?.mimeType || agentAttachmentMimeType(filePath)).trim().slice(0, 120) || "application/octet-stream";
        const textLike = [ ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml", ".html", ".htm", ".yaml", ".yml" ].includes(extension);
        const record = {
            id: String(reference?.id || `file-${sha256.slice(0, 24)}`).trim().slice(0, 160),
            name: sanitizedAgentAttachmentName(reference?.name, path.basename(filePath)),
            relativePath: relativePath,
            byteLength: buffer.length,
            size: buffer.length,
            sha256: sha256,
            mimeType: mimeType,
            kind: [ "image", "text", "document", "other" ].includes(String(reference?.kind)) ? String(reference.kind) : agentAttachmentKindForPath(mimeType, filePath),
            ...textLike ? {
                textPreview: buffer.subarray(0, 12e3).toString("utf8").replace(/\u0000/g, ""),
                textTruncated: buffer.length > 12e3
            } : {},
            data: buffer.toString("base64")
        };
        records.push(record);
        byPath.set(key, record);
    }
    return {
        files: records,
        decodedBytes: decodedBytes,
        portableReference: reference => {
            if (!reference || typeof reference !== "object") return null;
            const filePath = agentAttachmentPathFromReference(reference, projectPath);
            const record = filePath ? byPath.get(comparablePath(filePath)) : null;
            if (!record) return null;
            const next = {
                ...reference,
                id: reference.id || record.id,
                name: reference.name || record.name,
                relativePath: record.relativePath,
                mimeType: record.mimeType,
                size: record.byteLength,
                contentHash: record.sha256,
                kind: record.kind,
                ...record.textPreview ? {
                    textPreview: record.textPreview
                } : {},
                ...record.textTruncated ? {
                    textTruncated: !0
                } : {}
            };
            delete next.path;
            delete next.assetUrl;
            delete next.url;
            return next;
        }
    };
}

function createAgentPackageRestorer(files, projectPath) {
    const targetRoot = projectAgentAttachmentRoot(projectPath);
    const entries = [];
    const byRelativePath = new Map;
    const byHash = new Map;
    const byId = new Map;
    const plannedTargets = new Map;
    const existingEntry = filePath => {
        if (!existsSync(filePath)) return null;
        try {
            const link = lstatSync(filePath);
            if (!link.isFile() || link.isSymbolicLink()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Agent 附件目标不是普通文件。");
            const buffer = boundedImageRead(filePath, projectPackageMaximumAgentFileBytes, path.basename(filePath), "已有 Agent 附件");
            return {
                path: filePath,
                sha256: createHash("sha256").update(buffer).digest("hex")
            };
        } catch (error) {
            if (error?.code) throw error;
            throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "已有 Agent 附件无法读取。");
        }
    };
    for (const file of Array.isArray(files) ? files : []) {
        const relativePath = safeAgentPackageRelativePath(file.relativePath);
        const declaredTarget = relativePath ? resolveProjectRelativePath(projectPath, relativePath) : "";
        if (!declaredTarget || !isComparablePathInside(declaredTarget, targetRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Agent 附件越过目标项目边界。");
        const buffer = Buffer.from(file.data, "base64");
        const sha256 = String(file.sha256 || "").toLowerCase();
        let targetPath = declaredTarget;
        let targetKey = comparablePath(targetPath);
        const occupied = () => existingEntry(targetPath) || plannedTargets.get(targetKey) || null;
        let current = occupied();
        if (current && current.sha256 !== sha256) {
            const parsed = path.parse(targetPath);
            let attempt = 0;
            do {
                const suffix = attempt ? `${sha256.slice(0, 12)}-${attempt}` : sha256.slice(0, 12);
                targetPath = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
                targetKey = comparablePath(targetPath);
                current = occupied();
                attempt += 1;
            } while (current && current.sha256 !== sha256);
        }
        const entry = {
            ...file,
            buffer: buffer,
            sha256: sha256,
            relativePath: relativePath,
            targetPath: targetPath,
            existing: current?.sha256 === sha256
        };
        entries.push(entry);
        plannedTargets.set(targetKey, {
            path: targetPath,
            sha256: sha256
        });
        byRelativePath.set(relativePath.toLowerCase(), entry);
        byHash.set(sha256, entry);
        file.id && byId.set(String(file.id), entry);
    }
    return {
        entries: entries,
        reference: value => {
            if (!value || typeof value !== "object") return null;
            const relative = safeAgentPackageRelativePath(value.relativePath);
            const entry = (relative ? byRelativePath.get(relative.toLowerCase()) : null) || (value.contentHash ? byHash.get(String(value.contentHash).toLowerCase()) : null) || (value.id ? byId.get(String(value.id)) : null);
            if (!entry) return null;
            const next = {
                ...value,
                id: value.id || entry.id,
                name: value.name || entry.name,
                path: entry.targetPath,
                relativePath: projectRelativePath(projectPath, entry.targetPath),
                assetUrl: assetUrlFor(entry.targetPath),
                mimeType: value.mimeType || entry.mimeType,
                size: entry.byteLength,
                contentHash: entry.sha256,
                kind: value.kind || entry.kind,
                ...entry.textPreview ? {
                    textPreview: entry.textPreview
                } : {},
                ...entry.textTruncated ? {
                    textTruncated: !0
                } : {}
            };
            delete next.url;
            return next;
        },
        commit: () => {
            const created = [];
            try {
                if (entries.length) {
                    mkdirSync(targetRoot, {
                        recursive: !0
                    });
                    const rootInfo = lstatSync(targetRoot);
                    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Agent 附件目标目录身份无效。");
                }
                for (const entry of entries) {
                    if (entry.existing) continue;
                    mkdirSync(path.dirname(entry.targetPath), {
                        recursive: !0
                    });
                    const tempPath = `${entry.targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
                    try {
                        writeFileSync(tempPath, entry.buffer, {
                            flag: "wx"
                        });
                        renameSync(tempPath, entry.targetPath);
                        created.push(entry.targetPath);
                    } finally {
                        rmSync(tempPath, {
                            force: !0
                        });
                    }
                }
            } catch (error) {
                for (const filePath of created) rmSync(filePath, {
                    force: !0
                });
                throw error;
            }
        }
    };
}

function writeProjectPackageFile(filePath, packageData) {
    const serialized = `${JSON.stringify(packageData)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > 201326592) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "导出的项目包超过 192MB，请减少画布图片后重试。");
    mkdirSync(path.dirname(filePath), {
        recursive: !0
    });
    const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
        writeFileSync(tempPath, serialized, {
            encoding: "utf8",
            flag: "wx"
        });
        renameSync(tempPath, filePath);
    } finally {
        rmSync(tempPath, {
            force: !0
        });
    }
}

function packageProject(project) {
    if (project.kind === "agent") throw new Error("编程源码请通过项目目录保存；当前项目包不支持完整 Codex 会话导出。");
    const session = projectSessionFromDisk(project);
    const projectPath = path.resolve(project.path);
    const agentFilePackage = createAgentFilePackage(session, projectPath);
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    if (project?.quarantine?.readOnly) {
        const portableSession = mapSessionFileAttachments({
            ...session && typeof session === "object" ? session : {},
            projectKind: project.kind,
            pendingAgentExecution: null
        }, agentFilePackage.portableReference);
        delete portableSession.projectReadOnly;
        delete portableSession.projectQuarantine;
        validateProjectPackageSessionShape(portableSession);
        const packageData = {
            format: "iiimage-project-package",
            version: 3,
            exportedAt: (new Date).toISOString(),
            project: {
                schemaVersion: 4,
                id: project.id,
                name: project.name,
                kind: project.kind,
                quarantine: project.quarantine,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                ...project.extensions && typeof project.extensions === "object" ? {
                    extensions: project.extensions
                } : {}
            },
            session: portableSession,
            assets: [],
            agentFiles: agentFilePackage.files
        };
        validateProjectPackageData(packageData);
        return packageData;
    }
    if (kindState.supportedKind === "writing") {
        const portableSession = mapSessionFileAttachments({
            ...writingSessionForProject(session, project, "save"),
            pendingAgentExecution: null
        }, agentFilePackage.portableReference);
        const writingFiles = collectWritingPackageFiles(projectPath);
        validateProjectPackageSessionShape(portableSession);
        const packageData = {
            format: "iiimage-project-package",
            version: 3,
            exportedAt: (new Date).toISOString(),
            project: {
                schemaVersion: 4,
                id: project.id,
                name: project.name,
                kind: "writing",
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                ...project.extensions && typeof project.extensions === "object" ? {
                    extensions: project.extensions
                } : {}
            },
            session: portableSession,
            assets: [],
            agentFiles: agentFilePackage.files,
            writingFiles: writingFiles
        };
        validateProjectPackageData(packageData);
        return packageData;
    }
    if ([ "data", "finance" ].includes(String(kindState.supportedKind))) {
        const portableSession = mapSessionFileAttachments({
            ...lineageSessionForProject(session, project, "save"),
            pendingAgentExecution: null
        }, agentFilePackage.portableReference);
        const lineageFiles = collectLineagePackageFiles(projectPath);
        validateProjectPackageSessionShape(portableSession);
        const packageData = {
            format: "iiimage-project-package",
            version: 3,
            exportedAt: (new Date).toISOString(),
            project: {
                schemaVersion: 4,
                id: project.id,
                name: project.name,
                kind: kindState.supportedKind,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                ...project.extensions && typeof project.extensions === "object" ? {
                    extensions: project.extensions
                } : {}
            },
            session: portableSession,
            assets: [],
            agentFiles: agentFilePackage.files,
            lineageFiles: lineageFiles
        };
        validateProjectPackageData(packageData);
        return packageData;
    }
    const assets = [];
    let packagedDecodedBytes = 0;
    const readPackageAsset = filePath => {
        if (assets.length >= 1e3) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_COMPLEX", "画布图片超过 1000 张，无法安全导出。");
        const label = path.basename(filePath);
        const buffer = boundedImageRead(filePath, 33554432, label, "项目图片");
        const format = validateProjectPackageImageBuffer(buffer, label);
        packagedDecodedBytes += buffer.length;
        if (packagedDecodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "画布图片总量超过 128MB，请减少图片后再导出。");
        return {
            buffer: buffer,
            ...format
        };
    };
    for (const node of Array.isArray(session.nodes) ? session.nodes : []) for (const asset of node.assets || []) {
        if (asset.type !== "file" || !asset.path || !existsSync(asset.path)) continue;
        const controlledPath = controlledProjectAssetFile(asset.path, projectPath);
        if (!controlledPath || !/^image\/(png|jpeg|webp)$/i.test(mimeTypeForPath(controlledPath))) continue;
        const packagedImage = readPackageAsset(controlledPath);
        const {buffer: buffer, mimeType: mimeType} = packagedImage;
        assets.push({
            nodeId: node.id,
            assetId: asset.assetId || "",
            displayCode: asset.displayCode || "",
            contentHash: createHash("sha256").update(buffer).digest("hex"),
            index: asset.index,
            type: "file",
            path: asset.relativePath || projectRelativePath(projectPath, controlledPath) || path.join("output", "imagegen", path.basename(controlledPath)).split(path.sep).join("/"),
            fileName: path.basename(controlledPath),
            mimeType: mimeType,
            runId: asset.runId || "",
            revisedPrompt: asset.revisedPrompt || "",
            data: buffer.toString("base64")
        });
    }
    const packagedAttachmentKeys = new Set(assets.map(asset => asset.assetId || `${asset.nodeId}:${asset.index}:${asset.runId}`));
    const conversationMessages = [ ...Array.isArray(session.messages) ? session.messages : [], ...Array.isArray(session.conversations) ? session.conversations.flatMap(conversation => Array.isArray(conversation?.messages) ? conversation.messages : []) : [] ];
    for (const message of conversationMessages) {
        const attachmentItems = [ ...Array.isArray(message?.attachments?.sourceAssets) ? message.attachments.sourceAssets : [], ...Array.isArray(message?.attachments?.referenceAssets) ? message.attachments.referenceAssets : [], ...Array.isArray(message?.attachments?.contextAssets) ? message.attachments.contextAssets : [] ];
        for (const attachment of attachmentItems) {
            const attachmentPath = controlledProjectAssetFile(attachment?.path, projectPath);
            if (!attachmentPath) continue;
            if (!/^image\/(png|jpeg|webp)$/i.test(mimeTypeForPath(attachmentPath))) continue;
            const packageKey = String(attachment.assetId || "").trim() || `path:${comparablePath(attachmentPath)}`;
            if (packagedAttachmentKeys.has(packageKey)) continue;
            packagedAttachmentKeys.add(packageKey);
            const packagedImage = readPackageAsset(attachmentPath);
            const {buffer: buffer, mimeType: mimeType} = packagedImage;
            assets.push({
                nodeId: attachment.nodeId || "",
                attachment: !0,
                assetId: attachment.assetId || "",
                displayCode: attachment.displayCode || "",
                contentHash: createHash("sha256").update(buffer).digest("hex"),
                index: 1,
                type: "file",
                path: projectRelativePath(projectPath, attachmentPath) || path.join("assets", path.basename(attachmentPath)).split(path.sep).join("/"),
                fileName: path.basename(attachmentPath),
                mimeType: mimeType,
                runId: "",
                revisedPrompt: "",
                data: buffer.toString("base64")
            });
        }
    }
    const packagedByPath = new Map;
    for (const packaged of assets) {
        const absolutePath = resolveProjectRelativePath(projectPath, packaged.path);
        absolutePath && packagedByPath.set(comparablePath(absolutePath), packaged);
    }
    const portableFileReference = (reference, nodeId = "", slot = "asset", index = 1) => {
        if (!reference || typeof reference !== "object") return reference;
        const controlledPath = controlledProjectAssetFile(reference.path, projectPath);
        if (!controlledPath) return reference.type === "file" || reference.path ? {
            ...reference,
            path: void 0,
            assetUrl: void 0
        } : {
            ...reference
        };
        const mimeType = mimeTypeForPath(controlledPath);
        if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) return {
            ...reference,
            path: void 0,
            assetUrl: void 0
        };
        const pathKey = comparablePath(controlledPath);
        let packaged = packagedByPath.get(pathKey);
        if (!packaged) {
            const relativePath = projectRelativePath(projectPath, controlledPath) || path.join("assets", path.basename(controlledPath)).split(path.sep).join("/");
            const packagedImage = readPackageAsset(controlledPath);
            const {buffer: buffer, mimeType: actualMimeType} = packagedImage;
            packaged = {
                nodeId: nodeId,
                nested: !0,
                assetId: reference.assetId || "",
                displayCode: reference.displayCode || "",
                contentHash: createHash("sha256").update(buffer).digest("hex"),
                index: index,
                type: "file",
                path: relativePath,
                fileName: path.basename(controlledPath),
                mimeType: actualMimeType,
                runId: reference.runId || "",
                revisedPrompt: reference.revisedPrompt || "",
                data: buffer.toString("base64")
            };
            assets.push(packaged);
            packagedByPath.set(pathKey, packaged);
        }
        const packageAssetKey = packaged.packageAssetKey || reference.assetId || `pkg-${createHash("sha256").update(`${nodeId}|${slot}|${packaged.path}`).digest("hex").slice(0, 24)}`;
        packaged.packageAssetKey = packageAssetKey;
        return {
            ...reference,
            packageAssetKey: packageAssetKey,
            path: void 0,
            assetUrl: void 0,
            relativePath: reference.relativePath || projectRelativePath(projectPath, controlledPath),
            fileName: reference.fileName || path.basename(controlledPath)
        };
    };
    const portableAttachment = (attachment, index, role) => portableFileReference(attachment, attachment?.nodeId || "", `message-${role}-${index}`, index + 1);
    const portableMessage = message => {
        if (!message || typeof message !== "object" || !message.attachments) return message;
        return {
            ...message,
            attachments: {
                ...message.attachments,
                sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map((item, index) => portableAttachment(item, index, "source")) : [],
                referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map((item, index) => portableAttachment(item, index, "reference")) : [],
                contextAssets: Array.isArray(message.attachments.contextAssets) ? message.attachments.contextAssets.map((item, index) => portableAttachment(item, index, "context")) : [],
                fileAttachments: Array.isArray(message.attachments.fileAttachments) ? message.attachments.fileAttachments.map(agentFilePackage.portableReference).filter(Boolean) : []
            }
        };
    };
    const portableSession = {
        ...session,
        pendingAgentExecution: null,
        nodes: (Array.isArray(session.nodes) ? session.nodes : []).map(node => ({
            ...node,
            assets: (node.assets || []).map((asset, index) => portableFileReference(asset, node.id, `assets-${index}`, index + 1)),
            imageParams: node.imageParams ? {
                ...node.imageParams,
                referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map((reference, index) => portableFileReference(reference, node.id, `image-params-reference-${index}`, index + 1)) : [],
                maskImage: portableFileReference(node.imageParams.maskImage, node.id, "image-params-mask", 1)
            } : node.imageParams,
            layerGroup: node.layerGroup ? {
                ...node.layerGroup,
                previewAsset: portableFileReference(node.layerGroup.previewAsset, node.id, "layer-group-preview", 1),
                mergedAsset: portableFileReference(node.layerGroup.mergedAsset, node.id, "layer-group-merged", 1)
            } : node.layerGroup,
            layerComposition: node.layerComposition ? {
                ...node.layerComposition,
                previewAsset: portableFileReference(node.layerComposition.previewAsset, node.id, "layer-composition-preview", 1),
                mergedAsset: portableFileReference(node.layerComposition.mergedAsset, node.id, "layer-composition-merged", 1),
                layers: Array.isArray(node.layerComposition.layers) ? node.layerComposition.layers.map((layer, index) => ({
                    ...layer,
                    asset: portableFileReference(layer.asset, node.id, `layer-${layer.id || index}`, index + 1)
                })) : []
            } : node.layerComposition
        })),
        messages: Array.isArray(session.messages) ? session.messages.map(portableMessage) : [],
        conversations: Array.isArray(session.conversations) ? session.conversations.map(conversation => ({
            ...conversation,
            messages: Array.isArray(conversation.messages) ? conversation.messages.map(portableMessage) : []
        })) : []
    };
    validateProjectPackageSessionShape(portableSession);
    const packageData = {
        format: "iiimage-project-package",
        version: 3,
        exportedAt: (new Date).toISOString(),
        project: {
            schemaVersion: 4,
            id: project.id,
            name: project.name,
            kind: kindState.kind,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            ...project.extensions && typeof project.extensions === "object" ? {
                extensions: project.extensions
            } : {}
        },
        session: portableSession,
        assets: assets,
        studioFiles: require("./work/studio-documents.cjs").studioPackage(project),
        agentFiles: agentFilePackage.files
    };
    validateProjectPackageData(packageData);
    return packageData;
}

function lineagePackageStoredDependencies(stored) {
    const dependencies = new Set;
    if (stored?.kind === "scenario-workbook") for (const source of Array.isArray(stored.content?.workbook?.sources) ? stored.content.workbook.sources : []) dependencies.add(String(source?.artifactId || ""));
    if (stored?.kind === "presentation") for (const slide of Array.isArray(stored.content?.slides) ? stored.content.slides : []) {
        slide?.citation?.reportArtifactId && dependencies.add(String(slide.citation.reportArtifactId));
        slide?.table?.reportArtifactId && dependencies.add(String(slide.table.reportArtifactId));
    }
    dependencies.delete("");
    return dependencies;
}

function rewriteLineageStoredEmbeddedShas(storedInput, rewrittenRevisionHashes, label) {
    const stored = JSON.parse(JSON.stringify(storedInput));
    const rewrittenSha = (artifactId, revision, referenceLabel) => {
        const sha256 = rewrittenRevisionHashes.get(String(artifactId || ""))?.get(Number(revision));
        if (!sha256) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} ${referenceLabel} 无法映射到已重写 revision。`);
        return sha256;
    };
    stored.kind === "scenario-workbook" && (stored.content.workbook.sources = stored.content.workbook.sources.map(source => ({
        ...source,
        sha256: rewrittenSha(source.artifactId, source.revision, `scenario source ${source.artifactId}`)
    })));
    stored.kind === "presentation" && (stored.content.slides = stored.content.slides.map((slide, index) => ({
        ...slide,
        ...slide.citation ? {
            citation: {
                ...slide.citation,
                reportSha256: rewrittenSha(slide.citation.reportArtifactId, slide.citation.reportRevision, `slide ${index + 1} citation`)
            }
        } : {},
        ...slide.table ? {
            table: {
                ...slide.table,
                reportSha256: rewrittenSha(slide.table.reportArtifactId, slide.table.reportRevision, `slide ${index + 1} table`)
            }
        } : {}
    })));
    return stored;
}

function rewriteLineagePackageForTarget(packageData, packageValidation, targetProject, targetKindState) {
    const sourceSession = packageData?.session && typeof packageData.session === "object" ? packageData.session : {};
    const sourceArtifacts = Array.isArray(sourceSession.lineageArtifacts) ? sourceSession.lineageArtifacts : [];
    const descriptorById = new Map(sourceArtifacts.map(artifact => [ String(artifact.id), artifact ]));
    const revisionEntryByArtifact = new Map;
    const dependenciesByArtifact = new Map(sourceArtifacts.map(artifact => [ String(artifact.id), new Set((artifact.sourceArtifactIds || []).map(String)) ]));
    const rewrittenFiles = [];
    for (const entry of packageValidation.lineageEntries) {
        if (entry.pathInfo.type === "source") {
            rewrittenFiles.push({
                relativePath: entry.relativePath,
                byteLength: entry.buffer.length,
                sha256: entry.sha256,
                data: entry.buffer.toString("base64")
            });
            continue;
        }
        if (entry.pathInfo.type !== "revision") continue;
        const byRevision = revisionEntryByArtifact.get(entry.pathInfo.artifactId) || new Map;
        byRevision.set(entry.pathInfo.revision, entry);
        revisionEntryByArtifact.set(entry.pathInfo.artifactId, byRevision);
        const stored = JSON.parse(entry.buffer.toString("utf8"));
        const dependencies = dependenciesByArtifact.get(entry.pathInfo.artifactId) || new Set;
        for (const dependency of lineagePackageStoredDependencies(stored)) dependencies.add(dependency);
        dependenciesByArtifact.set(entry.pathInfo.artifactId, dependencies);
    }
    for (const [artifactId, dependencies] of dependenciesByArtifact) if (!descriptorById.has(artifactId) || [ ...dependencies ].some(dependency => dependency === artifactId || !descriptorById.has(dependency))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `Lineage portable DAG 缺失依赖或包含自环：${artifactId}`);
    const pending = new Set([ ...descriptorById.keys() ].sort((left, right) => left.localeCompare(right, "en")));
    const topologicalArtifactIds = [];
    const completed = new Set;
    while (pending.size) {
        const ready = [ ...pending ].filter(artifactId => [ ...dependenciesByArtifact.get(artifactId) || [] ].every(dependency => completed.has(dependency))).sort((left, right) => left.localeCompare(right, "en"));
        if (!ready.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage portable provenance DAG 包含环。");
        for (const artifactId of ready) {
            pending.delete(artifactId);
            completed.add(artifactId);
            topologicalArtifactIds.push(artifactId);
        }
    }
    const rewrittenRevisionHashes = new Map;
    const rewrittenCurrentByArtifact = new Map;
    for (const artifactId of topologicalArtifactIds) {
        const descriptor = descriptorById.get(artifactId);
        const sourceRevisions = revisionEntryByArtifact.get(artifactId);
        const hashes = new Map;
        let latestFile = null;
        for (let revision = 1; revision <= Number(descriptor.revision); revision += 1) {
            const entry = sourceRevisions?.get(revision);
            if (!entry) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_LINEAGE_FILES_REQUIRED", `Lineage portable 缺少 revision：${artifactId} r${revision}`);
            const sourceStored = JSON.parse(entry.buffer.toString("utf8"));
            const stored = rewriteLineageStoredEmbeddedShas({
                ...sourceStored,
                projectId: targetProject.id
            }, rewrittenRevisionHashes, `${artifactId} r${revision}`);
            const buffer = Buffer.from(`${JSON.stringify(stored, null, 2)}\n`, "utf8");
            const file = {
                relativePath: `.iiimage/lineage/artifacts/${artifactId}/revisions/r${revision}.json`,
                byteLength: buffer.length,
                sha256: createHash("sha256").update(buffer).digest("hex"),
                data: buffer.toString("base64")
            };
            rewrittenFiles.push(file);
            hashes.set(revision, file.sha256);
            latestFile = file;
        }
        rewrittenRevisionHashes.set(artifactId, hashes);
        const currentFile = {
            ...latestFile,
            relativePath: `.iiimage/lineage/artifacts/${artifactId}/current.json`
        };
        rewrittenFiles.push(currentFile);
        rewrittenCurrentByArtifact.set(artifactId, currentFile);
    }
    const rewrittenSession = {
        ...sourceSession,
        projectKind: targetKindState.supportedKind,
        pendingAgentExecution: null,
        lineageArtifacts: sourceArtifacts.map(artifact => {
            const currentFile = rewrittenCurrentByArtifact.get(String(artifact.id));
            const provenance = artifact.provenance && typeof artifact.provenance === "object" ? artifact.provenance : {};
            return {
                ...artifact,
                projectId: targetProject.id,
                projectKind: targetKindState.supportedKind,
                contentSha256: currentFile?.sha256 || "",
                byteLength: currentFile?.byteLength || 0,
                provenance: {
                    ...provenance,
                    inputs: (Array.isArray(provenance.inputs) ? provenance.inputs : []).map(input => ({
                        ...input,
                        sha256: rewrittenRevisionHashes.get(String(input?.artifactId || ""))?.get(Number(input?.revision)) || ""
                    })),
                    outputSha256: currentFile?.sha256 || ""
                }
            };
        })
    };
    const rewrittenPackage = {
        ...packageData,
        project: {
            ...packageData.project && typeof packageData.project === "object" ? packageData.project : {},
            id: targetProject.id,
            kind: targetKindState.supportedKind
        },
        session: rewrittenSession,
        assets: [],
        writingFiles: [],
        lineageFiles: rewrittenFiles
    };
    const validation = validateLineagePackageFiles(rewrittenPackage, targetKindState);
    return {
        session: rewrittenSession,
        files: rewrittenFiles,
        entries: validation.entries,
        packageData: rewrittenPackage,
        validation: validation
    };
}

function lineagePackageTreeTarget(treeRootInput, relativePath) {
    const treeRoot = path.resolve(treeRootInput);
    const pathInfo = lineagePackagePathInfo(relativePath);
    if (!pathInfo || !pathInfo.relativePath.startsWith(".iiimage/lineage/")) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging 文件路径无效。");
    const suffix = pathInfo.relativePath.slice(17);
    const target = path.resolve(treeRoot, ...suffix.split("/"));
    if (target === treeRoot || !isPathInside(target, treeRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging 文件越过暂存边界。");
    return {
        target: target,
        pathInfo: pathInfo
    };
}

function ensureLineagePackageTreeDirectory(treeRootInput, directoryInput) {
    const treeRoot = path.resolve(treeRootInput);
    const directory = path.resolve(directoryInput);
    if (!isPathInside(directory, treeRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging 目录越过暂存边界。");
    const rootInfo = lstatSync(treeRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging 根目录身份无效。");
    let cursor = treeRoot;
    const relative = path.relative(treeRoot, directory);
    for (const segment of relative ? relative.split(path.sep) : []) {
        cursor = path.join(cursor, segment);
        existsSync(cursor) || mkdirSync(cursor);
        const info = lstatSync(cursor);
        if (info.isSymbolicLink() || !info.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging 目录包含链接或非目录条目。");
    }
}

function verifyLineagePackageTree(treeRootInput, rewrittenPackage, targetKindState, expectedEntries, label) {
    const treeRoot = path.resolve(treeRootInput);
    const rootInfo = lstatSync(treeRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 根目录身份无效。`);
    const realRoot = realpathSync(treeRoot);
    const expectedByPath = new Map(expectedEntries.map(entry => [ entry.relativePath.toLowerCase(), entry ]));
    const readbackFiles = [];
    const seen = new Set;
    (function walk(directory) {
        const directoryInfo = lstatSync(directory);
        if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 目录包含链接或非目录条目。`);
        lineagePathInsideRealRoot(directory, realRoot);
        for (const dirent of readdirSync(directory, {
            withFileTypes: !0
        })) {
            const candidate = path.join(directory, dirent.name);
            if (dirent.isSymbolicLink()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 目录包含符号链接。`);
            const suffix = path.relative(treeRoot, candidate).split(path.sep).join("/");
            const portablePath = `.iiimage/lineage/${suffix}`;
            if (dirent.isDirectory()) {
                if (!lineagePackageRelativeDirectoryAllowed(portablePath)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 目录包含未知目录：${portablePath}`);
                walk(candidate);
                continue;
            }
            if (!dirent.isFile()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 目录包含非普通文件：${portablePath}`);
            const pathInfo = lineagePackagePathInfo(portablePath);
            const key = pathInfo?.relativePath.toLowerCase() || "";
            const expected = key ? expectedByPath.get(key) : null;
            if (!pathInfo || !expected || seen.has(key)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 目录包含未知或重复文件：${portablePath}`);
            const maximum = pathInfo.type === "source" ? 33554432 : 50331648;
            const buffer = stableLineagePackageFileRead(candidate, realRoot, maximum, portablePath);
            const sha256 = createHash("sha256").update(buffer).digest("hex");
            if (buffer.length !== expected.byteLength || sha256 !== expected.sha256 || !buffer.equals(expected.buffer)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} Lineage 文件写入后完整性不一致：${portablePath}`);
            seen.add(key);
            readbackFiles.push({
                relativePath: pathInfo.relativePath,
                byteLength: buffer.length,
                sha256: sha256,
                data: buffer.toString("base64")
            });
        }
    })(treeRoot);
    if (seen.size !== expectedByPath.size) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_LINEAGE_FILES_REQUIRED", `${label} Lineage staging 缺少受控文件。`);
    const readbackPackage = {
        ...rewrittenPackage,
        lineageFiles: readbackFiles
    };
    validateLineagePackageFiles(readbackPackage, targetKindState);
    return readbackFiles;
}

function removeLineagePackageTree(treeRootInput, parentInput) {
    const treeRoot = path.resolve(treeRootInput);
    const parent = path.resolve(parentInput);
    if (!existsSync(treeRoot)) return;
    if (path.dirname(treeRoot) !== parent) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_ROLLBACK_UNSAFE", "Lineage staging 回滚目标越界。");
    const info = lstatSync(treeRoot);
    if (info.isSymbolicLink()) {
        rmSync(treeRoot, {
            force: !0
        });
        return;
    }
    if (!info.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_ROLLBACK_UNSAFE", "Lineage staging 回滚目标不是目录。");
    rmSync(treeRoot, {
        recursive: !0,
        force: !0
    });
}

function publishLineagePackageTree(targetProjectRootInput, rewritten, targetKindState) {
    const targetProjectRoot = path.resolve(targetProjectRootInput);
    const metaRoot = path.join(targetProjectRoot, projectMetaDirName);
    if (existsSync(metaRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Lineage staging 元数据目录已存在，已停止覆盖。");
    mkdirSync(metaRoot);
    const metaInfo = lstatSync(metaRoot);
    if (metaInfo.isSymbolicLink() || !metaInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging 元数据目录身份无效。");
    const finalLineageRoot = path.join(metaRoot, "lineage");
    const stagingLineageRoot = path.join(metaRoot, `.lineage-import-${process.pid}-${randomBytes(10).toString("hex")}`);
    let staged = !1;
    let published = !1;
    try {
        mkdirSync(stagingLineageRoot);
        staged = !0;
        for (const entry of [ ...rewritten.entries ].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
            const {target: target} = lineagePackageTreeTarget(stagingLineageRoot, entry.relativePath);
            ensureLineagePackageTreeDirectory(stagingLineageRoot, path.dirname(target));
            writeFileSync(target, entry.buffer, {
                flag: "wx"
            });
        }
        verifyLineagePackageTree(stagingLineageRoot, rewritten.packageData, targetKindState, rewritten.entries, "暂存");
        if (existsSync(finalLineageRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Lineage 发布目录已存在，已停止覆盖。");
        renameSync(stagingLineageRoot, finalLineageRoot);
        staged = !1;
        published = !0;
        verifyLineagePackageTree(finalLineageRoot, rewritten.packageData, targetKindState, rewritten.entries, "发布后");
        return finalLineageRoot;
    } catch (error) {
        staged && removeLineagePackageTree(stagingLineageRoot, metaRoot);
        published && removeLineagePackageTree(finalLineageRoot, metaRoot);
        throw error;
    }
}

function verifyPortableLineageProjectReadback(project, expectedSession, label) {
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    if (![ "data", "finance" ].includes(String(kindState.supportedKind))) return projectSessionFromDisk(project);
    const snapshot = inspectJson(project.sessionPath);
    if (snapshot.status !== "valid") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} session.json 回读失败。`);
    const rawSession = snapshot.value;
    const canonicalRaw = validateCanonicalLineageSessionDescriptor(rawSession, kindState.supportedKind, project.id);
    const canonicalExpected = dehydrateLineageSession(sanitizeLineageSession(expectedSession, project), project);
    if (!canonicalProjectPackageEqual(lineageSessionDescriptorShape(canonicalRaw), lineageSessionDescriptorShape(canonicalExpected))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} session descriptor 与导入清单不一致。`);
    const lineageFiles = collectLineagePackageFiles(project.path);
    validateProjectPackageData({
        format: "iiimage-project-package",
        version: 3,
        exportedAt: (new Date).toISOString(),
        project: {
            id: project.id,
            name: project.name,
            kind: kindState.supportedKind
        },
        session: rawSession,
        assets: [],
        lineageFiles: lineageFiles
    });
    const hydrated = projectSessionFromDisk(project);
    const hydratedDescriptor = dehydrateLineageSession(sanitizeLineageSession(hydrated, project), project);
    if (!canonicalProjectPackageEqual(lineageSessionDescriptorShape(hydratedDescriptor), lineageSessionDescriptorShape(canonicalExpected))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", `${label} hydrate 后 descriptor 与导入清单不一致。`);
    for (const descriptor of hydratedDescriptor.lineageArtifacts) readLineageArtifact(project, descriptor, hydratedDescriptor.lineageArtifacts);
    return hydrated;
}

function sessionFromPackage(packageData, targetProject, options = {}) {
    const packageValidation = validateProjectPackageData(packageData);
    const transactionOwnedRoot = options.allowExistingImportTransactionRoot === !0;
    const targetKindState = normalizedProjectKind(targetProject?.kind || packageValidation.kindState.kind, targetProject?.quarantine);
    if (targetProject?.quarantine?.readOnly && ![ "data", "finance" ].includes(String(targetKindState.supportedKind))) {
        if (packageValidation.assets.length || packageValidation.agentFiles.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_UNSUPPORTED", "未知项目类型包含当前版本无法验证的资产，已停止导入。");
        return {
            ...packageData?.session && typeof packageData.session === "object" ? packageData.session : {},
            projectKind: targetProject.kind,
            pendingAgentExecution: null,
            projectReadOnly: !0,
            projectQuarantine: targetProject.quarantine
        };
    }
    const projectPath = path.resolve(targetProject.path);
    const agentPackageRestorer = createAgentPackageRestorer(packageValidation.agentFiles, projectPath);
    if (targetKindState.supportedKind === "writing") {
        if (packageValidation.assets.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_UNSUPPORTED", "当前 Writing 项目包尚不接受图片资产。");
        const targetRoot = path.resolve(targetProject.path);
        const targetExisted = existsSync(targetRoot);
        if (targetExisted && packageValidation.writingFiles.length && !transactionOwnedRoot) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Writing 导入目标已存在，已停止覆盖。");
        try {
            packageValidation.writingFiles.length && mkdirSync(targetRoot, {
                recursive: !0
            });
            for (const file of packageValidation.writingFiles) {
                const relativePath = safeWritingPackageRelativePath(file.relativePath);
                const target = path.resolve(targetRoot, ...relativePath.split("/"));
                if (!isPathInside(target, targetRoot)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Writing 导入文件越过目标项目边界。");
                mkdirSync(path.dirname(target), {
                    recursive: !0
                });
                const tempPath = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
                try {
                    writeFileSync(tempPath, Buffer.from(file.data, "base64"), {
                        flag: "wx"
                    });
                    renameSync(tempPath, target);
                } finally {
                    rmSync(tempPath, {
                        force: !0
                    });
                }
            }
            const restoredSession = writingSessionForProject(mapSessionFileAttachments({
                ...packageData?.session && typeof packageData.session === "object" ? packageData.session : {},
                pendingAgentExecution: null
            }, agentPackageRestorer.reference), targetProject, packageValidation.writingFiles.length ? "load" : "save");
            agentPackageRestorer.commit();
            return restoredSession;
        } catch (error) {
            !targetExisted && existsSync(targetRoot) && rmSync(targetRoot, {
                recursive: !0,
                force: !0
            });
            throw error;
        }
    }
    if ([ "data", "finance" ].includes(String(targetKindState.supportedKind))) {
        if (packageValidation.assets.length || packageValidation.writingFiles.length) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_UNSUPPORTED", "Data/Finance 项目包不能包含 Image/Writing 资产。");
        const targetRoot = path.resolve(targetProject.path);
        const targetExisted = existsSync(targetRoot);
        if (targetExisted && packageValidation.lineageFiles.length && !transactionOwnedRoot) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Lineage 导入目标已存在，已停止覆盖。");
        let createdTargetRoot = !1;
        try {
            const rewritten = rewriteLineagePackageForTarget(packageData, packageValidation, targetProject, targetKindState);
            if (rewritten.entries.length) {
                mkdirSync(path.dirname(targetRoot), {
                    recursive: !0
                });
                if (transactionOwnedRoot) {
                    const rootInfo = lstatSync(targetRoot);
                    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Lineage 导入事务 staging 根目录身份无效。");
                } else try {
                    mkdirSync(targetRoot);
                    createdTargetRoot = !0;
                } catch (error) {
                    if (error?.code === "EEXIST") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "Lineage 导入目标在 staging 期间被占用，已停止覆盖。");
                    throw error;
                }
                publishLineagePackageTree(targetRoot, rewritten, targetKindState);
            }
            const restored = lineageSessionForProject(mapSessionFileAttachments(rewritten.session, agentPackageRestorer.reference), targetProject, rewritten.entries.length ? "load" : "save");
            const expectedDescriptor = dehydrateLineageSession(sanitizeLineageSession(rewritten.session, targetProject), targetProject);
            const restoredDescriptor = dehydrateLineageSession(sanitizeLineageSession(restored, targetProject), targetProject);
            if (!canonicalProjectPackageEqual(lineageSessionDescriptorShape(expectedDescriptor), lineageSessionDescriptorShape(restoredDescriptor))) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "Lineage staging hydrate 后 descriptor 与导入清单不一致。");
            agentPackageRestorer.commit();
            return restored;
        } catch (error) {
            if (createdTargetRoot && existsSync(targetRoot)) {
                const rollbackInfo = lstatSync(targetRoot);
                if (path.dirname(targetRoot) !== path.dirname(path.resolve(targetProject.path)) || rollbackInfo.isSymbolicLink() || !rollbackInfo.isDirectory()) {
                    const rollbackFailure = projectPackageFailure("AIEYRA_PROJECT_PACKAGE_ROLLBACK_UNSAFE", "Lineage 导入失败且 staging 项目目录无法安全回滚。");
                    rollbackFailure.cause = error;
                    throw rollbackFailure;
                }
                rmSync(targetRoot, {
                    recursive: !0,
                    force: !0
                });
            }
            throw error;
        }
    }
    if (targetKindState.supportedKind !== "image") throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_UNSUPPORTED", `项目类型“${targetKindState.kind}”尚无可用导入器。`);
    const assetMap = new Map;
    const assetById = new Map;
    const assetByPackageKey = new Map;
    const assetByRelativePath = new Map;
    const ambiguousAssetIds = new Set;
    const ambiguousAssetMapKeys = new Set;
    const ambiguousPackageKeys = new Set;
    const ambiguousRelativePaths = new Set;
    const restoredByTargetPath = new Map;
    const existingTargetEntry = filePath => {
        const key = comparablePath(filePath);
        const known = restoredByTargetPath.get(key);
        if (known) return known;
        if (!existsSync(filePath)) return null;
        try {
            const stats = lstatSync(filePath);
            const contentHash = stats.isFile() && !stats.isSymbolicLink() ? createHash("sha256").update(boundedImageRead(filePath, 33554432, path.basename(filePath), "已有项目图片")).digest("hex") : "occupied:" + (stats.isDirectory() ? "directory" : "non-file");
            const entry = {
                path: filePath,
                contentHash: contentHash
            };
            restoredByTargetPath.set(key, entry);
            return entry;
        } catch {
            const entry = {
                path: filePath,
                contentHash: "occupied:unreadable"
            };
            restoredByTargetPath.set(key, entry);
            return entry;
        }
    };
    const packageRelativeLookupKey = value => String(value || "").trim().replace(/\\/g, "/").toLowerCase();
    const setUniqueAssetLookup = (lookup, ambiguous, key, value) => {
        const cleanKey = String(key || "").trim();
        if (!cleanKey || ambiguous.has(cleanKey)) return;
        const existing = lookup.get(cleanKey);
        if (existing && existing.contentHash !== value.contentHash) {
            lookup.delete(cleanKey);
            ambiguous.add(cleanKey);
            return;
        }
        lookup.set(cleanKey, value);
    };
    const packageAssets = packageValidation.assets;
    let decodedBytes = 0;
    for (const asset of packageAssets) {
        if (!asset || typeof asset !== "object" || !asset.data) continue;
        const relative = String(asset.path || path.join("output", "imagegen", asset.fileName || `asset-${Date.now()}.png`)).replace(/\\/g, "/");
        const buffer = Buffer.from(String(asset.data), "base64");
        if (buffer.toString("base64") !== asset.data || buffer.length > 33554432) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_IMAGE_INVALID", `项目图片“${asset.fileName || relative}”的编码无效。`);
        decodedBytes += buffer.length;
        if (decodedBytes > 134217728) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TOO_LARGE", "项目包图片总量超过 128MB，无法安全导入。");
        const imageFormat = validateProjectPackageImageBuffer(buffer, asset.fileName || path.basename(relative));
        const contentHash = createHash("sha256").update(buffer).digest("hex");
        const declaredTarget = resolveProjectRelativePath(projectPath, relative);
        const allowedTarget = declaredTarget && projectAssetRoots(projectPath).filter(root => comparablePath(root) !== comparablePath(projectAgentAttachmentRoot(projectPath))).some(root => comparablePath(declaredTarget) !== comparablePath(root) && isComparablePathInside(declaredTarget, root));
        let targetPath = allowedTarget ? declaredTarget : path.join(projectPath, "assets", "package-imports", safeName(asset.fileName || path.basename(relative), `asset-${contentHash.slice(0, 12)}${imageFormat.extension}`));
        path.extname(targetPath).toLowerCase() !== imageFormat.extension && (targetPath = path.join(path.dirname(targetPath), `${safeName(path.basename(targetPath, path.extname(targetPath)), "asset")}${imageFormat.extension}`));
        let targetKey = comparablePath(targetPath);
        const existingTarget = existingTargetEntry(targetPath);
        if (existingTarget && existingTarget.contentHash !== contentHash) {
            const extension = path.extname(targetPath);
            const stem = safeName(path.basename(targetPath, extension), "asset");
            let attempt = 0;
            do {
                const suffix = attempt ? `${contentHash.slice(0, 12)}-${attempt}` : contentHash.slice(0, 12);
                targetPath = path.join(path.dirname(targetPath), `${stem}-${suffix}${extension}`);
                targetKey = comparablePath(targetPath);
                attempt += 1;
            } while (existingTargetEntry(targetPath) && existingTargetEntry(targetPath).contentHash !== contentHash);
        }
        const reusableTarget = existingTargetEntry(targetPath);
        if (reusableTarget) targetPath = reusableTarget.path; else {
            mkdirSync(path.dirname(targetPath), {
                recursive: !0
            });
            const temporaryTarget = path.join(path.dirname(targetPath), `.iiimage-package-${randomBytes(8).toString("hex")}.tmp`);
            try {
                writeFileSync(temporaryTarget, buffer, {
                    flag: "wx"
                });
                renameSync(temporaryTarget, targetPath);
            } finally {
                rmSync(temporaryTarget, {
                    force: !0
                });
            }
            targetKey = comparablePath(targetPath);
            restoredByTargetPath.set(targetKey, {
                path: targetPath,
                contentHash: contentHash
            });
        }
        const declaredHash = String(asset.contentHash || "").trim().toLowerCase();
        declaredHash && declaredHash !== contentHash && log(`project package content hash corrected ${relative}`);
        const key = `${asset.nodeId || ""}:${asset.index || ""}:${asset.runId || ""}`;
        const restoredAsset = {
            assetId: asset.assetId || "",
            displayCode: asset.displayCode || "",
            contentHash: contentHash,
            index: Number(asset.index || 1),
            type: "file",
            path: targetPath,
            relativePath: projectRelativePath(projectPath, targetPath),
            fileName: path.basename(targetPath),
            assetUrl: assetUrlFor(targetPath),
            runId: asset.runId || "",
            revisedPrompt: asset.revisedPrompt || ""
        };
        setUniqueAssetLookup(assetMap, ambiguousAssetMapKeys, key, restoredAsset);
        setUniqueAssetLookup(assetById, ambiguousAssetIds, restoredAsset.assetId, restoredAsset);
        setUniqueAssetLookup(assetByPackageKey, ambiguousPackageKeys, asset.packageAssetKey, restoredAsset);
        setUniqueAssetLookup(assetByRelativePath, ambiguousRelativePaths, packageRelativeLookupKey(relative), restoredAsset);
    }
    const packageAssetForReference = (reference, fallbackKey = "") => {
        if (!reference || typeof reference !== "object") return null;
        const portablePath = reference.relativePath || (typeof reference.path !== "string" || path.isAbsolute(reference.path) ? "" : reference.path);
        return (reference.packageAssetKey ? assetByPackageKey.get(String(reference.packageAssetKey)) : null) || (reference.assetId ? assetById.get(String(reference.assetId)) : null) || (fallbackKey ? assetMap.get(fallbackKey) : null) || (portablePath ? assetByRelativePath.get(packageRelativeLookupKey(portablePath)) : null) || null;
    };
    const restoredForReference = reference => {
        if (!reference || typeof reference !== "object") return reference;
        const restored = packageAssetForReference(reference);
        if (!restored) {
            const next = {
                ...reference
            };
            delete next.contentHash;
            delete next.sha256;
            return next;
        }
        const next = {
            ...reference,
            ...restored
        };
        delete next.packageAssetKey;
        return next;
    };
    const preparePackageMessage = message => {
        if (!message || typeof message !== "object" || !message.attachments) return message;
        return {
            ...message,
            attachments: {
                ...message.attachments,
                sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(restoredForReference) : [],
                referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(restoredForReference) : [],
                contextAssets: Array.isArray(message.attachments.contextAssets) ? message.attachments.contextAssets.map(restoredForReference) : [],
                fileAttachments: Array.isArray(message.attachments.fileAttachments) ? message.attachments.fileAttachments.map(agentPackageRestorer.reference).filter(Boolean) : []
            }
        };
    };
    const portableSession = packageData?.session && typeof packageData.session === "object" ? packageData.session : defaultSession;
    const preparedSession = {
        ...portableSession,
        pendingAgentExecution: null,
        nodes: (Array.isArray(portableSession.nodes) ? portableSession.nodes : []).map(node => ({
            ...node,
            assets: (Array.isArray(node?.assets) ? node.assets : []).map(asset => {
                const key = `${node?.id || ""}:${asset?.index || ""}:${asset?.runId || ""}`;
                const restored = packageAssetForReference(asset, key);
                return restoredForReference(restored ? {
                    ...asset,
                    ...restored
                } : asset);
            }),
            imageParams: node?.imageParams ? {
                ...node.imageParams,
                referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : [],
                maskImage: restoredForReference(node.imageParams.maskImage)
            } : node?.imageParams,
            layerGroup: node?.layerGroup ? {
                ...node.layerGroup,
                previewAsset: restoredForReference(node.layerGroup.previewAsset),
                mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
            } : node?.layerGroup,
            layerComposition: node?.layerComposition ? {
                ...node.layerComposition,
                previewAsset: restoredForReference(node.layerComposition.previewAsset),
                mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
                layers: Array.isArray(node.layerComposition.layers) ? node.layerComposition.layers.map(layer => ({
                    ...layer,
                    asset: restoredForReference(layer?.asset)
                })) : []
            } : node?.layerComposition
        })),
        messages: Array.isArray(portableSession.messages) ? portableSession.messages.map(preparePackageMessage) : [],
        conversations: Array.isArray(portableSession.conversations) ? portableSession.conversations.map(conversation => ({
            ...conversation,
            messages: Array.isArray(conversation?.messages) ? conversation.messages.map(preparePackageMessage) : []
        })) : []
    };
    const rawSession = sanitizeSession(preparedSession);
    const importedIndex = buildProjectAssetIndex(projectPath);
    const nodes = rawSession.nodes.map(node => {
        const assets = (node.assets || []).map(asset => {
            const key = `${node.id}:${asset.index || ""}:${asset.runId || ""}`;
            const restored = (asset.packageAssetKey ? assetByPackageKey.get(asset.packageAssetKey) : null) || (asset.assetId ? assetById.get(asset.assetId) : null) || assetMap.get(key);
            if (!restored) return hydrateAssetForProject(asset, targetProject, importedIndex);
            const next = {
                ...asset,
                ...restored
            };
            delete next.packageAssetKey;
            return next;
        }).filter(Boolean);
        if (!assets.length) for (const [key, value] of assetMap.entries()) key.startsWith(`${node.id}:`) && assets.push(value);
        return {
            ...node,
            assets: assets,
            imageParams: node.imageParams ? {
                ...node.imageParams,
                referenceImages: Array.isArray(node.imageParams.referenceImages) ? node.imageParams.referenceImages.map(restoredForReference) : [],
                maskImage: restoredForReference(node.imageParams.maskImage)
            } : node.imageParams,
            layerGroup: node.layerGroup ? {
                ...node.layerGroup,
                previewAsset: restoredForReference(node.layerGroup.previewAsset),
                mergedAsset: restoredForReference(node.layerGroup.mergedAsset)
            } : node.layerGroup,
            layerComposition: node.layerComposition ? {
                ...node.layerComposition,
                previewAsset: restoredForReference(node.layerComposition.previewAsset),
                mergedAsset: restoredForReference(node.layerComposition.mergedAsset),
                layers: Array.isArray(node.layerComposition.layers) ? node.layerComposition.layers.map(layer => ({
                    ...layer,
                    asset: restoredForReference(layer.asset)
                })) : []
            } : node.layerComposition,
            imageState: node.type === "image" && assets.length ? "done" : node.imageState,
            status: node.type === "image" && assets.length ? "done" : node.status,
            outputs: Math.max(Number(node.outputs || 0), assets.length)
        };
    });
    const rewriteAttachment = attachment => {
        if (!attachment || typeof attachment !== "object") return attachment;
        const restored = restoredForReference(attachment);
        if (restored === attachment) return attachment;
        return {
            ...restored,
            path: restored.path,
            assetUrl: restored.assetUrl,
            mimeType: attachment.mimeType || mimeTypeForPath(restored.path),
            name: attachment.name || restored.fileName
        };
    };
    const rewriteMessage = message => {
        if (!message || typeof message !== "object" || !message.attachments) return message;
        return {
            ...message,
            attachments: {
                ...message.attachments,
                sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map(rewriteAttachment) : [],
                referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map(rewriteAttachment) : [],
                contextAssets: Array.isArray(message.attachments.contextAssets) ? message.attachments.contextAssets.map(rewriteAttachment) : [],
                fileAttachments: Array.isArray(message.attachments.fileAttachments) ? message.attachments.fileAttachments.map(agentPackageRestorer.reference).filter(Boolean) : []
            }
        };
    };
    const messages = Array.isArray(rawSession.messages) ? rawSession.messages.map(rewriteMessage) : [];
    const conversations = Array.isArray(rawSession.conversations) ? rawSession.conversations.map(conversation => ({
        ...conversation,
        messages: Array.isArray(conversation.messages) ? conversation.messages.map(rewriteMessage) : []
    })) : [];
    require("./work/studio-documents.cjs").studioPackage(targetProject, packageData.studioFiles || []).restore();
    const restoredSession = sanitizeSession({
        ...rawSession,
        nodes: nodes,
        messages: messages,
        conversations: conversations
    });
    agentPackageRestorer.commit();
    return restoredSession;
}

function invokeProjectImportCheckpoint(options, name, detail = {}) {
    typeof options?.checkpoint === "function" && options.checkpoint(name, detail);
}

function projectImportHardCrashWasSimulated(error) {
    return error?.aieyraProjectImportHardCrash === !0;
}

function importProjectPackage(packageData, targetPath, options = {}) {
    const validation = validateProjectPackageData(packageData);
    const finalPath = path.resolve(targetPath);
    const parentPath = path.dirname(finalPath);
    if (finalPath === parentPath || !path.basename(finalPath)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_INVALID", "导入目标目录无效。");
    if (existsSync(finalPath)) throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_TARGET_EXISTS", "导入目标已存在，已停止覆盖。");
    mkdirSync(parentPath, {
        recursive: !0
    });
    const token = `${process.pid}-${randomBytes(10).toString("hex")}`;
    const stagingPath = path.join(parentPath, `.iiimage-import-${token}`);
    const name = safeName(packageData.project?.name || path.basename(finalPath), "导入项目");
    const stagingRecord = createProjectRecord(name, stagingPath, validation.kindState.kind);
    packageData.project?.extensions && typeof packageData.project.extensions === "object" && !Array.isArray(packageData.project.extensions) && (stagingRecord.extensions = packageData.project.extensions);
    projectImportTransactionManager.begin({
        transactionId: token,
        projectId: stagingRecord.id,
        projectKind: stagingRecord.kind,
        stagingPath: stagingPath,
        finalPath: finalPath
    }, {
        checkpoint: options.checkpoint
    });
    try {
        const stagedSession = sessionFromPackage(packageData, stagingRecord, {
            allowExistingImportTransactionRoot: !0
        });
        if (stagingRecord.quarantine?.readOnly) {
            const opaqueSession = {
                ...stagedSession
            };
            delete opaqueSession.projectReadOnly;
            delete opaqueSession.projectQuarantine;
            writeJson(stagingRecord.sessionPath, opaqueSession);
        } else writeJson(stagingRecord.sessionPath, sessionForProjectSave(stagedSession, stagingRecord));
        writeProjectManifest(stagingRecord, stagedSession);
        projectImportTransactionManager.verifyOwnership(token, "staging");
        const lineageImport = [ "data", "finance" ].includes(String(validation.kindState.supportedKind));
        lineageImport ? verifyPortableLineageProjectReadback(stagingRecord, stagedSession, "发布前") : projectSessionFromDisk(stagingRecord);
        invokeProjectImportCheckpoint(options, "before-publish", {
            transactionId: token
        });
        projectImportTransactionManager.verifyOwnership(token, "staging");
        renameSync(stagingPath, finalPath);
        invokeProjectImportCheckpoint(options, "after-final-rename", {
            transactionId: token
        });
        projectImportTransactionManager.markPublished(token);
        invokeProjectImportCheckpoint(options, "after-publish", {
            transactionId: token
        });
        const record = {
            ...stagingRecord,
            path: finalPath,
            sessionPath: path.join(finalPath, "session.json")
        };
        const session = lineageImport ? verifyPortableLineageProjectReadback(record, stagedSession, "发布后") : projectSessionFromDisk(record);
        const result = {
            record: record,
            session: session,
            ...options.retainTransaction === !0 ? {
                importTransactionId: token
            } : {}
        };
        options.retainTransaction !== !0 && projectImportTransactionManager.finalize(token, record, {
            projects: []
        }, {
            requireRegistration: !1
        });
        return result;
    } catch (error) {
        if (projectImportHardCrashWasSimulated(error)) throw error;
        try {
            projectImportTransactionManager.rollback(token);
        } catch (rollbackError) {
            const cleanupError = projectPackageFailure("AIEYRA_PROJECT_PACKAGE_ROLLBACK_UNSAFE", "导入失败且事务无法安全回滚，请手动检查项目导入事务目录。");
            cleanupError.cause = rollbackError;
            cleanupError.importError = error;
            throw cleanupError;
        }
        throw error;
    }
}

function registerProjectImportTransaction(importResult, options = {}) {
    const record = importResult?.record;
    const transactionId = String(importResult?.importTransactionId || "");
    if (!record?.id || !transactionId) throw projectPackageFailure("AIEYRA_PROJECT_IMPORT_REGISTRATION_INVALID", "导入结果缺少待注册事务身份。");
    invokeProjectImportCheckpoint(options, "before-register", {
        transactionId: transactionId,
        projectId: record.id
    });
    const latestList = readProjectList();
    const projects = latestList.projects.filter(item => item.id !== record.id && comparablePath(item.path) !== comparablePath(record.path));
    writeProjectList({
        activeProjectId: record.id,
        projects: [ record, ...projects ]
    });
    const persistedList = readProjectList();
    invokeProjectImportCheckpoint(options, "after-register", {
        transactionId: transactionId,
        projectId: record.id
    });
    projectImportTransactionManager.finalize(transactionId, record, persistedList, {
        requireRegistration: !0,
        checkpoint: options.checkpoint
    });
    return persistedList;
}

let dataReportWritingSnapshotCoordinator = null;

function readableAssetRoots() {
    const list = readProjectList();
    const roots = new Set([ path.resolve(projectRoot, "output") ]);
    for (const project of list.projects) if (project?.path) for (const root of managedRootsForProject(project)) roots.add(root);
    return [ ...roots ];
}

function isPathInside(resolvedPath, rootPath) {
    const root = path.resolve(rootPath);
    const candidate = path.resolve(resolvedPath);
    const relation = path.relative(root, candidate);
    return relation === "" || relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation);
}

function isAllowedAssetPath(filePath) {
    const resolved = path.resolve(filePath);
    if (isPathInside(resolved, referencesDir)) return !0;
    return readableAssetRoots().some(root => isPathInside(resolved, root));
}

function assetUrlFor(filePath) {
    const resolved = path.resolve(filePath);
    if (isPathInside(resolved, projectRoot)) {
        const relativePath = path.relative(projectRoot, resolved).split(path.sep).map(encodeURIComponent).join("/");
        return `iiimage-asset://local/${relativePath}`;
    }
    return `iiimage-asset://local/abs/${encodeURIComponent(resolved)}`;
}

function resolveReadableImageAsset(filePath) {
    if (!filePath || typeof filePath !== "string") return null;
    const resolved = path.resolve(filePath);
    if (!isAllowedAssetPath(resolved) || !existsSync(resolved)) return null;
    const stats = lstatSync(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    const realFile = realpathSync(resolved);
    if (!isAllowedAssetPath(realFile)) return null;
    return realFile;
}

const maxExportImageBytes = 134217728;

const exportBlendModes = new Set([ "normal", "source-over", "multiply", "screen", "overlay" ]);

const transientExportSourceRefs = new Map;

function comparablePath(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isComparablePathInside(filePath, rootPath) {
    const resolved = comparablePath(filePath);
    const root = comparablePath(rootPath);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function realPathIfPresent(filePath) {
    const resolved = path.resolve(filePath);
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function managedRootsForProject(project) {
    const projectPath = path.resolve(project?.path || "");
    if (!projectPath) return [];
    return [ path.join(projectPath, "output"), path.join(projectPath, "assets"), path.join(projectPath, projectMetaDirName, "assets") ];
}

function addRecordedAssetSources(target, asset, project) {
    if (!asset || typeof asset !== "object") return;
    for (const key of [ "url", "assetUrl" ]) {
        const value = typeof asset[key] === "string" ? asset[key].trim() : "";
        value && target.urls.add(value);
    }
    for (const value of [ asset.path, asset.relativePath ? resolveProjectRelativePath(project.path, asset.relativePath) : "" ]) {
        if (typeof value !== "string" || !value.trim()) continue;
        target.paths.add(comparablePath(value));
    }
}

function recordedAssetSourcesForProject(project) {
    const recorded = {
        paths: new Set,
        urls: new Set
    };
    let session;
    try {
        session = projectSessionFromDisk(project);
    } catch (error) {
        log(`asset export session scan failed project=${project?.id || "unknown"} ${error instanceof Error ? error.message : String(error)}`);
        return recorded;
    }
    for (const node of Array.isArray(session?.nodes) ? session.nodes : []) {
        for (const asset of Array.isArray(node?.assets) ? node.assets : []) addRecordedAssetSources(recorded, asset, project);
        addRecordedAssetSources(recorded, node?.layerGroup?.previewAsset, project);
        addRecordedAssetSources(recorded, node?.layerGroup?.mergedAsset, project);
        addRecordedAssetSources(recorded, node?.layerComposition?.previewAsset, project);
        addRecordedAssetSources(recorded, node?.layerComposition?.mergedAsset, project);
        for (const layer of Array.isArray(node?.layerComposition?.layers) ? node.layerComposition.layers : []) addRecordedAssetSources(recorded, layer?.asset, project);
        for (const reference of Array.isArray(node?.imageParams?.referenceImages) ? node.imageParams.referenceImages : []) addRecordedAssetSources(recorded, {
            path: reference?.path,
            assetUrl: reference?.assetUrl
        }, project);
        addRecordedAssetSources(recorded, node?.imageParams?.maskImage, project);
    }
    return recorded;
}

function createAssetExportContext(projectId) {
    const list = readProjectList();
    const activeProject = getActiveProject(list);
    const requestedId = typeof projectId === "string" ? projectId.trim() : "";
    if (requestedId && requestedId !== list.activeProjectId) throw new Error("当前项目已切换，请重新选择需要导出的图片。");
    const project = requestedId ? getProjectById(requestedId, list) : activeProject;
    if (!project?.path) throw new Error("当前没有可用的项目图片库。");
    assertProjectWritable(project, "导出图片");
    if (normalizedProjectKind(project.kind, project.quarantine).supportedKind !== "image") throw new Error("当前项目不是图片项目，不能使用图片导出器。");
    ensureProjectFiles(project, defaultSessionForProject(project));
    const realProjectPath = realPathIfPresent(project.path);
    const realProjectRoot = realPathIfPresent(projectRoot);
    const realConfigDir = realPathIfPresent(configDir);
    const managedRoots = managedRootsForProject(project).map(realPathIfPresent).filter(root => isComparablePathInside(root, realProjectPath));
    const legacyRoots = [ path.join(projectRoot, "output"), referencesDir ].map(realPathIfPresent).filter(root => isComparablePathInside(root, realProjectRoot) || isComparablePathInside(root, realConfigDir));
    return {
        project: project,
        managedRoots: managedRoots,
        legacyRoots: legacyRoots,
        recorded: recordedAssetSourcesForProject(project)
    };
}

function decodeLocalAssetUrl(value) {
    if (typeof value !== "string" || !value.startsWith("iiimage-asset:")) return "";
    try {
        const url = new URL(value);
        const pathname = url.pathname.replace(/^\/+/, "");
        return pathname.startsWith("abs/") ? path.resolve(decodeURIComponent(pathname.slice(4))) : path.resolve(projectRoot, decodeURIComponent(pathname));
    } catch {
        return "";
    }
}

function isRecordedAssetPath(context, filePath) {
    return context.recorded.paths.has(comparablePath(filePath));
}

function resolveManagedAssetFile(asset, context) {
    const rawPath = typeof asset?.path === "string" && asset.path.trim() ? asset.path : decodeLocalAssetUrl(asset?.assetUrl) || decodeLocalAssetUrl(asset?.url);
    if (!rawPath) return "";
    const resolved = path.resolve(rawPath);
    if (!existsSync(resolved)) throw new Error("图片文件不存在，无法导出。");
    const stats = lstatSync(resolved);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("图片路径不是受支持的普通文件。");
    const realFile = realpathSync(resolved);
    const managed = context.managedRoots.some(root => isComparablePathInside(realFile, root));
    const recordedLegacy = context.legacyRoots.some(root => isComparablePathInside(realFile, root)) && isRecordedAssetPath(context, resolved);
    if (!managed && !recordedLegacy) throw new Error("图片不属于当前项目管理的资产目录，已拒绝导出。");
    return realFile;
}

function detectImageFormat(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer.subarray(0, 8).equals(Buffer.from([ 137, 80, 78, 71, 13, 10, 26, 10 ]))) return {
        extension: ".png",
        mimeType: "image/png"
    };
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return {
        extension: ".jpg",
        mimeType: "image/jpeg"
    };
    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return {
        extension: ".webp",
        mimeType: "image/webp"
    };
    return null;
}

function inspectImageFile(filePath) {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size <= 0) throw new Error("图片文件为空或不可读取。");
    if (stats.size > maxExportImageBytes) throw new Error("图片文件超过 128 MB，已取消导出。");
    const descriptor = openSync(filePath, "r");
    try {
        const header = Buffer.alloc(Math.min(32, stats.size));
        readSync(descriptor, header, 0, header.length, 0);
        const format = detectImageFormat(header);
        if (!format) throw new Error("只支持真实的 PNG、JPG 或 WEBP 图片文件。");
        return {
            path: filePath,
            size: stats.size,
            ...format
        };
    } finally {
        closeSync(descriptor);
    }
}

function normalizedExportAsset(input) {
    if (!input || typeof input !== "object") return null;
    return input.asset && typeof input.asset === "object" ? input.asset : input;
}

function remoteOrDataAssetSource(asset) {
    for (const value of [ asset?.url, asset?.assetUrl ]) {
        const source = typeof value === "string" ? value.trim() : "";
        if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(source)) return {
            kind: "data",
            value: source
        };
        if (/^https?:\/\//i.test(source)) return {
            kind: "remote",
            value: source
        };
    }
    return null;
}

function isRecordedRemoteOrDataSource(context, source) {
    return context.recorded.urls.has(source);
}

function imageBufferFromDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match) throw new Error("图片 Data URL 格式无效。");
    const encoded = match[2].replace(/\s+/g, "");
    if (encoded.length > Math.ceil(maxExportImageBytes / 3) * 4 + 8) throw new Error("图片数据超过 128 MB，已取消导出。");
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length <= 0 || buffer.length > maxExportImageBytes) throw new Error("图片数据大小无效。");
    return buffer;
}

async function imageBufferFromRemoteUrl(remoteUrl, options = {}) {
    const callerSignal = options?.signal;
    if (callerSignal?.aborted) throw newApiAbortError(callerSignal);
    const controller = new AbortController;
    const timeoutError = Object.assign(new Error("远程图片下载超时。"), {
        code: "AIEYRA_IMAGE_DOWNLOAD_TIMEOUT"
    });
    const timeout = setTimeout(() => controller.abort(timeoutError), 3e4);
    try {
        const signal = combineNewApiAbortSignals(callerSignal, controller.signal);
        const provider = options.providerSnapshot;
        const trustedProviderOrigin = provider?.mode === "custom" && typeof provider.endpoint === "function" ? new URL(provider.endpoint("images/generations")).origin : "";
        return await downloadRemoteImage(remoteUrl, {
            signal: signal,
            maxBytes: maxExportImageBytes,
            trustedProviderOrigin: trustedProviderOrigin
        });
    } catch (error) {
        if (callerSignal?.aborted) throw newApiAbortError(callerSignal);
        if (controller.signal.aborted) throw timeoutError;
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function secureExportSourceCacheDir(context) {
    const projectPath = path.resolve(context?.project?.path || "");
    const projectOutput = path.resolve(projectPath, "output");
    const realProject = realPathIfPresent(projectPath);
    const realOutput = realPathIfPresent(projectOutput);
    if (!isComparablePathInside(realOutput, realProject)) throw new Error("项目导出缓存目录越过了项目边界。");
    const requested = path.resolve(activeProjectTempDir(context.project.id), "export-sources");
    mkdirSync(requested, {
        recursive: !0
    });
    const stats = lstatSync(requested);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("项目导出缓存目录不是安全的普通目录。");
    const realCache = realpathSync(requested);
    if (!isComparablePathInside(realCache, realOutput) || path.basename(realCache) !== "export-sources") throw new Error("项目导出缓存目录包含不安全的链接。");
    return realCache;
}

function materializedExportSourcePath(context, buffer, extension) {
    const digest = createHash("sha256").update(buffer).digest("hex");
    const cacheDir = secureExportSourceCacheDir(context);
    const filePath = path.join(cacheDir, `${digest}-${process.pid}${extension}`);
    if (!existsSync(filePath)) {
        const tempPath = `${filePath}.${process.pid}.tmp`;
        writeFileSync(tempPath, buffer);
        try {
            renameSync(tempPath, filePath);
        } catch (error) {
            if (!existsSync(filePath)) throw error;
            rmSync(tempPath, {
                force: !0
            });
        }
    }
    return filePath;
}

function retainTransientExportSource(filePath) {
    const key = comparablePath(filePath);
    transientExportSourceRefs.set(key, (transientExportSourceRefs.get(key) || 0) + 1);
}

function releaseTransientExportSource(source, context) {
    if (!source?.transient || !source.path || !context?.project?.id) return;
    const key = comparablePath(source.path);
    const next = Math.max(0, (transientExportSourceRefs.get(key) || 1) - 1);
    if (next > 0) {
        transientExportSourceRefs.set(key, next);
        return;
    }
    transientExportSourceRefs.delete(key);
    const cacheDir = path.resolve(activeProjectTempDir(context.project.id), "export-sources");
    const resolved = path.resolve(source.path);
    const ownedNamePattern = new RegExp(`^[a-f0-9]{64}-${process.pid}\\.(?:png|jpe?g|webp)$`, "i");
    if (!ownedNamePattern.test(path.basename(resolved)) || !isComparablePathInside(resolved, cacheDir) || comparablePath(path.dirname(resolved)) !== comparablePath(cacheDir) || !existsSync(resolved)) return;
    try {
        const stats = lstatSync(resolved);
        if (!stats.isFile() || stats.isSymbolicLink()) return;
        const realCache = realpathSync(cacheDir);
        const realSource = realpathSync(resolved);
        if (!isComparablePathInside(realSource, realCache) || comparablePath(path.dirname(realSource)) !== comparablePath(realCache)) return;
        rmSync(realSource, {
            force: !0
        });
    } catch (error) {
        log(`asset transient source cleanup failed ${error instanceof Error ? error.message : String(error)}`);
    }
}

function releaseTransientExportSources(sources, context) {
    for (const source of Array.isArray(sources) ? sources : []) releaseTransientExportSource(source, context);
}

async function materializeManagedImageAsset(input, context) {
    const asset = normalizedExportAsset(input);
    if (!asset) throw new Error("没有可导出的图片资产。");
    const localFile = resolveManagedAssetFile(asset, context);
    if (localFile) return {
        ...inspectImageFile(localFile),
        asset: asset
    };
    const source = remoteOrDataAssetSource(asset);
    if (!source) throw new Error("图片缺少可用的项目文件或受支持的 URL。");
    if (!isRecordedRemoteOrDataSource(context, source.value)) throw new Error("远程或内嵌图片未记录在当前项目中，已拒绝导出。");
    const buffer = source.kind === "data" ? imageBufferFromDataUrl(source.value) : await imageBufferFromRemoteUrl(source.value);
    const format = detectImageFormat(buffer);
    if (!format) throw new Error("下载或内嵌的数据不是真实的 PNG、JPG 或 WEBP 图片。");
    const filePath = materializedExportSourcePath(context, buffer, format.extension);
    retainTransientExportSource(filePath);
    return {
        path: filePath,
        size: buffer.length,
        ...format,
        asset: asset,
        transient: !0
    };
}

function safeExportStem(value, fallback = "aieyra-workspace-image") {
    const raw = path.parse(path.basename(String(value || ""))).name.normalize("NFKC");
    let stem = raw.replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim().slice(0, 96);
    stem || (stem = fallback);
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) && (stem = `_${stem}`);
    return stem;
}

function preferredAssetName(asset, suggestedName, fallback = "aieyra-workspace-image") {
    if (suggestedName) return suggestedName;
    if (asset?.title) return asset.title;
    if (asset?.originalName) return asset.originalName;
    if (asset?.path) return path.basename(asset.path);
    if (/^https?:\/\//i.test(String(asset?.url || ""))) try {
        return decodeURIComponent(path.basename(new URL(asset.url).pathname));
    } catch {}
    return fallback;
}

function exportFileName(source, suggestedName, fallback = "aieyra-workspace-image") {
    return `${safeExportStem(preferredAssetName(source.asset, suggestedName, fallback), fallback)}${source.extension}`;
}

function ensureMatchingExportExtension(filePath, extension) {
    const selectedExtension = path.extname(filePath).toLowerCase();
    if (!selectedExtension) return `${filePath}${extension}`;
    if (extension === ".jpg" && (selectedExtension === ".jpg" || selectedExtension === ".jpeg")) return filePath;
    if (selectedExtension === extension) return filePath;
    return path.join(path.dirname(filePath), `${path.parse(filePath).name}${extension}`);
}

function uniqueExportPath(parentDir, name) {
    const parsed = path.parse(name);
    let candidate = path.join(parentDir, name);
    for (let index = 2; existsSync(candidate); index += 1) candidate = path.join(parentDir, `${parsed.name} (${index})${parsed.ext}`);
    return candidate;
}

function normalizedExportItem(input, index) {
    const asset = normalizedExportAsset(input);
    if (!asset) return null;
    const requestedOrder = Number(input?.order ?? asset.index ?? index + 1);
    const opacityValue = Number(input?.opacity);
    const blendModeValue = String(input?.blendMode || "normal");
    return {
        asset: asset,
        order: Number.isFinite(requestedOrder) ? Math.max(1, Math.round(requestedOrder)) : index + 1,
        sourceIndex: index,
        title: String(input?.title || asset.title || `图层 ${index + 1}`).trim().slice(0, 120) || `图层 ${index + 1}`,
        role: String(input?.role || "layer").trim().slice(0, 80) || "layer",
        visible: input?.visible !== !1,
        opacity: Number.isFinite(opacityValue) ? Math.max(0, Math.min(1, opacityValue)) : 1,
        blendMode: exportBlendModes.has(blendModeValue) ? blendModeValue : "normal"
    };
}

function exportGroupMetadata(group = {}) {
    const groupNumber = Number(group.groupNumber);
    const width = Number(group.width);
    const height = Number(group.height);
    return {
        id: String(group.id || "").trim().slice(0, 120),
        title: String(group.title || "").trim().slice(0, 160),
        groupNumber: Number.isFinite(groupNumber) ? Math.max(1, Math.round(groupNumber)) : void 0,
        width: Number.isFinite(width) ? Math.max(1, Math.round(width)) : void 0,
        height: Number.isFinite(height) ? Math.max(1, Math.round(height)) : void 0
    };
}

function removeExportStagingFolder(stagingPath, parentPath) {
    const resolvedStaging = path.resolve(stagingPath);
    const resolvedParent = path.resolve(parentPath);
    if (!path.basename(resolvedStaging).startsWith(".iiimage-export-") || !isComparablePathInside(resolvedStaging, resolvedParent)) return;
    existsSync(resolvedStaging) && rmSync(resolvedStaging, {
        recursive: !0,
        force: !0
    });
}

function outputDirForProjectId(projectId) {
    return outputBucketDirForProjectId(projectId, "imagegen");
}

async function importLocalImagesToProject(payload = {}) {
    const requestedProjectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
    const outputDir = path.join(outputDirForProjectId(requestedProjectId), "imports");
    const projectPath = path.resolve(outputDir, "..", "..", "..");
    const requestedLimit = Number(payload.maxFiles);
    const maxFiles = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, maxImportedImageFiles)) : maxImportedImageFiles;
    const importer = await currentProjectImageImporter();
    const startedAt = Date.now();
    imageImportCounters.requests += 1;
    imageImportCounters.active += 1;
    imageImportCounters.maxActiveRequests = Math.max(imageImportCounters.maxActiveRequests, imageImportCounters.active);
    try {
        const imported = await importer.importImages({
            inputPaths: Array.isArray(payload.paths) ? payload.paths : [],
            outputDir: outputDir,
            maxFiles: maxFiles
        });
        assertWorkspaceAccessLease();
        const assets = imported.assets.map((asset, index) => ({
            contentHash: String(asset.sha256 || "").toLowerCase(),
            occurrenceId: String(asset.occurrenceId || "").slice(0, 80),
            importBatchId: String(asset.importBatchId || imported.importBatchId || "").slice(0, 160),
            importRootId: String(asset.importRootId || "").slice(0, 80),
            sourceRelativePath: safeImageSourceRelativePath(asset.sourceRelativePath),
            sourceRootLabel: String(asset.sourceRootLabel || "").slice(0, 260),
            sourceRootKind: asset.sourceRootKind === "directory" ? "directory" : "file",
            index: index + 1,
            type: "file",
            path: asset.path,
            relativePath: projectRelativePath(projectPath, asset.path),
            assetUrl: assetUrlFor(asset.path),
            originalName: asset.originalName || path.basename(asset.path),
            revisedPrompt: "",
            runId: "import-" + asset.sha256.slice(0, 16),
            width: Number(asset.width) || void 0,
            height: Number(asset.height) || void 0
        }));
        imageImportCounters.completed += 1;
        imageImportCounters.lastDurationMs = Date.now() - startedAt;
        imageImportCounters.lastSelectedCount = Number(imported.selectedCount) || 0;
        imageImportCounters.lastImportedCount = assets.length;
        imageImportCounters.lastSkippedCount = Number(imported.skippedCount) || 0;
        imageImportCounters.lastMaxActiveFiles = Number(imported.maxActiveFiles) || 0;
        imageImportCounters.lastWorkerPid = Number(imported.workerPid) || 0;
        imageImportCounters.lastErrorCode = "";
        const skipReasonSummary = imported.skipReasons && typeof imported.skipReasons === "object" ? JSON.stringify(imported.skipReasons) : "{}";
        const skipSampleSummary = Array.isArray(imported.skippedSamples) ? JSON.stringify(imported.skippedSamples.map(sample => ({
            reason: sample?.reason || "",
            message: sample?.message || "",
            decoder: sample?.details?.decoder || ""
        }))) : "[]";
        log(`asset batch import project=${requestedProjectId || "active"} files=${assets.length} skipped=${imported.skippedCount} skipReasons=${skipReasonSummary} skipSamples=${skipSampleSummary} duration=${imageImportCounters.lastDurationMs}ms worker=${imported.workerPid}`);
        return {
            ok: !0,
            assets: assets,
            ...payload.includeSourcePaths ? {
                sourcePaths: imported.assets.map(asset => asset.sourcePath)
            } : {},
            roots: (Array.isArray(imported.roots) ? imported.roots : []).map(root => ({
                importBatchId: String(root.importBatchId || imported.importBatchId || "").slice(0, 160),
                importRootIndex: Math.max(0, Math.floor(Number(root.importRootIndex) || 0)),
                importRootId: String(root.importRootId || "").slice(0, 80),
                sourceRootLabel: String(root.sourceRootLabel || "").slice(0, 260),
                sourceRootKind: root.sourceRootKind === "directory" ? "directory" : "file"
            })),
            importBatchId: String(imported.importBatchId || "").slice(0, 160),
            selectedCount: imported.selectedCount,
            uniqueAssetCount: imported.uniqueAssetCount,
            occurrenceCount: imported.occurrenceCount,
            skippedCount: imported.skippedCount,
            truncated: imported.truncated,
            duplicateCount: imported.duplicateCount,
            reusedCount: imported.reusedCount,
            durationMs: imageImportCounters.lastDurationMs,
            maxActiveFiles: imported.maxActiveFiles,
            workerPid: imported.workerPid
        };
    } catch (error) {
        const code = String(error?.code || "IMAGE_IMPORT_FAILED");
        imageImportCounters.lastDurationMs = Date.now() - startedAt;
        imageImportCounters.lastErrorCode = code;
        code === "IMAGE_IMPORT_CLOSED" ? imageImportCounters.canceled += 1 : imageImportCounters.errors += 1;
        throw error;
    } finally {
        imageImportCounters.active = Math.max(0, imageImportCounters.active - 1);
    }
}

function sanitizeOutputBucket(value) {
    const normalized = String(value || "imagegen").trim().toLowerCase();
    return normalized === "post" || normalized === "imagegen" ? normalized : "imagegen";
}

function sanitizeOutputSubdir(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.split(/[\\/]+/).map(part => sanitizeFileStem(part, "")).filter(Boolean).slice(0, 4).join(path.sep);
}

function outputBucketDirForProjectId(projectId, bucket = "imagegen", subdir = "") {
    const project = imageProjectForOperation(projectId, "写入图片输出");
    if (!project?.path) throw new Error("当前没有可用的项目输出目录。");
    const projectPath = path.resolve(project?.path || path.dirname(currentSessionPath()) || projectRoot);
    const baseDir = path.join(projectPath, "output", sanitizeOutputBucket(bucket));
    const cleanSubdir = sanitizeOutputSubdir(subdir);
    return cleanSubdir ? path.join(baseDir, cleanSubdir) : baseDir;
}

function activeProjectTempDir(projectId) {
    return path.join(outputDirForProjectId(projectId), "_plugin-temp");
}

function newApiAbortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error(signal?.reason ? String(signal.reason) : "New API 请求已取消。");
    error.code = "ABORT_ERR";
    return error;
}

function uniqueModelIds(modelIds = []) {
    const seen = new Set;
    const output = [];
    for (const modelId of modelIds) {
        const clean = String(modelId || "").trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(clean);
    }
    return output;
}

function encodedImageDimensions(buffer) {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([ 137, 80, 78, 71, 13, 10, 26, 10 ]))) return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
    };
    if (buffer.length >= 12 && buffer[0] === 255 && buffer[1] === 216) {
        const sofMarkers = new Set([ 192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207 ]);
        let offset = 2;
        while (offset + 8 < buffer.length) {
            if (buffer[offset] !== 255) {
                offset += 1;
                continue;
            }
            while (offset < buffer.length && buffer[offset] === 255) offset += 1;
            const marker = buffer[offset];
            if (sofMarkers.has(marker) && offset + 7 < buffer.length) return {
                height: buffer.readUInt16BE(offset + 4),
                width: buffer.readUInt16BE(offset + 6)
            };
            if (marker === 216 || marker === 217 || marker >= 208 && marker <= 215) {
                offset += 1;
                continue;
            }
            if (offset + 2 >= buffer.length) break;
            const length = buffer.readUInt16BE(offset + 1);
            if (length < 2) break;
            offset += 1 + length;
        }
    }
    if (buffer.length >= 20 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        let offset = 12;
        while (offset + 8 <= buffer.length) {
            const chunkType = buffer.subarray(offset, offset + 4).toString("ascii");
            const chunkSize = buffer.readUInt32LE(offset + 4);
            const dataOffset = offset + 8;
            if (chunkSize > buffer.length - dataOffset) break;
            if (chunkType === "VP8X" && chunkSize >= 10) return {
                width: buffer.readUIntLE(dataOffset + 4, 3) + 1,
                height: buffer.readUIntLE(dataOffset + 7, 3) + 1
            };
            if (chunkType === "VP8L" && chunkSize >= 5 && buffer[dataOffset] === 47) {
                const b1 = buffer[dataOffset + 1];
                const b2 = buffer[dataOffset + 2];
                const b3 = buffer[dataOffset + 3];
                const b4 = buffer[dataOffset + 4];
                return {
                    width: 1 + b1 + ((b2 & 63) << 8),
                    height: 1 + ((b2 & 192) >> 6) + (b3 << 2) + ((b4 & 15) << 10)
                };
            }
            if (chunkType === "VP8 " && chunkSize >= 10 && buffer[dataOffset + 3] === 157 && buffer[dataOffset + 4] === 1 && buffer[dataOffset + 5] === 42) return {
                width: buffer.readUInt16LE(dataOffset + 6) & 16383,
                height: buffer.readUInt16LE(dataOffset + 8) & 16383
            };
            const paddedSize = chunkSize + chunkSize % 2;
            if (paddedSize > Number.MAX_SAFE_INTEGER - dataOffset) break;
            offset = dataOffset + paddedSize;
        }
    }
    return null;
}

function assertSafeEncodedImageDimensions(buffer, name) {
    const dimensions = encodedImageDimensions(buffer);
    if (!dimensions) return;
    if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > 12e3 || dimensions.height > 12e3 || dimensions.width * dimensions.height > 64e6) {
        const error = new Error(`图片 ${name} 像素尺寸过大或无效，请先缩小后再处理。`);
        error.code = "AIEYRA_SOURCE_DIMENSIONS_TOO_LARGE";
        throw error;
    }
}

function boundedImageRead(filePath, maximumBytes, name, kind = "图片") {
    const safeMaximum = Math.max(1, Math.floor(Number(maximumBytes) || 0));
    const descriptor = openSync(filePath, "r");
    try {
        const info = fstatSync(descriptor);
        if (!info.isFile()) {
            const error = new Error(`${kind} ${name} 不是有效文件。`);
            error.code = "AIEYRA_SOURCE_NOT_FILE";
            throw error;
        }
        if (info.size > safeMaximum) {
            const error = new Error(`${kind} ${name} 超过 ${Math.round(safeMaximum / 1024 / 1024)}MB。`);
            error.code = "AIEYRA_SOURCE_TOO_LARGE";
            throw error;
        }
        const ceiling = safeMaximum + 1;
        let capacity = Math.min(ceiling, Math.max(65536, Number(info.size || 0) + 1));
        let buffer = Buffer.allocUnsafe(capacity);
        let offset = 0;
        while (offset < ceiling) {
            if (offset === buffer.length) {
                const nextCapacity = Math.min(ceiling, Math.max(offset + 65536, buffer.length * 2));
                if (nextCapacity <= buffer.length) break;
                const expanded = Buffer.allocUnsafe(nextCapacity);
                buffer.copy(expanded, 0, 0, offset);
                buffer = expanded;
            }
            const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
            if (bytesRead === 0) break;
            offset += bytesRead;
        }
        if (offset > safeMaximum) {
            const error = new Error(`${kind} ${name} 在读取期间发生变化或超过 ${Math.round(safeMaximum / 1024 / 1024)}MB。`);
            error.code = "AIEYRA_SOURCE_TOO_LARGE";
            throw error;
        }
        return buffer.subarray(0, offset);
    } finally {
        closeSync(descriptor);
    }
}

const agentAttachmentMaxFiles = 24;

const agentAttachmentMaxBytes = 100663296;

const agentAttachmentMaxFileBytes = 25165824;

const agentAttachmentTextPreviewBytes = 12288;

const agentKnowledgeTextMaxChars = 49152;

const agentKnowledgeTotalTextMaxChars = 98304;

const agentKnowledgeMaxEstimatedTokens = 32768;

const agentAttachmentTextExtensions = new Set([ ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".xml", ".html", ".htm", ".yaml", ".yml" ]);

const agentKnowledgeExtensions = new Set([ ...agentAttachmentTextExtensions, ".docx", ".pdf" ]);

function estimatedKnowledgeTokens(text) {
    const value = String(text || "");
    const han = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
    return Math.max(1, Math.ceil(han + Math.max(0, value.length - han) / 4));
}

async function extractAgentKnowledgeText(sourcePath, extension, buffer) {
    if (agentAttachmentTextExtensions.has(extension)) return {
        canonicalText: buffer.toString("utf8").replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim(),
        warnings: [],
        expectedSourceSha256: createHash("sha256").update(buffer).digest("hex")
    };
    if (extension === ".docx") {
        const prepared = await prepareDocxImport(sourcePath);
        const stable = assertPreparedDocxSourceStable(prepared);
        return {
            canonicalText: String(prepared.canonicalText || "").trim(),
            warnings: prepared.warnings || [],
            expectedSourceSha256: stable.sha256
        };
    }
    if (extension === ".pdf") {
        const prepared = await preparePdfImport(sourcePath);
        return {
            canonicalText: String(prepared.canonicalText || "").trim(),
            warnings: prepared.warnings || [],
            expectedSourceSha256: String(prepared.expectedSourceSha256 || "")
        };
    }
    return {
        canonicalText: "",
        warnings: [ "该文件格式暂不支持提取知识正文。" ],
        expectedSourceSha256: ""
    };
}

function agentAttachmentMimeType(filePath) {
    const ext = path.extname(String(filePath || "")).toLowerCase();
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
        ".jfif": "image/jpeg",
        ".avif": "image/avif",
        ".heic": "image/heic",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".json": "application/json",
        ".csv": "text/csv",
        ".tsv": "text/tab-separated-values",
        ".log": "text/plain",
        ".xml": "application/xml",
        ".html": "text/html",
        ".htm": "text/html",
        ".yaml": "text/yaml",
        ".yml": "text/yaml",
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    }[ext] || "application/octet-stream";
}

function agentAttachmentKind(mimeType, filePath) {
    if (/^image\//i.test(String(mimeType || ""))) return "image";
    if (/^text\//i.test(String(mimeType || "")) || agentAttachmentTextExtensions.has(path.extname(String(filePath || "")).toLowerCase())) return "text";
    if (/^(application\/pdf|application\/msword|application\/vnd\.)/i.test(String(mimeType || ""))) return "document";
    return "other";
}

function agentAttachmentProjectForOperation(projectId, operation = "导入附件") {
    const list = readProjectList();
    const requested = typeof projectId === "string" ? projectId.trim() : "";
    const project = requested ? getProjectById(requested, list) : getActiveProject(list);
    if (!project?.path) throw new Error("当前项目不存在或没有可用的文件目录。");
    assertProjectWritable(project, operation);
    return project;
}

function safeAgentAttachmentName(filePath) {
    const parsed = path.parse(path.basename(filePath));
    const stem = sanitizeFileStem(parsed.name, "attachment").slice(0, 56) || "attachment";
    const ext = parsed.ext.toLowerCase();
    return `${stem}${ext}`;
}

function writeAgentAttachmentControlledCopy(attachmentDir, destination, buffer, expectedSha256) {
    const root = path.resolve(attachmentDir);
    const target = path.resolve(destination);
    if (comparablePath(path.dirname(target)) !== comparablePath(root)) throw new Error("附件目标路径越界，已停止导入。");
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("附件目录不是受控普通目录，已停止导入。");
    const realRoot = realpathSync(root);
    const expectedHash = String(expectedSha256 || "").toLowerCase();
    if (!expectedHash || createHash("sha256").update(buffer).digest("hex") !== expectedHash) throw new Error("附件内容校验失败，已停止导入。");
    const verifyExisting = () => {
        const link = lstatSync(target);
        if (!link.isFile() || link.isSymbolicLink() || Number(link.nlink) !== 1) throw new Error("附件目标不是受控普通文件，已停止导入。");
        if (link.size !== buffer.length) throw new Error("附件目标存在同名内容冲突，已停止导入。");
        const realTarget = realpathSync(target);
        if (comparablePath(path.dirname(realTarget)) !== comparablePath(realRoot)) throw new Error("附件目标真实路径越界，已停止导入。");
        const current = readFileSync(realTarget);
        if (current.length !== buffer.length || createHash("sha256").update(current).digest("hex") !== expectedHash) throw new Error("附件目标存在同名内容冲突，已停止导入。");
        return realTarget;
    };
    if (existsSync(target)) return verifyExisting();
    let descriptor = null;
    try {
        descriptor = openSync(target, "wx", 384);
        writeFileSync(descriptor, buffer);
        const written = fstatSync(descriptor);
        if (!written.isFile() || Number(written.nlink) !== 1 || written.size !== buffer.length) throw new Error("附件副本写入不完整，已停止导入。");
    } catch (error) {
        if (error?.code === "EEXIST") return verifyExisting();
        throw error;
    } finally {
        if (descriptor !== null) try {
            closeSync(descriptor);
        } catch {}
    }
    return verifyExisting();
}

async function importAgentFilesToProject(payload = {}) {
    const project = agentAttachmentProjectForOperation(payload.projectId, "导入 Agent 附件");
    const purpose = payload.purpose === "knowledge" ? "knowledge" : "attachment";
    const requestedLimit = Number(payload.maxFiles);
    const maxFiles = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, agentAttachmentMaxFiles)) : agentAttachmentMaxFiles;
    const inputPaths = Array.from(new Set((Array.isArray(payload.paths) ? payload.paths : []).map(value => typeof value === "string" ? path.resolve(value) : "").filter(Boolean)));
    const inputFiles = Array.isArray(payload.files) ? [ ...payload.files ] : [];
    if (inputPaths.length + inputFiles.length > agentAttachmentMaxFiles) throw Error("一次最多添加 24 个文件。");
    if (payload.clipboardImage) {
        const image = clipboard.readImage();
        if (image.isEmpty()) throw Error("剪贴板中没有可粘贴的图片。");
        inputFiles.push({
            name: "粘贴图片.png",
            bytes: image.toPNG()
        });
    }
    const inputs = [ ...inputPaths.map(sourcePath => ({
        sourcePath: sourcePath
    })), ...inputFiles.map(file => ({
        file: file
    })) ];
    const attachmentDir = path.join(path.resolve(project.path), "output", "agent-attachments");
    mkdirSync(attachmentDir, {
        recursive: !0
    });
    const files = [];
    let totalBytes = 0;
    let totalKnowledgeChars = 0;
    let skippedCount = 0;
    const warnings = [];
    for (const input of inputs) {
        if (files.length >= maxFiles) {
            skippedCount += 1;
            continue;
        }
        let sourcePath = input.sourcePath || path.basename(String(input.file?.name || "未命名文件"));
        let stats, buffer;
        try {
            if (input.file) {
                if (!(input.file.bytes instanceof Uint8Array) || input.file.bytes.byteLength > agentAttachmentMaxFileBytes) throw Error("文件内容无效或超过 24 MB。");
                buffer = Buffer.from(input.file.bytes);
                stats = {
                    size: buffer.length
                };
            } else {
                const link = lstatSync(sourcePath);
                if (!link.isFile() || link.isSymbolicLink()) throw Error("请拖入普通文件，目录与链接请使用画布导入。");
                stats = statSync(sourcePath);
            }
        } catch (error) {
            skippedCount += 1;
            warnings.push(`${path.basename(sourcePath)}：${error.message}`);
            continue;
        }
        let ext = path.extname(sourcePath).toLowerCase();
        const allowedExtension = purpose !== "knowledge" || agentKnowledgeExtensions.has(ext);
        if (!allowedExtension || stats.size > agentAttachmentMaxFileBytes || totalBytes + stats.size > agentAttachmentMaxBytes) {
            warnings.length < 12 && warnings.push(`${path.basename(sourcePath)}：${allowedExtension ? "超过单文件 24 MB 或本次合计 96 MB 限制" : "当前知识文档用途不支持该格式"}。`);
            skippedCount += 1;
            continue;
        }
        buffer ||= readFileSync(sourcePath);
        if (buffer.length !== stats.size) {
            skippedCount += 1;
            warnings.push(`${path.basename(sourcePath)}：文件读取期间已变化，请重新添加。`);
            continue;
        }
        if (purpose === "attachment" && !/^image\//.test(agentAttachmentMimeType(sourcePath))) {
            const imageExt = buffer.subarray(0, 8).equals(Buffer.from([ 137, 80, 78, 71, 13, 10, 26, 10 ])) ? ".png" : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? ".jpg" : /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString()) ? ".gif" : buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" ? ".webp" : "";
            if (imageExt) {
                sourcePath += imageExt;
                ext = imageExt;
            }
        }
        const contentHash = createHash("sha256").update(buffer).digest("hex");
        let knowledgeText = "";
        let knowledgeWarnings = [];
        let knowledgeTokens = 0;
        if (purpose === "knowledge") {
            try {
                const extracted = await extractAgentKnowledgeText(sourcePath, ext, buffer);
                knowledgeText = String(extracted.canonicalText || "").trim();
                knowledgeWarnings = (Array.isArray(extracted.warnings) ? extracted.warnings : []).map(String).filter(Boolean).slice(0, 8);
                knowledgeTokens = estimatedKnowledgeTokens(knowledgeText);
                if (extracted.expectedSourceSha256 && extracted.expectedSourceSha256 !== contentHash) throw new Error("知识文档在读取期间发生变化，请重新选择后再试。");
            } catch (error) {
                skippedCount += 1;
                warnings.length < 12 && warnings.push(`${path.basename(sourcePath)}：${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            if (!knowledgeText) {
                skippedCount += 1;
                warnings.length < 12 && warnings.push(`${path.basename(sourcePath)}：没有提取到可读正文。`);
                continue;
            }
            if (knowledgeText.length > agentKnowledgeTextMaxChars || knowledgeTokens > agentKnowledgeMaxEstimatedTokens) {
                skippedCount += 1;
                warnings.length < 12 && warnings.push(`${path.basename(sourcePath)}：正文约 ${knowledgeTokens.toLocaleString()} TOKEN，超过单份知识文档限制，未加入。`);
                continue;
            }
            if (totalKnowledgeChars + knowledgeText.length > agentKnowledgeTotalTextMaxChars) {
                skippedCount += 1;
                warnings.length < 12 && warnings.push(`${path.basename(sourcePath)}：本轮知识正文总量超过限制，未加入。`);
                continue;
            }
        }
        const mimeType = agentAttachmentMimeType(sourcePath);
        const name = path.basename(sourcePath).slice(0, 220) || safeAgentAttachmentName(sourcePath);
        const destination = path.join(attachmentDir, `${contentHash.slice(0, 16)}-${safeAgentAttachmentName(sourcePath)}`);
        try {
            writeAgentAttachmentControlledCopy(attachmentDir, destination, buffer, contentHash);
        } catch (error) {
            skippedCount += 1;
            warnings.length < 12 && warnings.push(`${path.basename(sourcePath)}：${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        let textPreview = "";
        let textTruncated = !1;
        if (purpose === "knowledge") {
            textPreview = knowledgeText;
            textTruncated = !1;
        } else if (agentAttachmentTextExtensions.has(ext)) {
            textPreview = buffer.subarray(0, agentAttachmentTextPreviewBytes).toString("utf8").replace(/\u0000/g, "").slice(0, agentAttachmentTextPreviewBytes);
            textTruncated = buffer.length > agentAttachmentTextPreviewBytes;
        }
        const relativePath = projectRelativePath(project.path, destination);
        files.push({
            id: `file-${contentHash.slice(0, 24)}`,
            name: name,
            path: destination,
            relativePath: relativePath,
            assetUrl: assetUrlFor(destination),
            mimeType: mimeType,
            size: stats.size,
            contentHash: contentHash,
            kind: agentAttachmentKind(mimeType, sourcePath),
            purpose: purpose,
            ...input.file?.pasteBlock === !0 ? {
                pasteBlock: {
                    lines: buffer.length ? buffer.toString("utf8").split(/\r\n|\r|\n/).length : 0,
                    chars: [ ...buffer.toString("utf8") ].length
                }
            } : {},
            ...textPreview ? {
                textPreview: textPreview
            } : {},
            ...textTruncated ? {
                textTruncated: !0
            } : {},
            ...purpose === "knowledge" ? {
                textChars: knowledgeText.length,
                estimatedTokens: knowledgeTokens,
                parseWarnings: knowledgeWarnings
            } : {}
        });
        totalBytes += stats.size;
        purpose === "knowledge" && (totalKnowledgeChars += knowledgeText.length);
    }
    log(`agent attachments project=${project.id} files=${files.length} skipped=${skippedCount} bytes=${totalBytes}`);
    return {
        ok: !0,
        files: files,
        selectedCount: inputs.length,
        skippedCount: skippedCount,
        truncated: inputs.length > maxFiles || skippedCount > 0,
        warnings: warnings
    };
}

function sanitizeFileStem(value, fallback = "image") {
    return String(value || fallback).replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || fallback;
}

function writeDataUrlOutput(dataUrl, stem, runId = "", projectId = "", options = {}) {
    const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!match) throw new Error("invalid image data url");
    const outputDir = outputBucketDirForProjectId(projectId, options.bucket, options.subdir);
    mkdirSync(outputDir, {
        recursive: !0
    });
    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const filePath = path.join(outputDir, `${sanitizeFileStem(stem)}.${ext}`);
    const buffer = Buffer.from(match[2], "base64");
    writeFileSync(filePath, buffer);
    return {
        index: 1,
        type: "file",
        path: filePath,
        assetUrl: assetUrlFor(filePath),
        contentHash: createHash("sha256").update(buffer).digest("hex"),
        revisedPrompt: "",
        runId: runId
    };
}

function persistedNodeSequenceFromCode(value) {
    const code = String(value || "").trim().toUpperCase();
    if (/^[A-Z]$/.test(code)) return code.charCodeAt(0) - 64;
    const numbered = code.match(/^N(\d+)$/);
    return numbered ? Math.max(0, Number(numbered[1]) || 0) : 0;
}

function sessionAssetContentHash(asset) {
    const source = asset && typeof asset === "object" ? asset : {};
    const value = String(source.contentHash || source.sha256 || "").trim().toLowerCase();
    return /^[a-f0-9]{32,128}$/.test(value) ? value : "";
}

function sessionAssetOccurrenceId(asset, ownerId = "asset", assetIndex = 0) {
    const source = asset && typeof asset === "object" ? asset : {};
    const existing = String(source.occurrenceId || "").trim().toLowerCase();
    if (/^occ-[a-f0-9]{16,64}$/.test(existing)) return existing;
    const importBatchId = String(source.importBatchId || "").trim();
    const importRootId = String(source.importRootId || "").trim();
    const sourceRelativePath = safeImageSourceRelativePath(source.sourceRelativePath).toLowerCase();
    const runId = String(source.runId || "").trim().toLowerCase();
    const assetId = String(source.assetId || `asset-${sessionAssetFingerprint(source, assetIndex + 1, ownerId, assetIndex)}`).trim();
    const identity = importBatchId && importRootId && sourceRelativePath ? `import:${importBatchId}|root:${importRootId}|source:${sourceRelativePath}` : runId ? `run:${runId}|slot:${Math.max(0, Math.floor(Number(assetIndex) || 0))}|asset:${assetId}` : `owner:${ownerId}|asset:${assetId}`;
    return `occ-${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function sessionAssetIdentityLocators(asset) {
    const source = asset && typeof asset === "object" ? asset : {};
    const relativePath = String(source.relativePath || "").trim().replace(/\\/g, "/").toLowerCase();
    const localPath = String(source.path || "").trim().replace(/\\/g, "/").toLowerCase();
    const assetUrl = String(source.assetUrl || "").trim();
    const url = String(source.url || "").trim();
    const stableAssetUrl = /^(?:data|blob):/i.test(assetUrl) ? "" : assetUrl;
    const stableUrl = /^(?:data|blob):/i.test(url) ? "" : url;
    return [ ...new Set([ relativePath ? `relative-path:${relativePath}` : "", localPath ? `path:${localPath}` : "", stableAssetUrl ? `asset-url:${stableAssetUrl}` : "", stableUrl ? `url:${stableUrl}` : "" ].filter(Boolean)) ];
}

function sessionAssetFingerprint(asset, fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null) {
    const source = asset && typeof asset === "object" ? asset : {};
    const contentHash = sessionAssetContentHash(source);
    const locators = sessionAssetIdentityLocators(source);
    const bridgedHashes = new Set;
    if (!contentHash && contentHashesByLocator) for (const locator of locators) {
        const hashes = contentHashesByLocator.get(locator);
        hashes?.size === 1 && bridgedHashes.add([ ...hashes ][0]);
    }
    const effectiveContentHash = contentHash || (bridgedHashes.size === 1 ? [ ...bridgedHashes ][0] : "");
    const runId = String(source.runId || "").trim();
    const originalName = String(source.originalName || source.fileName || source.name || "").trim().toLowerCase();
    const index = Math.max(1, Number(source.index || fallbackIndex) || 1);
    let identity = effectiveContentHash ? `content:${effectiveContentHash}` : locators.length ? locators[0] : runId ? `run:${runId}|index:${index}` : originalName ? `name:${originalName}|index:${index}` : `index:${index}`;
    effectiveContentHash || locators.length !== 0 || runId || (identity = `${identity}|owner:${String(ownerId || "")}|slot:${Math.max(0, Number(slot) || 0)}`);
    return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

function sessionAssetAliasFingerprints(asset, fallbackIndex = 1, ownerId = "", slot = 0, contentHashesByLocator = null) {
    const primary = sessionAssetFingerprint(asset, fallbackIndex, ownerId, slot, contentHashesByLocator);
    const contentHash = sessionAssetContentHash(asset);
    const locators = sessionAssetIdentityLocators(asset);
    const bridgedHashes = new Set;
    if (!contentHash && contentHashesByLocator) for (const locator of locators) {
        const hashes = contentHashesByLocator.get(locator);
        hashes?.size === 1 && bridgedHashes.add([ ...hashes ][0]);
    }
    if (contentHash || bridgedHashes.size === 1 || locators.length === 0) return [ primary ];
    return [ ...new Set([ primary, ...locators.map(locator => createHash("sha256").update(locator).digest("hex").slice(0, 32)) ]) ];
}

function repairSessionAssetIdentities(nodes) {
    const records = [];
    const pinCollectionAssetSlots = (collection, assets) => {
        if (!collection || typeof collection !== "object" || !Array.isArray(collection.items)) return collection;
        return {
            ...collection,
            items: collection.items.map((item, itemIndex) => {
                if (!item || typeof item !== "object" || item.status === "pending" || item.status === "error") return item;
                const explicit = Number(item.assetIndex);
                if (Number.isInteger(explicit) && explicit >= 1 && explicit <= assets.length) return item;
                const assetId = String(item.assetId || "").trim();
                const occurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(item.occurrenceId || "").trim()) ? String(item.occurrenceId).trim().toLowerCase() : "";
                const requestIndex = Math.max(1, Math.floor(Number(item.requestIndex || itemIndex + 1) || itemIndex + 1));
                const occurrenceIndex = occurrenceId ? assets.findIndex(asset => asset?.occurrenceId === occurrenceId) : -1;
                const matchingIdIndexes = assetId ? assets.map((asset, index) => String(asset?.assetId || "").trim() === assetId ? index : -1).filter(index => index >= 0) : [];
                const matchedIndex = occurrenceIndex >= 0 ? occurrenceIndex : matchingIdIndexes.length === 1 ? matchingIdIndexes[0] : matchingIdIndexes.find(index => Number(assets[index]?.index) === requestIndex) ?? assets.findIndex(asset => Number(asset?.index) === requestIndex);
                return matchedIndex >= 0 ? {
                    ...item,
                    assetIndex: matchedIndex + 1,
                    occurrenceId: sessionAssetOccurrenceId(assets[matchedIndex], "image-collection", matchedIndex)
                } : item;
            })
        };
    };
    const register = (asset, nodeId, slot, apply, ownerId = nodeId) => {
        if (!asset || typeof asset !== "object") return asset;
        const next = {
            ...asset
        };
        delete next.inputRoot;
        delete next.sourcePath;
        typeof next.importBatchId === "string" && (next.importBatchId = next.importBatchId.trim().slice(0, 160) || void 0);
        typeof next.importRootId === "string" && (next.importRootId = next.importRootId.trim().slice(0, 80) || void 0);
        typeof next.sourceRootLabel === "string" && (next.sourceRootLabel = next.sourceRootLabel.trim().slice(0, 260) || void 0);
        next.sourceRootKind !== "directory" && next.sourceRootKind !== "file" && delete next.sourceRootKind;
        typeof next.sourceRelativePath === "string" && (next.sourceRelativePath = safeImageSourceRelativePath(next.sourceRelativePath) || void 0);
        next.occurrenceId = sessionAssetOccurrenceId(next, ownerId, slot);
        apply(next);
        records.push({
            asset: next,
            nodeId: nodeId,
            ownerId: ownerId,
            slot: slot,
            oldId: String(next.assetId || "").trim(),
            displayCode: String(next.displayCode || "").trim()
        });
        return next;
    };
    for (const node of nodes) {
        const rawAssets = Array.isArray(node.assets) ? node.assets : [];
        node.imageCollection && (node.imageCollection = pinCollectionAssetSlots(node.imageCollection, rawAssets));
        node.imageContainerSpec?.collection && (node.imageContainerSpec = {
            ...node.imageContainerSpec,
            collection: pinCollectionAssetSlots(node.imageContainerSpec.collection, rawAssets)
        });
        node.assets = (Array.isArray(node.assets) ? node.assets : []).map((asset, index) => register(asset, node.id, index, () => {}));
        node.imageParams && Array.isArray(node.imageParams.referenceImages) && (node.imageParams = {
            ...node.imageParams,
            referenceImages: node.imageParams.referenceImages.map((asset, index) => register(asset, node.id, index, () => {}, `${node.id}:imageParams`))
        });
        node.imageParams?.maskImage && (node.imageParams = {
            ...node.imageParams,
            maskImage: register(node.imageParams.maskImage, node.id, 0, () => {}, `${node.id}:imageParams-mask`)
        });
        if (node.layerGroup) {
            node.layerGroup = {
                ...node.layerGroup
            };
            node.layerGroup.previewAsset && (node.layerGroup.previewAsset = register(node.layerGroup.previewAsset, node.id, 0, () => {}, `${node.id}:group-preview`));
            node.layerGroup.mergedAsset && (node.layerGroup.mergedAsset = register(node.layerGroup.mergedAsset, node.id, 0, () => {}, `${node.id}:group-merged`));
        }
        if (node.layerComposition) {
            node.layerComposition = {
                ...node.layerComposition
            };
            node.layerComposition.previewAsset && (node.layerComposition.previewAsset = register(node.layerComposition.previewAsset, node.id, 0, () => {}, `${node.id}:layer-preview`));
            node.layerComposition.mergedAsset && (node.layerComposition.mergedAsset = register(node.layerComposition.mergedAsset, node.id, 0, () => {}, `${node.id}:layer-merged`));
            Array.isArray(node.layerComposition.layers) && (node.layerComposition.layers = node.layerComposition.layers.map((layer, index) => ({
                ...layer,
                asset: layer?.asset ? register(layer.asset, node.id, index, () => {}, `${node.id}:layer:${layer.id || index}`) : layer?.asset
            })));
        }
    }
    const contentHashesByLocator = new Map;
    for (const record of records) {
        const contentHash = sessionAssetContentHash(record.asset);
        if (!contentHash) continue;
        for (const locator of sessionAssetIdentityLocators(record.asset)) {
            const hashes = contentHashesByLocator.get(locator) || new Set;
            hashes.add(contentHash);
            contentHashesByLocator.set(locator, hashes);
        }
    }
    for (const record of records) {
        record.fingerprint = sessionAssetFingerprint(record.asset, record.slot + 1, record.ownerId, record.slot, contentHashesByLocator);
        record.aliasFingerprints = sessionAssetAliasFingerprints(record.asset, record.slot + 1, record.ownerId, record.slot, contentHashesByLocator);
    }
    const recordsByOldId = new Map;
    const assigned = new Map;
    const canonicalByFingerprint = new Map;
    const canonicalReferenceByFingerprint = new Map;
    const allocations = new Map;
    const allocate = (record, preferred) => {
        let candidate = preferred;
        let salt = 0;
        while (assigned.has(candidate) && assigned.get(candidate) !== record.fingerprint) candidate = `asset-${createHash("sha256").update(`${record.fingerprint}|${record.ownerId}|${record.slot}|${salt++}`).digest("hex").slice(0, 32)}`;
        assigned.set(candidate, record.fingerprint);
        return candidate;
    };
    for (const record of records) {
        const oldId = record.oldId || `asset-${record.fingerprint}`;
        record.oldId = oldId;
        const sameOldId = recordsByOldId.get(oldId) || [];
        sameOldId.push(record);
        recordsByOldId.set(oldId, sameOldId);
        let assetId = record.aliasFingerprints.map(fingerprint => canonicalByFingerprint.get(fingerprint)).find(Boolean);
        if (!assetId) {
            assetId = assigned.has(oldId) && assigned.get(oldId) !== record.fingerprint ? allocate(record, `asset-${record.fingerprint}`) : oldId;
            assigned.set(assetId, record.fingerprint);
        }
        record.aliasFingerprints.forEach(fingerprint => canonicalByFingerprint.set(fingerprint, assetId));
        allocations.set(`${oldId}\n${record.fingerprint}`, assetId);
        record.asset.assetId = assetId;
    }
    return {
        resolve: (reference, fallbackIndex = 1) => {
            if (!reference || typeof reference !== "object") return reference;
            const oldId = String(reference.assetId || "").trim();
            const nodeId = String(reference.nodeId || "").trim();
            const assetIndex = Number(reference.assetIndex);
            const fingerprint = sessionAssetFingerprint(reference, fallbackIndex, nodeId, Number.isInteger(assetIndex) ? assetIndex : Math.max(0, fallbackIndex - 1), contentHashesByLocator);
            const aliasFingerprints = sessionAssetAliasFingerprints(reference, fallbackIndex, nodeId, Number.isInteger(assetIndex) ? assetIndex : Math.max(0, fallbackIndex - 1), contentHashesByLocator);
            const canonical = aliasFingerprints.map(alias => canonicalByFingerprint.get(alias)).find(Boolean);
            if (canonical) return {
                ...reference,
                assetId: canonical
            };
            const exact = oldId ? allocations.get(`${oldId}\n${fingerprint}`) : "";
            if (exact) return {
                ...reference,
                assetId: exact
            };
            const candidates = oldId && recordsByOldId.get(oldId) || [];
            const matched = candidates.find(record => nodeId && record.nodeId === nodeId && Number.isInteger(assetIndex) && record.slot === assetIndex) || candidates.find(record => reference.displayCode && record.displayCode === reference.displayCode) || (candidates.length === 1 ? candidates[0] : null);
            if (matched) return {
                ...reference,
                assetId: matched.asset.assetId
            };
            const knownReferenceId = aliasFingerprints.map(alias => canonicalReferenceByFingerprint.get(alias)).find(Boolean);
            if (knownReferenceId) return {
                ...reference,
                assetId: knownReferenceId
            };
            let unresolvedId = candidates.length > 1 || !oldId ? `asset-${fingerprint}` : oldId;
            assigned.has(unresolvedId) && assigned.get(unresolvedId) !== fingerprint && (unresolvedId = `asset-${fingerprint}`);
            assigned.set(unresolvedId, fingerprint);
            aliasFingerprints.forEach(alias => canonicalReferenceByFingerprint.set(alias, unresolvedId));
            return {
                ...reference,
                assetId: unresolvedId
            };
        }
    };
}

function repairSessionMessageAssetIds(messages, resolve) {
    return (Array.isArray(messages) ? messages : []).map(message => {
        if (!message || typeof message !== "object" || !message.attachments) return message;
        return {
            ...message,
            attachments: {
                ...message.attachments,
                sourceAssets: Array.isArray(message.attachments.sourceAssets) ? message.attachments.sourceAssets.map((asset, index) => resolve(asset, index + 1)) : [],
                referenceAssets: Array.isArray(message.attachments.referenceAssets) ? message.attachments.referenceAssets.map((asset, index) => resolve(asset, index + 1)) : [],
                contextAssets: Array.isArray(message.attachments.contextAssets) ? message.attachments.contextAssets.map((asset, index) => resolve(asset, index + 1)) : []
            }
        };
    });
}

const persistedRequirementScenarios = new Set([ "text-to-image", "image-to-image", "replace-element", "place-element", "virtual-try-on", "layered-drawing", "cutout", "region-redraw", "photo-enhance" ]);

function sanitizePersistedRequirementBindings(value) {
    const seen = new Set;
    return (Array.isArray(value) ? value : []).slice(0, 80).flatMap(binding => {
        if (!binding || typeof binding.nodeId !== "string" || !binding.nodeId.trim() || ![ "source", "reference" ].includes(binding.role)) return [];
        const nodeId = binding.nodeId.trim().slice(0, 160);
        if (seen.has(nodeId)) return [];
        seen.add(nodeId);
        return [ {
            nodeId: nodeId,
            role: binding.role,
            ...typeof binding.purpose === "string" && binding.purpose.trim() ? {
                purpose: binding.purpose.trim().slice(0, 1e3)
            } : {}
        } ];
    });
}

function sanitizePersistedCanvasImageTask(value) {
    if (!value || typeof value !== "object" || value.version !== 1 || !persistedRequirementScenarios.has(value.scenario)) return null;
    const task = {
        version: 1,
        scenario: value.scenario,
        inputBindings: sanitizePersistedRequirementBindings(value.inputBindings)
    };
    for (const [key, maximum] of [ [ "requirementNodeId", 160 ], [ "title", 160 ], [ "text", 24e3 ] ]) typeof value[key] === "string" && (task[key] = value[key].trim().slice(0, maximum));
    return task;
}

function sanitizePersistedCanvasRequirement(value, fallbackText = "") {
    if (!value || typeof value !== "object") return null;
    const text = typeof value.text === "string" ? value.text.trim().slice(0, 24e3) : typeof fallbackText === "string" && fallbackText.trim() ? fallbackText.trim().slice(0, 24e3) : "";
    const createdFrom = [ "canvas", "container", "layer" ].includes(value.createdFrom) ? value.createdFrom : "node";
    const requirement = {
        ...sanitizeGoalFeedback(value.goalFeedback) ? {
            goalFeedback: sanitizeGoalFeedback(value.goalFeedback)
        } : {},
        version: [ 1, 2, 3 ].includes(value.version) ? value.version : 1,
        text: text,
        revision: Math.max(1, Math.floor(Number(value.revision || 1))),
        createdFrom: createdFrom,
        ...persistedRequirementScenarios.has(value.scenario) ? {
            scenario: value.scenario
        } : {},
        ...Array.isArray(value.inputBindings) ? {
            inputBindings: sanitizePersistedRequirementBindings(value.inputBindings)
        } : {}
    };
    typeof value.lastSourceSignature === "string" && value.lastSourceSignature.trim() && (requirement.lastSourceSignature = value.lastSourceSignature.trim().slice(0, 160));
    typeof value.lastRunAt === "string" && value.lastRunAt.trim() && (requirement.lastRunAt = value.lastRunAt.trim().slice(0, 80));
    const lastRunCount = Math.max(0, Math.floor(Number(value.lastRunCount || 0)));
    lastRunCount > 0 && (requirement.lastRunCount = lastRunCount);
    typeof value.lastError === "string" && value.lastError.trim() && (requirement.lastError = value.lastError.trim().slice(0, 500));
    return requirement;
}

function sanitizePersistedImageTaskProvenance(value) {
    if (!value || typeof value !== "object" || value.version !== 1) return null;
    const snapshotHash = String(value.taskScopeSnapshotHash || "").trim().toLowerCase();
    const resultPolicies = new Set([ "single", "grouped-by-source", "grouped-by-container", "layer-variants" ]);
    if (!/^scope-[a-f0-9]{32}$/.test(snapshotHash) || !resultPolicies.has(value.resultPolicy)) return null;
    const clean = (input, maximum) => typeof input === "string" && input.trim() ? input.trim().slice(0, maximum) : void 0;
    const revision = Number(value.requirementRevision);
    const expectedSourceBindingIds = [ ...new Set((Array.isArray(value.expectedSourceBindingIds) ? value.expectedSourceBindingIds : []).map(item => clean(item, 520)).filter(Boolean)) ].slice(0, 200);
    return {
        version: 1,
        taskScopeSnapshotHash: snapshotHash,
        resultPolicy: value.resultPolicy,
        ...clean(value.sourceBindingId, 520) ? {
            sourceBindingId: clean(value.sourceBindingId, 520)
        } : {},
        ...expectedSourceBindingIds.length ? {
            expectedSourceBindingIds: expectedSourceBindingIds
        } : {},
        ...clean(value.sourceAssetId, 160) ? {
            sourceAssetId: clean(value.sourceAssetId, 160)
        } : {},
        ...clean(value.sourceOccurrenceId, 80) ? {
            sourceOccurrenceId: clean(value.sourceOccurrenceId, 80)
        } : {},
        ...clean(value.sourceNodeId, 160) ? {
            sourceNodeId: clean(value.sourceNodeId, 160)
        } : {},
        ...clean(value.sourceContainerId, 160) ? {
            sourceContainerId: clean(value.sourceContainerId, 160)
        } : {},
        ...clean(value.sourceDisplayCode, 40) ? {
            sourceDisplayCode: clean(value.sourceDisplayCode, 40)
        } : {},
        ...clean(value.requirementNodeId, 160) ? {
            requirementNodeId: clean(value.requirementNodeId, 160)
        } : {},
        ...Number.isInteger(revision) && revision >= 1 ? {
            requirementRevision: Math.floor(revision)
        } : {}
    };
}

function sanitizePersistedImageCollection(value, assets = []) {
    if (!value || typeof value !== "object") return null;
    const source = value;
    const items = (Array.isArray(source.items) ? source.items : []).slice(0, 10).map((item, index) => {
        const candidate = item && typeof item === "object" ? item : {};
        const requestedStatus = candidate.status === "pending" || candidate.status === "error" ? candidate.status : "done";
        const rawAssetIndex = Number(candidate.assetIndex);
        const candidateAssetId = typeof candidate.assetId === "string" && candidate.assetId.trim() ? candidate.assetId.trim().slice(0, 160) : "";
        const candidateOccurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(candidate.occurrenceId || "").trim()) ? String(candidate.occurrenceId).trim().toLowerCase() : "";
        const explicitAssetIndex = Number.isInteger(rawAssetIndex) && rawAssetIndex >= 1 && rawAssetIndex <= Math.min(10, assets.length) ? rawAssetIndex : void 0;
        const occurrenceIndex = explicitAssetIndex === void 0 && candidateOccurrenceId ? assets.findIndex(asset => asset?.occurrenceId === candidateOccurrenceId) : -1;
        const matchingAssetIdIndexes = explicitAssetIndex === void 0 && occurrenceIndex < 0 && candidateAssetId ? assets.map((asset, assetIndex) => asset?.assetId === candidateAssetId ? assetIndex : -1).filter(assetIndex => assetIndex >= 0) : [];
        const assetIdIndex = matchingAssetIdIndexes.length === 1 ? matchingAssetIdIndexes[0] : -1;
        const legacyAssetIndex = explicitAssetIndex === void 0 && occurrenceIndex < 0 && assetIdIndex < 0 && requestedStatus === "done" && candidate.assetIndex === void 0 && !candidateAssetId && Boolean(assets[index]) ? index + 1 : void 0;
        const assetIndex = requestedStatus === "done" ? explicitAssetIndex ?? (occurrenceIndex >= 0 ? occurrenceIndex + 1 : assetIdIndex >= 0 ? assetIdIndex + 1 : legacyAssetIndex) : void 0;
        const asset = assetIndex === void 0 ? null : assets[assetIndex - 1];
        const status = requestedStatus !== "done" || asset ? requestedStatus : "error";
        return {
            id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim().slice(0, 120) : `item-${index + 1}`,
            requestIndex: Math.max(1, Math.min(10, Math.floor(Number(candidate.requestIndex || index + 1) || index + 1))),
            ...assetIndex === void 0 ? {} : {
                assetIndex: assetIndex
            },
            ...status === "done" && asset?.assetId ? {
                assetId: asset.assetId
            } : {},
            ...status === "done" && asset ? {
                occurrenceId: sessionAssetOccurrenceId(asset, "image-collection", (assetIndex || 1) - 1)
            } : {},
            prompt: typeof candidate.prompt === "string" && candidate.prompt.trim() ? candidate.prompt.trim().slice(0, 12e3) : String(asset?.prompt || asset?.revisedPrompt || "").slice(0, 12e3),
            ...typeof candidate.title === "string" && candidate.title.trim() ? {
                title: candidate.title.trim().slice(0, 160)
            } : {},
            status: status,
            ...typeof candidate.error === "string" && candidate.error.trim() ? {
                error: candidate.error.trim().slice(0, 320)
            } : requestedStatus !== "done" || asset ? {} : {
                error: "图片槽位缺少对应成果。"
            }
        };
    });
    if (!items.length && !assets.length) return null;
    return {
        id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 120) : "image-collection",
        kind: source.kind === "series" ? "series" : "batch",
        generationMode: source.generationMode === "sequential" ? "sequential" : "parallel",
        items: items.length ? items : assets.slice(0, 10).map((asset, index) => ({
            id: `item-${index + 1}`,
            requestIndex: index + 1,
            assetIndex: index + 1,
            assetId: asset.assetId,
            occurrenceId: sessionAssetOccurrenceId(asset, "image-collection", index),
            prompt: String(asset.prompt || asset.revisedPrompt || "").slice(0, 12e3),
            ...asset.title ? {
                title: String(asset.title).slice(0, 160)
            } : {},
            status: "done"
        })),
        ...typeof source.sourceNodeId === "string" && source.sourceNodeId.trim() ? {
            sourceNodeId: source.sourceNodeId.trim().slice(0, 160)
        } : {},
        ...typeof source.createdAt === "string" && source.createdAt.trim() ? {
            createdAt: source.createdAt.trim().slice(0, 80)
        } : {},
        autoFit: source.autoFit !== !1
    };
}

function sanitizePersistedImageContainerSpec(value, node, fallbackCollection = null) {
    if (!value || typeof value !== "object") return null;
    const kinds = new Set([ "manual", "folder", "batch-result", "container-group" ]);
    if (!kinds.has(value.kind)) return null;
    const uniqueIds = items => [ ...new Set((Array.isArray(items) ? items : []).map(item => typeof item === "string" ? item.trim().slice(0, 160) : "").filter(id => id && id !== node.id)) ];
    const seenBindingIds = new Set;
    const memberBindings = (Array.isArray(value.memberBindings) ? value.memberBindings : []).slice(0, 2e3).flatMap((binding, index) => {
        if (!binding || typeof binding !== "object") return [];
        const assetId = typeof binding.assetId === "string" ? binding.assetId.trim().slice(0, 160) : "";
        const ownerNodeId = typeof binding.nodeId === "string" && binding.nodeId.trim() ? binding.nodeId.trim().slice(0, 160) : node.id;
        const containerNodeId = typeof binding.containerNodeId === "string" && binding.containerNodeId.trim() ? binding.containerNodeId.trim().slice(0, 160) : node.id;
        if (!assetId) return [];
        const assetIndex = Math.max(0, Math.floor(Number(binding.assetIndex ?? index) || 0));
        const occurrenceId = /^occ-[a-f0-9]{16,64}$/i.test(String(binding.occurrenceId || "").trim()) ? String(binding.occurrenceId).trim().toLowerCase() : void 0;
        const requestedBindingId = typeof binding.bindingId === "string" && binding.bindingId.trim() ? binding.bindingId.trim().slice(0, 520) : "";
        const bindingSeed = occurrenceId || `${assetId}:${assetIndex}`;
        let bindingId = requestedBindingId && !seenBindingIds.has(requestedBindingId) ? requestedBindingId : `binding:${containerNodeId}:${ownerNodeId}:${bindingSeed}`;
        let suffix = 1;
        while (seenBindingIds.has(bindingId)) bindingId = `binding:${containerNodeId}:${ownerNodeId}:${bindingSeed}:${suffix++}`;
        seenBindingIds.add(bindingId);
        return [ {
            bindingId: bindingId,
            assetId: assetId,
            ...occurrenceId ? {
                occurrenceId: occurrenceId
            } : {},
            nodeId: ownerNodeId,
            containerNodeId: containerNodeId,
            assetIndex: assetIndex,
            ...binding.role === "source" || binding.role === "reference" ? {
                role: binding.role
            } : {}
        } ];
    });
    const collection = sanitizePersistedImageCollection(value.collection, node.assets) || fallbackCollection;
    return {
        version: 1,
        kind: value.kind,
        memberNodeIds: uniqueIds(value.memberNodeIds),
        childContainerNodeIds: uniqueIds(value.childContainerNodeIds),
        memberBindings: memberBindings,
        ...value.hostContentKind === "manual" || value.hostContentKind === "folder" || value.hostContentKind === "batch-result" ? {
            hostContentKind: value.hostContentKind
        } : {},
        ...typeof value.sourceLabel === "string" && value.sourceLabel.trim() ? {
            sourceLabel: value.sourceLabel.trim().slice(0, 260)
        } : {},
        ...typeof value.importBatchId === "string" && value.importBatchId.trim() ? {
            importBatchId: value.importBatchId.trim().slice(0, 160)
        } : {},
        ...typeof value.layoutId === "string" && value.layoutId.trim() ? {
            layoutId: value.layoutId.trim().slice(0, 160)
        } : {},
        layoutOrigin: value.layoutOrigin === "auto" || value.layoutOrigin === "generation" ? value.layoutOrigin : "manual",
        autoFit: value.autoFit !== !1,
        ...collection ? {
            collection: collection
        } : {}
    };
}

function repairPersistedImageContainerSpecs(nodes) {
    const nodeById = new Map(nodes.map(node => [ node.id, node ]));
    const eligible = id => {
        const node = nodeById.get(id);
        return Boolean(node && node.type === "image" && !node.layerGroup);
    };
    const isContainer = node => Boolean(node && node.type === "image" && !node.layerGroup && (node.imageContainerSpec || node.imageContainer || node.imageCollection));
    const rawSpecs = new Map;
    for (const node of nodes) {
        if (node.type !== "image" || node.layerGroup) continue;
        const collection = sanitizePersistedImageCollection(node.imageCollection, node.assets);
        let spec = sanitizePersistedImageContainerSpec(node.imageContainerSpec, node, collection);
        !spec && collection ? spec = {
            version: 1,
            kind: "batch-result",
            memberNodeIds: [],
            childContainerNodeIds: [],
            memberBindings: [],
            layoutOrigin: "generation",
            autoFit: collection.autoFit !== !1,
            collection: collection
        } : !spec && node.imageContainer && (spec = {
            version: 1,
            kind: "manual",
            memberNodeIds: [],
            childContainerNodeIds: [],
            memberBindings: [],
            layoutOrigin: "manual",
            autoFit: !0
        });
        spec && rawSpecs.set(node.id, spec);
    }
    const reaches = (startId, targetId, active = new Set, depth = 0) => {
        if (startId === targetId) return !0;
        if (depth >= 16 || active.has(startId)) return !1;
        const spec = rawSpecs.get(startId);
        if (!spec) return !1;
        const next = new Set(active).add(startId);
        return spec.childContainerNodeIds.some(childId => reaches(childId, targetId, next, depth + 1));
    };
    const maxDepth = (nodeId, active = new Set) => {
        if (active.has(nodeId)) return 17;
        const spec = rawSpecs.get(nodeId);
        if (!spec?.childContainerNodeIds?.length) return 1;
        const next = new Set(active).add(nodeId);
        return 1 + Math.max(...spec.childContainerNodeIds.map(childId => maxDepth(childId, next)));
    };
    const descendantIds = (nodeId, active = new Set) => {
        if (active.has(nodeId)) return new Set;
        const spec = rawSpecs.get(nodeId);
        const result = new Set;
        if (!spec) return result;
        const next = new Set(active).add(nodeId);
        for (const memberId of spec.memberNodeIds || []) result.add(memberId);
        for (const childId of spec.childContainerNodeIds || []) {
            result.add(childId);
            descendantIds(childId, next).forEach(id => result.add(id));
        }
        return result;
    };
    const claimedParent = new Map;
    const ancestorDepth = nodeId => {
        let depth = 0;
        let current = nodeId;
        const seen = new Set;
        while (claimedParent.has(current) && !seen.has(current) && depth <= 16) {
            seen.add(current);
            current = claimedParent.get(current);
            depth += 1;
        }
        return depth;
    };
    const bindingForAssets = (owner, containerId, existing = []) => {
        const unused = new Set(existing.map((_item, index) => index));
        const usedBindingIds = new Set;
        return (Array.isArray(owner.assets) ? owner.assets : []).map((asset, assetIndex) => {
            const assetId = String(asset.assetId || `asset-${sessionAssetFingerprint(asset, assetIndex + 1, owner.id, assetIndex)}`).slice(0, 160);
            const occurrenceId = sessionAssetOccurrenceId(asset, owner.id, assetIndex);
            asset.occurrenceId = occurrenceId;
            const exact = existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.assetIndex === assetIndex && (binding.occurrenceId ? binding.occurrenceId === occurrenceId : binding.assetId === assetId));
            const sameOccurrence = exact >= 0 ? exact : existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.occurrenceId === occurrenceId);
            const fallback = sameOccurrence >= 0 ? sameOccurrence : existing.findIndex((binding, index) => unused.has(index) && binding.nodeId === owner.id && binding.containerNodeId === containerId && binding.assetIndex === assetIndex);
            const previous = fallback >= 0 ? existing[fallback] : null;
            fallback >= 0 && unused.delete(fallback);
            const bindingBase = `binding:${containerId}:${owner.id}:${occurrenceId}`;
            let bindingId = previous?.bindingId && !usedBindingIds.has(previous.bindingId) ? previous.bindingId : bindingBase;
            let bindingSuffix = 2;
            while (usedBindingIds.has(bindingId)) bindingId = `${bindingBase}:${bindingSuffix++}`;
            usedBindingIds.add(bindingId);
            return {
                bindingId: bindingId,
                assetId: assetId,
                occurrenceId: occurrenceId,
                nodeId: owner.id,
                containerNodeId: containerId,
                assetIndex: assetIndex,
                ...asset.taskRole === "source" || asset.taskRole === "reference" ? {
                    role: asset.taskRole
                } : owner.imageContainerRole === "source" || owner.imageContainerRole === "reference" ? {
                    role: owner.imageContainerRole
                } : previous?.role ? {
                    role: previous.role
                } : {}
            };
        });
    };
    for (const node of nodes) {
        const source = rawSpecs.get(node.id);
        if (!source) {
            delete node.imageContainerSpec;
            if (node.type !== "image" || node.layerGroup) {
                delete node.imageContainer;
                delete node.imageCollection;
            }
            continue;
        }
        const rawMembers = [ ...new Set((source.memberNodeIds || []).filter(id => eligible(id) && id !== node.id)) ];
        const childCandidates = [ ...new Set([ ...source.childContainerNodeIds || [], ...rawMembers.filter(id => isContainer(nodeById.get(id))) ]) ].filter(id => eligible(id) && id !== node.id && isContainer(nodeById.get(id)));
        const requestedChildren = childCandidates.filter(candidateId => !childCandidates.some(otherId => otherId !== candidateId && descendantIds(otherId).has(candidateId)));
        const childContainerNodeIds = [];
        for (const childId of requestedChildren) {
            if (claimedParent.has(childId) || reaches(childId, node.id) || ancestorDepth(node.id) + 1 + maxDepth(childId) > 16) continue;
            claimedParent.set(childId, node.id);
            childContainerNodeIds.push(childId);
        }
        const memberNodeIds = [];
        for (const memberId of rawMembers) {
            if (childContainerNodeIds.includes(memberId) || claimedParent.has(memberId)) continue;
            claimedParent.set(memberId, node.id);
            memberNodeIds.push(memberId);
        }
        const hasChildren = childContainerNodeIds.length > 0;
        const kind = hasChildren ? "container-group" : source.kind === "container-group" ? source.hostContentKind || "manual" : source.kind;
        const ownBindings = bindingForAssets(node, node.id, source.memberBindings || []);
        const memberBindings = [ ...ownBindings, ...memberNodeIds.flatMap(memberId => {
            const member = nodeById.get(memberId);
            return bindingForAssets(member, node.id, (source.memberBindings || []).filter(binding => binding.nodeId === memberId && binding.containerNodeId === node.id));
        }) ].slice(0, 2e3);
        const collection = sanitizePersistedImageCollection(source.collection || node.imageCollection, node.assets);
        collection && (collection.items = collection.items.map(item => {
            const asset = Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 1 ? node.assets?.[Number(item.assetIndex) - 1] : null;
            return {
                ...item,
                ...asset?.assetId ? {
                    assetId: asset.assetId,
                    occurrenceId: sessionAssetOccurrenceId(asset, node.id, Number(item.assetIndex) - 1)
                } : {}
            };
        }));
        node.imageContainerSpec = {
            ...source,
            kind: kind,
            ...hasChildren ? {
                hostContentKind: source.kind === "container-group" ? source.hostContentKind : source.kind
            } : {
                hostContentKind: void 0
            },
            memberNodeIds: memberNodeIds,
            childContainerNodeIds: childContainerNodeIds,
            memberBindings: memberBindings,
            ...(memberNodeIds.length || childContainerNodeIds.length) && source.layoutId ? {
                layoutId: source.layoutId
            } : {
                layoutId: void 0
            },
            ...collection ? {
                collection: collection
            } : {
                collection: void 0
            }
        };
        node.imageContainer = kind !== "batch-result";
        collection ? node.imageCollection = collection : delete node.imageCollection;
    }
}

function sanitizePersistedPendingAgentExecution(value) {
    if (!value || typeof value !== "object") return null;
    const clean = (input, maximum) => typeof input === "string" ? input.trim().slice(0, maximum) : "";
    const cleanPath = input => {
        const candidate = typeof input === "string" ? input.trim() : "";
        return candidate && candidate.length <= 32767 && !candidate.includes("\0") ? candidate : "";
    };
    const requestId = clean(value.requestId, 180);
    const projectId = clean(value.projectId, 180);
    const conversationId = clean(value.conversationId, 180);
    const originalPrompt = clean(value.originalPrompt, 24e3);
    const question = clean(value.question, 4e3);
    const kinds = new Set([ "clarify", "confirm", "source_images", "reference_images" ]);
    const origins = new Set([ "chat", "canvas", "node", "container", "layer", "requirement" ]);
    const scopeTypes = new Set([ "none", "single", "multi-source", "container", "container-group", "layer", "layer-group", "mixed" ]);
    const resultPolicies = new Set([ "single", "grouped-by-source", "grouped-by-container", "layer-variants" ]);
    const confirmationPolicies = new Set([ "auto", "preview-3", "staged", "direct" ]);
    if (!requestId || !projectId || !conversationId || !originalPrompt || !question || !kinds.has(value.kind)) return null;
    const rawScope = value.taskScope && typeof value.taskScope === "object" ? value.taskScope : null;
    if (!rawScope) return null;
    const normalizeAssets = (items, role, limit) => (Array.isArray(items) ? items : []).slice(0, limit).flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const assetId = clean(item.assetId, 160);
        const localPath = cleanPath(item.path);
        const relativePath = cleanPath(item.relativePath).replace(/\\/g, "/");
        const assetUrl = clean(item.assetUrl, 4e3);
        if (!assetId && !localPath && !relativePath && !assetUrl) return [];
        const containerSlot = Number.isInteger(Number(item.containerSlot)) && Number(item.containerSlot) >= 0 ? Math.floor(Number(item.containerSlot)) : Number.isInteger(Number(item.assetIndex)) && Number(item.assetIndex) >= 0 ? Math.floor(Number(item.assetIndex)) : void 0;
        const ownerAssetIndex = Number.isInteger(Number(item.ownerAssetIndex)) && Number(item.ownerAssetIndex) >= 0 ? Math.floor(Number(item.ownerAssetIndex)) : void 0;
        const sourceRelativePath = safeImageSourceRelativePath(item.sourceRelativePath);
        return [ {
            ...clean(item.bindingId, 520) ? {
                bindingId: clean(item.bindingId, 520)
            } : {},
            assetId: assetId || `pending-${role}-${index + 1}`,
            .../^occ-[a-f0-9]{16,64}$/i.test(clean(item.occurrenceId, 80)) ? {
                occurrenceId: clean(item.occurrenceId, 80).toLowerCase()
            } : {},
            ...clean(item.importBatchId, 160) ? {
                importBatchId: clean(item.importBatchId, 160)
            } : {},
            ...clean(item.importRootId, 80) ? {
                importRootId: clean(item.importRootId, 80)
            } : {},
            ...sourceRelativePath ? {
                sourceRelativePath: sourceRelativePath
            } : {},
            ...clean(item.sourceRootLabel, 260) ? {
                sourceRootLabel: clean(item.sourceRootLabel, 260)
            } : {},
            ...item.sourceRootKind === "directory" || item.sourceRootKind === "file" ? {
                sourceRootKind: item.sourceRootKind
            } : {},
            displayCode: clean(item.displayCode, 40) || `${role === "source" ? "SRC" : "REF"}${index + 1}`,
            .../^[a-f0-9]{32,128}$/i.test(clean(item.contentHash, 128)) ? {
                contentHash: clean(item.contentHash, 128).toLowerCase()
            } : {},
            role: role,
            name: clean(item.name, 260) || `${role === "source" ? "原图" : "参考图"} ${index + 1}`,
            ...containerSlot === void 0 ? {} : {
                assetIndex: containerSlot,
                containerSlot: containerSlot
            },
            ...ownerAssetIndex === void 0 ? {} : {
                ownerAssetIndex: ownerAssetIndex
            },
            ...clean(item.ownerNodeId, 160) ? {
                ownerNodeId: clean(item.ownerNodeId, 160)
            } : {},
            ...clean(item.nodeId, 160) ? {
                nodeId: clean(item.nodeId, 160)
            } : {},
            ...clean(item.containerId, 160) ? {
                containerId: clean(item.containerId, 160)
            } : {},
            ...localPath ? {
                path: localPath
            } : {},
            ...relativePath ? {
                relativePath: relativePath
            } : {},
            ...assetUrl ? {
                assetUrl: assetUrl
            } : {},
            ...clean(item.mimeType, 100) ? {
                mimeType: clean(item.mimeType, 100)
            } : {},
            ...clean(item.purpose, 400) ? {
                purpose: clean(item.purpose, 400)
            } : {},
            ...role === "reference" && clean(item.referenceRole, 80) ? {
                referenceRole: clean(item.referenceRole, 80)
            } : {},
            feedbackScore: normalizeFeedbackScore(item.feedbackScore)
        } ];
    });
    const sourceAssets = normalizeAssets(rawScope.sourceAssets, "source", 200);
    const referenceAssets = normalizeAssets(rawScope.referenceAssets, "reference", 40);
    const contextAssets = normalizeAssets(rawScope.contextAssets, "reference", 200);
    const explicitMentions = (Array.isArray(rawScope.explicitMentions) ? rawScope.explicitMentions : []).flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const kind = item.kind === "asset" || item.kind === "node" ? item.kind : null;
        const code = clean(item.code, 40);
        const nodeId = clean(item.nodeId, 160);
        if (!kind || !code || !nodeId) return [];
        const assetIndex = Number(item.assetIndex);
        return [ {
            kind: kind,
            code: code,
            nodeId: nodeId,
            ...kind === "asset" && Number.isInteger(assetIndex) && assetIndex >= 0 ? {
                assetIndex: Math.floor(assetIndex)
            } : {},
            ...clean(item.bindingId, 520) ? {
                bindingId: clean(item.bindingId, 520)
            } : {},
            ...clean(item.assetId, 160) ? {
                assetId: clean(item.assetId, 160)
            } : {},
            feedbackScore: normalizeFeedbackScore(item.feedbackScore)
        } ];
    }).slice(0, 64);
    const options = (items => {
        if (!Array.isArray(items)) return [];
        const usedIds = new Set;
        let recommendedClaimed = !1;
        const options = items.slice(0, 3).flatMap((item, index) => {
            if (!item || typeof item !== "object") return [];
            const label = clean(item.label, 80).replace(/\s+/g, " ");
            if (!label) return [];
            const fallbackId = `option-${index + 1}`;
            let id = clean(item.id, 80).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallbackId;
            let suffix = 2;
            const baseId = id;
            while (usedIds.has(id)) id = `${baseId}-${suffix++}`.slice(0, 80);
            usedIds.add(id);
            const recommended = item.recommended === !0 && !recommendedClaimed;
            recommended && (recommendedClaimed = !0);
            return [ {
                id: id,
                label: label,
                ...clean(item.description, 260) ? {
                    description: clean(item.description, 260)
                } : {},
                answer: clean(item.answer, 4e3) || label,
                ...recommended ? {
                    recommended: !0
                } : {}
            } ];
        });
        return options.length >= 2 ? options : [];
    })(value.options);
    const sourceNodeIds = [ ...new Set((Array.isArray(value.sourceNodeIds) ? value.sourceNodeIds : rawScope.sourceNodeIds || []).map(id => clean(id, 160)).filter(Boolean)) ].slice(0, 200);
    const origin = origins.has(value.taskOrigin) ? value.taskOrigin : origins.has(rawScope.origin) ? rawScope.origin : "chat";
    const cleanIds = (items, maximum) => [ ...new Set((Array.isArray(items) ? items : []).map(id => clean(id, 520)).filter(Boolean)) ].slice(0, maximum);
    const scopeType = scopeTypes.has(rawScope.scopeType) ? rawScope.scopeType : sourceAssets.length > 1 || sourceNodeIds.length > 1 ? "multi-source" : sourceAssets.length === 1 ? "single" : "none";
    const resultPolicy = resultPolicies.has(rawScope.resultPolicy) ? rawScope.resultPolicy : scopeType === "layer" || scopeType === "layer-group" ? "layer-variants" : scopeType === "container-group" ? "grouped-by-container" : sourceAssets.length > 1 || sourceNodeIds.length > 1 ? "grouped-by-source" : "single";
    const confirmationPolicy = confirmationPolicies.has(rawScope.confirmationPolicy) ? rawScope.confirmationPolicy : "auto";
    const requirementNodeId = clean(value.requirementNodeId, 160) || clean(rawScope.requirement?.nodeId, 160);
    const requirementRevisionValue = Number(value.requirementRevision ?? rawScope.requirement?.revision);
    const requirementRevision = Number.isInteger(requirementRevisionValue) && requirementRevisionValue >= 1 ? Math.floor(requirementRevisionValue) : void 0;
    const requirementSourceSignature = clean(value.requirementSourceSignature, 240) || clean(rawScope.requirement?.sourceSignature, 240);
    const snapshotHash = /^scope-[a-f0-9]{32}$/i.test(clean(rawScope.snapshotHash, 80)) ? clean(rawScope.snapshotHash, 80).toLowerCase() : "";
    return {
        version: 2,
        requestId: requestId,
        projectId: projectId,
        conversationId: conversationId,
        originalPrompt: originalPrompt,
        sourceNodeIds: sourceNodeIds,
        ...clean(value.focusedNodeId, 160) ? {
            focusedNodeId: clean(value.focusedNodeId, 160)
        } : {},
        taskOrigin: origin,
        taskScope: {
            version: 2,
            origin: origin,
            scopeType: scopeType,
            canvasRevision: Math.max(0, Math.floor(Number(rawScope.canvasRevision) || 0)),
            sourceNodeIds: [ ...new Set((Array.isArray(rawScope.sourceNodeIds) ? rawScope.sourceNodeIds : sourceNodeIds).map(id => clean(id, 160)).filter(Boolean)) ].slice(0, 200),
            sourceContainerIds: cleanIds(rawScope.sourceContainerIds, 200),
            referenceContainerIds: cleanIds(rawScope.referenceContainerIds, 40),
            sourceBindingIds: cleanIds(Array.isArray(rawScope.sourceBindingIds) && rawScope.sourceBindingIds.length ? rawScope.sourceBindingIds : sourceAssets.map(asset => asset.bindingId), 200),
            referenceBindingIds: cleanIds(Array.isArray(rawScope.referenceBindingIds) && rawScope.referenceBindingIds.length ? rawScope.referenceBindingIds : referenceAssets.map(asset => asset.bindingId), 40),
            sourceAssets: sourceAssets,
            referenceAssets: referenceAssets,
            contextNodeIds: cleanIds(rawScope.contextNodeIds, 200),
            contextAssets: contextAssets,
            explicitMentions: explicitMentions,
            resultPolicy: resultPolicy,
            confirmationPolicy: confirmationPolicy,
            ...requirementNodeId && requirementRevision !== void 0 ? {
                requirement: {
                    nodeId: requirementNodeId,
                    revision: requirementRevision,
                    ...requirementSourceSignature ? {
                        sourceSignature: requirementSourceSignature
                    } : {}
                }
            } : {},
            snapshotHash: snapshotHash,
            sourceAssetCount: Math.max(sourceAssets.length, Math.floor(Number(rawScope.sourceAssetCount || sourceAssets.length) || sourceAssets.length)),
            referenceAssetCount: Math.max(referenceAssets.length, Math.floor(Number(rawScope.referenceAssetCount || referenceAssets.length) || referenceAssets.length)),
            truncated: rawScope.truncated === !0
        },
        ...requirementNodeId ? {
            requirementNodeId: requirementNodeId
        } : {},
        ...requirementRevision === void 0 ? {} : {
            requirementRevision: requirementRevision
        },
        ...clean(value.requirementSourceNodeId, 160) ? {
            requirementSourceNodeId: clean(value.requirementSourceNodeId, 160)
        } : {},
        ...requirementSourceSignature ? {
            requirementSourceSignature: requirementSourceSignature
        } : {},
        kind: value.kind,
        title: clean(value.title, 240) || (value.kind === "source_images" ? "添加原图" : value.kind === "reference_images" ? "添加参考图" : "需要你确认"),
        question: question,
        ...clean(value.detail, 4e3) ? {
            detail: clean(value.detail, 4e3)
        } : {},
        ...clean(value.suggestedAnswer, 4e3) ? {
            suggestedAnswer: clean(value.suggestedAnswer, 4e3)
        } : {},
        ...options.length ? {
            options: options
        } : {},
        maxImages: Math.max(1, Math.min(40, Math.floor(Number(value.maxImages || 9) || 9))),
        createdAt: clean(value.createdAt, 80) || (new Date).toISOString()
    };
}

function sanitizeSession(session) {
    const source = session && typeof session === "object" ? session : {};
    const usedIds = new Set;
    const usedDisplayCodes = new Set;
    const nodes = Array.isArray(source.nodes) ? source.nodes.filter(node => node && typeof node === "object").map((node, index) => {
        const next = {
            ...node
        };
        const fallbackId = `N${index + 1}`;
        next.id = typeof next.id === "string" && next.id.trim() ? next.id.trim() : fallbackId;
        if (usedIds.has(next.id)) {
            let suffix = Math.max(27, index + 1);
            while (usedIds.has(`N${suffix}`)) suffix += 1;
            next.id = `N${suffix}`;
        }
        usedIds.add(next.id);
        next.displayCode = typeof next.displayCode === "string" && next.displayCode.trim() ? next.displayCode.trim().replace(/\s+/g, "").slice(0, 32) : next.id;
        if (usedDisplayCodes.has(next.displayCode)) {
            let suffix = Math.max(27, index + 1);
            while (usedDisplayCodes.has(`N${suffix}`)) suffix += 1;
            next.displayCode = `N${suffix}`;
        }
        usedDisplayCodes.add(next.displayCode);
        next.parentId !== next.id && typeof next.parentId === "string" && next.parentId.trim() || delete next.parentId;
        next.agentOwnerId !== next.id && typeof next.agentOwnerId === "string" && next.agentOwnerId.trim() || delete next.agentOwnerId;
        if (next.type === "video") next.video = sanitizeVideoNode(next.video);
        next.type === "image" && next.imageState === "queued" && (next.imageState = "empty");
        if (next.type === "image" && Array.isArray(next.assets) && next.assets.length > 0) {
            next.imageState = "done";
            next.status = "done";
            next.outputs = Math.max(Number(next.outputs ?? 0), next.assets.length);
        }
        if (next.type === "image") {
            next.imageTask = sanitizePersistedCanvasImageTask(next.imageTask);
            next.imageTask || delete next.imageTask;
            next.taskProvenance = sanitizePersistedImageTaskProvenance(next.taskProvenance);
            next.taskProvenance || delete next.taskProvenance;
        }
        if (next.type === "requirement") {
            next.requirement = sanitizePersistedCanvasRequirement(next.requirement, next.prompt);
            next.status = "done";
            next.outputs = 0;
            delete next.assets;
            delete next.imageState;
            delete next.imageProgress;
            delete next.imageParams;
            delete next.imageCollection;
            delete next.imageContainer;
            delete next.imageContainerSpec;
            delete next.layerGroup;
            delete next.layerComposition;
        }
        Number.isFinite(Number(next.x)) || (next.x = 120 + index * 300);
        Number.isFinite(Number(next.y)) || (next.y = 120 + index * 120);
        return next;
    }) : [];
    const isPersistedPromptNode = node => Boolean(node && node.type === "intent" && node.branch === "manual-prompt" && typeof node.prompt === "string" && node.prompt.trim());
    const removedLegacyIds = new Set(nodes.filter(node => !isPersistedPromptNode(node) && node.type !== "image" && !(node.type === "video" && node.video) && !(node.type === "requirement" && node.requirement) && (!Array.isArray(node.assets) || node.assets.length === 0)).map(node => node.id));
    const artifactNodes = nodes.filter(node => isPersistedPromptNode(node) || node.type === "image" || node.type === "video" && node.video || node.type === "requirement" && node.requirement || Array.isArray(node.assets) && node.assets.length > 0).map(node => node.type === "requirement" || node.type === "video" || isPersistedPromptNode(node) ? node : {
        ...node,
        type: "image"
    });
    const ids = new Set(artifactNodes.map(node => node.id));
    for (const node of artifactNodes) {
        node.parentId && !ids.has(node.parentId) && delete node.parentId;
        node.parentId && removedLegacyIds.has(node.parentId) && delete node.parentId;
        delete node.agentOwnerId;
        delete node.agentConversationId;
        delete node.agentInitState;
        delete node.agentLastMemoryEntryId;
    }
    const assetIdentity = repairSessionAssetIdentities(artifactNodes);
    repairPersistedImageContainerSpecs(artifactNodes);
    const nodeById = new Map(artifactNodes.map(node => [ node.id, node ]));
    const claimedLayoutNodeIds = new Set;
    const usedLayoutGroupIds = new Set;
    const layoutGroups = [];
    for (const rawGroup of Array.isArray(source.layoutGroups) ? source.layoutGroups : []) {
        if (!rawGroup || typeof rawGroup !== "object") continue;
        const id = typeof rawGroup.id === "string" ? rawGroup.id.trim().slice(0, 160) : "";
        if (!id || usedLayoutGroupIds.has(id)) continue;
        usedLayoutGroupIds.add(id);
        const requestedMembers = Array.isArray(rawGroup.memberNodeIds) ? rawGroup.memberNodeIds : [];
        const candidateIds = [];
        const hostCandidate = typeof rawGroup.hostNodeId === "string" ? rawGroup.hostNodeId.trim() : "";
        hostCandidate && candidateIds.push(hostCandidate);
        candidateIds.push(...requestedMembers.map(value => typeof value === "string" ? value.trim() : "").filter(Boolean));
        const memberNodeIds = [];
        for (const memberId of candidateIds) {
            const member = nodeById.get(memberId);
            if (!member || member.type !== "image" || member.layerGroup || claimedLayoutNodeIds.has(memberId) || memberNodeIds.includes(memberId)) continue;
            memberNodeIds.push(memberId);
        }
        if (memberNodeIds.length < 2) continue;
        const hostNodeId = memberNodeIds.includes(hostCandidate) ? hostCandidate : memberNodeIds[0];
        memberNodeIds.forEach(memberId => claimedLayoutNodeIds.add(memberId));
        layoutGroups.push({
            id: id,
            hostNodeId: hostNodeId,
            memberNodeIds: memberNodeIds,
            origin: rawGroup.origin === "auto" || rawGroup.origin === "generation" ? rawGroup.origin : "manual",
            autoFit: rawGroup.autoFit !== !1
        });
    }
    const selectedNodeId = ids.has(source.selectedNodeId) ? source.selectedNodeId : "";
    const conversations = Array.isArray(source.conversations) ? source.conversations.filter(item => item && typeof item === "object").map((item, index) => {
        const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `conv-${index + 1}`;
        const messages = repairSessionMessageAssetIds(item.messages, assetIdentity.resolve);
        const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : (new Date).toISOString();
        return {
            id: id,
            title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 80) : `会话 ${index + 1}`,
            messages: messages,
            createdAt: typeof item.createdAt === "string" ? item.createdAt : updatedAt,
            updatedAt: updatedAt
        };
    }) : [];
    const activeConversationId = typeof source.activeConversationId === "string" && source.activeConversationId.trim() && (conversations.length === 0 || conversations.some(item => item.id === source.activeConversationId)) ? source.activeConversationId : conversations[0]?.id ?? "";
    const pendingAgentExecution = sanitizePersistedPendingAgentExecution(source.pendingAgentExecution);
    const validPendingAgentExecution = pendingAgentExecution && pendingAgentExecution.conversationId === activeConversationId ? pendingAgentExecution : null;
    return {
        schemaVersion: Math.max(0, Math.floor(Number(source.schemaVersion || 0))) >= 3 ? 3 : 2,
        sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || 0))),
        canvasRevision: Math.max(0, Math.floor(Number(source.canvasRevision || 0))),
        nodeSequence: Math.max(Math.max(0, Math.floor(Number(source.nodeSequence || 0))), ...artifactNodes.flatMap(node => [ persistedNodeSequenceFromCode(node.displayCode), persistedNodeSequenceFromCode(node.id) ])),
        messages: repairSessionMessageAssetIds(source.messages, assetIdentity.resolve),
        conversations: conversations,
        activeConversationId: activeConversationId,
        nodes: artifactNodes,
        layoutGroups: layoutGroups,
        selectedNodeId: selectedNodeId,
        pendingAgentExecution: validPendingAgentExecution
    };
}

function messageHasSessionContent(message) {
    if (!message || typeof message !== "object" || message.hidden) return !1;
    return Boolean(String(message.content || "").trim() || message.toolTrace);
}

function normalizedSessionHasContent(source) {
    if (source.nodes.length > 0) return !0;
    if (source.messages.some(messageHasSessionContent)) return !0;
    return source.conversations.some(conversation => Array.isArray(conversation.messages) && conversation.messages.some(messageHasSessionContent));
}

function sessionHasContent(session) {
    return normalizedSessionHasContent(sanitizeSession(session));
}

function projectSessionHasContent(session, project) {
    const kindState = normalizedProjectKind(project?.kind, project?.quarantine);
    if (kindState.supportedKind === "writing" && !project?.quarantine?.readOnly) {
        const source = writingSessionForProject(session, project);
        if (writingSessionHasContent(source)) return !0;
        if (source.messages.some(messageHasSessionContent)) return !0;
        return source.conversations.some(conversation => Array.isArray(conversation.messages) && conversation.messages.some(messageHasSessionContent));
    }
    if ([ "data", "finance" ].includes(String(kindState.supportedKind)) && !project?.quarantine?.readOnly) {
        const source = lineageSessionForProject(session, project);
        if (lineageSessionHasContent(source)) return !0;
        if (source.messages.some(messageHasSessionContent)) return !0;
        return source.conversations.some(conversation => Array.isArray(conversation.messages) && conversation.messages.some(messageHasSessionContent));
    }
    if (project?.quarantine?.readOnly) {
        const source = session && typeof session === "object" ? session : {};
        return Object.keys(source).some(key => ![ "schemaVersion", "projectKind", "sessionRevision" ].includes(key));
    }
    return sessionHasContent(session);
}

function hydrateSessionAssets(session) {
    return sanitizeSession(session);
}

function ensureProjectFiles(project, session, create = !1) {
    if (!project?.path || !project?.sessionPath) return;
    if (project.quarantine?.readOnly || project.kind === "writing" && workspaceModules.status().state !== "installed") return;
    const initialSession = session && typeof session === "object" ? session : defaultSessionForProject(project);
    if (!create && !existsSync(project.path)) throw new Error("项目文件夹已被移除，请选择其他项目。");
    mkdirSync(project.path, {
        recursive: !0
    });
    mkdirSync(path.dirname(project.sessionPath), {
        recursive: !0
    });
    existsSync(project.sessionPath) || writeJson(project.sessionPath, initialSession);
    existsSync(projectManifestPath(project)) || writeProjectManifest(project, existsSync(project.sessionPath) ? readStoredSession(project.sessionPath, initialSession) : initialSession);
}

const projectManagedResetPrefix = ".iiimage-managed-reset-";

const projectManagedResetMetadataName = "transaction.json";

const projectManagedResetMetadataMaximumBytes = 65536;

const projectManagedResetStagingNamePattern = /^\.iiimage-managed-reset-[1-9]\d*-[a-f0-9]{16}$/;

const projectManagedDataRelativePaths = Object.freeze([ "output", "assets", ".iiimage/assets", ".iiimage/thumbnails", ".iiimage/studio", ".iiimage/writing", ".iiimage/lineage", ".iiimage/exports" ]);

function projectManagedDataTargets(projectPath) {
    return projectManagedDataRelativePaths.map(relativePath => path.join(projectPath, relativePath));
}

function assertProjectManagedResetPath(projectPath, targetPath, label = "项目托管目录") {
    const root = path.resolve(projectPath);
    const target = path.resolve(targetPath);
    if (!isComparablePathInside(target, root) || target === root) throw new Error(`${label}越过项目边界，已停止重置。`);
    if (!existsSync(root)) throw new Error("重置目标项目目录不存在。");
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("重置目标项目根目录不是可信实体目录。");
    const relative = path.relative(root, target);
    let cursor = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, segment);
        if (!existsSync(cursor)) continue;
        const info = lstatSync(cursor);
        if (info.isSymbolicLink()) throw new Error(`${label}包含符号链接或 junction，已停止重置：${path.relative(root, cursor)}`);
        if (cursor !== target && !info.isDirectory()) throw new Error(`${label}祖先不是目录，已停止重置：${path.relative(root, cursor)}`);
    }
    return target;
}

function invalidProjectManagedResetMetadata(detail) {
    const error = new Error(`项目重置 staging 事务元数据无效：${detail}`);
    error.code = "PROJECT_RESET_METADATA_INVALID";
    return error;
}

function projectManagedResetHasExactKeys(value, expectedKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return !1;
    const actual = Object.keys(value).sort();
    const expected = [ ...expectedKeys ].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function projectManagedResetTimestampIsCanonical(value) {
    if (typeof value !== "string" || !value) return !1;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function assertProjectManagedResetStaging(projectPath, stagingPath) {
    const root = path.resolve(projectPath);
    const staging = assertProjectManagedResetPath(root, stagingPath, "项目重置 staging");
    const relative = path.relative(root, staging);
    if (!relative || path.isAbsolute(relative) || relative !== path.basename(staging) || !projectManagedResetStagingNamePattern.test(relative)) throw invalidProjectManagedResetMetadata("staging 必须是项目根目录下名称规范的直系子目录");
    if (!existsSync(staging)) throw invalidProjectManagedResetMetadata("staging 目录不存在");
    const stagingInfo = lstatSync(staging);
    if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink()) throw invalidProjectManagedResetMetadata("staging 不是可信实体目录");
    return staging;
}

function validateProjectManagedResetMetadata(project, stagingPath, metadata) {
    if (!project?.path || typeof project.id !== "string" || typeof project.kind !== "string") throw invalidProjectManagedResetMetadata("目标项目身份无效");
    const projectPath = path.resolve(project.path);
    const trustedStagingPath = assertProjectManagedResetStaging(projectPath, stagingPath);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw invalidProjectManagedResetMetadata("顶层必须是对象");
    if (![ "staging", "committed" ].includes(metadata.state)) throw invalidProjectManagedResetMetadata("state 只能是 staging 或 committed");
    const expectedTopLevelKeys = [ "version", "state", "projectId", "projectKind", "expectedSessionRevision", "createdAt", "entries", ...metadata.state === "committed" ? [ "committedAt" ] : [] ];
    if (!projectManagedResetHasExactKeys(metadata, expectedTopLevelKeys)) throw invalidProjectManagedResetMetadata("顶层字段缺失或包含额外字段");
    if (metadata.version !== 1) throw invalidProjectManagedResetMetadata("version 不受支持");
    if (metadata.projectId !== project.id) throw invalidProjectManagedResetMetadata("projectId 与目标项目不匹配");
    if (![ "agent", "image", "writing", "data", "finance" ].includes(metadata.projectKind) || metadata.projectKind !== project.kind) throw invalidProjectManagedResetMetadata("projectKind 与目标项目不匹配");
    if (typeof metadata.expectedSessionRevision !== "number" || !Number.isSafeInteger(metadata.expectedSessionRevision) || metadata.expectedSessionRevision < 0) throw invalidProjectManagedResetMetadata("expectedSessionRevision 必须是非负安全整数");
    if (!projectManagedResetTimestampIsCanonical(metadata.createdAt)) throw invalidProjectManagedResetMetadata("createdAt 不是规范 ISO 时间戳");
    if (metadata.state === "committed" && !projectManagedResetTimestampIsCanonical(metadata.committedAt)) throw invalidProjectManagedResetMetadata("committedAt 不是规范 ISO 时间戳");
    if (!Array.isArray(metadata.entries) || metadata.entries.length < 1 || metadata.entries.length > projectManagedDataRelativePaths.length) throw invalidProjectManagedResetMetadata("entries 必须是非空的托管目标子集");
    const seenSourcePaths = new Set;
    let previousSourceIndex = -1;
    const validatedEntries = metadata.entries.map((entry, index) => {
        if (!projectManagedResetHasExactKeys(entry, [ "sourceRelativePath", "stagedName" ])) throw invalidProjectManagedResetMetadata(`entries[${index}] 字段缺失或包含额外字段`);
        if (typeof entry.sourceRelativePath !== "string" || typeof entry.stagedName !== "string") throw invalidProjectManagedResetMetadata(`entries[${index}] 路径字段类型无效`);
        const sourceIndex = projectManagedDataRelativePaths.indexOf(entry.sourceRelativePath);
        if (sourceIndex < 0) throw invalidProjectManagedResetMetadata(`entries[${index}] 不是允许的托管目标`);
        if (seenSourcePaths.has(entry.sourceRelativePath)) throw invalidProjectManagedResetMetadata(`entries[${index}] 重复`);
        if (sourceIndex <= previousSourceIndex) throw invalidProjectManagedResetMetadata("entries 顺序与托管目标白名单不一致");
        if (entry.stagedName !== `entry-${index}`) throw invalidProjectManagedResetMetadata(`entries[${index}] stagedName 无效`);
        seenSourcePaths.add(entry.sourceRelativePath);
        previousSourceIndex = sourceIndex;
        const sourcePath = assertProjectManagedResetPath(projectPath, path.join(projectPath, entry.sourceRelativePath), "项目重置回滚目标");
        const stagedPath = path.resolve(trustedStagingPath, entry.stagedName);
        if (path.dirname(stagedPath) !== trustedStagingPath || path.basename(stagedPath) !== entry.stagedName) throw invalidProjectManagedResetMetadata(`entries[${index}] staging 路径不是直系子项`);
        assertProjectManagedResetPath(projectPath, stagedPath, "项目重置 staging 文件");
        if (existsSync(stagedPath)) {
            const stagedInfo = lstatSync(stagedPath);
            if (!stagedInfo.isDirectory() || stagedInfo.isSymbolicLink()) throw invalidProjectManagedResetMetadata(`entries[${index}] staging 项不是可信实体目录`);
        }
        return {
            ...entry,
            sourcePath: sourcePath,
            stagedPath: stagedPath
        };
    });
    const allowedStagingChildren = new Set([ projectManagedResetMetadataName, ...metadata.entries.map(entry => entry.stagedName) ]);
    for (const child of readdirSync(trustedStagingPath, {
        withFileTypes: !0
    })) if (!allowedStagingChildren.has(child.name)) throw invalidProjectManagedResetMetadata(`staging 包含未声明的直系子项：${child.name}`);
    return {
        metadata: metadata,
        stagingPath: trustedStagingPath,
        entries: validatedEntries
    };
}

function projectManagedResetMetadata(project, stagingPath) {
    const trustedStagingPath = assertProjectManagedResetStaging(project.path, stagingPath);
    const metadataPath = path.join(trustedStagingPath, projectManagedResetMetadataName);
    if (!existsSync(metadataPath)) throw invalidProjectManagedResetMetadata("缺少 transaction.json");
    const metadataInfo = lstatSync(metadataPath);
    if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink()) throw invalidProjectManagedResetMetadata("transaction.json 不是可信普通文件");
    if (metadataInfo.size < 1 || metadataInfo.size > projectManagedResetMetadataMaximumBytes) throw invalidProjectManagedResetMetadata(`transaction.json 大小必须在 1-${projectManagedResetMetadataMaximumBytes} 字节之间`);
    let metadata;
    try {
        metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    } catch {
        throw invalidProjectManagedResetMetadata("transaction.json 不是有效 JSON");
    }
    return {
        metadataPath: metadataPath,
        ...validateProjectManagedResetMetadata(project, trustedStagingPath, metadata)
    };
}

function projectManagedResetSessionCommitted(project, metadata) {
    const expectedRevision = Math.max(0, Math.floor(Number(metadata.expectedSessionRevision || 0)));
    if (!expectedRevision || !existsSync(project.sessionPath)) return !1;
    let session;
    try {
        session = JSON.parse(readFileSync(project.sessionPath, "utf8"));
    } catch {
        return !1;
    }
    if (Math.floor(Number(session?.sessionRevision || 0)) < expectedRevision) return !1;
    if (metadata.projectKind === "writing") return Array.isArray(session.artifacts) && session.artifacts.length === 0;
    if ([ "data", "finance" ].includes(metadata.projectKind)) return Array.isArray(session.lineageArtifacts) && session.lineageArtifacts.length === 0;
    return !1;
}

function rollbackProjectManagedReset(project, stagingPath, metadata) {
    const projectPath = path.resolve(project.path);
    const validated = validateProjectManagedResetMetadata(project, stagingPath, metadata);
    const conflicts = validated.entries.filter(entry => existsSync(entry.sourcePath) && existsSync(entry.stagedPath));
    if (conflicts.length) {
        const error = new Error(`项目托管数据重置回滚失败：${conflicts.map(entry => `回滚目标冲突：${entry.sourceRelativePath}`).join("；")}`);
        error.code = "PROJECT_RESET_ROLLBACK_FAILED";
        throw error;
    }
    const rollbackErrors = [];
    for (const entry of [ ...validated.entries ].reverse()) try {
        const source = entry.sourcePath;
        const staged = entry.stagedPath;
        const stagedExists = existsSync(staged);
        if (!stagedExists) continue;
        const sourceParent = path.dirname(source);
        sourceParent !== projectPath && assertProjectManagedResetPath(projectPath, sourceParent, "项目重置回滚父目录");
        mkdirSync(sourceParent, {
            recursive: !0
        });
        renameSync(staged, source);
    } catch (error) {
        rollbackErrors.push(error instanceof Error ? error.message : String(error));
    }
    rollbackErrors.length || rmSync(stagingPath, {
        recursive: !0,
        force: !0
    });
    if (rollbackErrors.length) {
        const error = new Error(`项目托管数据重置回滚失败：${rollbackErrors.join("；")}`);
        error.code = "PROJECT_RESET_ROLLBACK_FAILED";
        throw error;
    }
}

function recoverProjectManagedDataReset(project) {
    if (!project?.path || !existsSync(project.path)) return {
        recovered: !1
    };
    const projectPath = path.resolve(project.path);
    const candidates = readdirSync(projectPath, {
        withFileTypes: !0
    }).filter(entry => entry.name.startsWith(projectManagedResetPrefix)).map(entry => path.join(projectPath, entry.name)).sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
    const transactions = candidates.map(stagingPath => ({
        stagingPath: stagingPath,
        ...projectManagedResetMetadata(project, stagingPath)
    }));
    const actions = [];
    for (const {stagingPath: stagingPath, metadata: metadata} of transactions) if (metadata.state === "committed" || projectManagedResetSessionCommitted(project, metadata)) {
        rmSync(stagingPath, {
            recursive: !0,
            force: !0
        });
        actions.push("finalized");
    } else {
        rollbackProjectManagedReset(project, stagingPath, metadata);
        actions.push("rolled-back");
    }
    return {
        recovered: actions.length > 0,
        actions: actions
    };
}

function beginProjectManagedDataReset(projectId, options = {}) {
    const project = getProjectById(String(projectId || "").trim(), readProjectList());
    if (!project?.path) throw new Error("重置目标项目不存在或已被移除。");
    assertProjectWritable(project, "重置");
    const expectedSessionRevision = options.expectedSessionRevision === void 0 ? 0 : options.expectedSessionRevision;
    if (typeof expectedSessionRevision !== "number" || !Number.isSafeInteger(expectedSessionRevision) || expectedSessionRevision < 0) throw new Error("项目重置 expectedSessionRevision 必须是非负安全整数。");
    recoverProjectManagedDataReset(project);
    const projectPath = path.resolve(project.path);
    const existingTargets = projectManagedDataTargets(projectPath).map(target => {
        const resolved = assertProjectManagedResetPath(projectPath, target);
        if (!existsSync(resolved)) return null;
        const info = lstatSync(resolved);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`项目托管目标不是可信实体目录：${path.relative(projectPath, resolved)}`);
        return resolved;
    }).filter(Boolean);
    const removed = existingTargets.map(target => path.relative(projectPath, target).split(path.sep).join("/"));
    if (!existingTargets.length) return {
        project: project,
        removed: removed,
        stagingPath: "",
        markCommitted() {},
        commit() {
            return !0;
        },
        rollback() {}
    };
    let stagingPath = "";
    for (let attempt = 0; attempt < 4 && !stagingPath; attempt += 1) {
        const candidate = path.join(projectPath, `${projectManagedResetPrefix}${process.pid}-${randomBytes(8).toString("hex")}`);
        assertProjectManagedResetPath(projectPath, candidate, "项目重置 staging");
        if (existsSync(candidate)) continue;
        mkdirSync(candidate, {
            recursive: !1
        });
        stagingPath = candidate;
    }
    if (!stagingPath) throw new Error("无法创建唯一的项目重置 staging。");
    const metadata = {
        version: 1,
        state: "staging",
        projectId: project.id,
        projectKind: project.kind,
        expectedSessionRevision: expectedSessionRevision,
        createdAt: (new Date).toISOString(),
        entries: existingTargets.map((target, index) => ({
            sourceRelativePath: path.relative(projectPath, target).split(path.sep).join("/"),
            stagedName: `entry-${index}`
        }))
    };
    const metadataPath = path.join(stagingPath, projectManagedResetMetadataName);
    try {
        validateProjectManagedResetMetadata(project, stagingPath, metadata);
        writeJson(metadataPath, metadata);
    } catch (error) {
        rmSync(stagingPath, {
            recursive: !0,
            force: !0
        });
        throw error;
    }
    try {
        metadata.entries.forEach((entry, index) => {
            renameSync(existingTargets[index], path.join(stagingPath, entry.stagedName));
        });
    } catch (error) {
        try {
            rollbackProjectManagedReset(project, stagingPath, metadata);
        } catch (rollbackError) {
            const failure = new Error(`${error instanceof Error ? error.message : String(error)}；${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
            failure.code = "PROJECT_RESET_ROLLBACK_FAILED";
            throw failure;
        }
        throw error;
    }
    let committed = !1;
    return {
        project: project,
        removed: removed,
        stagingPath: stagingPath,
        markCommitted() {
            if (committed) return;
            metadata.state = "committed";
            metadata.committedAt = (new Date).toISOString();
            writeJson(metadataPath, metadata);
            committed = !0;
        },
        commit() {
            this.markCommitted();
            try {
                rmSync(stagingPath, {
                    recursive: !0,
                    force: !0
                });
                return !0;
            } catch (error) {
                log(`project managed reset cleanup deferred project=${project.id} ${error instanceof Error ? error.message : String(error)}`);
                return !1;
            }
        },
        rollback() {
            if (committed) throw new Error("已提交的项目重置事务不能回滚。");
            rollbackProjectManagedReset(project, stagingPath, metadata);
        }
    };
}

function clearProjectManagedData(projectId) {
    const project = imageProjectForOperation(projectId, "重置图片项目托管数据");
    const transaction = beginProjectManagedDataReset(project.id);
    const cleanupComplete = transaction.commit();
    return {
        project: transaction.project,
        removed: transaction.removed,
        cleanupDeferred: !cleanupComplete
    };
}

function projectLifecycleBusyReason(event) {
    if (host.images?.list?.().some(job => job.status === "running")) return "请先停止当前画布图片任务，再管理项目。";
    if (codingAgentManager?.isBusy()) return "编程任务正在执行，请停止或完成任务后再管理项目。";
    const windows = BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().split(/[?#]/)[0] === event.sender.getURL().split(/[?#]/)[0]);
    if (windows.length > 1) return "请先关闭其他工作区窗口，再管理项目。";
    if (projectStorageMoving || activeProjectStorageOperations > 1 || activeAgentRunControllers.size || backgroundImageRuntime?.list(event.sender.id).length || imageImportCounters.active || activeImageEditRequests || queuedImageEditRequests.length || projectSessionSaveCoordinator.pendingProjectCount() || writingProjectOperationQueues.size || lineageProjectOperationQueues.size || activeWritingMutationProjects.size || activeLineageMutationProjects.size || projectReconciliationBusy) return "请等待当前任务、图片导入和项目保存完成后再管理项目。";
    return "";
}

function assertProjectLifecycleIdle(event) {
    const reason = projectLifecycleBusyReason(event);
    if (reason) throw new Error(reason);
}

function removeWorkspaceProject(id, archive) {
    const list = readProjectList(), project = list.projects.find(p => p.id === id);
    if (!project) throw new Error("项目不存在或已被移除。");
    if (!projectRecordVisibleOnCurrentSurface(project)) throw new Error(projectSurfaceUnavailableMessage(project));
    const options = {
        protectedPaths: [ projectRoot, desktopRoot, configDir, projectsDir ],
        projects: list.projects
    };
    assertProjectDirectory(project, options);
    const remaining = list.projects.filter(p => p.id !== id);
    let active = remaining.find(p => p.id === list.activeProjectId && projectRecordVisibleOnCurrentSurface(p)) || remaining.find(projectRecordVisibleOnCurrentSurface);
    let created = !1;
    if (!active) {
        active = createProjectRecord("未命名项目");
        ensureProjectFiles(active, defaultSessionForProject(active), !0);
        remaining.unshift(active);
        created = !0;
    }
    let session;
    try {
        session = projectSessionFromDisk(active);
    } catch (error) {
        created && rmSync(active.path, {
            recursive: !0,
            force: !0
        });
        throw error;
    }
    let next;
    if (archive) try {
        archiveProjectDirectory(project, options);
        next = writeProjectList({
            ...list,
            activeProjectId: active.id,
            projects: remaining
        });
    } catch (error) {
        rmSync(path.join(project.path, ".iiimage/archived.json"), {
            force: !0
        });
        created && rmSync(active.path, {
            recursive: !0,
            force: !0
        });
        throw error;
    } else {
        const removedPath = path.join(path.dirname(project.path), `.aieyra-deleted-${project.id}-${Date.now()}`);
        try {
            renameSync(project.path, removedPath);
            try {
                next = writeProjectList({
                    ...list,
                    activeProjectId: active.id,
                    projects: remaining
                });
            } catch (error) {
                renameSync(removedPath, project.path);
                throw error;
            }
        } catch (error) {
            created && rmSync(active.path, {
                recursive: !0,
                force: !0
            });
            throw error;
        }
        try {
            rmSync(removedPath, {
                recursive: !0,
                force: !0
            });
        } catch (error) {
            log(`project delete cleanup failed ${id} ${error.message}`);
            return {
                ok: !0,
                project: active,
                ...projectListSnapshotForRenderer(next),
                session: session,
                warning: `项目已移除，部分占用文件暂时保留在：${removedPath}`
            };
        }
    }
    projectRecoveryAssessmentCache.clear();
    log(`project ${archive ? "archive" : "delete"} ${id}`);
    return {
        ok: !0,
        project: active,
        ...projectListSnapshotForRenderer(next),
        session: session
    };
}

function cleanupEmptyWorkspaceProjects(payload = {}) {
    const list = readProjectList();
    if (payload.activeProjectId !== list.activeProjectId || !Array.isArray(payload.ids) || !Array.isArray(payload.protectedIds)) return {
        ok: !1,
        error: "项目状态已变化，稍后重新自检。"
    };
    const protectedIds = new Set([ list.activeProjectId, ...payload.protectedIds ]);
    const matrixBindings = readMatrixWorkspaceBindings();
    for (const id of Object.keys(matrixBindings.projects || {})) protectedIds.add(id);
    const requested = new Set(payload.ids.slice(0, 100));
    const removedIds = [];
    for (const project of list.projects) {
        if (!requested.has(project.id) || protectedIds.has(project.id) || !projectRecordVisibleOnCurrentSurface(project)) continue;
        const touched = Math.max(Date.parse(project.updatedAt || project.createdAt || "") || Date.now(), (() => {
            try {
                return statSync(project.sessionPath).mtimeMs;
            } catch {
                return Date.now();
            }
        })());
        if (Date.now() - touched < 18e5) continue;
        if (!isEmptyManagedProject(project, projectsDir)) continue;
        try {
            rmSync(project.path, {
                recursive: !0
            });
            removedIds.push(project.id);
        } catch (error) {
            log(`empty project retained ${project.id} ${error.message}`);
        }
    }
    const next = removedIds.length ? writeProjectList({
        ...list,
        projects: list.projects.filter(p => !removedIds.includes(p.id))
    }) : list;
    removedIds.length && projectRecoveryAssessmentCache.clear();
    return {
        ok: !0,
        ...projectListSnapshotForRenderer(next),
        removedIds: removedIds
    };
}

function cleanupEmptyProjectsForIpc(event, payload = {}) {
    return withProjectRegistryLock(() => {
        try {
            if (projectLifecycleBusyReason(event)) return {
                ok: !0,
                ...projectListSnapshotForRenderer(readProjectList()),
                removedIds: [],
                deferred: !0
            };
            return cleanupEmptyWorkspaceProjects(payload);
        } catch (error) {
            return {
                ok: !1,
                error: error.message
            };
        }
    });
}

const projectSessionSaveCoordinator = function(options = {}) {
    const queues = new Map;
    const revisions = new Map;
    const initialRevision = typeof options.initialRevision === "function" ? options.initialRevision : () => 0;
    return {
        enqueue: function(projectId, requestedRevision, apply) {
            const key = String(projectId || "__global__");
            const explicitRevision = requestedRevision === void 0 || requestedRevision === null || requestedRevision === "" ? null : normalizeSessionRevision(requestedRevision);
            if (explicitRevision === null && requestedRevision !== void 0 && requestedRevision !== null && requestedRevision !== "") return Promise.resolve({
                ok: !1,
                error: "session revision 必须是非负安全整数。",
                appliedRevision: revisions.get(key) ?? 0,
                skippedStale: !1
            });
            const previous = queues.get(key) || Promise.resolve();
            const task = previous.catch(() => {}).then(async () => {
                const persistedRevision = normalizeSessionRevision(await initialRevision(key)) ?? 0;
                const currentRevision = Math.max(revisions.get(key) || 0, persistedRevision);
                revisions.set(key, currentRevision);
                if (explicitRevision !== null && explicitRevision <= currentRevision) return {
                    ok: !0,
                    appliedRevision: currentRevision,
                    requestedRevision: explicitRevision,
                    skippedStale: !0
                };
                const nextRevision = explicitRevision ?? currentRevision + 1;
                const result = await apply(nextRevision, currentRevision);
                if (result?.applied === !1) return {
                    ...result,
                    ok: result.ok !== !1,
                    appliedRevision: currentRevision,
                    requestedRevision: explicitRevision,
                    skippedStale: !1
                };
                revisions.set(key, nextRevision);
                return {
                    ...result,
                    ok: result?.ok !== !1,
                    appliedRevision: nextRevision,
                    requestedRevision: explicitRevision,
                    skippedStale: !1
                };
            });
            queues.set(key, task);
            task.then(() => {
                queues.get(key) === task && queues.delete(key);
            }, () => {
                queues.get(key) === task && queues.delete(key);
            });
            return task;
        },
        revision(projectId) {
            return revisions.get(String(projectId || "__global__")) ?? null;
        },
        pendingProjectCount() {
            return queues.size;
        }
    };
}({
    initialRevision(projectId) {
        if (projectId === "__global__") return normalizeSessionRevision(readJson(sessionPath, defaultSession)?.sessionRevision) ?? 0;
        return projectSessionRevisionFromDisk(getProjectById(projectId, readProjectList()));
    }
});

function openProjectFromPath(selectedPathInput) {
    const rawSelectedPath = String(selectedPathInput || "").trim();
    if (!rawSelectedPath) throw new Error("打开项目需要有效目录。");
    const selectedPath = path.resolve(rawSelectedPath);
    if (isArchivedProject(selectedPath)) return {
        ok: !1,
        error: "此项目已归档，文件保留在数据目录中，不再加入项目列表。"
    };
    const list = readProjectList();
    let record = list.projects.find(item => path.resolve(item.path) === selectedPath);
    const isNewRecord = !record;
    if (!record) {
        const manifest = readProjectManifest(selectedPath);
        const detectedKind = manifest?.project?.kind || manifest?.kind || "image";
        record = createProjectRecord(path.basename(selectedPath), selectedPath, detectedKind);
    }
    if (!projectRecordVisibleOnCurrentSurface(record)) return {
        ok: !1,
        error: projectSurfaceUnavailableMessage(record)
    };
    const commitOpen = () => {
        record.quarantine?.readOnly || ensureProjectFiles(record, defaultSessionForProject(record));
        const session = projectSessionFromDisk(record);
        if (!record.quarantine?.readOnly && !writingModuleUnavailable(record)) {
            writeJson(record.sessionPath, sessionForProjectSave(session, record));
            writeProjectManifest(record, session);
        }
        const projects = isNewRecord ? [ record, ...list.projects ] : list.projects;
        const next = writeProjectList({
            ...list,
            projects: projects,
            activeProjectId: record.id
        });
        const snapshot = projectListSnapshotForRenderer(next);
        return {
            ok: !0,
            path: selectedPath,
            project: record,
            ...snapshot,
            session: writingRendererSession(session)
        };
    };
    const kindState = normalizedProjectKind(record.kind, record.quarantine);
    if (kindState.supportedKind === "writing" && !record.quarantine?.readOnly) return withWritingProjectLock(record.id, commitOpen);
    if ([ "data", "finance" ].includes(String(kindState.supportedKind)) && !record.quarantine?.readOnly) return withLineageProjectLock(record.id, commitOpen);
    return commitOpen();
}

function thumbnailCacheRootForAsset(filePath) {
    const resolved = path.resolve(filePath);
    const project = thumbnailProjectRoots().find(item => isPathInside(resolved, item.projectPath));
    if (project) return project.cacheRoot;
    if (isPathInside(resolved, referencesDir)) return path.join(configDir, projectMetaDirName, "thumbnails");
    return null;
}

const handlers = new Map();
handlers.set("aieyra:config:load-settings", () => {
            const settings = migrateSettings(readJson(settingsPath, {}));
            syncNativeThemeSource(settings);
            log("config load settings");
            return {
                ok: !0,
                path: settingsPath,
                settings: publicSettings(settings)
            };
        });
handlers.set("aieyra:config:save-settings", (_event, settings) => {
            const current = migrateSettings(readJson(settingsPath, {}));
            const next = migrateSettings({
                ...current,
                ...settings || {}
            });
            writeJson(settingsPath, next);
            syncNativeThemeSource(next);
            matrixBroadcast("settings");
            log("config save settings");
            return {
                ok: !0,
                path: settingsPath
            };
        });
handlers.set("aieyra:project:storage-status", () => ({
            ok: !0,
            root: projectsDir,
            moving: projectStorageMoving,
            pathMappings: projectPathMappings(readProjectList())
        }));
handlers.set("aieyra:project:choose-storage-root", async event => {
            const choice = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
                title: "选择项目根目录",
                defaultPath: projectsDir,
                properties: [ "openDirectory", "createDirectory" ]
            });
            return {
                ok: !0,
                canceled: choice.canceled,
                root: choice.filePaths[0] || ""
            };
        });
handlers.set("aieyra:project:cancel-storage-move", () => {
            projectStorageAbort?.abort(new Error("迁移已取消，原项目保持完整。"));
            return {
                ok: !0
            };
        });
handlers.set("aieyra:project:move-storage-root", async (event, payload = {}) => {
            if (codingAgentManager?.isBusy()) return {
                ok: !1,
                error: "编程任务正在执行，请停止或完成任务后再迁移项目目录。"
            };
            if (projectStorageMoving || activeProjectStorageOperations > 1 || activeAgentRunControllers.size || backgroundImageRuntime?.list(event.sender.id).length || imageImportCounters.active || activeImageEditRequests || projectSessionSaveCoordinator.pendingProjectCount() || writingProjectOperationQueues.size || lineageProjectOperationQueues.size || projectReconciliationBusy) return {
                ok: !1,
                error: "请等待当前任务、图片导入和项目保存完成后迁移。"
            };
            const workspaceWindows = BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().split(/[?#]/)[0] === event.sender.getURL().split(/[?#]/)[0]);
            if (workspaceWindows.length > 1) return {
                ok: !1,
                error: "请先关闭其他工作区窗口，再迁移项目目录。"
            };
            if (typeof payload.root !== "string" || !path.isAbsolute(payload.root)) return {
                ok: !1,
                error: "请选择有效的项目根目录。"
            };
            projectStorageMoving = !0;
            projectStorageAbort = new AbortController;
            try {
                codingAgentManager?.close();
                agentRuntime?.dispose();
                agentRuntime = null;
                await recycleProjectImageImporter(!1);
                const result = await migrateProjectsRoot({
                    configDir: configDir,
                    listPath: projectListPath,
                    fromRoot: projectsDir,
                    toRoot: payload.root,
                    signal: projectStorageAbort.signal,
                    progress: progress => {
                        event.sender.isDestroyed() || event.sender.send("aieyra:project:storage-progress", progress);
                    }
                });
                projectsDir = result.root;
                projectMigrationTransactionManager = createProjectMigrationTransactionManager({
                    configDir: configDir,
                    projectsDir: projectsDir,
                    projectListPath: projectListPath
                });
                projectRecoveryAssessmentCache.clear();
                dataReportWritingSnapshotCoordinator = null;
                updateThumbnailProjectRootsCache(readProjectList());
                return {
                    ok: !0,
                    ...result
                };
            } catch (error) {
                return {
                    ok: !1,
                    canceled: projectStorageAbort.signal.aborted,
                    error: String((projectStorageAbort.signal.aborted ? projectStorageAbort.signal.reason : error)?.message || error)
                };
            } finally {
                projectStorageMoving = !1;
                projectStorageAbort = null;
            }
        });
handlers.set("aieyra:config:load-session", (_event, payload = {}) => {
            const {list: list, snapshot: snapshot} = readProjectListForCurrentSurface();
            const requestedId = String(payload.projectId || "").trim();
            const activeProject = requestedId ? getProjectById(requestedId, list) : getActiveProject(list);
            if (requestedId && (!activeProject || !projectRecordVisibleOnCurrentSurface(activeProject))) return {
                ok: !1,
                error: "项目不存在或当前不可访问。"
            };
            const activeSessionPath = activeProject?.sessionPath || sessionPath;
            if (activeProject && !activeProject.quarantine?.readOnly) ensureProjectFiles(activeProject);
            const session = activeProject ? projectSessionFromDisk(activeProject) : hydrateSessionAssets(readJson(activeSessionPath, readJson(sessionPath, defaultSession)));
            // projectSessionFromDisk commits actual migrations/recovery. A
            // normal read must not rewrite the session, manifest or backups.
            log("config load session");
            return {
                ok: !0,
                path: activeSessionPath,
                project: activeProject,
                ...snapshot,
                session: writingRendererSession(session)
            };
        });
handlers.set("aieyra:config:save-session", async (_event, session) => {
            const list = readProjectList();
            const requestedProjectId = typeof session?.projectId === "string" ? session.projectId.trim() : "";
            const targetProject = requestedProjectId ? getProjectById(requestedProjectId, list) : getActiveProject(list);
            if (requestedProjectId && !targetProject) return {
                ok: !1,
                error: "保存目标项目不存在或已被移除。",
                appliedRevision: 0,
                skippedStale: !1
            };
            if (targetProject && !projectRecordVisibleOnCurrentSurface(targetProject)) return {
                ok: !1,
                error: projectSurfaceUnavailableMessage(targetProject),
                appliedRevision: projectSessionRevisionFromDisk(targetProject),
                skippedStale: !1
            };
            if (targetProject?.quarantine?.readOnly) return {
                ok: !1,
                error: projectReadOnlyReason(targetProject),
                appliedRevision: projectSessionRevisionFromDisk(targetProject),
                skippedStale: !1
            };
            const activeSessionPath = targetProject?.sessionPath || sessionPath;
            const requestedRevision = session?.revision ?? session?.sessionRevision;
            const allowEmptyOverwrite = session?.allowEmptyOverwrite === !0;
            const saveTargetSession = async () => {
                const saveResult = await projectSessionSaveCoordinator.enqueue(targetProject?.id || "__global__", requestedRevision, async appliedRevision => {
                    const typedArtifactProject = [ "writing", "data", "finance" ].includes(String(targetProject?.kind));
                    const imageOrAgentProject = targetProject && [ "image", "agent" ].includes(normalizedProjectKind(targetProject.kind, targetProject.quarantine).supportedKind);
                    const existingRaw = typedArtifactProject ? projectSessionFromDisk(targetProject) : readJson(activeSessionPath, targetProject ? defaultSessionForProject(targetProject) : defaultSession);
                    const incoming = {
                        ...targetProject ? defaultSessionForProject(targetProject) : defaultSession,
                        ...session,
                        sessionRevision: appliedRevision
                    };
                    delete incoming.revision;
                    delete incoming.projectId;
                    delete incoming.allowEmptyOverwrite;
                    const nextInput = targetProject?.kind === "writing" ? {
                        ...existingRaw,
                        ...incoming,
                        schemaVersion: 4,
                        projectKind: "writing",
                        artifacts: existingRaw.artifacts,
                        artifactEdges: existingRaw.artifactEdges,
                        artifactLayout: existingRaw.artifactLayout,
                        artifactViewport: existingRaw.artifactViewport
                    } : [ "data", "finance" ].includes(String(targetProject?.kind)) ? {
                        ...existingRaw,
                        ...incoming,
                        schemaVersion: 4,
                        projectKind: targetProject.kind,
                        lineageRevision: existingRaw.lineageRevision,
                        lineageArtifacts: existingRaw.lineageArtifacts,
                        lineageEdges: existingRaw.lineageEdges,
                        lineageLayout: existingRaw.lineageLayout,
                        lineageViewport: existingRaw.lineageViewport
                    } : incoming;
                    const next = targetProject ? sessionForProjectSave(nextInput, targetProject) : sanitizeSession(nextInput);
                    if (targetProject && !allowEmptyOverwrite && !(imageOrAgentProject ? normalizedSessionHasContent(next) : projectSessionHasContent(next, targetProject)) && projectSessionHasContent(existingRaw, targetProject)) {
                        log(`config save session skipped empty overwrite ${targetProject.id}`);
                        return {
                            ok: !0,
                            path: activeSessionPath,
                            skipped: !0,
                            applied: !1,
                            reason: "empty-session-overwrite"
                        };
                    }
                    writeJson(activeSessionPath, next);
                    targetProject?.id === "default" && activeSessionPath !== sessionPath && writeJson(sessionPath, next);
                    if (targetProject?.path && imageOrAgentProject) {
                        assertProjectWritable(targetProject, "保存");
                        writeNormalizedManifest(targetProject, next);
                    } else if (targetProject) writeProjectManifest(targetProject, next);
                    if (targetProject) {
                        targetProject.updatedAt = (new Date).toISOString();
                        const latestList = readProjectList();
                        writeProjectList({
                            ...latestList,
                            projects: latestList.projects.map(item => item.id === targetProject.id ? targetProject : item)
                        });
                    }
                    log(`config save session project=${targetProject?.id || "global"} revision=${appliedRevision}`);
                    return {
                        ok: !0,
                        path: activeSessionPath,
                        applied: !0,
                        ...typedArtifactProject ? {
                            session: targetProject.kind === "writing" ? writingRendererSession(projectSessionFromDisk(targetProject)) : projectSessionFromDisk(targetProject)
                        } : {}
                    };
                });
                return {
                    ...saveResult,
                    path: saveResult.path || activeSessionPath
                };
            };
            if (targetProject?.kind === "writing") return withWritingProjectLock(targetProject.id, saveTargetSession);
            if ([ "data", "finance" ].includes(String(targetProject?.kind))) return withLineageProjectLock(targetProject.id, saveTargetSession);
            return saveTargetSession();
        });
handlers.set("aieyra:project:reset-data", (_event, payload = {}) => {
            try {
                const result = clearProjectManagedData(payload?.id);
                log(`project managed data reset project=${result.project.id} removed=${result.removed.join(",") || "none"}`);
                return {
                    ok: !0,
                    projectId: result.project.id,
                    removed: result.removed
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`project managed data reset failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            }
        });
handlers.set("aieyra:goals", (_event, payload = {}) => {
            try {
                const scope = resolveAgentProjectScope({
                    ...payload,
                    conversationId: payload.conversationId || "workspace-goals"
                }, "读取或更新持续目标");
                const project = projectForTrustedAgentScope(scope, "读取或更新持续目标");
                const session = projectSessionFromDisk(project);
                const input = payload.input || {};
                if (payload.action === "checkpoint") {
                    if (!Array.isArray(payload.nodeIds) || !payload.nodeIds.length || payload.nodeIds.length > 40) throw new Error("成果反馈需要 1–40 个已保存图片节点。");
                    const goal = readGoal(project.path, input.goalId);
                    const existing = goal.checkpoints.find(item => item.key === input.key);
                    const job = getBackgroundImageRuntime().list(_event.sender.id).find(item => item.id === input.key && item.projectId === project.id && item.conversationId === scope.conversationId && item.status === "completed" && item.reviewContext?.goalId === goal.id);
                    if (!existing && !job) throw new Error("没有属于当前目标的已完成绘图回执。");
                    const outputRuns = new Set([input.key, ...(job?.actions || []).map(action => action.toolRunId || action.operationId || action.node?.id).filter(Boolean)]);
                    const outputs = [ ...new Set(payload.nodeIds) ].map(id => {
                        const node = (session.nodes || []).find(item => item.id === id && item.type === "image" && item.assets?.length && item.imageState === "done" && (outputRuns.has(item.generationRunId) || existing?.outputs?.some(output => output.nodeId === id)));
                        if (!node) throw new Error("图片尚未完整保存，请稍后再建立反馈。");
                        return {
                            nodeId: node.id,
                            code: node.displayCode || node.id,
                            versions: node.assets.map(asset => imageVersion(asset))
                        };
                    });
                    return {
                        ok: !0,
                        ...checkpointGoal(project.path, {
                            ...input,
                            outputs: outputs
                        })
                    };
                }
                if (payload.action === "feedback") {
                    const goal = readGoal(project.path, input.goalId), cp = goal.checkpoints.find(item => item.id === input.checkpointId);
                    if (!cp) throw new Error("成果反馈记录不存在。");
                    for (const output of cp.outputs) {
                        const node = (session.nodes || []).find(item => item.id === output.nodeId);
                        if (!node || JSON.stringify((node.assets || []).map(asset => imageVersion(asset))) !== JSON.stringify(output.versions)) throw new Error("这一轮图片已变化或移除，请查看最新成果后再反馈。");
                    }
                    if (input.noteNodeId) {
                        const note = (session.nodes || []).find(item => item.id === input.noteNodeId && item.type === "requirement" && item.requirement?.goalFeedback?.goalId === goal.id && item.requirement?.goalFeedback?.checkpointId === cp.id && cp.outputs.some(output => output.nodeId === item.parentId));
                        if (!note) throw new Error("反馈便签尚未完整保存，请稍后重试。");
                        linkGoalNote(project.path, goal.id, cp.id, note.id);
                    }
                    return {
                        ok: !0,
                        goal: recordGoalFeedback(project.path, {
                            ...input,
                            source: "user"
                        })
                    };
                }
                if (payload.action === "link-note") {
                    const goal = readGoal(project.path, input.goalId), cp = goal.checkpoints.find(item => item.id === input.checkpointId);
                    const node = (session.nodes || []).find(item => item.id === input.noteNodeId && item.type === "requirement" && item.requirement?.goalFeedback?.goalId === goal.id && item.requirement?.goalFeedback?.checkpointId === input.checkpointId && cp?.outputs.some(output => output.nodeId === item.parentId));
                    if (!node) throw new Error("反馈便签尚未保存。");
                    linkGoalNote(project.path, input.goalId, input.checkpointId, node.id);
                    return {
                        ok: !0
                    };
                }
                return {
                    ok: !0,
                    ...runGoalTool(project.path, input, {
                        nodes: session.nodes || [],
                        artifacts: session.artifacts || [],
                        conversationId: scope.conversationId,
                        prompt: payload.userPrompt || ""
                    })
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error.message
                };
            }
        });
handlers.set("aieyra:project:list", () => {
            const {snapshot: snapshot} = readProjectListForCurrentSurface();
            return {
                ok: !0,
                ...snapshot
            };
        });
handlers.set("aieyra:project:reconciliation:assess", () => {
            if (projectReconciliationBusy) return {
                ok: !1,
                error: "本地项目正在处理中，请稍后重试。"
            };
            try {
                return {
                    ok: !0,
                    assessment: projectRecoveryAssessmentForRenderer()
                };
            } catch (error) {
                log(`project reconciliation assess failed code=${String(error?.code || "unknown")}`);
                return {
                    ok: !1,
                    error: publicProjectReconciliationError(error)
                };
            }
        });
handlers.set("aieyra:project:reconciliation:recover", (_event, payload = {}) => {
            if (projectReconciliationBusy) return {
                ok: !1,
                error: "本地项目正在处理中，请稍后重试。"
            };
            projectReconciliationBusy = !0;
            const requestedIds = Array.isArray(payload.ids) ? payload.ids.map(id => String(id || "")) : [];
            try {
                pruneProjectRecoveryAssessments();
                const assessmentId = String(payload.assessmentId || "");
                const cached = projectRecoveryAssessmentCache.get(assessmentId);
                if (!/^[a-f0-9]{24}$/.test(assessmentId) || !cached) return {
                    ok: !1,
                    error: "盘点结果已过期，请重新盘点后再恢复。"
                };
                if (!requestedIds.length || requestedIds.length > 20 || new Set(requestedIds).size !== requestedIds.length) return {
                    ok: !1,
                    error: "一次只能恢复 1 到 20 个不同项目。"
                };
                const originals = requestedIds.map(id => cached.internalCandidates.get(id));
                if (originals.some(candidate => !candidate)) return {
                    ok: !1,
                    error: "选择中包含不可恢复项目，请重新盘点。"
                };
                projectRecoveryAssessmentCache.delete(assessmentId);
                const migrated = projectMigrationTransactionManager.migrateMany(originals, {
                    targetProjectSchemaVersion: 4,
                    targetSessionSchemaVersion: 3
                });
                projectRecoveryAssessmentCache.clear();
                projectListAfterReconciliation();
                const recoveredProjectIds = migrated.map(item => item.record.id);
                log(`project reconciliation recover projects=${recoveredProjectIds.join(",")}`);
                return {
                    ok: !0,
                    recoveredProjectIds: recoveredProjectIds,
                    assessment: projectRecoveryAssessmentForRenderer()
                };
            } catch (error) {
                let recoveryFailure = null;
                try {
                    projectMigrationTransactionManager.recover();
                } catch (recoveryError) {
                    recoveryFailure = recoveryError;
                }
                projectRecoveryAssessmentCache.clear();
                let list = null;
                let assessment = null;
                try {
                    list = projectListAfterReconciliation();
                    assessment = projectRecoveryAssessmentForRenderer();
                } catch {}
                const recoveredProjectIds = list ? requestedIds.filter(id => list.projects.some(project => project.id === id)) : [];
                const publicError = publicProjectReconciliationError(recoveryFailure || error);
                log(`project reconciliation recover failed code=${String((recoveryFailure || error)?.code || "unknown")} partial=${recoveredProjectIds.length}`);
                return {
                    ok: !1,
                    ...assessment ? {
                        assessment: assessment
                    } : {},
                    recoveredProjectIds: recoveredProjectIds,
                    partial: recoveredProjectIds.length > 0,
                    error: recoveredProjectIds.length > 0 ? `已恢复 ${recoveredProjectIds.length} 个项目，后续项目已停止：${publicError}` : publicError
                };
            } finally {
                projectReconciliationBusy = !1;
            }
        });
handlers.set("aieyra:project:reconciliation:rollback", (_event, payload = {}) => {
            if (projectReconciliationBusy) return {
                ok: !1,
                error: "本地项目正在处理中，请稍后重试。"
            };
            projectReconciliationBusy = !0;
            try {
                const transactionId = String(payload.transactionId || "");
                const receipt = projectMigrationTransactionManager.listReceipts().find(entry => entry.transactionId === transactionId);
                if (receipt && projectKindVisibleOnCurrentSurface(receipt.receipt?.project?.kind) === !1) return {
                    ok: !1,
                    error: projectSurfaceUnavailableMessage(receipt.receipt?.project)
                };
                const result = projectMigrationTransactionManager.rollback(transactionId);
                projectRecoveryAssessmentCache.clear();
                projectListAfterReconciliation();
                log(`project reconciliation rollback transaction=${transactionId}`);
                return {
                    ok: !0,
                    rolledBackTransactionId: result.transactionId,
                    assessment: projectRecoveryAssessmentForRenderer()
                };
            } catch (error) {
                let recoveryFailure = null;
                try {
                    projectMigrationTransactionManager.recover();
                } catch (recoveryError) {
                    recoveryFailure = recoveryError;
                }
                projectRecoveryAssessmentCache.clear();
                let assessment = null;
                try {
                    assessment = projectRecoveryAssessmentForRenderer();
                } catch {}
                log(`project reconciliation rollback failed code=${String((recoveryFailure || error)?.code || "unknown")}`);
                return {
                    ok: !1,
                    ...assessment ? {
                        assessment: assessment
                    } : {},
                    error: publicProjectReconciliationError(recoveryFailure || error)
                };
            } finally {
                projectReconciliationBusy = !1;
            }
        });
handlers.set("aieyra:project:create", (_event, payload) => {
            const list = readProjectList();
            const capability = projectCreationCapability(payload?.kind || "image", {
                surface: projectSurface
            });
            if (!capability.ok) return {
                ok: !1,
                error: capability.error
            };
            if (capability.capability.kind === "writing" && workspaceModules.status().state !== "installed") return {
                ok: !1,
                error: "请先在右侧“模块”中安装写作模块。",
                code: "WORKSPACE_MODULE_UNAVAILABLE"
            };
            const record = createProjectRecord(payload?.name || `项目 ${list.projects.length + 1}`, "", capability.capability.kind, payload?.template);
            const initialSession = defaultSessionForProject(record);
            ensureProjectFiles(record, initialSession, !0);
            const next = writeProjectList({
                activeProjectId: record.id,
                projects: [ record, ...list.projects ]
            });
            log(`project create ${record.id}`);
            return {
                ok: !0,
                project: record,
                ...projectListSnapshotForRenderer(next),
                session: initialSession
            };
        });
handlers.set("aieyra:project:create-folder", async (_event, payload) => {
            const capability = projectCreationCapability(payload?.kind || "image", {
                surface: projectSurface
            });
            if (!capability.ok) return {
                ok: !1,
                error: capability.error
            };
            if (capability.capability.kind === "writing" && workspaceModules.status().state !== "installed") return {
                ok: !1,
                error: "请先在右侧“模块”中安装写作模块。",
                code: "WORKSPACE_MODULE_UNAVAILABLE"
            };
            const result = await dialog.showOpenDialog({
                title: "选择新项目保存位置",
                buttonLabel: "在这里创建",
                properties: [ "openDirectory", "createDirectory" ]
            });
            if (result.canceled || result.filePaths.length === 0) return {
                ok: !0,
                canceled: !0
            };
            assertWorkspaceAccessLease();
            const list = readProjectList();
            const projectName = safeName(payload?.name, `项目 ${list.projects.length + 1}`);
            const selectedPath = nextExternalProjectFolderPath(result.filePaths[0], projectName, list);
            const record = createProjectRecord(projectName, selectedPath, capability.capability.kind, payload?.template);
            list.projects.unshift(record);
            ensureProjectFiles(record, defaultSessionForProject(record), !0);
            const next = writeProjectList({
                ...list,
                activeProjectId: record.id
            });
            const session = projectSessionFromDisk(record);
            log(`project create folder ${selectedPath}`);
            return {
                ok: !0,
                path: selectedPath,
                project: record,
                ...projectListSnapshotForRenderer(next),
                session: session
            };
        });
handlers.set("aieyra:project:switch", async (_event, payload) => {
            const id = String(payload?.id || "");
            const switchToProject = () => {
                const list = readProjectList();
                const project = list.projects.find(item => item.id === id);
                if (!project) return {
                    ok: !1,
                    error: "项目不存在或已被移除。"
                };
                project.quarantine?.readOnly || ensureProjectFiles(project, defaultSessionForProject(project));
                const session = projectSessionFromDisk(project);
                if (!project.quarantine?.readOnly && !writingModuleUnavailable(project)) {
                    writeJson(project.sessionPath, sessionForProjectSave(session, project));
                    writeProjectManifest(project, session);
                }
                const next = writeProjectList({
                    ...list,
                    activeProjectId: id
                });
                log(`project switch ${id}`);
                return {
                    ok: !0,
                    project: project,
                    ...projectListSnapshotForRenderer(next),
                    session: session
                };
            };
            const initialProject = readProjectList().projects.find(item => item.id === id);
            if (!initialProject) return {
                ok: !1,
                error: "项目不存在或已被移除。"
            };
            if (!projectRecordVisibleOnCurrentSurface(initialProject)) return {
                ok: !1,
                error: projectSurfaceUnavailableMessage(initialProject)
            };
            const switchKind = normalizedProjectKind(initialProject.kind, initialProject.quarantine).supportedKind;
            if (switchKind === "writing" && !initialProject.quarantine?.readOnly) return withWritingProjectLock(id, switchToProject);
            if ([ "data", "finance" ].includes(String(switchKind)) && !initialProject.quarantine?.readOnly) return withLineageProjectLock(id, switchToProject);
            return switchToProject();
        });
handlers.set("aieyra:project:rename", (_event, payload) => {
            const id = String(payload?.id || "");
            const name = safeName(payload?.name, "");
            if (!id || !name) return {
                ok: !1,
                error: "项目名称不能为空。"
            };
            const list = readProjectList();
            const project = list.projects.find(item => item.id === id);
            if (!project) return {
                ok: !1,
                error: "项目不存在或已被移除。"
            };
            if (!projectRecordVisibleOnCurrentSurface(project)) return {
                ok: !1,
                error: projectSurfaceUnavailableMessage(project)
            };
            const renamed = {
                ...project,
                name: name,
                updatedAt: (new Date).toISOString()
            };
            const next = writeProjectList({
                ...list,
                projects: list.projects.map(item => item.id === id ? renamed : item)
            });
            renamed.quarantine?.readOnly || ensureProjectFiles(renamed, defaultSessionForProject(renamed));
            const session = projectSessionFromDisk(renamed);
            if (!renamed.quarantine?.readOnly && !writingModuleUnavailable(renamed)) {
                writeJson(renamed.sessionPath, sessionForProjectSave(session, renamed));
                writeProjectManifest(renamed, session);
            }
            log(`project rename ${id}`);
            return {
                ok: !0,
                project: renamed,
                ...projectListSnapshotForRenderer(next),
                session: session
            };
        });
handlers.set("aieyra:project:open", async (_event, payload = {}) => {
            const fixture = payload && Object.keys(payload).length ? {
                provided: !0,
                path: "",
                error: "项目路径只能通过文件选择器选择。"
            } : {
                provided: !1,
                path: "",
                error: ""
            };
            if (fixture.error) return {
                ok: !1,
                error: fixture.error
            };
            let selectedPath = fixture.path;
            if (!fixture.provided) {
                const result = await dialog.showOpenDialog({
                    title: "打开 Aieyra Workspace 项目",
                    properties: [ "openDirectory" ]
                });
                if (result.canceled || result.filePaths.length === 0) {
                    log("project open canceled");
                    return {
                        ok: !0,
                        canceled: !0
                    };
                }
                selectedPath = result.filePaths[0];
            }
            assertWorkspaceAccessLease();
            const opened = await openProjectFromPath(selectedPath);
            log(`project open ${opened.path}`);
            return opened;
        });
handlers.set("aieyra:project:export", async () => {
            const list = readProjectList();
            const project = getActiveProject(list);
            if (!project) return {
                ok: !1,
                error: "当前没有可导出的项目。"
            };
            if (project.kind === "agent") return {
                ok: !1,
                error: "编程项目请通过“打开目录”保存源码；当前项目包尚不包含原生 Codex 会话，暂不提供可能遗漏文件的导出。"
            };
            if (!projectRecordVisibleOnCurrentSurface(project)) return {
                ok: !1,
                error: projectSurfaceUnavailableMessage(project)
            };
            const result = await dialog.showSaveDialog({
                title: "导出 Aieyra Workspace 项目",
                defaultPath: path.join(project.path || desktopRoot, `${safeName(project.name, "Aieyra Workspace 项目")}.iiimage`),
                filters: [ {
                    name: "Aieyra Workspace 项目",
                    extensions: [ "iiimage" ]
                } ]
            });
            if (result.canceled || !result.filePath) return {
                ok: !0,
                canceled: !0
            };
            assertWorkspaceAccessLease();
            const packageData = packageProject(project);
            assertWorkspaceAccessLease();
            writeProjectPackageFile(result.filePath, packageData);
            project.quarantine?.readOnly || writeProjectManifest(project, packageData.session);
            log(`project export ${result.filePath}`);
            return {
                ok: !0,
                path: result.filePath
            };
        });
handlers.set("aieyra:project:import", async (_event, payload = {}) => {
            const fixture = payload && Object.keys(payload).length ? {
                provided: !0,
                path: "",
                error: "项目路径只能通过文件选择器选择。"
            } : {
                provided: !1,
                path: "",
                error: ""
            };
            if (fixture.error) return {
                ok: !1,
                error: fixture.error
            };
            let sourceFile = fixture.path;
            if (!fixture.provided) {
                const open = await dialog.showOpenDialog({
                    title: "导入 Aieyra Workspace 项目",
                    properties: [ "openFile" ],
                    filters: [ {
                        name: "Aieyra Workspace 项目",
                        extensions: [ "iiimage", "json" ]
                    } ]
                });
                if (open.canceled || open.filePaths.length === 0) return {
                    ok: !0,
                    canceled: !0
                };
                sourceFile = open.filePaths[0];
            }
            assertWorkspaceAccessLease();
            const packageBuffer = boundedImageRead(sourceFile, 201326592, path.basename(sourceFile), "项目文件");
            let packageData;
            try {
                packageData = JSON.parse(packageBuffer.toString("utf8"));
            } catch {
                throw projectPackageFailure("AIEYRA_PROJECT_PACKAGE_INVALID", "项目包不是有效的 JSON 文件。");
            }
            validateProjectPackageData(packageData);
            const importedKind = packageData?.project?.kind || packageData?.session?.projectKind || "image";
            if (projectKindVisibleOnCurrentSurface(importedKind) === !1) return {
                ok: !1,
                error: projectSurfaceUnavailableMessage({
                    kind: importedKind
                })
            };
            const target = await dialog.showOpenDialog({
                title: "选择导入项目的父目录",
                properties: [ "openDirectory", "createDirectory" ]
            });
            if (target.canceled || target.filePaths.length === 0) return {
                ok: !0,
                canceled: !0
            };
            assertWorkspaceAccessLease();
            const list = readProjectList();
            const targetPath = nextExternalProjectFolderPath(target.filePaths[0], safeName(packageData?.project?.name || path.basename(sourceFile, path.extname(sourceFile)), "导入项目"), list);
            const imported = importProjectPackage(packageData, targetPath, {
                retainTransaction: !0
            });
            const {record: record, session: session} = imported;
            const next = await withProjectRegistryLock(() => {
                assertWorkspaceAccessLease();
                return registerProjectImportTransaction(imported);
            });
            log(`project import ${sourceFile} -> ${targetPath}`);
            return {
                ok: !0,
                path: targetPath,
                project: record,
                ...projectListSnapshotForRenderer(next),
                session: session
            };
        });
handlers.set("aieyra:project:open-current-folder", async (_event, payload) => {
            const list = readProjectList();
            const requestedProjectId = String(payload?.id || "").trim();
            const project = projectForFolderOpen(list, requestedProjectId);
            if (requestedProjectId && !project) return {
                ok: !1,
                error: "当前项目不存在或已经被移除。"
            };
            if (!project?.path) return {
                ok: !1,
                error: "当前没有可打开的项目文件夹。"
            };
            if (!projectRecordVisibleOnCurrentSurface(project)) return {
                ok: !1,
                error: projectSurfaceUnavailableMessage(project)
            };
            if (!existsSync(project.path)) {
                if (project.external) return {
                    ok: !1,
                    error: "当前外部项目文件夹不存在或已被移除。"
                };
                if (project.quarantine?.readOnly) return {
                    ok: !1,
                    error: "只读隔离项目的文件夹不存在，已停止自动创建。"
                };
                mkdirSync(project.path, {
                    recursive: !0
                });
            }
            const error = await shell.openPath(project.path);
            if (error) return {
                ok: !1,
                error: error
            };
            log(`project folder open ${project.path}`);
            return {
                ok: !0,
                path: project.path,
                projectId: project.id
            };
        });
        const removeProject = (event, payload, archive) => withProjectRegistryLock(() => {
            try {
                assertProjectLifecycleIdle(event);
                return removeWorkspaceProject(String(payload?.id || ""), archive);
            } catch (error) {
                return {
                    ok: !1,
                    error: error.message
                };
            }
        });

handlers.set("aieyra:project:archive", (event, payload) => removeProject(event, payload, !0));
handlers.set("aieyra:project:delete", (event, payload) => removeProject(event, payload, !1));
handlers.set("aieyra:project:delete-folder", (event, payload) => removeProject(event, payload, !1));
handlers.set("aieyra:project:cleanup-empty", (event, payload = {}) => cleanupEmptyProjectsForIpc(event, payload));
handlers.set("aieyra:asset:pick-local-images", async (_event, payload = {}) => {
            try {
                const project = imageProjectForOperation(payload.projectId, "导入图片");
                const maxFiles = Math.max(1, Math.min(Number(payload.maxFiles ?? 2e3), 2e3));
                const result = await dialog.showOpenDialog({
                    title: "导入图片到画布",
                    properties: [ "openFile", "multiSelections" ],
                    filters: [ {
                        name: "Images",
                        extensions: [ "png", "jpg", "jpeg", "webp" ]
                    } ]
                });
                if (result.canceled || result.filePaths.length === 0) return {
                    ok: !0,
                    canceled: !0,
                    assets: []
                };
                const imported = await importLocalImagesToProject({
                    paths: result.filePaths,
                    projectId: project.id,
                    maxFiles: maxFiles
                });
                return {
                    ok: !0,
                    ...imported,
                    selectedCount: result.filePaths.length,
                    truncated: result.filePaths.length > maxFiles || imported.truncated
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset pick local images failed ${message}`);
                return {
                    ok: !1,
                    assets: [],
                    errorCode: error?.code || "IMAGE_PICK_FAILED",
                    error: message
                };
            }
        });
        async function pickReferenceImages(payload = {}) {
            const project = imageProjectForOperation(payload.projectId, "导入参考图");
            const max = Math.max(1, Math.min(Number(payload.max ?? 9), 200));
            const result = await dialog.showOpenDialog({
                title: String(payload.title || "选择参考图").slice(0, 80),
                properties: [ "openFile", "multiSelections" ],
                filters: [ {
                    name: "Images",
                    extensions: [ "png", "jpg", "jpeg", "webp" ]
                } ]
            });
            if (result.canceled || result.filePaths.length === 0) return {
                ok: !0,
                canceled: !0
            };
            const imported = await importLocalImagesToProject({
                paths: result.filePaths,
                projectId: project.id,
                maxFiles: max
            });
            const images = imported.assets.map(asset => ({
                occurrenceId: asset.occurrenceId,
                importBatchId: asset.importBatchId,
                importRootId: asset.importRootId,
                sourceRelativePath: asset.sourceRelativePath,
                sourceRootLabel: asset.sourceRootLabel,
                sourceRootKind: asset.sourceRootKind,
                contentHash: asset.contentHash || asset.sha256,
                name: asset.originalName || path.basename(asset.path || "reference.png"),
                path: asset.path,
                relativePath: asset.relativePath,
                mimeType: mimeTypeForPath(asset.path),
                assetUrl: asset.assetUrl
            }));
            return {
                ok: !0,
                images: images,
                image: images[0],
                truncated: result.filePaths.length > max || imported.truncated,
                selectedCount: result.filePaths.length
            };
        }

handlers.set("aieyra:asset:pick-reference-images", async (_event, payload) => pickReferenceImages(payload ?? {}));
handlers.set("aieyra:asset:pick-agent-files", async (_event, payload = {}) => {
            try {
                const project = agentAttachmentProjectForOperation(payload?.projectId, "选择 Agent 附件");
                const maxFiles = Math.max(1, Math.min(Number(payload?.maxFiles) || agentAttachmentMaxFiles, agentAttachmentMaxFiles));
                const purpose = payload?.purpose === "knowledge" ? "knowledge" : "attachment";
                const result = await dialog.showOpenDialog({
                    title: purpose === "knowledge" ? "导入知识文档" : "添加文件",
                    properties: [ "openFile", "multiSelections" ],
                    filters: [ {
                        name: purpose === "knowledge" ? "知识文档" : "所有文件",
                        extensions: purpose === "knowledge" ? [ ...agentKnowledgeExtensions ].map(item => item.slice(1)) : [ "*" ]
                    } ]
                });
                if (result.canceled || result.filePaths.length === 0) return {
                    ok: !0,
                    canceled: !0,
                    files: []
                };
                return await importAgentFilesToProject({
                    paths: result.filePaths,
                    projectId: project.id,
                    maxFiles: maxFiles,
                    purpose: purpose
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`agent attachment picker failed ${message}`);
                return {
                    ok: !1,
                    files: [],
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:pick-reference-image", async () => {
            const result = await pickReferenceImages({
                max: 1
            });
            return {
                ...result,
                images: result.images?.slice(0, 1)
            };
        });
handlers.set("aieyra:asset:open-folder", async (_event, payload) => {
            try {
                const resolved = resolveReadableImageAsset((payload ?? {}).path);
                if (!resolved) return {
                    ok: !1,
                    error: "图片文件不存在，或不在当前可访问的资产目录内。"
                };
                shell.showItemInFolder(resolved);
                log(`asset reveal ${resolved}`);
                return {
                    ok: !0
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });
handlers.set("aieyra:asset:open-default", async (_event, payload) => {
            try {
                const resolved = resolveReadableImageAsset((payload ?? {}).path);
                if (!resolved) return {
                    ok: !1,
                    error: "图片不在 Aieyra Workspace 可读取资产目录内，或文件已经不存在。"
                };
                const inspected = inspectImageFile(resolved);
                const openError = await shell.openPath(inspected.path);
                if (openError) throw new Error(openError);
                log(`asset open default ${inspected.path}`);
                return {
                    ok: !0
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset open default failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:copy-image", async (_event, payload) => {
            try {
                const resolved = resolveReadableImageAsset((payload ?? {}).path);
                if (!resolved) return {
                    ok: !1,
                    error: "图片不在 Aieyra Workspace 可读取资产目录内，或文件已经不存在。"
                };
                const inspected = inspectImageFile(resolved);
                const buffer = boundedImageRead(inspected.path, maxExportImageBytes, path.basename(inspected.path), "待复制图片");
                const image = nativeImage.createFromBuffer(buffer);
                if (image.isEmpty()) throw new Error("图片无法写入系统剪贴板。");
                clipboard.writeImage(image);
                const copied = clipboard.readImage();
                if (copied.isEmpty()) throw new Error("系统剪贴板没有接收到图片。");
                const size = copied.getSize();
                log(`asset copy image ${inspected.path} ${size.width}x${size.height}`);
                return {
                    ok: !0,
                    width: size.width,
                    height: size.height
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset copy image failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:read-data-url", async (_event, payload) => {
            try {
                const rawPath = (payload ?? {}).path;
                if (!rawPath || typeof rawPath !== "string") return {
                    ok: !1,
                    error: "图片路径无效。"
                };
                const resolved = path.resolve(rawPath);
                if (!isAllowedAssetPath(resolved)) {
                    log(`asset read data url denied ${resolved}`);
                    return {
                        ok: !1,
                        error: "图片不在 Aieyra Workspace 可读取资产目录内。"
                    };
                }
                if (!existsSync(resolved)) {
                    log(`asset read data url missing ${resolved}`);
                    return {
                        ok: !1,
                        error: "图片文件不存在。"
                    };
                }
                const mimeType = mimeTypeForPath(resolved);
                if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) return {
                    ok: !1,
                    error: "只支持 PNG/JPG/WEBP 图片。"
                };
                const imageBuffer = boundedImageRead(resolved, maxExportImageBytes, path.basename(resolved));
                const actualFormat = validateProjectPackageImageBuffer(imageBuffer, path.basename(resolved));
                const dataUrl = `data:${actualFormat.mimeType};base64,${imageBuffer.toString("base64")}`;
                log(`asset read data url ${resolved}`);
                return {
                    ok: !0,
                    dataUrl: dataUrl,
                    mimeType: actualFormat.mimeType,
                    name: path.basename(resolved)
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset read data url failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:refine-semantic-layers", () => ({
            ok: !1,
            error: "该图片工具已从当前版本移除。"
        }));
handlers.set("aieyra:asset:isolate-background", () => ({
            ok: !1,
            error: "该图片工具已从当前版本移除。"
        }));
handlers.set("aieyra:asset:thumbnail-stats", async (_event, payload) => {
            try {
                const cache = await currentImageThumbnailCache();
                const stats = payload?.reset === !0 ? cache.resetStats() : cache.stats();
                return {
                    ok: !0,
                    stats: stats
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });
handlers.set("aieyra:asset:image-import-status", (_event, payload) => ({
            ok: !0,
            status: imageImportStatus(payload?.reset === !0)
        }));
handlers.set("aieyra:asset:cancel-image-imports", async () => {
            await recycleProjectImageImporter(!0);
            return {
                ok: !0,
                status: imageImportStatus(!1)
            };
        });
handlers.set("aieyra:asset:import-local-images", async (_event, payload) => {
            try {
                return await importLocalImagesToProject(payload ?? {});
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log("asset batch import failed " + message);
                return {
                    ok: !1,
                    assets: [],
                    canceled: error?.code === "IMAGE_IMPORT_CLOSED",
                    errorCode: error?.code || "IMAGE_IMPORT_FAILED",
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:import-canvas-assets", async (_event, payload = {}) => {
            try {
                const requested = [ ...new Set(Array.isArray(payload.paths) ? payload.paths : []) ];
                if (!requested.length) return {
                    ok: !0,
                    assets: {}
                };
                const paths = requested.map(input => {
                    const resolved = typeof input === "string" && resolveReadableImageAsset(input);
                    if (!resolved) throw new Error("复制的图片已移动或不在项目素材目录内，请重新复制。");
                    return resolved;
                });
                const imported = await importLocalImagesToProject({
                    projectId: payload.projectId,
                    paths: paths,
                    maxFiles: paths.length,
                    includeSourcePaths: !0
                });
                const lookup = new Map(imported.sourcePaths.map((source, index) => [ path.resolve(source).toLowerCase(), imported.assets[index] ]));
                if (paths.some(source => !lookup.has(path.resolve(source).toLowerCase()))) throw new Error("部分图片导入失败，尚未向画布粘贴节点。");
                return {
                    ok: !0,
                    assets: Object.fromEntries(requested.map((source, index) => [ source, lookup.get(path.resolve(paths[index]).toLowerCase()) ]))
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });
handlers.set("aieyra:studio:documents", async (event, input = {}) => {
            try {
                assertWorkspaceRuntimeReady();
                if (input.action === "pick-import") {
                    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
                        properties: [ "openFile" ],
                        filters: [ {
                            name: "文档与数据",
                            extensions: [ "txt", "md", "html", "csv", "tsv", "json", "docx", "xlsx", "pptx", "pdf" ]
                        } ]
                    });
                    if (picked.canceled) return {
                        ok: !1,
                        canceled: !0
                    };
                    input = {
                        ...input,
                        action: "import",
                        path: picked.filePaths[0]
                    };
                }
                const result = await studioDocuments.run(input, "user");
                (result.document && ![ "read", "list" ].includes(input.action) || input.action === "delete") && matrixBroadcast("documents", {
                    projectId: input.projectId,
                    id: result.document?.id || input.id
                });
                return result;
            } catch (error) {
                return {
                    ok: !1,
                    error: error.message,
                    code: error.code
                };
            }
        });
handlers.set("aieyra:asset:import-clipboard-image", async (_event, payload = {}) => {
            try {
                const image = clipboard.readImage();
                if (image.isEmpty()) throw new Error("剪贴板中没有可粘贴的图片。");
                const runId = `clipboard-${randomUUID()}`;
                const asset = writeDataUrlOutput(image.toDataURL(), runId, runId, payload.projectId, {
                    subdir: "imports"
                });
                return {
                    ok: !0,
                    asset: asset
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });
handlers.set("aieyra:asset:import-agent-files", async (_event, payload = {}) => {
            try {
                return await importAgentFilesToProject(payload ?? {});
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`agent attachment import failed ${message}`);
                return {
                    ok: !1,
                    files: [],
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:import-local-image", async (_event, payload) => {
            try {
                const rawPath = (payload ?? {}).path;
                if (!rawPath || typeof rawPath !== "string") return {
                    ok: !1,
                    error: "图片路径无效。"
                };
                const imported = await importLocalImagesToProject({
                    paths: [ rawPath ],
                    projectId: (payload ?? {}).projectId,
                    maxFiles: 1
                });
                const asset = imported.assets[0];
                if (!asset) return {
                    ok: !1,
                    error: "没有找到可导入的 PNG/JPG/WEBP 图片。"
                };
                log("asset import local image " + asset.path);
                return {
                    ok: !0,
                    asset: asset
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset import local image failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:save-output-image", async (_event, payload) => {
            try {
                const runId = String((payload ?? {}).runId || `asset-${Date.now()}`);
                const dataUrl = String((payload ?? {}).dataUrl || "");
                const identity = createHash("sha256").update(runId).update("\0").update(dataUrl).digest("hex").slice(0, 16);
                const stem = `${sanitizeFileStem((payload ?? {}).stem || "plugin").slice(0, 56)}-${identity}`;
                const asset = writeDataUrlOutput(dataUrl, stem, runId, (payload ?? {}).projectId, {
                    bucket: (payload ?? {}).bucket,
                    subdir: (payload ?? {}).subdir
                });
                log(`asset save output ${asset.path}`);
                return {
                    ok: !0,
                    asset: asset
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset save output failed ${message}`);
                return {
                    ok: !1,
                    canceled: error?.code === "IMAGE_IMPORT_CLOSED",
                    errorCode: error?.code || "IMAGE_IMPORT_FAILED",
                    error: message
                };
            }
        });
handlers.set("aieyra:asset:save-as", async (event, payload = {}) => {
            let context = null;
            const transientSources = [];
            try {
                context = createAssetExportContext(payload?.projectId);
                const source = await materializeManagedImageAsset(payload?.asset, context);
                transientSources.push(source);
                const defaultName = exportFileName(source, payload?.suggestedName);
                const owner = BrowserWindow.fromWebContents(event.sender);
                let selectedPath = "";
                {
                    const options = {
                        title: "图片另存为",
                        defaultPath: path.join(app.getPath("desktop") || desktopRoot, defaultName),
                        buttonLabel: "保存",
                        filters: [ {
                            name: source.mimeType === "image/png" ? "PNG 图片" : source.mimeType === "image/webp" ? "WEBP 图片" : "JPEG 图片",
                            extensions: [ source.extension.slice(1) ]
                        } ]
                    };
                    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
                    if (result.canceled || !result.filePath) return {
                        ok: !0,
                        canceled: !0
                    };
                    selectedPath = path.resolve(result.filePath);
                }
                const destinationPath = ensureMatchingExportExtension(selectedPath, source.extension);
                if (comparablePath(destinationPath) !== comparablePath(selectedPath) && existsSync(destinationPath)) {
                    const confirmOptions = {
                        type: "warning",
                        title: "确认覆盖图片",
                        message: `“${path.basename(destinationPath)}”已经存在，是否覆盖？`,
                        buttons: [ "覆盖", "取消" ],
                        defaultId: 1,
                        cancelId: 1,
                        noLink: !0
                    };
                    const confirmation = owner ? await dialog.showMessageBox(owner, confirmOptions) : await dialog.showMessageBox(confirmOptions);
                    if (confirmation.response !== 0) return {
                        ok: !0,
                        canceled: !0
                    };
                }
                if (comparablePath(destinationPath) !== comparablePath(source.path)) {
                    mkdirSync(path.dirname(destinationPath), {
                        recursive: !0
                    });
                    copyFileSync(source.path, destinationPath);
                }
                log(`asset save as project=${context.project.id} format=${source.extension} bytes=${source.size}`);
                return {
                    ok: !0,
                    path: destinationPath
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log(`asset save as failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            } finally {
                releaseTransientExportSources(transientSources, context);
            }
        });
handlers.set("aieyra:asset:export-folder", async (event, payload = {}) => {
            let stagingPath = "";
            let selectedParent = "";
            let context = null;
            const transientSources = [];
            try {
                context = createAssetExportContext(payload?.projectId);
                const rawItems = Array.isArray(payload?.assets) ? payload.assets : [];
                if (rawItems.length <= 0) return {
                    ok: !1,
                    error: "没有可导出的图片或图层。"
                };
                if (rawItems.length > 200) return {
                    ok: !1,
                    error: "单次最多导出 200 张图片。"
                };
                const items = rawItems.map(normalizedExportItem).filter(Boolean).sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);
                if (items.length <= 0) return {
                    ok: !1,
                    error: "没有可导出的有效图片或图层。"
                };
                const group = exportGroupMetadata(payload?.group);
                const owner = BrowserWindow.fromWebContents(event.sender);
                {
                    const options = {
                        title: "选择图层文件夹的保存位置",
                        buttonLabel: "导出到此处",
                        properties: [ "openDirectory", "createDirectory" ]
                    };
                    const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
                    if (selected.canceled || !selected.filePaths[0]) return {
                        ok: !0,
                        canceled: !0
                    };
                    selectedParent = realpathSync(selected.filePaths[0]);
                }
                const materializedItems = [];
                for (const item of items) {
                    const source = await materializeManagedImageAsset(item.asset, context);
                    transientSources.push(source);
                    materializedItems.push({
                        ...item,
                        source: source
                    });
                }
                const previewSource = payload?.previewAsset ? await materializeManagedImageAsset(payload.previewAsset, context) : null;
                previewSource && transientSources.push(previewSource);
                const mergedSource = payload?.mergedAsset ? await materializeManagedImageAsset(payload.mergedAsset, context) : null;
                mergedSource && transientSources.push(mergedSource);
                const defaultFolderName = group.title ? `${group.title}-图层` : "Aieyra-Workspace-分层图片";
                const folderName = safeExportStem(payload?.folderName || defaultFolderName, "Aieyra-Workspace-分层图片");
                const targetPath = uniqueExportPath(selectedParent, folderName);
                stagingPath = path.join(selectedParent, `.iiimage-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
                if (!isComparablePathInside(stagingPath, selectedParent)) throw new Error("导出暂存目录无效。");
                mkdirSync(stagingPath, {
                    recursive: !1
                });
                const relativeFiles = [];
                let previewFileName = "";
                let mergedFileName = "";
                if (previewSource) {
                    previewFileName = `00-合成预览${previewSource.extension}`;
                    copyFileSync(previewSource.path, path.join(stagingPath, previewFileName));
                    relativeFiles.push(previewFileName);
                }
                const orderWidth = Math.max(2, String(Math.max(...materializedItems.map(item => item.order))).length);
                const manifestLayers = [];
                for (const item of materializedItems) {
                    const orderLabel = String(item.order).padStart(orderWidth, "0");
                    const desiredName = `${orderLabel}-${safeExportStem(item.title, `图层-${orderLabel}`)}${item.source.extension}`;
                    const targetFile = uniqueExportPath(stagingPath, desiredName);
                    copyFileSync(item.source.path, targetFile);
                    const fileName = path.basename(targetFile);
                    relativeFiles.push(fileName);
                    manifestLayers.push({
                        order: item.order,
                        title: item.title,
                        role: item.role,
                        fileName: fileName,
                        visible: item.visible,
                        opacity: item.opacity,
                        blendMode: item.blendMode,
                        width: Number(item.asset.width) || group.width,
                        height: Number(item.asset.height) || group.height
                    });
                }
                if (mergedSource) {
                    mergedFileName = `99-合成${mergedSource.extension}`;
                    const mergedTarget = uniqueExportPath(stagingPath, mergedFileName);
                    copyFileSync(mergedSource.path, mergedTarget);
                    mergedFileName = path.basename(mergedTarget);
                    relativeFiles.push(mergedFileName);
                }
                const manifest = {
                    format: "iiimage-layer-export",
                    version: 1,
                    exportedAt: (new Date).toISOString(),
                    group: group,
                    composite: {
                        previewFileName: previewFileName || void 0,
                        mergedFileName: mergedFileName || void 0
                    },
                    layers: manifestLayers
                };
                writeJson(path.join(stagingPath, "layers.json"), manifest);
                relativeFiles.push("layers.json");
                renameSync(stagingPath, targetPath);
                stagingPath = "";
                const files = relativeFiles.map(fileName => path.join(targetPath, fileName));
                log(`asset export folder project=${context.project.id} layers=${manifestLayers.length} preview=${Boolean(previewSource)} merged=${Boolean(mergedSource)}`);
                return {
                    ok: !0,
                    path: targetPath,
                    files: files,
                    count: manifestLayers.length
                };
            } catch (error) {
                stagingPath && selectedParent && removeExportStagingFolder(stagingPath, selectedParent);
                const message = error instanceof Error ? error.message : String(error);
                log(`asset export folder failed ${message}`);
                return {
                    ok: !1,
                    error: message
                };
            } finally {
                releaseTransientExportSources(transientSources, context);
            }
        });
handlers.set("aieyra:asset:export-psd", () => ({
            ok: !1,
            error: "该图片工具已从当前版本移除。"
        }));
handlers.set("aieyra:asset:export-layer-psd", () => ({
            ok: !1,
            error: "该图片工具已从当前版本移除。"
        }));
for (const [channel, action] of [ [ "trash", "trash" ], [ "restore", "restore" ], [ "forget", "forget" ] ]) handlers.set(`aieyra:asset:${channel}-project-content`, async (_event, payload = {}) => {
            try {
                const scope = resolveAgentProjectScope({
                    ...payload,
                    conversationId: payload.conversationId || "asset-trash"
                }, "管理图片成果");
                const result = await projectAssetTrash[action](scope.projectPath, action === "trash" ? payload.paths : String(payload.token || ""));
                return {
                    ok: !0,
                    ...result
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });
for (const [channel, operation] of [ [ "list", () => styleLibrary.list() ], [ "mutate", input => styleLibrary.mutate(input) ], [ "reference", input => styleLibrary.reference(input) ] ]) handlers.set(`aieyra:styles:${channel}`, async (_event, input = {}) => {
            try {
                const result = await operation(input);
                channel === "mutate" && matrixBroadcast("database", {});
                return {
                    ok: !0,
                    [channel === "reference" ? "reference" : "library"]: result
                };
            } catch (error) {
                return {
                    ok: !1,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });
host.diagnostic?.('storage-dependencies', {durationMs:performance.now()-storageStarted});
const filesStarted = performance.now();
ensureRuntimeFiles();
host.diagnostic?.('storage-files', {durationMs:performance.now()-filesStarted});
// The OS owns startup; this storage service is ready after its local files are initialized.
workspaceRuntimeReady = true;
workspaceRuntimeSuspended = false;
workspaceRuntimeInitializationStage = "ready";
workspaceRuntimeRevision++;
const saveTransferredImage=(project,next,expectedRevision)=>projectSessionSaveCoordinator.enqueue(project.id,Number(expectedRevision||0)+1,appliedRevision=>{
 if(projectSessionRevisionFromDisk(project)!==Number(expectedRevision||0))throw Error('项目在复制期间已变化，原节点保留');
 const saved=sessionForProjectSave({...next,sessionRevision:appliedRevision},project);writeJson(project.sessionPath,saved);writeProjectManifest(project,saved);return {ok:true,appliedRevision};
}).then(result=>{if(result.skippedStale)throw Error('项目已有更新，未覆盖已有内容');return result;});
return {studioDocuments, styleLibrary, saveTransferredImage, handlers, isAllowedAssetPath, thumbnailCacheRootForAsset, currentImageThumbnailCache, assetUrlFor, resolveReadableImageAsset, projectSessionFromDisk, readProjectList, getProjectById, writeDataUrlOutput, async close(){quitting=true;workspaceRuntimeReady=false;workspaceRuntimeSuspended=true; await projectImageImporter.close?.(); await imageThumbnailCache.close?.();}};
};
