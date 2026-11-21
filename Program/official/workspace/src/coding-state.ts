import type { CodingState } from "./coding-types";

export type CodingOperationError = { message: string; operation: string; submissionId?: string; runtimeId?: string; revision: number };
export function codingOperationRecovered(state: CodingState, failure: CodingOperationError) {
  if (failure.operation === "send") return Boolean(failure.submissionId && state.submissions?.some(item => item.id === failure.submissionId && item.status === "accepted"));
  return failure.operation === "status" && state.ok && !state.error && Boolean(state.runtimeId) &&
    (state.runtimeId !== failure.runtimeId || (state.revision || 0) > failure.revision);
}

// Native revisions increase across session replacements in one host process.
// A full status response may arrive after a newer stream delta: keep the newer
// state, but use its older history as the base if the view has not received one.
export function mergeCodingState(current: CodingState, next: CodingState): CodingState {
  const sameRuntime = current.runtimeId === next.runtimeId;
  const older = Boolean(current.runtimeId && next.runtimeId) && (next.revision || 0) < (current.revision || 0);
  const mergeItems = (base: CodingState, update: CodingState) => {
    const changed = new Map((update.items || []).map(item => [item.id, item]));
    const items = (base.items || []).map(item => { const value = changed.get(item.id); changed.delete(item.id); return value || item; });
    return [...items, ...changed.values()].slice(-240);
  };
  if (older) {
    if (sameRuntime && current.itemsDelta && !next.itemsDelta) return { ...current, items: mergeItems(next, current), itemsDelta: false };
    return current;
  }
  if (!next.itemsDelta) return next;
  return { ...next, items: mergeItems(sameRuntime ? current : { ok: true }, next), itemsDelta: sameRuntime ? current.itemsDelta ?? !current.runtimeId : true };
}

export function readExcludedReferences(projectId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`os-canvas:refs:${projectId}`) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}
