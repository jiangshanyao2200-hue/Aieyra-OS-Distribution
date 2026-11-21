import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Maximize2, Paperclip, Pin, Square, X, Minimize2, FileText } from "lucide-react";
import { ActionButton, ButtonBase, InlineNotice } from "./ui";
import type { ConnectionPublicSnapshot } from "./core";
import type { CodingRequest, CodingState } from "./coding-types";
import { codingOperationRecovered, mergeCodingState, type CodingOperationError } from "./coding-state";
import { useTranscriptScroll } from "./use-transcript-scroll";
import { appendComposerDraft, useComposerDraft } from "./os-composer";
import { importTransferredFiles, transferredFiles } from "./agent-file-runtime";
import { shouldCreatePasteBlock } from "./core";
import type { AgentFileAttachment } from "./core";
import { TimelineItem } from "./coding-timeline";
import "./coding-workbench.css";
import type { MatrixReference } from "./matrix";
import { MatrixWelcome, useMatrixWelcome } from "./matrix-welcome";
import { codingActivity } from "./coding-activity";

function MatrixIdentity({ state, drawing, starting, stopping, welcoming }: { state: CodingState; drawing: boolean; starting: boolean; stopping: boolean; welcoming: boolean }) {
  const activity = codingActivity(state, { drawing, starting, stopping, welcoming });
  const busy = !["idle", "stopped"].includes(activity.kind);
  const agentName = state.conversations?.[0]?.label || "画布 Agent";
  const next = busy ? activity.label : agentName;
  const [label, setLabel] = useState(next), [closing, setClosing] = useState(false);
  useEffect(() => {
    if (label === next) { setClosing(false); return; }
    setClosing(true);
    const timer = setTimeout(() => { setLabel(next); setClosing(false); }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140);
    return () => clearTimeout(timer);
  }, [next, label]);
  return <span className={`matrix-card-identity${busy ? " is-working" : ""}`} data-activity={activity.kind} title={busy ? [activity.label, activity.detail, activity.progress].filter(Boolean).join(" · ") : agentName}>
    <i aria-hidden="true" className={busy ? "is-working" : ""} />
    <span className={`matrix-identity-copy${closing ? " is-closing" : ""}`}><strong>{label}</strong>{busy && activity.detail ? <small>{activity.detail}</small> : null}</span>
    <span className="sr-only" role="status" aria-live="polite">{next}</span>
  </span>;
}

function Request({ request, busy, reply }: { request: CodingRequest; busy: boolean; reply: (input: { requestId: string | number; decision?: string; answers?: Record<string, string> }) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = request.params.questions;
  return <form className="coding-request" onSubmit={event => { event.preventDefault(); reply({ requestId: request.id, answers }); }}>
    {questions ? <>{questions.map(question => <label key={question.id}><strong>{question.question}</strong>
      {question.options?.length ? <select value={answers[question.id] || ""} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}><option value="">选择回复</option>{question.options.map(option => <option key={option.label} value={option.label}>{option.label} · {option.description}</option>)}</select> : null}
      <input type={question.isSecret ? "password" : "text"} value={answers[question.id] || ""} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} required placeholder="也可以直接填写你的想法" />
    </label>)}<ActionButton type="submit" disabled={busy}>提交回复</ActionButton></> : <><strong>确认执行</strong><pre>{request.params.command || request.params.reason || "修改项目文件"}</pre><div><ActionButton disabled={busy} onClick={() => reply({ requestId: request.id, decision: "accept" })}>允许本次</ActionButton><ActionButton disabled={busy} onClick={() => reply({ requestId: request.id, decision: "decline" })}>拒绝</ActionButton></div></>}
  </form>;
}

export default function CodingWorkbench({ projectId, canvasProjectId, conversationId: initialConversationId, onConnect, onState, onSendFiles, active = true, composerOpen = true, onComposerOpen, chatWidth = 400, chatMaxWidth = 880, onChatWidth, onChatResizing }: { chatWidth?: number; chatMaxWidth?: number; onChatWidth?: (width: number) => void; onChatResizing?: (active: boolean) => void; active?: boolean; composerOpen?: boolean; onComposerOpen?: (open: boolean) => void; onSendFiles: (files: AgentFileAttachment[], canvasProjectId: string) => Promise<string>; projectId: string; canvasProjectId: string; conversationId: string; onConnect?: () => void; onState?: (state: CodingState & { projectId: string; conversationId: string }) => void }) {
  const [reading, setReading] = useState(false), [unread, setUnread] = useState(false);
  const edgeDrag = useRef<{ x: number; width: number; restore: number; edge: boolean; moved: boolean; next: number } | null>(null);
  const [resizeActive, setResizeActive] = useState(false);
  const suppressEdgeClick = useRef(false);
  const [crewActivity] = useState<NonNullable<CodingState["agents"]>>([]);
  useEffect(() => {
    setResizeActive(false); suppressEdgeClick.current = false;
    return () => { edgeDrag.current = null; onChatResizing?.(false); };
  }, [projectId, onChatResizing]);
  const beginResize = (event: React.PointerEvent<HTMLElement>, edge = false) => {
    if (event.button !== 0 || reading) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    edgeDrag.current = { x: event.clientX, width: edge ? 0 : chatWidth, restore: chatWidth, edge, moved: false, next: chatWidth };
    suppressEdgeClick.current = false; setResizeActive(true); onChatResizing?.(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: React.PointerEvent<HTMLElement>) => {
    const drag = edgeDrag.current; if (!drag) return;
    const distance = drag.x - event.clientX;
    if (Math.abs(distance) > 6) drag.moved = true;
    if (!drag.moved) return;
    drag.next = drag.width + distance;
    if (drag.edge && distance > 20) onComposerOpen?.(true);
    onChatWidth?.(drag.next);
  };
  const endResize = (event: React.PointerEvent<HTMLElement>, canceled = false) => {
    const drag = edgeDrag.current; if (!drag) return;
    edgeDrag.current = null; suppressEdgeClick.current = drag.moved;
    setResizeActive(false); onChatResizing?.(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (canceled) { onChatWidth?.(drag.restore); if (drag.edge) onComposerOpen?.(false); }
    else if (drag.moved && drag.next < 240) { restoreFocusAfterCollapse.current = true; onComposerOpen?.(false); }
  };
  const wasWorking = useRef(false);
  const earlierScroll = useRef<{ top: number; height: number } | null>(null);
  const [pinning, setPinning] = useState(false), [pinned, setPinned] = useState("");
  const hostRef = useRef<HTMLElement>(null), cardRef = useRef<HTMLElement>(null), orbRef = useRef<HTMLButtonElement>(null);
  const preference = `aieyra:coding:conversations:${projectId}:active`;
  const [conversationId, setConversationId] = useState(initialConversationId), [ready, setReady] = useState(false);
  const [state, setState] = useState<CodingState>({ ok: true, status: "connecting", model: "" });
  const [error, setError] = useState(""), [pending, setPending] = useState(false), [fileBusy, setFileBusy] = useState(false);
  const [operationError, setOperationError] = useState<CodingOperationError | null>(null);
  const latestState = useRef(state); latestState.current = state;
  const visibleError = error || (operationError && !codingOperationRecovered(state, operationError) ? operationError.message : "");
  useEffect(() => { if (operationError && codingOperationRecovered(state, operationError)) setOperationError(null); }, [state, operationError]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const [model, setModel] = useState(""), [models, setModels] = useState<string[]>([]);
  const { listRef, contentRef, atBottom, latest: scrollLatest, preserve: preserveScroll } = useTranscriptScroll(`${projectId}/${conversationId}`, composerOpen, reading);
  const [aiReady, setAiReady] = useState(false), [connectionNotice, setConnectionNotice] = useState("");
  const [connectionIdentity, setConnectionIdentity] = useState("");
  const [connectionLoaded, setConnectionLoaded] = useState(false), [statusIdentity, setStatusIdentity] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [stopping, setStopping] = useState(false);
  const composer = useComposerDraft(projectId, conversationId), { files: attachments } = composer.draft;
  const draft = composer.draft.prompt;
  const editDraft = composer.setPrompt;
  const [references, setReferences] = useState<MatrixReference[]>([]), [referencePicker, setReferencePicker] = useState(false);
  const selectedReferences = composer.draft.references as MatrixReference[];
  const toggleReference = (ref: MatrixReference, selected: boolean) => composer.setReferences((current: MatrixReference[]) => selected ? [...current.filter(r => r.id !== ref.id || r.sourceProjectId !== ref.sourceProjectId), ref] : current.filter(r => r.id !== ref.id || r.sourceProjectId !== ref.sourceProjectId));
  useEffect(() => {
    if (!referencePicker) return;
    let disposed = false, revision = 0;
    const refresh = () => {
      const request = ++revision;
      void window.aieyraMatrix?.references({ projectId }).then(result => {
        if (disposed || request !== revision) return;
        if (!result.ok) throw new Error(result.error || "画布引用读取失败");
        setReferences(result.references || []);
      }).catch(error => { if (!disposed && request === revision) setError(error.message); });
    };
    refresh(); const off = window.aieyraMatrix?.onChanged(event => { if (event.kind === "projects") refresh(); });
    return () => { disposed = true; off?.(); };
  }, [projectId, referencePicker]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocusAfterCollapse = useRef(false);
  const changeReading = (open: boolean) => { setReading(open); };
  useLayoutEffect(() => {
    if (reading) cardRef.current?.focus({ preventScroll: true });
  }, [reading]);
  useLayoutEffect(() => {
    if (cardRef.current) cardRef.current.inert = !composerOpen;
    if (!composerOpen) {
      setReading(false);
      if (restoreFocusAfterCollapse.current) orbRef.current?.focus({ preventScroll: true });
      restoreFocusAfterCollapse.current = false;
      return;
    }
    setUnread(false);
    const request = cardRef.current?.querySelector<HTMLElement>(".matrix-card-requests input, .matrix-card-requests button");
    (request || inputRef.current)?.focus({ preventScroll: true });
  }, [composerOpen]);
  useLayoutEffect(() => {
    const before = earlierScroll.current, list = listRef.current;
    if (before && list) { list.scrollTop = before.top + list.scrollHeight - before.height; earlierScroll.current = null; }
  }, [state.items]);
  const alive = useRef(true), operationPending = useRef(false), modelEdited = useRef(false);
  const latestDraft = useRef(draft); latestDraft.current = draft;
  const requestEpoch = useRef(0), fileImportPending = useRef(false), fileImportQueue = useRef(Promise.resolve()), fileImportCount = useRef(0);
  const currentConversation = useRef(conversationId); currentConversation.current = conversationId;
  const running = ["running", "compacting", "connecting"].includes(state.status || "");
  const greetingEligible = ready && connectionLoaded && statusIdentity === connectionIdentity && !state.hasMessages && !state.items?.length && !state.turnId && !state.requests?.length;
  const [greetingOpened, setGreetingOpened] = useState(false);
  useEffect(() => { if (active) setGreetingOpened(true); }, [active]);
  const welcome = useMatrixWelcome({ projectId, conversationId, model, identity: connectionIdentity, active: greetingOpened, eligible: greetingEligible, connected: aiReady });
  const drawing = state.items?.some(item => item.type === "imageGeneration" && item.status === "inProgress") || false;
  const locateImage = useCallback((canvasProjectId: string, nodeId: string) => {
    void window.aieyraMatrix.execute({ projectId, conversationId, name: "images.locate", arguments: { projectId: canvasProjectId, nodeId } }).then(r => { if (!r.ok) setError(r.error || "成果暂时不可定位。"); }).catch(e => setError(e.message));
  }, [projectId, conversationId]);
  const cancelImage = useCallback((jobId: string, operation: "pause" | "resume" | "cancel" = "cancel") => {
    void window.aieyraMatrix.execute({ projectId, conversationId, name: jobId.startsWith("matrix-batch-") ? "images.batch" : "images.cancel", arguments: { jobId, ...(jobId.startsWith("matrix-batch-") ? {operation} : {}) } }).then(r => { if (!r.ok && !r.canceled) setError(r.error || "图片任务操作失败。"); }).catch(e => setError(e.message));
  }, [projectId, conversationId]);
  const working = Boolean(state.turnId) || ["running", "compacting"].includes(state.status || "") || pendingAction === "send" || welcome.busy;
  useEffect(() => { if (!working) setStopping(false); }, [working]);
  useEffect(() => { onState?.({ ...state, agents: crewActivity, error:visibleError || state.error, status: visibleError ? "error" : pendingAction === "send" ? "running" : welcome.busy ? "connecting" : aiReady ? state.status : "idle", projectId, conversationId }); }, [state, crewActivity, visibleError, pendingAction, welcome.busy, aiReady, projectId, conversationId, onState]);
  useEffect(() => {
    let disposed = false;
    void window.aieyraAgent!.coding({ projectId, conversationId: initialConversationId, operation: "conversations" }).then(result => {
      if (disposed) return;
      const conversations = result.conversations || [], selected = localStorage.getItem(preference);
      // Explicit focus may target a new feedback-only conversation before a native binding exists.
      const id = selected && selected.length <= 160 ? selected : conversations[conversations.length - 1]?.id || initialConversationId;
      setConversationId(id); localStorage.setItem(preference, id);
    }).catch(error => { if (!disposed) setError(error.message); }).finally(() => { if (!disposed) setReady(true); });
    return () => { disposed = true; };
  }, [projectId, initialConversationId, preference]);
  useEffect(() => {
    let disposed = false;
    const apply = (connection: ConnectionPublicSnapshot) => {
      if (disposed) return;
      setAiReady(connection.aiReady);
      if (connection.aiReady) setConnectionNotice("");
      setConnectionLoaded(true);
      setConnectionIdentity(JSON.stringify([connection.mode, connection.profileId, connection.displayBaseUrl, connection.credential.epoch, connection.agentModel, connection.agentModelPool, connection.reasoningEffort, connection.modelAdapters]));
      const pool = [...new Set([connection.agentModel, ...(connection.agentModelPool || [])].filter(Boolean))];
      setModels(pool);
      setModel(current => pool.includes(current) ? current : pool.includes("gpt-5") ? "gpt-5" : pool[0] || current);
    };
    void window.aieyraConnection?.status().then(result => apply(result.connection)).catch(error => { if (!disposed) setError(error.message); });
    const off = window.aieyraConnection?.onChanged?.(apply);
    return () => { disposed = true; off?.(); };
  }, []);
  const invoke = useCallback(async (payload: Omit<Parameters<NonNullable<Window["aieyraAgent"]>["coding"]>[0], "projectId" | "conversationId">) => {
    if (!window.aieyraAgent?.coding) throw new Error("请启动当前开发版本以连接Matrix引擎。");
    const epoch = requestEpoch.current;
    const result = await window.aieyraAgent.coding({ projectId, conversationId, ...payload });
    if (!result.ok) throw new Error(result.error || "Matrix操作失败。");
    if (alive.current && currentConversation.current === conversationId && epoch === requestEpoch.current) {
      latestState.current = mergeCodingState(latestState.current, result);
      setState(latestState.current);
      if (payload.operation === "status" && result.model && !result.storedHistory && !modelEdited.current) setModel(result.model);
    }
    return result;
  }, [projectId, conversationId]);
  useEffect(() => {
    if (!ready || !connectionLoaded) return;
    alive.current = true; requestEpoch.current++; let disposed = false;
    const off = window.aieyraAgent?.onCodingEvent(event => {
      if (disposed || event.projectId !== projectId || event.conversationId !== conversationId) return;
      latestState.current = mergeCodingState(latestState.current, event.state);
      setState(latestState.current);
    });
    setError(""); setOperationError(null);
    const before=latestState.current;
    void invoke({ operation: "status" }).then(() => { if (!disposed) setStatusIdentity(connectionIdentity); }).catch(error => { if (!disposed) setOperationError({message:error.message,operation:"status",runtimeId:before.runtimeId,revision:before.revision||0}); });
    return () => { disposed = true; requestEpoch.current++; off?.(); };
  }, [invoke, ready, projectId, conversationId, aiReady, connectionIdentity, connectionLoaded]);
  useEffect(() => {
    let disposed=false,timer:number;
    const refresh=async()=>{
      if(disposed)return;
      if(!document.hidden&&document.body.dataset.visible!=='false')try { await invoke({operation:"status"}); const c=await window.aieyraConnection!.status(); if(!disposed){setAiReady(c.connection.aiReady);setModels(c.connection.agentModelPool||[]);setModel(c.connection.agentModel||"");} } catch(error) { if(!disposed)setError(error instanceof Error?error.message:String(error)); }
      if(!disposed)timer=window.setTimeout(refresh,active?700:2000);
    };void refresh();return ()=>{disposed=true;clearTimeout(timer);};
  },[invoke,active]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; requestEpoch.current++; }; }, []);
  useEffect(() => {
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; conversationId: string }>).detail;
      if (detail.projectId !== projectId || !detail.conversationId || detail.conversationId === currentConversation.current) return;
      if (operationPending.current || fileImportPending.current) { setError("请先完成当前操作与文件导入，再切换会话。"); return; }
      requestEpoch.current++; setError(""); setOperationError(null); setStatusIdentity("");
      setState({ ok: true, status: "connecting" }); modelEdited.current = false;
      setConversationId(detail.conversationId); localStorage.setItem(preference, detail.conversationId);
    };
    window.addEventListener("aieyra:matrix:focus", focus);
    return () => window.removeEventListener("aieyra:matrix:focus", focus);
  }, [projectId, preference]);
  useEffect(() => { const input = inputRef.current; if (input && composerOpen) { input.style.height = "auto"; input.style.height = `${Math.min(140, Math.max(54, input.scrollHeight))}px`; } }, [draft, composerOpen]);
  const taskKey = state.turnId || (state.status === "compacting" ? "compacting" : drawing ? state.items?.find(item => item.type === "imageGeneration" && item.status === "inProgress")?.id || "drawing" : "");
  const attentionKey = JSON.stringify([(state.requests || []).map(request => request.id), state.waitingFor || "", visibleError || state.error || ""]);
  useEffect(() => {
    if (state.requests?.length || state.waitingFor || visibleError || state.error) onComposerOpen?.(true);
  }, [attentionKey]);
  const taskWorking = Boolean(taskKey) || pendingAction === "send";
  useEffect(() => {
    if (taskWorking) wasWorking.current = true;
    else if (wasWorking.current) { wasWorking.current = false; if (!composerOpen) setUnread(true); }
  }, [taskWorking]);
  async function loadEarlier() {
    preserveScroll();
    const list = listRef.current;
    if (list) earlierScroll.current = { top: list.scrollTop, height: list.scrollHeight };
    if (!await act({ operation: "history", cursor: state.cursor! })) earlierScroll.current = null;
  }
  async function act(payload: Parameters<typeof invoke>[0]) {
    if (operationPending.current) return false;
    operationPending.current = true; setPending(true); setPendingAction(payload.operation); setError(""); setOperationError(null);
    const epoch=requestEpoch.current, before=latestState.current;
    try {
      if (payload.operation === "send" && payload.fileAttachments?.some(file => file.kind === "image")) {
        const saved = await onSendFiles(payload.fileAttachments, canvasProjectId);
        payload = { ...payload, prompt: `${payload.prompt}\n\n${saved}` };
      }
      await invoke(payload); return true;
    }
    catch (error) {
      const failure={message:error instanceof Error ? error.message : String(error),operation:payload.operation,submissionId:payload.submissionId,runtimeId:before.runtimeId,revision:before.revision||0};
      if(payload.operation==="send") {
        try { await invoke({operation:"status"}); } catch { /* A read-only reconciliation never resends a task. */ }
        if(codingOperationRecovered(latestState.current,failure))return true;
      }
      if (alive.current && epoch===requestEpoch.current && currentConversation.current===conversationId) { setStopping(false); setOperationError(failure); }
      return false;
    }
    finally { operationPending.current = false; if (alive.current) { setPending(false); setPendingAction(""); } }
  }
  async function stop() {
    if (operationPending.current || stopping) return;
    if (welcome.busy) {
      setStopping(true);
      try { await welcome.stop(); } catch (error) { setStopping(false); setError(error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (!state.turnId && state.status !== "compacting" && !drawing) return;
    setStopping(true);
    await act({ operation: "interrupt" });
  }
  async function send() {
    if (operationPending.current || pending || fileImportPending.current || working) return;
    if (!aiReady) { setConnectionNotice("请在联系人中配置画布 Agent 的模型。"); onConnect?.(); return; }
    const prompt = draft.trim() || (attachments.length || selectedReferences.length ? "请查看这些文件和项目节点，并根据当前要求继续。" : "");
    if (!prompt || pending || fileBusy) return;
    await composer.flush();
    scrollLatest();
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([prompt,model,attachments,selectedReferences])))),n=>n.toString(16).padStart(2,"0")).join("");
    const receiptKey=`matrix:submission:${projectId}/${conversationId}`;
    let submissionId=crypto.randomUUID() as string;
    try { const saved=JSON.parse(localStorage.getItem(receiptKey)||"null"); if(saved?.fingerprint===fingerprint)submissionId=saved.id; localStorage.setItem(receiptKey,JSON.stringify({id:submissionId,fingerprint})); } catch { /* Native receipt still protects this invocation. */ }
    if (await act({ operation: "send", submissionId, prompt, model, fileAttachments: attachments, context: selectedReferences.length ? {program:"workspace", references:selectedReferences} : null })) {
      try { localStorage.removeItem(receiptKey); } catch { /* Safe to retain the already accepted receipt. */ }
      composer.consume(draft);
      if (alive.current && currentConversation.current === conversationId) {
        setUnread(false);
        if (latestDraft.current === draft) inputRef.current?.focus({ preventScroll: true });
      }
    }
  }
  function importFiles(files?: File[], pastedText?: string, clipboardImage = false) {
    if (operationPending.current) { setError("当前操作正在提交，请稍后添加文件。"); return; }
    fileImportPending.current = true; fileImportCount.current++;
    setFileBusy(true); setError("");
    // Capture the draft scope now, and serialize imports without discarding a
    // second paste or delivering a late result into another conversation.
    fileImportQueue.current = fileImportQueue.current.then(async () => {
      const api = window.aieyraConfig!;
      const result = pastedText !== undefined
        ? await api.importAgentFiles!({ projectId, files: [{ name: `粘贴文本-${Date.now()}.txt`, bytes: new TextEncoder().encode(pastedText), pasteBlock: true }] })
        : files?.length ? await importTransferredFiles(projectId, files)
        : clipboardImage ? await api.importAgentFiles!({ projectId, clipboardImage: true })
        : await api.pickAgentFiles!({ projectId, maxFiles: 24 });
      if ("canceled" in result && result.canceled) return;
      if (!result.ok) throw Error(result.error || "添加文件失败。");
      await appendComposerDraft(projectId, conversationId, { files: result.files || [] });
      if (result.skippedCount) throw Error(result.warnings?.join("\n") || `${result.skippedCount} 个文件未能导入，请检查格式或大小；其余文件已加入草稿。`);
    }).catch(error => { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }).finally(() => {
      fileImportPending.current = --fileImportCount.current > 0;
      if (alive.current) setFileBusy(fileImportPending.current);
    });
  }
  function paste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = transferredFiles(event.clipboardData);
    if (files.length) { event.preventDefault(); event.stopPropagation(); importFiles(files); return; }
    if (event.clipboardData.types.some(type => /^image\//i.test(type))) { event.preventDefault(); event.stopPropagation(); importFiles(undefined, undefined, true); return; }
    const text = event.clipboardData.getData("text/plain");
    // Connection setup keeps its existing non-persistent secret handling.
    if (shouldCreatePasteBlock(text) && !/(?:sk-|(?:api[_ -]?key|key|密钥)["']?\s*[:：=])/i.test(text)) {
      event.preventDefault(); event.stopPropagation(); importFiles(undefined, text);
    }
  }
  useEffect(() => {
    const accept = (event: Event) => {
      const detail = (event as CustomEvent<{projectId:string;conversationId?:string;text?:string;files?:typeof attachments;referenceId?:string;submitted?:boolean}>).detail;
      if (detail.projectId !== projectId || (detail.conversationId && detail.conversationId !== conversationId)) return;
      if (detail.text) composer.setPrompt(current => `${current}${current.trim() ? "\n\n" : ""}${detail.text}`);
      if (detail.files?.length) composer.setFiles(current => [...current, ...detail.files!.filter(file => !current.some(saved => saved.id === file.id))]);
      void window.aieyraMatrix.references({projectId}).then(result => { if(result.ok && alive.current){setReferences(result.references || []);const ref=result.references?.find(r=>r.id===detail.referenceId);if(ref)toggleReference(ref,!detail.submitted);} }).catch(error => { if (alive.current) setError(error.message); });
      if (!detail.submitted) { onComposerOpen?.(true); window.setTimeout(() => inputRef.current?.focus(), 0); }
    };
    window.addEventListener("aieyra:matrix:draft", accept);
    return () => window.removeEventListener("aieyra:matrix:draft", accept);
  }, [projectId, conversationId, composer.setPrompt, composer.setFiles]);
  const pool = models.length ? models : state.models || [];
  const items = (state.items || []).slice(-120);
  let lastUser = -1;
  for (let index = items.length - 1; index >= 0; index--) { if (items[index].type === "userMessage") { lastUser = index; break; } }
  const currentItems = items.slice(lastUser < 0 ? 0 : lastUser);
  const replies = currentItems.filter(item => item.type === "agentMessage" && item.phase !== "commentary");
  const needsReply = Boolean(state.requests?.length || state.waitingFor);
  const replyId = replies.map(item => item.id).join("/");
  async function pinReply() {
    if (!replyId || pinning || working) return;
    setPinning(true);
    try {
      const result = await window.aieyraMatrix.execute({ projectId, conversationId, name: "nodes.create", arguments: { projectId: canvasProjectId, type: "requirement", title: (lastUser >= 0 ? items[lastUser].text || "画布 Agent 回复" : "画布 Agent 回复").replace(/\s+/g, " ").slice(0, 60), text: replies.map(item => item.text || "").join("\n\n") } });
      if (!result.ok) throw Error(result.error || "回复未能保存到画布。");
      if (alive.current) setPinned(replyId);
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (alive.current) setPinning(false); }
  }
  const closeComposer = () => { restoreFocusAfterCollapse.current = true; onComposerOpen?.(false); setReading(false); };
  return <section ref={hostRef} className={`coding-workbench matrix-canvas-workbench${composerOpen ? " is-composing" : ""}${reading && composerOpen ? " is-reading" : ""}`} aria-label="Matrix工作区" data-project-id={projectId} data-conversation-id={conversationId} data-recovery-blocked={Boolean(fileBusy) || undefined}
    onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); dragDepth.current++; setDraggingFiles(true); onComposerOpen?.(true); } }}
    onDragLeave={event => { event.stopPropagation(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDraggingFiles(false); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; } }}
    onDrop={event => { const files = transferredFiles(event.dataTransfer); if (files.length || event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDraggingFiles(false); onComposerOpen?.(true); if (files.length) importFiles(files); else setError("未取得拖入文件，请从 QQ 复制图片后在此粘贴。"); } }}>
    {reading && composerOpen ? <div className="matrix-reading-backdrop" aria-hidden="true" onClick={() => changeReading(false)} /> : null}
    <section id={`matrix-dialog-${projectId}`} ref={cardRef} tabIndex={-1} role="complementary" aria-label={`与 ${state.conversations?.[0]?.label || "画布 Agent"} 对话`} aria-hidden={!composerOpen} className={`matrix-conversation-card matrix-chat-dialog${composerOpen ? " is-open" : ""}${reading ? " is-expanded" : ""}`} data-ui-interactive="true"
      onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); if (reading) changeReading(false); else closeComposer(); } }}>
      <header className="matrix-card-header">
        <ButtonBase className="matrix-card-collapse" aria-label="收起对话侧栏" title="收起对话，任务继续，草稿保留" onClick={closeComposer}><ChevronRight size={17} /></ButtonBase>
        <MatrixIdentity state={{ ...state, error: visibleError || state.error }} drawing={drawing} starting={pendingAction === "send"} stopping={stopping} welcoming={welcome.busy} />
        <div>
          {working ? <ButtonBase aria-label="停止当前任务" title="停止任务" disabled={pending || stopping} onClick={() => void stop()}><Square size={12} /></ButtonBase> : null}
          {replyId && !working ? <ButtonBase aria-label={pinned === replyId ? "回复已留在画布" : "将回复留在画布"} title={pinned === replyId ? "已保存为画布便签" : "将回复保存为画布便签"} disabled={pinning || pinned === replyId} onClick={() => void pinReply()}><Pin size={14} /></ButtonBase> : null}
          <ButtonBase aria-label={reading ? "退出专注阅读" : "放大阅读"} title={reading ? "退出专注阅读" : "放大阅读"} aria-pressed={reading} onClick={() => changeReading(!reading)}>{reading ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</ButtonBase>
        </div>
      </header>
      <div className="coding-transcript matrix-dialog-transcript" ref={listRef} tabIndex={0} aria-label="对话进展">
        <div className="coding-timeline" ref={contentRef} aria-label="Matrix执行时间线">
          {state.storedHistory ? <p className="matrix-connect-help">离线显示最近保存的对话，连接后可查看完整历史。</p> : null}
          {state.cursor && aiReady && items.length < 120 ? <ButtonBase className="coding-history" disabled={pending} onClick={() => void loadEarlier()}>查看更早记录</ButtonBase> : null}
          {greetingEligible ? <MatrixWelcome result={welcome.result} connect={onConnect} name={state.conversations?.[0]?.label} avatar={state.avatar} /> : null}
          {(state.items?.length || 0) >= 120 ? <p className="matrix-history-limit">显示最近 120 条记录</p> : null}
          {items.map(item => <TimelineItem key={item.id} item={item} onLocate={locateImage} onCancel={cancelImage} />)}
          {!greetingEligible && !items.length ? <p className="matrix-dialog-placeholder">{working ? "画布 Agent 正在准备，执行过程会显示在这里。" : "把想法交给画布 Agent，让成果留在画布。"}</p> : null}
        </div>
      </div>
      {needsReply ? <div className="matrix-card-requests" aria-label="需要你的回复">{state.requests?.map(request => <Request key={request.id} request={request} busy={pending} reply={input => void act({ operation: "reply", ...input })} />)}</div> : null}
      <div className="matrix-dialog-status" hidden={atBottom}>
        {!atBottom ? <ButtonBase className="matrix-read-latest" onClick={scrollLatest}><ArrowDown size={12} />查看最新</ButtonBase> : null}
      </div>
    <div id={`matrix-composer-${projectId}`} className="coding-input-area matrix-canvas-composer">

      {visibleError || state.error || composer.error ? <InlineNotice tone="danger">{visibleError || state.error || composer.error}</InlineNotice> : null}
      {connectionNotice || (!aiReady && !greetingEligible) ? <div className="matrix-connect-help"><span>{connectionNotice || "连接模型后即可开始"}</span><ActionButton variant="ghost" onClick={onConnect}>连接设置</ActionButton></div> : null}
      <form className={`coding-composer${draggingFiles ? " is-file-drop" : ""}`} onSubmit={event => { event.preventDefault(); if (working) void stop(); else void send(); }}>
        {draggingFiles ? <div className="coding-drop-hint" role="status">松开添加图片或文件 · 发送后图片进入画布</div> : null}
        {selectedReferences.length ? <div className="coding-attachments">{selectedReferences.map(ref => <span className="coding-reference" data-matrix-reference={ref.id} key={ref.id} title={`${ref.count} 个节点 · ${ref.sourceNodeIds.join(", ")}`}><span>@{ref.sourceProjectName} · @{ref.title}</span><ButtonBase type="button" aria-label={`移除引用 ${ref.title}`} onClick={() => toggleReference(ref, false)}><X size={12} /></ButtonBase></span>)}</div> : null}
        {referencePicker ? <div className="matrix-reference-picker">{references.length ? references.map(ref => <label key={ref.id}><input type="checkbox" checked={selectedReferences.some(r => r.id === ref.id && r.sourceProjectId === ref.sourceProjectId)} onChange={event => toggleReference(ref, event.target.checked)} />@{ref.sourceProjectName} · @{ref.title}</label>) : <p>当前画布没有可引用的对象。</p>}</div> : null}
        {attachments.length ? <div className="coding-file-previews" aria-label="待发送附件">{attachments.map(file => <article className={`coding-file-preview${file.pasteBlock ? " is-paste-block" : ""}`} key={file.id} data-attachment-id={file.id}>
          {file.kind === "image" && file.assetUrl ? <img src={file.assetUrl} alt={file.name} draggable={false} /> : <FileText size={22} />}
          <div>{file.pasteBlock ? <details><summary>粘贴块 · {file.pasteBlock.lines} 行 · {file.pasteBlock.chars} 字</summary><pre>{file.textPreview}{file.textTruncated ? "\n…预览已折叠，完整原文随附件发送。" : ""}</pre></details> : <><strong title={file.name}>{file.name}</strong><small>{file.kind === "image" ? "发送后保存到画布 · " : ""}{file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`}</small></>}</div>
          <ButtonBase type="button" disabled={pending} aria-label={`移除 ${file.name}`} onClick={() => composer.setFiles(current => current.filter(value => value.id !== file.id))}><X size={12} /></ButtonBase>
        </article>)}</div> : null}
        <textarea ref={inputRef} value={draft} onPaste={paste} onChange={event => editDraft(event.target.value)} placeholder={working ? "可以先写下接下来的想法…" : "描述任务，粘贴图片、长文本或拖入文件…"} aria-label="Matrix任务" rows={2} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
        <footer><label className="coding-model"><select aria-label="画布 Agent 模型" value={model} disabled={running || pending || !pool.length} onChange={event => { modelEdited.current = true; setModel(event.target.value); }}>{!pool.includes(model) ? <option value={model} disabled>{pool.length ? `${model} · 待选择` : "连接模型池"}</option> : null}{pool.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <ButtonBase type="button" aria-label="添加文件" title="添加文件" disabled={fileBusy} onClick={() => void importFiles()}>{fileBusy ? <Loader2 size={15} className="spin" /> : <Paperclip size={15} />}</ButtonBase>
          <ButtonBase type="button" aria-label="项目节点引用" title="项目节点引用" aria-expanded={referencePicker} onClick={() => setReferencePicker(value => !value)}>＠</ButtonBase>
          <ButtonBase type="button" aria-label="压缩上下文" title="整理上下文" disabled={pending || running || !aiReady || !state.threadId} onClick={() => void act({ operation: "compact" })}><Minimize2 size={15} /></ButtonBase>
          <span className="coding-shortcut">Ctrl + Enter</span>
          <ButtonBase type="submit" className={`coding-send${working ? " is-working" : ""}${stopping ? " is-stopping" : ""}${pending ? " is-pending" : ""}`} aria-label={stopping ? "正在停止" : working ? "停止任务" : "发送任务"} title={stopping ? "正在停止…" : working ? "停止任务" : "发送任务 · Ctrl + Enter"} aria-busy={pending || stopping} disabled={working ? pending || stopping || (!state.turnId && state.status !== "compacting" && !welcome.busy && !drawing) : pending || fileBusy || (aiReady && (state.status === "connecting" || !pool.includes(model))) || (!draft.trim() && !attachments.length && !selectedReferences.length)}>
            <span className="coding-send-arrow" aria-hidden="true"><ArrowUp size={19} /></span>
            <span className="coding-send-square" aria-hidden="true"><Square size={12} fill="currentColor" /></span>
            <span className="coding-send-progress" aria-hidden="true" />
          </ButtonBase>
        </footer>
      </form>
    </div>
    </section>
    <div role="separator" aria-label="调整对话侧栏宽度" aria-orientation="vertical" aria-valuemin={Math.min(320, chatMaxWidth)} aria-valuemax={chatMaxWidth} aria-valuenow={Math.round(chatWidth)} tabIndex={0} className="matrix-chat-resize" hidden={!composerOpen || reading}
      onPointerDown={event => beginResize(event)} onPointerMove={moveResize} onPointerUp={event => endResize(event)} onPointerCancel={event => endResize(event, true)}
      onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); if (event.key === "Enter" || event.key === "Home") closeComposer(); else onChatWidth?.(event.key === "End" ? chatMaxWidth : chatWidth + (event.key === "ArrowLeft" ? 24 : -24)); }} />
    <button ref={orbRef} type="button" className="matrix-edge-restore" hidden={composerOpen && !(resizeActive && edgeDrag.current?.edge)}
      aria-label="展开对话侧栏" aria-controls={`matrix-dialog-${projectId}`} aria-expanded={composerOpen}
      title="展开对话，也可以向左拖动" onClick={() => { if (!suppressEdgeClick.current) onComposerOpen?.(true); suppressEdgeClick.current = false; }}
      onKeyDown={event => event.stopPropagation()}
      onPointerDown={event => beginResize(event, true)} onPointerMove={moveResize}
      onPointerUp={event => endResize(event)} onPointerCancel={event => endResize(event, true)}>
      <span className="matrix-edge-preview" aria-hidden="true" /><span className="matrix-edge-arrow"><ChevronLeft size={17} />{draft.trim() || attachments.length || unread ? <i className="matrix-draft-dot" /> : null}</span>
    </button>
  </section>;
}
