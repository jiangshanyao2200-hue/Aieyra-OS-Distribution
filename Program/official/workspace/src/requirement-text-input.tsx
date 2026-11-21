import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acceptMentionOnContinuation, matchesMention, mentionQueryAt, type MentionOption } from "./mention-input";

type ImageOption = MentionOption & { nodeId: string; previewSrc: string };

// The editor stays inside the resized note; only the suggestion list is outside
// the transformed canvas, so its size and position remain readable at any zoom.
export default function RequirementTextInput({ value, label, images, onChange, onMention, onFocus, onBlur }: {
  value: string; label: string; images: ImageOption[];
  onChange: (text: string) => void; onMention: (image: ImageOption) => void;
  onFocus: () => void; onBlur: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const [position, setPosition] = useState({ left: 12, top: 12, width: 300, height: 200 });
  const explicit = useRef(false);
  const query = focused ? mentionQueryAt(value, caret) : null;
  const queryKey = query ? `${query.start}:${query.end}:${query.prefix}` : "";
  const options = query ? images.filter(image => matchesMention(image, query.prefix)).slice(0, 24) : [];
  const active: ImageOption | undefined = options[Math.min(index, options.length - 1)];
  const open = Boolean(query && dismissed !== queryKey);
  const composition = useRef<{ before: string; query: typeof query; active: ImageOption | undefined; options: ImageOption[]; explicit: boolean } | null>(null);

  useLayoutEffect(() => { setIndex(0); explicit.current = false; }, [queryKey]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = input.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(330, window.innerWidth - 24);
      const height = Math.min(240, Math.max(80, window.innerHeight - 24));
      setPosition({ width, height, left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        top: box.bottom + height + 8 < window.innerHeight ? box.bottom + 6 : Math.max(12, box.top - height - 6) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  function commit(text: string, nextCaret: number) {
    onChange(text.slice(0, 24000)); setCaret(nextCaret);
    requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(nextCaret, nextCaret); });
  }
  function accept(image: ImageOption) {
    if (!query) return;
    const insertion = `@${image.code} `;
    commit(value.slice(0, query.start) + insertion + value.slice(query.end), query.start + insertion.length);
    onMention(image); setDismissed(queryKey);
  }
  function change(text: string, nextCaret: number, snapshot: NonNullable<typeof composition.current> = { before: value, query: open ? query : null, active, options, explicit: explicit.current }) {
    const accepted = acceptMentionOnContinuation(snapshot.before, text, snapshot.query, snapshot.options, snapshot.active, snapshot.explicit);
    if (accepted) {
      const code = accepted.text.slice(snapshot.query!.start).match(/^@([^\s]+)/)?.[1];
      const image = snapshot.options.find(option => option.code === code);
      commit(accepted.text, accepted.caret); if (image) onMention(image);
    } else { onChange(text); setCaret(nextCaret); }
  }
  return <>
    <textarea ref={input} className="requirement-node-text" aria-label={label} value={value} maxLength={24000}
      placeholder="写下想做什么，用 @图片 指定参考内容。"
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
      onFocus={() => { setFocused(true); onFocus(); }} onBlur={() => { setFocused(false); onBlur(); }}
      onSelect={event => setCaret(event.currentTarget.selectionStart)}
      onCompositionStart={() => { composition.current = { before: value, query: open ? query : null, active, options, explicit: explicit.current }; }}
      onCompositionEnd={event => { const snapshot = composition.current; composition.current = null; if (snapshot) change(event.currentTarget.value, event.currentTarget.selectionStart, snapshot); }}
      onChange={event => { if (composition.current || (event.nativeEvent as InputEvent).isComposing) { onChange(event.target.value); setCaret(event.target.selectionStart); }
        else change(event.target.value, event.target.selectionStart); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (!open || event.nativeEvent.isComposing || composition.current) return;
        if (event.key === "Escape") { event.preventDefault(); setDismissed(queryKey); }
        else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
          event.preventDefault(); explicit.current = true; setIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if ((event.key === "Enter" || event.key === "Tab") && active) { event.preventDefault(); accept(active); }
      }} />
    {open ? createPortal(<div className="requirement-mention-picker" role="listbox" aria-label="引用图片"
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.height }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onWheel={event => event.stopPropagation()}>
      {options.length ? options.map((image, i) => <button type="button" key={image.code} role="option" aria-selected={i === Math.min(index, options.length - 1)}
        data-image-mention={image.code} onClick={() => accept(image)}>
        <img src={image.previewSrc} alt="" loading="lazy" /><span><strong>@{image.code}</strong><small>{image.name || image.nodeTitle}</small></span>
      </button>) : <small>当前范围没有匹配的图片</small>}
    </div>, document.body) : null}
  </>;
}
