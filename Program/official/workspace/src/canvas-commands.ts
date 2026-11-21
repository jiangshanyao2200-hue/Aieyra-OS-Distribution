import type { WorkflowNode } from "./core";
import type { ImageLayoutGroup } from "./image-layout";
import { requirementInputBindings } from "./requirement-graph.ts";

export type CanvasSelectionExclusionReason = "layer" | "unsupported" | "empty" | "busy";

export type CanvasSelectionExclusion = {
  nodeId: string;
  reason: CanvasSelectionExclusionReason;
};

export type CanvasSelectionCapabilities = {
  layerVisibleCount: number;
  groupableNodeIds: string[];
  groupExcluded: CanvasSelectionExclusion[];
  deleteNodeIds: string[];
  deleteExcluded: CanvasSelectionExclusion[];
  selectedLayoutGroupIds: string[];
  selectedLayerGroupIds: string[];
  layerGroupRepresentativeIds: string[];
  preferredContainerHostId: string;
  canGroupIntoContainer: boolean;
  canDelete: boolean;
};

export type CanvasSuggestedActionId =
  | "create-image"
  | "ask-agent"
  | "arrange-canvas"
  | "merge-selection"
  | "arrange-selection"
  | "create-requirement"
  | "run-requirement"
  | "add-to-container";

export type CanvasSuggestedAction = {
  id: CanvasSuggestedActionId;
  label: string;
  reason: string;
};

const uniqueIds = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const isLayerNode = (node: WorkflowNode): boolean => Boolean(node.layerGroup || node.layerComposition);

const isBusyNode = (node: WorkflowNode): boolean =>
  node.status === "working" || node.imageState === "generating";

/** Expands visible selections to every persisted node that must move with them. */
export function expandCanvasSelectionNodeIds(
  nodes: readonly WorkflowNode[],
  layoutGroups: readonly ImageLayoutGroup[],
  selectedIds: readonly string[],
): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layoutByHost = new Map(layoutGroups.map((group) => [group.hostNodeId, group]));
  const layoutByMember = new Map<string, ImageLayoutGroup>();
  for (const group of layoutGroups) {
    for (const nodeId of group.memberNodeIds) layoutByMember.set(nodeId, group);
  }
  const expanded = new Set<string>();
  for (const requestedId of uniqueIds(selectedIds)) {
    const layout = layoutByHost.get(requestedId) ?? layoutByMember.get(requestedId);
    if (layout) {
      layout.memberNodeIds.forEach((id) => {
        if (nodeById.has(id)) expanded.add(id);
      });
      continue;
    }
    const node = nodeById.get(requestedId);
    if (!node) continue;
    if (node.layerGroup && !node.layerGroup.detached) {
      nodes
        .filter((candidate) => candidate.layerGroup?.id === node.layerGroup?.id)
        .forEach((candidate) => expanded.add(candidate.id));
      continue;
    }
    expanded.add(node.id);
  }
  return [...expanded];
}

/**
 * Returns a bounded, stable graph closure around the current work focus.
 * These nodes are observational context only and never become implicit SOURCE.
 */
export function relatedCanvasWorkflowNodeIds(
  nodes: readonly WorkflowNode[],
  layoutGroups: readonly ImageLayoutGroup[],
  focusNodeIds: readonly string[],
  options: { maxNodes?: number; maxDepth?: number } = {},
): string[] {
  const maxNodes = Math.max(1, Math.min(80, Math.floor(Number(options.maxNodes) || 48)));
  const maxDepth = Math.max(1, Math.min(8, Math.floor(Number(options.maxDepth) || 4)));
  const layoutByMember = new Map<string, ImageLayoutGroup>();
  for (const group of layoutGroups) {
    for (const id of group.memberNodeIds) layoutByMember.set(id, group);
  }
  const canonical = (id: string) => layoutByMember.get(id)?.hostNodeId || id;
  const available = new Set(nodes.map((node) => canonical(node.id)));
  const adjacency = new Map<string, Set<string>>();
  const link = (leftRaw: string, rightRaw: string) => {
    const left = canonical(String(leftRaw || ""));
    const right = canonical(String(rightRaw || ""));
    if (!left || !right || left === right || !available.has(left) || !available.has(right)) return;
    const leftSet = adjacency.get(left) ?? new Set<string>();
    const rightSet = adjacency.get(right) ?? new Set<string>();
    leftSet.add(right);
    rightSet.add(left);
    adjacency.set(left, leftSet);
    adjacency.set(right, rightSet);
  };

  for (const node of nodes) {
    if (node.parentId) link(node.id, node.parentId);
    if (node.type === "requirement") {
      requirementInputBindings(node, nodes).forEach((binding) => link(node.id, binding.nodeId));
    }
    const spec = node.imageContainerSpec;
    spec?.memberNodeIds.forEach((id) => link(node.id, id));
    spec?.childContainerNodeIds.forEach((id) => link(node.id, id));
    spec?.memberBindings.forEach((binding) => link(node.id, binding.nodeId));
  }

  const layerMembers = new Map<string, string[]>();
  for (const node of nodes) {
    const groupId = String(node.layerGroup?.id || "");
    if (!groupId) continue;
    const members = layerMembers.get(groupId) ?? [];
    members.push(node.id);
    layerMembers.set(groupId, members);
  }
  for (const members of layerMembers.values()) {
    const anchor = members[0];
    members.slice(1).forEach((id) => link(anchor, id));
  }

  const seeds = uniqueIds(focusNodeIds.map(canonical)).filter((id) => available.has(id));
  const visited = new Set<string>();
  const queue = seeds.map((id) => ({ id, depth: 0 }));
  while (queue.length && visited.size < maxNodes) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.depth >= maxDepth) continue;
    const neighbors = [...(adjacency.get(current.id) ?? [])].sort((left, right) => left.localeCompare(right, "en"));
    neighbors.forEach((id) => {
      if (!visited.has(id)) queue.push({ id, depth: current.depth + 1 });
    });
  }
  return [...visited];
}

const groupExclusionReason = (
  node: WorkflowNode,
  layoutGroup?: ImageLayoutGroup,
): CanvasSelectionExclusionReason | "" => {
  if (isLayerNode(node)) return "layer";
  if (isBusyNode(node)) return "busy";
  if (node.type !== "image") return "unsupported";
  if ((node.assets?.length ?? 0) > 0 || node.imageContainer || node.imageCollection || layoutGroup) return "";
  return "empty";
};

export function analyzeCanvasSelection(
  nodes: readonly WorkflowNode[],
  layoutGroups: readonly ImageLayoutGroup[],
  selectedIds: readonly string[],
  primaryId = "",
): CanvasSelectionCapabilities {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layoutByHost = new Map(layoutGroups.map((group) => [group.hostNodeId, group]));
  const layoutByMember = new Map<string, ImageLayoutGroup>();
  for (const group of layoutGroups) {
    for (const nodeId of group.memberNodeIds) layoutByMember.set(nodeId, group);
  }

  const visibleIds = uniqueIds(selectedIds).filter((id) => nodeById.has(id) || layoutByHost.has(id));
  const expandedNodeIds = uniqueIds(visibleIds.flatMap((id) => {
    const group = layoutByHost.get(id) ?? layoutByMember.get(id);
    return group ? group.memberNodeIds : [id];
  })).filter((id) => nodeById.has(id));

  const selectedLayoutGroupIds = uniqueIds(visibleIds
    .map((id) => layoutByHost.get(id) ?? layoutByMember.get(id))
    .filter((group): group is ImageLayoutGroup => Boolean(group))
    .map((group) => group.id));

  const groupableNodeIds: string[] = [];
  const groupExcluded: CanvasSelectionExclusion[] = [];
  const deleteNodeIds: string[] = [];
  const deleteExcluded: CanvasSelectionExclusion[] = [];
  const selectedLayerGroupIds: string[] = [];
  const layerRepresentativeByGroup = new Map<string, WorkflowNode>();

  for (const nodeId of expandedNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const layoutGroup = layoutByMember.get(nodeId);
    const exclusion = groupExclusionReason(node, layoutGroup);
    if (exclusion) groupExcluded.push({ nodeId, reason: exclusion });
    else groupableNodeIds.push(nodeId);

    if (isBusyNode(node)) deleteExcluded.push({ nodeId, reason: "busy" });
    else deleteNodeIds.push(nodeId);

    const layerGroupId = String(node.layerGroup?.id || "").trim();
    if (layerGroupId) {
      selectedLayerGroupIds.push(layerGroupId);
      const current = layerRepresentativeByGroup.get(layerGroupId);
      if (!current || Number(node.layerGroup?.order || 0) > Number(current.layerGroup?.order || 0)) {
        layerRepresentativeByGroup.set(layerGroupId, node);
      }
    }
  }

  let layerVisibleCount = 0;
  for (const nodeId of visibleIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    if (isLayerNode(node)) layerVisibleCount += 1;
  }

  const selectedGroupById = new Map(
    selectedLayoutGroupIds
      .map((id) => layoutGroups.find((group) => group.id === id))
      .filter((group): group is ImageLayoutGroup => Boolean(group))
      .map((group) => [group.id, group]),
  );
  const primaryGroup = layoutByHost.get(primaryId) ?? layoutByMember.get(primaryId);
  const primaryNodeId = primaryGroup?.hostNodeId || primaryId;
  const preferredContainerHostId = groupableNodeIds.includes(primaryNodeId)
    ? primaryNodeId
    : [...selectedGroupById.values()].find((group) => groupableNodeIds.includes(group.hostNodeId))?.hostNodeId
      || groupableNodeIds[0]
      || "";

  const existingSingleGroup = selectedLayoutGroupIds.length === 1
    ? selectedGroupById.get(selectedLayoutGroupIds[0])
    : undefined;
  const sameAsExistingGroup = Boolean(
    existingSingleGroup &&
    groupableNodeIds.length === existingSingleGroup.memberNodeIds.length &&
    existingSingleGroup.memberNodeIds.every((id) => groupableNodeIds.includes(id)) &&
    existingSingleGroup.hostNodeId === preferredContainerHostId,
  );

  return {
    layerVisibleCount,
    groupableNodeIds,
    groupExcluded,
    deleteNodeIds,
    deleteExcluded,
    selectedLayoutGroupIds,
    selectedLayerGroupIds: uniqueIds(selectedLayerGroupIds),
    layerGroupRepresentativeIds: [...layerRepresentativeByGroup.values()].map((node) => node.id),
    preferredContainerHostId,
    canGroupIntoContainer: groupableNodeIds.length >= 2 && !sameAsExistingGroup && !groupExcluded.some(item => nodeById.get(item.nodeId)?.type === "image"),
    canDelete: deleteNodeIds.length > 0,
  };
}

/** A local, explainable next-action hint. It never executes by itself. */
export function suggestCanvasNextAction(
  nodes: readonly WorkflowNode[],
  layoutGroups: readonly ImageLayoutGroup[],
  selectedIds: readonly string[],
  primaryId = "",
  recentOperation = "",
): CanvasSuggestedAction {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selected = uniqueIds(selectedIds).filter((id) => nodeById.has(id));
  const primary = nodeById.get(primaryId) ?? selected.map((id) => nodeById.get(id)).find(Boolean);
  const capabilities = analyzeCanvasSelection(nodes, layoutGroups, selected, primaryId);

  if (selected.length > 1) {
    if (capabilities.canGroupIntoContainer) {
      return {
        id: "merge-selection",
        label: `合并 ${capabilities.groupableNodeIds.length} 个图片成果`,
        reason: "当前多选包含可归组的图片或图片容器。",
      };
    }
    return {
      id: "arrange-selection",
      label: `整理 ${selected.length} 个选中成果`,
      reason: capabilities.groupExcluded.length
        ? "当前混选包含不适合归组的节点，优先只整理位置。"
        : "当前多选已经属于同一容器，优先整理位置。",
    };
  }

  if (primary?.type === "requirement") {
    return { id: "run-requirement", label: "将需求交给 Agent", reason: "当前焦点是可复用需求节点。" };
  }
  if (primary?.type === "image" && primary.imageContainer && !(primary.assets?.length)) {
    return { id: "add-to-container", label: "向空容器添加图片", reason: "当前图片容器还没有素材。" };
  }
  if (primary?.type === "image") {
    return { id: "create-requirement", label: "基于这张图提要求", reason: "当前焦点是可继续编辑的图片成果。" };
  }

  if (!nodes.length) {
    return { id: "create-image", label: "创建生图工作", reason: "当前画布为空。" };
  }
  if (nodes.length > 1 && /(?:导入|拖入|创建图片容器)/.test(String(recentOperation || ""))) {
    return { id: "arrange-canvas", label: "整理刚加入的画布内容", reason: "最近加入了多项画布内容。" };
  }
  return { id: "ask-agent", label: "告诉 Agent 下一步", reason: "当前没有明确选择，交给 Agent 继续判断。" };
}
