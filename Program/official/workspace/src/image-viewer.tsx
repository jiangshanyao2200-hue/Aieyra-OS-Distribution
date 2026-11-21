import type { ImageOrigin } from "./image-origin";
import React, { useRef, useState, useEffect } from "react";
import { Copy, Download, ExternalLink, FolderOpen, Maximize2, Minus, Plus } from "./studio-icons";
import { ActionButton, ButtonBase, DialogShell, IconActionButton, SurfaceBody, SurfaceHeader } from "./ui";
import { imageAssetSrc, imageAssetThumbnailSrc, type ImageAsset, type ImageViewerState } from "./core";
import { CompleteImage, useStableEvent } from "./image-render";
const IMAGE_VIEWER_MIN_SCALE = 0.05, IMAGE_VIEWER_MAX_SCALE = 8;
const CLOSE_BUTTON_REASON = "close-button" as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const imageOrientationForSize = (size?: { width: number; height: number } | null) => !size?.width || !size.height ? "unknown" : size.width / size.height >= 1.22 ? "landscape" : size.width / size.height <= .82 ? "portrait" : "square";

export default function ImageViewer({
  viewer,
  setViewer,
  origin,
  locateOrigin,
  close,
  openFolder,
  openSystemViewer,
  copyImage,
  saveAs,
  openAssetMenu,
  reconcileNaturalSize
}: {
  viewer: ImageViewerState;
  origin?: ImageOrigin & { nodeExists: boolean; sourceExists: boolean };
  locateOrigin: (nodeId: string) => void;
  setViewer: React.Dispatch<React.SetStateAction<ImageViewerState | null>>;
  close: () => void;
  openFolder: (asset?: ImageAsset) => void | Promise<void>;
  openSystemViewer: (asset?: ImageAsset) => Promise<{ ok: boolean; error?: string }>;
  copyImage: (asset?: ImageAsset) => Promise<{ ok: boolean; width?: number; height?: number; error?: string }>;
  saveAs: (index: number) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  openAssetMenu: (event: React.MouseEvent, index: number) => void;
  reconcileNaturalSize: (index: number, width: number, height: number) => void;
}) {
  const asset = viewer.assets[viewer.index] ?? viewer.assets[0];
  const src = imageAssetSrc(asset);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const userAdjustedImageRef = useRef(false);
  const actualSizeRef = useRef(false);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [imageView, setImageView] = useState({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);
  const [viewerActionStatus, setViewerActionStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const viewerOrientation = imageOrientationForSize(naturalSize);
  const displayOffset = { x: imageView.x, y: imageView.y };
  if (naturalSize && Math.abs(imageView.scale * pixelRatio - 1) < 0.0001) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) {
      const left = (rect.left + rect.width / 2 + imageView.x) * pixelRatio - naturalSize.width / 2;
      const top = (rect.top + rect.height / 2 + imageView.y) * pixelRatio - naturalSize.height / 2;
      displayOffset.x += (Math.round(left) - left) / pixelRatio;
      displayOffset.y += (Math.round(top) - top) / pixelRatio;
    }
  }

  async function copyCurrentImage() {
    const result = await copyImage(asset);
    setViewerActionStatus(result.ok
      ? { tone: "success", text: "图片已复制，可直接粘贴到聊天窗口。" }
      : { tone: "error", text: result.error || "图片复制失败。" });
  }

  async function openCurrentImageInSystemViewer() {
    const result = await openSystemViewer(asset);
    if (!result.ok) setViewerActionStatus({ tone: "error", text: result.error || "系统图片查看器打开失败。" });
  }

  function setIndex(index: number) {
    const nextIndex = (index + viewer.assets.length) % viewer.assets.length;
    setViewer((current) => (current ? { ...current, index: nextIndex } : current));
  }

  function fitScaleFor(size = naturalSize) {
    const stage = stageRef.current;
    if (!stage || !size?.width || !size.height) return 1;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 1;
    const padding = 26;
    return clamp(
      Math.min((rect.width - padding) / size.width, (rect.height - padding) / size.height, 1 / pixelRatio),
      IMAGE_VIEWER_MIN_SCALE,
      IMAGE_VIEWER_MAX_SCALE
    );
  }

  function fitImage(size = naturalSize, markUser = false) {
    actualSizeRef.current = false;
    if (markUser) userAdjustedImageRef.current = true;
    setImageView({ scale: fitScaleFor(size), x: 0, y: 0 });
  }

  function showActualSize() {
    userAdjustedImageRef.current = true;
    actualSizeRef.current = true;
    setImageView({ scale: 1 / pixelRatio, x: 0, y: 0 });
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    userAdjustedImageRef.current = true;
    actualSizeRef.current = false;
    setImageView((current) => {
      const nextScale = clamp(current.scale * factor, IMAGE_VIEWER_MIN_SCALE, IMAGE_VIEWER_MAX_SCALE);
      if (nextScale === current.scale) return current;

      const rect = stageRef.current?.getBoundingClientRect();
      const pointerX = rect && clientX !== undefined ? clientX - rect.left - rect.width / 2 : 0;
      const pointerY = rect && clientY !== undefined ? clientY - rect.top - rect.height / 2 : 0;
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;

      return {
        scale: nextScale,
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale
      };
    });
  }

  function handleImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const size = {
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1
    };
    setNaturalSize(size);
    reconcileNaturalSize(viewer.index, size.width, size.height);
    window.requestAnimationFrame(() => {
      if (!userAdjustedImageRef.current) fitImage(size);
    });
  }

  const handleViewerWheel = useStableEvent((event: WheelEvent) => {
    event.preventDefault();
    zoomAt(event.deltaY > 0 ? 0.88 : 1.12, event.clientX, event.clientY);
  });

  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    userAdjustedImageRef.current = true;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: imageView.x,
      viewY: imageView.y
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    setImageView((current) => ({
      ...current,
      x: pan.viewX + event.clientX - pan.startX,
      y: pan.viewY + event.clientY - pan.startY
    }));
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
    panRef.current = null;
    setIsPanning(false);
  }

  useEffect(() => {
    setNaturalSize(null);
    setImageView({ scale: 1, x: 0, y: 0 });
    setIsPanning(false);
    panRef.current = null;
    userAdjustedImageRef.current = false;
    actualSizeRef.current = false;
    setViewerActionStatus(null);
  }, [src]);

  useEffect(() => {
    // Windows display scaling, browser zoom and moving between monitors can
    // all change the physical pixel ratio while this viewer stays open.
    const changed = () => setPixelRatio(window.devicePixelRatio || 1);
    const media = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    media.addEventListener("change", changed);
    window.addEventListener("resize", changed);
    if (actualSizeRef.current) setImageView(current => ({ ...current, scale: 1 / pixelRatio }));
    return () => { media.removeEventListener("change", changed); window.removeEventListener("resize", changed); };
  }, [pixelRatio]);

  useEffect(() => {
    if (!viewerActionStatus) return undefined;
    const timer = window.setTimeout(() => setViewerActionStatus(null), 2800);
    return () => window.clearTimeout(timer);
  }, [viewerActionStatus]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const revealCurrent = () => {
      const active = strip.querySelector<HTMLElement>('[aria-current="true"]');
      if (!active) return;
      const item = active.getBoundingClientRect(), viewport = strip.getBoundingClientRect();
      if (item.left < viewport.left + 4) strip.scrollLeft += item.left - viewport.left - 4;
      else if (item.right > viewport.right - 4) strip.scrollLeft += item.right - viewport.right + 4;
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(strip);
    // Ordinary mouse wheels navigate the strip without zooming the large image.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? strip.clientWidth : 1);
    };
    strip.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); strip.removeEventListener("wheel", wheel); };
  }, [viewer.index, viewer.assets.length]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.addEventListener("wheel", handleViewerWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleViewerWheel);
  }, [handleViewerWheel]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !naturalSize) return;
    let frame = 0;
    const refit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!userAdjustedImageRef.current) fitImage(naturalSize);
        else if (actualSizeRef.current) setImageView(current => ({ ...current }));
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refit);
    observer?.observe(stage);
    window.addEventListener("resize", refit);
    refit();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [naturalSize, src, pixelRatio]);

  const handleViewerKey = useStableEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyCurrentImage();
    } else if (event.key === "Escape") event.preventDefault();
    else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt(1.12);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAt(0.88);
    } else if (event.key === "0") {
      event.preventDefault();
      fitImage(undefined, true);
    } else if (event.key === "1") {
      event.preventDefault();
      showActualSize();
    } else if (event.key === "ArrowRight" && viewer.assets.length > 1) {
      event.preventDefault();
      setIndex(viewer.index + 1);
    } else if (event.key === "ArrowLeft" && viewer.assets.length > 1) {
      event.preventDefault();
      setIndex(viewer.index - 1);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleViewerKey);
    return () => window.removeEventListener("keydown", handleViewerKey);
  }, [handleViewerKey]);

  return (
    <DialogShell
      surface="image-viewer"
      ariaLabel="图片查看"
      layerClassName="image-viewer-layer"
      className={`image-viewer image-${viewerOrientation}`}
      onRequestClose={close}
      minimizable
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title={viewer.nodeTitle}
            description={`图片 ${viewer.index + 1}/${viewer.assets.length}${naturalSize ? ` · 原图 ${naturalSize.width} × ${naturalSize.height}` : ""}${naturalSize && asset.requestedWidth && asset.requestedHeight && (asset.requestedWidth !== naturalSize.width || asset.requestedHeight !== naturalSize.height) ? ` · 请求 ${asset.requestedWidth} × ${asset.requestedHeight}，已保留实际尺寸` : ""}`}
            onClose={() => requestClose(CLOSE_BUTTON_REASON)}
            closeLabel="关闭图片查看器"
          >
            <div className="image-viewer-actions" aria-label="图片查看工具">
            <IconActionButton label="缩小图片" onClick={() => zoomAt(0.88)} icon={<Minus size={18} />} />
            <span className="viewer-zoom-label" title="原图像素与屏幕物理像素的比例">{Math.round(imageView.scale * pixelRatio * 100)}%</span>
            <IconActionButton label="放大图片" onClick={() => zoomAt(1.12)} icon={<Plus size={18} />} />
            <IconActionButton label="适配窗口" onClick={() => fitImage(undefined, true)} icon={<Maximize2 size={18} />} />
            <ActionButton variant="ghost" className="actual-size-button" onClick={showActualSize} aria-label="按原始大小查看" title="一个图片像素对应一个屏幕像素">
              1:1
            </ActionButton>
            <IconActionButton label="另存为" onClick={() => void saveAs(viewer.index)} icon={<Download size={18} />} />
            {asset?.path ? (
              <IconActionButton label="复制图片（Ctrl+C）" onClick={() => void copyCurrentImage()} icon={<Copy size={18} />} />
            ) : null}
            {asset?.path ? (
              <IconActionButton label="用系统图片查看器打开" onClick={() => void openCurrentImageInSystemViewer()} icon={<ExternalLink size={18} />} />
            ) : null}
            {asset?.path ? (
              <IconActionButton label="打开图片文件夹" onClick={() => openFolder(asset)} icon={<FolderOpen size={18} />} />
            ) : null}
            </div>
          </SurfaceHeader>
          <SurfaceBody className="image-viewer-body">
            {origin ? <div className="image-viewer-origin" aria-label="图片原始来源">
              <span title={origin.title}>原始容器：{origin.title}{!origin.nodeExists ? "（已移除）" : ""}</span>
              {origin.nodeExists ? <ButtonBase onClick={() => locateOrigin(origin.nodeId)}>定位</ButtonBase> : null}
              {origin.sourceNodeId ? <><span title={origin.sourceTitle}>来源：{origin.sourceTitle}{!origin.sourceExists ? "（已移除）" : ""}</span>{origin.sourceExists ? <ButtonBase onClick={() => locateOrigin(origin.sourceNodeId!)}>定位来源</ButtonBase> : null}</> : null}
            </div> : null}
            {viewerActionStatus ? (
              <span className={`image-viewer-action-status ${viewerActionStatus.tone}`} role="status" aria-live="polite">
                {viewerActionStatus.text}
              </span>
            ) : null}
            <div
              ref={stageRef}
              className={`image-viewer-stage ${isPanning ? "is-panning" : ""}`}
              data-scale={imageView.scale.toFixed(3)}
              data-pixel-ratio={pixelRatio}
              data-offset-x={Math.round(imageView.x)}
              data-offset-y={Math.round(imageView.y)}
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onDoubleClick={() => (Math.abs(imageView.scale * pixelRatio - 1) > 0.02 ? showActualSize() : fitImage(undefined, true))}
              onContextMenu={(event) => {
                openAssetMenu(event, viewer.index);
              }}
            >
              <CompleteImage
                src={src}
                alt={`生成图 ${viewer.index + 1}`}
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  width: naturalSize?.width ? `${naturalSize.width}px` : undefined,
                  height: naturalSize?.height ? `${naturalSize.height}px` : undefined,
                  transform: `translate(-50%, -50%) translate3d(${displayOffset.x}px, ${displayOffset.y}px, 0) scale(${imageView.scale})`
                }}
              />
            </div>
            {viewer.assets.length > 1 ? (
              <div ref={stripRef} className="image-viewer-strip" aria-label="图片列表，可左右滚动">
                {viewer.assets.map((item, index) => (
                  <ButtonBase
                    key={`${item.runId || item.assetUrl || item.url || item.path || "asset"}-${item.index ?? index}-${index}`}
                    className={`ui-choice-row ${index === viewer.index ? "active" : ""}`}
                    type="button"
                    aria-label={`查看图片 ${index + 1}`}
                    aria-current={index === viewer.index ? "true" : undefined}
                    title={`查看图片 ${index + 1}`}
                    onClick={() => setIndex(index)}
                    onContextMenu={(event) => openAssetMenu(event, index)}
                  >
                    <CompleteImage src={imageAssetThumbnailSrc(item)} alt={`生成图 ${index + 1}`} draggable={false} loading="lazy" decoding="async" />
                  </ButtonBase>
                ))}
              </div>
            ) : null}
          </SurfaceBody>
        </>
      )}
    </DialogShell>
  );
}
