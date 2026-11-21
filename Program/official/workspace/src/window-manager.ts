import { createContext, useContext, useEffect, useState } from "react";

/**
 * Minimal window-manager state shared by dialog surfaces and the canvas
 * taskbar. A minimized dialog stays mounted but renders nothing, while its
 * entry lives here so the taskbar can restore or close it without losing the
 * dialog's own React state.
 */
export type MinimizedWindow = {
  id: string;
  title: string;
  restore: () => void;
  close: () => boolean;
};

let minimizedWindows: MinimizedWindow[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function registerMinimizedWindow(window: MinimizedWindow) {
  const existing = minimizedWindows.some((item) => item.id === window.id);
  minimizedWindows = existing
    ? minimizedWindows.map((item) => (item.id === window.id ? window : item))
    : [...minimizedWindows, window];
  emit();
}

export function unregisterMinimizedWindow(id: string) {
  const next = minimizedWindows.filter((item) => item.id !== id);
  if (next.length !== minimizedWindows.length) {
    minimizedWindows = next;
    emit();
  }
}

export function restoreMinimizedWindow(id: string) {
  const window = minimizedWindows.find((item) => item.id === id);
  if (window) {
    minimizedWindows = minimizedWindows.filter((item) => item.id !== id);
    emit();
    window.restore();
  }
}

export function closeMinimizedWindow(id: string) {
  const window = minimizedWindows.find((item) => item.id === id);
  if (window && window.close()) {
    minimizedWindows = minimizedWindows.filter((item) => item.id !== id);
    emit();
  }
}

export function useMinimizedWindows() {
  const [windows, setWindows] = useState<MinimizedWindow[]>(minimizedWindows);
  useEffect(() => {
    const listener = () => setWindows([...minimizedWindows]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return windows;
}

export const DialogMinimizeContext = createContext<{ minimize: () => void } | null>(null);

export function useDialogMinimize() {
  return useContext(DialogMinimizeContext);
}
