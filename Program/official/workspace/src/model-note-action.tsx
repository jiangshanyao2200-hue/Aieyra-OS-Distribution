import { useId, useState } from "react";
import { MessageSquareText } from "./studio-icons-lazy";
import { Check, X } from "./studio-icons";
import { IconActionButton } from "./ui";

/** Optional model guidance stays out of the list until the user asks to edit it. */
export function ModelNoteAction({ model, value, disabled = false, onChange }: {
  model: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const save = () => { onChange(draft); setOpen(false); };
  return <>
    <IconActionButton id={`${id}-trigger`} className={`model-note-action${value.trim() ? " has-note" : ""}`}
      label={`${model} 备注`} title={value.trim() || "添加备注"}
      icon={<MessageSquareText size={15} />} disabled={disabled}
      aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => {
        if (open) save();
        else { setDraft(value); setOpen(true); }
      }} />
    {open ? <div className="model-note-editor" id={id} data-escape-local
      onBlur={event => {
        if ((event.relatedTarget as HTMLElement | null)?.id === `${id}-trigger`) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) save();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault(); document.getElementById(`${id}-trigger`)?.focus(); setOpen(false);
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
          event.preventDefault(); save();
        }
      }}>
      <textarea autoFocus rows={2} maxLength={240} value={draft} disabled={disabled}
        aria-label={`${model} 的备注`} placeholder="例如：适合角色一致性、文字海报…"
        onChange={event => setDraft(event.target.value)} />
      <div className="model-note-editor-actions">
        <small>{draft.length}/240</small>
        <IconActionButton label="取消备注编辑" icon={<X size={14} />} onClick={() => setOpen(false)} />
        <IconActionButton label="完成备注编辑" icon={<Check size={14} />} onClick={save} />
      </div>
    </div> : null}
  </>;
}
