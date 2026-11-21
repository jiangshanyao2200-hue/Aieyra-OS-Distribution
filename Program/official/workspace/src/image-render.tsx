import React, { useRef, useState, useCallback, useLayoutEffect } from "react";
import { RotateCcw } from "./studio-icons";
import { ActionButton } from "./ui";

function imagePaintIdentity(source: string) {
  if (!source.startsWith("iiimage-asset:")) return source;
  try {
    const url = new URL(source);
    url.searchParams.delete("preview");
    url.searchParams.delete("max");
    return url.toString();
  } catch { return source; }
}

export function CompleteImage({ className, onLoad, onError, src, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const source = typeof src === "string" ? src : "";
  const identity = imagePaintIdentity(source);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [painted, setPainted] = useState({ identity, source });
  const paintSource = painted.identity === identity ? painted.source : source;
  const [readyIdentity, setReadyIdentity] = useState("");
  const ready = Boolean(source && readyIdentity === identity);
  const revealWhenDecoded = useCallback((image: HTMLImageElement, expectedSource: string) => {
    const reveal = () => {
      if (imageRef.current === image && sourceRef.current === expectedSource) setReadyIdentity(imagePaintIdentity(expectedSource));
    };
    if (typeof image.decode !== "function") {
      reveal();
      return;
    }
    try {
      void image.decode().then(reveal, reveal);
    } catch {
      reveal();
    }
  }, []);

  // Assigning src clears naturalWidth even when the same img stays mounted.
  // Keep its decoded source until a replacement resolution is in the browser's
  // decoded image cache. A different asset still starts with its own source.
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (paintSource === source) {
      if (painted.identity !== identity) setPainted({ identity, source });
      // Cached assets can finish before React attaches its load listener.
      if (source && image.complete && image.naturalWidth > 0) revealWhenDecoded(image, source);
      return;
    }
    let cancelled = false;
    const replacement = new Image();
    replacement.decoding = "async";
    replacement.onload = () => {
      const commit = () => {
        if (!cancelled && sourceRef.current === source && imageRef.current === image && replacement.naturalWidth > 0) setPainted({ identity, source });
      };
      try { void replacement.decode().then(commit, commit); } catch { commit(); }
    };
    // A failed optional resolution must not erase a usable decoded image.
    replacement.src = source;
    return () => {
      cancelled = true;
      replacement.onload = null;
      replacement.removeAttribute("src");
    };
  }, [identity, painted.identity, paintSource, revealWhenDecoded, source]);

  return (
    <img
      {...props}
      key={identity}
      ref={imageRef}
      src={paintSource}
      className={`${className ? `${className} ` : ""}complete-image-paint${ready ? " is-ready" : ""}`}
      onLoad={(event) => {
        revealWhenDecoded(event.currentTarget, paintSource);
        onLoad?.(event);
      }}
      onError={(event) => {
        setReadyIdentity(identity);
        onError?.(event);
      }}
    />
  );
}

export function useStableEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, []);
}


export function ImageRetryTile({ nodeCode, error, canRetry, onRetry }: {
  nodeCode: string;
  error: string;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const reason = error || "绘图失败，上游未返回具体原因。";
  return <span className="node-image-retry-tile">
    <span className="node-image-error-reason" role="status" title={reason}>{reason}</span>
    {canRetry ? <ActionButton className="node-image-retry" aria-label={`重新绘图 ${nodeCode}`} title={`重新绘图：${reason}`}
      icon={<RotateCcw size={15} aria-hidden="true" />}
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onRetry(); }}>
      重试
    </ActionButton> : null}
  </span>;
}
