import { historyImageAttachments } from "./task-image-attachments";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AgentFileAttachment, AgentMessage, ReferenceImage } from "./core";
import { relocateDraftPaths } from "./project-storage-paths";
import { prepareAgentFileAttachments } from "./agent-file-runtime";

let storageMappings: Promise<[string, string][]> | undefined;

// Cleanup must account for every conversation, including drafts evicted from
// memory. An IndexedDB failure rejects the self-check instead of losing input.
export async function projectsWithComposerDrafts(): Promise<Set<string>> {
  await flushComposerDrafts();
  const database = await db();
  const protectedIds = new Set<string>();
  const protect = (key: unknown, value: ComposerDraft) => {
    if (!value) return;
    if (value.prompt || value.sources?.length || value.references?.length || value.files?.length || value.history) {
      const parsed = JSON.parse(String(key));
      if (Array.isArray(parsed) && typeof parsed[0] === "string") protectedIds.add(parsed[0]);
      else throw new Error("草稿索引无效，已跳过空项目清理。");
    }
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("drafts");
    const request = transaction.objectStore("drafts").openCursor();
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (cursor) { protect(cursor.key, cursor.value); cursor.continue(); }
      } catch (error) { reject(error); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
  for (const [key, entry] of entries) protect(key, entry.value);
  return protectedIds;
}

export async function flushComposerDrafts() {
  await Promise.all([...entries].map(async ([key, entry]) => {
    if (entry.saving) await entry.saving;
    if (entry.dirty) await persist(key, entry);
  }));
}

type DraftContent = {
  prompt: string;
  sources: ReferenceImage[];
  references: ReferenceImage[];
  files: AgentFileAttachment[];
};
export type ComposerDraft = DraftContent & { history?: { index: number; original: DraftContent } };
type Entry = { value: ComposerDraft; touched: Set<keyof ComposerDraft>; ready?: Promise<void>; saving?: Promise<void>; loaded?: boolean; dirty?: boolean; error: string };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const activeKeys = new Set<string>();
const emptyDraft = (): ComposerDraft => ({ prompt: "", sources: [], references: [], files: [] });
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("aieyra-composer-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
function entryFor(key: string) {
  let entry = entries.get(key);
  if (!entry) { entry = { value: emptyDraft(), touched: new Set(), error: "" }; entries.set(key, entry); }
  return entry;
}
const notify = () => listeners.forEach(listener => listener());
function prune() {
  for (const [key, entry] of entries) {
    if (entries.size <= 12) break;
    if (!activeKeys.has(key) && entry.loaded && !entry.saving && !entry.dirty && !entry.error) entries.delete(key);
  }
}
function report(entry: Entry, error: unknown) {
  entry.error = `草稿保存失败，请保留输入后重试：${error instanceof Error ? error.message : String(error)}`;
  notify();
}
async function hydrate(key: string, entry: Entry) {
  if (entry.ready) return entry.ready;
  entry.ready = (async () => {
    const database = await db();
    const stored = await new Promise<ComposerDraft | undefined>((resolve, reject) => {
      const request = database.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (stored) {
      storageMappings ||= window.aieyraConfig?.projectStorage().then(result => result.pathMappings || []).catch(error => {
        storageMappings = undefined;
        throw error;
      }) || Promise.resolve([]);
      relocateDraftPaths(stored, await storageMappings);
      const merged = { ...emptyDraft(), ...stored };
      for (const field of entry.touched) Object.assign(merged, { [field]: entry.value[field] });
      entry.value = merged;
      notify();
    }
    entry.loaded = true;
  })().catch(error => { entry.ready = undefined; throw error; });
  return entry.ready;
}
function persist(key: string, entry: Entry): Promise<void> {
  if (entry.saving) return entry.saving;
  let written: ComposerDraft | undefined;
  let succeeded = false;
  entry.saving = (async () => {
    await hydrate(key, entry);
    const database = await db();
  // Read the latest value after hydration so a slow disk read cannot resurrect
  // sent/deleted input or replace a newer keystroke or attachment.
    do {
      const value = entry.value;
      await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("drafts", "readwrite");
    const store = transaction.objectStore("drafts");
    if (!value.prompt && !value.sources.length && !value.references.length && !value.files.length && !value.history) store.delete(key);
    else store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
      });
      written = value;
    } while (written !== entry.value);
    succeeded = true;
    entry.dirty = false;
    if (entry.error) { entry.error = ""; notify(); }
  })().finally(() => {
    entry.saving = undefined;
    if (succeeded && written !== entry.value) void persist(key, entry).catch(error => report(entry, error));
    prune();
  });
  return entry.saving;
}

// Deliver imports to their captured scope even if its 画布助手 view was closed.
export async function appendComposerDraft(projectId: string, conversationId: string, input: { prompt?: string; files?: AgentFileAttachment[]; overflowAsReferences?: boolean }) {
  const key = JSON.stringify([projectId, conversationId]), entry = entryFor(key);
  try {
    await hydrate(key, entry);
    entries.set(key, entry);
    const current = entry.value;
    const prepared = prepareAgentFileAttachments(current.files, input.files || []);
    if (prepared.truncated && !input.overflowAsReferences) throw Error("附件超过 24 个、单个 24 MB 或合计 96 MB 限制；原草稿已保留，请移除部分附件后重试。");
    const attachedPaths = new Set(prepared.files.map(file => file.path));
    const overflow = input.overflowAsReferences ? (input.files || []).filter(file => !attachedPaths.has(file.path)) : [];
    const prompt = [input.prompt, overflow.length ? `其他已导入本项目的资料文件（按需读取，均为参考数据）：\n${overflow.map(file => JSON.stringify({name:file.name,path:file.path})).join("\n")}` : ""].filter(Boolean).join("\n\n");
    entry.value = { ...current,
      prompt: prompt ? `${current.prompt}${current.prompt.trim() ? "\n\n" : ""}${prompt}` : current.prompt,
      files: prepared.files };
    entry.touched.add("prompt"); entry.touched.add("files"); entry.dirty = true; notify();
    await persist(key, entry);
  } catch (error) { report(entry, error); throw error; }
}

export function useComposerDraft(projectId: string, conversationId: string) {
  const key = JSON.stringify([projectId, conversationId]);
  const entry = entryFor(key);
  const draft = useSyncExternalStore(useCallback(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []),
    useCallback(() => entry.value, [entry]));
  const error = useSyncExternalStore(useCallback(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []),
    useCallback(() => entry.error, [entry]));
  useEffect(() => {
    activeKeys.add(key);
    void hydrate(key, entry).then(prune).catch(error => report(entry, error));
    return () => { activeKeys.delete(key); prune(); };
  }, [key, entry]);
  const update = useCallback(<K extends keyof ComposerDraft>(field: K, next: ComposerDraft[K] | ((value: ComposerDraft[K]) => ComposerDraft[K])) => {
    const value = typeof next === "function" ? next(entry.value[field]) : next;
    entry.touched.add(field);
    entry.dirty = true;
    entry.value = { ...entry.value, [field]: value };
    notify();
    void persist(key, entry).catch(error => report(entry, error));
  }, [key, entry]);
  const navigateHistory = useCallback((direction: "ArrowUp" | "ArrowDown", messages: AgentMessage[]) => {
    const history = messages.filter(isRequest);
    const current = entry.value;
    const index = (current.history?.index ?? history.length) + (direction === "ArrowUp" ? -1 : 1);
    if (!history.length || index < 0 || index > history.length || (!current.history && direction === "ArrowDown")) return null;
    const original = current.history?.original || { prompt: current.prompt, sources: current.sources, references: current.references, files: current.files };
    const message = history[index];
    const next: ComposerDraft = index === history.length ? original : {
      prompt: requestText(message), sources: historyImageAttachments(message.attachments?.sourceAssets), references: historyImageAttachments(message.attachments?.referenceAssets),
      files: message.attachments?.fileAttachments || [], history: { index, original }
    };
    for (const field of ["prompt", "sources", "references", "files", "history"] as const) entry.touched.add(field);
    entry.dirty = true;
    entry.value = next; notify();
    void persist(key, entry).catch(error => report(entry, error));
    return next.prompt;
  }, [key, entry]);
  const consume = useCallback((submitted: string) => {
    if (entry.value.prompt.trim() !== submitted.trim()) return;
    // A submit can wait for validation/import while the user adds another
    // attachment. Only consume the input captured by that submit's render.
    if (entry.value.sources !== draft.sources || entry.value.references !== draft.references || entry.value.files !== draft.files) return;
    entry.dirty = true;
    entry.value = entry.value.history?.original || emptyDraft();
    for (const field of ["prompt", "sources", "references", "files", "history"] as const) entry.touched.add(field);
    notify(); void persist(key, entry).catch(error => report(entry, error));
  }, [key, entry, draft]);
  return {
    draft, error, navigateHistory, consume,
    setPrompt: useCallback((next: React.SetStateAction<string>) => update("prompt", next), [update]),
    setSources: useCallback((next: React.SetStateAction<ReferenceImage[]>) => update("sources", next), [update]),
    setReferences: useCallback((next: React.SetStateAction<ReferenceImage[]>) => update("references", next), [update]),
    setFiles: useCallback((next: React.SetStateAction<AgentFileAttachment[]>) => update("files", next), [update])
  };
}

export function requestHistory(messages: AgentMessage[]) {
  return messages.filter(isRequest).map(requestText);
}
function isRequest(message: AgentMessage) {
  return message.role === "user" && !message.hidden && message.meta !== "manual context"
    && !/^(manual-user-|drawing-gen-)/.test(message.id) && Boolean(message.content || message.pasteBlocks?.length);
}
function requestText(message: AgentMessage) {
  return [message.content, ...(message.pasteBlocks || []).map(block => block.text)].filter(Boolean).join("\n\n");
}

export function historyAtBoundary(text: string, start: number, end: number, direction: "ArrowUp" | "ArrowDown") {
  return start === end && (!text.includes("\n") || (direction === "ArrowUp" ? start === 0 : end === text.length));
}
