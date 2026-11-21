import { useEffect, useState } from "react";
import type { CodingState } from "./coding-types";
import { ButtonBase } from "./ui";

import { workspaceActivity } from "./coding-activity";

export function WorkspaceBrand({ state, drawingCount, openChat }: { state: CodingState; drawingCount: number; openChat: () => void }) {
  const message = workspaceActivity(state, drawingCount);
  return <ButtonBase className={`titlebar-brand workspace-brand${message ? " is-working" : ""}${state.status === "error" ? " is-error" : ""}`}
    data-activity={message ? "working" : "idle"} aria-label={message || "Aieyra Workspace"} title={message || "Aieyra Workspace"} onClick={openChat}>
    <img className="titlebar-brand-icon" src="./aieyra-workspace.png" alt="" draggable={false} />
    <span className="workspace-brand-copy"><strong className="workspace-brand-name" aria-hidden={Boolean(message)}>Aieyra Workspace</strong>
      <strong className="workspace-brand-activity" aria-hidden={!message}><span key={message}>{message}</span></strong></span>
    <span className="sr-only" role="status" aria-live="polite">{message || "Aieyra Workspace"}</span>
  </ButtonBase>;
}

const chatWidthKey = "aieyra:workspace:chat-width";
export function useWorkspaceChatWidth() {
  const [preferred, setPreferred] = useState(() => {
    try { const saved = Number(localStorage.getItem(chatWidthKey)); if (saved >= 320 && saved <= 880) return saved; } catch { /* Optional layout preference. */ }
    return 400;
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const [resizing, setResizing] = useState(false);
  useEffect(() => { const resize = () => setViewport(window.innerWidth); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useEffect(() => { if (resizing) return; try { localStorage.setItem(chatWidthKey, String(preferred)); } catch { /* Keep the in-memory layout usable. */ } }, [preferred, resizing]);
  const max = Math.max(1, Math.min(880, Math.floor(viewport / 2)));
  return { width: Math.min(preferred, max), max, resizing, setResizing, setWidth: (value: number) => setPreferred(Math.max(Math.min(320, max), Math.min(max, value))) };
}
