export const DRAG_MERGE_HOLD_MS = 280;
export const DRAG_MERGE_SLOP_PX = 12;
export type DragMergeIntent = { targetId: string; x: number; y: number; since: number };

/** Require a pause over one target; passing across it never means merge. */
export function updateDragMergeIntent(previous: DragMergeIntent | null, targetId: string, x: number, y: number, now: number): DragMergeIntent | null {
  if (!targetId) return null;
  if (previous?.targetId === targetId && Math.hypot(x - previous.x, y - previous.y) <= DRAG_MERGE_SLOP_PX) return previous;
  return { targetId, x, y, since: now };
}
export const dragMergeIntentReady = (intent: DragMergeIntent | null, now: number) => Boolean(intent && now - intent.since >= DRAG_MERGE_HOLD_MS);
