import { workspaceReferenceCode } from "../shared/workspace-references.mjs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WritingArtifactRecord } from "./writing-schema";
import { ActionButton, ButtonBase } from "./ui";
import { StageReviewDisclosure } from "./work-review-panel";
import { WritingReadingContent } from "./writing-illustrations";
import { WritingDocumentEditor } from "./writing-text-editor";
import "./writing-editor.css";
import { NOVEL_SECTIONS, artifactText, novelParts, novelReviewState, type NovelCommand, type NovelSection } from "../shared/writing-novel.mjs";

export default function WritingNovelPanel({ projectId, onIllustration, root, artifacts, busy, onCommand, onSaveRoot, onAskAgent, onOpenChapter, onExport, registerCommit, sectionRequest }: {
  projectId: string; onIllustration: (input: import("./writing-schema").WritingIllustrationInput) => Promise<WritingArtifactRecord>;
  root: WritingArtifactRecord; artifacts: WritingArtifactRecord[]; busy: boolean;
  onCommand: (input: NovelCommand) => Promise<WritingArtifactRecord>;
  onSaveRoot: (text: string, revision: number) => Promise<WritingArtifactRecord>;
  onAskAgent: (prompt: string, visiblePrompt: string) => void | Promise<void>;
  onOpenChapter: (artifact: WritingArtifactRecord) => void;
  onExport: (format: "html" | "docx", revision: number) => Promise<void>;
  sectionRequest?: { section: string; sequence: number };
  registerCommit: (commit: (() => Promise<void>) | null) => void;
}) {
  const [tab, setTab] = useState<"request" | NovelSection | "chapters" | "read">(() => novelReviewState(artifacts, root).pending?.id || "chapters");
  useEffect(() => { if (sectionRequest && NOVEL_SECTIONS.some(item => item.id === sectionRequest.section)) setTab(sectionRequest.section as NovelSection); }, [sectionRequest]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [titleDraft, setTitleDraft] = useState({ value: root.title, base: root.title });
  const title = titleDraft.value;
  useEffect(() => {
    setTitleDraft(current => current.value === current.base ? { value: root.title, base: root.title } : current);
  }, [root.title]);
  const format = root.attributes?.deliveryFormat === "docx" ? "docx" : "html";
  const [readingChapterId, setReadingChapterId] = useState("");
  const commit = useRef<(() => Promise<void>) | null>(null);
  const latest = useRef({ root, artifacts });
  latest.current = { root, artifacts };
  const acting = useRef(false);
  const titleSave = useRef<Promise<void> | null>(null);
  const parts = novelParts(artifacts, root.id);
  const state = novelReviewState(artifacts, root);
  const readingChapter = parts.chapters.find((chapter) => chapter.id === readingChapterId) || parts.chapters[0];
  const selected = tab === "request" ? root : tab === "read" || tab === "chapters" ? undefined : parts.sections[tab];
  const locked = busy || pending;
  const register = (next: (() => Promise<void>) | null) => { commit.current = next; };
  function remember(saved: WritingArtifactRecord) {
    const current = latest.current;
    latest.current = { root: saved.id === current.root.id ? saved : current.root,
      artifacts: current.artifacts.map((item) => item.id === saved.id ? saved : item) };
    return saved;
  }
  async function command(input: NovelCommand) { return remember(await onCommand(input)); }
  async function saveCurrent() {
    try {
      await commit.current?.();
      if (titleSave.current) return await titleSave.current;
      if (!title.trim()) throw new Error("请填写小说名称。");
      if (title.trim() !== titleDraft.base) {
        titleSave.current = command({ action: "rename", novelId: root.id, title: title.trim(), previousTitle: titleDraft.base }).then(saved => {
          setTitleDraft(current => ({ value: current.value === title ? saved.title : current.value, base: saved.title }));
        });
        try { await titleSave.current; } finally { titleSave.current = null; }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure; }
  }
  useLayoutEffect(() => { registerCommit(saveCurrent); return () => registerCommit(null); });
  async function act(action: () => unknown | Promise<unknown>) {
    if (locked || acting.current) return;
    acting.current = true;
    setError(""); setPending(true);
    try { await saveCurrent(); await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { acting.current = false; setPending(false); }
  }
  const ask = (instruction: string) => { const message = `@${workspaceReferenceCode("document", root.id)} ${instruction}`; return onAskAgent(message, message); };
  async function confirm(phase: NovelSection) {
    const current = latest.current;
    const review = novelReviewState(current.artifacts, current.root);
    const stage = review.stages.find(item => item.id === phase)!;
    await command({ action: "confirm", novelId: root.id, phase, reviewKey: stage.reviewKey });
    const next = NOVEL_SECTIONS[NOVEL_SECTIONS.findIndex(item => item.id === phase) + 1];
    setTab(next?.id || "chapters");
    await ask(next ? `${stage.label}已在节点中确认。请读取最新版本，准备${next.label}；信息不足先问我，完成后等我核对。`
      : "大纲已在节点中确认。请读取已确认规划和已有章节；没有正文时先写第一章样章，有正文时按当前修改范围继续，保留已有稿件。完成后让我核对文风与节奏。");
  }
  const tabs = [{ id: "request", label: "我的描述" }, ...NOVEL_SECTIONS, { id: "chapters", label: `章节 ${parts.chapters.length}` }, { id: "read", label: "阅读" }];
  return <section className="writing-novel-panel" data-writing-novel={root.id}>
    <header className="writing-novel-panel__header">
      <div><span className="writing-novel-kicker">小说 · {state.label}</span><input className="writing-novel-title" aria-label="小说名称" value={title} maxLength={120} disabled={locked}
        onChange={(event) => setTitleDraft(current => ({ ...current, value: event.target.value }))}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void act(() => undefined); } if (event.key === "Escape") { setTitleDraft({ value: root.title, base: root.title }); event.stopPropagation(); } }} /></div>
      <div className="writing-novel-actions">
        <select aria-label="小说导出格式" className="ui-control" value={format} disabled={locked} onChange={(e) => { const value = e.target.value as "html" | "docx"; void act(() => command({ action: "format", novelId: root.id, format: value })); }}><option value="html">HTML</option><option value="docx">Word · DOCX</option></select>
        <ActionButton disabled={locked || !parts.chapters.length || !state.planConfirmed} onClick={() => void act(() => onExport(format, latest.current.root.revision))}>导出全书</ActionButton>
      </div>
    </header>
    <div className="writing-novel-progress" aria-label="小说创作进度">
      {state.stages.map((stage, index) => <ButtonBase type="button" key={stage.id} disabled={locked} className={stage.confirmed ? "is-complete" : state.pending?.id === stage.id ? "is-current" : ""} onClick={() => void act(() => setTab(stage.id))}>{index + 1} {stage.label}{stage.confirmed ? " ✓" : stage.ready ? " · 待核对" : ""}</ButtonBase>)}
      <span className={state.planConfirmed ? "is-current" : ""}>6 章节创作</span>
    </div>
    <nav className="writing-novel-tabs" aria-label="小说内容">{tabs.map((item) => <ButtonBase type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} disabled={locked} onClick={() => void act(() => setTab(item.id as typeof tab))} data-novel-tab={item.id}>{item.label}</ButtonBase>)}</nav>
    {error ? <p className="writing-editor-error" role="alert">{error}</p> : null}
    {title !== titleDraft.base && root.title !== titleDraft.base ? <div className="writing-editor-conflict" data-novel-title-conflict="true" role="alert">
      <p>小说名称已有新版本：{root.title}。你正在编辑的名称已保留，请核对后继续。</p>
      <ActionButton disabled={locked} onClick={() => { setTitleDraft({ value: root.title, base: root.title }); setError(""); }}>采用最新名称</ActionButton>
      <ActionButton disabled={locked} onClick={() => { setTitleDraft(current => ({ ...current, base: root.title })); setError(""); }}>已核对，保留我的名称</ActionButton>
    </div> : null}
    <div className="writing-novel-panel__body">
      {tab === "read" ? <div className="writing-reading-page writing-novel-reader"><h1>{root.title}</h1>
        {parts.sections.synopsis ? <WritingReadingContent projectId={projectId} artifact={parts.sections.synopsis} text={artifactText(parts.sections.synopsis)} /> : null}
        <nav aria-label="小说目录">{parts.chapters.map((chapter) => <ButtonBase type="button" key={chapter.id} aria-current={readingChapter?.id === chapter.id ? "page" : undefined} onClick={() => setReadingChapterId(chapter.id)}>{chapter.title}</ButtonBase>)}</nav>
        {readingChapter ? <article key={readingChapter.id}><h2>{readingChapter.title}</h2><WritingReadingContent projectId={projectId} artifact={readingChapter} text={artifactText(readingChapter)} /></article> : null}
        {!parts.chapters.length ? <p>章节完成后会在这里按顺序展示。</p> : null}
      </div> : tab === "chapters" ? <div className="writing-novel-chapters">{parts.chapters.map((chapter) => <ButtonBase type="button" key={chapter.id} onClick={() => onOpenChapter(chapter)}><strong>{chapter.title}</strong><span>{artifactText(chapter).replace(/\s/g, "").length} 字 · 第 {chapter.revision} 版</span><p>{artifactText(chapter).slice(0, 130)}</p></ButtonBase>)}
        {!parts.chapters.length ? <div className="writing-novel-empty">章节会在这里和画布上同步显示。</div> : null}
      </div> : selected ? <WritingDocumentEditor projectId={projectId} onIllustration={tab === "synopsis" ? onIllustration : undefined} key={selected.id} artifact={selected} busy={busy} registerCommit={register} onSave={async (text, revision) => {
        if (tab === "request") return remember(await onSaveRoot(text, revision));
        return command({ action: "write", novelId: root.id, expectedRootRevision: latest.current.root.revision, section: tab as NovelSection, expectedRevision: revision, text });
      }} /> : <div className="writing-novel-empty"><strong>{NOVEL_SECTIONS.find((s) => s.id === tab)?.label}还未生成</strong><p>{state.requirementsConfirmed ? "交给 Agent 生成初版，完成后可在这里编辑与核对。" : "先让 Agent 梳理你的描述，确认需求后再准备初版。"}</p></div>}
    </div>
    <StageReviewDisclosure collapseKey={`${root.id}:${state.pending?.id || "chapters"}`} title={state.pending ? `${state.pending.label} · ${state.pending.ready ? "待确认" : "待准备"}` : "规划已确认"}
      summary={state.planConfirmed ? "按已确认规划分章创作，先核对样章。" : `${state.pending?.label}确认后继续下一步。已有资料会作为创作依据。`}>
      <p>{state.planConfirmed ? "阅读已有章节后，可以继续创作下一章。" : "先阅读当前阶段内容，需要调整时与 Agent 讨论，确认后继续。"}</p>
      <div className="work-review-actions">
        {state.pending ? <>
          <ActionButton disabled={locked} onClick={() => void act(() => ask(`请读取已有资料和当前规划，${state.pending!.ready ? "与我讨论需要修改的地方，先问我反馈" : `准备${state.pending!.label}，缺少关键信息先问我`}。本阶段核对完成后再继续。`))}>{state.pending.ready ? "讨论修改" : `准备${state.pending.label}`}</ActionButton>
          <ActionButton variant="primary" data-novel-confirm={state.pending.id} disabled={locked || !state.pending.ready} onClick={() => void act(() => confirm(state.pending!.id))}>确认{state.pending.label}并继续</ActionButton>
        </> : <ActionButton variant="primary" disabled={locked} onClick={() => void act(() => ask(`阅读已确认的规划和已有章节，先写第 ${Math.max(0, ...parts.chapters.map((c) => Number(c.attributes?.chapterIndex || 0))) + 1} 章，保存到画布，避免重复已有章节。`))}>写下一章</ActionButton>}
      </div>
    </StageReviewDisclosure>
  </section>;
}
