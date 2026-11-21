import { canvasPlatformEditableTarget } from "./canvas-platform-input";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Focus } from "./studio-icons-lazy";
import {
  CanvasPlatformBackdrop,
  CanvasPlatformEmptyState,
  CanvasPlatformFooter
} from "./canvas-platform";
import CanvasPlatformSelectionIndicator from "./canvas-platform-selection";
import type { CanvasPlatformFocusCloseReason } from "./canvas-platform-focus";
import {
  CANVAS_PLATFORM_MAX_SCALE,
  CANVAS_PLATFORM_MIN_SCALE,
  CANVAS_PLATFORM_ZOOM_FACTOR,
  CANVAS_PLATFORM_ZOOM_OUT_FACTOR,
  canvasPlatformArtifactWorkflowBounds,
  canvasPlatformArtifactWorkflowNodeSize,
  canvasPlatformClarityBand,
  canvasPlatformContainmentDelta,
  canvasPlatformResizeNodeSize,
  canvasPlatformFitViewport,
  canvasPlatformMoveArtifactWorkflowNode,
  canvasPlatformRectIsRendered,
  canvasPlatformViewportTransform,
  canvasPlatformViewportFromFactor,
  canvasPlatformViewportFromWheel,
  canvasPlatformWorldPoint,
  normalizeCanvasPlatformViewport,
  observeCanvasPlatformResizeRebase
} from "./canvas-platform-viewport";
import type {
  ArtifactWorkflowCommit,
  ArtifactWorkflowCommitReason,
  ArtifactWorkflowLayout,
  ArtifactWorkflowNode,
  ArtifactWorkflowViewport
} from "./artifact-workflow-canvas-model";
import "./artifact-workflow-canvas.css";

export type {
  ArtifactWorkflowCommit,
  ArtifactWorkflowCommitReason,
  ArtifactWorkflowLayout,
  ArtifactWorkflowNode,
  ArtifactWorkflowViewport
} from "./artifact-workflow-canvas-model";

const CanvasPlatformFocusSurface = lazy(() => import("./canvas-platform-focus"));

/**
 * Domain-neutral interaction shell for artifact-only workflows.  It deliberately
 * knows nothing about prompts, plans, or execution: callers provide real
 * artifact nodes and provenance edges, then commit only viewport/layout intent.
 */
export type ArtifactWorkflowEdge = {
  id: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  relation?: string;
};

export type ArtifactWorkflowContext = {
  kind: "canvas" | "node";
  nodeId?: string;
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
};

export type ArtifactWorkflowFocusCloseReason = CanvasPlatformFocusCloseReason;

type RenderContext = {
  selected: boolean;
  scale: number;
  select: () => void;
};

export type ArtifactWorkflowCanvasProps<TNode extends ArtifactWorkflowNode, TEdge extends ArtifactWorkflowEdge> = {
  kind: string;
  nodes: readonly TNode[];
  edges: readonly TEdge[];
  layout: readonly ArtifactWorkflowLayout[];
  viewport: ArtifactWorkflowViewport;
  selectedNodeId?: string;
  defaultNodeSize?: { width: number; height: number };
  resizable?: boolean;
  minimumNodeSize?: { width: number; height: number };
  maximumNodeSize?: { width: number; height: number };
  /** Minimum scale used by the explicit "fit all" command. Domains with
   * dense readable cards can opt out of a microscopic overview while the
   * shared zoom controls still retain the global MIN_SCALE floor. */
  fitMinimumScale?: number;
  autoFitOnMount?: boolean;
  /** Live collaboration facts never move a human-controlled view. */
  preserveViewportOnDataChange?: boolean;
  autoFitKey?: string;
  busy?: boolean;
  toolbar?: React.ReactNode;
  canvasMeta?: string;
  selectionIcon?: React.ReactNode;
  selectionTitle?: string;
  selectionDetail?: string;
  onClearSelection?: () => void;
  focusLayer?: React.ReactNode;
  /**
   * Focused artifact content is rendered as a modal owned by the canvas.  It
   * must never become a second center-pane workbench or a document-level
   * window.  The caller owns the state transition and persistence boundary.
   */
  focusLayerLabel?: string;
  onFocusLayerClose?: (reason: ArtifactWorkflowFocusCloseReason) => void;
  focusLayerHostRef?: (element: HTMLDivElement | null) => void;
  /**
   * One context-menu contract for every artifact canvas. Domains provide the
   * menu contents, while the shared shell owns pointer-to-world conversion,
   * blank-space versus node targeting, and browser-menu suppression.
   */
  onContextMenu?: (context: ArtifactWorkflowContext) => void;
  onFilesDrop?: (files: File[], position: { x: number; y: number }) => void;
  /** Match the Image canvas habit: a plain click selects, while a deliberate
   * double click opens the domain-owned artifact focus surface. */
  onNodeOpen?: (nodeId: string) => void;
  /** Start/finish a provenance connection without teaching the shell any
   * domain-specific relation rules. The caller validates and persists it. */
  onConnect?: (sourceArtifactId: string, targetArtifactId: string) => void | Promise<void>;
  emptyContent?: React.ReactNode;
  renderNode: (node: TNode, context: RenderContext) => React.ReactNode;
  renderEdgeLabel?: (edge: TEdge) => React.ReactNode;
  onSelect?: (nodeId: string) => void;
  onLayoutChange?: (layout: ArtifactWorkflowLayout[]) => void;
  onViewportChange?: (viewport: ArtifactWorkflowViewport) => void;
  onCommit?: (commit: ArtifactWorkflowCommit) => void;
};

const MIN_SCALE = CANVAS_PLATFORM_MIN_SCALE;
const MAX_SCALE = CANVAS_PLATFORM_MAX_SCALE;
const DEFAULT_VIEWPORT: ArtifactWorkflowViewport = { x: 0, y: 0, scale: 1 };
const ALL_NODES_RECONCILE_MAX_ATTEMPTS = 9;
// Win32 SetDoubleClickTime accepts values through 5000ms. Keep automatic
// viewport movement outside that interval plus one small event-loop margin so
// a timer due at the boundary cannot run ahead of click 2's input task.
const WIN32_MAX_DOUBLE_CLICK_MS = 5_000;
const POINTER_SELECTION_VIEWPORT_BARRIER_MS = WIN32_MAX_DOUBLE_CLICK_MS + 100;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeViewport(value: ArtifactWorkflowViewport): ArtifactWorkflowViewport {
  return normalizeCanvasPlatformViewport(value);
}

export function ArtifactWorkflowCanvas<TNode extends ArtifactWorkflowNode, TEdge extends ArtifactWorkflowEdge>({
  kind,
  nodes,
  edges,
  layout,
  viewport,
  selectedNodeId = "",
  defaultNodeSize = { width: 220, height: 88 },
  resizable = false,
  minimumNodeSize = { width: 220, height: 160 },
  maximumNodeSize = { width: 900, height: 1200 },
  fitMinimumScale = MIN_SCALE,
  autoFitOnMount = false,
  preserveViewportOnDataChange = false,
  autoFitKey = "",
  busy = false,
  toolbar,
  canvasMeta,
  selectionIcon,
  selectionTitle = "当前成果",
  selectionDetail = "已选中",
  onClearSelection,
  focusLayer,
  focusLayerLabel = "成果聚焦",
  onFocusLayerClose,
  focusLayerHostRef,
  onContextMenu,
  onFilesDrop,
  onNodeOpen,
  onConnect,
  emptyContent,
  renderNode,
  renderEdgeLabel,
  onSelect,
  onLayoutChange,
  onViewportChange,
  onCommit
}: ArtifactWorkflowCanvasProps<TNode, TEdge>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [interactionVisual, setInteractionVisual] = useState<"pan" | "node" | "resize" | "connect" | null>(null);
  const [wheelAccelerated, setWheelAccelerated] = useState(false);
  const wheelSettleTimerRef = useRef(0);
  const fitSettleTimerRef = useRef(0);
  const readableMinimumScaleRef = useRef(MIN_SCALE);
  const selectionReconcileFrameRef = useRef(0);
  const pointerSelectionViewportBarrierTimerRef = useRef(0);
  const pointerSelectionViewportBarrierRef = useRef<{ nodeId: string } | null>(null);
  const focusPointerSelectionViewportBarrierRef = useRef<{ nodeId: string } | null>(null);
  const allNodesReconcileTimerRef = useRef(0);
  const allNodesReconcileDeadlineRef = useRef(0);
  const allNodesReconcileAttemptRef = useRef(0);
  const allNodesReconcileActiveRef = useRef(false);
  const allNodesReconcileCommitReasonRef = useRef<ArtifactWorkflowCommitReason | null>(null);
  const resizeRebaseRefreshRef = useRef<() => void>(() => undefined);
  const resizeRebaseRevisionRef = useRef(0);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const interactionRef = useRef<
    | { type: "pan"; pointerId: number; startX: number; startY: number; viewport: ArtifactWorkflowViewport; moved: boolean }
    | { type: "node"; pointerId: number; nodeId: string; startX: number; startY: number; scale: number; layout: ArtifactWorkflowLayout[]; moved: boolean }
    | { type: "resize"; pointerId: number; nodeId: string; startX: number; startY: number; scale: number; layout: ArtifactWorkflowLayout[]; size: { width: number; height: number }; moved: boolean }
    | { type: "connect"; pointerId: number; sourceId: string; startX: number; startY: number; worldX: number; worldY: number; moved: boolean }
    | null
  >(null);
  const [connectionDraft, setConnectionDraft] = useState<{ sourceId: string; worldX: number; worldY: number } | null>(null);
  const suppressNodeClickRef = useRef("");
  const autoFitConsumedRef = useRef("");
  const currentViewport = safeViewport(viewport || DEFAULT_VIEWPORT);
  const currentViewportRef = useRef(currentViewport);
  if (interactionRef.current?.type !== "pan") currentViewportRef.current = currentViewport;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const layoutById = useMemo(() => new Map(layout.map((item) => [item.artifactId, item])), [layout]);
  const connectedInputs = useMemo(() => new Set(edges.map((edge) => edge.targetArtifactId)), [edges]);
  const connectedOutputs = useMemo(() => new Set(edges.map((edge) => edge.sourceArtifactId)), [edges]);
  const focusOpen = Boolean(focusLayer || focusLayerHostRef);
  const focusOpenRef = useRef(focusOpen);
  focusOpenRef.current = focusOpen;
  const previousFocusOpenRef = useRef(focusOpen);
  const clarityBand = canvasPlatformClarityBand(currentViewport.scale);
  const viewportInteracting = interactionVisual === "pan" || wheelAccelerated;
  const worldTransform = canvasPlatformViewportTransform(interactionRef.current?.type === "pan" ? currentViewportRef.current : currentViewport, viewportInteracting, typeof window === "undefined" ? 1 : window.devicePixelRatio);

  useEffect(() => () => {
    window.clearTimeout(wheelSettleTimerRef.current);
    window.clearTimeout(fitSettleTimerRef.current);
    window.clearTimeout(pointerSelectionViewportBarrierTimerRef.current);
    window.cancelAnimationFrame(selectionReconcileFrameRef.current);
    window.clearTimeout(allNodesReconcileTimerRef.current);
    allNodesReconcileActiveRef.current = false;
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.code === "Space" && !event.repeat && !event.isComposing && !canvasPlatformEditableTarget(event.target)) {
        setSpacePressed(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    const blur = () => setSpacePressed(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const commit = (
    reason: ArtifactWorkflowCommitReason,
    nextLayout = [...layoutRef.current],
    nextViewport = currentViewportRef.current
  ) => {
    onCommitRef.current?.({ reason, layout: nextLayout, viewport: safeViewport(nextViewport) });
  };

  const setViewport = (next: ArtifactWorkflowViewport) => {
    const normalized = safeViewport(next);
    currentViewportRef.current = normalized;
    onViewportChangeRef.current?.(normalized);
  };

  const pointerSelectionViewportBlocked = () => Boolean(pointerSelectionViewportBarrierRef.current);

  const reconcileSelectedNodeWithChrome = (nodeId = selectedNodeIdRef.current) => {
    const host = hostRef.current;
    if (
      !host || !nodeId || selectedNodeIdRef.current !== nodeId || interactionRef.current ||
      focusOpenRef.current || pointerSelectionViewportBlocked()
    ) return false;
    const nodeElement = Array.from(host.querySelectorAll<HTMLElement>("[data-workflow-node-id]"))
      .find((item) => item.getAttribute("data-workflow-node-id") === nodeId) ?? null;
    if (!nodeElement) return false;
    const hostRect = host.getBoundingClientRect();
    const nodeRect = nodeElement.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0 || nodeRect.width <= 0 || nodeRect.height <= 0) return false;

    const margin = 12;
    let minLeft = hostRect.left + margin;
    let maxRight = hostRect.right - margin;
    let minTop = hostRect.top + margin;
    let maxBottom = hostRect.bottom - margin;
    for (const chrome of Array.from(host.querySelectorAll<HTMLElement>("[data-canvas-platform-selection], [data-workflow-toolbar]"))) {
      const style = window.getComputedStyle(chrome);
      const chromeRect = chrome.getBoundingClientRect();
      if (!canvasPlatformRectIsRendered(chromeRect, style)) continue;
      const centerY = (chromeRect.top + chromeRect.bottom) / 2;
      if (centerY <= (hostRect.top + hostRect.bottom) / 2) minTop = Math.max(minTop, chromeRect.bottom + margin);
      else maxBottom = Math.min(maxBottom, chromeRect.top - margin);
    }

    // Extremely compact hosts can leave less room than the selected artifact.
    // Preserve a usable top/left anchor instead of oscillating between edges.
    if (maxRight <= minLeft) {
      minLeft = hostRect.left;
      maxRight = hostRect.right;
    }
    if (maxBottom <= minTop) {
      minTop = hostRect.top;
      maxBottom = hostRect.bottom;
    }
    const { x: dx, y: dy } = canvasPlatformContainmentDelta(nodeRect, {
      left: minLeft,
      right: maxRight,
      top: minTop,
      bottom: maxBottom
    });
    const current = currentViewportRef.current;
    const bounds = canvasPlatformArtifactWorkflowBounds(nodesRef.current, layoutRef.current, defaultNodeSize);
    const graphHeight = bounds ? Math.max(0, bounds.bottom - bounds.top) * current.scale : 0;
    const readableOverflow = current.scale <= readableMinimumScaleRef.current + 0.001 && (
      hostRect.height <= 420 || graphHeight > Math.max(1, hostRect.height - 96)
    );
    // At the readable minimum a compact host intentionally shows only part of
    // the graph. A selected lower node may be below the bottom toolbar; moving
    // the whole world upward to contain it would hide the first row under the
    // top selection rail. Keep the established vertical anchor and only allow
    // positive correction that clears a real top-rail overlap.
    const adjustedDy = readableOverflow ? Math.max(0, dy) : dy;
    if (Math.abs(dx) < 1 && Math.abs(adjustedDy) < 1) return false;
    setViewport({ ...current, x: current.x + dx, y: current.y + adjustedDy });
    return true;
  };

  /**
   * Fit/resize can leave a non-selected artifact underneath the transient
   * selection rail or domain toolbar on compact hosts. Move the world by the
   * smallest screen-space delta that clears every real two-dimensional
   * intersection with top chrome. This is deliberately settle-only: normal
   * pan and node dragging remain entirely under the user's control.
   */
  const reconcileAllNodesWithChrome = (): "corrected" | "settled" | "waiting" => {
    const host = hostRef.current;
    if (!host || interactionRef.current || focusOpenRef.current || pointerSelectionViewportBlocked()) return "waiting";
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) return "waiting";
    const margin = 12;
    const visibleChrome = Array.from(host.querySelectorAll<HTMLElement>("[data-canvas-platform-selection], [data-workflow-toolbar], [data-workflow-status], [data-workflow-controls]"))
      .map((chrome) => {
        const style = window.getComputedStyle(chrome);
        const rect = chrome.getBoundingClientRect();
        return canvasPlatformRectIsRendered(rect, style) ? rect : null;
      })
      .filter((rect): rect is DOMRect => Boolean(rect));
    const topChrome = visibleChrome
      .filter((rect) => (rect.top + rect.bottom) / 2 <= (hostRect.top + hostRect.bottom) / 2);
    const bottomChrome = visibleChrome
      .filter((rect) => (rect.top + rect.bottom) / 2 > (hostRect.top + hostRect.bottom) / 2);
    if (!topChrome.length) return "waiting";

    // At the readable minimum the world can be larger than the compact host.
    // In that deliberate overflow mode, prioritize clearing the top rail and
    // leave off-screen world nodes pannable instead of letting them block the
    // only correction that makes the current working area reachable. A real
    // bottom toolbar remains a hard boundary in either mode.
    const readableOverflow = currentViewportRef.current.scale <= readableMinimumScaleRef.current + 0.001;
    let dy = 0;
    let maxDy = readableOverflow ? Number.POSITIVE_INFINITY : hostRect.bottom - margin;
    const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-workflow-node-id]"));
    if (!nodes.length) return "waiting";
    for (const node of nodes) {
      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.width <= 0 || nodeRect.height <= 0) continue;
      if (!readableOverflow) maxDy = Math.min(maxDy, hostRect.bottom - margin - nodeRect.bottom);
      for (const chromeRect of bottomChrome) {
        const horizontallyAligned = nodeRect.right > chromeRect.left && nodeRect.left < chromeRect.right;
        if (horizontallyAligned) maxDy = Math.min(maxDy, chromeRect.top - margin - nodeRect.bottom);
      }
      for (const chromeRect of topChrome) {
        const intersects = nodeRect.right > chromeRect.left && nodeRect.left < chromeRect.right &&
          nodeRect.bottom > chromeRect.top && nodeRect.top < chromeRect.bottom;
        if (intersects) dy = Math.max(dy, chromeRect.bottom + margin - nodeRect.top);
      }
    }
    const boundedDy = Math.max(0, Math.min(dy, maxDy));
    if (boundedDy < 1) {
      allNodesReconcileCommitReasonRef.current = null;
      return "settled";
    }
    const current = currentViewportRef.current;
    const next = { ...current, y: current.y + boundedDy };
    setViewport(next);
    const commitReason = allNodesReconcileCommitReasonRef.current;
    // A correction that completes an explicit fit is part of that durable user
    // intent. Resize/selection-only corrections remain presentation state and
    // naturally persist with the next explicit canvas gesture.
    if (commitReason) commit(commitReason, [...layoutRef.current], next);
    allNodesReconcileCommitReasonRef.current = null;
    return "corrected";
  };

  const scheduleSelectedNodeChromeReconcile = (nodeId = selectedNodeIdRef.current) => {
    window.cancelAnimationFrame(selectionReconcileFrameRef.current);
    selectionReconcileFrameRef.current = 0;
    if (focusOpenRef.current || pointerSelectionViewportBlocked()) return;
    selectionReconcileFrameRef.current = window.requestAnimationFrame(() => {
      selectionReconcileFrameRef.current = window.requestAnimationFrame(() => {
        selectionReconcileFrameRef.current = 0;
        reconcileSelectedNodeWithChrome(nodeId);
      });
    });
  };

  const scheduleAllNodesChromeReconcile = (
    settleWindowMs = 0,
    commitReason: ArtifactWorkflowCommitReason | null | undefined = undefined
  ) => {
    if (focusOpenRef.current || pointerSelectionViewportBlocked()) return;
    const now = window.performance.now();
    if (settleWindowMs > 0) {
      // A new layout event starts one finite settlement budget. Repeated
      // viewport callbacks during that budget coalesce into the existing run
      // and cannot extend it indefinitely.
      const startingNewRun = !allNodesReconcileActiveRef.current || now > allNodesReconcileDeadlineRef.current;
      if (startingNewRun) {
        allNodesReconcileActiveRef.current = true;
        allNodesReconcileAttemptRef.current = 0;
        allNodesReconcileDeadlineRef.current = now + settleWindowMs;
      }
      if (commitReason !== undefined && (commitReason !== null || startingNewRun)) {
        allNodesReconcileCommitReasonRef.current = commitReason;
      }
    } else if (!allNodesReconcileActiveRef.current || now > allNodesReconcileDeadlineRef.current) {
      return;
    }
    if (allNodesReconcileTimerRef.current) return;
    const finish = (clearReason = false) => {
      allNodesReconcileActiveRef.current = false;
      allNodesReconcileDeadlineRef.current = 0;
      allNodesReconcileAttemptRef.current = 0;
      if (clearReason) allNodesReconcileCommitReasonRef.current = null;
    };
    const attempt = () => {
      allNodesReconcileTimerRef.current = 0;
      if (!allNodesReconcileActiveRef.current) return;
      const attemptNumber = allNodesReconcileAttemptRef.current;
      if (attemptNumber >= ALL_NODES_RECONCILE_MAX_ATTEMPTS || window.performance.now() > allNodesReconcileDeadlineRef.current) {
        finish(true);
        return;
      }
      allNodesReconcileAttemptRef.current += 1;
      const result = reconcileAllNodesWithChrome();
      if (result === "settled") {
        finish();
        return;
      }
      if (window.performance.now() >= allNodesReconcileDeadlineRef.current) {
        finish(true);
        return;
      }
      // Give React/layout one turn after a correction. Timers are used instead
      // of an rAF-only chain because hidden Electron windows can throttle rAF.
      const delay = result === "corrected"
        ? 32
        : Math.min(240, 32 * (2 ** Math.min(attemptNumber, 3)));
      allNodesReconcileTimerRef.current = window.setTimeout(attempt, delay);
    };
    allNodesReconcileTimerRef.current = window.setTimeout(attempt, 0);
  };

  const cancelSelectionChangeChromeReconcile = () => {
    window.cancelAnimationFrame(selectionReconcileFrameRef.current);
    selectionReconcileFrameRef.current = 0;
  };

  const scheduleSelectionChangeChromeReconcile = (nodeId: string) => {
    cancelSelectionChangeChromeReconcile();
    if (
      focusOpenRef.current || pointerSelectionViewportBlocked() ||
      selectedNodeIdRef.current !== nodeId
    ) return;
    scheduleSelectedNodeChromeReconcile(nodeId);
    scheduleAllNodesChromeReconcile(1200, null);
  };

  const cancelPointerSelectionViewportBarrier = () => {
    window.clearTimeout(pointerSelectionViewportBarrierTimerRef.current);
    pointerSelectionViewportBarrierTimerRef.current = 0;
    pointerSelectionViewportBarrierRef.current = null;
  };

  const consumePointerSelectionViewportBarrier = () => {
    const hadBarrier = pointerSelectionViewportBlocked();
    cancelPointerSelectionViewportBarrier();
    if (hadBarrier) resizeRebaseRefreshRef.current();
  };

  const releasePointerSelectionViewportBarrier = (reconcile = false) => {
    cancelPointerSelectionViewportBarrier();
    if (!reconcile) return;
    resizeRebaseRefreshRef.current();
    const selectedNodeId = selectedNodeIdRef.current;
    if (selectedNodeId) {
      scheduleSelectedNodeChromeReconcile(selectedNodeId);
      scheduleAllNodesChromeReconcile(1200, null);
    }
  };

  const armPointerSelectionViewportBarrier = (nodeId: string) => {
    cancelPointerSelectionViewportBarrier();
    const barrier = { nodeId };
    pointerSelectionViewportBarrierRef.current = barrier;
    pointerSelectionViewportBarrierTimerRef.current = window.setTimeout(() => {
      if (pointerSelectionViewportBarrierRef.current !== barrier) return;
      pointerSelectionViewportBarrierTimerRef.current = 0;
      pointerSelectionViewportBarrierRef.current = null;
      resizeRebaseRefreshRef.current();
      scheduleSelectionChangeChromeReconcile(nodeId);
    }, POINTER_SELECTION_VIEWPORT_BARRIER_MS);
  };

  const armOrExtendPointerSelectionViewportBarrier = (nodeId: string) => {
    // pointerdown protects the press itself; arming again at click protects the
    // complete OS double-click interval even if an intervening async selection
    // or layout commit released the original press barrier.
    armPointerSelectionViewportBarrier(nodeId);
  };

  useLayoutEffect(() => {
    // A durable canvas commit can finish after the fit click that superseded
    // it. During the short fit/resize settlement window, re-check any incoming
    // viewport replay so an older persisted frame cannot put nodes back under
    // the top chrome. Outside this window user pan/zoom stays untouched.
    if (window.performance.now() <= allNodesReconcileDeadlineRef.current) {
      scheduleAllNodesChromeReconcile();
    }
  }, [currentViewport.x, currentViewport.y, currentViewport.scale]);

  const worldPointFromClient = (clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    // Resize rebasing updates the ref before the parent render lands. Pointer
    // gestures must use that live viewport or the first movement can jump back
    // to the previous render's translation/scale.
    const world = canvasPlatformWorldPoint(currentViewportRef.current, { x: clientX - left, y: clientY - top });
    return {
      clientX,
      clientY,
      worldX: world.x,
      worldY: world.y
    };
  };

  const [keyboardConnectionSourceId, setKeyboardConnectionSourceId] = useState("");

  const cancelKeyboardConnection = () => {
    setKeyboardConnectionSourceId("");
    setConnectionDraft(null);
  };

  const beginConnection = (sourceId: string, event: React.PointerEvent<HTMLElement>) => {
    if (!onConnect || event.button !== 0 || busy) return;
    event.preventDefault();
    event.stopPropagation();
    consumeAutoFit();
    setKeyboardConnectionSourceId("");
    const point = worldPointFromClient(event.clientX, event.clientY);
    hostRef.current?.setPointerCapture(event.pointerId);
    interactionRef.current = { type: "connect", pointerId: event.pointerId, sourceId, startX: event.clientX, startY: event.clientY, worldX: point.worldX, worldY: point.worldY, moved: false };
    setInteractionVisual("connect");
    setConnectionDraft({ sourceId, worldX: point.worldX, worldY: point.worldY });
  };

  const handlePortKeyDown = (nodeId: string, side: "input" | "output", event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onConnect || busy || !["Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      cancelKeyboardConnection();
      return;
    }
    consumeAutoFit();
    if (side === "output") {
      setKeyboardConnectionSourceId((current) => current === nodeId ? "" : nodeId);
      setConnectionDraft(null);
      return;
    }
    if (keyboardConnectionSourceId && keyboardConnectionSourceId !== nodeId) {
      const sourceId = keyboardConnectionSourceId;
      cancelKeyboardConnection();
      void Promise.resolve(onConnect(sourceId, nodeId)).catch(() => undefined);
    }
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const dispose = observeCanvasPlatformResizeRebase(
      host,
      () => currentViewportRef.current,
      (next) => {
        if (pointerSelectionViewportBlocked()) return;
        resizeRebaseRevisionRef.current += 1;
        const current = currentViewportRef.current;
        const bounds = canvasPlatformArtifactWorkflowBounds(nodesRef.current, layoutRef.current, defaultNodeSize);
        const hostRect = host.getBoundingClientRect();
        const graphHeight = bounds ? Math.max(0, bounds.bottom - bounds.top) * current.scale : 0;
        // At the readable minimum a compact host may show only part of the
        // graph. Re-centering that overflow on a delayed resize callback can
        // move the first row back underneath the top selection rail. Preserve
        // the established vertical anchor in that mode; horizontal rebasing
        // still keeps the canvas center stable.
        const verticalOverflowAtReadableMinimum = Boolean(
          current.scale <= readableMinimumScaleRef.current + 0.001 &&
          (hostRect.height <= 420 || Boolean(bounds && graphHeight > Math.max(1, hostRect.height - 96)))
        );
        const rebased = verticalOverflowAtReadableMinimum ? { ...next, y: current.y } : next;
        currentViewportRef.current = rebased;
        onViewportChangeRef.current?.(rebased);
        scheduleSelectedNodeChromeReconcile();
        scheduleAllNodesChromeReconcile(1600, null);
        // A responsive host resize is presentation state, not a user canvas
        // edit. Keep the world-space center stable in this mounted view, but
        // do not advance the durable workflow session merely because startup,
        // a sidebar transition, or a window resize changed its pixel bounds.
        // The rebased viewport is persisted naturally with the next explicit
        // pan/zoom/fit/node gesture.
      },
      () => Boolean(interactionRef.current || pointerSelectionViewportBlocked()),
      host.closest(".ide-main")
    );
    resizeRebaseRefreshRef.current = dispose.refresh;
    return () => {
      resizeRebaseRefreshRef.current = () => undefined;
      dispose();
    };
  }, []);

  useLayoutEffect(() => {
    // Hidden/background Electron windows may defer ResizeObserver delivery.
    // A layout commit still runs after a sidebar toggle, so measure the host
    // synchronously and preserve the same world-space center immediately.
    resizeRebaseRefreshRef.current();
  });

  const consumeAutoFit = (
    preserveChromeSettlement = false,
    preservePointerSelectionBarrier = false
  ) => {
    autoFitConsumedRef.current = autoFitKey;
    window.clearTimeout(fitSettleTimerRef.current);
    fitSettleTimerRef.current = 0;
    // A sidebar resize deferred by the click barrier still owns an armed retry.
    // Consume its measured size before the new gesture reads the viewport so
    // that retry cannot rebase a later zoom, pan, or context-menu position.
    // A native double-click still owns the barrier through its focus-open
    // transition. Every unrelated viewport gesture consumes it immediately.
    if (!preservePointerSelectionBarrier) consumePointerSelectionViewportBarrier();
    cancelSelectionChangeChromeReconcile();
    if (!preserveChromeSettlement) {
      allNodesReconcileDeadlineRef.current = 0;
      allNodesReconcileAttemptRef.current = 0;
      allNodesReconcileActiveRef.current = false;
      allNodesReconcileCommitReasonRef.current = null;
      window.clearTimeout(allNodesReconcileTimerRef.current);
      allNodesReconcileTimerRef.current = 0;
    }
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number, reason: ArtifactWorkflowCommitReason = "zoom") => {
    consumeAutoFit();
    const host = hostRef.current;
    const rect = host?.getBoundingClientRect();
    const pointerX = rect && clientX !== undefined ? clientX - rect.left : (rect?.width || 0) / 2;
    const pointerY = rect && clientY !== undefined ? clientY - rect.top : (rect?.height || 0) / 2;
    // Resize rebasing updates the ref before the parent render lands. Read the
    // ref here so a wheel/button zoom cannot apply a stale translation to the
    // newly measured canvas.
    const current = currentViewportRef.current;
    const next = canvasPlatformViewportFromFactor(current, factor, { x: pointerX, y: pointerY });
    if (Math.abs(next.scale - current.scale) < 0.0001) return;
    setViewport(next);
    commit(reason, [...layout], next);
  };

  const zoomWheelAt = (deltaY: number, clientX: number, clientY: number) => {
    consumeAutoFit();
    const rect = hostRef.current?.getBoundingClientRect();
    const current = currentViewportRef.current;
    const next = canvasPlatformViewportFromWheel(current, deltaY, {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0)
    });
    if (Math.abs(next.scale - current.scale) < 0.0001) return;
    window.clearTimeout(wheelSettleTimerRef.current);
    setWheelAccelerated(true);
    wheelSettleTimerRef.current = window.setTimeout(() => setWheelAccelerated(false), 96);
    setViewport(next);
    commit("zoom", [...layout], next);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-workflow-focus-layer]")) return;
      event.preventDefault();
      zoomWheelAt(event.deltaY, event.clientX, event.clientY);
    };
    host.addEventListener("wheel", handleWheel, { passive: false });
    return () => host.removeEventListener("wheel", handleWheel);
  }, [currentViewport.x, currentViewport.y, currentViewport.scale, layout]);

  const fit = (selectionOnly: boolean, minimumScale = MIN_SCALE) => {
    consumeAutoFit(true);
    readableMinimumScaleRef.current = minimumScale;
    const host = hostRef.current;
    if (!host) return;
    // A responsive shell can finish its grid transition just before an
    // explicit fit click. Consume that live host size first so a delayed
    // ResizeObserver callback cannot rebase the newly fitted viewport from a
    // stale desktop/compact size and move artifacts back under canvas chrome.
    resizeRebaseRefreshRef.current();
    const currentNodes = nodesRef.current;
    const currentSelectedNodeId = selectedNodeIdRef.current;
    const currentLayout = layoutRef.current;
    const targetNodes = selectionOnly && currentSelectedNodeId
      ? currentNodes.filter((node) => node.id === currentSelectedNodeId)
      : currentNodes;
    if (!targetNodes.length) {
      const next = { x: 40, y: 40, scale: 1 };
      setViewport(next);
      commit(selectionOnly ? "fit-selection" : "fit-all", [...currentLayout], next);
      return;
    }
    const bounds = canvasPlatformArtifactWorkflowBounds(targetNodes, currentLayout, defaultNodeSize);
    if (!bounds) return;
    const rect = host.getBoundingClientRect();
    const padding = Math.min(120, Math.max(48, Math.min(rect.width, rect.height) * 0.12));
    let topPadding = padding;
    let bottomPadding = padding;
    // Shared chrome can live at either edge: transient domain feedback is at
    // the top, while status and zoom controls are docked at the bottom. Treat
    // those as two independent insets. Folding bottom chrome into the top
    // inset pushed an otherwise valid fit below the canvas on every domain.
    for (const element of Array.from(host.querySelectorAll<HTMLElement>("[data-canvas-platform-selection], [data-workflow-status], [data-workflow-controls], [data-workflow-toolbar]"))) {
      const chromeRect = element.getBoundingClientRect();
      if (chromeRect.width <= 0 || chromeRect.height <= 0) continue;
      const relativeTop = chromeRect.top - rect.top;
      const relativeBottom = chromeRect.bottom - rect.top;
      if ((relativeTop + relativeBottom) / 2 <= rect.height / 2) {
        topPadding = Math.max(topPadding, relativeBottom + 14);
      } else {
        bottomPadding = Math.max(bottomPadding, rect.height - relativeTop + 14);
      }
    }
    // Selection chrome can mount in the same commit as fit and be absent from
    // the live measurement. Reserve its compact/desktop rail even in that
    // frame, then anchor the overflowing graph at the resulting safe edge.
    const selectionChromeExpected = Boolean(currentSelectedNodeId && !focusOpen);
    if (selectionChromeExpected) {
      topPadding = Math.max(topPadding, (rect.width <= 620 ? 40 : 44) + 14);
    }
    const next = canvasPlatformFitViewport(bounds, {
      width: rect.width,
      height: rect.height
    }, {
      insets: { left: padding, right: padding, top: topPadding, bottom: bottomPadding },
      minimumScale,
      maximumScale: MAX_SCALE,
      maximumFitScale: selectionOnly ? 1.35 : 1
    });
    if (selectionChromeExpected) {
      const firstNodeTop = next.y + bounds.top * next.scale;
      if (firstNodeTop < topPadding) next.y += topPadding - firstNodeTop;
    }
    setViewport(next);
    commit(selectionOnly ? "fit-selection" : "fit-all", [...currentLayout], next);
    scheduleSelectedNodeChromeReconcile();
    scheduleAllNodesChromeReconcile(1600, selectionOnly ? "fit-selection" : "fit-all");
    window.clearTimeout(fitSettleTimerRef.current);
    const committedSize = { width: rect.width, height: rect.height };
    fitSettleTimerRef.current = window.setTimeout(() => {
      fitSettleTimerRef.current = 0;
      if (pointerSelectionViewportBlocked()) return;
      const settledRect = hostRef.current?.getBoundingClientRect();
      if (!settledRect || Math.abs(settledRect.width - committedSize.width) <= 1 && Math.abs(settledRect.height - committedSize.height) <= 1) return;
      // A compact shell can resolve its stacked rows after the click. Refit
      // once against that settled size so the resize rebase cannot leave the
      // first artifacts beneath the selection rail.
      fit(selectionOnly, minimumScale);
    }, 180);
  };

  const selectedLayoutItem = selectedNodeId ? layoutById.get(selectedNodeId) : undefined;
  const selectedLayoutVisibilityKey = selectedLayoutItem
    ? [selectedLayoutItem.x, selectedLayoutItem.y, selectedLayoutItem.width ?? "", selectedLayoutItem.height ?? ""].join(":")
    : "";
  useLayoutEffect(() => {
    const focusWasOpen = previousFocusOpenRef.current;
    previousFocusOpenRef.current = focusOpen;
    if (focusOpen) {
      if (!focusWasOpen) {
        focusPointerSelectionViewportBarrierRef.current = pointerSelectionViewportBarrierRef.current;
      }
      cancelSelectionChangeChromeReconcile();
      return;
    }
    if (focusWasOpen) {
      const focusBarrier = focusPointerSelectionViewportBarrierRef.current;
      focusPointerSelectionViewportBarrierRef.current = null;
      const currentBarrier = pointerSelectionViewportBarrierRef.current;
      // A focus-close commit can be followed immediately by a new node press.
      // Only the barrier captured by the focus gesture may be released here;
      // a newer barrier belongs to the next native click sequence.
      if (!currentBarrier || currentBarrier === focusBarrier) {
        // A focus close should restore only the selected node's rail. Any
        // all-node settlement left by the prior focus gesture is stale and
        // must not move the canvas before the next native click can establish
        // its own viewport barrier.
        allNodesReconcileActiveRef.current = false;
        allNodesReconcileDeadlineRef.current = 0;
        allNodesReconcileAttemptRef.current = 0;
        allNodesReconcileCommitReasonRef.current = null;
        window.clearTimeout(allNodesReconcileTimerRef.current);
        allNodesReconcileTimerRef.current = 0;
        // Finish the selected-node correction in this layout commit. A delayed
        // rAF/timer here can run between a slow native mouse move and its
        // pointerdown, moving the next double-click target out from under the
        // original point.
        releasePointerSelectionViewportBarrier(false);
        resizeRebaseRefreshRef.current();
        reconcileSelectedNodeWithChrome(selectedNodeIdRef.current);
      }
      // The focus-close branch owns its one synchronous reconciliation. Do not
      // fall through to the general selection settlement scheduler.
      return;
    }
    if (!selectedNodeId) {
      cancelPointerSelectionViewportBarrier();
      cancelSelectionChangeChromeReconcile();
      return;
    }
    // The active pointer barrier is intentionally not consumed here. Layout
    // and node-count commits during click 1 must not reopen an automatic path.
    // Focus close has already restored the selected rail above; scheduling a
    // full all-node settlement here would reintroduce the stale movement that
    // the next native click is meant to supersede.
    if (!preserveViewportOnDataChange) scheduleSelectionChangeChromeReconcile(selectedNodeId);
  }, [focusOpen, nodes.length, selectedNodeId, selectedLayoutVisibilityKey, preserveViewportOnDataChange]);
  useEffect(() => {
    if (!autoFitOnMount || !nodes.length || autoFitConsumedRef.current === autoFitKey) return;
    const timer = window.setTimeout(() => {
      if (autoFitConsumedRef.current === autoFitKey) return;
      // First-open/project-remount views must remain readable at the supported
      // 884px workbench minimum. Overflow is intentional and pannable; the
      // explicit fit-all control remains available for a compact overview.
      const host = hostRef.current;
      if (host?.clientWidth && host.clientHeight) {
        fit(false, fitMinimumScale);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [autoFitKey, kind, nodes.length, layout, fitMinimumScale]);

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target instanceof Element && event.target.closest("[data-workflow-node], [data-workflow-controls], [data-workflow-toolbar], [data-workflow-focus-layer], button, input, textarea, select, a")) return;
    if (event.button === 0 || spacePressed || event.button === 1) {
      consumeAutoFit();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, viewport: currentViewportRef.current, moved: false };
      setInteractionVisual("pan");
    }
  };

  const beginNodeDrag = (nodeId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("[data-workflow-node-interactive]")) return;
    if (busy) return;
    consumeAutoFit();
    armPointerSelectionViewportBarrier(nodeId);
    const startingLayout = layout.map((item) => ({ ...item }));
    const liveViewport = currentViewportRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { type: "node", pointerId: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY, scale: liveViewport.scale, layout: startingLayout, moved: false };
    setInteractionVisual("node");
    setDraggingNodeId(nodeId);
  };

  const resizeLayout = (interaction: Extract<NonNullable<typeof interactionRef.current>, { type: "resize" }>, x: number, y: number) => {
    const size = canvasPlatformResizeNodeSize(interaction.size, { x: x - interaction.startX, y: y - interaction.startY }, interaction.scale, minimumNodeSize, maximumNodeSize);
    const existing = interaction.layout.find(item => item.artifactId === interaction.nodeId) || { artifactId: interaction.nodeId, x: 64, y: 64 };
    return [...interaction.layout.filter(item => item.artifactId !== interaction.nodeId), { ...existing, ...size }];
  };

  const beginNodeResize = (nodeId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || busy || !resizable) return;
    event.preventDefault(); event.stopPropagation(); consumeAutoFit();
    armPointerSelectionViewportBarrier(nodeId);
    onSelect?.(nodeId);
    const startingLayout = layoutRef.current.map(item => ({ ...item }));
    interactionRef.current = { type: "resize", pointerId: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY,
      scale: currentViewportRef.current.scale, layout: startingLayout,
      size: canvasPlatformArtifactWorkflowNodeSize(startingLayout.find(item => item.artifactId === nodeId), defaultNodeSize), moved: false };
    hostRef.current?.setPointerCapture(event.pointerId);
    setInteractionVisual("resize");
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      if (!interaction.moved && interaction.type === "node") {
        cancelPointerSelectionViewportBarrier();
      }
      interaction.moved = true;
    }
    if (interaction.type === "pan") {
      const next = safeViewport({ ...interaction.viewport, x: interaction.viewport.x + dx, y: interaction.viewport.y + dy });
      currentViewportRef.current = next;
      if (worldRef.current) worldRef.current.style.transform = canvasPlatformViewportTransform(next, true, window.devicePixelRatio);
      return;
    }
    if (interaction.type === "connect") {
      const point = worldPointFromClient(event.clientX, event.clientY);
      interaction.worldX = point.worldX;
      interaction.worldY = point.worldY;
      setConnectionDraft({ sourceId: interaction.sourceId, worldX: point.worldX, worldY: point.worldY });
      return;
    }
    if (interaction.type === "resize") {
      onLayoutChange?.(resizeLayout(interaction, event.clientX, event.clientY));
      return;
    }
    const nextLayout = canvasPlatformMoveArtifactWorkflowNode(
      interaction.layout,
      interaction.nodeId,
      { x: dx, y: dy },
      interaction.scale
    );
    onLayoutChange?.(nextLayout);
  };

  const finishInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    setInteractionVisual(null);
    setDraggingNodeId("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (interaction.type === "connect") {
      setConnectionDraft(null);
      setKeyboardConnectionSourceId("");
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-workflow-port="input"]')
        ?.closest<HTMLElement>("[data-workflow-node-id]")
        ?.getAttribute("data-workflow-node-id");
      if (target && target !== interaction.sourceId) {
        void Promise.resolve(onConnect?.(interaction.sourceId, target)).catch(() => undefined);
      }
      return;
    }
    if (interaction.type === "pan") {
      if (interaction.moved) {
        const next = safeViewport({
          ...interaction.viewport,
          x: interaction.viewport.x + event.clientX - interaction.startX,
          y: interaction.viewport.y + event.clientY - interaction.startY
        });
        setViewport(next);
        commit("pan", [...layout], next);
      }
      return;
    }
    if (interaction.type === "resize") {
      if (interaction.moved || Math.abs(event.clientX - interaction.startX) > 2 || Math.abs(event.clientY - interaction.startY) > 2) {
        const nextLayout = resizeLayout(interaction, event.clientX, event.clientY);
        onLayoutChange?.(nextLayout);
        commit("node-resize", nextLayout);
      }
      return;
    }
    if (interaction.moved) {
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      const nextLayout = canvasPlatformMoveArtifactWorkflowNode(
        interaction.layout,
        interaction.nodeId,
        { x: dx, y: dy },
        interaction.scale
      );
      suppressNodeClickRef.current = interaction.nodeId;
      commit("node-drag", nextLayout);
    }
  };

  const cancelInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      // A late pointercancel can arrive after pointerup has already
      // completed the click. It is not an active gesture and must not release
      // the barrier protecting the remaining native double-click.
      return;
    }
    interactionRef.current = null;
    setInteractionVisual(null);
    setDraggingNodeId("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (interaction.type === "connect") {
      releasePointerSelectionViewportBarrier(true);
      setConnectionDraft(null);
      setKeyboardConnectionSourceId("");
      return;
    }
    // A cancelled gesture is not a user commit. Restore the last persisted
    // display state instead of leaving a live drag/pan preview behind.
    if (interaction.type === "pan") {
      if (worldRef.current) worldRef.current.style.transform = canvasPlatformViewportTransform(interaction.viewport, false, window.devicePixelRatio);
      setViewport(interaction.viewport);
      releasePointerSelectionViewportBarrier(true);
      return;
    }
    onLayoutChange?.(interaction.layout);
    releasePointerSelectionViewportBarrier(true);
  };

  const handleCanvasContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onContextMenu) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-workflow-focus-layer], [data-workflow-toolbar], [data-workflow-controls], button:not([data-workflow-node-select]), input, textarea, select, a")) return;
    event.preventDefault();
    event.stopPropagation();
    consumeAutoFit();
    const node = target?.closest<HTMLElement>("[data-workflow-node-id]");
    const point = worldPointFromClient(event.clientX, event.clientY);
    onContextMenu({
      kind: node ? "node" : "canvas",
      ...(node?.getAttribute("data-workflow-node-id") ? { nodeId: node.getAttribute("data-workflow-node-id") || undefined } : {}),
      ...point
    });
  };

  return (
    <div
      className="artifact-workflow-canvas"
      data-workflow-canvas-shell="true"
      data-workflow-canvas="true"
      data-workflow-kind={kind}
      data-workflow-scale={currentViewport.scale}
      data-workflow-clarity={clarityBand}
      data-workflow-render-mode={viewportInteracting ? "accelerated" : "settled"}
      data-workflow-busy={busy ? "true" : "false"}
      data-workflow-focus-open={focusOpen ? "true" : "false"}
      data-workflow-resize-revision={resizeRebaseRevisionRef.current}
      tabIndex={-1}
      onContextMenu={handleCanvasContextMenu}
    >
      <div
      ref={hostRef}
      onDragOver={(event) => {
        if (!onFilesDrop || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = busy || focusOpen ? "none" : "copy";
      }}
      onDrop={(event) => {
        if (!onFilesDrop || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.stopPropagation();
        if (busy || focusOpen) return;
        const point = worldPointFromClient(event.clientX, event.clientY);
        onFilesDrop(Array.from(event.dataTransfer.files), { x: point.worldX, y: point.worldY });
      }}
      className={`workflow-canvas artifact-workflow-viewport${spacePressed ? " is-pan-ready" : ""}${interactionVisual === "pan" ? " is-panning" : ""}${viewportInteracting ? " is-viewport-interacting" : ""}${interactionVisual === "connect" ? " is-connecting" : ""}`}
      data-workflow-viewport="true"
      data-workflow-selection-toolbar-stacked={selectedNodeId && toolbar ? "true" : undefined}
      style={{
        "--port-zoom-compensation": String(clamp(0.72 / Math.max(currentViewport.scale, MIN_SCALE), 1, 4)),
        "--workflow-screen-pixel": `${1 / currentViewport.scale}px`
      } as React.CSSProperties}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={cancelInteraction}
      onLostPointerCapture={cancelInteraction}
      onContextMenu={handleCanvasContextMenu}
      onScroll={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0;
        if (event.currentTarget.scrollTop !== 0) event.currentTarget.scrollTop = 0;
      }}
    >
      <CanvasPlatformBackdrop />
      {toolbar ? <div className="artifact-workflow-toolbar-slot" data-workflow-toolbar="true">{toolbar}</div> : null}
      {selectedNodeId ? (
        <CanvasPlatformSelectionIndicator
          icon={selectionIcon ?? <Focus size={18} />}
          title={selectionTitle}
          detail={selectionDetail}
          kind={kind}
          ids={[selectedNodeId]}
          onFocus={() => fit(true)}
          onClear={onClearSelection}
        />
      ) : null}
      <div
        ref={worldRef}
        className="artifact-workflow-world"
        data-workflow-world="true"
        style={{ transform: worldTransform }}
      >
        <svg className="artifact-workflow-edges" aria-hidden="true">
          {edges.map((edge) => {
            const sourceLayout = layoutById.get(edge.sourceArtifactId);
            const targetLayout = layoutById.get(edge.targetArtifactId);
            if (!sourceLayout || !targetLayout) return null;
            const sourceSize = canvasPlatformArtifactWorkflowNodeSize(sourceLayout, defaultNodeSize);
            const targetSize = canvasPlatformArtifactWorkflowNodeSize(targetLayout, defaultNodeSize);
            const x1 = sourceLayout.x + sourceSize.width;
            const y1 = sourceLayout.y + sourceSize.height / 2;
            const x2 = targetLayout.x;
            const y2 = targetLayout.y + targetSize.height / 2;
            const middle = x1 + (x2 - x1) / 2;
            const labelFitsInline = x2 - x1 >= 82;
            const labelY = labelFitsInline
              ? (y1 + y2) / 2 - 11
              : Math.min(sourceLayout.y, targetLayout.y) - 28;
            return <g key={edge.id} data-workflow-relation={edge.relation || "derived-from"}>
              <path
                d={`M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`}
                data-workflow-edge={edge.id}
                data-workflow-source={edge.sourceArtifactId}
                data-workflow-target={edge.targetArtifactId}
                data-workflow-relation={edge.relation || "derived-from"}
              />
              {renderEdgeLabel ? <foreignObject
                className="artifact-workflow-edge-label-host"
                data-workflow-edge-label={edge.id}
                data-workflow-source={edge.sourceArtifactId}
                data-workflow-target={edge.targetArtifactId}
                data-workflow-edge-label-placement={labelFitsInline ? "inline" : "above"}
                x={middle - 32}
                y={labelY}
                width="64"
                height="22"
              >{renderEdgeLabel(edge)}</foreignObject> : null}
            </g>;
          })}
          {connectionDraft ? (() => {
            const sourceLayout = layoutById.get(connectionDraft.sourceId);
            if (!sourceLayout) return null;
            const sourceSize = canvasPlatformArtifactWorkflowNodeSize(sourceLayout, defaultNodeSize);
            const x1 = sourceLayout.x + sourceSize.width;
            const y1 = sourceLayout.y + sourceSize.height / 2;
            const middle = x1 + (connectionDraft.worldX - x1) / 2;
            return <path
              className="artifact-workflow-edge-draft"
              d={`M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${connectionDraft.worldY}, ${connectionDraft.worldX} ${connectionDraft.worldY}`}
            />;
          })() : null}
        </svg>
        {nodes.map((node) => {
          const item = layoutById.get(node.id) || { artifactId: node.id, x: 64, y: 64 };
          const size = canvasPlatformArtifactWorkflowNodeSize(item, defaultNodeSize);
          const nodeLabel = String(node.title || node.id).trim() || node.id;
          return <div
            key={node.id}
            className={`artifact-workflow-node${node.id === selectedNodeId ? " selected" : ""}${node.id === draggingNodeId ? " dragging" : ""}`}
            data-workflow-node="true"
            data-workflow-node-id={node.id}
            data-workflow-node-x={String(item.x)}
            data-workflow-node-y={String(item.y)}
            data-workflow-id={node.id}
            data-workflow-x={String(item.x)}
            data-workflow-y={String(item.y)}
            data-workflow-selected={node.id === selectedNodeId ? "true" : "false"}
            role="group"
            aria-label={`成果节点：${nodeLabel}`}
            style={{ left: item.x, top: item.y, width: size.width, ...(resizable ? { height: size.height } : { minHeight: size.height }) }}
            onPointerDown={(event) => beginNodeDrag(node.id, event)}
            onPointerMove={onPointerMove}
            onPointerUp={finishInteraction}
            onPointerCancel={cancelInteraction}
            onClick={(event) => {
              if (suppressNodeClickRef.current === node.id) {
                suppressNodeClickRef.current = "";
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              const interactiveTarget = event.target instanceof Element && event.target.closest("[data-workflow-node-interactive]");
              if (event.detail > 0 && !interactiveTarget) {
                armOrExtendPointerSelectionViewportBarrier(node.id);
              }
              onSelect?.(node.id);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.target instanceof Element && event.target.closest("[data-workflow-node-interactive]")) return;
              // Opening focus is still part of the native double-click
              // gesture. Cancel automatic fit work, but keep the selection
              // viewport barrier until the gesture window has settled.
              consumeAutoFit(false, true);
              onSelect?.(node.id);
              onNodeOpen?.(node.id);
            }}
          >
            <button
              type="button"
              className="artifact-workflow-node-select"
              data-workflow-node-select="true"
              data-workflow-node-interactive="true"
              aria-label={`选择成果：${nodeLabel}`}
              aria-pressed={node.id === selectedNodeId}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(node.id);
              }}
            />
            <button
              type="button"
              className={`artifact-workflow-port artifact-workflow-port--input${onConnect ? " is-connectable" : ""}${connectedInputs.has(node.id) ? " connected" : ""}${keyboardConnectionSourceId ? " is-keyboard-target" : ""}`}
              data-workflow-port="input"
              data-workflow-node-interactive="true"
              aria-label={`连接到成果节点 ${node.id}`}
              disabled={!onConnect || busy}
              onKeyDown={(event) => handlePortKeyDown(node.id, "input", event)}
            />
            <button
              type="button"
              className={`artifact-workflow-port artifact-workflow-port--output${onConnect ? " is-connectable" : ""}${connectedOutputs.has(node.id) ? " connected" : ""}`}
              data-workflow-port="output"
              data-workflow-node-interactive="true"
              aria-label={`从成果节点 ${node.id} 开始连接`}
              aria-pressed={keyboardConnectionSourceId === node.id}
              disabled={!onConnect || busy}
              onPointerDown={(event) => beginConnection(node.id, event)}
              onKeyDown={(event) => handlePortKeyDown(node.id, "output", event)}
            />
            {renderNode(node, { selected: node.id === selectedNodeId, scale: currentViewport.scale, select: () => onSelect?.(node.id) })}
            {resizable && <button type="button" className="artifact-workflow-node-resize" data-workflow-node-interactive="true"
              aria-label={"调整容器大小：" + nodeLabel} title="拖动调整大小；方向键微调" disabled={busy}
              onPointerDown={event => beginNodeResize(node.id, event)}
              onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || busy) return;
                event.preventDefault(); event.stopPropagation(); consumeAutoFit();
                const step = event.shiftKey ? 40 : 10;
                const size = canvasPlatformResizeNodeSize(canvasPlatformArtifactWorkflowNodeSize(item, defaultNodeSize),
                  { x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0 }, 1, minimumNodeSize, maximumNodeSize);
                const next = [...layout.filter(value => value.artifactId !== node.id), { ...item, ...size }];
                onLayoutChange?.(next); commit("node-resize", next);
              }} />}
          </div>;
        })}
      </div>
      {focusOpen ? (
        <Suspense fallback={null}>
          <CanvasPlatformFocusSurface
            label={focusLayerLabel}
            bodyRef={focusLayerHostRef}
            onRequestClose={onFocusLayerClose}
          >
            {focusLayer}
          </CanvasPlatformFocusSurface>
        </Suspense>
      ) : null}
      {!nodes.length ? (
        emptyContent ?? <CanvasPlatformEmptyState
          title="从第一个真实成果开始"
          description="成果会在这里形成可平移、缩放和追溯的工作流。"
        />
      ) : null}
      </div>
      <CanvasPlatformFooter
        meta={canvasMeta ?? (nodes.length ? `${nodes.length} 个成果 · ${edges.length} 条关系` : "暂无成果")}
        scale={currentViewport.scale}
        onZoomOut={() => zoomAt(CANVAS_PLATFORM_ZOOM_OUT_FACTOR)}
        onFitAll={() => fit(false, fitMinimumScale)}
        onZoomIn={() => zoomAt(CANVAS_PLATFORM_ZOOM_FACTOR)}
      />
    </div>
  );
}
