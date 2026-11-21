import "./writing-html-preview.css";
import { useLayoutEffect, useMemo, useRef } from "react";
import { createSafeHtmlDocument } from "../shared/writing-html.mjs";
export function WritingHtmlPreview({ text, title, thumbnail = false }: { text: string; title: string; thumbnail?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!thumbnail || !element) return;
    const resize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const pageWidth = Math.max(800, width), scale = width / pageWidth;
      element.style.setProperty("--preview-width", `${pageWidth}px`);
      element.style.setProperty("--preview-height", `${height / scale}px`);
      element.style.setProperty("--preview-scale", String(scale));
    };
    resize(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect; if (size) resize(size.width, size.height); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [thumbnail]);
  const result = useMemo(() => {
    try { return { html: createSafeHtmlDocument(text, title), error: "" }; }
    catch (error) { return { html: "", error: error instanceof Error ? error.message : "HTML 无法预览。" }; }
  }, [text, title]);
  if (result.error) return <p className="writing-editor-error" role="alert">{result.error}</p>;
  const frame = <iframe className={thumbnail ? "writing-html-thumbnail" : "writing-html-preview"} title={`${title} · HTML 预览`} sandbox="" referrerPolicy="no-referrer" srcDoc={result.html} tabIndex={thumbnail ? -1 : 0} />;
  return thumbnail ? <div className="writing-html-thumbnail-viewport" ref={viewport}>{frame}</div> : frame;
}
export default WritingHtmlPreview;
