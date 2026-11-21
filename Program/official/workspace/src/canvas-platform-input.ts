// Keep document editors and ordinary inputs out of global canvas shortcuts.
export function canvasPlatformEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element && (element.isContentEditable ||
    element.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], .cm-editor")));
}
