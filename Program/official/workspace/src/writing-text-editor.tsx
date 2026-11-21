import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { WritingHtmlPreview } from "./writing-html-preview";
import { isHtmlArtifact } from "../shared/writing-html.mjs";
import { markdown } from "@codemirror/lang-markdown";
import { ActionButton } from "./ui";
import RichMarkdownMessage from "./markdown";
import { WritingIllustrationDialog, WritingReadingContent } from "./writing-illustrations";
import type { WritingArtifactRecord } from "./writing-schema";
import { artifactText } from "../shared/writing-novel.mjs";
import "./writing-editor.css";

const externalDocument = Annotation.define<boolean>();

function TextEditor({ value, onChange, disabled, onSave, htmlSource = false }: { htmlSource?: boolean; value: string; onChange: (text: string) => void; disabled: boolean; onSave: () => Promise<void> }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const editable = useRef(new Compartment());
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      htmlSource ? html() : markdown(), history(), EditorView.lineWrapping, placeholder("从这里开始写作…"),
      editable.current.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
      keymap.of([{ key: "Mod-s", run: () => { void handlers.current.onSave().catch(() => undefined); return true; } }, ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ "aria-label": "文档正文", "data-writing-text-input": "true", spellcheck: "false" }),
      EditorView.updateListener.of((update) => { if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalDocument))) handlers.current.onChange(update.state.doc.toString()); }),
      EditorView.theme({ "&": { height: "100%", background: "transparent", color: "var(--ink)" },
        ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.9" },
        ".cm-content": { padding: "24px 28px", caretColor: "var(--accent)" },
        ".cm-line": { padding: "0" }, "&.cm-focused": { outline: "none" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "color-mix(in srgb, var(--accent) 24%, transparent)" },
        ".cm-cursor": { borderLeftColor: "var(--ink)" }, ".cm-placeholder": { color: "var(--muted)" }
      })
    ] }) });
    view.current = editor;
    return () => { view.current = undefined; editor.destroy(); };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: [externalDocument.of(true), Transaction.addToHistory.of(false)]
    });
  }, [value]);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); }, [disabled]);
  return <div className="writing-text-editor" ref={host} />;
}

export type WritingDocumentEditorProps = {
  projectId?: string;
  onIllustration?: (input: import("./writing-schema").WritingIllustrationInput) => Promise<WritingArtifactRecord>;
  artifact: WritingArtifactRecord;
  busy: boolean;
  onSave: (text: string, expectedRevision: number) => Promise<WritingArtifactRecord>;
  registerCommit: (commit: (() => Promise<void>) | null) => void;
};

export function WritingDocumentEditor({ artifact, busy, onSave, registerCommit, projectId, onIllustration }: WritingDocumentEditorProps) {
  const [base, setBase] = useState(() => ({ text: artifactText(artifact), revision: artifact.revision }));
  const baseRef = useRef(base);
  const [draft, setDraft] = useState(base.text);
  const draftRef = useRef(draft);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const htmlSource = isHtmlArtifact(artifact);
  const [preview, setPreview] = useState(true);
  const [compare, setCompare] = useState(false);
  const [illustrationsOpen, setIllustrationsOpen] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = draft !== base.text;
  const dirtyRef = useRef(dirty);
  function updateDraft(text: string) {
    draftRef.current = text;
    dirtyRef.current = text !== baseRef.current.text;
    setDraft(text);
  }
  function updateBase(next: typeof base) { baseRef.current = next; setBase(next); }
  useEffect(() => {
    // Preserve a local draft when Agent or another editor updates the file.
    if (!dirtyRef.current) {
      const text = artifactText(artifact);
      updateBase({ text, revision: artifact.revision }); updateDraft(text);
    }
  }, [artifact.id, artifact.revision]);
  async function save() {
    if (inFlight.current) { await inFlight.current; return save(); }
    const savedBase = baseRef.current;
    const textToSave = draftRef.current;
    if (textToSave === savedBase.text) return;
    if (busy) {
      setError("正在处理文档，请稍后保存。");
      throw new Error("正在处理文档，请稍后保存。");
    }
    if (artifact.revision > savedBase.revision) {
      setCompare(true);
      throw new Error("文档已有新版本，请先核对后再保存。");
    }
    const promise = (async () => {
      setError(""); setSaving(true);
      try {
        const saved = await onSave(textToSave, savedBase.revision);
        const text = artifactText(saved);
        updateBase({ text, revision: saved.revision });
        updateDraft(draftRef.current === textToSave ? text : draftRef.current);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        throw failure;
      } finally { setSaving(false); }
    })();
    inFlight.current = promise;
    try { await promise; } finally { inFlight.current = null; }
    // A transition must wait for edits made before the disabled editor renders.
    if (draftRef.current !== baseRef.current.text) await save();
  }
  useLayoutEffect(() => { registerCommit(save); return () => registerCommit(null); });
  return <section className="writing-document-editor" data-writing-document-editor={artifact.id}>
    <div className="writing-document-editor__tools">
      <span>{saving ? "保存中…" : dirty ? "未保存的修改" : `已保存 · 第 ${artifact.revision} 版`} · {draft.replace(/\s/g, "").length.toLocaleString()} 字</span>
      <div>{projectId && onIllustration && !htmlSource ? <ActionButton disabled={busy || saving} onClick={() => void save().then(() => setIllustrationsOpen(true)).catch(() => undefined)}>配图</ActionButton> : null}<ActionButton onClick={() => setPreview(!preview)}>{preview ? htmlSource ? "编辑 HTML" : "编辑" : "预览"}</ActionButton>
        <ActionButton variant="primary" disabled={!dirty || busy} busy={saving} onClick={() => void save().catch(() => undefined)} data-writing-save-text="true">保存</ActionButton></div>
    </div>
    {error ? <p className="writing-editor-error" role="alert">{error} 草稿仍保留在编辑器中。</p> : null}
    {dirty && artifact.revision !== base.revision ? <div className="writing-editor-conflict" role="alert">
      <p>文档已有新版本。你的草稿保留在下方，核对并合并需要的内容后继续保存。</p>
      <div><ActionButton onClick={() => setCompare(!compare)}>{compare ? "收起最新内容" : "查看最新内容"}</ActionButton>
        <ActionButton onClick={() => void navigator.clipboard.writeText(draft).catch(() => setError("复制失败，请在编辑器中全选复制。"))}>复制我的草稿</ActionButton>
        {compare ? <ActionButton disabled={busy || saving} onClick={() => { updateBase({ text: artifactText(artifact), revision: artifact.revision }); dirtyRef.current = draftRef.current !== baseRef.current.text; setCompare(false); setError(""); }}>已核对，以当前草稿继续</ActionButton> : null}</div>
      {compare ? <pre aria-label="最新版本正文">{artifactText(artifact)}</pre> : null}
    </div> : null}
    {artifact.provenance.source?.format === "docx" ? <p className="writing-format-note">正在编辑 Word 文档的正文副本；原文件保留。复杂版式和嵌入图片暂不随正文编辑。</p> : null}
    {preview && htmlSource ? <WritingHtmlPreview text={draft} title={artifact.title} /> : preview ? <div className="writing-reading-page">{projectId ? <WritingReadingContent projectId={projectId} artifact={artifact} text={draft} /> : <RichMarkdownMessage content={draft} />}</div>
      : <TextEditor htmlSource={htmlSource} value={draft} onChange={updateDraft} disabled={saving || busy} onSave={save} />}
    {illustrationsOpen && projectId && onIllustration ? <WritingIllustrationDialog projectId={projectId} artifact={artifact} close={() => setIllustrationsOpen(false)} change={onIllustration} /> : null}
  </section>;
}
