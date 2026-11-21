import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./image-mention-preview.css";

type MentionImage = { id: string; code: string; nodeCode: string; name: string; previewSrc: string; width?: number; height?: number };
type Point = { x: number; y: number };
type Hit = { code: string; rects: DOMRect[]; anchor: DOMRect };
const inside = (point: Point, rect: DOMRect) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
const tokens = (text: string) => text.matchAll(/@([A-Za-z][A-Za-z0-9_-]{0,31})(?![A-Za-z0-9_-])/g);

// Textareas do not expose glyph ranges. Measure at most once per animation frame,
// matching wrapping, scroll and canvas transforms without touching
// focus, selection or the editable value.
function inputHit(input: HTMLTextAreaElement | HTMLInputElement, point: Point): Hit | null {
  if (!input.value.includes("@")) return null;
  const box = input.getBoundingClientRect();
  if (!inside(point, box)) return null;
  const style = getComputedStyle(input), mirror = document.createElement("div");
  for (const key of ["box-sizing", "width", "height", "font-family", "font-size", "font-weight", "font-style", "font-variant", "line-height", "letter-spacing", "word-spacing", "text-align", "text-indent", "text-transform", "direction", "tab-size", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style", "word-break", "overflow-wrap"])
    mirror.style.setProperty(key, style.getPropertyValue(key));
  const outerSize = (axis: "width" | "height") => parseFloat(style[axis]) + (style.boxSizing === "border-box" ? 0 : axis === "width"
    ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
    : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth));
  Object.assign(mirror.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, margin: "0", visibility: "hidden", pointerEvents: "none", transformOrigin: "top left",
    transform: `scale(${box.width / outerSize("width")},${box.height / outerSize("height")})`,
    whiteSpace: input instanceof HTMLInputElement || input.wrap === "off" ? "pre" : "pre-wrap", overflow: "auto" });
  mirror.setAttribute("aria-hidden", "true");
  const spans: Array<{ code: string; span: HTMLSpanElement }> = [];
  let end = 0;
  for (const match of tokens(input.value)) {
    mirror.append(document.createTextNode(input.value.slice(end, match.index)));
    const span = document.createElement("span"); span.textContent = match[0]; mirror.append(span);
    spans.push({ code: match[1], span }); end = match.index + match[0].length;
  }
  mirror.append(document.createTextNode(input.value.slice(end) + "\u200b"));
  document.body.append(mirror);
  try {
    mirror.scrollTop = input.scrollTop; mirror.scrollLeft = input.scrollLeft;
    for (const { code, span } of spans) {
      const rects = Array.from(span.getClientRects());
      const anchor = rects.find(rect => inside(point, rect));
      if (anchor) return { code, rects, anchor };
    }
  } finally { mirror.remove(); }
  return null;
}

function textHit(target: Element, point: Point): Hit | null {
  const direct = target.closest<HTMLElement>("[data-image-mention]");
  if (direct) {
    const anchor = direct.getBoundingClientRect();
    return inside(point, anchor) ? { code: direct.dataset.imageMention!.replace(/^@/, ""), rects: [anchor], anchor } : null;
  }
  const caret = document.caretRangeFromPoint(point.x, point.y);
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const parent = caret.startContainer.parentElement;
  if (!parent) return null;
  const text = parent.textContent || "";
  if (!text.includes("@")) return null;
  const nodes: Text[] = [], walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = caret.startOffset;
  for (const node of nodes) { if (node === caret.startContainer) break; offset += node.length; }
  const match = [...tokens(text)].find(token => offset >= token.index && offset <= token.index + token[0].length);
  if (!match) return null;
  const range = document.createRange();
  let cursor = 0;
  for (const node of nodes) {
    if (match.index >= cursor && match.index < cursor + node.length) range.setStart(node, match.index - cursor);
    const end = match.index + match[0].length;
    if (end > cursor && end <= cursor + node.length) { range.setEnd(node, end - cursor); break; }
    cursor += node.length;
  }
  const rects = Array.from(range.getClientRects()), anchor = rects.find(rect => inside(point, rect));
  return anchor ? { code: match[1], rects, anchor } : null;
}

function PreviewImage({ image, immediateSrc }: { image: MentionImage; immediateSrc?: string }) {
  const [failed, setFailed] = useState(false), [ready, setReady] = useState(false), [baseFailed, setBaseFailed] = useState(false);
  const src = useMemo(() => {
    if (!image.previewSrc.startsWith("iiimage-asset:")) return image.previewSrc;
    const url = new URL(image.previewSrc); url.searchParams.set("max", "768"); return url.toString();
  }, [image.previewSrc]);
  return <span className="image-mention-preview-image">
    {baseFailed && failed ? <span className="image-mention-preview-error">图片暂不可用</span> :
      <img src={baseFailed ? src : immediateSrc || image.previewSrc} alt={image.name || `@${image.code}`} decoding="async" onError={() => setBaseFailed(true)} />}
    {!failed && <img className={`image-mention-preview-detail${ready ? " is-ready" : ""}`} src={src} alt="" decoding="async"
      onLoad={() => setReady(true)} onError={() => setFailed(true)} />}
  </span>;
}

export default function ImageMentionPreview({ images }: { images: MentionImage[] }) {
  const [preview, setPreview] = useState<{ hit: Hit; images: MentionImage[]; immediateSrc?: string } | null>(null);
  const lookup = useMemo(() => {
    const assets = new Map<string, MentionImage[]>(), nodes = new Map<string, MentionImage[]>();
    for (const image of images) {
      const code = image.code.toLowerCase(), node = image.nodeCode.toLowerCase();
      if (!assets.has(code)) assets.set(code, []);
      if (!nodes.has(node)) nodes.set(node, []);
      assets.get(code)!.push(image);
      nodes.get(node)!.push(image);
    }
    return { assets, nodes };
  }, [images]);
  useEffect(() => {
    if (!images.length) return;
    let frame = 0, active: Hit | null = null, source: Element | null = null;
    let pending: { target: Element; point: Point } | null = null;
    const hide = () => { cancelAnimationFrame(frame); frame = 0; pending = null; if (active) setPreview(null); active = null; source = null; };
    const show = (target: Element, point: Point) => {
      frame = 0;
      if (!target.isConnected || document.hidden) return;
      const tile = target.closest<HTMLElement>("[data-image-hover-code]");
      const rect = tile?.getBoundingClientRect();
      const hit = tile && rect ? { code: tile.dataset.imageHoverCode!, rects: [rect], anchor: rect } : target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? inputHit(target, point) : textHit(target, point);
      if (!hit) { hide(); return; }
      const exact = lookup.assets.get(hit.code.toLowerCase());
      const matched = exact ? exact.length === 1 ? exact : [] : lookup.nodes.get(hit.code.toLowerCase());
      if (!matched?.length) { hide(); return; }
      const thumb = (tile || document.querySelector(`[data-image-code="${CSS.escape(matched[0].code)}"]`))?.querySelector<HTMLImageElement>("img");
      const immediateSrc = thumb?.complete && thumb.naturalWidth > 0 ? thumb.currentSrc : undefined;
      active = hit; source = target; setPreview({ hit, images: matched, immediateSrc });
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons) { hide(); return; }
      const rawTarget = event.target;
      const target = rawTarget instanceof Element ? rawTarget.closest("[data-image-hover-code]") || rawTarget : rawTarget;
      if (!(target instanceof Element)) { hide(); return; }
      const point = { x: event.clientX, y: event.clientY };
      if (active && target === source && active.rects.some(rect => inside(point, rect))) return;
      const input = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ["text", "search"].includes(target.type));
      // Do not walk entire canvas/message subtrees on every pointer move.
      const hasText = input ? (target as HTMLTextAreaElement).value.includes("@")
        : Array.from(target.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("@"));
      if (!hasText && !target.closest("[data-image-mention], [data-image-hover-code]")) { hide(); return; }
      if (target.closest("[data-image-mention], [data-image-hover-code]")) { cancelAnimationFrame(frame); frame = 0; show(target, point); return; }
      pending = { target, point };
      if (!frame) frame = requestAnimationFrame(() => { const next = pending; frame = 0; if (next) show(next.target, next.point); });
    };
    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches("[data-image-mention]")) return;
      hide(); const rect = target.getBoundingClientRect();
      show(target, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("focusin", focus);
    const closeEvents = ["pointerdown", "scroll", "wheel", "input", "keydown", "focusout", "visibilitychange"] as const;
    closeEvents.forEach(name => document.addEventListener(name, hide, true));
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    document.addEventListener("pointerout", leave);
    window.addEventListener("resize", hide); window.addEventListener("blur", hide);
    return () => {
      hide(); document.removeEventListener("pointerout", leave); document.removeEventListener("pointermove", move); document.removeEventListener("focusin", focus);
      closeEvents.forEach(name => document.removeEventListener(name, hide, true));
      window.removeEventListener("resize", hide); window.removeEventListener("blur", hide);
    };
  }, [images, lookup]);
  if (!preview) return null;
  const image = preview.images[0], multiple = preview.images.length > 1;
  const ratio = multiple ? 1.5 : image.width && image.height ? image.width / image.height : 1;
  const maxWidth = Math.max(80, Math.min(420, window.innerWidth - 24)), maxHeight = Math.max(60, Math.min(380, window.innerHeight - 70));
  const width = Math.min(maxWidth, maxHeight * ratio), height = width / ratio;
  const cardWidth = Math.max(Math.min(160, maxWidth), width) + 12, cardHeight = height + 44;
  const anchor = preview.hit.anchor;
  const left = Math.max(6, Math.min(window.innerWidth - cardWidth - 6, anchor.right + cardWidth + 16 <= window.innerWidth ? anchor.right + 12 : anchor.left - cardWidth - 12));
  const top = Math.max(6, Math.min(window.innerHeight - cardHeight - 6, anchor.top));
  return createPortal(<div className="image-mention-preview" role="tooltip" aria-label={`图片引用预览 @${preview.hit.code}`} style={{ left, top, width: cardWidth }}>
    <div className="image-mention-preview-media" data-multiple={multiple || undefined} style={{ height }}>
      {preview.images.slice(0, 6).map(image => <PreviewImage key={`${image.id}:${image.previewSrc}`} image={image} immediateSrc={preview.images.length === 1 ? preview.immediateSrc : undefined} />)}
    </div>
    <div className="image-mention-preview-caption"><strong>@{preview.hit.code}</strong><span>{multiple ? `${preview.images.length} 张图片${preview.images.length > 6 ? " · 预览前 6 张" : ""}` : image.name}</span></div>
  </div>, document.body);
}
