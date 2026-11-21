import { validConversations, validMessages } from "./core";
import type { AgentConversation, AgentMessage, PendingAgentExecution, WorkflowSession } from "./core";
import {
  DATA_ARTIFACT_KINDS,
  FINANCE_ARTIFACT_KINDS,
  type LineageArtifactRecord,
  type LineageProjectKind,
  type LineageSessionFields
} from "./lineage-schema";

export type StudioLineageSession = LineageSessionFields & {
  sessionRevision: number;
  messages: AgentMessage[];
  conversations: AgentConversation[];
  activeConversationId: string;
  pendingAgentExecution: PendingAgentExecution | null;
};

export function normalizeLineageRendererSession(
  session: (WorkflowSession & { sessionRevision?: number }) | undefined,
  projectKind: LineageProjectKind,
  normalizePendingExecution: (value: unknown) => PendingAgentExecution | null
): StudioLineageSession {
  const source = session && typeof session === "object" ? session : {};
  const allowedKinds = new Set<string>(projectKind === "finance" ? FINANCE_ARTIFACT_KINDS : DATA_ARTIFACT_KINDS);
  const lineageArtifacts = (Array.isArray(source.lineageArtifacts) ? source.lineageArtifacts : []).filter((artifact): artifact is LineageArtifactRecord => (
    Boolean(artifact) &&
    typeof artifact === "object" &&
    typeof artifact.id === "string" &&
    artifact.id.length > 0 &&
    artifact.projectKind === projectKind &&
    allowedKinds.has(String(artifact.kind || ""))
  ));
  const artifactIds = new Set(lineageArtifacts.map((artifact) => artifact.id));
  const lineageEdges = (Array.isArray(source.lineageEdges) ? source.lineageEdges : []).filter((edge) => (
    Boolean(edge) &&
    artifactIds.has(String(edge.sourceArtifactId || "")) &&
    artifactIds.has(String(edge.targetArtifactId || "")) &&
    edge.sourceArtifactId !== edge.targetArtifactId
  ));
  const lineageLayout = (Array.isArray(source.lineageLayout) ? source.lineageLayout : []).filter((layout) => (
    Boolean(layout) && artifactIds.has(String(layout.artifactId || ""))
  ));
  const selectedLineageArtifactId = artifactIds.has(String(source.selectedLineageArtifactId || ""))
    ? String(source.selectedLineageArtifactId)
    : "";
  return {
    schemaVersion: 4,
    projectKind,
    lineageRevision: 1,
    sessionRevision: Math.max(0, Math.floor(Number(source.sessionRevision || 0))),
    messages: validMessages(source.messages),
    conversations: validConversations(source.conversations),
    activeConversationId: typeof source.activeConversationId === "string" ? source.activeConversationId : "",
    pendingAgentExecution: normalizePendingExecution(source.pendingAgentExecution),
    lineageArtifacts,
    lineageEdges,
    lineageLayout,
    lineageViewport: {
      x: Number.isFinite(Number(source.lineageViewport?.x)) ? Math.max(-400_000, Math.min(400_000, Number(source.lineageViewport?.x))) : 40,
      y: Number.isFinite(Number(source.lineageViewport?.y)) ? Math.max(-400_000, Math.min(400_000, Number(source.lineageViewport?.y))) : 40,
      scale: Number.isFinite(Number(source.lineageViewport?.scale)) ? Math.max(0.2, Math.min(2.5, Number(source.lineageViewport?.scale))) : 1
    },
    selectedLineageArtifactId
  };
}
