import type { WorkspaceRuntimeStatus } from "./core";

// Main sends monotonic revisions so an older status response cannot replace a
// completed initialization or a newer recovery result.
export function reduceWorkspaceRuntimeStatus(current: WorkspaceRuntimeStatus, incoming: WorkspaceRuntimeStatus) {
  const previous = current.revision ?? -1;
  const next = incoming.revision ?? previous;
  return next < previous ? current : incoming;
}
