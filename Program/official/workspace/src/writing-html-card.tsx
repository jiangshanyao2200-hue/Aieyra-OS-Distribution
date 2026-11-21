import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { WritingArtifactRecord } from "./writing-schema";
const Preview = lazy(() => import("./writing-html-preview"));
export function WritingHtmlCard({ artifact }: { artifact: WritingArtifactRecord }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => { const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting)); if (host.current) observer.observe(host.current); return () => observer.disconnect(); }, []);
  return <div ref={host} className="writing-html-card" aria-hidden="true"><Suspense fallback={<span>HTML</span>}>{visible ? <Preview thumbnail title={artifact.title} text={artifact.paragraphs.map(p => p.text).join("\n\n")} /> : null}</Suspense></div>;
}
