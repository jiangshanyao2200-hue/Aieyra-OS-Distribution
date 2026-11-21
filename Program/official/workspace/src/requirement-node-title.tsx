import { useRef, useState } from "react";

export function RequirementNodeTitle({ title, onSave }: { title: string; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const begin = () => { cancelled.current = false; setDraft(title); };
  const save = () => {
    setDraft(null);
    const next = draft?.trim() || title || "需求便签";
    if (!cancelled.current && next !== title) onSave(next);
  };
  return draft === null ? <strong className="requirement-node-title" tabIndex={0}
    aria-label={`需求名称：${title || "需求便签"}，双击或按 F2 编辑`} title="拖动移动 · 双击改名"
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); begin(); }}
    onKeyDown={event => {
      if (event.key !== "F2" && event.key !== "Enter") return;
      event.preventDefault(); event.stopPropagation(); begin();
    }}>{title || "需求便签"}</strong> : <input className="requirement-node-title" aria-label="需求名称"
    value={draft} maxLength={120} placeholder="需求便签" autoFocus onFocus={event => event.currentTarget.select()}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
    onChange={event => setDraft(event.target.value)} onBlur={save}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); save(); }
      if (event.key === "Escape") { event.preventDefault(); cancelled.current = true; setDraft(null); }
    }} />;
}
