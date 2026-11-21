import {
  agentTaskScopeSnapshotHash,
  mimeTypeFromPath,
  normalizeFeedbackScore,
  stableImageAssetId
} from "./core.ts";
import { imageContainerKindForNode, nodeUsesImageContainer } from "./image-container.ts";
import type {
  AgentTaskResultPolicy,
  AgentTaskScope,
  AgentTaskScopeType,
  AgentTaskMention,
  AssetTaskRole,
  ReferenceImage,
  TaskAssetReference,
  WorkflowNode
} from "./core.ts";

import type { ResolvedTaskImageAttachments } from "./task-image-attachments.ts";

type AssetReferenceReader = (
  node: WorkflowNode,
  role?: AssetTaskRole,
  includeUnassigned?: boolean,
  respectProjectedRoles?: boolean
) => TaskAssetReference[];

export function buildAgentTaskScope({
  sourceNodes,
  references,
  referenceContainer,
  origin = "chat",
  canvasRevision = 0,
  requirementNode,
  requirementSourceSignature,
  explicitNodeRoles = {},
  options = {},
  readAssets
}: {
  sourceNodes: WorkflowNode[];
  references: ReferenceImage[];
  referenceContainer?: WorkflowNode | null;
  origin?: AgentTaskScope["origin"];
  canvasRevision?: number;
  requirementNode?: WorkflowNode | null;
  requirementSourceSignature?: string;
  explicitNodeRoles?: Readonly<Record<string, AssetTaskRole>>;
  options?: {
    contextNodeIds?: string[];
    contextAssets?: TaskAssetReference[];
    explicitMentions?: AgentTaskMention[];
    inputPurposes?: Readonly<Record<string, string>>;
    completeNodeIds?: string[];
    attachments?: ResolvedTaskImageAttachments;
  };
  readAssets: AssetReferenceReader;
}): AgentTaskScope {
  const eligibleImageNodes = sourceNodes.filter((node) => node.type === "image");
  // A reusable note describes one composition. Its connected images are inputs
  // for the model to interpret, not an instruction to generate once per image.
  const explicitRoleFor = (node: WorkflowNode) => requirementNode?.requirement ? "reference" as const : explicitNodeRoles[node.id];
  const completeNodeIds = new Set((options.completeNodeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const resolvedMentions = (options.explicitMentions || []).filter((mention) => mention.ambiguous !== true);
  const mentionedNodeIds = new Set(resolvedMentions
    .filter((mention) => mention.kind === "node")
    .map((mention) => mention.nodeId));
  const assetMentionsByNode = new Map<string, AgentTaskMention[]>();
  for (const mention of resolvedMentions) {
    if (mention.kind !== "asset") continue;
    const mentions = assetMentionsByNode.get(mention.nodeId) || [];
    mentions.push(mention);
    assetMentionsByNode.set(mention.nodeId, mentions);
  }
  const sourceAssetsForNode = (node: WorkflowNode) => {
    const assets = readAssets(node, "source", true, explicitRoleFor(node) === undefined);
    const withPurpose = (items: TaskAssetReference[]) => items.map((asset) => ({
      ...asset,
      purpose: options.inputPurposes?.[node.id] || options.inputPurposes?.[asset.ownerNodeId || ""] || asset.purpose,
    }));
    if (mentionedNodeIds.has(node.id) || completeNodeIds.has(node.id)) return withPurpose(assets);
    const mentions = assetMentionsByNode.get(node.id);
    if (!mentions?.length) return withPurpose(assets);
    return withPurpose(assets.filter((asset) => mentions.some((mention) => {
      if (mention.bindingId) return asset.bindingId === mention.bindingId;
      if (Number.isInteger(mention.assetIndex)) return Number(asset.assetIndex) === Number(mention.assetIndex);
      return Boolean(mention.assetId && asset.assetId === mention.assetId);
    })));
  };
  const referenceRoleNodes = eligibleImageNodes.filter((node) => explicitRoleFor(node) === "reference" || (
    !explicitRoleFor(node) && readAssets(node, "reference", false).length > 0
  ));
  const eligibleSourceNodes = eligibleImageNodes.filter((node) => explicitRoleFor(node) === "source" || (
    !explicitRoleFor(node) && readAssets(node, "source", true).length > 0
  ));
  // Selection now contains explicit checked inputs only.
  const sourceNodesForScope = [...new Map([...eligibleSourceNodes, ...(options.attachments?.sourceNodes || [])].map(node => [node.id, node])).values()];
  const sourceNodeIds = [...new Set(sourceNodesForScope.map((node) => node.id).filter(Boolean))];
  const taskAssetIdentity = (item: TaskAssetReference, index = 0) => item.bindingId
    ? `binding-id:${item.bindingId}`
    : item.occurrenceId
      ? `occurrence:${item.occurrenceId}`
      : item.nodeId && Number.isInteger(item.assetIndex)
        ? `binding:${item.role}:${item.nodeId}:${item.assetIndex}`
        : item.contentHash
          ? `content:${item.contentHash}`
          : item.relativePath
            ? `relative:${item.relativePath.replace(/\\/g, "/").toLowerCase()}`
            : item.path
              ? `path:${item.path.replace(/\\/g, "/").toLowerCase()}`
              : item.assetId
                ? `id:${item.assetId}`
                : item.assetUrl
                  ? `url:${item.assetUrl}`
                  : `slot:${item.nodeId || item.containerId || "asset"}:${item.assetIndex ?? index}`;
  const uniqueTaskAssets = (items: TaskAssetReference[]) => {
    const seen = new Set<string>();
    return items.filter((item, index) => {
      const key = taskAssetIdentity(item, index);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const allSourceAssets = uniqueTaskAssets([...eligibleSourceNodes.flatMap(sourceAssetsForNode), ...(options.attachments?.sourceAssets || [])]);
  const sourceAssetCount = allSourceAssets.length;
  const sourceAssets = allSourceAssets.slice(0, 200);
  const stagedReferenceAssets = options.attachments?.referenceAssets ?? (referenceContainer ? readAssets(referenceContainer, "reference", true) : references).map((reference, index): TaskAssetReference => {
    const stagedMetadata = references.find((candidate) =>
      Boolean(candidate.occurrenceId && reference.occurrenceId && candidate.occurrenceId === reference.occurrenceId) ||
      Boolean(candidate.contentHash && reference.contentHash && candidate.contentHash === reference.contentHash) ||
      Boolean(candidate.assetId && reference.assetId && candidate.assetId === reference.assetId) ||
      Boolean(candidate.relativePath && reference.relativePath && candidate.relativePath === reference.relativePath) ||
      Boolean(candidate.path && reference.path && candidate.path === reference.path)
    ) ?? references[index];
    const requestedRole = String(stagedMetadata?.role || "").trim();
    const referenceRole = requestedRole && !["source", "reference", "edit_target"].includes(requestedRole.toLowerCase())
      ? requestedRole
      : undefined;
    return {
      bindingId: "bindingId" in reference && reference.bindingId
        ? reference.bindingId
        : `binding:${referenceContainer?.id || "chat-reference"}:${referenceContainer?.id || "attachment"}:${reference.occurrenceId || index}:${reference.assetId || index + 1}`,
      assetId: reference.assetId || stableImageAssetId({ contentHash: reference.contentHash, path: reference.path, relativePath: reference.relativePath, assetUrl: reference.assetUrl, originalName: reference.name }, index + 1),
      occurrenceId: reference.occurrenceId,
      importBatchId: reference.importBatchId,
      importRootId: reference.importRootId,
      sourceRelativePath: reference.sourceRelativePath,
      sourceRootLabel: reference.sourceRootLabel,
      sourceRootKind: reference.sourceRootKind,
      displayCode: reference.displayCode || `REF${index + 1}`,
      contentHash: reference.contentHash,
      role: "reference",
      name: reference.name || `参考图 ${index + 1}`,
      assetIndex: "assetIndex" in reference ? reference.assetIndex : index,
      containerSlot: "containerSlot" in reference ? reference.containerSlot : ("assetIndex" in reference ? reference.assetIndex : index),
      ownerAssetIndex: "ownerAssetIndex" in reference ? reference.ownerAssetIndex : ("assetIndex" in reference ? reference.assetIndex : index),
      ownerNodeId: "ownerNodeId" in reference ? reference.ownerNodeId : referenceContainer?.id,
      nodeId: referenceContainer?.id || ("nodeId" in reference ? reference.nodeId : undefined),
      containerId: referenceContainer?.id,
      path: reference.path,
      relativePath: reference.relativePath,
      assetUrl: reference.assetUrl,
      mimeType: reference.mimeType || mimeTypeFromPath(reference.path),
      purpose: stagedMetadata?.purpose,
      referenceRole,
      feedbackScore: normalizeFeedbackScore(reference.feedbackScore)
    };
  });
  const referenceNodeAssets = referenceRoleNodes.flatMap((node) => {
    const mentions = assetMentionsByNode.get(node.id);
    const assets = readAssets(node, "reference", true, explicitRoleFor(node) === undefined)
      .filter((asset) => completeNodeIds.has(node.id) || !mentions?.length || mentions.some((mention) => {
        if (mention.bindingId) return asset.bindingId === mention.bindingId;
        if (Number.isInteger(mention.assetIndex)) return Number(asset.assetIndex) === Number(mention.assetIndex);
        return Boolean(mention.assetId && asset.assetId === mention.assetId);
      }));
    return assets.map((asset) => ({
      ...asset,
      purpose: options.inputPurposes?.[node.id] || options.inputPurposes?.[asset.ownerNodeId || ""] || asset.purpose,
    }));
  });
  const allReferenceAssets = uniqueTaskAssets([...stagedReferenceAssets, ...referenceNodeAssets]);
  const referenceAssets = allReferenceAssets.slice(0, 40);
  const sourceNodeIdSet = new Set(sourceNodeIds);
  const contextNodeIds = [...new Set([
    ...(options.contextNodeIds || [])
  ].map((id) => String(id || "").trim()).filter((id) => Boolean(id) && !sourceNodeIdSet.has(id)))].slice(0, 200);
  const sourceAssetIdentities = new Set(allSourceAssets.map((asset, index) => taskAssetIdentity(asset, index)));
  const contextAssets = uniqueTaskAssets([
    ...(options.contextAssets || [])
  ]).filter((asset, index) => !sourceAssetIdentities.has(taskAssetIdentity(asset, index))).slice(0, 200);
  const sourceContainerIds = [...new Set([
    ...sourceNodesForScope.filter((node) => nodeUsesImageContainer(node)).map((node) => node.id),
    ...sourceAssets.map((asset) => asset.containerId || "")
  ].filter(Boolean))];
  const referenceContainerIds = [...new Set([
    ...(referenceContainer ? [referenceContainer.id] : []),
    ...referenceRoleNodes.filter((node) => nodeUsesImageContainer(node)).map((node) => node.id),
    ...referenceAssets.map((asset) => asset.containerId || "")
  ].filter(Boolean))];
  const layerGroupIds = new Set(sourceNodesForScope.map((node) => node.layerGroup?.id || "").filter(Boolean));
  const hasLayer = sourceNodesForScope.some((node) => Boolean(node.layerGroup || node.layerComposition));
  const containerKinds = sourceNodesForScope.map((node) => imageContainerKindForNode(node)).filter(Boolean);
  const hasContainerGroup = containerKinds.includes("container-group");
  const hasContainer = containerKinds.length > 0;
  const scopeType: AgentTaskScopeType = sourceNodesForScope.length === 0
    ? "none"
    : hasLayer && hasContainer
      ? "mixed"
      : hasLayer
        ? sourceNodesForScope.length > 1 && layerGroupIds.size === 1 ? "layer-group" : "layer"
        : hasContainerGroup
          ? "container-group"
          : hasContainer
            ? "container"
            : allSourceAssets.length > 1 || sourceNodesForScope.length > 1
              ? "multi-source"
              : "single";
  const resultPolicy: AgentTaskResultPolicy = scopeType === "layer" || scopeType === "layer-group"
    ? "layer-variants"
    : scopeType === "container-group"
      ? "grouped-by-container"
      : allSourceAssets.length > 1 || sourceNodesForScope.length > 1
        ? "grouped-by-source"
        : "single";
  const confirmationPolicy = scopeType === "container-group"
    ? "preview-3" as const
    : allSourceAssets.length > 10
      ? "staged" as const
      : "auto" as const;
  const requirement = requirementNode?.type === "requirement" && requirementNode.requirement
    ? { nodeId: requirementNode.id, revision: requirementNode.requirement.revision, sourceSignature: requirementSourceSignature }
    : undefined;
  const scopeWithoutHash: Omit<AgentTaskScope, "snapshotHash"> = {
    version: 2,
    origin,
    scopeType,
    canvasRevision: Math.max(0, Math.floor(Number(canvasRevision) || 0)),
    sourceNodeIds,
    sourceContainerIds,
    referenceContainerIds,
    sourceBindingIds: [...new Set(sourceAssets.map((asset) => asset.bindingId || "").filter(Boolean))],
    referenceBindingIds: [...new Set(referenceAssets.map((asset) => asset.bindingId || "").filter(Boolean))],
    sourceAssets,
    referenceAssets,
    contextNodeIds,
    contextAssets,
    explicitMentions: (options.explicitMentions || []).map((mention) => ({ ...mention, feedbackScore: normalizeFeedbackScore(mention.feedbackScore) })),
    resultPolicy,
    confirmationPolicy,
    requirement,
    sourceAssetCount,
    referenceAssetCount: allReferenceAssets.length,
    truncated: sourceAssetCount > sourceAssets.length || allReferenceAssets.length > referenceAssets.length
  };
  return { ...scopeWithoutHash, snapshotHash: agentTaskScopeSnapshotHash(scopeWithoutHash) };
}
