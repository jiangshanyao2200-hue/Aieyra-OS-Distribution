import { preserveImageOriginsForNodes } from "./image-origin.ts";
import type { WorkflowNode } from "./core.ts";
import { analyzeCanvasSelection } from "./canvas-commands.ts";
import { deriveImageLayoutGroupsFromContainerSpecs, imageContainerSpecForNode, synchronizeImageContainerSpecs } from "./image-container.ts";
import type { ImageLayoutGroup } from "./image-layout.ts";
import { primaryRequirementInputNodeId, removeRequirementInputBindings, requirementInputBindings } from "./requirement-graph.ts";

/** One atomic user merge: complete membership, detached canvas links, unchanged files. */
export function mergeCanvasImageContainers(
  nodes: readonly WorkflowNode[], groups: readonly ImageLayoutGroup[], selectedIds: readonly string[], hostId: string, groupId: string,
) {
  const selection = analyzeCanvasSelection(nodes, groups, selectedIds, hostId);
  const members = new Set(selection.groupableNodeIds);
  const hostNodeId = selection.preferredContainerHostId;
  if (members.size < 2 || !members.has(hostNodeId)) return null;
  // Unsupported notes stay on the canvas, but never silently omit an image.
  if (selection.groupExcluded.some(item => nodes.find(node => node.id === item.nodeId)?.type === "image")) return null;
  const detached = preserveImageOriginsForNodes(nodes).map((node): WorkflowNode => {
    if (members.has(node.id)) {
      const spec = imageContainerSpecForNode(node);
      return { ...node, parentId: undefined, relationType: undefined,
        imageContainerSpec: spec ? { ...spec, kind: spec.kind === "container-group" ? spec.hostContentKind || "manual" : spec.kind,
          hostContentKind: undefined, memberNodeIds: [], childContainerNodeIds: [], memberBindings: spec.memberBindings.filter(binding => binding.nodeId === node.id), layoutId: undefined } : undefined };
    }
    if (node.type === "requirement" && node.requirement) {
      const before = requirementInputBindings(node, nodes as WorkflowNode[]);
      if (!before.some(binding => members.has(binding.nodeId))) return node;
      const requirement = removeRequirementInputBindings({ ...node.requirement, inputBindings: before }, members);
      const bindings = requirementInputBindings({ ...node, requirement, parentId: undefined }, nodes as WorkflowNode[]);
      return { ...node, requirement, parentId: primaryRequirementInputNodeId(bindings) || undefined, relationType: bindings.length ? "referenced" : undefined };
    }
    return node.parentId && members.has(node.parentId) ? { ...node, parentId: undefined, relationType: undefined } : node;
  });
  const untouchedGroups = groups.filter(group => !group.memberNodeIds.some(id => members.has(id)));
  const combined: ImageLayoutGroup = { id: groupId, hostNodeId, memberNodeIds: [hostNodeId, ...members].filter((id, index, ids) => ids.indexOf(id) === index), origin: "manual", autoFit: true };
  const canonical = synchronizeImageContainerSpecs(detached, [...untouchedGroups, combined]);
  const nextGroups = deriveImageLayoutGroupsFromContainerSpecs(canonical);
  const merged = nextGroups.find(group => group.hostNodeId === hostNodeId);
  if (!merged || members.size !== merged.memberNodeIds.length || merged.memberNodeIds.some(id => !members.has(id))) return null;
  return { nodes: canonical, groups: nextGroups, hostNodeId, memberNodeIds: [...members], excluded: selection.groupExcluded.length };
}
