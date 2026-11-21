import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Maximize2, Minus, Plus } from "./studio-icons";
import { ButtonBase } from "./ui";
import type {
  ArtifactWorkflowCommit,
  ArtifactWorkflowLayout,
  ArtifactWorkflowViewport
} from "./artifact-workflow-canvas-model";
import "./canvas-platform.css";

type CanvasPlatformFooterProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  meta?: string;
  scale: number;
  onZoomOut: () => void;
  onFitAll: () => void;
  onZoomIn: () => void;
};

type CanvasPlatformEmptyStateProps = {
  title: string;
  description: string;
  primaryLabel?: string;
  primaryIcon?: ReactNode;
  onPrimary?: () => void;
  secondaryLabel?: string;
  secondaryIcon?: ReactNode;
  onSecondary?: () => void;
  ariaLabel?: string;
};

/** Debounced durable commit shared by Writing and development-only Lineage. */
export function useArtifactWorkflowCommit(
  projectId: string,
  onCommit: (projectId: string, layout: ArtifactWorkflowLayout[], viewport: ArtifactWorkflowViewport) => void | Promise<void>
) {
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<ArtifactWorkflowCommit | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    timerRef.current = null;
    pendingRef.current = null;
    if (pending) void Promise.resolve(onCommitRef.current(projectId, pending.layout, pending.viewport)).catch(() => undefined);
  }, [projectId]);

  return useCallback((commit: ArtifactWorkflowCommit) => {
    pendingRef.current = commit;
    const flush = () => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) void Promise.resolve(onCommitRef.current(projectId, pending.layout, pending.viewport)).catch(() => undefined);
    };
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (commit.reason === "zoom") timerRef.current = window.setTimeout(flush, 280);
    else flush();
  }, [projectId]);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * The single decorative backdrop used by every infinite canvas. It is pointer
 * reactive, bounded by the real canvas element, idle when the pointer leaves,
 * and completely disabled for reduced-motion users.
 */
export function CanvasPlatformBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const particleCanvas = canvasRef.current;
    const host = particleCanvas?.parentElement;
    if (!host || !particleCanvas) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reducedMotion?.matches) return;

    const context = particleCanvas.getContext("2d", { alpha: true });
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    type ParticlePoint = {
      x: number;
      y: number;
      radius: number;
      alpha: number;
      tone: number;
    };

    let disposed = false;
    let frame = 0;
    let fallbackTimer = 0;
    let resizeFrame = 0;
    let width = 1;
    let height = 1;
    let renderScale = 1;
    let stableFrames = 0;
    let pendingResize = { width: 1, height: 1 };
    let hostRect: Pick<DOMRect, "left" | "top" | "width" | "height"> = { left: 0, top: 0, width: 1, height: 1 };
    let points: ParticlePoint[] = [];
    const pointer = {
      x: width / 2,
      y: height / 2,
      targetX: width / 2,
      targetY: height / 2,
      force: 0,
      targetForce: 0,
      inside: false
    };

    const noise = (seed: number) => {
      const value = Math.sin(seed * 12.9898) * 43758.5453;
      return value - Math.floor(value);
    };

    const rebuildPoints = () => {
      const targetCount = clamp(Math.round((width * height) / 5600), 96, 260);
      const spacing = Math.max(36, Math.sqrt((width * height) / targetCount));
      const columns = Math.ceil(width / spacing) + 2;
      const rows = Math.ceil(height / spacing) + 2;
      const next: ParticlePoint[] = [];

      for (let row = -1; row < rows; row += 1) {
        for (let column = -1; column < columns; column += 1) {
          const seed = row * 97 + column * 31 + 17;
          next.push({
            x: (column + 0.5) * spacing + (noise(seed) - 0.5) * spacing * 0.44,
            y: (row + 0.5) * spacing + (noise(seed + 11) - 0.5) * spacing * 0.44,
            radius: 0.9 + noise(seed + 23) * 1.38,
            alpha: 0.24 + noise(seed + 41) * 0.28,
            tone: noise(seed + 59)
          });
        }
      }
      points = next;
    };

    const resize = (nextWidth: number, nextHeight: number) => {
      const measuredWidth = Math.max(1, Math.round(nextWidth));
      const measuredHeight = Math.max(1, Math.round(nextHeight));
      const measuredRenderScale = Math.min(window.devicePixelRatio || 1, 1.1);
      const backingWidth = Math.round(measuredWidth * measuredRenderScale);
      const backingHeight = Math.round(measuredHeight * measuredRenderScale);
      if (
        width === measuredWidth &&
        height === measuredHeight &&
        renderScale === measuredRenderScale &&
        particleCanvas.width === backingWidth &&
        particleCanvas.height === backingHeight
      ) return;

      width = measuredWidth;
      height = measuredHeight;
      renderScale = measuredRenderScale;
      particleCanvas.width = backingWidth;
      particleCanvas.height = backingHeight;
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      pointer.x = clamp(pointer.x, 0, width);
      pointer.y = clamp(pointer.y, 0, height);
      pointer.targetX = clamp(pointer.targetX, 0, width);
      pointer.targetY = clamp(pointer.targetY, 0, height);
      rebuildPoints();
    };

    const schedule = () => {
      if (disposed || frame || fallbackTimer) return;
      frame = window.requestAnimationFrame(() => {
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        fallbackTimer = 0;
        frame = 0;
        draw();
      });
      fallbackTimer = window.setTimeout(() => {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        fallbackTimer = 0;
        draw();
      }, 140);
    };

    function draw() {
      if (disposed || document.visibilityState === "hidden") return;
      pointer.x += (pointer.targetX - pointer.x) * 0.22;
      pointer.y += (pointer.targetY - pointer.y) * 0.22;
      pointer.force += (pointer.targetForce - pointer.force) * (pointer.inside ? 0.18 : 0.34);
      ctx.clearRect(0, 0, width, height);

      const force = pointer.force;
      if (force > 0.008) {
        const avoidRadius = clamp(Math.min(width, height) * 0.24, 145, 235);
        const visibleRadius = avoidRadius * 1.86;
        const avoidRadiusSq = avoidRadius * avoidRadius;
        const visibleRadiusSq = visibleRadius * visibleRadius;
        ctx.globalCompositeOperation = "lighter";

        for (const point of points) {
          const dx = point.x - pointer.x;
          const dy = point.y - pointer.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > visibleRadiusSq) continue;
          const distance = Math.max(0.001, Math.sqrt(distanceSq));
          const visibleFalloff = Math.max(0, 1 - distance / visibleRadius);
          const avoidFalloff = distanceSq < avoidRadiusSq ? Math.pow(1 - distance / avoidRadius, 2) : 0;
          const push = avoidFalloff * avoidRadius * 0.44 * force;
          const px = point.x + (dx / distance) * push;
          const py = point.y + (dy / distance) * push;
          const cursorVoid = Math.max(0.18, 1 - avoidFalloff * 0.84);
          const alpha = point.alpha * force * Math.pow(visibleFalloff, 0.52) * cursorVoid;
          if (alpha <= 0.004) continue;
          ctx.beginPath();
          ctx.fillStyle = point.tone > 0.58
            ? `rgba(126, 164, 255, ${alpha})`
            : `rgba(118, 238, 218, ${alpha})`;
          ctx.arc(px, py, point.radius * (1 + avoidFalloff * 0.82), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      const settled =
        Math.abs(pointer.x - pointer.targetX) < 0.18 &&
        Math.abs(pointer.y - pointer.targetY) < 0.18 &&
        Math.abs(pointer.force - pointer.targetForce) < 0.006;
      stableFrames = settled ? stableFrames + 1 : 0;
      if (!pointer.inside && pointer.force < 0.01) {
        pointer.force = 0;
        pointer.targetForce = 0;
        ctx.clearRect(0, 0, width, height);
        return;
      }
      if (stableFrames < 18 || (!pointer.inside && pointer.force > 0.01)) schedule();
    }

    const movePointer = (event: PointerEvent) => {
      if (event.buttons) {
        // Decorative pointer particles yield to canvas/node gestures.
        if (frame) window.cancelAnimationFrame(frame);
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        frame = 0; fallbackTimer = 0;
        if (pointer.force) ctx.clearRect(0, 0, width, height);
        pointer.force = 0; pointer.targetForce = 0; pointer.inside = false;
        return;
      }
      pointer.targetX = clamp(event.clientX - hostRect.left, 0, width);
      pointer.targetY = clamp(event.clientY - hostRect.top, 0, height);
      pointer.inside = true;
      pointer.targetForce = 1;
      stableFrames = 0;
      schedule();
    };
    const enterPointer = () => { hostRect = host.getBoundingClientRect(); };
    const leavePointer = () => {
      pointer.inside = false;
      pointer.targetForce = 0;
      stableFrames = 0;
      schedule();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") {
        hostRect = host.getBoundingClientRect();
        return;
      }
      pointer.inside = false;
      pointer.force = 0;
      pointer.targetForce = 0;
      stableFrames = 0;
      if (frame) window.cancelAnimationFrame(frame);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      frame = 0;
      fallbackTimer = 0;
      ctx.clearRect(0, 0, width, height);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) pendingResize = { width: rect.width, height: rect.height };
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        resize(pendingResize.width, pendingResize.height);
        schedule();
      });
    });
    hostRect = host.getBoundingClientRect();
    resizeObserver.observe(host);
    host.addEventListener("pointerenter", enterPointer, { passive: true });
    host.addEventListener("pointermove", movePointer, { passive: true });
    host.addEventListener("pointerleave", leavePointer);
    window.addEventListener("blur", leavePointer);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      resizeObserver.disconnect();
      host.removeEventListener("pointerenter", enterPointer);
      host.removeEventListener("pointermove", movePointer);
      host.removeEventListener("pointerleave", leavePointer);
      window.removeEventListener("blur", leavePointer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      ctx.clearRect(0, 0, width, height);
    };
  }, []);

  return <canvas ref={canvasRef} className="canvas-particle-field" data-canvas-platform-backdrop="true" aria-hidden="true" />;
}

/** One status and viewport control bar for Image and every artifact canvas. */
export function CanvasPlatformFooter({
  leading,
  trailing,
  meta,
  scale,
  onZoomOut,
  onFitAll,
  onZoomIn
}: CanvasPlatformFooterProps) {
  return (
    <footer className="canvas-footer canvas-platform-footer" data-canvas-platform-footer="true">
      <div className="canvas-footer-leading" data-canvas-taskbar-slot="true">{leading}</div>
      <div className="canvas-footer-controls">
        {meta ? <span className="canvas-counts" data-workflow-status="true" aria-label="画布信息">{meta}</span> : null}
        <div className="canvas-tools" aria-label="画布缩放" data-workflow-controls="true">
          <ButtonBase type="button" onClick={onZoomOut} aria-label="缩小画布"><Minus size={14} /></ButtonBase>
          <ButtonBase className="zoom-button" type="button" onClick={onFitAll} data-workflow-fit="all" aria-label="适配全部成果" title="适配全部成果">
            <Maximize2 size={14} />
            {Math.round(scale * 100)}%
          </ButtonBase>
          <ButtonBase type="button" onClick={onZoomIn} aria-label="放大画布"><Plus size={14} /></ButtonBase>
        </div>
      </div>
      {trailing ? <div className="canvas-footer-trailing">{trailing}</div> : null}
    </footer>
  );
}

/** Shared AI-first blank canvas language; domains only supply nouns/actions. */
export function CanvasPlatformEmptyState({
  title,
  description,
  primaryLabel,
  primaryIcon,
  onPrimary,
  secondaryLabel,
  secondaryIcon,
  onSecondary,
  ariaLabel = "空白画布入口"
}: CanvasPlatformEmptyStateProps) {
  return (
    <section className="canvas-empty-workspace" data-canvas-platform-empty="true" data-workflow-empty="true" aria-label={ariaLabel}>
      <div className="canvas-empty-workspace-card">
        <div className="canvas-empty-workspace-copy">
          <h2>{title}</h2>
          <span>{description}</span>
        </div>
        {primaryLabel && onPrimary ? (
          <div className="canvas-empty-workspace-actions">
            <ButtonBase type="button" className="canvas-empty-workspace-primary" onClick={onPrimary}>{primaryIcon}{primaryLabel}</ButtonBase>
            {secondaryLabel && onSecondary ? <ButtonBase type="button" className="canvas-empty-workspace-secondary" onClick={onSecondary}>{secondaryIcon}{secondaryLabel}</ButtonBase> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
