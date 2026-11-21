import { useEffect, useRef, useState } from "react";
import type { WritingArtifactRecord } from "./writing-schema";

// Fetch only visible cards. Keep a small cache across canvas pan/zoom and projects.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
export function WritingOfficePreview({ projectId, artifact }: { projectId: string; artifact: WritingArtifactRecord }) {
  const host = useRef<HTMLDivElement>(null);
  const key = `${projectId}:${artifact.id}:${artifact.provenance.office?.previewSha256}`;
  const [source, setSource] = useState(cache.get(key) || "");
  useEffect(() => {
    setSource(cache.get(key) || "");
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const found = cache.get(key);
      if (found) { setSource(found); return; }
      let request = pending.get(key);
      if (!request) {
        request = Promise.resolve(window.aieyraWriting?.officePreview({ projectId, artifactId: artifact.id })).then((result) => {
          if (!result?.ok || !result.url) return "";
          if (cache.size >= 48) cache.delete(cache.keys().next().value!);
          cache.set(key, result.url); return result.url;
        }).catch(() => "").finally(() => pending.delete(key));
        pending.set(key, request);
      }
      void request.then((url) => { if (active) setSource(url); });
    }, { rootMargin: "200px" });
    if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); };
  }, [key, projectId, artifact.id]);
  return <div className="writing-office-preview" ref={host}>{source ? <img src={source} alt={`${artifact.title}首页预览`} draggable={false} /> : <span>{artifact.paragraphs.slice(0, 3).map((p) => p.text.slice(0, 180)).join("\n").slice(0, 200) || "文档预览"}</span>}</div>;
}
