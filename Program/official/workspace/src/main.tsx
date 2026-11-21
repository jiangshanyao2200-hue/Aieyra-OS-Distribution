import "./os-bridge.js";
import {appendComposerDraft,flushComposerDrafts as flushOsComposerDrafts} from './os-composer';
async function flushComposerDrafts(){await flushLocalComposerDrafts();await flushOsComposerDrafts();}
import { normalizeNodeStyle, nodeStyleProperties } from "../shared/canvas-node-style.mjs";
import "./workspace-module-host";
import type { MatrixTransfer } from "./matrix";
import { OptionalWritingPatchReviewDialog } from "./workspace-modules";
import { imageOriginForAsset, sanitizeImageOrigin, preserveImageOrigins, preserveImageOriginsForNodes } from "./image-origin";
import { mergeCanvasImageContainers } from "./image-container-merge";
import { DRAG_MERGE_HOLD_MS, dragMergeIntentReady, updateDragMergeIntent, type DragMergeIntent } from "./drag-merge-intent";
import { mergeQueuedAgentFollowUps, type QueuedAgentFollowUp } from "./agent-follow-up";
import { CompleteImage, ImageRetryTile, useStableEvent } from "./image-render";
import { canvasClipboardMime, copyCanvasSelection, readCanvasClipboard, clipboardAssetPaths, pasteCanvasSelection } from "../shared/canvas-transfer.mjs";
import { importTransferredFiles, transferredFiles } from "./agent-file-runtime";
import { writingReferenceCandidates, resolveWorkspaceReferences, workspaceReferenceError } from "../shared/workspace-references.mjs";
import { canvasPlatformEditableTarget } from "./canvas-platform-input";
import { ImageMentionContext } from "./image-mention-context";
import { readExcludedReferences } from "./coding-state";
import { useComposerDraft, flushComposerDrafts as flushLocalComposerDrafts, projectsWithComposerDrafts } from "./composer-draft";
import { resolveTaskImageAttachments, type ResolvedTaskImageAttachments } from "./task-image-attachments";
import type { StyleReference } from "./core";
import { useMinimizedWindows, restoreMinimizedWindow, closeMinimizedWindow } from "./window-manager";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mountProgramToolbar } from "../../../../Theme/runtime/program-toolbar.mjs";
import "../../../../Theme/runtime/program-toolbar.css";
import { createRoot, type Root } from "react-dom/client";
import type { NodeNoteDraft } from "./node-note-popover";
import { openProjectTab, useProjectTabPreferences } from "./project-preferences";
import { Brain, Check, Download, Eye, EyeOff, FolderOpen, FolderPlus, ImageIcon, Import, Layers3, MessageSquareReply, Plus, RotateCcw, Send, Settings, Shield, Trash2, WandSparkles, Workflow, X } from "./studio-icons";
import "./styles.css";
import "./os-embedded.css";
import { appendStreamingAgentMessage, finishRunStreamingMessages, finishThinkingMessages, requestAgent, timelineTextForProgress, toolTraceForProgress } from "./agent";
import { CanvasPlatformBackdrop, CanvasPlatformEmptyState, CanvasPlatformFooter } from "./canvas-platform";
import VideoEditor, { type VideoReply } from "./video-editor";
import { VideoCanvasNode, videoNode, type VideoNode } from "./video-canvas";
import { sanitizeVideoNode } from "../shared/video-node.mjs";
import { CANVAS_PLATFORM_MAX_SCALE, CANVAS_PLATFORM_MIN_SCALE, CANVAS_PLATFORM_ZOOM_FACTOR, CANVAS_PLATFORM_ZOOM_OUT_FACTOR, canvasPlatformContainmentDelta, canvasPlatformResizeNodeSize, canvasPlatformViewportTransform, canvasPlatformFitViewport, canvasPlatformRectIsRendered, canvasPlatformViewportFromFactor, canvasPlatformViewportFromWheel, canvasPlatformWorldPoint, clampCanvasPlatformScale, observeCanvasPlatformResizeRebase } from "./canvas-platform-viewport";
import { MAX_AGENT_SOURCE_IMAGES, MAX_REFERENCE_IMAGES, STORAGE_IMAGE_STATS, STORAGE_LAYOUT, STORAGE_SESSION, STORAGE_SETTINGS, agentTaskScopeSnapshotHash, agentExecutionScopeMatches, clipboardHasImage, cloneImageAssets, cloneImageCollection, cloneImageContainerSpec, cloneImageLayerComposition, cloneImageLayerNodeGroup, cloneImageTaskDraft, cloneReferenceImages, cloneWorkflowNode, compareImageSourcesVisualFidelity, composeImageLayersToDataUrl, computedSizeFor, createConversationSnapshot, defaultImageTaskDraft, defaultSettings, fileDragPayloadPresent, formatDuration, friendlyImageError, imageAssetCanvasSrc, imageAssetName, imageAssetSrc, imageAssetThumbnailSrc, isAgentExecutionBusy, loadImageForCanvas, localConnectionFallback, mergeReferenceImages, mergeSettings, mimeTypeFromPath, normalizeFeedbackScore, parseImageSizeValue, qualityLabel, readJson, reconcileImageAssetIdentityClaims, sanitizeAgentVisibleText, safeImageLocatorText, safeImageSourceRelativePath, sizeFromDraft, splitPromptError, stableImageAssetId, stableImageOccurrenceId, upsertConversation, validatePendingRequirementContinuation, validConversations, validMessages, writeJson, yuan } from "./core";
import type { ManualImageTaskDialogState } from "./manual-image-task-dialog";
import RequirementTextInput from "./requirement-text-input";
import { GoalFeedbackPanel, sanitizeGoalFeedback, type GoalFeedbackNote } from "./goal-feedback";
import type { BackgroundImageJob } from "./core";
import { undoCanvasChanges } from "./canvas-undo";
import { type LayeredImageTaskDialogState } from "./layered-image-task-runtime";
import type { ProjectResetDraft, ProjectResetLevel } from "./project-reset-dialog";
import { applyImageContainerCompatibility, deriveImageLayoutGroupsFromContainerSpecs, flattenImageContainerBindings, imageContainerKindForNode, imageContainerSpecForNode, mergeLegacyImageLayoutGroups, nodeUsesImageContainer, sanitizeImageContainerSpec, synchronizeImageContainerSpecs } from "./image-container";
import type { TaskResultLayoutMutation } from "./task-result-layout";
import { ActionButton, ButtonBase, CheckboxControl, DialogShell, ErrorBoundary, Field, IconActionButton, InlineNotice, MenuItem, MenuSeparator, MenuSummary, MenuSurface, OverflowTooltipLayer, SegmentButton, SegmentedControl, SurfaceBody, SurfaceFooter, SurfaceHeader, useFloatingDialogInteractions } from "./ui";
import { createManualImageLayoutGroup, extractImageLayoutMember, imageGridPresentationForRatios, imageGridPlanForCount, imagePreviewCanReportAuthoritativeSize, mergeImageLayoutSelection, normalizeImageLayoutState, reorderImageLayoutMember, sanitizeImageLayoutGroups, type ImageLayoutGroup } from "./image-layout";
import { nodeSelectionMode, resolveSelectionRetargetIntent, reduceNodeSelection, type NodeSelectionAction, type NodeSelectionState, type PendingSelectionRetargetIntent } from "./selection-state";
import { analyzeCanvasSelection, expandCanvasSelectionNodeIds, relatedCanvasWorkflowNodeIds, type CanvasSelectionCapabilities } from "./canvas-commands";
import { resolveToolTimelineOperationId } from "./tool-timeline";
import { stableRequirementInputSignature } from "./requirement-signature";
import { type ProjectSurface } from "./project-capabilities";
import type { WritingSessionFields } from "./writing-schema";
import { type LineageBridgeResult, type LineageProjectKind } from "./lineage-schema";
import type { StudioLineageSession } from "./lineage-renderer-session";
import { CANVAS_REQUIREMENT_SCENE_OPTIONS, mergePromptNodesIntoRequirements, primaryRequirementInputNodeId, removeRequirementInputBindings, requirementInputBindings, requirementLinkedImageBindings, requirementInputNodeIds, sanitizeCanvasRequirementScenario, sanitizeCanvasImageTask, sanitizeRequirementInputBindings, upsertRequirementInputBinding, wouldCreateWorkflowConnectionCycle } from "./requirement-graph";
import { withAgentTaskScopeConfirmationPolicy } from "./task-scope";
import type { ThemeChoice, AgentStatus, NodeStatus, AppSettings, AgentMessage, AgentFileAttachment, AgentConversation, AgentTaskScope, AgentTaskMention, AgentTaskScopeType, AgentTaskResultPolicy, AgentTaskConfirmationPolicy, AgentCanvasContext, AgentCanvasNodeSummary, AgentCanvasContainerRelation, ConnectionPublicSnapshot, ImageTaskProvenance, AgentAskUserOption, AgentExecutionScopeSnapshot, PendingAgentExecution, AssetTaskRole, CanvasRequirement, CanvasRequirementInputBinding, CanvasRequirementScenario, ImageAssetIdentityClaim, TaskAssetReference, WorkflowNode, ImageNodeProgress, ImageAsset, ImageCollection, ImageContainerKind, ImageContainerMemberBinding, ImageContainerSpec, ReferenceImage, ProjectRecord, ProjectRecoveryAssessment, ProjectNameDraft, ConfirmDialogDraft, WorkflowSession, CanvasViewport, WorkspaceLayout, CanvasMenuState, ImageTaskDraft, ReferencePickerTarget, ReferencePickerDraft, ReferencePickerCanvasCandidate, AskUserDraft, ServerUser, ServerWallet, ServerPublicSettings, ServerKeyStatus, OfficialTokenMeta, ImageViewerState, ImageGenerationStats, ImageQuotaDialogState, AgentProgress, AgentRuntimeAction, AgentToolTrace, ServerBridge, DesktopUpdateInfo, ImageLayerComposition, ImageLayerNodeGroup, WritingAgentPatchProposal, WritingBridgeResult } from "./core";
declare const __AIEYRA_DEV__: boolean;
declare const __AIEYRA_PERF_PROBE__: boolean;
const AIEYRA_RUNTIME_METRICS = __AIEYRA_PERF_PROBE__;
function cloneAgentFileAttachments(files?: AgentFileAttachment[]) {
    return (files ?? []).map((file) => ({ ...file, parseWarnings: file.parseWarnings ? [...file.parseWarnings] : undefined }));
}
function agentFileAttachmentsForHistory(files: AgentFileAttachment[]) {
    return cloneAgentFileAttachments(files).map((file) => {
        if (file.purpose !== "knowledge")
            return file;
        const { textPreview: _oneTurnKnowledgeBody, ...metadata } = file;
        return metadata;
    });
}
function defaultPromptForAgentFiles(files: AgentFileAttachment[]) {
    const knowledgeCount = files.filter((file) => file.purpose === "knowledge").length;
    if (knowledgeCount) {
        return knowledgeCount === files.length
            ? "请阅读我导入的知识文档，提炼与当前项目相关的可复用经验并保存到 Experience。"
            : "请处理我附加的文件；其中的知识文档请先提炼为可复用经验并保存到 Experience。";
    }
    return files.length ? "请处理我附加的文件。" : "";
}
function visiblePromptForAgentFiles(files: AgentFileAttachment[]) {
    const knowledgeCount = files.filter((file) => file.purpose === "knowledge").length;
    if (!files.length)
        return "";
    if (knowledgeCount === files.length)
        return `已导入 ${knowledgeCount} 份知识文档，请提炼经验。`;
    return `已附加 ${files.length} 个文件${knowledgeCount ? `，其中 ${knowledgeCount} 份为知识文档` : ""}，请处理。`;
}
const taskResultLayoutModulePromise = import("./task-result-layout");
const WritingPatchReviewDialog = OptionalWritingPatchReviewDialog;
const CanvasPlatformSelectionIndicator = React.lazy(() => import("./canvas-platform-selection"));
type StudioWorkflowSession = Required<Omit<WorkflowSession, "pendingAgentExecution" | "projectKind" | "projectReadOnly" | "projectQuarantine" | "artifacts" | "artifactEdges" | "artifactLayout" | "artifactViewport" | "selectedArtifactId" | "selectedParagraphId" | "lineageRevision" | "lineageArtifacts" | "lineageEdges" | "lineageLayout" | "lineageViewport" | "selectedLineageArtifactId">> & {
    schemaVersion: number;
    projectKind?: "image";
    layoutGroups: ImageLayoutGroup[];
    sessionRevision: number;
    pendingAgentExecution: PendingAgentExecution | null;
};
type StudioWorkflowSessionInput = Omit<StudioWorkflowSession, "sessionRevision" | "nodeSequence" | "canvasRevision" | "pendingAgentExecution"> & {
    sessionRevision?: number;
    nodeSequence?: number;
    canvasRevision?: number;
    pendingAgentExecution?: PendingAgentExecution | null;
};
type StudioWritingSession = WritingSessionFields & {
    sessionRevision: number;
    messages: AgentMessage[];
    conversations: AgentConversation[];
    activeConversationId: string;
    pendingAgentExecution: PendingAgentExecution | null;
};
type ProjectRunStatus = "running" | "waiting" | "completed" | "error" | "cancelled";
type ProjectRunRecord = {
    projectId: string;
    conversationId: string;
    runId: string;
    runKind?: "agent" | "manual-image" | "preference-summary";
    completionJobIds?: string[];
    status: ProjectRunStatus;
    startedAt: number;
    progress: AgentProgress[];
    imageRunStarts?: Record<string, number>;
    queuedActions: AgentRuntimeAction[];
    session: StudioWorkflowSession;
    taskScope: AgentTaskScope;
    existingNodeIds: string[];
    pendingExecution: PendingAgentExecution | null;
    finalMessage?: AgentMessage;
    error?: string;
};
type ProjectRunView = Pick<ProjectRunRecord, "projectId" | "conversationId" | "runId" | "status" | "startedAt"> & {
    progressCount: number;
    summary: string;
};
type CancelledAgentRequest = {
    projectId: string;
    conversationId: string;
    requestId: string;
    selectedNodeIds: string[];
};
type WritingRuntimeToolResult = NonNullable<Awaited<ReturnType<typeof requestAgent>>["toolResults"]>[number] & {
    callId?: string;
    operationId?: string;
    toolCallId?: string;
    toolRunId?: string;
    skipped?: boolean;
};
export function unresolvedWritingToolFailures(results: readonly WritingRuntimeToolResult[] = []): WritingRuntimeToolResult[] {
    const unresolved: WritingRuntimeToolResult[] = [];
    const identity = (result: WritingRuntimeToolResult) => String(result.toolCallId || result.operationId || result.toolRunId || result.callId || "").trim();
    const toolName = (result: WritingRuntimeToolResult) => String(result.tool || "").trim();
    const skippedSuccess = (result: WritingRuntimeToolResult) => result.skipped === true ||
        /(?:未执行|已跳过|跳过|not\s+executed|skipp?ed)/i.test(String(result.summary || ""));
    const lastUnresolvedIndex = (matches: (failure: WritingRuntimeToolResult) => boolean) => {
        for (let index = unresolved.length - 1; index >= 0; index -= 1) {
            if (matches(unresolved[index]))
                return index;
        }
        return -1;
    };
    for (const result of results) {
        if (result.status === "skipped")
            continue;
        if (result.ok === false) {
            unresolved.push(result);
            continue;
        }
        if (skippedSuccess(result))
            continue;
        const successfulIdentity = identity(result);
        const successfulTool = toolName(result);
        let recoveredIndex = successfulIdentity
            ? lastUnresolvedIndex((failure) => identity(failure) === successfulIdentity)
            : -1;
        if (recoveredIndex < 0 && successfulTool) {
            recoveredIndex = lastUnresolvedIndex((failure) => toolName(failure) === successfulTool);
        }
        if (recoveredIndex >= 0)
            unresolved.splice(recoveredIndex, 1);
    }
    return unresolved;
}
function agentRequestScopeKey(projectId: string, conversationId: string) {
    return `${projectId}\u0000${conversationId}`;
}
type CanvasHistorySnapshot = {
    label: string;
    nodes: WorkflowNode[];
    layoutGroups: ImageLayoutGroup[];
    selection: NodeSelectionState;
    afterNodes?: WorkflowNode[];
    afterGroups?: ImageLayoutGroup[];
    trashToken?: string;
    projectId?: string;
};
type RegionRedrawDraft = {
    mode: "redraw" | "cutout";
    nodeId: string;
    assetIndex: number;
    prompt: string;
    initialPrompt: string;
    brushSize: number;
    maskDirty: boolean;
    discardArmed?: boolean;
    sourceWidth?: number;
    sourceHeight?: number;
    ready: boolean;
    busy: boolean;
    error?: string;
};
type NodeEditorDraft = {
    nodeId: string;
    assetIndex: number;
    title: string;
    prompt: string;
    note: string;
    noteExpanded?: boolean;
    discardArmed?: boolean;
    error?: string;
};
type AgentPromptDispatchOptions = {
    goalId?: string;
    summarizePreferences?: boolean;
    completionProjectId?: string;
    completionConversationId?: string;
    imageJobCompletionIds?: string[];
    sourceNodeIds?: string[];
    focusedNodeId?: string;
    taskOrigin?: AgentTaskScope["origin"];
    requirementNodeId?: string;
    requirementInputSignature?: string;
    requirementSourceSignature?: string;
    useComposerAttachments?: boolean;
    frozenTaskScope?: AgentTaskScope;
    sourceImages?: ReferenceImage[];
    referenceImages?: ReferenceImage[];
    fileAttachments?: AgentFileAttachment[];
    continuationRequestId?: string;
    selectedOptionId?: string;
    originalPrompt?: string;
    explicitMentions?: AgentTaskMention[];
    explicitNodeRoles?: Record<string, AssetTaskRole>;
    scopeExtension?: boolean;
    contextNodeIds?: string[];
};
type AssetContextMenuState = {
    x: number;
    y: number;
    nodeId: string;
    assetIndex: number;
    source: "canvas" | "viewer";
};
type LayerViewerState = {
    groupId: string;
    selectedNodeId: string;
    mode: "composite" | "solo" | "onion";
};
type LayerGroupViewMeta = ImageLayerNodeGroup & {
    visible?: boolean;
    opacity?: number;
    blendMode?: "normal" | "multiply" | "screen" | "overlay" | "source-over";
};
type LayerMergeRuntimeJob = {
    action: AgentRuntimeAction;
    key: string;
    nonce: number;
    projectId: string;
    scopeEpoch: number;
    groupId: string;
    groupNumber: number;
    placeholder?: LayerExecutionPlaceholder;
};
type PendingLayerMergeRuntime = Pick<LayerMergeRuntimeJob, "nonce" | "projectId" | "scopeEpoch" | "groupId" | "groupNumber">;
type LayerExecutionPlaceholder = {
    operationId: string;
    projectId: string;
    groupId: string;
    groupNumber: number;
    parentId?: string;
    nodeIds: string[];
    activeNodeIds: string[];
    resume: boolean;
    retryLayerIds: string[];
    anchorX: number;
    anchorY: number;
    createdAt: string;
};
type RecoverableLayerPreparationFailure = Error & {
    recoverable: true;
    partialComposition: ImageLayerComposition;
    failedLayerIds: string[];
    successfulLayerIds: string[];
    stage: string;
    detail?: Record<string, unknown>;
};
type RuntimeActionCommitResult = {
    operationId: string;
    status: "done" | "error" | "cancelled";
    summary: string;
};
type RuntimeActionApplicationResult = {
    commits: RuntimeActionCommitResult[];
};
type ImageToolCommitEvidence = {
    operationId: string;
    operation?: string;
    toolRequestAt?: number;
    placeholderCommitAt?: number;
    placeholderVisibleAt?: number;
    runtimeImageResponseAt?: number;
    runtimeToolDoneAt?: number;
    nodeCommitAt?: number;
    nodeVisibleAt?: number;
    previewReadyAt?: number;
    resultCardScheduledAt?: number;
    nodeIds: string[];
    nodeRemovalById?: Record<string, number>;
    expectedRendered?: boolean;
    settleReason?: "preview-ready" | "node-visible" | "virtualized" | "commit-only" | "visibility-timeout";
    visibilityTimedOut?: boolean;
    error?: string;
};
type TransientNodeDragEdge = {
    element: SVGPathElement;
    source: WorkflowNode;
    target: WorkflowNode;
    kind: string;
    laneIndex: number;
    laneCount: number;
};
const mainBootStartedAt = performance.now();
const markPerformancePhase = (name: string) => {
    if (__AIEYRA_PERF_PROBE__)
        performance.mark(`aieyra:${name}`);
};
markPerformancePhase("main-module");
let firstAppRenderMarked = false;
let firstWorkspaceRenderMarked = false;
const bootLog = (stage: string) => {
    console.info(`[Aieyra Workspace boot +${Math.round(performance.now() - mainBootStartedAt)}ms] ${stage}`);
};
const stageSize = { width: 24000, height: 18000 };
const WORLD_MARGIN = 12000;
const initialViewport: CanvasViewport = { x: 72, y: 58, scale: 0.9 };
const ImageMentionPreview = React.lazy(() => import("./image-mention-preview"));
const NodeNotePopover = React.lazy(() => import("./node-note-popover").then(module => ({ default: module.NodeNotePopover })));
import { RequirementNodeTitle } from "./requirement-node-title";
function canvasViewportTransform(viewport: CanvasViewport, accelerated = false) {
    return canvasPlatformViewportTransform(viewport, accelerated, typeof window === "undefined" ? 1 : window.devicePixelRatio);
}
const ZOOM_MIN = CANVAS_PLATFORM_MIN_SCALE;
const ZOOM_MAX = CANVAS_PLATFORM_MAX_SCALE;
const CANVAS_SELECTION_HUD_SAFE_TOP = 112;
const VIEWPORT_WHEEL_COMMIT_DELAY_MS = 240;
const NODE_W = 260;
const PROMPT_NODE_W = 320;
const PROMPT_NODE_H = 240;
const REQUIREMENT_NODE_W = 400;
const REQUIREMENT_NODE_H = 310;
const IMAGE_CONTAINER_W = 420;
const IMAGE_CONTAINER_H = 410;
const IMAGE_CONTAINER_MIN_W = 360;
const IMAGE_CONTAINER_MIN_H = 300;
const TASK_IMAGE_CONTAINER_W = 224;
const TASK_IMAGE_CONTAINER_H = 226;
const TASK_IMAGE_CONTAINER_MIN_W = 190;
const TASK_IMAGE_CONTAINER_MIN_H = 190;
const IMAGE_COLLECTION_W = 420;
const IMAGE_COLLECTION_BATCH_H = 410;
const IMAGE_COLLECTION_SERIES_H = 330;
const LAYER_STACK_W = 430;
const LAYER_STACK_H = 500;
const NODE_CONNECT_Y = 40;
const MEDIA_TOOLBAR_HEIGHT = 52;
const MEDIA_TOOLBAR_BOTTOM = MEDIA_TOOLBAR_HEIGHT;
const MEDIA_FRAME_INSET = 6;
const NODE_RESIZE_MIN_W = 260;
const NODE_RESIZE_MAX_W = 720;
const INSPECTOR_MIN_W = 360;
const INSPECTOR_MAX_W = 760;
const INSPECTOR_DEFAULT_W = 560;
const AGENT_MIN_W = 286;
const AGENT_MAX_W = 560;
const AGENT_DEFAULT_W = 360;
const NODE_SELECTED_Z = 900000;
const NODE_PRIMARY_SELECTED_Z = 900001;
const NODE_INTERACTION_Z = 1000000;
const NODE_RENDER_BUFFER = 520;
const NODE_OVERVIEW_MAX_SCALE = 0.45;
const NODE_OVERVIEW_MIN_COUNT = 50;
const CANVAS_PREVIEW_MANY_NODES = 60;
const INTERNAL_ASSET_DRAG_MIME = "application/x-iiimage-asset";
const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;
const WHEN_IDLE_AND_CLEAN = "when-idle-and-clean" as const;
function progressInputOperation(progress?: AgentProgress | null) {
    const input = progress?.input;
    if (!input || typeof input !== "object" || Array.isArray(input))
        return "";
    return String((input as Record<string, unknown>).operation || "");
}
const NODE_RESIZE_MIN_H = 220;
const NODE_RESIZE_MAX_H = 900;
const initialNodes: WorkflowNode[] = [];
type ConnectionDraft = {
    sourceId: string;
    worldX: number;
    worldY: number;
};
function hasMediaNodeToolbar(node: WorkflowNode) {
    return node.type === "image" && !node.layerComposition && (!node.layerGroup || node.layerGroup.detached);
}
function nodeConnectionY(node: WorkflowNode, scale: number) {
    if (node.type === "requirement")
        return 21 * clamp(1 / Math.max(scale, .01), 1, 2);
    return hasMediaNodeToolbar(node)
        ? MEDIA_TOOLBAR_HEIGHT / 2
        : NODE_CONNECT_Y;
}
function provenanceEdgePath(source: WorkflowNode, target: WorkflowNode, laneIndex = 0, laneCount = 1, scale = 1) {
    const sourceCount = source.imageContainer
        ? Math.max(source.assets?.length ?? 0, 1)
        : imageNodeSlotCount(source);
    const adaptiveWidth = displaySizeForImageNode(imageTaskSizeForNode(source), sourceCount, source.assets ?? []).width ?? NODE_W;
    const defaultWidth = source.imageContainer
        ? adaptiveWidth
        : source.imageCollection
            ? source.imageCollection.kind === "series" ? IMAGE_COLLECTION_W : adaptiveWidth
            : source.layerComposition
                ? LAYER_STACK_W
                : adaptiveWidth;
    const x1 = source.x + Math.max(Number(source.width ?? defaultWidth), minimumNodeSize(source).width ?? NODE_W);
    const y1 = source.y + nodeConnectionY(source, scale);
    const x2 = target.x;
    const y2 = target.y + nodeConnectionY(target, scale);
    const lane = (laneIndex - (laneCount - 1) / 2) * 34;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1 + lane}, ${mid} ${y2 + lane}, ${x2} ${y2}`;
}
function parentImageActionToRequirement(action: AgentRuntimeAction, requirementNodeId: string): AgentRuntimeAction {
    if (!requirementNodeId || action.type !== "workflow.node.create" || action.node?.nodeType !== "image")
        return action;
    if (action.node.imageParams?.purpose === "preference_comparison")
        return action;
    return {
        ...action,
        node: {
            ...action.node,
            parentId: requirementNodeId,
            relationType: action.node.imageParams?.layerGroupId ? "grouped" as const : "derived-from" as const,
            imageCollection: action.node.imageCollection
                ? { ...action.node.imageCollection, sourceNodeId: requirementNodeId }
                : undefined
        }
    };
}
const initialMessages: AgentMessage[] = [];
function promptMetaValue(prompt: string, key: string) {
    const match = String(prompt || "").match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
    return match?.[1]?.trim() ?? "";
}
function requirementScenarioLabel(scenario: CanvasRequirementScenario) {
    return CANVAS_REQUIREMENT_SCENE_OPTIONS.find((option) => option.value === scenario)?.label || "图片处理";
}
type DebugRenderCommitArea = "app" | "canvas" | "agentFeed" | "composer";
type PersistenceDebugMetrics = {
    mutationCount: number;
    scheduledWriteCount: number;
    coalescedWriteCount: number;
    writeCount: number;
    skippedWriteCount: number;
    failedWriteCount: number;
    totalFlushMs: number;
    maxFlushMs: number;
    lastFlushMs: number;
};
function emptyPersistenceDebugMetrics(): PersistenceDebugMetrics {
    return {
        mutationCount: 0,
        scheduledWriteCount: 0,
        coalescedWriteCount: 0,
        writeCount: 0,
        skippedWriteCount: 0,
        failedWriteCount: 0,
        totalFlushMs: 0,
        maxFlushMs: 0,
        lastFlushMs: 0
    };
}
function DebugCommitProbe({ area, record }: {
    area: DebugRenderCommitArea;
    record: (area: DebugRenderCommitArea) => void;
}) {
    useEffect(() => {
        if (AIEYRA_RUNTIME_METRICS)
            record(area);
    });
    return null;
}
const ImageViewer = React.lazy(() => import("./image-viewer"));
import { normalizeImageMarks, marksCurrent, studioCall } from "./core";
const StudioDocumentCard = React.lazy(() => import("./studio").then(m => ({ default: m.StudioDocumentCard })));
const StudioDocumentEditor = React.lazy(() => import("./studio").then(m => ({ default: m.StudioDocumentEditor })));
const ImageAnnotationEditor = React.lazy(() => import("./studio").then(m => ({ default: m.ImageAnnotationEditor })));
import type { StudioDocument, ImageMarks } from "./studio";
const ProjectNameDialog = React.lazy(() => import("./common-dialogs").then((module) => ({ default: module.ProjectNameDialog })));
const QuotaDialog = React.lazy(() => import("./common-dialogs").then((module) => ({ default: module.QuotaDialog })));
const ConfirmDialog = React.lazy(() => import("./common-dialogs").then((module) => ({ default: module.ConfirmDialog })));
const ManualImageTaskDialog = React.lazy(() => import("./manual-image-task-dialog"));
const LazyAskUserDialog = React.lazy(() => import("./ask-user-dialog"));
const LazyProjectRecoveryDialog = React.lazy(() => import("./project-recovery-dialog"));
const ProjectResetDialog = React.lazy(() => import("./project-reset-dialog"));
const AgentAssetPickerDialog = React.lazy(() => import("./agent-asset-picker-dialog").then((module) => ({ default: module.AgentAssetPickerDialog })));
const ReferencePickerDialog = React.lazy(() => import("./agent-asset-picker-dialog").then((module) => ({ default: module.ReferencePickerDialog })));
function imageAssetNodePreviewSrc(asset: ImageAsset, node: WorkflowNode, assetCount: number, canvasScale: number) {
    if (node.layerGroup)
        return imageAssetSrc(asset);
    const sourceLongestEdge = Math.max(Number(asset.width || 0), Number(asset.height || 0));
    if (sourceLongestEdge > 0 && sourceLongestEdge <= 256)
        return imageAssetSrc(asset);
    const plan = imageGridPlanForCount(assetCount);
    const nodeWidth = Math.max(160, Number(node.width ?? NODE_W));
    const nodeHeight = Math.max(180, Number(node.height ?? 360));
    const tileWidth = Math.max(24, (nodeWidth - 18) / plan.columns);
    const tileHeight = Math.max(24, (nodeHeight - 72) / plan.rows);
    const dpr = typeof window === "undefined" ? 1 : clamp(Number(window.devicePixelRatio || 1), 1, 3);
    const requiredEdge = Math.max(tileWidth, tileHeight) * Math.max(canvasScale, ZOOM_MIN) * dpr;
    if (requiredEdge > 900 || (sourceLongestEdge > 0 && sourceLongestEdge <= requiredEdge * 1.25))
        return imageAssetSrc(asset);
    return imageAssetThumbnailSrc(asset, requiredEdge > 440 ? 1024 : requiredEdge > 200 ? 512 : 256);
}
function imageNodeSlotCount(node: WorkflowNode) {
    if (node.type !== "image")
        return 1;
    if (node.imageContainer)
        return 1;
    const progressTotal = Number(node.imageProgress?.total ?? 0);
    const paramCount = Number(node.imageParams?.count ?? 0);
    const outputs = Number(node.outputs ?? 0);
    const assets = node.assets?.length ?? 0;
    return clamp(Math.max(progressTotal, paramCount, outputs, assets, 1), 1, 10);
}
function hasSingleImageFrame(node: WorkflowNode) {
    if (!hasMediaNodeToolbar(node))
        return false;
    const count = node.assets?.length ?? 0;
    if (node.imageContainer)
        return count === 1;
    return imageNodeSlotCount(node) === 1 && (!node.imageCollection || count === 1);
}
function imageProgressState(total: number, completed: number, message: string, overrides: Partial<ImageNodeProgress> = {}): ImageNodeProgress {
    return {
        total,
        completed,
        failed: 0,
        failedSlots: [],
        retryCount: 0,
        maxRetries: 0,
        stopped: false,
        message,
        ...overrides
    };
}
function isDraggableImageGroup(node: WorkflowNode) {
    return node.type === "image" && Boolean(node.imageContainer || node.imageCollection);
}
function canGroupImageAsset(node: WorkflowNode) {
    return node.type === "image" && !node.layerComposition && !node.layerGroup && (node.assets?.length ?? 0) > 0;
}
function imageTileRatioForSize(size: string) {
    const parsed = parseImageSizeValue(size);
    if (!parsed)
        return 1;
    return clamp(imageAssetRatio(undefined, parsed.width / parsed.height), 0.48, 2.35);
}
function imageAssetRatio(asset: ImageAsset | undefined, fallbackRatio: number) {
    const width = Number(asset?.width ?? 0);
    const height = Number(asset?.height ?? 0);
    const ratio = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : fallbackRatio;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}
function imageRatiosForAssets(assets: ImageAsset[], assetCount: number, fallbackSize: string) {
    const fallbackRatio = imageTileRatioForSize(fallbackSize);
    return Array.from({ length: Math.max(1, assetCount) }, (_item, index) => imageAssetRatio(assets[index], fallbackRatio));
}
function imageNodePreviewHeight(size: string, assetCount: number, nodeWidth: number, assets: ImageAsset[] = []) {
    const fallbackRatio = imageTileRatioForSize(size);
    const ratios = imageRatiosForAssets(assets, assetCount, size);
    const presentation = imageGridPresentationForRatios(assetCount, ratios, fallbackRatio);
    const gap = 5;
    const padding = 10;
    const contentWidth = Math.max(156, nodeWidth - 34);
    if (presentation.variant === "triple-mosaic-left") {
        const availableWidth = Math.max(120, contentWidth - padding - gap);
        const columnFr = presentation.columnFr ?? [2, 1];
        const primaryWidth = availableWidth * columnFr[0] / Math.max(0.01, columnFr[0] + columnFr[1]);
        const primaryRatio = ratios[presentation.order[0]] ?? fallbackRatio;
        return Math.round(padding + clamp(primaryWidth / primaryRatio, 144, 540));
    }
    if (presentation.variant === "triple-mosaic-top") {
        const availableWidth = Math.max(120, contentWidth - padding);
        const primaryRatio = ratios[presentation.order[0]] ?? fallbackRatio;
        const leftRatio = ratios[presentation.order[1]] ?? fallbackRatio;
        const rightRatio = ratios[presentation.order[2]] ?? fallbackRatio;
        const primaryHeight = availableWidth / primaryRatio;
        const lowerHeight = Math.max(70, (availableWidth - gap) / Math.max(0.64, leftRatio + rightRatio));
        return Math.round(padding + clamp(primaryHeight + gap + lowerHeight, 144, 540));
    }
    const ratio = presentation.representativeRatio;
    const tileWidth = Math.max(86, (contentWidth - padding - gap * (presentation.columns - 1)) / presentation.columns);
    const tileHeight = clamp(Math.round(tileWidth / ratio), ratio < 0.7 ? 150 : 72, ratio < 0.7 ? 420 : ratio > 1.35 ? 230 : 340);
    return Math.round(padding + tileHeight * presentation.rows + gap * (presentation.rows - 1));
}
function minimumImageNodeSize(size: string, assetCount: number, assets: ImageAsset[] = []): Pick<WorkflowNode, "width" | "height"> {
    if (assetCount > 10)
        return { width: 320, height: 300 };
    if (assetCount <= 1)
        return singleImageFrameSize(size, NODE_RESIZE_MIN_W, assets);
    const presentation = imageGridPresentationForRatios(assetCount, imageRatiosForAssets(assets, assetCount, size), imageTileRatioForSize(size));
    const plan = presentation;
    const minTileWidth = plan.columns >= 3 ? 126 : plan.columns === 2 ? 132 : 150;
    const minWidth = clamp(34 + 10 + plan.columns * minTileWidth + (plan.columns - 1) * 5, NODE_RESIZE_MIN_W, NODE_RESIZE_MAX_W);
    const previewHeight = imageNodePreviewHeight(size, assetCount, minWidth, assets);
    const chromeHeight = 116;
    return {
        width: Math.round(minWidth),
        height: Math.round(clamp(previewHeight + chromeHeight, NODE_RESIZE_MIN_H, NODE_RESIZE_MAX_H))
    };
}
function clampImageNodeDimensions(size: string, assetCount: number, width?: number, height?: number, assets: ImageAsset[] = []) {
    if (assetCount <= 1)
        return singleImageFrameSize(size, width ?? NODE_W, assets);
    const minimum = minimumImageNodeSize(size, assetCount, assets);
    const nextWidth = clamp(Number(width ?? minimum.width ?? NODE_W), minimum.width ?? NODE_RESIZE_MIN_W, NODE_RESIZE_MAX_W);
    const nextHeight = clamp(Number(height ?? minimum.height ?? NODE_RESIZE_MIN_H), minimum.height ?? NODE_RESIZE_MIN_H, NODE_RESIZE_MAX_H);
    return { width: Math.round(nextWidth), height: Math.round(nextHeight) };
}
function singleImageFrameSize(size: string, width: number, assets: ImageAsset[] = []) {
    const parsed = parseImageSizeValue(size);
    const ratio = imageAssetRatio(assets[0], parsed ? parsed.width / parsed.height : 1);
    const frameWidth = clamp(Number.isFinite(width) && width > 0 ? width : NODE_W, NODE_RESIZE_MIN_W, NODE_RESIZE_MAX_W);
    return { width: frameWidth, height: (frameWidth - MEDIA_FRAME_INSET * 2) / ratio + MEDIA_FRAME_INSET * 2 + 52 };
}
function layerArtboardDisplaySize(width: number, height: number) {
    const ratio = Math.max(0.08, Number(width || 1) / Math.max(1, Number(height || 1)));
    const maxWidth = 520;
    const maxHeight = 540;
    let displayWidth = ratio >= 1 ? maxWidth : Math.round(maxHeight * ratio);
    let displayHeight = ratio >= 1 ? Math.round(maxWidth / ratio) : maxHeight;
    if (displayWidth < 260) {
        displayWidth = 260;
        displayHeight = Math.round(displayWidth / ratio);
    }
    if (displayHeight < 200) {
        displayHeight = 200;
        displayWidth = Math.round(displayHeight * ratio);
    }
    return {
        width: Math.round(clamp(displayWidth, 260, NODE_RESIZE_MAX_W)),
        height: Math.round(clamp(displayHeight, 200, NODE_RESIZE_MAX_H))
    };
}
function detachedLayerNodeDisplaySize(group: ImageLayerNodeGroup) {
    const size = `${group.compositionWidth}x${group.compositionHeight}`;
    const preferred = displaySizeForImageNode(size, 1);
    return clampImageNodeDimensions(size, 1, preferred.width, preferred.height);
}
function minimumNodeSize(node: WorkflowNode): Pick<WorkflowNode, "width" | "height"> {
    if (node.type === "agent")
        return { width: NODE_W, height: NODE_RESIZE_MIN_H };
    if (node.type === "intent")
        return { width: PROMPT_NODE_W, height: PROMPT_NODE_H };
    if (node.type === "requirement")
        return { width: 300, height: node.requirement?.lastError ? 240 : 220 };
    if (hasSingleImageFrame(node))
        return singleImageFrameSize(imageTaskSizeForNode(node), NODE_RESIZE_MIN_W, node.assets ?? []);
    if (node.imageContainer) {
        if (node.imageContainerRole === "source" || node.imageContainerRole === "reference") {
            return { width: TASK_IMAGE_CONTAINER_MIN_W, height: TASK_IMAGE_CONTAINER_MIN_H };
        }
        const count = Math.max(node.assets?.length ?? 0, 1);
        return count > 1
            ? minimumImageNodeSize(imageTaskSizeForNode(node), count, node.assets ?? [])
            : { width: IMAGE_CONTAINER_MIN_W, height: IMAGE_CONTAINER_MIN_H };
    }
    if (node.imageCollection) {
        const count = Math.max(node.assets?.length ?? node.imageCollection.items.length ?? 0, 1);
        return node.imageCollection.kind === "series"
            ? { width: 360, height: 260 }
            : minimumImageNodeSize(imageTaskSizeForNode(node), count, node.assets ?? []);
    }
    if (node.layerGroup && !node.layerGroup.detached)
        return { width: 260, height: 200 };
    if (node.layerComposition)
        return { width: 360, height: 420 };
    if (node.type !== "image")
        return { width: NODE_RESIZE_MIN_W, height: NODE_RESIZE_MIN_H };
    return minimumImageNodeSize(imageTaskSizeForNode(node), imageNodeSlotCount(node), node.assets ?? []);
}
function displaySizeForImageNode(size: string, assetCount: number, assets: ImageAsset[] = []): Pick<WorkflowNode, "width" | "height"> {
    if (assetCount > 10)
        return { width: 520, height: 520 };
    const parsed = parseImageSizeValue(size);
    if (!parsed)
        return {};
    const count = clamp(Math.round(assetCount || 1), 1, 99);
    const ratio = imageAssetRatio(assets[0], parsed.width / parsed.height);
    const wide = ratio >= 1.25;
    const tall = ratio <= 0.82;
    if (count > 1) {
        const plan = imageGridPresentationForRatios(count, imageRatiosForAssets(assets, count, size), ratio);
        const targetTileWidth = count > 10 ? Math.max(38, 460 / plan.columns) : tall ? 150 : wide ? 170 : 156;
        const width = clamp(34 + 10 + plan.columns * targetTileWidth + (plan.columns - 1) * 5, NODE_RESIZE_MIN_W, NODE_RESIZE_MAX_W);
        const previewHeight = imageNodePreviewHeight(size, count, width, assets);
        const height = clamp(previewHeight + 116, NODE_RESIZE_MIN_H, NODE_RESIZE_MAX_H);
        return clampImageNodeDimensions(size, count, width, height, assets);
    }
    const targetPreviewHeight = tall ? 560 : wide ? 270 : 330;
    const width = clamp(targetPreviewHeight * ratio, NODE_RESIZE_MIN_W, wide ? 560 : tall ? 390 : 430);
    return singleImageFrameSize(size, width, assets);
}
function fitImageLayoutHostNodes(sourceNodes: WorkflowNode[], groups: ImageLayoutGroup[]) {
    if (!groups.length)
        return sourceNodes;
    const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
    const fittedSizes = new Map<string, {
        width: number;
        height: number;
    }>();
    for (const group of groups) {
        if (group.autoFit === false)
            continue;
        const host = nodeById.get(group.hostNodeId);
        if (!host)
            continue;
        const members = group.memberNodeIds
            .map((nodeId) => nodeById.get(nodeId))
            .filter((node): node is WorkflowNode => Boolean(node));
        const assetCount = members.reduce((total, node) => total + Math.max(node.assets?.length ?? 0, 1), 0);
        if (assetCount < 2)
            continue;
        const assets = members.flatMap((node) => node.assets ?? []);
        const dimensionedAssets = assets
            .filter((asset) => Number(asset.width) > 0 && Number(asset.height) > 0)
            .sort((left, right) => Number(left.width) / Number(left.height) - Number(right.width) / Number(right.height));
        const representativeAsset = dimensionedAssets[Math.floor(dimensionedAssets.length / 2)];
        const representativeSize = representativeAsset
            ? `${Math.round(Number(representativeAsset.width))}x${Math.round(Number(representativeAsset.height))}`
            : imageTaskSizeForNode(host);
        const adaptive = displaySizeForImageNode(representativeSize, assetCount, assets);
        const width = Number(adaptive.width ?? 0);
        const height = Number(adaptive.height ?? 0);
        if (!(width > 0 && height > 0))
            continue;
        fittedSizes.set(group.hostNodeId, { width: Math.round(width), height: Math.round(height) });
    }
    if (!fittedSizes.size)
        return sourceNodes;
    return sourceNodes.map((node) => {
        const fitted = fittedSizes.get(node.id);
        return fitted ? { ...node, ...fitted } : node;
    });
}
function imageNodePreviewReserve(node: WorkflowNode, promptPreview: string, hasImageProgress: boolean) {
    if (node.type !== "image")
        return 0;
    if (node.layerGroup && !node.layerGroup.detached)
        return 0;
    let reserve = 82;
    if (promptPreview)
        reserve += 30;
    if (hasImageProgress)
        reserve += 32;
    return reserve;
}
function imageOrientationForSize(size?: {
    width: number;
    height: number;
} | null) {
    if (!size?.width || !size.height)
        return "unknown";
    const ratio = size.width / size.height;
    if (ratio >= 1.22)
        return "landscape";
    if (ratio <= 0.82)
        return "portrait";
    return "square";
}
function imageOrientationForNode(node: WorkflowNode) {
    const size = imageTaskSizeForNode(node);
    const parsed = parseImageSizeValue(size);
    return imageOrientationForSize(parsed);
}
function walletFromServerSettings(user?: ServerUser | null, settings?: ServerPublicSettings | null): ServerWallet | null {
    if (!user || typeof settings?.imageCostCents !== "number")
        return null;
    const balanceCents = Math.max(0, Number(user.balanceCents) || 0);
    const imageCostCents = Math.max(0, Number(settings.imageCostCents) || 0);
    return {
        balanceCents,
        balanceYuan: Number((balanceCents / 100).toFixed(2)),
        imageCostCents,
        imageCostYuan: Number((imageCostCents / 100).toFixed(2))
    };
}
const shortTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
});
function nowLabel() {
    return shortTimeFormatter.format(new Date());
}
function uid(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
function describeError(error: unknown) {
    try {
        if (error && (typeof error === "object" || typeof error === "function")) {
            const message = (error as {
                message?: unknown;
            }).message;
            if (typeof message === "string" && message.trim())
                return message.trim();
        }
        return String(error || "操作失败");
    }
    catch {
        return "操作失败";
    }
}
function accountSyncErrorMessage(value: unknown) {
    const message = typeof value === "string" ? value.trim() : describeError(value);
    return /^internal (?:service|server) error\.?$/i.test(message)
        ? "服务暂时不可用，请稍后重试。当前登录与连接状态已保留。"
        : message || "服务暂时不可用，请稍后重试。";
}
function moveBy<T>(items: T[], predicate: (item: T) => boolean, patch: (item: T) => T) {
    return items.map((item) => (predicate(item) ? patch(item) : item));
}
function readImageGenerationStats(): ImageGenerationStats {
    const stats = readJson<ImageGenerationStats>(STORAGE_IMAGE_STATS, { count: 0, totalSeconds: 0, lastSeconds: 0 });
    return {
        count: Math.max(0, Number(stats.count) || 0),
        totalSeconds: Math.max(0, Number(stats.totalSeconds) || 0),
        lastSeconds: Math.max(0, Number(stats.lastSeconds) || 0),
        updatedAt: typeof stats.updatedAt === "string" ? stats.updatedAt : undefined
    };
}
function normalizeNodeStatus(value: unknown): NodeStatus {
    return value === "queued" || value === "working" || value === "review" || value === "done" ? value : "review";
}
function normalizeImageState(value: unknown, assets: ImageAsset[]): WorkflowNode["imageState"] | undefined {
    if (assets.length > 0)
        return "done";
    if (value === "generating" || value === "done" || value === "empty" || value === "error")
        return value;
    if (value === "queued")
        return "empty";
    return undefined;
}
function normalizeNodeType(value: unknown): WorkflowNode["type"] {
    return value === "intent" || value === "image" || value === "video" || value === "requirement" || value === "review" || value === "export" || value === "branch" || value === "post" || value === "agent" ? value : "intent";
}
function readWorkspaceLayout(): WorkspaceLayout {
    const layout = readJson<WorkspaceLayout>(STORAGE_LAYOUT, {
        inspectorWidth: INSPECTOR_DEFAULT_W,
        agentWidth: AGENT_DEFAULT_W
    });
    return {
        inspectorWidth: clamp(Number(layout.inspectorWidth) > 320 ? Number(layout.inspectorWidth) : INSPECTOR_DEFAULT_W, INSPECTOR_MIN_W, INSPECTOR_MAX_W),
        agentWidth: clamp(Number(layout.agentWidth) || AGENT_DEFAULT_W, AGENT_MIN_W, AGENT_MAX_W),
    };
}
function validNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function sanitizeImageProgress(value: unknown, assets: ImageAsset[], fallbackTotal: number): ImageNodeProgress | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<ImageNodeProgress>;
    const total = clamp(Number(source.total ?? fallbackTotal), 1, 1000);
    const completed = clamp(Number(source.completed ?? assets.length), 0, total);
    const failedSlots = Array.isArray(source.failedSlots)
        ? source.failedSlots.map((item) => clamp(Number(item), 1, total)).filter((item, index, items) => Number.isFinite(item) && items.indexOf(item) === index)
        : [];
    const failed = clamp(Number(source.failed ?? failedSlots.length ?? 0), 0, total);
    return {
        total,
        completed,
        failed,
        failedSlots,
        activeIndex: source.activeIndex === undefined ? undefined : clamp(Number(source.activeIndex), 1, total),
        retryCount: clamp(Number(source.retryCount ?? 0), 0, 99),
        maxRetries: clamp(Number(source.maxRetries ?? 0), 0, 10),
        stopped: source.stopped === true,
        message: typeof source.message === "string" ? source.message.slice(0, 220) : undefined
    };
}
function sanitizeStoredImageAsset(value: unknown, fallbackIndex = 1): ImageAsset | null {
    if (!value || typeof value !== "object")
        return null;
    const source = value as Partial<ImageAsset>;
    const path = safeImageLocatorText(source.path);
    const relativePath = safeImageLocatorText(source.relativePath)?.replace(/\\/g, "/");
    const url = typeof source.url === "string" && source.url.trim() ? source.url.trim() : undefined;
    const assetUrl = typeof source.assetUrl === "string" && source.assetUrl.trim() ? source.assetUrl.trim() : undefined;
    const sourceRelativePath = safeImageSourceRelativePath(source.sourceRelativePath);
    if (!path && !relativePath && !url && !assetUrl)
        return null;
    const normalized: ImageAsset = {
        origin: sanitizeImageOrigin(source.origin),
        annotations: normalizeImageMarks(source.annotations),
        occurrenceId: typeof source.occurrenceId === "string" && /^occ-[a-f0-9]{16,64}$/i.test(source.occurrenceId.trim()) ? source.occurrenceId.trim().toLowerCase() : undefined,
        importBatchId: typeof source.importBatchId === "string" && source.importBatchId.trim() ? source.importBatchId.trim().slice(0, 160) : undefined,
        importRootId: typeof source.importRootId === "string" && source.importRootId.trim() ? source.importRootId.trim().slice(0, 80) : undefined,
        sourceRelativePath,
        sourceRootLabel: typeof source.sourceRootLabel === "string" && source.sourceRootLabel.trim() ? source.sourceRootLabel.trim().slice(0, 260) : undefined,
        sourceRootKind: source.sourceRootKind === "directory" ? "directory" : source.sourceRootKind === "file" ? "file" : undefined,
        contentHash: typeof source.contentHash === "string" && /^[a-f0-9]{32,128}$/i.test(source.contentHash.trim()) ? source.contentHash.trim().toLowerCase() : undefined,
        taskRole: source.taskRole === "source" || source.taskRole === "reference" ? source.taskRole : undefined,
        index: clamp(Number(source.index ?? fallbackIndex), 1, 10000),
        type: source.type === "url" || (!path && Boolean(url || assetUrl)) ? "url" : "file",
        width: Number(source.width) > 0 ? Number(source.width) : undefined,
        height: Number(source.height) > 0 ? Number(source.height) : undefined,
        requestedWidth: Number.isSafeInteger(source.requestedWidth) && Number(source.requestedWidth) > 0 ? source.requestedWidth : undefined,
        requestedHeight: Number.isSafeInteger(source.requestedHeight) && Number(source.requestedHeight) > 0 ? source.requestedHeight : undefined,
        path,
        relativePath,
        url,
        assetUrl,
        originalName: typeof source.originalName === "string" && source.originalName.trim() ? source.originalName.trim().slice(0, 260) : undefined,
        revisedPrompt: typeof source.revisedPrompt === "string" && source.revisedPrompt.trim() ? source.revisedPrompt.trim().slice(0, 12000) : undefined,
        prompt: typeof source.prompt === "string" && source.prompt.trim() ? source.prompt.trim().slice(0, 12000) : undefined,
        title: typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 160) : undefined,
        note: typeof source.note === "string" && source.note.trim()
            ? source.note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
            : undefined,
        status: source.status === "pending" || source.status === "error" ? source.status : "done",
        error: typeof source.error === "string" && source.error.trim() ? friendlyImageError(source.error).slice(0, 320) : undefined,
        runId: typeof source.runId === "string" && source.runId.trim() ? source.runId.trim().slice(0, 180) : undefined,
        displayCode: typeof source.displayCode === "string" && source.displayCode.trim() ? source.displayCode.trim().replace(/\s+/g, "").slice(0, 32) : undefined,
        feedbackScore: normalizeFeedbackScore(source.feedbackScore)
    };
    normalized.assetId = stableImageAssetId({ ...normalized, assetId: typeof source.assetId === "string" ? source.assetId : undefined }, fallbackIndex);
    return normalized;
}
function sanitizeImageCollection(value: unknown, assets: ImageAsset[], fallbackPrompt: string): ImageCollection | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<ImageCollection>;
    const rawItems = Array.isArray(source.items) ? source.items : [];
    const items = rawItems
        .map((item, index) => {
        if (!item || typeof item !== "object")
            return null;
        const candidate = item as ImageCollection["items"][number];
        const requestedStatus = candidate.status === "pending" || candidate.status === "error" ? candidate.status : "done";
        const candidateAssetIndex = Number(candidate.assetIndex);
        const candidateAssetId = typeof candidate.assetId === "string" && candidate.assetId.trim()
            ? candidate.assetId.trim().slice(0, 160)
            : "";
        const candidateOccurrenceId = typeof candidate.occurrenceId === "string" && /^occ-[a-f0-9]{16,64}$/i.test(candidate.occurrenceId.trim())
            ? candidate.occurrenceId.trim().toLowerCase()
            : "";
        const explicitAssetIndex = Number.isInteger(candidateAssetIndex) && candidateAssetIndex >= 1 && candidateAssetIndex <= Math.min(10, assets.length)
            ? clamp(candidateAssetIndex, 1, 10)
            : undefined;
        const occurrenceIndex = explicitAssetIndex === undefined && candidateOccurrenceId
            ? assets.findIndex((asset) => asset.occurrenceId === candidateOccurrenceId)
            : -1;
        const matchingAssetIdIndexes = explicitAssetIndex === undefined && occurrenceIndex < 0 && candidateAssetId
            ? assets.map((asset, assetIndex) => asset.assetId === candidateAssetId ? assetIndex : -1).filter((assetIndex) => assetIndex >= 0)
            : [];
        const assetIdIndex = matchingAssetIdIndexes.length === 1
            ? matchingAssetIdIndexes[0]
            : -1;
        const legacyAssetIndex = explicitAssetIndex === undefined && occurrenceIndex < 0 && assetIdIndex < 0 && requestedStatus === "done" &&
            candidate.assetIndex === undefined && !candidateAssetId && Boolean(assets[index])
            ? index + 1
            : undefined;
        const assetIndex = requestedStatus === "done"
            ? explicitAssetIndex ?? (occurrenceIndex >= 0 ? occurrenceIndex + 1 : assetIdIndex >= 0 ? assetIdIndex + 1 : legacyAssetIndex)
            : undefined;
        const asset = assetIndex === undefined ? undefined : assets[assetIndex - 1];
        const status = requestedStatus === "done" && !asset ? "error" as const : requestedStatus;
        return {
            id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim().slice(0, 120) : `item-${index + 1}`,
            assetIndex,
            requestIndex: clamp(Number(candidate.requestIndex ?? index + 1), 1, 10),
            assetId: status === "done" && asset
                ? asset.assetId || stableImageAssetId(asset, assetIndex)
                : undefined,
            occurrenceId: status === "done" && asset
                ? stableImageOccurrenceId(asset, "image-collection", (assetIndex ?? 1) - 1)
                : undefined,
            prompt: typeof candidate.prompt === "string" && candidate.prompt.trim()
                ? candidate.prompt.trim().slice(0, 12000)
                : asset?.prompt || asset?.revisedPrompt || fallbackPrompt,
            title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 160) : undefined,
            status,
            error: typeof candidate.error === "string" && candidate.error.trim()
                ? friendlyImageError(candidate.error).slice(0, 320)
                : requestedStatus === "done" && !asset
                    ? "图片槽位缺少对应成果。"
                    : undefined
        } satisfies ImageCollection["items"][number];
    })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .slice(0, 10);
    if (!items.length && !assets.length)
        return undefined;
    const normalizedItems = items.length
        ? items
        : assets.slice(0, 10).map((asset, index) => ({
            id: `item-${index + 1}`,
            assetIndex: index + 1,
            requestIndex: index + 1,
            assetId: asset.assetId,
            occurrenceId: stableImageOccurrenceId(asset, "image-collection", index),
            prompt: asset.prompt || asset.revisedPrompt || fallbackPrompt,
            title: asset.title,
            status: "done" as const
        }));
    return {
        id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 120) : uid("collection"),
        kind: source.kind === "series" ? "series" : "batch",
        generationMode: source.generationMode === "sequential" ? "sequential" : "parallel",
        items: normalizedItems,
        sourceNodeId: typeof source.sourceNodeId === "string" && source.sourceNodeId.trim() ? source.sourceNodeId.trim().slice(0, 120) : undefined,
        createdAt: typeof source.createdAt === "string" && source.createdAt.trim() ? source.createdAt : undefined,
        autoFit: source.autoFit !== false
    };
}
function parallelImageCollection(nodeId: string, total: number, assets: ImageAsset[], fallbackPrompt: string, current?: ImageCollection, failedSlots: readonly number[] = []) {
    if (total <= 1)
        return undefined;
    const failed = new Set(failedSlots.map((slot) => Math.max(1, Math.floor(Number(slot) || 1))));
    const items = Array.from({ length: total }, (_item, requestOffset) => {
        const requestIndex = requestOffset + 1;
        const compactAssetIndex = assets.findIndex((asset, compactIndex) => Number(asset.index ?? compactIndex + 1) === requestIndex);
        const asset = compactAssetIndex >= 0 ? assets[compactAssetIndex] : undefined;
        const existing = current?.items.find((item) => Number(item.requestIndex ?? item.assetIndex) === requestIndex);
        return {
            id: existing?.id || `item-${requestIndex}`,
            requestIndex,
            assetIndex: asset ? compactAssetIndex + 1 : undefined,
            assetId: asset?.assetId,
            prompt: asset?.prompt || asset?.revisedPrompt || existing?.prompt || fallbackPrompt,
            title: asset?.title || existing?.title,
            status: asset ? "done" as const : failed.has(requestIndex) ? "error" as const : "pending" as const,
            error: failed.has(requestIndex) ? existing?.error || "本张生成失败。" : undefined
        };
    });
    return sanitizeImageCollection({
        id: current?.id || `batch-${nodeId}`,
        kind: "batch",
        generationMode: "parallel",
        items,
        sourceNodeId: current?.sourceNodeId,
        createdAt: current?.createdAt || new Date().toISOString(),
        autoFit: current?.autoFit !== false
    }, assets, fallbackPrompt);
}
function directImageContainerBindings(nodeId: string, assets: ImageAsset[], current: readonly ImageContainerMemberBinding[] = [], role?: AssetTaskRole): ImageContainerMemberBinding[] {
    const unused = new Set(current.map((_binding, index) => index));
    const usedBindingIds = new Set<string>();
    return assets.map((asset, assetIndex) => {
        const assetId = asset.assetId || stableImageAssetId(asset, assetIndex + 1);
        const occurrenceId = stableImageOccurrenceId(asset, nodeId, assetIndex);
        const exact = current.findIndex((binding, index) => (unused.has(index) && binding.nodeId === nodeId && binding.assetIndex === assetIndex && (binding.occurrenceId ? binding.occurrenceId === occurrenceId : binding.assetId === assetId)));
        const sameOccurrence = exact >= 0 ? exact : current.findIndex((binding, index) => (unused.has(index) && binding.nodeId === nodeId && binding.occurrenceId === occurrenceId));
        const sameSlot = sameOccurrence >= 0 ? sameOccurrence : current.findIndex((binding, index) => (unused.has(index) && binding.nodeId === nodeId && binding.assetIndex === assetIndex));
        const fallback = sameSlot;
        const previous = fallback >= 0 ? current[fallback] : undefined;
        if (fallback >= 0)
            unused.delete(fallback);
        const bindingBase = `binding:${nodeId}:${nodeId}:${occurrenceId}`;
        let bindingId = previous?.bindingId && !usedBindingIds.has(previous.bindingId) ? previous.bindingId : bindingBase;
        let bindingSuffix = 2;
        while (usedBindingIds.has(bindingId))
            bindingId = `${bindingBase}:${bindingSuffix++}`;
        usedBindingIds.add(bindingId);
        return {
            bindingId,
            assetId,
            occurrenceId,
            nodeId,
            containerNodeId: nodeId,
            assetIndex,
            role: asset.taskRole ?? role ?? previous?.role
        };
    });
}
function imageContainerSpecWithCollection(nodeId: string, assets: ImageAsset[], collection: ImageCollection | undefined, current?: ImageContainerSpec): ImageContainerSpec | undefined {
    if (!collection)
        return cloneImageContainerSpec(current);
    const base = current ? cloneImageContainerSpec(current) : undefined;
    const containerGroup = base?.kind === "container-group";
    return {
        version: 1,
        kind: containerGroup ? "container-group" : "batch-result",
        memberNodeIds: [...(base?.memberNodeIds ?? [])],
        childContainerNodeIds: [...(base?.childContainerNodeIds ?? [])],
        memberBindings: directImageContainerBindings(nodeId, assets, base?.memberBindings),
        hostContentKind: containerGroup ? "batch-result" : undefined,
        sourceLabel: base?.sourceLabel,
        importBatchId: base?.importBatchId,
        layoutId: base?.layoutId,
        layoutOrigin: base?.layoutOrigin || "generation",
        autoFit: collection.autoFit !== false,
        collection: cloneImageCollection(collection)
    };
}
function withNodeImageCollection(node: WorkflowNode, collection: ImageCollection | undefined): WorkflowNode {
    const normalizedCollection = collection
        ? sanitizeImageCollection(collection, node.assets ?? [], node.prompt)
        : undefined;
    return applyImageContainerCompatibility({
        ...node,
        imageCollection: cloneImageCollection(normalizedCollection),
        imageContainerSpec: imageContainerSpecWithCollection(node.id, node.assets ?? [], normalizedCollection, imageContainerSpecForNode(node))
    });
}
function sanitizeLayerComposition(value: unknown): ImageLayerComposition | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<ImageLayerComposition>;
    const width = clamp(Number(source.width || 0), 64, 8192);
    const height = clamp(Number(source.height || 0), 64, 8192);
    const layers = (Array.isArray(source.layers) ? source.layers : [])
        .map((layer, index) => {
        if (!layer || typeof layer !== "object")
            return null;
        const asset = sanitizeStoredImageAsset(layer.asset, 1);
        return {
            id: typeof layer.id === "string" && layer.id.trim() ? layer.id.trim().slice(0, 120) : `layer-${index + 1}`,
            title: typeof layer.title === "string" && layer.title.trim() ? layer.title.trim().slice(0, 160) : `图层 ${index + 1}`,
            prompt: typeof layer.prompt === "string" ? layer.prompt.slice(0, 12000) : undefined,
            text: typeof layer.text === "string" && layer.text.trim() ? layer.text.trim().slice(0, 500) : undefined,
            transparent: layer.role === "background" ? false : layer.transparent !== false,
            referenceCodes: Array.isArray(layer.referenceCodes) ? [...new Set(layer.referenceCodes.map((item) => String(item || "").trim().replace(/^@/, "").slice(0, 40)).filter(Boolean))].slice(0, 4) : undefined,
            role: typeof layer.role === "string" && layer.role.trim() ? layer.role.trim().slice(0, 80) : undefined,
            groupId: typeof layer.groupId === "string" && layer.groupId.trim() ? layer.groupId.trim().slice(0, 120) : undefined,
            order: clamp(Number(layer.order ?? index + 1), 1, 32),
            sourceNodeId: typeof layer.sourceNodeId === "string" && layer.sourceNodeId.trim() ? layer.sourceNodeId.trim().slice(0, 120) : undefined,
            assetIndex: layer.assetIndex === undefined ? undefined : clamp(Number(layer.assetIndex), 0, 1000),
            asset: asset ?? undefined,
            extractionMode: layer.extractionMode === "mask-from-preview" ? "mask-from-preview" : layer.extractionMode === "prepared" ? "prepared" : "direct",
            alphaStrategy: layer.alphaStrategy === "native-alpha" || layer.alphaStrategy === "local-alpha-extraction" ? layer.alphaStrategy : undefined,
            x: clamp(Number(layer.x ?? 0), -8192, 8192),
            y: clamp(Number(layer.y ?? 0), -8192, 8192),
            homeX: clamp(Number(layer.homeX ?? 0), -8192, 8192),
            homeY: clamp(Number(layer.homeY ?? 0), -8192, 8192),
            width: layer.width === undefined ? undefined : clamp(Number(layer.width), 1, 32768),
            height: layer.height === undefined ? undefined : clamp(Number(layer.height), 1, 32768),
            scale: clamp(Number(layer.scale ?? 1), 0.05, 8),
            opacity: clamp(Number(layer.opacity ?? 1), 0, 1),
            visible: layer.visible !== false,
            blendMode: layer.blendMode === "multiply" || layer.blendMode === "screen" || layer.blendMode === "overlay" || layer.blendMode === "source-over" ? layer.blendMode : "normal"
        } satisfies ImageLayerComposition["layers"][number];
    })
        .filter((layer): layer is NonNullable<typeof layer> => layer !== null)
        .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
        .slice(0, 32);
    if (!layers.length)
        return undefined;
    return {
        id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 120) : uid("layers"),
        title: typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 160) : "分层 PNG",
        mode: "layer-stack",
        groupNumber: Number.isFinite(Number(source.groupNumber)) ? clamp(Number(source.groupNumber), 1, 9999) : undefined,
        layout: source.layout === "exploded" ? "exploded" : "stacked",
        width,
        height,
        background: typeof source.background === "string" && source.background.trim() ? source.background.trim().slice(0, 80) : "transparent",
        layers,
        previewAsset: sanitizeStoredImageAsset(source.previewAsset, 1) ?? undefined,
        mergedAsset: sanitizeStoredImageAsset(source.mergedAsset, 1) ?? undefined,
        createdAt: typeof source.createdAt === "string" ? source.createdAt : undefined,
        summary: typeof source.summary === "string" ? source.summary.slice(0, 800) : undefined
    };
}
function sanitizeLayerRecovery(value: unknown): NonNullable<ImageLayerNodeGroup["recovery"]> | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<NonNullable<ImageLayerNodeGroup["recovery"]>>;
    const ids = (input: unknown) => Array.isArray(input)
        ? input.map((item) => String(item || "").trim().slice(0, 120)).filter(Boolean).slice(0, 32)
        : [];
    const failedLayerIds = ids(source.failedLayerIds);
    const successfulLayerIds = ids(source.successfulLayerIds).filter((id) => !failedLayerIds.includes(id));
    if (!failedLayerIds.length && !successfulLayerIds.length)
        return undefined;
    const residualRatio = Number(source.residualRatio);
    const residualLimit = Number(source.residualLimit);
    return {
        status: source.status === "failed" ? "failed" : "partial",
        stage: typeof source.stage === "string" && source.stage.trim() ? source.stage.trim().slice(0, 80) : "unknown",
        recoverable: source.recoverable !== false,
        failedLayerIds,
        successfulLayerIds,
        message: typeof source.message === "string" ? source.message.slice(0, 800) : "分层任务需要恢复。",
        attempt: clamp(Math.floor(Number(source.attempt || 1)), 1, 20),
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt.slice(0, 80) : new Date().toISOString(),
        residualRatio: Number.isFinite(residualRatio) ? clamp(residualRatio, 0, 1) : undefined,
        residualLimit: Number.isFinite(residualLimit) ? clamp(residualLimit, 0, 1) : undefined,
    };
}
function sanitizeLayerNodeGroup(value: unknown): ImageLayerNodeGroup | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<ImageLayerNodeGroup>;
    const id = typeof source.id === "string" ? source.id.trim().slice(0, 120) : "";
    const layerId = typeof source.layerId === "string" ? source.layerId.trim().slice(0, 120) : "";
    if (!id || !layerId)
        return undefined;
    const total = clamp(Number(source.total ?? 1), 1, 32);
    return {
        id,
        title: typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 160) : "分层 PNG",
        groupNumber: clamp(Number(source.groupNumber ?? 1), 1, 9999),
        total,
        order: clamp(Number(source.order ?? 1), 1, total),
        layerId,
        layerTitle: typeof source.layerTitle === "string" && source.layerTitle.trim() ? source.layerTitle.trim().slice(0, 160) : `图层 ${source.order ?? 1}`,
        role: typeof source.role === "string" && source.role.trim() ? source.role.trim().slice(0, 80) : "other",
        text: typeof source.text === "string" && source.text.trim() ? source.text.trim().slice(0, 500) : undefined,
        transparent: source.role === "background" ? false : source.transparent !== false,
        referenceCodes: Array.isArray(source.referenceCodes) ? [...new Set(source.referenceCodes.map((item) => String(item || "").trim().replace(/^@/, "").slice(0, 40)).filter(Boolean))].slice(0, 4) : undefined,
        compositionWidth: clamp(Number(source.compositionWidth ?? 1024), 64, 8192),
        compositionHeight: clamp(Number(source.compositionHeight ?? 1024), 64, 8192),
        anchorX: clamp(Number(source.anchorX ?? 0), -24000, 24000),
        anchorY: clamp(Number(source.anchorY ?? 0), -18000, 18000),
        detached: source.detached === true,
        visible: source.visible !== false,
        opacity: clamp(Number(source.opacity ?? 1), 0, 1),
        blendMode: source.blendMode === "multiply" || source.blendMode === "screen" || source.blendMode === "overlay" || source.blendMode === "source-over" ? source.blendMode : "normal",
        sourceParentId: typeof source.sourceParentId === "string" && source.sourceParentId.trim() ? source.sourceParentId.trim().slice(0, 120) : undefined,
        previewAsset: sanitizeStoredImageAsset(source.previewAsset, 1) ?? undefined,
        mergedAsset: sanitizeStoredImageAsset(source.mergedAsset, 1) ?? undefined,
        createdAt: typeof source.createdAt === "string" ? source.createdAt : undefined,
        summary: typeof source.summary === "string" ? source.summary.slice(0, 800) : undefined,
        recovery: sanitizeLayerRecovery(source.recovery)
    };
}
function sanitizeCanvasRequirement(value: unknown, fallbackText = ""): CanvasRequirement | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<CanvasRequirement>;
    const text = typeof source.text === "string" ? source.text.trim().slice(0, 24000) : fallbackText.trim().slice(0, 24000);
    return {
        goalFeedback: sanitizeGoalFeedback(source.goalFeedback) || undefined,
        version: source.version === 3 ? 3 : source.version === 2 ? 2 : 1,
        text,
        revision: Math.max(1, Math.floor(Number(source.revision ?? 1) || 1)),
        createdFrom: source.createdFrom === "canvas" || source.createdFrom === "container" || source.createdFrom === "layer" ? source.createdFrom : "node",
        scenario: sanitizeCanvasRequirementScenario(source.scenario, source.createdFrom === "canvas" ? "text-to-image" : "image-to-image"),
        inputBindings: sanitizeRequirementInputBindings(source.inputBindings),
        lastSourceSignature: typeof source.lastSourceSignature === "string" && source.lastSourceSignature.trim() ? source.lastSourceSignature.trim().slice(0, 160) : undefined,
        lastRunAt: typeof source.lastRunAt === "string" && source.lastRunAt.trim() ? source.lastRunAt.trim().slice(0, 80) : undefined,
        lastRunCount: Number.isFinite(Number(source.lastRunCount)) ? Math.max(0, Math.floor(Number(source.lastRunCount))) : undefined,
        lastError: typeof source.lastError === "string" && source.lastError.trim() ? source.lastError.trim().slice(0, 500) : undefined
    };
}
function sanitizeImageTaskProvenance(value: unknown): ImageTaskProvenance | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<ImageTaskProvenance>;
    const snapshotHash = typeof source.taskScopeSnapshotHash === "string" ? source.taskScopeSnapshotHash.trim().toLowerCase() : "";
    const resultPolicies = new Set<AgentTaskResultPolicy>(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
    if (source.version !== 1 || !/^scope-[a-f0-9]{32}$/.test(snapshotHash) || !resultPolicies.has(source.resultPolicy as AgentTaskResultPolicy))
        return undefined;
    const clean = (input: unknown, maximum: number) => typeof input === "string" && input.trim() ? input.trim().slice(0, maximum) : undefined;
    const revision = Number(source.requirementRevision);
    return {
        version: 1,
        taskScopeSnapshotHash: snapshotHash,
        resultPolicy: source.resultPolicy as AgentTaskResultPolicy,
        sourceBindingId: clean(source.sourceBindingId, 520),
        expectedSourceBindingIds: [...new Set((Array.isArray(source.expectedSourceBindingIds) ? source.expectedSourceBindingIds : [])
                .map((value) => clean(value, 520))
                .filter((value): value is string => Boolean(value)))]
            .slice(0, 200),
        sourceAssetId: clean(source.sourceAssetId, 160),
        sourceOccurrenceId: clean(source.sourceOccurrenceId, 80),
        sourceNodeId: clean(source.sourceNodeId, 160),
        sourceContainerId: clean(source.sourceContainerId, 160),
        sourceDisplayCode: clean(source.sourceDisplayCode, 40),
        requirementNodeId: clean(source.requirementNodeId, 160),
        requirementRevision: Number.isInteger(revision) && revision >= 1 ? Math.floor(revision) : undefined
    };
}
function sanitizeNode(raw: unknown, index: number, usedIds: Set<string>, usedDisplayCodes: Set<string>, preserveRuntimeState = false): WorkflowNode | null {
    if (!raw || typeof raw !== "object")
        return null;
    const source = raw as Partial<WorkflowNode> & Record<string, unknown>;
    const promptParts = splitPromptError(source.prompt);
    let id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : String.fromCharCode(65 + index);
    if (usedIds.has(id)) {
        let suffix = Math.max(27, index + 1);
        while (usedIds.has(`N${suffix}`))
            suffix += 1;
        id = `N${suffix}`;
    }
    usedIds.add(id);
    let displayCode = typeof source.displayCode === "string" && source.displayCode.trim()
        ? source.displayCode.trim().replace(/\s+/g, "").slice(0, 32)
        : id;
    if (usedDisplayCodes.has(displayCode)) {
        let suffix = Math.max(27, index + 1);
        while (usedDisplayCodes.has(`N${suffix}`))
            suffix += 1;
        displayCode = `N${suffix}`;
    }
    usedDisplayCodes.add(displayCode);
    const type = normalizeNodeType(source.type);
    const sourceImageState = source.imageState;
    const generationRunId = typeof source.generationRunId === "string" && source.generationRunId.trim() ? source.generationRunId.trim() : undefined;
    const assets = (Array.isArray(source.assets)
        ? source.assets.map((asset, assetIndex) => sanitizeStoredImageAsset(asset, assetIndex + 1)).filter((asset): asset is ImageAsset => Boolean(asset)).filter(() => {
            if (sourceImageState === "empty")
                return false;
            return true;
        })
        : []).map((asset, assetIndex) => ({
        ...asset,
        assetId: stableImageAssetId(asset, assetIndex + 1),
        displayCode: asset.displayCode || `${displayCode}${assetIndex + 1}`
    }));
    const normalizedImageState = type === "image" ? normalizeImageState(source.imageState, assets) : undefined;
    const interruptedImageRun = type === "image" && normalizedImageState === "generating" && !preserveRuntimeState;
    const imageState = interruptedImageRun ? "error" : normalizedImageState;
    const status = imageState === "done" ? "done" : imageState === "generating" ? "working" : interruptedImageRun ? "review" : normalizeNodeStatus(source.status);
    const parentId = typeof source.parentId === "string" && source.parentId.trim() && source.parentId !== id ? source.parentId.trim() : undefined;
    const agentOwnerId = typeof source.agentOwnerId === "string" && source.agentOwnerId.trim() && source.agentOwnerId !== id ? source.agentOwnerId.trim() : undefined;
    const outputs = Math.max(assets.length, Number.isFinite(Number(source.outputs)) ? Math.max(0, Number(source.outputs)) : 0);
    const imageParams = sanitizeImageParams(source.imageParams, promptParts.prompt);
    const layerGroup = sanitizeLayerNodeGroup(source.layerGroup);
    const layerComposition = sanitizeLayerComposition(source.layerComposition);
    const requirement = type === "requirement" ? sanitizeCanvasRequirement(source.requirement, promptParts.prompt) : undefined;
    const storedCollection = sanitizeImageCollection(source.imageCollection, assets, promptParts.prompt);
    const imageCollection = storedCollection || (type === "image" && source.imageContainer !== true && !layerComposition && assets.length > 1
        ? sanitizeImageCollection({ id: `legacy-${id}`, kind: "batch", generationMode: "parallel", items: [] }, assets, promptParts.prompt)
        : undefined);
    const imageContainerSpec = type === "image"
        ? sanitizeImageContainerSpec(source.imageContainerSpec, id, imageCollection, assets)
        : undefined;
    const imageProgress = type === "image" ? sanitizeImageProgress(source.imageProgress, assets, (imageParams?.count ?? outputs) || 1) : undefined;
    const taskProvenance = type === "image" ? sanitizeImageTaskProvenance(source.taskProvenance) : undefined;
    const completedImageProgress = type === "image" && imageState === "done" && imageProgress
        ? {
            ...imageProgress,
            total: Math.max(imageProgress.total, assets.length, 1),
            completed: Math.max(imageProgress.completed, assets.length),
            activeIndex: undefined,
            stopped: false,
            message: `已完成 ${Math.max(imageProgress.completed, assets.length)}/${Math.max(imageProgress.total, assets.length, 1)} 张`
        }
        : imageProgress;
    const rawImageError = typeof source.imageError === "string" && source.imageError.trim() ? source.imageError.trim() : promptParts.error;
    const imageError = interruptedImageRun ? "上次生成已中断。" : rawImageError;
    let appearance: WorkflowNode["appearance"];
    try {
        const normalized = normalizeNodeStyle(source.appearance);
        if (Object.keys(normalized).length)
            appearance = normalized;
    }
    catch { }
    return applyImageContainerCompatibility({
        id,
        displayCode,
        appearance,
        documentId: typeof source.documentId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(source.documentId) ? source.documentId : undefined,
        databaseReference: source.databaseReference && typeof source.databaseReference.id === "string" ? source.databaseReference : undefined,
        assetSequence: Math.max(Math.floor(Number(source.assetSequence || 0) || 0), imageAssetSequence(assets, displayCode)),
        title: typeof source.title === "string" && source.title.trim() ? source.title : "未命名成果",
        prompt: promptParts.prompt,
        note: typeof source.note === "string" && source.note.trim()
            ? source.note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
            : undefined,
        type,
        video: type === "video" ? sanitizeVideoNode(source.video) : undefined,
        status,
        x: validNumber(source.x, 120 + index * 300),
        y: validNumber(source.y, 120 + index * 120),
        parentId,
        relationType: source.relationType === "derived-from" || source.relationType === "referenced" || source.relationType === "variant" || source.relationType === "grouped"
            ? source.relationType
            : parentId
                ? "derived-from"
                : undefined,
        agentOwnerId,
        branch: typeof source.branch === "string" && source.branch.trim() ? source.branch : "project-agent",
        outputs,
        createdAt: typeof source.createdAt === "string" && source.createdAt.trim() ? source.createdAt : nowLabel(),
        agentConversationId: type === "agent" && typeof source.agentConversationId === "string" && source.agentConversationId.trim() ? source.agentConversationId.trim() : undefined,
        agentInitState: type === "agent" && (source.agentInitState === "checking" || source.agentInitState === "awaiting-brief" || source.agentInitState === "ready" || source.agentInitState === "error")
            ? source.agentInitState
            : type === "agent"
                ? "awaiting-brief"
                : undefined,
        agentLastMemoryEntryId: type === "agent" && typeof source.agentLastMemoryEntryId === "string" && source.agentLastMemoryEntryId.trim() ? source.agentLastMemoryEntryId.trim() : undefined,
        assets,
        imageState,
        imageError: type === "image" && imageError ? friendlyImageError(imageError) : undefined,
        imageParams,
        imageProgress: interruptedImageRun && completedImageProgress ? { ...completedImageProgress, stopped: true, message: "上次生成已中断。" } : completedImageProgress,
        generationRunId: interruptedImageRun ? undefined : generationRunId,
        layerGroup,
        layerComposition,
        imageContainer: type === "image" && source.imageContainer === true,
        imageContainerRole: source.imageContainerRole === "source" || source.imageContainerRole === "reference" ? source.imageContainerRole : undefined,
        imageContainerSpec,
        imageCollection,
        taskProvenance,
        requirement,
        imageTask: type === "image" ? sanitizeCanvasImageTask(source.imageTask) : undefined,
        feedbackScore: normalizeFeedbackScore(source.feedbackScore),
        width: validNumber(source.width, NODE_W),
        height: validNumber(source.height, 0) || undefined,
        zOrder: Number.isFinite(Number(source.zOrder)) ? clamp(Math.round(Number(source.zOrder)), 1, 1000000) : undefined
    });
}
function sanitizeImageParams(value: unknown, fallbackPrompt = ""): ImageTaskDraft | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value as Partial<ImageTaskDraft>;
    const referenceImages: ReferenceImage[] = Array.isArray(source.referenceImages)
        ? source.referenceImages
            .reduce<ReferenceImage[]>((items, image) => {
            if (!image || typeof image !== "object")
                return items;
            const candidate = image as Partial<ReferenceImage>;
            const rawPath = safeImageLocatorText(candidate.path) || "";
            const contentHash = typeof candidate.contentHash === "string" && /^[a-f0-9]{32,128}$/i.test(candidate.contentHash.trim()) ? candidate.contentHash.trim().toLowerCase() : undefined;
            const relativePath = safeImageLocatorText(candidate.relativePath)?.replace(/\\/g, "/");
            if (!rawPath && !relativePath)
                return items;
            const path = rawPath || relativePath || "";
            const reference: ReferenceImage = {
                assetId: typeof candidate.assetId === "string" && candidate.assetId.trim() ? candidate.assetId.trim().slice(0, 160) : stableImageAssetId({ contentHash, path, relativePath }, items.length + 1),
                displayCode: typeof candidate.displayCode === "string" && candidate.displayCode.trim() ? candidate.displayCode.trim().replace(/\s+/g, "").slice(0, 32) : undefined,
                contentHash,
                taskRole: candidate.taskRole === "source" ? "source" : "reference",
                name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : path.split(/[\\/]/).pop() || "reference.png",
                path,
                relativePath,
                mimeType: typeof candidate.mimeType === "string" && candidate.mimeType.trim() ? candidate.mimeType.trim() : mimeTypeFromPath(path)
            };
            if (typeof candidate.assetUrl === "string" && candidate.assetUrl.trim())
                reference.assetUrl = candidate.assetUrl;
            if (typeof candidate.role === "string" && candidate.role.trim())
                reference.role = candidate.role.replace(/\s+/g, " ").trim().slice(0, 80);
            if (typeof candidate.purpose === "string" && candidate.purpose.trim())
                reference.purpose = candidate.purpose.replace(/\s+/g, " ").trim().slice(0, 320);
            reference.feedbackScore = normalizeFeedbackScore(candidate.feedbackScore);
            items.push(reference);
            return items;
        }, [])
            .slice(0, MAX_REFERENCE_IMAGES)
        : [];
    return {
        prompt: typeof source.prompt === "string" ? source.prompt : fallbackPrompt,
        ratio: typeof source.ratio === "string" && source.ratio.trim() ? source.ratio : "1:1",
        resolution: typeof source.resolution === "string" && source.resolution.trim() ? source.resolution : "2K",
        size: typeof source.size === "string" ? source.size : "",
        count: clamp(Number(source.count ?? 1), 1, 10),
        quality: source.quality === "low" || source.quality === "medium" || source.quality === "high" || source.quality === "xhigh" || source.quality === "max" || source.quality === "auto"
            ? source.quality
            : "auto",
        batchMode: "parallel",
        referenceImages,
        ...(source.outputFormat === "png" || source.outputFormat === "jpeg" || source.outputFormat === "webp" ? { outputFormat: source.outputFormat } : {}),
        ...(Number.isFinite(Number(source.outputCompression)) ? { outputCompression: clamp(Number(source.outputCompression), 0, 100) } : {}),
        ...(source.background === "auto" || source.background === "transparent" || source.background === "opaque" ? { background: source.background } : {}),
        ...(source.moderation === "auto" || source.moderation === "low" ? { moderation: source.moderation } : {}),
        ...(source.inputFidelity === "low" || source.inputFidelity === "high" ? { inputFidelity: source.inputFidelity } : {}),
        ...(typeof source.model === "string" && source.model.trim() ? { model: source.model.trim() } : {}),
        ...(typeof source.layerId === "string" && source.layerId.trim() ? { layerId: source.layerId.trim() } : {}),
        ...(typeof source.layerRole === "string" && source.layerRole.trim() ? { layerRole: source.layerRole.trim() } : {}),
        ...(typeof source.layerGroupId === "string" && source.layerGroupId.trim() ? { layerGroupId: source.layerGroupId.trim() } : {}),
        ...(source.transparentPreferred === true ? { transparentPreferred: true } : {}),
        ...(source.alphaStrategy === "native-alpha" || source.alphaStrategy === "local-alpha-extraction" ? { alphaStrategy: source.alphaStrategy } : {})
    };
}
function normalizeStoredLayerGroups(source: WorkflowNode[]) {
    if (!source.some((node) => Boolean(node.layerGroup)))
        return source;
    let next = source.map(cloneWorkflowNode);
    const groupIds = [...new Set(next.map((node) => node.layerGroup?.id).filter((id): id is string => Boolean(id)))];
    for (const groupId of groupIds) {
        const members = next
            .map((node, sourceIndex) => ({ node, sourceIndex }))
            .filter((entry) => entry.node.layerGroup?.id === groupId)
            .sort((left, right) => Number(left.node.layerGroup?.order ?? 0) - Number(right.node.layerGroup?.order ?? 0) || left.sourceIndex - right.sourceIndex);
        if (!members.length)
            continue;
        const template = members[0].node.layerGroup!;
        const memberIds = new Set(members.map((entry) => entry.node.id));
        const externalParent = members.find((entry) => entry.node.parentId && !memberIds.has(entry.node.parentId))?.node.parentId;
        const sourceParentId = template.sourceParentId || externalParent;
        if (members.length === 1) {
            const only = members[0].node;
            next = next.map((node) => node.id === only.id
                ? {
                    ...node,
                    title: template.layerTitle || node.title,
                    parentId: sourceParentId,
                    relationType: sourceParentId ? (node.relationType || "derived-from") : undefined,
                    layerGroup: undefined,
                    imageParams: node.imageParams ? cloneImageTaskDraft({
                        ...node.imageParams,
                        layerId: undefined,
                        layerRole: undefined,
                        layerGroupId: undefined
                    }) : undefined
                }
                : node);
            continue;
        }
        const positions = new Map(members.map((entry, index) => [entry.node.id, index + 1]));
        const structuralRepairNeeded = members.some((entry, index) => entry.node.layerGroup?.order !== index + 1 ||
            entry.node.layerGroup?.total !== members.length ||
            entry.node.layerGroup?.compositionWidth !== template.compositionWidth ||
            entry.node.layerGroup?.compositionHeight !== template.compositionHeight);
        next = next.map((node) => {
            const order = positions.get(node.id);
            if (!order || !node.layerGroup)
                return node;
            const isBase = order === 1;
            return {
                ...node,
                title: `#${String(template.groupNumber).padStart(3, "0")} · ${node.layerGroup.layerTitle}`,
                parentId: isBase ? sourceParentId : undefined,
                relationType: isBase && sourceParentId ? (node.relationType || "derived-from") : undefined,
                layerGroup: {
                    ...cloneImageLayerNodeGroup(node.layerGroup)!,
                    title: template.title,
                    groupNumber: template.groupNumber,
                    total: members.length,
                    order,
                    compositionWidth: template.compositionWidth,
                    compositionHeight: template.compositionHeight,
                    anchorX: template.anchorX,
                    anchorY: template.anchorY,
                    sourceParentId,
                    ...(structuralRepairNeeded ? {
                        mergedAsset: undefined,
                        summary: `读取项目时已修复残缺层序，当前 ${members.length} 层。`
                    } : {})
                },
                imageProgress: node.imageProgress ? {
                    ...node.imageProgress,
                    total: 1,
                    completed: 1,
                    message: `第 ${order}/${members.length} 层${structuralRepairNeeded ? " · 层序已修复" : ""}`
                } : node.imageProgress
            };
        });
    }
    return next;
}
function normalizeNodeZOrders(source: WorkflowNode[]) {
    if (!source.length)
        return source;
    let previousZOrder = 0;
    const alreadyStable = source.every((node) => {
        const zOrder = Number(node.zOrder);
        if (node.layerGroup || !Number.isFinite(zOrder) || zOrder <= previousZOrder)
            return false;
        previousZOrder = zOrder;
        return true;
    });
    if (alreadyStable)
        return source;
    const highestExplicit = source.reduce((highest, node) => Math.max(highest, Number.isFinite(Number(node.zOrder)) ? Math.round(Number(node.zOrder)) : 0), 0);
    const ordered = source
        .map((node, index) => ({
        node,
        index,
        requested: Number.isFinite(Number(node.zOrder)) ? Math.round(Number(node.zOrder)) : highestExplicit + index + 1
    }))
        .sort((left, right) => left.requested - right.requested || left.index - right.index);
    const grouped = new Map<string, typeof ordered>();
    for (const entry of ordered) {
        const groupId = entry.node.layerGroup?.id;
        if (!groupId)
            continue;
        const members = grouped.get(groupId) ?? [];
        members.push(entry);
        grouped.set(groupId, members);
    }
    grouped.forEach((members) => members.sort((left, right) => Number(left.node.layerGroup?.order ?? 0) - Number(right.node.layerGroup?.order ?? 0) || left.index - right.index));
    const emittedGroups = new Set<string>();
    const flattened: typeof ordered = [];
    for (const entry of ordered) {
        const groupId = entry.node.layerGroup?.id;
        if (!groupId) {
            flattened.push(entry);
            continue;
        }
        if (emittedGroups.has(groupId))
            continue;
        emittedGroups.add(groupId);
        flattened.push(...(grouped.get(groupId) ?? [entry]));
    }
    const zById = new Map(flattened.map((entry, index) => [entry.node.id, index + 10]));
    return source.map((node) => ({ ...node, zOrder: zById.get(node.id) ?? 10 }));
}
function nodeZOrder(node: WorkflowNode, fallbackIndex = 0) {
    return Number.isFinite(Number(node.zOrder)) ? Math.round(Number(node.zOrder)) : fallbackIndex + 10;
}
function nodeRenderZIndex(node: WorkflowNode, nodeStackById: ReadonlyMap<string, number>, selectedNodeIdSet: ReadonlySet<string>, selectedNodeId: string, interactionActive = false) {
    if (interactionActive)
        return NODE_INTERACTION_Z;
    const persistedZIndex = nodeStackById.get(node.id) ?? 0;
    if (node.layerGroup && !node.layerGroup.detached)
        return persistedZIndex;
    if (selectedNodeIdSet.has(node.id)) {
        return node.id === selectedNodeId ? NODE_PRIMARY_SELECTED_Z : NODE_SELECTED_Z;
    }
    return persistedZIndex;
}
function nextNodeZOrder(nodes: WorkflowNode[]) {
    return nodes.reduce((highest, node, index) => Math.max(highest, nodeZOrder(node, index)), 9) + 1;
}
function validNodes(value: unknown, preserveRuntimeState = false): WorkflowNode[] {
    if (!Array.isArray(value) || value.length === 0)
        return initialNodes;
    const usedIds = new Set<string>();
    const usedDisplayCodes = new Set<string>();
    const migratedNodes = mergePromptNodesIntoRequirements(value
        .map((node, index) => sanitizeNode(node, index, usedIds, usedDisplayCodes, preserveRuntimeState))
        .filter((node): node is WorkflowNode => Boolean(node)));
    const expandedIds = new Set(migratedNodes.map((node) => node.id));
    const migrated = migratedNodes.flatMap((node) => {
        const composition = node.layerComposition;
        if (!composition)
            return [node];
        const layersWithAssets = composition.layers.filter((layer) => Boolean(layer.asset));
        if (!layersWithAssets.length)
            return [node];
        const groupNumber = composition.groupNumber ?? 1;
        const groupLabel = `#${String(groupNumber).padStart(3, "0")}`;
        return layersWithAssets.map((layer, index): WorkflowNode => {
            const baseId = `${node.id}-${layer.id || `layer-${index + 1}`}`.replace(/[^a-z0-9_-]/gi, "-");
            let id = baseId;
            let suffix = 2;
            while (expandedIds.has(id))
                id = `${baseId}-${suffix++}`;
            expandedIds.add(id);
            const order = Number(layer.order ?? index + 1);
            const displayCode = `L${String(groupNumber).padStart(3, "0")}-${order}`;
            const asset = { ...layer.asset!, assetId: stableImageAssetId(layer.asset!, 1), displayCode: layer.asset?.displayCode || `${displayCode}1`, index: 1, title: layer.title, prompt: layer.prompt };
            return {
                ...node,
                id,
                displayCode,
                assetSequence: 1,
                title: `${groupLabel} · ${layer.title || `图层 ${order}`}`,
                prompt: layer.prompt || node.prompt,
                x: node.x,
                y: node.y,
                parentId: order === 1 ? node.parentId : undefined,
                relationType: order === 1 ? node.relationType : undefined,
                outputs: 1,
                assets: [asset],
                imageState: "done",
                status: "done",
                layerComposition: undefined,
                layerGroup: {
                    id: composition.id,
                    title: composition.title || "分层 PNG",
                    groupNumber,
                    total: layersWithAssets.length,
                    order,
                    layerId: layer.id,
                    layerTitle: layer.title || `图层 ${order}`,
                    role: layer.role || "other",
                    text: layer.text,
                    transparent: (layer.role || "other") === "background" ? false : layer.transparent !== false,
                    referenceCodes: layer.referenceCodes ? [...layer.referenceCodes] : undefined,
                    compositionWidth: composition.width,
                    compositionHeight: composition.height,
                    anchorX: node.x,
                    anchorY: node.y,
                    detached: false,
                    visible: layer.visible !== false,
                    opacity: clamp(Number(layer.opacity ?? 1), 0, 1),
                    blendMode: layer.blendMode === "multiply" || layer.blendMode === "screen" || layer.blendMode === "overlay" || layer.blendMode === "source-over" ? layer.blendMode : "normal",
                    sourceParentId: node.parentId,
                    previewAsset: composition.previewAsset ? { ...composition.previewAsset } : undefined,
                    mergedAsset: composition.mergedAsset ? { ...composition.mergedAsset } : undefined,
                    createdAt: composition.createdAt,
                    summary: composition.summary
                },
                imageParams: cloneImageTaskDraft({
                    ...(node.imageParams ?? defaultImageTaskDraft(defaultSettings)),
                    prompt: layer.prompt || node.imageParams?.prompt || node.prompt,
                    count: 1,
                    layerId: layer.id,
                    layerRole: layer.role,
                    layerGroupId: composition.id,
                    transparentPreferred: layer.role !== "background" && layer.transparent !== false,
                    alphaStrategy: layer.alphaStrategy
                }),
                imageProgress: imageProgressState(1, 1, `${groupLabel} · 第 ${order}/${layersWithAssets.length} 层`),
                ...layerArtboardDisplaySize(composition.width, composition.height)
            };
        });
    });
    const removedLegacyIds = new Set(migrated
        .filter((node) => node.type !== "image" && !(node.type === "video" && node.video) && !(node.type === "requirement" && node.requirement) && (node.assets?.length ?? 0) === 0)
        .map((node) => node.id));
    const nodes = migrated
        .filter((node) => node.type === "image" || (node.type === "video" && node.video) || (node.type === "requirement" && node.requirement) || (node.assets?.length ?? 0) > 0)
        .map((node): WorkflowNode => {
        if (node.type === "image" || node.type === "requirement" || node.type === "video")
            return node;
        const assets = cloneImageAssets(node.assets);
        const total = Math.max(assets.length, 1);
        return applyImageContainerCompatibility({
            ...node,
            type: "image",
            status: assets.length ? "done" : "review",
            outputs: assets.length,
            assets,
            imageState: assets.length ? "done" : "empty",
            imageParams: node.imageParams ?? cloneImageTaskDraft({ ...defaultImageTaskDraft(defaultSettings), prompt: node.prompt, count: total }),
            imageProgress: imageProgressState(total, assets.length, assets.length ? `旧成果已迁移 · ${assets.length} 张图片` : "旧成果没有可用图片"),
            imageCollection: assets.length > 1
                ? sanitizeImageCollection({ id: `legacy-${node.id}`, kind: "batch", generationMode: "parallel", items: [] }, assets, node.prompt)
                : undefined
        });
    });
    const normalizedGroups = normalizeStoredLayerGroups(nodes);
    const ids = new Set(normalizedGroups.map((node) => node.id));
    const cleanedNodes = normalizedGroups.map((node) => {
        const invalidParent = Boolean(node.parentId && (!ids.has(node.parentId) || removedLegacyIds.has(node.parentId)));
        const hasLegacyAgentState = Boolean(node.agentOwnerId || node.agentConversationId || node.agentInitState || node.agentLastMemoryEntryId);
        if (!invalidParent && !hasLegacyAgentState)
            return node;
        return {
            ...node,
            ...(invalidParent ? { parentId: undefined, relationType: undefined } : {}),
            agentOwnerId: undefined,
            agentConversationId: undefined,
            agentInitState: undefined,
            agentLastMemoryEntryId: undefined
        };
    });
    return normalizeNodeZOrders(cleanedNodes);
}
type AssetIdentityTarget = {
    assetId?: string;
};
function reconcileWorkflowSessionAssetIds(nodes: WorkflowNode[], messages: AgentMessage[], conversations: AgentConversation[]) {
    const records: Array<{
        target: AssetIdentityTarget;
        claim: ImageAssetIdentityClaim;
    }> = [];
    function addAsset(target: AssetIdentityTarget | null | undefined, ownerId: string, assetIndex: number) {
        if (!target)
            return;
        const identity = target as AssetIdentityTarget & Partial<ImageAsset> & {
            name?: string;
        };
        records.push({
            target,
            claim: {
                ...identity,
                originalName: identity.originalName || identity.name,
                ownerId,
                assetIndex
            }
        });
    }
    for (const node of nodes) {
        (node.assets ?? []).forEach((asset, assetIndex) => addAsset(asset, node.id, assetIndex));
    }
    for (const node of nodes) {
        (node.imageParams?.referenceImages ?? []).forEach((reference, assetIndex) => addAsset(reference, `${node.id}:imageParams`, assetIndex));
        (node.layerComposition?.layers ?? []).forEach((layer, assetIndex) => addAsset(layer.asset, `${node.id}:layer:${layer.id || assetIndex}`, assetIndex));
        addAsset(node.layerComposition?.previewAsset, `${node.id}:layer-preview`, 0);
        addAsset(node.layerComposition?.mergedAsset, `${node.id}:layer-merged`, 0);
        addAsset(node.layerGroup?.previewAsset, `${node.id}:group-preview`, 0);
        addAsset(node.layerGroup?.mergedAsset, `${node.id}:group-merged`, 0);
    }
    function addMessageAssets(message: AgentMessage, ownerId: string) {
        (message.attachments?.sourceAssets ?? []).forEach((asset, assetIndex) => addAsset(asset, `${ownerId}:source`, asset.assetIndex ?? assetIndex));
        (message.attachments?.referenceAssets ?? []).forEach((asset, assetIndex) => addAsset(asset, `${ownerId}:reference`, asset.assetIndex ?? assetIndex));
        (message.attachments?.contextAssets ?? []).forEach((asset, assetIndex) => addAsset(asset, `${ownerId}:context`, asset.assetIndex ?? assetIndex));
    }
    messages.forEach((message, index) => addMessageAssets(message, `message:${message.id || index}`));
    conversations.forEach((conversation) => conversation.messages.forEach((message, index) => addMessageAssets(message, `conversation:${conversation.id}:message:${message.id || index}`)));
    const resolutions = reconcileImageAssetIdentityClaims(records.map((record) => record.claim));
    resolutions.forEach((resolution, index) => {
        records[index].target.assetId = resolution.assetId;
    });
}
function sanitizeAgentAskUserOptions(value: unknown): AgentAskUserOption[] {
    if (!Array.isArray(value))
        return [];
    const usedIds = new Set<string>();
    let recommendedClaimed = false;
    const options = value.slice(0, 3).flatMap((item, index) => {
        if (!item || typeof item !== "object")
            return [];
        const candidate = item as Partial<AgentAskUserOption>;
        const label = String(candidate.label || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (!label)
            return [];
        const fallbackId = `option-${index + 1}`;
        let id = String(candidate.id || fallbackId).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallbackId;
        let suffix = 2;
        const baseId = id;
        while (usedIds.has(id))
            id = `${baseId}-${suffix++}`.slice(0, 80);
        usedIds.add(id);
        const recommended = candidate.recommended === true && !recommendedClaimed;
        if (recommended)
            recommendedClaimed = true;
        return [{
                id,
                label,
                description: String(candidate.description || "").trim().slice(0, 260) || undefined,
                answer: String(candidate.answer || label).trim().slice(0, 4000) || label,
                recommended: recommended || undefined
            }];
    });
    return options.length >= 2 ? options : [];
}
function sanitizePendingAgentExecution(value: unknown): PendingAgentExecution | null {
    if (!value || typeof value !== "object")
        return null;
    const source = value as Partial<PendingAgentExecution>;
    const clean = (input: unknown, maximum: number) => typeof input === "string" ? input.trim().slice(0, maximum) : "";
    const requestId = clean(source.requestId, 180);
    const projectId = clean(source.projectId, 180);
    const conversationId = clean(source.conversationId, 180);
    const originalPrompt = clean(source.originalPrompt, 24000);
    const question = clean(source.question, 4000);
    const kinds = new Set<PendingAgentExecution["kind"]>(["clarify", "confirm", "source_images", "reference_images"]);
    const origins = new Set<AgentTaskScope["origin"]>(["chat", "canvas", "node", "container", "layer", "requirement"]);
    const scopeTypes = new Set<AgentTaskScopeType>(["none", "single", "multi-source", "container", "container-group", "layer", "layer-group", "mixed"]);
    const resultPolicies = new Set<AgentTaskResultPolicy>(["single", "grouped-by-source", "grouped-by-container", "layer-variants"]);
    const confirmationPolicies = new Set<AgentTaskConfirmationPolicy>(["auto", "preview-3", "staged", "direct"]);
    if (!requestId || !projectId || !conversationId || !originalPrompt || !question || !kinds.has(source.kind as PendingAgentExecution["kind"]))
        return null;
    const rawScope = source.taskScope && typeof source.taskScope === "object" ? source.taskScope : null;
    if (!rawScope)
        return null;
    const normalizeTaskAssets = (items: unknown, role: AssetTaskRole, limit: number): TaskAssetReference[] => (Array.isArray(items) ? items : []).flatMap((item, index) => {
        if (!item || typeof item !== "object")
            return [];
        const candidate = item as Partial<TaskAssetReference>;
        const assetId = clean(candidate.assetId, 160);
        const path = clean(candidate.path, 1000);
        const relativePath = clean(candidate.relativePath, 1000).replace(/\\/g, "/");
        const assetUrl = clean(candidate.assetUrl, 4000);
        if (!assetId && !path && !relativePath && !assetUrl)
            return [];
        const containerSlot = Number.isInteger(Number(candidate.containerSlot)) && Number(candidate.containerSlot) >= 0
            ? Math.floor(Number(candidate.containerSlot))
            : Number.isInteger(Number(candidate.assetIndex)) && Number(candidate.assetIndex) >= 0
                ? Math.floor(Number(candidate.assetIndex))
                : undefined;
        const ownerAssetIndex = Number.isInteger(Number(candidate.ownerAssetIndex)) && Number(candidate.ownerAssetIndex) >= 0
            ? Math.floor(Number(candidate.ownerAssetIndex))
            : undefined;
        return [{
                bindingId: clean(candidate.bindingId, 520) || undefined,
                assetId: assetId || stableImageAssetId({ path, relativePath, assetUrl, originalName: candidate.name }, index + 1),
                occurrenceId: /^occ-[a-f0-9]{16,64}$/i.test(clean(candidate.occurrenceId, 80)) ? clean(candidate.occurrenceId, 80).toLowerCase() : undefined,
                importBatchId: clean(candidate.importBatchId, 160) || undefined,
                importRootId: clean(candidate.importRootId, 80) || undefined,
                sourceRelativePath: safeImageSourceRelativePath(candidate.sourceRelativePath),
                sourceRootLabel: clean(candidate.sourceRootLabel, 260) || undefined,
                sourceRootKind: candidate.sourceRootKind === "directory" ? "directory" as const : candidate.sourceRootKind === "file" ? "file" as const : undefined,
                displayCode: clean(candidate.displayCode, 40) || `${role === "source" ? "SRC" : "REF"}${index + 1}`,
                contentHash: /^[a-f0-9]{32,128}$/i.test(clean(candidate.contentHash, 128)) ? clean(candidate.contentHash, 128).toLowerCase() : undefined,
                role,
                name: clean(candidate.name, 260) || `${role === "source" ? "原图" : "参考图"} ${index + 1}`,
                assetIndex: containerSlot,
                containerSlot,
                ownerAssetIndex,
                ownerNodeId: clean(candidate.ownerNodeId, 160) || undefined,
                nodeId: clean(candidate.nodeId, 160) || undefined,
                containerId: clean(candidate.containerId, 160) || undefined,
                path: path || undefined,
                relativePath: relativePath || undefined,
                assetUrl: assetUrl || undefined,
                mimeType: clean(candidate.mimeType, 100) || undefined,
                purpose: clean(candidate.purpose, 400) || undefined,
                referenceRole: role === "reference" ? clean(candidate.referenceRole, 80) || undefined : undefined,
                feedbackScore: normalizeFeedbackScore(candidate.feedbackScore)
            }];
    }).slice(0, limit);
    const sourceAssets = normalizeTaskAssets(rawScope.sourceAssets, "source", 200);
    const referenceAssets = normalizeTaskAssets(rawScope.referenceAssets, "reference", 40);
    const contextAssets = normalizeTaskAssets(rawScope.contextAssets, "reference", 200);
    const explicitMentions: AgentTaskMention[] = (Array.isArray(rawScope.explicitMentions) ? rawScope.explicitMentions : []).flatMap((item) => {
        if (!item || typeof item !== "object")
            return [];
        const candidate = item as Partial<AgentTaskMention>;
        const kind = candidate.kind === "asset" || candidate.kind === "node" ? candidate.kind : null;
        const code = clean(candidate.code, 40);
        const nodeId = clean(candidate.nodeId, 160);
        if (!kind || !code || !nodeId)
            return [];
        const assetIndex = Number(candidate.assetIndex);
        return [{
                kind,
                code,
                nodeId,
                assetIndex: Number.isInteger(assetIndex) && assetIndex >= 0 ? Math.floor(assetIndex) : undefined,
                bindingId: clean(candidate.bindingId, 520) || undefined,
                assetId: clean(candidate.assetId, 160) || undefined,
                feedbackScore: normalizeFeedbackScore(candidate.feedbackScore),
                ambiguous: candidate.ambiguous === true || undefined
            } satisfies AgentTaskMention];
    }).slice(0, 64);
    const sourceNodeIds = [...new Set((Array.isArray(source.sourceNodeIds) ? source.sourceNodeIds : rawScope.sourceNodeIds ?? [])
            .map((id) => clean(id, 160)).filter(Boolean))].slice(0, 200);
    const taskOrigin = origins.has(source.taskOrigin as AgentTaskScope["origin"])
        ? source.taskOrigin as AgentTaskScope["origin"]
        : origins.has(rawScope.origin as AgentTaskScope["origin"])
            ? rawScope.origin as AgentTaskScope["origin"]
            : "chat";
    const cleanIds = (value: unknown, maximum = 200) => [...new Set((Array.isArray(value) ? value : []).map((id) => clean(id, 520)).filter(Boolean))].slice(0, maximum);
    const options = sanitizeAgentAskUserOptions(source.options);
    const requirementNodeId = clean(source.requirementNodeId, 160) || clean(rawScope.requirement?.nodeId, 160) || undefined;
    const requirementRevisionValue = Number(source.requirementRevision ?? rawScope.requirement?.revision);
    const requirementRevision = Number.isInteger(requirementRevisionValue) && requirementRevisionValue >= 1
        ? Math.floor(requirementRevisionValue)
        : undefined;
    const requirementInputNodeIds = cleanIds(source.requirementInputNodeIds, 240).map((id) => id.slice(0, 160));
    const requirementInputSignature = clean(source.requirementInputSignature, 240) || undefined;
    const requirementSourceSignature = clean(source.requirementSourceSignature, 240) || clean(rawScope.requirement?.sourceSignature, 240) || undefined;
    const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
        version: 2,
        origin: taskOrigin,
        scopeType: scopeTypes.has(rawScope.scopeType as AgentTaskScopeType) ? rawScope.scopeType as AgentTaskScopeType : sourceAssets.length > 1 ? "multi-source" : sourceAssets.length === 1 ? "single" : "none",
        canvasRevision: Math.max(0, Math.floor(Number(rawScope.canvasRevision ?? 0) || 0)),
        sourceNodeIds: [...new Set((Array.isArray(rawScope.sourceNodeIds) ? rawScope.sourceNodeIds : sourceNodeIds).map((id) => clean(id, 160)).filter(Boolean))].slice(0, 200),
        sourceContainerIds: cleanIds(rawScope.sourceContainerIds),
        referenceContainerIds: cleanIds(rawScope.referenceContainerIds, 40),
        sourceBindingIds: cleanIds(rawScope.sourceBindingIds?.length ? rawScope.sourceBindingIds : sourceAssets.map((asset) => asset.bindingId), 200),
        referenceBindingIds: cleanIds(rawScope.referenceBindingIds?.length ? rawScope.referenceBindingIds : referenceAssets.map((asset) => asset.bindingId), 40),
        sourceAssets,
        referenceAssets,
        contextNodeIds: cleanIds(rawScope.contextNodeIds, 200),
        contextAssets,
        explicitMentions,
        resultPolicy: resultPolicies.has(rawScope.resultPolicy as AgentTaskResultPolicy)
            ? rawScope.resultPolicy as AgentTaskResultPolicy
            : sourceAssets.length > 1 ? "grouped-by-source" : "single",
        confirmationPolicy: confirmationPolicies.has(rawScope.confirmationPolicy as AgentTaskConfirmationPolicy)
            ? rawScope.confirmationPolicy as AgentTaskConfirmationPolicy
            : "auto",
        requirement: requirementNodeId && requirementRevision
            ? { nodeId: requirementNodeId, revision: requirementRevision, sourceSignature: requirementSourceSignature }
            : undefined,
        sourceAssetCount: Math.max(sourceAssets.length, Math.floor(Number(rawScope.sourceAssetCount ?? sourceAssets.length) || sourceAssets.length)),
        referenceAssetCount: Math.max(referenceAssets.length, Math.floor(Number(rawScope.referenceAssetCount ?? referenceAssets.length) || referenceAssets.length)),
        truncated: rawScope.truncated === true
    };
    const taskScope: AgentTaskScope = { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) };
    return {
        version: 2,
        requestId,
        projectId,
        conversationId,
        originalPrompt,
        sourceNodeIds,
        focusedNodeId: clean(source.focusedNodeId, 160) || undefined,
        taskOrigin,
        taskScope,
        requirementNodeId,
        requirementRevision,
        requirementInputNodeIds: requirementInputNodeIds.length ? requirementInputNodeIds : undefined,
        requirementInputSignature,
        requirementSourceNodeId: clean(source.requirementSourceNodeId, 160) || undefined,
        requirementSourceSignature,
        kind: source.kind as PendingAgentExecution["kind"],
        title: clean(source.title, 240) || (source.kind === "source_images" ? "添加原图" : source.kind === "reference_images" ? "添加参考图" : "需要你确认"),
        question,
        detail: clean(source.detail, 4000) || undefined,
        suggestedAnswer: clean(source.suggestedAnswer, 4000) || undefined,
        options: options.length ? options : undefined,
        maxImages: Math.max(1, Math.min(40, Math.floor(Number(source.maxImages ?? 9) || 9))),
        createdAt: clean(source.createdAt, 80) || new Date().toISOString()
    };
}
function normalizeSelectedNodeId(nodes: WorkflowNode[], selectedNodeId: unknown) {
    const id = typeof selectedNodeId === "string" ? selectedNodeId : "";
    return id && nodes.some((node) => node.id === id) ? id : "";
}
function messageHasConversationContent(message: AgentMessage) {
    if (message.hidden)
        return false;
    return Boolean(String(message.content ?? "").trim() || message.toolTrace);
}
function conversationHasContent(messages: AgentMessage[]) {
    return validMessages(messages).some(messageHasConversationContent);
}
function createPersistedConversationSnapshot(messages: AgentMessage[], id: string, conversations: AgentConversation[], preserveRunning = false) {
    const existing = conversations.find((conversation) => conversation.id === id);
    const hasCurrentContent = conversationHasContent(messages);
    if (!hasCurrentContent && existing && conversationHasContent(existing.messages))
        return existing;
    const snapshot = createConversationSnapshot(messages, id, { preserveRunning });
    if (!existing)
        return snapshot;
    return {
        ...snapshot,
        title: hasCurrentContent ? snapshot.title : existing.title,
        createdAt: existing.createdAt
    };
}
function normalizeWorkflowSession(session?: WorkflowSession | Partial<StudioWorkflowSession>, options: {
    preserveRuntimeState?: boolean;
} = {}): StudioWorkflowSession {
    const preserveRuntimeState = options.preserveRuntimeState === true;
    const valid = validNodes(session?.nodes, preserveRuntimeState);
    const migratedNodes = preserveImageOriginsForNodes(valid);
    const conversations = validConversations(session?.conversations, { preserveRunning: preserveRuntimeState });
    const rootMessages = validMessages(session?.messages, { preserveRunning: preserveRuntimeState });
    reconcileWorkflowSessionAssetIds(migratedNodes, rootMessages, conversations);
    const inputSchemaVersion = Math.max(0, Math.floor(Number((session as Partial<StudioWorkflowSession> | undefined)?.schemaVersion ?? 0) || 0));
    const storedLayoutGroups = Array.isArray((session as Partial<StudioWorkflowSession> | undefined)?.layoutGroups)
        ? (session as Partial<StudioWorkflowSession>).layoutGroups ?? []
        : [];
    const legacyLayoutGroups = inputSchemaVersion < 3 && storedLayoutGroups.length
        ? sanitizeImageLayoutGroups(migratedNodes, storedLayoutGroups).groups
        : [];
    const specProjectedGroups = deriveImageLayoutGroupsFromContainerSpecs(migratedNodes);
    const migrationGroups = mergeLegacyImageLayoutGroups(migratedNodes, specProjectedGroups, legacyLayoutGroups);
    const canonicalNodes = synchronizeImageContainerSpecs(migratedNodes, migrationGroups);
    const normalizedLayoutGroups = sanitizeImageLayoutGroups(canonicalNodes, deriveImageLayoutGroupsFromContainerSpecs(canonicalNodes)).groups;
    const fittedNodes = fitImageLayoutHostNodes(canonicalNodes, normalizedLayoutGroups);
    const selectedNodeId = normalizeSelectedNodeId(fittedNodes, session?.selectedNodeId);
    const requestedConversationId = typeof session?.activeConversationId === "string" && session.activeConversationId.trim() ? session.activeConversationId.trim() : "";
    const exactConversation = requestedConversationId ? conversations.find((conversation) => conversation.id === requestedConversationId) : undefined;
    const fallbackConversation = !exactConversation && rootMessages.length === 0 ? conversations[0] : undefined;
    const activeConversation = exactConversation ?? fallbackConversation;
    const activeConversationId = (activeConversation?.id ?? requestedConversationId) || conversations[0]?.id || uid("conv");
    const messages = rootMessages.length > 0
        ? rootMessages
        : validMessages(activeConversation?.messages, { preserveRunning: preserveRuntimeState });
    const pendingAgentExecution = sanitizePendingAgentExecution((session as Partial<StudioWorkflowSession> | undefined)?.pendingAgentExecution);
    return {
        schemaVersion: 3,
        sessionRevision: Math.max(0, Math.floor(Number((session as Partial<StudioWorkflowSession> | undefined)?.sessionRevision ?? 0) || 0)),
        canvasRevision: Math.max(0, Math.floor(Number((session as Partial<StudioWorkflowSession> | undefined)?.canvasRevision ?? 0) || 0)),
        nodeSequence: Math.max(inferredNodeSequence(fittedNodes), Math.floor(Number((session as Partial<StudioWorkflowSession> | undefined)?.nodeSequence ?? 0) || 0)),
        layoutGroups: normalizedLayoutGroups,
        messages,
        conversations,
        activeConversationId,
        nodes: fittedNodes,
        selectedNodeId,
        pendingAgentExecution
    };
}
function emptyWritingSession(): StudioWritingSession {
    return {
        schemaVersion: 4,
        projectKind: "writing",
        sessionRevision: 0,
        messages: [],
        conversations: [],
        activeConversationId: "",
        pendingAgentExecution: null,
        artifacts: [],
        artifactEdges: [],
        artifactLayout: [],
        artifactViewport: { x: 40, y: 40, scale: 1 },
        selectedArtifactId: "",
        selectedParagraphId: ""
    };
}
function normalizeWritingRendererSession(session?: WorkflowSession & {
    sessionRevision?: number;
}): StudioWritingSession {
    const source = session && typeof session === "object" ? session : {};
    const artifacts = (Array.isArray(source.artifacts) ? source.artifacts : []).filter((artifact) => (artifact && typeof artifact === "object" && typeof artifact.id === "string" && typeof artifact.kind === "string"));
    const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
    const artifactEdges = (Array.isArray(source.artifactEdges) ? source.artifactEdges : []).filter((edge) => (edge && artifactIds.has(edge.sourceArtifactId) && artifactIds.has(edge.targetArtifactId)));
    const artifactLayout = (Array.isArray(source.artifactLayout) ? source.artifactLayout : []).filter((layout) => (layout && artifactIds.has(layout.artifactId)));
    const selectedArtifactId = artifactIds.has(String(source.selectedArtifactId || "")) ? String(source.selectedArtifactId) : "";
    const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId);
    const selectedParagraphId = selectedArtifact?.paragraphs.some((paragraph) => paragraph.id === source.selectedParagraphId)
        ? String(source.selectedParagraphId)
        : "";
    return {
        schemaVersion: 4,
        projectKind: "writing",
        sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || 0))),
        messages: validMessages(source.messages),
        conversations: validConversations(source.conversations),
        activeConversationId: typeof source.activeConversationId === "string" ? source.activeConversationId : "",
        pendingAgentExecution: source.pendingAgentExecution ?? null,
        artifacts,
        artifactEdges,
        artifactLayout,
        artifactViewport: {
            x: Number.isFinite(Number(source.artifactViewport?.x)) ? Math.max(-400000, Math.min(400000, Number(source.artifactViewport?.x))) : 40,
            y: Number.isFinite(Number(source.artifactViewport?.y)) ? Math.max(-400000, Math.min(400000, Number(source.artifactViewport?.y))) : 40,
            scale: Number.isFinite(Number(source.artifactViewport?.scale)) ? Math.max(0.2, Math.min(2.5, Number(source.artifactViewport?.scale))) : 1
        },
        selectedArtifactId,
        selectedParagraphId
    };
}
function emptyLineageRendererSession(projectKind: LineageProjectKind = "data"): StudioLineageSession {
    return {
        schemaVersion: 4,
        projectKind,
        lineageRevision: 1,
        sessionRevision: 0,
        messages: [],
        conversations: [],
        activeConversationId: "",
        pendingAgentExecution: null,
        lineageArtifacts: [],
        lineageEdges: [],
        lineageLayout: [],
        lineageViewport: { x: 40, y: 40, scale: 1 },
        selectedLineageArtifactId: ""
    };
}
let lineageRendererSessionModulePromise: Promise<typeof import("./lineage-renderer-session")> | null = null;
async function normalizeLineageRendererSession(session: (WorkflowSession & {
    sessionRevision?: number;
}) | undefined, projectKind: LineageProjectKind): Promise<StudioLineageSession> {
    if (!__AIEYRA_DEV__)
        return emptyLineageRendererSession(projectKind);
    lineageRendererSessionModulePromise ??= import("./lineage-renderer-session");
    const module = await lineageRendererSessionModulePromise;
    return module.normalizeLineageRendererSession(session, projectKind, sanitizePendingAgentExecution);
}
function buildWorkflowSessionSnapshot(session: StudioWorkflowSessionInput): StudioWorkflowSession {
    const migratedNodes = validNodes(session.nodes, true);
    const messages = validMessages(session.messages, { preserveRunning: true });
    const conversations = validConversations(session.conversations, { preserveRunning: true });
    reconcileWorkflowSessionAssetIds(migratedNodes, messages, conversations);
    const normalizedInputGroups = session.layoutGroups.length
        ? normalizeImageLayoutState({ nodes: migratedNodes, groups: session.layoutGroups }).groups
        : [];
    const nodes = synchronizeImageContainerSpecs(migratedNodes, normalizedInputGroups);
    const normalizedLayoutGroups = sanitizeImageLayoutGroups(nodes, deriveImageLayoutGroupsFromContainerSpecs(nodes)).groups;
    const selectedNodeId = normalizeSelectedNodeId(nodes, session.selectedNodeId);
    const activeConversationId = session.activeConversationId || conversations[0]?.id || uid("conv");
    const shouldRecordActiveConversation = conversationHasContent(messages) || conversations.length > 0;
    const nextConversations = shouldRecordActiveConversation
        ? upsertConversation(conversations, createPersistedConversationSnapshot(messages, activeConversationId, conversations, true))
        : conversations;
    return {
        schemaVersion: 3,
        sessionRevision: Math.max(0, Math.floor(Number(session.sessionRevision ?? 0) || 0)),
        canvasRevision: Math.max(0, Math.floor(Number(session.canvasRevision ?? 0) || 0)),
        nodeSequence: Math.max(inferredNodeSequence(nodes), Math.floor(Number(session.nodeSequence ?? 0) || 0)),
        layoutGroups: normalizedLayoutGroups,
        messages,
        conversations: nextConversations,
        activeConversationId,
        nodes,
        selectedNodeId,
        pendingAgentExecution: sanitizePendingAgentExecution(session.pendingAgentExecution)
    };
}
async function loadSettingsFromStore(): Promise<AppSettings> {
    if (window.aieyraConfig) {
        const result = await window.aieyraConfig.loadSettings();
        if (!result.ok)
            throw new Error(result.error || "本地设置读取失败，原资料已保留。");
        return mergeSettings(result.settings);
    }
    return mergeSettings(readJson<Partial<AppSettings> & Record<string, unknown>>(STORAGE_SETTINGS, defaultSettings));
}
async function loadSessionFromStore(projectId?: string): Promise<WorkflowSession & {
    sessionRevision?: number;
}> {
    if (window.aieyraConfig) {
        const result = await window.aieyraConfig.loadSession(projectId ? { projectId } : undefined);
        if (!result.ok)
            throw new Error(result.error || "画布读取失败，原资料已保留。");
        return result.session ?? {};
    }
    const fallback = readJson<WorkflowSession & Partial<StudioWorkflowSession>>(STORAGE_SESSION, {});
    return fallback;
}
async function saveSessionToStore(session: StudioWorkflowSession & {
    projectId?: string;
    allowEmptyOverwrite?: boolean;
}) {
    if (window.aieyraConfig) {
        return window.aieyraConfig.saveSession(session);
    }
    const { allowEmptyOverwrite: _allowEmptyOverwrite, ...persistedSession } = session;
    writeJson(STORAGE_SESSION, persistedSession);
    return { ok: true, appliedRevision: session.sessionRevision, skippedStale: false };
}
function applyTheme(choice: ThemeChoice) {
    const resolved = choice === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
        : choice;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeChoice = choice;
    document.documentElement.classList.toggle("theme-dark", resolved === "dark");
    document.documentElement.classList.toggle("theme-light", resolved === "light");
}
function nodeLabel(status: NodeStatus) {
    return {
        queued: "待重做",
        working: "执行中",
        review: "可介入",
        done: "已完成"
    }[status];
}
function nodeStateLabel(node: WorkflowNode) {
    const containerKind = imageContainerKindForNode(node);
    if (containerKind === "folder")
        return "文件夹容器";
    if (containerKind === "container-group")
        return "容器组";
    if (containerKind === "manual")
        return "图片容器";
    if (node.imageCollection) {
        const progress = node.imageProgress;
        const failed = Math.max(0, Number(progress?.failed ?? progress?.failedSlots?.length ?? 0) || 0);
        if (failed && (node.assets?.length ?? 0) > 0)
            return "部分失败";
        if (node.imageState === "error")
            return (node.assets?.length ?? 0) > 0 ? "部分失败" : "失败";
        if (progress?.stopped)
            return (node.assets?.length ?? 0) > 0 ? "已停止" : "已暂停";
        return node.imageCollection.kind === "series" ? "连续系列" : "图片组";
    }
    if (node.layerComposition) {
        const group = `#${String(node.layerComposition.groupNumber ?? 0).padStart(3, "0")}`;
        if (node.imageState === "error")
            return `${group} · 需检查`;
        return `图层组 ${group}`;
    }
    if (node.type === "agent") {
        if (node.agentInitState === "checking")
            return "检查中";
        if (node.agentInitState === "ready")
            return "已就绪";
        if (node.agentInitState === "error")
            return "连接异常";
        return "等待初始化";
    }
    if (node.type === "image") {
        const progress = node.imageProgress;
        const failed = Math.max(0, Number(progress?.failed ?? progress?.failedSlots?.length ?? 0) || 0);
        if (failed && (node.assets?.length ?? 0) > 0)
            return "部分失败";
        if (node.imageState === "error")
            return (node.assets?.length ?? 0) > 0 ? "部分失败" : "失败";
        if (progress?.stopped)
            return (node.assets?.length ?? 0) > 0 ? "已停止" : "已暂停";
        const total = Math.max(node.imageParams?.count ?? 0, progress?.total ?? 0, node.assets?.length ?? 0, 1);
        return total > 1 ? "多图成果" : "单图";
    }
    if (node.type === "intent")
        return "提示词";
    if (node.type === "requirement")
        return !node.requirement?.text.trim() ? "待填写" : "可复用";
    return nodeLabel(node.status);
}
function nodeImageEmptyLabel(node: WorkflowNode) {
    if (node.layerComposition && node.imageState === "error")
        return "合成失败";
    if (node.layerComposition)
        return "分层 PNG";
    if (node.imageState === "error")
        return "生成失败";
    return "图片成果";
}
function nodeImageProgressText(node: WorkflowNode) {
    if (node.type !== "image")
        return "";
    const progress = node.imageProgress;
    if (!progress)
        return "";
    const failed = Math.max(0, Number(progress.failed ?? progress.failedSlots?.length ?? 0) || 0);
    if (!failed && !progress.stopped && node.imageState !== "error")
        return "";
    const parts = [`${progress.completed}/${progress.total}`];
    if (failed)
        parts.push(`失败 ${failed}`);
    if (progress.stopped)
        parts.push("已停止");
    return parts.join(" · ");
}
function pendingImageTileCount(node: WorkflowNode, generating: boolean) {
    if (node.type !== "image" || !generating)
        return 0;
    const progress = node.imageProgress;
    const total = Math.max(progress?.total ?? node.imageParams?.count ?? 1, 1);
    const completed = Math.max(node.assets?.length ?? progress?.completed ?? 0, 0);
    const failed = Math.max(0, Number(progress?.failed ?? progress?.failedSlots?.length ?? 0) || 0);
    return clamp(total - completed - failed, 0, total);
}
function nodeSequenceFromCode(value: unknown) {
    const code = String(value || "").trim().toUpperCase();
    if (/^[A-Z]$/.test(code))
        return code.charCodeAt(0) - 64;
    const numbered = code.match(/^N(\d+)$/);
    return numbered ? Math.max(0, Number(numbered[1]) || 0) : 0;
}
function inferredNodeSequence(nodes: WorkflowNode[] = []) {
    return nodes.reduce((highest, node) => Math.max(highest, nodeSequenceFromCode(node.displayCode), nodeSequenceFromCode(node.id)), 0);
}
function nodeCodeForSequence(sequence: number) {
    const normalized = Math.max(1, Math.floor(Number(sequence) || 1));
    return normalized <= 26 ? String.fromCharCode(64 + normalized) : `N${normalized}`;
}
function nextNodeId(nodes: WorkflowNode[], minimumSequence = 0) {
    const used = new Set(nodes.flatMap((node) => [node.id, node.displayCode]).map((value) => String(value || "").trim()).filter(Boolean));
    let sequence = Math.max(Math.floor(Number(minimumSequence) || 0), inferredNodeSequence(nodes));
    let id = "";
    do {
        sequence += 1;
        id = nodeCodeForSequence(sequence);
    } while (used.has(id));
    return id;
}
function nodeDisplayCode(node: WorkflowNode) {
    return String(node.displayCode || node.id || "图").trim() || "图";
}
function imageAssetSequence(assets: ImageAsset[] = [], displayPrefix = "I") {
    const prefix = String(displayPrefix || "I").trim() || "I";
    return assets.reduce((highest, asset) => {
        const code = String(asset.displayCode || "").trim();
        if (!code.startsWith(prefix))
            return highest;
        const value = code.slice(prefix.length);
        return Math.max(highest, /^\d+$/.test(value) ? Number(value) : 0);
    }, 0);
}
function imageAssetsWithIdentity(assets: ImageAsset[] = [], displayPrefix = "I", minimumSequence = 0) {
    const prefix = String(displayPrefix || "I").trim() || "I";
    const existingCodes = assets.map((asset) => String(asset.displayCode || "").trim()).filter(Boolean);
    const reservedCodes = new Set(existingCodes);
    const claimedCodes = new Set<string>();
    let suffix = Math.max(Math.floor(Number(minimumSequence) || 0), imageAssetSequence(assets, prefix));
    return assets.map((asset, index) => {
        let displayCode = String(asset.displayCode || "").trim();
        if (!displayCode || claimedCodes.has(displayCode)) {
            do {
                suffix += 1;
                displayCode = `${prefix}${suffix}`;
            } while (reservedCodes.has(displayCode) || claimedCodes.has(displayCode));
        }
        claimedCodes.add(displayCode);
        return {
            ...asset,
            assetId: stableImageAssetId(asset, index + 1),
            displayCode,
            index: index + 1
        };
    });
}
function taskAssetReferencesForNode(node: WorkflowNode, role: AssetTaskRole = "source", includeUnassigned = role === "source", respectProjectedRoles = true): TaskAssetReference[] {
    const code = nodeDisplayCode(node);
    const containerSpec = imageContainerSpecForNode(node);
    return imageAssetsWithIdentity(node.assets ?? [], code)
        .map((asset, assetIndex) => {
        const binding = containerSpec?.memberBindings[assetIndex];
        return { asset, assetIndex, binding };
    })
        .filter(({ asset, binding }) => {
        if (!respectProjectedRoles)
            return true;
        const effectiveRole = binding?.role ?? asset.taskRole ?? (node.imageContainerRole === "source" || node.imageContainerRole === "reference" ? node.imageContainerRole : undefined);
        return effectiveRole ? effectiveRole === role : includeUnassigned;
    })
        .map(({ asset, assetIndex, binding }) => ({
        bindingId: binding?.bindingId || `binding:${node.id}:${node.id}:${stableImageOccurrenceId(asset, node.id, assetIndex)}`,
        assetId: asset.assetId || stableImageAssetId(asset, assetIndex + 1),
        occurrenceId: binding?.occurrenceId || stableImageOccurrenceId(asset, node.id, assetIndex),
        importBatchId: asset.importBatchId,
        importRootId: asset.importRootId,
        sourceRelativePath: asset.sourceRelativePath,
        sourceRootLabel: asset.sourceRootLabel,
        sourceRootKind: asset.sourceRootKind,
        displayCode: asset.displayCode || `${code}${assetIndex + 1}`,
        contentHash: asset.contentHash,
        role,
        name: asset.title || asset.originalName || imageAssetName(asset) || `${code}${assetIndex + 1}`,
        assetIndex,
        containerSlot: assetIndex,
        ownerAssetIndex: binding?.assetIndex ?? assetIndex,
        ownerNodeId: binding?.nodeId || node.id,
        nodeId: node.id,
        containerId: binding?.containerNodeId || (nodeUsesImageContainer(node) ? node.id : undefined),
        path: asset.path,
        relativePath: asset.relativePath,
        assetUrl: asset.assetUrl || asset.url,
        mimeType: asset.path ? mimeTypeFromPath(asset.path) : undefined,
        purpose: asset.note || node.note,
        feedbackScore: normalizeFeedbackScore(asset.feedbackScore !== undefined ? asset.feedbackScore : node.feedbackScore)
    }));
}
function legacyAgentTaskScopeForRequest(sourceNodes: WorkflowNode[], references: ReferenceImage[], referenceContainer?: WorkflowNode | null, origin: AgentTaskScope["origin"] = "chat", canvasRevision = 0, requirementNode?: WorkflowNode | null, requirementSourceSignature?: string, explicitNodeRoles: Readonly<Record<string, AssetTaskRole>> = {}, options: {
    contextNodeIds?: string[];
    contextAssets?: TaskAssetReference[];
    explicitMentions?: AgentTaskMention[];
    inputPurposes?: Readonly<Record<string, string>>;
    completeNodeIds?: string[];
} = {}): AgentTaskScope {
    const eligibleImageNodes = sourceNodes.filter((node) => node.type === "image");
    const explicitRoleFor = (node: WorkflowNode) => explicitNodeRoles[node.id];
    const completeNodeIds = new Set((options.completeNodeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    const resolvedMentions = (options.explicitMentions || []).filter((mention) => mention.ambiguous !== true);
    const mentionedNodeIds = new Set(resolvedMentions
        .filter((mention) => mention.kind === "node")
        .map((mention) => mention.nodeId));
    const assetMentionsByNode = new Map<string, AgentTaskMention[]>();
    for (const mention of resolvedMentions) {
        if (mention.kind !== "asset")
            continue;
        const mentions = assetMentionsByNode.get(mention.nodeId) || [];
        mentions.push(mention);
        assetMentionsByNode.set(mention.nodeId, mentions);
    }
    const sourceAssetsForNode = (node: WorkflowNode) => {
        const assets = taskAssetReferencesForNode(node, "source", true, explicitRoleFor(node) === undefined);
        const withPurpose = (items: TaskAssetReference[]) => items.map((asset) => ({
            ...asset,
            purpose: options.inputPurposes?.[node.id] || options.inputPurposes?.[asset.ownerNodeId || ""] || asset.purpose,
        }));
        if (mentionedNodeIds.has(node.id) || completeNodeIds.has(node.id))
            return withPurpose(assets);
        const mentions = assetMentionsByNode.get(node.id);
        if (!mentions?.length)
            return withPurpose(assets);
        return withPurpose(assets.filter((asset) => mentions.some((mention) => {
            if (mention.bindingId)
                return asset.bindingId === mention.bindingId;
            if (Number.isInteger(mention.assetIndex))
                return Number(asset.assetIndex) === Number(mention.assetIndex);
            return Boolean(mention.assetId && asset.assetId === mention.assetId);
        })));
    };
    const referenceRoleNodes = eligibleImageNodes.filter((node) => explicitRoleFor(node) === "reference" || (!explicitRoleFor(node) && taskAssetReferencesForNode(node, "reference", false).length > 0));
    const eligibleSourceNodes = eligibleImageNodes.filter((node) => explicitRoleFor(node) === "source" || (!explicitRoleFor(node) && taskAssetReferencesForNode(node, "source", true).length > 0));
    const sourceNodesForScope = eligibleSourceNodes;
    const sourceNodeIds = [...new Set(sourceNodesForScope.map((node) => node.id).filter(Boolean))];
    const taskAssetIdentity = (item: TaskAssetReference, index = 0) => item.bindingId
        ? `binding-id:${item.bindingId}`
        : item.occurrenceId
            ? `occurrence:${item.occurrenceId}`
            : item.nodeId && Number.isInteger(item.assetIndex)
                ? `binding:${item.role}:${item.nodeId}:${item.assetIndex}`
                : item.contentHash
                    ? `content:${item.contentHash}`
                    : item.relativePath
                        ? `relative:${item.relativePath.replace(/\\/g, "/").toLowerCase()}`
                        : item.path
                            ? `path:${item.path.replace(/\\/g, "/").toLowerCase()}`
                            : item.assetId
                                ? `id:${item.assetId}`
                                : item.assetUrl
                                    ? `url:${item.assetUrl}`
                                    : `slot:${item.nodeId || item.containerId || "asset"}:${item.assetIndex ?? index}`;
    const uniqueTaskAssets = (items: TaskAssetReference[]) => {
        const seen = new Set<string>();
        return items.filter((item, index) => {
            const key = taskAssetIdentity(item, index);
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    };
    const allSourceAssets = uniqueTaskAssets(sourceNodesForScope.flatMap(sourceAssetsForNode));
    const sourceAssetCount = allSourceAssets.length;
    const sourceAssets = allSourceAssets.slice(0, 200);
    const stagedReferenceAssets = (referenceContainer ? taskAssetReferencesForNode(referenceContainer, "reference", true) : references).map((reference, index): TaskAssetReference => {
        const stagedMetadata = references.find((candidate) => Boolean(candidate.occurrenceId && reference.occurrenceId && candidate.occurrenceId === reference.occurrenceId) ||
            Boolean(candidate.contentHash && reference.contentHash && candidate.contentHash === reference.contentHash) ||
            Boolean(candidate.assetId && reference.assetId && candidate.assetId === reference.assetId) ||
            Boolean(candidate.relativePath && reference.relativePath && candidate.relativePath === reference.relativePath) ||
            Boolean(candidate.path && reference.path && candidate.path === reference.path)) ?? references[index];
        const requestedRole = String(stagedMetadata?.role || "").trim();
        const referenceRole = requestedRole && !["source", "reference", "edit_target"].includes(requestedRole.toLowerCase())
            ? requestedRole
            : undefined;
        return {
            bindingId: "bindingId" in reference && reference.bindingId
                ? reference.bindingId
                : `binding:${referenceContainer?.id || "chat-reference"}:${referenceContainer?.id || "attachment"}:${reference.occurrenceId || index}:${reference.assetId || index + 1}`,
            assetId: reference.assetId || stableImageAssetId({ contentHash: reference.contentHash, path: reference.path, relativePath: reference.relativePath, assetUrl: reference.assetUrl, originalName: reference.name }, index + 1),
            occurrenceId: reference.occurrenceId,
            importBatchId: reference.importBatchId,
            importRootId: reference.importRootId,
            sourceRelativePath: reference.sourceRelativePath,
            sourceRootLabel: reference.sourceRootLabel,
            sourceRootKind: reference.sourceRootKind,
            displayCode: reference.displayCode || `REF${index + 1}`,
            contentHash: reference.contentHash,
            role: "reference",
            name: reference.name || `参考图 ${index + 1}`,
            assetIndex: "assetIndex" in reference ? reference.assetIndex : index,
            containerSlot: "containerSlot" in reference ? reference.containerSlot : ("assetIndex" in reference ? reference.assetIndex : index),
            ownerAssetIndex: "ownerAssetIndex" in reference ? reference.ownerAssetIndex : ("assetIndex" in reference ? reference.assetIndex : index),
            ownerNodeId: "ownerNodeId" in reference ? reference.ownerNodeId : referenceContainer?.id,
            nodeId: referenceContainer?.id || ("nodeId" in reference ? reference.nodeId : undefined),
            containerId: referenceContainer?.id,
            path: reference.path,
            relativePath: reference.relativePath,
            assetUrl: reference.assetUrl,
            mimeType: reference.mimeType || mimeTypeFromPath(reference.path),
            purpose: stagedMetadata?.purpose,
            referenceRole,
            feedbackScore: normalizeFeedbackScore(reference.feedbackScore)
        };
    });
    const referenceNodeAssets = referenceRoleNodes.flatMap((node) => {
        const mentions = assetMentionsByNode.get(node.id);
        const assets = taskAssetReferencesForNode(node, "reference", true, explicitRoleFor(node) === undefined)
            .filter((asset) => completeNodeIds.has(node.id) || !mentions?.length || mentions.some((mention) => {
            if (mention.bindingId)
                return asset.bindingId === mention.bindingId;
            if (Number.isInteger(mention.assetIndex))
                return Number(asset.assetIndex) === Number(mention.assetIndex);
            return Boolean(mention.assetId && asset.assetId === mention.assetId);
        }));
        return assets.map((asset) => ({
            ...asset,
            purpose: options.inputPurposes?.[node.id] || options.inputPurposes?.[asset.ownerNodeId || ""] || asset.purpose,
        }));
    });
    const allReferenceAssets = uniqueTaskAssets([...stagedReferenceAssets, ...referenceNodeAssets]);
    const referenceAssets = allReferenceAssets.slice(0, 40);
    const sourceNodeIdSet = new Set(sourceNodeIds);
    const contextNodeIds = [...new Set([
            ...(options.contextNodeIds || [])
        ].map((id) => String(id || "").trim()).filter((id) => Boolean(id) && !sourceNodeIdSet.has(id)))].slice(0, 200);
    const sourceAssetIdentities = new Set(allSourceAssets.map((asset, index) => taskAssetIdentity(asset, index)));
    const contextAssets = uniqueTaskAssets([
        ...(options.contextAssets || [])
    ]).filter((asset, index) => !sourceAssetIdentities.has(taskAssetIdentity(asset, index))).slice(0, 200);
    const sourceContainerIds = [...new Set([
            ...sourceNodesForScope.filter((node) => nodeUsesImageContainer(node)).map((node) => node.id),
            ...sourceAssets.map((asset) => asset.containerId || "")
        ].filter(Boolean))];
    const referenceContainerIds = [...new Set([
            ...(referenceContainer ? [referenceContainer.id] : []),
            ...referenceRoleNodes.filter((node) => nodeUsesImageContainer(node)).map((node) => node.id),
            ...referenceAssets.map((asset) => asset.containerId || "")
        ].filter(Boolean))];
    const layerGroupIds = new Set(sourceNodesForScope.map((node) => node.layerGroup?.id || "").filter(Boolean));
    const hasLayer = sourceNodesForScope.some((node) => Boolean(node.layerGroup || node.layerComposition));
    const containerKinds = sourceNodesForScope.map((node) => imageContainerKindForNode(node)).filter(Boolean);
    const hasContainerGroup = containerKinds.includes("container-group");
    const hasContainer = containerKinds.length > 0;
    const scopeType: AgentTaskScopeType = sourceNodesForScope.length === 0
        ? "none"
        : hasLayer && hasContainer
            ? "mixed"
            : hasLayer
                ? sourceNodesForScope.length > 1 && layerGroupIds.size === 1 ? "layer-group" : "layer"
                : hasContainerGroup
                    ? "container-group"
                    : hasContainer
                        ? "container"
                        : allSourceAssets.length > 1 || sourceNodesForScope.length > 1
                            ? "multi-source"
                            : "single";
    const resultPolicy: AgentTaskResultPolicy = scopeType === "layer" || scopeType === "layer-group"
        ? "layer-variants"
        : scopeType === "container-group"
            ? "grouped-by-container"
            : allSourceAssets.length > 1 || sourceNodesForScope.length > 1
                ? "grouped-by-source"
                : "single";
    const confirmationPolicy: AgentTaskConfirmationPolicy = scopeType === "container-group"
        ? "preview-3"
        : allSourceAssets.length > 10
            ? "staged"
            : "auto";
    const requirement = requirementNode?.type === "requirement" && requirementNode.requirement
        ? {
            nodeId: requirementNode.id,
            revision: requirementNode.requirement.revision,
            sourceSignature: requirementSourceSignature
        }
        : undefined;
    const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
        version: 2,
        origin,
        scopeType,
        canvasRevision: Math.max(0, Math.floor(Number(canvasRevision) || 0)),
        sourceNodeIds,
        sourceContainerIds,
        referenceContainerIds,
        sourceBindingIds: [...new Set(sourceAssets.map((asset) => asset.bindingId || "").filter(Boolean))],
        referenceBindingIds: [...new Set(referenceAssets.map((asset) => asset.bindingId || "").filter(Boolean))],
        sourceAssets,
        referenceAssets,
        contextNodeIds,
        contextAssets,
        explicitMentions: (options.explicitMentions || []).map((mention) => ({
            ...mention,
            feedbackScore: normalizeFeedbackScore(mention.feedbackScore)
        })),
        resultPolicy,
        confirmationPolicy,
        requirement,
        sourceAssetCount,
        referenceAssetCount: allReferenceAssets.length,
        truncated: sourceAssetCount > sourceAssets.length || allReferenceAssets.length > referenceAssets.length
    };
    return { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) };
}
let agentTaskScopeRuntimeModulePromise: Promise<typeof import("./agent-task-scope-runtime")> | null = null;
async function agentTaskScopeForRequest(sourceNodes: WorkflowNode[], references: ReferenceImage[], referenceContainer?: WorkflowNode | null, origin: AgentTaskScope["origin"] = "chat", canvasRevision = 0, requirementNode?: WorkflowNode | null, requirementSourceSignature?: string, explicitNodeRoles: Readonly<Record<string, AssetTaskRole>> = {}, options: {
    contextNodeIds?: string[];
    contextAssets?: TaskAssetReference[];
    explicitMentions?: AgentTaskMention[];
    inputPurposes?: Readonly<Record<string, string>>;
    completeNodeIds?: string[];
    attachments?: ResolvedTaskImageAttachments;
} = {}): Promise<AgentTaskScope> {
    agentTaskScopeRuntimeModulePromise ??= import("./agent-task-scope-runtime");
    const runtime = await agentTaskScopeRuntimeModulePromise;
    return runtime.buildAgentTaskScope({
        sourceNodes,
        references,
        referenceContainer,
        origin,
        canvasRevision,
        requirementNode,
        requirementSourceSignature,
        explicitNodeRoles,
        options,
        readAssets: taskAssetReferencesForNode
    });
}
function firstPromptLine(prompt: string) {
    return String(prompt || "").split(/\n\s*\n|model:|size:|quality:|count:|returned:|cost:/i)[0]?.trim() || "";
}
function nodeWorkName(node: WorkflowNode) {
    if (node.type === "agent")
        return node.title?.trim() || "旧 Agent";
    if (node.type === "intent")
        return node.title?.trim() || "提示词";
    if (node.type === "requirement")
        return node.title?.trim() || "图片处理需求";
    if (node.layerComposition)
        return node.title?.trim() || node.layerComposition.title || "图层合成";
    const containerKind = imageContainerKindForNode(node);
    if (containerKind === "folder")
        return node.title?.trim() || "文件夹容器";
    if (containerKind === "container-group")
        return node.title?.trim() || "容器组";
    if (containerKind === "manual")
        return node.title?.trim() || "图片容器";
    if (node.imageCollection)
        return node.title?.trim() || (node.imageCollection.kind === "series" ? "连续系列" : "批量图片组");
    if (node.type === "image")
        return node.title?.trim() || "生成图片";
    if (node.type === "video")
        return node.title?.trim() || "视频";
    return {
        intent: "提示词",
        requirement: "图片处理需求",
        review: "评审成果",
        export: "导出成果",
        branch: "版本成果",
        post: "处理成果",
        agent: "旧 Agent"
    }[node.type] ?? node.title;
}
type AgentMentionImageOption = {
    kind?: "document";
    id: string;
    code: string;
    nodeId: string;
    assetIndex: number;
    nodeCode: string;
    nodeTitle: string;
    name: string;
    previewSrc: string;
    width?: number;
    height?: number;
};
function agentMentionImageOptions(nodes: WorkflowNode[]) {
    return nodes.flatMap((node): AgentMentionImageOption[] => {
        if (node.type !== "image")
            return [];
        const nodeCode = nodeDisplayCode(node);
        const nodeTitle = nodeWorkName(node);
        return imageAssetsWithIdentity(node.assets ?? [], nodeCode)
            .map((asset, assetIndex) => ({ asset, assetIndex }))
            .filter(({ asset }) => Boolean(asset.path || imageAssetSrc(asset)))
            .map(({ asset, assetIndex }) => ({
            id: `${node.id}:${asset.occurrenceId || asset.assetId || assetIndex}:${assetIndex}`,
            code: asset.displayCode || `${nodeCode}${assetIndex + 1}`,
            nodeId: node.id,
            assetIndex,
            nodeCode,
            nodeTitle,
            name: asset.title || imageAssetName(asset),
            previewSrc: imageAssetThumbnailSrc(asset, 256),
            width: Number(asset.width || 0) > 0 ? Number(asset.width) : undefined,
            height: Number(asset.height || 0) > 0 ? Number(asset.height) : undefined
        }));
    });
}
function canvasReferencePickerCandidates(nodes: WorkflowNode[], role: AssetTaskRole, preferredNodeIds: string[] = []): ReferencePickerCanvasCandidate[] {
    const preferred = new Map(preferredNodeIds.map((id, index) => [id, index]));
    return nodes
        .flatMap((node) => taskAssetReferencesForNode(node, role, true, false).map((asset, assetIndex) => ({
        id: asset.bindingId || `${node.id}:${asset.occurrenceId || asset.assetId}:${assetIndex}`,
        nodeId: node.id,
        displayCode: asset.displayCode,
        name: asset.name,
        previewSrc: imageAssetThumbnailSrc({
            type: "file",
            path: asset.path,
            relativePath: asset.relativePath,
            assetUrl: asset.assetUrl,
            originalName: asset.name,
        }, 256),
        asset: { ...asset, role },
        preferredOrder: preferred.get(node.id) ?? Number.MAX_SAFE_INTEGER,
    })))
        .filter((candidate) => Boolean(candidate.asset.path || candidate.asset.relativePath || candidate.asset.assetUrl))
        .sort((left, right) => left.preferredOrder - right.preferredOrder || left.displayCode.localeCompare(right.displayCode, "en"))
        .slice(0, 80)
        .map(({ preferredOrder: _preferredOrder, ...candidate }) => candidate);
}
function nodeErrorMessage(node: WorkflowNode) {
    if (node.imageError)
        return friendlyImageError(node.imageError);
    const match = String(node.prompt || "").match(/\nerror:\s*([\s\S]+)$/i);
    return match ? friendlyImageError(match[1]) : "";
}
function collectDescendantIds(nodes: WorkflowNode[], rootId: string) {
    const descendants = new Set<string>();
    const children = new Map<string, string[]>();
    for (const node of nodes) {
        if (!node.parentId)
            continue;
        const siblings = children.get(node.parentId) || [];
        siblings.push(node.id);
        children.set(node.parentId, siblings);
    }
    const pending = [rootId];
    for (let index = 0; index < pending.length; index++) {
        for (const id of children.get(pending[index]) || []) {
            if (id === rootId || descendants.has(id))
                continue;
            descendants.add(id);
            pending.push(id);
        }
    }
    return descendants;
}
function workflowNodeBounds(node: WorkflowNode) {
    if (hasSingleImageFrame(node)) {
        return { x: node.x, y: node.y, ...singleImageFrameSize(imageTaskSizeForNode(node), node.width ?? NODE_W, node.assets ?? []) };
    }
    if (node.type === "image" && !node.imageContainer && !node.imageCollection && !node.layerComposition && !node.layerGroup) {
        const dimensions = clampImageNodeDimensions(imageTaskSizeForNode(node), imageNodeSlotCount(node), node.width, node.height, node.assets ?? []);
        return { x: node.x, y: node.y, ...dimensions };
    }
    const storedWidth = Number(node.width);
    const storedHeight = Number(node.height);
    const minimum = minimumNodeSize(node);
    if (storedWidth >= Number(minimum.width ?? NODE_RESIZE_MIN_W) && storedHeight >= Number(minimum.height ?? NODE_RESIZE_MIN_H)) {
        return { x: node.x, y: node.y, width: storedWidth, height: storedHeight };
    }
    return {
        x: node.x,
        y: node.y,
        width: Math.max(node.width ?? NODE_W, minimum.width ?? NODE_RESIZE_MIN_W),
        height: Math.max(node.height ?? NODE_RESIZE_MIN_H, minimum.height ?? NODE_RESIZE_MIN_H)
    };
}
function closestNodeIdAt(nodes: WorkflowNode[], worldX: number, worldY: number, excludeId?: string) {
    let best: {
        id: string;
        distance: number;
    } | null = null;
    for (const node of nodes) {
        if (node.id === excludeId)
            continue;
        const bounds = workflowNodeBounds(node);
        const dx = Math.max(bounds.x - worldX, 0, worldX - (bounds.x + bounds.width));
        const dy = Math.max(bounds.y - worldY, 0, worldY - (bounds.y + bounds.height));
        const distance = Math.hypot(dx, dy);
        if (distance < 180 && (!best || distance < best.distance))
            best = { id: node.id, distance };
    }
    return best?.id ?? "";
}
function rectOverlapArea(first: {
    x: number;
    y: number;
    width: number;
    height: number;
}, second: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
    const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
    return width * height;
}
function workflowNodeCollisionMeasure(bounds: Array<{ x: number; y: number; width: number; height: number }>) {
    type Box = typeof bounds[number];
    type Entry = { box: Box; index: number };
    type Branch = { left: number; top: number; right: number; bottom: number; entries?: Entry[]; children?: [Branch, Branch] };
    const linearMeasure = (box: Box) => bounds.reduce((total, item) => total + rectOverlapArea(box, item), 0);
    if (bounds.length < 64 || bounds.some(box => ![box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height].every(Number.isFinite) || box.width < 0 || box.height < 0))
        return linearMeasure;
    const build = (entries: Entry[]): Branch => {
        const branch: Branch = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
        for (const { box } of entries) {
            branch.left = Math.min(branch.left, box.x);
            branch.top = Math.min(branch.top, box.y);
            branch.right = Math.max(branch.right, box.x + box.width);
            branch.bottom = Math.max(branch.bottom, box.y + box.height);
        }
        if (entries.length <= 12) {
            branch.entries = entries;
        }
        else {
            const horizontal = branch.right - branch.left >= branch.bottom - branch.top;
            entries.sort((first, second) => horizontal ? first.box.x - second.box.x : first.box.y - second.box.y);
            const middle = Math.floor(entries.length / 2);
            branch.children = [build(entries.slice(0, middle)), build(entries.slice(middle))];
        }
        return branch;
    };
    const root = build(bounds.map((box, index) => ({ box, index })));
    return (box: Box) => {
        const right = box.x + box.width;
        const bottom = box.y + box.height;
        const overlaps: Entry[] = [];
        const visit = (branch: Branch) => {
            if (right <= branch.left || box.x >= branch.right || bottom <= branch.top || box.y >= branch.bottom)
                return;
            if (branch.entries) {
                for (const entry of branch.entries) {
                    const item = entry.box;
                    if (right > item.x && box.x < item.x + item.width && bottom > item.y && box.y < item.y + item.height)
                        overlaps.push(entry);
                }
            }
            else if (branch.children) {
                visit(branch.children[0]);
                visit(branch.children[1]);
            }
        };
        visit(root);
        // Preserve accumulation order and therefore the original placement score.
        overlaps.sort((first, second) => first.index - second.index);
        return overlaps.reduce((total, entry) => total + rectOverlapArea(box, entry.box), 0);
    };
}
function findOpenWorkflowNodePosition(nodes: WorkflowNode[], options: {
    parent?: WorkflowNode;
    width: number;
    height: number;
    preferredX: number;
    preferredY: number;
    viewportCenter?: {
        x: number;
        y: number;
    };
    cascadeIndex?: number;
}) {
    const gap = 80;
    const width = Math.max(options.width, NODE_RESIZE_MIN_W);
    const height = Math.max(options.height, NODE_RESIZE_MIN_H);
    const bounds = nodes.map(workflowNodeBounds);
    const inflated = bounds.map((box) => ({
        x: box.x - gap / 2,
        y: box.y - gap / 2,
        width: box.width + gap,
        height: box.height + gap
    }));
    const collisionAt = workflowNodeCollisionMeasure(inflated);
    const parentBounds = options.parent ? workflowNodeBounds(options.parent) : null;
    const cascade = Number.isFinite(Number(options.cascadeIndex)) ? Math.max(0, Math.floor(Number(options.cascadeIndex))) : nodes.length;
    const cascadeDx = (cascade % 5) * 36;
    const cascadeDy = (cascade % 5) * 28;
    const viewportPreferred = options.viewportCenter && Number.isFinite(options.viewportCenter.x) && Number.isFinite(options.viewportCenter.y)
        ? { x: Math.round(options.viewportCenter.x - width / 2 + cascadeDx), y: Math.round(Math.max(80, options.viewportCenter.y - height / 2 + cascadeDy)) }
        : null;
    const effectivePreferredX = !parentBounds && viewportPreferred ? viewportPreferred.x : options.preferredX;
    const effectivePreferredY = !parentBounds && viewportPreferred ? viewportPreferred.y : options.preferredY;
    const minX = Math.max(120, bounds.reduce((minimum, box) => Math.min(minimum, box.x), Math.min(effectivePreferredX, 180)));
    const minY = Math.max(120, bounds.reduce((minimum, box) => Math.min(minimum, box.y), Math.min(effectivePreferredY, 150)));
    const candidates: Array<{
        x: number;
        y: number;
        priority: number;
    }> = [];
    const addCandidate = (x: number, y: number, priority: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return;
        candidates.push({ x: Math.round(x), y: Math.round(Math.max(80, y)), priority });
    };
    if (parentBounds) {
        addCandidate(parentBounds.x + parentBounds.width + gap, parentBounds.y, 0);
        addCandidate(parentBounds.x + parentBounds.width + gap, parentBounds.y + Math.max(0, parentBounds.height - height) / 2, 1);
        addCandidate(parentBounds.x + parentBounds.width + gap, parentBounds.y + parentBounds.height + gap, 2);
        addCandidate(parentBounds.x, parentBounds.y + parentBounds.height + gap, 3);
    }
    else if (viewportPreferred) {
        addCandidate(viewportPreferred.x, viewportPreferred.y, 0);
        addCandidate(viewportPreferred.x + width + gap, viewportPreferred.y, 1);
        addCandidate(viewportPreferred.x, viewportPreferred.y + height + gap, 2);
        addCandidate(viewportPreferred.x - width - gap, viewportPreferred.y, 3);
    }
    addCandidate(effectivePreferredX, effectivePreferredY, 4);
    for (const box of bounds) {
        addCandidate(box.x + box.width + gap, box.y, 5);
        addCandidate(box.x, box.y + box.height + gap, 6);
    }
    for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 7; col += 1) {
            addCandidate(minX + col * (width + gap), minY + row * (height + gap), 10 + row);
        }
    }
    let best = { x: Math.round(effectivePreferredX), y: Math.round(effectivePreferredY), score: Number.POSITIVE_INFINITY };
    const anchorX = parentBounds ? parentBounds.x + parentBounds.width + gap : effectivePreferredX;
    const anchorY = parentBounds ? parentBounds.y : effectivePreferredY;
    for (const candidate of candidates) {
        const box = { x: candidate.x, y: candidate.y, width, height };
        const collision = collisionAt(box);
        const anchorDistance = Math.hypot(candidate.x - anchorX, candidate.y - anchorY);
        const preferredDistance = Math.hypot(candidate.x - effectivePreferredX, candidate.y - effectivePreferredY);
        const score = collision * 100000 + candidate.priority * 1000 + anchorDistance + preferredDistance * 0.2 + candidate.y * 0.01 + candidate.x * 0.001;
        if (score < best.score)
            best = { x: candidate.x, y: candidate.y, score };
        if (collision === 0 && candidate.priority <= 1)
            break;
    }
    return { x: best.x, y: best.y };
}
function imageTaskSizeForNode(node: WorkflowNode, fallbackSize = "") {
    const assetDimensions = (node.assets ?? [])
        .map((asset) => ({ width: Number(asset.width ?? 0), height: Number(asset.height ?? 0) }))
        .filter((size) => Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0)
        .sort((left, right) => left.width / left.height - right.width / right.height);
    if (assetDimensions.length) {
        const representative = assetDimensions[Math.floor(assetDimensions.length / 2)];
        return `${Math.round(representative.width)}x${Math.round(representative.height)}`;
    }
    const params = node.imageParams;
    if (params?.size)
        return params.size;
    if (params?.ratio && params?.resolution)
        return computedSizeFor(params.ratio, params.resolution);
    return promptMetaValue(node.prompt, "size") || fallbackSize || "1024x1024";
}
function projectCanvasImageLayouts(nodes: WorkflowNode[], layoutGroups: ImageLayoutGroup[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groupByMember = new Map<string, ImageLayoutGroup>();
    const assetSourcesByHost = new Map<string, Array<{
        bindingId?: string;
        nodeId: string;
        containerNodeId?: string;
        assetIndex: number;
        role?: AssetTaskRole;
    }>>();
    for (const group of layoutGroups) {
        for (const memberId of group.memberNodeIds)
            groupByMember.set(memberId, group);
    }
    const canvasNodes: WorkflowNode[] = [];
    for (const node of nodes) {
        const group = groupByMember.get(node.id);
        if (!group) {
            const bounds = workflowNodeBounds(node);
            canvasNodes.push(node.width === bounds.width && node.height === bounds.height ? node : { ...node, width: bounds.width, height: bounds.height });
            continue;
        }
        if (group.hostNodeId !== node.id)
            continue;
        const members = group.memberNodeIds.map((id) => nodeById.get(id)).filter((item): item is WorkflowNode => Boolean(item));
        const containerSpec = imageContainerSpecForNode(node);
        const flattenedBindings = flattenImageContainerBindings(nodes, node.id, nodeById);
        const sources: Array<{
            bindingId?: string;
            nodeId: string;
            containerNodeId?: string;
            assetIndex: number;
            role?: AssetTaskRole;
        }> = [];
        const orderedAssets = flattenedBindings.length ? flattenedBindings.flatMap(binding => {
            const member = nodeById.get(binding.nodeId), asset = member?.assets?.[binding.assetIndex];
            return member && asset ? [{ member, asset, assetIndex: binding.assetIndex, binding }] : [];
        }) : members.flatMap(member => (member.assets ?? []).map((asset, assetIndex) => ({ member, asset, assetIndex, binding: undefined })));
        const assets = orderedAssets.map(({ member, asset, assetIndex, binding }) => {
            sources.push({
                bindingId: binding?.bindingId,
                nodeId: binding?.nodeId || member.id,
                containerNodeId: binding?.containerNodeId,
                assetIndex: binding?.assetIndex ?? assetIndex,
                role: binding?.role
            });
            const memberTaskRole = binding?.role ?? (member.imageContainerRole === "source" || member.imageContainerRole === "reference"
                ? member.imageContainerRole
                : asset.taskRole);
            return { ...asset, taskRole: memberTaskRole, index: sources.length };
        });
        assetSourcesByHost.set(node.id, sources);
        const count = Math.max(assets.length, 1);
        const adaptive = displaySizeForImageNode(imageTaskSizeForNode({ ...node, assets }), count, assets);
        const autoFit = group.autoFit !== false;
        const taskPreview = node.imageContainerRole === "source" || node.imageContainerRole === "reference";
        const width = taskPreview
            ? Number(node.width ?? TASK_IMAGE_CONTAINER_W)
            : autoFit
                ? Math.max(Number(adaptive.width ?? IMAGE_CONTAINER_W), IMAGE_CONTAINER_MIN_W)
                : Number(node.width ?? adaptive.width ?? IMAGE_CONTAINER_W);
        const height = taskPreview
            ? Number(node.height ?? TASK_IMAGE_CONTAINER_H)
            : autoFit
                ? Math.max(Number(adaptive.height ?? IMAGE_CONTAINER_H), IMAGE_CONTAINER_MIN_H)
                : Number(node.height ?? adaptive.height ?? IMAGE_CONTAINER_H);
        const projectedCollection = containerSpec?.kind === "batch-result"
            ? parallelImageCollection(node.id, count, assets, node.prompt, containerSpec.collection)
            : undefined;
        canvasNodes.push({
            ...node,
            title: projectedCollection ? node.title : node.imageContainer ? node.title : "图片容器",
            prompt: node.prompt || "用户整理的图片成果容器。",
            assets,
            outputs: assets.length,
            imageState: assets.length ? "done" : "empty",
            imageContainer: !projectedCollection,
            imageContainerSpec: (() => {
                const spec = imageContainerSpecForNode(node);
                return spec ? { ...cloneImageContainerSpec(spec)!, memberBindings: flattenedBindings.map((binding) => ({ ...binding })) } : undefined;
            })(),
            imageCollection: projectedCollection,
            imageParams: node.imageParams ? cloneImageTaskDraft({ ...node.imageParams, count }) : node.imageParams,
            ...(assets.length === 1 ? singleImageFrameSize(imageTaskSizeForNode({ ...node, assets }), width, assets) : { width, height })
        });
    }
    return {
        canvasNodes,
        canvasNodeById: new Map(canvasNodes.map((node) => [node.id, node])),
        groupByMember,
        assetSourcesByHost
    };
}
function arrangeCanvasNodePositions(nodes: WorkflowNode[], layoutGroups: ImageLayoutGroup[]) {
    if (nodes.length < 2)
        return nodes;
    const projection = projectCanvasImageLayouts(nodes, layoutGroups);
    const rawById = new Map(nodes.map((node) => [node.id, node]));
    const layoutByHost = new Map(layoutGroups.map((group) => [group.hostNodeId, group]));
    const consumed = new Set<string>();
    const units: Array<{
        id: string;
        memberNodeIds: string[];
        bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    }> = [];
    for (const visibleNode of projection.canvasNodes) {
        if (consumed.has(visibleNode.id))
            continue;
        const layoutGroup = layoutByHost.get(visibleNode.id);
        const layerGroupId = visibleNode.layerGroup?.id;
        const memberNodeIds = layoutGroup
            ? layoutGroup.memberNodeIds.filter((id) => rawById.has(id))
            : layerGroupId
                ? nodes.filter((node) => node.layerGroup?.id === layerGroupId).map((node) => node.id)
                : [visibleNode.id];
        memberNodeIds.forEach((id) => consumed.add(id));
        const visualMembers = layoutGroup
            ? [visibleNode]
            : memberNodeIds.map((id) => rawById.get(id)).filter((node): node is WorkflowNode => Boolean(node));
        const memberBounds = visualMembers.map(workflowNodeBounds);
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const bounds of memberBounds) {
            left = Math.min(left, bounds.x);
            top = Math.min(top, bounds.y);
            right = Math.max(right, bounds.x + bounds.width);
            bottom = Math.max(bottom, bounds.y + bounds.height);
        }
        units.push({
            id: layoutGroup ? `layout:${layoutGroup.id}` : layerGroupId ? `layers:${layerGroupId}` : `node:${visibleNode.id}`,
            memberNodeIds,
            bounds: { x: left, y: top, width: right - left, height: bottom - top }
        });
    }
    const unitByNodeId = new Map<string, string>();
    units.forEach((unit) => unit.memberNodeIds.forEach((nodeId) => unitByNodeId.set(nodeId, unit.id)));
    const parentUnitIds = new Map<string, Set<string>>(units.map((unit) => [unit.id, new Set<string>()]));
    for (const unit of units) {
        const parents = parentUnitIds.get(unit.id)!;
        for (const nodeId of unit.memberNodeIds) {
            const node = rawById.get(nodeId);
            if (!node)
                continue;
            const parentNodeIds = node.type === "requirement" && node.requirement
                ? requirementInputBindings(node, nodes).map((binding) => binding.nodeId)
                : [node.parentId, node.layerGroup?.sourceParentId].filter((id): id is string => Boolean(id));
            for (const parentNodeId of parentNodeIds) {
                const parentUnitId = unitByNodeId.get(parentNodeId);
                if (parentUnitId && parentUnitId !== unit.id)
                    parents.add(parentUnitId);
            }
        }
    }
    let depthByUnit = new Map(units.map(unit => [unit.id, 0]));
    for (let pass = 0; pass < 12; pass++) {
        const next = new Map(depthByUnit);
        let changed = false;
        for (const unit of units) {
            let depth = 0;
            for (const parent of parentUnitIds.get(unit.id) || [])
                depth = Math.max(depth, Math.min(12, (depthByUnit.get(parent) || 0) + 1));
            if (depth !== depthByUnit.get(unit.id)) {
                next.set(unit.id, depth);
                changed = true;
            }
        }
        depthByUnit = next;
        if (!changed)
            break;
    }
    const columns = new Map<number, typeof units>();
    for (const unit of units) {
        const depth = depthByUnit.get(unit.id) ?? 0;
        const column = columns.get(depth) || [];
        column.push(unit);
        columns.set(depth, column);
    }
    const offsetsByUnit = new Map<string, {
        dx: number;
        dy: number;
    }>();
    let columnX = 160;
    const unitNaturalKey = (unit: {
        memberNodeIds: string[];
    }) => {
        let best = Number.POSITIVE_INFINITY;
        for (const memberId of unit.memberNodeIds) {
            const node = rawById.get(memberId);
            if (!node)
                continue;
            best = Math.min(best, nodeSequenceFromCode(node.displayCode), nodeSequenceFromCode(node.id));
        }
        return Number.isFinite(best) ? best : Number.MAX_SAFE_INTEGER;
    };
    for (const depth of [...columns.keys()].sort((left, right) => left - right)) {
        const column = columns.get(depth)!
            .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || unitNaturalKey(left) - unitNaturalKey(right) || left.id.localeCompare(right.id, undefined, { numeric: true }));
        const columnWidth = column.reduce((width, unit) => Math.max(width, unit.bounds.width), 0);
        let rowY = 140;
        for (const unit of column) {
            offsetsByUnit.set(unit.id, {
                dx: Math.round(columnX - unit.bounds.x),
                dy: Math.round(rowY - unit.bounds.y)
            });
            rowY += unit.bounds.height + 76;
        }
        columnX += columnWidth + 112;
    }
    return nodes.map((node) => {
        const offset = offsetsByUnit.get(unitByNodeId.get(node.id) || "");
        if (!offset || (!offset.dx && !offset.dy))
            return node;
        return {
            ...node,
            x: Math.round(node.x + offset.dx),
            y: Math.round(node.y + offset.dy),
            layerGroup: node.layerGroup ? {
                ...cloneImageLayerNodeGroup(node.layerGroup)!,
                anchorX: Math.round(Number(node.layerGroup.anchorX ?? node.x) + offset.dx),
                anchorY: Math.round(Number(node.layerGroup.anchorY ?? node.y) + offset.dy)
            } : undefined
        };
    });
}
function emptyProjectRecoveryAssessment(error = ""): ProjectRecoveryAssessment {
    return {
        assessmentId: "",
        total: 0,
        registered: 0,
        recoverable: 0,
        blocked: 0,
        candidates: [],
        committedReceipts: [],
        ...(error ? { error } : {})
    };
}
function App() {
    useFloatingDialogInteractions();
    return <WorkspaceApp />;
}
function WorkspaceApp() {
    const toolbarCleanup = useRef<(() => void) | undefined>(undefined);
    const attachToolbar = useCallback((node: HTMLElement | null) => {
        toolbarCleanup.current?.();
        toolbarCleanup.current = node ? mountProgramToolbar(node, {loadStyles: false}).close : undefined;
    }, []);
    if (!firstAppRenderMarked) {
        firstAppRenderMarked = true;
        markPerformancePhase("app-first-render");
    }
    const [settings, setSettings] = useState<AppSettings>(() => window.aieyraConfig ? defaultSettings : mergeSettings(readJson<Partial<AppSettings> & Record<string, unknown>>(STORAGE_SETTINGS, defaultSettings)));
    const [workspaceLayout] = useState<WorkspaceLayout>(() => readWorkspaceLayout());
    const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
    const [conversations, setConversations] = useState<AgentConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState(() => uid("conv"));
    const [nodes, setNodesState] = useState<WorkflowNode[]>(initialNodes);
    const [layoutGroups, setLayoutGroupsState] = useState<ImageLayoutGroup[]>([]);
    const [selectedNodeId, setPrimarySelectedNodeId] = useState("");
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
    const [canvasSelectionBox, setCanvasSelectionBox] = useState<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>(null);
    const [projects, setProjects] = useState<ProjectRecord[]>([]);
    const [activeProjectId, setActiveProjectId] = useState("default");
    const [projectTabPreferences, setProjectTabPreferences] = useProjectTabPreferences();
    const initialProjectTabsAppliedRef = useRef(false);
    const requirementEditHistoryRef = useRef("");
    // 第109轮 R15：只有一个画布，活动画布存在即显示；旧版「关闭项目」留下的标签状态不再隐藏它。
    const projectWorkspaceOpen = projects.some((project) => project.id === activeProjectId && project.kind === "image");
    const [projectSurface] = useState<ProjectSurface>("public");
    const [projectRecoveryAssessment, setProjectRecoveryAssessment] = useState<ProjectRecoveryAssessment | null>(null);
    const [projectRecoveryOpen, setProjectRecoveryOpen] = useState(false);
    const [projectRecoveryBusy, setProjectRecoveryBusy] = useState(false);
    const projectRecoveryBridgeEvidenceRef = useRef<{
        operation: "" | "recover" | "rollback";
        keys: string[];
        safe: boolean;
        projectRecordPayloadPresent: boolean;
    }>({
        operation: "",
        keys: [],
        safe: true,
        projectRecordPayloadPresent: false
    });
    const [writingSession, setWritingSession] = useState<StudioWritingSession>(() => emptyWritingSession());
    const [writingError, setWritingError] = useState("");
    const [lineageSession, setLineageSession] = useState<StudioLineageSession>(() => emptyLineageRendererSession());
    const [writingPatchProposals, setWritingPatchProposals] = useState<Record<string, WritingAgentPatchProposal[]>>({});
    const [writingPatchDecisionBusy, setWritingPatchDecisionBusy] = useState(false);
    const [writingPatchDecisionError, setWritingPatchDecisionError] = useState("");
    const activeWritingPatchProposalId = writingPatchProposals[activeProjectId]?.[0]?.proposalId || "";
    useEffect(() => {
        setWritingPatchDecisionError("");
    }, [activeProjectId, activeWritingPatchProposalId]);
    const [projectRunViews, setProjectRunViews] = useState<Record<string, ProjectRunView>>({});
    const [projectResetDraft, setProjectResetDraft] = useState<ProjectResetDraft | null>(null);
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
    const [cullingViewport, setCullingViewport] = useState<CanvasViewport | null>(null);
    const zoom = viewport.scale;
    const composerDraft = useComposerDraft(activeProjectId, activeConversationId);
    const { prompt, sources: agentSourceImages, references: agentReferenceImages, files: agentFileAttachments } = composerDraft.draft;
    const { setSources: setAgentSourceImagesState, setReferences: setAgentReferenceImagesState } = composerDraft;
    const [connectionSnapshot, setConnectionSnapshot] = useState<ConnectionPublicSnapshot>(() => localConnectionFallback());
    const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useState(true);
    const matrixBindingRef = useRef<{ projectId: string; conversationId: string; canvasProjectId: string } | null>(null);
    // OS owns the conversation. Bind it only when a canvas action needs it;
    // no hidden chat renderer or model polling is needed to restore local work.
    async function requireCanvasBinding(canvasProjectId = activeProjectIdRef.current) {
        const result = await window.aieyraMatrix.workspace({ canvasProjectId });
        if (!result.ok || !result.projectId || !result.conversationId || result.canvasProjectId !== canvasProjectId)
            throw Error(result.error || "画布 Agent 暂时不可用，请稍后重试。");
        if (canvasProjectId !== activeProjectIdRef.current || projectTransitionRef.current)
            throw Error("画布已切换，请回原画布重试。");
        const binding = { ...result, projectId: result.projectId, conversationId: result.conversationId, canvasProjectId };
        matrixBindingRef.current = binding;
        return binding;
    }
    const setMatrixChatOpen = useCallback((open: boolean) => {
        void Promise.resolve((window as any).aieyraApp?.invoke({ scope: "os", action: "sidebar", open })).catch(() => undefined);
    }, []);
    const [projectSearch, setProjectSearch] = useState("");
    const [projectHistoryOpen, setProjectHistoryOpen] = useState(false);
    const [studioEditor, setStudioEditor] = useState<{
        projectId: string;
        id: string;
    } | null>(null);
    const [imageMarkEditor, setImageMarkEditor] = useState<{
        projectId: string;
        nodeId: string;
        assetIndex: number;
        asset: ImageAsset;
    } | null>(null);
    const [agentCollapsed, setAgentCollapsed] = useState(false);
    const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
    const [manualImageTaskDialog, setManualImageTaskDialog] = useState<ManualImageTaskDialogState | null>(null);
    const [layeredImageTaskDialog, setLayeredImageTaskDialog] = useState<LayeredImageTaskDialogState | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogDraft | null>(null);
    const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null);
    const [requirementReferenceMenu, setRequirementReferenceMenu] = useState<{
        images: Array<{
            nodeId: string;
            code: string;
        }>;
        x: number;
        y: number;
    } | null>(null);
    const [assetContextMenu, setAssetContextMenu] = useState<AssetContextMenuState | null>(null);
    const [layerViewer, setLayerViewer] = useState<LayerViewerState | null>(null);
    const [regionRedrawDraft, setRegionRedrawDraft] = useState<RegionRedrawDraft | null>(null);
    const [nodeEditorDraft, setNodeEditorDraft] = useState<NodeEditorDraft | null>(null);
    const [nodeNoteDraft, setNodeNoteDraft] = useState<NodeNoteDraft | null>(null);
    useEffect(() => setNodeNoteDraft(null), [activeProjectId]);
    const [referencePickerDraft, setReferencePickerDraft] = useState<ReferencePickerDraft | null>(null);
    const [referencePickerMinimized, setReferencePickerMinimized] = useState(false);
    const [agentAssetPickerOpen, setAgentAssetPickerOpen] = useState(false);
    const [askUserDraft, setAskUserDraft] = useState<AskUserDraft | null>(null);
    const [askUserMinimized, setAskUserMinimized] = useState(false);
    const minimizedWindows = useMinimizedWindows();
    const [pendingAgentExecution, setPendingAgentExecution] = useState<PendingAgentExecution | null>(null);
    const [quotaDialog, setQuotaDialog] = useState<ImageQuotaDialogState | null>(null);
    const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
    const [newNodeHighlightIds, setNewNodeHighlightIds] = useState<string[]>([]);
    const newNodeHighlightIdsRef = useRef<string[]>([]);
    const newNodeHighlightTimerRef = useRef<number | null>(null);
    const flashNewCanvasNodes = useStableEvent((ids: Array<string | undefined | null>) => {
        const next = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
        if (newNodeHighlightTimerRef.current !== null) {
            window.clearTimeout(newNodeHighlightTimerRef.current);
            newNodeHighlightTimerRef.current = null;
        }
        newNodeHighlightIdsRef.current = next;
        setNewNodeHighlightIds(next);
        if (!next.length)
            return;
        newNodeHighlightTimerRef.current = window.setTimeout(() => {
            newNodeHighlightIdsRef.current = [];
            setNewNodeHighlightIds([]);
            newNodeHighlightTimerRef.current = null;
        }, 15000);
    });
    useEffect(() => () => {
        if (newNodeHighlightTimerRef.current !== null)
            window.clearTimeout(newNodeHighlightTimerRef.current);
    }, []);
    const agentSourceImagesRef = useRef(agentSourceImages);
    const agentReferenceImagesRef = useRef(agentReferenceImages);
    const agentFileAttachmentsRef = useRef(agentFileAttachments);
    agentSourceImagesRef.current = agentSourceImages;
    agentReferenceImagesRef.current = agentReferenceImages;
    agentFileAttachmentsRef.current = agentFileAttachments;
    const connectionSnapshotRef = useRef(connectionSnapshot);
    connectionSnapshotRef.current = connectionSnapshot;
    const commitAgentSourceImages = useCallback((next: React.SetStateAction<ReferenceImage[]>) => {
        const value = typeof next === "function" ? next(agentSourceImagesRef.current) : next;
        agentSourceImagesRef.current = value;
        setAgentSourceImagesState(value);
    }, [setAgentSourceImagesState]);
    const commitAgentReferenceImages = useCallback((next: React.SetStateAction<ReferenceImage[]>) => {
        const value = typeof next === "function" ? next(agentReferenceImagesRef.current) : next;
        agentReferenceImagesRef.current = value;
        setAgentReferenceImagesState(value);
    }, [setAgentReferenceImagesState]);
    const [agentProgress, setAgentProgress] = useState<AgentProgress[]>([]);
    const [queuedAgentFollowUps, setQueuedAgentFollowUps] = useState<QueuedAgentFollowUp[]>([]);
    const imageGenerationStatsRef = useRef<ImageGenerationStats>(readImageGenerationStats());
    const [imageRunStarts, setImageRunStarts] = useState<Record<string, number>>({});
    const [executionReservation, setExecutionReservation] = useState(false);
    const [assetDropTargetId, setAssetDropTargetId] = useState("");
    const [externalCanvasDropActive, setExternalCanvasDropActive] = useState(false);
    const [draggingNodeId, setDraggingNodeId] = useState("");
    const [resizingNodeId, setResizingNodeId] = useState("");
    const [activeLayerSurface, setActiveLayerSurface] = useState<{
        nodeId: string;
        layerId: string;
    } | null>(null);
    const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
    const [serverUser, setServerUser] = useState<ServerUser | null>(null);
    const [serverWallet, setServerWallet] = useState<ServerWallet | null>(null);
    const [, setServerKeyStatus] = useState<ServerKeyStatus | null>(null);
    const [officialTokens, setOfficialTokens] = useState<OfficialTokenMeta[]>([]);
    const [selectedOfficialTokenId, setSelectedOfficialTokenId] = useState("");
    const [, setDesktopUpdateNotice] = useState<DesktopUpdateInfo | null>(null);
    const [serverMessage, setServerMessage] = useState("");
    const [videoEditor, setVideoEditor] = useState<{projectId:string;assetId?:string;timelineId?:string} | null>(null);
    const videoFlushRef = useRef<(()=>Promise<void>) | null>(null);
    useEffect(() => { if (composerDraft.error)
        setServerMessage(composerDraft.error); }, [composerDraft.error]);
    const [canvasOperationNotice, setCanvasOperationNotice] = useState<{
        id: number;
        message: string;
    } | null>(null);
    const canvasOperationNoticeSequenceRef = useRef(0);
    const [fileActionBusy, setFileActionBusy] = useState(false);
    const [projectNameDraft, setProjectNameDraft] = useState<ProjectNameDraft | null>(null);
    const [configReady, setConfigReady] = useState(false);
    const [backgroundReady, setBackgroundReady] = useState(false);
    const [configError, setConfigError] = useState("");
    const [configAttempt, setConfigAttempt] = useState(0);
    const startupRequest = useRef<Promise<{ settings: AppSettings; canvas: Awaited<ReturnType<NonNullable<typeof window.aieyraConfig>["loadSession"]>> }> | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [canvasMountTick, setCanvasMountTick] = useState(0);
    const [canvasViewportSize, setCanvasViewportSize] = useState({ width: 1, height: 1 });
    useEffect(() => {
        if (!askUserDraft && askUserMinimized)
            setAskUserMinimized(false);
    }, [askUserDraft, askUserMinimized]);
    useEffect(() => {
        if (!referencePickerDraft && referencePickerMinimized)
            setReferencePickerMinimized(false);
    }, [referencePickerDraft, referencePickerMinimized]);
    const showCanvasOperationNotice = useCallback((message: string) => {
        const normalized = String(message || "").replace(/\s+/g, " ").trim().slice(0, 220);
        if (!normalized)
            return;
        setServerMessage(normalized);
        canvasOperationNoticeSequenceRef.current += 1;
        setCanvasOperationNotice({ id: canvasOperationNoticeSequenceRef.current, message: normalized });
    }, []);
    useEffect(() => {
        if (!canvasOperationNotice)
            return;
        const noticeId = canvasOperationNotice.id;
        const timeout = window.setTimeout(() => {
            setCanvasOperationNotice((current) => current?.id === noticeId ? null : current);
        }, 3600);
        return () => window.clearTimeout(timeout);
    }, [canvasOperationNotice]);
    useEffect(() => {
        setAgentAssetPickerOpen(false);
    }, [activeProjectId]);
    useEffect(() => {
        if (!askUserDraft || !askUserMinimized)
            return;
        const focusFrame = window.requestAnimationFrame(() => {
            const canvas = document.querySelector<HTMLElement>('[data-workflow-canvas="true"], .workflow-canvas');
            canvas?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(focusFrame);
    }, [askUserDraft, askUserMinimized]);
    const eventLogByProjectRef = useRef<Record<string, string[]>>({});
    const agentEndRef = useRef<HTMLDivElement | null>(null);
    const agentInputRef = useRef<HTMLTextAreaElement | null>(null);
    const confirmRestoreFocusRef = useRef<{
        element: HTMLElement | null;
        ariaLabel: string;
        text: string;
    } | null>(null);
    const viewportRef = useRef(viewport);
    const viewportInteractionActiveRef = useRef(false);
    const suppressCanvasAutoRefocusUntilRef = useRef(0);
    const canvasViewportSizeRef = useRef(canvasViewportSize);
    const nodesRef = useRef(nodes);
    const nodeSequenceRef = useRef(inferredNodeSequence(nodes));
    const reactNodesRef = useRef(nodes);
    const layoutGroupsRef = useRef(layoutGroups);
    const writingSessionRef = useRef(writingSession);
    const lineageSessionRef = useRef(lineageSession);
    const lineageCanvasCommitQueueRef = useRef<Record<string, Promise<void>>>({});
    const writingPromptPreflightRef = useRef(false);
    writingSessionRef.current = writingSession;
    lineageSessionRef.current = lineageSession;
    const nodeEditorDraftRef = useRef(nodeEditorDraft);
    const activeRunRef = useRef<string | null>(null);
    const projectRunsRef = useRef<Record<string, ProjectRunRecord>>({});
    const backgroundImageJobsRef = useRef(new Map<string, {
        job: BackgroundImageJob;
        nodeIds: Record<string, string>;
        requirementNodeId?: string;
        resumeAttempted?: boolean;
        resumeAttempts?: number;
        resumeAfter?: number;
    }>());
    const goalFeedbackCommitsRef = useRef(new Map<string, Promise<void>>());
    const goalFeedbackSavedRef = useRef(new Set<string>());
    const manualImageJobsRef = useRef(new Map<string, {
        projectId: string;
        conversationId: string;
        nodeId: string;
    }>());
    const manualImageReservationsRef = useRef(new Set<string>());
    const projectImageStartsRef = useRef<Record<string, Record<string, number>>>({});
    const [, setImageJobsRevision] = useState(0);
    const projectTransitionRef = useRef(false);
    const projectSwitchQueueRef = useRef<Promise<void>>(Promise.resolve());
    const projectRuntimeCommitsRef = useRef<Map<string, Set<Promise<unknown>>>>(new Map());
    const executionReservationRef = useRef<string | null>(null);
    const pendingAgentExecutionRef = useRef<PendingAgentExecution | null>(pendingAgentExecution);
    const stoppingAgentRunRef = useRef(false);
    const queuedAgentFollowUpsRef = useRef<QueuedAgentFollowUp[]>(queuedAgentFollowUps);
    const queuedFollowUpDispatchingRef = useRef(false);
    const cancelledAgentRequestsRef = useRef<Map<string, CancelledAgentRequest>>(new Map());
    const requirementRunParentsRef = useRef<Map<string, string>>(new Map());
    const imageRunStartsRef = useRef<Record<string, number>>({});
    const activeImageRequestIdsRef = useRef<Map<string, string>>(new Map());
    const agentToolNodeIdsRef = useRef<Record<string, string>>({});
    const agentToolNodeCodesRef = useRef<Record<string, string>>({});
    const toolTimelineAliasesRef = useRef<Map<string, string>>(new Map());
    const pendingLayerMergeRunsRef = useRef<Map<string, PendingLayerMergeRuntime>>(new Map());
    const layerExecutionPlaceholdersRef = useRef<Map<string, LayerExecutionPlaceholder>>(new Map());
    const layerMergeCommitPromisesRef = useRef<Map<string, Promise<RuntimeActionCommitResult>>>(new Map());
    const completedLayerMergeRunsRef = useRef<Set<string>>(new Set());
    const pendingImageToolResultsRef = useRef<Map<string, AgentProgress>>(new Map());
    const pendingImageToolSettlementsRef = useRef<Set<string>>(new Set());
    const completedLocalToolOperationsRef = useRef<Set<string>>(new Set());
    const renderedLocalToolOperationsRef = useRef<Set<string>>(new Set());
    const imageToolCommitEvidenceRef = useRef<Map<string, ImageToolCommitEvidence>>(new Map());
    const layerDetachAuditRef = useRef<Array<{
        at: number;
        action: "detach" | "explode" | "recompose" | "cancel";
        source: string;
        nodeId: string;
        groupId?: string;
        pointerId?: number;
        pointerType?: string;
        eventType?: string;
        dx?: number;
        dy?: number;
    }>>([]);
    const layerMergeNonceRef = useRef(0);
    const layerRuntimeScopeEpochRef = useRef(0);
    const pendingLayerNarrationRunIdsRef = useRef<Set<string>>(new Set());
    const pendingAgentStreamMessagesRef = useRef<Map<string, AgentMessage>>(new Map());
    const agentStreamFlushTimerRef = useRef<number | null>(null);
    const pendingRuntimeFocusNodeIdRef = useRef("");
    const layoutRefocusTimerRef = useRef<number | null>(null);
    const explicitViewportIntentRef = useRef("");
    const viewportIntentRevisionRef = useRef(0);
    const activeProjectIdRef = useRef(activeProjectId);
    const projectsRef = useRef(projects);
    const projectSessionApplyRef = useRef(0);
    const skipInitialSessionAutosaveRef = useRef(true);
    const projectSessionRevisionRef = useRef<Record<string, number>>({});
    const canvasRevisionRef = useRef(0);
    const persistenceDebugMetricsRef = useRef<PersistenceDebugMetrics>(emptyPersistenceDebugMetrics());
    const writingPromptPreflightRunRef = useRef("");
    const writingPromptPreflightCancelledRef = useRef(false);
    const debugRenderCommitsRef = useRef<Record<DebugRenderCommitArea, number>>({ app: 0, canvas: 0, agentFeed: 0, composer: 0 });
    const runtimeActionHandlerRef = useRef<(actions: AgentRuntimeAction[], fallbackAgentOwnerId?: string) => Promise<RuntimeActionApplicationResult>>(async () => ({ commits: [] }));
    const lastSubmitRef = useRef<{
        projectId: string;
        conversationId: string;
        text: string;
        time: number;
    } | null>(null);
    const lastTimelineMessageRef = useRef("");
    const serverUserRef = useRef<ServerUser | null>(null);
    const authCheckedTokenRef = useRef("");
    const serverRefreshEpochRef = useRef(0);
    const activeConversationIdRef = useRef(activeConversationId);
    const selectedNodeIdRef = useRef(selectedNodeId);
    const selectedNodeIdsRef = useRef<string[]>(selectedNodeIds);
    const selectionGestureRef = useRef("restore");
    const selectionRetargetIntentRef = useRef<PendingSelectionRetargetIntent | null>(null);
    const canvasUndoRef = useRef<CanvasHistorySnapshot | null>(null);
    const canvasHistoryCaptureRef = useRef<CanvasHistorySnapshot | null>(null);
    const removedManualImageResultsRef = useRef(new Map<string, WorkflowNode>());
    const keyboardNudgeHistoryAtRef = useRef(0);
    const messagesRef = useRef(messages);
    const conversationsRef = useRef(conversations);
    const agentProgressRef = useRef(agentProgress);
    const agentStatusRef = useRef(agentStatus);
    const fileActionBusyRef = useRef(fileActionBusy);
    function commitFileActionBusy(busy: boolean) {
        fileActionBusyRef.current = busy;
        setFileActionBusy(busy);
    }
    function projectRunActionLineageKey(action: AgentRuntimeAction) {
        const operationId = String(action.operationId || "").trim();
        const toolRunId = String(action.toolRunId || "").trim();
        const runtimeIdentity = operationId || toolRunId;
        if (!runtimeIdentity)
            return "";
        return `${action.type}:operation:${runtimeIdentity}:tool:${toolRunId || runtimeIdentity}`;
    }
    function projectRunActionKey(action: AgentRuntimeAction) {
        const lineage = projectRunActionLineageKey(action);
        const targetIdentity = [
            action.node?.id ? `node:${action.node.id}` : "",
            action.patch?.id ? `patch:${action.patch.id}` : "",
            action.composition?.id ? `composition:${action.composition.id}` : "",
            action.request?.requestId ? `request:${action.request.requestId}` : "",
            action.id ? `id:${action.id}` : "",
            action.resumeLayerGroupId ? `layer:${action.resumeLayerGroupId}` : "",
            action.sourceId || action.targetId ? `edge:${action.sourceId || ""}->${action.targetId || ""}` : "",
            action.sourceNodeId ? `source:${action.sourceNodeId}` : "",
            action.node?.imageCollection?.id ? `collection:${action.node.imageCollection.id}` : ""
        ].filter(Boolean).join("|");
        if (lineage || targetIdentity)
            return `${lineage || `${action.type}:unscoped`}:${targetIdentity || "primary"}`;
        try {
            return `${action.type}:${JSON.stringify(action)}`;
        }
        catch {
            return `${action.type}:${String(action)}`;
        }
    }
    function projectRunActionFingerprint(action: AgentRuntimeAction) {
        try {
            return JSON.stringify(action);
        }
        catch {
            return projectRunActionKey(action);
        }
    }
    function projectRunActionIsSettled(action: AgentRuntimeAction) {
        const imageState = action.node?.imageState ?? action.patch?.imageState;
        return Boolean((imageState && imageState !== "generating") ||
            (action.node?.assets?.length ?? 0) > 0 ||
            action.node?.status === "done" ||
            action.patch?.status === "done");
    }
    function mergeProjectRunActions(current: AgentRuntimeAction[], incoming: AgentRuntimeAction[]) {
        const next = [...current];
        for (const action of incoming) {
            const key = projectRunActionKey(action);
            let existingIndex = next.findIndex((candidate) => projectRunActionKey(candidate) === key);
            if (existingIndex < 0) {
                const lineage = projectRunActionLineageKey(action);
                if (lineage) {
                    existingIndex = next.findIndex((candidate) => projectRunActionLineageKey(candidate) === lineage);
                }
            }
            if (existingIndex < 0) {
                next.push(action);
                continue;
            }
            const existing = next[existingIndex];
            if (projectRunActionIsSettled(existing) && !projectRunActionIsSettled(action))
                continue;
            next[existingIndex] = action;
        }
        return next;
    }
    function projectHasImageWork(projectId: string) {
        return [...manualImageJobsRef.current.values()].some(job => job.projectId === projectId) ||
            [...backgroundImageJobsRef.current.values()].some(entry => entry.job.projectId === projectId && entry.job.status === "running");
    }
    function imageJobRecord(projectId: string, conversationId: string) {
        if (activeProjectIdRef.current === projectId && !projectTransitionRef.current)
            captureActiveProjectRunSession();
        const existing = projectRunsRef.current[projectId];
        if (existing)
            return existing;
        if (activeProjectIdRef.current !== projectId)
            return null;
        const record: ProjectRunRecord = {
            projectId, conversationId, runId: uid("image-host"), status: "completed", startedAt: Date.now(), progress: [], queuedActions: [],
            session: buildWorkflowSessionSnapshot({ schemaVersion: 3, nodeSequence: nodeSequenceRef.current, canvasRevision: canvasRevisionRef.current,
                nodes: nodesRef.current, layoutGroups: layoutGroupsRef.current, selectedNodeId: selectedNodeIdRef.current,
                messages: messagesRef.current, conversations: conversationsRef.current, activeConversationId: activeConversationIdRef.current,
                pendingAgentExecution: pendingAgentExecutionRef.current }),
            existingNodeIds: nodesRef.current.map(node => node.id), taskScope: legacyAgentTaskScopeForRequest([], [], undefined, "canvas", canvasRevisionRef.current), pendingExecution: null
        };
        publishProjectRun(record);
        return record;
    }
    async function recoverImageJobProject(job: BackgroundImageJob) {
        if (imageJobRecord(job.projectId, job.conversationId))
            return;
        const result = await window.aieyraConfig?.loadSession({ projectId: job.projectId });
        if (!result?.ok || !result.session || projectRunsRef.current[job.projectId])
            return;
        const session = normalizeWorkflowSession(result.session, { preserveRuntimeState: true });
        projectSessionRevisionRef.current[job.projectId] = Math.max(projectSessionRevisionRef.current[job.projectId] || 0, session.sessionRevision || 0);
        publishProjectRun({ projectId: job.projectId, conversationId: job.conversationId, runId: uid("image-host"), status: "completed",
            startedAt: job.startedAt, progress: [], queuedActions: [], session,
            taskScope: job.taskScope || legacyAgentTaskScopeForRequest([], [], undefined, "canvas", session.canvasRevision),
            existingNodeIds: session.nodes.map(node => node.id), pendingExecution: session.pendingAgentExecution || null });
    }
    function appendImageJobMessage(projectId: string, conversationId: string, message: AgentMessage) {
        const record = imageJobRecord(projectId, conversationId);
        if (!record)
            return;
        const replace = (items: AgentMessage[]) => items.some(item => item.id === message.id)
            ? items.map(item => item.id === message.id ? message : item) : [...items, message];
        const visible = activeProjectIdRef.current === projectId && activeConversationIdRef.current === conversationId && !projectTransitionRef.current;
        if (visible) {
            messagesRef.current = replace(messagesRef.current);
            setMessages(messagesRef.current);
        }
        updateProjectRun(projectId, current => ({ ...current, session: { ...current.session,
                messages: current.session.activeConversationId === conversationId ? replace(current.session.messages) : current.session.messages,
                conversations: current.session.conversations.map(conversation => conversation.id === conversationId
                    ? { ...conversation, messages: replace(conversation.messages) } : conversation)
            } }));
    }
    function commitBackgroundImageActions(entry: {
        job: BackgroundImageJob;
        nodeIds: Record<string, string>;
        requirementNodeId?: string;
    }, actions: AgentRuntimeAction[]) {
        const { job } = entry;
        const record = imageJobRecord(job.projectId, job.conversationId);
        if (!record || job.status === "cancelled" && !actions.some(action => action.node?.assets?.length))
            return;
        const visible = activeProjectIdRef.current === job.projectId && !projectTransitionRef.current;
        let next = visible ? nodesRef.current : record.session.nodes;
        let sequence = Math.max(record.session.nodeSequence, inferredNodeSequence(next), visible ? nodeSequenceRef.current : 0);
        const freshIds: string[] = [];
        let viewportCenter: {
            x: number;
            y: number;
        } | undefined;
        try {
            viewportCenter = visible ? canvasCenterToWorld() : undefined;
        }
        catch {
            viewportCenter = undefined;
        }
        for (const action of actions) {
            if (action.type !== "workflow.node.create" || !action.node || action.node.nodeType !== "image")
                continue;
            const key = action.toolRunId || action.operationId || action.node.id || job.id;
            const oldId = entry.nodeIds[key];
            const previous = oldId ? next.find(node => node.id === oldId) : next.find(node => node.generationRunId === key);
            if (oldId && !previous)
                continue;
            if (previous && previous.imageState !== "generating" && action.node.imageState === "generating" && !job.id.startsWith("matrix-batch-"))
                continue;
            const id = previous?.id || nextNodeId(next, sequence);
            sequence = Math.max(sequence, nodeSequenceFromCode(id));
            const code = previous?.displayCode || id;
            entry.nodeIds[key] = id;
            const assets = imageAssetsWithIdentity(action.node.assets || [], code);
            const imageState = action.node.imageState || (assets.length ? "done" : "generating");
            const parentId = entry.requirementNodeId || action.node.parentId || undefined;
            const parent = next.find(node => node.id === parentId);
            const total = Math.max(1, action.node.imageProgress?.total || action.node.imageParams?.count || assets.length);
            const size = displaySizeForImageNode(action.node.imageParams?.size || "1024x1024", total, assets);
            const position = previous || findOpenWorkflowNodePosition(next, { parent, width: size.width || NODE_W,
                height: size.height || NODE_RESIZE_MIN_H, preferredX: (parent?.x || 120) + 300, preferredY: (parent?.y || 160) + 110,
                viewportCenter, cascadeIndex: next.length });
            const node: WorkflowNode = applyImageContainerCompatibility({
                ...previous, id, displayCode: code, type: "image", title: previous?.title || action.node.title || "图片成果",
                prompt: action.node.prompt || previous?.prompt || job.prompt, branch: "project-agent", createdAt: previous?.createdAt || nowLabel(),
                x: position.x, y: position.y, ...size, zOrder: previous?.zOrder ?? nextNodeZOrder(next),
                parentId: parent?.id, relationType: parent ? "derived-from" : undefined,
                status: imageState === "generating" ? "working" : imageState === "error" ? "review" : "done",
                assets, outputs: assets.length, assetSequence: imageAssetSequence(assets, code), imageState,
                generationRunId: key, imageParams: action.node.imageParams,
                imageError: action.node.imageError, imageProgress: action.node.imageProgress,
                imageCollection: action.node.imageCollection,
                imageContainerSpec: previous?.imageContainerSpec ? { ...previous.imageContainerSpec, collection: action.node.imageCollection } : undefined,
                taskProvenance: action.node.taskProvenance
            });
            next = previous ? next.map(item => item.id === id ? node : item) : [...next, node];
            if (!previous)
                freshIds.push(id);
            if (imageState === "generating")
                markImageRunStarted(id, job.startedAt, job.projectId);
            else
                markImageRunFinished(id, job.projectId);
        }
        next = preserveImageOriginsForNodes(next);
        if (visible) {
            nodesRef.current = next;
            nodeSequenceRef.current = sequence;
            setNodes(next);
            if (freshIds.length)
                flashNewCanvasNodes(freshIds);
        }
        const updated = updateProjectRun(job.projectId, current => ({ ...current, session: { ...current.session, nodes: next, nodeSequence: sequence } }));
        if (updated && job.status !== "running")
            void persistProjectSession(job.projectId, updated.session).catch(error => addEvent(`图片结果保存失败：${describeError(error)}`));
        if (job.status === "completed" && job.reviewContext?.goalId && !goalFeedbackCommitsRef.current.has(job.id)) {
            const commit = attachGoalFeedback(job, Object.values(entry.nodeIds));
            goalFeedbackCommitsRef.current.set(job.id, commit);
            void commit.then(() => { goalFeedbackSavedRef.current.add(job.id); setImageJobsRevision(value => value + 1); }, () => { });
            void commit.catch(error => { goalFeedbackCommitsRef.current.delete(job.id); addEvent(`目标反馈便签尚未保存：${describeError(error)}`); });
        }
    }
    async function attachGoalFeedback(job: BackgroundImageJob, nodeIds: string[]) {
        const goalId = String(job.reviewContext?.goalId || "");
        if (!goalId || !nodeIds.length || !window.aieyraGoals)
            return;
        const record = imageJobRecord(job.projectId, job.conversationId);
        if (!record)
            return;
        await persistProjectSession(job.projectId, record.session);
        const result = await window.aieyraGoals.execute({ projectId: job.projectId, conversationId: job.conversationId,
            action: "checkpoint", input: { goalId, key: job.id }, nodeIds });
        if (!result.ok)
            throw new Error(result.error);
        if (!result.showNote || !result.checkpoint || !result.goal)
            return;
        const visible = activeProjectIdRef.current === job.projectId && !projectTransitionRef.current;
        const latest = projectRunsRef.current[job.projectId];
        if (!visible && !latest)
            return;
        const currentNodes = visible ? nodesRef.current : latest.session.nodes;
        let note = currentNodes.find(node => node.requirement?.goalFeedback?.checkpointId === result.checkpoint!.id);
        if (!note && result.checkpoint.noteNodeId)
            return;
        if (!note) {
            const outputs = nodeIds.map(id => currentNodes.find(node => node.id === id)).filter((node): node is WorkflowNode => Boolean(node?.assets?.length));
            if (!outputs.length)
                return;
            note = buildReusableRequirement(currentNodes, "image-to-image", outputs.map(node => ({ nodeId: node.id, role: "reference" })), outputs[0], { title: "看图后，告诉我你的想法" });
            note.width = 380;
            note.height = 420;
            note.requirement!.goalFeedback = { goalId, checkpointId: result.checkpoint.id, objective: result.goal.objective,
                question: result.checkpoint.question, outputKey: JSON.stringify(result.checkpoint.outputs), keep: "", change: "" };
            const next = [...currentNodes, note];
            if (visible) {
                nodesRef.current = next;
                setNodes(next);
            }
            if (latest)
                updateProjectRun(job.projectId, value => ({ ...value, session: { ...value.session, nodes: next } }));
        }
        const savedRecord = imageJobRecord(job.projectId, job.conversationId);
        if (!savedRecord)
            throw new Error("成果反馈尚未保存，等待原项目恢复。");
        const saved = await persistProjectSession(job.projectId, savedRecord.session);
        if (saved.applied === false || saved.skippedStale)
            throw new Error("项目已有更新，成果反馈将随项目恢复重新保存。");
        const linked = await window.aieyraGoals.execute({ projectId: job.projectId, action: "link-note",
            input: { goalId, checkpointId: result.checkpoint.id, noteNodeId: note.id } });
        if (!linked.ok)
            throw new Error(linked.error);
    }
    function handleBackgroundImageProgress(payload: AgentProgress) {
        const id = payload.backgroundJobId;
        if (!id || !payload.projectId || !payload.conversationId)
            return;
        let entry = backgroundImageJobsRef.current.get(id);
        if (!entry) {
            entry = { job: payload.imageJob || { id, parentRunId: payload.parentRunId || "", projectId: payload.projectId,
                    conversationId: payload.conversationId, prompt: payload.originalPrompt || "", input: (payload.input || {}) as Record<string, unknown>,
                    status: "running", startedAt: payload.startedAtMs || Date.now(), actions: [] }, nodeIds: {},
                requirementNodeId: requirementRunParentsRef.current.get(payload.parentRunId || "") };
            backgroundImageJobsRef.current.set(id, entry);
        }
        if (entry.job.status === "cancelled")
            return;
        if (payload.imageJob)
            entry.job = payload.imageJob;
        entry.requirementNodeId ||= entry.job.taskScope?.requirement?.nodeId;
        if (payload.workflowAction) {
            entry.job.actions = mergeProjectRunActions(entry.job.actions, [payload.workflowAction]);
            commitBackgroundImageActions(entry, [payload.workflowAction]);
        }
        if (payload.phase === "background-image-start") {
            imageJobRecord(payload.projectId, payload.conversationId);
        }
        if (payload.phase === "background-image-result") {
            commitBackgroundImageActions(entry, entry.job.actions);
            const jobNodeIds = new Set(Object.values(entry.nodeIds));
            if (entry.job.status !== "completed") {
                const record = imageJobRecord(payload.projectId, payload.conversationId);
                if (record) {
                    const next = record.session.nodes.map(node => jobNodeIds.has(node.id) && node.imageState === "generating"
                        ? { ...node, status: "review" as const, imageState: "error" as const, imageError: payload.summary, generationRunId: undefined } : node);
                    updateProjectRun(payload.projectId, current => ({ ...current, session: { ...current.session, nodes: next } }));
                    if (activeProjectIdRef.current === payload.projectId && !projectTransitionRef.current) {
                        nodesRef.current = next;
                        setNodes(next);
                    }
                }
            }
            for (const nodeId of jobNodeIds)
                markImageRunFinished(nodeId, payload.projectId);
            activeImageRequestIdsRef.current.delete(id);
        }
        else if (entry.job.status === "running")
            activeImageRequestIdsRef.current.set(id, payload.projectId);
        if (payload.phase === "background-image-start" || payload.phase === "background-image-result") {
            const done = entry.job.status !== "running";
            const failed = done && entry.job.status !== "completed";
            const trace = toolTraceForProgress({ ...payload, tool: "image_gen", operationId: id,
                phase: done ? failed ? "tool-error" : "tool-done" : "tool-start",
                input: entry.job.input, startedAtMs: entry.job.startedAt });
            if (!entry.job.reviewContext?.matrixProjectId)
                appendImageJobMessage(payload.projectId, payload.conversationId, {
                    id: progressToolMessageId(id), role: "assistant", content: "", createdAt: nowLabel(),
                    status: done ? failed ? "error" : "done" : "running", meta: "background-image",
                    toolTrace: trace ? { ...trace, stage: done ? "result" : "start" } : undefined
                });
            if (done) {
                const record = projectRunsRef.current[payload.projectId];
                if (record)
                    void persistProjectSession(payload.projectId, record.session).catch(error => addEvent(`图片任务保存失败：${describeError(error)}`));
            }
        }
        setImageJobsRevision(revision => revision + 1);
    }
    function publishProjectRun(record: ProjectRunRecord) {
        projectRunsRef.current = { ...projectRunsRef.current, [record.projectId]: record };
        const latest = record.progress[record.progress.length - 1];
        const summary = String(record.error || latest?.summary || latest?.brief || "").replace(/\s+/g, " ").trim().slice(0, 120);
        setProjectRunViews((current) => ({
            ...current,
            [record.projectId]: {
                projectId: record.projectId,
                conversationId: record.conversationId,
                runId: record.runId,
                status: record.status === "running" || record.status === "waiting" ? record.status : projectHasImageWork(record.projectId) ? "running" : record.status,
                startedAt: record.startedAt,
                progressCount: record.progress.length,
                summary
            }
        }));
    }
    function updateProjectRun(projectId: string, update: (current: ProjectRunRecord) => ProjectRunRecord) {
        const current = projectRunsRef.current[projectId];
        if (!current)
            return null;
        const next = update(current);
        publishProjectRun(next);
        if (activeProjectIdRef.current === projectId && !projectTransitionRef.current) {
            let conversations = conversationsRef.current;
            for (const conversation of next.session.conversations) {
                if (conversation.id === activeConversationIdRef.current ||
                    current.session.conversations.find(item => item.id === conversation.id)?.messages === conversation.messages)
                    continue;
                conversations = upsertConversation(conversations, conversation);
            }
            if (conversations !== conversationsRef.current) {
                conversationsRef.current = conversations;
                setConversations(conversations);
            }
        }
        return next;
    }
    async function acknowledgeImageReceipts(ids: string[], projectId: string, conversationId: string) {
        const bridge = window.aieyraAgent;
        if (!bridge)
            throw new Error("绘图结果已保存，等待重新连接后确认回执。");
        const result = await bridge.imageJobs({ acknowledgeIds: ids, projectId, conversationId });
        if (!result.ok)
            throw new Error("绘图结果已保存，回执尚未确认，将稍后重试。");
        for (const id of ids) {
            const entry = backgroundImageJobsRef.current.get(id);
            if (entry)
                entry.job.delivered = true;
        }
    }
    function removeProjectRun(projectId: string) {
        if (projectHasImageWork(projectId)) {
            captureActiveProjectRunSession();
            updateProjectRun(projectId, current => ({ ...current, status: "completed", pendingExecution: null }));
            return;
        }
        if (projectRunsRef.current[projectId]) {
            const nextRuns = { ...projectRunsRef.current };
            delete nextRuns[projectId];
            projectRunsRef.current = nextRuns;
        }
        setProjectRunViews((current) => {
            if (!current[projectId])
                return current;
            const next = { ...current };
            delete next[projectId];
            return next;
        });
    }
    function waitForRendererRuntimeCommit(timeoutMs = 480) {
        return new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                window.clearTimeout(timer);
                resolve();
            };
            const timer = window.setTimeout(finish, Math.max(120, timeoutMs));
            window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
        });
    }
    function startProjectRuntimeCommit<T>(projectId: string, conversationId: string, runId: string, work: () => Promise<T>): Promise<T> | null {
        if (projectTransitionRef.current ||
            activeProjectIdRef.current !== projectId ||
            activeConversationIdRef.current !== conversationId ||
            activeRunRef.current !== runId)
            return null;
        const commit = (async () => {
            const result = await work();
            await waitForRendererRuntimeCommit();
            return result;
        })();
        const commits = projectRuntimeCommitsRef.current.get(projectId) ?? new Set<Promise<unknown>>();
        commits.add(commit);
        projectRuntimeCommitsRef.current.set(projectId, commits);
        const cleanup = () => {
            const current = projectRuntimeCommitsRef.current.get(projectId);
            current?.delete(commit);
            if (current?.size === 0)
                projectRuntimeCommitsRef.current.delete(projectId);
        };
        void commit.then(cleanup, cleanup);
        return commit;
    }
    async function awaitProjectRuntimeCommits(projectId: string) {
        for (;;) {
            const commits = [...(projectRuntimeCommitsRef.current.get(projectId) ?? [])];
            if (!commits.length)
                return;
            await Promise.allSettled(commits);
        }
    }
    function commitServerUser(user: ServerUser | null) {
        serverUserRef.current = user;
        setServerUser(user);
    }
    async function acceptServerUserIdentity(user: ServerUser, isCurrent: () => boolean = () => true) {
        if (!isCurrent())
            return false;
        const previousUserId = serverUserRef.current?.id || "";
        if (previousUserId && previousUserId !== user.id) {
            setServerWallet(null);
            setServerKeyStatus(null);
            setOfficialTokens([]);
            setSelectedOfficialTokenId("");
            if (!isCurrent())
                return false;
        }
        commitServerUser(user);
        return true;
    }
    function trackedProjectRun(projectId = activeProjectIdRef.current) {
        return projectRunsRef.current[projectId] || null;
    }
    const recordDebugRenderCommit = useCallback((area: DebugRenderCommitArea) => {
        if (!AIEYRA_RUNTIME_METRICS)
            return;
        debugRenderCommitsRef.current[area] += 1;
    }, []);
    pendingAgentExecutionRef.current = pendingAgentExecution;
    queuedAgentFollowUpsRef.current = queuedAgentFollowUps;
    const mergeHoverRef = useRef<{
        intent: DragMergeIntent | null;
        timer: number;
        owner: object | null;
        element: HTMLElement | null;
    }>({ intent: null, timer: 0, owner: null, element: null });
    const dragRef = useRef<{
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
        nodeX: number;
        nodeY: number;
        moved: boolean;
        allowImageGrouping?: boolean;
        assetKey?: string;
        containerDragNodeIds?: string[];
        dropTargetId?: string;
        layerGroupId?: string;
        layerGroupStart?: Record<string, {
            x: number;
            y: number;
            anchorX: number;
            anchorY: number;
            detached: boolean;
        }>;
        selectionStart?: Record<string, {
            x: number;
            y: number;
        }>;
        pendingX?: number;
        pendingY?: number;
        frame?: number;
        nodeElement?: HTMLDivElement;
        captureElement?: HTMLElement;
        releaseListeners?: () => void;
        originalZIndex?: string;
        originalWillChange?: string;
        originalWidth?: number;
        originalHeight?: number;
        originalLayerGroup?: ImageLayerNodeGroup;
        pointerType?: string;
        startedAt?: number;
        transientEdges?: TransientNodeDragEdge[];
    } | null>(null);
    useEffect(() => {
        window.addEventListener("blur", cancelTransientCanvasInteractions);
        return () => { window.removeEventListener("blur", cancelTransientCanvasInteractions); dragRef.current?.releaseListeners?.(); window.clearTimeout(mergeHoverRef.current.timer); };
    }, []);
    const layerDragRef = useRef<{
        nodeId: string;
        layerId: string;
        pointerId: number;
        startX: number;
        startY: number;
        layerX: number;
        layerY: number;
        compositionWidth: number;
        compositionHeight: number;
        previewWidth: number;
        previewHeight: number;
        moved: boolean;
        pendingX?: number;
        pendingY?: number;
        frame?: number;
    } | null>(null);
    const regionRedrawSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const regionRedrawMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const recordLayerDetachAudit = useCallback((_entry: Omit<(typeof layerDetachAuditRef.current)[number], "at">) => {
        return;
    }, []);
    const regionRedrawPaintRef = useRef<{
        pointerId: number;
        lastX: number;
        lastY: number;
    } | null>(null);
    const regionRedrawDraftRef = useRef<RegionRedrawDraft | null>(null);
    const imageTileClickTimerRef = useRef<number | null>(null);
    const imageViewerAssetSourcesRef = useRef<Array<{
        nodeId: string;
        assetIndex: number;
    }>>([]);
    const lastNodeDragEndRef = useRef<{
        nodeId: string;
        endedAt: number;
    } | null>(null);
    const internalAssetDragRef = useRef<{
        dragId: string;
        nodeId: string;
        assetIndex: number;
        assetKey: string;
        startedAt: number;
        diagnosticId?: string;
    } | null>(null);
    const nativeAssetDropTraceRef = useRef<{
        diagnosticId: string;
        sourceNodeId: string;
        targetContainerId: string;
        status: "pending" | "done" | "error";
        result?: {
            ok: boolean;
            nodeId?: string;
            error?: string;
        };
    } | null>(null);
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const canvasStageRef = useRef<HTMLDivElement | null>(null);
    const edgeZoomUpdatesRef = useRef(new Map<string, (scale: number) => void>());
    const lastCanvasElementRef = useRef<HTMLDivElement | null>(null);
    const canvasResizeRebaseRefreshRef = useRef<() => void>(() => undefined);
    function currentNodeSelection(): NodeSelectionState {
        return {
            primaryId: selectedNodeIdRef.current,
            ids: [...selectedNodeIdsRef.current]
        };
    }
    function commitNodeSelection(next: NodeSelectionState, gesture: string) {
        const samePrimary = selectedNodeIdRef.current === next.primaryId;
        const sameIds = selectedNodeIdsRef.current.length === next.ids.length &&
            selectedNodeIdsRef.current.every((id, index) => id === next.ids[index]);
        if (samePrimary && sameIds) {
            selectionGestureRef.current = gesture;
            return;
        }
        selectionRetargetIntentRef.current = null;
        explicitViewportIntentRef.current = "";
        selectedNodeIdRef.current = next.primaryId;
        selectedNodeIdsRef.current = [...next.ids];
        selectionGestureRef.current = gesture;
        if (!samePrimary)
            setPrimarySelectedNodeId(next.primaryId);
        if (!sameIds)
            setSelectedNodeIds([...next.ids]);
    }
    function applyNodeSelection(action: NodeSelectionAction, gesture: string, validateAvailableIds = false) {
        const availableIds = validateAvailableIds
            ? new Set(nodesRef.current.map((node) => node.id))
            : undefined;
        commitNodeSelection(reduceNodeSelection(currentNodeSelection(), action, availableIds), gesture);
    }
    function replaceSelectedNodeId(value: string | ((current: string) => string)) {
        const current = selectedNodeIdRef.current;
        const next = typeof value === "function" ? value(current) : value;
        applyNodeSelection(next ? { type: "replace", id: next } : { type: "clear" }, "explicit-replace");
    }
    function setSelectedNodeId(value: string | ((current: string) => string)) {
        const current = selectedNodeIdRef.current;
        const next = typeof value === "function" ? value(current) : value;
        applyNodeSelection(next ? { type: "focus", id: next } : { type: "clear" }, "programmatic-focus");
    }
    function selectNodeFromPlainClick(nodeId: string, gesture = "plain-click") {
        selectionRetargetIntentRef.current = null;
        applyNodeSelection({ type: "focus", id: nodeId }, gesture, true);
        return true;
    }
    function removeNodeIdsFromSelection(removeIds: Set<string>) {
        applyNodeSelection({ type: "remove", ids: [...removeIds] }, "remove-nodes");
    }
    function selectCanvas() {
        applyNodeSelection({ type: "clear" }, "explicit-clear");
    }
    function selectNodeGroup(ids: string[], requestedPrimaryId = "") {
        applyNodeSelection({ type: "replace-group", ids, primaryId: requestedPrimaryId }, "group-replace", true);
    }
    function toggleNodeSelection(nodeId: string) {
        selectionRetargetIntentRef.current = null;
        applyNodeSelection({ type: "toggle", id: nodeId }, "modifier-toggle", true);
    }
    const setNodes = useStableEvent((update: React.SetStateAction<WorkflowNode[]>) => {
        const next = typeof update === "function" ? update(nodesRef.current) : update;
        nodesRef.current = next;
        setNodesState(next);
        const snapshot = canvasHistoryCaptureRef.current;
        if (snapshot && snapshot === canvasUndoRef.current && snapshot.projectId === activeProjectIdRef.current)
            snapshot.afterNodes = next.map(cloneWorkflowNode);
    });
    const setLayoutGroups = useStableEvent((update: React.SetStateAction<ImageLayoutGroup[]>) => {
        const next = typeof update === "function" ? update(layoutGroupsRef.current) : update;
        layoutGroupsRef.current = next;
        setLayoutGroupsState(next);
        const snapshot = canvasHistoryCaptureRef.current;
        if (snapshot && snapshot === canvasUndoRef.current && snapshot.projectId === activeProjectIdRef.current)
            snapshot.afterGroups = next.map(group => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
    });
    function captureCanvasHistorySnapshot(label: string): CanvasHistorySnapshot {
        return {
            label,
            nodes: nodesRef.current.map(cloneWorkflowNode),
            layoutGroups: layoutGroupsRef.current.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] })),
            selection: currentNodeSelection()
        };
    }
    function pushCanvasHistory(label: string) {
        const old = canvasUndoRef.current;
        if (old?.trashToken && old.projectId)
            void window.aieyraConfig?.forgetProjectContent?.({ projectId: old.projectId, token: old.trashToken });
        const snapshot = captureCanvasHistorySnapshot(label);
        snapshot.projectId = activeProjectIdRef.current;
        snapshot.afterNodes = snapshot.nodes.map(cloneWorkflowNode);
        snapshot.afterGroups = snapshot.layoutGroups.map(group => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
        canvasUndoRef.current = snapshot;
        canvasHistoryCaptureRef.current = snapshot;
        queueMicrotask(() => { if (canvasHistoryCaptureRef.current === snapshot)
            canvasHistoryCaptureRef.current = null; });
    }
    function restoreCanvasHistorySnapshot(snapshot: CanvasHistorySnapshot, gesture: string) {
        cancelTransientCanvasInteractions();
        const restoredNodes = snapshot.afterNodes ? undoCanvasChanges(snapshot.nodes, snapshot.afterNodes, nodesRef.current) : snapshot.nodes.map(cloneWorkflowNode);
        const restoredGroups = snapshot.afterGroups ? undoCanvasChanges(snapshot.layoutGroups, snapshot.afterGroups, layoutGroupsRef.current)
            : snapshot.layoutGroups.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
        const restoredNodeIds = new Set(restoredNodes.map((node) => node.id));
        recordImageToolNodeRemovals(nodesRef.current.filter((node) => !restoredNodeIds.has(node.id)).map((node) => node.id));
        nodesRef.current = restoredNodes;
        layoutGroupsRef.current = restoredGroups;
        setNodes(restoredNodes);
        setLayoutGroups(restoredGroups);
        commitNodeSelection(reduceNodeSelection(snapshot.selection, { type: "replace-group", ids: snapshot.selection.ids, primaryId: snapshot.selection.primaryId }, new Set(restoredNodes.map((node) => node.id))), gesture);
        setCanvasMenu(null);
    }
    async function undoCanvasCommand() {
        const snapshot = canvasUndoRef.current;
        if (!snapshot || fileActionBusyRef.current || snapshot.projectId && snapshot.projectId !== activeProjectIdRef.current)
            return false;
        if (snapshot.trashToken) {
            commitFileActionBusy(true);
            try {
                const result = await window.aieyraConfig?.restoreProjectContent?.({ projectId: activeProjectIdRef.current, token: snapshot.trashToken });
                if (!result?.ok) {
                    setServerMessage(`恢复成品失败：${result?.error || "桌面文件服务不可用"}`);
                    return false;
                }
            }
            finally {
                commitFileActionBusy(false);
            }
        }
        canvasUndoRef.current = null;
        restoreCanvasHistorySnapshot(snapshot, "undo");
        for (const entry of backgroundImageJobsRef.current.values()) {
            if (entry.job.projectId === activeProjectIdRef.current && Object.values(entry.nodeIds).some(id => snapshot.nodes.some(node => node.id === id) && !snapshot.afterNodes?.some(node => node.id === id))) {
                commitBackgroundImageActions(entry, entry.job.actions);
            }
        }
        const restoredManual = nodesRef.current.map(node => {
            const key = `${activeProjectIdRef.current}:${node.id}`;
            const completed = removedManualImageResultsRef.current.get(key);
            if (!completed || !snapshot.nodes.some(item => item.id === node.id) || snapshot.afterNodes?.some(item => item.id === node.id))
                return node;
            removedManualImageResultsRef.current.delete(key);
            return { ...completed, x: node.x, y: node.y, title: node.title, zOrder: node.zOrder };
        });
        if (restoredManual.some((node, index) => node !== nodesRef.current[index]))
            setNodes(restoredManual);
        addEvent(`撤销：${snapshot.label}`);
        return true;
    }
    function trimIdentityMap<T>(map: Map<string, T>, limit = 192) {
        while (map.size > limit) {
            const oldest = map.keys().next().value;
            if (typeof oldest !== "string")
                break;
            map.delete(oldest);
        }
    }
    function rememberCompletedLocalToolOperation(operationId: string) {
        completedLocalToolOperationsRef.current.add(operationId);
        while (completedLocalToolOperationsRef.current.size > 192) {
            const oldest = completedLocalToolOperationsRef.current.values().next().value;
            if (typeof oldest !== "string")
                break;
            completedLocalToolOperationsRef.current.delete(oldest);
        }
    }
    function progressToolMessageKey(operationId: string) {
        return String(operationId || "active-tool")
            .replace(/[^a-zA-Z0-9_-]+/g, "-")
            .slice(0, 96) || "active-tool";
    }
    function progressToolMessageId(operationId: string) {
        return `progress-tool-${progressToolMessageKey(operationId)}`;
    }
    function progressToolLegacyMessageIds(operationId: string) {
        const key = progressToolMessageKey(operationId);
        return [`progress-tool-${key}-start`, `progress-tool-${key}-result`];
    }
    function progressToolMessageMatches(message: AgentMessage, operationId: string) {
        const id = progressToolMessageId(operationId);
        return message.id === id || progressToolLegacyMessageIds(operationId).includes(message.id) || (message.meta === "progress" && String(message.toolTrace?.operationId || "").trim() === operationId);
    }
    function clearLocalToolTimelineScope() {
        cancelAgentStreamFlush();
        pendingAgentStreamMessagesRef.current.clear();
        toolTimelineAliasesRef.current.clear();
        pendingImageToolResultsRef.current.clear();
        pendingImageToolSettlementsRef.current.clear();
        completedLocalToolOperationsRef.current.clear();
        renderedLocalToolOperationsRef.current.clear();
        imageToolCommitEvidenceRef.current.clear();
        pendingLayerNarrationRunIdsRef.current.clear();
        lastTimelineMessageRef.current = "";
    }
    function cancelAgentStreamFlush() {
        if (agentStreamFlushTimerRef.current === null)
            return;
        window.clearTimeout(agentStreamFlushTimerRef.current);
        agentStreamFlushTimerRef.current = null;
    }
    function flushPendingAgentStreamMessages() {
        cancelAgentStreamFlush();
        const pending = [...pendingAgentStreamMessagesRef.current.values()];
        if (pending.length === 0)
            return;
        pendingAgentStreamMessagesRef.current.clear();
        setMessages((current) => pending.reduce((nextMessages, message) => appendStreamingAgentMessage(nextMessages, message), current));
    }
    function queueAgentStreamMessage(message: AgentMessage) {
        const current = pendingAgentStreamMessagesRef.current.get(message.id);
        pendingAgentStreamMessagesRef.current.set(message.id, current
            ? {
                ...current,
                ...message,
                content: `${current.content || ""}${message.content || ""}`
            }
            : message);
        if (agentStreamFlushTimerRef.current === null) {
            agentStreamFlushTimerRef.current = window.setTimeout(flushPendingAgentStreamMessages, 32);
        }
    }
    function recordImageToolCommitEvidence(_operationId: string, _patch: Partial<ImageToolCommitEvidence>) {
        return;
    }
    function recordImageToolNodeRemovals(_removedIds: Iterable<string>) {
        return;
    }
    function settleDeferredImageToolResult(requestedOperationId: string, outcome: {
        status: "done" | "error";
        summary?: string;
        detail?: string;
    }, fallbackProgress?: AgentProgress) {
        const operationId = String(requestedOperationId || "").trim();
        if (!operationId)
            return false;
        if (renderedLocalToolOperationsRef.current.has(operationId))
            return true;
        const pending = pendingImageToolResultsRef.current.get(operationId) ?? fallbackProgress ?? {
            runId: operationId,
            phase: outcome.status === "error" ? "tool-error" : "tool-done",
            tool: "image_gen",
            operationId,
            toolRunId: operationId,
            operation: "layers",
            input: { operation: "layers" },
            summary: outcome.summary || (outcome.status === "error" ? "分层 PNG 本地处理失败。" : "分层 PNG 已完成。"),
            detail: outcome.detail,
            createdAt: new Date().toISOString()
        };
        const settledProgress: AgentProgress = {
            ...pending,
            phase: outcome.status === "error" ? "tool-error" : "tool-done",
            operationId,
            toolRunId: operationId,
            summary: outcome.summary || pending.summary,
            detail: outcome.detail ?? pending.detail,
            createdAt: new Date().toISOString()
        };
        const trace = toolTraceForProgress(settledProgress);
        if (!trace)
            return false;
        const messageId = progressToolMessageId(operationId);
        const isError = outcome.status === "error";
        const settledOperation = progressInputOperation(settledProgress) || String(settledProgress.operation || "");
        recordImageToolCommitEvidence(operationId, {
            operation: settledOperation,
            resultCardScheduledAt: Date.now(),
            ...(isError ? { error: outcome.summary || "图片任务执行失败。" } : {})
        });
        setMessages((current) => {
            const existingIndex = current.findIndex((message) => progressToolMessageMatches(message, operationId));
            const resultMessage: AgentMessage = {
                id: messageId,
                role: "assistant",
                content: "",
                createdAt: existingIndex >= 0 ? current[existingIndex].createdAt : nowLabel(),
                status: isError ? "error" : "done",
                meta: "progress",
                toolTrace: {
                    ...trace,
                    stage: "result",
                    operationId,
                    brief: "",
                    prompts: undefined,
                    completionText: trace.completionText || (isError ? "执行失败" : "图片生成完成")
                }
            };
            const withoutDuplicates = current.filter((message, index) => {
                if (!progressToolMessageMatches(message, operationId))
                    return true;
                return index === existingIndex;
            });
            if (existingIndex < 0)
                return [...withoutDuplicates, resultMessage];
            return withoutDuplicates.map((message) => progressToolMessageMatches(message, operationId) ? resultMessage : message);
        });
        setAgentProgress((current) => [...current, settledProgress].slice(-48));
        pendingImageToolResultsRef.current.delete(operationId);
        rememberCompletedLocalToolOperation(operationId);
        renderedLocalToolOperationsRef.current.add(operationId);
        while (renderedLocalToolOperationsRef.current.size > 192) {
            const oldest = renderedLocalToolOperationsRef.current.values().next().value;
            if (typeof oldest !== "string")
                break;
            renderedLocalToolOperationsRef.current.delete(oldest);
        }
        scheduleAgentFeedBottomSettle();
        return true;
    }
    async function waitForCanvasNodeCommit(nodeId: string, attempts = 120) {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            if (document.querySelector(`.flow-node[data-node-id="${CSS.escape(nodeId)}"]`))
                return true;
            await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        }
        return false;
    }
    async function waitForCanvasImageCommit(nodeId: string) {
        let element: HTMLElement | null = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            element = document.querySelector<HTMLElement>(`.flow-node[data-node-id="${CSS.escape(nodeId)}"]`);
            if (element)
                break;
            await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        }
        const expectedRendered = renderedNodesRef.current.some((node) => node.id === nodeId);
        if (!element) {
            return {
                visible: false,
                previewReady: false,
                expectedRendered,
                settleReason: expectedRendered ? "visibility-timeout" as const : "virtualized" as const
            };
        }
        const preview = element.querySelector<HTMLImageElement>(".node-image-preview img");
        if (!preview) {
            return { visible: true, previewReady: false, expectedRendered, settleReason: "node-visible" as const };
        }
        const isReady = () => preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0;
        if (!isReady()) {
            await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled)
                        return;
                    settled = true;
                    window.clearTimeout(timer);
                    preview.removeEventListener("load", finish);
                    preview.removeEventListener("error", finish);
                    resolve();
                };
                const timer = window.setTimeout(finish, 1200);
                preview.addEventListener("load", finish, { once: true });
                preview.addEventListener("error", finish, { once: true });
                void preview.decode?.().then(finish, finish);
            });
        }
        return {
            visible: true,
            previewReady: isReady(),
            expectedRendered,
            settleReason: isReady() ? "preview-ready" as const : "node-visible" as const
        };
    }
    function scheduleImageToolResultAfterCanvasCommit(operationId: string, progress: AgentProgress) {
        const id = String(operationId || "").trim();
        if (!id || pendingImageToolSettlementsRef.current.has(id) || renderedLocalToolOperationsRef.current.has(id))
            return;
        pendingImageToolSettlementsRef.current.add(id);
        while (pendingImageToolSettlementsRef.current.size > 48) {
            const oldest = pendingImageToolSettlementsRef.current.values().next().value;
            if (typeof oldest !== "string")
                break;
            pendingImageToolSettlementsRef.current.delete(oldest);
        }
        void (async () => {
            try {
                let committedNodeId = "";
                for (let attempt = 0; attempt < 120; attempt += 1) {
                    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
                    const candidateId = agentToolNodeIdsRef.current[id] || "";
                    const candidate = candidateId ? nodesRef.current.find((node) => node.id === candidateId) : undefined;
                    if (!candidate || candidate.imageState === "generating")
                        continue;
                    committedNodeId = candidate.id;
                    break;
                }
                if (!committedNodeId) {
                    recordImageToolCommitEvidence(id, {
                        operation: progressInputOperation(progress) || String(progress.operation || ""),
                        settleReason: "commit-only",
                        visibilityTimedOut: true,
                        error: "图片结果已返回，但画布成果未在 3 秒内提交。"
                    });
                    settleDeferredImageToolResult(id, { status: "done", summary: progress.summary, detail: typeof progress.detail === "string" ? progress.detail : undefined }, progress);
                    return;
                }
                const committedAt = Date.now();
                recordImageToolCommitEvidence(id, {
                    operation: progressInputOperation(progress) || String(progress.operation || ""),
                    nodeCommitAt: committedAt,
                    nodeIds: [committedNodeId]
                });
                const readiness = await waitForCanvasImageCommit(committedNodeId);
                recordImageToolCommitEvidence(id, {
                    expectedRendered: readiness.expectedRendered,
                    ...(readiness.visible ? { nodeVisibleAt: Date.now() } : {}),
                    ...(readiness.previewReady ? { previewReadyAt: Date.now() } : {}),
                    settleReason: readiness.settleReason,
                    visibilityTimedOut: readiness.settleReason === "visibility-timeout"
                });
                settleDeferredImageToolResult(id, { status: "done", summary: progress.summary, detail: typeof progress.detail === "string" ? progress.detail : undefined }, progress);
            }
            finally {
                pendingImageToolSettlementsRef.current.delete(id);
            }
        })();
    }
    const bindCanvasRef = useCallback((element: HTMLDivElement | null) => {
        if (lastCanvasElementRef.current === element)
            return;
        lastCanvasElementRef.current = element;
        canvasRef.current = element;
        setCanvasMountTick((current) => current + 1);
    }, []);
    async function persistProjectSession(projectId: string, snapshot: StudioWorkflowSession, options: {
        allowEmptyOverwrite?: boolean;
    } = {}) {
        const flushStartedAt = performance.now();
        try {
            const currentRevision = Math.max(0, Math.floor(Number(projectSessionRevisionRef.current[projectId] ?? snapshot.sessionRevision ?? 0) || 0));
            const requestedRevision = currentRevision + 1;
            projectSessionRevisionRef.current[projectId] = requestedRevision;
            const result = await saveSessionToStore({ ...snapshot, ...options, projectId, sessionRevision: requestedRevision });
            if (!result?.ok)
                throw new Error(result?.error || "保存项目会话失败。");
            const appliedRevision = Math.max(requestedRevision, Math.floor(Number(result.appliedRevision ?? requestedRevision) || requestedRevision));
            projectSessionRevisionRef.current[projectId] = Math.max(projectSessionRevisionRef.current[projectId] ?? 0, appliedRevision);
            if (AIEYRA_RUNTIME_METRICS) {
                const durationMs = Math.max(0, performance.now() - flushStartedAt);
                const metrics = persistenceDebugMetricsRef.current;
                metrics.lastFlushMs = durationMs;
                metrics.totalFlushMs += durationMs;
                metrics.maxFlushMs = Math.max(metrics.maxFlushMs, durationMs);
                if (result.applied === false || result.skippedStale)
                    metrics.skippedWriteCount += 1;
                else
                    metrics.writeCount += 1;
            }
            return result;
        }
        catch (error) {
            if (AIEYRA_RUNTIME_METRICS) {
                const durationMs = Math.max(0, performance.now() - flushStartedAt);
                const metrics = persistenceDebugMetricsRef.current;
                metrics.failedWriteCount += 1;
                metrics.lastFlushMs = durationMs;
                metrics.totalFlushMs += durationMs;
                metrics.maxFlushMs = Math.max(metrics.maxFlushMs, durationMs);
            }
            throw error;
        }
    }
    async function persistWritingSessionState(projectId: string, session: StudioWritingSession) {
        const currentRevision = Math.max(0, Math.floor(Number(projectSessionRevisionRef.current[projectId] ?? session.sessionRevision ?? 0) || 0));
        const requestedRevision = currentRevision + 1;
        projectSessionRevisionRef.current[projectId] = requestedRevision;
        const result = await window.aieyraConfig?.saveSession({
            ...session,
            projectId,
            projectKind: "writing",
            schemaVersion: 4,
            sessionRevision: requestedRevision,
            ...({})
        });
        if (!result?.ok)
            throw new Error(result?.error || "保存 Writing 会话失败。");
        const appliedRevision = Math.max(requestedRevision, Math.floor(Number(result.appliedRevision ?? requestedRevision) || requestedRevision));
        projectSessionRevisionRef.current[projectId] = Math.max(projectSessionRevisionRef.current[projectId] ?? 0, appliedRevision);
        let resolvedSession = result.session ? normalizeWritingRendererSession(result.session) : null;
        if (activeProjectIdRef.current === projectId) {
            const current = writingSessionRef.current;
            const authoritativeIsCurrent = Boolean(resolvedSession) &&
                Number(resolvedSession?.sessionRevision || 0) >= Number(current.sessionRevision || 0);
            const next: StudioWritingSession = {
                ...current,
                ...(authoritativeIsCurrent && resolvedSession ? {
                    schemaVersion: resolvedSession.schemaVersion,
                    projectKind: "writing" as const,
                    artifacts: resolvedSession.artifacts,
                    artifactEdges: resolvedSession.artifactEdges,
                    artifactLayout: resolvedSession.artifactLayout,
                    artifactViewport: resolvedSession.artifactViewport
                } : {}),
                sessionRevision: Math.max(current.sessionRevision || 0, appliedRevision)
            };
            writingSessionRef.current = next;
            setWritingSession(next);
            resolvedSession = next;
        }
        return { ...result, ...(resolvedSession ? { session: resolvedSession } : {}) };
    }
    async function persistLineageSessionState(projectId: string, session: StudioLineageSession) {
        const currentRevision = Math.max(0, Math.floor(Number(projectSessionRevisionRef.current[projectId] ?? session.sessionRevision ?? 0) || 0));
        const requestedRevision = currentRevision + 1;
        projectSessionRevisionRef.current[projectId] = requestedRevision;
        const result = await window.aieyraConfig?.saveSession({
            ...session,
            projectId,
            projectKind: session.projectKind,
            schemaVersion: 4,
            sessionRevision: requestedRevision
        });
        if (!result?.ok)
            throw new Error(result?.error || "保存 Lineage 会话失败。");
        const appliedRevision = Math.max(requestedRevision, Math.floor(Number(result.appliedRevision ?? requestedRevision) || requestedRevision));
        projectSessionRevisionRef.current[projectId] = Math.max(projectSessionRevisionRef.current[projectId] ?? 0, appliedRevision);
        let resolvedSession = result.session ? await normalizeLineageRendererSession(result.session, session.projectKind) : null;
        if (activeProjectIdRef.current === projectId) {
            const current = lineageSessionRef.current;
            const authoritativeIsCurrent = Boolean(resolvedSession) &&
                Number(resolvedSession?.sessionRevision || 0) >= Number(current.sessionRevision || 0);
            const liveSelectionAdvanced = current.selectedLineageArtifactId !== session.selectedLineageArtifactId;
            const preservedLiveSelection = liveSelectionAdvanced && resolvedSession?.lineageArtifacts.some((artifact) => artifact.id === current.selectedLineageArtifactId)
                ? current.selectedLineageArtifactId
                : resolvedSession?.selectedLineageArtifactId || "";
            const next: StudioLineageSession = {
                ...current,
                ...(authoritativeIsCurrent && resolvedSession ? {
                    schemaVersion: resolvedSession.schemaVersion,
                    projectKind: resolvedSession.projectKind,
                    lineageRevision: resolvedSession.lineageRevision,
                    lineageArtifacts: resolvedSession.lineageArtifacts,
                    lineageEdges: resolvedSession.lineageEdges,
                    lineageLayout: resolvedSession.lineageLayout,
                    lineageViewport: resolvedSession.lineageViewport,
                    selectedLineageArtifactId: preservedLiveSelection
                } : {}),
                sessionRevision: Math.max(current.sessionRevision || 0, appliedRevision)
            };
            lineageSessionRef.current = next;
            setLineageSession(next);
            resolvedSession = next;
        }
        return { ...result, ...(resolvedSession ? { session: resolvedSession } : {}) };
    }
    useEffect(() => {
        if (configReady)
            return;
        let cancelled = false;
        setConfigError("");
        // One read per attempt, including StrictMode effect re-entry. OS owns
        // runtime readiness; the canvas only restores its local settings/session.
        startupRequest.current ||= (async () => {
            markPerformancePhase("config-load-start");
            bootLog("canvas restore start");
            if (window.aieyraConfig?.loadCanvas) {
                const canvas = await window.aieyraConfig.loadCanvas();
                if (!canvas.ok || !canvas.activeProjectId || !canvas.session)
                    throw Error(canvas.error || "画布资料暂时不可用，原资料已保留。");
                return { settings: mergeSettings(canvas.settings), canvas };
            }
            const [settings, session] = await Promise.all([loadSettingsFromStore(), loadSessionFromStore()]);
            return { settings, canvas: { ok: true, session } };
        })();
        void startupRequest.current.then(async ({ settings, canvas }) => {
            if (cancelled)
                return;
            setSettings(settings);
            const applyStarted = performance.now();
            await applyProjectSession(canvas);
            if (cancelled)
                return;
            setConfigReady(true);
            window.dispatchEvent(new CustomEvent("workspace-metric", { detail: { stage: "canvas-applied", metrics: { durationMs: performance.now() - applyStarted, nodeCount: canvas.session?.nodes?.length || 0 } } }));
            markPerformancePhase("config-ready-scheduled");
            bootLog("canvas restore done");
        }).catch(error => {
            if (!cancelled) {
                setConfigError(describeError(error));
                window.dispatchEvent(new CustomEvent("workspace-error", { detail: { stage: "restore", error } }));
                bootLog("canvas restore failed");
            }
        });
        return () => { cancelled = true; };
    }, [configReady, configAttempt]);
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        // 第109轮 R15：嵌入 OS 时固定深色，与 OS 一致；还原时改回 settings.theme。
        const apply = () => applyTheme("dark");
        apply();
        if (settings.theme !== "system")
            return;
        media.addEventListener("change", apply);
        return () => media.removeEventListener("change", apply);
    }, [settings.theme]);
    useEffect(() => {
        if (!configReady)
            return;
        let second = 0, timer = 0;
        const first = window.requestAnimationFrame(() => {
            second = window.requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent("workspace-metric", { detail: { stage: "first-frame", metrics: { durationMs: performance.now() - mainBootStartedAt, nodeCount: nodesRef.current.length, domNodes: document.querySelectorAll(".flow-node").length } } }));
                timer = window.setTimeout(() => setBackgroundReady(true), 0);
            });
        });
        return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); window.clearTimeout(timer); };
    }, [configReady]);
    useEffect(() => {
        const updater = window.aieyraUpdater;
        if (!backgroundReady || !updater)
            return;
        let disposed = false, request = 0;
        const refresh = async () => {
            const current = ++request;
            const result = await updater.status().catch(() => null);
            if (!disposed && current === request && result?.ok)
                setDesktopUpdateNotice(result);
        };
        void refresh();
        const offMatrixUpdates = window.aieyraMatrix?.onChanged?.(event => { if (event.kind === "updates")
            void refresh(); });
        const off = updater.onProgress?.(progress => {
            if (["checked", "ready", "error"].includes(progress.stage))
                void refresh();
        });
        return () => {
            disposed = true;
            ++request;
            off?.();
            offMatrixUpdates?.();
        };
    }, [backgroundReady]);
    useEffect(() => {
        if (!layoutGroups.length && !layoutGroupsRef.current.length)
            return;
        if (nodesRef.current !== nodes || layoutGroupsRef.current !== layoutGroups)
            return;
        const normalized = normalizeImageLayoutState({ nodes, groups: layoutGroups });
        if (normalized.changed) {
            layoutGroupsRef.current = normalized.groups;
            setLayoutGroups(normalized.groups);
            return;
        }
        layoutGroupsRef.current = layoutGroups;
    }, [layoutGroups, nodes]);
    useEffect(() => {
        if (!configReady)
            return;
        const activeRecord = projects.find((project) => project.id === (activeProjectId || activeProjectIdRef.current));
        if (activeRecord && activeRecord.kind !== "image")
            return;
        if (activeRecord?.quarantine?.readOnly)
            return;
        if (skipInitialSessionAutosaveRef.current) {
            skipInitialSessionAutosaveRef.current = false;
            return;
        }
        const projectId = activeProjectId || activeProjectIdRef.current || "default";
        let flushStarted = false;
        if (AIEYRA_RUNTIME_METRICS) {
            persistenceDebugMetricsRef.current.mutationCount += 1;
            persistenceDebugMetricsRef.current.scheduledWriteCount += 1;
        }
        const nodeCount = Array.isArray(nodes) ? nodes.length : 0;
        const debounceMs = nodeCount > 300 ? 1200 : nodeCount > 120 ? 600 : 320;
        let timer = 0;
        const saveLatest = () => {
            if (activeProjectIdRef.current !== projectId)
                return;
            if (projectSessionApplyRef.current > 0) {
                timer = window.setTimeout(saveLatest, 100);
                return;
            }
            flushStarted = true;
            const snapshot = buildWorkflowSessionSnapshot({ schemaVersion: 3, nodeSequence: nodeSequenceRef.current, canvasRevision: canvasRevisionRef.current,
                layoutGroups: layoutGroupsRef.current, messages: messagesRef.current, conversations: conversationsRef.current,
                activeConversationId: activeConversationIdRef.current, nodes: nodesRef.current,
                selectedNodeId: selectedNodeIdRef.current, pendingAgentExecution: pendingAgentExecutionRef.current });
            persistProjectSession(projectId, snapshot).catch((error) => console.error("save session failed", error));
        };
        timer = window.setTimeout(saveLatest, debounceMs);
        return () => {
            window.clearTimeout(timer);
            if (AIEYRA_RUNTIME_METRICS && !flushStarted)
                persistenceDebugMetricsRef.current.coalescedWriteCount += 1;
        };
    }, [messages, conversations, activeConversationId, nodes, layoutGroups, selectedNodeId, pendingAgentExecution, activeProjectId, configReady, projects]);
    useEffect(() => {
        writeJson(STORAGE_LAYOUT, workspaceLayout);
    }, [workspaceLayout]);
    useLayoutEffect(() => {
        const canvasElement = canvasRef.current;
        if (!canvasElement)
            return;
        const syncCanvasViewportSize = () => {
            const rect = canvasElement.getBoundingClientRect();
            const nextSize = {
                width: Math.max(1, Math.round(rect.width)),
                height: Math.max(1, Math.round(rect.height))
            };
            const previousSize = canvasViewportSizeRef.current;
            if (previousSize.width === nextSize.width && previousSize.height === nextSize.height)
                return false;
            canvasViewportSizeRef.current = nextSize;
            setCanvasViewportSize(nextSize);
            return true;
        };
        const initialMeasurement = syncCanvasViewportSize();
        const dispose = observeCanvasPlatformResizeRebase(canvasElement, () => viewportRef.current, (nextViewport) => {
            viewportRef.current = nextViewport;
            setViewport(nextViewport);
            syncCanvasViewportSize();
            scheduleFocusedNodeRefit();
        }, () => canvasElement.classList.contains("is-viewport-interacting"), canvasElement.closest(".ide-main"));
        const refresh = dispose.refresh;
        canvasResizeRebaseRefreshRef.current = refresh;
        if (initialMeasurement)
            scheduleFocusedNodeRefit();
        return () => {
            if (canvasResizeRebaseRefreshRef.current === refresh) {
                canvasResizeRebaseRefreshRef.current = () => undefined;
            }
            dispose();
            if (layoutRefocusTimerRef.current) {
                window.clearTimeout(layoutRefocusTimerRef.current);
                layoutRefocusTimerRef.current = null;
            }
        };
    }, [canvasMountTick]);
    useLayoutEffect(() => {
        canvasResizeRebaseRefreshRef.current();
    }, [agentCollapsed, canvasMountTick, projectSidebarCollapsed]);
    function settleAgentFeedBottom() {
        const endNode = agentEndRef.current;
        endNode?.scrollIntoView({ behavior: "auto", block: "end" });
    }
    function scheduleAgentFeedBottomSettle() {
        const frame = window.requestAnimationFrame(settleAgentFeedBottom);
        return () => {
            window.cancelAnimationFrame(frame);
        };
    }
    useEffect(() => {
        if (!viewportInteractionActiveRef.current)
            viewportRef.current = viewport;
    }, [viewport]);
    useEffect(() => {
        if (!configReady)
            return;
        canvasRevisionRef.current = Math.max(1, canvasRevisionRef.current + 1);
    }, [configReady, layoutGroups, nodes]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);
    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);
    useEffect(() => {
        agentProgressRef.current = agentProgress;
    }, [agentProgress]);
    useEffect(() => {
        agentStatusRef.current = agentStatus;
    }, [agentStatus]);
    useEffect(() => {
        if (activeProjectIdRef.current !== activeProjectId)
            explicitViewportIntentRef.current = "";
        activeProjectIdRef.current = activeProjectId;
    }, [activeProjectId]);
    useEffect(() => {
        projectsRef.current = projects;
    }, [projects]);
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);
    useEffect(() => {
        selectedNodeIdRef.current = selectedNodeId;
    }, [selectedNodeId]);
    useEffect(() => {
        regionRedrawDraftRef.current = regionRedrawDraft;
    }, [regionRedrawDraft]);
    useEffect(() => () => {
        if (imageTileClickTimerRef.current !== null)
            window.clearTimeout(imageTileClickTimerRef.current);
        cancelAgentStreamFlush();
        pendingAgentStreamMessagesRef.current.clear();
    }, []);
    useEffect(() => {
        const nodeId = regionRedrawDraft?.nodeId;
        const assetIndex = regionRedrawDraft?.assetIndex ?? 0;
        if (!nodeId)
            return;
        let cancelled = false;
        const load = async () => {
            try {
                const node = nodesRef.current.find((item) => item.id === nodeId);
                const asset = node?.assets?.[assetIndex];
                if (!asset)
                    throw new Error("AI 图片编辑来源图片不存在。");
                const source = await imageAssetCanvasSrc(asset);
                const image = await loadImageForCanvas(source);
                if (cancelled)
                    return;
                const sourceCanvas = regionRedrawSourceCanvasRef.current;
                const maskCanvas = regionRedrawMaskCanvasRef.current;
                if (!sourceCanvas || !maskCanvas)
                    throw new Error("AI 图片编辑画布尚未就绪。");
                const width = Math.max(1, image.naturalWidth || image.width);
                const height = Math.max(1, image.naturalHeight || image.height);
                sourceCanvas.width = width;
                sourceCanvas.height = height;
                maskCanvas.width = width;
                maskCanvas.height = height;
                const sourceContext = sourceCanvas.getContext("2d");
                const maskContext = maskCanvas.getContext("2d");
                if (!sourceContext || !maskContext)
                    throw new Error("当前环境不支持 AI 图片编辑画布。");
                sourceContext.clearRect(0, 0, width, height);
                sourceContext.drawImage(image, 0, 0, width, height);
                maskContext.clearRect(0, 0, width, height);
                setRegionRedrawDraft((current) => current && current.nodeId === nodeId
                    ? { ...current, sourceWidth: width, sourceHeight: height, ready: true, error: undefined }
                    : current);
            }
            catch (error) {
                if (cancelled)
                    return;
                const message = friendlyImageError(error);
                setRegionRedrawDraft((current) => current && current.nodeId === nodeId ? { ...current, ready: false, error: message } : current);
            }
        };
        void load();
        return () => {
            cancelled = true;
            regionRedrawPaintRef.current = null;
        };
    }, [regionRedrawDraft?.nodeId, regionRedrawDraft?.assetIndex]);
    useEffect(() => {
        if (!window.aieyraAgent?.onProgress)
            return;
        return window.aieyraAgent.onProgress((payload) => {
            if (payload.backgroundJobId) {
                handleBackgroundImageProgress(payload);
                return;
            }
            const progressProjectId = String(payload.projectId || "").trim();
            const progressConversationId = String(payload.conversationId || "").trim();
            const progressRunId = String(payload.runId || "").trim();
            const tracked = progressProjectId
                ? projectRunsRef.current[progressProjectId]
                : Object.values(projectRunsRef.current).find((item) => item.runId === progressRunId);
            const currentScope = !projectTransitionRef.current &&
                (!progressProjectId || progressProjectId === activeProjectIdRef.current) &&
                (!progressConversationId || progressConversationId === activeConversationIdRef.current) &&
                (!progressRunId || progressRunId === activeRunRef.current);
            const requirementParentId = progressRunId ? requirementRunParentsRef.current.get(progressRunId) : undefined;
            const scopedWorkflowAction = payload.workflowAction
                ? requirementParentId
                    ? parentImageActionToRequirement(payload.workflowAction, requirementParentId)
                    : payload.workflowAction
                : null;
            if (tracked && (!progressRunId || tracked.runId === progressRunId)) {
                const keepProgress = !payload.internalOnly && payload.phase !== "model-thinking-delta" && payload.phase !== "assistant-message-delta";
                updateProjectRun(tracked.projectId, (current) => ({
                    ...current,
                    progress: keepProgress ? [...current.progress, payload].slice(-48) : current.progress,
                    queuedActions: scopedWorkflowAction && !currentScope
                        ? mergeProjectRunActions(current.queuedActions, [scopedWorkflowAction])
                        : current.queuedActions
                }));
            }
            if (!currentScope)
                return;
            const operationId = resolveToolTimelineOperationId(toolTimelineAliasesRef.current, payload);
            trimIdentityMap(toolTimelineAliasesRef.current);
            const timelinePayload = operationId && (String(payload.operationId || "") !== operationId || String(payload.toolRunId || "") !== operationId)
                ? {
                    ...payload,
                    operationId,
                    childTaskId: payload.childTaskId || (payload.toolRunId && payload.toolRunId !== operationId ? payload.toolRunId : undefined),
                    toolRunId: operationId
                }
                : payload;
            const timelineOperation = progressInputOperation(timelinePayload) || String(timelinePayload.operation || "");
            const isImageTool = String(timelinePayload.tool || "") === "image_gen";
            const layerImageResponse = payload.phase === "image-response" && isImageTool && timelineOperation === "layers";
            if (layerImageResponse) {
                const narrationRunId = String(payload.runId || activeRunRef.current || "").trim();
                if (narrationRunId)
                    pendingLayerNarrationRunIdsRef.current.add(narrationRunId);
            }
            if (payload.phase === "image-response" && isImageTool && operationId) {
                recordImageToolCommitEvidence(operationId, { operation: timelineOperation, runtimeImageResponseAt: Date.now() });
            }
            if (scopedWorkflowAction) {
                const commit = startProjectRuntimeCommit(progressProjectId || activeProjectIdRef.current, progressConversationId || activeConversationIdRef.current, progressRunId || activeRunRef.current || "", () => runtimeActionHandlerRef.current([scopedWorkflowAction]));
                if (commit) {
                    void commit.catch((error) => {
                        const message = describeError(error);
                        const failedProjectId = progressProjectId || activeProjectIdRef.current;
                        updateProjectRun(failedProjectId, (current) => ({
                            ...current,
                            queuedActions: mergeProjectRunActions(current.queuedActions, [scopedWorkflowAction]),
                            error: message
                        }));
                        setServerMessage(`画布成果提交暂时失败，已保留待重试：${message}`);
                    });
                }
            }
            if (payload.phase === "image-request" && isImageTool && timelineOperation === "layers" && operationId) {
                recordImageToolCommitEvidence(operationId, { operation: "layers", toolRequestAt: Date.now() });
            }
            if (isImageTool &&
                timelineOperation === "layers" &&
                operationId &&
                (payload.phase === "tool-error" || payload.phase === "image-error")) {
                failLayerExecutionPlaceholders(operationId, friendlyImageError(payload.detail || payload.summary || "分层 PNG 生成失败。"));
            }
            if (payload.internalOnly)
                return;
            if (payload.phase === "model-retry") {
                flushPendingAgentStreamMessages();
                const suffix = payload.modelRound ? `-round-${payload.modelRound}` : "";
                const retryIds = new Set([`thinking-${progressRunId}${suffix}`, `assistant-stream-${progressRunId}${suffix}`]);
                setMessages(current => current.filter(message => !retryIds.has(message.id)));
            }
            const mayDeferImageToolDone = payload.phase === "tool-done" && isImageTool;
            if (payload.phase !== "model-thinking-delta" &&
                payload.phase !== "assistant-message-delta" &&
                !mayDeferImageToolDone) {
                setAgentProgress((current) => [...current, payload].slice(-48));
            }
            if (payload.phase === "model-thinking-delta") {
                if (!activeRunRef.current || (payload.runId && payload.runId !== activeRunRef.current))
                    return;
                const delta = String(payload.delta ?? payload.text ?? payload.summary ?? "");
                if (!delta)
                    return;
                const roundSuffix = payload.modelRound ? `-round-${payload.modelRound}` : "";
                const id = `thinking-${payload.runId ?? activeRunRef.current ?? "active"}${roundSuffix}`;
                queueAgentStreamMessage({
                    id,
                    role: "assistant",
                    content: delta,
                    createdAt: nowLabel(),
                    status: "running",
                    meta: "thinking",
                    collapsed: false
                });
                return;
            }
            if (payload.phase === "assistant-message-delta") {
                if (!activeRunRef.current || (payload.runId && payload.runId !== activeRunRef.current))
                    return;
                const narrationRunId = String(payload.runId || activeRunRef.current || "").trim();
                if (narrationRunId && pendingLayerNarrationRunIdsRef.current.has(narrationRunId))
                    return;
                const delta = String(payload.delta ?? payload.text ?? payload.summary ?? "");
                if (!delta)
                    return;
                const roundSuffix = payload.modelRound ? `-round-${payload.modelRound}` : "";
                const id = `assistant-stream-${payload.runId ?? activeRunRef.current ?? "active"}${roundSuffix}`;
                queueAgentStreamMessage({
                    id,
                    role: "assistant",
                    content: delta,
                    createdAt: nowLabel(),
                    status: "running",
                    meta: "assistant-stream"
                });
                return;
            }
            flushPendingAgentStreamMessages();
            if (["model-response", "tool-start", "image-request"].includes(payload.phase)) {
                setMessages(current => current.map(message => message.meta === "assistant-stream" && message.status === "running"
                    ? { ...message, status: "done" as const } : message));
            }
            if (payload.phase === "model-thinking-done") {
                setMessages((current) => finishThinkingMessages(current, payload.runId, payload.modelRound));
                return;
            }
            const timelineText = timelineTextForProgress(timelinePayload);
            const toolTrace = toolTraceForProgress(timelinePayload);
            if (payload.phase === "image-response" && isImageTool && timelineOperation !== "layers" && timelineOperation !== "cutout" && operationId) {
                scheduleImageToolResultAfterCanvasCommit(operationId, timelinePayload);
            }
            if (mayDeferImageToolDone && operationId) {
                recordImageToolCommitEvidence(operationId, { operation: timelineOperation, runtimeToolDoneAt: Date.now() });
                if (completedLocalToolOperationsRef.current.has(operationId)) {
                    settleDeferredImageToolResult(operationId, { status: "done" }, timelinePayload);
                }
                else {
                    pendingImageToolResultsRef.current.set(operationId, timelinePayload);
                    trimIdentityMap(pendingImageToolResultsRef.current, 48);
                    if (timelineOperation !== "layers" && timelineOperation !== "cutout") {
                        scheduleImageToolResultAfterCanvasCommit(operationId, timelinePayload);
                    }
                }
                return;
            }
            if (toolTrace) {
                const isError = payload.phase === "tool-error" || payload.phase === "image-error";
                const isAwaitingUser = payload.phase === "tool-awaiting-user";
                const isDone = payload.phase === "tool-done" || payload.phase === "tool-skip" || isAwaitingUser;
                const isTerminal = isError || isDone;
                const id = progressToolMessageId(operationId || `${payload.runId || "active"}-${toolTrace.name || payload.tool || "tool"}`);
                const status: AgentMessage["status"] = isError ? "error" : isTerminal ? "done" : "running";
                setMessages((current) => {
                    const resolvedOperationId = operationId || String(toolTrace.operationId || "").trim();
                    const index = resolvedOperationId
                        ? current.findIndex((message) => progressToolMessageMatches(message, resolvedOperationId))
                        : current.findIndex((message) => message.id === id);
                    const previousTrace = index >= 0 ? current[index].toolTrace : undefined;
                    const normalizedBrief = normalizeVisibleDuplicateText(toolTrace.brief || "");
                    const duplicateAssistantBrief = !isTerminal && normalizedBrief
                        ? [...current].reverse().some((message) => message.meta === "assistant-stream" &&
                            (!payload.runId || message.id.startsWith(`assistant-stream-${payload.runId}`)) &&
                            normalizeVisibleDuplicateText(message.content) === normalizedBrief)
                        : false;
                    const nextTrace: AgentToolTrace = isTerminal
                        ? {
                            ...(previousTrace ?? {}),
                            ...toolTrace,
                            stage: "result",
                            operationId: resolvedOperationId || undefined,
                            brief: toolTrace.brief || previousTrace?.brief || "",
                            details: toolTrace.details?.length ? toolTrace.details : previousTrace?.details,
                            prompts: toolTrace.prompts?.length ? toolTrace.prompts : previousTrace?.prompts,
                            completionText: toolTrace.completionText || (isError ? "执行失败" : "执行完成")
                        }
                        : {
                            ...(previousTrace ?? toolTrace),
                            ...toolTrace,
                            stage: "start",
                            operationId: resolvedOperationId || undefined,
                            brief: duplicateAssistantBrief ? "" : (toolTrace.brief || previousTrace?.brief || ""),
                            details: toolTrace.details?.length ? toolTrace.details : previousTrace?.details,
                            prompts: toolTrace.prompts?.length ? toolTrace.prompts : previousTrace?.prompts,
                            completionText: undefined
                        };
                    const timelineMessage: AgentMessage = {
                        id,
                        role: "assistant",
                        content: "",
                        createdAt: index >= 0 ? current[index].createdAt : nowLabel(),
                        status,
                        meta: "progress",
                        toolTrace: nextTrace
                    };
                    const matches = resolvedOperationId
                        ? (message: AgentMessage) => progressToolMessageMatches(message, resolvedOperationId)
                        : (message: AgentMessage) => message.id === id;
                    const withoutDuplicates = current.filter((message, messageIndex) => !matches(message) || messageIndex === index);
                    if (index < 0)
                        return [...withoutDuplicates, timelineMessage];
                    return withoutDuplicates.map((message) => matches(message) ? timelineMessage : message);
                });
                return;
            }
            if (!timelineText) {
                if (payload.phase === "model-response") {
                    setMessages((current) => current.map((message) => (message.meta === "progress" &&
                        message.status === "running" &&
                        (!message.toolTrace?.operationId || !pendingImageToolResultsRef.current.has(message.toolTrace.operationId))
                        ? { ...message, status: "done" as const }
                        : message)));
                }
                return;
            }
            const key = `${payload.runId ?? ""}|${payload.phase}|${payload.tool ?? ""}|${payload.toolRunId ?? ""}|${timelineText}`;
            if (lastTimelineMessageRef.current === key)
                return;
            lastTimelineMessageRef.current = key;
            const isError = /error|失败|异常/i.test(payload.phase) || /失败|错误|openai_error/i.test(timelineText);
            const timelineStatus: AgentMessage["status"] = isError
                ? "error"
                : payload.phase === "tool-start" || payload.phase === "tool-poll" || payload.phase === "image-request" || payload.phase === "memory-start" || payload.phase === "model-request"
                    ? "running"
                    : "done";
            const timelineMessage: AgentMessage = {
                id: uid("progress"),
                role: "assistant",
                content: timelineText,
                createdAt: nowLabel(),
                status: timelineStatus,
                meta: "progress",
                toolTrace: undefined
            };
            if (payload.phase === "tool-poll") {
                setMessages((current) => {
                    const runningIndex = [...current].reverse().findIndex((message) => message.meta === "progress" && message.status === "running");
                    if (runningIndex < 0)
                        return [...current, timelineMessage];
                    const index = current.length - 1 - runningIndex;
                    return current.map((message, messageIndex) => messageIndex === index
                        ? {
                            ...message,
                            content: timelineText,
                            createdAt: timelineMessage.createdAt,
                            status: timelineStatus,
                            toolTrace: toolTrace ?? message.toolTrace
                        }
                        : message);
                });
                return;
            }
            setMessages((current) => [
                ...current.map((message) => (message.meta === "progress" && message.status === "running" ? { ...message, status: "done" as const } : message)),
                timelineMessage
            ]);
        });
    }, []);
    function commitConnectionSnapshot(next: ConnectionPublicSnapshot) {
        connectionSnapshotRef.current = next;
        setConnectionSnapshot(next);
        {
            setSettings((current) => mergeSettings({
                ...current,
                agentModel: next.agentModel || "",
                agentModelPool: next.agentModelPool || [],
                imageModel: next.imageModel || "",
                imageModelPool: next.imageModelPool || [],
                imageModelNotes: next.imageModelNotes,
                agentProvider: next.agentProvider,
                reasoningEffort: next.reasoningEffort,
                serviceTier: next.serviceTier,
                fastMode: next.fastMode
            }));
        }
    }
    async function refreshConnectionState() {
        if (!window.aieyraConnection?.status) {
            const local = localConnectionFallback();
            commitConnectionSnapshot(local);
            return local;
        }
        try {
            const result = await window.aieyraConnection.status();
            if (!result?.connection)
                return null;
            commitConnectionSnapshot(result.connection);
            return result.connection;
        }
        catch {
            return null;
        }
    }
    function openOSModelSettings() {
        void (window as any).aieyraApp?.invoke({ scope: "workspace", channel: "aieyra:os:configure", payload: { section: "images" } });
    }
    async function ensureAiConnectionReady(actionLabel = "AI 操作") {
        const current = await refreshConnectionState();
        if (actionLabel === "图片生成" ? Boolean(current?.imageModel) : current?.aiReady)
            return true;

        openOSModelSettings();
        setFileMenuOpen(false);

        setServerMessage(actionLabel === "图片生成"
            ? "请在 OS 设置中配置 Image Gen。"
            : "请在右上角选择画布 Agent 的模型，默认跟随 Eyra。");
        return false;
    }
    async function refreshServerState() {
        if (!window.aieyraServer?.me)
            return false;
        const refreshEpoch = ++serverRefreshEpochRef.current;
        const isCurrentRefresh = () => serverRefreshEpochRef.current === refreshEpoch;
        try {
            const me = await window.aieyraServer.me();
            if (!isCurrentRefresh() || me.stale === true)
                return false;
            if (!me.ok || !me.user) {
                const authenticationFailed = me.authError === true || /(?:请先.*登录|登录会话.*失效|unauthorized|forbidden|\b401\b|\b403\b)/i.test(me.error || "");
                if (serverUserRef.current && !authenticationFailed) {
                    if (me.error)
                        setServerMessage(`账户同步暂时失败：${accountSyncErrorMessage(me.error)}`);
                    return true;
                }
                authCheckedTokenRef.current = "";
                commitServerUser(null);
                setServerWallet(null);
                setServerKeyStatus(null);
                setOfficialTokens([]);
                setSelectedOfficialTokenId("");
                if (!isCurrentRefresh())
                    return false;
                if (me.error)
                    setServerMessage(accountSyncErrorMessage(me.error));
                return false;
            }
            setServerMessage("");
            const user = me.user;
            if (!await acceptServerUserIdentity(user, isCurrentRefresh))
                return false;
            setServerWallet(me.wallet ?? walletFromServerSettings(user, me.settings));
            setServerKeyStatus(me.keyStatus ?? null);
            setOfficialTokens(me.tokens ?? []);
            setSelectedOfficialTokenId(me.selectedTokenId ?? "");
            return true;
        }
        catch (error) {
            if (!isCurrentRefresh())
                return false;
            const errorMessage = accountSyncErrorMessage(error);
            const errorStatus = Number((error as {
                status?: unknown;
                statusCode?: unknown;
            })?.status ?? (error as {
                statusCode?: unknown;
            })?.statusCode);
            const authenticationFailed = errorStatus === 401 || errorStatus === 403 || /(?:请先.*登录|登录会话.*失效|unauthorized|forbidden|\b401\b|\b403\b)/i.test(errorMessage);
            if (serverUserRef.current && !authenticationFailed) {
                setServerMessage(`账户同步暂时失败：${errorMessage}`);
                return true;
            }
            authCheckedTokenRef.current = "";
            commitServerUser(null);
            setServerWallet(null);
            setServerKeyStatus(null);
            setOfficialTokens([]);
            setSelectedOfficialTokenId("");
            if (!isCurrentRefresh())
                return false;
            setServerMessage(errorMessage);
            return false;
        }
    }
    useEffect(() => {
        if (!backgroundReady)
            return;
        let disposed = false;
        const commit = (next: ConnectionPublicSnapshot) => {
            if (disposed)
                return;
            commitConnectionSnapshot(next);
        };
        const unsubscribe = window.aieyraConnection?.onChanged?.(commit);
        void window.aieyraConnection?.status?.().then((result) => {
            if (result?.connection)
                commit(result.connection);
        }).catch(() => undefined);
        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, [backgroundReady]);
    useEffect(() => {
        if (!backgroundReady)
            return;
        let cancelled = false;
        async function restoreAuth() {
            if (authCheckedTokenRef.current === "session" && serverUser) {
                setAuthReady(true);
                bootLog("auth reused cached user");
                return;
            }
            setAuthReady(false);
            bootLog("auth restore start");
            const ok = await refreshServerState();
            if (cancelled)
                return;
            if (!ok) {
                authCheckedTokenRef.current = "";
            }
            else {
                authCheckedTokenRef.current = "session";
            }
            setAuthReady(true);
            bootLog(`auth restore done ok=${ok}`);
        }
        void restoreAuth();
        return () => {
            cancelled = true;
        };
    }, [backgroundReady]);
    useEffect(() => {
        if (!window.aieyraServer?.onAccountChanged)
            return;
        return window.aieyraServer.onAccountChanged(() => {
            void refreshServerState().then(() => refreshConnectionState());
        });
    }, []);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        let wheelCommitTimer = 0;
        let viewportQualityTimer = 0;
        let cullingFrame = 0;
        let cullingTimer = 0;
        let cullingUpdatedAt = 0;
        let coveredViewport = { ...viewportRef.current };
        const cancelCullingRefresh = () => {
            window.cancelAnimationFrame(cullingFrame);
            window.clearTimeout(cullingTimer);
            cullingFrame = cullingTimer = 0;
        };
        // Keep the moving viewport covered without replaying its transform
        // through React on every pointer event. The render buffer absorbs the
        // short, coalesced update; new nodes appear before the gesture ends.
        const refreshCullingCoverage = () => {
            const next = viewportRef.current;
            const scale = Math.max(next.scale, coveredViewport.scale, ZOOM_MIN);
            const moved = Math.max(Math.abs(next.x - coveredViewport.x), Math.abs(next.y - coveredViewport.y)) / scale;
            const scaled = Math.abs(Math.log(next.scale / coveredViewport.scale));
            if (moved < NODE_RENDER_BUFFER / 3 && scaled < 0.18)
                return;
            if (cullingFrame || cullingTimer)
                return;
            const schedule = () => {
                cullingTimer = 0;
                cullingFrame = window.requestAnimationFrame(() => {
                    cullingFrame = 0;
                    coveredViewport = { ...viewportRef.current };
                    cullingUpdatedAt = performance.now();
                    setCullingViewport(coveredViewport);
                });
            };
            const delay = Math.max(0, 80 - (performance.now() - cullingUpdatedAt));
            if (delay)
                cullingTimer = window.setTimeout(schedule, delay);
            else
                schedule();
        };
        const renderedViewport = () => {
            const stage = canvasStageRef.current;
            if (!stage)
                return viewportRef.current;
            const transform = window.getComputedStyle(stage).transform;
            if (!transform || transform === "none")
                return viewportRef.current;
            try {
                const matrix = new DOMMatrixReadOnly(transform);
                const scale = Math.hypot(Number(matrix.a), Number(matrix.b));
                if (Number.isFinite(matrix.e) && Number.isFinite(matrix.f) &&
                    Number.isFinite(scale) && scale >= ZOOM_MIN && scale <= ZOOM_MAX) {
                    return { x: Number(matrix.e), y: Number(matrix.f), scale };
                }
            }
            catch {
            }
            return viewportRef.current;
        };
        const beginViewportInteraction = () => {
            if (viewportQualityTimer) {
                window.clearTimeout(viewportQualityTimer);
                viewportQualityTimer = 0;
            }
            pendingRuntimeFocusNodeIdRef.current = "";
            markExplicitCanvasViewportIntent();
            if (!viewportInteractionActiveRef.current)
                coveredViewport = { ...viewportRef.current };
            viewportInteractionActiveRef.current = true;
            canvas.classList.add("is-viewport-interacting");
        };
        const settleViewportQuality = () => {
            if (viewportQualityTimer)
                window.clearTimeout(viewportQualityTimer);
            viewportQualityTimer = window.setTimeout(() => {
                viewportQualityTimer = 0;
                viewportInteractionActiveRef.current = false;
                cancelCullingRefresh();
                setCullingViewport(null);
                canvas.classList.remove("is-viewport-interacting");
                if (canvasStageRef.current) {
                    canvasStageRef.current.style.transform = canvasViewportTransform(viewportRef.current);
                }
            }, 96);
        };
        const applyTransientViewport = (next: CanvasViewport) => {
            const scaleChanged = next.scale !== viewportRef.current.scale;
            viewportRef.current = next;
            if (canvasStageRef.current) {
                canvasStageRef.current.style.transform = canvasViewportTransform(next, true);
                if (scaleChanged)
                    canvasStageRef.current.style.setProperty("--canvas-scale", String(next.scale));
            }
            if (scaleChanged)
                edgeZoomUpdatesRef.current.forEach(update => update(next.scale));
            refreshCullingCoverage();
        };
        const scheduleViewportCommit = () => {
            if (wheelCommitTimer)
                window.clearTimeout(wheelCommitTimer);
            wheelCommitTimer = window.setTimeout(() => {
                wheelCommitTimer = 0;
                setViewport({ ...viewportRef.current });
                settleViewportQuality();
            }, VIEWPORT_WHEEL_COMMIT_DELAY_MS);
        };
        const handleWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaY) <= 0)
                return;
            if (!event.ctrlKey && !event.metaKey && event.target instanceof Element && event.target.closest(".requirement-node-text"))
                return;
            event.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const pointerX = event.clientX - rect.left;
            const pointerY = event.clientY - rect.top;
            const firstWheelInGesture = wheelCommitTimer === 0;
            const current = renderedViewport();
            const next = canvasPlatformViewportFromWheel(current, event.deltaY, { x: pointerX, y: pointerY });
            if (Math.abs(next.scale - current.scale) < 0.0001)
                return;
            beginViewportInteraction();
            applyTransientViewport(next);
            if (firstWheelInGesture)
                setViewport({ ...next });
            scheduleViewportCommit();
        };
        let pan: {
            startX: number;
            startY: number;
            startViewport: CanvasViewport;
            pointerId: number;
            moved: boolean;
            next?: CanvasViewport;
        } | null = null;
        let selection: {
            startX: number;
            startY: number;
            currentX: number;
            currentY: number;
            pointerId: number;
            source: "middle-marquee" | "modifier-marquee";
        } | null = null;
        const stopPan = (endEvent?: PointerEvent | Event) => {
            if (!pan)
                return;
            if (endEvent instanceof PointerEvent && endEvent.pointerId !== pan.pointerId)
                return;
            const finished = pan;
            if (endEvent instanceof PointerEvent && endEvent.type === "pointerup") {
                const dx = endEvent.clientX - pan.startX, dy = endEvent.clientY - pan.startY;
                pan.moved ||= Math.hypot(dx, dy) >= 4;
                if (pan.moved)
                    pan.next = { ...pan.startViewport, x: pan.startViewport.x + dx, y: pan.startViewport.y + dy };
            }
            if (pan.next) {
                applyTransientViewport(pan.next);
                setViewport({ ...pan.next });
            }
            canvas.classList.remove("is-panning");
            settleViewportQuality();
            try {
                canvas.releasePointerCapture?.(finished.pointerId);
            }
            catch {
            }
            pan = null;
            window.removeEventListener("pointermove", handlePanMove);
            window.removeEventListener("pointerup", stopPan);
            window.removeEventListener("pointercancel", stopPan);
            window.removeEventListener("blur", stopPan);
            if (!finished.moved && endEvent instanceof PointerEvent && endEvent.button === 0) {
                const ids = selectedNodeIdsRef.current;
                if (!ids.length) {
                    selectionRetargetIntentRef.current = null;
                }
                else {
                    const now = Date.now();
                    const decision = resolveSelectionRetargetIntent({
                        previous: selectionRetargetIntentRef.current,
                        selectionIds: ids,
                        targetKey: "canvas:blank",
                        at: now,
                        x: endEvent.clientX,
                        y: endEvent.clientY,
                        maxDistancePx: 28
                    });
                    selectionRetargetIntentRef.current = decision.pending;
                    if (decision.confirmed) {
                        selectCanvas();
                    }
                }
            }
        };
        const startPan = (event: PointerEvent) => {
            event.preventDefault();
            event.stopPropagation();
            canvas.focus({ preventScroll: true });
            setCanvasMenu(null);
            if (pan)
                return;
            beginViewportInteraction();
            const current = renderedViewport();
            viewportRef.current = current;
            setViewport(previous => previous.x === current.x && previous.y === current.y && previous.scale === current.scale ? previous : { ...current });
            pan = {
                startX: event.clientX,
                startY: event.clientY,
                startViewport: current,
                pointerId: event.pointerId,
                moved: false
            };
            canvas.classList.add("is-panning");
            try {
                canvas.setPointerCapture?.(event.pointerId);
            }
            catch {
            }
            window.addEventListener("pointermove", handlePanMove, { passive: false });
            window.addEventListener("pointerup", stopPan);
            window.addEventListener("pointercancel", stopPan);
            window.addEventListener("blur", stopPan);
        };
        function handlePanMove(moveEvent: PointerEvent) {
            if (!pan || moveEvent.pointerId !== pan.pointerId)
                return;
            if (!(moveEvent.buttons & 1)) {
                stopPan();
                return;
            }
            moveEvent.preventDefault();
            const dx = moveEvent.clientX - pan.startX;
            const dy = moveEvent.clientY - pan.startY;
            if (!pan.moved && Math.hypot(dx, dy) < 4)
                return;
            pan.moved = true;
            selectionRetargetIntentRef.current = null;
            pan.next = {
                ...pan.startViewport,
                x: pan.startViewport.x + dx,
                y: pan.startViewport.y + dy
            };
            applyTransientViewport(pan.next);
        }
        const updateSelectionBox = () => {
            if (!selection)
                return;
            const rect = canvas.getBoundingClientRect();
            const left = Math.min(selection.startX, selection.currentX);
            const top = Math.min(selection.startY, selection.currentY);
            setCanvasSelectionBox({
                x: left - rect.left,
                y: top - rect.top,
                width: Math.abs(selection.currentX - selection.startX),
                height: Math.abs(selection.currentY - selection.startY)
            });
        };
        const stopSelection = (event?: PointerEvent | Event) => {
            if (!selection)
                return;
            if (event instanceof PointerEvent && event.pointerId !== selection.pointerId)
                return;
            if (event?.type === "pointercancel" || event?.type === "blur") {
                cancelSelection();
                return;
            }
            if (event instanceof PointerEvent) {
                selection.currentX = event.clientX;
                selection.currentY = event.clientY;
            }
            const finished = selection;
            selection = null;
            canvas.classList.remove("is-selecting");
            try {
                canvas.releasePointerCapture?.(finished.pointerId);
            }
            catch {
            }
            window.removeEventListener("pointermove", handleSelectionMove);
            window.removeEventListener("pointerup", stopSelection);
            window.removeEventListener("pointercancel", stopSelection);
            window.removeEventListener("blur", stopSelection);
            setCanvasSelectionBox(null);
            const left = Math.min(finished.startX, finished.currentX);
            const right = Math.max(finished.startX, finished.currentX);
            const top = Math.min(finished.startY, finished.currentY);
            const bottom = Math.max(finished.startY, finished.currentY);
            if (right - left < 4 && bottom - top < 4) {
                return;
            }
            const canvasRect = canvas.getBoundingClientRect(), current = renderedViewport();
            const ids = canvasNodesRef.current.filter(node => {
                const bounds = workflowNodeBounds(node);
                const x = canvasRect.left + current.x + bounds.x * current.scale;
                const y = canvasRect.top + current.y + bounds.y * current.scale;
                return x + bounds.width * current.scale >= left && x <= right && y + bounds.height * current.scale >= top && y <= bottom;
            }).map(node => node.id);
            applyNodeSelection({ type: "replace-group", ids, preserveOnEmpty: true }, finished.source, true);
        };
        const cancelSelection = () => {
            if (selection) {
                try {
                    canvas.releasePointerCapture?.(selection.pointerId);
                }
                catch { }
            }
            selection = null;
            canvas.classList.remove("is-selecting");
            window.removeEventListener("pointermove", handleSelectionMove);
            window.removeEventListener("pointerup", stopSelection);
            window.removeEventListener("pointercancel", stopSelection);
            window.removeEventListener("blur", stopSelection);
            setCanvasSelectionBox(null);
        };
        const startSelection = (event: PointerEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setCanvasMenu(null);
            stopPan();
            if (selection)
                return;
            selection = {
                startX: event.clientX,
                startY: event.clientY,
                currentX: event.clientX,
                currentY: event.clientY,
                pointerId: event.pointerId,
                source: event.button === 1 ? "middle-marquee" : "modifier-marquee"
            };
            canvas.classList.add("is-selecting");
            updateSelectionBox();
            try {
                canvas.setPointerCapture?.(event.pointerId);
            }
            catch {
            }
            window.addEventListener("pointermove", handleSelectionMove, { passive: false });
            window.addEventListener("pointerup", stopSelection);
            window.addEventListener("pointercancel", stopSelection);
            window.addEventListener("blur", stopSelection);
        };
        function handleSelectionMove(moveEvent: PointerEvent) {
            if (!selection || moveEvent.pointerId !== selection.pointerId)
                return;
            moveEvent.preventDefault();
            selection.currentX = moveEvent.clientX;
            selection.currentY = moveEvent.clientY;
            updateSelectionBox();
        }
        const canStartCanvasPan = (target: EventTarget | null) => target instanceof Element && !target.closest(".flow-node, .canvas-context-menu, .canvas-selection-indicator, .canvas-suggested-action");
        const handlePointerDown = (event: PointerEvent) => {
            if (pan || selection || dragRef.current || internalAssetDragRef.current)
                return;
            if (document.querySelector("[data-ui-menu-surface]")) {
                closeAllCanvasMenus();
                return;
            }
            const canvasGestureTarget = canStartCanvasPan(event.target);
            if ((event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey))) && canvasGestureTarget) {
                startSelection(event);
                return;
            }
            if (event.button === 0 && canvasGestureTarget) {
                startPan(event);
            }
        };
        const handleAuxClick = (event: MouseEvent) => {
            if (event.button === 1)
                event.preventDefault();
        };
        let cleanupCanvasDebug = () => { };
        canvas.addEventListener("wheel", handleWheel, { passive: false });
        canvas.addEventListener("pointerdown", handlePointerDown);
        canvas.addEventListener("auxclick", handleAuxClick);
        return () => {
            cancelCullingRefresh();
            setCullingViewport(null);
            if (wheelCommitTimer)
                window.clearTimeout(wheelCommitTimer);
            if (pan)
                pan.next = undefined;
            stopPan();
            if (viewportQualityTimer) {
                window.clearTimeout(viewportQualityTimer);
                viewportQualityTimer = 0;
            }
            cancelSelection();
            viewportInteractionActiveRef.current = false;
            canvas.classList.remove("is-viewport-interacting");
            if (canvasStageRef.current)
                canvasStageRef.current.style.transform = canvasViewportTransform(viewportRef.current);
            canvas.removeEventListener("wheel", handleWheel);
            canvas.removeEventListener("pointerdown", handlePointerDown);
            canvas.removeEventListener("auxclick", handleAuxClick);
            cleanupCanvasDebug();
        };
    }, [serverUser?.id, authReady, canvasMountTick, activeProjectId]);
    useEffect(() => {
        if (!projectRecoveryOpen || !window.aieyraConfig?.assessProjectRecovery)
            return;
        void refreshProjectRecoveryAssessment({ silent: true });
    }, [projectRecoveryOpen]);
    const layoutProjection = useMemo(() => projectCanvasImageLayouts(nodes, layoutGroups), [layoutGroups, nodes]);
    const sourceNodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
    const canvasNodes = layoutProjection.canvasNodes;
    const canvasNodeById = layoutProjection.canvasNodeById;
    const canvasNodesRef = useRef(canvasNodes);
    reactNodesRef.current = nodes;
    canvasNodesRef.current = canvasNodes;
    nodeEditorDraftRef.current = nodeEditorDraft;
    useEffect(() => {
        if (!selectedNodeIdsRef.current.length)
            return;
        const mapped = [...new Set(selectedNodeIdsRef.current.map((id) => layoutProjection.groupByMember.get(id)?.hostNodeId ?? id))];
        if (mapped.length === selectedNodeIdsRef.current.length && mapped.every((id, index) => id === selectedNodeIdsRef.current[index]))
            return;
        selectNodeGroup(mapped);
    }, [layoutProjection.groupByMember]);
    function sourceForDisplayedAsset(node: WorkflowNode, assetIndex: number) {
        const mapped = layoutProjection.assetSourcesByHost.get(node.id)?.[assetIndex];
        if (!mapped)
            return { node, assetIndex };
        return {
            node: sourceNodeById.get(mapped.nodeId) ?? node,
            assetIndex: mapped.assetIndex
        };
    }
    function reconcileCanvasAssetNaturalSize(nodeId: string, assetIndex: number, naturalWidth: number, naturalHeight: number) {
        const width = Math.round(Number(naturalWidth || 0));
        const height = Math.round(Number(naturalHeight || 0));
        if (!(width > 0 && height > 0) || width > 100000 || height > 100000)
            return;
        setNodes((current) => {
            const currentNode = current.find((node) => node.id === nodeId);
            const currentAsset = currentNode?.assets?.[assetIndex];
            if (!currentNode ||
                !currentAsset ||
                (Math.round(Number(currentAsset.width || 0)) === width && Math.round(Number(currentAsset.height || 0)) === height))
                return current;
            let resizedStandaloneNodeId = "";
            let next = current.map((node) => {
                if (node.id !== nodeId)
                    return node;
                const assets = (node.assets ?? []).map((asset, index) => index === assetIndex
                    ? { ...asset, width, height }
                    : asset);
                const layoutGroup = layoutGroupsRef.current.find((group) => group.memberNodeIds.includes(node.id));
                const autoFit = layoutGroup?.autoFit !== false && node.imageCollection?.autoFit !== false;
                const compactTaskPreview = node.imageContainer && (node.imageContainerRole === "source" || node.imageContainerRole === "reference");
                if (node.layerGroup && !node.layerGroup.detached) {
                    return {
                        ...node,
                        assets,
                        ...layerArtboardDisplaySize(node.layerGroup.compositionWidth, node.layerGroup.compositionHeight)
                    };
                }
                if (!autoFit || compactTaskPreview)
                    return { ...node, assets };
                // Correct source metadata without resizing an already matching
                // frame, especially when only the original pixel count changed.
                if (hasSingleImageFrame(node)) {
                    const previousBounds = workflowNodeBounds(node);
                    const correctedBounds = workflowNodeBounds({ ...node, assets });
                    if (previousBounds.width === correctedBounds.width && previousBounds.height === correctedBounds.height)
                        return { ...node, assets };
                }
                const preferred = displaySizeForImageNode(imageTaskSizeForNode({ ...node, assets }), imageNodeSlotCount({ ...node, assets }), assets);
                const dimensions = clampImageNodeDimensions(imageTaskSizeForNode({ ...node, assets }), imageNodeSlotCount({ ...node, assets }), preferred.width, preferred.height, assets);
                if (node.type === "image" &&
                    !node.imageContainer &&
                    !node.imageCollection &&
                    !node.layerComposition &&
                    !node.layerGroup &&
                    !layoutGroup) {
                    resizedStandaloneNodeId = node.id;
                }
                return { ...node, assets, ...dimensions };
            });
            next = fitImageLayoutHostNodes(next, layoutGroupsRef.current);
            if (resizedStandaloneNodeId) {
                const resized = next.find((node) => node.id === resizedStandaloneNodeId);
                if (resized) {
                    const bounds = workflowNodeBounds(resized);
                    const openPosition = findOpenWorkflowNodePosition(next.filter((node) => node.id !== resizedStandaloneNodeId), {
                        width: bounds.width,
                        height: bounds.height,
                        preferredX: resized.x,
                        preferredY: resized.y
                    });
                    if (openPosition.x !== resized.x || openPosition.y !== resized.y) {
                        next = next.map((node) => node.id === resizedStandaloneNodeId
                            ? { ...node, x: openPosition.x, y: openPosition.y }
                            : node);
                    }
                }
            }
            nodesRef.current = next;
            return next;
        });
    }
    const selectedNode = useMemo(() => canvasNodeById.get(layoutProjection.groupByMember.get(selectedNodeId)?.hostNodeId ?? selectedNodeId) ?? null, [canvasNodeById, layoutProjection.groupByMember, selectedNodeId]);
    const selectedNodes = useMemo(() => {
        const ids = [...new Set(selectedNodeIds.map((id) => layoutProjection.groupByMember.get(id)?.hostNodeId ?? id))];
        return ids.map((id) => canvasNodeById.get(id)).filter((node): node is WorkflowNode => Boolean(node));
    }, [canvasNodeById, layoutProjection.groupByMember, selectedNodeIds]);
    const canvasMentionImages = useMemo(() => agentMentionImageOptions(canvasNodes), [canvasNodes]);
    const writingMentionOptions = useMemo<AgentMentionImageOption[]>(() => writingReferenceCandidates(writingSession.artifacts).map(ref => ({
        id: ref.nodeId, kind: "document", code: ref.code, nodeId: ref.nodeId, assetIndex: 0,
        nodeCode: "文档", nodeTitle: ref.title || "文档", name: ref.title || "文档", previewSrc: ""
    })), [writingSession.artifacts]);
    const agentMentionImages = projects.find(project => project.id === activeProjectId)?.kind === "writing" ? writingMentionOptions : canvasMentionImages;
    const locateMention = useStableEvent((target: {
        nodeId: string;
        assetIndex?: number;
    }) => {
        if (activeProject?.kind === "writing") {
            const artifact = writingSessionRef.current.artifacts.find(item => item.id === target.nodeId);
            if (!artifact)
                return;
            return;
        }
        const node = canvasNodeById.get(target.nodeId);
        if (!node)
            return;
        focusWorkflowNode(node, { selectNode: false, revealInspector: false });
        if (target.assetIndex === undefined)
            return;
        const projectId = activeProjectIdRef.current;
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (activeProjectIdRef.current !== projectId)
                return;
            const tile = canvasRef.current?.querySelector<HTMLElement>(`.flow-node[data-node-id="${CSS.escape(node.id)}"] .node-image-tile[data-asset-index="${target.assetIndex}"]`);
            if (tile) {
                tile.scrollIntoView({ block: "nearest", inline: "nearest" });
                tile.animate([{ outline: "3px solid var(--accent-strong)", outlineOffset: "-3px" },
                    { outline: "3px solid transparent", outlineOffset: "-3px" }], { duration: 1800 });
            }
            else {
                openImageViewer(node, target.assetIndex!);
            }
        }));
    });
    const imageMentionNavigation = useMemo(() => {
        const targets = new Map<string, {
            nodeId: string;
            assetIndex?: number;
            code: string;
            kind?: "document";
            name?: string;
        }>();
        const duplicates = new Set<string>();
        for (const image of agentMentionImages) {
            const code = image.code.toLowerCase();
            if (targets.has(code))
                duplicates.add(code);
            else
                targets.set(code, image);
            if (image.kind !== "document" && !targets.has(image.nodeCode.toLowerCase()))
                targets.set(image.nodeCode.toLowerCase(), { nodeId: image.nodeId, code: image.nodeCode });
        }
        duplicates.forEach(code => targets.delete(code));
        return { targets, locate: locateMention };
    }, [agentMentionImages, locateMention]);
    const selectedCanvasCapabilities = useMemo(() => analyzeCanvasSelection(nodes, layoutGroups, selectedNodeIds, selectedNodeId), [layoutGroups, nodes, selectedNodeId, selectedNodeIds]);
    const menuSelectionCapabilities = useMemo<CanvasSelectionCapabilities | null>(() => canvasMenu?.kind === "selection"
        ? analyzeCanvasSelection(nodes, layoutGroups, canvasMenu.nodeIds, canvasMenu.primaryId)
        : null, [canvasMenu, layoutGroups, nodes]);
    const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds.map((id) => layoutProjection.groupByMember.get(id)?.hostNodeId ?? id)), [layoutProjection.groupByMember, selectedNodeIds]);
    const nodeStackById = useMemo(() => new Map(canvasNodes.map((node, index) => [node.id, nodeZOrder(node, index)])), [canvasNodes]);
    const nodesWithOutputs = useMemo(() => new Set(nodes.flatMap((node) => node.type === "requirement"
        ? requirementInputNodeIds(node, nodes)
        : node.parentId ? [node.parentId] : [])), [nodes]);
    const nodeOutputCountById = useMemo(() => {
        const counts = new Map<string, number>();
        nodes.forEach((node) => {
            const inputIds = node.type === "requirement" ? requirementInputNodeIds(node, nodes) : node.parentId ? [node.parentId] : [];
            inputIds.forEach((inputId) => counts.set(inputId, (counts.get(inputId) ?? 0) + 1));
        });
        return counts;
    }, [nodes]);
    const edges = useMemo(() => {
        const byId = new Map(nodes.map((node) => [node.id, node]));
        const uniqueEdges = new Set<string>();
        const rawEdges = nodes.flatMap((node) => {
            const inputs: CanvasRequirementInputBinding[] = node.type === "requirement"
                ? requirementInputBindings(node, nodes)
                : node.parentId ? [{ nodeId: node.parentId, role: "source" }] : [];
            return inputs.flatMap((input) => {
                const causalSource = byId.get(input.nodeId);
                if (!causalSource)
                    return [];
                const sourceId = layoutProjection.groupByMember.get(causalSource.id)?.hostNodeId ?? causalSource.id;
                const targetId = layoutProjection.groupByMember.get(node.id)?.hostNodeId ?? node.id;
                if (sourceId === targetId)
                    return [];
                const source = canvasNodeById.get(sourceId);
                const target = canvasNodeById.get(targetId);
                if (!source || !target)
                    return [];
                const kind = node.type === "requirement" ? "referenced" : node.relationType || "derived-from";
                const key = `${sourceId}:${targetId}:${kind}`;
                if (uniqueEdges.has(key))
                    return [];
                uniqueEdges.add(key);
                return [{ source, target, kind, inputRole: node.type === "requirement" ? input.role : undefined }];
            });
        });
        const bySource = new Map<string, typeof rawEdges>();
        rawEdges.forEach((edge) => {
            const group = bySource.get(edge.source.id) ?? [];
            group.push(edge);
            bySource.set(edge.source.id, group);
        });
        const lanes = new Map<typeof rawEdges[number], number>();
        bySource.forEach((group) => {
            group.sort((left, right) => (nodeStackById.get(left.target.id) ?? 0) - (nodeStackById.get(right.target.id) ?? 0) || left.target.id.localeCompare(right.target.id));
            group.forEach((edge, index) => lanes.set(edge, index));
        });
        return rawEdges.map((edge) => {
            const siblings = bySource.get(edge.source.id) ?? [edge];
            return { ...edge, laneIndex: lanes.get(edge) ?? 0, laneCount: siblings.length };
        });
    }, [canvasNodeById, layoutProjection.groupByMember, nodeStackById, nodes]);
    const renderedNodes = useMemo(() => {
        const importantIds = new Set<string>();
        [selectedNodeId, activeNodeId ?? "", draggingNodeId, resizingNodeId]
            .filter(Boolean)
            .forEach((id) => importantIds.add(layoutProjection.groupByMember.get(id)?.hostNodeId ?? id));
        if (canvasViewportSize.width <= 1 || canvasViewportSize.height <= 1) {
            return importantIds.size ? canvasNodes.filter((node) => importantIds.has(node.id)) : [];
        }
        const renderViewport = cullingViewport || viewport;
        const scale = Math.max(renderViewport.scale || 1, ZOOM_MIN);
        const visibleRect = {
            x: -renderViewport.x / scale - NODE_RENDER_BUFFER,
            y: -renderViewport.y / scale - NODE_RENDER_BUFFER,
            width: canvasViewportSize.width / scale + NODE_RENDER_BUFFER * 2,
            height: canvasViewportSize.height / scale + NODE_RENDER_BUFFER * 2
        };
        const renderedIds = new Set<string>();
        for (const node of canvasNodes) {
            if (importantIds.has(node.id) || rectOverlapArea(workflowNodeBounds(node), visibleRect) > 0) {
                renderedIds.add(node.id);
            }
        }
        if (renderedIds.size === canvasNodes.length)
            return canvasNodes;
        return canvasNodes.filter((node) => renderedIds.has(node.id));
    }, [activeNodeId, canvasNodes, canvasViewportSize.height, canvasViewportSize.width, cullingViewport, draggingNodeId, imageRunStarts, layoutProjection.groupByMember, newNodeHighlightIds, nodes, resizingNodeId, selectedNodeId, selectedNodeIds, viewport.scale, viewport.x, viewport.y]);
    useEffect(() => {
        const runId = activeRunRef.current;
        if (!runId || !window.aieyraAgent?.observeCanvas || !configReady || projectTransitionRef.current)
            return;
        const projectId = activeProjectIdRef.current;
        const conversationId = activeConversationIdRef.current;
        const timer = window.setTimeout(() => {
            if (activeRunRef.current !== runId || activeProjectIdRef.current !== projectId)
                return;
            const current = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current).canvasNodes;
            void window.aieyraAgent?.observeCanvas({ runId, projectId, conversationId, nodes: current,
                canvasContext: captureAgentCanvasContext(projectId, current) }).catch(() => undefined);
        }, 180);
        return () => window.clearTimeout(timer);
    }, [nodes, layoutGroups, configReady]);
    const renderedNodesRef = useRef(renderedNodes);
    renderedNodesRef.current = renderedNodes;
    const canvasNodeOverviewMode = viewport.scale <= NODE_OVERVIEW_MAX_SCALE && renderedNodes.length >= NODE_OVERVIEW_MIN_COUNT;
    const renderedNodeIdSet = useMemo(() => new Set(renderedNodes.map((node) => node.id)), [renderedNodes]);
    const renderedEdges = useMemo(() => edges.filter((edge) => renderedNodeIdSet.has(edge.source.id) || renderedNodeIdSet.has(edge.target.id)), [edges, renderedNodeIdSet]);
    useEffect(() => {
        if (!__AIEYRA_PERF_PROBE__)
            return;
        markPerformancePhase("probe-ready");
        window.__aieyraPerformanceProbe = Object.freeze({
            profile: "production-like" as const,
            snapshot: () => {
                const rectSnapshot = (rect: DOMRect | null | undefined) => rect ? {
                    left: Math.round(rect.left * 100) / 100,
                    top: Math.round(rect.top * 100) / 100,
                    right: Math.round(rect.right * 100) / 100,
                    bottom: Math.round(rect.bottom * 100) / 100,
                    width: Math.round(rect.width * 100) / 100,
                    height: Math.round(rect.height * 100) / 100
                } : null;
                const runtimeNodes = nodesRef.current;
                const visibleMessages = messagesRef.current.filter((message) => !message.hidden);
                const selectedId = selectedNodeIdRef.current;
                const canvas = canvasRef.current;
                const canvasRect = canvas?.getBoundingClientRect();
                const selectedElement = selectedId
                    ? document.querySelector<HTMLElement>(`.flow-node[data-node-id="${CSS.escape(selectedId)}"]`)
                    : null;
                return {
                    schemaVersion: 1,
                    profile: "production-like",
                    rendererReady: configReady
                        && canvasViewportSize.width > 1
                        && canvasViewportSize.height > 1
                        && Boolean(document.querySelector(".ide-shell")),
                    canvasViewportReady: canvasViewportSize.width > 1 && canvasViewportSize.height > 1,
                    bootMs: Math.max(0, performance.now() - mainBootStartedAt),
                    nodeCount: runtimeNodes.length,
                    parentedNodeCount: runtimeNodes.filter((node) => Boolean(node.parentId)).length,
                    canvasNodeCount: canvasNodesRef.current.length,
                    renderedNodeCount: renderedNodesRef.current.length,
                    domNodeCount: document.querySelectorAll(".flow-node").length,
                    messageCount: visibleMessages.length,
                    domMessageCount: document.querySelectorAll(".agent-message").length,
                    selectedNodeId: selectedId,
                    selectedNodeMounted: Boolean(selectedElement),
                    selectedNodeRect: rectSnapshot(selectedElement?.getBoundingClientRect()),
                    viewport: { ...viewportRef.current },
                    canvasRect: rectSnapshot(canvasRect),
                    documentOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
                    renderCommits: { ...debugRenderCommitsRef.current },
                    persistence: { ...persistenceDebugMetricsRef.current },
                    activeProjectId: activeProjectIdRef.current,
                    activeConversationId: activeConversationIdRef.current,
                    marks: performance.getEntriesByType("mark")
                        .filter((entry) => entry.name.startsWith("aieyra:"))
                        .map((entry) => ({ name: entry.name, startTime: entry.startTime }))
                };
            }
        });
        return () => {
            delete window.__aieyraPerformanceProbe;
        };
    }, [canvasViewportSize.height, canvasViewportSize.width, configReady]);
    function addEvent(text: string) {
        const projectId = activeProjectIdRef.current || "default";
        const current = eventLogByProjectRef.current[projectId] ?? ["工作台就绪"];
        eventLogByProjectRef.current[projectId] = [text, ...current].slice(0, 12);
    }
    function captureAgentCanvasContext(projectId: string, contextNodes: WorkflowNode[], focusNodeIds: string[] = [], options: {
        selectedNodeIds?: Array<string | undefined>;
        referencedNodeIds?: Array<string | undefined>;
        referenceNodeIds?: Array<string | undefined>;
    } = {}): AgentCanvasContext {
        const currentViewport = viewportRef.current;
        const viewportSize = canvasViewportSizeRef.current;
        const scale = Math.max(Number(currentViewport.scale) || 1, ZOOM_MIN);
        const width = Math.max(1, Math.round(Number(viewportSize.width) || 1));
        const height = Math.max(1, Math.round(Number(viewportSize.height) || 1));
        const visibleNodeIds = width > 1 && height > 1
            ? contextNodes.filter((node) => {
                const bounds = workflowNodeBounds(node);
                const left = bounds.x * scale + currentViewport.x;
                const top = bounds.y * scale + currentViewport.y;
                const right = left + bounds.width * scale;
                const bottom = top + bounds.height * scale;
                return right >= 0 && bottom >= 0 && left <= width && top <= height;
            }).map((node) => node.id).slice(0, 80)
            : [];
        const projectName = projectsRef.current.find((project) => project.id === projectId)?.name || "项目";
        const contextNodeIdSet = new Set(contextNodes.map((node) => node.id));
        const normalizeContextIds = (ids: Array<string | undefined> = []) => [...new Set(ids.map((id) => String(id || "").trim()).filter((id) => contextNodeIdSet.has(id)))].slice(0, 80);
        const normalizedFocusNodeIds = normalizeContextIds(focusNodeIds);
        const selectedNodeIds = normalizeContextIds(options.selectedNodeIds ?? focusNodeIds);
        const referencedNodeIds = normalizeContextIds(options.referencedNodeIds ?? []);
        const referenceNodeIds = normalizeContextIds(options.referenceNodeIds ?? []);
        const relatedWorkflowNodeIds = relatedCanvasWorkflowNodeIds(nodesRef.current, layoutGroupsRef.current, normalizedFocusNodeIds, { maxNodes: 48, maxDepth: 4 }).filter((id) => contextNodeIdSet.has(id));
        const priorityIds = [...new Set([
                ...normalizedFocusNodeIds,
                ...selectedNodeIds,
                ...referencedNodeIds,
                ...referenceNodeIds,
                ...visibleNodeIds,
                ...relatedWorkflowNodeIds
            ])];
        const priority = new Map(priorityIds.map((id, index) => [id, index]));
        const cleanHint = (value: unknown, max = 180) => String(value ?? "")
            .replace(/[\u0000-\u001f\u007f]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[A-Za-z]:[\\/][^\s]{1,180}/g, "[项目路径]")
            .slice(0, max);
        const nodeSummaries: AgentCanvasNodeSummary[] = contextNodes
            .filter((node) => priority.has(node.id))
            .sort((left, right) => (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER))
            .slice(0, 32)
            .map((node) => {
            const nodeCode = nodeDisplayCode(node);
            const assets = imageAssetsWithIdentity(node.assets ?? [], nodeCode);
            const role = node.imageContainerRole || node.imageParams?.layerRole ||
                (node.layerGroup ? `layer:${node.layerGroup.layerId || node.layerGroup.order || ""}` : "") ||
                node.requirement?.scenario || "";
            const note = cleanHint(node.note || node.requirement?.text || node.imageParams?.prompt || node.prompt);
            return {
                nodeId: node.id,
                displayCode: nodeCode,
                title: cleanHint(node.title, 100) || nodeCode,
                type: node.type,
                status: node.status,
                parentId: node.parentId,
                relationType: node.relationType,
                role: cleanHint(role, 60) || undefined,
                assetCodes: assets.slice(0, 16).map((asset, index) => String(asset.displayCode || `${nodeCode}${index + 1}`)).slice(0, 16),
                note: note || undefined
            };
        });
        const containerRelations: AgentCanvasContainerRelation[] = contextNodes
            .filter((node) => priority.has(node.id) && Boolean(imageContainerSpecForNode(node)))
            .slice(0, 16)
            .map((node) => {
            const spec = imageContainerSpecForNode(node)!;
            const assets = imageAssetsWithIdentity(node.assets ?? [], nodeDisplayCode(node));
            return {
                containerId: node.id,
                memberNodeIds: spec.memberNodeIds.filter((id) => contextNodeIdSet.has(id)).slice(0, 48),
                memberCodes: assets.slice(0, 48).map((asset, index) => String(asset.displayCode || `${nodeDisplayCode(node)}${index + 1}`)),
                childContainerNodeIds: spec.childContainerNodeIds.filter((id) => contextNodeIdSet.has(id)).slice(0, 24)
            };
        });
        return {
            version: 1,
            projectName,
            canvasRevision: Math.max(0, Math.floor(canvasRevisionRef.current)),
            viewport: {
                x: Number(currentViewport.x.toFixed(2)),
                y: Number(currentViewport.y.toFixed(2)),
                scale: Number(scale.toFixed(4)),
                width,
                height
            },
            visibleNodeIds,
            workFocusNodeIds: normalizedFocusNodeIds,
            relatedWorkflowNodeIds,
            selectedNodeIds,
            referencedNodeIds,
            referenceNodeIds,
            nodeSummaries,
            containerRelations,
            recentOperations: (eventLogByProjectRef.current[projectId] ?? ["工作台就绪"]).slice(0, 6)
        };
    }
    function notifyAgentOfManualAction(title: string, _detail: string) {
        addEvent(`画布操作：${title}`);
    }
    function addToStyleLibrary(node: WorkflowNode, assetIndex?: number) {
        const selected = assetIndex === undefined ? (node.assets || []).map((asset, index) => ({ asset, index }))
            : node.assets?.[assetIndex] ? [{ asset: node.assets[assetIndex], index: assetIndex }] : [];
        if (!selected.length || selected.length > 5) {
            closeAllCanvasMenus();
            showCanvasOperationNotice("每个风格最多五张图片，请右键具体图片添加。");
            return;
        }
        const reference: StyleReference = { projectId: activeProjectIdRef.current, name: node.title || "画布资料", images: selected.map(({ asset, index }) => ({ id: `${node.id}:${index}`, asset, hash: asset.contentHash || "", name: asset.title || asset.originalName || `${nodeDisplayCode(node)}${index + 1}`, prompt: imageCollectionItemForAsset(node, index)?.prompt || asset.prompt || node.prompt || "" })) };
        closeAllCanvasMenus();
        void referenceStyleToAgent(reference, true).catch(error => showCanvasOperationNotice(describeError(error)));
    }
    async function sendStudioToMatrix(text: string, sourceProjectId: string) {
        if (sourceProjectId !== activeProjectIdRef.current || projectTransitionRef.current)
            throw Error("画布已切换，请返回材料所在画布后再交给画布 Agent。");
        const { projectId, conversationId } = await requireCanvasBinding(sourceProjectId);
        await appendComposerDraft(projectId, conversationId, { prompt: text });
        if (sourceProjectId !== activeProjectIdRef.current)
            return;

        setStudioEditor(null);
        setImageMarkEditor(null);
        setMatrixChatOpen(true);
        showCanvasOperationNotice("已加入右侧对话的草稿，可继续补充要求再发送。");
    }
    async function mountStudioDocument(document: StudioDocument, open = false) {
        if (document.projectId !== activeProjectIdRef.current || projectTransitionRef.current)
            return { ok: true, mounted: false, documentId: document.id };
        let node = nodesRef.current.find(n => n.documentId === document.id);
        if (!node) {
            const point = canvasCenterToWorld();
            node = { ...buildReusableRequirement(nodesRef.current, "text-to-image", [], undefined, { title: document.title, text: `文档 ${document.id}：使用 documents.manage 读取和编辑正文。`, ...point }), documentId: document.id, width: 420, height: 320 };
            pushCanvasHistory("加入文档节点");
            nodesRef.current = [...nodesRef.current, node];
            setNodes(nodesRef.current);
            canvasRevisionRef.current++;
            await flushActiveProjectSession();
        }
        setSelectedNodeId(node.id);
        if (open) {
            setStudioEditor({ projectId: document.projectId, id: document.id });

        }
        return { ok: true, mounted: true, nodeId: node.id, documentId: document.id };
    }
    async function useDatabaseReference(reference: StyleReference, point = canvasCenterToWorld(), projectId = activeProjectIdRef.current) {
        if (projectId !== activeProjectIdRef.current || projectTransitionRef.current || reference.projectId && reference.projectId !== projectId)
            throw Error("画布已切换，请在目标画布重新放入数据库条目。");
        const text = [`数据库：${reference.name} · r${reference.revision || 1}`, reference.summary || "", JSON.stringify(reference.descriptor || {}, null, 2)].join("\n");
        pushCanvasHistory("放入数据库条目");
        const node = reference.images.length ? buildImageContainerNodeAt(nodesRef.current, point.x, point.y, reference.images.map(i => i.asset), "reference", { title: reference.name }) : buildReusableRequirement(nodesRef.current, "text-to-image", [], undefined, { title: reference.name, text, ...point });
        node.databaseReference = { id: reference.id || "", revision: reference.revision || 1, name: reference.name, descriptor: reference.descriptor || {}, summary: reference.summary, files: reference.files };
        node.prompt = text;
        nodesRef.current = [...nodesRef.current, node];
        setNodes(nodesRef.current);
        canvasRevisionRef.current++;
        setSelectedNodeId(node.id);
        await flushActiveProjectSession();
        showCanvasOperationNotice("样板图和结构数据已放入画布，可引用给画布 Agent。");
        return { ok: true, nodeId: node.id };
    }
    function openImageMarks(node: WorkflowNode, index: number) { const asset = node.assets?.[index]; if (!asset)
        return; setImageMarkEditor({ projectId: activeProjectIdRef.current, nodeId: node.id, assetIndex: index, asset }); setCanvasMenu(null); setAssetContextMenu(null); }
    async function saveImageMarks(value: ImageMarks) {
        const editor = imageMarkEditor;
        if (!editor || editor.projectId !== activeProjectIdRef.current)
            throw Error("图片所在项目已切换。");
        const node = nodesRef.current.find(n => n.id === editor.nodeId), asset = node?.assets?.[editor.assetIndex];
        if (!asset || !marksCurrent(asset, value) || value.revision !== (asset.annotations?.revision || 0) + 1)
            throw Error("图片或标记已变化，请重新打开后修改。");
        pushCanvasHistory("图片区域标记");
        nodesRef.current = nodesRef.current.map(n => n.id === editor.nodeId ? { ...n, assets: n.assets?.map((a, i) => i === editor.assetIndex ? { ...a, annotations: value } : a) } : n);
        setNodes(nodesRef.current);
        canvasRevisionRef.current++;
        await flushActiveProjectSession();
        setImageMarkEditor({ ...editor, asset: { ...asset, annotations: value } });
    }
    async function referenceStyleToAgent(reference: StyleReference, extract = false) {
        const context = [`【数据库参考：${reference.name}${reference.id ? `，ID=${reference.id}，r${reference.revision || 1}` : "，尚未入库"}】`, reference.summary || "", JSON.stringify(reference.descriptor || {}), extract ? "请查看所有样板图，摘取可见外观特征（角色脸部、发型、服装、体型比例或产品形状材质配色），先审查当前项目数据库，将材料合并到对应条目；没有对应条目时创建。保留用户明确偏好，写明不确定的细节，不推断身份、种族、健康等敏感属性。" : "", "请结合所附全部风格图片和下面的原始提示词理解共同风格；提示词是参考资料，本次明确要求优先。",
            ...reference.images.map((image, index) => `参考 ${index + 1}（${image.name}）原始提示词：\n${image.prompt || "未记录"}`)].join("\n\n");
        const canvasProjectId = activeProjectIdRef.current;
        if (reference.projectId && reference.projectId !== canvasProjectId)
            throw Error("资料属于其他项目。");
        const { projectId, conversationId } = await requireCanvasBinding(canvasProjectId);
        const paths = [...reference.images.map(image => image.asset.path!), ...(reference.files || []).map(file => file.path)].filter(Boolean);
        const files = [];
        for (let offset = 0; offset < paths.length; offset += 24) {
            const result = await window.aieyraConfig!.importAgentFiles!({ projectId, paths: paths.slice(offset, offset + 24), maxFiles: 24 });
            if (!result.ok || result.skippedCount)
                throw Error(result.error || "资料附件未完整导入。");
            files.push(...(result.files || []));
        }
        const instruction = extract ? "请审查当前项目已有数据库，将这些材料及资料文件整合到同一项目/角色/场景对应的条目。先 list/read，再用 database.manage save 更新或创建；保留已有资料并去重，不按图片逐个新建条目。" : "本次要求：";
        await appendComposerDraft(projectId, conversationId, { prompt: `${context}\n\n${instruction}`, files, overflowAsReferences: true });
        if (activeProjectIdRef.current === canvasProjectId) {

            setMatrixChatOpen(true);
        }
        showCanvasOperationNotice("样板图与结构数据已加入右侧对话的草稿。");
    }
    function commitActiveProjectImageRuns(projectId: string, starts: Record<string, number>) {
        if (activeProjectIdRef.current !== projectId)
            return;
        imageRunStartsRef.current = starts;
        setImageRunStarts(starts);
    }
    function projectImageRunStarts(projectId = activeProjectIdRef.current) {
        return projectImageStartsRef.current[projectId] || {};
    }
    function projectImageRunActive(projectId: string, nodeId: string, runId?: string) {
        if (runId && !manualImageJobsRef.current.has(runId))
            return false;
        return projectImageRunStarts(projectId)[nodeId] !== undefined;
    }
    function markImageRunStarted(nodeId: string, startedAt: number, projectId = activeProjectIdRef.current) {
        const next = { ...projectImageRunStarts(projectId), [nodeId]: startedAt };
        projectImageStartsRef.current[projectId] = next;
        updateProjectRun(projectId, (current) => ({ ...current, imageRunStarts: next }));
        commitActiveProjectImageRuns(projectId, next);
    }
    function markImageRunFinished(nodeId: string, projectId = activeProjectIdRef.current) {
        const next = { ...projectImageRunStarts(projectId) };
        delete next[nodeId];
        projectImageStartsRef.current[projectId] = next;
        updateProjectRun(projectId, (current) => ({ ...current, imageRunStarts: next }));
        commitActiveProjectImageRuns(projectId, next);
    }
    function commitExecutionReservation(reservationId: string | null) {
        executionReservationRef.current = reservationId;
        setExecutionReservation(Boolean(reservationId));
    }
    function currentExecutionScope(taskSignature: string): AgentExecutionScopeSnapshot {
        return {
            projectId: activeProjectIdRef.current,
            conversationId: activeConversationIdRef.current,
            taskSignature
        };
    }
    function executionScopeIsCurrent(scope: AgentExecutionScopeSnapshot) {
        return agentExecutionScopeMatches(scope, currentExecutionScope(scope.taskSignature));
    }
    const callVideo = useStableEvent(async (action:string, args:Record<string,unknown> = {}):Promise<VideoReply> => {
        const projectId = videoEditor?.projectId || activeProjectIdRef.current;
        if (projectId !== activeProjectIdRef.current || projectTransitionRef.current)
            throw Error("画布已切换，请返回原画布继续剪辑。");
        return await window.aieyraMatrix.execute({ projectId, conversationId: activeConversationIdRef.current,
            name: "videos." + action, arguments: args }) as VideoReply;
    });
    const matrixRequest = useStableEvent(async ({ action, args = {}, scope }: {
        action: string;
        args?: Record<string, any>;
        scope?: {
            projectId?: string;
            conversationId?: string;
            canvasProjectId?: string;
        };
    }): Promise<unknown> => {
        if (action === "documents.mount")
            return mountStudioDocument(args.document);
        if (action === "database.use") {
            if (args.projectId !== scope?.canvasProjectId)
                throw Error("数据库引用项目与 画布助手 不一致。");
            return useDatabaseReference(args.reference, canvasCenterToWorld(), args.projectId);
        }
        if (action === "annotations.read" || action === "annotations.preview") {
            const projectId = scope?.canvasProjectId;
            if (!projectId || args.projectId && args.projectId !== projectId)
                throw Error("标记读取项目不一致。");
            let sourceNodes = nodesRef.current;
            if (projectId !== activeProjectIdRef.current) {
                const loaded = await window.aieyraConfig!.loadSession(projectId ? { projectId } : undefined);
                if (!loaded.ok || !loaded.session)
                    throw Error("读取标记项目失败。");
                sourceNodes = normalizeWorkflowSession(loaded.session, { preserveRuntimeState: true }).nodes;
            }
            const selected = sourceNodes.filter(n => !args.nodeId || n.id === args.nodeId).flatMap(n => (n.assets || []).flatMap((asset, index) => asset.annotations && (!Number.isInteger(args.assetIndex) || index === args.assetIndex) ? [{ nodeId: n.id, assetIndex: index, asset, annotations: asset.annotations, current: marksCurrent(asset, asset.annotations) }] : []));
            if (action === "annotations.read")
                return { ok: true, projectId, images: selected };
            if (selected.length !== 1)
                throw Error("请指定一个有标记的节点和图片序号。");
            return { ok: true, dataUrl: await (await import("./studio")).renderMarkedImage(selected[0].asset, selected[0].annotations), annotations: selected[0].annotations };
        }
        if (action === "images.context") {
            const projectId = scope?.canvasProjectId;
            if (!projectId || projectsRef.current.find(p => p.id === projectId)?.kind !== "image")
                throw Error("画布助手 所属画布不可用。");
            if (projectTransitionRef.current || fileActionBusyRef.current)
                throw Error("画布正在保存或切换，请稍后重试。");
            const visible = projectId === activeProjectIdRef.current;
            let session = visible ? null : projectRunsRef.current[projectId]?.session;
            if (!visible && !session) {
                const loaded = await window.aieyraConfig!.loadSession(projectId ? { projectId } : undefined);
                if (!loaded.ok || !loaded.session)
                    throw Error("读取画布失败。");
                session = normalizeWorkflowSession(loaded.session, { preserveRuntimeState: true });
            }
            const projection = projectCanvasImageLayouts(visible ? nodesRef.current : session!.nodes, visible ? layoutGroupsRef.current : session!.layoutGroups || []);
            const nodeIds = [...new Set<string>([...(args.nodeIds || []), ...(args.input?.parentId ? [args.input.parentId] : [])])];
            const selected = nodeIds.map(id => {
                const node = projection.canvasNodeById.get(projection.groupByMember.get(id)?.hostNodeId ?? id);
                if (!node)
                    throw Error(`引用节点 ${id} 已不存在，请重新读取画布。`);
                return node;
            });
            const canvasRevision = visible ? canvasRevisionRef.current : session!.canvasRevision;
            const conversationId = visible ? activeConversationIdRef.current : session!.activeConversationId;
            const taskScope = await agentTaskScopeForRequest(selected, [], null, "chat", canvasRevision);
            return { ok: true, projectId, conversationId, canvasRevision,
                nodes: projection.canvasNodes, selectedNodeId: nodeIds[0], selectedNodeIds: nodeIds, taskScope };
        }
        if (action === "videos.commit") {
            if (!args.projectId || args.projectId !== scope?.canvasProjectId || args.projectId !== activeProjectIdRef.current || projectTransitionRef.current)
                throw Error("视频已保存，请回到原画布恢复成果。");
            const data = sanitizeVideoNode({asset:args.asset,timeline:args.timeline});
            if (!data) throw Error("视频成果缺少有效的素材或剪辑编号。");
            const existing = nodesRef.current.find(n => n.type === "video" &&
                (data.timeline ? n.video?.timeline?.id === data.timeline.id : n.video?.asset?.id === data.asset?.id));
            if (existing?.video?.timeline && data.timeline && existing.video.timeline.revision > data.timeline.revision)
                throw Error("画布已有更新版本的剪辑，旧回执未覆盖它。");
            if (!existing || JSON.stringify(existing.video) !== JSON.stringify(data)) {
                pushCanvasHistory(existing ? "更新视频剪辑" : "加入视频成果");
                const node = existing ? {...existing, video:data, title:data.timeline?.name || data.asset?.name || existing.title}
                    : {...videoNode(data,findOpenWorkflowNodePosition(nodesRef.current, {
                        width:380,height:280,preferredX:120,preferredY:160,
                        viewportCenter:canvasCenterToWorld(),cascadeIndex:nodesRef.current.length
                    })),zOrder:nextNodeZOrder(nodesRef.current)};
                nodesRef.current = existing ? nodesRef.current.map(n=>n.id === existing.id ? node : n) : [...nodesRef.current,node];
                setNodes(nodesRef.current);
                canvasRevisionRef.current++;
            }
            await flushActiveProjectSession();
            return {ok:true,projectId:args.projectId,nodeId:existing?.id || nodesRef.current[nodesRef.current.length-1].id};
        }
        if (action === "images.commit") {
            const job = args.job as BackgroundImageJob;
            if (!job || job.projectId !== scope?.canvasProjectId || job.reviewContext?.matrixProjectId !== scope?.projectId || job.reviewContext?.matrixConversationId !== scope?.conversationId)
                throw Error("图片成果归属不一致。");
            await recoverImageJobProject(job);
            handleBackgroundImageProgress({ phase: args.partial ? "image-progress" : "background-image-result", backgroundJobId: job.id, runId: job.id,
                projectId: job.projectId, conversationId: job.conversationId, imageJob: job, summary: job.result?.envelope?.summary });
            if (args.partial) {
                const partialEntry = backgroundImageJobsRef.current.get(job.id);
                if (partialEntry)
                    commitBackgroundImageActions(partialEntry, job.actions);
            }
            await goalFeedbackCommitsRef.current.get(job.id);
            const entry = backgroundImageJobsRef.current.get(job.id), record = imageJobRecord(job.projectId, job.conversationId);
            if (!entry || !record)
                throw Error("画布尚未恢复，成果保留等待提交。");
            const saved = await persistProjectSession(job.projectId, record.session);
            if (saved.applied === false || saved.skippedStale)
                throw Error("画布已有更新，图片成果尚未确认保存，请重新检查。");
            const ids = new Set(args.partial ? job.actions.map(action => entry.nodeIds[action.toolRunId || action.operationId || action.node?.id || job.id]).filter(Boolean) : Object.values(entry.nodeIds));
            const outputs = record.session.nodes.filter(node => ids.has(node.id) && node.assets?.length).map(node => ({
                nodeId: node.id, displayCode: node.displayCode || node.id, title: node.title,
                assets: (node.assets || []).map(asset => ({ path: asset.path, assetUrl: asset.assetUrl, displayCode: asset.displayCode }))
            }));
            if (job.status === "completed" && !outputs.length)
                return { ok: false, error: "图片已返回，但未找到已保存的成果节点。" };
            return { ok: true, projectId: job.projectId, outputs };
        }
        if (action === "images.actions") {
            if (args.projectId !== scope?.canvasProjectId || activeProjectIdRef.current !== args.projectId || projectTransitionRef.current)
                throw Error("请打开任务所属画布后再修改或定位节点。");
            if (projectHasImageWork(args.projectId))
                throw Error("图片仍在生成，请等待完成后修改画布。");
            if (args.canvasRevision !== canvasRevisionRef.current)
                throw Error("画布已变化，请重新读取后再操作。");
            pushCanvasHistory("画布 Agent 操作画布");
            const applied = await runtimeActionHandlerRef.current(args.actions || []);
            const failed = applied.commits.find(commit => commit.status !== "done");
            if (failed)
                throw Error(failed.summary);
            await flushActiveProjectSession();
            return { ok: true };
        }
        if (action === "images.import") {
            if (args.projectId !== scope?.canvasProjectId || activeProjectIdRef.current !== args.projectId || projectTransitionRef.current)
                throw Error("请打开任务所属画布后导入素材。");
            if (args.canvasRevision !== canvasRevisionRef.current)
                throw Error("画布已变化，请重新读取后导入素材。");
            const rect = canvasRef.current?.getBoundingClientRect();
            const point = clientToWorld((rect?.left || 0) + (rect?.width || 800) * .65, (rect?.top || 0) + 160);
            pushCanvasHistory("画布 Agent 导入素材");
            const id = createImageContainerAt(point.x, point.y, args.assets, undefined, { title: args.title || "画布 Agent 导入素材" });
            canvasRevisionRef.current++;
            await flushActiveProjectSession();
            return { ok: true, projectId: args.projectId, node: nodesRef.current.find(node => node.id === id) };
        }
        if (action === "images.locate") {
            if (args.projectId !== scope?.canvasProjectId)
                throw Error("图片不属于当前 画布助手 项目。");
            if (!await switchProject(args.projectId))
                throw Error("目标画布暂时无法打开。");
            if (!nodesRef.current.some(node => node.id === args.nodeId))
                throw Error("成果节点已移除，历史回执保留。");
            await runtimeActionHandlerRef.current([{ type: "workflow.node.focus", id: args.nodeId }]);
            return { ok: true };
        }
        if (action === "observe") {
            const projectId = scope?.canvasProjectId || activeProjectIdRef.current;
            const visible = projectId === activeProjectIdRef.current;
            return { ok: true, activeProjectId: projectId, visibleProjectId: activeProjectIdRef.current,
                matrixWorkspace: scope?.projectId ? { projectId: scope.projectId, conversationId: scope.conversationId, canvasProjectId: projectId } : matrixBindingRef.current?.canvasProjectId === projectId ? matrixBindingRef.current : null,
                projects: projectsRef.current.filter(p => p.id === projectId).map(p => ({ id: p.id, name: p.name, kind: p.kind, status: projectRunsRef.current[p.id]?.status || "idle" })),
                errors: visible ? [writingError, /失败|错误|异常|\berror\b|\bfailed\b/i.test(serverMessage || "") ? serverMessage : ""].filter(Boolean) : [], notifications: visible ? [serverMessage].filter(Boolean) : [] };
        }
        if (action === "settings.reload") {
            setSettings(await loadSettingsFromStore());
            return { ok: true };
        }
        if (action === "open_panel") {
            // 第109轮 R15：对话走 OS 统一侧栏；工具、项目、设置与模型连接已并入 OS，不再有独立入口。
            setProjectSidebarCollapsed(true);
            if (args.panel === "matrix") {

                setMatrixChatOpen(true);
            }
            else if (args.panel === "documents")
                throw Error("文档由 documents.manage 管理，请读取或打开具体文档。");
            else if (["tools", "projects", "settings", "connection", "database", "prompts"].includes(args.panel))
                throw Error("Workspace 专注画布；模型、提示词和工具请使用 OS 的共同入口。");
            else
                throw new Error("请选择 matrix 打开画布 Agent 对话。");
            return { ok: true };
        }
        if (action === "projects.refresh_list") {
            const list = await window.aieyraConfig!.listProjects!();
            if (!list.ok)
                throw new Error(list.error || "读取项目列表失败。");
            projectsRef.current = list.projects || [];
            setProjects(projectsRef.current);
            return { ok: true };
        }
        if (action === "projects.prepare") {
            for (const id of args.projectIds || [])
                if (["running", "waiting"].includes(projectRunsRef.current[id]?.status || "") || projectHasImageWork(id))
                    throw new Error("另一个窗口的项目正在创作，请完成后再复制。");
            if (args.projectIds?.includes(activeProjectIdRef.current)) {
                if (fileActionBusyRef.current || projectTransitionRef.current)
                    throw new Error("另一个窗口正在切换或保存项目，请稍后重试。");
                await flushActiveProjectSession();
            }
            return { ok: true };
        }
        if (action === "projects.refresh") {
            for (const id of args.projectIds || [])
                removeProjectRun(id);
            if (args.projectIds?.includes(activeProjectIdRef.current)) {
                const projectId = activeProjectIdRef.current;
                const loaded = await window.aieyraConfig!.loadSession(projectId ? { projectId } : undefined);
                if (loaded.ok && activeProjectIdRef.current === projectId)
                    await applyProjectSession({ ...loaded, project: projectsRef.current.find(p => p.id === projectId), projects: projectsRef.current, activeProjectId: projectId });
            }
            return { ok: true };
        }
        if (action === "projects.flush") {
            if (activeProjectIdRef.current === args.projectId) {
                if (fileActionBusyRef.current || projectTransitionRef.current)
                    throw new Error("项目操作正在提交，稍后重新读取即可获取最新内容。");
                await flushActiveProjectSession();
            }
            return { ok: true };
        }
        if (action === "projects.create") {
            // 第109轮 R15：只有一个画布。已有画布时返回它，不再新建第二个项目。
            const current = projectsRef.current.find(p => p.id === activeProjectIdRef.current && p.kind === "image" && !p.quarantine?.readOnly);
            if (current) {
                setProjectTabPreferences(value => openProjectTab(value, current.id));
                return { ok: true, project: current, existing: true };
            }
            if (args.kind && args.kind !== "image")
                throw new Error("请在当前画布中使用画布助手。");
            args.kind = "image";
            await flushActiveProjectSession();
            const result = await window.aieyraConfig!.createProject!({ name: args.name, kind: args.kind });
            if (!result.ok)
                throw new Error(result.error);
            await applyProjectSession(result);
            setProjectTabPreferences(current => openProjectTab(current, activeProjectIdRef.current));
            return { ok: true, project: result.project };
        }
        if (action === "projects.open") {
            if (args.projectId !== activeProjectIdRef.current)
                throw new Error("Workspace 只有一个画布，不能切换到其他项目。");
            setProjectTabPreferences(value => openProjectTab(value, args.projectId));
            return { ok: true };
        }
        if (action === "matrix.focus") {
            if (projectsRef.current.find(p => p.id === args.projectId)?.kind !== "agent" || typeof args.conversationId !== "string" || !args.conversationId || args.conversationId.length > 160)
                throw new Error("请提供有效 画布助手 项目和会话 ID。");
            const binding = await window.aieyraMatrix.workspace({ matrixProjectId: args.projectId });
            if (!binding.ok || !binding.canvasProjectId || !binding.projectId || !binding.conversationId)
                throw Error(binding.error || "画布助手 所属项目不可用。");
            if (!await switchProject(binding.canvasProjectId))
                throw Error("画布助手 所属项目暂时无法打开。");
            localStorage.setItem(`aieyra:coding:conversations:${args.projectId}:active`, args.conversationId);
            matrixBindingRef.current = { projectId: binding.projectId, conversationId: binding.conversationId, canvasProjectId: binding.canvasProjectId };

            setMatrixChatOpen(true);
            window.dispatchEvent(new CustomEvent("aieyra:matrix:focus", { detail: { projectId: args.projectId, conversationId: args.conversationId } }));
            return { ok: true, projectId: args.projectId, conversationId: args.conversationId };
        }
        if (action === "nodes.transfer")
            return transferProjectNodes(args as MatrixTransfer);
        if (action === "workspace.prepare_reload") {
            if (document.querySelector('[data-ui-dirty="true"], [data-ui-busy="true"], [data-recovery-blocked="true"]'))
                throw new Error("请先保存面板修改、完成连接配置或处理临时密钥，再重载界面。");
            if (fileActionBusyRef.current || projectTransitionRef.current || !["idle", "error"].includes(agentStatus) || pendingAgentExecution || nodeEditorDraft || nodeNoteDraft || requirementEditHistoryRef.current || Object.values(projectRunsRef.current).some(run => ["running", "waiting"].includes(run.status)))
                throw new Error("请先完成当前编辑、绘图或待回复任务，再重载界面。");
            await flushActiveProjectSession();
            await flushComposerDrafts();
            return { ok: true, projectId: activeProjectIdRef.current, matrixWorkspace: matrixBindingRef.current?.canvasProjectId === activeProjectIdRef.current ? matrixBindingRef.current : null };
        }
        if (action === "nodes.style") {
            if (!await switchProject(args.projectId))
                throw new Error("项目暂时无法打开。");
            const found = nodesRef.current.find(n => n.id === args.nodeId);
            if (!found)
                throw new Error("节点不存在。");
            const current = normalizeNodeStyle(found.appearance);
            const expected = normalizeNodeStyle(args.expected);
            if (Object.keys(current).length !== Object.keys(expected).length || Object.entries(current).some(([k, v]) => expected[k as keyof typeof expected] !== v))
                throw new Error("节点样式已变化，请重新 inspect 后再修改。");
            const appearance = normalizeNodeStyle(args.appearance);
            pushCanvasHistory("画布 Agent 修改节点样式");
            nodesRef.current = nodesRef.current.map(n => n.id === found.id ? { ...n, appearance } : n);
            setNodes(nodesRef.current);
            canvasRevisionRef.current++;
            await flushActiveProjectSession();
            return { ok: true, projectId: args.projectId, nodeId: found.id, appearance };
        }
        if (action === "nodes.create" || action === "nodes.update") {
            if (projectsRef.current.find(p => p.id === args.projectId)?.kind !== "image")
                throw new Error("此入口操作绘画节点；文档交给对应项目 Agent。");
            if (["running", "waiting"].includes(projectRunsRef.current[args.projectId]?.status || "") || projectHasImageWork(args.projectId))
                throw new Error("项目仍在创作，请完成后再编辑节点。");
            if (!await switchProject(args.projectId))
                throw new Error("项目暂时无法打开。");
            let node: WorkflowNode;
            if (action === "nodes.create") {
                if (!["requirement", "container"].includes(args.type))
                    throw new Error("请选择需求便签或图片容器。");
                const position = { x: Number.isFinite(args.x) ? args.x : 80, y: Number.isFinite(args.y) ? args.y : 80 };
                node = args.type === "container" ? buildImageContainerNodeAt(nodesRef.current, position.x, position.y, [], undefined, { title: args.title }) : buildReusableRequirement(nodesRef.current, "text-to-image", [], undefined, { title: args.title, text: args.text || "", ...position });
                pushCanvasHistory("画布 Agent 创建节点");
                nodesRef.current = [...nodesRef.current, node];
            }
            else {
                const found = nodesRef.current.find(n => n.id === args.nodeId);
                if (!found)
                    throw new Error("节点已经不存在。");
                const patch: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(args.patch || {})) {
                    if (!["title", "text", "prompt", "x", "y", "width", "height"].includes(key))
                        throw new Error(`此入口不支持修改 ${key}。`);
                    const current = key === "text" ? found.requirement?.text ?? found.note ?? "" : (found as unknown as Record<string, unknown>)[key];
                    if (!Object.prototype.hasOwnProperty.call(args.expected || {}, key) || args.expected[key] !== current)
                        throw new Error(`节点 ${key} 已变化，请重新读取。`);
                    if (["title", "text", "prompt"].includes(key) ? typeof value !== "string" || value.length > 120000 : typeof value !== "number" || !Number.isFinite(value) || (["width", "height"].includes(key) && value < 80))
                        throw new Error(`节点 ${key} 的值无效。`);
                    patch[key] = value as string | number;
                }
                const { text: patchedText, ...fields } = patch;
                if (found.requirement && typeof patchedText === "string" && fields.prompt !== undefined && fields.prompt !== patchedText)
                    throw new Error("需求正文与 prompt 应使用相同内容。");
                const text = typeof patchedText === "string" ? patchedText : found.requirement && typeof fields.prompt === "string" ? fields.prompt : undefined;
                node = { ...found, ...fields, ...(typeof text === "string" ? found.requirement ? {
                        prompt: text, requirement: { ...found.requirement, text, revision: found.requirement.revision + 1, lastError: undefined }
                    } : { note: text } : {}) };
                pushCanvasHistory("画布 Agent 修改节点");
                nodesRef.current = nodesRef.current.map(n => n.id === node.id ? node : n);
            }
            setNodes(nodesRef.current);
            canvasRevisionRef.current++;
            await flushActiveProjectSession();
            return { ok: true, projectId: args.projectId, node };
        }
        throw new Error(`未知 画布助手 界面操作：${action}`);
    });
    useEffect(() => {
        if (configReady)
            return window.aieyraMatrix?.onRequest(matrixRequest);
    }, [matrixRequest, configReady]);
    useEffect(() => window.aieyraMatrix?.onChanged(event => {
        if (event.kind === "settings")
            void matrixRequest({ action: "settings.reload" }).catch(error => setServerMessage(describeError(error)));
        if (event.kind === "projects" && event.reload)
            void matrixRequest({ action: "projects.refresh", args: { projectIds: event.projectIds } }).catch(error => setServerMessage(describeError(error)));
    }), [matrixRequest]);
    useEffect(() => {
        if (!backgroundReady || !window.aieyraMatrix)
            return;
        const style = document.createElement("style");
        style.dataset.matrixExtensions = "true";
        document.head.append(style);
        const load = () => void window.aieyraMatrix.styles().then(result => { style.textContent = result.css || ""; }).catch(() => { });
        load();
        const off = window.aieyraMatrix.onChanged(event => { if (event.kind === "extensions")
            load(); });
        return () => { off(); style.remove(); };
    }, [backgroundReady]);
    async function transferProjectNodes(input: MatrixTransfer) {
        if (fileActionBusyRef.current || projectTransitionRef.current)
            throw new Error("请等待当前项目操作结束。");
        for (const id of [input.sourceProjectId, input.targetProjectId])
            if (["running", "waiting"].includes(projectRunsRef.current[id]?.status || "") || projectHasImageWork(id))
                throw new Error("源项目或目标项目正在创作，请等待完成后复制。");
        // A same-canvas transfer saves a reference, without changing any nodes.
        // The host requests projects.flush before taking its snapshot, so this
        // read must not hold the mutation lock that protects real transfers.
        if (input.sourceProjectId === input.targetProjectId) {
            const result = await window.aieyraMatrix.transfer(input);
            if (!result.ok)
                throw new Error(result.error || "引用未完成。");
            return result;
        }
        commitFileActionBusy(true);
        try {
            await flushActiveProjectSession();
            const result = await window.aieyraMatrix.transfer(input);
            if (result.copied)
                removeProjectRun(input.targetProjectId);
            if (result.moved)
                removeProjectRun(input.sourceProjectId);
            if (result.copied && (activeProjectIdRef.current === input.targetProjectId || result.moved && activeProjectIdRef.current === input.sourceProjectId)) {
                removeProjectRun(activeProjectIdRef.current);
                const loaded = await window.aieyraConfig!.loadSession({ projectId: activeProjectIdRef.current });
                if (loaded.ok)
                    await applyProjectSession({ ...loaded, project: projectsRef.current.find(p => p.id === activeProjectIdRef.current), projects: projectsRef.current, activeProjectId: activeProjectIdRef.current });
            }
            if (!result.ok)
                throw new Error(result.error || "复制未完成。");
            const target = projectsRef.current.find(p => p.id === input.targetProjectId);
            showCanvasOperationNotice(`已${result.moved ? "移动" : "复制"}到 ${target?.name || "目标项目"}。`);
            return result;
        }
        finally {
            commitFileActionBusy(false);
        }
    }
    async function referenceNodesInMatrix(nodeIds: string[], text?: string, submit = false) {
        const sourceProjectId = activeProjectIdRef.current;
        const { projectId, conversationId, configured } = await requireCanvasBinding(sourceProjectId);
        const result = await transferProjectNodes({ sourceProjectId, targetProjectId: projectId, nodeIds: [...new Set(nodeIds)], mode: "copy" });
        if (!result.reference)
            throw Error("节点引用尚未保存。");
        if (activeProjectIdRef.current === sourceProjectId) {

            setMatrixChatOpen(true);
        }
        if (submit && configured) {
            const sent = await window.aieyraAgent!.coding({ projectId, conversationId, operation: "send", submissionId: crypto.randomUUID(), prompt: text || "请根据引用的需求与素材继续工作。", referenceIds: [result.reference.id] });
            if (!sent.ok)
                throw Error(sent.error || "画布 Agent 暂时无法接收任务。");
            try {
                localStorage.setItem(`matrix:refs:${projectId}`, JSON.stringify([...new Set([...readExcludedReferences(projectId), result.reference.id])]));
            }
            catch {
                showCanvasOperationNotice("任务已发送，但引用选择未能保存，请检查本地存储。");
            }
            await appendComposerDraft(projectId, conversationId, { removeReferenceIds: [result.reference.id] });
        }
        else {
            await appendComposerDraft(projectId, conversationId, { prompt: text, references: [{ ...result.reference, sourceProjectName: activeProjectName }] });
            showCanvasOperationNotice(submit ? "需求已加入右侧对话的草稿，配置模型后可继续。" : "已引用到右侧对话。");
        }
    }
    function canvasClipboardTarget(target: EventTarget | null) {
        const element = target instanceof Element ? target : null;
        return projectWorkspaceOpen && ["image", "writing"].includes(activeProject?.kind || "") && !fileActionBusyRef.current && !projectTransitionRef.current &&
            !element?.closest('input, textarea, [contenteditable="true"], [role="dialog"], .coding-workbench') &&
            !imageViewer && !layerViewer && !manualImageTaskDialog && !nodeEditorDraft && !regionRedrawDraft;
    }
    function copySelectedCanvasNodes(event: React.ClipboardEvent<HTMLElement>) {
        if (!canvasClipboardTarget(event.target) || window.getSelection()?.isCollapsed === false)
            return;
        const selected = activeProject?.kind === "writing" ? [writingSessionRef.current.selectedArtifactId].filter(Boolean)
            : selectedNodeIdsRef.current.length ? selectedNodeIdsRef.current : [selectedNodeIdRef.current].filter(id => nodesRef.current.some(node => node.id === id));
        if (!selected.length)
            return;
        const copied = activeProject?.kind === "writing" ? { version: 1 as const, nodes: [], groups: [] } : copyCanvasSelection(nodesRef.current, layoutGroupsRef.current, selected);
        const value = { ...copied, source: { projectId: activeProjectIdRef.current, projectName: activeProjectName, kind: activeProject?.kind, nodeIds: selected } };
        event.preventDefault();
        event.clipboardData.setData(canvasClipboardMime, JSON.stringify(value));
        event.clipboardData.setData("text/plain", `@${activeProjectName} ${selected.map(id => `@${id}`).join(" ")}`);
        showCanvasOperationNotice(`已复制 ${selected.length} 个节点，可切换项目粘贴。`);
    }
    function pasteCanvasClipboard(event: React.ClipboardEvent<HTMLElement>) {
        const nodeClipboard = event.clipboardData.getData(canvasClipboardMime);
        if (nodeClipboard && (activeProject?.kind === "agent" || canvasClipboardTarget(event.target))) {
            try {
                const value = JSON.parse(nodeClipboard);
                if (value.source?.projectId && Array.isArray(value.source.nodeIds)) {
                    event.preventDefault();
                    event.stopPropagation();
                    void transferProjectNodes({ sourceProjectId: value.source.projectId, targetProjectId: activeProjectIdRef.current, nodeIds: value.source.nodeIds }).catch(error => { showCanvasOperationNotice(describeError(error)); setServerMessage(describeError(error)); });
                    return;
                }
            }
            catch { }
        }
        if (!canvasClipboardTarget(event.target))
            return;
        const content = event.clipboardData.getData(canvasClipboardMime);
        const files = transferredFiles(event.clipboardData);
        const hasImage = clipboardHasImage(event);
        if (!content && files.length) {
            event.preventDefault();
            event.stopPropagation();
            const rect = canvasRef.current?.getBoundingClientRect();
            void importCanvasFiles(files, (rect?.left || 0) + (rect?.width || 800) / 2, (rect?.top || 0) + 180);
            return;
        }
        if (!content && !hasImage)
            return;
        event.preventDefault();
        event.stopPropagation();
        const projectId = activeProjectIdRef.current;
        const view = viewportRef.current;
        const position = { x: (canvasViewportSize.width / 2 - view.x) / view.scale, y: (canvasViewportSize.height / 2 - view.y) / view.scale };
        commitFileActionBusy(true);
        void (async () => {
            try {
                let nextNodes: WorkflowNode[], nextGroups: ImageLayoutGroup[] = [];
                if (content) {
                    const copied = readCanvasClipboard(content);
                    const result = await window.aieyraConfig?.importCanvasAssets?.({ projectId, paths: clipboardAssetPaths(copied) });
                    if (!result?.ok)
                        throw new Error(result?.error || "节点粘贴需要重启开发版加载最新功能。");
                    if (activeProjectIdRef.current !== projectId || projectTransitionRef.current)
                        throw new Error("画布已切换，请回原画布重新粘贴。");
                    const ids = new Map(copied.nodes.map((node:WorkflowNode) => [node.id, allocateNodeCode()]));
                    const pasted = pasteCanvasSelection(copied, ids, result.assets || {}, position, nextNodeZOrder(nodesRef.current));
                    nextNodes = pasted.nodes;
                    nextGroups = pasted.groups;
                }
                else {
                    const result = await window.aieyraConfig?.importClipboardImage?.({ projectId });
                    if (!result?.ok || !result.asset)
                        throw new Error(result?.error || "图片粘贴需要重启开发版加载最新功能。");
                    if (activeProjectIdRef.current !== projectId || projectTransitionRef.current)
                        throw new Error("画布已切换，请回原画布重新粘贴。");
                    const host = buildImageContainerNodeAt(nodesRef.current, position.x, position.y, [result.asset], undefined, { title: "粘贴的图片" });
                    nextNodes = [{ ...host, imageContainer: false, imageContainerSpec: undefined, branch: "image-import" }];
                }
                pushCanvasHistory("粘贴节点");
                setNodes([...nodesRef.current, ...nextNodes]);
                if (nextGroups.length)
                    setLayoutGroups([...layoutGroupsRef.current, ...nextGroups]);
                selectNodeGroup(nextNodes.map(node => node.id), nextNodes[0]?.id);
                notifyAgentOfManualAction("粘贴节点", "");
                await flushActiveProjectSession();
                showCanvasOperationNotice(`已粘贴 ${nextNodes.length} 个节点。`);
            }
            catch (error) {
                showCanvasOperationNotice(describeError(error));
            }
            finally {
                commitFileActionBusy(false);
            }
        })();
    }
    function allocateNodeCode(sourceNodes: WorkflowNode[] = nodesRef.current) {
        const code = nextNodeId(sourceNodes, nodeSequenceRef.current);
        nodeSequenceRef.current = Math.max(nodeSequenceRef.current, nodeSequenceFromCode(code));
        return code;
    }
    function observeAllocatedNodeCode(code: unknown) {
        nodeSequenceRef.current = Math.max(nodeSequenceRef.current, nodeSequenceFromCode(code));
    }
    function nextManualImageNodeId() {
        const reserved = Object.keys(imageRunStartsRef.current).map((id) => ({ id }) as WorkflowNode);
        return allocateNodeCode([...nodes, ...reserved]);
    }
    function updateNode(id: string, patch: Partial<WorkflowNode>) {
        setNodes((current) => {
            const next = moveBy(current, (node) => node.id === id, (node) => ({ ...node, ...patch }));
            nodesRef.current = next;
            return next;
        });
    }
    function recordImageGenerationDuration(startedAt: number) {
        const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const current = imageGenerationStatsRef.current;
        const next = {
            count: current.count + 1,
            totalSeconds: current.totalSeconds + seconds,
            lastSeconds: seconds,
            updatedAt: new Date().toISOString()
        };
        imageGenerationStatsRef.current = next;
        writeJson(STORAGE_IMAGE_STATS, next);
        return seconds;
    }
    async function refreshOfficialQuotaAuthority() {
        let user = serverUserRef.current;
        let wallet = serverWallet;
        let selectedToken = officialTokens.find((token) => token.id === selectedOfficialTokenId) ?? null;
        try {
            const result = await window.aieyraServer?.me?.();
            if (result?.ok) {
                user = result.user ?? user;
                wallet = result.wallet ?? wallet;
                if (user)
                    await acceptServerUserIdentity(user);
                else
                    commitServerUser(null);
                setServerWallet(wallet ?? null);
                setServerKeyStatus(result.keyStatus ?? null);
                setOfficialTokens(result.tokens ?? []);
                setSelectedOfficialTokenId(result.selectedTokenId ?? "");
                selectedToken = (result.tokens ?? []).find((token) => token.id === result.selectedTokenId) ?? null;
            }
        }
        catch {
        }
        const connection = await refreshConnectionState();
        return { user, wallet, selectedToken, connection };
    }
    function quotaBlockFromGenerateResult(task: ImageTaskDraft, result: Pick<Awaited<ReturnType<ServerBridge["generateImage"]>>, "error" | "errorCategory" | "balanceCents" | "costCents" | "deficitCents" | "paidImages" | "trialImagesUsed" | "trialImagesRemaining">): ImageQuotaDialogState | null {
        const isQuotaError = result.errorCategory === "quota" || /余额不足|insufficient|balance/i.test(result.error ?? "") || Number(result.deficitCents) > 0;
        if (!isQuotaError)
            return null;
        const requestedCount = clamp(Math.round(Number(task.count) || 1), 1, 10);
        const trialImagesUsed = Math.max(0, Number(result.trialImagesUsed ?? 0) || 0);
        const paidImages = Math.max(0, Number(result.paidImages ?? requestedCount - trialImagesUsed) || 0);
        const requiredCents = Math.max(0, Number(result.costCents ?? 0) || 0);
        const rawReportedBalance = result.balanceCents;
        const reportedBalance = rawReportedBalance === null || rawReportedBalance === undefined || String(rawReportedBalance).trim() === ""
            ? Number.NaN
            : Number(rawReportedBalance);
        const balanceCents = Number.isFinite(reportedBalance) && reportedBalance >= 0
            ? Math.round(reportedBalance)
            : null;
        const imageCostCents = paidImages > 0 ? Math.round(requiredCents / paidImages) : Math.max(0, Number(serverWallet?.imageCostCents ?? 0) || 0);
        const rawReportedDeficit = result.deficitCents;
        const reportedDeficit = rawReportedDeficit === null || rawReportedDeficit === undefined || String(rawReportedDeficit).trim() === ""
            ? Number.NaN
            : Number(rawReportedDeficit);
        const deficitCents = Number.isFinite(reportedDeficit) && reportedDeficit >= 0
            ? Math.round(reportedDeficit)
            : balanceCents === null
                ? null
                : Math.max(0, requiredCents - balanceCents);
        return {
            requestedCount,
            trialImagesAvailable: Math.max(0, Number(result.trialImagesRemaining ?? serverUser?.trialImagesRemaining ?? 0) || 0),
            trialImagesUsed,
            paidImages,
            imageCostCents,
            balanceCents,
            requiredCents,
            deficitCents
        };
    }
    async function blockImageTaskIfQuotaInsufficient(_task: ImageTaskDraft) {
        if (connectionSnapshotRef.current.mode !== "official")
            return false;
        const snapshot = await refreshOfficialQuotaAuthority();
        if (snapshot.connection?.aiReady && snapshot.selectedToken?.usable !== false)
            return false;

        openOSModelSettings();
        setServerMessage(snapshot.selectedToken && !snapshot.selectedToken.usable
            ? "所选 Aieyra Key 已停用、过期或额度不足，请重新选择。"
            : "当前 Aieyra Key 尚未就绪，请重新连接或选择其他 Key。");
        return true;
    }
    function clientToWorld(clientX: number, clientY: number) {
        const rect = canvasRef.current?.getBoundingClientRect();
        return canvasPlatformWorldPoint(viewportRef.current, {
            x: clientX - (rect?.left ?? 0),
            y: clientY - (rect?.top ?? 0)
        });
    }
    function canvasCenterToWorld() {
        const rect = canvasRef.current?.getBoundingClientRect();
        return clientToWorld((rect?.left ?? 0) + (rect?.width ?? 720) / 2, (rect?.top ?? 0) + (rect?.height ?? 460) / 2);
    }
    function connectNodes(sourceId: string, targetId: string, relationType: WorkflowNode["relationType"] = "derived-from") {
        if (!sourceId || !targetId || sourceId === targetId)
            return false;
        const sourceNode = nodesRef.current.find((node) => node.id === sourceId);
        const targetNode = nodesRef.current.find((node) => node.id === targetId);
        if (!sourceNode || !targetNode)
            return false;
        if (targetNode.type === "requirement" && sourceNode.type !== "image") {
            showCanvasOperationNotice("需求节点左侧只能连接图片、图片容器或分层成果。");
            return false;
        }
        if (sourceNode.type === "requirement" && targetNode.type === "requirement") {
            showCanvasOperationNotice("需求节点不能串联需求节点，请把需求连接到图片成果。");
            return false;
        }
        const effectiveRelation = targetNode.type === "requirement"
            ? "referenced"
            : sourceNode.type === "requirement"
                ? "derived-from"
                : relationType || "derived-from";
        const currentRequirementBindings = targetNode.type === "requirement"
            ? requirementInputBindings(targetNode, nodesRef.current)
            : [];
        const existingRequirementBinding = currentRequirementBindings.find((binding) => binding.nodeId === sourceId);
        const requirementBinding = targetNode.type === "requirement" && targetNode.requirement
            ? existingRequirementBinding || { nodeId: sourceId, role: "reference" as const }
            : undefined;
        if (targetNode.type === "requirement") {
            if (existingRequirementBinding?.role === requirementBinding?.role &&
                existingRequirementBinding?.purpose === requirementBinding?.purpose)
                return false;
        }
        else if (targetNode.parentId === sourceId && (targetNode.relationType || "derived-from") === effectiveRelation) {
            return false;
        }
        if (wouldCreateWorkflowConnectionCycle(nodesRef.current, sourceId, targetId)) {
            addEvent("阻止会形成循环的连线");
            showCanvasOperationNotice("这条连线会让两个工作流互相引用，已为你保留原有关系。");
            return false;
        }
        pushCanvasHistory(targetNode.type === "requirement" ? "连接需求来源" : "调整成果关系");
        const nextNodes: WorkflowNode[] = nodesRef.current.map((node): WorkflowNode => {
            if (node.id !== targetId)
                return node;
            if (node.type === "requirement" && node.requirement && requirementBinding) {
                const requirement = upsertRequirementInputBinding(node.requirement, requirementBinding);
                const bindings = requirementInputBindings({ ...node, requirement, parentId: node.parentId }, nodesRef.current);
                return {
                    ...node,
                    parentId: primaryRequirementInputNodeId(bindings) || undefined,
                    relationType: effectiveRelation,
                    requirement,
                };
            }
            return { ...preserveImageOrigins(node, nodesRef.current), parentId: sourceId, relationType: effectiveRelation };
        });
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setSelectedNodeId(targetId);
        setActiveNodeId(targetId);
        window.setTimeout(() => setActiveNodeId(null), 700);
        addEvent(`连线 ${sourceId} -> ${targetId}`);
        notifyAgentOfManualAction("调整成果关系", targetNode.type === "requirement"
            ? `用户将图片 ${sourceId} 连接到需求 ${targetId}，图片用途由需求正文决定。`
            : `用户将成果 ${sourceId} 设为成果 ${targetId} 的来源。`);
        return true;
    }
    function droppedPathsFromFiles(files: File[]) {
        const paths = files.map((file) => {
            try {
                return window.aieyraConfig?.pathForDroppedFile?.(file) || (file as File & {
                    path?: string;
                }).path || "";
            }
            catch {
                return (file as File & {
                    path?: string;
                }).path || "";
            }
        }).filter(Boolean);
        return Array.from(new Set(paths));
    }
    function clampNodeWorldPosition(position: {
        x: number;
        y: number;
    }, width: number, height: number) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const viewportNow = viewportRef.current;
        if (!rect || rect.width <= 1 || rect.height <= 1)
            return position;
        const scale = Math.max(viewportNow.scale || 1, ZOOM_MIN);
        const padding = 18 / scale;
        const minX = (-viewportNow.x) / scale + padding;
        const minY = (-viewportNow.y) / scale + padding;
        const maxX = (rect.width - viewportNow.x) / scale - width - padding;
        const maxY = (rect.height - viewportNow.y) / scale - height - padding;
        return {
            x: Math.round(clamp(position.x, Math.min(minX, maxX), Math.max(minX, maxX))),
            y: Math.round(clamp(position.y, Math.min(minY, maxY), Math.max(minY, maxY)))
        };
    }
    function mergeContainerAssets(currentAssets: ImageAsset[] = [], incomingAssets: ImageAsset[] = [], displayPrefix = "I", minimumSequence = 0) {
        const merged = new Map<string, ImageAsset>();
        for (const asset of [...currentAssets, ...incomingAssets]) {
            const key = asset.occurrenceId
                ? `occurrence:${asset.occurrenceId}`
                : asset.path || asset.assetUrl || asset.url || `${asset.runId || "asset"}-${asset.index || merged.size + 1}`;
            if (!merged.has(key))
                merged.set(key, { ...asset });
        }
        return imageAssetsWithIdentity(Array.from(merged.values()), displayPrefix, minimumSequence);
    }
    async function importExternalImagePaths(paths: string[], maxFiles = 2000) {
        if (!paths.length)
            return { ok: false, assets: [] as ImageAsset[], error: "没有可导入的本地路径。" };
        if (!window.aieyraConfig?.importLocalImages)
            return { ok: false, assets: [] as ImageAsset[], error: "当前环境不支持批量导入本地图片。" };
        const requestProjectId = activeProjectIdRef.current;
        const result = await window.aieyraConfig.importLocalImages({ paths, projectId: requestProjectId, maxFiles });
        if (activeProjectIdRef.current !== requestProjectId) {
            return { ok: false, assets: [] as ImageAsset[], error: "画布已切换，本次导入结果不会加入当前画布。" };
        }
        if (!result?.ok)
            return { ok: false, assets: [] as ImageAsset[], error: result?.error || "图片入库失败。" };
        return { ...result, assets: cloneImageAssets(result.assets ?? []) };
    }
    function buildImageContainerNodeAt(sourceNodes: WorkflowNode[], worldX: number, worldY: number, incomingAssets: ImageAsset[] = [], role?: "source" | "reference", options: {
        kind?: Exclude<ImageContainerKind, "container-group">;
        title?: string;
        prompt?: string;
        sourceLabel?: string;
        importBatchId?: string;
        layoutOrigin?: "manual" | "auto" | "generation";
    } = {}): WorkflowNode {
        const id = allocateNodeCode(sourceNodes);
        const assets = mergeContainerAssets([], incomingAssets, id);
        const compactTaskPreview = role === "source" || role === "reference";
        const containerWidth = compactTaskPreview ? TASK_IMAGE_CONTAINER_W : IMAGE_CONTAINER_W;
        const containerHeight = compactTaskPreview ? TASK_IMAGE_CONTAINER_H : IMAGE_CONTAINER_H;
        const preferredPosition = clampNodeWorldPosition({ x: worldX, y: worldY }, containerWidth, containerHeight);
        const openPosition = findOpenWorkflowNodePosition(sourceNodes, {
            width: containerWidth,
            height: containerHeight,
            preferredX: preferredPosition.x,
            preferredY: preferredPosition.y
        });
        const position = { x: Math.round(openPosition.x), y: Math.round(openPosition.y) };
        const kind = options.kind || "manual";
        const node: WorkflowNode = {
            id,
            displayCode: id,
            assetSequence: imageAssetSequence(assets, id),
            title: options.title || (role === "source" ? "本轮原图" : role === "reference" ? "本轮参考图" : kind === "folder" ? "文件夹容器" : "图片容器"),
            prompt: options.prompt || (role ? "本轮消息素材。" : kind === "folder" ? "用户导入的文件夹；保留源目录内的逻辑图片边界。" : "项目图片库；图片可拖出为独立成果。"),
            type: "image",
            status: "done",
            x: position.x,
            y: position.y,
            branch: kind === "folder" ? "image-folder-container" : "image-container",
            outputs: assets.length,
            createdAt: nowLabel(),
            assets,
            imageState: assets.length ? "done" : "empty",
            imageContainer: true,
            imageContainerRole: role,
            imageContainerSpec: {
                version: 1,
                kind,
                memberNodeIds: [],
                childContainerNodeIds: [],
                memberBindings: directImageContainerBindings(id, assets, [], role),
                sourceLabel: options.sourceLabel || (role === "source" ? "本轮原图" : role === "reference" ? "本轮参考图" : undefined),
                importBatchId: options.importBatchId || incomingAssets.find((asset) => asset.importBatchId)?.importBatchId || (incomingAssets.length ? uid("import-batch") : undefined),
                layoutOrigin: options.layoutOrigin || "manual",
                autoFit: true
            },
            width: containerWidth,
            height: containerHeight,
            zOrder: nextNodeZOrder(sourceNodes)
        };
        return node;
    }
    function createImageContainerAt(worldX: number, worldY: number, incomingAssets: ImageAsset[] = [], role?: "source" | "reference", options: Parameters<typeof buildImageContainerNodeAt>[5] = {}) {
        const nextNode = buildImageContainerNodeAt(nodesRef.current, worldX, worldY, incomingAssets, role, options);
        const id = nextNode.id;
        const nextNodes = [...nodesRef.current, nextNode];
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        if (!role)
            setSelectedNodeId(id);
        if (!role)
            setActiveNodeId(id);
        setCanvasMenu(null);
        if (!role)
            window.setTimeout(() => setActiveNodeId(null), 700);
        return id;
    }
    function setImageContainerTaskRole(nodeId: string, role?: AssetTaskRole) {
        const sourceNode = nodesRef.current.find((node) => node.id === nodeId && node.type === "image" && nodeUsesImageContainer(node));
        if (!sourceNode)
            return false;
        if (sourceNode.imageContainerRole === role)
            return false;
        pushCanvasHistory(role === "source" ? "设为原图容器" : role === "reference" ? "设为参考图容器" : "恢复普通图片容器");
        const defaultTitles = new Set(["本轮原图", "本轮参考图", "图片容器", "项目图片库"]);
        const nextNodes: WorkflowNode[] = nodesRef.current.map((node): WorkflowNode => {
            if (node.id === nodeId) {
                const assets = (node.assets ?? []).map((asset) => ({ ...asset, taskRole: role }));
                const spec = imageContainerSpecForNode(node);
                return applyImageContainerCompatibility({
                    ...node,
                    title: defaultTitles.has(node.title) ? role === "source" ? "本轮原图" : role === "reference" ? "本轮参考图" : "图片容器" : node.title,
                    assets,
                    imageContainerRole: role,
                    width: role === "source" || role === "reference" ? TASK_IMAGE_CONTAINER_W : Math.max(Number(node.width ?? IMAGE_CONTAINER_W), IMAGE_CONTAINER_MIN_W),
                    height: role === "source" || role === "reference" ? TASK_IMAGE_CONTAINER_H : Math.max(Number(node.height ?? IMAGE_CONTAINER_H), IMAGE_CONTAINER_MIN_H),
                    imageContainerSpec: spec ? {
                        ...spec,
                        sourceLabel: role === "source" ? "本轮原图" : role === "reference" ? "本轮参考图" : undefined,
                        memberBindings: spec.memberBindings.map((binding) => ({ ...binding, role })),
                    } : undefined,
                });
            }
            if (node.type === "requirement" && node.requirement) {
                const bindings = requirementInputBindings(node, nodesRef.current);
                if (!bindings.some((binding) => binding.nodeId === nodeId))
                    return node;
                const requirement = upsertRequirementInputBinding({ ...node.requirement, inputBindings: bindings }, { nodeId, role: role || "source" });
                const nextBindings = requirementInputBindings({ ...node, requirement }, nodesRef.current);
                return {
                    ...node,
                    requirement,
                    parentId: primaryRequirementInputNodeId(nextBindings) || undefined,
                    relationType: nextBindings.length ? "referenced" : undefined,
                };
            }
            return node;
        });
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        replaceSelectedNodeId(nodeId);
        setCanvasMenu(null);
        setActiveNodeId(nodeId);
        window.setTimeout(() => setActiveNodeId(null), 700);
        addEvent(`${nodeId} ${role === "reference" ? "设为参考图容器" : role === "source" ? "设为原图容器" : "恢复为普通图片容器"}`);
        notifyAgentOfManualAction("调整图片容器角色", `用户将容器 ${nodeId} ${role === "reference" ? "设为参考图" : role === "source" ? "设为需要处理的原图" : "恢复为未指定角色"}。`);
        return true;
    }
    function buildContainerGroupMutation(sourceNodes: WorkflowNode[], sourceGroups: ImageLayoutGroup[], requestedChildIds: string[], worldX: number, worldY: number, options: {
        title?: string;
        prompt?: string;
        sourceLabel?: string;
        importBatchId?: string;
        layoutOrigin?: "manual" | "auto" | "generation";
    } = {}) {
        const childContainerIds = [...new Set(requestedChildIds)].filter((id) => {
            const node = sourceNodes.find((item) => item.id === id);
            return Boolean(node && nodeUsesImageContainer(node) && !node.layerGroup && !node.layerComposition);
        });
        if (childContainerIds.length < 2)
            return null;
        const groupId = allocateNodeCode(sourceNodes);
        const groupHost: WorkflowNode = {
            id: groupId,
            displayCode: groupId,
            title: options.title || "容器组",
            prompt: options.prompt || "由多个图片或文件夹容器组成；子容器边界保持独立。",
            type: "image",
            status: "done",
            x: Math.round(worldX),
            y: Math.round(worldY),
            branch: "image-container-group",
            outputs: 0,
            createdAt: nowLabel(),
            assets: [],
            imageState: "empty",
            imageContainer: true,
            imageContainerSpec: {
                version: 1,
                kind: "container-group",
                memberNodeIds: [],
                childContainerNodeIds: [...childContainerIds],
                memberBindings: [],
                sourceLabel: options.sourceLabel || options.title || "容器组",
                importBatchId: options.importBatchId,
                layoutOrigin: options.layoutOrigin || "manual",
                autoFit: true
            },
            width: IMAGE_CONTAINER_W,
            height: IMAGE_CONTAINER_H,
            zOrder: nextNodeZOrder(sourceNodes)
        };
        const workingNodes = [...sourceNodes, groupHost];
        const replaceGroupIds = sourceGroups
            .filter((group) => childContainerIds.some((childId) => group.hostNodeId === childId || group.memberNodeIds.includes(childId)))
            .map((group) => group.id);
        const mutation = mergeImageLayoutSelection({ nodes: workingNodes, groups: sourceGroups }, {
            groupId: uid("image-layout"),
            hostNodeId: groupId,
            memberNodeIds: [groupId, ...childContainerIds],
            replaceGroupIds
        });
        return mutation.ok ? { hostNodeId: groupId, nodes: mutation.nodes, groups: mutation.groups, childContainerIds } : null;
    }
    function createImportedRootContainersAt(worldX: number, worldY: number, assets: ImageAsset[], roots: Array<{
        importBatchId: string;
        importRootIndex: number;
        importRootId: string;
        sourceRootLabel: string;
        sourceRootKind: "file" | "directory";
    }> = [], importBatchId = "") {
        const sourceNodes = nodesRef.current;
        const assetsByRoot = new Map<string, ImageAsset[]>();
        for (const asset of assets) {
            const rootId = asset.importRootId || "loose-files";
            const bucket = assetsByRoot.get(rootId) ?? [];
            bucket.push(asset);
            assetsByRoot.set(rootId, bucket);
        }
        const orderedRoots = roots
            .filter((root) => root.sourceRootKind === "directory" && assetsByRoot.has(root.importRootId))
            .sort((left, right) => left.importRootIndex - right.importRootIndex);
        const knownDirectoryIds = new Set(orderedRoots.map((root) => root.importRootId));
        for (const asset of assets) {
            if (asset.sourceRootKind !== "directory" || !asset.importRootId || knownDirectoryIds.has(asset.importRootId))
                continue;
            knownDirectoryIds.add(asset.importRootId);
            orderedRoots.push({
                importBatchId: asset.importBatchId || importBatchId,
                importRootIndex: orderedRoots.length,
                importRootId: asset.importRootId,
                sourceRootLabel: asset.sourceRootLabel || "导入文件夹",
                sourceRootKind: "directory"
            });
        }
        const looseAssets = assets.filter((asset) => asset.sourceRootKind !== "directory" || !asset.importRootId);
        let workingNodes = [...sourceNodes];
        const childContainerIds: string[] = [];
        for (const [index, root] of orderedRoots.entries()) {
            const rootAssets = assetsByRoot.get(root.importRootId) ?? [];
            if (!rootAssets.length)
                continue;
            const node = buildImageContainerNodeAt(workingNodes, worldX + index * 28, worldY + index * 24, rootAssets, undefined, {
                kind: "folder",
                title: root.sourceRootLabel || `文件夹 ${index + 1}`,
                sourceLabel: root.sourceRootLabel || `文件夹 ${index + 1}`,
                importBatchId: root.importBatchId || importBatchId,
                layoutOrigin: "auto"
            });
            workingNodes.push(node);
            childContainerIds.push(node.id);
        }
        if (looseAssets.length || childContainerIds.length === 0) {
            const node = buildImageContainerNodeAt(workingNodes, worldX + childContainerIds.length * 28, worldY + childContainerIds.length * 24, looseAssets.length ? looseAssets : assets, undefined, {
                kind: "manual",
                title: orderedRoots.length ? "零散图片" : "导入图片",
                sourceLabel: orderedRoots.length ? "零散图片" : "导入图片",
                importBatchId: importBatchId || assets.find((asset) => asset.importBatchId)?.importBatchId,
                layoutOrigin: "auto"
            });
            workingNodes.push(node);
            childContainerIds.push(node.id);
        }
        let containerId = childContainerIds[0] || "";
        if (childContainerIds.length >= 2) {
            const allFolders = looseAssets.length === 0;
            const grouped = buildContainerGroupMutation(workingNodes, layoutGroupsRef.current, childContainerIds, worldX, worldY, {
                title: allFolders ? "导入文件夹组" : "导入素材组",
                prompt: "由本次导入的多个素材根组成；每个文件夹边界保持独立，可分别或整体交给 Agent 处理。",
                sourceLabel: allFolders ? "导入文件夹组" : "导入素材组",
                importBatchId: importBatchId || assets.find((asset) => asset.importBatchId)?.importBatchId,
                layoutOrigin: "auto"
            });
            if (grouped) {
                commitImageLayout(grouped.nodes, grouped.groups, grouped.hostNodeId);
                containerId = grouped.hostNodeId;
            }
            else {
                nodesRef.current = workingNodes;
                setNodes(workingNodes);
            }
        }
        else {
            nodesRef.current = workingNodes;
            setNodes(workingNodes);
        }
        replaceSelectedNodeId(containerId);
        setActiveNodeId(containerId);
        window.setTimeout(() => setActiveNodeId(null), 700);
        return { containerId, childContainerIds, folderCount: orderedRoots.length };
    }
    function importNewAgentTaskImages(images: ReferenceImage[], taskRole: "source" | "reference") {
        if (!images.length)
            return null;
        const assets = images.map((image, index): ImageAsset => ({
            assetId: image.assetId || stableImageAssetId({ contentHash: image.contentHash, path: image.path, relativePath: image.relativePath, assetUrl: image.assetUrl, originalName: image.name }, index + 1),
            occurrenceId: image.occurrenceId,
            importBatchId: image.importBatchId,
            importRootId: image.importRootId,
            sourceRelativePath: image.sourceRelativePath,
            sourceRootLabel: image.sourceRootLabel,
            sourceRootKind: image.sourceRootKind,
            displayCode: image.displayCode,
            taskRole,
            contentHash: image.contentHash,
            index: index + 1,
            type: "file",
            path: image.path,
            relativePath: image.relativePath,
            assetUrl: image.assetUrl,
            originalName: image.name,
            status: "done"
        }));
        const rect = canvasRef.current?.getBoundingClientRect();
        const point = clientToWorld((rect?.left ?? 0) + Math.min((rect?.width ?? 720) * 0.68, 720), (rect?.top ?? 0) + 150);
        const id = createImageContainerAt(point.x, point.y, assets, taskRole);
        const node = nodesRef.current.find((item) => item.id === id) ?? null;
        addEvent(`附件 ${id} · ${assets.length} 张`);
        return node;
    }
    function prepareAgentTaskImages(sources: ReferenceImage[], references: ReferenceImage[]): ResolvedTaskImageAttachments | null {
        const readCurrent = () => {
            const projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
            return { projection, assets: projection.canvasNodes.flatMap(node => taskAssetReferencesForNode(node, "source", true, false)) };
        };
        let current = readCurrent();
        const source = resolveTaskImageAttachments(sources, current.assets, "source");
        const reference = resolveTaskImageAttachments(references, current.assets, "reference");
        const issues = [...source.issues, ...reference.issues];
        if (issues.length) {
            setServerMessage(`图片引用已变化：${issues.slice(0, 3).join("；")}。请移除失效附件或重新引用当前图片后发送。`);
            return null;
        }
        let materialized = false;
        for (const [images, role] of [[sources, "source"], [references, "reference"]] as const) {
            const pending = resolveTaskImageAttachments(images, current.assets, role).pending;
            const unique = pending.filter((image, index) => !pending.slice(0, index).some(other => resolveTaskImageAttachments([image], [{ ...other, assetId: other.assetId || "", displayCode: other.displayCode || "", role }], role).resolved.length));
            if (unique.length) {
                importNewAgentTaskImages(unique, role);
                materialized = true;
                current = readCurrent();
            }
        }
        const sourceAssets = resolveTaskImageAttachments(sources, current.assets, "source").resolved;
        const referenceAssets = resolveTaskImageAttachments(references, current.assets, "reference").resolved;
        const sourceNodes = [...new Set(sourceAssets.map(asset => asset.nodeId))]
            .map(id => current.projection.canvasNodeById.get(id || ""))
            .filter((node): node is WorkflowNode => Boolean(node));
        return { sourceAssets, referenceAssets, sourceNodes, materialized };
    }
    function openManualImageTaskAt(worldX: number, worldY: number, initialPrompt = "", forkFromNodeId = "", targetNodeId = "") {
        const draft = cloneImageTaskDraft({
            ...defaultImageTaskDraft(settings),
            prompt: initialPrompt.trim(),
            count: clamp(Number(settings.imageCount || 1), 1, 10),
            model: settings.imageModel || "",
            referenceImages: []
        });
        setCanvasMenu(null);
        setManualImageTaskDialog({
            draft,
            worldX: Math.round(worldX),
            worldY: Math.round(worldY),
            projectId: activeProjectIdRef.current,
            forkFromNodeId: forkFromNodeId || undefined,
            targetNodeId: targetNodeId || undefined
        });
    }
    function submitManualImageTask(dialog: ManualImageTaskDialogState) {
        if (dialog.projectId !== activeProjectIdRef.current) {
            setManualImageTaskDialog(null);
            setServerMessage("画布已经切换，请在当前画布重新手动生图。");
            return;
        }
        const task = cloneImageTaskDraft(dialog.draft);
        setManualImageTaskDialog(null);
        void runManualImageTask(task, {
            targetNodeId: dialog.targetNodeId,
            forkFromNodeId: dialog.forkFromNodeId,
            worldX: dialog.worldX,
            worldY: dialog.worldY,
            requestedCount: task.count,
            targetTotal: task.count,
            quotaChecked: false
        });
    }
    function submitImageTaskToAgent(dialog: ManualImageTaskDialogState) {
        if (dialog.projectId !== activeProjectIdRef.current || agentExecutionBusyNow())
            return;
        const draft = cloneImageTaskDraft(dialog.draft);
        const attachments = prepareAgentTaskImages([], draft.referenceImages || []);
        if (!attachments)
            return;
        setManualImageTaskDialog(null);
        const referenceMentions = attachments.referenceAssets.map(asset => `@${asset.displayCode}`).join(" ");
        const request = `${draft.prompt}\n\n输出设置：模型 ${draft.model || settings.imageModel}，${draft.ratio}，${draft.resolution}，质量 ${draft.quality}，${draft.count} 张。${referenceMentions ? `\n参考图片：${referenceMentions}` : ""}`;
        const sourceId = dialog.forkFromNodeId || dialog.targetNodeId;
        const note = createConnectedRequirement({ title: "生图需求", text: request, x: dialog.worldX, y: dialog.worldY,
            sourceNodeIds: sourceId ? [sourceId] : [] });
        executeRequirementNode(note.requirementNodeId);
    }
    async function importPickedImagesToCanvasAt(worldX: number, worldY: number) {
        const requestProjectId = activeProjectIdRef.current;
        setCanvasMenu(null);
        const pickLocalImages = window.aieyraConfig?.pickLocalImages;
        if (!pickLocalImages) {
            setServerMessage("当前环境不支持系统文件选择器导入图片。");
            return;
        }
        try {
            let result: {
                ok?: boolean;
                canceled?: boolean;
                assets?: ImageAsset[];
                error?: string;
            } | undefined;
            {
                result = await pickLocalImages?.({ projectId: requestProjectId, maxFiles: 2000 });
            }
            if (result?.canceled)
                return;
            if (activeProjectIdRef.current !== requestProjectId) {
                setServerMessage("画布已经切换，本次选择不会加入当前画布。");
                return;
            }
            const assets = cloneImageAssets(result?.assets ?? []);
            if (!result?.ok || !assets.length)
                throw new Error(result?.error || "没有找到可导入的 PNG/JPG/WEBP 图片。");
            const containerId = createImageContainerAt(worldX, worldY, assets);
            setServerMessage(`已将 ${assets.length} 张图片复制到项目图片库并放入图片容器。`);
            addEvent(`导入${assets.length}张`);
            notifyAgentOfManualAction("导入图片素材", `用户向图片容器 ${containerId} 导入 ${assets.length} 张项目库图片，可作为后续参考素材。`);
        }
        catch (error) {
            setServerMessage(friendlyImageError(error));
        }
    }
    function appendAssetsToContainer(containerId: string, incomingAssets: ImageAsset[]) {
        const existing = nodesRef.current.find((node) => node.id === containerId && node.imageContainer);
        if (!existing)
            return 0;
        const displayCode = nodeDisplayCode(existing);
        const assets = mergeContainerAssets(existing.assets, incomingAssets, displayCode, existing.assetSequence);
        const assetSequence = Math.max(Number(existing.assetSequence || 0), imageAssetSequence(assets, displayCode));
        const added = Math.max(0, assets.length - (existing.assets?.length ?? 0));
        setNodes((current) => current.map((node) => node.id === containerId
            ? applyImageContainerCompatibility({
                ...node,
                assets,
                assetSequence,
                outputs: assets.length,
                imageState: assets.length ? "done" : "empty",
                status: "done",
                imageContainerSpec: cloneImageContainerSpec(imageContainerSpecForNode(node))
            })
            : node));
        setSelectedNodeId(containerId);
        setActiveNodeId(containerId);
        window.setTimeout(() => setActiveNodeId(null), 700);
        return added;
    }
    function importedImageArtifactsForHost(currentNodes: WorkflowNode[], host: WorkflowNode, assets: ImageAsset[]) {
        let nextNodes = [...currentNodes];
        let nextZ = nextNodeZOrder(nextNodes);
        const memberNodeIds: string[] = [];
        for (const [index, asset] of assets.entries()) {
            const id = allocateNodeCode(nextNodes);
            const title = asset.title || asset.originalName || imageAssetName(asset) || `导入图片 ${index + 1}`;
            const source: WorkflowNode = {
                ...host,
                id,
                title,
                prompt: asset.prompt || asset.revisedPrompt || "用户导入的图片素材。",
                parentId: undefined,
                relationType: undefined,
                imageContainer: false,
                imageContainerSpec: undefined,
                imageCollection: undefined,
                assets: [asset],
                createdAt: nowLabel()
            };
            const node = standardImageArtifactFromAsset(source, asset, 0, id, { x: host.x + 28 + index * 18, y: host.y + 28 + index * 18 }, nextZ++);
            nextNodes.push(node);
            memberNodeIds.push(id);
        }
        return { nodes: nextNodes, memberNodeIds };
    }
    async function importPathsToCanvas(paths: string[], clientX: number, clientY: number, targetContainerId = "") {
        try {
            const result = await importExternalImagePaths(paths);
            if (!result.ok || !result.assets.length)
                throw new Error(result.error || "没有找到可导入的 PNG/JPG/WEBP 图片。");
            const explicitTarget = targetContainerId ? nodesRef.current.find((node) => node.id === targetContainerId) : undefined;
            if (explicitTarget?.layerGroup || explicitTarget?.layerComposition)
                targetContainerId = "";
            const point = clientToWorld(clientX, clientY);
            const preserveFolderBoundaries = result.assets.some((asset) => asset.sourceRootKind === "directory");
            const boundaryTarget = preserveFolderBoundaries && targetContainerId
                ? nodesRef.current.find((node) => node.id === targetContainerId && nodeUsesImageContainer(node) && !node.layerGroup && !node.layerComposition)
                : null;
            if (boundaryTarget) {
                const boundarySpec = imageContainerSpecForNode(boundaryTarget);
                const directoryRootIds = [...new Set(result.assets
                        .filter((asset) => asset.sourceRootKind === "directory" && asset.importRootId)
                        .map((asset) => String(asset.importRootId)))];
                const hasLooseAssets = result.assets.some((asset) => asset.sourceRootKind !== "directory" || !asset.importRootId);
                const boundaryIsEmpty = Boolean((boundaryTarget.assets?.length ?? 0) === 0 &&
                    (boundarySpec?.memberNodeIds.length ?? 0) === 0 &&
                    (boundarySpec?.childContainerNodeIds.length ?? 0) === 0 &&
                    !layoutGroupsRef.current.some((group) => group.memberNodeIds.includes(boundaryTarget.id)));
                if (boundaryIsEmpty && directoryRootIds.length === 1 && !hasLooseAssets) {
                    const displayCode = nodeDisplayCode(boundaryTarget);
                    const assets = mergeContainerAssets([], result.assets, displayCode, boundaryTarget.assetSequence);
                    const root = (result.roots ?? []).find((item) => item.importRootId === directoryRootIds[0]);
                    const sourceLabel = root?.sourceRootLabel || result.assets[0]?.sourceRootLabel || "导入文件夹";
                    const nextNodes = nodesRef.current.map((node): WorkflowNode => node.id === boundaryTarget.id
                        ? applyImageContainerCompatibility({
                            ...node,
                            title: ["图片容器", "项目图片库", "导入图片"].includes(node.title) ? sourceLabel : node.title,
                            prompt: "用户导入的文件夹；保留源目录内的逻辑图片边界。",
                            branch: "image-folder-container",
                            assets,
                            assetSequence: imageAssetSequence(assets, displayCode),
                            outputs: assets.length,
                            imageState: assets.length ? "done" : "empty",
                            status: "done",
                            imageContainer: true,
                            imageContainerSpec: {
                                version: 1,
                                kind: "folder",
                                memberNodeIds: [],
                                childContainerNodeIds: [],
                                memberBindings: directImageContainerBindings(boundaryTarget.id, assets, [], boundaryTarget.imageContainerRole),
                                sourceLabel,
                                importBatchId: result.importBatchId || assets.find((asset) => asset.importBatchId)?.importBatchId,
                                layoutOrigin: "auto",
                                autoFit: true,
                            },
                        })
                        : node);
                    nodesRef.current = nextNodes;
                    setNodes(nextNodes);
                    replaceSelectedNodeId(boundaryTarget.id);
                    setActiveNodeId(boundaryTarget.id);
                    window.setTimeout(() => setActiveNodeId(null), 700);
                    setCanvasMenu(null);
                    setServerMessage(`已将文件夹「${sourceLabel}」的 ${assets.length} 张图片复制到项目图片库。`);
                    addEvent(`空容器接收文件夹 ${assets.length} 张`);
                    notifyAgentOfManualAction("导入文件夹素材", `用户将文件夹「${sourceLabel}」导入空容器 ${boundaryTarget.id}，该容器现包含 ${assets.length} 张项目库图片。`);
                    return { ok: true, containerId: boundaryTarget.id, assets: result.assets, added: assets.length };
                }
                const importedContainers = createImportedRootContainersAt(point.x, point.y, result.assets, result.roots ?? [], result.importBatchId || "");
                const grouped = buildContainerGroupMutation(nodesRef.current, layoutGroupsRef.current, [boundaryTarget.id, importedContainers.containerId], point.x, point.y, {
                    title: "素材容器组",
                    prompt: "由已有图片容器与新导入文件夹组成；各自边界保持独立，可整体或分别交给 Agent 处理。",
                    sourceLabel: "素材容器组",
                    importBatchId: result.importBatchId,
                    layoutOrigin: "auto"
                });
                const containerId = grouped?.hostNodeId || importedContainers.containerId;
                if (grouped)
                    commitImageLayout(grouped.nodes, grouped.groups, grouped.hostNodeId);
                replaceSelectedNodeId(containerId);
                setCanvasMenu(null);
                setServerMessage(grouped
                    ? `已导入 ${result.assets.length} 张图片，并与 ${boundaryTarget.id} 组合为保留文件夹边界的超级容器。`
                    : `已导入 ${result.assets.length} 张图片并保留文件夹边界；原容器未发生变化。`);
                addEvent(`文件夹导入 ${result.assets.length} 张并组合容器`);
                notifyAgentOfManualAction("导入并组合文件夹", grouped
                    ? `用户将新导入的 ${result.assets.length} 张文件夹图片与容器 ${boundaryTarget.id} 组合为超级容器 ${containerId}，所有子容器边界保持独立。`
                    : `用户导入了 ${result.assets.length} 张文件夹图片，主容器为 ${containerId}；原容器 ${boundaryTarget.id} 未改变。`);
                return { ok: true, containerId, assets: result.assets, added: result.assets.length };
            }
            const layoutTarget = targetContainerId ? layoutGroupsRef.current.find((group) => group.hostNodeId === targetContainerId) : undefined;
            if (layoutTarget) {
                const currentNodes = nodesRef.current;
                const host = currentNodes.find((node) => node.id === layoutTarget.hostNodeId);
                if (!host)
                    throw new Error("图片容器已经不存在。");
                if (host.layerGroup || host.layerComposition)
                    throw new Error("分层 PNG 图层不能接收普通图片归组。");
                const imported = importedImageArtifactsForHost(currentNodes, host, result.assets);
                const nextNodes = imported.nodes;
                const memberNodeIds = imported.memberNodeIds;
                const nextGroups = layoutGroupsRef.current.map((group) => group.id === layoutTarget.id
                    ? { ...group, memberNodeIds: [...group.memberNodeIds, ...memberNodeIds], autoFit: true }
                    : group);
                commitImageLayout(nextNodes, nextGroups, layoutTarget.hostNodeId);
                setCanvasMenu(null);
                setServerMessage(`已将 ${memberNodeIds.length} 张图片复制到项目图片库并加入图片容器。`);
                addEvent(`图片容器导入 ${memberNodeIds.length} 张`);
                notifyAgentOfManualAction("导入图片素材", `用户向图片容器 ${layoutTarget.hostNodeId} 导入 ${memberNodeIds.length} 张项目库图片，可作为后续参考素材。`);
                return { ok: true, containerId: layoutTarget.hostNodeId, assets: result.assets, added: memberNodeIds.length };
            }
            const collectionTarget = targetContainerId
                ? nodesRef.current.find((node) => node.id === targetContainerId && node.imageCollection && !node.layerGroup && !node.layerComposition)
                : undefined;
            if (collectionTarget) {
                const imported = importedImageArtifactsForHost(nodesRef.current, collectionTarget, result.assets);
                const mutation = createManualImageLayoutGroup({ nodes: imported.nodes, groups: layoutGroupsRef.current }, { groupId: uid("image-layout"), hostNodeId: collectionTarget.id, memberNodeIds: imported.memberNodeIds });
                if (!mutation.ok)
                    throw new Error(`无法将导入图片加入现有图片组：${mutation.reason}`);
                commitImageLayout(mutation.nodes as WorkflowNode[], mutation.groups, collectionTarget.id);
                setCanvasMenu(null);
                setServerMessage(`已将 ${imported.memberNodeIds.length} 张图片复制到项目图片库并加入现有图片组。`);
                addEvent(`生成图片组导入 ${imported.memberNodeIds.length} 张`);
                notifyAgentOfManualAction("导入图片素材", `用户向生成图片组 ${collectionTarget.id} 导入 ${imported.memberNodeIds.length} 张独立项目库图片；原生成节点、提示词和因果关系保持不变。`);
                return { ok: true, containerId: collectionTarget.id, assets: result.assets, added: imported.memberNodeIds.length };
            }
            const target = targetContainerId ? nodesRef.current.find((node) => node.id === targetContainerId && node.imageContainer) : null;
            const importedContainers = target ? null : createImportedRootContainersAt(point.x, point.y, result.assets, result.roots ?? [], result.importBatchId || "");
            const containerId = target ? target.id : importedContainers?.containerId || "";
            const added = target ? appendAssetsToContainer(target.id, result.assets) : result.assets.length;
            setCanvasMenu(null);
            const folderSummary = importedContainers?.folderCount
                ? `，保留 ${importedContainers.folderCount} 个文件夹边界`
                : "";
            setServerMessage(`已将 ${added} 张图片复制到项目图片库${folderSummary}。`);
            addEvent(`图片容器导入 ${added} 张${folderSummary}`);
            notifyAgentOfManualAction("导入图片素材", `用户向画布导入 ${added} 张项目库图片${folderSummary}，主容器为 ${containerId}；可作为后续工作素材。`);
            return { ok: true, containerId, assets: result.assets, added };
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message, assets: [] as ImageAsset[] };
        }
    }
    function imageAssetLogicalKey(asset: ImageAsset | undefined, ownerNodeId: string, assetIndex: number) {
        if (!asset)
            return "";
        return `occurrence:${stableImageOccurrenceId(asset, ownerNodeId, assetIndex)}`;
    }
    function imageAssetMatchesLogicalKey(asset: ImageAsset, ownerNodeId: string, assetIndex: number, assetKey: string) {
        if (assetKey.startsWith("occurrence:"))
            return imageAssetLogicalKey(asset, ownerNodeId, assetIndex) === assetKey;
        return (asset.path || asset.assetUrl || asset.url) === assetKey;
    }
    function removeAssetFromImageGroup(node: WorkflowNode, assetKey: string): WorkflowNode {
        const originalAssets = node.assets ?? [];
        const removedIndex = originalAssets.findIndex((item, index) => imageAssetMatchesLogicalKey(item, node.id, index, assetKey));
        if (removedIndex < 0)
            return node;
        const removedAsset = originalAssets[removedIndex];
        const assets = originalAssets
            .filter((_item, index) => index !== removedIndex)
            .map((item, index) => ({ ...item, index: index + 1 }));
        const imageCollection = node.imageCollection
            ? {
                ...cloneImageCollection(node.imageCollection)!,
                items: node.imageCollection.items
                    .filter((item) => !((removedAsset.occurrenceId && item.occurrenceId === removedAsset.occurrenceId) ||
                    item.assetIndex === removedIndex + 1))
                    .map((item) => {
                    const occurrenceIndex = item.occurrenceId ? assets.findIndex((asset) => asset.occurrenceId === item.occurrenceId) : -1;
                    const matchingAssetIdIndexes = item.assetId
                        ? assets.map((asset, index) => asset.assetId === item.assetId ? index : -1).filter((index) => index >= 0)
                        : [];
                    const matchedIndex = occurrenceIndex >= 0 ? occurrenceIndex : matchingAssetIdIndexes.length === 1 ? matchingAssetIdIndexes[0] : -1;
                    const assetIndex = matchedIndex >= 0
                        ? matchedIndex + 1
                        : item.assetIndex === undefined
                            ? undefined
                            : item.assetIndex > removedIndex + 1
                                ? item.assetIndex - 1
                                : item.assetIndex;
                    return {
                        ...item,
                        assetIndex,
                        assetId: assetIndex === undefined ? item.assetId : assets[assetIndex - 1]?.assetId,
                        occurrenceId: assetIndex === undefined ? item.occurrenceId : assets[assetIndex - 1]?.occurrenceId || item.occurrenceId
                    };
                })
            }
            : undefined;
        const shouldDowngrade = assets.length === 1;
        const remainingAsset = assets[0];
        const remainingOccurrenceId = remainingAsset ? stableImageOccurrenceId(remainingAsset, node.id, 0) : "";
        const remainingItem = imageCollection?.items.find((item) => Boolean(remainingOccurrenceId && item.occurrenceId === remainingOccurrenceId))
            ?? imageCollection?.items.find((item) => item.assetIndex === 1);
        const remainingPrompt = remainingItem?.prompt || remainingAsset?.prompt || remainingAsset?.revisedPrompt || node.imageParams?.prompt || node.prompt;
        const remainingTitle = remainingItem?.title || remainingAsset?.title || remainingAsset?.originalName || node.title;
        const remainingSize = remainingAsset?.width && remainingAsset?.height
            ? `${remainingAsset.width}x${remainingAsset.height}`
            : imageTaskSizeForNode(node, "1024x1024");
        const standardSize = shouldDowngrade ? displaySizeForImageNode(remainingSize, 1) : null;
        const currentSpec = imageContainerSpecForNode(node);
        const imageContainerSpec: ImageContainerSpec | undefined = shouldDowngrade
            ? undefined
            : currentSpec
                ? {
                    ...cloneImageContainerSpec(currentSpec)!,
                    memberBindings: directImageContainerBindings(node.id, assets, currentSpec.memberBindings),
                    collection: cloneImageCollection(imageCollection)
                }
                : imageCollection
                    ? {
                        version: 1,
                        kind: "batch-result" as const,
                        memberNodeIds: [],
                        childContainerNodeIds: [],
                        memberBindings: directImageContainerBindings(node.id, assets),
                        layoutOrigin: "generation" as const,
                        autoFit: imageCollection.autoFit !== false,
                        collection: cloneImageCollection(imageCollection)
                    }
                    : undefined;
        return {
            ...node,
            assets,
            imageContainer: shouldDowngrade ? false : node.imageContainer,
            imageContainerSpec,
            imageCollection: shouldDowngrade ? undefined : imageCollection,
            ...(shouldDowngrade ? {
                title: remainingTitle,
                prompt: remainingPrompt,
                branch: "basic",
                width: standardSize?.width,
                height: standardSize?.height,
                imageParams: cloneImageTaskDraft({
                    ...(node.imageParams ?? defaultImageTaskDraft(settings)),
                    prompt: remainingPrompt,
                    count: 1,
                    size: remainingSize,
                    referenceImages: remainingAsset?.path
                        ? [{
                                assetId: remainingAsset.assetId,
                                occurrenceId: remainingAsset.occurrenceId,
                                importBatchId: remainingAsset.importBatchId,
                                importRootId: remainingAsset.importRootId,
                                sourceRelativePath: remainingAsset.sourceRelativePath,
                                sourceRootLabel: remainingAsset.sourceRootLabel,
                                sourceRootKind: remainingAsset.sourceRootKind,
                                contentHash: remainingAsset.contentHash,
                                name: remainingTitle,
                                path: remainingAsset.path,
                                relativePath: remainingAsset.relativePath,
                                mimeType: mimeTypeFromPath(remainingAsset.path),
                                assetUrl: remainingAsset.assetUrl
                            }]
                        : []
                }),
                imageProgress: imageProgressState(1, 1, "单张图片成果")
            } : {}),
            outputs: assets.length,
            imageState: assets.length ? "done" : "empty"
        };
    }
    function imageCollectionItemForAsset(node: WorkflowNode, assetIndex: number) {
        const asset = node.assets?.[assetIndex];
        const occurrenceId = asset ? stableImageOccurrenceId(asset, node.id, assetIndex) : "";
        const byOccurrence = node.imageCollection?.items.find((item) => Boolean(occurrenceId && item.occurrenceId === occurrenceId));
        if (byOccurrence)
            return byOccurrence;
        const bySlot = node.imageCollection?.items.find((item) => item.assetIndex === assetIndex + 1);
        if (bySlot)
            return bySlot;
        const matchingAssetItems = asset?.assetId ? node.imageCollection?.items.filter((item) => item.assetId === asset.assetId) ?? [] : [];
        return matchingAssetItems.length === 1 ? matchingAssetItems[0] : undefined;
    }
    function standardImageArtifactFromAsset(source: WorkflowNode, asset: ImageAsset, assetIndex: number, id: string, position: {
        x: number;
        y: number;
    }, zOrder: number): WorkflowNode {
        const collectionItem = imageCollectionItemForAsset(source, assetIndex);
        const title = collectionItem?.title || asset.title || asset.originalName || imageAssetName(asset) || "图片成果";
        const visualPrompt = collectionItem?.prompt || asset.prompt || asset.revisedPrompt || source.imageParams?.prompt || firstPromptLine(source.prompt) || "图片成果。";
        const size = asset.width && asset.height ? `${asset.width}x${asset.height}` : imageTaskSizeForNode(source, "1024x1024");
        const nodeSize = displaySizeForImageNode(size, 1);
        return {
            id,
            displayCode: id,
            title,
            prompt: visualPrompt,
            type: "image",
            status: "done",
            x: position.x,
            y: position.y,
            parentId: source.parentId,
            relationType: source.parentId ? (source.relationType || "derived-from") : undefined,
            branch: source.imageCollection ? "collection-artifact" : source.branch || "basic",
            outputs: 1,
            createdAt: source.createdAt || nowLabel(),
            assets: [{ ...asset, origin: imageOriginForAsset(asset, source, nodesRef.current), assetId: stableImageAssetId(asset, assetIndex + 1), occurrenceId: stableImageOccurrenceId(asset, source.id, assetIndex), displayCode: asset.displayCode || `${id}1`, index: 1, prompt: visualPrompt, title }],
            imageState: "done",
            taskProvenance: source.taskProvenance ? { ...source.taskProvenance } : undefined,
            imageParams: cloneImageTaskDraft({
                ...(source.imageParams ?? defaultImageTaskDraft(settings)),
                prompt: visualPrompt,
                count: 1,
                size,
                referenceImages: asset.path ? [{ assetId: asset.assetId, contentHash: asset.contentHash, name: title, path: asset.path, relativePath: asset.relativePath, mimeType: mimeTypeFromPath(asset.path), assetUrl: asset.assetUrl }] : []
            }),
            imageProgress: imageProgressState(1, 1, "单张图片成果"),
            width: nodeSize.width,
            height: nodeSize.height,
            zOrder
        };
    }
    function isolateImageAssetNode(sourceNodes: WorkflowNode[], sourceGroups: ImageLayoutGroup[], sourceNodeId: string, assetKey: string) {
        const source = sourceNodes.find((node) => node.id === sourceNodeId && canGroupImageAsset(node));
        const assetIndex = source?.assets?.findIndex((asset, index) => imageAssetMatchesLogicalKey(asset, source.id, index, assetKey)) ?? -1;
        const asset = assetIndex >= 0 ? source?.assets?.[assetIndex] : undefined;
        if (!source || !asset)
            return { ok: false as const, error: "图片成果不存在。", nodes: sourceNodes, groups: sourceGroups, memberNodeId: "" };
        if ((source.assets?.length ?? 0) === 1) {
            const normalized = source.imageContainer || source.imageCollection
                ? standardImageArtifactFromAsset(source, asset, assetIndex, source.id, { x: source.x, y: source.y }, nodeZOrder(source))
                : source;
            return {
                ok: true as const,
                nodes: normalized === source ? sourceNodes : sourceNodes.map((node) => node.id === source.id ? normalized : node),
                groups: sourceGroups,
                memberNodeId: source.id,
                asset
            };
        }
        const id = allocateNodeCode(sourceNodes);
        const zOrder = nextNodeZOrder(sourceNodes);
        const extracted = standardImageArtifactFromAsset(source, asset, assetIndex, id, { x: source.x + 34, y: source.y + 34 }, zOrder);
        const nodes = [
            ...sourceNodes.map((node) => node.id === source.id ? removeAssetFromImageGroup(node, assetKey) : node),
            extracted
        ];
        return { ok: true as const, nodes, groups: sourceGroups, memberNodeId: id, asset };
    }
    function preserveLayoutHostPositions(beforeGroups: ImageLayoutGroup[], afterGroups: ImageLayoutGroup[], sourceNodes: WorkflowNode[], movingNodeId = "") {
        let next = sourceNodes;
        const afterMembership = new Set(afterGroups.flatMap((group) => group.memberNodeIds));
        for (const before of beforeGroups) {
            const after = afterGroups.find((group) => group.id === before.id);
            const oldHost = next.find((node) => node.id === before.hostNodeId);
            if (!oldHost)
                continue;
            if (after) {
                if (after.hostNodeId === before.hostNodeId)
                    continue;
                next = next.map((node) => node.id === after.hostNodeId
                    ? { ...node, x: oldHost.x, y: oldHost.y, width: oldHost.width, height: oldHost.height, zOrder: oldHost.zOrder }
                    : node);
                continue;
            }
            if (!movingNodeId)
                continue;
            const remainingNodeIds = before.memberNodeIds.filter((nodeId) => nodeId !== movingNodeId && !afterMembership.has(nodeId) && next.some((node) => node.id === nodeId));
            if (remainingNodeIds.length !== 1)
                continue;
            next = next.map((node) => node.id === remainingNodeIds[0]
                ? { ...node, x: oldHost.x, y: oldHost.y, width: oldHost.width, height: oldHost.height, zOrder: oldHost.zOrder }
                : node);
        }
        return next;
    }
    function commitImageLayout(nodes: WorkflowNode[], groups: ImageLayoutGroup[], selectedId: string) {
        const canonicalNodes = synchronizeImageContainerSpecs(nodes, groups);
        const canonicalGroups = sanitizeImageLayoutGroups(canonicalNodes, deriveImageLayoutGroupsFromContainerSpecs(canonicalNodes)).groups;
        const fittedNodes = normalizeNodeZOrders(fitImageLayoutHostNodes(canonicalNodes, canonicalGroups));
        nodesRef.current = fittedNodes;
        layoutGroupsRef.current = canonicalGroups;
        setNodes(fittedNodes);
        setLayoutGroups(canonicalGroups);
        setSelectedNodeId(selectedId);
        setActiveNodeId(selectedId);
        window.setTimeout(() => setActiveNodeId(null), 700);
    }
    async function applyTaskResultLayout(taskScope: AgentTaskScope, existingNodeIds: ReadonlySet<string>, runId: string, projectId: string, conversationId: string): Promise<TaskResultLayoutMutation | null | undefined> {
        const executionScope = currentExecutionScope(taskScope.snapshotHash);
        const frozenScope = { ...executionScope, projectId, conversationId };
        const active = () => activeRunRef.current === runId && executionScopeIsCurrent(frozenScope);
        if (!active())
            return null;
        const { buildTaskResultLayoutMutation, waitForTaskResultNodeIds } = await taskResultLayoutModulePromise;
        const resultNodeIds = await waitForTaskResultNodeIds({
            existingNodeIds,
            taskScope,
            nodes: () => nodesRef.current,
            active,
        });
        if (resultNodeIds === null)
            return null;
        if (!resultNodeIds.length)
            return undefined;
        if (!active())
            return null;
        let localSequence = nodeSequenceRef.current;
        const application = buildTaskResultLayoutMutation({
            nodes: nodesRef.current,
            groups: layoutGroupsRef.current,
            taskScope,
            resultNodeIds,
            allocateNodeId: (sourceNodes) => {
                const code = nextNodeId(sourceNodes, localSequence);
                localSequence = Math.max(localSequence, nodeSequenceFromCode(code));
                return code;
            },
            createdAt: nowLabel(),
            nextZOrder: nextNodeZOrder(nodesRef.current),
            containerWidth: IMAGE_CONTAINER_W,
            containerHeight: IMAGE_CONTAINER_H,
        });
        if (!active())
            return null;
        if (!application.applied || !application.nodes || !application.groups)
            return application;
        const normalized = sanitizeImageLayoutGroups(application.nodes, application.groups);
        const finalGroups = normalized.groups;
        const finalNodes = normalizeNodeZOrders(fitImageLayoutHostNodes(normalized.nodes, finalGroups));
        nodesRef.current = finalNodes;
        layoutGroupsRef.current = finalGroups;
        if (application.containerGroupNodeId)
            observeAllocatedNodeCode(application.containerGroupNodeId);
        setNodes(finalNodes);
        setLayoutGroups(finalGroups);
        const removedGroupIds = new Set(application.removedContainerGroupNodeIds ?? []);
        if (selectedNodeIdsRef.current.some((id) => removedGroupIds.has(id))) {
            replaceSelectedNodeId(application.containerGroupNodeId || application.partitionHostNodeIds[0] || "");
        }
        if (application.eventSummary)
            addEvent(application.eventSummary);
        const highlightIds = [
            ...(application.resultNodeIds || []),
            ...(application.partitionHostNodeIds || []),
            ...(application.containerGroupNodeId ? [application.containerGroupNodeId] : []),
        ];
        if (highlightIds.length)
            flashNewCanvasNodes(highlightIds);
        return application;
    }
    function markImageLayoutSizeManual(nodeId: string) {
        const targetNode = nodesRef.current.find((node) => node.id === nodeId);
        const targetSpec = targetNode ? imageContainerSpecForNode(targetNode) : undefined;
        if (targetNode && ((targetNode.imageCollection && targetNode.imageCollection.autoFit !== false) ||
            (targetSpec && targetSpec.autoFit !== false))) {
            const imageCollection = targetNode.imageCollection
                ? { ...cloneImageCollection(targetNode.imageCollection)!, autoFit: false }
                : undefined;
            updateNode(nodeId, {
                imageCollection,
                imageContainerSpec: targetSpec
                    ? { ...cloneImageContainerSpec(targetSpec)!, autoFit: false, collection: imageCollection ?? cloneImageCollection(targetSpec.collection) }
                    : undefined
            });
        }
        const current = layoutGroupsRef.current;
        const group = current.find((item) => item.hostNodeId === nodeId);
        if (!group || group.autoFit === false)
            return;
        const next = current.map((item) => item.id === group.id ? { ...item, autoFit: false } : item);
        layoutGroupsRef.current = next;
        setLayoutGroups(next);
    }
    function dissolveImageLayoutGroup(hostNodeId: string) {
        const group = layoutGroupsRef.current.find((item) => item.hostNodeId === hostNodeId);
        if (!group)
            return false;
        const groups = layoutGroupsRef.current.filter((item) => item.id !== group.id);
        const sourceNodes = nodesRef.current.map(cloneWorkflowNode);
        const memberIds = new Set(group.memberNodeIds);
        const rawHost = sourceNodes.find((node) => node.id === hostNodeId);
        if (!rawHost)
            return false;
        const hostAssetCount = Math.max(rawHost.assets?.length ?? rawHost.imageCollection?.items.length ?? 0, 1);
        const hostSize = imageTaskSizeForNode(rawHost);
        const preferredHostSize = rawHost.imageCollection?.kind === "series"
            ? { width: IMAGE_COLLECTION_W, height: IMAGE_COLLECTION_SERIES_H }
            : displaySizeForImageNode(hostSize, hostAssetCount, rawHost.assets ?? []);
        const restoredHostSize = rawHost.imageCollection?.kind === "series"
            ? preferredHostSize
            : clampImageNodeDimensions(hostSize, hostAssetCount, preferredHostSize.width, preferredHostSize.height);
        const host = { ...rawHost, width: restoredHostSize.width, height: restoredHostSize.height };
        const hostBounds = workflowNodeBounds(host);
        const positionedById = new Map<string, WorkflowNode>([[host.id, host]]);
        const occupiedNodes = [
            ...projectCanvasImageLayouts(sourceNodes, groups).canvasNodes.filter((node) => !memberIds.has(node.id)),
            host
        ];
        for (const memberId of group.memberNodeIds) {
            if (memberId === host.id)
                continue;
            const member = sourceNodes.find((node) => node.id === memberId);
            if (!member)
                continue;
            const memberBounds = workflowNodeBounds(member);
            let position = { x: member.x, y: member.y };
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const openPosition = findOpenWorkflowNodePosition(occupiedNodes, {
                    parent: host,
                    width: memberBounds.width,
                    height: memberBounds.height,
                    preferredX: hostBounds.x + hostBounds.width + 80 + attempt * (memberBounds.width + 80),
                    preferredY: hostBounds.y + (attempt % 3) * (memberBounds.height + 80)
                });
                const candidate = { ...member, x: Math.round(openPosition.x), y: Math.round(openPosition.y) };
                const candidateBounds = workflowNodeBounds(candidate);
                position = { x: candidate.x, y: candidate.y };
                if (!occupiedNodes.some((node) => rectOverlapArea(candidateBounds, workflowNodeBounds(node)) > 0))
                    break;
            }
            const positioned = { ...member, x: position.x, y: position.y };
            positionedById.set(member.id, positioned);
            occupiedNodes.push(positioned);
        }
        const arrangedNodes = sourceNodes.map((node) => positionedById.get(node.id) ?? node);
        const canonicalNodes = synchronizeImageContainerSpecs(arrangedNodes, groups);
        const canonicalGroups = deriveImageLayoutGroupsFromContainerSpecs(canonicalNodes);
        nodesRef.current = canonicalNodes;
        layoutGroupsRef.current = canonicalGroups;
        setNodes(canonicalNodes);
        setLayoutGroups(canonicalGroups);
        setSelectedNodeId(hostNodeId);
        setCanvasMenu(null);
        addEvent(`解散图片容器 ${group.id}`);
        notifyAgentOfManualAction("解散图片容器", `用户解散图片容器 ${hostNodeId}，其中 ${group.memberNodeIds.length} 个图片成果恢复为独立节点；生成关系保持不变。`);
        return true;
    }
    async function moveContainerAsset(sourceContainerId: string, assetKey: string, clientX: number, clientY: number, targetContainerId = "") {
        const beforeNodes = nodesRef.current.map(cloneWorkflowNode);
        const beforeGroups = layoutGroupsRef.current.map((group) => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
        const sourceBefore = beforeNodes.find((node) => node.id === sourceContainerId && canGroupImageAsset(node));
        if (!sourceBefore || sourceBefore.layerGroup)
            return { ok: false, error: "分层 PNG 图层不能加入普通图片容器。" };
        if (sourceBefore.status === "working" || sourceBefore.imageState === "generating")
            return { ok: false, error: "请等待这个容器的绘图结束后再移动图片。" };
        const isolated = isolateImageAssetNode(beforeNodes, beforeGroups, sourceContainerId, assetKey);
        if (!isolated.ok)
            return { ok: false, error: isolated.error };
        let workingNodes = isolated.nodes;
        let workingGroups = isolated.groups;
        const memberNodeId = isolated.memberNodeId;
        const memberNode = workingNodes.find((node) => node.id === memberNodeId);
        if (!memberNode)
            return { ok: false, error: "无法建立独立图片成果。" };
        if (targetContainerId) {
            const target = workingNodes.find((node) => node.id === targetContainerId && (canGroupImageAsset(node) || (node.type === "image" && node.imageContainer)));
            if (!target || target.layerGroup)
                return { ok: false, error: "目标不是可用的图片或容器。" };
            if (target.id === memberNodeId)
                return { ok: true, nodeId: target.id, reason: "same-image" };
            const sourceGroup = workingGroups.find((group) => group.memberNodeIds.includes(memberNodeId));
            const targetGroup = workingGroups.find((group) => group.memberNodeIds.includes(target.id));
            let mutation;
            if (targetGroup && sourceGroup?.id === targetGroup.id) {
                const targetIndex = targetGroup.memberNodeIds.indexOf(target.id);
                mutation = reorderImageLayoutMember({ nodes: workingNodes, groups: workingGroups }, { groupId: targetGroup.id, memberNodeId, targetIndex });
            }
            else {
                if (sourceGroup) {
                    const extracted = extractImageLayoutMember({ nodes: workingNodes, groups: workingGroups }, { groupId: sourceGroup.id, memberNodeId });
                    if (!extracted.ok)
                        return { ok: false, error: "无法从原图片容器中取出图片。" };
                    workingNodes = preserveLayoutHostPositions(workingGroups, extracted.groups, extracted.nodes as WorkflowNode[], memberNodeId);
                    workingGroups = extracted.groups;
                }
                workingNodes = synchronizeImageContainerSpecs(workingNodes, workingGroups);
                workingGroups = deriveImageLayoutGroupsFromContainerSpecs(workingNodes);
                const hostId = targetGroup?.hostNodeId || target.id;
                const merged = mergeCanvasImageContainers(workingNodes, workingGroups, [hostId, memberNodeId], hostId, targetGroup?.id || uid("image-layout"));
                if (!merged)
                    return { ok: false, error: "无法完整移动图片，原容器保持不变。" };
                pushCanvasHistory("移动容器图片");
                commitImageLayout(merged.nodes, merged.groups, merged.hostNodeId);
                addEvent(`移动图片 ${memberNodeId} → ${merged.hostNodeId}`);
                notifyAgentOfManualAction("移动图片成果", `用户仅将图片 ${memberNodeId} 放入容器 ${merged.hostNodeId}；已解除合并节点连线，原容器的其他图片保留。`);
                return { ok: true, nodeId: merged.hostNodeId, reason: "moved" };
            }
            if (!mutation.ok) {
                return mutation.reason === "duplicate"
                    ? { ok: true, nodeId: targetGroup?.hostNodeId || target.id, reason: mutation.reason }
                    : { ok: false, error: `图片归组失败：${mutation.reason}` };
            }
            workingNodes = preserveLayoutHostPositions(workingGroups, mutation.groups, mutation.nodes as WorkflowNode[], memberNodeId);
            workingGroups = mutation.groups;
            const selectedGroup = workingGroups.find((group) => group.memberNodeIds.includes(memberNodeId) || group.memberNodeIds.includes(target.id));
            const selectedId = selectedGroup?.hostNodeId || target.id;
            pushCanvasHistory("调整容器图片顺序");
            commitImageLayout(workingNodes, workingGroups, selectedId);
            addEvent(`整理图片 ${memberNodeId} → ${selectedId}`);
            notifyAgentOfManualAction("整理图片成果", `用户将图片成果 ${memberNodeId} 放入画布图片容器 ${selectedId}；原始生成关系保持不变。`);
            return { ok: true, nodeId: selectedId, reason: mutation.reason };
        }
        const sourceGroup = workingGroups.find((group) => group.memberNodeIds.includes(memberNodeId));
        const wasSplitFromMultiImage = memberNodeId !== sourceContainerId;
        const normalizedFromImageGroup = Boolean(sourceBefore.imageContainer || sourceBefore.imageCollection);
        if (!sourceGroup && !wasSplitFromMultiImage && !normalizedFromImageGroup) {
            return { ok: true, nodeId: memberNodeId, reason: "single-image-noop" };
        }
        if (sourceGroup) {
            const extracted = extractImageLayoutMember({ nodes: workingNodes, groups: workingGroups }, { groupId: sourceGroup.id, memberNodeId });
            if (!extracted.ok)
                return { ok: false, error: "无法从图片容器取出图片。" };
            workingNodes = preserveLayoutHostPositions(workingGroups, extracted.groups, extracted.nodes as WorkflowNode[], memberNodeId);
            workingGroups = extracted.groups;
        }
        const point = clientToWorld(clientX, clientY);
        const movingNode = workingNodes.find((node) => node.id === memberNodeId)!;
        const bounds = workflowNodeBounds(movingNode);
        const preferredPosition = clampNodeWorldPosition({ x: Math.round(point.x - bounds.width / 2), y: Math.round(point.y - NODE_CONNECT_Y) }, bounds.width, bounds.height);
        const occupiedNodes = projectCanvasImageLayouts(workingNodes, workingGroups).canvasNodes
            .filter((node) => node.id !== memberNodeId);
        const openPosition = findOpenWorkflowNodePosition(occupiedNodes, {
            width: bounds.width,
            height: bounds.height,
            preferredX: preferredPosition.x,
            preferredY: preferredPosition.y
        });
        const position = { x: Math.round(openPosition.x), y: Math.round(openPosition.y) };
        workingNodes = workingNodes.map((node) => node.id === memberNodeId ? { ...node, x: position.x, y: position.y, zOrder: nextNodeZOrder(workingNodes) } : node);
        pushCanvasHistory("取出容器图片");
        commitImageLayout(workingNodes, workingGroups, memberNodeId);
        pendingRuntimeFocusNodeIdRef.current = memberNodeId;
        addEvent(`从图片容器取出 ${memberNode.title}`);
        notifyAgentOfManualAction("取出图片成果", `用户将图片 ${memberNode.title} 从容器取出为独立画布成果 ${memberNodeId}；原始生成关系保持不变。`);
        return { ok: true, nodeId: memberNodeId, reason: "extracted" };
    }
    function moveCanvasNodesIntoContainer(sourceNodeIds: string[], targetContainerId: string) {
        const target = nodesRef.current.find((node) => node.id === targetContainerId);
        if (!target || target.type !== "image" || target.layerGroup || target.layerComposition ||
            (!target.imageContainer && !target.imageCollection && !canGroupImageAsset(target))) {
            showCanvasOperationNotice("目标不是可接收图片的素材容器。");
            return false;
        }
        const requestedIds = [...new Set(sourceNodeIds.map((id) => String(id || "").trim()))]
            .filter((id) => id && id !== targetContainerId);
        const capabilities = analyzeCanvasSelection(nodesRef.current, layoutGroupsRef.current, requestedIds, requestedIds[0]);
        if (!capabilities.groupableNodeIds.length || capabilities.groupExcluded.length) {
            showCanvasOperationNotice("当前拖动中包含不能放入普通图片容器的成果，画布位置已保持不变。");
            return false;
        }
        const targetGroup = layoutGroupsRef.current.find((group) => group.hostNodeId === targetContainerId || group.memberNodeIds.includes(targetContainerId));
        const targetHostId = targetGroup?.hostNodeId || targetContainerId;
        if (requestedIds.includes(targetHostId) || capabilities.groupableNodeIds.includes(targetHostId))
            return false;
        const mutation = mergeCanvasImageContainers(nodesRef.current, layoutGroupsRef.current, [targetHostId, ...requestedIds], targetHostId, targetGroup?.id || uid("image-layout"));
        if (!mutation) {
            showCanvasOperationNotice("当前图片未能完整放入容器，画布保持原状。");
            return false;
        }
        pushCanvasHistory(`放入 ${capabilities.groupableNodeIds.length} 个图片成果`);
        commitImageLayout(mutation.nodes, mutation.groups, mutation.hostNodeId);
        replaceSelectedNodeId(mutation.hostNodeId);
        setCanvasMenu(null);
        setAssetContextMenu(null);
        addEvent(`拖入素材容器 ${capabilities.groupableNodeIds.length} 个图片成果`);
        notifyAgentOfManualAction("合并图片容器", `用户将 ${capabilities.groupableNodeIds.length} 个图片成果放入容器 ${targetHostId}；已解除合并节点的输入、输出及需求连线，图片文件保持不变。`);
        return true;
    }
    function openRegionRedraw(node: WorkflowNode, assetIndex = 0, redrawPrompt = "", allowDuringAgent = false) {
        if (!allowDuringAgent && agentExecutionBusyNow()) {
            setServerMessage("Agent 正在执行当前任务；你可以在对话框继续发送补充，其他画布操作请等待本轮完成。");
            return false;
        }
        if (node.type !== "image" || !node.assets?.[assetIndex]) {
            setServerMessage("请先选择一张有效图片再进行 AI 重绘。");
            return false;
        }
        setCanvasMenu(null);
        selectNodeFromPlainClick(node.id, "node-pointer-down");
        const initialPrompt = redrawPrompt.trim();
        const draft: RegionRedrawDraft = {
            mode: "redraw",
            nodeId: node.id,
            assetIndex,
            prompt: initialPrompt,
            initialPrompt,
            brushSize: 72,
            maskDirty: false,
            discardArmed: false,
            ready: false,
            busy: false
        };
        regionRedrawDraftRef.current = draft;
        setRegionRedrawDraft(draft);
        return true;
    }
    function disconnectNodeInput(nodeId: string) {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        setSelectedNodeId(nodeId);
        if (!node)
            return;
        const requirementBindings = node.type === "requirement" ? requirementInputBindings(node, nodesRef.current) : [];
        if (!node.parentId && requirementBindings.length === 0)
            return;
        pushCanvasHistory(node.type === "requirement" ? "断开需求来源" : "断开输入关系");
        const nextNodes = nodesRef.current.map((item) => item.id === nodeId
            ? item.type === "requirement" && item.requirement
                ? { ...item, parentId: undefined, relationType: undefined, requirement: removeRequirementInputBindings(item.requirement) }
                : { ...preserveImageOrigins(item, nodesRef.current), parentId: undefined, relationType: undefined }
            : item);
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setActiveNodeId(nodeId);
        setCanvasMenu(null);
        window.setTimeout(() => setActiveNodeId(null), 700);
        addEvent(`断开成果 ${nodeId} 的输入关系`);
        notifyAgentOfManualAction("断开成果关系", node.type === "requirement"
            ? `用户断开了需求 ${nodeId} 的 ${requirementBindings.length} 个输入素材。`
            : `用户断开了成果 ${nodeId} 与原来源成果的关系。`);
    }
    function disconnectNodeOutputs(nodeId: string) {
        const childCount = nodesRef.current.reduce((count, item) => {
            if (item.type === "requirement" && requirementInputBindings(item, nodesRef.current).some((binding) => binding.nodeId === nodeId))
                return count + 1;
            return count + (item.parentId === nodeId ? 1 : 0);
        }, 0);
        setSelectedNodeId(nodeId);
        if (childCount === 0)
            return;
        pushCanvasHistory("断开输出关系");
        const removedInputIds = new Set([nodeId]);
        const nextNodes: WorkflowNode[] = nodesRef.current.map((item): WorkflowNode => {
            if (item.type === "requirement" && item.requirement) {
                const before = requirementInputBindings(item, nodesRef.current);
                if (!before.some((binding) => binding.nodeId === nodeId))
                    return item;
                const requirement = removeRequirementInputBindings({ ...item.requirement, inputBindings: before }, removedInputIds);
                const bindings = requirementInputBindings({ ...item, requirement, parentId: undefined }, nodesRef.current);
                return {
                    ...item,
                    requirement,
                    parentId: primaryRequirementInputNodeId(bindings) || undefined,
                    relationType: bindings.length ? "referenced" : undefined,
                };
            }
            return item.parentId === nodeId ? { ...preserveImageOrigins(item, nodesRef.current), parentId: undefined, relationType: undefined } : item;
        });
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setActiveNodeId(nodeId);
        setCanvasMenu(null);
        window.setTimeout(() => setActiveNodeId(null), 700);
        addEvent(`断开成果 ${nodeId} 的 ${childCount} 条输出关系`);
        notifyAgentOfManualAction("断开成果关系", `用户断开了成果 ${nodeId} 的 ${childCount} 条后续成果关系。`);
    }
    function beginConnection(event: React.PointerEvent<HTMLSpanElement>, source: WorkflowNode) {
        if (event.button !== 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        suppressCanvasAutoRefocus();
        setSelectedNodeId(source.id);
        const startX = event.clientX;
        const startY = event.clientY;
        let moved = false;
        const sourceBounds = workflowNodeBounds(source);
        const sourceX = sourceBounds.x + sourceBounds.width;
        const sourceY = sourceBounds.y + nodeConnectionY(source, viewportRef.current.scale);
        setConnectionDraft({ sourceId: source.id, worldX: sourceX + 90, worldY: sourceY });
        const target = event.currentTarget;
        try {
            target.setPointerCapture(event.pointerId);
        }
        catch {
        }
        const move = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault();
            suppressCanvasAutoRefocus();
            if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 4)
                moved = true;
            const point = clientToWorld(moveEvent.clientX, moveEvent.clientY);
            setConnectionDraft({ sourceId: source.id, worldX: point.x, worldY: point.y });
        };
        const end = (endEvent: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            try {
                target.releasePointerCapture(event.pointerId);
            }
            catch {
            }
            const point = clientToWorld(endEvent.clientX, endEvent.clientY);
            const element = document.elementFromPoint(endEvent.clientX, endEvent.clientY) as HTMLElement | null;
            const targetId = element?.closest<HTMLElement>(".flow-node")?.dataset.nodeId || closestNodeIdAt(nodesRef.current, point.x, point.y, source.id);
            setConnectionDraft(null);
            suppressCanvasAutoRefocus();
            if (endEvent.type === "pointercancel")
                return;
            if (moved && targetId)
                connectNodes(source.id, targetId);
            if (!moved)
                disconnectNodeOutputs(source.id);
        };
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }
    function openAICutout(node: WorkflowNode, assetIndex = 0, allowDuringAgent = false) {
        if (!allowDuringAgent && agentExecutionBusyNow()) {
            setServerMessage("Agent 正在执行当前任务；你可以在对话框继续发送补充，其他画布操作请等待本轮完成。");
            return false;
        }
        if (node.type !== "image" || !node.assets?.[assetIndex]) {
            setServerMessage("请先选择一张有效图片再进行 AI 抠图。");
            return false;
        }
        setCanvasMenu(null);
        setSelectedNodeId(node.id);
        const initialPrompt = "完整保留涂抹区域内的主体、轮廓和内部细节";
        const draft: RegionRedrawDraft = {
            mode: "cutout",
            nodeId: node.id,
            assetIndex,
            prompt: initialPrompt,
            initialPrompt,
            brushSize: 72,
            maskDirty: false,
            discardArmed: false,
            ready: false,
            busy: false
        };
        regionRedrawDraftRef.current = draft;
        setRegionRedrawDraft(draft);
        return true;
    }
    function agentExecutionBusyNow() {
        if (stoppingAgentRunRef.current)
            return true;
        if (projectRunsRef.current[activeProjectIdRef.current]?.status === "running")
            return true;
        return isAgentExecutionBusy({
            reservation: Boolean(executionReservationRef.current),
            activeRun: Boolean(activeRunRef.current),
            activeImageRunCount: 0,
            status: agentStatusRef.current,
            pending: Boolean(pendingAgentExecutionRef.current)
        });
    }
    function agentActiveWorkNow() {
        return isAgentExecutionBusy({
            reservation: Boolean(executionReservationRef.current),
            activeRun: Boolean(activeRunRef.current),
            activeImageRunCount: 0,
            status: agentStatusRef.current,
            pending: false
        });
    }
    async function drainQueuedAgentFollowUp() {
        if (queuedFollowUpDispatchingRef.current || agentExecutionBusyNow() || pendingAgentExecutionRef.current)
            return;
        const first = queuedAgentFollowUpsRef.current.find(item => (item.projectId === activeProjectIdRef.current && item.conversationId === activeConversationIdRef.current) ||
            (item.summarizePreferences && item.projectKind === "image" && !["running", "waiting"].includes(projectRunsRef.current[item.projectId]?.status)));
        if (!first)
            return;
        const batch = mergeQueuedAgentFollowUps(queuedAgentFollowUpsRef.current, first);
        const next = batch.merged;
        queuedFollowUpDispatchingRef.current = true;
        queuedAgentFollowUpsRef.current = batch.remaining;
        setQueuedAgentFollowUps(batch.remaining);
        try {
            if (next.projectKind === "image") {
                await sendPrompt(next.prompt, {
                    summarizePreferences: next.summarizePreferences,
                    completionProjectId: next.projectId,
                    completionConversationId: next.conversationId,
                    sourceNodeIds: next.selectedNodeIds,
                    focusedNodeId: next.focusedNodeId,
                    sourceImages: next.sourceImages,
                    referenceImages: next.referenceImages,
                    fileAttachments: next.fileAttachments,
                    useComposerAttachments: false,
                    frozenTaskScope: next.frozenTaskScope
                });
            }
            else if (next.projectKind === "writing") {
                await sendWritingPrompt(next.prompt, next.visiblePrompt, next);
            }
            else {
                await sendLineagePrompt(next.prompt, next.visiblePrompt, next);
            }
        }
        catch (error) {
            setServerMessage(`队列任务暂未完成：${describeError(error)}`);
        }
        finally {
            queuedFollowUpDispatchingRef.current = false;
            if (queuedAgentFollowUpsRef.current.length)
                setQueuedAgentFollowUps([...queuedAgentFollowUpsRef.current]);
        }
    }
    useEffect(() => {
        if (!queuedAgentFollowUps.length || !configReady)
            return undefined;
        const timer = window.setTimeout(() => drainQueuedAgentFollowUp(), 0);
        return () => window.clearTimeout(timer);
    }, [queuedAgentFollowUps, activeProjectId, activeConversationId, agentStatus, pendingAgentExecution, configReady, projectRunViews]);
    function handleCanvasDragOver(event: React.DragEvent<HTMLDivElement>) {
        const types = Array.from(event.dataTransfer?.types ?? []);
        const internalAssetDrag = internalAssetDragRef.current;
        const hasInternalAsset = Boolean(internalAssetDrag &&
            Date.now() - internalAssetDrag.startedAt < 30000 &&
            types.includes(INTERNAL_ASSET_DRAG_MIME));
        const hasFiles = fileDragPayloadPresent(types, Array.from(event.dataTransfer?.items ?? [], (item) => item.kind), event.dataTransfer?.files?.length ?? 0);
        const hasDatabase = types.includes("application/x-aieyra-database");
        if (!hasInternalAsset && !hasFiles && !hasDatabase)
            return;
        event.preventDefault();
        event.dataTransfer.dropEffect = hasInternalAsset ? "move" : "copy";
        setExternalCanvasDropActive(hasFiles && !hasInternalAsset);
        if (hasInternalAsset) {
            const target = event.target as HTMLElement;
            const preview = target.closest<HTMLElement>(".node-image-preview");
            const rawTargetId = preview?.closest<HTMLElement>(".flow-node.image")?.dataset.nodeId || "";
            const targetNode = rawTargetId ? (canvasNodeById.get(rawTargetId) ?? nodesRef.current.find((node) => node.id === rawTargetId)) : null;
            const targetId = targetNode && !targetNode.layerGroup && !targetNode.layerComposition &&
                (targetNode.imageContainer || targetNode.imageCollection || canGroupImageAsset(targetNode))
                ? rawTargetId
                : "";
            updateMergeHover(targetId, event.clientX, event.clientY, internalAssetDrag!);
        }
    }
    async function importCanvasFiles(files: File[], clientX: number, clientY: number, targetContainerId = "") {
        const projectId = activeProjectIdRef.current;
        if (fileActionBusyRef.current || projectTransitionRef.current) {
            showCanvasOperationNotice("请等待当前项目保存或导入结束。");
            return;
        }
        try {
            const imageFiles = files.filter(file => /^image\//i.test(file.type) || /\.(?:png|jpe?g|webp|gif|bmp|svg|avif|heic)$/i.test(file.name));
            const otherFiles = files.filter(file => !imageFiles.includes(file));
            if (imageFiles.length) {
                const result = await importTransferredFiles(projectId, imageFiles);
                if (!result.ok || result.skippedCount)
                    throw Error(result.error || result.warnings?.join("\n") || "部分图片未能导入，请重试。");
                if (projectId !== activeProjectIdRef.current || projectTransitionRef.current)
                    throw Error("画布已切换，请回原画布重试。");
                await importPathsToCanvas((result.files || []).map(file => file.path), clientX, clientY, targetContainerId);
                await flushActiveProjectSession();
            }
            if (otherFiles.length) {
                const binding = await requireCanvasBinding(projectId);
                const result = await importTransferredFiles(binding.projectId, otherFiles);
                if (!result.ok)
                    throw Error(result.error || "文件未能导入。");
                await appendComposerDraft(binding.projectId, binding.conversationId, { files: result.files || [] });
                if (projectId === activeProjectIdRef.current) {

                    setMatrixChatOpen(true);
                }
                showCanvasOperationNotice("文件已加入右侧对话的输入框，可补充要求后发送。");
                if (result.skippedCount)
                    throw Error(result.warnings?.join("\n") || "部分文件未能添加。");
            }
        }
        catch (error) {
            showCanvasOperationNotice(describeError(error));
        }
    }
    function handleCanvasDrop(event: React.DragEvent<HTMLDivElement>) {
        setAssetDropTargetId("");
        setExternalCanvasDropActive(false);
        const database = event.dataTransfer.getData("application/x-aieyra-database");
        if (database) {
            event.preventDefault();
            event.stopPropagation();
            const projectId = activeProjectIdRef.current, point = clientToWorld(event.clientX, event.clientY);
            void (async () => { const data = JSON.parse(database); if (data.projectId !== projectId)
                throw Error("资料属于其他项目，请返回原项目后重新拖入。"); const r = await window.aieyraConfig!.referenceStyle!({ styleId: data.id, projectId, recordRevision: data.revision }); if (!r.ok || !r.reference)
                throw Error(r.error || "数据库引用失败"); if (r.reference.revision !== data.revision)
                throw Error("数据库已有更新，请重新拖入最新卡片。"); await useDatabaseReference(r.reference, point, projectId); })().catch(e => showCanvasOperationNotice(describeError(e)));
            return;
        }
        const dropTarget = event.target as HTMLElement;
        const rawTargetNodeId = dropTarget.closest<HTMLElement>(".flow-node.image")?.dataset.nodeId || "";
        const targetPreview = dropTarget.closest<HTMLElement>(".node-image-preview");
        const targetNodeId = targetPreview?.closest<HTMLElement>(".flow-node.image")?.dataset.nodeId || "";
        const targetTile = dropTarget.closest<HTMLElement>(".node-image-tile");
        const targetCanvasNode = targetNodeId ? canvasNodeById.get(targetNodeId) : undefined;
        const targetDisplayIndex = Number(targetTile?.dataset.assetIndex ?? 0);
        const targetSource = targetCanvasNode ? sourceForDisplayedAsset(targetCanvasNode, Number.isFinite(targetDisplayIndex) ? targetDisplayIndex : 0) : null;
        const targetArtifactNodeId = targetSource?.node.id || targetNodeId;
        const internalAssetDrag = internalAssetDragRef.current;
        const dragToken = event.dataTransfer.getData(INTERNAL_ASSET_DRAG_MIME);
        if (internalAssetDrag &&
            dragToken === internalAssetDrag.dragId &&
            Date.now() - internalAssetDrag.startedAt < 30000) {
            event.preventDefault();
            event.stopPropagation();
            internalAssetDragRef.current = null;
            const source = nodesRef.current.find((node) => node.id === internalAssetDrag.nodeId);
            if (source?.layerGroup) {
                clearMergeHover();
                return;
            }
            const explicitTarget = targetArtifactNodeId
                ? (nodesRef.current.find((node) => node.id === targetArtifactNodeId) ?? targetCanvasNode)
                : null;
            const invalidNodeSurfaceDrop = Boolean(rawTargetNodeId && (!targetPreview || !explicitTarget || explicitTarget.layerGroup || explicitTarget.layerComposition));
            if (invalidNodeSurfaceDrop) {
                clearMergeHover();
                return;
            }
            const sourceHost = layoutGroupsRef.current.find(group => group.memberNodeIds.includes(internalAssetDrag.nodeId))?.hostNodeId || internalAssetDrag.nodeId;
            const sameContainer = sourceHost === targetNodeId;
            const ready = sameContainer || !targetNodeId || readyMergeTarget(targetNodeId, event.clientX, event.clientY, internalAssetDrag);
            clearMergeHover();
            if (!ready)
                return;
            const move = moveContainerAsset(internalAssetDrag.nodeId, internalAssetDrag.assetKey, event.clientX, event.clientY, targetArtifactNodeId);
            if (internalAssetDrag.diagnosticId) {
                const diagnosticId = internalAssetDrag.diagnosticId;
                nativeAssetDropTraceRef.current = {
                    diagnosticId,
                    sourceNodeId: internalAssetDrag.nodeId,
                    targetContainerId: targetArtifactNodeId,
                    status: "pending"
                };
                void move.then((result) => {
                    if (nativeAssetDropTraceRef.current?.diagnosticId !== diagnosticId)
                        return;
                    nativeAssetDropTraceRef.current = {
                        diagnosticId,
                        sourceNodeId: internalAssetDrag.nodeId,
                        targetContainerId: targetArtifactNodeId,
                        status: result.ok ? "done" : "error",
                        result
                    };
                }).catch((error) => {
                    if (nativeAssetDropTraceRef.current?.diagnosticId !== diagnosticId)
                        return;
                    nativeAssetDropTraceRef.current = {
                        diagnosticId,
                        sourceNodeId: internalAssetDrag.nodeId,
                        targetContainerId: targetArtifactNodeId,
                        status: "error",
                        result: { ok: false, error: describeError(error) }
                    };
                });
            }
            else {
                void move;
            }
            return;
        }
        const transferItems = Array.from(event.dataTransfer?.items ?? []);
        const externalFilePayload = fileDragPayloadPresent(Array.from(event.dataTransfer?.types ?? []), transferItems.map((item) => item.kind), event.dataTransfer?.files?.length ?? 0);
        if (!externalFilePayload)
            return;
        event.preventDefault();
        event.stopPropagation();
        const droppedFiles = [
            ...Array.from(event.dataTransfer?.files ?? []),
            ...transferItems.map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => Boolean(file))
        ];
        const uniqueFiles = transferredFiles(event.dataTransfer);
        const paths = droppedPathsFromFiles(Array.from(new Set(droppedFiles)));
        if (paths.length && uniqueFiles.some(file => !droppedPathsFromFiles([file]).length)) {
            void importCanvasFiles(uniqueFiles, event.clientX, event.clientY, targetNodeId);
            return;
        }
        if (!paths.length) {
            void importCanvasFiles(uniqueFiles, event.clientX, event.clientY, targetNodeId);
            return;
        }
        const documentPaths = paths.filter(path => /\.(?:txt|md|markdown|html?|csv|tsv|json|docx|xlsx|pptx|pdf)$/i.test(path));
        if (documentPaths.length) {
            const projectId = activeProjectIdRef.current;
            void (async () => { for (const path of documentPaths) {
                const r = await studioCall({ action: "import", projectId, path });
                if (r.document)
                    await mountStudioDocument(r.document);
            } })().catch(e => showCanvasOperationNotice(describeError(e)));
        }
        const miscellaneous = uniqueFiles.filter(file => !/\.(?:txt|md|markdown|html?|csv|tsv|json|docx|xlsx|pptx|pdf|png|jpe?g|webp|gif|bmp|svg|avif|heic)$/i.test(file.name) && !file.webkitRelativePath && file.size > 0);
        if (miscellaneous.length)
            void importCanvasFiles(miscellaneous, event.clientX, event.clientY);
        const otherPaths = droppedPathsFromFiles(miscellaneous);
        const imagePaths = paths.filter(path => !documentPaths.includes(path) && !otherPaths.includes(path));
        if (!imagePaths.length)
            return;
        const targetContainerId = nodesRef.current.some((node) => node.id === targetNodeId && (node.imageContainer || node.imageCollection)) ||
            layoutGroupsRef.current.some((group) => group.hostNodeId === targetNodeId)
            ? targetNodeId
            : "";
        void importPathsToCanvas(imagePaths, event.clientX, event.clientY, targetContainerId);
    }
    function normalizeLayerGroupsAfterRemoval(source: WorkflowNode[], removeIds: Set<string>) {
        const affectedGroups = new Map<string, ImageLayerNodeGroup>();
        for (const node of source) {
            if (removeIds.has(node.id) && node.layerGroup)
                affectedGroups.set(node.layerGroup.id, cloneImageLayerNodeGroup(node.layerGroup)!);
        }
        let next = source.filter((node) => !removeIds.has(node.id));
        for (const [groupId, removedGroup] of affectedGroups) {
            const members = next
                .filter((node) => node.layerGroup?.id === groupId)
                .sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0));
            if (!members.length)
                continue;
            const memberIds = new Set(members.map((member) => member.id));
            const sourceParentId = removedGroup.sourceParentId && !removeIds.has(removedGroup.sourceParentId)
                ? removedGroup.sourceParentId
                : undefined;
            if (members.length === 1) {
                const only = members[0];
                const onlyGroup = only.layerGroup!;
                next = next.map((node) => node.id === only.id
                    ? {
                        ...node,
                        title: onlyGroup.layerTitle || node.title,
                        parentId: sourceParentId,
                        relationType: sourceParentId ? (node.relationType || "derived-from") : undefined,
                        layerGroup: undefined,
                        imageParams: node.imageParams ? cloneImageTaskDraft({
                            ...node.imageParams,
                            layerId: undefined,
                            layerRole: undefined,
                            layerGroupId: undefined
                        }) : undefined,
                        imageProgress: node.imageProgress ? {
                            ...node.imageProgress,
                            message: "图层组仅剩一层，已转为普通图片成果"
                        } : node.imageProgress
                    }
                    : node);
                continue;
            }
            const normalized = new Map(members.map((member, index) => [member.id, {
                    order: index + 1,
                    total: members.length
                }]));
            next = next.map((node) => {
                const position = normalized.get(node.id);
                if (!position || !node.layerGroup)
                    return node;
                const isBase = position.order === 1;
                return {
                    ...node,
                    title: `#${String(node.layerGroup.groupNumber).padStart(3, "0")} · ${node.layerGroup.layerTitle}`,
                    parentId: isBase ? sourceParentId : undefined,
                    relationType: isBase && sourceParentId ? (node.relationType || "derived-from") : undefined,
                    layerGroup: {
                        ...cloneImageLayerNodeGroup(node.layerGroup)!,
                        order: position.order,
                        total: position.total,
                        sourceParentId,
                        mergedAsset: undefined,
                        summary: `图层组删除一层后已自动整理，当前 ${position.total} 层。`
                    },
                    imageProgress: node.imageProgress ? {
                        ...node.imageProgress,
                        total: 1,
                        completed: 1,
                        message: `第 ${position.order}/${position.total} 层 · 已自动整理`
                    } : node.imageProgress
                };
            });
            if (memberIds.size !== members.length)
                throw new Error("图层组整理失败。");
        }
        return next;
    }
    function normalizeImageLayoutsAfterRemoval(sourceBeforeRemoval: WorkflowNode[], remainingNodes: WorkflowNode[], sourceGroups: ImageLayoutGroup[], removeIds: Set<string>) {
        const normalized = normalizeImageLayoutState({ nodes: remainingNodes, groups: sourceGroups });
        const sourceGroupById = new Map(sourceGroups.map((group) => [group.id, group]));
        const groups = normalized.groups.map((group) => {
            const before = sourceGroupById.get(group.id);
            const membershipChanged = Boolean(before && (before.hostNodeId !== group.hostNodeId ||
                before.memberNodeIds.length !== group.memberNodeIds.length ||
                before.memberNodeIds.some((nodeId, index) => nodeId !== group.memberNodeIds[index])));
            return membershipChanged ? { ...group, autoFit: true } : group;
        });
        const remainingIds = new Set(remainingNodes.map((node) => node.id));
        let nodes = remainingNodes;
        for (const before of sourceGroups) {
            if (!before.memberNodeIds.some((nodeId) => removeIds.has(nodeId)))
                continue;
            const oldHost = sourceBeforeRemoval.find((node) => node.id === before.hostNodeId);
            if (!oldHost)
                continue;
            const after = groups.find((group) => group.id === before.id);
            const survivorId = after?.hostNodeId || before.memberNodeIds.find((nodeId) => remainingIds.has(nodeId)) || "";
            if (!survivorId || survivorId === before.hostNodeId)
                continue;
            nodes = nodes.map((node) => node.id === survivorId
                ? { ...node, x: oldHost.x, y: oldHost.y, zOrder: oldHost.zOrder }
                : node);
        }
        const canonicalNodes = synchronizeImageContainerSpecs(nodes, groups);
        const canonicalGroups = deriveImageLayoutGroupsFromContainerSpecs(canonicalNodes);
        return { nodes: fitImageLayoutHostNodes(canonicalNodes, canonicalGroups), groups: canonicalGroups };
    }
    function commitNodeRemoval(requestedIds: Iterable<string>, options: {
        historyLabel: string;
        eventText: string;
        agentText: string;
        recordHistory?: boolean;
    }) {
        const sourceNodes = nodesRef.current;
        const availableIds = new Set(sourceNodes.map((node) => node.id));
        const removeIds = new Set([...requestedIds].filter((id) => availableIds.has(id)));
        if (!removeIds.size)
            return 0;
        if (options.recordHistory !== false)
            pushCanvasHistory(options.historyLabel);
        const detached: WorkflowNode[] = sourceNodes.map((item): WorkflowNode => {
            if (removeIds.has(item.id))
                return item;
            if (item.type === "requirement" && item.requirement) {
                const before = requirementInputBindings(item, sourceNodes);
                const requirement = removeRequirementInputBindings({ ...item.requirement, inputBindings: before }, removeIds);
                const bindings = requirementInputBindings({ ...item, requirement, parentId: undefined }, sourceNodes);
                return {
                    ...item,
                    requirement,
                    parentId: primaryRequirementInputNodeId(bindings) || undefined,
                    relationType: bindings.length ? "referenced" : undefined,
                };
            }
            return item.parentId && removeIds.has(item.parentId)
                ? { ...item, parentId: undefined, relationType: undefined }
                : item;
        });
        const layerNormalized = normalizeLayerGroupsAfterRemoval(detached, removeIds);
        const layoutNormalized = normalizeImageLayoutsAfterRemoval(sourceNodes, layerNormalized, layoutGroupsRef.current, removeIds);
        nodesRef.current = layoutNormalized.nodes;
        layoutGroupsRef.current = layoutNormalized.groups;
        if (canvasUndoRef.current && options.recordHistory !== false) {
            canvasUndoRef.current.afterNodes = layoutNormalized.nodes.map(cloneWorkflowNode);
            canvasUndoRef.current.afterGroups = layoutNormalized.groups.map(group => ({ ...group, memberNodeIds: [...group.memberNodeIds] }));
        }
        recordImageToolNodeRemovals(removeIds);
        setNodes(layoutNormalized.nodes);
        setLayoutGroups(layoutNormalized.groups);
        removeNodeIdsFromSelection(removeIds);
        setCanvasMenu(null);
        addEvent(options.eventText);
        notifyAgentOfManualAction("删除画布成果", options.agentText);
        return removeIds.size;
    }
    function requestDeleteNode(nodeId: string) {
        const ids = expandCanvasSelectionNodeIds(nodesRef.current, layoutGroupsRef.current, [nodeId]);
        commitNodeRemoval(ids, { historyLabel: "删除节点", eventText: `移除节点 ${nodeId}，原图片文件保留`, agentText: `用户移除了节点 ${nodeId} 及其容器成员，原文件保留。` });
    }
    function currentCanvasSelectionCapabilities() {
        const selection = currentNodeSelection();
        return analyzeCanvasSelection(nodesRef.current, layoutGroupsRef.current, selection.ids, selection.primaryId);
    }
    function mergeSelectedIntoImageContainer(capabilities = currentCanvasSelectionCapabilities()) {
        if (!capabilities.canGroupIntoContainer || !capabilities.preferredContainerHostId)
            return false;
        const sourceNodes = nodesRef.current;
        const mutation = mergeCanvasImageContainers(sourceNodes, layoutGroupsRef.current, [...capabilities.groupableNodeIds, ...capabilities.groupExcluded.map(item => item.nodeId)], capabilities.preferredContainerHostId, uid("image-layout"));
        if (!mutation) {
            showCanvasOperationNotice("当前选择未能完整合并，请先停止正在绘制的节点后重试。画布保持原状。");
            return false;
        }
        pushCanvasHistory("合并图片容器");
        commitImageLayout(mutation.nodes, mutation.groups, mutation.hostNodeId);
        replaceSelectedNodeId(mutation.hostNodeId);
        setCanvasMenu(null);
        setAssetContextMenu(null);
        addEvent(`已合并 ${mutation.memberNodeIds.length} 个图片节点`);
        if (mutation.excluded)
            showCanvasOperationNotice("已合并全部图片；需求便签保留在画布上。");
        notifyAgentOfManualAction("合并图片容器", `用户将 ${mutation.memberNodeIds.length} 个图片节点完整合并到容器 ${mutation.hostNodeId}，已解除这些节点的输入、输出及需求连线；图片文件保持不变。`);
        return mutation.hostNodeId;
    }
    function deleteSelectedCanvasNodes(capabilities = currentCanvasSelectionCapabilities()) {
        if (!capabilities.canDelete)
            return false;
        const excluded = capabilities.deleteExcluded.length;
        const count = commitNodeRemoval(capabilities.deleteNodeIds, {
            historyLabel: `删除 ${capabilities.deleteNodeIds.length} 项`,
            eventText: `删除选中的 ${capabilities.deleteNodeIds.length} 个成果${excluded ? `，保留 ${excluded} 个生成中成果` : ""}`,
            agentText: `用户删除画布上选中的 ${capabilities.deleteNodeIds.length} 个成果，未删除原始图片文件，未被删除成果的衍生关系已安全解除。${excluded ? `另有 ${excluded} 个生成中成果未删除。` : ""}`
        });
        return count > 0;
    }
    function dissolveSelectedImageContainers(capabilities = currentCanvasSelectionCapabilities()) {
        const selectedGroups = capabilities.selectedLayoutGroupIds
            .map((id) => layoutGroupsRef.current.find((group) => group.id === id))
            .filter((group): group is ImageLayoutGroup => Boolean(group));
        if (!selectedGroups.length)
            return false;
        pushCanvasHistory(`解散 ${selectedGroups.length} 个图片容器`);
        const hostIds = selectedGroups.map((group) => group.hostNodeId);
        for (const group of selectedGroups)
            dissolveImageLayoutGroup(group.hostNodeId);
        selectNodeGroup(hostIds, hostIds[0]);
        setCanvasMenu(null);
        return true;
    }
    function nudgeSelectedCanvasNodes(dx: number, dy: number) {
        const selection = currentNodeSelection();
        const projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const targetIds = new Set(selection.ids.map((id) => projection.groupByMember.get(id)?.hostNodeId ?? id));
        if (!targetIds.size)
            return false;
        const now = Date.now();
        if (now - keyboardNudgeHistoryAtRef.current > 360)
            pushCanvasHistory("移动选中成果");
        keyboardNudgeHistoryAtRef.current = now;
        const next = nodesRef.current.map((node) => targetIds.has(node.id)
            ? { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) }
            : node);
        nodesRef.current = next;
        setNodes(next);
        const history = canvasUndoRef.current;
        if (history?.label === "移动选中成果" && history.projectId === activeProjectIdRef.current) {
            const moved = new Map(next.map(node => [node.id, node]));
            history.afterNodes = (history.afterNodes || history.nodes).map(node => targetIds.has(node.id) && moved.has(node.id)
                ? { ...node, x: moved.get(node.id)!.x, y: moved.get(node.id)!.y } : node);
        }
        setCanvasMenu(null);
        return true;
    }
    async function nodeIdForRuntimeToolRun(toolRunId: string, attempts = 20) {
        if (!toolRunId)
            return "";
        for (let index = 0; index < attempts; index += 1) {
            const nodeId = agentToolNodeIdsRef.current[toolRunId] || "";
            if (nodeId)
                return nodeId;
            await new Promise((resolve) => window.setTimeout(resolve, 40));
        }
        return agentToolNodeIdsRef.current[toolRunId] || "";
    }
    function resolveLayerCompositionAssets(composition: ImageLayerComposition): ImageLayerComposition {
        return {
            ...composition,
            layers: composition.layers.map((layer, index) => {
                if (layer.asset)
                    return { ...layer, asset: { ...layer.asset } };
                const sourceNode = layer.sourceNodeId ? nodesRef.current.find((node) => node.id === layer.sourceNodeId) : null;
                if (!sourceNode)
                    throw new Error(`图层 ${index + 1} 缺少源节点 ${layer.sourceNodeId || ""}。`);
                const requestedIndex = Number(layer.assetIndex ?? 1);
                const assetIndex = requestedIndex <= 0 ? 0 : requestedIndex - 1;
                const asset = sourceNode.assets?.[assetIndex];
                if (!asset)
                    throw new Error(`图层 ${index + 1} 在节点 ${sourceNode.id} 找不到第 ${requestedIndex || 1} 张图片。`);
                return {
                    ...layer,
                    title: layer.title || nodeWorkName(sourceNode),
                    asset: { ...asset }
                };
            })
        };
    }
    function layerMergeGroupId(action: AgentRuntimeAction) {
        const composition = action.composition ?? action.node?.layerComposition;
        if (!composition)
            return "";
        return composition.layers.find((layer) => String(layer.groupId || "").trim())?.groupId || composition.id;
    }
    function layerMergeRuntimeKey(action: AgentRuntimeAction, projectId: string) {
        const toolRunId = String(action.toolRunId || "").trim();
        const groupId = layerMergeGroupId(action);
        return `${projectId}::${toolRunId ? `run:${toolRunId}` : `group:${groupId}`}`;
    }
    function existingLayerMergeNode(action: AgentRuntimeAction, source = nodesRef.current) {
        const composition = action.composition ?? action.node?.layerComposition;
        if (!composition)
            return undefined;
        const toolRunId = String(action.toolRunId || "").trim();
        const groupIds = new Set([
            String(composition.id || "").trim(),
            ...composition.layers.map((layer) => String(layer.groupId || "").trim())
        ].filter(Boolean));
        const resumesExistingGroup = Boolean(String(action.resumeLayerGroupId || "").trim());
        return source.find((node) => Boolean(node.layerGroup &&
            node.imageState !== "generating" &&
            ((toolRunId && node.layerGroup.toolRunId === toolRunId) ||
                (!resumesExistingGroup && groupIds.has(node.layerGroup.id)))));
    }
    function layerExecutionPlaceholderForAction(action: AgentRuntimeAction) {
        const operationId = String(action.operationId || action.toolRunId || "").trim();
        if (operationId && layerExecutionPlaceholdersRef.current.has(operationId)) {
            return layerExecutionPlaceholdersRef.current.get(operationId);
        }
        const composition = action.composition ?? action.node?.layerComposition;
        const groupId = String(composition?.id || "").trim();
        return groupId
            ? [...layerExecutionPlaceholdersRef.current.values()].find((placeholder) => placeholder.groupId === groupId)
            : undefined;
    }
    function ensureLayerExecutionPlaceholders(action: AgentRuntimeAction) {
        const composition = action.composition ?? action.node?.layerComposition;
        const operationId = String(action.operationId || action.toolRunId || "").trim();
        if (!composition || !operationId || !composition.layers.length)
            return false;
        if (layerExecutionPlaceholdersRef.current.has(operationId))
            return true;
        const projectId = activeProjectIdRef.current;
        const resumeLayerGroupId = String(action.resumeLayerGroupId || "").trim();
        if (resumeLayerGroupId) {
            const members = nodesRef.current
                .filter((node) => node.layerGroup?.id === resumeLayerGroupId)
                .sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0));
            const recovery = members.find((node) => node.layerGroup?.recovery)?.layerGroup?.recovery;
            const failedLayerIds = new Set(recovery?.failedLayerIds ?? []);
            const requestedRetryLayerIds = [...new Set((action.retryLayerIds ?? []).map((value) => String(value || "").trim()).filter(Boolean))];
            const requestedRegenerateLayerIds = [...new Set((action.regenerateLayerIds ?? []).map((value) => String(value || "").trim()).filter(Boolean))];
            const regenerateMode = requestedRegenerateLayerIds.length > 0;
            if (requestedRetryLayerIds.length && regenerateMode) {
                setServerMessage("分层任务不能同时恢复失败层并重新生成已完成层。");
                return false;
            }
            const activeLayerIds = regenerateMode
                ? requestedRegenerateLayerIds
                : requestedRetryLayerIds.length ? requestedRetryLayerIds : [...failedLayerIds];
            const activeLayerSet = new Set(activeLayerIds);
            const memberByLayerId = new Map(members.map((node) => [String(node.layerGroup?.layerId || ""), node]));
            const orderedMembers = composition.layers.map((layer) => memberByLayerId.get(String(layer.id || ""))).filter((node): node is WorkflowNode => Boolean(node));
            const validRecovery = Boolean(!regenerateMode &&
                recovery?.recoverable &&
                members.length === composition.layers.length &&
                orderedMembers.length === composition.layers.length &&
                activeLayerIds.length > 0 &&
                activeLayerIds.length === failedLayerIds.size &&
                activeLayerIds.every((layerId) => failedLayerIds.has(layerId)));
            const validRegeneration = Boolean(regenerateMode &&
                members.length === composition.layers.length &&
                orderedMembers.length === composition.layers.length &&
                members.every((node) => node.imageState === "done" && (node.assets?.length ?? 0) > 0 && !node.layerGroup?.recovery) &&
                activeLayerIds.every((layerId) => memberByLayerId.has(layerId)));
            if (!validRecovery && !validRegeneration) {
                setServerMessage(regenerateMode ? "当前分层组尚未完整就绪，无法单独重新生成图层。" : "分层恢复状态与当前画布不一致，请重新执行原需求。");
                return false;
            }
            const activeNodeIds = orderedMembers
                .filter((node) => activeLayerSet.has(String(node.layerGroup?.layerId || "")))
                .map((node) => node.id);
            if (!activeNodeIds.length)
                return false;
            const activeNodeIdSet = new Set(activeNodeIds);
            const now = new Date().toISOString();
            const nextNodes = nodesRef.current.map((node) => {
                if (!activeNodeIdSet.has(node.id) || !node.layerGroup)
                    return node;
                return {
                    ...node,
                    status: "working" as const,
                    imageState: "generating" as const,
                    imageError: undefined,
                    generationRunId: operationId,
                    imageProgress: imageProgressState(1, 0, `正在定向修复图层 · 第 ${node.layerGroup.order}/${node.layerGroup.total} 层`),
                    layerGroup: {
                        ...cloneImageLayerNodeGroup(node.layerGroup)!,
                        toolRunId: operationId,
                        recovery: !regenerateMode && recovery ? {
                            ...recovery,
                            failedLayerIds: [...recovery.failedLayerIds],
                            successfulLayerIds: [...recovery.successfulLayerIds],
                            attempt: Math.max(1, Number(recovery.attempt || 1)) + 1,
                            updatedAt: now,
                        } : undefined,
                    },
                };
            });
            const first = orderedMembers[0];
            const groupNumber = Number(first.layerGroup?.groupNumber || composition.groupNumber || 0);
            const placeholder: LayerExecutionPlaceholder = {
                operationId,
                projectId,
                groupId: resumeLayerGroupId,
                groupNumber,
                parentId: first.layerGroup?.sourceParentId,
                nodeIds: orderedMembers.map((node) => node.id),
                activeNodeIds,
                resume: true,
                retryLayerIds: activeLayerIds,
                anchorX: Number(first.layerGroup?.anchorX ?? first.x),
                anchorY: Number(first.layerGroup?.anchorY ?? first.y),
                createdAt: first.layerGroup?.createdAt || first.createdAt || nowLabel(),
            };
            layerExecutionPlaceholdersRef.current.set(operationId, placeholder);
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
            activeNodeIds.forEach((nodeId) => markImageRunStarted(nodeId, Date.now()));
            const top = [...orderedMembers].reverse().find((node) => activeNodeIdSet.has(node.id)) ?? orderedMembers[orderedMembers.length - 1];
            if (top) {
                agentToolNodeIdsRef.current[operationId] = top.id;
                setSelectedNodeId(top.id);
                setActiveNodeId(top.id);
                pendingRuntimeFocusNodeIdRef.current = top.id;
                void waitForCanvasNodeCommit(top.id).then((visible) => {
                    if (visible)
                        recordImageToolCommitEvidence(operationId, { placeholderVisibleAt: Date.now() });
                });
            }
            recordImageToolCommitEvidence(operationId, {
                operation: "layers",
                placeholderCommitAt: Date.now(),
                nodeIds: placeholder.nodeIds,
            });
            addEvent(`runtime ${regenerateMode ? "重新生成" : "定向修复"}分层组 #${String(groupNumber).padStart(3, "0")} · ${activeLayerIds.length} 层`);
            return true;
        }
        const usedGroupNumbers = new Set(nodesRef.current.map((node) => Number(node.layerGroup?.groupNumber ?? node.layerComposition?.groupNumber ?? 0)).filter((value) => value > 0));
        const requestedGroupNumber = Math.max(0, Math.floor(Number(composition.groupNumber || 0)));
        const groupNumber = requestedGroupNumber > 0 && !usedGroupNumbers.has(requestedGroupNumber)
            ? requestedGroupNumber
            : Math.max(0, ...usedGroupNumbers) + 1;
        const groupId = String(composition.id || `pending-layers-${operationId}`).trim();
        const parentId = String(action.parentId ?? action.node?.parentId ?? "").trim() || undefined;
        const parent = parentId ? nodesRef.current.find((node) => node.id === parentId) : undefined;
        const nodeSize = layerArtboardDisplaySize(composition.width, composition.height);
        const openPosition = findOpenWorkflowNodePosition(nodesRef.current, {
            parent,
            width: nodeSize.width,
            height: nodeSize.height,
            preferredX: (parent?.x ?? 120) + 320,
            preferredY: (parent?.y ?? 140) + 80,
        });
        const anchor = { x: Math.round(openPosition.x), y: Math.round(openPosition.y) };
        const createdAt = composition.createdAt || nowLabel();
        const nextNodes = [...nodesRef.current];
        const baseZ = nextNodeZOrder(nextNodes);
        const placeholders = composition.layers.map((layer, index): WorkflowNode => {
            const order = Number(layer.order ?? index + 1);
            const id = allocateNodeCode(nextNodes);
            const displayCode = `L${String(groupNumber).padStart(3, "0")}-${order}`;
            const role = layer.role || "other";
            const node: WorkflowNode = {
                id,
                displayCode,
                title: `#${String(groupNumber).padStart(3, "0")} · ${layer.title || `图层 ${order}`}`,
                prompt: layer.prompt || action.node?.prompt || "正在生成独立 PNG 图层",
                type: "image",
                status: "working",
                x: anchor.x,
                y: anchor.y,
                parentId: index === 0 ? parentId : undefined,
                relationType: index === 0 && parentId ? (action.node?.relationType || "derived-from") : undefined,
                branch: "project-agent",
                outputs: 0,
                createdAt,
                assets: [],
                imageState: "generating",
                imageParams: cloneImageTaskDraft({
                    ...(action.node?.imageParams ?? defaultImageTaskDraft(settings)),
                    prompt: layer.prompt || action.node?.prompt || "正在生成独立 PNG 图层",
                    count: 1,
                    size: `${composition.width}x${composition.height}`,
                    outputFormat: "png",
                    background: role === "background" || layer.transparent === false ? "opaque" : "transparent",
                    layerId: layer.id,
                    layerRole: role,
                    layerGroupId: groupId,
                    transparentPreferred: role !== "background" && layer.transparent !== false,
                    alphaStrategy: layer.alphaStrategy,
                }),
                imageProgress: imageProgressState(1, 0, `等待第 ${order}/${composition.layers.length} 层`),
                generationRunId: operationId,
                taskProvenance: sanitizeImageTaskProvenance(action.node?.taskProvenance),
                layerGroup: {
                    id: groupId,
                    toolRunId: operationId,
                    title: composition.title || action.node?.title || "分层 PNG",
                    groupNumber,
                    total: composition.layers.length,
                    order,
                    layerId: layer.id,
                    layerTitle: layer.title || `图层 ${order}`,
                    role,
                    text: layer.text,
                    transparent: role === "background" ? false : layer.transparent !== false,
                    referenceCodes: layer.referenceCodes ? [...layer.referenceCodes] : undefined,
                    compositionWidth: composition.width,
                    compositionHeight: composition.height,
                    anchorX: anchor.x,
                    anchorY: anchor.y,
                    detached: false,
                    visible: layer.visible !== false,
                    opacity: clamp(Number(layer.opacity ?? 1), 0, 1),
                    blendMode: layer.blendMode === "multiply" || layer.blendMode === "screen" || layer.blendMode === "overlay" || layer.blendMode === "source-over" ? layer.blendMode : "normal",
                    sourceParentId: parentId,
                    createdAt,
                    summary: composition.summary || `正在生成 ${composition.layers.length} 个独立 PNG 图层。`,
                },
                width: nodeSize.width,
                height: nodeSize.height,
                zOrder: baseZ + index,
            };
            nextNodes.push(node);
            return node;
        });
        const placeholder: LayerExecutionPlaceholder = {
            operationId,
            projectId,
            groupId,
            groupNumber,
            parentId,
            nodeIds: placeholders.map((node) => node.id),
            activeNodeIds: placeholders.map((node) => node.id),
            resume: false,
            retryLayerIds: composition.layers.map((layer) => layer.id),
            anchorX: anchor.x,
            anchorY: anchor.y,
            createdAt,
        };
        layerExecutionPlaceholdersRef.current.set(operationId, placeholder);
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        placeholders.forEach((node) => markImageRunStarted(node.id, Date.now()));
        const top = placeholders[placeholders.length - 1];
        if (top) {
            agentToolNodeIdsRef.current[operationId] = top.id;
            setSelectedNodeId(top.id);
            setActiveNodeId(top.id);
            pendingRuntimeFocusNodeIdRef.current = top.id;
            void waitForCanvasNodeCommit(top.id).then((visible) => {
                if (visible)
                    recordImageToolCommitEvidence(operationId, { placeholderVisibleAt: Date.now() });
            });
        }
        recordImageToolCommitEvidence(operationId, {
            operation: "layers",
            placeholderCommitAt: Date.now(),
            nodeIds: placeholder.nodeIds,
        });
        addEvent(`runtime 创建分层运行占位 #${String(groupNumber).padStart(3, "0")} · ${placeholders.length} 层`);
        return true;
    }
    function releaseLayerExecutionPlaceholder(placeholder: LayerExecutionPlaceholder) {
        placeholder.activeNodeIds.forEach((nodeId) => markImageRunFinished(nodeId));
        layerExecutionPlaceholdersRef.current.delete(placeholder.operationId);
    }
    function removeLayerExecutionPlaceholderNodes(placeholder: LayerExecutionPlaceholder) {
        if (placeholder.resume) {
            releaseLayerExecutionPlaceholder(placeholder);
            return;
        }
        const nodeIds = new Set(placeholder.nodeIds);
        const nextNodes = nodesRef.current.filter((node) => !nodeIds.has(node.id));
        if (nextNodes.length !== nodesRef.current.length) {
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
        }
        releaseLayerExecutionPlaceholder(placeholder);
    }
    function releaseAllLayerExecutionPlaceholders() {
        [...layerExecutionPlaceholdersRef.current.values()].forEach(releaseLayerExecutionPlaceholder);
        layerExecutionPlaceholdersRef.current.clear();
    }
    function failLayerExecutionPlaceholders(operationId: string, message: string) {
        const placeholder = layerExecutionPlaceholdersRef.current.get(operationId);
        if (!placeholder)
            return false;
        const nodeIds = new Set(placeholder.activeNodeIds);
        const nextNodes = nodesRef.current.map((node) => nodeIds.has(node.id)
            ? {
                ...node,
                status: "review" as const,
                imageState: "error" as const,
                imageError: message,
                generationRunId: undefined,
                imageProgress: imageProgressState(1, 0, "图层生成失败，可重新执行需求", { failed: 1, failedSlots: [1], stopped: true }),
            }
            : node);
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        releaseLayerExecutionPlaceholder(placeholder);
        recordImageToolCommitEvidence(operationId, { operation: "layers", error: message, nodeIds: placeholder.nodeIds });
        return true;
    }
    function failAllLayerExecutionPlaceholders(message: string) {
        [...layerExecutionPlaceholdersRef.current.keys()].forEach((operationId) => {
            failLayerExecutionPlaceholders(operationId, message);
        });
    }
    function retryNodeImageWork(nodeId: string) {
        const node = nodesRef.current.find(item => item.id === nodeId);
        if (!node || node.type !== "image" || projectImageRunStarts(activeProjectIdRef.current)[nodeId])
            return;
        if (node.layerGroup || node.layerComposition)
            return;
        const entries = [...backgroundImageJobsRef.current.values()].filter(entry => entry.job.projectId === activeProjectIdRef.current && Object.values(entry.nodeIds).includes(nodeId));
        const job = entries[entries.length - 1]?.job;
        const draft = cloneImageTaskDraft(node.imageParams || defaultImageTaskDraft(settings));
        draft.prompt = draft.prompt || String(job?.input.prompt || node.prompt || "");
        if (!draft.prompt.trim()) {
            openManualImageTaskAt(node.x, node.y, "", "", nodeId);
            return;
        }
        const originals = [...(job?.taskScope?.sourceAssets || []), ...(job?.taskScope?.referenceAssets || [])];
        const references: ReferenceImage[] = originals.filter(asset => asset.path || asset.assetUrl).map(asset => ({
            ...asset, path: asset.path || "", name: asset.name || asset.displayCode || "参考图", taskRole: "reference"
        }));
        draft.referenceImages = [...new Map([...references, ...(draft.referenceImages || [])].map(image => [image.path || image.assetUrl || image.assetId, image])).values()];
        const originalSource = job?.input.editImage as ReferenceImage | undefined;
        if (originalSource?.path && !draft.referenceImages.some(image => image.taskRole === "source")) {
            draft.referenceImages = [{ ...originalSource, taskRole: "source" }, ...draft.referenceImages.filter(image => image.path !== originalSource.path)];
        }
        const originalMask = job?.input.maskImage as ReferenceImage | undefined;
        if (!draft.maskImage && originalMask?.path)
            draft.maskImage = { ...originalMask };
        if (!draft.maskDataUrl && /^data:image\//i.test(String(job?.input.maskDataUrl || "")))
            draft.maskDataUrl = String(job!.input.maskDataUrl);
        if (!draft.maskImage && !draft.maskDataUrl && /maskImage:\s*yes/i.test(node.prompt || "")) {
            setServerMessage("原重绘蒙版已不可用，请重新选择修改区域；本次没有提交整张改图。");
            return;
        }
        const total = Math.max(1, node.imageProgress?.total || draft.count || 1);
        const completed = node.assets?.length || 0;
        draft.count = Math.max(1, total - completed);
        const review = projectRunsRef.current[activeProjectIdRef.current];
        if (review?.completionJobIds?.some(id => entries.some(entry => entry.job.id === id)) && review.status === "running") {
            void window.aieyraAgent?.cancelRun({ runId: review.runId });
            updateProjectRun(review.projectId, current => ({ ...current, status: "cancelled" }));
            if (activeRunRef.current === review.runId) {
                activeRunRef.current = null;
                setAgentStatus("idle");
            }
        }
        for (const entry of entries) {
            entry.job.delivered = true;
            void window.aieyraAgent?.cancelRun({ runId: entry.job.id });
        }
        void runManualImageTask(draft, { targetNodeId: nodeId, append: completed > 0, requestedCount: draft.count, targetTotal: Math.max(total, completed + draft.count) });
    }
    function stopNodeImageWork(nodeId: string) {
        const projectId = activeProjectIdRef.current;
        for (const [id, entry] of backgroundImageJobsRef.current) {
            if (entry.job.projectId !== projectId || entry.job.status !== "running" || !Object.values(entry.nodeIds).includes(nodeId))
                continue;
            entry.job.status = "cancelled";
            entry.resumeAttempted = true;
            void window.aieyraAgent?.cancelRun({ runId: id });
            activeImageRequestIdsRef.current.delete(id);
            appendImageJobMessage(projectId, entry.job.conversationId, { id: progressToolMessageId(id), role: "assistant", content: "已停止绘图。", createdAt: nowLabel(), status: "done", meta: "background-image" });
        }
        for (const [id, job] of manualImageJobsRef.current) {
            if (job.projectId !== projectId || job.nodeId !== nodeId)
                continue;
            manualImageJobsRef.current.delete(id);
            for (const requestId of activeImageRequestIdsRef.current.keys())
                if (requestId.startsWith(`manual-image:${id}-`)) {
                    void window.aieyraAgent?.cancelRun({ runId: requestId });
                    activeImageRequestIdsRef.current.delete(requestId);
                }
        }
        const node = nodesRef.current.find(item => item.id === nodeId);
        if (node?.imageState === "generating") {
            updateNode(nodeId, { status: "review", imageState: "error", imageError: "绘图已停止。", generationRunId: undefined,
                imageProgress: imageProgressState(node.imageProgress?.total || 1, node.assets?.length || 0, "绘图已停止。", { stopped: true }) });
        }
        markImageRunFinished(nodeId, projectId);
        setImageJobsRevision(revision => revision + 1);
    }
    async function commitRecoverableLayerPreparationFailure(job: LayerMergeRuntimeJob, failure: RecoverableLayerPreparationFailure): Promise<RuntimeActionCommitResult> {
        const operationId = String(job.action.operationId || job.action.toolRunId || "").trim();
        const placeholder = job.placeholder ?? layerExecutionPlaceholderForAction(job.action);
        const message = friendlyImageError(failure);
        if (!placeholder || !layerMergeJobIsCurrent(job)) {
            return { operationId, status: "cancelled", summary: "分层恢复状态已失效。" };
        }
        const failedIds = new Set(failure.failedLayerIds);
        const layerById = new Map(failure.partialComposition.layers.map((layer) => [layer.id, layer]));
        const placeholderIds = new Set(placeholder.nodeIds);
        const residualRatio = Number(failure.detail?.residualRatio);
        const residualLimit = Number(failure.detail?.residualLimit);
        const recovery: NonNullable<ImageLayerNodeGroup["recovery"]> = {
            status: failure.successfulLayerIds.length ? "partial" : "failed",
            stage: failure.stage,
            recoverable: failure.recoverable,
            failedLayerIds: [...failure.failedLayerIds],
            successfulLayerIds: [...failure.successfulLayerIds],
            message,
            attempt: 1,
            updatedAt: new Date().toISOString(),
            residualRatio: Number.isFinite(residualRatio) ? residualRatio : undefined,
            residualLimit: Number.isFinite(residualLimit) ? residualLimit : undefined,
        };
        const nextNodes = nodesRef.current.map((node) => {
            if (!placeholderIds.has(node.id) || !node.layerGroup)
                return node;
            const layer = layerById.get(node.layerGroup.layerId);
            const failed = failedIds.has(node.layerGroup.layerId) || !layer?.asset;
            const assets = layer?.asset ? imageAssetsWithIdentity([{ ...layer.asset, status: failed ? "error" : "done" }], node.displayCode || node.id) : [];
            return {
                ...node,
                status: failed ? "review" as const : "done" as const,
                imageState: failed ? "error" as const : "done" as const,
                imageError: failed ? message : undefined,
                generationRunId: undefined,
                outputs: assets.length,
                assets,
                imageProgress: imageProgressState(1, failed ? 0 : 1, failed ? "图层待定向修复" : "图层已保留", {
                    failed: failed ? 1 : 0,
                    failedSlots: failed ? [1] : [],
                    stopped: failed,
                }),
                layerGroup: {
                    ...cloneImageLayerNodeGroup(node.layerGroup)!,
                    previewAsset: failure.partialComposition.previewAsset ? { ...failure.partialComposition.previewAsset } : node.layerGroup.previewAsset,
                    summary: `${failure.successfulLayerIds.length} 层已保留，${failure.failedLayerIds.length} 层待修复。`,
                    recovery,
                },
            };
        });
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        releaseLayerExecutionPlaceholder(placeholder);
        const topNodeId = placeholder.nodeIds[placeholder.nodeIds.length - 1] || "";
        if (topNodeId) {
            agentToolNodeIdsRef.current[operationId] = topNodeId;
            const visible = await waitForCanvasNodeCommit(topNodeId);
            if (visible)
                recordImageToolCommitEvidence(operationId, { nodeVisibleAt: Date.now() });
        }
        recordImageToolCommitEvidence(operationId, {
            operation: "layers",
            nodeCommitAt: Date.now(),
            error: message,
            nodeIds: placeholder.nodeIds,
        });
        const detail = `已保留 ${failure.successfulLayerIds.length} 层；${failure.failedLayerIds.length} 层可定向重试。`;
        settleDeferredImageToolResult(operationId, { status: "error", summary: message, detail });
        setServerMessage(`${message} ${detail}`);
        addEvent(`runtime 保留分层部分成果 · ${detail}`);
        return { operationId, status: "error", summary: `${message} ${detail}` };
    }
    function layerMergeJobIsCurrent(job: LayerMergeRuntimeJob) {
        const pending = pendingLayerMergeRunsRef.current.get(job.key);
        return Boolean(pending &&
            pending.nonce === job.nonce &&
            pending.projectId === job.projectId &&
            pending.scopeEpoch === job.scopeEpoch &&
            activeProjectIdRef.current === job.projectId &&
            layerRuntimeScopeEpochRef.current === job.scopeEpoch);
    }
    async function finalizeLayerMergeAction(job: LayerMergeRuntimeJob): Promise<RuntimeActionCommitResult> {
        const { action, key, nonce, projectId, groupNumber } = job;
        const toolRunId = action.toolRunId || "";
        const operationId = String(action.operationId || toolRunId).trim();
        const cancelled = (): RuntimeActionCommitResult => ({ operationId, status: "cancelled", summary: "分层提交已取消。" });
        const completed = (summary: string): RuntimeActionCommitResult => ({ operationId, status: "done", summary });
        const composition = action.composition ?? action.node?.layerComposition;
        const regeneratesLayers = Boolean(action.regenerateLayerIds?.length);
        if (!composition) {
            if (pendingLayerMergeRunsRef.current.get(key)?.nonce === nonce)
                pendingLayerMergeRunsRef.current.delete(key);
            const summary = "分层结果缺少合成数据，无法提交到画布。";
            failLayerExecutionPlaceholders(job.placeholder?.operationId || operationId, summary);
            settleDeferredImageToolResult(operationId, { status: "error", summary });
            return { operationId, status: "error", summary };
        }
        try {
            if (!layerMergeJobIsCurrent(job))
                return cancelled();
            const placeholder = job.placeholder ?? layerExecutionPlaceholderForAction(action);
            const existingAtStart = existingLayerMergeNode(action);
            if (existingAtStart) {
                completedLayerMergeRunsRef.current.add(key);
                if (toolRunId)
                    agentToolNodeIdsRef.current[toolRunId] = existingAtStart.id;
                if (operationId)
                    agentToolNodeIdsRef.current[operationId] = existingAtStart.id;
                const existingNodeIds = layerGroupMembers(existingAtStart.id).map((node) => node.id);
                recordImageToolCommitEvidence(operationId, { operation: "layers", nodeCommitAt: Date.now(), nodeIds: existingNodeIds.length ? existingNodeIds : [existingAtStart.id] });
                const existingVisible = await waitForCanvasNodeCommit(existingAtStart.id);
                if (existingVisible)
                    recordImageToolCommitEvidence(operationId, { nodeVisibleAt: Date.now() });
                const summary = `分层 PNG 完成：已有 ${layerGroupMembers(existingAtStart.id).length || 1} 个独立图层节点。`;
                settleDeferredImageToolResult(operationId, {
                    status: "done",
                    summary
                });
                if (placeholder)
                    removeLayerExecutionPlaceholderNodes(placeholder);
                return completed(summary);
            }
            const resolvedComposition = resolveLayerCompositionAssets({ ...cloneImageLayerComposition(composition)!, groupNumber });
            const layerRuntime = await import("./layer-composition-runtime");
            let preparedComposition: ImageLayerComposition;
            try {
                preparedComposition = await layerRuntime.prepareLayerCompositionAssets(resolvedComposition, projectId);
            }
            catch (error) {
                if (layerRuntime.isLayerCompositionPreparationError(error)) {
                    return await commitRecoverableLayerPreparationFailure(job, error);
                }
                throw error;
            }
            if (!layerMergeJobIsCurrent(job))
                return cancelled();
            const result = await composeImageLayersToDataUrl(preparedComposition);
            if (!layerMergeJobIsCurrent(job))
                return cancelled();
            if (preparedComposition.previewAsset && !regeneratesLayers) {
                const previewSource = await imageAssetCanvasSrc(preparedComposition.previewAsset);
                const hasDirectReconstruction = preparedComposition.layers.some((layer) => layer.extractionMode === "direct" || layer.extractionMode === "prepared");
                const fidelity = await compareImageSourcesVisualFidelity(previewSource, result.dataUrl);
                const fidelityFailed = hasDirectReconstruction ? fidelity.meanRgbDelta > 40 : !fidelity.ok;
                if (fidelityFailed) {
                    const reason = fidelity.meanRgbDelta > 40
                        ? `平均色差 ${fidelity.meanRgbDelta.toFixed(1)}`
                        : `结构相关度 ${fidelity.luminanceCorrelation.toFixed(2)}`;
                    throw new Error(`图层重组与合成预览差异过大（${reason}），已停止提交错误分层。`);
                }
            }
            let asset: ImageAsset = {
                index: 1,
                type: "url",
                url: result.dataUrl,
                assetUrl: result.dataUrl,
                runId: toolRunId || preparedComposition.id
            };
            if (window.aieyraConfig?.saveOutputImage) {
                const saved = await window.aieyraConfig.saveOutputImage({
                    dataUrl: result.dataUrl,
                    stem: "99-recomposed",
                    runId: toolRunId || preparedComposition.id,
                    projectId,
                    bucket: "imagegen",
                    subdir: `layers/${preparedComposition.groupNumber ? `group-${String(preparedComposition.groupNumber).padStart(3, "0")}` : preparedComposition.id}`
                });
                if (saved.ok && saved.asset)
                    asset = { ...saved.asset, index: 1, runId: toolRunId || preparedComposition.id };
            }
            const groupPreviewAsset = regeneratesLayers ? asset : preparedComposition.previewAsset;
            if (!layerMergeJobIsCurrent(job))
                return cancelled();
            const outputSize = `${result.width}x${result.height}`;
            const orderedLayers = [...preparedComposition.layers]
                .filter((layer) => Boolean(layer.asset))
                .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));
            if (orderedLayers.length !== preparedComposition.layers.length) {
                throw new Error("分层结果缺少独立 PNG 资产，已停止创建不完整图层组。");
            }
            const groupId = placeholder?.groupId || orderedLayers.find((layer) => layer.groupId)?.groupId || preparedComposition.id;
            const existingBeforeCommit = existingLayerMergeNode(action);
            if (existingBeforeCommit) {
                completedLayerMergeRunsRef.current.add(key);
                if (toolRunId)
                    agentToolNodeIdsRef.current[toolRunId] = existingBeforeCommit.id;
                if (operationId)
                    agentToolNodeIdsRef.current[operationId] = existingBeforeCommit.id;
                const existingNodeIds = layerGroupMembers(existingBeforeCommit.id).map((node) => node.id);
                recordImageToolCommitEvidence(operationId, { operation: "layers", nodeCommitAt: Date.now(), nodeIds: existingNodeIds.length ? existingNodeIds : [existingBeforeCommit.id] });
                const existingVisible = await waitForCanvasNodeCommit(existingBeforeCommit.id);
                if (existingVisible)
                    recordImageToolCommitEvidence(operationId, { nodeVisibleAt: Date.now() });
                const summary = `分层 PNG 完成：已有 ${layerGroupMembers(existingBeforeCommit.id).length || 1} 个独立图层节点。`;
                settleDeferredImageToolResult(operationId, {
                    status: "done",
                    summary
                });
                if (placeholder)
                    removeLayerExecutionPlaceholderNodes(placeholder);
                return completed(summary);
            }
            const sourceParentId = placeholder?.parentId ?? (String(action.parentId ?? action.node?.parentId ?? "").trim() || undefined);
            const parent = sourceParentId ? nodesRef.current.find((node) => node.id === sourceParentId) : undefined;
            const nodeSize = layerArtboardDisplaySize(result.width, result.height);
            const anchor = placeholder
                ? { x: placeholder.anchorX, y: placeholder.anchorY }
                : clampNodeWorldPosition(findOpenWorkflowNodePosition(nodesRef.current, {
                    parent,
                    width: nodeSize.width,
                    height: nodeSize.height,
                    preferredX: (parent?.x ?? 120) + 320,
                    preferredY: (parent?.y ?? 140) + 80
                }), nodeSize.width, nodeSize.height);
            const usedIds = new Set(nodesRef.current.map((node) => node.id));
            const makeLayerNodeId = (layerId: string, index: number) => {
                const reservedId = placeholder?.nodeIds[index];
                if (reservedId)
                    return reservedId;
                const stem = `${groupId}-${layerId || `layer-${index + 1}`}`.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").slice(0, 96) || `layer-${Date.now()}-${index + 1}`;
                let id = stem;
                let suffix = 2;
                while (usedIds.has(id))
                    id = `${stem}-${suffix++}`;
                usedIds.add(id);
                return id;
            };
            const createdAt = placeholder?.createdAt || preparedComposition.createdAt || nowLabel();
            const groupSummary = preparedComposition.summary || `已生成并重组 ${result.drawn}/${result.layerCount} 个独立 PNG 图层。`;
            const taskProvenance = sanitizeImageTaskProvenance(action.node?.taskProvenance);
            const layerNodes = orderedLayers.map((layer, index): WorkflowNode => {
                const order = Number(layer.order ?? index + 1);
                const layerDisplayCode = `L${String(groupNumber).padStart(3, "0")}-${order}`;
                const layerAsset = {
                    ...layer.asset!,
                    assetId: stableImageAssetId(layer.asset!, 1),
                    displayCode: `${layerDisplayCode}1`,
                    index: 1,
                    title: layer.title || `图层 ${order}`,
                    prompt: layer.prompt,
                    status: "done" as const
                };
                const layerGroup: ImageLayerNodeGroup = {
                    id: groupId,
                    toolRunId: toolRunId || undefined,
                    title: preparedComposition.title || action.node?.title || "分层 PNG",
                    groupNumber,
                    total: orderedLayers.length,
                    order,
                    layerId: layer.id,
                    layerTitle: layer.title || `图层 ${order}`,
                    role: layer.role || "other",
                    text: layer.text,
                    transparent: (layer.role || "other") === "background" ? false : layer.transparent !== false,
                    referenceCodes: layer.referenceCodes ? [...layer.referenceCodes] : undefined,
                    compositionWidth: preparedComposition.width,
                    compositionHeight: preparedComposition.height,
                    anchorX: anchor.x,
                    anchorY: anchor.y,
                    detached: false,
                    visible: layer.visible !== false,
                    opacity: clamp(Number(layer.opacity ?? 1), 0, 1),
                    blendMode: layer.blendMode === "multiply" || layer.blendMode === "screen" || layer.blendMode === "overlay" || layer.blendMode === "source-over" ? layer.blendMode : "normal",
                    sourceParentId,
                    previewAsset: groupPreviewAsset ? { ...groupPreviewAsset } : undefined,
                    mergedAsset: { ...asset },
                    createdAt,
                    summary: groupSummary
                };
                const isBaseLayer = index === 0;
                return {
                    id: makeLayerNodeId(layer.id, index),
                    displayCode: layerDisplayCode,
                    assetSequence: 1,
                    title: `#${String(groupNumber).padStart(3, "0")} · ${layerGroup.layerTitle}`,
                    prompt: layer.prompt || action.node?.prompt || "分层 PNG 图层",
                    type: "image",
                    status: "done",
                    x: anchor.x,
                    y: anchor.y,
                    parentId: isBaseLayer ? sourceParentId : undefined,
                    relationType: isBaseLayer && sourceParentId ? (action.node?.relationType || "derived-from") : undefined,
                    branch: "project-agent",
                    outputs: 1,
                    createdAt,
                    assets: [layerAsset],
                    imageState: "done",
                    imageParams: cloneImageTaskDraft({
                        ...(action.node?.imageParams ?? defaultImageTaskDraft(settings)),
                        prompt: layer.prompt || action.node?.imageParams?.prompt || action.node?.prompt || "分层 PNG 图层",
                        size: outputSize,
                        count: 1,
                        outputFormat: "png",
                        background: layerGroup.role === "background" || layer.transparent === false ? "opaque" : "transparent",
                        layerId: layer.id,
                        layerRole: layerGroup.role,
                        layerGroupId: groupId,
                        transparentPreferred: layerGroup.role !== "background" && layer.transparent !== false,
                        alphaStrategy: layer.alphaStrategy
                    }),
                    imageProgress: imageProgressState(1, 1, `第 ${order}/${orderedLayers.length} 层 · ${layerGroup.layerTitle}`),
                    taskProvenance: taskProvenance ? { ...taskProvenance } : undefined,
                    layerGroup,
                    width: nodeSize.width,
                    height: nodeSize.height
                };
            });
            const topLayerNode = layerNodes[layerNodes.length - 1];
            if (!layerMergeJobIsCurrent(job))
                return cancelled();
            const currentNodes = nodesRef.current;
            const duplicateAtCommit = existingLayerMergeNode(action, currentNodes);
            if (duplicateAtCommit) {
                completedLayerMergeRunsRef.current.add(key);
                if (toolRunId)
                    agentToolNodeIdsRef.current[toolRunId] = duplicateAtCommit.id;
                if (operationId)
                    agentToolNodeIdsRef.current[operationId] = duplicateAtCommit.id;
                const existingNodeIds = layerGroupMembers(duplicateAtCommit.id, currentNodes).map((node) => node.id);
                recordImageToolCommitEvidence(operationId, { operation: "layers", nodeCommitAt: Date.now(), nodeIds: existingNodeIds.length ? existingNodeIds : [duplicateAtCommit.id] });
                const duplicateVisible = await waitForCanvasNodeCommit(duplicateAtCommit.id);
                if (duplicateVisible)
                    recordImageToolCommitEvidence(operationId, { nodeVisibleAt: Date.now() });
                const summary = `分层 PNG 完成：已有 ${existingNodeIds.length || 1} 个独立图层节点。`;
                settleDeferredImageToolResult(operationId, { status: "done", summary });
                if (placeholder)
                    removeLayerExecutionPlaceholderNodes(placeholder);
                return completed(summary);
            }
            const placeholderIds = new Set(placeholder?.nodeIds ?? []);
            const placeholderNodes = new Map(currentNodes.filter((node) => placeholderIds.has(node.id)).map((node) => [node.id, node]));
            const baseZ = nextNodeZOrder(currentNodes.filter((node) => !placeholderIds.has(node.id)));
            const committedLayerNodes = layerNodes.map((node, index) => ({
                ...node,
                zOrder: placeholderNodes.get(node.id)?.zOrder ?? baseZ + index
            }));
            const committedById = new Map(committedLayerNodes.map((node) => [node.id, node]));
            const nextNodes = currentNodes.flatMap((node) => {
                if (!placeholderIds.has(node.id))
                    return [node];
                const committed = committedById.get(node.id);
                if (!committed)
                    return [];
                committedById.delete(node.id);
                return [committed];
            });
            committedById.forEach((node) => nextNodes.push(node));
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
            if (placeholder)
                releaseLayerExecutionPlaceholder(placeholder);
            recordImageToolCommitEvidence(operationId, { operation: "layers", nodeCommitAt: Date.now(), nodeIds: committedLayerNodes.map((node) => node.id) });
            completedLayerMergeRunsRef.current.add(key);
            if (toolRunId && topLayerNode)
                agentToolNodeIdsRef.current[toolRunId] = topLayerNode.id;
            if (operationId && topLayerNode)
                agentToolNodeIdsRef.current[operationId] = topLayerNode.id;
            if (topLayerNode) {
                setSelectedNodeId(topLayerNode.id);
                setActiveNodeId(topLayerNode.id);
                pendingRuntimeFocusNodeIdRef.current = topLayerNode.id;
                window.setTimeout(() => setActiveNodeId(null), 700);
                const nodeVisible = await waitForCanvasNodeCommit(topLayerNode.id);
                if (nodeVisible)
                    recordImageToolCommitEvidence(operationId, { nodeVisibleAt: Date.now() });
            }
            const summary = `分层 PNG 完成：${result.drawn}/${result.layerCount} 个独立图层节点。`;
            settleDeferredImageToolResult(operationId, {
                status: "done",
                summary,
                detail: outputSize
            });
            addEvent(`runtime 创建分层组 #${String(groupNumber).padStart(3, "0")} · ${layerNodes.length} 个独立节点`);
            return completed(summary);
        }
        catch (error) {
            if (!layerMergeJobIsCurrent(job))
                return cancelled();
            const message = friendlyImageError(error);
            failLayerExecutionPlaceholders(job.placeholder?.operationId || operationId, message);
            recordImageToolCommitEvidence(operationId, { operation: "layers", error: message });
            settleDeferredImageToolResult(operationId, {
                status: "error",
                summary: message,
                detail: "请检查源节点图片是否存在，或调整图层参数后重试。"
            });
            setServerMessage(message);
            return { operationId, status: "error", summary: message };
        }
        finally {
            if (pendingLayerMergeRunsRef.current.get(key)?.nonce === nonce)
                pendingLayerMergeRunsRef.current.delete(key);
        }
    }
    function layerGroupMembers(nodeId: string, source = nodesRef.current) {
        const target = source.find((item) => item.id === nodeId && item.layerGroup);
        if (!target?.layerGroup)
            return [];
        return source
            .filter((item) => item.layerGroup?.id === target.layerGroup?.id)
            .sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0));
    }
    function layerGroupViewMeta(node?: WorkflowNode | null) {
        return node?.layerGroup as LayerGroupViewMeta | undefined;
    }
    function layerNodeIsVisible(node?: WorkflowNode | null) {
        return layerGroupViewMeta(node)?.visible !== false;
    }
    function setLayerNodeVisibility(nodeId: string, visible: boolean) {
        const target = nodesRef.current.find((item) => item.id === nodeId && item.layerGroup);
        if (!target?.layerGroup)
            return;
        setNodes((current) => current.map((item) => item.id === nodeId && item.layerGroup
            ? {
                ...item,
                layerGroup: {
                    ...cloneImageLayerNodeGroup(item.layerGroup)!,
                    visible
                }
            }
            : item));
        addEvent(`${visible ? "显示" : "隐藏"}图层 ${target.layerGroup.layerTitle}`);
    }
    function showAllLayerGroup(nodeId: string) {
        const members = layerGroupMembers(nodeId);
        if (!members.length)
            return;
        const ids = new Set(members.map((member) => member.id));
        setNodes((current) => current.map((item) => ids.has(item.id) && item.layerGroup
            ? {
                ...item,
                layerGroup: {
                    ...cloneImageLayerNodeGroup(item.layerGroup)!,
                    visible: true
                }
            }
            : item));
        addEvent(`显示图层组 #${String(members[0].layerGroup?.groupNumber ?? 0).padStart(3, "0")} 全部图层`);
    }
    function openLayerGroupViewer(nodeId: string, mode: LayerViewerState["mode"] = "composite") {
        const members = layerGroupMembers(nodeId);
        const selected = members.find((member) => member.id === nodeId) ?? members[members.length - 1];
        if (!selected?.layerGroup)
            return;
        setCanvasMenu(null);
        setAssetContextMenu(null);
        setLayerViewer({ groupId: selected.layerGroup.id, selectedNodeId: selected.id, mode });
        setSelectedNodeId(selected.id);
        addEvent(`打开分层查看器 #${String(selected.layerGroup.groupNumber).padStart(3, "0")}`);
    }
    function compositionFromLayerNodes(members: WorkflowNode[]): ImageLayerComposition | null {
        const first = members[0];
        const group = first?.layerGroup;
        if (!group || !members.length)
            return null;
        if (members.length !== Number(group.total) ||
            members.some((member, index) => member.layerGroup?.id !== group.id ||
                Number(member.layerGroup?.order ?? 0) !== index + 1 ||
                Number(member.layerGroup?.total ?? 0) !== members.length ||
                Number(member.layerGroup?.compositionWidth ?? 0) !== Number(group.compositionWidth) ||
                Number(member.layerGroup?.compositionHeight ?? 0) !== Number(group.compositionHeight)))
            return null;
        const layers = members.map((member, index) => {
            const memberGroup = member.layerGroup!;
            return {
                id: memberGroup.layerId || `layer-${index + 1}`,
                title: memberGroup.layerTitle || member.title,
                prompt: member.imageParams?.prompt || member.prompt,
                text: memberGroup.text,
                transparent: memberGroup.role === "background" ? false : memberGroup.transparent !== false,
                referenceCodes: memberGroup.referenceCodes ? [...memberGroup.referenceCodes] : undefined,
                role: memberGroup.role || "other",
                groupId: group.id,
                order: Number(memberGroup.order ?? index + 1),
                asset: member.assets?.[0] ? { ...member.assets[0] } : undefined,
                x: 0,
                y: 0,
                homeX: 0,
                homeY: 0,
                width: group.compositionWidth,
                height: group.compositionHeight,
                scale: 1,
                opacity: clamp(Number(memberGroup.opacity ?? 1), 0, 1),
                visible: memberGroup.visible !== false,
                blendMode: memberGroup.blendMode === "multiply" || memberGroup.blendMode === "screen" || memberGroup.blendMode === "overlay" || memberGroup.blendMode === "source-over" ? memberGroup.blendMode : "normal" as const
            };
        });
        if (layers.some((layer) => !layer.asset))
            return null;
        return {
            id: `${group.id}-composition`,
            title: group.title || "分层 PNG",
            mode: "layer-stack",
            groupNumber: group.groupNumber,
            layout: "stacked",
            width: group.compositionWidth,
            height: group.compositionHeight,
            background: "transparent",
            layers,
            previewAsset: group.previewAsset ? { ...group.previewAsset } : undefined,
            mergedAsset: group.mergedAsset ? { ...group.mergedAsset } : undefined,
            createdAt: group.createdAt,
            summary: group.summary
        };
    }
    async function recomposeLayerStack(nodeId: string) {
        const target = nodesRef.current.find((node) => node.id === nodeId && node.layerGroup);
        if (!target?.layerGroup)
            return { ok: false, error: "图层组不存在。" };
        const groupId = target.layerGroup.id;
        const beforeMembers = layerGroupMembers(nodeId);
        const repairedNodes = normalizeStoredLayerGroups(nodesRef.current);
        const members = repairedNodes
            .filter((node) => node.layerGroup?.id === groupId)
            .sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0));
        const repaired = beforeMembers.length !== members.length || beforeMembers.some((member, index) => {
            const next = members[index];
            return !next || member.layerGroup?.order !== next.layerGroup?.order || member.layerGroup?.total !== next.layerGroup?.total || member.layerGroup?.compositionWidth !== next.layerGroup?.compositionWidth || member.layerGroup?.compositionHeight !== next.layerGroup?.compositionHeight;
        });
        if (repaired) {
            nodesRef.current = repairedNodes;
            setNodes(repairedNodes);
            addEvent(`修复图层组 #${String(target.layerGroup.groupNumber).padStart(3, "0")} 层序`);
        }
        if (!members.length) {
            return { ok: true, nodeId, nodeIds: [nodeId], layerCount: 1, collapsed: true, repaired: true };
        }
        const composition = compositionFromLayerNodes(members);
        if (!composition)
            return { ok: false, error: "图层组仍存在缺失或尺寸冲突，无法安全重组。" };
        const group = members[0].layerGroup!;
        setCanvasMenu(null);
        setSelectedNodeId(nodeId);
        setActiveNodeId(nodeId);
        try {
            const result = await composeImageLayersToDataUrl(composition);
            let asset: ImageAsset = {
                index: 1,
                type: "url",
                url: result.dataUrl,
                assetUrl: result.dataUrl,
                runId: `${composition.id}-manual-recompose`
            };
            if (window.aieyraConfig?.saveOutputImage) {
                const saved = await window.aieyraConfig.saveOutputImage({
                    dataUrl: result.dataUrl,
                    stem: "99-recomposed",
                    runId: `${composition.id}-manual-recompose-${Date.now()}`,
                    projectId: activeProjectIdRef.current,
                    bucket: "imagegen",
                    subdir: `layers/${composition.groupNumber ? `group-${String(composition.groupNumber).padStart(3, "0")}` : composition.id}`
                });
                if (!saved.ok || !saved.asset)
                    throw new Error(saved.error || "图层重组结果保存失败。");
                asset = { ...saved.asset, index: 1, title: "图层重组结果", status: "done" };
            }
            const memberIds = new Set(members.map((member) => member.id));
            const stackedSize = layerArtboardDisplaySize(group.compositionWidth, group.compositionHeight);
            recordLayerDetachAudit({
                action: "recompose",
                source: "recompose-layer-stack",
                nodeId,
                groupId
            });
            setNodes((current) => current.map((item) => {
                if (!memberIds.has(item.id) || !item.layerGroup)
                    return item;
                const order = Number(item.layerGroup.order ?? 1);
                const isBaseLayer = order === Math.min(...members.map((member) => Number(member.layerGroup?.order ?? 1)));
                return {
                    ...item,
                    x: group.anchorX,
                    y: group.anchorY,
                    width: stackedSize.width,
                    height: stackedSize.height,
                    status: "done",
                    imageState: "done",
                    imageError: undefined,
                    parentId: isBaseLayer ? item.layerGroup.sourceParentId : undefined,
                    relationType: isBaseLayer && item.layerGroup.sourceParentId ? (item.relationType || "derived-from") : undefined,
                    layerGroup: {
                        ...cloneImageLayerNodeGroup(item.layerGroup)!,
                        anchorX: group.anchorX,
                        anchorY: group.anchorY,
                        detached: false,
                        mergedAsset: { ...asset },
                        summary: `已按原始层序重组 ${result.drawn}/${result.layerCount} 个图层。`
                    },
                    imageProgress: imageProgressState(1, 1, `第 ${order}/${members.length} 层 · 已归位`)
                };
            }));
            addEvent(`重组图层组 #${String(composition.groupNumber ?? 0).padStart(3, "0")}`);
            window.setTimeout(() => setActiveNodeId(null), 700);
            return { ok: true, nodeId, nodeIds: members.map((member) => member.id), asset, composition, repaired };
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message };
        }
    }
    function explodeLayerStack(nodeId: string) {
        const members = layerGroupMembers(nodeId);
        if (!members.length || !members[0].layerGroup)
            return { ok: false, error: "图层组不存在。" };
        const group = members[0].layerGroup;
        const columns = Math.min(3, members.length);
        const detachedSizes = new Map(members.map((member) => [member.id, detachedLayerNodeDisplaySize(member.layerGroup!)]));
        const nodeWidth = Math.max(...[...detachedSizes.values()].map((size) => size.width));
        const nodeHeight = Math.max(...[...detachedSizes.values()].map((size) => size.height));
        const positions = new Map(members.map((member, index) => [member.id, {
                x: Math.round(group.anchorX + (index % columns) * (nodeWidth + 34)),
                y: Math.round(group.anchorY + Math.floor(index / columns) * (nodeHeight + 34))
            }]));
        setCanvasMenu(null);
        setSelectedNodeId(nodeId);
        setActiveNodeId(nodeId);
        recordLayerDetachAudit({
            action: "explode",
            source: "explode-layer-stack",
            nodeId,
            groupId: group.id
        });
        setNodes((current) => current.map((item) => {
            const position = positions.get(item.id);
            if (!position || !item.layerGroup)
                return item;
            const detachedSize = detachedSizes.get(item.id);
            return {
                ...item,
                ...position,
                width: detachedSize?.width ?? item.width,
                height: detachedSize?.height ?? item.height,
                layerGroup: { ...cloneImageLayerNodeGroup(item.layerGroup)!, detached: true }
            };
        }));
        addEvent(`展开图层组 #${String(group.groupNumber ?? 0).padStart(3, "0")}`);
        window.setTimeout(() => setActiveNodeId(null), 500);
        return { ok: true, nodeId, nodeIds: members.map((member) => member.id), layerCount: members.length };
    }
    async function mergeLayerGroupToNewNode(nodeId: string) {
        const members = layerGroupMembers(nodeId);
        const fullComposition = compositionFromLayerNodes(members);
        if (!fullComposition || !members.length)
            return { ok: false, error: "图层组不存在或存在缺失图层。" };
        const visibleIds = new Set(members.filter((member) => layerNodeIsVisible(member)).map((member) => member.id));
        const visibleComposition: ImageLayerComposition = {
            ...fullComposition,
            layers: fullComposition.layers.filter((_layer, index) => visibleIds.has(members[index]?.id))
        };
        if (!visibleComposition.layers.length) {
            setServerMessage("当前图层组没有可见图层，无法合并。");
            return { ok: false, error: "当前图层组没有可见图层。" };
        }
        setCanvasMenu(null);
        setLayerViewer(null);
        commitFileActionBusy(true);
        try {
            const result = await composeImageLayersToDataUrl(visibleComposition);
            const group = members[0].layerGroup!;
            const runId = `${group.id}-flatten-${Date.now()}`;
            let mergedAsset: ImageAsset = {
                index: 1,
                type: "url",
                url: result.dataUrl,
                assetUrl: result.dataUrl,
                runId,
                title: `${group.title || "分层作品"} · 合并图`,
                status: "done"
            };
            if (window.aieyraConfig?.saveOutputImage) {
                const saved = await window.aieyraConfig.saveOutputImage({
                    dataUrl: result.dataUrl,
                    stem: "flattened-visible-layers",
                    runId,
                    projectId: activeProjectIdRef.current,
                    bucket: "imagegen",
                    subdir: `layers/group-${String(group.groupNumber).padStart(3, "0")}`
                });
                if (!saved.ok || !saved.asset)
                    throw new Error(saved.error || "合并图片保存失败。");
                mergedAsset = { ...saved.asset, index: 1, title: `${group.title || "分层作品"} · 合并图`, status: "done" };
            }
            const source = members[0];
            const size = `${result.width}x${result.height}`;
            const nodeSize = displaySizeForImageNode(size, 1);
            const position = findOpenWorkflowNodePosition(nodesRef.current, {
                parent: source,
                width: nodeSize.width ?? NODE_W,
                height: nodeSize.height ?? NODE_RESIZE_MIN_H,
                preferredX: source.x + Number(source.width ?? NODE_W) + 70,
                preferredY: source.y
            });
            const id = allocateNodeCode(nodesRef.current);
            const mergedNode: WorkflowNode = {
                id,
                title: `${group.title || "分层作品"} · 合并`,
                prompt: `由分层组 #${String(group.groupNumber).padStart(3, "0")} 的 ${visibleComposition.layers.length}/${members.length} 个可见图层非破坏性合并。`,
                type: "image",
                status: "done",
                x: position.x,
                y: position.y,
                parentId: source.id,
                relationType: "grouped",
                branch: "project-agent",
                outputs: 1,
                createdAt: nowLabel(),
                assets: [mergedAsset],
                imageState: "done",
                imageParams: cloneImageTaskDraft({
                    ...defaultImageTaskDraft(settings),
                    prompt: `合并分层组 #${String(group.groupNumber).padStart(3, "0")}`,
                    size,
                    count: 1,
                    outputFormat: "png",
                    background: "transparent"
                }),
                imageProgress: imageProgressState(1, 1, `已合并 ${visibleComposition.layers.length}/${members.length} 个可见图层`),
                width: nodeSize.width,
                height: nodeSize.height
            };
            setNodes((current) => [...current, { ...mergedNode, zOrder: nextNodeZOrder(current) }]);
            setSelectedNodeId(id);
            setActiveNodeId(id);
            pendingRuntimeFocusNodeIdRef.current = id;
            window.setTimeout(() => setActiveNodeId(null), 700);
            addEvent(`合并图层组 #${String(group.groupNumber).padStart(3, "0")} 为新成果 ${id}`);
            notifyAgentOfManualAction("合并分层 PNG", `用户将分层组 #${String(group.groupNumber).padStart(3, "0")} 的可见图层合并为新的图片成果 ${id}，原图层组保留。`);
            return { ok: true, nodeId: id, asset: mergedAsset, drawn: result.drawn, layerCount: result.layerCount };
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message };
        }
        finally {
            commitFileActionBusy(false);
        }
    }
    function layerGroupExportBundle(nodeId: string) {
        const members = layerGroupMembers(nodeId);
        const composition = compositionFromLayerNodes(members);
        const group = members[0]?.layerGroup;
        if (!composition || !group || !members.length)
            throw new Error("图层组不存在或存在缺失图层。");
        const orders = members.map((member) => Number(member.layerGroup?.order ?? 0));
        const expectedOrders = Array.from({ length: members.length }, (_item, index) => index + 1);
        if (members.length !== Number(group.total) || new Set(orders).size !== members.length || orders.some((order, index) => order !== expectedOrders[index])) {
            throw new Error("图层组层序不完整，已停止导出以避免生成损坏文件。请先执行“图层重组”。");
        }
        const assets = members.map((member, index) => {
            const memberGroup = member.layerGroup;
            const asset = member.assets?.[0];
            if (!memberGroup || !asset)
                throw new Error(`第 ${index + 1} 个图层缺少可导出的 PNG 图片。`);
            return {
                asset: { ...asset },
                order: Number(memberGroup.order ?? index + 1),
                title: memberGroup.layerTitle || member.title || `图层 ${index + 1}`,
                role: memberGroup.role || "layer",
                visible: memberGroup.visible !== false,
                opacity: clamp(Number(memberGroup.opacity ?? 1), 0, 1),
                blendMode: memberGroup.blendMode || "normal"
            };
        });
        return {
            members,
            composition,
            group,
            assets,
            exportGroup: {
                id: group.id,
                title: group.title || "分层 PNG",
                groupNumber: group.groupNumber,
                width: group.compositionWidth,
                height: group.compositionHeight
            }
        };
    }
    async function renderLayerGroupCompositeAsset(nodeId: string, purpose: string) {
        const bundle = layerGroupExportBundle(nodeId);
        const visibleCount = bundle.composition.layers.filter((layer) => layer.visible !== false).length;
        if (!visibleCount)
            throw new Error("当前图层组没有可见图层，无法导出合成图片。");
        const result = await composeImageLayersToDataUrl(bundle.composition);
        if (!window.aieyraConfig?.saveOutputImage)
            throw new Error("项目图片库不可用，无法准备导出文件。");
        const runId = `${bundle.group.id}-${purpose}-${Date.now()}`;
        const saved = await window.aieyraConfig.saveOutputImage({
            dataUrl: result.dataUrl,
            stem: purpose,
            runId,
            projectId: activeProjectIdRef.current,
            bucket: "imagegen",
            subdir: `layers/group-${String(bundle.group.groupNumber).padStart(3, "0")}/exports`
        });
        if (!saved.ok || !saved.asset)
            throw new Error(saved.error || "合成图片写入项目图片库失败。");
        return {
            ...bundle,
            result,
            asset: {
                ...saved.asset,
                index: 1,
                title: `${bundle.group.title || "分层作品"} · 合成`,
                status: "done" as const
            }
        };
    }
    async function exportLayerGroupMergedPng(nodeId: string) {
        const bridge = window.aieyraConfig;
        if (!bridge?.saveAssetAs) {
            setServerMessage("当前版本尚未连接合成 PNG 导出服务。");
            return { ok: false, error: "合成 PNG 导出服务不可用。" };
        }
        setAssetContextMenu(null);
        commitFileActionBusy(true);
        try {
            const rendered = await renderLayerGroupCompositeAsset(nodeId, "99-visible-composite");
            const result = await bridge.saveAssetAs({
                asset: rendered.asset,
                projectId: activeProjectIdRef.current,
                suggestedName: `${rendered.group.title || "分层作品"}-合成-${String(rendered.group.groupNumber).padStart(3, "0")}.png`
            });
            if (!result.ok && !result.canceled)
                throw new Error(result.error || "合成 PNG 导出失败。");
            if (result.ok && !result.canceled && result.path) {
                setServerMessage(`已导出合成 PNG：${result.path}`);
                addEvent(`导出分层组 #${String(rendered.group.groupNumber).padStart(3, "0")} 合成 PNG`);
            }
            return result;
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message };
        }
        finally {
            commitFileActionBusy(false);
        }
    }
    async function exportLayerGroupFolder(nodeId: string) {
        const bridge = window.aieyraConfig;
        if (!bridge?.exportAssetsToFolder) {
            setServerMessage("当前版本尚未连接图层文件夹导出服务。");
            return { ok: false, error: "图层文件夹导出服务不可用。" };
        }
        setAssetContextMenu(null);
        commitFileActionBusy(true);
        try {
            const rendered = await renderLayerGroupCompositeAsset(nodeId, "99-folder-composite");
            const result = await bridge.exportAssetsToFolder({
                assets: rendered.assets,
                projectId: activeProjectIdRef.current,
                folderName: `${rendered.group.title || "分层作品"}-图层-${String(rendered.group.groupNumber).padStart(3, "0")}`,
                previewAsset: rendered.asset,
                mergedAsset: rendered.asset,
                group: rendered.exportGroup
            });
            if (!result.ok && !result.canceled)
                throw new Error(result.error || "图层文件夹导出失败。");
            if (result.ok && !result.canceled && result.path) {
                setServerMessage(`已导出 ${result.count ?? rendered.assets.length} 个图层：${result.path}`);
                addEvent(`导出分层组 #${String(rendered.group.groupNumber).padStart(3, "0")} 图层文件夹`);
            }
            return result;
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message };
        }
        finally {
            commitFileActionBusy(false);
        }
    }
    async function finalizeCutoutAction(action: AgentRuntimeAction): Promise<RuntimeActionCommitResult> {
        const toolRunId = action.toolRunId || "";
        const operationId = String(action.operationId || toolRunId).trim();
        const nodeId = await nodeIdForRuntimeToolRun(toolRunId);
        if (!nodeId) {
            return { operationId, status: "error", summary: "透明 PNG 结果没有对应的画布节点。" };
        }
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const sourceAsset = node?.assets?.[0] ?? action.node?.assets?.[0];
        if (!sourceAsset) {
            return { operationId, status: "error", summary: "透明 PNG 结果缺少可处理的图片。" };
        }
        const isCutout = node?.imageParams?.layerRole === "cutout" || action.node?.imageParams?.layerRole === "cutout";
        const operation = isCutout ? "cutout" : "transparent";
        try {
            markImageRunStarted(nodeId, Date.now());
            setNodes((current) => current.map((item) => item.id === nodeId
                ? {
                    ...item,
                    status: "working",
                    imageState: "generating",
                    imageProgress: imageProgressState(1, 0, "正在移除背景并生成透明 PNG")
                }
                : item));
            const { removeConnectedBorderBackgroundToDataUrl } = await import("./image-pixels");
            const isolated = await removeConnectedBorderBackgroundToDataUrl(sourceAsset);
            if (isolated.transparentRatio < 0.04)
                throw new Error("AI 抠图未形成可靠透明区域，已停止以避免伪透明结果。");
            if (!window.aieyraConfig?.saveOutputImage)
                throw new Error("项目图片库不可用，无法保存透明 PNG。");
            const saved = await window.aieyraConfig.saveOutputImage({
                dataUrl: isolated.dataUrl,
                stem: "cutout-transparent",
                runId: `${toolRunId || nodeId}-transparent`,
                projectId: activeProjectIdRef.current,
                bucket: "imagegen",
                subdir: isCutout ? "cutout" : "transparent"
            });
            if (!saved.ok || !saved.asset)
                throw new Error(saved.error || "透明 PNG 保存失败。");
            const asset: ImageAsset = {
                ...saved.asset,
                index: 1,
                title: "透明主体",
                prompt: sourceAsset.prompt || node?.imageParams?.prompt,
                status: "done"
            };
            setNodes((current) => current.map((item) => item.id === nodeId
                ? {
                    ...item,
                    title: item.title.replace(/^AI 抠图：?/, "透明主体："),
                    status: "done",
                    imageState: "done",
                    imageError: undefined,
                    generationRunId: undefined,
                    outputs: 1,
                    assets: [asset],
                    imageParams: item.imageParams
                        ? cloneImageTaskDraft({ ...item.imageParams, outputFormat: "png", background: "transparent", transparentPreferred: true })
                        : item.imageParams,
                    imageProgress: imageProgressState(1, 1, `透明 PNG 已完成 · 透明区域 ${Math.round(isolated.transparentRatio * 100)}%`)
                }
                : item));
            recordImageToolCommitEvidence(operationId, {
                operation,
                nodeCommitAt: Date.now(),
                nodeIds: [nodeId]
            });
            const readiness = await waitForCanvasImageCommit(nodeId);
            recordImageToolCommitEvidence(operationId, {
                expectedRendered: readiness.expectedRendered,
                ...(readiness.visible ? { nodeVisibleAt: Date.now() } : {}),
                ...(readiness.previewReady ? { previewReadyAt: Date.now() } : {}),
                settleReason: readiness.settleReason,
                visibilityTimedOut: readiness.settleReason === "visibility-timeout"
            });
            settleDeferredImageToolResult(operationId, {
                status: "done",
                summary: `透明 PNG 已完成，透明区域 ${Math.round(isolated.transparentRatio * 100)}%。`,
                detail: `${isolated.width}x${isolated.height}`
            }, {
                runId: operationId || toolRunId || nodeId,
                phase: "tool-done",
                tool: "image_gen",
                operationId,
                toolRunId: operationId,
                operation,
                input: { operation, nodeId },
                summary: `透明 PNG 已完成，透明区域 ${Math.round(isolated.transparentRatio * 100)}%。`,
                detail: `${isolated.width}x${isolated.height}`
            });
            addEvent(`完成透明 PNG ${nodeId}`);
            return {
                operationId,
                status: "done",
                summary: `透明 PNG 已完成，透明区域 ${Math.round(isolated.transparentRatio * 100)}%。`
            };
        }
        catch (error) {
            const message = friendlyImageError(error);
            recordImageToolCommitEvidence(operationId, { operation, error: message });
            setNodes((current) => current.map((item) => item.id === nodeId
                ? { ...item, status: "review", imageState: "error", imageError: message, generationRunId: undefined }
                : item));
            settleDeferredImageToolResult(operationId, { status: "error", summary: message }, {
                runId: operationId || toolRunId || nodeId,
                phase: "tool-error",
                tool: "image_gen",
                operationId,
                toolRunId: operationId,
                operation,
                input: { operation, nodeId },
                summary: message
            });
            setServerMessage(message);
            return { operationId, status: "error", summary: message };
        }
        finally {
            markImageRunFinished(nodeId);
        }
    }
    async function applyRuntimeActions(actions: AgentRuntimeAction[]): Promise<RuntimeActionApplicationResult> {
        for (const action of actions.filter((item) => item.type === "workflow.requirement.prepare")) {
            const identity = action.operationId || action.toolRunId;
            const preparedId = identity ? agentToolNodeIdsRef.current[identity] : undefined;
            if (preparedId && nodesRef.current.some((node) => node.id === preparedId))
                continue;
            const prepared = createConnectedRequirement(action);
            if (identity && prepared)
                agentToolNodeIdsRef.current[identity] = prepared.anchorId;
        }
        actions = actions.filter((action) => action.type !== "workflow.requirement.prepare");
        if (actions.length === 0)
            return { commits: [] };
        const initialRuntimeParentContextId = selectedNodeIdRef.current || selectedNode?.id || "";
        const layerMergeJobs: LayerMergeRuntimeJob[] = [];
        const layerCommitPromises: Promise<RuntimeActionCommitResult>[] = [];
        const cutoutCommitPromises: Promise<RuntimeActionCommitResult>[] = [];
        for (const action of actions) {
            if (action.type === "workflow.canvas.clear") {
                cancelTransientCanvasInteractions();
                releaseAllLayerExecutionPlaceholders();
                layerRuntimeScopeEpochRef.current += 1;
                pendingLayerMergeRunsRef.current.clear();
                layerMergeCommitPromisesRef.current.clear();
                completedLayerMergeRunsRef.current.clear();
                pendingImageToolResultsRef.current.clear();
                pendingImageToolSettlementsRef.current.clear();
                completedLocalToolOperationsRef.current.clear();
                renderedLocalToolOperationsRef.current.clear();
                imageToolCommitEvidenceRef.current.clear();
                pendingLayerNarrationRunIdsRef.current.clear();
                imageRunStartsRef.current = {};
                setImageRunStarts({});
                continue;
            }
            if (action.type === "workflow.layer.placeholders") {
                ensureLayerExecutionPlaceholders(action);
                continue;
            }
            if (action.type !== "workflow.layer.group" && action.type !== "workflow.layer.merge")
                continue;
            const composition = action.composition ?? action.node?.layerComposition;
            if (!composition)
                continue;
            const projectId = activeProjectIdRef.current;
            const placeholder = layerExecutionPlaceholderForAction(action);
            const key = layerMergeRuntimeKey(action, projectId);
            const knownCommit = layerMergeCommitPromisesRef.current.get(key);
            if (knownCommit) {
                layerCommitPromises.push(knownCommit);
                continue;
            }
            const existing = existingLayerMergeNode(action);
            if (existing) {
                completedLayerMergeRunsRef.current.add(key);
                if (action.toolRunId)
                    agentToolNodeIdsRef.current[action.toolRunId] = existing.id;
                const operationId = String(action.operationId || action.toolRunId || "").trim();
                if (operationId)
                    agentToolNodeIdsRef.current[operationId] = existing.id;
                const existingCount = layerGroupMembers(existing.id).length || 1;
                const commit = Promise.resolve<RuntimeActionCommitResult>({
                    operationId,
                    status: "done",
                    summary: `分层 PNG 完成：已有 ${existingCount} 个独立图层节点。`
                });
                layerMergeCommitPromisesRef.current.set(key, commit);
                trimIdentityMap(layerMergeCommitPromisesRef.current, 48);
                layerCommitPromises.push(commit);
                continue;
            }
            if (pendingLayerMergeRunsRef.current.has(key) || completedLayerMergeRunsRef.current.has(key)) {
                layerCommitPromises.push(Promise.resolve({
                    operationId: String(action.operationId || action.toolRunId || "").trim(),
                    status: "cancelled",
                    summary: "分层提交状态已失效。"
                }));
                continue;
            }
            const scopeEpoch = layerRuntimeScopeEpochRef.current;
            const reservedNumbers = [...pendingLayerMergeRunsRef.current.values()]
                .filter((entry) => entry.projectId === projectId && entry.scopeEpoch === scopeEpoch)
                .map((entry) => entry.groupNumber);
            const nextGroupNumber = Math.max(0, ...nodesRef.current.map((node) => Number(node.layerGroup?.groupNumber ?? node.layerComposition?.groupNumber ?? 0)).filter(Number.isFinite), ...reservedNumbers) + 1;
            const usedGroupNumbers = new Set([
                ...nodesRef.current.map((node) => Number(node.layerGroup?.groupNumber ?? node.layerComposition?.groupNumber ?? 0)).filter((value) => Number.isFinite(value) && value > 0),
                ...reservedNumbers
            ]);
            const requestedGroupNumber = Number(composition.groupNumber || 0);
            const groupNumber = placeholder?.groupNumber ?? (requestedGroupNumber > 0 && !usedGroupNumbers.has(requestedGroupNumber)
                ? requestedGroupNumber
                : nextGroupNumber);
            const groupId = placeholder?.groupId || layerMergeGroupId(action);
            const nonce = ++layerMergeNonceRef.current;
            const job: LayerMergeRuntimeJob = { action, key, nonce, projectId, scopeEpoch, groupId, groupNumber, placeholder };
            pendingLayerMergeRunsRef.current.set(key, { nonce, projectId, scopeEpoch, groupId, groupNumber });
            layerMergeJobs.push(job);
        }
        const cutoutJobs = actions.filter((action) => action.type === "workflow.node.create" &&
            (action.node?.imageParams?.layerRole === "cutout" ||
                (action.node?.imageParams?.alphaStrategy === "local-alpha-extraction" &&
                    !action.node?.imageParams?.layerGroupId)) &&
            (action.node.assets?.length ?? 0) > 0);
        const deferredNodeJobs = actions.filter((action) => action.type === "workflow.node.continue" ||
            action.type === "workflow.node.redraw" ||
            action.type === "workflow.node.cutout");
        setNodes((current) => {
            let next = [...current];
            let runtimeParentContextId = initialRuntimeParentContextId;
            for (const action of actions) {
                if (action.type === "workflow.canvas.clear") {
                    next = [];
                    layoutGroupsRef.current = [];
                    setLayoutGroups([]);
                    runtimeParentContextId = "";
                    agentToolNodeIdsRef.current = {};
                    agentToolNodeCodesRef.current = {};
                    selectCanvas();
                    setActiveNodeId(null);
                    setCanvasMenu(null);
                    addEvent("runtime 清理画布");
                    continue;
                }
                if (action.type === "workflow.layer.placeholders" || action.type === "workflow.layer.group" || action.type === "workflow.layer.merge") {
                    continue;
                }
                if (action.type === "workflow.node.create" && action.node) {
                    const existingId = action.toolRunId ? agentToolNodeIdsRef.current[action.toolRunId] : "";
                    const existingNode = existingId ? next.find((node) => node.id === existingId) : undefined;
                    const reservedExistingId = existingId && !next.some((node) => node.id === existingId) ? existingId : "";
                    const requestedNodeId = String(action.node.id || "").trim();
                    const requestedSequence = nodeSequenceFromCode(requestedNodeId);
                    const canUseRequestedId = Boolean(requestedNodeId &&
                        !next.some((node) => node.id === requestedNodeId) &&
                        !(requestedSequence > 0 && requestedSequence <= nodeSequenceRef.current));
                    let allocatedCode = "";
                    const id = existingNode?.id ?? (reservedExistingId || (canUseRequestedId ? requestedNodeId : (allocatedCode = allocateNodeCode(next))));
                    const displayCode = existingNode?.displayCode || agentToolNodeCodesRef.current[id] || allocatedCode || (requestedSequence > 0 && requestedNodeId === id
                        ? requestedNodeId
                        : allocateNodeCode(next));
                    observeAllocatedNodeCode(displayCode);
                    agentToolNodeCodesRef.current[id] = displayCode;
                    const hasExplicitParent = Object.prototype.hasOwnProperty.call(action.node, "parentId");
                    const requestedParent = hasExplicitParent ? String(action.node.parentId || "") : "";
                    const selectedParent = runtimeParentContextId ? next.find((node) => node.id === runtimeParentContextId) : undefined;
                    const parent = hasExplicitParent
                        ? requestedParent
                            ? next.find((node) => node.id === requestedParent)
                            : undefined
                        : selectedParent;
                    const nextParentId = parent?.id && parent.id !== id ? parent.id : undefined;
                    const assets = imageAssetsWithIdentity(Array.isArray(action.node.assets) ? action.node.assets : [], displayCode);
                    const imageState = action.node.imageState ?? (assets.length > 0 ? "done" : undefined);
                    const nodeType = action.node.nodeType ?? "intent";
                    if (nodeType !== "image") {
                        addEvent(`runtime 忽略非图片成果创建请求 ${nodeType}`);
                        continue;
                    }
                    const effectiveParent = parent;
                    const effectiveParentId = effectiveParent?.id && effectiveParent.id !== id ? effectiveParent.id : undefined;
                    const imageParams = nodeType === "image" && action.node.imageParams ? cloneImageTaskDraft(action.node.imageParams) : undefined;
                    const incomingLayerComposition = action.node.layerComposition ? cloneImageLayerComposition(action.node.layerComposition) : existingNode?.layerComposition;
                    const layerComposition = incomingLayerComposition
                        ? (() => {
                            const groupNumber = incomingLayerComposition.groupNumber ?? Math.max(0, ...next.map((node) => Number(node.layerComposition?.groupNumber ?? 0)).filter(Number.isFinite)) + 1;
                            return {
                                ...incomingLayerComposition,
                                groupNumber,
                                layout: incomingLayerComposition.layout === "exploded" ? "exploded" as const : "stacked" as const,
                                layers: incomingLayerComposition.layers.map((layer, index) => ({
                                    ...layer,
                                    groupId: layer.groupId || incomingLayerComposition.id,
                                    order: Number(layer.order ?? index + 1),
                                    x: Number(layer.x ?? 0),
                                    y: Number(layer.y ?? 0),
                                    homeX: Number(layer.homeX ?? layer.x ?? 0),
                                    homeY: Number(layer.homeY ?? layer.y ?? 0)
                                }))
                            };
                        })()
                        : undefined;
                    const incomingContainerSpec = sanitizeImageContainerSpec(action.node.imageContainerSpec, id, action.node.imageCollection, assets);
                    const imageCollection = action.node.imageCollection
                        ? cloneImageCollection(action.node.imageCollection)
                        : incomingContainerSpec?.collection
                            ? cloneImageCollection(incomingContainerSpec.collection)
                            : existingNode?.imageCollection;
                    const taskProvenance = sanitizeImageTaskProvenance(action.node.taskProvenance) ?? existingNode?.taskProvenance;
                    const total = Math.max(action.node.imageProgress?.total ?? imageParams?.count ?? assets.length ?? 1, 1);
                    const completed = clamp(action.node.imageProgress?.completed ?? assets.length, 0, total);
                    const failedSlots = Array.isArray(action.node.imageProgress?.failedSlots)
                        ? action.node.imageProgress.failedSlots.map((slot) => clamp(Number(slot), 1, total)).filter((slot, index, items) => Number.isFinite(slot) && items.indexOf(slot) === index)
                        : [];
                    const failed = clamp(Number(action.node.imageProgress?.failed ?? failedSlots.length ?? 0), 0, total);
                    const imageError = typeof action.node.imageError === "string" && action.node.imageError.trim() ? friendlyImageError(action.node.imageError) : undefined;
                    const imageSize = imageParams?.size ||
                        (layerComposition ? `${layerComposition.width}x${layerComposition.height}` : "") ||
                        promptMetaValue(action.node.prompt ?? "", "size") ||
                        settings.imageSize ||
                        "1024x1024";
                    const resetBatchPlaceholderSize = Boolean(existingNode &&
                        nodeType === "image" &&
                        imageState !== "generating" &&
                        assets.length === 1 &&
                        Number(existingNode.imageParams?.count ?? existingNode.imageProgress?.total ?? 1) > 1 &&
                        Number(imageParams?.count ?? total) === 1);
                    const nodeSize = nodeType !== "image"
                        ? {}
                        : imageCollection
                            ? imageCollection.kind === "series"
                                ? {
                                    width: existingNode?.width ?? IMAGE_COLLECTION_W,
                                    height: existingNode?.height ?? IMAGE_COLLECTION_SERIES_H
                                }
                                : (() => {
                                    const preferred = displaySizeForImageNode(imageSize, total, assets);
                                    const autoFit = imageCollection.autoFit !== false;
                                    return clampImageNodeDimensions(imageSize, total, autoFit ? preferred.width : existingNode?.width ?? preferred.width, autoFit ? preferred.height : existingNode?.height ?? preferred.height, assets);
                                })()
                            : layerComposition
                                ? { width: existingNode?.width ?? LAYER_STACK_W, height: existingNode?.height ?? LAYER_STACK_H }
                                : clampImageNodeDimensions(imageSize, total, resetBatchPlaceholderSize ? displaySizeForImageNode(imageSize, total, assets).width : existingNode?.width ?? displaySizeForImageNode(imageSize, total, assets).width, resetBatchPlaceholderSize ? displaySizeForImageNode(imageSize, total, assets).height : existingNode?.height ?? displaySizeForImageNode(imageSize, total, assets).height, assets);
                    const progressMessage = action.node.imageProgress?.message ??
                        (imageState === "generating"
                            ? total > 1
                                ? `Agent 并行生成中，已完成 ${completed}/${total} 张${failed ? `，失败 ${failed} 张` : ""}`
                                : "Agent 正在生成"
                            : imageState === "error"
                                ? imageError || "生图失败，已停止。可手动重试。"
                                : assets.length
                                    ? "Agent 生成完成"
                                    : "无图片结果");
                    const imageProgress = action.node.imageProgress;
                    const explicitX = Number(action.node.x);
                    const explicitY = Number(action.node.y);
                    const hasExplicitX = action.node.x !== undefined && Number.isFinite(explicitX);
                    const hasExplicitY = action.node.y !== undefined && Number.isFinite(explicitY);
                    const fallbackX = existingNode?.x ?? (effectiveParent?.x ?? 120) + 300;
                    const fallbackY = existingNode?.y ?? (effectiveParent?.y ?? 160) + 110;
                    const placementWidth = "width" in nodeSize && typeof nodeSize.width === "number" ? nodeSize.width : NODE_W;
                    const placementHeight = "height" in nodeSize && typeof nodeSize.height === "number" ? nodeSize.height : NODE_RESIZE_MIN_H;
                    const autoPosition = !existingNode && !hasExplicitX && !hasExplicitY
                        ? findOpenWorkflowNodePosition(next, {
                            parent: effectiveParent ?? undefined,
                            width: placementWidth,
                            height: placementHeight,
                            preferredX: fallbackX,
                            preferredY: fallbackY
                        })
                        : null;
                    const nodeBase: WorkflowNode = {
                        id,
                        displayCode,
                        assetSequence: imageAssetSequence(assets, displayCode),
                        title: action.node.title?.trim() || "Agent 成果",
                        prompt: action.node.prompt?.trim() || "项目 Agent 生成的成果。",
                        type: nodeType,
                        status: action.node.status ?? (imageState === "done" ? "done" : imageState === "generating" ? "working" : "review"),
                        x: hasExplicitX ? explicitX : autoPosition?.x ?? fallbackX,
                        y: hasExplicitY ? explicitY : autoPosition?.y ?? fallbackY,
                        parentId: existingNode?.parentId ?? effectiveParentId ?? nextParentId,
                        relationType: existingNode?.relationType ?? (effectiveParentId || nextParentId
                            ? action.node.relationType === "referenced" || action.node.relationType === "variant" || action.node.relationType === "grouped"
                                ? action.node.relationType
                                : "derived-from"
                            : undefined),
                        branch: "project-agent",
                        outputs: Number(action.node.outputs ?? assets.length ?? 0),
                        createdAt: existingNode?.createdAt ?? nowLabel(),
                        assets,
                        imageState,
                        imageError,
                        imageParams,
                        layerComposition,
                        imageContainerSpec: incomingContainerSpec ?? cloneImageContainerSpec(existingNode?.imageContainerSpec),
                        imageCollection,
                        taskProvenance: taskProvenance ? { ...taskProvenance } : undefined,
                        imageProgress: nodeType === "image" ? {
                            total,
                            completed,
                            failed,
                            failedSlots,
                            activeIndex: imageProgress?.activeIndex,
                            retryCount: imageProgress?.retryCount ?? 0,
                            maxRetries: imageProgress?.maxRetries ?? 0,
                            stopped: imageProgress?.stopped ?? imageState === "error",
                            message: progressMessage
                        } : undefined,
                        generationRunId: imageState === "generating"
                            ? existingNode?.generationRunId || String(action.operationId || action.toolRunId || "").trim() || undefined
                            : undefined,
                        zOrder: existingNode?.zOrder ?? nextNodeZOrder(next),
                        ...nodeSize
                    };
                    const node = imageCollection
                        ? withNodeImageCollection(nodeBase, imageCollection)
                        : applyImageContainerCompatibility(nodeBase);
                    next = existingNode ? next.map((item) => (item.id === id ? { ...item, ...node } : item)) : [...next, node];
                    if (action.toolRunId)
                        agentToolNodeIdsRef.current[action.toolRunId] = id;
                    if (action.operationId)
                        agentToolNodeIdsRef.current[action.operationId] = id;
                    const imageOperationId = String(action.operationId || action.toolRunId || "").trim();
                    if (imageOperationId && imageState !== "generating") {
                        recordImageToolCommitEvidence(imageOperationId, {
                            nodeCommitAt: Date.now(),
                            nodeIds: [id]
                        });
                    }
                    const hasLiveSelection = selectedNodeIdsRef.current.some((selectedId) => next.some((item) => item.id === selectedId));
                    if (!hasLiveSelection)
                        setSelectedNodeId(id);
                    setActiveNodeId(id);
                    pendingRuntimeFocusNodeIdRef.current = id;
                    if (imageState === "generating")
                        markImageRunStarted(id, Date.now());
                    if (imageState !== "generating")
                        markImageRunFinished(id);
                    addEvent(existingNode ? `runtime 更新节点 ${id}` : `runtime 创建节点 ${id}`);
                    continue;
                }
                if (action.type === "workflow.node.update" && action.patch?.id) {
                    next = next.map((node) => {
                        if (node.id !== action.patch?.id)
                            return node;
                        const updated = { ...node, ...action.patch };
                        return updated.imageCollection
                            ? withNodeImageCollection(updated, updated.imageCollection)
                            : applyImageContainerCompatibility(updated);
                    });
                    addEvent(`runtime 更新节点 ${action.patch.id}`);
                    continue;
                }
                if (action.type === "workflow.node.delete" && action.id) {
                    const mode = action.mode === "branch" ? "branch" : "only";
                    const descendants = collectDescendantIds(next, action.id);
                    const removeIds = mode === "branch" ? new Set([action.id, ...descendants]) : new Set([action.id]);
                    const sourceBeforeRemoval = next;
                    const detached = next
                        .map((node) => ({
                        ...node,
                        ...(mode === "only" && node.parentId === action.id ? { parentId: undefined, relationType: undefined } : {})
                    }));
                    const layerNormalized = normalizeLayerGroupsAfterRemoval(detached, removeIds);
                    const layoutNormalized = normalizeImageLayoutsAfterRemoval(sourceBeforeRemoval, layerNormalized, layoutGroupsRef.current, removeIds);
                    next = layoutNormalized.nodes;
                    layoutGroupsRef.current = layoutNormalized.groups;
                    setLayoutGroups(layoutNormalized.groups);
                    removeNodeIdsFromSelection(removeIds);
                    addEvent(mode === "branch" ? `runtime 删除成果 ${action.id} 及衍生结果 ${descendants.size} 个` : `runtime 删除成果 ${action.id}`);
                    continue;
                }
                if (action.type === "workflow.node.connect" && action.sourceId && action.targetId) {
                    if (action.sourceId === action.targetId) {
                        addEvent("runtime 忽略自连接");
                        continue;
                    }
                    const descendants = collectDescendantIds(next, action.targetId);
                    const sourceExists = next.some((node) => node.id === action.sourceId);
                    const targetExists = next.some((node) => node.id === action.targetId);
                    if (!sourceExists || !targetExists || descendants.has(action.sourceId)) {
                        addEvent(`runtime 连接失败 ${action.sourceId} -> ${action.targetId}`);
                        continue;
                    }
                    const relationType = action.relationType === "referenced" || action.relationType === "variant" || action.relationType === "grouped"
                        ? action.relationType
                        : "derived-from";
                    next = next.map((node) => (node.id === action.targetId ? { ...preserveImageOrigins(node, next), parentId: action.sourceId, relationType } : node));
                    setSelectedNodeId(action.targetId);
                    setActiveNodeId(action.targetId);
                    addEvent(`runtime 连线 ${action.sourceId} -> ${action.targetId}`);
                    continue;
                }
                if (action.type === "workflow.node.disconnect" && action.id) {
                    const direction = action.direction ?? "input";
                    let changed = 0;
                    next = next.map((node) => {
                        if ((direction === "input" || direction === "both") && node.id === action.id && node.parentId) {
                            changed += 1;
                            return { ...preserveImageOrigins(node, next), parentId: undefined, relationType: undefined };
                        }
                        if ((direction === "output" || direction === "both") && node.parentId === action.id) {
                            changed += 1;
                            return { ...preserveImageOrigins(node, next), parentId: undefined, relationType: undefined };
                        }
                        return node;
                    });
                    setSelectedNodeId(action.id);
                    setActiveNodeId(action.id);
                    addEvent(changed ? `runtime 断开节点 ${action.id} 连线 ${changed} 条` : `runtime 未找到可断开的节点连线 ${action.id}`);
                    continue;
                }
                if (action.type === "workflow.node.focus" && action.id) {
                    const target = next.find((node) => node.id === action.id);
                    if (target) {
                        setSelectedNodeId(target.id);
                        setActiveNodeId(target.id);
                        setViewport((current) => ({ ...current, x: Math.round(420 - target.x * current.scale), y: Math.round(260 - target.y * current.scale) }));
                        addEvent(`runtime 定位节点 ${target.id}`);
                    }
                    continue;
                }
                if (action.type === "workflow.node.continue" && action.id) {
                    const actionId = action.id;
                    if (action.prompt) {
                        const actionPrompt = action.prompt;
                        next = next.map((node) => node.id === actionId && node.type === "image"
                            ? {
                                ...node,
                                prompt: `${node.prompt}\n\ncontinue: ${actionPrompt}`,
                                imageParams: node.imageParams ? cloneImageTaskDraft({ ...node.imageParams, prompt: actionPrompt }) : node.imageParams
                            }
                            : node);
                    }
                    setSelectedNodeId(actionId);
                    setActiveNodeId(actionId);
                    pendingRuntimeFocusNodeIdRef.current = actionId;
                    addEvent(`runtime 准备基于节点 ${actionId} 继续生图`);
                    continue;
                }
                if ((action.type === "workflow.node.redraw" || action.type === "workflow.node.cutout") && action.id) {
                    setSelectedNodeId(action.id);
                    setActiveNodeId(action.id);
                    pendingRuntimeFocusNodeIdRef.current = action.id;
                    addEvent(`runtime 准备基于节点 ${action.id} ${action.type === "workflow.node.cutout" ? "抠图" : "重绘"}`);
                    continue;
                }
                if (action.type === "workflow.node.rollback" && action.id) {
                    const descendants = collectDescendantIds(next, action.id);
                    next = next.map((node) => node.id === action.id
                        ? { ...node, status: "review" }
                        : descendants.has(node.id)
                            ? { ...node, status: "queued" }
                            : node);
                    setSelectedNodeId(action.id);
                    pendingRuntimeFocusNodeIdRef.current = action.id;
                    addEvent(`runtime 回退到节点 ${action.id}`);
                }
                if (action.type === "ui.ask_user.open" && action.request) {
                    setAskUserMinimized(false);
                    setAskUserDraft({
                        requestId: action.request.requestId || action.operationId || action.toolRunId || "",
                        kind: action.request.kind === "confirm" ? "confirm" : "clarify",
                        title: action.request.title || "需要你确认",
                        question: action.request.question || "请补充信息。",
                        detail: action.request.detail,
                        suggestedAnswer: action.request.suggestedAnswer,
                        options: sanitizeAgentAskUserOptions(action.request.options)
                    });
                    addEvent("runtime 请求用户确认");
                    continue;
                }
                if ((action.type === "ui.source_images.open" || action.type === "ui.reference_images.open") && action.request) {
                    const role: AssetTaskRole = action.type === "ui.source_images.open" ? "source" : "reference";
                    openReferencePicker({
                        kind: "agent-request",
                        requestId: action.request.requestId || action.operationId || action.toolRunId || "",
                        role,
                        question: action.request.question || (role === "source" ? "请添加需要处理的原图。" : "请添加参考图。"),
                        suggestedAnswer: action.request.suggestedAnswer
                    }, role === "source" ? agentSourceImagesRef.current : agentReferenceImagesRef.current, {
                        title: action.request.title || (role === "source" ? "Agent 需要原图" : "Agent 需要参考图"),
                        detail: action.request.detail || action.request.question,
                        max: role === "source"
                            ? action.request.maxSourceImages ?? MAX_AGENT_SOURCE_IMAGES
                            : action.request.maxReferenceImages ?? MAX_REFERENCE_IMAGES
                    });
                    addEvent(role === "source" ? "runtime 请求原图" : "runtime 请求参考图");
                    continue;
                }
            }
            return preserveImageOriginsForNodes(next);
        });
        for (const action of layerMergeJobs) {
            const commit = new Promise<RuntimeActionCommitResult>((resolve) => {
                window.setTimeout(() => {
                    void finalizeLayerMergeAction(action).then(resolve, (error) => {
                        const summary = friendlyImageError(error);
                        resolve({
                            operationId: String(action.action.operationId || action.action.toolRunId || "").trim(),
                            status: "error",
                            summary
                        });
                    });
                }, 0);
            });
            layerMergeCommitPromisesRef.current.set(action.key, commit);
            trimIdentityMap(layerMergeCommitPromisesRef.current, 48);
            layerCommitPromises.push(commit);
        }
        for (const action of cutoutJobs) {
            cutoutCommitPromises.push(new Promise<RuntimeActionCommitResult>((resolve) => {
                window.setTimeout(() => {
                    void finalizeCutoutAction(action).then(resolve, (error) => {
                        resolve({
                            operationId: String(action.operationId || action.toolRunId || "").trim(),
                            status: "error",
                            summary: friendlyImageError(error)
                        });
                    });
                }, 0);
            }));
        }
        for (const action of deferredNodeJobs) {
            window.setTimeout(() => {
                const target = action.id ? nodesRef.current.find((node) => node.id === action.id) : null;
                if (!target || target.type !== "image")
                    return;
                if (action.type === "workflow.node.continue") {
                    continueImageNodeRun(target);
                    return;
                }
                if (action.type === "workflow.node.redraw") {
                    openRegionRedraw(target, Math.max(0, Number(action.assetIndex ?? 0)), String(action.prompt || ""), true);
                    return;
                }
                if (action.type === "workflow.node.cutout") {
                    openAICutout(target, Math.max(0, Number(action.assetIndex ?? 0)), true);
                }
            }, 0);
        }
        window.setTimeout(() => setActiveNodeId(null), 900);
        const commitPromises = [...layerCommitPromises, ...cutoutCommitPromises];
        const commits = commitPromises.length ? await Promise.all(commitPromises) : [];
        return { commits };
    }
    useEffect(() => {
        runtimeActionHandlerRef.current = applyRuntimeActions;
    });
    function cancelTransientCanvasInteractions() {
        clearMergeHover();
        const drag = dragRef.current;
        drag?.releaseListeners?.();
        if (drag) {
            try {
                drag.captureElement?.releasePointerCapture(drag.pointerId);
            }
            catch { }
            if (drag.selectionStart)
                applyTransientNodePositions(drag.selectionStart, drag.transientEdges);
            else if (drag.layerGroupStart)
                applyTransientNodePositions(drag.layerGroupStart, drag.transientEdges);
            else
                applyTransientNodePosition(drag.id, drag.nodeX, drag.nodeY, drag.nodeElement, drag.transientEdges);
        }
        if (dragRef.current?.frame)
            window.cancelAnimationFrame(dragRef.current.frame);
        if (dragRef.current?.nodeElement) {
            dragRef.current.nodeElement.classList.remove("dragging");
            dragRef.current.nodeElement.style.zIndex = dragRef.current.originalZIndex ?? "";
            dragRef.current.nodeElement.style.willChange = dragRef.current.originalWillChange ?? "";
        }
        if (layerDragRef.current?.frame)
            window.cancelAnimationFrame(layerDragRef.current.frame);
        dragRef.current = null;
        layerDragRef.current = null;
        internalAssetDragRef.current = null;
        nativeAssetDropTraceRef.current = null;
        lastNodeDragEndRef.current = null;
        setAssetDropTargetId("");
        setDraggingNodeId("");
        setResizingNodeId("");
        setConnectionDraft(null);
    }
    function beginLayerDrag(event: React.PointerEvent<HTMLElement>, node: WorkflowNode, layerId: string) {
        if (event.button !== 0 || !node.layerComposition)
            return;
        event.preventDefault();
        event.stopPropagation();
        const workbench = event.currentTarget.closest<HTMLElement>(".node-layer-stack-workbench");
        const preview = workbench?.querySelector<HTMLElement>(".node-layer-canvas");
        const rect = preview?.getBoundingClientRect();
        if (!rect || rect.width <= 1 || rect.height <= 1)
            return;
        const layer = node.layerComposition.layers.find((item) => item.id === layerId);
        if (!layer)
            return;
        setActiveLayerSurface({ nodeId: node.id, layerId });
        layerDragRef.current = {
            nodeId: node.id,
            layerId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            layerX: Number(layer.x ?? 0),
            layerY: Number(layer.y ?? 0),
            compositionWidth: node.layerComposition.width,
            compositionHeight: node.layerComposition.height,
            previewWidth: rect.width,
            previewHeight: rect.height,
            moved: false
        };
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        catch {
        }
    }
    function moveLayerDrag(event: React.PointerEvent<HTMLElement>) {
        const drag = layerDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        event.stopPropagation();
        const dx = (event.clientX - drag.startX) / Math.max(1, drag.previewWidth) * drag.compositionWidth;
        const dy = (event.clientY - drag.startY) / Math.max(1, drag.previewHeight) * drag.compositionHeight;
        if (Math.abs(dx) + Math.abs(dy) > 2)
            drag.moved = true;
        drag.pendingX = Math.round(drag.layerX + dx);
        drag.pendingY = Math.round(drag.layerY + dy);
        if (drag.frame)
            return;
        drag.frame = window.requestAnimationFrame(() => {
            const current = layerDragRef.current;
            if (!current)
                return;
            current.frame = undefined;
            if (current.pendingX === undefined || current.pendingY === undefined)
                return;
            const x = current.pendingX;
            const y = current.pendingY;
            setNodes((nodes) => nodes.map((item) => item.id === current.nodeId && item.layerComposition
                ? {
                    ...item,
                    layerComposition: {
                        ...cloneImageLayerComposition(item.layerComposition)!,
                        layout: "exploded",
                        layers: item.layerComposition.layers.map((layer) => layer.id === current.layerId ? { ...layer, x, y } : { ...layer })
                    }
                }
                : item));
        });
    }
    function endLayerDrag(event: React.PointerEvent<HTMLElement>) {
        const drag = layerDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        event.stopPropagation();
        if (drag.frame)
            window.cancelAnimationFrame(drag.frame);
        if (drag.pendingX !== undefined && drag.pendingY !== undefined) {
            const x = drag.pendingX;
            const y = drag.pendingY;
            setNodes((nodes) => nodes.map((item) => item.id === drag.nodeId && item.layerComposition
                ? {
                    ...item,
                    layerComposition: {
                        ...cloneImageLayerComposition(item.layerComposition)!,
                        layout: drag.moved ? "exploded" : item.layerComposition.layout,
                        layers: item.layerComposition.layers.map((layer) => layer.id === drag.layerId ? { ...layer, x, y } : { ...layer })
                    }
                }
                : item));
        }
        if (drag.moved)
            addEvent(`移动图层 ${drag.layerId}`);
        layerDragRef.current = null;
    }
    function clearMergeHover() {
        const hover = mergeHoverRef.current;
        window.clearTimeout(hover.timer);
        hover.element?.classList.remove("asset-merge-pending", "asset-drop-target");
        mergeHoverRef.current = { intent: null, timer: 0, owner: null, element: null };
        if (dragRef.current)
            dragRef.current.dropTargetId = "";
        setAssetDropTargetId("");
    }
    function updateMergeHover(targetId: string, x: number, y: number, owner: object) {
        const previous = mergeHoverRef.current;
        const intent = updateDragMergeIntent(previous.owner === owner ? previous.intent : null, targetId, x, y, performance.now());
        if (intent === previous.intent && previous.owner === owner)
            return;
        clearMergeHover();
        if (!intent)
            return;
        const element = document.querySelector<HTMLElement>(`.flow-node[data-node-id="${CSS.escape(targetId)}"]`);
        element?.classList.add("asset-merge-pending");
        const hover = { intent, timer: 0, owner, element };
        mergeHoverRef.current = hover;
        hover.timer = window.setTimeout(() => {
            if (mergeHoverRef.current !== hover || (dragRef.current !== owner && internalAssetDragRef.current !== owner) || !element?.isConnected)
                return;
            element.classList.remove("asset-merge-pending");
            element.classList.add("asset-drop-target");
            if (dragRef.current === owner)
                dragRef.current.dropTargetId = targetId;
            setAssetDropTargetId(targetId);
        }, DRAG_MERGE_HOLD_MS);
    }
    function readyMergeTarget(targetId: string, x: number, y: number, owner: object) {
        const hover = mergeHoverRef.current;
        const intent = updateDragMergeIntent(hover.owner === owner ? hover.intent : null, targetId, x, y, performance.now());
        return intent === hover.intent && dragMergeIntentReady(intent, performance.now()) ? targetId : "";
    }
    function imageGroupingTargetAt(clientX: number, clientY: number, sourceNodeId: string, excludedNodeIds: readonly string[] = []) {
        const excluded = new Set([sourceNodeId, ...excludedNodeIds]);
        const candidateIds = [...new Set(document.elementsFromPoint(clientX, clientY)
                .map((element) => element.closest<HTMLElement>(".flow-node.image")?.dataset.nodeId || "")
                .filter((id) => id && !excluded.has(id)))];
        for (const candidateId of candidateIds) {
            const element = document.querySelector<HTMLElement>(`.flow-node.image[data-node-id="${candidateId}"]`);
            const preview = element?.querySelector<HTMLElement>(".node-image-preview");
            const target = canvasNodeById.get(candidateId) ?? nodesRef.current.find((item) => item.id === candidateId);
            if (!preview || !target || target.layerGroup || target.layerComposition || target.type !== "image")
                continue;
            if (!target.imageContainer && !target.imageCollection && !canGroupImageAsset(target))
                continue;
            const rect = preview.getBoundingClientRect();
            if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
                continue;
            return candidateId;
        }
        return "";
    }
    function applyTransientNodePosition(nodeId: string, x: number, y: number, cachedNodeElement?: HTMLElement, cachedEdges?: TransientNodeDragEdge[]) {
        const nodeElement = cachedNodeElement?.isConnected
            ? cachedNodeElement
            : Array.from(document.querySelectorAll<HTMLElement>(".flow-node[data-node-id]"))
                .find((element) => element.dataset.nodeId === nodeId);
        if (nodeElement) {
            nodeElement.style.left = `${x}px`;
            nodeElement.style.top = `${y}px`;
        }
        if (cachedEdges) {
            for (const edge of cachedEdges) {
                const source = edge.source.id === nodeId ? { ...edge.source, x, y } : edge.source;
                const target = edge.target.id === nodeId ? { ...edge.target, x, y } : edge.target;
                edge.element.setAttribute("d", provenanceEdgePath(source, target, edge.laneIndex, edge.laneCount, viewportRef.current.scale));
            }
            return;
        }
        const affectedEdges = edges.filter((edge) => edge.source.id === nodeId || edge.target.id === nodeId);
        if (!affectedEdges.length)
            return;
        const edgeElements = new Map(Array.from(document.querySelectorAll<SVGPathElement>(".edge-layer .edge.provenance")).map((element) => [
            `${element.dataset.sourceId || ""}\u0000${element.dataset.targetId || ""}\u0000${element.dataset.relation || ""}`,
            element
        ]));
        for (const edge of affectedEdges) {
            const source = edge.source.id === nodeId ? { ...edge.source, x, y } : edge.source;
            const target = edge.target.id === nodeId ? { ...edge.target, x, y } : edge.target;
            const edgeElement = edgeElements.get(`${edge.source.id}\u0000${edge.target.id}\u0000${edge.kind}`);
            edgeElement?.setAttribute("d", provenanceEdgePath(source, target, edge.laneIndex, edge.laneCount, viewportRef.current.scale));
        }
    }
    function applyTransientNodePositions(positions: Record<string, {
        x: number;
        y: number;
    }>, cachedEdges: TransientNodeDragEdge[] = []) {
        const elements = new Map(Array.from(document.querySelectorAll<HTMLElement>(".flow-node[data-node-id]"))
            .map((element) => [element.dataset.nodeId || "", element]));
        for (const [nodeId, position] of Object.entries(positions)) {
            const element = elements.get(nodeId);
            if (!element)
                continue;
            element.style.left = `${position.x}px`;
            element.style.top = `${position.y}px`;
        }
        for (const edge of cachedEdges) {
            const sourcePosition = positions[edge.source.id];
            const targetPosition = positions[edge.target.id];
            const source = sourcePosition ? { ...edge.source, ...sourcePosition } : edge.source;
            const target = targetPosition ? { ...edge.target, ...targetPosition } : edge.target;
            edge.element.setAttribute("d", provenanceEdgePath(source, target, edge.laneIndex, edge.laneCount, viewportRef.current.scale));
        }
    }
    function beginNodeDrag(event: React.PointerEvent<HTMLDivElement>, node: WorkflowNode) {
        if (event.button !== 0)
            return;
        if (event.ctrlKey || event.metaKey)
            return;
        if (document.querySelector("[data-ui-menu-surface]")) {
            closeAllCanvasMenus();
            return;
        }
        const target = event.target as HTMLElement;
        const imageTile = target.closest<HTMLElement>(".node-image-tile");
        const imageTileMovesNode = Boolean(imageTile &&
            node.type === "image" &&
            !node.imageContainer &&
            !node.imageCollection &&
            !node.layerComposition &&
            !node.layerGroup &&
            (node.assets?.length ?? 0) === 1);
        const layerGroupTitleDrag = Boolean(target.closest(".node-layer-group-titlebar") && node.layerGroup && !node.layerGroup.detached);
        const layerMemberDrag = Boolean(target.closest(".node-layer-member-tab") && node.layerGroup && !node.layerGroup.detached);
        if (imageTile && !imageTileMovesNode)
            return;
        if (node.layerGroup && !node.layerGroup.detached && !layerGroupTitleDrag && !layerMemberDrag)
            return;
        if (target.closest(".node-port, .node-resize-handle, textarea, input, select, button"))
            return;
        const sourceAsset = imageTileMovesNode ? node.assets?.[0] : undefined;
        const currentSelection = currentNodeSelection();
        const selectedForGroupDrag = currentSelection.ids.length > 1 && currentSelection.ids.includes(node.id)
            ? currentSelection.ids
            : [];
        const expandedSelectionIds = new Set(expandCanvasSelectionNodeIds(nodesRef.current, layoutGroupsRef.current, selectedForGroupDrag));
        const selectionStart = expandedSelectionIds.size > 1
            ? Object.fromEntries([...expandedSelectionIds].flatMap((id) => {
                const selected = nodesRef.current.find((item) => item.id === id);
                return selected ? [[id, { x: selected.x, y: selected.y }]] : [];
            }))
            : undefined;
        const selectionCapabilities = selectionStart
            ? analyzeCanvasSelection(nodesRef.current, layoutGroupsRef.current, selectedForGroupDrag, node.id)
            : null;
        const wholeContainerDrag = !selectionStart && !imageTile && node.type === "image" &&
            !node.layerGroup && !node.layerComposition && (nodeUsesImageContainer(node) || canGroupImageAsset(node));
        const containerDragNodeIds = selectionCapabilities && selectionCapabilities.groupableNodeIds.length > 0 && selectionCapabilities.groupExcluded.length === 0
            ? [...selectedForGroupDrag]
            : wholeContainerDrag || imageTileMovesNode ? [node.id] : undefined;
        const layerGroupStart = !selectionStart && layerGroupTitleDrag && node.layerGroup
            ? Object.fromEntries(nodesRef.current
                .filter((item) => item.layerGroup?.id === node.layerGroup?.id)
                .map((item) => [item.id, {
                    x: item.x,
                    y: item.y,
                    anchorX: Number(item.layerGroup?.anchorX ?? item.x),
                    anchorY: Number(item.layerGroup?.anchorY ?? item.y),
                    detached: Boolean(item.layerGroup?.detached)
                }]))
            : undefined;
        const edgeElements = new Map(Array.from(document.querySelectorAll<SVGPathElement>(".edge-layer .edge.provenance")).map((element) => [
            `${element.dataset.sourceId || ""}\u0000${element.dataset.targetId || ""}\u0000${element.dataset.relation || ""}`,
            element
        ]));
        const transientNodeIds = new Set(selectionStart ? Object.keys(selectionStart) : [node.id]);
        const transientEdges = edges
            .filter((edge) => transientNodeIds.has(edge.source.id) || transientNodeIds.has(edge.target.id))
            .flatMap((edge): TransientNodeDragEdge[] => {
            const element = edgeElements.get(`${edge.source.id}\u0000${edge.target.id}\u0000${edge.kind}`);
            return element ? [{ element, ...edge, source: edge.source, target: edge.target }] : [];
        });
        const nodeElement = event.currentTarget;
        const originalZIndex = nodeElement.style.zIndex;
        const originalWillChange = nodeElement.style.willChange;
        nodeElement.classList.add("dragging");
        nodeElement.style.zIndex = "1000000";
        nodeElement.style.willChange = "left, top";
        markExplicitCanvasViewportIntent();
        suppressCanvasAutoRefocus();
        pendingRuntimeFocusNodeIdRef.current = "";
        setDraggingNodeId(node.id);
        dragRef.current = {
            id: node.id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            nodeX: node.x,
            nodeY: node.y,
            moved: false,
            allowImageGrouping: Boolean((!selectionStart && imageTileMovesNode && sourceAsset) || containerDragNodeIds?.length),
            assetKey: imageAssetLogicalKey(sourceAsset, node.id, 0),
            containerDragNodeIds,
            layerGroupId: layerGroupTitleDrag ? node.layerGroup?.id : undefined,
            layerGroupStart,
            selectionStart,
            nodeElement,
            originalZIndex,
            originalWillChange,
            originalWidth: node.width,
            originalHeight: node.height,
            originalLayerGroup: node.layerGroup ? cloneImageLayerNodeGroup(node.layerGroup) : undefined,
            pointerType: event.pointerType,
            startedAt: Date.now(),
            transientEdges
        };
        try {
            const captureElement = imageTile || target.closest<HTMLElement>("strong.requirement-node-title") || event.currentTarget;
            dragRef.current.captureElement = captureElement;
            captureElement.setPointerCapture(event.pointerId);
        }
        catch {
        }
        const owner = dragRef.current;
        const moveOutside = (next: PointerEvent) => {
            if (dragRef.current !== owner || owner.nodeElement?.contains(next.target as Node))
                return;
            moveNode(next, node);
        };
        const finishOutside = (next: PointerEvent) => {
            if (dragRef.current === owner)
                endNodeDrag(next, node);
        };
        window.addEventListener("pointermove", moveOutside);
        window.addEventListener("pointerup", finishOutside);
        window.addEventListener("pointercancel", finishOutside);
        owner.releaseListeners = () => {
            window.removeEventListener("pointermove", moveOutside);
            window.removeEventListener("pointerup", finishOutside);
            window.removeEventListener("pointercancel", finishOutside);
        };
    }
    function moveNode(event: React.PointerEvent<HTMLDivElement> | PointerEvent, node: WorkflowNode) {
        const drag = dragRef.current;
        if (!drag || drag.id !== node.id || drag.pointerId !== event.pointerId)
            return;
        if (!event.buttons) {
            cancelTransientCanvasInteractions();
            return;
        }
        const dx = (event.clientX - drag.startX) / zoom;
        const dy = (event.clientY - drag.startY) / zoom;
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 7;
        if (drag.allowImageGrouping) {
            const groupingTarget = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 18
                ? imageGroupingTargetAt(event.clientX, event.clientY, node.id, drag.containerDragNodeIds || [])
                : "";
            updateMergeHover(groupingTarget, event.clientX, event.clientY, drag);
        }
        drag.pendingX = Math.round(drag.nodeX + dx);
        drag.pendingY = Math.round(drag.nodeY + dy);
        if (drag.moved && drag.selectionStart) {
            applyTransientNodePositions(Object.fromEntries(Object.entries(drag.selectionStart).map(([id, start]) => [id, {
                    x: Math.round(start.x + dx),
                    y: Math.round(start.y + dy)
                }])), drag.transientEdges);
        }
        else if (drag.moved && !drag.layerGroupId && drag.nodeElement) {
            drag.nodeElement.style.left = `${drag.pendingX}px`;
            drag.nodeElement.style.top = `${drag.pendingY}px`;
        }
        if (drag.frame)
            return;
        drag.frame = window.requestAnimationFrame(() => {
            const current = dragRef.current;
            if (!current)
                return;
            if (current.selectionStart) {
                const groupDx = current.moved ? (current.pendingX ?? current.nodeX) - current.nodeX : 0;
                const groupDy = current.moved ? (current.pendingY ?? current.nodeY) - current.nodeY : 0;
                applyTransientNodePositions(Object.fromEntries(Object.entries(current.selectionStart).map(([id, start]) => [id, {
                        x: Math.round(start.x + groupDx),
                        y: Math.round(start.y + groupDy)
                    }])), current.transientEdges);
                current.frame = undefined;
                return;
            }
            if (current.layerGroupId && current.layerGroupStart) {
                const dx = current.moved ? (current.pendingX ?? current.nodeX) - current.nodeX : 0;
                const dy = current.moved ? (current.pendingY ?? current.nodeY) - current.nodeY : 0;
                const transientPositions: Record<string, {
                    x: number;
                    y: number;
                }> = {};
                for (const [memberId, start] of Object.entries(current.layerGroupStart)) {
                    if ((start as {
                        detached?: boolean;
                    }).detached)
                        continue;
                    transientPositions[memberId] = {
                        x: Math.round((start as {
                            x: number;
                        }).x + dx),
                        y: Math.round((start as {
                            y: number;
                        }).y + dy),
                    };
                }
                if (Object.keys(transientPositions).length) {
                    applyTransientNodePositions(transientPositions, current.transientEdges);
                }
                current.frame = undefined;
                return;
            }
            applyTransientNodePosition(current.id, current.moved ? current.pendingX ?? current.nodeX : current.nodeX, current.moved ? current.pendingY ?? current.nodeY : current.nodeY, current.nodeElement, current.transientEdges);
            current.frame = undefined;
        });
    }
    function endNodeDrag(event: React.PointerEvent<HTMLDivElement> | PointerEvent, node: WorkflowNode) {
        const drag = dragRef.current;
        if (!drag || drag.id !== node.id || drag.pointerId !== event.pointerId)
            return;
        drag.releaseListeners?.();
        try {
            drag.captureElement?.releasePointerCapture(event.pointerId);
        }
        catch {
        }
        if (drag.frame)
            window.cancelAnimationFrame(drag.frame);
        if (drag.nodeElement) {
            drag.nodeElement.classList.remove("dragging");
            drag.nodeElement.style.zIndex = drag.originalZIndex ?? "";
            drag.nodeElement.style.willChange = drag.originalWillChange ?? "";
        }
        if (event.type === "pointercancel") {
            clearMergeHover();
            if (drag.selectionStart) {
                applyTransientNodePositions(drag.selectionStart, drag.transientEdges);
            }
            else if (drag.layerGroupId && drag.layerGroupStart) {
                Object.entries(drag.layerGroupStart).forEach(([id, start]) => {
                    applyTransientNodePosition(id, start.x, start.y);
                });
                setNodes((source) => {
                    const next = source.map((item) => {
                        const start = drag.layerGroupStart?.[item.id];
                        if (!start || item.layerGroup?.id !== drag.layerGroupId)
                            return item;
                        return {
                            ...item,
                            x: start.x,
                            y: start.y,
                            layerGroup: {
                                ...cloneImageLayerNodeGroup(item.layerGroup)!,
                                anchorX: start.anchorX,
                                anchorY: start.anchorY,
                                detached: start.detached
                            }
                        };
                    });
                    nodesRef.current = next;
                    return next;
                });
            }
            else if (drag.originalLayerGroup) {
                applyTransientNodePosition(drag.id, drag.nodeX, drag.nodeY, drag.nodeElement, drag.transientEdges);
                updateNode(drag.id, {
                    x: drag.nodeX,
                    y: drag.nodeY,
                    width: drag.originalWidth,
                    height: drag.originalHeight,
                    layerGroup: cloneImageLayerNodeGroup(drag.originalLayerGroup)
                });
            }
            else if (drag.nodeElement) {
                applyTransientNodePosition(drag.id, drag.nodeX, drag.nodeY, drag.nodeElement, drag.transientEdges);
            }
            recordLayerDetachAudit({
                action: "cancel",
                source: "node-pointer-cancel-rollback",
                nodeId: drag.id,
                groupId: drag.originalLayerGroup?.id || drag.layerGroupId,
                pointerId: drag.pointerId,
                pointerType: drag.pointerType,
                eventType: event.type,
                dx: (drag.pendingX ?? drag.nodeX) - drag.nodeX,
                dy: (drag.pendingY ?? drag.nodeY) - drag.nodeY
            });
            dragRef.current = null;
            setAssetDropTargetId("");
            setDraggingNodeId("");
            return;
        }
        const dx = (event.clientX - drag.startX) / zoom;
        const dy = (event.clientY - drag.startY) / zoom;
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 7;
        if (drag.moved) {
            drag.pendingX = Math.round(drag.nodeX + dx);
            drag.pendingY = Math.round(drag.nodeY + dy);
        }
        else if (drag.layerGroupId) {
            drag.pendingX = drag.nodeX;
            drag.pendingY = drag.nodeY;
        }
        else {
            drag.pendingX = undefined;
            drag.pendingY = undefined;
            if (drag.nodeElement)
                applyTransientNodePosition(drag.id, drag.nodeX, drag.nodeY, drag.nodeElement, drag.transientEdges);
        }
        const candidate = drag.allowImageGrouping ? imageGroupingTargetAt(event.clientX, event.clientY, node.id, drag.containerDragNodeIds || []) : "";
        const dropTargetId = readyMergeTarget(candidate, event.clientX, event.clientY, drag);
        clearMergeHover();
        const containerDrop = Boolean(drag.moved && dropTargetId && drag.containerDragNodeIds?.length);
        if (containerDrop) {
            if (drag.selectionStart)
                applyTransientNodePositions(drag.selectionStart, drag.transientEdges);
            else
                applyTransientNodePosition(drag.id, drag.nodeX, drag.nodeY, drag.nodeElement, drag.transientEdges);
            moveCanvasNodesIntoContainer(drag.containerDragNodeIds!, dropTargetId);
        }
        if (!containerDrop && drag.selectionStart && drag.moved && drag.pendingX !== undefined && drag.pendingY !== undefined) {
            const groupDx = drag.pendingX - drag.nodeX;
            const groupDy = drag.pendingY - drag.nodeY;
            pushCanvasHistory(`移动 ${Object.keys(drag.selectionStart).length} 个成果`);
            setNodes((source) => {
                const next = source.map((item) => {
                    const start = drag.selectionStart?.[item.id];
                    if (!start)
                        return item;
                    return {
                        ...item,
                        x: Math.round(start.x + groupDx),
                        y: Math.round(start.y + groupDy),
                        layerGroup: item.layerGroup ? {
                            ...cloneImageLayerNodeGroup(item.layerGroup)!,
                            anchorX: Math.round(Number(item.layerGroup.anchorX ?? start.x) + groupDx),
                            anchorY: Math.round(Number(item.layerGroup.anchorY ?? start.y) + groupDy)
                        } : undefined
                    };
                });
                nodesRef.current = next;
                return next;
            });
        }
        else if (!containerDrop && drag.layerGroupId && drag.layerGroupStart && drag.pendingX !== undefined && drag.pendingY !== undefined) {
            const dx = drag.pendingX - drag.nodeX;
            const dy = drag.pendingY - drag.nodeY;
            setNodes((source) => {
                const next = source.map((item) => {
                    const start = drag.layerGroupStart?.[item.id];
                    if (!start || item.layerGroup?.id !== drag.layerGroupId)
                        return item;
                    return {
                        ...item,
                        ...(!start.detached ? { x: Math.round(start.x + dx), y: Math.round(start.y + dy) } : {}),
                        layerGroup: {
                            ...cloneImageLayerNodeGroup(item.layerGroup)!,
                            anchorX: Math.round(start.anchorX + dx),
                            anchorY: Math.round(start.anchorY + dy)
                        }
                    };
                });
                nodesRef.current = next;
                return next;
            });
        }
        else if (!containerDrop && drag.moved && drag.pendingX !== undefined && drag.pendingY !== undefined) {
            pushCanvasHistory("移动画布成果");
            const currentNode = nodesRef.current.find((item) => item.id === node.id);
            if (drag.moved && currentNode?.layerGroup && !currentNode.layerGroup.detached) {
                recordLayerDetachAudit({
                    action: "detach",
                    source: "node-pointer-drag-end",
                    nodeId: currentNode.id,
                    groupId: currentNode.layerGroup.id,
                    pointerId: drag.pointerId,
                    pointerType: drag.pointerType,
                    eventType: event.type,
                    dx: drag.pendingX - drag.nodeX,
                    dy: drag.pendingY - drag.nodeY
                });
            }
            const detachedSize = drag.moved && node.layerGroup ? detachedLayerNodeDisplaySize(node.layerGroup) : null;
            updateNode(node.id, {
                x: drag.pendingX,
                y: drag.pendingY,
                ...(drag.moved && node.layerGroup
                    ? {
                        layerGroup: { ...cloneImageLayerNodeGroup(node.layerGroup)!, detached: true },
                        width: detachedSize?.width,
                        height: detachedSize?.height
                    }
                    : {})
            });
        }
        if (drag.moved && !containerDrop) {
            selectNodeFromPlainClick(node.id, "node-drag-end");
            markExplicitCanvasViewportIntent();
            suppressCanvasAutoRefocus();
        }
        if (containerDrop) {
            lastNodeDragEndRef.current = { nodeId: node.id, endedAt: Date.now() };
        }
        else if (drag.moved && drag.selectionStart) {
            const movedCount = Object.keys(drag.selectionStart).length;
            addEvent(`移动 ${movedCount} 个选中成果`);
            notifyAgentOfManualAction("移动多个画布成果", `用户整体移动了 ${movedCount} 个选中成果；相对位置和节点关系保持不变。`);
        }
        else if (drag.moved && drag.layerGroupId) {
            addEvent(`移动分层 PNG #${String(node.layerGroup?.groupNumber ?? 0).padStart(3, "0")}`);
            notifyAgentOfManualAction("移动分层 PNG", `用户移动了分层 PNG 组 #${String(node.layerGroup?.groupNumber ?? 0).padStart(3, "0")}；各图层顺序和归属保持不变。`);
        }
        else if (drag.moved && dropTargetId && drag.assetKey && drag.allowImageGrouping) {
            lastNodeDragEndRef.current = { nodeId: node.id, endedAt: Date.now() };
            void moveContainerAsset(node.id, drag.assetKey, event.clientX, event.clientY, dropTargetId);
        }
        else if (drag.moved) {
            lastNodeDragEndRef.current = { nodeId: node.id, endedAt: Date.now() };
            addEvent(node.layerGroup ? `拖出图层节点 ${node.id}` : `调整节点 ${node.id} 位置`);
            notifyAgentOfManualAction(node.layerGroup ? "拖出分层 PNG 图层" : "移动画布成果", node.layerGroup
                ? `用户将分层组 #${String(node.layerGroup.groupNumber).padStart(3, "0")} 的「${node.layerGroup.layerTitle}」图层节点独立拖出。`
                : `用户将成果 ${node.id} 移动到新的画布位置。`);
        }
        dragRef.current = null;
        setAssetDropTargetId("");
        setDraggingNodeId("");
    }
    function beginNodeResize(event: React.PointerEvent<HTMLSpanElement>, node: WorkflowNode) {
        if (event.button !== 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        suppressCanvasAutoRefocus();
        setSelectedNodeId(node.id);
        markImageLayoutSizeManual(node.id);
        setResizingNodeId(node.id);
        const startX = event.clientX;
        const startY = event.clientY;
        const startBounds = workflowNodeBounds(node);
        const startWidth = startBounds.width;
        const startHeight = startBounds.height;
        const lockImageRatio = hasSingleImageFrame(node);
        const minimum = minimumNodeSize(node);
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        let frame = 0;
        let hasPendingSize = false;
        let pendingWidth = Math.round(startWidth);
        let pendingHeight = Math.round(startHeight);
        const flushResize = () => {
            frame = 0;
            if (!hasPendingSize)
                return;
            hasPendingSize = false;
            updateNode(node.id, {
                width: pendingWidth,
                height: pendingHeight
            });
        };
        const move = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault();
            suppressCanvasAutoRefocus();
            const resized = canvasPlatformResizeNodeSize({ width: startWidth, height: startHeight }, { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY }, zoom, { width: minimum.width ?? NODE_RESIZE_MIN_W, height: minimum.height ?? NODE_RESIZE_MIN_H }, { width: NODE_RESIZE_MAX_W, height: NODE_RESIZE_MAX_H });
            pendingWidth = resized.width;
            pendingHeight = resized.height;
            if (lockImageRatio) {
                const dx = (moveEvent.clientX - startX) / zoom, dy = (moveEvent.clientY - startY) / zoom;
                const ratio = (startWidth - MEDIA_FRAME_INSET * 2) / Math.max(.001, startHeight - 52 - MEDIA_FRAME_INSET * 2);
                const width = startWidth + (Math.abs(dx) >= Math.abs(dy * ratio) ? dx : dy * ratio);
                const size = singleImageFrameSize(imageTaskSizeForNode(node), width, node.assets ?? []);
                pendingWidth = size.width;
                pendingHeight = size.height;
            }
            hasPendingSize = true;
            if (!frame)
                frame = window.requestAnimationFrame(flushResize);
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            if (frame)
                window.cancelAnimationFrame(frame);
            if (hasPendingSize) {
                updateNode(node.id, {
                    width: pendingWidth,
                    height: pendingHeight
                });
            }
            try {
                target.releasePointerCapture(event.pointerId);
            }
            catch {
            }
            setResizingNodeId("");
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }
    function selectedImageDraft(node: WorkflowNode): ImageTaskDraft {
        return cloneImageTaskDraft({
            ...defaultImageTaskDraft(settings),
            ...(node.imageParams ?? {}),
            prompt: node.imageParams?.prompt ?? firstPromptLine(node.prompt)
        });
    }
    function continueImageNodeRun(node: WorkflowNode) {
        if (node.type !== "image" || imageRunStartsRef.current[node.id])
            return;
        const draft = selectedImageDraft(node);
        const completed = node.assets?.length ?? 0;
        const total = Math.max(node.imageProgress?.total ?? draft.count, completed + 1);
        const remaining = Math.max(1, total - completed);
        void runManualImageTask({ ...draft, count: remaining }, { targetNodeId: node.id, append: true, requestedCount: remaining, targetTotal: total, quotaChecked: false });
    }
    function openReferencePicker(target: ReferencePickerTarget, currentImages: ReferenceImage[] = [], options?: {
        title?: string;
        detail?: string;
        max?: number;
    }) {
        const max = clamp(Number(options?.max ?? MAX_REFERENCE_IMAGES), 1, MAX_AGENT_SOURCE_IMAGES);
        const pending = target.kind === "agent-request" ? pendingAgentExecutionRef.current : null;
        const preferredNodeIds = target.kind === "agent-request"
            ? [pending?.focusedNodeId || "", ...(pending?.sourceNodeIds || []), ...selectedNodeIdsRef.current].filter(Boolean)
            : [];
        const canvasCandidates = target.kind === "agent-request"
            ? canvasReferencePickerCandidates(canvasNodesRef.current, target.role, preferredNodeIds)
            : [];
        setReferencePickerMinimized(false);
        setReferencePickerDraft({
            target,
            title: options?.title ?? "参考图",
            detail: options?.detail,
            images: cloneReferenceImages(currentImages).slice(0, max),
            max,
            canvasCandidates,
            selectedCanvasCandidateIds: []
        });
    }
    function resumePendingAgentExecution(requestId: string, answer: string, images: ReferenceImage[] = [], role?: AssetTaskRole, selectedOptionId?: string, canvasAssets: TaskAssetReference[] = []) {
        const pending = pendingAgentExecutionRef.current;
        if (!pending || pending.requestId !== requestId) {
            closePendingAgentExecution(requestId);
            pushSystemMessage("agent-continuation", "这次补充请求已失效，请重新向 Agent 发送原任务。");
            return false;
        }
        if (pending.projectId !== activeProjectIdRef.current ||
            pending.conversationId !== activeConversationIdRef.current) {
            closePendingAgentExecution(requestId);
            pushSystemMessage("agent-continuation", "画布或会话已经切换，旧任务没有被恢复，以免处理错误图片。");
            return false;
        }
        if (projectsRef.current.find(project => project.id === pending.projectId)?.kind === "writing") {
            const content = answer.trim() || pending.suggestedAnswer || "已补充所需信息，请继续原任务。";
            void sendWritingPrompt(content, content, {
                id: crypto.randomUUID(), projectId: pending.projectId, conversationId: pending.conversationId,
                projectKind: "writing", prompt: content, visiblePrompt: content, createdAt: new Date().toISOString(), fileAttachments: []
            }, { pending, selectedOptionId });
            return true;
        }
        if (pending.requirementNodeId) {
            const requirementNode = nodesRef.current.find((node) => (node.id === pending.requirementNodeId && node.type === "requirement" && node.requirement));
            const currentInputNodeIds = requirementNode ? requirementInputNodeIds(requirementNode, nodesRef.current) : [];
            const currentInputSignature = requirementNode
                ? stableRequirementInputSignature(requirementNode, nodesRef.current)
                : "";
            const validation = validatePendingRequirementContinuation(pending, requirementNode, currentInputNodeIds, currentInputSignature);
            if (!validation.ok) {
                const message = validation.issue === "missing-requirement"
                    ? "原需求节点已不存在，旧任务已取消。请重新选择来源并创建或执行需求。"
                    : validation.issue === "revision-changed"
                        ? "需求内容在等待期间已被修改，旧任务已取消。请从更新后的需求节点重新执行。"
                        : validation.issue === "source-binding-changed"
                            ? "需求节点的来源在等待期间已改变，旧任务已取消。请核对当前来源后重新执行需求。"
                            : validation.issue === "source-content-changed"
                                ? "来源图片或容器内容在等待期间已变化，旧任务已取消。请从当前需求节点重新执行。"
                                : "旧任务缺少安全恢复信息，已取消。请从当前需求节点重新执行。";
                closePendingAgentExecution(requestId);
                setServerMessage(message);
                pushSystemMessage("agent-continuation", message);
                return false;
            }
        }
        const normalizedImages = cloneReferenceImages(images).map((image) => ({
            ...image,
            taskRole: role
        }));
        const selectedConfirmationPolicy = selectedOptionId === "preview-3" || selectedOptionId === "staged" || selectedOptionId === "direct"
            ? selectedOptionId
            : undefined;
        const continuationTaskScope = withAgentTaskScopeConfirmationPolicy(pending.taskScope, selectedConfirmationPolicy);
        const canvasNodeIds = [...new Set(canvasAssets.map((asset) => asset.nodeId || asset.ownerNodeId || "").filter(Boolean))];
        const canvasMentions: AgentTaskMention[] = canvasAssets.flatMap((asset) => {
            const nodeId = asset.nodeId || asset.ownerNodeId || "";
            if (!nodeId || !asset.displayCode)
                return [];
            return [{
                    kind: "asset" as const,
                    code: asset.displayCode,
                    nodeId,
                    assetIndex: asset.containerSlot ?? asset.assetIndex,
                    bindingId: asset.bindingId,
                    assetId: asset.assetId,
                    feedbackScore: asset.feedbackScore,
                }];
        });
        const explicitNodeRoles = role
            ? Object.fromEntries(canvasNodeIds.map((nodeId) => [nodeId, role])) as Record<string, AssetTaskRole>
            : undefined;
        closePendingAgentExecution(requestId, false);
        void sendPrompt(answer.trim() || pending.suggestedAnswer || "已补充所需信息，请继续原任务。", {
            sourceNodeIds: [...new Set([...pending.sourceNodeIds, ...canvasNodeIds])],
            focusedNodeId: canvasNodeIds[0] || pending.focusedNodeId,
            taskOrigin: pending.taskOrigin,
            requirementNodeId: pending.requirementNodeId,
            requirementInputSignature: pending.requirementInputSignature,
            requirementSourceSignature: pending.requirementSourceSignature,
            useComposerAttachments: false,
            frozenTaskScope: continuationTaskScope,
            sourceImages: role === "source" ? normalizedImages : [],
            referenceImages: role === "reference" ? normalizedImages : [],
            explicitMentions: canvasMentions,
            explicitNodeRoles,
            scopeExtension: canvasAssets.length > 0,
            continuationRequestId: pending.requestId,
            selectedOptionId,
            originalPrompt: pending.originalPrompt
        });
        return true;
    }
    function saveReferencePicker(draft: ReferencePickerDraft) {
        const images = cloneReferenceImages(draft.images).slice(0, draft.max);
        const selectedCanvasIds = new Set(draft.selectedCanvasCandidateIds || []);
        const canvasAssets = (draft.canvasCandidates || [])
            .filter((candidate) => selectedCanvasIds.has(candidate.id))
            .slice(0, Math.max(0, draft.max - images.length))
            .map((candidate) => ({ ...candidate.asset, role: draft.target.kind === "agent-request" ? draft.target.role : candidate.asset.role }));
        if (draft.target.kind === "agent-request") {
            if (!images.length && !canvasAssets.length) {
                setServerMessage(draft.target.role === "source" ? "请至少添加一张需要处理的原图。" : "请至少添加一张参考图。");
                return;
            }
            const label = draft.target.role === "source" ? "原图" : "参考图";
            const total = images.length + canvasAssets.length;
            const answer = draft.target.suggestedAnswer || `已补充 ${total} 张${label}，请继续原任务。`;
            setReferencePickerMinimized(false);
            setReferencePickerDraft(null);
            resumePendingAgentExecution(draft.target.requestId, answer, images, draft.target.role, undefined, canvasAssets);
            return;
        }
        setReferencePickerMinimized(false);
        setReferencePickerDraft(null);
        if (draft.target.kind === "agent-source") {
            commitAgentSourceImages(images.map((image) => ({ ...image, taskRole: "source" })));
            return;
        }
        if (draft.target.kind === "agent") {
            commitAgentReferenceImages(images.map((image) => ({ ...image, taskRole: "reference" })));
            return;
        }
        if (draft.target.kind === "image-task") {
            setManualImageTaskDialog((current) => current
                ? { ...current, draft: cloneImageTaskDraft({ ...current.draft, referenceImages: images }) }
                : current);
            return;
        }
        const target = draft.target;
        if (target.kind === "selected-node") {
            const node = nodes.find((item) => item.id === target.nodeId);
            if (node?.type === "image") {
                const current = selectedImageDraft(node);
                updateNode(node.id, {
                    imageParams: cloneImageTaskDraft({ ...current, referenceImages: images }),
                    prompt: current.prompt,
                    title: "生成图片"
                });
            }
        }
    }
    function workflowNodeFocusBounds(node: WorkflowNode) {
        const { width, height } = workflowNodeBounds(node);
        const stackedLayerGroup = Boolean(node.layerGroup && !node.layerGroup.detached);
        const compactLayerTabs = stackedLayerGroup && window.matchMedia("(max-width: 1100px)").matches;
        const layerTitlebarHeight = stackedLayerGroup ? 44 : 0;
        const externalLayerTabWidth = stackedLayerGroup ? (compactLayerTabs ? 48 : 214) : 0;
        return {
            left: node.x,
            top: node.y - layerTitlebarHeight,
            right: node.x + width + externalLayerTabWidth,
            bottom: node.y + height
        };
    }
    function workflowNodeElementFocusRect(nodeElement: HTMLElement) {
        const groupId = nodeElement.dataset.layerGroup || "";
        const groupElements = groupId && nodeElement.classList.contains("layer-group-stacked")
            ? Array.from(document.querySelectorAll<HTMLElement>(".flow-node.layer-group-stacked"))
                .filter((item) => item.dataset.layerGroup === groupId)
            : [nodeElement];
        const focusElements = groupElements.flatMap((item) => [
            item,
            item.querySelector<HTMLElement>(".node-layer-member-tab"),
            item.querySelector<HTMLElement>(".node-layer-group-titlebar")
        ].filter((element): element is HTMLElement => Boolean(element)));
        const rects = focusElements
            .map((element) => ({ element, rect: element.getBoundingClientRect(), style: window.getComputedStyle(element) }))
            .filter(({ rect, style }) => canvasPlatformRectIsRendered(rect, style))
            .map(({ rect }) => rect);
        if (!rects.length)
            return nodeElement.getBoundingClientRect();
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const rect of rects) {
            left = Math.min(left, rect.left);
            top = Math.min(top, rect.top);
            right = Math.max(right, rect.right);
            bottom = Math.max(bottom, rect.bottom);
        }
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    function canvasSelectionHudRect() {
        const elements = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>(".canvas-selection-indicator, .canvas-suggested-action") ?? []);
        const rendered = elements
            .map((element) => ({ rect: element.getBoundingClientRect(), style: window.getComputedStyle(element) }))
            .filter(({ rect, style }) => canvasPlatformRectIsRendered(rect, style))
            .map(({ rect }) => rect)
            .sort((left, right) => right.bottom - left.bottom);
        return rendered[0] ?? null;
    }
    function currentCanvasViewportIntentKey() {
        const canvas = canvasRef.current;
        if (!canvas)
            return "";
        const selection = [selectedNodeIdRef.current, ...selectedNodeIdsRef.current].join("\u0000");
        return [activeProjectIdRef.current, selection, canvas.clientWidth, canvas.clientHeight].join("\u0000");
    }
    function markExplicitCanvasViewportIntent() {
        viewportIntentRevisionRef.current += 1;
        if (layoutRefocusTimerRef.current) {
            window.clearTimeout(layoutRefocusTimerRef.current);
            layoutRefocusTimerRef.current = null;
        }
        explicitViewportIntentRef.current = currentCanvasViewportIntentKey();
    }
    function suppressCanvasAutoRefocus(ms = 2200) {
        suppressCanvasAutoRefocusUntilRef.current = Math.max(suppressCanvasAutoRefocusUntilRef.current, Date.now() + ms);
        if (layoutRefocusTimerRef.current) {
            window.clearTimeout(layoutRefocusTimerRef.current);
            layoutRefocusTimerRef.current = null;
        }
    }
    function canvasAutoRefocusSuppressed() {
        if (Date.now() < suppressCanvasAutoRefocusUntilRef.current)
            return true;
        suppressCanvasAutoRefocusUntilRef.current = 0;
        return false;
    }
    function explicitCanvasViewportIntentMatchesCurrentLayout() {
        const matches = Boolean(explicitViewportIntentRef.current && explicitViewportIntentRef.current === currentCanvasViewportIntentKey());
        if (!matches)
            explicitViewportIntentRef.current = "";
        return matches;
    }
    function fitCanvas() {
        markExplicitCanvasViewportIntent();
        pendingRuntimeFocusNodeIdRef.current = "";
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const visibleCanvasNodes = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current).canvasNodes;
        if (!rect || visibleCanvasNodes.length === 0) {
            const next = { x: 86, y: 70, scale: 0.86 };
            viewportRef.current = next;
            setViewport(next);
            addEvent("画布视图已适配");
            return;
        }
        const bounds = visibleCanvasNodes.reduce((current, node) => {
            const nodeBounds = workflowNodeFocusBounds(node);
            return {
                left: Math.min(current.left, nodeBounds.left),
                top: Math.min(current.top, nodeBounds.top),
                right: Math.max(current.right, nodeBounds.right),
                bottom: Math.max(current.bottom, nodeBounds.bottom)
            };
        }, { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY });
        const compactCanvasViewport = typeof window !== "undefined" && window.matchMedia("(max-width: 740px)").matches;
        const marginX = clamp(rect.width * 0.055, 28, 64);
        const marginY = compactCanvasViewport ? 16 : clamp(rect.height * 0.06, 28, 56);
        const selectionHudRect = canvasSelectionHudRect();
        const compactProjectStripInset = compactCanvasViewport ? 72 : 0;
        const safeTop = selectionHudRect
            ? Math.max(marginY, selectionHudRect.bottom - rect.top + 12, compactProjectStripInset)
            : selectedNodeIdRef.current || selectedNodeIdsRef.current.length
                ? Math.max(marginY, CANVAS_SELECTION_HUD_SAFE_TOP, compactProjectStripInset)
                : marginY;
        const next = canvasPlatformFitViewport(bounds, {
            width: rect.width,
            height: rect.height
        }, {
            insets: { left: marginX, right: marginX, top: safeTop, bottom: marginY },
            minimumScale: ZOOM_MIN,
            maximumScale: ZOOM_MAX,
            maximumFitScale: 1
        });
        viewportRef.current = next;
        setViewport(next);
        addEvent("画布视图已适配");
    }
    function requestArrangeCanvas() {
        setCanvasMenu(null);
        if (agentExecutionBusyNow()) {
            setServerMessage("Agent 正在写入画布，请等待当前工作完成后再整理位置。");
            return;
        }
        if (projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current).canvasNodes.length < 2) {
            setServerMessage("当前画布不足两个成果，无需整理。");
            return;
        }
        openConfirmDialog({
            id: activeProjectIdRef.current,
            eyebrow: "CANVAS",
            title: "整理当前画布？",
            message: "将按来源、需求与成果关系自动工整排列当前画布。",
            detail: "只改变节点位置，不会修改图片、编号、容器、连线或任务内容；整理后可使用 Ctrl+Z 撤销。",
            confirmLabel: "整理画布",
            action: "arrange-canvas"
        });
    }
    function arrangeCurrentCanvas(projectId: string) {
        if (projectId !== activeProjectIdRef.current)
            return false;
        const currentNodes = nodesRef.current;
        const nextNodes = arrangeCanvasNodePositions(currentNodes, layoutGroupsRef.current);
        const changed = nextNodes.some((node, index) => node.x !== currentNodes[index]?.x || node.y !== currentNodes[index]?.y);
        if (!changed) {
            setServerMessage("当前画布已经排列整齐。");
            return false;
        }
        pushCanvasHistory("整理画布");
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setServerMessage("画布已按关系整理，可使用 Ctrl+Z 撤销。");
        addEvent(`整理画布 · ${nextNodes.length} 个节点`);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => fitCanvas()));
        return true;
    }
    function referenceSelectedCanvasImages(selectedIds = currentNodeSelection().ids) {
        const visibleIds = new Set(selectedIds.map((id) => layoutProjection.groupByMember.get(id)?.hostNodeId ?? id));
        const codes = agentMentionImageOptions(canvasNodesRef.current.filter((item) => visibleIds.has(item.id)))
            .map((item) => item.code);
        if (!codes.length) {
            setServerMessage("选中内容中没有可引用的图片。");
            setCanvasMenu(null);
            return false;
        }
        insertAgentMentions(codes);
        setAgentCollapsed(false);
        setCanvasMenu(null);
        addEvent(`批量引用 ${codes.length} 张画布图片`);
        return true;
    }
    function zoomCanvas(factor: number) {
        markExplicitCanvasViewportIntent();
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const pointerX = rect ? rect.width / 2 : 0;
        const pointerY = rect ? rect.height / 2 : 0;
        setViewport((current) => {
            const next = canvasPlatformViewportFromFactor(current, factor, { x: pointerX, y: pointerY });
            if (Math.abs(next.scale - current.scale) < 0.0001)
                return current;
            viewportRef.current = next;
            return next;
        });
    }
    function viewportForNode(node: WorkflowNode, current: CanvasViewport, rect?: DOMRect | null): CanvasViewport {
        let scale = clampCanvasPlatformScale(current.scale, ZOOM_MIN, ZOOM_MAX);
        const compactCanvasViewport = typeof window !== "undefined" && window.matchMedia("(max-width: 740px)").matches;
        const canvasWidth = Math.max(320, rect?.width ?? 900);
        const canvasHeight = Math.max(260, rect?.height ?? 620);
        const focusBounds = workflowNodeFocusBounds(node);
        const focusWidth = Math.max(1, focusBounds.right - focusBounds.left);
        const focusHeight = Math.max(1, focusBounds.bottom - focusBounds.top);
        const marginLeft = Math.min(36, Math.max(16, canvasWidth * 0.06));
        const marginRight = Math.min(56, Math.max(20, canvasWidth * 0.08));
        const baseMarginTop = Math.min(34, Math.max(16, canvasHeight * 0.055));
        const selectionHudRect = canvasSelectionHudRect();
        const compactProjectStripInset = compactCanvasViewport ? 72 : 0;
        const selectionHudInset = selectionHudRect && rect
            ? Math.max(0, selectionHudRect.bottom - rect.top + 12)
            : selectedNodeIdRef.current || selectedNodeIdsRef.current.length
                ? CANVAS_SELECTION_HUD_SAFE_TOP
                : 0;
        const marginTop = Math.min(Math.max(baseMarginTop, selectionHudInset, compactProjectStripInset), Math.max(baseMarginTop, canvasHeight - 120));
        const marginBottom = compactCanvasViewport ? 8 : Math.min(44, Math.max(20, canvasHeight * 0.07));
        const minLeft = marginLeft;
        const maxRight = Math.max(minLeft + 80, canvasWidth - marginRight);
        const minTop = marginTop;
        const maxBottom = Math.max(minTop + 80, canvasHeight - marginBottom);
        const availableWidth = maxRight - minLeft;
        const availableHeight = maxBottom - minTop;
        const fitPadding = compactCanvasViewport ? 0 : 18;
        const fitAvailableWidth = Math.max(80, availableWidth - fitPadding);
        const fitAvailableHeight = Math.max(80, availableHeight - fitPadding);
        const focusMaxScale = node.type === "image" ? 0.92 : 1.05;
        const fitScale = Math.min(focusMaxScale, fitAvailableWidth / focusWidth, fitAvailableHeight / focusHeight);
        if (Number.isFinite(fitScale) && fitScale > 0) {
            scale = clampCanvasPlatformScale(fitScale, ZOOM_MIN, ZOOM_MAX);
        }
        const centeredX = canvasWidth / 2 - (focusBounds.left + focusWidth / 2) * scale;
        const centeredY = canvasHeight / 2 - (focusBounds.top + focusHeight / 2) * scale;
        const screenWidth = focusWidth * scale;
        const screenHeight = focusHeight * scale;
        const delta = canvasPlatformContainmentDelta({
            left: focusBounds.left * scale + centeredX,
            top: focusBounds.top * scale + centeredY,
            right: focusBounds.left * scale + centeredX + screenWidth,
            bottom: focusBounds.top * scale + centeredY + screenHeight
        }, { left: minLeft, top: minTop, right: maxRight, bottom: maxBottom });
        return { x: centeredX + delta.x, y: centeredY + delta.y, scale };
    }
    function viewportForNodes(targetNodes: WorkflowNode[], current: CanvasViewport, rect?: DOMRect | null): CanvasViewport {
        const liveProjection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const visibleNodes = [...new Map(targetNodes.map((node) => {
                const hostId = liveProjection.groupByMember.get(node.id)?.hostNodeId ?? node.id;
                const visibleNode = liveProjection.canvasNodeById.get(hostId) ?? node;
                return [visibleNode.id, visibleNode] as const;
            })).values()];
        if (visibleNodes.length <= 1)
            return visibleNodes[0] ? viewportForNode(visibleNodes[0], current, rect) : current;
        const compactCanvasViewport = typeof window !== "undefined" && window.matchMedia("(max-width: 740px)").matches;
        const canvasWidth = Math.max(320, rect?.width ?? 900);
        const canvasHeight = Math.max(260, rect?.height ?? 620);
        const marginLeft = Math.min(36, Math.max(16, canvasWidth * 0.06));
        const marginRight = Math.min(56, Math.max(20, canvasWidth * 0.08));
        const baseMarginTop = Math.min(34, Math.max(16, canvasHeight * 0.055));
        const selectionHudRect = canvasSelectionHudRect();
        const compactProjectStripInset = compactCanvasViewport ? 72 : 0;
        const selectionHudInset = selectionHudRect && rect
            ? selectionHudRect.bottom - rect.top + 12
            : selectedNodeIdRef.current || selectedNodeIdsRef.current.length
                ? CANVAS_SELECTION_HUD_SAFE_TOP
                : 0;
        const marginTop = Math.min(Math.max(baseMarginTop, selectionHudInset, compactProjectStripInset), Math.max(baseMarginTop, canvasHeight - 120));
        const marginBottom = compactCanvasViewport ? 8 : Math.min(44, Math.max(20, canvasHeight * 0.07));
        const bounds = visibleNodes.reduce((currentBounds, node) => {
            const nodeBounds = workflowNodeFocusBounds(node);
            return {
                left: Math.min(currentBounds.left, nodeBounds.left),
                top: Math.min(currentBounds.top, nodeBounds.top),
                right: Math.max(currentBounds.right, nodeBounds.right),
                bottom: Math.max(currentBounds.bottom, nodeBounds.bottom)
            };
        }, { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY });
        return canvasPlatformFitViewport(bounds, {
            width: canvasWidth,
            height: canvasHeight
        }, {
            insets: { left: marginLeft, right: marginRight, top: marginTop, bottom: marginBottom },
            minimumScale: ZOOM_MIN,
            maximumScale: ZOOM_MAX,
            maximumFitScale: 0.92
        });
    }
    function nudgeNodeElementIntoCanvas(nodeId: string, margin = 10) {
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const nodeElement = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>(".flow-node") ?? [])
            .find((item) => item.dataset.nodeId === nodeId) ?? null;
        if (!canvasRect || !nodeElement)
            return false;
        const nodeRect = workflowNodeElementFocusRect(nodeElement);
        const selectionHudRect = canvasSelectionHudRect();
        const minLeft = canvasRect.left + margin;
        const maxRight = canvasRect.right - margin;
        const minTop = Math.max(canvasRect.top + margin, selectionHudRect ? selectionHudRect.bottom + 12 : canvasRect.top + margin);
        const maxBottom = canvasRect.bottom - margin;
        const { x: dx, y: dy } = canvasPlatformContainmentDelta(nodeRect, {
            left: minLeft,
            right: maxRight,
            top: minTop,
            bottom: maxBottom
        });
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1)
            return false;
        const next = {
            ...viewportRef.current,
            x: viewportRef.current.x + dx,
            y: viewportRef.current.y + dy
        };
        viewportRef.current = next;
        setViewport(next);
        return true;
    }
    function focusWorkflowNode(node: WorkflowNode, options?: {
        revealInspector?: boolean;
        recordEvent?: boolean;
        selectNode?: boolean;
    }) {
        const intentRevision = viewportIntentRevisionRef.current;
        const liveProjection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const hostId = liveProjection.groupByMember.get(node.id)?.hostNodeId ?? node.id;
        const visibleNode = liveProjection.canvasNodeById.get(hostId) ?? node;
        const rect = canvasRef.current?.getBoundingClientRect();
        const next = viewportForNode(visibleNode, viewportRef.current, rect);
        viewportRef.current = next;
        setViewport(next);
        if (options?.selectNode !== false)
            setSelectedNodeId(visibleNode.id);
        setCanvasMenu(null);
        if (options?.recordEvent !== false)
            addEvent(`定位节点 ${visibleNode.id}`);
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (intentRevision === viewportIntentRevisionRef.current && !viewportInteractionActiveRef.current)
                    nudgeNodeElementIntoCanvas(visibleNode.id);
            });
        });
    }
    function focusWorkflowNodes(targetNodes: WorkflowNode[], options?: {
        recordEvent?: boolean;
    }) {
        if (!targetNodes.length)
            return;
        if (targetNodes.length === 1) {
            focusWorkflowNode(targetNodes[0], { revealInspector: false, recordEvent: options?.recordEvent, selectNode: false });
            return;
        }
        const rect = canvasRef.current?.getBoundingClientRect();
        const next = viewportForNodes(targetNodes, viewportRef.current, rect);
        markExplicitCanvasViewportIntent();
        viewportRef.current = next;
        setViewport(next);
        setCanvasMenu(null);
        if (options?.recordEvent !== false)
            addEvent(`定位 ${targetNodes.length} 个相关成果`);
        const targetIds = targetNodes.map((node) => node.id);
        const intentRevision = viewportIntentRevisionRef.current;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (intentRevision !== viewportIntentRevisionRef.current || viewportInteractionActiveRef.current || canvasAutoRefocusSuppressed())
                    return;
                const liveTargets = targetIds
                    .map((id) => nodesRef.current.find((node) => node.id === id))
                    .filter((node): node is WorkflowNode => Boolean(node));
                const liveRect = canvasRef.current?.getBoundingClientRect();
                if (!liveTargets.length || !liveRect)
                    return;
                const reconciled = viewportForNodes(liveTargets, viewportRef.current, liveRect);
                viewportRef.current = reconciled;
                setViewport(reconciled);
            });
        });
    }
    function scheduleFocusedNodeRefit() {
        if (layoutRefocusTimerRef.current)
            window.clearTimeout(layoutRefocusTimerRef.current);
        layoutRefocusTimerRef.current = window.setTimeout(() => {
            layoutRefocusTimerRef.current = null;
            if (viewportInteractionActiveRef.current || canvasAutoRefocusSuppressed())
                return;
            if (explicitCanvasViewportIntentMatchesCurrentLayout())
                return;
            const selectedId = selectedNodeIdRef.current;
            const currentNodes = nodesRef.current;
            let target = selectedId ? currentNodes.find((node) => node.id === selectedId) : null;
            const shouldSelect = Boolean(target && selectedId);
            if (!target)
                target = [...currentNodes].reverse().find((node) => node.type === "image") ?? currentNodes[currentNodes.length - 1] ?? null;
            if (!target)
                return;
            const liveProjection = projectCanvasImageLayouts(currentNodes, layoutGroupsRef.current);
            const hostId = liveProjection.groupByMember.get(target.id)?.hostNodeId ?? target.id;
            const canvasRect = canvasRef.current?.getBoundingClientRect();
            const nodeElement = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>(".flow-node") ?? [])
                .find((item) => item.dataset.nodeId === hostId) ?? null;
            if (canvasRect && nodeElement) {
                const nodeRect = workflowNodeElementFocusRect(nodeElement);
                const selectionHudRect = canvasSelectionHudRect();
                const margin = 10;
                const minTop = Math.max(canvasRect.top + margin, selectionHudRect ? selectionHudRect.bottom + 12 : canvasRect.top + margin);
                const alreadyVisible = nodeRect.left >= canvasRect.left + margin - 1 &&
                    nodeRect.right <= canvasRect.right - margin + 1 &&
                    nodeRect.top >= minTop - 1 &&
                    nodeRect.bottom <= canvasRect.bottom - margin + 1;
                if (alreadyVisible)
                    return;
            }
            focusWorkflowNode(target, { revealInspector: false, recordEvent: false, selectNode: shouldSelect });
        }, 160);
    }
    useEffect(() => {
        if (!selectedNodeId || !canvasRef.current)
            return;
        let cancelled = false;
        let firstFrame = 0;
        let secondFrame = 0;
        firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(() => {
                if (cancelled || viewportInteractionActiveRef.current || canvasAutoRefocusSuppressed())
                    return;
                const target = nodesRef.current.find((node) => node.id === selectedNodeId);
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!target || !rect)
                    return;
                if (!explicitCanvasViewportIntentMatchesCurrentLayout()) {
                    const next = viewportForNode(target, viewportRef.current, rect);
                    viewportRef.current = next;
                    setViewport(next);
                }
                window.requestAnimationFrame(() => {
                    if (!cancelled)
                        nudgeNodeElementIntoCanvas(selectedNodeId, 12);
                });
            });
        });
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(firstFrame);
            window.cancelAnimationFrame(secondFrame);
        };
    }, [selectedNodeId, selectedNodeIds.length]);
    useEffect(() => {
        const targetId = pendingRuntimeFocusNodeIdRef.current;
        if (!targetId)
            return;
        if (!nodes.some((node) => node.id === targetId))
            return;
        pendingRuntimeFocusNodeIdRef.current = "";
        let cancelled = false;
        const intentRevision = viewportIntentRevisionRef.current;
        const refitTarget = () => {
            if (cancelled || intentRevision !== viewportIntentRevisionRef.current || viewportInteractionActiveRef.current || canvasAutoRefocusSuppressed())
                return;
            const target = nodesRef.current.find((node) => node.id === targetId);
            if (!target)
                return;
            const selectedTargets = selectedNodeIdsRef.current
                .map((id) => nodesRef.current.find((node) => node.id === id))
                .filter((node): node is WorkflowNode => Boolean(node && node.id !== target.id));
            focusWorkflowNodes([...selectedTargets, target], { recordEvent: false });
        };
        const frame = window.requestAnimationFrame(refitTarget);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
        };
    }, [nodes]);
    function pushSystemMessage(meta: string, content: string) {
        setMessages((current) => [
            ...current,
            {
                id: uid("system"),
                role: "system",
                createdAt: nowLabel(),
                status: "done",
                meta,
                content
            }
        ]);
        scheduleAgentFeedBottomSettle();
    }
    function commitPendingAgentExecution(value: PendingAgentExecution | null) {
        pendingAgentExecutionRef.current = value;
        setPendingAgentExecution(value);
        if (projectsRef.current.find(project => project.id === activeProjectIdRef.current)?.kind === "writing") {
            writingSessionRef.current = { ...writingSessionRef.current, pendingAgentExecution: value };
            setWritingSession(current => ({ ...current, pendingAgentExecution: value }));
        }
    }
    function clearCancelledAgentRequestScopes(projectId: string, conversationId?: string) {
        for (const [key, request] of cancelledAgentRequestsRef.current) {
            if (request.projectId !== projectId)
                continue;
            if (conversationId && request.conversationId !== conversationId)
                continue;
            cancelledAgentRequestsRef.current.delete(key);
        }
    }
    function closePendingAgentExecution(requestId?: string, notifyProtocol = true) {
        const pending = pendingAgentExecutionRef.current;
        if (requestId && pending?.requestId !== requestId)
            return;
        if (pending && notifyProtocol) {
            cancelledAgentRequestsRef.current.set(agentRequestScopeKey(pending.projectId, pending.conversationId), {
                projectId: pending.projectId,
                conversationId: pending.conversationId,
                requestId: pending.requestId,
                selectedNodeIds: [...selectedNodeIdsRef.current]
            });
            void window.aieyraAgent?.cancelPendingExecution?.({
                projectId: pending.projectId,
                conversationId: pending.conversationId,
                requestId: pending.requestId
            });
        }
        commitPendingAgentExecution(null);
        setAskUserDraft(null);
        setAskUserMinimized(false);
        setReferencePickerMinimized(false);
        setReferencePickerDraft((current) => current?.target.kind === "agent-request" ? null : current);
        if (pending && projectsRef.current.find(project => project.id === pending.projectId)?.kind === "writing" &&
            activeProjectIdRef.current === pending.projectId) {
            if (projectRunsRef.current[pending.projectId]?.status === "waiting")
                removeProjectRun(pending.projectId);
            if (notifyProtocol)
                void persistWritingAgentMessages(pending.projectId, pending.conversationId, messagesRef.current, () => activeProjectIdRef.current === pending.projectId && activeConversationIdRef.current === pending.conversationId && !pendingAgentExecutionRef.current && !activeRunRef.current).catch(error => setWritingError(describeError(error)));
        }
    }
    function suspendProjectSessionAutosave(durationMs = 1200) {
        projectSessionApplyRef.current += 1;
        const token = projectSessionApplyRef.current;
        const holdMs = Math.max(0, Math.min(5000, Math.floor(Number(durationMs) || 0)));
        window.setTimeout(() => {
            if (projectSessionApplyRef.current === token)
                projectSessionApplyRef.current = 0;
        }, holdMs);
    }
    async function applyProjectSession(result: {
        project?: ProjectRecord;
        projects?: ProjectRecord[];
        activeProjectId?: string;
        session?: WorkflowSession & {
            sessionRevision?: number;
        };
    }) {
        const nextProjectId = result.activeProjectId ?? result.project?.id ?? activeProjectId;
        const nextProjects = result.projects ?? projects;
        const nextProject = result.project ?? nextProjects.find((project) => project.id === nextProjectId);
        const writingMode = nextProject?.kind === "writing" && !nextProject.quarantine?.readOnly;
        const lineageKind = !nextProject?.quarantine?.readOnly && (nextProject?.kind === "data" || nextProject?.kind === "finance")
            ? nextProject.kind
            : null;
        const attachedRun = projectRunsRef.current[nextProjectId];
        const liveAttachedRun = attachedRun && (attachedRun.status === "running" || attachedRun.status === "waiting")
            ? attachedRun
            : null;
        const loadedWritingSession = writingMode ? normalizeWritingRendererSession(result.session) : emptyWritingSession();
        const nextWritingSession = writingMode && liveAttachedRun ? {
            ...loadedWritingSession,
            messages: liveAttachedRun.session.messages,
            activeConversationId: liveAttachedRun.conversationId,
            pendingAgentExecution: liveAttachedRun.pendingExecution
        } : loadedWritingSession;
        const loadedLineageSession = lineageKind
            ? await normalizeLineageRendererSession(result.session, lineageKind)
            : emptyLineageRendererSession();
        const nextLineageSession = lineageKind && liveAttachedRun ? {
            ...loadedLineageSession,
            messages: liveAttachedRun.session.messages,
            activeConversationId: liveAttachedRun.conversationId,
            pendingAgentExecution: liveAttachedRun.pendingExecution
        } : loadedLineageSession;
        const typedSession = writingMode ? nextWritingSession : lineageKind ? nextLineageSession : null;
        const nextSession = normalizeWorkflowSession(typedSession ? {
            schemaVersion: 3,
            messages: typedSession.messages,
            conversations: typedSession.conversations,
            activeConversationId: typedSession.activeConversationId,
            nodes: [],
            layoutGroups: [],
            selectedNodeId: "",
            pendingAgentExecution: typedSession.pendingAgentExecution,
            sessionRevision: typedSession.sessionRevision
        } : liveAttachedRun?.session ?? result.session, {
            preserveRuntimeState: Boolean(liveAttachedRun)
        });
        if (typedSession)
            typedSession.activeConversationId = nextSession.activeConversationId;
        const restoredPending = nextSession.pendingAgentExecution &&
            nextSession.pendingAgentExecution.projectId === nextProjectId &&
            nextSession.pendingAgentExecution.conversationId === nextSession.activeConversationId
            ? nextSession.pendingAgentExecution
            : null;
        if (!initialProjectTabsAppliedRef.current) {
            initialProjectTabsAppliedRef.current = true;
            if (nextProjectId === "default" && nextProjects.length === 1 && nextProject?.kind === "image"
                && !nextSession.nodes.length && !nextSession.messages.some(message => message.role === "user")
                && !restoredPending && !attachedRun) {
                setProjectTabPreferences(current => ({ ...current, closed: [...new Set([...current.closed, "default"])] }));
            }
        }
        activeRunRef.current = liveAttachedRun?.status === "running" ? liveAttachedRun.runId : null;
        commitExecutionReservation(null);
        cancelTransientCanvasInteractions();
        releaseAllLayerExecutionPlaceholders();
        layerRuntimeScopeEpochRef.current += 1;
        pendingLayerMergeRunsRef.current.clear();
        layerMergeCommitPromisesRef.current.clear();
        completedLayerMergeRunsRef.current.clear();
        pendingLayerNarrationRunIdsRef.current.clear();
        clearLocalToolTimelineScope();
        agentToolNodeCodesRef.current = Object.fromEntries(nextSession.nodes.map(node => [node.id, node.displayCode || node.id]));
        agentToolNodeIdsRef.current = liveAttachedRun
            ? Object.fromEntries(nextSession.nodes.flatMap((node) => {
                const operationIds = [node.generationRunId, node.layerGroup?.toolRunId]
                    .map((value) => String(value || "").trim())
                    .filter(Boolean);
                return operationIds.map((operationId) => [operationId, node.id]);
            }))
            : {};
        suspendProjectSessionAutosave(1200);
        if (activeProjectIdRef.current !== nextProjectId)
            explicitViewportIntentRef.current = "";
        activeProjectIdRef.current = nextProjectId;
        projectSessionRevisionRef.current[nextProjectId] = nextSession.sessionRevision;
        canvasRevisionRef.current = nextSession.canvasRevision;
        nodeSequenceRef.current = nextSession.nodeSequence;
        activeConversationIdRef.current = nextSession.activeConversationId;
        messagesRef.current = nextSession.messages;
        conversationsRef.current = nextSession.conversations;
        nodesRef.current = nextSession.nodes;
        layoutGroupsRef.current = nextSession.layoutGroups;
        setProjects((current) => result.projects ?? current);
        setActiveProjectId(nextProjectId);
        setWritingSession(nextWritingSession);
        writingSessionRef.current = nextWritingSession;
        setLineageSession(nextLineageSession);
        lineageSessionRef.current = nextLineageSession;
        setWritingError("");
        setNodes(nextSession.nodes);
        setLayoutGroups(nextSession.layoutGroups);
        setSelectedNodeId(nextSession.selectedNodeId);
        setMessages(nextSession.messages);
        setConversations(nextSession.conversations);
        setActiveConversationId(nextSession.activeConversationId);
        setAgentStatus(liveAttachedRun?.status === "running" ? liveAttachedRun.runKind === "manual-image" ? "editing" : "thinking" : liveAttachedRun?.status === "error" ? "error" : "idle");
        setAgentProgress(liveAttachedRun?.progress ?? []);
        setActiveNodeId(null);
        flashNewCanvasNodes([]);
        const restoredImageRunStarts = { ...projectImageRunStarts(nextProjectId) };
        imageRunStartsRef.current = restoredImageRunStarts;
        setImageRunStarts(restoredImageRunStarts);
        setViewport(initialViewport);
        viewportRef.current = initialViewport;
        setFileMenuOpen(false);

        setManualImageTaskDialog(null);
        setRequirementReferenceMenu(null);
        setLayeredImageTaskDialog(null);
        setCanvasMenu(null);
        setAssetContextMenu(null);
        setImageViewer(null);
        setLayerViewer(null);
        setActiveLayerSurface(null);
        setRegionRedrawDraft(null);
        regionRedrawDraftRef.current = null;
        setNodeEditorDraft(null);
        const restoredPickerRole: AssetTaskRole | null = restoredPending?.kind === "source_images"
            ? "source"
            : restoredPending?.kind === "reference_images"
                ? "reference"
                : null;
        const restoredPickerCandidates = restoredPending && restoredPickerRole
            ? canvasReferencePickerCandidates(nextSession.nodes, restoredPickerRole, [restoredPending.focusedNodeId || "", ...restoredPending.sourceNodeIds, nextSession.selectedNodeId].filter(Boolean))
            : [];
        setReferencePickerDraft(restoredPending && (restoredPending.kind === "source_images" || restoredPending.kind === "reference_images")
            ? {
                target: {
                    kind: "agent-request",
                    requestId: restoredPending.requestId,
                    role: restoredPending.kind === "source_images" ? "source" : "reference",
                    question: restoredPending.question,
                    suggestedAnswer: restoredPending.suggestedAnswer
                },
                title: restoredPending.title,
                detail: restoredPending.detail || restoredPending.question,
                images: [],
                max: restoredPending.maxImages ?? (restoredPending.kind === "source_images" ? MAX_AGENT_SOURCE_IMAGES : MAX_REFERENCE_IMAGES),
                canvasCandidates: restoredPickerCandidates,
                selectedCanvasCandidateIds: []
            }
            : null);
        setReferencePickerMinimized(false);
        setAskUserDraft(restoredPending && (restoredPending.kind === "clarify" || restoredPending.kind === "confirm")
            ? {
                requestId: restoredPending.requestId,
                kind: restoredPending.kind,
                title: restoredPending.title,
                question: restoredPending.question,
                detail: restoredPending.detail,
                suggestedAnswer: restoredPending.suggestedAnswer,
                options: sanitizeAgentAskUserOptions(restoredPending.options)
            }
            : null);
        setAskUserMinimized(false);
        commitPendingAgentExecution(restoredPending);
        setQuotaDialog(null);
        setConfirmDialog(null);
    }
    const visibleProjects = projects.filter(project => project.kind === "image" && !project.quarantine?.readOnly);
    const populatedProjects = visibleProjects.filter(project => project.id === activeProjectId
        ? Boolean(project.matrixProjectId) || nodes.length > 0 || messages.some(message => message.role === "user") || conversations.some(conversation => conversation.messages.length > 0) || projectHasImageWork(project.id)
        : project.empty !== true);
    const activeProject = visibleProjects.find((item) => item.id === activeProjectId) ?? visibleProjects[0];
    const activeProjectName = activeProject?.name ?? "项目";
    const activeWritingPatchProposal = writingPatchProposals[activeProject?.id || ""]?.[0];
    const canvasSelectionSummary = useMemo(() => {
        if (!selectedNodes.length)
            return null;
        if (selectedNodes.length === 1) {
            const node = selectedNodes[0];
            const title = nodeWorkName(node);
            const typeLabel = node.layerGroup
                ? "PNG 图层"
                : node.layerComposition
                    ? "分层合成"
                    : node.imageContainer
                        ? "图片容器"
                        : node.imageCollection
                            ? "图片组"
                            : node.type === "requirement" ? "可复用需求" : node.type === "image" ? "图片成果" : "成果节点";
            const detail = node.layerGroup
                ? `分层 PNG #${String(node.layerGroup.groupNumber).padStart(3, "0")} · 第 ${node.layerGroup.order}/${node.layerGroup.total} 层`
                : node.type === "requirement"
                    ? `${typeLabel} · ${node.requirement?.inputBindings?.length || node.parentId ? "已连接图片" : "文字需求"}`
                    : node.imageContainer || node.imageCollection
                        ? `${typeLabel} · ${Math.max(0, node.assets?.length ?? 0)} 张`
                        : typeLabel;
            return {
                kind: "single",
                title,
                detail,
                fullText: `${title} · ${detail}`
            };
        }
        const titles = selectedNodes.map((node) => nodeWorkName(node));
        return {
            kind: "multiple",
            title: `${selectedNodes.length} 个成果`,
            detail: `${selectedNodes.reduce((total, node) => total + (node.assets?.length || 0), 0)} 张图片`,
            fullText: `${selectedNodes.length} 个成果 · ${titles.join("、")}`
        };
    }, [selectedCanvasCapabilities, selectedNodes]);
    async function flushActiveProjectSession() {
        if (!configReady)
            return;
        const projectId = activeProjectIdRef.current || activeProjectId || "default";
        const project = projectsRef.current.find((item) => item.id === projectId);
        if (!project || project.quarantine?.readOnly)
            return;
        if (project?.kind === "writing") {
            const moduleState = await window.aieyraModules.status();
            if (moduleState.status?.state !== "installed")
                return;
            const beforeCommit = writingSessionRef.current;
            const session = activeProjectIdRef.current === projectId ? writingSessionRef.current : beforeCommit;
            await persistWritingSessionState(projectId, session);
            return;
        }
        if (project?.kind === "data" || project?.kind === "finance") {
            const tracked = projectRunsRef.current[projectId];
            if (tracked?.status === "running" || tracked?.status === "waiting")
                return;
            await persistLineageSessionState(projectId, lineageSessionRef.current);
            return;
        }
        const capture = () => buildWorkflowSessionSnapshot({
            schemaVersion: 3,
            nodeSequence: nodeSequenceRef.current,
            canvasRevision: canvasRevisionRef.current,
            layoutGroups: layoutGroupsRef.current,
            messages: messagesRef.current,
            conversations: conversationsRef.current,
            activeConversationId: activeConversationIdRef.current,
            nodes: nodesRef.current,
            selectedNodeId: selectedNodeIdRef.current,
            pendingAgentExecution: pendingAgentExecutionRef.current
        });
        const beforeCommit = capture();
        await awaitProjectRuntimeCommits(projectId);
        const snapshot = activeProjectIdRef.current === projectId ? capture() : projectRunsRef.current[projectId]?.session || beforeCommit;
        await persistProjectSession(projectId, snapshot);
        const trackedAfterFlush = projectRunsRef.current[projectId];
        if (trackedAfterFlush && (trackedAfterFlush.status === "running" || trackedAfterFlush.status === "waiting") && activeProjectIdRef.current === projectId) {
            const latest = capture();
            updateProjectRun(projectId, current => ({ ...current, session: { ...current.session,
                    nodes: latest.nodes, layoutGroups: latest.layoutGroups, canvasRevision: latest.canvasRevision,
                    nodeSequence: latest.nodeSequence, selectedNodeId: latest.selectedNodeId } }));
        }
        if (trackedAfterFlush && trackedAfterFlush.status !== "running" && trackedAfterFlush.status !== "waiting") {
            if (activeProjectIdRef.current === projectId) {
                updateProjectRun(projectId, (current) => ({ ...current, session: snapshot, pendingExecution: snapshot.pendingAgentExecution }));
            }
            else {
                removeProjectRun(projectId);
            }
        }
    }
    const saveBeforeWindowClose = useStableEvent(async () => {
        try {
            await videoFlushRef.current?.();
            await flushActiveProjectSession();
            await flushComposerDrafts();
        }
        catch (error) {
            const message = `尚未关闭：${describeError(error)}。请保留草稿，处理后再关闭。`;
            setServerMessage(message);
            if (projectsRef.current.find(project => project.id === activeProjectIdRef.current)?.kind === "writing")
                setWritingError(message);
            throw error;
        }
    });
    useEffect(() => window.aieyraConfig?.onWindowCloseRequest?.(saveBeforeWindowClose), [saveBeforeWindowClose]);
    function captureActiveProjectRunSession() {
        const projectId = activeProjectIdRef.current || activeProjectId || "default";
        const record = projectRunsRef.current[projectId];
        if (!record)
            return;
        const snapshot = buildWorkflowSessionSnapshot({
            schemaVersion: 3,
            nodeSequence: nodeSequenceRef.current,
            canvasRevision: canvasRevisionRef.current,
            layoutGroups: layoutGroupsRef.current,
            messages: messagesRef.current,
            conversations: conversationsRef.current,
            activeConversationId: activeConversationIdRef.current,
            nodes: nodesRef.current,
            selectedNodeId: selectedNodeIdRef.current,
            pendingAgentExecution: pendingAgentExecutionRef.current
        });
        publishProjectRun({ ...record, session: snapshot, pendingExecution: snapshot.pendingAgentExecution });
    }
    async function activateProjectRun(projectId: string) {
        const record = projectRunsRef.current[projectId];
        if (!record || record.status === "cancelled")
            return;
        const runningStatus: AgentStatus = record.runKind === "manual-image" ? "editing" : "thinking";
        const projectKind = projects.find((project) => project.id === projectId)?.kind;
        if (projectKind === "writing" || projectKind === "data" || projectKind === "finance") {
            activeRunRef.current = record.status === "running" ? record.runId : null;
            setAgentProgress(record.progress);
            setAgentStatus(record.status === "running" ? runningStatus : record.status === "error" ? "error" : "idle");
            if (record.status === "completed")
                removeProjectRun(projectId);
            return;
        }
        const queuedActions = record.queuedActions.filter((action) => ![
            "ui.ask_user.open",
            "ui.source_images.open",
            "ui.reference_images.open"
        ].includes(action.type));
        const appliedActionFingerprints = new Map(queuedActions.map((action) => [projectRunActionKey(action), projectRunActionFingerprint(action)]));
        if (queuedActions.length) {
            activeRunRef.current = record.runId;
            setAgentStatus("editing");
            try {
                const application = await applyRuntimeActions(queuedActions);
                const unfinished = application.commits.find(commit => commit.status !== "done");
                if (unfinished)
                    throw new Error(unfinished.summary || "后台成果尚未提交完成。");
                await applyTaskResultLayout(record.taskScope, new Set(record.existingNodeIds), record.runId, record.projectId, record.conversationId);
                await waitForRendererRuntimeCommit();
            }
            catch (error) {
                const message = describeError(error);
                updateProjectRun(projectId, (current) => ({ ...current, status: "error", error: message }));
                setAgentStatus("error");
                setServerMessage(`后台项目成果提交失败：${message}`);
                activeRunRef.current = null;
                return;
            }
        }
        const latest = projectRunsRef.current[projectId] || record;
        activeRunRef.current = latest.status === "running" ? latest.runId : null;
        setAgentStatus(latest.status === "running" ? runningStatus : latest.status === "error" ? "error" : "idle");
        const snapshot = buildWorkflowSessionSnapshot({
            ...latest.session,
            nodeSequence: nodeSequenceRef.current,
            canvasRevision: canvasRevisionRef.current,
            nodes: nodesRef.current,
            layoutGroups: layoutGroupsRef.current,
            selectedNodeId: selectedNodeIdRef.current,
            messages: messagesRef.current,
            conversations: conversationsRef.current,
            activeConversationId: activeConversationIdRef.current,
            pendingAgentExecution: latest.pendingExecution
        });
        try {
            await persistProjectSession(projectId, snapshot);
            if (latest.completionJobIds?.length && latest.status !== "running") {
                await acknowledgeImageReceipts(latest.completionJobIds, projectId, latest.conversationId);
            }
        }
        catch (error) {
            updateProjectRun(projectId, current => ({ ...current, status: "error", session: snapshot, error: describeError(error) }));
            setServerMessage(`项目结果暂未保存完成：${describeError(error)}`);
            return;
        }
        const finalLatest = projectRunsRef.current[projectId] || latest;
        const remainingActions = finalLatest.queuedActions.filter((action) => (!["ui.ask_user.open", "ui.source_images.open", "ui.reference_images.open"].includes(action.type) &&
            appliedActionFingerprints.get(projectRunActionKey(action)) !== projectRunActionFingerprint(action)));
        if (finalLatest.status === "running") {
            activeRunRef.current = finalLatest.runId;
            setAgentStatus(runningStatus);
            publishProjectRun({ ...finalLatest, queuedActions: remainingActions, session: snapshot });
            return;
        }
        activeRunRef.current = null;
        setAgentStatus(finalLatest.status === "error" ? "error" : "idle");
        const manualImageResult = finalLatest.runKind === "manual-image"
            ? [...nodesRef.current].reverse().find((node) => (node.type === "image" &&
                (node.generationRunId === finalLatest.runId || node.id === finalLatest.session.selectedNodeId)))
            : null;
        if (manualImageResult) {
            replaceSelectedNodeId(manualImageResult.id);
            setActiveNodeId(manualImageResult.id);
            focusWorkflowNode(manualImageResult, { recordEvent: false, selectNode: false });
            window.setTimeout(() => {
                if (activeProjectIdRef.current === projectId)
                    setActiveNodeId(null);
            }, 900);
        }
        if (finalLatest.status === "completed") {
            removeProjectRun(projectId);
            setAgentProgress([]);
        }
        else {
            publishProjectRun({ ...finalLatest, queuedActions: remainingActions, session: snapshot });
        }
    }
    function executionScopeBoundaryBlocked(allowPendingCancellation = false, allowProjectTransition = false) {
        if (allowProjectTransition && document.querySelector('.coding-workbench[data-recovery-blocked="true"]')) {
            setServerMessage("请先完成文件导入或处理尚未保存的连接信息，再切换画布。");
            return true;
        }
        if (!allowProjectTransition && projectHasImageWork(activeProjectIdRef.current)) {
            setServerMessage("图片仍在后台生成，请先停止绘图后再重置或移动项目数据。");
            return true;
        }
        if (!agentExecutionBusyNow())
            return false;
        const currentRun = trackedProjectRun();
        if (allowProjectTransition && currentRun && ["completed", "error"].includes(currentRun.status))
            return false;
        if (allowProjectTransition && pendingAgentExecutionRef.current && !agentActiveWorkNow())
            return false;
        if (allowPendingCancellation && pendingAgentExecutionRef.current && !agentActiveWorkNow())
            return false;
        setServerMessage("Agent 当前任务尚未结束，请先完成、回答或停止任务，再切换项目或重置会话。");
        return true;
    }
    // 第109轮 R15：没有画布时直接建默认画布；已有画布时重开它；多个旧项目且没有可用的活动画布时，
    // 打开历史项目让用户选定，不按「取第一个」猜测。
    async function startCanvas() {
        if (fileActionBusyRef.current || projectRecoveryBusy)
            return;
        const usable = projectsRef.current.filter(p => p.kind === "image" && !p.quarantine?.readOnly);
        const current = usable.find(p => p.id === activeProjectIdRef.current);
        if (current) {
            setProjectTabPreferences(value => openProjectTab(value, current.id));
            return;
        }
        if (usable.length === 1) {
            await switchProject(usable[0].id);
            return;
        }
        if (usable.length > 1) {
            setProjectHistoryOpen(true);
            void refreshAvailableProjects();
            return;
        }
        await createProject("画布", "image");
    }
    async function createProject(name: string, kind = projectNameDraft?.kind ?? "image", template = projectNameDraft?.template) {
        if (fileActionBusyRef.current || executionScopeBoundaryBlocked(false, true))
            return;
        const fallbackName = `项目 ${projects.length + 1}`;
        const projectName = name.trim() || fallbackName;
        commitFileActionBusy(true);
        projectTransitionRef.current = true;
        try {
            await flushActiveProjectSession();
            const result = await window.aieyraConfig?.createProject?.({ name: projectName, kind, template });
            if (!result?.ok)
                throw new Error(result?.error ?? "创建项目失败。");
            setProjectNameDraft(null);
            await applyProjectSession(result);
            setProjectTabPreferences((current) => openProjectTab(current, activeProjectIdRef.current));
            await activateProjectRun(result.activeProjectId ?? result.project?.id ?? activeProjectIdRef.current);
            addEvent(`创建项目 ${result.project?.name ?? projectName}`);
        }
        catch (error) {
            pushSystemMessage("project", `创建项目失败：${describeError(error)}`);
        }
        finally {
            projectTransitionRef.current = false;
            commitFileActionBusy(false);
        }
    }
    function openRenameProjectDialog(id = activeProjectIdRef.current) {
        const project = projectsRef.current.find((item) => item.id === id);
        if (fileActionBusyRef.current || !project)
            return;
        setProjectNameDraft({ mode: "rename", id: project.id, name: project.name });
        setFileMenuOpen(false);
    }
    async function renameProject(name: string) {
        if (fileActionBusyRef.current)
            return;
        const targetId = projectNameDraft?.id ?? activeProjectId;
        const projectName = name.trim();
        if (!targetId || !projectName)
            return;
        commitFileActionBusy(true);
        try {
            const result = await window.aieyraConfig?.renameProject?.({ id: targetId, name: projectName });
            if (!result?.ok)
                throw new Error(result?.error ?? "重命名项目失败。");
            setProjectNameDraft(null);
            if (result.projects)
                setProjects(result.projects);
            addEvent(`重命名项目 ${result.project?.name ?? projectName}`);
        }
        catch (error) {
            pushSystemMessage("project", `重命名项目失败：${describeError(error)}`);
        }
        finally {
            commitFileActionBusy(false);
        }
    }
    async function createProjectFolder(name = `项目 ${projects.length + 1}`, kind = projectNameDraft?.kind ?? "image", template = projectNameDraft?.template) {
        if (fileActionBusyRef.current || executionScopeBoundaryBlocked(false, true))
            return;
        commitFileActionBusy(true);
        projectTransitionRef.current = true;
        try {
            await flushActiveProjectSession();
            const result = await window.aieyraConfig?.createProjectFolder?.({ name: name.trim() || `项目 ${projects.length + 1}`, kind, template });
            if (!result?.ok)
                throw new Error(result?.error ?? "新建项目文件夹失败。");
            if (!result.canceled) {
                setProjectNameDraft(null);
                await applyProjectSession(result);
                setProjectTabPreferences((current) => openProjectTab(current, activeProjectIdRef.current));
                await activateProjectRun(result.activeProjectId ?? result.project?.id ?? activeProjectIdRef.current);
                addEvent(`新建项目文件夹 ${result.path ?? result.project?.path ?? ""}`);
            }
        }
        catch (error) {
            pushSystemMessage("project", `新建项目文件夹失败：${describeError(error)}`);
        }
        finally {
            projectTransitionRef.current = false;
            commitFileActionBusy(false);
            setFileMenuOpen(false);
        }
    }
    const projectCleanupBusyRef = useRef(false);
    const projectCleanupCursorRef = useRef(0);
    const checkEmptyProjects = useStableEvent(async () => {
        if (document.hidden || document.body.dataset.visible === "false" || !configReady || projectCleanupBusyRef.current || projectTransitionRef.current || fileActionBusyRef.current || !window.aieyraConfig?.cleanupEmptyProjects)
            return;
        projectCleanupBusyRef.current = true;
        const currentId = activeProjectIdRef.current;
        try {
            const protectedIds = await projectsWithComposerDrafts();
            if (projectTransitionRef.current || fileActionBusyRef.current || currentId !== activeProjectIdRef.current)
                return;
            for (const project of projectsRef.current)
                if (["running", "waiting"].includes(projectRunsRef.current[project.id]?.status) || projectHasImageWork(project.id))
                    protectedIds.add(project.id);
            const ids = projectsRef.current.filter(p => p.id !== currentId && !p.external && !projectTabPreferences.archived.includes(p.id)).map(p => p.id);
            const start = projectCleanupCursorRef.current % Math.max(1, ids.length);
            const batch = [...ids.slice(start), ...ids.slice(0, start)].slice(0, 8);
            projectCleanupCursorRef.current = start + batch.length;
            if (!batch.length)
                return;
            const result = await window.aieyraConfig.cleanupEmptyProjects({ activeProjectId: currentId, ids: batch, protectedIds: [...protectedIds] });
            if (!result.ok || !result.removedIds?.length || projectTransitionRef.current || fileActionBusyRef.current || currentId !== activeProjectIdRef.current)
                return;
            for (const id of result.removedIds)
                removeProjectRun(id);
            projectsRef.current = result.projects || [];
            setProjects(result.projects || []);
        }
        catch { }
        finally {
            projectCleanupBusyRef.current = false;
        }
    });
    useEffect(() => {
        if (!configReady || fileActionBusy)
            return;
        const timer = window.setTimeout(() => { void checkEmptyProjects(); }, 30000);
        const interval = window.setInterval(() => { void checkEmptyProjects(); }, 60000);
        return () => { clearTimeout(timer); clearInterval(interval); };
    }, [configReady, activeProjectId, fileActionBusy, checkEmptyProjects]);
    useEffect(() => {
        if (!configReady || fileActionBusy)
            return;
        const id = projectTabPreferences.archived.find(id => projects.some(p => p.id === id));
        if (id)
            void archiveWorkspaceProject(id);
    }, [configReady, projectTabPreferences.archived]);
    const refreshAvailableProjects = useStableEvent(async () => {
        if (!configReady || projectTransitionRef.current || fileActionBusyRef.current || !window.aieyraConfig?.listProjects)
            return;
        const result = await window.aieyraConfig.listProjects();
        if (!result.ok || projectTransitionRef.current || fileActionBusyRef.current)
            return;
        const next = result.projects || [];
        if (JSON.stringify(next) === JSON.stringify(projectsRef.current))
            return;
        projectsRef.current = next;
        setProjects(next);
    });
    useEffect(() => {
        const refresh = () => { void refreshAvailableProjects(); };
        refresh();
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, [refreshAvailableProjects]);
    async function refreshProjectListAfterRecovery() {
        if (!window.aieyraConfig?.listProjects)
            throw new Error("项目列表接口不可用。");
        const list = await window.aieyraConfig.listProjects();
        if (!list.ok)
            throw new Error(list.error || "刷新项目列表失败。");
        const nextProjects = list.projects || [];
        const nextActiveProjectId = list.activeProjectId || activeProjectIdRef.current || "default";
        projectsRef.current = nextProjects;
        if (activeProjectIdRef.current !== nextActiveProjectId)
            explicitViewportIntentRef.current = "";
        activeProjectIdRef.current = nextActiveProjectId;
        setProjects(nextProjects);
        setActiveProjectId(nextActiveProjectId);
    }
    function recordProjectRecoveryBridgeEvidence(operation: "recover" | "rollback", result: Record<string, unknown>) {
        const keys = Object.keys(result).sort();
        const allowedKeys = new Set([
            "assessment",
            "error",
            "ok",
            "partial",
            "recoveredProjectIds",
            "rolledBackTransactionId"
        ]);
        const projectRecordPayloadPresent = ["project", "projects", "activeProjectId", "path", "sessionPath", "extensions"]
            .some((key) => Object.prototype.hasOwnProperty.call(result, key));
        projectRecoveryBridgeEvidenceRef.current = {
            operation,
            keys,
            safe: !projectRecordPayloadPresent && keys.every((key) => allowedKeys.has(key)),
            projectRecordPayloadPresent
        };
    }
    async function refreshProjectRecoveryAssessment(options: {
        silent?: boolean;
    } = {}) {
        if (!window.aieyraConfig?.assessProjectRecovery || projectRecoveryBusy)
            return;
        if (!options.silent)
            setProjectRecoveryBusy(true);
        try {
            const result = await window.aieyraConfig.assessProjectRecovery();
            if (!result.ok || !result.assessment)
                throw new Error(result.error || "本地项目盘点失败。");
            setProjectRecoveryAssessment(result.assessment);
        }
        catch (error) {
            const message = describeError(error);
            setProjectRecoveryAssessment((current) => ({ ...(current || emptyProjectRecoveryAssessment()), error: message }));
        }
        finally {
            if (!options.silent)
                setProjectRecoveryBusy(false);
        }
    }
    async function recoverLocalProjects(ids: string[]) {
        const assessmentId = projectRecoveryAssessment?.assessmentId || "";
        if (!assessmentId || !window.aieyraConfig?.recoverProjects || projectRecoveryBusy)
            return;
        setProjectRecoveryBusy(true);
        try {
            const result = await window.aieyraConfig.recoverProjects({ assessmentId, ids });
            recordProjectRecoveryBridgeEvidence("recover", result as unknown as Record<string, unknown>);
            if (result.ok || result.partial || (result.recoveredProjectIds?.length || 0) > 0) {
                await refreshProjectListAfterRecovery();
            }
            if (result.assessment) {
                setProjectRecoveryAssessment(result.ok ? result.assessment : { ...result.assessment, error: result.error || "恢复未完成。" });
            }
            else if (!result.ok) {
                setProjectRecoveryAssessment((current) => ({ ...(current || emptyProjectRecoveryAssessment()), error: result.error || "恢复未完成。" }));
            }
            if (!result.ok) {
                setServerMessage(result.error || "本地项目恢复未完成。");
                return;
            }
            const count = result.recoveredProjectIds?.length || ids.length;
            setServerMessage(`已找回 ${count} 个本地项目，原目录与内容保持不动。`);
            addEvent(`找回本地项目 ${count} 个`);
        }
        catch (error) {
            const message = describeError(error);
            setProjectRecoveryAssessment((current) => ({ ...(current || emptyProjectRecoveryAssessment()), error: message }));
            setServerMessage(`本地项目恢复失败：${message}`);
        }
        finally {
            setProjectRecoveryBusy(false);
        }
    }
    async function rollbackLocalProjectRecovery(transactionId: string) {
        if (!window.aieyraConfig?.rollbackProjectRecovery || projectRecoveryBusy)
            return;
        setProjectRecoveryBusy(true);
        try {
            const result = await window.aieyraConfig.rollbackProjectRecovery({ transactionId });
            recordProjectRecoveryBridgeEvidence("rollback", result as unknown as Record<string, unknown>);
            if (result.ok)
                await refreshProjectListAfterRecovery();
            if (result.assessment) {
                setProjectRecoveryAssessment(result.ok ? result.assessment : { ...result.assessment, error: result.error || "回滚未完成。" });
            }
            if (!result.ok) {
                setServerMessage(result.error || "项目已有后续变化，无法安全回滚。");
                return;
            }
            setServerMessage("已撤销本次项目找回，历史目录与字节已恢复。");
            addEvent("回滚本地项目找回");
        }
        catch (error) {
            const message = describeError(error);
            setProjectRecoveryAssessment((current) => ({ ...(current || emptyProjectRecoveryAssessment()), error: message }));
            setServerMessage(`项目找回回滚失败：${message}`);
        }
        finally {
            setProjectRecoveryBusy(false);
        }
    }
    async function openCurrentProjectFolder() {
        if (fileActionBusyRef.current)
            return;
        const requestProjectId = activeProjectIdRef.current || activeProjectId;
        commitFileActionBusy(true);
        try {
            await flushActiveProjectSession();
            const result = await window.aieyraConfig?.openCurrentProjectFolder?.({ id: requestProjectId });
            if (!result?.ok)
                throw new Error(result?.error ?? "打开当前项目文件夹失败。");
            if (result.projectId && result.projectId !== requestProjectId)
                throw new Error("当前项目已经切换，请重新打开项目文件夹。");
            addEvent(`打开当前项目文件夹 ${result.path ?? ""}`);
        }
        catch (error) {
            pushSystemMessage("project", `打开当前项目文件夹失败：${describeError(error)}`);
        }
        finally {
            commitFileActionBusy(false);
            setFileMenuOpen(false);
        }
    }
    async function exportProject() {
        if (fileActionBusyRef.current)
            return;
        commitFileActionBusy(true);
        try {
            await flushActiveProjectSession();
            const result = await window.aieyraConfig?.exportProject?.();
            if (!result?.ok)
                throw new Error(result?.error ?? "导出项目失败。");
            if (!result.canceled) {
                addEvent(`导出项目 ${result.path ?? ""}`);
                setServerMessage(`项目已导出：${result.path ?? ""}`);
            }
        }
        catch (error) {
            pushSystemMessage("project", `导出项目失败：${describeError(error)}`);
        }
        finally {
            commitFileActionBusy(false);
            setFileMenuOpen(false);
        }
    }
    async function importProject() {
        if (fileActionBusyRef.current || executionScopeBoundaryBlocked(false, true))
            return;
        commitFileActionBusy(true);
        projectTransitionRef.current = true;
        try {
            await flushActiveProjectSession();
            const result = await window.aieyraConfig?.importProject?.();
            if (!result?.ok)
                throw new Error(result?.error ?? "导入项目失败。");
            if (!result.canceled) {
                await applyProjectSession(result);
                setProjectTabPreferences((current) => openProjectTab(current, activeProjectIdRef.current));
                await activateProjectRun(result.activeProjectId ?? result.project?.id ?? activeProjectIdRef.current);
                addEvent(`导入项目 ${result.path ?? result.project?.path ?? ""}`);
            }
        }
        catch (error) {
            pushSystemMessage("project", `导入项目失败：${describeError(error)}`);
        }
        finally {
            projectTransitionRef.current = false;
            commitFileActionBusy(false);
            setFileMenuOpen(false);
        }
    }
    function projectManagementBlocked(id: string) {
        return fileActionBusyRef.current || ["running", "waiting"].includes(projectRunsRef.current[id]?.status) || projectHasImageWork(id) || (id === activeProjectIdRef.current && executionScopeBoundaryBlocked());
    }
    async function archiveWorkspaceProject(id: string) {
        if (projectManagementBlocked(id))
            return;
        const project = projectsRef.current.find(item => item.id === id);
        if (!project)
            return;
        commitFileActionBusy(true);
        projectTransitionRef.current = true;
        try {
            await flushActiveProjectSession();
            await flushComposerDrafts();
            const result = await window.aieyraConfig?.archiveProject?.({ id });
            if (!result?.ok)
                throw new Error(result?.error || "归档失败。");
            clearCancelledAgentRequestScopes(id);
            removeProjectRun(id);
            if (id === activeProjectIdRef.current) {
                await applyProjectSession(result);
                setProjectTabPreferences(current => openProjectTab(current, activeProjectIdRef.current));
                await activateProjectRun(activeProjectIdRef.current);
            }
            else if (result.projects) {
                projectsRef.current = result.projects;
                setProjects(result.projects);
            }
            setProjectTabPreferences(current => ({ ...current, archived: current.archived.filter(value => value !== id) }));
            setServerMessage(`已归档“${project.name}”，文件保留在：${project.path}`);
        }
        catch (error) {
            setServerMessage(`归档失败：${describeError(error)}`);
        }
        finally {
            projectTransitionRef.current = false;
            commitFileActionBusy(false);
            setFileMenuOpen(false);
        }
    }
    async function confirmDeleteProjectFolder(id: string) {
        if (projectManagementBlocked(id)) {
            setConfirmDialog(null);
            return;
        }
        const project = projectsRef.current.find(item => item.id === id);
        if (!project) {
            setConfirmDialog(null);
            return;
        }
        commitFileActionBusy(true);
        projectTransitionRef.current = true;
        try {
            await flushActiveProjectSession();
            await flushComposerDrafts();
            const result = await window.aieyraConfig?.deleteProjectFolder?.({ id });
            if (!result?.ok)
                throw new Error(result?.error || "删除项目失败。");
            clearCancelledAgentRequestScopes(id);
            removeProjectRun(id);
            if (id === activeProjectIdRef.current) {
                await applyProjectSession(result);
                setProjectTabPreferences(current => openProjectTab(current, activeProjectIdRef.current));
                await activateProjectRun(activeProjectIdRef.current);
            }
            else if (result.projects) {
                projectsRef.current = result.projects;
                setProjects(result.projects);
            }
            setServerMessage(result.warning || `已删除项目“${project.name}”。`);
        }
        catch (error) {
            setServerMessage(`删除项目失败：${describeError(error)}`);
        }
        finally {
            projectTransitionRef.current = false;
            commitFileActionBusy(false);
            setConfirmDialog(null);
            setFileMenuOpen(false);
        }
    }
    function openConfirmDialog(draft: ConfirmDialogDraft) {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        confirmRestoreFocusRef.current = {
            element: active,
            ariaLabel: active?.getAttribute("aria-label")?.trim() || "",
            text: active?.textContent?.replace(/\s+/g, " ").trim() || ""
        };
        setConfirmDialog(draft);
    }
    function closeConfirmDialog() {
        const restore = confirmRestoreFocusRef.current;
        confirmRestoreFocusRef.current = null;
        setConfirmDialog(null);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            let target = restore?.element?.isConnected ? restore.element : null;
            if (!target && restore?.ariaLabel) {
                target = Array.from(document.querySelectorAll<HTMLElement>("[aria-label]"))
                    .find((element) => element.getAttribute("aria-label")?.trim() === restore.ariaLabel) ?? null;
            }
            if (!target && restore?.text) {
                target = Array.from(document.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"))
                    .find((element) => element.textContent?.replace(/\s+/g, " ").trim() === restore.text) ?? null;
            }
            target?.focus({ preventScroll: true });
        }));
    }
    function submitConfirmDialog() {
        if (!confirmDialog)
            return;
        if (confirmDialog.action === "delete-project-folder") {
            void confirmDeleteProjectFolder(confirmDialog.id);
            return;
        }
        if (confirmDialog.action === "rerun-requirement") {
            const nodeId = confirmDialog.id;
            setConfirmDialog(null);
            executeRequirementNode(nodeId, true);
            return;
        }
        if (confirmDialog.action === "arrange-canvas") {
            const projectId = confirmDialog.id;
            setConfirmDialog(null);
            arrangeCurrentCanvas(projectId);
        }
    }
    async function switchProject(id: string) {
        const targetId = String(id || "").trim();
        if (!targetId || !projectsRef.current.some((project) => project.id === targetId && project.kind === "image" && !project.quarantine?.readOnly))
            return false;
        const transition = async () => {
            if (!targetId || targetId === activeProjectIdRef.current)
                return;
            if (fileActionBusyRef.current && !projectTransitionRef.current)
                return;
            if (executionScopeBoundaryBlocked(false, true))
                return;
            commitFileActionBusy(true);
            projectTransitionRef.current = true;
            try {
                await flushActiveProjectSession();
                const result = await window.aieyraConfig?.switchProject?.({ id: targetId });
                if (!result?.ok)
                    throw new Error(result?.error ?? "切换项目失败。");
                await applyProjectSession(result);
                setProjectTabPreferences((current) => openProjectTab(current, activeProjectIdRef.current));
                await activateProjectRun(result.activeProjectId ?? targetId);
                addEvent(`切换项目 ${result.project?.name ?? targetId}`);
            }
            catch (error) {
                pushSystemMessage("project", `切换项目失败：${describeError(error)}`);
            }
            finally {
                projectTransitionRef.current = false;
                commitFileActionBusy(false);
            }
        };
        const queued = projectSwitchQueueRef.current.then(transition, transition);
        projectSwitchQueueRef.current = queued.then(() => undefined, () => undefined);
        await queued;
        const selected = activeProjectIdRef.current === targetId;
        if (selected)
            setProjectTabPreferences((current) => openProjectTab(current, targetId));
        return selected;
    }
    async function clearProjectConversationAfterReset(projectId: string, conversationId: string) {
        try {
            const cleared = await window.aieyraAgent?.clearConversation?.({ projectId, conversationId });
            if (cleared && cleared.ok === false)
                return cleared.error || "Agent 会话记忆清理失败。";
            return "";
        }
        catch (error) {
            return describeError(error);
        }
        finally {
            clearCancelledAgentRequestScopes(projectId, conversationId);
        }
    }
    async function resetCurrentProject(level: ProjectResetLevel) {
        if (agentActiveWorkNow()) {
            setProjectResetDraft((current) => current ? { ...current, error: "当前项目仍在运行，请先停止任务。" } : current);
            return;
        }
        if (level === "all" && !projectResetDraft?.confirmAll) {
            setProjectResetDraft({ level, confirmAll: true });
            return;
        }
        const projectId = activeProjectIdRef.current || activeProjectId || "default";
        const conversationId = activeConversationIdRef.current;
        setProjectResetDraft({ level, confirmAll: level === "all", busy: true });
        try {
            const resetProject = projects.find((project) => project.id === projectId);
            if (resetProject?.kind === "writing") {
                const result = await window.aieyraWriting?.resetProject({ projectId, level });
                if (!result?.ok)
                    throw new Error(result?.error || "重置 Writing 项目失败。");
                applyWritingBridgeResult(result);
                activeRunRef.current = null;
                removeProjectRun(projectId);
                commitExecutionReservation(null);
                closePendingAgentExecution(undefined, false);
                messagesRef.current = [];
                conversationsRef.current = [];
                setMessages([]);
                setConversations([]);
                setAgentStatus("idle");
                setAgentProgress([]);
                setWritingError("");
                setProjectResetDraft(null);
                const memoryWarning = await clearProjectConversationAfterReset(projectId, conversationId);
                const label = level === "conversation" ? "会话与历史" : level === "canvas" ? "会话与写作画布" : "项目会话、画布及托管文档";
                setServerMessage(`已重置${label}。${memoryWarning ? ` Agent 经验清理需重试：${memoryWarning}` : ""}`);
                addEvent(`重置项目 ${activeProjectName} · ${label}`);
                return;
            }
            if (resetProject?.kind === "data" || resetProject?.kind === "finance") {
                const result = await window.aieyraLineage?.resetProject({ projectId, level });
                if (!result?.ok)
                    throw new Error(result?.error || "重置 Lineage 项目失败。");
                await applyLineageBridgeResult(result, resetProject.kind, projectId);
                activeRunRef.current = null;
                removeProjectRun(projectId);
                commitExecutionReservation(null);
                closePendingAgentExecution(undefined, false);
                messagesRef.current = [];
                conversationsRef.current = [];
                setMessages([]);
                setConversations([]);
                setAgentStatus("idle");
                setAgentProgress([]);
                setProjectResetDraft(null);
                const memoryWarning = await clearProjectConversationAfterReset(projectId, conversationId);
                const label = level === "conversation" ? "会话与历史" : level === "canvas" ? "会话与 lineage 画布" : "项目会话、画布及托管数据";
                setServerMessage(`已重置${label}。${memoryWarning ? ` Agent 经验清理需重试：${memoryWarning}` : ""}`);
                addEvent(`重置项目 ${activeProjectName} · ${label}`);
                return;
            }
            const clearCanvas = level !== "conversation";
            const nextNodes = clearCanvas ? [] : nodesRef.current;
            const nextGroups = clearCanvas ? [] : layoutGroupsRef.current;
            const nextSelectedNodeId = clearCanvas ? "" : selectedNodeIdRef.current;
            const nextNodeSequence = clearCanvas ? 0 : nodeSequenceRef.current;
            const nextCanvasRevision = clearCanvas ? Math.max(1, canvasRevisionRef.current + 1) : canvasRevisionRef.current;
            const snapshot = buildWorkflowSessionSnapshot({
                schemaVersion: 3,
                nodeSequence: nextNodeSequence,
                canvasRevision: nextCanvasRevision,
                layoutGroups: nextGroups,
                messages: [],
                conversations: [],
                activeConversationId: conversationId,
                nodes: nextNodes,
                selectedNodeId: nextSelectedNodeId,
                pendingAgentExecution: null
            });
            await persistProjectSession(projectId, snapshot, { allowEmptyOverwrite: true });
            let managedCleanupWarning = "";
            if (level === "all") {
                const removed = await window.aieyraConfig?.resetProjectData?.({ id: projectId });
                if (!removed?.ok)
                    managedCleanupWarning = removed?.error || "清理项目托管输出失败。";
            }
            activeRunRef.current = null;
            removeProjectRun(projectId);
            commitExecutionReservation(null);
            failAllLayerExecutionPlaceholders("项目已重置，未完成的分层提交已停止。");
            clearLocalToolTimelineScope();
            closePendingAgentExecution(undefined, false);
            messagesRef.current = [];
            conversationsRef.current = [];
            setMessages([]);
            setConversations([]);
            setAgentStatus("idle");
            setAgentProgress([]);
            commitAgentSourceImages([]);
            commitAgentReferenceImages([]);

            if (clearCanvas) {
                nodesRef.current = [];
                layoutGroupsRef.current = [];
                nodeSequenceRef.current = nextNodeSequence;
                canvasRevisionRef.current = nextCanvasRevision;
                setNodes([]);
                setLayoutGroups([]);
                replaceSelectedNodeId("");
                setActiveNodeId(null);
                setImageViewer(null);
                setLayerViewer(null);
                setNodeEditorDraft(null);
                setCanvasMenu(null);
                setAssetContextMenu(null);
            }
            setProjectResetDraft(null);
            const memoryWarning = await clearProjectConversationAfterReset(projectId, conversationId);
            const label = level === "conversation" ? "本项目本地记录" : level === "canvas" ? "本项目本地记录与画布" : "本项目本地记录、画布及托管输出";
            const warnings = [managedCleanupWarning, memoryWarning ? `Agent 经验清理需重试：${memoryWarning}` : ""].filter(Boolean);
            setServerMessage(`已重置${label}。画布 Agent 的跨项目聊天历史保留。${warnings.length ? ` ${warnings.join("；")}` : ""}`);
            addEvent(`重置项目 ${activeProjectName} · ${label}`);
            window.setTimeout(() => agentInputRef.current?.focus(), 0);
        }
        catch (error) {
            setProjectResetDraft((current) => ({
                ...(current || { level }),
                level,
                confirmAll: level === "all",
                busy: false,
                error: describeError(error)
            }));
        }
    }
    function closeAllCanvasMenus() {
        setCanvasMenu(null);
        setAssetContextMenu(null);
        setRequirementReferenceMenu(null);
    }
    function openCanvasMenu(event: React.MouseEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement;
        if (target.closest(".flow-node, .canvas-suggested-action"))
            return;
        event.preventDefault();
        closeAllCanvasMenus();
        const selection = currentNodeSelection();
        if (nodeSelectionMode(selection) === "multiple") {
            setCanvasMenu({
                kind: "selection",
                x: Math.round(clamp(event.clientX, 8, Math.max(8, window.innerWidth - 276))),
                y: Math.round(clamp(event.clientY, 8, Math.max(8, window.innerHeight - 390))),
                nodeIds: [...selection.ids],
                primaryId: selection.primaryId
            });
            return;
        }
        const point = clientToWorld(event.clientX, event.clientY);
        setCanvasMenu({
            kind: "canvas",
            x: Math.round(clamp(event.clientX, 8, Math.max(8, window.innerWidth - 248))),
            y: Math.round(clamp(event.clientY, 8, Math.max(8, window.innerHeight - 292))),
            worldX: Math.round(point.x),
            worldY: Math.round(point.y)
        });
    }
    function openNodeMenuAt(node: WorkflowNode, x: number, y: number, scenarioOpen = false) {
        closeAllCanvasMenus();
        const selection = currentNodeSelection();
        if (nodeSelectionMode(selection) === "multiple") {
            setCanvasMenu({
                kind: "selection",
                x: Math.round(clamp(x, 8, Math.max(8, window.innerWidth - 276))),
                y: Math.round(clamp(y, 8, Math.max(8, window.innerHeight - 390))),
                nodeIds: [...selection.ids],
                primaryId: selection.primaryId
            });
            return;
        }
        setSelectedNodeId(node.id);
        const estimatedHeight = node.layerGroup ? 620 : 430;
        setCanvasMenu({
            kind: "node",
            x: Math.round(clamp(x, 8, Math.max(8, window.innerWidth - 248))),
            y: Math.round(clamp(y, 8, Math.max(8, window.innerHeight - estimatedHeight - 8))),
            nodeId: node.id,
            scenarioOpen
        });
    }
    function openNodeMenu(event: React.MouseEvent<HTMLDivElement>, node: WorkflowNode) {
        event.preventDefault();
        event.stopPropagation();
        openNodeMenuAt(node, event.clientX, event.clientY);
    }
    useEffect(() => {
        const editableTarget = canvasPlatformEditableTarget;
        const blockingSurfaceOpen = Boolean(
            manualImageTaskDialog ||
            layeredImageTaskDialog ||
            confirmDialog ||
            imageViewer ||
            layerViewer ||
            regionRedrawDraft ||
            nodeEditorDraft ||
            referencePickerDraft ||
            (askUserDraft && !askUserMinimized) ||
            quotaDialog ||
            projectNameDraft);
        const handleCanvasShortcut = (event: KeyboardEvent) => {
            if (!event.defaultPrevented && event.key === "Escape" && (canvasMenu || assetContextMenu)) {
                event.preventDefault();
                setCanvasMenu(null);
                setAssetContextMenu(null);
                return;
            }
            if (!projectWorkspaceOpen || event.defaultPrevented || editableTarget(event.target) || (event.target instanceof Element && event.target.closest('[role="tablist"], [role="menu"]')))
                return;
            const key = event.key.toLowerCase();
            const command = event.ctrlKey || event.metaKey;
            if (event.key === "Escape") {
                if (fileMenuOpen) {
                    event.preventDefault();
                    setFileMenuOpen(false);
                    return;
                }
                if (!blockingSurfaceOpen && selectedNodeIdsRef.current.length) {
                    event.preventDefault();
                    selectCanvas();
                }
                return;
            }
            if (blockingSurfaceOpen || fileMenuOpen)
                return;
            if (command && key === "a") {
                event.preventDefault();
                const ids = canvasNodesRef.current.map((node) => node.id);
                selectNodeGroup(ids, ids.includes(selectedNodeIdRef.current) ? selectedNodeIdRef.current : ids[0]);
                setCanvasMenu(null);
                return;
            }
            if (command && key === "g") {
                event.preventDefault();
                if (event.shiftKey)
                    dissolveSelectedImageContainers();
                else
                    mergeSelectedIntoImageContainer();
                return;
            }
            if (command && key === "z") {
                event.preventDefault();
                undoCanvasCommand();
                return;
            }
            if (!command && (event.key === "Delete" || event.key === "Backspace")) {
                if (!selectedNodeIdsRef.current.length)
                    return;
                event.preventDefault();
                deleteSelectedCanvasNodes();
                return;
            }
            if (!command && event.key.startsWith("Arrow") && selectedNodeIdsRef.current.length) {
                const distance = event.shiftKey ? 10 : 1;
                const delta = event.key === "ArrowLeft"
                    ? [-distance, 0]
                    : event.key === "ArrowRight"
                        ? [distance, 0]
                        : event.key === "ArrowUp"
                            ? [0, -distance]
                            : [0, distance];
                event.preventDefault();
                nudgeSelectedCanvasNodes(delta[0], delta[1]);
                return;
            }
            if (!command && event.key === "0") {
                event.preventDefault();
                fitCanvas();
                return;
            }
            if (!command && event.key === "Enter" && selectedNodeIdsRef.current.length === 1) {
                const projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
                const selectedId = projection.groupByMember.get(selectedNodeIdsRef.current[0])?.hostNodeId ?? selectedNodeIdsRef.current[0];
                const node = nodesRef.current.find((candidate) => candidate.id === selectedId);
                if (node) {
                    event.preventDefault();
                    if (node.type === "requirement")
                        openRequirementEditor(node);
                    else
                        openNodeEditor(node);
                }
            }
        };
        window.addEventListener("keydown", handleCanvasShortcut);
        return () => window.removeEventListener("keydown", handleCanvasShortcut);
    }, [
        projectWorkspaceOpen,

        askUserDraft,
        askUserMinimized,
        assetContextMenu,
        canvasMenu,
        confirmDialog,

        fileMenuOpen,
        imageViewer,
        layerViewer,
        manualImageTaskDialog,
        layeredImageTaskDialog,
        nodeEditorDraft,
        projectNameDraft,

        quotaDialog,
        referencePickerDraft,
        regionRedrawDraft,

    ]);
    function openNodeNote(node: WorkflowNode, event: React.MouseEvent<HTMLElement>, assetIndex?: number) {
        setCanvasMenu(null);
        const anchor = event.currentTarget;
        const rect = anchor.getBoundingClientRect();
        const point = event.detail === 0 ? { x: rect.left, y: rect.bottom } : { x: event.clientX, y: event.clientY };
        setNodeNoteDraft({ nodeId: node.id, assetIndex, anchor, point, note: assetIndex === undefined ? node.note || "" : node.assets?.[assetIndex]?.note || "" });
    }
    function saveNodeNote(note: string) {
        if (!nodeNoteDraft)
            return;
        const { nodeId, assetIndex } = nodeNoteDraft;
        const normalized = note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
        setNodes(current => current.map(node => node.id !== nodeId ? node : assetIndex === undefined
            ? { ...node, note: normalized }
            : { ...node, assets: node.assets?.map((asset, index) => index === assetIndex ? { ...asset, note: normalized } : asset) }));
        setNodeNoteDraft(null);
    }
    function openNodeEditor(node: WorkflowNode, requestedAssetIndex = 0) {
        setSelectedNodeId(node.id);
        setCanvasMenu(null);
        const assetIndex = clamp(Number(requestedAssetIndex || 0), 0, Math.max(0, (node.assets?.length ?? 1) - 1));
        const asset = node.assets?.[assetIndex];
        const collectionItem = imageCollectionItemForAsset(node, assetIndex) ?? node.imageCollection?.items[assetIndex];
        setNodeEditorDraft({
            nodeId: node.id,
            assetIndex,
            title: collectionItem?.title || asset?.title || node.title || nodeWorkName(node),
            prompt: collectionItem?.prompt || asset?.prompt || asset?.revisedPrompt || node.imageParams?.prompt || firstPromptLine(node.prompt) || node.prompt || "",
            note: asset?.note || node.note || "",
            discardArmed: false
        });
        addEvent(`打开成果编辑器 ${node.id}`);
    }
    function saveNodeEditorDraft(closeAfterSave = true) {
        const draft = nodeEditorDraft;
        if (!draft)
            return null;
        const node = nodesRef.current.find((item) => item.id === draft.nodeId);
        if (!node) {
            setNodeEditorDraft({ ...draft, error: "这个成果已不存在。" });
            return null;
        }
        const title = draft.title.trim() || node.title || nodeWorkName(node);
        const visualPrompt = draft.prompt.trim();
        const note = draft.note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        const assetIndex = clamp(Number(draft.assetIndex || 0), 0, Math.max(0, (node.assets?.length ?? 1) - 1));
        setNodes((current) => current.map((item) => {
            if (item.id !== node.id)
                return item;
            if (item.imageCollection && item.assets?.[assetIndex]) {
                const editedAsset = item.assets[assetIndex];
                const editedOccurrenceId = stableImageOccurrenceId(editedAsset, item.id, assetIndex);
                const assets = item.assets.map((asset, index) => index === assetIndex
                    ? { ...asset, title, note: note || undefined, ...(visualPrompt ? { prompt: visualPrompt } : {}) }
                    : asset);
                const imageCollection = {
                    ...cloneImageCollection(item.imageCollection)!,
                    items: item.imageCollection.items.map((collectionItem) => collectionItem.occurrenceId === editedOccurrenceId ||
                        collectionItem.assetIndex === assetIndex + 1
                        ? { ...collectionItem, title, ...(visualPrompt ? { prompt: visualPrompt } : {}) }
                        : collectionItem)
                };
                return withNodeImageCollection({ ...item, assets }, imageCollection);
            }
            return {
                ...item,
                title,
                note: note || undefined,
                ...(item.layerGroup ? { layerGroup: { ...cloneImageLayerNodeGroup(item.layerGroup)!, layerTitle: title } } : {}),
                ...(visualPrompt ? { prompt: visualPrompt } : {}),
                ...(item.imageParams && visualPrompt ? { imageParams: cloneImageTaskDraft({ ...item.imageParams, prompt: visualPrompt }) } : {})
            };
        }));
        addEvent(`保存成果编辑 ${node.id}`);
        if (closeAfterSave)
            setNodeEditorDraft(null);
        return { node, title, visualPrompt, note, assetIndex };
    }
    function continueFromNodeEditor() {
        if (agentExecutionBusyNow()) {
            setServerMessage("Agent 正在执行当前任务；你可以在对话框继续发送补充，其他画布操作请等待本轮完成。");
            return;
        }
        const draft = nodeEditorDraft;
        if (!draft)
            return;
        const saved = saveNodeEditorDraft(false);
        if (!saved)
            return;
        const node = saved.node;
        const visualPrompt = saved.visualPrompt.trim();
        if (node.type !== "image" || !(node.assets?.length ?? 0)) {
            setNodeEditorDraft({ ...draft, error: "当前成果没有可继续生成的来源图片。" });
            return;
        }
        if (!visualPrompt) {
            setNodeEditorDraft({ ...draft, error: "请先填写用于继续生成的完整提示词。" });
            return;
        }
        if (node.layerGroup || node.layerComposition)
            return;
        const sourceAsset = node.assets?.[saved.assetIndex];
        const sourceReference = sourceAsset?.path
            ? [{
                    assetId: sourceAsset.assetId,
                    occurrenceId: sourceAsset.occurrenceId,
                    importBatchId: sourceAsset.importBatchId,
                    importRootId: sourceAsset.importRootId,
                    sourceRelativePath: sourceAsset.sourceRelativePath,
                    sourceRootLabel: sourceAsset.sourceRootLabel,
                    sourceRootKind: sourceAsset.sourceRootKind,
                    contentHash: sourceAsset.contentHash,
                    name: imageAssetName(sourceAsset),
                    path: sourceAsset.path,
                    relativePath: sourceAsset.relativePath,
                    mimeType: mimeTypeFromPath(sourceAsset.path),
                    assetUrl: sourceAsset.assetUrl
                }]
            : [];
        const base = selectedImageDraft(node);
        const task = cloneImageTaskDraft({
            ...base,
            prompt: visualPrompt,
            count: 1,
            referenceImages: mergeReferenceImages(base.referenceImages ?? [], sourceReference, MAX_REFERENCE_IMAGES)
        });
        setNodeEditorDraft(null);
        void runManualImageTask(task, { forkFromNodeId: node.id, requestedCount: 1, targetTotal: 1, quotaChecked: false });
        notifyAgentOfManualAction("从成果编辑器继续生图", `用户编辑了成果 ${node.id} 的完整提示词，并按该提示词继续生成。`);
    }
    function updateRequirementNode(nodeId: string, updater: (requirement: CanvasRequirement) => CanvasRequirement) {
        let changed = false;
        const nextNodes = nodesRef.current.map((node) => {
            if (node.id !== nodeId || node.type !== "requirement" || !node.requirement)
                return node;
            changed = true;
            const requirement = updater({ ...node.requirement });
            return { ...node, prompt: requirement.text, requirement };
        });
        if (!changed)
            return false;
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        return true;
    }
    function editGoalFeedback(nodeId: string, patch: Partial<GoalFeedbackNote>) {
        updateRequirementNode(nodeId, requirement => {
            if (!requirement.goalFeedback)
                return requirement;
            const feedback = { ...requirement.goalFeedback, ...patch };
            return { ...requirement, goalFeedback: feedback, revision: requirement.revision + 1,
                text: [feedback.keep && `满意并保留：${feedback.keep}`, feedback.change && `需要改进：${feedback.change}`].filter(Boolean).join("\n") };
        });
    }
    async function submitGoalFeedback(nodeId: string, satisfied: boolean) {
        const projectId = activeProjectIdRef.current, conversationId = activeConversationIdRef.current;
        const feedback = nodesRef.current.find(node => node.id === nodeId)?.requirement?.goalFeedback;
        if (!feedback || !window.aieyraGoals)
            throw new Error("目标反馈尚未就绪。");
        await flushActiveProjectSession();
        const result = await window.aieyraGoals.execute({ projectId, conversationId, action: "feedback",
            input: { goalId: feedback.goalId, checkpointId: feedback.checkpointId, noteNodeId: nodeId, outputKey: feedback.outputKey,
                satisfied, keep: feedback.keep, change: feedback.change } });
        if (!result.ok)
            throw new Error(result.error);
        if (activeProjectIdRef.current !== projectId || activeConversationIdRef.current !== conversationId)
            return;
        editGoalFeedback(nodeId, { submitted: true, satisfied });
        await flushActiveProjectSession();
        if (!satisfied && activeProjectIdRef.current === projectId && activeConversationIdRef.current === conversationId) {
            await sendPrompt([`继续这个目标：${feedback.objective}`, feedback.keep && `满意并保留：${feedback.keep}`, `需要改进：${feedback.change}`].filter(Boolean).join("\n"), { goalId: feedback.goalId, useComposerAttachments: false, sourceNodeIds: [] });
        }
    }
    async function disableGoalNotes(nodeId: string) {
        const projectId = activeProjectIdRef.current;
        const feedback = nodesRef.current.find(node => node.id === nodeId)?.requirement?.goalFeedback;
        if (!feedback || !window.aieyraGoals)
            throw new Error("目标记录尚未就绪。");
        const current = await window.aieyraGoals.execute({ projectId, input: { operation: "read", goalId: feedback.goalId } });
        if (!current.ok || !current.goal)
            throw new Error(current.error);
        const result = await window.aieyraGoals.execute({ projectId, input: { operation: "update", goalId: feedback.goalId,
                expectedRevision: current.goal.revision, feedbackMode: "chat" } });
        if (!result.ok)
            throw new Error(result.error);
        if (activeProjectIdRef.current === projectId) {
            editGoalFeedback(nodeId, { notesDisabled: true });
            await flushActiveProjectSession();
        }
    }
    function buildReusableRequirement(sourceNodes: WorkflowNode[], scenario: CanvasRequirementScenario, inputBindings: CanvasRequirementInputBinding[], anchor?: WorkflowNode, draft: {
        title?: string;
        text?: string;
        x?: number;
        y?: number;
    } = {}): WorkflowNode {
        const id = allocateNodeCode(sourceNodes);
        const position = findOpenWorkflowNodePosition(sourceNodes, {
            width: REQUIREMENT_NODE_W, height: REQUIREMENT_NODE_H,
            preferredX: draft.x ?? (anchor ? anchor.x + Number(anchor.width || NODE_W) + 72 : 180),
            preferredY: draft.y ?? anchor?.y ?? 160,
            parent: anchor,
        });
        const text = (draft.text || "").slice(0, 24000);
        return {
            id, displayCode: id, type: "requirement", status: "done",
            title: draft.title?.trim() || requirementScenarioLabel(scenario), prompt: text,
            x: position.x, y: position.y, width: REQUIREMENT_NODE_W, height: REQUIREMENT_NODE_H,
            parentId: primaryRequirementInputNodeId(inputBindings) || undefined,
            relationType: inputBindings.length ? "referenced" : undefined,
            branch: "project-agent", outputs: 0, createdAt: nowLabel(), zOrder: nextNodeZOrder(sourceNodes),
            requirement: {
                version: 3, revision: 1, scenario, inputBindings, text,
                createdFrom: !anchor ? "canvas" : anchor.imageContainer ? "container" : "node",
            },
        };
    }
    function createConnectedRequirement(options: {
        nodeId?: string;
        inputNodeIds?: string[];
        sourceNodeIds?: string[];
        referenceNodeIds?: string[];
        title?: string;
        text?: string;
        x?: number;
        y?: number;
    } = {}) {
        const projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const ids = [...new Set([
                ...(options.inputNodeIds || []), ...(options.nodeId ? [options.nodeId] : []),
                ...(options.sourceNodeIds || []), ...(options.referenceNodeIds || []),
            ].map((id) => projection.groupByMember.get(id)?.hostNodeId ?? id))];
        const inputs = ids.filter((id) => projection.canvasNodeById.get(id)?.type === "image");
        const sourceIds = new Set(options.sourceNodeIds || []);
        const bindings: CanvasRequirementInputBinding[] = inputs.map(nodeId => ({ nodeId, role: sourceIds.has(nodeId) ? "source" : "reference" }));
        const anchor = inputs.length ? projection.canvasNodeById.get(inputs[0]) : undefined;
        const center = canvasCenterToWorld();
        const requirement = buildReusableRequirement(nodesRef.current, "text-to-image", bindings, anchor, {
            title: options.title || "需求便签", text: options.text,
            x: options.x ?? (anchor ? undefined : center.x), y: options.y ?? (anchor ? undefined : center.y),
        });
        pushCanvasHistory("创建需求");
        nodesRef.current = [...nodesRef.current, requirement];
        setNodes(nodesRef.current);
        setCanvasMenu(null);
        setAssetContextMenu(null);
        replaceSelectedNodeId(requirement.id);
        openRequirementEditor(requirement);
        return { anchorId: requirement.id, requirementNodeId: requirement.id };
    }
    function linkImageToRequirement(requirementId: string, nodeId: string, mentionCode?: string) {
        linkImagesToRequirement(requirementId, [{ nodeId, code: mentionCode }]);
    }
    function linkImagesToRequirement(requirementId: string, images: Array<{
        nodeId: string;
        code?: string;
    }>) {
        const projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const inputs = images.map(image => ({ ...image, nodeId: projection.groupByMember.get(image.nodeId)?.hostNodeId ?? image.nodeId }))
            .filter(image => projection.canvasNodeById.get(image.nodeId)?.type === "image");
        const note = nodesRef.current.find(node => node.id === requirementId && node.requirement);
        if (!note?.requirement || !inputs.length)
            return;
        const bindings = requirementLinkedImageBindings(note, nodesRef.current);
        const nextBindings = [...bindings];
        let text = note.requirement.text;
        for (const input of inputs) {
            if (!nextBindings.some(binding => binding.nodeId === input.nodeId))
                nextBindings.push({ nodeId: input.nodeId, role: "reference" });
            if (input.code && !new RegExp(`@${input.code}(?![A-Za-z0-9_-])`, "i").test(text))
                text += `${text && !/\s$/.test(text) ? " " : ""}@${input.code} `;
        }
        if (bindings.length === nextBindings.length && text === note.requirement.text)
            return;
        if (requirementEditHistoryRef.current !== requirementId)
            pushCanvasHistory("引用到需求便签");
        nodesRef.current = nodesRef.current.map(node => node.id === requirementId ? {
            ...node, prompt: text, parentId: node.parentId || inputs[0].nodeId, relationType: "referenced",
            requirement: { ...note.requirement!, text, revision: note.requirement!.revision + 1,
                inputBindings: nextBindings }
        } : node);
        setNodes(nodesRef.current);
        const history = canvasUndoRef.current;
        if (history && history.projectId === activeProjectIdRef.current && ["编辑需求便签", "引用到需求便签"].includes(history.label)) {
            const updated = nodesRef.current.find(node => node.id === requirementId)!;
            history.afterNodes = (history.afterNodes || history.nodes).map(node => node.id === requirementId ? cloneWorkflowNode(updated) : node);
        }
    }
    function referenceImageToRequirement(source: WorkflowNode, code: string) {
        referenceImagesToRequirement([{ nodeId: source.id, code }]);
    }
    function referenceImagesToRequirement(images: Array<{
        nodeId: string;
        code: string;
    }>) {
        if (!images.length)
            return;
        const notes = nodesRef.current.filter(node => node.type === "requirement" && node.requirement);
        if (!notes.length) {
            createConnectedRequirement({ inputNodeIds: images.map(image => image.nodeId), text: images.map(image => `@${image.code} `).join("") });
            return;
        }
        const rect = document.querySelector<HTMLElement>(`.flow-node[data-node-id="${CSS.escape(images[0].nodeId)}"]`)?.getBoundingClientRect();
        setRequirementReferenceMenu({ images, x: Math.round(rect?.left ?? assetContextMenu?.x ?? canvasMenu?.x ?? 120),
            y: Math.round(rect?.top ?? assetContextMenu?.y ?? canvasMenu?.y ?? 120) });
        setCanvasMenu(null);
        setAssetContextMenu(null);
    }
    function openRequirementEditorForSource(source: WorkflowNode) {
        if (source.type === "image")
            referenceImageToRequirement(source, nodeDisplayCode(source));
    }
    function openRequirementEditorForAsset(source: WorkflowNode, assetIndex: number) {
        const asset = source.assets?.[assetIndex];
        if (asset)
            referenceImageToRequirement(source, asset.displayCode || (nodeDisplayCode(source) + (assetIndex + 1)));
    }
    function openRequirementEditorAt(worldX: number, worldY: number) {
        setCanvasMenu(null);
        setAssetContextMenu(null);
        const requirement = buildReusableRequirement(nodesRef.current, "text-to-image", [], undefined, { x: worldX, y: worldY, title: "需求便签" });
        pushCanvasHistory("创建需求");
        nodesRef.current = [...nodesRef.current, requirement];
        setNodes(nodesRef.current);
        replaceSelectedNodeId(requirement.id);
        openRequirementEditor(requirement);
    }
    function openRequirementEditor(node: WorkflowNode) {
        if (node.type !== "requirement" || !node.requirement)
            return;
        setCanvasMenu(null);
        setAssetContextMenu(null);
        replaceSelectedNodeId(node.id);
        const element = document.querySelector<HTMLElement>(`.flow-node[data-node-id="${CSS.escape(node.id)}"]`);
        const box = element?.getBoundingClientRect();
        const canvas = canvasRef.current?.getBoundingClientRect();
        if (!box || !canvas || box.left < canvas.left || box.right > canvas.right || box.top < canvas.top || box.bottom > canvas.bottom) {
            focusWorkflowNode(node, { revealInspector: false, recordEvent: false });
        }
        requestAnimationFrame(() => {
            document.querySelector<HTMLTextAreaElement>(`.flow-node[data-node-id="${CSS.escape(node.id)}"] .requirement-node-text`)?.focus({ preventScroll: true });
        });
    }
    function editRequirementField(nodeId: string, patch: {
        text?: string;
        title?: string;
    }) {
        const existing = nodesRef.current.find(node => node.id === nodeId);
        if (!existing?.requirement)
            return;
        const text = patch.text ?? existing.requirement.text;
        const title = patch.title ?? existing.title;
        if (text === existing.requirement.text && title === existing.title)
            return;
        if (requirementEditHistoryRef.current !== nodeId) {
            pushCanvasHistory("编辑需求便签");
            requirementEditHistoryRef.current = nodeId;
        }
        nodesRef.current = nodesRef.current.map(node => node.id === nodeId ? {
            ...node, title, prompt: text,
            requirement: { ...existing.requirement!, text, revision: existing.requirement!.revision + 1, lastError: undefined },
        } : node);
        setNodes(nodesRef.current);
        const history = canvasUndoRef.current;
        if (history?.label === "编辑需求便签" && history.projectId === activeProjectIdRef.current) {
            const edited = nodesRef.current.find(node => node.id === nodeId)!;
            history.afterNodes = (history.afterNodes || history.nodes).map(node => node.id === nodeId ? cloneWorkflowNode(edited) : node);
        }
    }
    function executeRequirementNode(nodeId: string, confirmedUnchanged = false) {
        if (agentExecutionBusyNow()) {
            setServerMessage("Agent 正在执行当前任务，需求不会被重复提交。");
            return false;
        }
        const projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const requirementNode = nodesRef.current.find((node) => node.id === nodeId && node.type === "requirement" && node.requirement);
        if (!requirementNode?.requirement)
            return false;
        if (requirementNode.requirement.goalFeedback) {
            void submitGoalFeedback(nodeId, false).catch(error => setServerMessage(describeError(error)));
            return true;
        }
        if (!requirementNode.requirement.text.trim()) {
            openRequirementEditor(requirementNode);
            setServerMessage("请先填写需求，再交给 Agent。");
            return false;
        }
        const inputBindings = requirementLinkedImageBindings(requirementNode, nodesRef.current);
        const inputEntries = inputBindings.map((binding) => ({
            binding,
            node: projection.canvasNodeById.get(binding.nodeId) ?? nodesRef.current.find((node) => node.id === binding.nodeId),
        }));
        if (inputEntries.some(({ node }) => node?.type !== "image")) {
            updateRequirementNode(nodeId, (requirement) => ({ ...requirement, lastError: "部分已连接素材不存在，请重新核对需求连线。" }));
            setServerMessage("需求节点存在失效素材连线，请断开或重新连接后再执行。");
            return false;
        }
        const emptyInput = inputEntries.find(({ node }) => !(node?.assets?.length ?? 0));
        if (emptyInput) {
            updateRequirementNode(nodeId, (requirement) => ({
                ...requirement,
                lastError: `关联节点 ${emptyInput.binding.nodeId} 中还没有图片。`,
            }));
            setServerMessage(`请先向关联节点 ${emptyInput.binding.nodeId} 添加图片。`);
            return false;
        }
        const inputSignature = stableRequirementInputSignature(requirementNode, nodesRef.current);
        if (!confirmedUnchanged &&
            requirementNode.requirement.lastRunCount &&
            requirementNode.requirement.lastSourceSignature === inputSignature) {
            openConfirmDialog({
                id: requirementNode.id,
                eyebrow: "REUSE",
                title: "来源没有变化",
                message: "原图、参考图与需求内容都没有变化，确定按同一需求再执行一次吗？",
                detail: "你也可以先调整需求连线、替换素材，或修改需求正文后再执行。",
                confirmLabel: "仍然执行",
                action: "rerun-requirement"
            });
            return false;
        }
        replaceSelectedNodeId(requirementNode.id);
        setCanvasMenu(null);
        void referenceNodesInMatrix([requirementNode.id, ...inputBindings.map(binding => binding.nodeId)], requirementNode.requirement.text, true)
            .catch(error => { showCanvasOperationNotice(describeError(error)); setServerMessage(describeError(error)); });
        addEvent(`交给 画布助手 · ${requirementNode.id} · ${inputBindings.length} 个关联图片节点`);
        return true;
    }
    async function sendPrompt(nextPrompt?: string, dispatch: AgentPromptDispatchOptions = {}) {
        const canvasProjectId = dispatch.completionProjectId || activeProjectIdRef.current;
        if (projectsRef.current.find(p => p.id === canvasProjectId)?.kind === "image") {
            if (dispatch.imageJobCompletionIds?.length) {
                return false;
            }
            const useComposer = dispatch.useComposerAttachments !== false;
            const files = dispatch.fileAttachments ?? (useComposer ? agentFileAttachmentsRef.current : []);
            const sources = dispatch.sourceImages ?? (useComposer ? agentSourceImagesRef.current : []);
            const references = dispatch.referenceImages ?? (useComposer ? agentReferenceImagesRef.current : []);
            const text = (nextPrompt ?? prompt).trim() || defaultPromptForAgentFiles(files) || (sources.length || references.length ? "请查看附带图片，并根据当前要求继续。" : "");
            if (!text)
                return false;
            const binding = await requireCanvasBinding(canvasProjectId);
            const paths = [...new Set([...files, ...sources, ...references].map(file => file.path).filter(Boolean))];
            let attachments: AgentFileAttachment[] = [];
            if (paths.length) {
                const imported = await window.aieyraConfig!.importAgentFiles!({ projectId: binding.projectId, paths, maxFiles: paths.length });
                if (!imported.ok || !imported.files || imported.files.length !== paths.length)
                    throw Error(imported.error || "部分任务附件未能转交画布 Agent，请检查后重试。");
                attachments = imported.files;
            }
            const ids = [...new Set([...(dispatch.sourceNodeIds || []), ...(dispatch.contextNodeIds || []), ...(dispatch.requirementNodeId ? [dispatch.requirementNodeId] : []), ...[...sources, ...references].map(image => image.nodeId).filter((id): id is string => Boolean(id))])];
            const referenceIds: string[] = [];
            const draftReferences: import("./matrix").MatrixReference[] = [];
            if (ids.length) {
                const transferred = await transferProjectNodes({ sourceProjectId: canvasProjectId, targetProjectId: binding.projectId, nodeIds: ids, mode: "copy" });
                if (!transferred.reference)
                    throw Error("节点引用尚未保存。");
                referenceIds.push(transferred.reference.id);
                draftReferences.push({ ...transferred.reference, sourceProjectName: activeProjectName });
            }
            const materialRoles = [sources.length ? `修改来源：${sources.map(image => image.name).join("、")}` : "", references.length ? `参考素材：${references.map(image => image.name).join("、")}` : ""].filter(Boolean).join("\n");
            if (!binding.configured) {
                await appendComposerDraft(binding.projectId, binding.conversationId, { prompt: text + (materialRoles ? `\n\n${materialRoles}` : ""), files: attachments, references: draftReferences });
                if (activeProjectIdRef.current === canvasProjectId) {

                    setMatrixChatOpen(true);
                }
                showCanvasOperationNotice("任务与素材已加入右侧对话，配置模型后可继续。");
            }
            else {
                const sent = await window.aieyraAgent!.coding({ projectId: binding.projectId, conversationId: binding.conversationId, operation: "send", submissionId: crypto.randomUUID(), prompt: text + (materialRoles ? `\n\n${materialRoles}` : ""), fileAttachments: attachments, referenceIds });
                if (!sent.ok)
                    throw Error(sent.error || "画布 Agent 暂时无法接收任务。");
                if (referenceIds.length) {
                    try {
                        localStorage.setItem(`matrix:refs:${binding.projectId}`, JSON.stringify([...new Set([...readExcludedReferences(binding.projectId), ...referenceIds])]));
                    }
                    catch {
                        showCanvasOperationNotice("任务已发送，但引用选择未能保存，请检查本地存储。");
                    }
                    await appendComposerDraft(binding.projectId, binding.conversationId, { removeReferenceIds: referenceIds });
                }
            }
            return true;
        }
        throw Error("此入口仅用于画布任务，请使用当前项目的 画布助手。");
    }
    async function runManualImageTask(task: ImageTaskDraft, options?: {
        targetNodeId?: string;
        forkFromNodeId?: string;
        worldX?: number;
        worldY?: number;
        quotaChecked?: boolean;
        append?: boolean;
        requestedCount?: number;
        targetTotal?: number;
    }) {
        if (!await ensureAiConnectionReady("图片生成"))
            return;
        if (!window.aieyraServer?.generateImage) {
            setServerMessage("桌面模型连接暂时不可用，请检查连接中心后重试。");
            return;
        }
        const imageServer = window.aieyraServer;
        const requestProjectId = activeProjectIdRef.current;
        const requestConversationId = activeConversationIdRef.current;
        const taskSnapshot = cloneImageTaskDraft(task);
        const hasRequestedWorldPosition = Number.isFinite(options?.worldX) && Number.isFinite(options?.worldY);
        const frozenTargetNode = options?.targetNodeId ? nodesRef.current.find((item) => item.id === options.targetNodeId) : null;
        const frozenForkNodeId = options?.forkFromNodeId || (!hasRequestedWorldPosition ? selectedNodeIdRef.current : "");
        const frozenForkNode = frozenForkNodeId ? nodesRef.current.find((item) => item.id === frozenForkNodeId) : null;
        const nodeExecutionFingerprint = (node: WorkflowNode | null | undefined) => node ? {
            id: node.id,
            type: node.type,
            status: node.status,
            imageState: node.imageState,
            generationRunId: node.generationRunId,
            assets: (node.assets ?? []).map((asset, index) => ({
                assetId: asset.assetId,
                occurrenceId: asset.occurrenceId,
                contentHash: asset.contentHash,
                path: asset.path,
                relativePath: asset.relativePath,
                index: asset.index ?? index + 1
            }))
        } : null;
        const taskExecutionSignature = (value: ImageTaskDraft, target: WorkflowNode | null | undefined, fork: WorkflowNode | null | undefined) => JSON.stringify({
            task: cloneImageTaskDraft(value),
            options: {
                targetNodeId: options?.targetNodeId || "",
                forkFromNodeId: frozenForkNodeId,
                worldX: Number.isFinite(options?.worldX) ? Number(options?.worldX) : null,
                worldY: Number.isFinite(options?.worldY) ? Number(options?.worldY) : null,
                append: options?.append === true,
                requestedCount: Number(options?.requestedCount ?? 0),
                targetTotal: Number(options?.targetTotal ?? 0)
            },
            target: nodeExecutionFingerprint(target),
            fork: nodeExecutionFingerprint(fork)
        });
        const executionScope: AgentExecutionScopeSnapshot = {
            projectId: requestProjectId,
            conversationId: requestConversationId,
            taskSignature: taskExecutionSignature(taskSnapshot, frozenTargetNode, frozenForkNode)
        };
        const reservationId = `${requestProjectId}:${executionScope.taskSignature}`;
        if (manualImageReservationsRef.current.has(reservationId))
            return;
        manualImageReservationsRef.current.add(reservationId);
        try {
            if (!options?.quotaChecked && await blockImageTaskIfQuotaInsufficient(taskSnapshot))
                return;
        }
        finally {
            manualImageReservationsRef.current.delete(reservationId);
        }
        const targetNode = options?.targetNodeId ? nodesRef.current.find((item) => item.id === options.targetNodeId) : null;
        const forkNode = frozenForkNodeId ? nodesRef.current.find((item) => item.id === frozenForkNodeId) : null;
        const currentTaskSignature = taskExecutionSignature(task, targetNode, forkNode);
        if (!agentExecutionScopeMatches(executionScope, currentExecutionScope(currentTaskSignature))) {
            setServerMessage("画布、会话或任务素材已在额度检查期间变化，本次生图没有提交；请在当前状态重新执行。");
            return;
        }
        if (targetNode && imageRunStartsRef.current[targetNode.id]) {
            setServerMessage("这个节点正在生成中，可以先停止或等待完成。");
            return;
        }
        const parentId = targetNode ? targetNode.parentId : forkNode?.id;
        const id = targetNode?.id ?? nextManualImageNodeId();
        const generationRunId = uid("gen");
        const startedAt = Date.now();
        const nodePrompt = taskSnapshot.prompt;
        taskSnapshot.count = clamp(Number(options?.requestedCount ?? taskSnapshot.count), 1, 10);
        taskSnapshot.batchMode = "parallel";
        taskSnapshot.model = taskSnapshot.model || settings.imageModel || "";
        const size = sizeFromDraft(taskSnapshot, settings);
        const existingAssets = options?.append && targetNode ? cloneImageAssets(targetNode.assets) : [];
        const total = options?.append && targetNode
            ? clamp(Number(options.targetTotal ?? Math.max(targetNode.imageProgress?.total ?? targetNode.imageParams?.count ?? taskSnapshot.count, existingAssets.length + taskSnapshot.count)), 1, 10)
            : taskSnapshot.count;
        const startCompleted = existingAssets.length;
        const remainingCount = Math.max(0, total - startCompleted);
        const initialNodeSize = displaySizeForImageNode(size, Math.max(total, 1));
        const clampedInitialNodeSize = clampImageNodeDimensions(size, Math.max(total, 1), targetNode?.width ?? initialNodeSize.width, targetNode?.height ?? initialNodeSize.height);
        const requestedPosition = hasRequestedWorldPosition
            ? clampNodeWorldPosition({ x: Number(options?.worldX), y: Number(options?.worldY) }, clampedInitialNodeSize.width, clampedInitialNodeSize.height)
            : null;
        const preferredPosition = requestedPosition ?? {
            x: (forkNode?.x ?? 120) + 300,
            y: (forkNode?.y ?? 160) + 110
        };
        let manualViewportCenter: {
            x: number;
            y: number;
        } | undefined;
        try {
            manualViewportCenter = !targetNode && !hasRequestedWorldPosition ? canvasCenterToWorld() : undefined;
        }
        catch {
            manualViewportCenter = undefined;
        }
        const openPosition = !targetNode
            ? findOpenWorkflowNodePosition(nodesRef.current, {
                parent: forkNode ?? undefined,
                width: clampedInitialNodeSize.width,
                height: clampedInitialNodeSize.height,
                preferredX: preferredPosition.x,
                preferredY: preferredPosition.y,
                viewportCenter: manualViewportCenter,
                cascadeIndex: nodesRef.current.length
            })
            : null;
        const initialImageCollection = parallelImageCollection(id, total, existingAssets, taskSnapshot.prompt, targetNode?.imageCollection);
        const nodeBase: WorkflowNode = {
            id,
            title: targetNode?.title || "生成图片",
            prompt: nodePrompt,
            type: "image",
            status: "working",
            x: targetNode?.x ?? openPosition?.x ?? preferredPosition.x,
            y: targetNode?.y ?? openPosition?.y ?? preferredPosition.y,
            parentId,
            branch: "basic",
            outputs: existingAssets.length,
            createdAt: targetNode?.createdAt ?? nowLabel(),
            assets: existingAssets,
            imageContainerSpec: cloneImageContainerSpec(targetNode?.imageContainerSpec),
            imageCollection: initialImageCollection,
            imageState: remainingCount > 0 ? "generating" : "done",
            imageError: undefined,
            imageParams: cloneImageTaskDraft({ ...taskSnapshot, size, count: total, batchMode: "parallel", referenceImages: taskSnapshot.referenceImages ?? [] }),
            imageProgress: imageProgressState(total, startCompleted, remainingCount > 1 ? `并行生成 ${remainingCount} 张` : `准备生成 ${remainingCount} 张`),
            generationRunId,
            ...clampedInitialNodeSize
        };
        const node = initialImageCollection ? withNodeImageCollection(nodeBase, initialImageCollection) : nodeBase;
        const initialRunNodes = targetNode
            ? nodesRef.current.map((item) => (item.id === id ? { ...item, ...node, zOrder: item.zOrder ?? node.zOrder ?? nextNodeZOrder(nodesRef.current) } : item))
            : [...nodesRef.current, { ...node, zOrder: nextNodeZOrder(nodesRef.current) }];
        nodesRef.current = initialRunNodes;
        setNodes(initialRunNodes);
        setSelectedNodeId(id);
        setActiveNodeId(id);
        if (!targetNode)
            flashNewCanvasNodes([id]);
        const manualReferences = taskSnapshot.referenceImages ?? [];
        manualImageJobsRef.current.set(generationRunId, { projectId: requestProjectId, conversationId: requestConversationId, nodeId: id });
        imageJobRecord(requestProjectId, requestConversationId);
        markImageRunStarted(id, startedAt, requestProjectId);
        setImageJobsRevision(revision => revision + 1);
        const manualRunIsActive = () => projectImageRunActive(requestProjectId, id, generationRunId);
        let latestManualNode = node;
        const updateManualRunNodes = (update: (current: WorkflowNode[]) => WorkflowNode[]) => {
            const tracked = projectRunsRef.current[requestProjectId];
            if (!tracked)
                return null;
            const renderCurrentProject = activeProjectIdRef.current === requestProjectId && !projectTransitionRef.current;
            const sourceNodes = renderCurrentProject ? nodesRef.current : tracked.session.nodes;
            const present = sourceNodes.some(item => item.id === id);
            const updated = update(present ? sourceNodes : [...sourceNodes, latestManualNode]);
            latestManualNode = updated.find(item => item.id === id) || latestManualNode;
            if (!present) {
                removedManualImageResultsRef.current.set(`${requestProjectId}:${id}`, cloneWorkflowNode(latestManualNode));
                trimIdentityMap(removedManualImageResultsRef.current, 96);
            }
            const nextNodes = present ? updated : updated.filter(item => item.id !== id);
            updateProjectRun(requestProjectId, (current) => ({
                ...current,
                session: buildWorkflowSessionSnapshot({ ...current.session, nodes: nextNodes })
            }));
            if (renderCurrentProject) {
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
            }
            else {
                const bgRecord = projectRunsRef.current[requestProjectId];
                if (bgRecord)
                    void persistProjectSession(requestProjectId, bgRecord.session).catch(() => null);
            }
            return nextNodes;
        };
        const appendManualProgress = (progress: AgentProgress) => {
            const tracked = updateProjectRun(requestProjectId, (current) => ({
                ...current,
                progress: [...current.progress, progress].slice(-48)
            }));
            if (tracked && activeProjectIdRef.current === requestProjectId && !projectTransitionRef.current) {
                setServerMessage(progress.summary || "正在绘图");
            }
        };
        const settleManualTimeline = (outcome: {
            status: "done" | "error";
            summary: string;
            detail?: string;
        }) => {
            if (activeProjectIdRef.current === requestProjectId && !projectTransitionRef.current)
                setServerMessage(outcome.summary);
            return true;
        };
        try {
            const assetSlots: (ImageAsset | null)[] = Array.from({ length: total }, (_item, index) => existingAssets[index] ?? null);
            const errors: string[] = [];
            const failedSlots = new Set<number>();
            async function generateSlot(index: number) {
                if (!manualRunIsActive())
                    return;
                updateManualRunNodes((current) => current.map((item) => item.id === id && item.generationRunId === generationRunId
                    ? {
                        ...item,
                        status: "working",
                        imageState: "generating",
                        imageError: undefined,
                        imageProgress: imageProgressState(total, assetSlots.filter(Boolean).length, "并行生成中", {
                            failed: failedSlots.size,
                            failedSlots: Array.from(failedSlots).sort((a, b) => a - b)
                        })
                    }
                    : item));
                const attemptRunId = `${generationRunId}-${index + 1}`;
                const cancellableRunId = `manual-image:${attemptRunId}`;
                activeImageRequestIdsRef.current.set(cancellableRunId, requestProjectId);
                try {
                    const result = await imageServer.generateImage({
                        runId: attemptRunId,
                        placementRunId: generationRunId,
                        projectId: requestProjectId,
                        prompt: taskSnapshot.prompt,
                        model: taskSnapshot.model || settings.imageModel,
                        size,
                        quality: taskSnapshot.quality,
                        count: 1,
                        editImage: taskSnapshot.referenceImages?.find(image => image.taskRole === "source"),
                        referenceImages: (taskSnapshot.referenceImages || []).filter(image => image.taskRole !== "source"),
                        maskImage: taskSnapshot.maskImage,
                        maskDataUrl: taskSnapshot.maskDataUrl,
                        outputFormat: taskSnapshot.outputFormat,
                        outputCompression: taskSnapshot.outputCompression,
                        background: taskSnapshot.background,
                        moderation: taskSnapshot.moderation,
                        inputFidelity: taskSnapshot.inputFidelity
                    });
                    if (!result.ok) {
                        const keyQuotaFailure = connectionSnapshotRef.current.mode === "official" && (result.errorCategory === "quota" ||
                            /(?:insufficient[_ -]?(?:quota|balance)|exceeded[^.]{0,80}quota|余额不足|额度不足|配额不足|额度已用完)/i.test(result.error ?? ""));
                        const hasAuthoritativeCost = Number(result.deficitCents || 0) > 0 || Number(result.costCents || 0) > 0;
                        if (keyQuotaFailure && !hasAuthoritativeCost) {
                            await refreshConnectionState();

                            openOSModelSettings();
                            setServerMessage("所选 Aieyra Key 额度不足，请充值或选择其他 Key。");
                            throw new Error("所选 Aieyra Key 额度不足，本张生成失败；已返回的其他图片仍会保留。");
                        }
                        const quota = quotaBlockFromGenerateResult(taskSnapshot, result);
                        if (quota) {
                            setQuotaDialog(quota);
                            setServerMessage(quota.deficitCents === null
                                ? "所选 Key 额度不足，差额由服务端实时判定。"
                                : `余额不足，还差 ${yuan(quota.deficitCents)}。`);
                            throw new Error("余额不足，本张生成失败；已返回的其他图片仍会保留。");
                        }
                        const upstreamParts = [
                            typeof result.upstreamStatus === "number" ? `上游状态 ${result.upstreamStatus}` : "",
                            result.upstreamErrorType ? `类型 ${result.upstreamErrorType}` : "",
                            result.upstreamErrorCode ? `代码 ${result.upstreamErrorCode}` : "",
                            result.upstreamErrorMessage && result.upstreamErrorMessage !== result.error ? result.upstreamErrorMessage : ""
                        ].filter(Boolean);
                        throw new Error(`${result.error ?? "生图失败。"}${upstreamParts.length ? `（${upstreamParts.join(" · ")}）` : ""}`);
                    }
                    const responseRunId = result.runId || attemptRunId;
                    const nextAssets = (result.assets ?? [])
                        .filter((asset) => !asset.runId || asset.runId === responseRunId)
                        .map((asset) => ({ ...asset, index: index + 1, runId: responseRunId }));
                    if (!nextAssets.length)
                        throw new Error(`第 ${index + 1}/${total} 张返回无图片结果。`);
                    assetSlots[index] = nextAssets[0];
                    const assets = assetSlots.filter((asset): asset is ImageAsset => Boolean(asset));
                    updateManualRunNodes((current) => current.map((item) => item.id === id && item.generationRunId === generationRunId
                        ? (() => {
                            const nodeSize = clampImageNodeDimensions(result.size ?? size, Math.max(total, assets.length), item.width, item.height);
                            const imageCollection = parallelImageCollection(id, total, assets, taskSnapshot.prompt, item.imageCollection, Array.from(failedSlots));
                            return withNodeImageCollection({
                                ...item,
                                status: assets.length >= total ? "done" : "working",
                                outputs: assets.length,
                                assets: cloneImageAssets(assets),
                                imageState: assets.length >= total ? "done" : "generating",
                                imageError: undefined,
                                imageParams: cloneImageTaskDraft({ ...taskSnapshot, count: total, size, batchMode: "parallel", referenceImages: taskSnapshot.referenceImages ?? [] }),
                                imageProgress: imageProgressState(total, assets.length, assets.length >= total ? `已完成 ${assets.length}/${total} 张` : `并行生成中，已完成 ${assets.length}/${total} 张`, {
                                    failed: failedSlots.size,
                                    failedSlots: Array.from(failedSlots).sort((a, b) => a - b)
                                }),
                                generationRunId,
                                prompt: [
                                    taskSnapshot.prompt,
                                    "",
                                    `model: ${result.model ?? settings.imageModel}`,
                                    `size: ${result.size ?? size}`,
                                    `quality: ${result.quality ?? taskSnapshot.quality}`,
                                    `count: ${total}`,
                                    `batchMode: parallel`,
                                    `returned: ${assets.length}`,
                                    `cost: ${yuan(result.costCents)}`
                                ].join("\n"),
                                ...nodeSize
                            }, imageCollection);
                        })()
                        : item));
                    appendManualProgress({
                        runId: id,
                        projectId: requestProjectId,
                        conversationId: requestConversationId,
                        phase: result.dryRun ? "image-dry-run" : "image-response",
                        tool: "image_gen",
                        summary: `节点 ${id} 已完成 ${assets.length}/${total} 张。`,
                        detail: `${result.size ?? size} · ${qualityLabel(result.quality ?? taskSnapshot.quality)}`,
                        startedAtMs: startedAt,
                        createdAt: new Date().toISOString()
                    });
                }
                catch (attemptError) {
                    const retryMessage = friendlyImageError(attemptError);
                    errors.push(`第 ${index + 1} 张：${retryMessage}`);
                    failedSlots.add(index + 1);
                    const assets = assetSlots.filter((asset): asset is ImageAsset => Boolean(asset));
                    const settledCount = assets.length + failedSlots.size;
                    updateManualRunNodes((current) => current.map((item) => item.id === id && item.generationRunId === generationRunId
                        ? withNodeImageCollection({
                            ...item,
                            status: settledCount >= total ? "review" : "working",
                            outputs: assets.length,
                            assets: cloneImageAssets(assets),
                            imageState: settledCount >= total ? (assets.length > 0 ? "done" : "error") : "generating",
                            imageError: retryMessage,
                            imageProgress: imageProgressState(total, assets.length, settledCount >= total ? `部分失败，已完成 ${assets.length}/${total} 张` : `第 ${index + 1}/${total} 张失败，其他图片继续生成`, {
                                failed: failedSlots.size,
                                failedSlots: Array.from(failedSlots).sort((a, b) => a - b),
                                activeIndex: settledCount >= total ? undefined : settledCount + 1
                            })
                        }, parallelImageCollection(id, total, assets, taskSnapshot.prompt, item.imageCollection, Array.from(failedSlots)))
                        : item));
                    appendManualProgress({
                        runId: id,
                        projectId: requestProjectId,
                        conversationId: requestConversationId,
                        phase: "image-error",
                        tool: "image_gen",
                        summary: retryMessage,
                        detail: "这张失败，不自动重试；其他图片继续生成。",
                        startedAtMs: startedAt,
                        createdAt: new Date().toISOString()
                    });
                }
                finally {
                    activeImageRequestIdsRef.current.delete(cancellableRunId);
                }
            }
            await Promise.all(Array.from({ length: remainingCount }, (_item, offset) => generateSlot(startCompleted + offset)));
            const assets = assetSlots.filter((asset): asset is ImageAsset => Boolean(asset));
            const completedAll = assets.length >= total && errors.length === 0;
            const stopped = !manualImageJobsRef.current.has(generationRunId) && !completedAll;
            const durationSeconds = recordImageGenerationDuration(startedAt);
            updateManualRunNodes((current) => current.map((item) => item.id === id && item.generationRunId === generationRunId
                ? withNodeImageCollection({
                    ...item,
                    status: stopped || !completedAll ? "review" : "done",
                    outputs: assets.length,
                    assets: cloneImageAssets(assets),
                    imageState: errors.length > 0 && assets.length === 0 ? "error" : assets.length > 0 ? "done" : stopped || !completedAll ? "empty" : "done",
                    imageError: errors.length ? errors.slice(0, 3).join("；") : undefined,
                    imageProgress: imageProgressState(total, assets.length, stopped ? `已停止，已完成 ${assets.length}/${total} 张` : errors.length ? `部分失败，已完成 ${assets.length}/${total} 张` : `耗时 ${formatDuration(durationSeconds)}`, {
                        failed: failedSlots.size,
                        failedSlots: Array.from(failedSlots).sort((a, b) => a - b),
                        activeIndex: stopped || !completedAll ? assets.length + 1 : undefined,
                        stopped
                    })
                }, parallelImageCollection(id, total, assets, taskSnapshot.prompt, item.imageCollection, Array.from(failedSlots)))
                : item));
            if (activeProjectIdRef.current === requestProjectId && !projectTransitionRef.current) {
                setServerMessage(stopped ? `节点 ${id} 已停止，保留 ${assets.length} 张。` : errors.length ? `节点 ${id} 部分失败，保留 ${assets.length}/${total} 张。` : `节点 ${id} 并行生成完成，${assets.length}/${total} 张。`);
            }
            settleManualTimeline({
                status: stopped || errors.length ? "error" : "done",
                summary: stopped
                    ? `已停止，保留 ${assets.length}/${total} 张。`
                    : errors.length
                        ? `部分失败，已完成 ${assets.length}/${total} 张。`
                        : `已完成 ${assets.length}/${total} 张。`,
                detail: `${size} · ${qualityLabel(taskSnapshot.quality)} · ${manualReferences.length} 张参考图`
            });
            await refreshServerState();
        }
        catch (error) {
            const message = friendlyImageError(error);
            const durationSeconds = recordImageGenerationDuration(startedAt);
            updateManualRunNodes((current) => current.map((item) => item.id === id && item.generationRunId === generationRunId
                ? withNodeImageCollection({
                    ...item,
                    status: "review",
                    imageState: "error",
                    imageError: message,
                    imageParams: cloneImageTaskDraft({ ...taskSnapshot, prompt: taskSnapshot.prompt, count: total, size, batchMode: "parallel", referenceImages: taskSnapshot.referenceImages ?? [] }),
                    imageProgress: imageProgressState(total, item.assets?.length ?? 0, `生图失败，已停止，已保留 ${item.assets?.length ?? 0} 张。可手动重试。`, { activeIndex: (item.assets?.length ?? 0) + 1, stopped: true }),
                    generationRunId,
                    prompt: `${nodePrompt}\n\nerror: ${message}\nduration: ${durationSeconds}s`
                }, parallelImageCollection(id, total, item.assets ?? [], taskSnapshot.prompt, item.imageCollection, Array.from({ length: total }, (_slot, slotIndex) => slotIndex + 1).filter((slot) => !(item.assets ?? []).some((asset, compactIndex) => Number(asset.index ?? compactIndex + 1) === slot))))
                : item));
            appendManualProgress({
                runId: id,
                projectId: requestProjectId,
                conversationId: requestConversationId,
                phase: "image-error",
                tool: "image_gen",
                summary: message,
                detail: `耗时 ${formatDuration(durationSeconds)}`,
                createdAt: new Date().toISOString()
            });
            settleManualTimeline({
                status: "error",
                summary: message,
                detail: `耗时 ${formatDuration(durationSeconds)}`
            });
            if (activeProjectIdRef.current === requestProjectId && !projectTransitionRef.current)
                setServerMessage(message);
        }
        finally {
            markImageRunFinished(id, requestProjectId);
            manualImageJobsRef.current.delete(generationRunId);
            setImageJobsRevision(revision => revision + 1);
            const finalRecord = imageJobRecord(requestProjectId, requestConversationId);
            if (finalRecord) {
                void persistProjectSession(requestProjectId, finalRecord.session).catch(error => addEvent(`图片结果保存失败：${describeError(error)}`));
                if (finalRecord.status === "completed" && !projectHasImageWork(requestProjectId))
                    removeProjectRun(requestProjectId);
                else
                    publishProjectRun(finalRecord);
            }
        }
    }
    function openImageViewer(node: WorkflowNode, index: number) {
        const entries = (node.assets ?? [])
            .map((asset, assetIndex) => ({ asset, assetIndex }))
            .filter((entry) => imageAssetSrc(entry.asset));
        if (entries.length === 0)
            return;
        const groupedSources = layoutProjection.assetSourcesByHost.get(node.id);
        imageViewerAssetSourcesRef.current = entries.map((entry) => groupedSources?.[entry.assetIndex] ?? { nodeId: node.id, assetIndex: entry.assetIndex });
        const requestedViewerIndex = entries.findIndex((entry) => entry.assetIndex === index);
        setImageViewer({
            nodeId: node.id,
            nodeTitle: node.title,
            assets: entries.map((entry) => entry.asset),
            assetIndices: entries.map((entry) => entry.assetIndex),
            index: requestedViewerIndex >= 0 ? requestedViewerIndex : clamp(index, 0, entries.length - 1)
        });
    }
    function insertAgentMentions(codes: string[]) {
        const wanted = new Set(codes), projection = projectCanvasImageLayouts(nodesRef.current, layoutGroupsRef.current);
        const imageMatches = agentMentionImageOptions(projection.canvasNodes).filter(item => wanted.has(item.code));
        const nodeIds = projection.canvasNodes.filter(node => wanted.has(nodeDisplayCode(node)) || imageMatches.some(item => item.nodeId === node.id)).map(node => node.id);
        if (!nodeIds.length) {
            showCanvasOperationNotice("引用已变化，请重新选择。");
            return;
        }
        void referenceNodesInMatrix(nodeIds, `引用 @${activeProjectName}：${codes.map(code => `@${code}`).join(" ")}。请以所选图片编号为准。`)
            .catch(error => showCanvasOperationNotice(describeError(error)));
    }
    function insertAgentMention(code: string) {
        insertAgentMentions([code]);
    }
    function setAssetFeedbackScore(nodeId: string, assetIndex: number, value: unknown) {
        const score = normalizeFeedbackScore(value);
        setNodes((current) => {
            const next = current.map((node) => node.id !== nodeId
                ? node
                : {
                    ...node,
                    assets: node.assets?.map((asset, index) => index === assetIndex ? { ...asset, feedbackScore: score } : asset)
                });
            nodesRef.current = next;
            return next;
        });
        canvasRevisionRef.current = Math.max(1, canvasRevisionRef.current + 1);
    }
    function setNodeFeedbackScore(nodeId: string, value: unknown) {
        const score = normalizeFeedbackScore(value);
        setNodes((current) => {
            const next = current.map((node) => node.id === nodeId ? { ...node, feedbackScore: score } : node);
            nodesRef.current = next;
            return next;
        });
        canvasRevisionRef.current = Math.max(1, canvasRevisionRef.current + 1);
    }
    function suggestedAssetExportName(node: WorkflowNode, asset: ImageAsset, index: number) {
        const rawExtension = String(asset.path || asset.originalName || "").match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
        const extension = rawExtension || (node.imageParams?.outputFormat === "jpeg" ? "jpg" : node.imageParams?.outputFormat || "png");
        const title = node.layerGroup
            ? `${String(node.layerGroup.order).padStart(2, "0")}-${node.layerGroup.layerTitle}`
            : (asset.title || node.title || `图片-${index + 1}`);
        return `${title}.${extension}`;
    }
    function openAssetContextMenuAt(event: React.MouseEvent, node: WorkflowNode, assetIndex: number, source: AssetContextMenuState["source"] = "canvas") {
        event.preventDefault();
        event.stopPropagation();
        if (source === "canvas" && nodeSelectionMode(currentNodeSelection()) === "multiple") {
            openNodeMenuAt(node, event.clientX, event.clientY);
            return;
        }
        const asset = node.assets?.[assetIndex];
        if (!asset)
            return;
        const width = 210;
        const estimatedHeight = node.layerGroup ? 520 : 220;
        closeAllCanvasMenus();
        setAssetContextMenu({
            x: Math.round(clamp(event.clientX, 8, Math.max(8, window.innerWidth - width - 8))),
            y: Math.round(clamp(event.clientY, 8, Math.max(8, window.innerHeight - estimatedHeight - 8))),
            nodeId: node.id,
            assetIndex,
            source
        });
    }
    async function saveAssetAs(node: WorkflowNode, assetIndex: number) {
        const asset = node.assets?.[assetIndex];
        if (!asset)
            return { ok: false, error: "图片资产不存在。" };
        const bridge = window.aieyraConfig as typeof window.aieyraConfig & {
            saveAssetAs?: (payload: {
                asset: ImageAsset;
                projectId?: string;
                suggestedName?: string;
            }) => Promise<{
                ok: boolean;
                canceled?: boolean;
                path?: string;
                error?: string;
            }>;
        };
        if (!bridge?.saveAssetAs) {
            setServerMessage("当前版本尚未连接图片另存为服务。");
            return { ok: false, error: "图片另存为服务不可用。" };
        }
        commitFileActionBusy(true);
        try {
            const result = await bridge.saveAssetAs({
                asset,
                projectId: activeProjectIdRef.current,
                suggestedName: suggestedAssetExportName(node, asset, assetIndex)
            });
            if (!result.ok && !result.canceled)
                setServerMessage(result.error || "图片另存为失败。");
            if (result.ok && !result.canceled && result.path) {
                setServerMessage(`已另存图片：${result.path}`);
                addEvent(`另存图片 ${node.id}/${assetIndex + 1}`);
            }
            return result;
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message };
        }
        finally {
            commitFileActionBusy(false);
            setAssetContextMenu(null);
        }
    }
    async function saveStandaloneAssetAs(asset: ImageAsset, suggestedName: string, eventLabel = "图片成果") {
        const bridge = window.aieyraConfig;
        if (!bridge?.saveAssetAs) {
            setServerMessage("当前版本尚未连接图片另存为服务。");
            return { ok: false, error: "图片另存为服务不可用。" };
        }
        commitFileActionBusy(true);
        try {
            const result = await bridge.saveAssetAs({ asset, projectId: activeProjectIdRef.current, suggestedName });
            if (!result.ok && !result.canceled)
                setServerMessage(result.error || "图片另存为失败。");
            if (result.ok && !result.canceled && result.path) {
                setServerMessage(`已另存图片：${result.path}`);
                addEvent(`另存${eventLabel}`);
            }
            return result;
        }
        catch (error) {
            const message = friendlyImageError(error);
            setServerMessage(message);
            return { ok: false, error: message };
        }
        finally {
            commitFileActionBusy(false);
            setAssetContextMenu(null);
        }
    }
    function beginInternalAssetDrag(event: React.DragEvent<HTMLElement>, node: WorkflowNode, assetIndex: number) {
        const asset = node.assets?.[assetIndex];
        const assetKey = imageAssetLogicalKey(asset, node.id, assetIndex);
        if (!asset || !assetKey || !canGroupImageAsset(node)) {
            event.preventDefault();
            return;
        }
        event.stopPropagation();
        const drag = {
            dragId: uid("asset-drag"),
            nodeId: node.id,
            assetIndex,
            assetKey,
            startedAt: Date.now()
        };
        internalAssetDragRef.current = drag;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(INTERNAL_ASSET_DRAG_MIME, drag.dragId);
        event.dataTransfer.setData("text/plain", `iiimage-asset:${drag.dragId}`);
    }
    function finishInternalAssetDrag() {
        clearMergeHover();
        const drag = internalAssetDragRef.current;
        setAssetDropTargetId("");
        if (!drag)
            return;
        window.setTimeout(() => {
            if (internalAssetDragRef.current === drag)
                internalAssetDragRef.current = null;
        }, 0);
    }
    async function openAssetFolder(asset?: ImageAsset) {
        if (!asset)
            return;
        if (!asset.path) {
            pushSystemMessage("asset", "这张图不是本地输出文件，当前没有可打开的本地文件夹。");
            return;
        }
        try {
            const result = await window.aieyraConfig?.openAssetFolder?.({ path: asset.path, url: asset.url });
            if (!result?.ok) {
                pushSystemMessage("asset", `打开图片文件夹失败：${result?.error ?? "本地资产服务未就绪。"}`);
            }
        }
        catch (error) {
            pushSystemMessage("asset", `打开图片文件夹失败：${describeError(error)}`);
        }
    }
    function applyWritingBridgeResult(result: WritingBridgeResult, render = true, preserveLiveWorkbench = false) {
        if (!result.session || !result.projectId)
            return null;
        let next = normalizeWritingRendererSession(result.session);
        projectSessionRevisionRef.current[result.projectId] = Math.max(projectSessionRevisionRef.current[result.projectId] || 0, next.sessionRevision);
        if (!render || result.projectId !== activeProjectIdRef.current)
            return next;
        const current = writingSessionRef.current;
        if (next.sessionRevision < current.sessionRevision)
            return current;
        next.activeConversationId ||= current.activeConversationId || activeConversationIdRef.current;
        if (preserveLiveWorkbench) {
            const artifacts = next.artifacts;
            const currentSelection = artifacts.find((artifact) => artifact.id === current.selectedArtifactId);
            const selectedArtifactId = currentSelection ? current.selectedArtifactId : next.selectedArtifactId;
            const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId);
            const preferredParagraphId = currentSelection ? current.selectedParagraphId : next.selectedParagraphId;
            next = {
                ...next,
                messages: current.messages,
                conversations: current.conversations,
                activeConversationId: current.activeConversationId,
                pendingAgentExecution: current.pendingAgentExecution,
                selectedArtifactId,
                selectedParagraphId: selectedArtifact?.paragraphs.some((paragraph) => paragraph.id === preferredParagraphId)
                    ? preferredParagraphId
                    : selectedArtifact?.paragraphs[0]?.id || ""
            };
        }
        else {
            messagesRef.current = next.messages;
            conversationsRef.current = next.conversations;
            setMessages(next.messages);
            setConversations(next.conversations);
            activeConversationIdRef.current = next.activeConversationId;
            setActiveConversationId(next.activeConversationId);
        }
        writingSessionRef.current = next;
        setWritingSession(next);
        return next;
    }
    async function applyLineageBridgeResult(result: LineageBridgeResult, expectedKind?: LineageProjectKind, expectedProjectId?: string, render = true, preserveLiveWorkbench = false) {
        const projectId = String(result.projectId || expectedProjectId || "").trim();
        const project = projectsRef.current.find((item) => item.id === projectId);
        const projectKind = project?.kind === "data" || project?.kind === "finance" ? project.kind : expectedKind;
        if (!result.session || !projectId || !projectKind)
            return null;
        let next = await normalizeLineageRendererSession(result.session as WorkflowSession & {
            sessionRevision?: number;
        }, projectKind);
        projectSessionRevisionRef.current[projectId] = Math.max(projectSessionRevisionRef.current[projectId] || 0, next.sessionRevision);
        if (!render || projectId !== activeProjectIdRef.current)
            return next;
        const current = lineageSessionRef.current;
        if (next.sessionRevision < current.sessionRevision)
            return current;
        next.activeConversationId ||= current.activeConversationId || activeConversationIdRef.current;
        if (preserveLiveWorkbench) {
            const selectedLineageArtifactId = next.lineageArtifacts.some((artifact) => artifact.id === current.selectedLineageArtifactId)
                ? current.selectedLineageArtifactId
                : next.selectedLineageArtifactId;
            next = {
                ...next,
                messages: current.messages,
                conversations: current.conversations,
                activeConversationId: current.activeConversationId,
                pendingAgentExecution: current.pendingAgentExecution,
                selectedLineageArtifactId
            };
        }
        lineageSessionRef.current = next;
        messagesRef.current = next.messages;
        conversationsRef.current = next.conversations;
        activeConversationIdRef.current = next.activeConversationId || activeConversationIdRef.current;
        setLineageSession(next);
        setMessages(next.messages);
        setConversations(next.conversations);
        setActiveConversationId(activeConversationIdRef.current);
        return next;
    }
    async function createWritingProjectFromReportSnapshot() {
        const draft = projectNameDraft;
        if (fileActionBusyRef.current || !draft || draft.mode !== "report-snapshot")
            return;
        const sourceProjectId = String(draft.sourceProjectId || "");
        const sourceArtifactId = String(draft.sourceArtifactId || "");
        const expectedRevision = Number(draft.sourceRevision);
        const targetProjectName = draft.name.trim();
        if (!sourceProjectId || !sourceArtifactId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !targetProjectName)
            return;
        if (!window.aieyraLineage?.createWritingSnapshot) {
            setProjectNameDraft({ ...draft, error: "当前桌面桥尚未提供写作快照能力，请重启应用后重试。" });
            return;
        }
        commitFileActionBusy(true);
        projectTransitionRef.current = true;
        try {
            const result = await window.aieyraLineage.createWritingSnapshot({
                sourceProjectId,
                sourceArtifactId,
                expectedRevision,
                targetProjectName,
                optionalTemplate: draft.template || "general"
            });
            if (!result?.ok || !result.project || !result.projects || !result.activeProjectId || !result.session) {
                throw new Error(result?.error || "写作项目未能安全创建，请重试。");
            }
            setProjectNameDraft(null);
            await applyProjectSession(result);
            setProjectTabPreferences((current) => openProjectTab(current, activeProjectIdRef.current));
            const duplicateNote = result.receipt?.idempotent ? "（已复用同一快照）" : "";
            setServerMessage(`已创建写作项目${duplicateNote}。`);
            addEvent(`Data 报告转入写作 ${draft.sourceTitle || sourceArtifactId} → ${result.project.name}`);
        }
        catch (error) {
            const message = describeError(error);
            setProjectNameDraft((current) => current?.mode === "report-snapshot" ? { ...current, error: message } : current);
        }
        finally {
            projectTransitionRef.current = false;
            commitFileActionBusy(false);
        }
    }
    function enqueueWritingPatchProposals(projectId: string, results: readonly WritingRuntimeToolResult[]) {
        const incoming = results
            .map((result) => result.writingPatchProposal)
            .filter((proposal): proposal is WritingAgentPatchProposal => Boolean(proposal?.proposalId));
        if (!incoming.length)
            return;
        setWritingPatchProposals((current) => {
            const existing = current[projectId] ?? [];
            const known = new Set(existing.map((proposal) => proposal.proposalId));
            const additions = incoming.filter((proposal) => !known.has(proposal.proposalId));
            return additions.length ? { ...current, [projectId]: [...existing, ...additions] } : current;
        });
    }
    function removeWritingPatchProposal(projectId: string, proposalId: string) {
        setWritingPatchProposals((current) => {
            const existing = current[projectId] ?? [];
            const next = existing.filter((proposal) => proposal.proposalId !== proposalId);
            if (next.length === existing.length)
                return current;
            if (next.length)
                return { ...current, [projectId]: next };
            const { [projectId]: _removed, ...rest } = current;
            return rest;
        });
    }
    async function acceptWritingPatchProposal(proposal: WritingAgentPatchProposal) {
        const projectId = activeProjectIdRef.current;
        if (!window.aieyraWriting?.acceptAgentPatch)
            return;
        setWritingPatchDecisionBusy(true);
        setWritingPatchDecisionError("");
        try {
            const result = await window.aieyraWriting.acceptAgentPatch({ projectId, proposalId: proposal.proposalId });
            if (!result?.ok)
                throw new Error(result?.error || "接受 Writing 修改提案失败。");
            removeWritingPatchProposal(projectId, proposal.proposalId);
            applyWritingBridgeResult(result);
            setServerMessage(`已接受 ${proposal.artifactTitle} 的修改提案${result.artifact ? ` · revision ${result.artifact.revision}` : ""}。`);
        }
        catch (error) {
            const message = describeError(error);
            setWritingPatchDecisionError(message);
            setWritingError(message);
            setServerMessage(message);
        }
        finally {
            setWritingPatchDecisionBusy(false);
        }
    }
    async function rejectWritingPatchProposal(proposal: WritingAgentPatchProposal) {
        const projectId = activeProjectIdRef.current;
        if (!window.aieyraWriting?.rejectAgentPatch)
            return;
        setWritingPatchDecisionBusy(true);
        setWritingPatchDecisionError("");
        try {
            const result = await window.aieyraWriting.rejectAgentPatch({ projectId, proposalId: proposal.proposalId });
            if (!result?.ok)
                throw new Error(result?.error || "拒绝 Writing 修改提案失败。");
            removeWritingPatchProposal(projectId, proposal.proposalId);
            setServerMessage(`已拒绝 ${proposal.artifactTitle} 的修改提案，正文与 revision 未变化。`);
        }
        catch (error) {
            const message = describeError(error);
            setWritingPatchDecisionError(message);
            setWritingError(message);
            setServerMessage(message);
        }
        finally {
            setWritingPatchDecisionBusy(false);
        }
    }
    async function loadWritingSessionForAgent(projectId: string) {
        const result = await window.aieyraWriting?.refresh({ projectId });
        if (!result?.ok || !result.session)
            throw new Error(result?.error || "无法刷新 Writing 项目。");
        const session = normalizeWritingRendererSession(result.session);
        projectSessionRevisionRef.current[projectId] = Math.max(projectSessionRevisionRef.current[projectId] || 0, session.sessionRevision);
        return session;
    }
    function settleWritingAgentMessages(source: AgentMessage[], runId: string, finalMessage: AgentMessage) {
        const settled = finishRunStreamingMessages(source, runId);
        const streamPrefix = `assistant-stream-${runId}`;
        const streamIndex = settled.reduce((latest, message, index) => message.meta === "assistant-stream" && message.id.startsWith(streamPrefix) ? index : latest, -1);
        if (streamIndex < 0)
            return [...settled, finalMessage];
        return settled.map((message, index) => index === streamIndex ? {
            ...message,
            content: finalMessage.content,
            status: finalMessage.status,
            meta: finalMessage.meta
        } : message);
    }
    async function persistWritingAgentMessages(projectId: string, conversationId: string, nextMessages: AgentMessage[], runStillTracked: () => boolean, pendingExecution: PendingAgentExecution | null = null) {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (!runStillTracked())
                return null;
            const fresh = await loadWritingSessionForAgent(projectId);
            if (!runStillTracked())
                return null;
            const next: StudioWritingSession = {
                ...fresh, messages: nextMessages, activeConversationId: conversationId, pendingAgentExecution: pendingExecution
            };
            const result = await persistWritingSessionState(projectId, next);
            if (!runStillTracked())
                return null;
            if (result.skippedStale)
                continue;
            if (result.applied === false)
                throw new Error("工作会话尚未保存，请保留当前对话后重试。");
            return { ...(result.session ? normalizeWritingRendererSession(result.session) : next),
                messages: nextMessages, activeConversationId: conversationId, pendingAgentExecution: pendingExecution };
        }
        throw new Error("工作会话持续收到并发更新，本轮记录未能保存，请保留当前对话后重试。");
    }
    async function loadLineageSessionForAgent(projectId: string, projectKind: LineageProjectKind) {
        const result = await window.aieyraLineage?.refresh({ projectId });
        if (!result?.ok || !result.session)
            throw new Error(result?.error || "无法刷新 Data/Finance 项目。");
        const session = await normalizeLineageRendererSession(result.session as WorkflowSession & {
            sessionRevision?: number;
        }, projectKind);
        projectSessionRevisionRef.current[projectId] = session.sessionRevision;
        return session;
    }
    async function persistLineageAgentMessages(projectId: string, projectKind: LineageProjectKind, conversationId: string, nextMessages: AgentMessage[], runStillTracked: () => boolean) {
        if (!runStillTracked())
            return null;
        const fresh = await loadLineageSessionForAgent(projectId, projectKind);
        if (!runStillTracked())
            return null;
        const next: StudioLineageSession = {
            ...fresh,
            messages: nextMessages,
            activeConversationId: conversationId,
            pendingAgentExecution: null
        };
        const result = await persistLineageSessionState(projectId, next);
        if (!runStillTracked())
            return null;
        return result.session
            ? await normalizeLineageRendererSession(result.session as WorkflowSession & {
                sessionRevision?: number;
            }, projectKind)
            : next;
    }
    async function sendWritingPrompt(nextPrompt?: string, visiblePrompt?: string, queuedContext?: QueuedAgentFollowUp, continuation?: {
        pending: PendingAgentExecution;
        selectedOptionId?: string;
    }) {
        if (writingPromptPreflightRef.current) {
            setServerMessage("正在保存当前 Writing 草稿，请等待保存完成后再发送。");
            return;
        }
        if (agentExecutionBusyNow() && (!continuation || agentActiveWorkNow() || stoppingAgentRunRef.current)) {
            setServerMessage("Agent 正在执行当前任务；你可以在对话框继续发送补充，其他画布操作请等待本轮完成。");
            return;
        }
        const fileAttachments = queuedContext?.fileAttachments !== undefined
            ? cloneAgentFileAttachments(queuedContext.fileAttachments)
            : cloneAgentFileAttachments(agentFileAttachmentsRef.current);
        const capturedPrompt = nextPrompt ?? prompt;
        const typedContent = capturedPrompt.trim();
        const content = typedContent || defaultPromptForAgentFiles(fileAttachments);
        const visibleContent = visiblePrompt?.trim() || typedContent || visiblePromptForAgentFiles(fileAttachments) || content;
        if (!content)
            return;
        const referenceCheck = resolveWorkspaceReferences(content, writingReferenceCandidates(writingSessionRef.current.artifacts));
        if (referenceCheck.issues.length) {
            setServerMessage(workspaceReferenceError(referenceCheck.issues));
            return;
        }
        const requestProjectId = activeProjectIdRef.current;
        const targetProject = projectsRef.current.find((project) => project.id === requestProjectId);
        if (!targetProject || targetProject.kind !== "writing" || targetProject.quarantine?.readOnly) {
            setServerMessage("当前项目不是可写的 Writing 项目。");
            return;
        }
        const requestConversationId = activeConversationIdRef.current || uid("conv");
        const preflightRunId = uid("run");
        const preflightStartedAt = Date.now();
        const preflightTaskScope = await agentTaskScopeForRequest([], [], null, "chat", 0);
        const preflightProgress: AgentProgress = {
            runId: preflightRunId,
            projectId: requestProjectId,
            conversationId: requestConversationId,
            phase: "writing-session-save",
            summary: "正在保存 Writing 会话，Agent 尚未启动。",
            createdAt: new Date().toISOString()
        };
        const preflightSession = buildWorkflowSessionSnapshot({
            schemaVersion: 3,
            nodeSequence: 0,
            canvasRevision: 0,
            layoutGroups: [],
            messages: messagesRef.current,
            conversations: conversationsRef.current,
            activeConversationId: requestConversationId,
            nodes: [],
            selectedNodeId: "",
            pendingAgentExecution: null
        });
        const clearPreflightRun = () => {
            if (projectRunsRef.current[requestProjectId]?.runId === preflightRunId)
                removeProjectRun(requestProjectId);
            if (activeRunRef.current === preflightRunId) {
                activeRunRef.current = null;
                setAgentStatus("idle");
                setAgentProgress([]);
            }
        };
        writingPromptPreflightRef.current = true;
        writingPromptPreflightRunRef.current = preflightRunId;
        writingPromptPreflightCancelledRef.current = false;
        activeRunRef.current = preflightRunId;
        setAgentStatus("thinking");
        setAgentProgress([preflightProgress]);
        publishProjectRun({
            projectId: requestProjectId,
            conversationId: requestConversationId,
            runId: preflightRunId,
            status: "running",
            runKind: queuedContext?.summarizePreferences ? "preference-summary" : "agent",
            startedAt: preflightStartedAt,
            progress: [preflightProgress],
            queuedActions: [],
            session: preflightSession,
            taskScope: preflightTaskScope,
            existingNodeIds: [],
            pendingExecution: null
        });
        try {
        }
        catch (error) {
            const cancelled = writingPromptPreflightCancelledRef.current;
            if (!cancelled)
                clearPreflightRun();
            const detail = describeError(error);
            const action = /revision|冲突|变化/i.test(detail)
                ? "请保留或复制当前草稿，刷新最新 revision 后手动合并并重试。"
                : "请检查当前草稿的错误提示，确认保存成功后重试。";
            const message = `Writing 草稿未能保存，Agent 未启动：${detail} ${action}`;
            if (!cancelled) {
                setWritingError(message);
                setServerMessage(message);
                window.setTimeout(() => agentInputRef.current?.focus(), 0);
            }
            writingPromptPreflightRunRef.current = "";
            writingPromptPreflightCancelledRef.current = false;
            return;
        }
        finally {
            writingPromptPreflightRef.current = false;
        }
        if (writingPromptPreflightCancelledRef.current ||
            activeRunRef.current !== preflightRunId ||
            projectRunsRef.current[requestProjectId]?.runId !== preflightRunId) {
            writingPromptPreflightRunRef.current = "";
            writingPromptPreflightCancelledRef.current = false;
            return;
        }
        writingPromptPreflightRunRef.current = "";
        writingPromptPreflightCancelledRef.current = false;
        const currentTargetProject = projectsRef.current.find((project) => project.id === requestProjectId);
        if (activeProjectIdRef.current !== requestProjectId ||
            !currentTargetProject ||
            currentTargetProject.kind !== "writing" ||
            currentTargetProject.quarantine?.readOnly) {
            clearPreflightRun();
            setServerMessage("草稿已保存，但当前项目已经切换；Agent 未启动，请在目标 Writing 项目中重新发送。");
            return;
        }
        if (!await ensureAiConnectionReady("Writing Agent")) {
            clearPreflightRun();
            return;
        }
        if (agentExecutionBusyNow() && activeRunRef.current !== preflightRunId) {
            clearPreflightRun();
            setServerMessage("草稿已保存，但当前项目已有 Agent 任务启动；本次输入未发送，请稍后重试。");
            return;
        }
        const now = Date.now();
        const lastSubmit = lastSubmitRef.current;
        if (lastSubmit?.projectId === requestProjectId &&
            lastSubmit.conversationId === requestConversationId &&
            lastSubmit.text === content &&
            now - lastSubmit.time < 900) {
            addEvent("忽略重复提交");
            return;
        }
        lastSubmitRef.current = { projectId: requestProjectId, conversationId: requestConversationId, text: content, time: now };
        const runId = preflightRunId;
        const userMessage: AgentMessage = {
            id: uid("user"),
            role: "user",
            content: visibleContent,
            createdAt: nowLabel(),
            status: "done",
            meta: "human"
        };
        if (fileAttachments.length) {
            userMessage.attachments = {
                fileAttachments: agentFileAttachmentsForHistory(fileAttachments),
                fileCount: fileAttachments.length,
                totalBytes: fileAttachments.reduce((sum, file) => sum + file.size, 0)
            };
        }
        const requestHistory = messagesRef.current;
        const requestMessages = [...requestHistory, userMessage];
        const writingTaskScope = await agentTaskScopeForRequest([], [], null, "chat", 0);
        const runSession = buildWorkflowSessionSnapshot({
            schemaVersion: 3,
            nodeSequence: 0,
            canvasRevision: 0,
            layoutGroups: [],
            messages: requestMessages,
            conversations: conversationsRef.current,
            activeConversationId: requestConversationId,
            nodes: [],
            selectedNodeId: "",
            pendingAgentExecution: null
        });
        const runtimeRequestProgress: AgentProgress = {
            runId,
            projectId: requestProjectId,
            conversationId: requestConversationId,
            phase: "runtime-request",
            summary: "已发送到 Writing Agent。",
            createdAt: new Date().toISOString()
        };
        const startingWritingSession: StudioWritingSession = {
            ...writingSessionRef.current,
            messages: requestMessages,
            activeConversationId: requestConversationId,
            pendingAgentExecution: null
        };
        activeConversationIdRef.current = requestConversationId;
        writingSessionRef.current = startingWritingSession;
        messagesRef.current = requestMessages;
        setWritingSession(startingWritingSession);
        setMessages(requestMessages);
        setActiveConversationId(requestConversationId);
        if (!queuedContext)
            composerDraft.consume(typedContent);
        setAgentStatus("thinking");
        setAgentProgress([runtimeRequestProgress]);
        activeRunRef.current = runId;
        publishProjectRun({
            projectId: requestProjectId,
            conversationId: requestConversationId,
            runId,
            status: "running",
            runKind: queuedContext?.summarizePreferences ? "preference-summary" : "agent",
            startedAt: now,
            progress: [runtimeRequestProgress],
            queuedActions: [],
            session: runSession,
            taskScope: writingTaskScope,
            existingNodeIds: [],
            pendingExecution: null
        });
        const runStillTracked = () => projectRunsRef.current[requestProjectId]?.runId === runId &&
            projectRunsRef.current[requestProjectId]?.status !== "cancelled";
        const runIsActive = () => !projectTransitionRef.current && runStillTracked() &&
            activeProjectIdRef.current === requestProjectId && activeRunRef.current === runId;
        try {
            await persistWritingSessionState(requestProjectId, startingWritingSession);
            if (!runStillTracked())
                return;
            if (runIsActive() && pendingAgentExecutionRef.current)
                closePendingAgentExecution(pendingAgentExecutionRef.current.requestId, !continuation);
            const runtimeResult = await requestAgent(requestHistory, [], content, runId, [], requestProjectId, requestConversationId, undefined, [], undefined, { projectKind: "writing", originalPrompt: continuation?.pending.originalPrompt,
                userReply: continuation ? { requestId: continuation.pending.requestId, selectedOptionId: continuation.selectedOptionId } : undefined }, fileAttachments);
            if (!runStillTracked())
                return;
            const workActions = runtimeResult.actions ?? [];
            if (workActions.some(action => action.type !== "ui.ask_user.open" || !action.request || !["clarify", "confirm"].includes(action.request.kind || "clarify"))) {
                throw new Error("工作 Agent 返回了未支持的界面操作，已保留现有成果。");
            }
            const askAction = workActions.find(action => action.request);
            const nextPendingExecution: PendingAgentExecution | null = askAction?.request ? {
                version: 2, requestId: askAction.request.requestId || askAction.operationId || `${runId}-ask`,
                projectId: requestProjectId, conversationId: requestConversationId,
                originalPrompt: continuation?.pending.originalPrompt || content,
                sourceNodeIds: [], taskOrigin: "chat", taskScope: writingTaskScope,
                kind: askAction.request.kind === "confirm" ? "confirm" : "clarify",
                title: askAction.request.title || "补充关键信息", question: askAction.request.question || "请补充信息。",
                detail: askAction.request.detail, suggestedAnswer: askAction.request.suggestedAnswer,
                options: sanitizeAgentAskUserOptions(askAction.request.options), createdAt: new Date().toISOString()
            } : null;
            const publicToolResults = runtimeResult.toolResults ?? [];
            enqueueWritingPatchProposals(requestProjectId, publicToolResults);
            const failedToolResults = unresolvedWritingToolFailures(publicToolResults);
            const runtimeFailed = failedToolResults.length > 0;
            const failureMessage = String([...failedToolResults].reverse().find((result) => result.error)?.error ||
                [...failedToolResults].reverse().find((result) => result.summary)?.summary ||
                "Writing Agent 工具执行失败。").trim();
            const answer = runtimeFailed
                ? `Writing Agent 工具执行失败：${failureMessage}`
                : sanitizeAgentVisibleText(runtimeResult.content?.trim() || (nextPendingExecution ? "请补充关键信息，回答后继续。" : "本轮工作已保存。")) || "本轮工作已保存。";
            const finalMessage: AgentMessage = {
                id: uid("assistant"),
                role: "assistant",
                content: answer,
                createdAt: nowLabel(),
                status: runtimeFailed ? "error" : "done",
                meta: runtimeFailed ? "error" : settings.agentModel ? `${settings.agentModel} / ${settings.reasoningEffort}` : "agent"
            };
            flushPendingAgentStreamMessages();
            const tracked = projectRunsRef.current[requestProjectId];
            const baseMessages = runIsActive() ? messagesRef.current : tracked?.session.messages ?? requestMessages;
            const finalMessages = settleWritingAgentMessages(baseMessages, runId, finalMessage);
            const persisted = await persistWritingAgentMessages(requestProjectId, requestConversationId, finalMessages, runStillTracked, nextPendingExecution);
            if (!persisted || !runStillTracked())
                return;
            const stillActive = runIsActive();
            const finalRunSession = { ...(tracked?.session ?? runSession), messages: finalMessages, pendingAgentExecution: nextPendingExecution };
            if (stillActive) {
                writingSessionRef.current = persisted;
                messagesRef.current = finalMessages;
                setWritingSession(persisted);
                setMessages(finalMessages);
                setAgentStatus(runtimeFailed ? "error" : "idle");
                activeRunRef.current = null;
                if (runtimeFailed) {
                    updateProjectRun(requestProjectId, (current) => ({ ...current, status: "error", error: failureMessage, session: finalRunSession, finalMessage }));
                }
                else if (nextPendingExecution) {
                    updateProjectRun(requestProjectId, current => ({ ...current, status: "waiting", pendingExecution: nextPendingExecution, session: finalRunSession }));
                    commitPendingAgentExecution(nextPendingExecution);
                    setAskUserMinimized(false);
                    setAskUserDraft({ ...nextPendingExecution, kind: nextPendingExecution.kind === "confirm" ? "confirm" : "clarify" });
                }
                else {
                    removeProjectRun(requestProjectId);
                }
            }
            else {
                updateProjectRun(requestProjectId, (current) => ({
                    ...current,
                    status: runtimeFailed ? "error" : nextPendingExecution ? "waiting" : "completed",
                    pendingExecution: nextPendingExecution,
                    error: runtimeFailed ? failureMessage : "",
                    session: finalRunSession,
                    finalMessage
                }));
            }
        }
        catch (error) {
            const message = describeError(error);
            if (!runStillTracked())
                return;
            const errorMessage: AgentMessage = {
                id: uid("assistant"),
                role: "assistant",
                content: `Writing Agent 调用失败：${message}`,
                createdAt: nowLabel(),
                status: "error",
                meta: "error"
            };
            flushPendingAgentStreamMessages();
            const tracked = projectRunsRef.current[requestProjectId];
            const active = runIsActive();
            const baseMessages = active ? messagesRef.current : tracked?.session.messages ?? requestMessages;
            const finalMessages = settleWritingAgentMessages(baseMessages, runId, errorMessage);
            await persistWritingAgentMessages(requestProjectId, requestConversationId, finalMessages, runStillTracked).catch(() => null);
            if (!runStillTracked())
                return;
            updateProjectRun(requestProjectId, (current) => ({
                ...current,
                status: "error",
                error: message,
                session: { ...current.session, messages: finalMessages },
                finalMessage: errorMessage
            }));
            if (active) {
                messagesRef.current = finalMessages;
                setMessages(finalMessages);
                setAgentStatus("error");
                activeRunRef.current = null;
            }
        }
    }
    async function sendLineagePrompt(nextPrompt?: string, visiblePrompt?: string, queuedContext?: QueuedAgentFollowUp) {
        if (!__AIEYRA_DEV__)
            return;
        if (agentExecutionBusyNow()) {
            setServerMessage("Agent 正在执行当前任务；你可以在对话框继续发送补充，其他画布操作请等待本轮完成。");
            return;
        }
        const fileAttachments = queuedContext?.fileAttachments !== undefined
            ? cloneAgentFileAttachments(queuedContext.fileAttachments)
            : cloneAgentFileAttachments(agentFileAttachmentsRef.current);
        const capturedPrompt = nextPrompt ?? prompt;
        const typedContent = capturedPrompt.trim();
        const content = typedContent || defaultPromptForAgentFiles(fileAttachments);
        const visibleContent = visiblePrompt?.trim() || typedContent || visiblePromptForAgentFiles(fileAttachments) || content;
        if (!content)
            return;
        const requestProjectId = activeProjectIdRef.current;
        const targetProject = projectsRef.current.find((project) => project.id === requestProjectId);
        if (!targetProject || (targetProject.kind !== "data" && targetProject.kind !== "finance") || targetProject.quarantine?.readOnly) {
            setServerMessage("当前项目不是可写的 Data/Finance 项目。");
            return;
        }
        if (!await ensureAiConnectionReady(`${targetProject.kind === "finance" ? "Finance" : "Data"} Agent`)) {
            return;
        }
        if (agentExecutionBusyNow()) {
            setServerMessage("当前项目已有 Agent 任务启动；本次输入未发送，请稍后重试。");
            return;
        }
        const pendingCanvasCommit = lineageCanvasCommitQueueRef.current[requestProjectId];
        if (pendingCanvasCommit) {
            try {
                await pendingCanvasCommit;
            }
            catch (error) {
                setServerMessage(`当前画布状态尚未保存：${describeError(error)}`);
                return;
            }
        }
        if (activeProjectIdRef.current !== requestProjectId || agentExecutionBusyNow()) {
            setServerMessage(activeProjectIdRef.current !== requestProjectId
                ? "项目已切换，本次输入未发送。"
                : "当前项目已有 Agent 任务启动；本次输入未发送，请稍后重试。");
            return;
        }
        const requestConversationId = activeConversationIdRef.current || uid("conv");
        const now = Date.now();
        const lastSubmit = lastSubmitRef.current;
        if (lastSubmit?.projectId === requestProjectId &&
            lastSubmit.conversationId === requestConversationId &&
            lastSubmit.text === content &&
            now - lastSubmit.time < 900) {
            addEvent("忽略重复提交");
            return;
        }
        lastSubmitRef.current = { projectId: requestProjectId, conversationId: requestConversationId, text: content, time: now };
        const projectKind: LineageProjectKind = targetProject.kind;
        const runId = uid("run");
        const userMessage: AgentMessage = {
            id: uid("user"),
            role: "user",
            content: visibleContent,
            createdAt: nowLabel(),
            status: "done",
            meta: "human"
        };
        if (fileAttachments.length) {
            userMessage.attachments = {
                fileAttachments: agentFileAttachmentsForHistory(fileAttachments),
                fileCount: fileAttachments.length,
                totalBytes: fileAttachments.reduce((sum, file) => sum + file.size, 0)
            };
        }
        const requestHistory = messagesRef.current;
        const requestMessages = [...requestHistory, userMessage];
        const taskScope = await agentTaskScopeForRequest([], [], null, "chat", 0);
        const runSession = buildWorkflowSessionSnapshot({
            schemaVersion: 3,
            nodeSequence: 0,
            canvasRevision: 0,
            layoutGroups: [],
            messages: requestMessages,
            conversations: conversationsRef.current,
            activeConversationId: requestConversationId,
            nodes: [],
            selectedNodeId: "",
            pendingAgentExecution: null
        });
        const runtimeRequestProgress: AgentProgress = {
            runId,
            projectId: requestProjectId,
            conversationId: requestConversationId,
            phase: "runtime-request",
            summary: `已发送到 ${projectKind === "finance" ? "Finance" : "Data"} Agent。`,
            createdAt: new Date().toISOString()
        };
        const startingLineageSession: StudioLineageSession = {
            ...lineageSessionRef.current,
            messages: requestMessages,
            activeConversationId: requestConversationId,
            pendingAgentExecution: null
        };
        activeConversationIdRef.current = requestConversationId;
        lineageSessionRef.current = startingLineageSession;
        messagesRef.current = requestMessages;
        setLineageSession(startingLineageSession);
        setMessages(requestMessages);
        setActiveConversationId(requestConversationId);
        if (!queuedContext)
            composerDraft.consume(typedContent);
        setAgentStatus("thinking");
        setAgentProgress([runtimeRequestProgress]);
        activeRunRef.current = runId;
        publishProjectRun({
            projectId: requestProjectId,
            conversationId: requestConversationId,
            runId,
            status: "running",
            runKind: queuedContext?.summarizePreferences ? "preference-summary" : "agent",
            startedAt: now,
            progress: [runtimeRequestProgress],
            queuedActions: [],
            session: runSession,
            taskScope,
            existingNodeIds: [],
            pendingExecution: null
        });
        const runStillTracked = () => projectRunsRef.current[requestProjectId]?.runId === runId &&
            projectRunsRef.current[requestProjectId]?.status !== "cancelled";
        const runIsActive = () => !projectTransitionRef.current && runStillTracked() &&
            activeProjectIdRef.current === requestProjectId && activeRunRef.current === runId;
        const selectedLineageArtifactId = queuedContext?.selectedLineageArtifactId || startingLineageSession.selectedLineageArtifactId;
        try {
            await persistLineageSessionState(requestProjectId, startingLineageSession);
            if (!runStillTracked())
                return;
            const runtimeResult = await requestAgent(requestHistory, [], content, runId, [], requestProjectId, requestConversationId, undefined, [], undefined, { projectKind, selectedLineageArtifactId, summarizePreferences: queuedContext?.summarizePreferences }, fileAttachments);
            if (!runStillTracked())
                return;
            if ((runtimeResult.actions ?? []).length) {
                throw new Error(`${projectKind === "finance" ? "Finance" : "Data"} Agent 返回了未授权的画布 action，已拒绝应用。`);
            }
            const publicToolResults = runtimeResult.toolResults ?? [];
            const failedToolResults = unresolvedWritingToolFailures(publicToolResults);
            const runtimeFailed = failedToolResults.length > 0;
            const failureMessage = String([...failedToolResults].reverse().find((result) => result.error)?.error ||
                [...failedToolResults].reverse().find((result) => result.summary)?.summary ||
                `${projectKind === "finance" ? "Finance" : "Data"} Agent 工具执行失败。`).trim();
            const agentLabel = projectKind === "finance" ? "Finance Agent" : "Data Agent";
            const answer = runtimeFailed
                ? `${agentLabel} 工具执行失败：${failureMessage}`
                : sanitizeAgentVisibleText(runtimeResult.content?.trim() || `${agentLabel} 任务已完成。`) || `${agentLabel} 任务已完成。`;
            const finalMessage: AgentMessage = {
                id: uid("assistant"),
                role: "assistant",
                content: answer,
                createdAt: nowLabel(),
                status: runtimeFailed ? "error" : "done",
                meta: runtimeFailed ? "error" : settings.agentModel ? `${settings.agentModel} / ${settings.reasoningEffort}` : "agent"
            };
            flushPendingAgentStreamMessages();
            const tracked = projectRunsRef.current[requestProjectId];
            const baseMessages = runIsActive() ? messagesRef.current : tracked?.session.messages ?? requestMessages;
            const finalMessages = settleWritingAgentMessages(baseMessages, runId, finalMessage);
            const persisted = await persistLineageAgentMessages(requestProjectId, projectKind, requestConversationId, finalMessages, runStillTracked);
            if (!persisted || !runStillTracked())
                return;
            const stillActive = runIsActive();
            const finalRunSession = { ...(tracked?.session ?? runSession), messages: finalMessages };
            if (stillActive) {
                lineageSessionRef.current = persisted;
                messagesRef.current = finalMessages;
                setLineageSession(persisted);
                setMessages(finalMessages);
                setAgentStatus(runtimeFailed ? "error" : "idle");
                activeRunRef.current = null;
                if (runtimeFailed) {
                    updateProjectRun(requestProjectId, (current) => ({ ...current, status: "error", error: failureMessage, session: finalRunSession, finalMessage }));
                }
                else {
                    removeProjectRun(requestProjectId);
                }
            }
            else {
                updateProjectRun(requestProjectId, (current) => ({
                    ...current,
                    status: runtimeFailed ? "error" : "completed",
                    error: runtimeFailed ? failureMessage : "",
                    session: finalRunSession,
                    finalMessage
                }));
            }
        }
        catch (error) {
            const message = describeError(error);
            if (!runStillTracked())
                return;
            const errorMessage: AgentMessage = {
                id: uid("assistant"),
                role: "assistant",
                content: `${projectKind === "finance" ? "Finance" : "Data"} Agent 调用失败：${message}`,
                createdAt: nowLabel(),
                status: "error",
                meta: "error"
            };
            flushPendingAgentStreamMessages();
            const tracked = projectRunsRef.current[requestProjectId];
            const active = runIsActive();
            const baseMessages = active ? messagesRef.current : tracked?.session.messages ?? requestMessages;
            const finalMessages = settleWritingAgentMessages(baseMessages, runId, errorMessage);
            await persistLineageAgentMessages(requestProjectId, projectKind, requestConversationId, finalMessages, runStillTracked).catch(() => null);
            if (!runStillTracked())
                return;
            updateProjectRun(requestProjectId, (current) => ({
                ...current,
                status: "error",
                error: message,
                session: { ...current.session, messages: finalMessages },
                finalMessage: errorMessage
            }));
            if (active) {
                messagesRef.current = finalMessages;
                setMessages(finalMessages);
                setAgentStatus("error");
                activeRunRef.current = null;
            }
        }
    }
    const agentExecutionBusy = isAgentExecutionBusy({
        reservation: executionReservation,
        activeRun: Boolean(activeRunRef.current),
        activeImageRunCount: 0,
        status: agentStatus,
        pending: Boolean(pendingAgentExecution)
    });
    useEffect(() => {
        if (!backgroundReady || !window.aieyraAgent?.imageJobs)
            return;
        let disposed = false;
        void window.aieyraAgent.imageJobs().then(async (result) => {
            if (disposed)
                return;
            for (const job of result.jobs || []) {
                if (job.delivered || job.status === "cancelled")
                    continue;
                await recoverImageJobProject(job);
                if (disposed)
                    return;
                handleBackgroundImageProgress({ runId: job.id, backgroundJobId: job.id, parentRunId: job.parentRunId,
                    projectId: job.projectId, conversationId: job.conversationId, imageJob: job, originalPrompt: job.prompt,
                    input: job.input, startedAtMs: job.startedAt, phase: job.status === "running" ? "background-image-start" : "background-image-result",
                    summary: job.status === "completed" ? "图片已返回" : job.result?.envelope?.summary });
                const entry = backgroundImageJobsRef.current.get(job.id);
                if (entry && job.status === "running")
                    commitBackgroundImageActions(entry, job.actions);
            }
        }).catch(error => addEvent(`恢复图片任务失败：${describeError(error)}`));
        return () => { disposed = true; };
    }, [backgroundReady, activeProjectId]);
    const canvasStageTransform = canvasViewportTransform(viewportInteractionActiveRef.current ? viewportRef.current : viewport, viewportInteractionActiveRef.current);
    const activeProjectRunRecord = projectRunsRef.current[activeProjectId];
    const activeTaskScope = activeProjectRunRecord?.status === "running" || activeProjectRunRecord?.status === "waiting"
        ? activeProjectRunRecord.taskScope
        : null;
    const workScopeNodeIds = activeTaskScope ? [...new Set([
            ...(activeTaskScope.explicitMentions || []).map((mention) => mention.nodeId),
            ...activeTaskScope.sourceNodeIds,
            ...(activeTaskScope.contextNodeIds || []),
            ...Object.keys(imageRunStarts)
        ].map((nodeId) => layoutProjection.groupByMember.get(nodeId)?.hostNodeId ?? nodeId).filter(Boolean))] : Object.keys(imageRunStarts);
    const agentWorkFocusNodeId = workScopeNodeIds[0] || (agentExecutionBusy ? activeNodeId || selectedNodeId : "");
    const agentWorkNodeIdSet = new Set<string>();
    if (agentExecutionBusy) {
        workScopeNodeIds.forEach((nodeId) => agentWorkNodeIdSet.add(nodeId));
        if (agentWorkFocusNodeId)
            agentWorkNodeIdSet.add(agentWorkFocusNodeId);
        const directWorkNodeIds = new Set(agentWorkNodeIdSet);
        for (const edge of edges) {
            if (directWorkNodeIds.has(edge.source.id) || directWorkNodeIds.has(edge.target.id)) {
                agentWorkNodeIdSet.add(edge.source.id);
                agentWorkNodeIdSet.add(edge.target.id);
            }
        }
    }
    if (!firstWorkspaceRenderMarked) {
        firstWorkspaceRenderMarked = true;
        markPerformancePhase("workspace-render");
    }
    return (<ImageMentionContext.Provider value={imageMentionNavigation}>
    <div className="ide-shell unified-workspace" {...(!configReady ? { inert: "" } : {})} aria-busy={!configReady} data-canvas-ready={configReady} data-project-surface={projectSurface} onCopyCapture={copySelectedCanvasNodes} onPasteCapture={pasteCanvasClipboard}>
      {AIEYRA_RUNTIME_METRICS ? <DebugCommitProbe area="app" record={recordDebugRenderCommit}/> : null}
      <OverflowTooltipLayer />
      <header ref={attachToolbar} className="module-command-bar workspace-command-bar">
        <strong>Workspace</strong>
        <span className="program-context">{activeProject?.name || ""}</span>
        <button type="button" onClick={() => setProjectHistoryOpen(true)}><FolderOpen size={16}/>项目</button>
      </header>

      <main className="ide-main canvas-only agent-mode" style={{
            "--inspector-w": `${workspaceLayout.inspectorWidth}px`,
            "--agent-w": `${workspaceLayout.agentWidth}px`
        } as React.CSSProperties & Record<string, string>}>
        <section id="workspace-canvas-panel" className="canvas-panel" aria-label="无限画布">
          {projectWorkspaceOpen ? <>
          {activeProject?.kind !== "image" || activeProject.quarantine?.readOnly ? (<div className="project-workspace-boundary" data-project-kind={activeProject?.kind || "unknown"}>
              <span aria-hidden="true">
                {activeProject?.quarantine?.readOnly ? <Shield size={24}/> : <Workflow size={24}/>}
              </span>
              <div>
                <small>{activeProject?.quarantine?.readOnly ? "COMPATIBILITY VIEW" : "TYPED WORKSPACE"}</small>
                <h2>{activeProject?.quarantine?.readOnly ? "项目以兼容方式打开" : "历史项目文件保留"}</h2>
                <p>
                  {activeProject?.quarantine?.readOnly
                    ? `当前版本不支持项目类型“${activeProject.kind}”。原始 session 与 manifest 不会经过图片清理器，也不会被自动改写。`
                    : "当前工作台仅开放统一画布。原项目与作品仍保留在原目录。"}
                </p>
              </div>
              <ActionButton onClick={openCurrentProjectFolder} icon={<FolderOpen size={15}/>}>打开项目文件夹</ActionButton>
            </div>) : (<>
          {AIEYRA_RUNTIME_METRICS ? <DebugCommitProbe area="canvas" record={recordDebugRenderCommit}/> : null}
          <div ref={bindCanvasRef} className={`workflow-canvas ${externalCanvasDropActive ? "external-file-drop-active" : ""}`} tabIndex={-1} onContextMenu={openCanvasMenu} onDragOver={handleCanvasDragOver} onDragLeave={(event) => {
                    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
                        return;
                    clearMergeHover();
                    setExternalCanvasDropActive(false);
                }} onDrop={handleCanvasDrop} onClick={(event) => {
                    setCanvasMenu(null);
                    if (!(event.target as HTMLElement).closest(".flow-node"))
                        return;
                }}>
            {externalCanvasDropActive ? (<div className="canvas-external-file-drop" role="status" aria-live="polite">
                <ImageIcon size={22}/>
                <strong>松开即可导入当前项目</strong>
                <span>图片和文件夹会先复制到项目素材库</span>
              </div>) : null}
            <CanvasPlatformBackdrop />
            {canvasOperationNotice ? (<div className="canvas-operation-notice" role="status" aria-live="polite" {...({})}>
                <Workflow size={15} aria-hidden="true"/>
                <span>{canvasOperationNotice.message}</span>
              </div>) : null}

            {!renderedNodes.length && !externalCanvasDropActive ? (<CanvasPlatformEmptyState ariaLabel="无限画布" title="欢迎使用 Aieyra Workspace" description="告诉画布 Agent 你的目标，或拖入图片开始。"/>) : null}
            {canvasSelectionSummary ? (<React.Suspense fallback={null}>
                <CanvasPlatformSelectionIndicator key={`${canvasSelectionSummary.kind}:${selectedNodes.map((node) => node.id).join(":")}`} icon={<ImageIcon size={18}/>} title={canvasSelectionSummary.title} detail={canvasSelectionSummary.detail} fullText={canvasSelectionSummary.fullText} kind={canvasSelectionSummary.kind} count={selectedNodes.length} ids={selectedNodes.map((node) => node.id)} displayOnly onFocus={() => focusWorkflowNodes(selectedNodes, { recordEvent: false })}/>
              </React.Suspense>) : null}
            <div ref={canvasStageRef} className="canvas-stage" style={{
                    width: stageSize.width,
                    height: stageSize.height,
                    transform: canvasStageTransform,
                    "--canvas-scale": String(zoom),
                    "--media-toolbar-height": `${MEDIA_TOOLBAR_HEIGHT}px`,
                    "--media-toolbar-bottom": `${MEDIA_TOOLBAR_BOTTOM}px`,
                    "--media-frame-inset": `${MEDIA_FRAME_INSET}px`,
                    "--port-zoom-compensation": String(clamp(0.72 / Math.max(zoom, ZOOM_MIN), 1, 4))
                } as React.CSSProperties}>
              <svg className="edge-layer" viewBox={`${-WORLD_MARGIN} ${-WORLD_MARGIN} ${stageSize.width + WORLD_MARGIN * 2} ${stageSize.height + WORLD_MARGIN * 2}`} style={{
                    left: -WORLD_MARGIN,
                    top: -WORLD_MARGIN,
                    width: stageSize.width + WORLD_MARGIN * 2,
                    height: stageSize.height + WORLD_MARGIN * 2
                }} aria-hidden="true">
                {renderedEdges.map(({ source: originalSource, target: originalTarget, kind, inputRole, laneIndex, laneCount }) => {
                    const source = originalSource, target = originalTarget;
                    const edgeKey = `${kind}-${source.id}-${target.id}`;
                    const active = activeNodeId === target.id || selectedNodeIdSet.has(target.id) || selectedNodeIdSet.has(source.id);
                    const agentWorkLink = agentExecutionBusy && agentWorkNodeIdSet.has(source.id) && agentWorkNodeIdSet.has(target.id);
                    return (<path key={edgeKey} ref={element => {
                            if (element)
                                edgeZoomUpdatesRef.current.set(edgeKey, scale => element.setAttribute("d", provenanceEdgePath(source, target, laneIndex, laneCount, scale)));
                            else
                                edgeZoomUpdatesRef.current.delete(edgeKey);
                        }} className={`edge provenance relation-${kind} ${inputRole ? `input-${inputRole}` : ""} ${active ? "active" : ""} ${agentWorkLink ? "agent-work-link" : ""}`} data-source-id={source.id} data-target-id={target.id} data-relation={kind} data-input-role={inputRole || undefined} vectorEffect="non-scaling-stroke" d={provenanceEdgePath(source, target, laneIndex, laneCount, cullingViewport?.scale || zoom)}/>);
                })}
                {connectionDraft ? (() => {
                    const original = nodes.find((node) => node.id === connectionDraft.sourceId);
                    if (!original)
                        return null;
                    const source = original;
                    const bounds = workflowNodeBounds(source);
                    const x1 = bounds.x + bounds.width;
                    const mid = (x1 + connectionDraft.worldX) / 2;
                    const draftPath = (scale: number) => {
                        const y1 = bounds.y + nodeConnectionY(source, scale);
                        return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${connectionDraft.worldY}, ${connectionDraft.worldX} ${connectionDraft.worldY}`;
                    };
                    return (<path ref={element => {
                            if (element)
                                edgeZoomUpdatesRef.current.set("draft", scale => element.setAttribute("d", draftPath(scale)));
                            else
                                edgeZoomUpdatesRef.current.delete("draft");
                        }} className="edge edge-draft active" vectorEffect="non-scaling-stroke" d={draftPath(zoom)}/>);
                })() : null}
              </svg>

              {renderedNodes.map((node) => {
                    if (node.type === "video" && node.video) return <VideoCanvasNode key={node.id} node={node as VideoNode}
                        selected={selectedNodeIdSet.has(node.id) || selectedNodeId === node.id}
                        onSelect={()=>selectNodeFromPlainClick(node.id)}
                        onOpen={()=>setVideoEditor({projectId:activeProjectIdRef.current,assetId:node.video?.asset?.id,timelineId:node.video?.timeline?.id})}
                        onSave={()=>void callVideo("save_file",{assetId:node.video?.asset?.id}).catch(error=>showCanvasOperationNotice(describeError(error)))}
                        onRemove={()=>commitNodeRemoval([node.id],{historyLabel:"移出视频",eventText:"视频已移出画布，原素材保留",agentText:"用户将视频节点移出画布，原素材和剪辑仍保留。"})}
                        onPointerDown={event=>beginNodeDrag(event,node)} onPointerMove={event=>moveNode(event,node)} onPointerUp={event=>endNodeDrag(event,node)} onResize={event=>beginNodeResize(event,node)}/>;
                    const nodeIsGenerating = Boolean(imageRunStarts[node.id]);
                    const isNewHighlight = newNodeHighlightIds.includes(node.id);
                    const renderAsOverview = canvasNodeOverviewMode
                        && !selectedNodeIdSet.has(node.id)
                        && selectedNodeId !== node.id
                        && activeNodeId !== node.id
                        && !isNewHighlight
                        && resizingNodeId !== node.id
                        && assetDropTargetId !== node.id
                        && connectionDraft?.sourceId !== node.id
                        && !nodeIsGenerating;
                    if (renderAsOverview) {
                        const bounds = workflowNodeBounds(node);
                        return (<div key={node.id} data-node-id={node.id} data-node-overview="true" data-ui-interactive="true" data-image-container={node.imageContainer ? "true" : undefined} data-node-styled={node.appearance && Object.keys(node.appearance).length ? "true" : undefined} data-image-container-kind={imageContainerKindForNode(node) || undefined} data-image-collection={node.imageCollection?.kind || undefined} data-layer-group={node.layerGroup?.id || node.layerComposition?.id || undefined} data-agent-work={agentWorkNodeIdSet.has(node.id) ? agentWorkFocusNodeId === node.id ? "focus" : "related" : undefined} role="button" tabIndex={0} aria-label={node.title?.trim() || node.id} title={`${node.title?.trim() || node.id} · 单击查看完整节点`} className={`flow-node canvas-node-overview ${node.type} ${node.type === "requirement" ? "requirement-node" : ""} ${node.imageContainer ? "image-container" : ""} ${node.imageCollection ? "image-collection" : ""} ${node.layerComposition || node.layerGroup ? "layer-overview" : ""} ${node.status} ${agentWorkNodeIdSet.has(node.id) ? "agent-work-related" : ""} ${agentWorkFocusNodeId === node.id ? "agent-work-focus" : ""} ${draggingNodeId === node.id ? "dragging" : ""} ${isNewHighlight ? "is-new-highlight" : ""}`} style={{
                                left: node.x,
                                top: node.y,
                                zIndex: nodeRenderZIndex(node, nodeStackById, selectedNodeIdSet, selectedNodeId, draggingNodeId === node.id),
                                width: bounds.width,
                                height: bounds.height,
                                minWidth: bounds.width,
                                minHeight: bounds.height
                            }} onPointerDown={(event) => beginNodeDrag(event, node)} onPointerMove={(event) => moveNode(event, node)} onPointerUp={(event) => endNodeDrag(event, node)} onPointerCancel={(event) => endNodeDrag(event, node)} onClick={(event) => {
                                event.stopPropagation();
                                selectNodeFromPlainClick(node.id);
                            }} onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (node.type === "requirement")
                                    openRequirementEditor(node);
                                else
                                    openNodeEditor(node);
                            }} onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ")
                                    return;
                                event.preventDefault();
                                selectNodeFromPlainClick(node.id, "keyboard-plain-select");
                            }} onContextMenu={(event) => openNodeMenu(event, node)}/>);
                    }
                    const promptPreview = "";
                    const visibleAssets = node.assets ?? [];
                    const canvasPreviewAssets = visibleAssets.slice(0, 99);
                    const containerOverflowCount = Math.max(0, visibleAssets.length - canvasPreviewAssets.length);
                    const layerGroup = node.layerGroup;
                    const stackedLayerMember = Boolean(layerGroup && !layerGroup.detached);
                    const slotCount = imageNodeSlotCount(node);
                    const displaySlotCount = Math.min(99, Math.max(canvasPreviewAssets.length, slotCount, 1));
                    const nodeImageSize = imageTaskSizeForNode(node);
                    const gridRatios = imageRatiosForAssets(canvasPreviewAssets, displaySlotCount, nodeImageSize);
                    const gridPresentation = imageGridPresentationForRatios(displaySlotCount, gridRatios, imageTileRatioForSize(nodeImageSize));
                    const nodeMinimum = minimumNodeSize(node);
                    const mediaShell = hasMediaNodeToolbar(node);
                    const adaptiveGroupSize = displaySizeForImageNode(nodeImageSize, displaySlotCount, canvasPreviewAssets);
                    const clampedRenderSize = hasSingleImageFrame(node)
                        ? singleImageFrameSize(nodeImageSize, node.width ?? adaptiveGroupSize.width ?? NODE_W, visibleAssets)
                        : node.imageContainer
                            ? {
                                width: clamp(Number(node.width ?? adaptiveGroupSize.width ?? IMAGE_CONTAINER_W), nodeMinimum.width ?? IMAGE_CONTAINER_MIN_W, NODE_RESIZE_MAX_W),
                                height: clamp(Number(node.height ?? adaptiveGroupSize.height ?? IMAGE_CONTAINER_H), nodeMinimum.height ?? IMAGE_CONTAINER_MIN_H, NODE_RESIZE_MAX_H)
                            }
                            : node.imageCollection
                                ? {
                                    width: clamp(Number(node.width ?? (node.imageCollection.kind === "series" ? IMAGE_COLLECTION_W : adaptiveGroupSize.width)), nodeMinimum.width ?? 360, NODE_RESIZE_MAX_W),
                                    height: clamp(Number(node.height ?? (node.imageCollection.kind === "series" ? IMAGE_COLLECTION_SERIES_H : adaptiveGroupSize.height ?? IMAGE_COLLECTION_BATCH_H)), nodeMinimum.height ?? (node.imageCollection.kind === "series" ? 260 : 300), NODE_RESIZE_MAX_H)
                                }
                                : layerGroup && !layerGroup.detached
                                    ? {
                                        width: Number(node.width ?? layerArtboardDisplaySize(layerGroup.compositionWidth, layerGroup.compositionHeight).width),
                                        height: Number(node.height ?? layerArtboardDisplaySize(layerGroup.compositionWidth, layerGroup.compositionHeight).height)
                                    }
                                    : node.layerComposition
                                        ? {
                                            width: clamp(Number(node.width ?? LAYER_STACK_W), 360, NODE_RESIZE_MAX_W),
                                            height: clamp(Number(node.height ?? LAYER_STACK_H), 420, NODE_RESIZE_MAX_H)
                                        }
                                        : node.type === "image"
                                            ? clampImageNodeDimensions(imageTaskSizeForNode(node), slotCount, node.width, node.height, visibleAssets)
                                            : {
                                                width: Math.max(node.width ?? NODE_W, nodeMinimum.width ?? NODE_RESIZE_MIN_W),
                                                height: node.height ? Math.max(node.height, nodeMinimum.height ?? NODE_RESIZE_MIN_H) : undefined
                                            };
                    const renderWidth = clampedRenderSize.width;
                    const renderHeight = clampedRenderSize.height;
                    const previewBaseHeight = renderHeight ?? nodeMinimum.height ?? NODE_RESIZE_MIN_H;
                    const pendingTileCount = pendingImageTileCount(node, nodeIsGenerating);
                    const failedTileCount = nodeIsGenerating ? 0 : Math.max(0, Number(node.imageProgress?.failed ?? node.imageProgress?.failedSlots?.length ?? 0) || 0);
                    const imageProgressText = nodeIsGenerating ? "" : nodeImageProgressText(node);
                    const visibleNodeError = nodeIsGenerating ? "" : nodeErrorMessage(node);
                    const hasImageProgressBlock = node.type === "image" && Boolean(node.imageState !== "error" && !failedTileCount && imageProgressText);
                    const previewReserve = imageNodePreviewReserve(node, promptPreview, hasImageProgressBlock);
                    const renderedPreviewHeight = node.type === "image" ? Math.max(1, previewBaseHeight - (mediaShell ? 52 : previewReserve)) : 0;
                    const layerCanvasSize = node.layerComposition ? (() => {
                        const ratio = Math.max(0.05, Number(node.layerComposition.width || 1) / Math.max(1, Number(node.layerComposition.height || 1)));
                        const maxWidth = Math.max(140, renderWidth - 22);
                        const maxHeight = Math.max(140, renderedPreviewHeight - 58);
                        if (ratio >= maxWidth / maxHeight)
                            return { width: maxWidth, height: maxWidth / ratio };
                        return { width: maxHeight * ratio, height: maxHeight };
                    })() : null;
                    const nodeTitle = nodeWorkName(node);
                    const outputConnected = nodesWithOutputs.has(node.id);
                    const requirementBindings = node.type === "requirement" ? requirementInputBindings(node, nodes) : [];
                    const mentionBudget = renderedNodes.length >= CANVAS_PREVIEW_MANY_NODES ? 8 : 40;
                    const requirementMentions = requirementBindings.flatMap(binding => {
                        const source = canvasNodeById.get(binding.nodeId);
                        if (!source)
                            return [];
                        return source.assets?.length ? source.assets.map((asset, index) => ({
                            code: asset.displayCode || `${nodeDisplayCode(source)}${index + 1}`,
                            title: asset.title || source.title,
                            preview: imageAssetThumbnailSrc(asset, 128),
                        })) : [{ code: nodeDisplayCode(source), title: source.title, preview: "" }];
                    }).slice(0, mentionBudget);
                    const requirementOutputCount = node.type === "requirement" ? nodeOutputCountById.get(node.id) ?? 0 : 0;
                    const presentedAssetIndexes = nodeIsGenerating
                        ? canvasPreviewAssets.map((_asset, index) => index)
                        : gridPresentation.order.filter((index) => index < canvasPreviewAssets.length);
                    const presentedAssets = presentedAssetIndexes.map((assetIndex) => ({ asset: canvasPreviewAssets[assetIndex], assetIndex }));
                    const opaqueContainerAssets = Boolean((node.imageContainer || node.imageCollection) && node.imageParams?.background === "opaque");
                    const transientNodeDrag = dragRef.current;
                    const pendingNodeDrag = transientNodeDrag?.id === node.id && transientNodeDrag.moved && !transientNodeDrag.layerGroupId
                        ? transientNodeDrag
                        : null;
                    return (<div key={node.id} data-node-id={node.id} data-ui-interactive="true" role="button" tabIndex={0} data-image-container={node.imageContainer ? "true" : undefined} data-node-styled={node.appearance && Object.keys(node.appearance).length ? "true" : undefined} data-image-container-kind={imageContainerKindForNode(node) || undefined} data-image-container-role={node.imageContainerRole || undefined} data-image-collection={node.imageCollection?.kind || undefined} data-layer-group={layerGroup?.id || node.layerComposition?.id || undefined} data-layer-group-number={layerGroup?.groupNumber || undefined} data-layer-order={layerGroup?.order || undefined} data-layer-detached={layerGroup ? String(Boolean(layerGroup.detached)) : undefined} data-image-run-state={nodeIsGenerating ? "placeholder" : "settled"} data-agent-work={agentWorkNodeIdSet.has(node.id) ? agentWorkFocusNodeId === node.id ? "focus" : "related" : undefined} className={`flow-node ${node.type} ${mediaShell ? "media-shell" : ""} ${node.type === "requirement" ? "requirement-node" : ""} ${node.imageContainer ? `image-container ${node.imageContainerRole ? `image-container-${node.imageContainerRole}` : ""}` : ""} ${node.imageCollection ? `image-collection image-collection-${node.imageCollection.kind}` : ""} ${node.layerComposition ? "layer-stack-node" : ""} ${layerGroup ? `layer-group-member ${stackedLayerMember ? "layer-group-stacked" : "layer-group-detached"}` : ""} ${node.status} ${selectedNodeIdSet.has(node.id) ? "selected" : ""} ${activeNodeId === node.id && !nodeIsGenerating ? "active-build" : ""} ${newNodeHighlightIds.includes(node.id) ? "is-new-highlight" : ""} ${agentWorkNodeIdSet.has(node.id) ? "agent-work-related" : ""} ${agentWorkFocusNodeId === node.id ? "agent-work-focus" : ""} ${assetDropTargetId === node.id ? "asset-drop-target" : ""} ${draggingNodeId === node.id ? "dragging" : ""} ${resizingNodeId === node.id ? "resizing" : ""}`} style={{
                            ...nodeStyleProperties(node.appearance),
                            left: pendingNodeDrag?.pendingX ?? node.x,
                            top: pendingNodeDrag?.pendingY ?? node.y,
                            zIndex: nodeRenderZIndex(node, nodeStackById, selectedNodeIdSet, selectedNodeId, resizingNodeId === node.id || draggingNodeId === node.id),
                            width: renderWidth,
                            height: renderHeight,
                            minWidth: nodeMinimum.width ?? NODE_RESIZE_MIN_W,
                            minHeight: nodeMinimum.height ?? NODE_RESIZE_MIN_H,
                            "--node-preview-h": node.type === "image" ? `${renderedPreviewHeight}px` : undefined,
                            "--node-image-cols": node.type === "image" ? gridPresentation.columns : undefined,
                            "--node-image-rows": node.type === "image" ? gridPresentation.rows : undefined,
                            "--node-image-column-template": node.type === "image" && gridPresentation.columnFr
                                ? gridPresentation.columnFr.map((value) => `minmax(0, ${clamp(value, 0.25, 4)}fr)`).join(" ")
                                : undefined,
                            "--node-image-row-template": node.type === "image" && gridPresentation.rowFr
                                ? gridPresentation.rowFr.map((value) => `minmax(0, ${clamp(value, 0.25, 4)}fr)`).join(" ")
                                : undefined,
                            "--layer-tab-offset": layerGroup ? `${Math.max(0, layerGroup.total - layerGroup.order) * 46}px` : undefined
                        } as React.CSSProperties & Record<string, string | number | undefined>} onPointerDown={(event) => beginNodeDrag(event, node)} onPointerMove={(event) => moveNode(event, node)} onPointerUp={(event) => endNodeDrag(event, node)} onPointerCancel={(event) => endNodeDrag(event, node)} onClick={(event) => {
                            event.stopPropagation();
                            selectNodeFromPlainClick(node.id);
                        }} onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (node.type === "requirement")
                                openRequirementEditor(node);
                            else
                                openNodeEditor(node);
                        }} onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                selectNodeFromPlainClick(node.id, "keyboard-plain-select");
                            }
                        }} onContextMenu={(event) => openNodeMenu(event, node)}>
                    {stackedLayerMember && layerGroup ? (<>
                        {layerGroup.order === layerGroup.total ? (<span className="node-layer-group-titlebar" onDoubleClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openLayerGroupViewer(node.id);
                                }} title="拖动可移动整组分层 PNG；双击打开分层查看器">
                            <Layers3 size={13}/>
                            <span>
                              <strong>分层 PNG #{String(layerGroup.groupNumber).padStart(3, "0")}</strong>
                              <small>{layerGroup.total} 层 · 双击查看</small>
                            </span>
                          </span>) : null}
                        <span className={`node-layer-member-tab role-${layerGroup.role || "other"} ${layerNodeIsVisible(node) ? "is-visible" : "is-hidden"}`} title={`第 ${layerGroup.order}/${layerGroup.total} 层 · ${layerGroup.layerTitle}；拖动可把这一层独立移出`} onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openNodeEditor(node);
                            }}>
                          <IconActionButton className="node-layer-visibility-toggle" label={layerNodeIsVisible(node) ? `隐藏 ${layerGroup.layerTitle}` : `显示 ${layerGroup.layerTitle}`} title={layerNodeIsVisible(node) ? "隐藏图层" : "显示图层"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setLayerNodeVisibility(node.id, !layerNodeIsVisible(node));
                            }} icon={layerNodeIsVisible(node) ? <Eye size={14}/> : <EyeOff size={14}/>}/>
                          <span className="node-layer-tab-thumbnail" aria-hidden="true">
                            {node.assets?.[0] ? <CompleteImage src={imageAssetThumbnailSrc(node.assets[0], 256)} alt="" draggable={false} loading="lazy" decoding="async"/> : <ImageIcon size={13}/>}
                          </span>
                          <span className="node-layer-tab-copy">
                            <strong>{layerGroup.layerTitle}</strong>
                            <small>{layerGroup.order}/{layerGroup.total} · {layerGroup.role}</small>
                          </span>
                        </span>
                      </>) : null}
                    <span className="node-head">
                      <span className={`node-id ${node.type === "image" ? "image-node-id" : ""}`}>
                        {node.type === "image" ? (<>
                            <ImageIcon size={16} aria-hidden="true"/>
                          </>) : node.type === "requirement" ? (<>
                            <Workflow size={16} aria-hidden="true"/>
                          </>) : node.type === "intent" ? (<>
                            <WandSparkles size={16} aria-hidden="true"/>
                          </>) : node.id}
                      </span>
                      <span className="node-title-block">
                        {node.type === "requirement" ? <>
                          <small>{nodeDisplayCode(node)}</small>
                          <RequirementNodeTitle title={node.title} onSave={title => {
                                requirementEditHistoryRef.current = "";
                                editRequirementField(node.id, { title });
                                requirementEditHistoryRef.current = "";
                            }}/>
                        </> : nodeIsGenerating ? <strong className="node-drawing-heading" title={nodeTitle}>
                          <span className="node-drawing-status" role="status"><span className="node-drawing-status-text">正在绘制</span></span>
                          <span>{nodeDisplayCode(node)}</span>
                        </strong> : <>
                          <strong title={nodeTitle}>{mediaShell ? nodeDisplayCode(node) : nodeTitle}</strong>
                          {!mediaShell ? <small>{nodeDisplayCode(node)}</small> : null}
                        </>}
                      </span>
                      <span className="node-head-actions">
                        {node.type === "image" ? (<>
                            {node.imageState === "generating" && !node.layerGroup ? <IconActionButton className="node-quick-action node-stop-drawing" label="停止绘图" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); stopNodeImageWork(node.id); }} icon={<X size={13}/>}/> : null}
                            <CheckboxControl className={`node-quick-select${selectedNodeIdSet.has(node.id) ? " checked" : ""}`} title={selectedNodeIdSet.has(node.id) ? "取消选择" : "选择图片"} label={`${selectedNodeIdSet.has(node.id) ? "取消选择" : "选择"} ${nodeTitle}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} inputProps={{
                                checked: selectedNodeIdSet.has(node.id),
                                onChange: () => toggleNodeSelection(node.id)
                            }} indicator={<Check size={12}/>}/>
                            <IconActionButton className="node-quick-action" label={`快速引用 ${nodeDisplayCode(node)}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                insertAgentMention(nodeDisplayCode(node));
                            }} icon={<Brain size={13}/>}/>
                            <IconActionButton className="node-quick-action" label={node.note ? "编辑便签" : "添加便签"} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openNodeNote(node, event);
                            }} icon={<MessageSquareReply size={13}/>}/>
                            {node.type === "image" ? (<IconActionButton className="node-quick-action node-scenario-action" label="引用到需求便签" disabled={agentExecutionBusy || node.imageState === "generating"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openRequirementEditorForSource(node);
                                }} icon={<Workflow size={13}/>}/>) : null}
                          </>) : null}
                        {node.type !== "requirement" && !nodeIsGenerating ? <span className="node-state">{nodeStateLabel(node)}</span> : null}
                      </span>
                    </span>
                    {node.type === "image" ? (<div className={`node-image-preview ${node.imageContainer || node.imageCollection ? "image-result-container-preview" : ""} ${node.imageContainer ? "image-container-preview" : ""} ${node.imageCollection ? `image-collection-preview ${node.imageCollection.kind}` : ""} ${visibleAssets.length > 0 || pendingTileCount > 0 || failedTileCount > 0 ? "ready" : node.imageState ?? "empty"} image-${imageOrientationForNode(node)} layout-${gridPresentation.variant} ${opaqueContainerAssets ? "opaque-assets" : ""} ${node.imageState === "error" ? "has-error" : ""}`} data-image-count={displaySlotCount} data-generating={nodeIsGenerating || undefined} aria-busy={nodeIsGenerating} data-container-core={node.imageContainer || node.imageCollection ? "image-result-container" : undefined} data-container-presentation={node.imageCollection?.kind === "series" ? "series" : node.imageContainer || node.imageCollection ? "grid" : undefined} data-container-layout={node.imageContainer || node.imageCollection ? gridPresentation.variant : undefined}>
                        {layerGroup ? (<strong className="node-layer-member-badge">
                            #{String(layerGroup.groupNumber).padStart(3, "0")} · {layerGroup.order}/{layerGroup.total}
                          </strong>) : null}
                        {node.layerComposition ? (<div className={`node-layer-stack-workbench ${node.layerComposition.layout === "exploded" ? "exploded" : "stacked"}`} data-layer-layout={node.layerComposition.layout === "exploded" ? "exploded" : "stacked"}>
                            <div className="node-layer-canvas" style={{
                                    width: layerCanvasSize ? `${Math.round(layerCanvasSize.width)}px` : undefined,
                                    height: layerCanvasSize ? `${Math.round(layerCanvasSize.height)}px` : undefined,
                                    aspectRatio: `${node.layerComposition.width} / ${node.layerComposition.height}`
                                }} aria-label={`图层组 ${node.layerComposition.groupNumber ?? ""} 合成预览`}>
                              {node.layerComposition.previewAsset && node.layerComposition.layers.every((layer) => !layer.asset) ? (<CompleteImage className="node-layer-preview-guide" src={imageAssetNodePreviewSrc(node.layerComposition.previewAsset, node, 1, zoom)} alt="合成预览" draggable={false} decoding="async"/>) : null}
                              {[...node.layerComposition.layers]
                                    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
                                    .map((layer, index) => layer.asset ? (<span key={layer.id || `${node.id}-layer-${index}`} className={`node-layer-surface role-${layer.role || "other"}${activeLayerSurface?.nodeId === node.id && activeLayerSurface.layerId === layer.id ? " active" : ""}`} data-layer-id={layer.id} data-layer-active={activeLayerSurface?.nodeId === node.id && activeLayerSurface.layerId === layer.id ? "true" : undefined} style={{
                                        zIndex: activeLayerSurface?.nodeId === node.id && activeLayerSurface.layerId === layer.id
                                            ? 900
                                            : 10 + Number(layer.order ?? index + 1),
                                        opacity: layer.visible === false ? 0 : Number(layer.opacity ?? 1),
                                        transform: `translate(${Number(layer.x ?? 0) / Math.max(1, node.layerComposition!.width) * 100}%, ${Number(layer.y ?? 0) / Math.max(1, node.layerComposition!.height) * 100}%) scale(${Number(layer.scale ?? 1)})`,
                                        transformOrigin: "top left",
                                        mixBlendMode: layer.blendMode && layer.blendMode !== "normal" && layer.blendMode !== "source-over" ? layer.blendMode : "normal"
                                    }}>
                                    <CompleteImage src={imageAssetNodePreviewSrc(layer.asset, node, 1, zoom)} alt={layer.title || `图层 ${index + 1}`} draggable={false} decoding="async"/>
                                  </span>) : null)}
                              {nodeIsGenerating ? (<span className="node-layer-processing" aria-label="分层 PNG 占位">
                                  <Layers3 size={16}/>
                                </span>) : null}
                              <strong className="node-layer-group-badge">
                                #{String(node.layerComposition.groupNumber ?? 0).padStart(3, "0")}
                              </strong>
                            </div>
                            <div className="node-layer-strip" aria-label="图层列表">
                              {[...node.layerComposition.layers]
                                    .sort((left, right) => Number(right.order ?? 0) - Number(left.order ?? 0))
                                    .map((layer, index) => (<span key={`${node.id}-${layer.id}-handle`} data-layer-id={layer.id} className={`node-layer-handle${activeLayerSurface?.nodeId === node.id && activeLayerSurface.layerId === layer.id ? " active" : ""}`} onPointerDown={(event) => beginLayerDrag(event, node, layer.id)} onPointerMove={moveLayerDrag} onPointerUp={endLayerDrag} onPointerCancel={endLayerDrag} title={`拖动「${layer.title || layer.id}」查看独立图层；右键节点可重组`}>
                                    <i>{Number(layer.order ?? node.layerComposition!.layers.length - index)}</i>
                                    <em>{layer.title || layer.role || layer.id}</em>
                                    <small>{layer.role || "layer"}</small>
                                  </span>))}
                            </div>
                          </div>) : visibleAssets.length > 0 || pendingTileCount > 0 || failedTileCount > 0 ? (<>
                            {presentedAssets.map(({ asset, assetIndex: index }) => {
                                    const collectionItem = imageCollectionItemForAsset(node, index);
                                    const assetPrompt = collectionItem?.prompt || asset.prompt || asset.revisedPrompt || "";
                                    const displayedSource = sourceForDisplayedAsset(node, index);
                                    const assetCode = asset.displayCode || `${nodeDisplayCode(node)}${index + 1}`;
                                    const previewSource = imageAssetNodePreviewSrc(asset, node, displaySlotCount, zoom);
                                    const previewHasAuthoritativeSize = imagePreviewCanReportAuthoritativeSize(previewSource, imageAssetSrc(asset));
                                    const imageTileMovesNode = Boolean(displayedSource.node.id === node.id &&
                                        !node.imageContainer &&
                                        !node.imageCollection &&
                                        !node.layerComposition &&
                                        !node.layerGroup &&
                                        visibleAssets.length === 1);
                                    const internalAssetDragEnabled = canGroupImageAsset(displayedSource.node) && !imageTileMovesNode;
                                    return (<span key={`${node.id}-${asset.occurrenceId || asset.runId || asset.assetUrl || asset.url || asset.path || "asset"}-${asset.index ?? index}-${index}`} data-image-code={assetCode} data-image-hover-code={displaySlotCount > 1 ? assetCode : undefined} data-asset-index={index} data-source-node-id={displayedSource.node.id} data-source-asset-index={displayedSource.assetIndex} className={`node-image-tile ${displaySlotCount > 10 ? "is-dense" : ""} ${internalAssetDragEnabled ? "draggable-image-tile" : ""} ${imageTileMovesNode ? "movable-node-image-tile" : ""} ${isDraggableImageGroup(node) ? "container-image-tile" : ""} ${node.layerGroup && !layerNodeIsVisible(node) ? "layer-image-hidden" : ""}`} aria-hidden={node.layerGroup && !layerNodeIsVisible(node) ? "true" : undefined} draggable={internalAssetDragEnabled} style={node.layerGroup ? {
                                            opacity: layerNodeIsVisible(node) ? clamp(Number(node.layerGroup.opacity ?? 1), 0, 1) : 0,
                                            mixBlendMode: node.layerGroup.blendMode && node.layerGroup.blendMode !== "normal" && node.layerGroup.blendMode !== "source-over" ? node.layerGroup.blendMode : "normal"
                                        } : undefined} onPointerDown={(event) => {
                                            if (!imageTileMovesNode)
                                                event.stopPropagation();
                                        }} onDragStart={(event) => {
                                            if (!internalAssetDragEnabled) {
                                                event.preventDefault();
                                                return;
                                            }
                                            beginInternalAssetDrag(event, displayedSource.node, displayedSource.assetIndex);
                                        }} onDragEnd={finishInternalAssetDrag} onClick={(event) => {
                                            event.stopPropagation();
                                            const allowImageViewer = selectNodeFromPlainClick(node.id, "image-tile-click");
                                            const recentDrag = lastNodeDragEndRef.current;
                                            if (recentDrag?.nodeId === node.id && Date.now() - recentDrag.endedAt < 260)
                                                return;
                                            if (imageTileClickTimerRef.current !== null)
                                                window.clearTimeout(imageTileClickTimerRef.current);
                                            if (!allowImageViewer)
                                                return;
                                            imageTileClickTimerRef.current = window.setTimeout(() => {
                                                imageTileClickTimerRef.current = null;
                                                openImageViewer(node, index);
                                            }, 220);
                                        }} onDoubleClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            const recentDrag = lastNodeDragEndRef.current;
                                            if (recentDrag?.nodeId === node.id && Date.now() - recentDrag.endedAt < 320)
                                                return;
                                            if (imageTileClickTimerRef.current !== null) {
                                                window.clearTimeout(imageTileClickTimerRef.current);
                                                imageTileClickTimerRef.current = null;
                                            }
                                            openNodeEditor(displayedSource.node, displayedSource.assetIndex);
                                        }} onContextMenu={(event) => openAssetContextMenuAt(event, displayedSource.node, displayedSource.assetIndex)} title={node.layerGroup ? "点击查看图层；分层组请先合并后再作为普通图片移动" : isDraggableImageGroup(node) ? `${assetPrompt || "图片成果"}\n拖到画布内整理图片` : "点击查看大图；拖动图片可移动节点，放到另一张图片上可归组"}>
                                <CompleteImage src={previewSource} loading="lazy" alt={`生成图 ${asset.index ?? index + 1}`} draggable={false} decoding="async" onLoad={previewHasAuthoritativeSize ? (event) => reconcileCanvasAssetNaturalSize(displayedSource.node.id, displayedSource.assetIndex, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight) : undefined}/>
                                <small className="node-asset-code">{assetCode}</small>
                                <span className="node-asset-quick-actions" aria-label={`图片 ${assetCode} 快捷操作`}>
                                  <IconActionButton label={`快速引用 ${assetCode}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            insertAgentMention(assetCode);
                                        }} icon={<Brain size={12}/>}/>
                                  <IconActionButton label={asset.note ? `编辑 ${assetCode} 描述` : `添加 ${assetCode} 描述`} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openNodeNote(displayedSource.node, event, displayedSource.assetIndex);
                                        }} icon={<MessageSquareReply size={12}/>}/>
                                </span>
                                {asset.note ? <ButtonBase type="button" className="node-asset-note" title={asset.note} aria-label={`编辑 ${assetCode} 便签`} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
                                                event.stopPropagation();
                                                openNodeNote(displayedSource.node, event, displayedSource.assetIndex);
                                            }}><MessageSquareReply size={12}/><span>{asset.note}</span></ButtonBase> : null}
                                {node.imageCollection ? (<small className="collection-image-prompt">
                                    <strong>{collectionItem?.title || asset.title || `图片 ${index + 1}`}</strong>
                                    <span>{assetPrompt || "未记录提示词"}</span>
                                  </small>) : null}
                              </span>);
                                })}
                            {containerOverflowCount ? (<span className="node-image-overflow-tile" title={`容器共 ${visibleAssets.length} 张图片，打开节点编辑器可查看完整素材列表`}>
                                <strong>+{containerOverflowCount}</strong>
                                <small>更多图片</small>
                              </span>) : null}
                            {Array.from({ length: pendingTileCount }, (_item, index) => (<span key={`pending-${node.id}-${index}`} className="node-image-pending-tile" aria-label="正在绘制图片" style={{ "--draw-phase": `${index * -0.45}s` } as React.CSSProperties}>
                                <ImageIcon size={22} aria-hidden="true"/>
                              </span>))}
                            {failedTileCount > 0 ? <ImageRetryTile nodeCode={nodeDisplayCode(node)} error={visibleNodeError} canRetry={!node.layerGroup && !node.layerComposition} onRetry={() => retryNodeImageWork(node.id)}/> : null}
                          </>) : !nodeIsGenerating ? (node.imageState === "error" ? <ImageRetryTile nodeCode={nodeDisplayCode(node)} error={visibleNodeError} canRetry={!node.layerGroup && !node.layerComposition} onRetry={() => retryNodeImageWork(node.id)}/> : <div>
                           <ImageIcon size={22}/>
                            <span>{node.imageContainer ? node.imageContainerRole ? node.title : "拖入图片或文件夹" : nodeImageEmptyLabel(node)}</span>
                            {node.imageContainerRole && !visibleAssets.length ? <small>导入图片，或从画布拖入</small> : null}
                          </div>) : null}
                      </div>) : node.documentId ? (<React.Suspense fallback={null}><StudioDocumentCard projectId={activeProjectId} id={node.documentId} open={() => setStudioEditor({ projectId: activeProjectId, id: node.documentId! })}/></React.Suspense>) : node.type === "requirement" && node.requirement?.goalFeedback ? (<GoalFeedbackPanel value={node.requirement.goalFeedback} busy={agentExecutionBusy} onChange={patch => editGoalFeedback(node.id, patch)} onSubmit={satisfied => submitGoalFeedback(node.id, satisfied)} onDisable={() => disableGoalNotes(node.id)}/>) : node.type === "requirement" && node.requirement ? (<div className="requirement-node-body">
                        <RequirementTextInput label={`需求正文 ${nodeDisplayCode(node)}`} value={node.requirement.text} images={agentMentionImages} onFocus={() => setSelectedNodeId(node.id)} onBlur={() => { requirementEditHistoryRef.current = ""; }} onChange={text => editRequirementField(node.id, { text })} onMention={image => linkImageToRequirement(node.id, image.nodeId)}/>
                        {requirementMentions.length ? <div className="requirement-node-mentions" aria-label="已关联图片，点击插入引用">
                          {requirementMentions.map((asset, index) => <ButtonBase key={`${asset.code}:${index}`} data-image-mention={asset.code} aria-label={`引用 ${asset.code}`} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => {
                                        event.stopPropagation();
                                        const input = event.currentTarget.closest('.requirement-node-body')?.querySelector<HTMLTextAreaElement>('.requirement-node-text');
                                        const text = nodesRef.current.find(item => item.id === node.id)?.requirement?.text || "";
                                        const start = input?.selectionStart ?? text.length, end = input?.selectionEnd ?? start;
                                        const insertion = `${start && !/\s$/.test(text.slice(0, start)) ? " " : ""}@${asset.code} `;
                                        editRequirementField(node.id, { text: `${text.slice(0, start)}${insertion}${text.slice(end)}`.slice(0, 24000) });
                                        requestAnimationFrame(() => { input?.focus({ preventScroll: true }); input?.setSelectionRange(start + insertion.length, start + insertion.length); });
                                    }}>
                            {asset.preview ? <img src={asset.preview} alt="" loading="lazy" decoding="async"/> : <ImageIcon size={14}/>}<span>@{asset.code}</span>
                          </ButtonBase>)}
                        </div> : null}
                        {node.requirement.lastError ? <small className="requirement-node-error" role="status">{node.requirement.lastError}</small> : null}
                        <div className="requirement-node-footer">
                        <div className="requirement-node-meta" title={`已执行 ${node.requirement.lastRunCount ?? 0} 次 · ${requirementOutputCount} 个成果`}>
                          {requirementBindings.length ? `${requirementBindings.length} 个关联节点` : "可复用需求"}
                        </div>
                        <ActionButton className="requirement-node-run" variant="primary" disabled={agentExecutionBusy || !node.requirement.text.trim()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                executeRequirementNode(node.id);
                            }} icon={<Send size={13}/>}>
                          交给 Agent
                        </ActionButton>
                        </div>
                      </div>) : null}
                    {node.note ? (<ButtonBase type="button" className="node-canvas-note" title={node.note} aria-label={`编辑 ${nodeDisplayCode(node)} 便签`} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
                                event.stopPropagation();
                                openNodeNote(node, event);
                            }}>
                        <MessageSquareReply size={12} aria-hidden="true"/>
                        <span>{node.note}</span>
                      </ButtonBase>) : null}
                    {node.type === "image" && node.imageState !== "error" && !failedTileCount && imageProgressText ? (<div className="node-image-progress">
                        <span>{imageProgressText || visibleNodeError}</span>
                      </div>) : null}
                    {node.type !== "requirement" ? <footer>
                      {mediaShell ? <>
                        <strong className="node-media-title" title={nodeTitle}>{nodeTitle}</strong>
                        <span className="node-media-meta">{displaySlotCount > 1 ? `${displaySlotCount} 张` : imageTaskSizeForNode(node).replace("x", " × ")}</span>
                      </> : <>
                      <span>{node.imageContainerRole === "source" ? "本轮原图" : node.imageContainerRole === "reference" ? "本轮参考图" : node.imageContainer ? "项目图片库" : node.imageCollection ? (node.imageCollection.kind === "series" ? "连续生成系列" : "并行批量图片组") : layerGroup ? `分层 PNG #${String(layerGroup.groupNumber).padStart(3, "0")}` : node.layerComposition ? `分层 PNG #${String(node.layerComposition.groupNumber ?? 0).padStart(3, "0")}` : node.type === "image" ? imageTaskSizeForNode(node).replace("x", " × ") : node.imageParams?.ratio || "图片成果"}</span>
                      <span>{node.imageContainer || node.imageCollection ? `${Math.max(node.imageProgress?.total ?? 0, node.imageParams?.count ?? 0, node.assets?.length ?? 0, 1)} 张` : layerGroup ? `第 ${layerGroup.order}/${layerGroup.total} 层` : node.layerComposition ? `${node.layerComposition.layers.length} 层 · 可拖动` : `${Math.max(node.imageParams?.count ?? 0, node.outputs ?? 0, 1)} 张`}</span>
                      </>}
                    </footer> : null}
                    <span className={`node-port provenance-port node-port-in node-connection-port input ${node.type === "requirement" ? requirementBindings.length ? "connected" : "" : node.parentId ? "connected" : ""}`} data-node-id={node.id} title={node.type === "requirement" ? (requirementBindings.length ? "点击断开全部关联图片" : "连接图片或图片容器") : node.parentId ? "点击断开输入关系" : "输入关系连接点"} aria-label={`${nodeTitle} 输入连接头`} onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }} onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            disconnectNodeInput(node.id);
                        }}/>
                    <span className={`node-port provenance-port node-port-out node-connection-port output ${outputConnected ? "connected" : ""} ${connectionDraft?.sourceId === node.id ? "connecting" : ""}`} data-node-id={node.id} title={node.type === "requirement" ? (outputConnected ? "已有需求成果；拖动可连接其他成果" : "拖动连接需求产出的成果") : outputConnected ? "点击断开输出关系，拖动连接到后续成果" : "拖动连接到后续成果"} aria-label={`${nodeTitle} 输出连接头`} onPointerDown={(event) => beginConnection(event, node)}/>
                    <span className="node-resize-handle" onPointerDown={(event) => beginNodeResize(event, node)} aria-hidden="true"/>
                  </div>);
                })}
            </div>

            {canvasSelectionBox ? (<div className="canvas-selection-box" aria-hidden="true" style={{
                        left: canvasSelectionBox.x,
                        top: canvasSelectionBox.y,
                        width: canvasSelectionBox.width,
                        height: canvasSelectionBox.height
                    }}/>) : null}

          </div>

          <CanvasPlatformFooter trailing={<ActionButton onClick={()=>setVideoEditor({projectId:activeProjectIdRef.current})}>视频剪辑</ActionButton>} scale={zoom} onZoomOut={() => zoomCanvas(CANVAS_PLATFORM_ZOOM_OUT_FACTOR)} onFitAll={fitCanvas} onZoomIn={() => zoomCanvas(CANVAS_PLATFORM_ZOOM_FACTOR)} leading={(askUserDraft && askUserMinimized || referencePickerDraft?.target.kind === "agent-request" && referencePickerMinimized || minimizedWindows.length > 0) ? (<div className="canvas-minimized-taskbar" role="toolbar" aria-label="最小化的工作窗口" data-canvas-taskbar="true">
                {askUserDraft && askUserMinimized ? (<div className="canvas-minimized-task-item ask-user-taskbar">
                    <ButtonBase type="button" className="canvas-minimized-task" onClick={() => setAskUserMinimized(false)} aria-label={`恢复等待回复窗口：${askUserDraft.title}`} title={askUserDraft.title}>
                      <MessageSquareReply size={14}/>
                      <strong>{askUserDraft.title}</strong>
                    </ButtonBase>
                    <ButtonBase type="button" className="canvas-minimized-task-close" onClick={() => closePendingAgentExecution(askUserDraft.requestId)} aria-label={`关闭等待回复窗口：${askUserDraft.title}`} title="关闭等待回复">
                      <X size={13}/>
                    </ButtonBase>
                  </div>) : null}
                {referencePickerDraft?.target.kind === "agent-request" && referencePickerMinimized ? (<div className="canvas-minimized-task-item">
                    <ButtonBase type="button" className="canvas-minimized-task" onClick={() => setReferencePickerMinimized(false)} aria-label={`恢复素材等待窗口：${referencePickerDraft.title}`} title={referencePickerDraft.title}>
                      <Import size={14}/>
                      <strong>{referencePickerDraft.title}</strong>
                    </ButtonBase>
                    <ButtonBase type="button" className="canvas-minimized-task-close" onClick={() => {
                            const target = referencePickerDraft.target;
                            if (target.kind === "agent-request")
                                closePendingAgentExecution(target.requestId);
                        }} aria-label={`关闭素材等待窗口：${referencePickerDraft.title}`} title="关闭素材等待">
                      <X size={13}/>
                    </ButtonBase>
                  </div>) : null}
                {minimizedWindows.map((window) => (<div className="canvas-minimized-task-item" key={window.id}>
                    <ButtonBase type="button" className="canvas-minimized-task" onClick={() => restoreMinimizedWindow(window.id)} aria-label={`恢复窗口：${window.title}`} title={window.title}>
                      <strong>{window.title}</strong>
                    </ButtonBase>
                    <ButtonBase type="button" className="canvas-minimized-task-close" onClick={() => closeMinimizedWindow(window.id)} aria-label={`关闭窗口：${window.title}`} title="关闭窗口">
                      <X size={13}/>
                    </ButtonBase>
                  </div>))}
              </div>) : undefined}/>

          {videoEditor ? <VideoEditor key={videoEditor.projectId} call={callVideo} initialAssetId={videoEditor.assetId} initialTimelineId={videoEditor.timelineId} close={()=>setVideoEditor(null)} registerFlush={save=>{videoFlushRef.current=save;}}/> : null}

          {canvasMenu ? (<MenuSurface className={`canvas-context-menu ${canvasMenu.kind === "selection" ? "selection-context-menu" : ""}`} x={canvasMenu.x} y={canvasMenu.y} ariaLabel={canvasMenu.kind === "canvas" ? "画布菜单" : canvasMenu.kind === "selection" ? "多选成果菜单" : "成果菜单"} onRequestClose={() => setCanvasMenu(null)}>
              {canvasMenu.kind === "canvas" ? (<>
                  <MenuItem icon={<WandSparkles size={15}/>} onClick={() => openManualImageTaskAt(canvasMenu.worldX, canvasMenu.worldY)}>
                    手动生图
                  </MenuItem>
                  <MenuItem icon={<Workflow size={15}/>} onClick={() => openRequirementEditorAt(canvasMenu.worldX, canvasMenu.worldY)}>
                    创建需求
                  </MenuItem>
                  <MenuItem icon={<FolderPlus size={15}/>} onClick={() => createImageContainerAt(canvasMenu.worldX, canvasMenu.worldY)}>
                    创建图片容器
                  </MenuItem>

                  <MenuItem icon={<Import size={15}/>} onClick={() => void importPickedImagesToCanvasAt(canvasMenu.worldX, canvasMenu.worldY)}>
                    导入图片
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<RotateCcw size={15}/>} shortcut="Ctrl+Z" disabled={!canvasUndoRef.current || fileActionBusy} onClick={() => void undoCanvasCommand()}>
                    撤回上一步
                  </MenuItem>
                  <MenuItem icon={<Workflow size={15}/>} disabled={agentExecutionBusy || canvasNodes.length < 2} onClick={requestArrangeCanvas}>
                    整理画布
                  </MenuItem>
                </>) : null}
              {canvasMenu.kind === "selection" && menuSelectionCapabilities ? (<>
                  <MenuSummary title={`已选择 ${canvasMenu.nodeIds.length} 个成果`}/>
                  <MenuItem icon={<Workflow size={15}/>} onClick={() => {
                            createConnectedRequirement({ inputNodeIds: canvasMenu.nodeIds });
                            setCanvasMenu(null);
                        }}>创建需求</MenuItem>
                  <MenuItem icon={<FolderPlus size={15}/>} shortcut="Ctrl G" disabled={!menuSelectionCapabilities.canGroupIntoContainer} onClick={() => mergeSelectedIntoImageContainer(menuSelectionCapabilities)}>合并为一个容器</MenuItem>
                  <MenuItem icon={<Brain size={15}/>} onClick={() => referenceSelectedCanvasImages(canvasMenu.nodeIds)}>批量引用到 画布助手</MenuItem>
                  <MenuSeparator />
                  <MenuItem tone="danger" icon={<Trash2 size={15}/>} shortcut="Del" disabled={!menuSelectionCapabilities.canDelete} onClick={() => deleteSelectedCanvasNodes(menuSelectionCapabilities)}>移除选中节点</MenuItem>
                  <MenuItem icon={<X size={15}/>} shortcut="Esc" onClick={() => {
                            selectCanvas();
                            setCanvasMenu(null);
                        }}>取消选择</MenuItem>
                </>) : null}
              {canvasMenu.kind === "node" ? (<>
                  {(() => {
                            const targetNode = canvasNodeById.get(canvasMenu.nodeId);
                            return targetNode ? (<>
                        {targetNode.type === "requirement" ? (<>
                            <MenuItem icon={<Send size={15}/>} disabled={agentExecutionBusy} onClick={() => executeRequirementNode(targetNode.id)}>
                              基于该需求继续工作
                            </MenuItem>
                            <MenuItem icon={<Settings size={15}/>} onClick={() => openRequirementEditor(targetNode)}>
                              编辑需求
                            </MenuItem>
                            {requirementInputBindings(targetNode, nodes).length ? (<MenuItem icon={<Workflow size={15}/>} onClick={() => {
                                            disconnectNodeInput(targetNode.id);
                                            setCanvasMenu(null);
                                        }}>
                                断开全部输入素材
                              </MenuItem>) : null}
                          </>) : (<>

                        <MenuItem icon={<Brain size={15}/>} onClick={() => {
                                        setSelectedNodeId(targetNode.id);
                                        insertAgentMention(nodeDisplayCode(targetNode));
                                        setCanvasMenu(null);
                                    }}>
                          引用到 画布助手
                        </MenuItem>
                        <MenuItem icon={<Workflow size={15}/>} onClick={() => openRequirementEditorForSource(targetNode)}>
                          引用到需求便签
                        </MenuItem>
                        <MenuItem icon={<ImageIcon size={15}/>} disabled={!targetNode.assets?.length} onClick={() => {
                                        setCanvasMenu(null);
                                        openImageViewer(targetNode, 0);
                                    }}>查看大图</MenuItem>
                        <MenuItem icon={<ImageIcon size={15}/>} disabled={!targetNode.assets?.length} onClick={() => addToStyleLibrary(targetNode)}>保存到数据库</MenuItem>
                        <MenuItem disabled={!targetNode.assets?.length} onClick={() => openImageMarks(targetNode, 0)}>区域标记</MenuItem>

                        <MenuSeparator />
                        <div className="asset-feedback-control" onPointerDown={(event) => event.stopPropagation()}>
                          <div className="asset-feedback-heading">
                            <span>成果评分</span>
                            <output>{normalizeFeedbackScore(targetNode.feedbackScore)}</output>
                          </div>
                          <input type="range" min="-100" max="100" step="1" value={normalizeFeedbackScore(targetNode.feedbackScore)} aria-label={`${nodeDisplayCode(targetNode)} 成果评分`} onChange={(event) => setNodeFeedbackScore(targetNode.id, event.currentTarget.value)}/>
                          <div className="asset-feedback-scale"><span>-100</span><span>0</span><span>100</span></div>
                        </div>
                        {targetNode.imageContainer ? (<>
                            <MenuSeparator />
                            {targetNode.imageContainerRole !== "source" ? (<MenuItem icon={<ImageIcon size={15}/>} onClick={() => setImageContainerTaskRole(targetNode.id, "source")}>
                                设为原图容器
                              </MenuItem>) : null}
                            {targetNode.imageContainerRole !== "reference" ? (<MenuItem icon={<Layers3 size={15}/>} onClick={() => setImageContainerTaskRole(targetNode.id, "reference")}>
                                设为参考图容器
                              </MenuItem>) : null}
                            {targetNode.imageContainerRole ? (<MenuItem icon={<FolderPlus size={15}/>} onClick={() => setImageContainerTaskRole(targetNode.id)}>
                                恢复普通图片容器
                              </MenuItem>) : null}
                          </>) : null}
                        {targetNode.type === "image" && (targetNode.assets?.length ?? 0) > 0 ? (<>
                            <MenuItem icon={<Download size={15}/>} busy={fileActionBusy} onClick={() => void saveAssetAs(targetNode, 0)}>
                              另存为…
                            </MenuItem>

                            <MenuSeparator />

                            {targetNode.imageContainer ? (<MenuItem icon={<FolderOpen size={15}/>} onClick={() => {
                                                setCanvasMenu(null);
                                                void openAssetFolder(targetNode.assets?.[0]);
                                            }}>
                                打开图片库文件夹
                              </MenuItem>) : null}
                           {targetNode.layerGroup || targetNode.imageParams?.layerGroupId ? (<MenuItem icon={<FolderOpen size={15}/>} onClick={() => {
                                                const layerAsset = targetNode.assets?.find((asset) => asset?.path)
                                                    ?? targetNode.layerComposition?.layers.map((layer) => layer.asset).find((asset) => asset?.path)
                                                    ?? targetNode.layerComposition?.previewAsset
                                                    ?? targetNode.layerComposition?.mergedAsset
                                                    ?? targetNode.assets?.[0];
                                                setCanvasMenu(null);
                                                void openAssetFolder(layerAsset);
                                            }}>
                                打开图层文件夹
                              </MenuItem>) : null}
                          </>) : null}
                        {targetNode.layerGroup ? (() => {
                                        const groupMembers = layerGroupMembers(targetNode.id);
                                        const isExpanded = groupMembers.some((member) => member.layerGroup?.detached);
                                        return (<>
                              <MenuSeparator />
                              <MenuItem icon={<Layers3 size={15}/>} onClick={() => openLayerGroupViewer(targetNode.id)}>
                                打开分层查看器
                              </MenuItem>
                              {isExpanded ? (<MenuItem icon={<Layers3 size={15}/>} busy={fileActionBusy} onClick={() => void recomposeLayerStack(targetNode.id)}>
                                  一键图层重组
                                </MenuItem>) : (<MenuItem icon={<Layers3 size={15}/>} busy={fileActionBusy} onClick={() => explodeLayerStack(targetNode.id)}>
                                  展开到画布
                                </MenuItem>)}
                              <MenuItem icon={<ImageIcon size={15}/>} busy={fileActionBusy} onClick={() => void mergeLayerGroupToNewNode(targetNode.id)}>
                                合并可见图层为新图片
                              </MenuItem>
                              <MenuItem icon={<Download size={15}/>} busy={fileActionBusy} onClick={() => void exportLayerGroupMergedPng(targetNode.id)}>
                                导出合成 PNG…
                              </MenuItem>
                              <MenuItem icon={<FolderOpen size={15}/>} busy={fileActionBusy} onClick={() => void exportLayerGroupFolder(targetNode.id)}>
                                导出图层文件夹…
                              </MenuItem>

                            </>);
                                    })() : null}
                        {targetNode.layerComposition ? (targetNode.layerComposition.layout === "exploded" ? (<MenuItem icon={<Layers3 size={15}/>} onClick={() => void recomposeLayerStack(targetNode.id)} disabled={targetNode.imageState === "generating"}>
                              图层重组
                            </MenuItem>) : (<MenuItem icon={<Layers3 size={15}/>} onClick={() => explodeLayerStack(targetNode.id)} disabled={targetNode.imageState === "generating"}>
                              展开图层
                            </MenuItem>)) : null}
                          </>)}
                      </>) : null;
                        })()}
                 <MenuSeparator />
                 <MenuItem tone="danger" icon={<X size={15}/>} onClick={() => {
                            requestDeleteNode(canvasMenu.nodeId);
                        }}>
                    删除节点
                 </MenuItem>

                </>) : null}
            </MenuSurface>) : null}

          {requirementReferenceMenu ? <MenuSurface className="canvas-context-menu" x={requirementReferenceMenu.x} y={requirementReferenceMenu.y} ariaLabel="引用到需求便签" onRequestClose={() => setRequirementReferenceMenu(null)}>
            <MenuSummary title="引用到需求便签">{requirementReferenceMenu.images.map(image => `@${image.code}`).join(" · ")}</MenuSummary>
            {nodes.filter(node => node.type === "requirement" && node.requirement).map(note => <MenuItem key={note.id} icon={<Workflow size={15}/>} onClick={() => {
                            linkImagesToRequirement(note.id, requirementReferenceMenu.images);
                            setRequirementReferenceMenu(null);
                            openRequirementEditor(note);
                        }}>{nodeDisplayCode(note)} · {note.title || "需求便签"}</MenuItem>)}
            <MenuSeparator />
            <MenuItem icon={<Plus size={15}/>} onClick={() => {
                        createConnectedRequirement({ inputNodeIds: requirementReferenceMenu.images.map(image => image.nodeId), text: requirementReferenceMenu.images.map(image => `@${image.code} `).join("") });
                        setRequirementReferenceMenu(null);
                    }}>新建需求便签</MenuItem>
          </MenuSurface> : null}
          {assetContextMenu ? (() => {
                    const targetNode = nodes.find((node) => node.id === assetContextMenu.nodeId);
                    const targetAsset = targetNode?.assets?.[assetContextMenu.assetIndex];
                    if (!targetNode || !targetAsset)
                        return null;
                    return (<MenuSurface className="canvas-context-menu asset-context-menu" x={assetContextMenu.x} y={assetContextMenu.y} ariaLabel={`${targetAsset.displayCode || targetNode.displayCode || targetNode.id} 图片菜单`} onRequestClose={() => setAssetContextMenu(null)}>

                <MenuItem icon={<Brain size={15}/>} onClick={() => {
                            setSelectedNodeId(targetNode.id);
                            insertAgentMention(targetAsset.displayCode || `${nodeDisplayCode(targetNode)}${assetContextMenu.assetIndex + 1}`);
                            setAssetContextMenu(null);
                        }}>
                  引用到 画布助手
                </MenuItem>
                <MenuItem icon={<Workflow size={15}/>} onClick={() => openRequirementEditorForAsset(targetNode, assetContextMenu.assetIndex)}>
                  引用到需求便签
                </MenuItem>
                <MenuItem icon={<ImageIcon size={15}/>} onClick={() => {
                            setAssetContextMenu(null);
                            openImageViewer(targetNode, assetContextMenu.assetIndex);
                        }}>
                  查看大图
                </MenuItem>

                <MenuItem icon={<ImageIcon size={15}/>} onClick={() => addToStyleLibrary(targetNode, assetContextMenu.assetIndex)}>保存到数据库</MenuItem>
                <MenuItem onClick={() => openImageMarks(targetNode, assetContextMenu.assetIndex)}>区域标记</MenuItem>
                <MenuSeparator />
                <div className="asset-feedback-control" onPointerDown={(event) => event.stopPropagation()}>
                  <div className="asset-feedback-heading">
                    <span>图片评分</span>
                    <output>{normalizeFeedbackScore(targetAsset.feedbackScore)}</output>
                  </div>
                  <input type="range" min="-100" max="100" step="1" value={normalizeFeedbackScore(targetAsset.feedbackScore)} aria-label={`${targetAsset.displayCode || "图片"} 图片评分`} onChange={(event) => setAssetFeedbackScore(targetNode.id, assetContextMenu.assetIndex, event.currentTarget.value)}/>
                  <div className="asset-feedback-scale"><span>-100</span><span>0</span><span>100</span></div>
                </div>
                <MenuSeparator />
                <MenuItem icon={<Download size={15}/>} busy={fileActionBusy} onClick={() => void saveAssetAs(targetNode, assetContextMenu.assetIndex)}>
                  另存为…
                </MenuItem>

                {targetAsset.path ? (<MenuItem icon={<FolderOpen size={15}/>} onClick={() => {
                                setAssetContextMenu(null);
                                void openAssetFolder(targetAsset);
                            }}>
                    打开所在文件夹
                  </MenuItem>) : null}
                {targetNode.layerGroup ? (<>
                    <MenuSeparator />
                    <MenuItem icon={<Layers3 size={15}/>} onClick={() => openLayerGroupViewer(targetNode.id)}>
                      打开分层查看器
                    </MenuItem>
                    <MenuItem icon={layerNodeIsVisible(targetNode) ? <EyeOff size={15}/> : <Eye size={15}/>} onClick={() => {
                                setAssetContextMenu(null);
                                setLayerNodeVisibility(targetNode.id, !layerNodeIsVisible(targetNode));
                            }}>
                      {layerNodeIsVisible(targetNode) ? "隐藏当前图层" : "显示当前图层"}
                    </MenuItem>
                    {layerGroupMembers(targetNode.id).some((member) => !layerNodeIsVisible(member)) ? (<MenuItem icon={<Eye size={15}/>} onClick={() => {
                                    setAssetContextMenu(null);
                                    showAllLayerGroup(targetNode.id);
                                }}>
                        显示全部图层
                      </MenuItem>) : null}
                    {layerGroupMembers(targetNode.id).some((member) => member.layerGroup?.detached) ? (<MenuItem icon={<Layers3 size={15}/>} busy={fileActionBusy} onClick={() => void recomposeLayerStack(targetNode.id)}>
                        一键图层重组
                      </MenuItem>) : (<MenuItem icon={<Layers3 size={15}/>} busy={fileActionBusy} onClick={() => explodeLayerStack(targetNode.id)}>
                        展开到画布
                      </MenuItem>)}
                    <MenuItem icon={<ImageIcon size={15}/>} busy={fileActionBusy} onClick={() => void mergeLayerGroupToNewNode(targetNode.id)}>
                      合并可见图层为新图片
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Download size={15}/>} busy={fileActionBusy} onClick={() => void exportLayerGroupMergedPng(targetNode.id)}>
                      导出合成 PNG…
                    </MenuItem>
                    <MenuItem icon={<FolderOpen size={15}/>} busy={fileActionBusy} onClick={() => void exportLayerGroupFolder(targetNode.id)}>
                      导出图层文件夹…
                    </MenuItem>

                  </>) : null}
                <MenuSeparator />

                <MenuSeparator />
                <MenuItem icon={<X size={15}/>} onClick={() => { setAssetContextMenu(null); requestDeleteNode(targetNode.id); }}>删除节点</MenuItem>

              </MenuSurface>);
                })() : null}
            </>)}

          </> : configReady ? <div className="project-tabs-empty" aria-labelledby="workspace-welcome-title">
            <div className="workspace-welcome-copy">
              <p className="workspace-welcome-greeting">欢迎使用</p>
              <h1 id="workspace-welcome-title">Aieyra Workspace</h1>
              <p className="workspace-welcome-description">让想法在这里，慢慢成为作品。</p>
              <ActionButton className="workspace-welcome-start" variant="primary" icon={<Plus size={18}/>} disabled={fileActionBusy || projectRecoveryBusy} onClick={() => { void startCanvas(); }}>
                开始创作
              </ActionButton>
            </div>
          </div> : null}

        </section>

      </main>

      {projectHistoryOpen ? <DialogShell surface="project-history" ariaLabel="历史项目" className="workspace-project-history" onRequestClose={() => setProjectHistoryOpen(false)}>
        {({ requestClose }) => <><SurfaceHeader title="历史项目" onClose={() => requestClose("close-button")}/><SurfaceBody>
          <input className="ui-control workspace-project-search" type="search" aria-label="查找历史项目" placeholder="搜索项目" value={projectSearch} onChange={event => setProjectSearch(event.target.value)}/>
          <div className="workspace-history-list">{populatedProjects.filter(project => project.id !== activeProjectId && project.name.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase())).map(project => <div key={project.id}>
            <ButtonBase className="workspace-history-restore" disabled={fileActionBusy} onClick={async () => { if (await switchProject(project.id))
                    setProjectHistoryOpen(false); }}><FolderOpen size={16}/><span>{project.name}</span><small>恢复</small></ButtonBase>
            <ButtonBase className="workspace-history-rename" aria-label={"重命名 " + project.name} onClick={() => openRenameProjectDialog(project.id)}>改名</ButtonBase>
          </div>)}</div>
          {!populatedProjects.some(project => project.id !== activeProjectId && project.name.toLocaleLowerCase().includes(projectSearch.trim().toLocaleLowerCase())) ? <div className="workspace-history-empty">{projectSearch ? "没有匹配的项目" : "暂无已关闭项目"}</div> : null}
        </SurfaceBody><SurfaceFooter><ActionButton onClick={importProject} disabled={fileActionBusy}>导入</ActionButton><ActionButton onClick={exportProject} disabled={fileActionBusy || !projectWorkspaceOpen}>导出当前项目</ActionButton><ActionButton onClick={openCurrentProjectFolder} disabled={!projectWorkspaceOpen}>打开文件夹</ActionButton></SurfaceFooter></>}
      </DialogShell> : null}
      {studioEditor ? <React.Suspense fallback={null}><StudioDocumentEditor key={`${studioEditor.projectId}:${studioEditor.id}`} {...studioEditor} close={() => setStudioEditor(null)} send={text => sendStudioToMatrix(text, studioEditor.projectId)}/></React.Suspense> : null}
      {imageMarkEditor ? <React.Suspense fallback={null}><ImageAnnotationEditor key={`${imageMarkEditor.projectId}:${imageMarkEditor.nodeId}:${imageMarkEditor.assetIndex}`} asset={imageMarkEditor.asset} value={imageMarkEditor.asset.annotations} save={saveImageMarks} close={() => setImageMarkEditor(null)} send={() => sendStudioToMatrix(`请读取 annotations.read projectId=${imageMarkEditor.projectId} nodeId=${imageMarkEditor.nodeId} assetIndex=${imageMarkEditor.assetIndex}，再调用 annotations.preview 查看叠加标记的原图。逐条理解满意/不满意区域与说明，并按标记完成修改，保留满意区域。`, imageMarkEditor.projectId)}/></React.Suspense> : null}
      {projectRecoveryOpen ? (<React.Suspense fallback={null}>
          <LazyProjectRecoveryDialog assessment={projectRecoveryAssessment || emptyProjectRecoveryAssessment()} busy={projectRecoveryBusy} onClose={() => setProjectRecoveryOpen(false)} onRefresh={() => refreshProjectRecoveryAssessment()} onRecover={recoverLocalProjects} onRollback={rollbackLocalProjectRecovery}/>
        </React.Suspense>) : null}

      {manualImageTaskDialog ? (<React.Suspense fallback={null}>
          <ManualImageTaskDialog state={manualImageTaskDialog} setState={setManualImageTaskDialog} imageModel={manualImageTaskDialog.draft.model || settings.imageModel} imageModels={settings.imageModelPool || []} executionBusy={agentExecutionBusy} close={() => setManualImageTaskDialog(null)} openReferencePicker={() => openReferencePicker({ kind: "image-task" }, manualImageTaskDialog.draft.referenceImages ?? [], { title: "生图参考图", detail: "参考图只从当前项目图片库读取。", max: MAX_REFERENCE_IMAGES })} submit={() => submitManualImageTask(manualImageTaskDialog)} submitToAgent={() => submitImageTaskToAgent(manualImageTaskDialog)}/>
        </React.Suspense>) : null}

      {agentAssetPickerOpen ? (<React.Suspense fallback={null}>
          <AgentAssetPickerDialog key={activeProjectId} projectId={activeProjectId} initialSourceImages={agentSourceImages} initialReferenceImages={agentReferenceImages} close={() => setAgentAssetPickerOpen(false)} save={(sourceImages, referenceImages) => {
                commitAgentSourceImages(sourceImages.map((image) => ({ ...image, taskRole: "source" })));
                commitAgentReferenceImages(referenceImages.map((image) => ({ ...image, taskRole: "reference" })));
                setAgentAssetPickerOpen(false);
            }}/>
        </React.Suspense>) : null}

      {referencePickerDraft && !referencePickerMinimized ? (<React.Suspense fallback={null}>
          <ReferencePickerDialog draft={referencePickerDraft} setDraft={setReferencePickerDraft} projectId={activeProjectId} minimize={() => setReferencePickerMinimized(true)} close={() => referencePickerDraft.target.kind === "agent-request"
                ? (setReferencePickerMinimized(false), closePendingAgentExecution(referencePickerDraft.target.requestId))
                : setReferencePickerDraft(null)} save={() => saveReferencePicker(referencePickerDraft)}/>
        </React.Suspense>) : null}

      {askUserDraft ? (() => {
            const pending = pendingAgentExecution?.requestId === askUserDraft.requestId ? pendingAgentExecution : null;
            const askImageText = `${askUserDraft.title} ${askUserDraft.question} ${askUserDraft.detail || ""}`;
            const imageChoiceRelevant = Boolean(pending && (/(?:哪(?:一|几)?张|哪个|选择.{0,8}(?:图|素材)|来源|原图|参考图|目标图|图片范围|画布图片)/i.test(askImageText) ||
                pending.sourceNodeIds.length > 1 ||
                Number(pending.taskScope.sourceAssetCount || 0) > 1 ||
                (pending.taskScope.contextAssets?.length || 0) > 1));
            const asksForReferenceOnly = /(?:参考图|参考素材|风格参考|仅作参考)/i.test(askImageText) &&
                !/(?:原图|源图|目标图|待处理|编辑对象)/i.test(askImageText);
            const canvasCandidateRole: AssetTaskRole = asksForReferenceOnly ? "reference" : "source";
            const preferredNodeIds = pending
                ? [pending.focusedNodeId || "", ...pending.sourceNodeIds, ...pending.taskScope.sourceNodeIds].filter(Boolean)
                : [];
            const canvasCandidates = imageChoiceRelevant
                ? canvasReferencePickerCandidates(canvasNodes, canvasCandidateRole, preferredNodeIds)
                : [];
            return (<React.Suspense fallback={null}>
            <LazyAskUserDialog key={askUserDraft.requestId} draft={askUserDraft} minimized={askUserMinimized} minimize={() => setAskUserMinimized(true)} cancel={() => closePendingAgentExecution(askUserDraft.requestId)} canvasCandidates={canvasCandidates} submit={(answer, selectedOptionId, selectedCanvasCandidateIds = []) => {
                    const selected = new Set(selectedCanvasCandidateIds);
                    const canvasAssets = canvasCandidates
                        .filter((candidate) => selected.has(candidate.id))
                        .map((candidate) => ({ ...candidate.asset, role: canvasCandidateRole }));
                    setAskUserMinimized(false);
                    resumePendingAgentExecution(askUserDraft.requestId, answer, [], canvasCandidateRole, selectedOptionId, canvasAssets);
                }}/>
          </React.Suspense>);
        })() : null}

      <React.Suspense fallback={null}>
        {projectNameDraft ? (<ProjectNameDialog draft={projectNameDraft} setDraft={setProjectNameDraft} close={() => setProjectNameDraft(null)} submit={() => (projectNameDraft.mode === "report-snapshot"
                ? createWritingProjectFromReportSnapshot()
                : projectNameDraft.mode === "rename"
                    ? renameProject(projectNameDraft.name)
                    : projectNameDraft.location === "folder"
                        ? createProjectFolder(projectNameDraft.name, projectNameDraft.kind ?? "image", projectNameDraft.template)
                        : createProject(projectNameDraft.name, projectNameDraft.kind ?? "image", projectNameDraft.template))} busy={fileActionBusy} projectSurface={projectSurface}/>) : null}

        <ImageMentionPreview images={canvasMentionImages}/>
        {quotaDialog ? (<QuotaDialog quota={quotaDialog} close={() => setQuotaDialog(null)} openAccount={() => {
                setQuotaDialog(null);

                openOSModelSettings();
            }}/>) : null}

        {confirmDialog ? (<ConfirmDialog draft={confirmDialog} busy={fileActionBusy} close={closeConfirmDialog} submit={submitConfirmDialog}/>) : null}
      </React.Suspense>

      {projectResetDraft ? (<React.Suspense fallback={null}>
          <ProjectResetDialog draft={projectResetDraft} projectName={activeProjectName} projectKind={activeProject?.kind} close={() => setProjectResetDraft(null)} back={() => setProjectResetDraft({})} reset={resetCurrentProject}/>
        </React.Suspense>) : null}

      {activeProject?.kind === "writing" && activeWritingPatchProposal ? (<React.Suspense fallback={null}>
          <WritingPatchReviewDialog key={activeWritingPatchProposal.proposalId} proposal={activeWritingPatchProposal} busy={writingPatchDecisionBusy} error={writingPatchDecisionError} accept={() => acceptWritingPatchProposal(activeWritingPatchProposal)} reject={() => rejectWritingPatchProposal(activeWritingPatchProposal)}/>
        </React.Suspense>) : null}

      <React.Suspense fallback={null}>
        {nodeNoteDraft ? <NodeNotePopover key={`${nodeNoteDraft.nodeId}:${nodeNoteDraft.assetIndex ?? "node"}`} draft={nodeNoteDraft} save={saveNodeNote} close={() => setNodeNoteDraft(null)}/> : null}
      </React.Suspense>
      {nodeEditorDraft ? (() => {
            const editorNode = nodes.find((node) => node.id === nodeEditorDraft.nodeId) ?? canvasNodeById.get(nodeEditorDraft.nodeId) ?? null;
            const editorAssetIndex = clamp(Number(nodeEditorDraft.assetIndex || 0), 0, Math.max(0, (editorNode?.assets?.length ?? 1) - 1));
            const editorAsset = editorNode?.type === "image" ? (editorNode.assets?.[editorAssetIndex] ?? editorNode.layerComposition?.mergedAsset) : undefined;
            const canContinue = Boolean(editorNode?.type === "image" && editorAsset && !editorNode.layerGroup && !editorNode.layerComposition);
            const editorCollectionItem = editorNode ? imageCollectionItemForAsset(editorNode, editorAssetIndex) : undefined;
            const editingCollectionMember = Boolean(editorNode?.imageCollection && editorNode.assets?.[editorAssetIndex]);
            const layerComposition = editorNode?.layerComposition;
            const layerGroup = editorNode?.layerGroup;
            const layerMembers = editorNode?.layerGroup ? layerGroupMembers(editorNode.id) : [];
            const layerGroupExpanded = layerMembers.some((member) => member.layerGroup?.detached);
            const editorSourceTitle = editingCollectionMember
                ? (editorCollectionItem?.title || editorAsset?.title || editorNode?.title || (editorNode ? nodeWorkName(editorNode) : ""))
                : (editorAsset?.title || editorNode?.title || (editorNode ? nodeWorkName(editorNode) : ""));
            const editorSourcePrompt = editingCollectionMember
                ? (editorCollectionItem?.prompt || editorAsset?.prompt || editorAsset?.revisedPrompt || editorNode?.imageParams?.prompt || firstPromptLine(editorNode?.prompt || "") || editorNode?.prompt || "")
                : (editorAsset?.prompt || editorAsset?.revisedPrompt || editorNode?.imageParams?.prompt || firstPromptLine(editorNode?.prompt || "") || editorNode?.prompt || "");
            const editorSourceNote = editingCollectionMember ? editorAsset?.note || "" : editorNode?.note || "";
            const editorDirty = nodeEditorDraft.title !== editorSourceTitle || nodeEditorDraft.prompt !== editorSourcePrompt || nodeEditorDraft.note !== editorSourceNote;
            const editorBusy = fileActionBusy;
            const editorDiscardArmed = nodeEditorDraft.discardArmed === true;
            return (<DialogShell surface="node-editor" ariaLabel="成果编辑器" layerClassName="node-editor-layer" className="node-editor-dialog unified-node-editor" busy={editorBusy} dirty={editorDirty} closePolicy={{
                    escape: editorDiscardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
                    backdrop: editorDiscardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
                    [CLOSE_BUTTON_REASON]: editorDiscardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
                    action: editorDiscardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN
                }} onRequestClose={() => setNodeEditorDraft(null)} onCloseBlocked={(_reason, state) => {
                    setNodeEditorDraft((current) => current ? {
                        ...current,
                        discardArmed: state.dirty ? true : current.discardArmed,
                        error: state.busy ? "正在处理图片文件，请稍候。" : "有未保存修改。再次关闭将放弃这些修改。"
                    } : current);
                }}>
            {({ requestClose }) => (<>
              <SurfaceHeader title="编辑成果" description={editorNode
                        ? layerGroup
                            ? `分层 PNG #${String(layerGroup.groupNumber).padStart(3, "0")} · 第 ${layerGroup.order}/${layerGroup.total} 层`
                            : layerComposition
                                ? `分层 PNG #${String(layerComposition.groupNumber ?? 0).padStart(3, "0")} · ${layerComposition.layers.length} 层`
                                : editingCollectionMember
                                    ? `图片 ${editorAssetIndex + 1} · ${editorSourceTitle || "图片成果"}`
                                    : "图片成果"
                        : "成果已不存在"} onClose={() => requestClose(CLOSE_BUTTON_REASON)} closeLabel="关闭成果编辑器" closeDisabled={editorBusy}/>

              <SurfaceBody className="unified-node-editor-body">
                {editorAsset ? (<div className="unified-node-editor-preview" data-ui-interactive="true" draggable={false}>
                    <ButtonBase className="unified-node-editor-preview-open" data-ui-control="preview" type="button" draggable={false} onClick={() => editorNode?.assets?.[editorAssetIndex] && openImageViewer(editorNode, editorAssetIndex)} onContextMenu={(event) => {
                            if (editorNode?.assets?.[editorAssetIndex]) {
                                openAssetContextMenuAt(event, editorNode, editorAssetIndex, "viewer");
                                return;
                            }
                            event.preventDefault();
                            void saveStandaloneAssetAs(editorAsset, `${nodeEditorDraft.title || "图片成果"}.png`, "编辑器预览");
                        }} title={editorNode?.layerGroup ? "查看原图；分层组请使用合成、图层文件夹或 PSD 导出" : "查看原图；右键可保存图片"}>
                      <CompleteImage src={imageAssetSrc(editorAsset)} alt={nodeEditorDraft.title || "图片成果"}/>
                      <span><ImageIcon size={14}/>单击查看原图</span>
                    </ButtonBase>
                    <ActionButton variant="secondary" className="unified-node-editor-save-image" draggable={false} onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (editorNode?.assets?.[editorAssetIndex])
                                void saveAssetAs(editorNode, editorAssetIndex);
                            else
                                void saveStandaloneAssetAs(editorAsset, `${nodeEditorDraft.title || "图片成果"}.png`, "编辑器预览");
                        }} disabled={fileActionBusy} title="另存为" icon={<Download size={14}/>}>
                      另存为
                    </ActionButton>
                  </div>) : (<div className="unified-node-editor-preview is-empty">
                    <Workflow size={28}/>
                    <span>当前成果没有图片预览</span>
                  </div>)}
                <div className={`unified-node-editor-fields ${layerComposition || layerGroup ? "has-layer-composition" : ""}`}>
                  <Field label={editingCollectionMember ? "图片标题" : "成果标题"}>
                    <input value={nodeEditorDraft.title} onChange={(event) => setNodeEditorDraft((current) => current ? { ...current, title: event.target.value, discardArmed: false, error: undefined } : current)} placeholder="给这个成果一个容易识别的名称"/>
                  </Field>
                  <details className="node-editor-note-disclosure" open={nodeEditorDraft.noteExpanded ?? Boolean(nodeEditorDraft.note)} onToggle={(event) => {
                        const expanded = event.currentTarget.open;
                        setNodeEditorDraft(current => current && current.noteExpanded !== expanded ? { ...current, noteExpanded: expanded } : current);
                    }}>
                  <summary><MessageSquareReply size={14}/>备注{nodeEditorDraft.note ? <small>已填写</small> : null}</summary>
                  <Field className="is-note" label="备注" hint={`${nodeEditorDraft.note.length}/500`}>
                    <textarea value={nodeEditorDraft.note} maxLength={500} rows={3} onChange={(event) => setNodeEditorDraft((current) => current ? { ...current, note: event.target.value, discardArmed: false, error: undefined } : current)} placeholder="记录素材用途、位置或需要保留的细节"/>
                  </Field>
                  </details>
                  <Field className="is-prompt" label="提示词">
                    <textarea value={nodeEditorDraft.prompt} onChange={(event) => setNodeEditorDraft((current) => current ? { ...current, prompt: event.target.value, discardArmed: false, error: undefined } : current)} placeholder="编辑这个成果的完整提示词；继续生成时会直接使用这里的内容"/>
                  </Field>
                  {layerGroup ? (<section className="node-editor-layer-panel" aria-label="独立分层 PNG 操作">
                      <header>
                        <span><Layers3 size={15}/>图层列表</span>
                        <strong>{layerGroup.compositionWidth}×{layerGroup.compositionHeight}</strong>
                      </header>
                      <div className="node-editor-layer-list">
                        {[...layerMembers]
                            .sort((left, right) => Number(right.layerGroup?.order ?? 0) - Number(left.layerGroup?.order ?? 0))
                            .map((member) => (<ButtonBase type="button" key={member.id} className={`ui-choice-row ${member.id === editorNode?.id ? "current" : ""}`} onClick={() => editorNode && openNodeEditor(member)} title={`编辑 ${member.layerGroup?.layerTitle || member.title}`}>
                              <i>{member.layerGroup?.order}</i>
                              <em>{member.layerGroup?.layerTitle || member.title}</em>
                              <small>{member.layerGroup?.role || "layer"} · {member.layerGroup?.detached ? "独立" : "叠放"}</small>
                            </ButtonBase>))}
                      </div>
                      <div className="node-editor-layer-actions">
                        <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="open-layers" onClick={() => void openAssetFolder(editorAsset)} icon={<FolderOpen size={15}/>}>
                          打开图层文件夹
                        </ActionButton>
                        {layerGroupExpanded ? (<ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="recompose" onClick={() => void recomposeLayerStack(editorNode!.id)} icon={<Layers3 size={15}/>}>
                            图层重组
                          </ActionButton>) : (<ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="explode" onClick={() => explodeLayerStack(editorNode!.id)} icon={<Layers3 size={15}/>}>
                            展开图层
                          </ActionButton>)}
                      </div>
                    </section>) : null}
                  {layerComposition ? (<section className="node-editor-layer-panel" aria-label="分层 PNG 操作">
                      <header>
                        <span><Layers3 size={15}/>分层 PNG</span>
                        <strong>#{String(layerComposition.groupNumber ?? 0).padStart(3, "0")} · {layerComposition.layers.length} 层</strong>
                      </header>
                      <div className="node-editor-layer-list">
                        {[...layerComposition.layers]
                            .sort((left, right) => Number(right.order ?? 0) - Number(left.order ?? 0))
                            .map((layer) => (<span key={`${editorNode?.id}-${layer.id}`}>
                              <i>{Number(layer.order ?? 0)}</i>
                              <em>{layer.title || layer.id}</em>
                              <small>{layer.role || "layer"}</small>
                            </span>))}
                      </div>
                      <div className="node-editor-layer-actions">
                        <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="open-layers" onClick={() => void openAssetFolder(layerComposition.layers.map((layer) => layer.asset).find((asset) => asset?.path) ?? layerComposition.mergedAsset ?? layerComposition.previewAsset)} icon={<FolderOpen size={15}/>}>
                          打开图层文件夹
                        </ActionButton>
                        {layerComposition.layout === "exploded" ? (<ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="recompose" onClick={() => void recomposeLayerStack(editorNode!.id)} icon={<Layers3 size={15}/>}>
                            图层重组
                          </ActionButton>) : (<ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="explode" onClick={() => explodeLayerStack(editorNode!.id)} icon={<Layers3 size={15}/>}>
                            展开图层
                          </ActionButton>)}
                      </div>
                    </section>) : null}
                  {nodeEditorDraft.error ? <InlineNotice className="node-editor-error" tone="danger">{nodeEditorDraft.error}</InlineNotice> : null}
                </div>
              </SurfaceBody>

              <SurfaceFooter className="unified-node-editor-footer">
                <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="cancel" onClick={() => requestClose("action")}>
                  {editorDiscardArmed && editorDirty ? "确认放弃" : "取消"}
                </ActionButton>
                <ActionButton variant="secondary" className="node-editor-action" data-node-editor-action="save" onClick={() => saveNodeEditorDraft(true)} icon={<Check size={15}/>} disabled={!editorDirty}>
                  保存
                </ActionButton>

                {canContinue ? (<ActionButton variant="primary" className="node-editor-action" data-node-editor-action="continue" onClick={continueFromNodeEditor} disabled={agentExecutionBusy} icon={<WandSparkles size={15}/>}>
                    重新生成
                  </ActionButton>) : null}
              </SurfaceFooter>
            </>)}
          </DialogShell>);
        })() : null}

      {layerViewer ? (() => {
            const members = nodes
                .filter((node) => node.layerGroup?.id === layerViewer.groupId)
                .sort((left, right) => Number(left.layerGroup?.order ?? 0) - Number(right.layerGroup?.order ?? 0));
            const selectedLayer = members.find((member) => member.id === layerViewer.selectedNodeId) ?? members[members.length - 1];
            const group = selectedLayer?.layerGroup;
            if (!selectedLayer || !group)
                return null;
            const groupExpanded = members.some((member) => member.layerGroup?.detached);
            return (<DialogShell surface="layer-group-viewer" ariaLabel={`分层查看器 ${group.title || "分层 PNG"}`} layerClassName="layer-group-viewer-layer" className="layer-group-viewer" busy={fileActionBusy} closePolicy={{ escape: WHEN_IDLE, backdrop: WHEN_IDLE, [CLOSE_BUTTON_REASON]: WHEN_IDLE, action: WHEN_IDLE }} onRequestClose={() => setLayerViewer(null)}>
            {({ requestClose }) => (<>
              <SurfaceHeader title={group.title || "分层 PNG"} description={`#${String(group.groupNumber).padStart(3, "0")} · ${members.length} 个真实 PNG 图层`} onClose={() => requestClose(CLOSE_BUTTON_REASON)} closeLabel="关闭分层查看器" closeDisabled={fileActionBusy}>
                <SegmentedControl className="layer-viewer-mode-switch" aria-label="分层查看模式">
                  {(["composite", "solo", "onion"] as const).map((mode) => (<SegmentButton key={mode} type="button" active={layerViewer.mode === mode} onClick={() => setLayerViewer((current) => current ? { ...current, mode } : current)}>
                      {mode === "composite" ? "合成" : mode === "solo" ? "单层" : "透视"}
                    </SegmentButton>))}
                </SegmentedControl>
              </SurfaceHeader>
              <SurfaceBody className="layer-group-viewer-body">
                <div className="layer-viewer-stage-wrap">
                  <div className="layer-viewer-stage" style={{ aspectRatio: `${group.compositionWidth} / ${group.compositionHeight}` }} aria-label={`${layerViewer.mode === "composite" ? "合成" : layerViewer.mode === "solo" ? "单层" : "透视"}预览`} onContextMenu={(event) => openAssetContextMenuAt(event, selectedLayer, 0, "viewer")}>
                    <div className="layer-viewer-image-stack">
                      {members.map((member, index) => {
                        const asset = member.assets?.[0];
                        if (!asset)
                            return null;
                        const visible = layerNodeIsVisible(member);
                        const selected = member.id === selectedLayer.id;
                        const shouldRender = layerViewer.mode === "solo" ? selected : visible;
                        const opacity = layerViewer.mode === "onion" ? (selected ? 1 : visible ? 0.24 : 0) : shouldRender ? 1 : 0;
                        const meta = layerGroupViewMeta(member);
                        return (<CompleteImage key={member.id} src={imageAssetSrc(asset)} alt={member.layerGroup?.layerTitle || `图层 ${index + 1}`} draggable={false} style={{
                                zIndex: Number(member.layerGroup?.order ?? index + 1),
                                opacity: opacity * Number(meta?.opacity ?? 1),
                                mixBlendMode: meta?.blendMode && meta.blendMode !== "normal" && meta.blendMode !== "source-over" ? meta.blendMode : "normal"
                            }}/>);
                    })}
                    </div>
                    <span className="layer-viewer-selected-label">
                      第 {group.order}/{group.total} 层 · {group.layerTitle}
                    </span>
                  </div>
                </div>
                <aside className="layer-viewer-rail" aria-label="图层列表">
                  <header>
                    <span>图层</span>
                    <ButtonBase className="ui-inline-action" type="button" onClick={() => showAllLayerGroup(selectedLayer.id)}>显示全部</ButtonBase>
                  </header>
                  <div>
                    {[...members].reverse().map((member) => {
                        const memberGroup = member.layerGroup!;
                        const visible = layerNodeIsVisible(member);
                        return (<article key={member.id} className={`${member.id === selectedLayer.id ? "active" : ""} ${visible ? "" : "hidden"}`} draggable={false} onContextMenu={(event) => openAssetContextMenuAt(event, member, 0, "viewer")} title="右键可另存当前图层；需要作为普通图片拖动时请先合并可见图层">
                          <IconActionButton className="layer-viewer-eye" label={visible ? `隐藏 ${memberGroup.layerTitle}` : `显示 ${memberGroup.layerTitle}`} onClick={() => setLayerNodeVisibility(member.id, !visible)} icon={visible ? <Eye size={15}/> : <EyeOff size={15}/>}/>
                          <ButtonBase type="button" className="ui-choice-row layer-viewer-row" onClick={() => {
                                setLayerViewer((current) => current ? { ...current, selectedNodeId: member.id } : current);
                                setSelectedNodeId(member.id);
                            }} onDoubleClick={() => openNodeEditor(member)}>
                            <span className="layer-viewer-thumb">
                              {member.assets?.[0] ? <CompleteImage src={imageAssetThumbnailSrc(member.assets[0])} alt="" draggable={false} loading="lazy" decoding="async"/> : null}
                            </span>
                            <span>
                              <strong>{memberGroup.layerTitle}</strong>
                              <small>{memberGroup.order}/{memberGroup.total} · {memberGroup.role}</small>
                            </span>
                          </ButtonBase>
                        </article>);
                    })}
                  </div>
                </aside>
              </SurfaceBody>
              <SurfaceFooter className="layer-group-viewer-footer" leading={<p>查看不会创建新节点；合并会保留全部原图层。</p>}>
                <ActionButton variant="secondary" onClick={() => void exportLayerGroupMergedPng(selectedLayer.id)} disabled={fileActionBusy} icon={<Download size={15}/>}>
                  合成 PNG
                </ActionButton>
                <ActionButton variant="secondary" onClick={() => void exportLayerGroupFolder(selectedLayer.id)} disabled={fileActionBusy} icon={<FolderOpen size={15}/>}>
                  图层文件夹
                </ActionButton>

                <ActionButton variant="secondary" onClick={() => groupExpanded ? void recomposeLayerStack(selectedLayer.id) : explodeLayerStack(selectedLayer.id)} icon={<Layers3 size={15}/>}>
                  {groupExpanded ? "图层重组" : "展开到画布"}
                </ActionButton>
                <ActionButton variant="secondary" onClick={() => void mergeLayerGroupToNewNode(selectedLayer.id)} busy={fileActionBusy} icon={<ImageIcon size={15}/>}>
                  合并可见图层为新图片
                </ActionButton>
              </SurfaceFooter>
            </>)}
          </DialogShell>);
        })() : null}

      {imageViewer ? (<React.Suspense fallback={null}><ImageViewer viewer={imageViewer} setViewer={setImageViewer} origin={(() => {
                const source = imageViewerAssetSourcesRef.current[imageViewer.index];
                const node = nodes.find(item => item.id === (source?.nodeId ?? imageViewer.nodeId));
                const asset = node?.assets?.[source?.assetIndex ?? imageViewer.assetIndices?.[imageViewer.index] ?? imageViewer.index];
                if (!node || !asset)
                    return undefined;
                const origin = imageOriginForAsset(asset, node, nodes);
                return { ...origin, nodeExists: nodes.some(item => item.id === origin.nodeId), sourceExists: nodes.some(item => item.id === origin.sourceNodeId) };
            })()} locateOrigin={(nodeId) => {
                const hostId = layoutProjection.groupByMember.get(nodeId)?.hostNodeId || nodeId;
                const node = nodesRef.current.find(item => item.id === hostId);
                if (!node)
                    return;
                setImageViewer(null);
                focusWorkflowNode(node, { revealInspector: false, recordEvent: false });
            }} close={() => setImageViewer(null)} openFolder={openAssetFolder} openSystemViewer={(asset) => window.aieyraConfig?.openAssetInSystemViewer?.({ path: asset?.path })
                ?? Promise.resolve({ ok: false, error: "当前环境不支持系统图片查看器。" })} copyImage={(asset) => window.aieyraConfig?.copyAssetImage?.({ path: asset?.path })
                ?? Promise.resolve({ ok: false, error: "当前环境不支持复制图片。" })} saveAs={(index) => {
                const source = imageViewerAssetSourcesRef.current[index];
                const node = nodesRef.current.find((item) => item.id === (source?.nodeId ?? imageViewer.nodeId));
                const assetIndex = source?.assetIndex ?? imageViewer.assetIndices?.[index] ?? index;
                return node ? saveAssetAs(node, assetIndex) : Promise.resolve({ ok: false, error: "图片成果不存在。" });
            }} openAssetMenu={(event, index) => {
                const source = imageViewerAssetSourcesRef.current[index];
                const node = nodesRef.current.find((item) => item.id === (source?.nodeId ?? imageViewer.nodeId));
                const assetIndex = source?.assetIndex ?? imageViewer.assetIndices?.[index] ?? index;
                if (node)
                    openAssetContextMenuAt(event, node, assetIndex, "viewer");
            }} reconcileNaturalSize={(index, width, height) => {
                const source = imageViewerAssetSourcesRef.current[index];
                reconcileCanvasAssetNaturalSize(source?.nodeId ?? imageViewer.nodeId, source?.assetIndex ?? imageViewer.assetIndices?.[index] ?? index, width, height);
            }}/></React.Suspense>) : null}
    </div>
    {configError ? <WorkspaceStartupRecovery error={configError} retry={() => { startupRequest.current = null; setConfigAttempt(current => current + 1); }}/> : null}
    </ImageMentionContext.Provider>);
}
function WorkspaceStartupRecovery({ error, retry }: { error: string; retry: () => void }) {
    return <aside className="workspace-startup-recovery" role="alert">
      <h2>画布暂时无法读取</h2>
      <p>{error}</p>
      <p>现有项目已保留，重试成功后即可继续编辑。</p>
      <ActionButton onClick={retry}>重新读取</ActionButton>
    </aside>;
}
function normalizeVisibleDuplicateText(text = "") {
    return sanitizeAgentVisibleText(text).replace(/\s+/g, " ").trim();
}
const rootElement = document.getElementById("root") as (HTMLElement & {
    __aieyraRoot?: Root;
}) | null;
if (!rootElement) {
    throw new Error("Aieyra Workspace root element not found.");
}
const aieyraRoot = rootElement.__aieyraRoot ?? createRoot(rootElement);
rootElement.__aieyraRoot = aieyraRoot;
aieyraRoot.render(<React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>);
