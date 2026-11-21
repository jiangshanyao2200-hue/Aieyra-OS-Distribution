import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, CheckCheck, ChevronDown, Circle, CircleAlert, Clipboard, Code2, FileCode2, GitBranch, Globe, Image, ListChecks, Loader2, Terminal, Wrench } from "lucide-react";
import type { CodingItem } from "./coding-types";
import { imageAssetThumbnailSrc } from "./core";
import { ButtonBase } from "./ui";
import { isMarkdownFenceClose, parseMarkdownFence, type MarkdownFence } from "./markdown-grammar";
const Markdown = React.lazy(() => import("./markdown").then(module => ({ default: module.AgentMarkdownMessage })));
import { codingItemSummary, displayCommand, shortPath } from "./coding-activity";
export { codingItemSummary } from "./coding-activity";

// Parse stable Markdown blocks once. Only the trailing, incomplete block is
// reparsed on each stream update; fenced code/tables/lists stay intact.
function markdownBlocks(text: string) {
  const lines = text.split("\n"), parts: string[] = []; let block: string[] = [], fence: MarkdownFence | null = null;
  for (const line of lines) {
    if (fence) { if (isMarkdownFenceClose(line, fence)) fence = null; }
    else fence = parseMarkdownFence(line);
    block.push(line);
    if (!line.trim() && !fence) { parts.push(block.join("\n")); block = []; }
  }
  if (block.length) parts.push(block.join("\n"));
  return parts;
}
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <React.Suspense fallback={<p className="coding-stream-fallback">{text}</p>}><Markdown content={text} /></React.Suspense>;
});
function useStreamText(text: string, streaming: boolean) {
  const [shown, setShown] = useState(text), current = useRef(text);
  useEffect(() => {
    if (!streaming || !text.startsWith(current.current) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { current.current = text; setShown(text); return; }
    let timer = 0;
    const frame = () => {
      const remaining = text.length - current.current.length;
      let end = Math.min(text.length, current.current.length + Math.max(12, Math.ceil(remaining / 3), remaining - 360));
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end++;
      current.current = text.slice(0, end); setShown(current.current);
      if (end < text.length) timer = window.setTimeout(frame, 32);
    };
    frame(); return () => clearTimeout(timer);
  }, [text, streaming]);
  return shown;
}
export const StreamingMarkdown = memo(function StreamingMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const shown = useStreamText(text, streaming), blocks = useMemo(() => markdownBlocks(shown), [shown]);
  return <div className={`coding-markdown${streaming ? " is-streaming" : ""}`}>{blocks.map((block, index) => <MarkdownBlock key={index} text={block} />)}{streaming ? <span className="coding-stream-caret" aria-label="正在生成" /> : null}</div>;
});

const iconMap: Record<string, React.ElementType> = { commandExecution: Terminal, fileChange: FileCode2, reasoning: Brain, webSearch: Globe, imageView: Image, imageGeneration: Image, plan: ListChecks, collabAgentToolCall: GitBranch, contextCompaction: Code2 };
const labels: Record<string, string> = { commandExecution: "终端", fileChange: "修改文件", reasoning: "思考", webSearch: "搜索资料", imageView: "查看图片", plan: "执行计划", collabAgentToolCall: "子 Agent", contextCompaction: "整理上下文", mcpToolCall: "工具箱", dynamicToolCall: "工具调用", agentMessage: "进展" };
const statusLabels: Record<string, string> = { inProgress: "执行中", completed: "已完成", failed: "执行失败", declined: "已拒绝", interrupted: "已停止", pendingInit: "准备中", running: "执行中", shutdown: "已结束", errored: "执行失败" };
function matrixReceipt(item: CodingItem): Record<string, any> | undefined {
  const result = item.result as { content?: Array<{ type: string; text?: string }> } | undefined;
  const text = result?.content?.find(part => part.type === "text")?.text;
  if (!text) return;
  try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; } catch { return; }
}
function printable(value: unknown) { return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2); }
function Diff({ item }: { item: CodingItem }) {
  return <div className="coding-diffs">{item.changes?.map(change => {
    const lines = (change.diff || "").split("\n");
    const added = lines.filter(line => line.startsWith("+") && !line.startsWith("+++")).length, removed = lines.filter(line => line.startsWith("-") && !line.startsWith("---")).length;
    return <section className="coding-diff" key={change.path}><header><FileCode2 size={14} /><span title={change.path}>{shortPath(change.path)}</span><small>{change.kind?.type === "add" ? "新建" : change.kind?.type === "delete" ? "删除" : "修改"}</small><b className="is-add">+{change.kind?.type === "add" ? lines.filter(Boolean).length : added}</b><b className="is-remove">−{removed}</b></header><pre>{lines.map((line, index) => <span key={index} className={line.startsWith("@@") ? "is-hunk" : line.startsWith("+") || change.kind?.type === "add" ? "is-add" : line.startsWith("-") ? "is-remove" : ""}><i>{index + 1}</i>{line || " "}</span>)}</pre></section>;
  })}</div>;
}
function MatrixImageBody({ item, onLocate, onCancel }: { item: CodingItem; onLocate?: (projectId: string, nodeId: string) => void; onCancel?: (jobId: string, operation?: "pause" | "resume" | "cancel") => void }) {
  const image = item.image!;
  const input = image.input;
  const prompts = Array.isArray(input.items) && input.items.length ? input.items as Array<{prompt?: string}> : [{ prompt: String(input.prompt || "") }];
  const outputs = image.outputs || [];
  return <div className="matrix-image-detail">
    <p>{image.error || image.summary || "正在准备图片"}</p>
    <div className="matrix-image-meta">{[({generate:"生成",edit:"编辑",replace:"替换",variants:"变体"} as Record<string,string>)[String(input.operation)] || input.operation, input.model, input.ratio, input.resolution, input.count ? `${input.count} 张` : ""].filter(Boolean).map((value, index) => <span key={index}>{String(value)}</span>)}</div>
    {prompts.map((entry, index) => entry.prompt ? <details key={index}><summary>生成提示词{prompts.length > 1 ? ` · ${index + 1}` : ""}</summary><p className="matrix-image-prompt">{entry.prompt}</p></details> : null)}
    {outputs.length ? <div className="matrix-image-results">{outputs.map(output => <button type="button" key={output.nodeId} aria-label={`定位画布成果 ${output.displayCode}`} onClick={() => onLocate?.(image.canvasProjectId, output.nodeId)}>
      <span className="matrix-image-thumbnails">{output.assets.slice(0, 4).map((asset, index) => { const src = imageAssetThumbnailSrc({ type: "file", path: asset.path, assetUrl: asset.assetUrl }, 256); return src ? <img key={index} src={src} alt={`${output.title} ${index + 1}`} loading="lazy" decoding="async" /> : <Image key={index} size={24} />; })}</span>
      <span>@{output.displayCode} · {output.assets.length} 张<small>在画布中查看</small></span>
    </button>)}</div> : null}
    {image.batch ? <div className="matrix-image-meta"><span>{image.batch.continuous ? "持续创作" : `${image.batch.completed}/${image.batch.count} 张`}</span><span>并发 {image.batch.concurrency}</span>{image.batch.count ? <progress aria-label="批量图片进度" max={image.batch.count} value={image.batch.completed} /> : null}</div> : null}
    {onCancel && image.batch && ["running", "pausing", "paused", "interrupted"].includes(image.batch.status) ? <div className="matrix-image-controls">
      {image.batch.status === "running" ? <ButtonBase onClick={() => onCancel(image.id, "pause")}>暂停</ButtonBase> : image.batch.status === "pausing" ? <span>正在保存本批图片…</span> : <ButtonBase disabled={image.batch.unknown > 0} title={image.batch.unknown > 0 ? "请先让 画布助手 核对未知请求的成果" : undefined} onClick={() => onCancel(image.id, "resume")}>继续</ButtonBase>}
      <ButtonBase className="matrix-image-cancel" onClick={() => onCancel(image.id, "cancel")}>停止绘图</ButtonBase>
    </div> : image.status === "running" && onCancel ? <ButtonBase className="matrix-image-cancel" onClick={() => onCancel(image.id)}>停止绘图</ButtonBase> : null}
  </div>;
}
function ToolBody({ item, streaming, onLocate, onCancel }: { item: CodingItem; streaming: boolean; onLocate?: (projectId: string, nodeId: string) => void; onCancel?: (jobId: string, operation?: "pause" | "resume" | "cancel") => void }) {
  if (item.image) return <MatrixImageBody item={item} onLocate={onLocate} onCancel={onCancel} />;
  if (item.delegation) return <div className="coding-child-list"><p>{item.delegation.name} · {item.delegation.model}</p><StreamingMarkdown text={item.delegation.error || item.delegation.result || item.delegation.progress || "副将正在准备任务…"} streaming={streaming} />{item.delegation.review ? <p>{item.delegation.review.verdict === "accepted" ? "母体已核验" : "需要返工"}：{item.delegation.review.evidence}</p> : !streaming ? <p>执行回执已保留，母体可继续核验成果。</p> : null}</div>;
  if (item.type === "fileChange") return <Diff item={item} />;
  if (item.type === "plan") return <ol className="coding-steps">{item.plan?.map((step, i) => <li key={i} className={`is-${step.status}`}>{step.status === "completed" ? <Check size={14} /> : step.status === "inProgress" ? <Loader2 size={14} className="spin" /> : <Circle size={12} />}<span>{step.step}</span></li>)}</ol>;
  if (item.type === "reasoning" || item.type === "agentMessage") return <StreamingMarkdown text={item.text || ""} streaming={streaming} />;
  if (item.type === "commandExecution") return <div className="coding-terminal"><div><Terminal size={13} /><code title={item.command}>{displayCommand(item.command || "")}</code></div>{item.aggregatedOutput ? <pre>{item.aggregatedOutput}</pre> : <p>{streaming ? "命令正在执行，输出将显示在这里。" : "命令已结束。"}</p>}<footer>{item.cwd ? <span title={item.cwd}>{shortPath(item.cwd)}</span> : null}{item.exitCode != null ? <span>退出码 {item.exitCode}</span> : null}</footer></div>;
  if (item.type === "collabAgentToolCall") return <div className="coding-child-list">{Object.entries(item.agentsStates || {}).map(([id, agent]) => <div key={id}><GitBranch size={14} /><span>{statusLabels[agent.status || ""] || agent.status || "处理中"}</span>{agent.message ? <StreamingMarkdown text={agent.message} /> : null}</div>)}</div>;
  if (item.type === "webSearch") {
    const action = item.action as { type?: string; queries?: string[]; url?: string; pattern?: string; results?: Array<{ title: string; url: string; excerpt: string }> } | undefined;
    return <div className="coding-search-detail">{[...new Set([item.query, ...(action?.queries || [])].filter(Boolean))].map(query => <p key={query}><Globe size={12} /> {query}</p>)}{action?.url ? <p>{/^https?:\/\//i.test(action.url) ? <a href={action.url} target="_blank" rel="noreferrer">{action.url}</a> : action.url}</p> : null}{action?.pattern ? <p>定位内容：{action.pattern}</p> : null}{action?.results?.map(result => <article key={result.url}>{/^https?:\/\//i.test(result.url) ? <a href={result.url} target="_blank" rel="noreferrer">{result.title}</a> : <strong>{result.title}</strong>}<p>{result.excerpt}</p></article>)}{item.error ? <p>{printable(item.error)}</p> : null}</div>;
  }
  if (item.type === "imageView") return <p className="coding-path">{item.path}</p>;
  if (item.type === "mcpToolCall" && item.server === "matrix") {
    const receipt = matrixReceipt(item), message = item.error ? printable(item.error) : receipt?.summary || receipt?.message || (streaming ? "正在执行…" : receipt?.ok === false ? "操作未完成，请检查回执。" : item.tool === "open_tool" ? "工具参数与说明已交给 画布助手。" : item.tool === "toolbox" ? "已返回匹配的工具目录。" : "操作回执已返回 画布助手。");
    return <div className="matrix-tool-detail"><p>{message}</p>{item.arguments ? <details><summary>调用参数</summary><pre>{printable(item.arguments)}</pre></details> : null}{item.result ? <details><summary>完整回执</summary><pre>{printable(receipt || item.result)}</pre></details> : null}</div>;
  }
  return <>{item.arguments ? <details><summary>调用参数</summary><pre>{printable(item.arguments)}</pre></details> : null}{item.text || item.aggregatedOutput || item.result ? <pre>{item.text || item.aggregatedOutput || printable(item.result)}</pre> : null}{item.error ? <pre>{printable(item.error)}</pre> : null}{item.type === "contextCompaction" ? <p>后续任务继续使用原生会话中的要求与执行记录。</p> : null}</>;
}

export const TimelineItem = memo(function TimelineItem({ item, onLocate, onCancel }: { item: CodingItem; onLocate?: (projectId: string, nodeId: string) => void; onCancel?: (jobId: string, operation?: "pause" | "resume" | "cancel") => void }) {
  const streaming = item.status === "inProgress", failed = item.status === "failed" || Boolean(item.error) || (item.exitCode != null && item.exitCode !== 0);
  const isUser = item.type === "userMessage", final = item.type === "agentMessage" && item.phase !== "commentary";
  const [expanded, setExpanded] = useState<boolean | null>(null), [copied, setCopied] = useState(false);
  const [completionDwell, setCompletionDwell] = useState(streaming);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (streaming) { setCompletionDwell(true); return; }
    const timer = window.setTimeout(() => setCompletionDwell(false), 2200);
    return () => window.clearTimeout(timer);
  }, [streaming]);
  const Icon = iconMap[item.type] || Wrench;
  const open = expanded ?? (streaming || completionDwell || failed);
  const [collapsed, setCollapsed] = useState(!open);
  useEffect(() => {
    if (open) { setCollapsed(false); return; }
    const timer = window.setTimeout(() => setCollapsed(true), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => { if (detailRef.current) detailRef.current.inert = !open; }, [open]);
  const durable = item.type === "fileChange" || item.type === "plan" || item.type === "imageGeneration";
  const stopped = item.status === "interrupted" || item.status === "declined";
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!streaming) return; const started = item.startedAt || Date.now(); const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => clearInterval(timer); }, [streaming, item.id, item.startedAt]);
  async function copy() { try { await navigator.clipboard.writeText(item.text || ""); setCopied(true); } catch { setCopied(false); } }
  return <article className={`coding-event ${isUser ? "is-user" : final ? "is-result" : durable ? "is-change" : "is-process"}${streaming ? " is-active" : ""}${failed ? " is-failed" : ""}`} data-coding-item={item.type} data-retention={isUser || final ? "keep" : durable || failed ? "receipt" : "fold"}>
    <span className="coding-event-node" aria-hidden="true">{isUser ? <Circle size={10} /> : final ? failed ? <CircleAlert size={13} /> : stopped ? <Circle size={13} /> : streaming ? <Loader2 size={13} className="spin" /> : <CheckCheck size={13} /> : <Icon size={13} />}</span>
    {isUser || final ? <><header className="coding-event-heading"><span>{isUser ? "任务" : failed ? `输出失败${item.text ? " · 部分回复" : ""}` : stopped ? `已停止${item.text ? " · 部分回复" : ""}` : streaming ? "正在输出" : "结果"}</span>{!isUser && item.text ? <ButtonBase aria-label="复制正文" title="复制正文" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Clipboard size={13} />}</ButtonBase> : null}</header><StreamingMarkdown text={item.text || ""} streaming={streaming} /></> : <>
      <button type="button" className="coding-event-toggle" aria-expanded={open} onClick={() => setExpanded(!open)}><strong>{item.image ? "图片创作" : item.type === "reasoning" ? "思考摘要" : labels[item.type] || item.tool || "工具调用"}</strong>{!open && collapsed ? <span className="coding-event-summary">{codingItemSummary(item)}</span> : <span className="coding-event-spacer" />}<small>{failed ? <CircleAlert size={12} /> : streaming ? <Loader2 size={12} className="spin" /> : stopped ? <Circle size={12} /> : <Check size={12} />}{failed ? "需要处理" : item.image?.status === "saving" ? "保存中" : statusLabels[item.status || "completed"] || "已完成"}{streaming ? ` · ${elapsed}s` : item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ""}</small><ChevronDown size={13} className={open ? "is-open" : ""} /></button>
      <div ref={detailRef} className={`coding-event-reveal${open ? " is-open" : ""}`} aria-hidden={!open}><div><div className="coding-event-detail">{item.type === "reasoning" ? <small>模型提供的思考摘要</small> : null}<ToolBody item={item} streaming={streaming} onLocate={onLocate} onCancel={onCancel} />{item.truncated ? <small>这里显示部分内容，完整执行记录保存在原生会话中。</small> : null}</div></div></div>
    </>}
  </article>;
});
