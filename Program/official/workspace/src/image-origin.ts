import type { ImageAsset, WorkflowNode } from "./core.ts";

export type ImageOrigin = {
  nodeId: string;
  title: string;
  sourceNodeId?: string;
  sourceTitle?: string;
  requirementNodeId?: string;
  requirementRevision?: number;
};
export function sanitizeImageOrigin(value: unknown): ImageOrigin | undefined {
  if (!value || typeof value !== "object") return;
  const source = value as Partial<ImageOrigin>;
  const clean = (text: unknown) => typeof text === "string" ? text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) : "";
  const nodeId = clean(source.nodeId);
  if (!nodeId) return;
  return { nodeId, title: clean(source.title) || nodeId,
    ...(clean(source.sourceNodeId) ? { sourceNodeId: clean(source.sourceNodeId), sourceTitle: clean(source.sourceTitle) || clean(source.sourceNodeId) } : {}),
    ...(clean(source.requirementNodeId) ? { requirementNodeId: clean(source.requirementNodeId) } : {}),
    ...(Number.isSafeInteger(source.requirementRevision) && Number(source.requirementRevision) > 0 ? { requirementRevision: source.requirementRevision } : {}) };
}
export function imageOriginForAsset(asset: ImageAsset, node: WorkflowNode, nodes: readonly WorkflowNode[], index?: ReadonlyMap<string, WorkflowNode>): ImageOrigin {
  const existing = sanitizeImageOrigin(asset.origin);
  if (existing) return existing;
  const provenance = node.taskProvenance;
  const sourceNodeId = provenance?.sourceNodeId || provenance?.sourceContainerId || (node.relationType !== "grouped" ? node.parentId : undefined);
  return { nodeId: node.id, title: node.title || node.displayCode || node.id,
    ...(sourceNodeId ? { sourceNodeId, sourceTitle: (index ? index.get(sourceNodeId) : nodes.find(item => item.id === sourceNodeId))?.title || provenance?.sourceDisplayCode || sourceNodeId } : {}),
    ...(provenance?.requirementNodeId ? { requirementNodeId: provenance.requirementNodeId, requirementRevision: provenance.requirementRevision } : {}) };
}
export function preserveImageOrigins(node: WorkflowNode, nodes: readonly WorkflowNode[], index?: ReadonlyMap<string, WorkflowNode>): WorkflowNode {
  if (node.type !== "image" || !node.assets?.some(asset => !sanitizeImageOrigin(asset.origin))) return node;
  return { ...node, assets: node.assets.map(asset => sanitizeImageOrigin(asset.origin) ? asset : { ...asset, origin: imageOriginForAsset(asset, node, nodes, index) }) };
}
/** Build one lookup per snapshot; never cache an index across edits. */
export function preserveImageOriginsForNodes(nodes: readonly WorkflowNode[]): WorkflowNode[] {
  const index = new Map<string, WorkflowNode>();
  for (const node of nodes) if (!index.has(node.id)) index.set(node.id, node);
  return nodes.map(node => preserveImageOrigins(node, nodes, index));
}
