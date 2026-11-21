import { useEffect, useState } from "react";
import { Check, Download, RotateCcw } from "./studio-icons";
import { ActionButton, CodeField, DialogShell, StatusLine, SurfaceBody, SurfaceFooter, SurfaceHeader, } from "./ui";
const CLOSE_BUTTON_REASON = "close-button" as const;
const WHEN_IDLE = "when-idle" as const;
const WHEN_IDLE_AND_CLEAN = "when-idle-and-clean" as const;
function mergeConcurrentFastMemory(baseText: string, localText: string, remoteText: string) {
    const base = baseText.trim();
    const local = localText.trim();
    const remote = remoteText.trim();
    if (local === base)
        return remote;
    if (remote === base || !remote)
        return local;
    const chunks = (value: string) => value.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
    const baseChunks = new Set(chunks(base));
    const localChunks = new Set(chunks(local));
    const remoteAdditions = chunks(remote).filter((item) => !baseChunks.has(item) && !localChunks.has(item));
    return [local, ...remoteAdditions].filter(Boolean).join("\n\n");
}
export default function AgentTextEditorDialog({ kind, projectId = "", conversationId = "", close, }: {
    kind: "prompt" | "knowledge" | "fastmemory";
    projectId?: string;
    conversationId?: string;
    close: () => void;
}) {
    const isPrompt = kind === "prompt";
    const isKnowledge = kind === "knowledge";
    const memoryScope = "project" as const;
    const editorTitle = isPrompt ? "编辑 Agent 提示词" : isKnowledge ? "基础知识库" : "编辑 Agent 经验";
    const contentLabel = isPrompt ? "Agent 提示词" : isKnowledge ? "基础知识" : "项目经验";
    const [draft, setDraft] = useState("");
    const [savedText, setSavedText] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [messageError, setMessageError] = useState(false);
    const [maxChars, setMaxChars] = useState(isPrompt ? 120000 : isKnowledge ? 40000 : 80000);
    const [loadedUpdatedAt, setLoadedUpdatedAt] = useState("");
    const [isDefault, setIsDefault] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [discardArmed, setDiscardArmed] = useState(false);
    const dirty = draft !== savedText;
    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setMessage("");
            setMessageError(false);
            setConfirmReset(false);
            setDiscardArmed(false);
            try {
                if (!window.aieyraAgent)
                    throw new Error("Agent 配置服务未就绪。");
                const result = isPrompt
                    ? await window.aieyraAgent.getMainPrompt()
                    : isKnowledge
                        ? await window.aieyraAgent.getKnowledgeBase()
                        : await window.aieyraAgent.getFastMemory({ projectId, conversationId, scope: memoryScope });
                if (!result.ok)
                    throw new Error(result.error || `${contentLabel}读取失败。`);
                if (cancelled)
                    return;
                const text = String(result.text || "");
                setDraft(text);
                setSavedText(text);
                setMaxChars(Math.max(1, Number(result.maxChars || (isPrompt ? 120000 : isKnowledge ? 40000 : 80000))));
                setLoadedUpdatedAt(isPrompt || isKnowledge ? "" : String("updatedAt" in result ? result.updatedAt || "" : ""));
                setIsDefault((isPrompt || isKnowledge) && "isDefault" in result ? result.isDefault === true : false);
            }
            catch (error) {
                if (cancelled)
                    return;
                setMessage(error instanceof Error ? error.message : String(error));
                setMessageError(true);
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [contentLabel, conversationId, isKnowledge, isPrompt, projectId, memoryScope]);
    async function save() {
        const text = draft.trim();
        if (!text || saving || !window.aieyraAgent)
            return;
        setSaving(true);
        setMessage("");
        setMessageError(false);
        try {
            const result = isPrompt
                ? await window.aieyraAgent.saveMainPrompt({ text: draft })
                : isKnowledge
                    ? await window.aieyraAgent.saveKnowledgeBase({ text: draft })
                    : await window.aieyraAgent.saveFastMemory({ projectId, conversationId, scope: memoryScope, text: draft, expectedUpdatedAt: loadedUpdatedAt });
            if (!isPrompt && !isKnowledge && "conflict" in result && result.conflict) {
                const remoteText = String(result.text || "");
                const mergedText = mergeConcurrentFastMemory(savedText, draft, remoteText).slice(0, maxChars);
                setDraft(mergedText);
                setSavedText(remoteText);
                setLoadedUpdatedAt(String(result.updatedAt || ""));
                setMessage(mergedText === remoteText
                    ? "Agent 在编辑期间更新了经验，已载入最新内容。"
                    : "Agent 在编辑期间新增了经验，新增内容已合并；请检查后再次保存。");
                setMessageError(false);
                return;
            }
            if (!result.ok)
                throw new Error(result.error || `${contentLabel}保存失败。`);
            const nextText = String(result.text ?? draft);
            setDraft(nextText);
            setSavedText(nextText);
            if (!isPrompt && !isKnowledge)
                setLoadedUpdatedAt(String("updatedAt" in result ? result.updatedAt || "" : ""));
            setIsDefault((isPrompt || isKnowledge) && "isDefault" in result ? result.isDefault === true : false);
            setDiscardArmed(false);
            setMessage(isPrompt ? "提示词已保存，下一轮 Agent 请求开始生效。" : isKnowledge ? "基础知识库已保存，下一轮 Agent 请求开始生效。" : "当前项目的 Agent 经验已保存。");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            setMessageError(true);
        }
        finally {
            setSaving(false);
        }
    }
    async function reset() {
        if (!confirmReset) {
            setConfirmReset(true);
            setMessage(isPrompt ? "再次点击“恢复默认”确认覆盖当前提示词。" : isKnowledge ? "再次点击“恢复默认”确认覆盖当前基础知识库。" : "再次点击“清空经验”确认只清空当前项目的 Agent 经验。");
            setMessageError(false);
            return;
        }
        if (saving || !window.aieyraAgent)
            return;
        setSaving(true);
        setMessage("");
        setMessageError(false);
        try {
            const result = isPrompt
                ? await window.aieyraAgent.resetMainPrompt()
                : isKnowledge
                    ? await window.aieyraAgent.resetKnowledgeBase()
                    : await window.aieyraAgent.resetFastMemory({ projectId, conversationId, scope: memoryScope, expectedUpdatedAt: loadedUpdatedAt });
            if (!isPrompt && !isKnowledge && "conflict" in result && result.conflict) {
                const remoteText = String(result.text || "");
                const mergedText = mergeConcurrentFastMemory(savedText, draft, remoteText).slice(0, maxChars);
                setDraft(mergedText);
                setSavedText(remoteText);
                setLoadedUpdatedAt(String(result.updatedAt || ""));
                setConfirmReset(false);
                setMessage("Agent 在编辑期间更新了经验，已合并最新内容；请检查后再次清空。");
                setMessageError(false);
                return;
            }
            if (!result.ok)
                throw new Error(result.error || (isPrompt ? "默认提示词恢复失败。" : isKnowledge ? "默认基础知识库恢复失败。" : "Agent 经验清空失败。"));
            const nextText = String(result.text || "");
            setDraft(nextText);
            setSavedText(nextText);
            setIsDefault(isPrompt || isKnowledge);
            if (!isPrompt && !isKnowledge)
                setLoadedUpdatedAt("");
            setConfirmReset(false);
            setDiscardArmed(false);
            setMessage(isPrompt ? "已恢复默认提示词。" : isKnowledge ? "已恢复默认基础知识库。" : "已清空当前项目的 Agent 经验。其他项目不受影响。");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            setMessageError(true);
        }
        finally {
            setSaving(false);
        }
    }
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void save();
            }
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    });
    function closeBlocked() {
        if (saving) {
            setMessage("正在保存，请稍候。");
            setMessageError(false);
            return;
        }
        if (dirty && !discardArmed) {
            setDiscardArmed(true);
            setMessage("有未保存修改。再次关闭将放弃这些修改。");
            setMessageError(true);
        }
    }
    async function exportKnowledge() {
        try {
            const result = await window.aieyraAgent?.exportKnowledgeBase({ text: draft });
            if (!result?.ok)
                throw new Error(result?.error || "导出失败，请重试。");
            if (!result.canceled) {
                setMessage("基础知识库已导出。");
                setMessageError(false);
            }
        }
        catch (error) {
            setMessage(String(error instanceof Error ? error.message : error));
            setMessageError(true);
        }
    }
    return (<DialogShell surface={isPrompt ? "agent-prompt-editor" : isKnowledge ? "agent-knowledge-editor" : "agent-memory-editor"} ariaLabel={editorTitle} className="agent-text-editor-dialog" layerClassName="agent-text-editor-layer" layerLevel={isKnowledge ? "dialog" : "nested"} busy={loading || saving} dirty={dirty} closePolicy={{
            escape: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
            backdrop: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
            [CLOSE_BUTTON_REASON]: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
            action: discardArmed ? WHEN_IDLE : WHEN_IDLE_AND_CLEAN,
        }} onRequestClose={close} onCloseBlocked={closeBlocked}>
      {({ requestClose }) => (<>
          <SurfaceHeader title={editorTitle} onClose={() => requestClose(CLOSE_BUTTON_REASON)} closeLabel="关闭编辑器" closeDisabled={loading || saving}/>
          <SurfaceBody className="agent-text-editor-body">
            <div className="agent-text-editor-meta">
              {isPrompt || isKnowledge ? <span>{isPrompt ? (isDefault ? "当前为默认提示词" : "当前为自定义提示词") : (isDefault ? "当前为默认基础知识" : "当前为自定义基础知识")}</span> : (<span>当前项目经验</span>)}
              <em>{draft.length.toLocaleString()} / {maxChars.toLocaleString()}</em>
            </div>
            <CodeField label={`${contentLabel}正文`} labelHidden fill fieldClassName="agent-text-editor-code-field" className="agent-text-editor-code-control" value={draft} onChange={(event) => {
                setDraft(event.target.value.slice(0, maxChars));
                setConfirmReset(false);
                setDiscardArmed(false);
                setMessage("");
            }} maxLength={maxChars} disabled={loading || saving} placeholder={isPrompt ? "编辑主 Agent 提示词…" : isKnowledge ? "编辑 Agent 按需参考的基础工作知识…" : "编辑当前项目工作中已验证的经验…"} autoFocus spellCheck={false}/>
            {message ? (<StatusLine tone={messageError ? "danger" : "success"} live={messageError ? "assertive" : "polite"}>
                {message}
              </StatusLine>) : null}
          </SurfaceBody>
          <SurfaceFooter className="agent-text-editor-footer" leading={<>
                {isKnowledge ? <ActionButton icon={<Download size={15}/>} onClick={() => void exportKnowledge()} disabled={loading || saving || !draft.trim()}>导出</ActionButton> : null}
                <ActionButton variant={confirmReset ? "danger" : "secondary"} onClick={() => void reset()} disabled={loading || saving} icon={<RotateCcw size={15}/>}>
                  {isPrompt || isKnowledge ? (confirmReset ? "确认恢复默认" : "恢复默认") : (confirmReset ? "确认清空经验" : "清空经验")}
                </ActionButton>
                <span className="agent-text-editor-dirty">{dirty ? "有未保存修改" : "已同步"}</span>
              </>}>
            <ActionButton onClick={() => requestClose("action")} disabled={loading || saving}>
              {discardArmed && dirty ? "确认放弃" : "关闭"}
            </ActionButton>
            <ActionButton variant="primary" onClick={() => void save()} busy={saving} disabled={loading || !draft.trim() || !dirty} icon={<Check size={15}/>}>
              保存
            </ActionButton>
          </SurfaceFooter>
        </>)}
    </DialogShell>);
}
