import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MessageSquareReply, Trash2, X } from "./studio-icons";
import { IconActionButton } from "./ui";

export type NodeNoteDraft = {
  nodeId: string;
  assetIndex?: number;
  anchor: HTMLElement;
  point: { x: number; y: number };
  note: string;
};

export function NodeNotePopover({ draft, save, close }: {
  draft: NodeNoteDraft;
  save: (note: string) => void;
  close: () => void;
}) {
  const [note, setNote] = useState(draft.note);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ note, save, close });
  latest.current = { note, save, close };

  useLayoutEffect(() => {
    let frame = 0;
    const positionPanel = () => {
      if (!draft.anchor.isConnected) { latest.current.close(); return; }
      const box = panel.current?.getBoundingClientRect();
      if (box) {
        const left = Math.max(12, Math.min(draft.point.x, window.innerWidth - box.width - 12));
        const top = Math.max(12, Math.min(draft.point.y + 8, window.innerHeight - box.height - 12));
        setPosition(previous => previous.left === left && previous.top === top && previous.ready ? previous : { left, top, ready: true });
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(positionPanel); };
    positionPanel();
    const observer = new ResizeObserver(schedule);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [draft]);

  useLayoutEffect(() => {
    if (!position.ready) return;
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(draft.note.length, draft.note.length);
  }, [position.ready, draft.note]);

  return createPortal(
    <div
      ref={panel}
      className="node-note-popover"
      role="dialog"
      aria-label="节点便签"
      style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") event.preventDefault();
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
          event.preventDefault(); save(note);
        }
      }}
    >
      <header>
        <span><MessageSquareReply size={14} />便签</span>
        <IconActionButton label="取消编辑便签" icon={<X size={14} />} onClick={close} />
      </header>
      <textarea ref={input} value={note} maxLength={500} rows={4} aria-label="便签备注" placeholder="添加备注…" onChange={event => setNote(event.target.value)} />
      <footer>
        <small>{note.length}/500</small>
        <span>
          <IconActionButton label="删除便签" icon={<Trash2 size={14} />} disabled={!draft.note} onClick={() => save("")} />
          <IconActionButton label="保存便签" icon={<Check size={15} />} onClick={() => save(note)} />
        </span>
      </footer>
    </div>,
    document.body
  );
}
