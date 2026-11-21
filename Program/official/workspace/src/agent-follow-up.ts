import type { AgentFileAttachment, AgentTaskScope, ReferenceImage } from "./core.ts";
import { mergeAgentTaskScopes } from "./task-scope.ts";

export type QueuedAgentFollowUp = {
  summarizePreferences?: boolean;
  id: string;
  projectId: string;
  conversationId: string;
  projectKind: "agent" | "image" | "writing" | "data" | "finance";
  prompt: string;
  visiblePrompt: string;
  createdAt: string;
  selectedNodeIds?: string[];
  focusedNodeId?: string;
  sourceImages?: ReferenceImage[];
  referenceImages?: ReferenceImage[];
  fileAttachments?: AgentFileAttachment[];
  frozenTaskScope?: AgentTaskScope;
  selectedLineageArtifactId?: string;
};

export function mergeQueuedAgentFollowUps(queue: QueuedAgentFollowUp[], first: QueuedAgentFollowUp) {
  const items = first.summarizePreferences ? [first] : queue.filter(item => !item.summarizePreferences &&
    item.projectId === first.projectId && item.conversationId === first.conversationId && item.projectKind === first.projectKind);
  const ids = new Set(items.map(item => item.id));
  const unique = <T extends { path?: string; id?: string; assetId?: string }>(values: T[]) =>
    [...new Map(values.map(value => [value.id || value.assetId || value.path || JSON.stringify(value), value])).values()];
  const scopes = items.map(item => item.frozenTaskScope).filter((scope): scope is AgentTaskScope => Boolean(scope));
  return {
    ids,
    remaining: queue.filter(item => !ids.has(item.id)),
    merged: { ...first, ...items[items.length - 1], id: first.id,
      prompt: items.map(item => item.prompt).join("\n\n"),
      visiblePrompt: items.map(item => item.visiblePrompt).join("\n\n"),
      selectedNodeIds: [...new Set(items.flatMap(item => item.selectedNodeIds || []))],
      sourceImages: unique(items.flatMap(item => item.sourceImages || [])),
      referenceImages: unique(items.flatMap(item => item.referenceImages || [])),
      fileAttachments: unique(items.flatMap(item => item.fileAttachments || [])),
      frozenTaskScope: scopes.length ? scopes.reduce(mergeAgentTaskScopes) : undefined
    } satisfies QueuedAgentFollowUp
  };
}
