/** Pure coordinate math shared by every Aieyra infinite canvas. */

export type CanvasPlatformViewport = {
  x: number;
  y: number;
  scale: number;
};

export type CanvasPlatformPoint = {
  x: number;
  y: number;
};

export type CanvasPlatformBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CanvasPlatformSize = {
  width: number;
  height: number;
};

export type CanvasPlatformInsets = {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
};

export type CanvasPlatformClarityBand = "overview" | "compact" | "detail";

export type CanvasPlatformArtifactWorkflowLayout = {
  artifactId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type CanvasPlatformArtifactWorkflowNode = {
  id: string;
  title?: string;
};

type CanvasPlatformRenderedRect = Pick<DOMRectReadOnly, "width" | "height">;
type CanvasPlatformRenderedStyle = Pick<CSSStyleDeclaration, "display" | "visibility" | "opacity">;

export const CANVAS_PLATFORM_MIN_SCALE = 0.18;
export const CANVAS_PLATFORM_MAX_SCALE = 2.4;
export const CANVAS_PLATFORM_ZOOM_FACTOR = 1.12;
export const CANVAS_PLATFORM_ZOOM_OUT_FACTOR = 1 / CANVAS_PLATFORM_ZOOM_FACTOR;
export const CANVAS_PLATFORM_OVERVIEW_SCALE = 0.68;
export const CANVAS_PLATFORM_DETAIL_SCALE = 0.9;

const TRANSLATE_LIMIT = 400_000;

function finite(value: unknown, fallback: number) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function orderedLimits(minimum?: number, maximum?: number) {
  const min = finite(minimum, CANVAS_PLATFORM_MIN_SCALE);
  const max = finite(maximum, CANVAS_PLATFORM_MAX_SCALE);
  return { minimum: Math.min(min, max), maximum: Math.max(min, max) };
}

export function clampCanvasPlatformScale(value: unknown, minimum?: number, maximum?: number) {
  const limits = orderedLimits(minimum, maximum);
  return Math.max(limits.minimum, Math.min(limits.maximum, finite(value, 1)));
}

export function normalizeCanvasPlatformViewport(
  value: Partial<CanvasPlatformViewport> | undefined,
  options: { minimumScale?: number; maximumScale?: number; fallback?: CanvasPlatformViewport } = {}
): CanvasPlatformViewport {
  const fallback = options.fallback || { x: 0, y: 0, scale: 1 };
  return {
    x: Math.max(-TRANSLATE_LIMIT, Math.min(TRANSLATE_LIMIT, finite(value?.x, fallback.x))),
    y: Math.max(-TRANSLATE_LIMIT, Math.min(TRANSLATE_LIMIT, finite(value?.y, fallback.y))),
    scale: clampCanvasPlatformScale(finite(value?.scale, fallback.scale), options.minimumScale, options.maximumScale)
  };
}

/**
 * One visibility contract for canvas chrome and node geometry. Callers still
 * own DOM lookup and side effects; this only decides whether a measured box is
 * actually participating in layout and paint.
 */
export function canvasPlatformRectIsRendered(
  rect: CanvasPlatformRenderedRect | null | undefined,
  style: CanvasPlatformRenderedStyle | null | undefined
) {
  return Boolean(
    rect && style && rect.width > 0 && rect.height > 0 &&
    style.display !== "none" && style.visibility !== "hidden" &&
    Number.parseFloat(style.opacity || "1") > 0.01
  );
}

function containmentDelta(start: number, end: number, minimum: number, maximum: number) {
  if (end - start > Math.max(1, maximum - minimum)) return minimum - start;
  let delta = end > maximum ? maximum - end : 0;
  if (start + delta < minimum) delta += minimum - start - delta;
  return delta;
}

/** Smallest screen-space translation that contains a target in a safe box. */
export function canvasPlatformContainmentDelta(
  target: CanvasPlatformBounds,
  safeArea: CanvasPlatformBounds
): CanvasPlatformPoint {
  return {
    x: containmentDelta(target.left, target.right, safeArea.left, safeArea.right),
    y: containmentDelta(target.top, target.bottom, safeArea.top, safeArea.bottom)
  };
}

export function completeArtifactWorkflowLayout<TNode extends CanvasPlatformArtifactWorkflowNode & { kind: string }>(
  nodes: readonly TNode[],
  layout: readonly CanvasPlatformArtifactWorkflowLayout[],
  columns: Readonly<Record<string, number>>,
  xStep: number,
  yStep: number
): CanvasPlatformArtifactWorkflowLayout[] {
  const supplied = new Map(layout.map((item) => [item.artifactId, item]));
  const occupied = new Set<string>();
  const columnSlots = new Map<number, number>();
  return nodes.map((node) => {
    const existing = supplied.get(node.id);
    const column = columns[node.kind] ?? 0;
    let x = Number.isFinite(Number(existing?.x)) ? Number(existing?.x) : 64 + column * xStep;
    let y = Number.isFinite(Number(existing?.y)) ? Number(existing?.y) : 64 + (columnSlots.get(column) || 0) * yStep;
    let collisionKey = `${Math.round(x)}:${Math.round(y)}`;
    while (occupied.has(collisionKey)) {
      y += yStep;
      collisionKey = `${Math.round(x)}:${Math.round(y)}`;
    }
    occupied.add(collisionKey);
    columnSlots.set(column, Math.max(columnSlots.get(column) || 0, Math.floor(Math.max(0, y - 64) / yStep) + 1));
    return {
      artifactId: node.id,
      x,
      y,
      ...(Number.isFinite(Number(existing?.width)) ? { width: Number(existing?.width) } : {}),
      ...(Number.isFinite(Number(existing?.height)) ? { height: Number(existing?.height) } : {})
    };
  });
}

export function canvasPlatformArtifactWorkflowNodeSize(
  layout: CanvasPlatformArtifactWorkflowLayout | undefined,
  fallback: CanvasPlatformSize
): CanvasPlatformSize {
  return {
    width: Math.max(120, Math.min(1200, finite(layout?.width, fallback.width))),
    height: Math.max(72, Math.min(1200, finite(layout?.height, fallback.height)))
  };
}

/** Freeform size intent shared by Image containers and artifact containers. */
export function canvasPlatformResizeNodeSize(
  original: CanvasPlatformSize, delta: CanvasPlatformPoint, scale: number,
  minimum: CanvasPlatformSize, maximum: CanvasPlatformSize = { width: 1200, height: 1200 }
): CanvasPlatformSize {
  const zoom = Math.max(CANVAS_PLATFORM_MIN_SCALE, finite(scale, 1));
  return {
    width: Math.round(Math.max(minimum.width, Math.min(maximum.width, original.width + finite(delta.x, 0) / zoom))),
    height: Math.round(Math.max(minimum.height, Math.min(maximum.height, original.height + finite(delta.y, 0) / zoom)))
  };
}

export function canvasPlatformMoveArtifactWorkflowNode(
  layout: readonly CanvasPlatformArtifactWorkflowLayout[],
  artifactId: string,
  delta: CanvasPlatformPoint,
  scale: number
): CanvasPlatformArtifactWorkflowLayout[] {
  const original = layout.find((item) => item.artifactId === artifactId) || { artifactId, x: 64, y: 64 };
  const x = Math.max(-200_000, Math.min(200_000, original.x + delta.x / scale));
  const y = Math.max(-200_000, Math.min(200_000, original.y + delta.y / scale));
  const next = layout.map((item) => item.artifactId === artifactId ? { ...item, x, y } : item);
  if (!next.some((item) => item.artifactId === artifactId)) next.push({ artifactId, x, y });
  return next;
}

export function canvasPlatformArtifactWorkflowBounds(
  nodes: readonly CanvasPlatformArtifactWorkflowNode[],
  layout: readonly CanvasPlatformArtifactWorkflowLayout[],
  fallback: CanvasPlatformSize
): CanvasPlatformBounds | undefined {
  return canvasPlatformBoundsFromRectangles(nodes.map((node) => {
    const item = layout.find((entry) => entry.artifactId === node.id);
    const size = canvasPlatformArtifactWorkflowNodeSize(item, fallback);
    const left = finite(item?.x, 64);
    const top = finite(item?.y, 64);
    return { left, top, right: left + size.width, bottom: top + size.height };
  }));
}

export function isPristineArtifactWorkflowViewport(value: CanvasPlatformViewport | undefined) {
  const { x, y, scale } = normalizeCanvasPlatformViewport(value || { x: 0, y: 0, scale: 1 });
  return Math.abs(scale - 1) < 0.0001 && (
    (Math.abs(x - 40) < 0.0001 && Math.abs(y - 40) < 0.0001) ||
    (Math.abs(x) < 0.0001 && Math.abs(y) < 0.0001)
  );
}

export function rebaseArtifactWorkflowViewportForResize(
  viewport: CanvasPlatformViewport,
  previousSize: CanvasPlatformSize,
  nextSize: CanvasPlatformSize
): CanvasPlatformViewport {
  return rebaseCanvasPlatformViewportForResize(viewport, previousSize, nextSize);
}

/**
 * Keep the settled world on physical-pixel translation boundaries. Chromium
 * otherwise rasterizes DOM text and one-pixel borders between device pixels,
 * which is especially visible after a fit-all operation below 70%.
 */
export function alignCanvasPlatformViewportForRender(
  viewport: CanvasPlatformViewport,
  devicePixelRatio: unknown = 1
): CanvasPlatformViewport {
  const current = normalizeCanvasPlatformViewport(viewport);
  const dpr = Math.max(1, Math.min(4, finite(devicePixelRatio, 1)));
  return {
    x: Math.round(current.x * dpr) / dpr,
    y: Math.round(current.y * dpr) / dpr,
    scale: Math.round(current.scale * 10_000) / 10_000
  };
}

/**
 * Active gestures use a promoted layer for responsiveness. At rest, a 2D
 * transform forces Chromium to re-rasterize text and SVG at the final scale
 * instead of reusing a softened GPU texture.
 */
export function canvasPlatformViewportTransform(
  viewport: CanvasPlatformViewport,
  accelerated = false,
  devicePixelRatio: unknown = 1
) {
  const aligned = alignCanvasPlatformViewportForRender(viewport, devicePixelRatio);
  return accelerated
    ? `translate3d(${aligned.x}px, ${aligned.y}px, 0) scale(${aligned.scale})`
    : `translate(${aligned.x}px, ${aligned.y}px) scale(${aligned.scale})`;
}

export function canvasPlatformClarityBand(scale: unknown): CanvasPlatformClarityBand {
  const current = clampCanvasPlatformScale(scale);
  if (current < CANVAS_PLATFORM_OVERVIEW_SCALE) return "overview";
  if (current < CANVAS_PLATFORM_DETAIL_SCALE) return "compact";
  return "detail";
}

export function canvasPlatformWorldPoint(
  viewport: CanvasPlatformViewport,
  screenPoint: CanvasPlatformPoint,
  options: { minimumScale?: number; maximumScale?: number } = {}
): CanvasPlatformPoint {
  const current = normalizeCanvasPlatformViewport(viewport, options);
  return {
    x: (finite(screenPoint.x, 0) - current.x) / current.scale,
    y: (finite(screenPoint.y, 0) - current.y) / current.scale
  };
}

export function canvasPlatformViewportAtPoint(
  viewport: CanvasPlatformViewport,
  nextScale: number,
  screenPoint: CanvasPlatformPoint,
  options: { minimumScale?: number; maximumScale?: number } = {}
): CanvasPlatformViewport {
  const current = normalizeCanvasPlatformViewport(viewport, options);
  const scale = clampCanvasPlatformScale(nextScale, options.minimumScale, options.maximumScale);
  const world = canvasPlatformWorldPoint(current, screenPoint, options);
  return normalizeCanvasPlatformViewport({
    x: finite(screenPoint.x, 0) - world.x * scale,
    y: finite(screenPoint.y, 0) - world.y * scale,
    scale
  }, options);
}

export function canvasPlatformViewportFromFactor(
  viewport: CanvasPlatformViewport,
  factor: number,
  screenPoint: CanvasPlatformPoint,
  options: { minimumScale?: number; maximumScale?: number } = {}
): CanvasPlatformViewport {
  const current = normalizeCanvasPlatformViewport(viewport, options);
  return canvasPlatformViewportAtPoint(
    current,
    current.scale * finite(factor, 1),
    screenPoint,
    options
  );
}

export function canvasPlatformViewportFromWheel(
  viewport: CanvasPlatformViewport,
  deltaY: number,
  screenPoint: CanvasPlatformPoint,
  options: { minimumScale?: number; maximumScale?: number } = {}
): CanvasPlatformViewport {
  if (finite(deltaY, 0) === 0) return normalizeCanvasPlatformViewport(viewport, options);
  const factor = Number(deltaY) > 0 ? CANVAS_PLATFORM_ZOOM_OUT_FACTOR : CANVAS_PLATFORM_ZOOM_FACTOR;
  return canvasPlatformViewportFromFactor(viewport, factor, screenPoint, options);
}

export function canvasPlatformFitViewport(
  bounds: CanvasPlatformBounds | undefined,
  viewportSize: CanvasPlatformSize,
  options: {
    insets?: CanvasPlatformInsets;
    minimumScale?: number;
    maximumScale?: number;
    maximumFitScale?: number;
    emptyViewport?: CanvasPlatformViewport;
  } = {}
): CanvasPlatformViewport {
  if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) {
    return normalizeCanvasPlatformViewport(
      options.emptyViewport || { x: 40, y: 40, scale: 1 },
      options
    );
  }
  const insets = options.insets || {};
  const left = Math.max(0, finite(insets.left, 0));
  const right = Math.max(0, finite(insets.right, 0));
  const top = Math.max(0, finite(insets.top, 0));
  const bottom = Math.max(0, finite(insets.bottom, 0));
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, finite(viewportSize.width, 1) - left - right);
  const availableHeight = Math.max(1, finite(viewportSize.height, 1) - top - bottom);
  const maximumFitScale = finite(options.maximumFitScale, options.maximumScale ?? CANVAS_PLATFORM_MAX_SCALE);
  const scale = clampCanvasPlatformScale(
    Math.min(availableWidth / width, availableHeight / height, maximumFitScale),
    options.minimumScale,
    options.maximumScale
  );
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  // A domain may deliberately keep a readable minimum scale even when the
  // whole graph cannot fit in a compact viewport. Centering negative overflow
  // hides the beginning of the workflow behind top/left canvas chrome. Anchor
  // overflowing axes to their safe inset instead; the infinite canvas remains
  // pannable toward the remaining content while the first artifacts stay
  // visible and pointer-reachable.
  const horizontalOffset = fittedWidth <= availableWidth ? (availableWidth - fittedWidth) / 2 : 0;
  const verticalOffset = fittedHeight <= availableHeight ? (availableHeight - fittedHeight) / 2 : 0;
  return normalizeCanvasPlatformViewport({
    x: left + horizontalOffset - bounds.left * scale,
    y: top + verticalOffset - bounds.top * scale,
    scale
  }, options);
}

export function rebaseCanvasPlatformViewportForResize(
  viewport: CanvasPlatformViewport,
  previousSize: CanvasPlatformSize,
  nextSize: CanvasPlatformSize,
  options: { minimumScale?: number; maximumScale?: number } = {}
): CanvasPlatformViewport {
  const current = normalizeCanvasPlatformViewport(viewport, options);
  return normalizeCanvasPlatformViewport({
    x: current.x + (finite(nextSize.width, previousSize.width) - finite(previousSize.width, 0)) / 2,
    y: current.y + (finite(nextSize.height, previousSize.height) - finite(previousSize.height, 0)) / 2,
    scale: current.scale
  }, options);
}

export function observeCanvasPlatformResizeRebase(
  element: HTMLElement,
  readViewport: () => CanvasPlatformViewport,
  writeViewport: (viewport: CanvasPlatformViewport) => void,
  blocked: () => boolean = () => false,
  layoutHost: Element | null = null
) {
  type ResizeRebaseDispose = (() => void) & { refresh: () => void };
  let previous: CanvasPlatformSize | undefined;
  let retryTimer = 0;
  let settleFrame = 0;
  let settleTimer = 0;
  const reconcile = (width: number, height: number) => {
    if (width < 1 || height < 1) return;
    const next = { width, height };
    if (!previous) {
      previous = next;
      return;
    }
    if (Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5) return;
    if (blocked()) {
      if (!retryTimer) retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        const rect = element.getBoundingClientRect();
        reconcile(rect.width, rect.height);
      }, 120);
      return;
    }
    const prior = previous;
    previous = next;
    writeViewport(rebaseCanvasPlatformViewportForResize(readViewport(), prior, next));
  };
  const refresh = () => {
    const rect = element.getBoundingClientRect();
    reconcile(rect.width, rect.height);
  };
  const scheduleSettledRefresh = () => {
    window.cancelAnimationFrame(settleFrame);
    window.clearTimeout(settleTimer);
    // A sidebar class mutation can be delivered before Chromium resolves the
    // new grid tracks, especially for a paint-when-hidden Electron window.
    // Measure once after layout and once after hidden-window timers settle;
    // reconcile is idempotent when the dimensions have not changed.
    settleFrame = window.requestAnimationFrame(() => {
      settleFrame = 0;
      refresh();
    });
    settleTimer = window.setTimeout(() => {
      settleTimer = 0;
      refresh();
    }, 140);
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
    const entry = entries.find((candidate) => candidate.target === element);
    reconcile(Number(entry?.contentRect.width || element.clientWidth || 0), Number(entry?.contentRect.height || element.clientHeight || 0));
  });
  const layoutObserver = typeof MutationObserver === "undefined" || !layoutHost ? null : new MutationObserver(() => {
    refresh();
    scheduleSettledRefresh();
  });
  observer?.observe(element);
  if (layoutObserver && layoutHost) {
    layoutObserver.observe(layoutHost, { attributes: true, attributeFilter: ["class", "style"] });
  }
  refresh();
  const dispose = (() => {
    observer?.disconnect();
    layoutObserver?.disconnect();
    window.clearTimeout(retryTimer);
    window.cancelAnimationFrame(settleFrame);
    window.clearTimeout(settleTimer);
  }) as ResizeRebaseDispose;
  dispose.refresh = refresh;
  return dispose;
}

export function canvasPlatformBoundsFromRectangles(rectangles: readonly CanvasPlatformBounds[]) {
  if (!rectangles.length) return undefined;
  return rectangles.slice(1).reduce<CanvasPlatformBounds>((current, next) => ({
    left: Math.min(current.left, next.left),
    top: Math.min(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom)
  }), rectangles[0]);
}
