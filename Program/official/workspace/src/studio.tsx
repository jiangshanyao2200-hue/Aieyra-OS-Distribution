import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageAsset } from "./core";
import {
  imageAssetSrc,
  imageAssetCanvasSrc,
  studioCall,
  marksCurrent,
  imageMarkSourceIdentity as sourceIdentity,
} from "./core";
import { ActionButton, ButtonBase, DialogShell, Field, InlineNotice, SearchField, SegmentedControl, SegmentButton, SurfaceBody, SurfaceHeader, SurfaceSection } from "./ui";
import RichMarkdownMessage from "./markdown";
import { Search } from "./studio-icons";
import { createSafeHtmlDocument } from "../shared/writing-html.mjs";

export type StudioAuthor = "import" | "user" | "agent";
export type StudioSpan = {
  start: number;
  end: number;
  author: StudioAuthor;
  revision: number;
};
export type StudioDocument = {
  id: string;
  projectId: string;
  title: string;
  format: string;
  revision: number;
  text: string;
  sha256: string;
  spans: StudioSpan[];
  blocks: { id: string; start: number; end: number; text: string }[];
  annotations: {
    id: string;
    start: number;
    end: number;
    quote: string;
    instruction: string;
    author: StudioAuthor;
    status: string;
    anchorChanged?: boolean;
  }[];
  history: {
    revision: number;
    author: StudioAuthor;
    at: string;
    summary: string;
  }[];
  source?: { originalName?: string; warnings?: string[] };
  sheets?: { name: string }[];
  activeSheet?: string;
  changes: {
    id: string;
    author: StudioAuthor;
    before: string;
    after: string;
    revision: number;
  }[];
};
export type StudioResult = {
  ok: boolean;
  document?: StudioDocument;
  documents?: {
    id: string;
    title: string;
    format: string;
    revision: number;
    excerpt: string;
  }[];
  path?: string;
  error?: string;
  canceled?: boolean;
  result?: unknown;
};

function useDocument(projectId: string, id: string) {
  const [document, setDocument] = useState<StudioDocument | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let sequence = 0;
    setDocument(null); setError("");
    const load = () => {
      const request = ++sequence;
      void studioCall({ projectId, id, action: "read" })
        .then((r) => {
          if (live && request === sequence && r.document) {
            setDocument(current => !current || r.document!.revision >= current.revision ? r.document! : current);
            setError("");
          }
        })
        .catch((e) => {
          if (live && request === sequence) setError(String(e.message));
        });
    };
    load();
    const off = window.aieyraMatrix?.onChanged((event) => {
      if (
        event.kind === "documents" &&
        event.projectId === projectId &&
        (!event.id || event.id === id)
      )
        load();
    });
    return () => {
      live = false;
      off?.();
    };
  }, [projectId, id]);
  return { document, setDocument, error, setError };
}
export function StudioDocumentCard({
  projectId,
  id,
  open,
}: {
  projectId: string;
  id: string;
  open: () => void;
}) {
  const { document, error } = useDocument(projectId, id);
  return (
    <div
      className="studio-document-card"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <small>
        {document?.format.toUpperCase() || "文档"} · r
        {document?.revision || "—"}
      </small>
      <pre>{error || document?.text.slice(0, 1200) || "打开文档开始编辑"}</pre>
      <ActionButton onClick={open}>打开编辑</ActionButton>
    </div>
  );
}
export function StudioDocumentsPanel({
  projectId,
  mount,
  close,
}: {
  projectId: string;
  mount: (doc: StudioDocument) => void;
  close: () => void;
}) {
  const [documents, setDocuments] = useState<
      NonNullable<StudioResult["documents"]>
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("新文档"),
    [format, setFormat] = useState("md"),
    [query, setQuery] = useState("");
  const alive = useRef(true), pending = useRef(false), sequence = useRef(0);
  const reload = async () => {
    const request = ++sequence.current;
    const r = await studioCall({ action: "list", projectId });
    if (alive.current && request === sequence.current) setDocuments(r.documents || []);
  };
  useEffect(() => {
    alive.current = true;
    void reload().catch((e) => setError(e.message));
    const off = window.aieyraMatrix?.onChanged((e) => {
      if (e.kind === "documents" && e.projectId === projectId)
        void reload().catch((e) => setError(e.message));
    });
    return () => { alive.current = false; off?.(); };
  }, [projectId]);
  const act = async (action: string) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await studioCall({
        action,
        projectId,
        title,
        format,
        text:
          format === "csv"
            ? "项目,数值\n示例,0"
            : format === "html"
              ? "<article><h1>标题</h1><p>正文</p></article>"
              : "",
      });
      if (r.document && alive.current) mount(r.document);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <DialogShell
      surface="studio-documents"
      ariaLabel="文档与数据"
      className="studio-documents-panel"
      busy={busy}
      onRequestClose={close}
    >
      {({ requestClose }) => (
        <>
          <SurfaceHeader
            title="文档与数据"
            description="写作 · 论文 · 表格 · 演示 · 报表"
            onClose={() => requestClose("close-button")}
          />
          <SurfaceBody>
            <div className="studio-toolbar">
              <input className="ui-control"
                disabled={busy}
                aria-label="文档标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={240}
              />
              <select className="ui-control"
                disabled={busy}
                aria-label="新文档格式"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="md">Markdown / 论文</option>
                <option value="txt">纯文本</option>
                <option value="html">HTML</option>
                <option value="csv">表格 CSV</option>
                <option value="json">JSON 数据</option>
              </select>
              <ActionButton
                disabled={busy || !projectId}
                onClick={() => void act("create")}
              >
                新建文档
              </ActionButton>
              <ActionButton
                disabled={busy || !projectId}
                onClick={() => void act("pick-import")}
              >
                导入文件
              </ActionButton>
            </div>
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            <SearchField label="搜索文档" icon={<Search size={16}/>} inputProps={{placeholder:"搜索文档",value:query,onChange:e=>setQuery(e.target.value)}} />
            <div className="studio-document-list">
              {documents
                .filter((d) =>
                  d.title
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                )
                .map((d) => (
                  <ButtonBase className="ui-choice-row" data-ui-choice-layout="list" disabled={busy}
                    key={d.id}
                    onClick={() =>
                      void studioCall({ action: "read", projectId, id: d.id })
                        .then((r) => r.document && alive.current && mount(r.document))
                        .catch((e) => setError(e.message))
                    }
                  >
                    <strong>{d.title}</strong>
                    <small>
                      {d.format.toUpperCase()} · r{d.revision}
                    </small>
                    <span>{d.excerpt}</span>
                  </ButtonBase>
                ))}
            </div>
            {!documents.length ? (
              <p>
                创建文档或导入TXT、MD、HTML、CSV、JSON、DOCX、XLSX、PPTX、PDF。也可直接让Matrix创建并保存。
              </p>
            ) : null}
          </SurfaceBody>
        </>
      )}
    </DialogShell>
  );
}
function draftSpans(doc: StudioDocument, draft: string): StudioSpan[] {
  if (doc.text === draft) return doc.spans;
  let start = 0,
    end = doc.text.length,
    tail = draft.length;
  while (start < end && start < tail && doc.text[start] === draft[start])
    start++;
  while (end > start && tail > start && doc.text[end - 1] === draft[tail - 1]) {
    end--;
    tail--;
  }
  const delta = tail - end,
    result: StudioSpan[] = [];
  for (const s of doc.spans) {
    if (s.end <= start) result.push(s);
    else if (s.start >= end)
      result.push({ ...s, start: s.start + delta, end: s.end + delta });
    else {
      if (s.start < start) result.push({ ...s, end: start });
      if (s.end > end) result.push({ ...s, start: tail, end: s.end + delta });
    }
  }
  if (tail > start)
    result.push({
      start,
      end: tail,
      author: "user",
      revision: doc.revision + 1,
    });
  const merged: StudioSpan[] = [];
  for (const span of result.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length-1];
    if (previous && previous.end === span.start && previous.author === span.author && previous.revision === span.revision) previous.end = span.end;
    else merged.push({...span});
  }
  return merged;
}
export function StudioDocumentEditor({
  projectId,
  id,
  close,
  send,
}: {
  projectId: string;
  id: string;
  close: () => void;
  send: (text: string) => Promise<void>;
}) {
  const {
    document: remote,
    setDocument,
    error,
    setError,
  } = useDocument(projectId, id);
  const [base, setBase] = useState<StudioDocument | null>(null),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [instruction, setInstruction] = useState(""),
    [preview, setPreview] = useState(false),
    [exportFormat, setExportFormat] = useState("docx"),
    [column, setColumn] = useState(""),
    [analysis, setAnalysis] = useState("summary"),
    [groupBy, setGroupBy] = useState("");
  const input = useRef<HTMLTextAreaElement>(null),
    paint = useRef<HTMLPreElement>(null),
    busyRef = useRef(false),
    [selection, setSelection] = useState({ start: 0, end: 0 });
  const draftKey = `studio-draft:${projectId}:${id}`,
    initialized = useRef(false),
    edits = useRef<
      { start: number; end: number; oldText: string; text: string }[]
    >([]);
  const painted = useRef<{text:string;spans:StudioSpan[]}|null>(null);
  const cachedDraft = useRef<string|null>(null);
  const dirty = Boolean(base && draft !== base.text),
    conflict = Boolean(base && remote && base.revision !== remote.revision);
  useEffect(() => {
    if (!remote) return;
    if (!initialized.current) {
      initialized.current = true;
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
        if (
          saved?.base &&
          saved.base.id === id && saved.base.projectId === projectId &&
          Number.isInteger(saved.base.revision) && Array.isArray(saved.base.spans) &&
          typeof saved.base.text === "string" &&
          typeof saved.text === "string" &&
          Array.isArray(saved.edits) && saved.edits.length <= 20000
        ) {
          let verified = saved.base.text;
          for (const edit of saved.edits) {
            if (!edit || !Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > verified.length || typeof edit.text !== "string" || verified.slice(edit.start,edit.end) !== edit.oldText) throw Error("无效草稿");
            verified=verified.slice(0,edit.start)+edit.text+verified.slice(edit.end);
          }
          if(verified!==saved.text) throw Error("草稿内容不一致");
          setBase(saved.base);
          setDraft(saved.text);
          edits.current = saved.edits;
          if(typeof saved.instruction === "string") setInstruction(saved.instruction);
          if(saved.selection && Number.isInteger(saved.selection.start) && Number.isInteger(saved.selection.end) && saved.selection.start>=0 && saved.selection.end>=saved.selection.start && saved.selection.end<=saved.text.length) setSelection(saved.selection);
          setNotice("已恢复未保存的人工输入，请核对后保存。");
          return;
        }
      } catch {
        setNotice("未保存草稿不可读取，请检查本地存储。");
      }
    }
    if (!dirty && !busyRef.current) {
      setBase(remote);
      setDraft(remote.text);
      edits.current = [];
      painted.current = null;
    }
  }, [remote]);
  useEffect(() => {
    if (!base) return;
    cachedDraft.current = dirty || instruction ? JSON.stringify({ base, text: draft, edits: edits.current, instruction, selection }) : null;
    const timer = window.setTimeout(() => flushDraft(), 180);
    return () => window.clearTimeout(timer);
  }, [draft, base, draftKey, dirty, instruction, selection]);
  const flushDraft = () => {
    // StrictMode probes an empty mount before the remote document arrives.
    // That cleanup must not erase a draft waiting to be restored.
    if (!initialized.current) return;
    try {
      if (cachedDraft.current) localStorage.setItem(draftKey, cachedDraft.current);
      else localStorage.removeItem(draftKey);
    } catch {
      setNotice("草稿本地缓存已满，请立即保存编辑。");
    }
  };
  useEffect(() => {
    const flush = () => flushDraft();
    window.addEventListener("pagehide", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); };
  }, [draftKey]);
  const changeDraft = (next: string) => {
    if (!base || busyRef.current || next === draft) return;
    if (edits.current.length >= 19999) {setNotice("本次编辑记录较多，请先保存后继续。");return;}
    let start = 0,
      end = draft.length,
      tail = next.length;
    while (start < end && start < tail && draft[start] === next[start]) start++;
    while (end > start && tail > start && draft[end - 1] === next[tail - 1]) {
      end--;
      tail--;
    }
    const edit = {
      start,
      end,
      oldText: draft.slice(start, end),
      text: next.slice(start, tail),
    };
    const last = edits.current[edits.current.length-1];
    if (last && !last.oldText && !edit.oldText && edit.start === last.start + last.text.length) last.text += edit.text;
    else edits.current.push(edit);
    painted.current = {text:next,spans:draftSpans({...base,text:draft,spans},next)};
    setDraft(next);
  };
  const run = async (action: Record<string, unknown>) => {
    if (!base || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await studioCall({
        projectId,
        id,
        expectedRevision: base.revision,
        ...action,
      });
      if (result.document?.id === id && result.document.projectId === projectId) {
        edits.current = [];
        painted.current = null;
        cachedDraft.current = null;
        flushDraft();
        setBase(result.document);
        setDocument(current=>current && current.revision>result.document!.revision ? current : result.document!);
        setDraft(result.document.text);
      }
      if (result.path) setNotice(`已导出：${result.path}`);
      if (result.result) setNotice(JSON.stringify(result.result, null, 2));
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = () =>
    dirty && !conflict ? run({
      action: "edit",
      text: draft,
      edits: edits.current,
      summary: "用户直接编辑",
    }) : Promise.resolve(undefined);
  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setNotice("还有未保存的人工编辑。请先保存，或使用“放弃本次输入”。");
      return;
    }
    close();
  };
  const spans = useMemo(() => {
    if (!base) return [];
    if (painted.current?.text === draft) return painted.current.spans;
    let doc = base;
    for (const edit of edits.current) {
      const text =
        doc.text.slice(0, edit.start) + edit.text + doc.text.slice(edit.end);
      doc = { ...doc, text, spans: draftSpans(doc, text) };
    }
    const result = doc.text === draft ? doc.spans : draftSpans(base, draft);
    painted.current = {text:draft,spans:result};
    return result;
  }, [base, draft]);
  const selectedText = draft.slice(selection.start, selection.end);
  const submit = async () => {
    if (dirty || busyRef.current || conflict) {
      setNotice("请先保存人工编辑，再将批注交给 Agent。");
      return;
    }
    await send(
      `请读取 documents.manage action=read projectId=${projectId} id=${id} 的当前版本，优先理解人工(user)修改和open批注。${instruction ? `\n当前指令：${instruction}` : ""}${selectedText ? `\n选区原文：${selectedText}` : ""}\n使用expectedRevision和精确patch完成必要补写或修改，保留其他原文，完成后读回核验并处理对应批注。不要伪造论文引文或数据。`,
    );
  };
  return (
    <DialogShell
      surface="studio-editor"
      ariaLabel="文档编辑器"
      className="studio-editor"
      busy={busy}
      onRequestClose={requestClose}
      closePolicy={{
        escape: "when-idle",
        backdrop: "never",
        "close-button": "when-idle",
      }}
    >
      {({ requestClose: closeSurface }) => (
        <>
          <SurfaceHeader
            title={base?.title || "文档编辑器"}
            description={`${base?.format.toUpperCase() || ""} · r${base?.revision || "—"} · 原文 / 人工 / Matrix来源可追踪`}
            onClose={() => closeSurface("close-button")}
          />
          <SurfaceBody>
            {error ? (
              <InlineNotice tone="danger">
                {error}
              </InlineNotice>
            ) : null}
            {conflict ? (
              <InlineNotice tone="warning">文档已有新修订，当前输入已保留。复制需要的内容后读取最新版再合并。</InlineNotice>
            ) : null}
            <div className="studio-toolbar">
              <ActionButton
                disabled={!dirty || busy || conflict}
                onClick={() => void save()}
              >
                保存编辑
              </ActionButton>
              <ActionButton
                disabled={!dirty || busy}
                onClick={() => {
                  if (remote) {
                    edits.current = [];
                    painted.current = null;
                    cachedDraft.current = null;
                    flushDraft();
                    setBase(remote);
                    setDraft(remote.text);
                    setNotice("");
                  }
                }}
              >
                放弃本次输入
              </ActionButton>
              <ActionButton onClick={() => setPreview(!preview)}>
                {preview ? "编辑正文" : "阅读预览"}
              </ActionButton>
              <select className="ui-control"
                aria-label="导出格式"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
              >
                {[
                  "docx",
                  "pdf",
                  "html",
                  "txt",
                  "md",
                  "csv",
                  "json",
                  "xlsx",
                  "pptx",
                ].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <ActionButton
                disabled={!base || dirty || busy || conflict}
                onClick={() =>
                  void run({ action: "export", format: exportFormat })
                }
              >
                导出
              </ActionButton>
              <span className="studio-origin import">原文</span>
              <span className="studio-origin user">人工修改</span>
              <span className="studio-origin agent">Matrix修改</span>
            </div>
            {base?.source?.warnings?.length ? (
              <details>
                <summary>导入说明 · 原件已保留</summary>
                {base.source.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            ) : null}
            {base?.sheets?.length ? (
              <Field label="工作表">
                <select className="ui-control"
                  aria-label="工作表"
                  disabled={!base || dirty || busy || conflict}
                  value={base.activeSheet || base.sheets[0].name}
                  onChange={(e) =>
                    void run({ action: "sheet", sheet: e.target.value })
                  }
                >
                  {base.sheets.map((s) => (
                    <option key={s.name}>{s.name}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <div className="studio-editor-workspace">
              <div className="studio-editor-main">
                {preview && base?.format === "html" ? (
                  <iframe
                    title="安全HTML预览"
                    sandbox=""
                    srcDoc={createSafeHtmlDocument(draft, base.title)}
                  />
                ) : preview && base?.format === "md" ? (
                  <div className="studio-reading markdown-body">
                    <RichMarkdownMessage content={draft} />
                  </div>
                ) : preview ? (
                  <pre className="studio-reading">
                    {spans.map((s, i) => (
                      <span key={i} className={`studio-origin ${s.author}`}>
                        {draft.slice(s.start, s.end)}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <div className="studio-text-editor">
                    <pre ref={paint} aria-hidden="true">
                      {spans.map((s, i) => (
                        <span key={i} className={`studio-origin ${s.author}`}>
                          {draft.slice(s.start, s.end)}
                        </span>
                      ))}
                      {"\n"}
                    </pre>
                    <textarea disabled={busy || !base}
                      ref={input}
                      aria-label="文档正文"
                      value={draft}
                      spellCheck={false}
                      onChange={(e) => changeDraft(e.target.value)}
                      onSelect={(e) =>
                        setSelection({
                          start: e.currentTarget.selectionStart,
                          end: e.currentTarget.selectionEnd,
                        })
                      }
                      onScroll={(e) => {
                        if (paint.current) {
                          paint.current.scrollTop = e.currentTarget.scrollTop;
                          paint.current.scrollLeft = e.currentTarget.scrollLeft;
                        }
                      }}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                          e.preventDefault();
                          void save();
                        }
                      }}
                    />
                  </div>
                )}
              </div>
              <aside className="studio-editor-aside">
                <strong>选区批注 / 补写要求</strong>
                <small>
                  {selection.end > selection.start
                    ? `选中 ${selection.end - selection.start} 字`
                    : `插入位置 ${selection.start}`}
                </small>
                <textarea className="ui-control" disabled={busy}
                  aria-label="补写或修改说明"
                  placeholder="例如：这里补充研究方法，结合表一解释结果。"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <ActionButton
                  disabled={!base || dirty || busy || conflict || !instruction.trim()}
                  onClick={() =>
                    void run({
                      action: "annotate",
                      start: selection.start,
                      end: selection.end,
                      instruction,
                    }).then((r) => {
                      if (r) setInstruction("");
                    })
                  }
                >
                  保存标记
                </ActionButton>
                <ActionButton
                  disabled={!base || dirty || busy || conflict}
                  onClick={() =>
                    void submit().catch((e) => setError(e.message))
                  }
                >
                  交给 Agent
                </ActionButton>
                {(base?.annotations || []).map((a) => (
                  <SurfaceSection key={a.id} className={`studio-comment ${a.status}`}>
                    <small>
                      {a.author === "user" ? "人工" : a.author === "import" ? "原文" : "画布助手"} · {a.status === "open" ? "待处理" : a.status === "resolved" ? "已处理" : a.status === "dismissed" ? "已忽略" : "状态未知"}
                      {a.anchorChanged ? " · 原文已变化，请复核位置" : ""}
                    </small>
                    <blockquote>{a.quote || "插入点"}</blockquote>
                    <p>{a.instruction}</p>
                    <ActionButton
                      disabled={!base || busy || dirty || conflict || a.status !== "open"}
                      onClick={() =>
                        void run({ action: "annotate", resolveId: a.id })
                      }
                    >
                      已处理
                    </ActionButton>
                    <ActionButton
                      disabled={!base || busy || dirty || conflict}
                      onClick={() =>
                        void run({ action: "annotate", removeId: a.id })
                      }
                    >
                      删除
                    </ActionButton>
                  </SurfaceSection>
                ))}
                <details>
                  <summary>修订历史</summary>
                  {[...(base?.history || [])].reverse().map((v) => (
                    <div key={v.revision}>
                      r{v.revision} · {v.author === "user" ? "人工" : v.author === "import" ? "原文" : "画布助手"}
                      <ActionButton
                        disabled={
                          dirty || busy || conflict || v.revision === base?.revision
                        }
                        onClick={() =>
                          void run({
                            action: "restore",
                            revision: v.revision,
                            summary: `恢复r${v.revision}`,
                          })
                        }
                      >
                        恢复为新修订
                      </ActionButton>
                    </div>
                  ))}
                </details>
              </aside>
            </div>
            {["csv", "tsv", "json"].includes(base?.format || "") ? (
              <details>
                <summary>数据与金融计算</summary>
                <div className="studio-toolbar">
                  <input className="ui-control"
                    aria-label="分析列"
                    placeholder="表头名称或0基列号"
                    value={column}
                    onChange={(e) => setColumn(e.target.value)}
                  />
                  <select className="ui-control" aria-label="计算方式"
                    value={analysis}
                    onChange={(e) => setAnalysis(e.target.value)}
                  >
                    <option value="summary">描述统计</option>
                    <option value="group">分组统计</option>
                    <option value="finance">金融序列</option>
                    <option value="sort">排序</option>
                  </select>
                  {analysis === "group" ? (
                    <input className="ui-control"
                      aria-label="分组列"
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value)}
                      placeholder="分组列"
                    />
                  ) : null}
                  <ActionButton
                    disabled={!base || dirty || busy || conflict || !column}
                    onClick={() =>
                      void run({
                        action: "analyze",
                        operation: analysis,
                        column: /^\d+$/.test(column) ? Number(column) : column,
                        groupBy,
                        periodsPerYear: 1,
                        discountRate: 0,
                      })
                    }
                  >
                    计算
                  </ActionButton>
                </div>
                <small>
                  金融序列默认每年一期、折现率0；自定义频率和每期折现率可由Matrix显式传入。缺失/非数字不静默跳过。
                </small>
              </details>
            ) : null}
            {notice ? (
              <InlineNotice className="studio-notice" role="status">{notice}</InlineNotice>
            ) : null}
          </SurfaceBody>
        </>
      )}
    </DialogShell>
  );
}

export type ImageMark = {
  id: string;
  kind: "pen" | "ellipse" | "rectangle" | "arrow";
  sentiment: "good" | "bad" | "note";
  text: string;
  points: { x: number; y: number }[];
};
export type ImageMarks = {
  version: 1;
  revision: number;
  sourceHash: string;
  sourceIdentity: string;
  marks: ImageMark[];
  updatedAt: string;
};
const markColor = (s: string) => `var(--${s === "good" ? "green" : s === "bad" ? "rose" : "amber"})`;
const markCanvasColor = (s:string) => getComputedStyle(document.documentElement).getPropertyValue(`--${s === "good" ? "green" : s === "bad" ? "rose" : "amber"}`).trim();
export async function renderMarkedImage(asset: ImageAsset, marks: ImageMarks) {
  if (!marksCurrent(asset, marks))
    throw Error("原图身份已变化，请重新建立标记。");
  const image = new Image();
  image.src = await imageAssetCanvasSrc(asset);
  await image.decode();
  const factor = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    ),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const [index, mark] of marks.marks.entries()) {
    if (!mark.points.length) continue;
    const points = mark.points.map((p) => ({
        x: p.x * canvas.width,
        y: p.y * canvas.height,
      })),
      a = points[0],
      b = points[points.length - 1];
    context.strokeStyle = markCanvasColor(mark.sentiment);
    context.fillStyle = context.strokeStyle;
    context.lineWidth = Math.max(2, canvas.width / 500);
    context.beginPath();
    if (mark.kind === "ellipse")
      context.ellipse(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        Math.abs(b.x - a.x) / 2,
        Math.abs(b.y - a.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
    else if (mark.kind === "rectangle")
      context.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    else {
      context.moveTo(a.x, a.y);
      for (const p of points.slice(1)) context.lineTo(p.x, p.y);
    }
    context.stroke();
    if (mark.kind === "arrow") {
      const angle = Math.atan2(b.y - a.y, b.x - a.x),
        size = 15;
      context.beginPath();
      context.moveTo(b.x, b.y);
      context.lineTo(
        b.x - size * Math.cos(angle - 0.45),
        b.y - size * Math.sin(angle - 0.45),
      );
      context.moveTo(b.x, b.y);
      context.lineTo(
        b.x - size * Math.cos(angle + 0.45),
        b.y - size * Math.sin(angle + 0.45),
      );
      context.stroke();
    }
    context.font = "bold 18px sans-serif";
    context.fillText(String(index + 1), Math.max(2, a.x), Math.max(20, a.y));
  }
  return canvas.toDataURL("image/png");
}
export function ImageAnnotationEditor({
  asset,
  value,
  save,
  close,
  send,
}: {
  asset: ImageAsset;
  value?: ImageMarks;
  save: (value: ImageMarks) => Promise<void>;
  close: () => void;
  send: () => Promise<void>;
}) {
  const [marks, setMarks] = useState<ImageMark[]>(
      value && marksCurrent(asset, value) ? value.marks : [],
    ),
    [kind, setKind] = useState<ImageMark["kind"]>("pen"),
    [sentiment, setSentiment] = useState<ImageMark["sentiment"]>("bad"),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(JSON.stringify(value && marksCurrent(asset,value) ? value.marks : []));
  const drawing = useRef<ImageMark | null>(null),
    svg = useRef<SVGSVGElement>(null),
    busyRef = useRef(false), pointerId = useRef<number|null>(null);
  const point = (e: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  };
  const commit = async () => {
    if(busyRef.current || drawing.current)return false;
    busyRef.current=true;
    setBusy(true);
    setError("");
    try {
      await save({
        version: 1,
        revision: (value?.revision || 0) + 1,
        sourceHash: asset.contentHash || "",
        sourceIdentity: sourceIdentity(asset),
        marks,
        updatedAt: new Date().toISOString(),
      });
      setSaved(JSON.stringify(marks));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      busyRef.current=false;
      setBusy(false);
    }
  };
  const requestClose = () => {
    if (busy) return;
    if (JSON.stringify(marks) !== saved) {
      setError("请先保存标记，或撤销未保存修改。");
      return;
    }
    close();
  };
  const shapes = marks.map((m, i) => {
    if (!m.points.length) return null;
    const a = m.points[0],
      b = m.points[m.points.length - 1],
      common = {
        stroke: markColor(m.sentiment),
        fill: "none",
        strokeWidth: 3,
        vectorEffect: "non-scaling-stroke" as const,
      };
    return (
      <g key={m.id}>
        {m.kind === "ellipse" ? (
          <ellipse
            {...common}
            cx={(a.x + b.x) * 500}
            cy={(a.y + b.y) * 500}
            rx={Math.abs(b.x - a.x) * 500}
            ry={Math.abs(b.y - a.y) * 500}
          />
        ) : m.kind === "rectangle" ? (
          <rect
            {...common}
            x={Math.min(a.x, b.x) * 1000}
            y={Math.min(a.y, b.y) * 1000}
            width={Math.abs(a.x - b.x) * 1000}
            height={Math.abs(a.y - b.y) * 1000}
          />
        ) : (
          <polyline
            {...common}
            points={m.points
              .map((p) => `${p.x * 1000},${p.y * 1000}`)
              .join(" ")}
            markerEnd={
              m.kind === "arrow" ? `url(#arrow-${m.sentiment})` : undefined
            }
          />
        )}
        <text
          x={a.x * 1000}
          y={Math.max(22, a.y * 1000)}
          fill={markColor(m.sentiment)}
          fontSize={26}
        >
          {i + 1}
        </text>
      </g>
    );
  });
  return (
    <DialogShell
      surface="image-annotations"
      ariaLabel="图片区域标记"
      className="studio-annotations"
      busy={busy}
      onRequestClose={requestClose}
      closePolicy={{
        escape: "when-idle",
        backdrop: "never",
        "close-button": "when-idle",
      }}
    >
      {({ requestClose: closeSurface }) => (
        <>
          <SurfaceHeader
            title="图片区域标记"
            description="圈出区域、画箭头并说明；原图保持完整"
            onClose={() => closeSurface("close-button")}
          />
          <SurfaceBody>
            <div className="studio-toolbar">
              <SegmentedControl aria-label="标记工具">{(["pen", "ellipse", "rectangle", "arrow"] as const).map(
                (k, i) => (
                  <SegmentButton disabled={busy}
                    key={k}
                    active={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {["画笔", "圈选", "矩形", "箭头"][i]}
                  </SegmentButton>
                ),
              )}</SegmentedControl>
              <select className="ui-control" disabled={busy}
                aria-label="标记含义"
                value={sentiment}
                onChange={(e) =>
                  setSentiment(e.target.value as ImageMark["sentiment"])
                }
              >
                <option value="bad">需要修改</option>
                <option value="good">满意 / 保留</option>
                <option value="note">说明</option>
              </select>
              <ActionButton disabled={busy} onClick={() => void commit()}>
                保存标记
              </ActionButton>
              <ActionButton
                disabled={busy}
                onClick={() => {
                  setMarks(JSON.parse(saved));
                  setError("");
                }}
              >
                撤销未保存修改
              </ActionButton>
              <ActionButton
                disabled={busy}
                onClick={() =>
                  void commit()
                    .then(async (ok) => {
                      if (ok) await send();
                    })
                    .catch((e) => setError(e.message))
                }
              >
                交给 Agent
              </ActionButton>
            </div>
            {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
            <div className="studio-mark-workspace">
              <div className="studio-mark-image">
                <img
                  src={imageAssetSrc(asset)}
                  alt="标记原图"
                  draggable={false}
                />
                <svg
                  ref={svg}
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  aria-label="区域标记画布"
                  onPointerDown={(e) => {
                    if (busyRef.current || drawing.current || e.button!==0 || !e.isPrimary) return;
                    if(marks.length>=100){setError("每张图片最多100条标记，请删除不再需要的标记后继续。");return;}
                    e.preventDefault();
                    pointerId.current=e.pointerId;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const mark: ImageMark = {
                      id: crypto.randomUUID(),
                      kind,
                      sentiment,
                      text: "",
                      points: [point(e)],
                    };
                    drawing.current = mark;
                    setSelected(mark.id);
                    setMarks((v) => [...v, mark]);
                  }}
                  onPointerMove={(e) => {
                    if (!drawing.current || pointerId.current!==e.pointerId) return;
                    const old = drawing.current,
                      p = point(e),
                      next = {
                        ...old,
                        points:
                          old.kind === "pen"
                            ? [...(old.points.length>=1999?old.points.filter((_,i)=>i%2===0):old.points), p]
                            : [old.points[0], p],
                      };
                    drawing.current = next;
                    setMarks((v) =>
                      v.map((m) => (m.id === next.id ? next : m)),
                    );
                  }}
                  onPointerUp={(e) => {
                    if(pointerId.current!==e.pointerId)return;
                    drawing.current = null;
                    pointerId.current=null;
                  }}
                  onPointerCancel={(e) => {
                    if(pointerId.current!==e.pointerId)return;
                    const abandoned=drawing.current?.id;
                    setMarks(v=>v.filter(m=>m.id!==abandoned));
                    drawing.current = null;
                    pointerId.current=null;
                  }}
                >
                  <defs>
                    {["good", "bad", "note"].map((s) => (
                      <marker
                        key={s}
                        id={`arrow-${s}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path
                          d="M 0 0 L 10 5 L 0 10"
                          fill="none"
                          stroke={markColor(s)}
                          strokeWidth="2"
                        />
                      </marker>
                    ))}
                  </defs>
                  {shapes}
                </svg>
              </div>
              <aside>
                {marks.map((m, i) => (
                  <SurfaceSection
                    key={m.id}
                    className={selected === m.id ? "selected" : ""}
                    onClick={() => setSelected(m.id)}
                  >
                    <strong style={{ color: markColor(m.sentiment) }}>
                      {i + 1} ·{" "}
                      {m.sentiment === "good"
                        ? "满意 / 保留"
                        : m.sentiment === "bad"
                          ? "需要修改"
                          : "说明"}
                    </strong>
                    <textarea className="ui-control" disabled={busy}
                      aria-label={`标记 ${i + 1} 说明`}
                      placeholder="描述这里应保留或修改什么"
                      value={m.text}
                      onChange={(e) =>
                        setMarks((v) =>
                          v.map((x) =>
                            x.id === m.id ? { ...x, text: e.target.value } : x,
                          ),
                        )
                      }
                      maxLength={5000}
                    />
                    <Field label="标记含义"><select disabled={busy} aria-label={`标记 ${i+1} 含义`} value={m.sentiment} onChange={e=>setMarks(v=>v.map(x=>x.id===m.id?{...x,sentiment:e.target.value as ImageMark["sentiment"]}:x))}><option value="bad">需要修改</option><option value="good">满意 / 保留</option><option value="note">说明</option></select></Field>
                    <ActionButton variant="danger" disabled={busy}
                      onClick={() =>
                        setMarks((v) => v.filter((x) => x.id !== m.id))
                      }
                    >
                      删除标记
                    </ActionButton>
                  </SurfaceSection>
                ))}
              </aside>
            </div>
          </SurfaceBody>
        </>
      )}
    </DialogShell>
  );
}
