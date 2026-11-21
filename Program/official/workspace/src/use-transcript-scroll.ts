import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Follow intent is separate from measured distance: streamed content changes
// the distance before ResizeObserver runs and must not look like user scrolling.
export function useTranscriptScroll(scope: string, open: boolean, layoutKey: boolean) {
  const listRef = useRef<HTMLDivElement>(null), contentRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true), lastTop = useRef(0), userScrollUntil = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const latest = useCallback(() => {
    follow.current = true;
    const list = listRef.current;
    if (list) { list.scrollTop = list.scrollHeight; lastTop.current = list.scrollTop; }
    setAtBottom(true);
  }, []);
  const preserve = useCallback(() => { follow.current = false; }, []);
  useLayoutEffect(() => { follow.current = true; lastTop.current = 0; userScrollUntil.current = 0; setAtBottom(true); }, [scope]);
  useLayoutEffect(() => {
    const list = listRef.current, content = contentRef.current;
    if (!list || !content || !open) return;
    const heldPointers = new Set<number>();
    const update = () => {
      if (follow.current) { list.scrollTop = list.scrollHeight; lastTop.current = list.scrollTop; }
      setAtBottom(list.scrollHeight - list.clientHeight - list.scrollTop < 32);
    };
    const intent = (event: Event) => {
      if (event instanceof WheelEvent && event.deltaY < 0) follow.current = false;
      if (event instanceof KeyboardEvent && ["ArrowUp", "PageUp", "Home"].includes(event.key)) follow.current = false;
      userScrollUntil.current = Date.now() + 1500;
    };
    const scroll = () => {
      const bottom = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
      if (heldPointers.size || Date.now() < userScrollUntil.current) {
        if (list.scrollTop < lastTop.current - 1) follow.current = false;
        if (bottom) follow.current = true;
      }
      lastTop.current = list.scrollTop;
      setAtBottom(bottom);
    };
    const pointerDown = (event: PointerEvent) => { heldPointers.add(event.pointerId); intent(event); };
    const pointerUp = (event: PointerEvent) => { heldPointers.delete(event.pointerId); userScrollUntil.current=Date.now()+1500; };
    const blur = () => heldPointers.clear();
    list.addEventListener("wheel", intent, { passive: true });
    list.addEventListener("touchstart", intent, { passive: true });
    list.addEventListener("touchmove", intent, { passive: true });
    list.addEventListener("pointerdown", pointerDown, { passive: true });
    window.addEventListener("pointerup", pointerUp, { passive: true });
    window.addEventListener("pointercancel", pointerUp, { passive: true });
    window.addEventListener("blur", blur);
    list.addEventListener("keydown", intent);
    list.addEventListener("scroll", scroll, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(content); observer.observe(list);
    update();
    return () => {
      observer.disconnect();
      for (const name of ["wheel", "touchstart", "touchmove", "keydown"]) list.removeEventListener(name, intent);
      list.removeEventListener("pointerdown",pointerDown);
      window.removeEventListener("pointerup",pointerUp);
      window.removeEventListener("pointercancel",pointerUp);
      window.removeEventListener("blur",blur);
      list.removeEventListener("scroll", scroll);
    };
  }, [scope, open, layoutKey]);
  return { listRef, contentRef, atBottom, latest, preserve };
}
