import type {
  AgentTaskMention,
  AssetTaskRole,
  CanvasImageTask,
  CanvasRequirement,
  CanvasRequirementInputBinding,
  CanvasRequirementScenario,
  WorkflowNode,
} from "./core.ts";

export type MentionedRequirementWorkflow = {
  requirementNodeId?: string;
  candidateRequirementNodeIds: string[];
  inputBindings: CanvasRequirementInputBinding[];
  outputNodeIds: string[];
  workflowNodeIds: string[];
  ambiguous: boolean;
};

/** Older user-authored prompt notes become reusable requirements in place. */
export function mergePromptNodesIntoRequirements(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.type !== "intent" || node.branch !== "manual-prompt" || node.assets?.length) return node;
    const text = node.prompt || "";
    return {
      ...node,
      type: "requirement",
      branch: "project-agent",
      title: node.title === "提示词" ? "需求" : node.title,
      requirement: {
        version: 3, revision: 1, text, createdFrom: node.parentId ? "node" : "canvas",
        scenario: node.parentId ? "image-to-image" : "text-to-image",
        inputBindings: node.parentId ? [{ nodeId: node.parentId, role: "reference" }] : [],
      },
    };
  });
}

/**
 * Checks the complete executable graph before a user connection is committed.
 * Requirement inputs are real directed edges even when they are not the
 * requirement's legacy parentId, so parent-only descendant checks can miss a
 * cycle that crosses two reusable workflows through reference bindings.
 */
export function wouldCreateWorkflowConnectionCycle(
  nodes: readonly WorkflowNode[],
  sourceId: string,
  targetId: string,
): boolean {
  const source = String(sourceId || "").trim();
  const target = String(targetId || "").trim();
  if (!source || !target) return false;
  if (source === target) return true;

  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(source) || !nodeIds.has(target)) return false;
  const outgoing = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
    const targets = outgoing.get(from) ?? new Set<string>();
    targets.add(to);
    outgoing.set(from, targets);
  };

  for (const node of nodes) {
    if (node.parentId) link(node.parentId, node.id);
    if (node.type === "requirement" && node.requirement) {
      requirementInputBindings(node, nodes).forEach((binding) => link(binding.nodeId, node.id));
    }
  }

  // Adding source -> target creates a cycle exactly when target can already
  // reach source. Use an iterative walk so corrupt legacy graphs cannot cause
  // recursive stack growth while the user is repairing them.
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of outgoing.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return false;
}

/**
 * Resolves an explicit canvas @ mention to one reusable requirement workflow.
 * Inputs may be shared by several requirements, so the resolver only expands
 * when every workflow-bearing mention identifies the same requirement.
 */
export function resolveMentionedRequirementWorkflow(
  nodes: readonly WorkflowNode[],
  mentions: readonly AgentTaskMention[],
  options: {
    canonicalNodeId?: (nodeId: string) => string;
    preferredRequirementNodeId?: string;
    maxAncestorDepth?: number;
    maxOutputs?: number;
  } = {},
): MentionedRequirementWorkflow {
  const canonicalNodeId = (nodeId: string) => {
    const normalized = String(nodeId || "").trim();
    return normalized ? String(options.canonicalNodeId?.(normalized) || normalized).trim() || normalized : "";
  };
  const maxAncestorDepth = Math.max(1, Math.min(24, Math.floor(Number(options.maxAncestorDepth) || 12)));
  const maxOutputs = Math.max(1, Math.min(200, Math.floor(Number(options.maxOutputs) || 80)));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodesByCanonicalId = new Map<string, WorkflowNode[]>();
  for (const node of nodes) {
    const canonicalId = canonicalNodeId(node.id);
    if (!canonicalId) continue;
    nodesByCanonicalId.set(canonicalId, [...(nodesByCanonicalId.get(canonicalId) || []), node]);
  }
  const requirements = nodes.filter((node) => node.type === "requirement" && Boolean(node.requirement));
  const requirementOrder = new Map(requirements.map((node, index) => [node.id, index]));
  const requirementByCanonicalId = new Map<string, string[]>();
  const requirementsByInputId = new Map<string, string[]>();
  for (const requirement of requirements) {
    const canonicalRequirementId = canonicalNodeId(requirement.id);
    requirementByCanonicalId.set(canonicalRequirementId, [
      ...(requirementByCanonicalId.get(canonicalRequirementId) || []),
      requirement.id,
    ]);
    for (const binding of requirementLinkedImageBindings(requirement, nodes)) {
      const inputId = canonicalNodeId(binding.nodeId);
      if (!inputId) continue;
      const linked = requirementsByInputId.get(inputId) || [];
      if (!linked.includes(requirement.id)) linked.push(requirement.id);
      requirementsByInputId.set(inputId, linked);
    }
  }

  const candidatesForNode = (nodeId: string) => {
    const canonicalId = canonicalNodeId(nodeId);
    const directRequirements = requirementByCanonicalId.get(canonicalId) || [];
    if (directRequirements.length) return new Set(directRequirements);
    const candidates = new Set(requirementsByInputId.get(canonicalId) || []);
    for (const start of nodesByCanonicalId.get(canonicalId) || []) {
      let current: WorkflowNode | undefined = start;
      const visited = new Set<string>();
      for (let depth = 0; current?.parentId && depth < maxAncestorDepth; depth += 1) {
        const parentId = String(current.parentId || "").trim();
        if (!parentId || visited.has(parentId)) break;
        visited.add(parentId);
        const parent = nodeById.get(parentId);
        if (!parent) break;
        if (parent.type === "requirement" && parent.requirement) {
          candidates.add(parent.id);
          break;
        }
        current = parent;
      }
    }
    return candidates;
  };

  const candidateSets = mentions
    .filter((mention) => mention.ambiguous !== true)
    .slice(0, 64)
    .map((mention) => candidatesForNode(mention.nodeId))
    .filter((candidates) => candidates.size > 0);
  if (!candidateSets.length) {
    return {
      candidateRequirementNodeIds: [],
      inputBindings: [],
      outputNodeIds: [],
      workflowNodeIds: [],
      ambiguous: false,
    };
  }

  const allCandidates = new Set(candidateSets.flatMap((candidates) => [...candidates]));
  const commonCandidates = [...candidateSets[0]].filter((id) => candidateSets.every((candidates) => candidates.has(id)));
  const preferredId = String(options.preferredRequirementNodeId || "").trim();
  const resolvedRequirementNodeId = preferredId && commonCandidates.includes(preferredId)
    ? preferredId
    : commonCandidates.length === 1 ? commonCandidates[0] : "";
  const orderedCandidates = [...allCandidates].sort((left, right) => (
    (requirementOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (requirementOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    left.localeCompare(right, "en")
  ));
  if (!resolvedRequirementNodeId) {
    return {
      candidateRequirementNodeIds: orderedCandidates,
      inputBindings: [],
      outputNodeIds: [],
      workflowNodeIds: [],
      ambiguous: orderedCandidates.length > 1 || commonCandidates.length !== 1,
    };
  }

  const requirementNode = nodeById.get(resolvedRequirementNodeId)!;
  const inputBindings = requirementLinkedImageBindings(requirementNode, nodes);
  const childrenByParentId = new Map<string, WorkflowNode[]>();
  for (const node of nodes) {
    const parentId = String(node.parentId || "").trim();
    if (!parentId) continue;
    childrenByParentId.set(parentId, [...(childrenByParentId.get(parentId) || []), node]);
  }
  const outputNodeIds: string[] = [];
  const seenOutputNodeIds = new Set<string>();
  const outputQueue = [resolvedRequirementNodeId];
  while (outputQueue.length && outputNodeIds.length < maxOutputs) {
    const parentId = outputQueue.shift()!;
    for (const child of childrenByParentId.get(parentId) || []) {
      if (child.type === "requirement") continue;
      const canonicalId = canonicalNodeId(child.id);
      if (!canonicalId || seenOutputNodeIds.has(canonicalId)) continue;
      seenOutputNodeIds.add(canonicalId);
      if (child.type === "image") outputNodeIds.push(canonicalId);
      outputQueue.push(child.id);
      if (outputNodeIds.length >= maxOutputs) break;
    }
  }
  const workflowNodeIds = [...new Set([
    ...inputBindings.map((binding) => canonicalNodeId(binding.nodeId)),
    canonicalNodeId(resolvedRequirementNodeId),
    ...outputNodeIds,
  ].filter(Boolean))];
  return {
    requirementNodeId: resolvedRequirementNodeId,
    candidateRequirementNodeIds: orderedCandidates,
    inputBindings,
    outputNodeIds,
    workflowNodeIds,
    ambiguous: false,
  };
}

export const CANVAS_REQUIREMENT_SCENARIOS: readonly CanvasRequirementScenario[] = [
  "text-to-image",
  "image-to-image",
  "replace-element",
  "place-element",
  "virtual-try-on",
  "layered-drawing",
  "cutout",
  "region-redraw",
  "photo-enhance",
];

export const CANVAS_REQUIREMENT_SCENE_OPTIONS: ReadonlyArray<{
  value: CanvasRequirementScenario;
  label: string;
  description: string;
  promptPlaceholder: string;
}> = [
  {
    value: "text-to-image",
    label: "文生图",
    description: "仅根据文字创作，也可连接视觉参考。",
    promptPlaceholder: "描述主体、构图、风格、光线和需要避免的内容；如有参考图，可用 @编号 指明用途。",
  },
  {
    value: "image-to-image",
    label: "图生图",
    description: "基于当前图片继续创作或生成变体。",
    promptPlaceholder: "说明要基于哪张 @图片 做什么改变，以及主体、构图或文字中必须保持不变的部分。",
  },
  {
    value: "replace-element",
    label: "将图中元素替换为",
    description: "在目标图中替换指定元素，并补充替换素材。",
    promptPlaceholder: "例如：将 @K1 中的本子替换为 @K2，只替换本子，保留原图文字、构图和光线。",
  },
  {
    value: "place-element",
    label: "将图中元素替换到",
    description: "保留当前元素，补充一张待编辑目标图。",
    promptPlaceholder: "例如：把 @K1 中的商品放入 @K2 的桌面场景，保持商品外观，并匹配目标透视与光线。",
  },
  {
    value: "virtual-try-on",
    label: "服装上身",
    description: "以人物图为目标，补充服装素材。",
    promptPlaceholder: "例如：让 @K1 中的人物穿上 @K2 的服装，保持人物身份、姿势和背景。",
  },
  {
    value: "layered-drawing",
    label: "分层绘制",
    description: "按背景、主体、前景等独立图层生成。",
    promptPlaceholder: "描述整体画面、图层顺序、每层内容和透明要求。",
  },
  {
    value: "cutout",
    label: "抠图",
    description: "提取主体并输出可靠透明背景。",
    promptPlaceholder: "说明要从 @原图 提取的主体、需要保留的边缘细节，以及透明背景要求。",
  },
  {
    value: "region-redraw",
    label: "区域重绘",
    description: "只修改选定区域，保持其他像素不变。",
    promptPlaceholder: "说明 @原图 中需要重绘的区域和新内容，并写明其他区域必须保持不变。",
  },
  {
    value: "photo-enhance",
    label: "照片美化",
    description: "改善光线、色彩和质感，保持主体身份。",
    promptPlaceholder: "说明 @照片 需要改善的光线、色彩或质感，以及必须保持不变的人物身份和画面内容。",
  },
];

export function requirementScenarioPrimaryBinding(scenario: CanvasRequirementScenario): Pick<CanvasRequirementInputBinding, "role" | "purpose"> {
  if (scenario === "text-to-image") return { role: "reference", purpose: "可选视觉参考" };
  if (scenario === "place-element") return { role: "reference", purpose: "要放入目标图的元素" };
  if (scenario === "replace-element") return { role: "source", purpose: "需要替换元素的目标图" };
  if (scenario === "virtual-try-on") return { role: "source", purpose: "人物或模特原图" };
  if (scenario === "layered-drawing") return { role: "source", purpose: "分层绘制来源图" };
  if (scenario === "cutout") return { role: "source", purpose: "待提取主体的原图" };
  if (scenario === "region-redraw") return { role: "source", purpose: "待局部修改的原图" };
  if (scenario === "photo-enhance") return { role: "source", purpose: "待美化照片" };
  return { role: "source", purpose: "图生图来源" };
}

export function requirementScenarioBlankBinding(scenario: CanvasRequirementScenario): (Pick<CanvasRequirementInputBinding, "role" | "purpose"> & {
  title: string;
  prompt: string;
}) | null {
  if (scenario === "replace-element") {
    return { role: "reference", purpose: "替换元素素材", title: "替换元素素材", prompt: "放入要替换成的新元素、商品或角色素材。" };
  }
  if (scenario === "place-element") {
    return { role: "source", purpose: "待编辑目标图", title: "待编辑目标图", prompt: "放入要承接当前元素的目标场景或背景图。" };
  }
  if (scenario === "virtual-try-on") {
    return { role: "reference", purpose: "服装素材", title: "服装素材", prompt: "放入需要穿到人物身上的服装图片。" };
  }
  return null;
}

export function requirementScenarioBlankBindings(
  scenario: CanvasRequirementScenario,
  hasPrimaryInput: boolean,
): Array<Pick<CanvasRequirementInputBinding, "role" | "purpose"> & { title: string; prompt: string }> {
  const items: Array<Pick<CanvasRequirementInputBinding, "role" | "purpose"> & { title: string; prompt: string }> = [];
  if (!hasPrimaryInput && scenario !== "text-to-image") {
    const primary = requirementScenarioPrimaryBinding(scenario);
    items.push({
      ...primary,
      title: primary.purpose || (primary.role === "source" ? "待处理原图" : "参考素材"),
      prompt: primary.role === "source" ? "放入这个场景需要处理的原图。" : "放入这个场景需要使用的参考素材。",
    });
  }
  const companion = requirementScenarioBlankBinding(scenario);
  if (companion) items.push(companion);
  return items;
}

export function reconcileRequirementScenarioBindings(
  scenario: CanvasRequirementScenario,
  bindings: readonly CanvasRequirementInputBinding[],
  options: { reassignSingleInput?: boolean } = {},
): {
  inputBindings: CanvasRequirementInputBinding[];
  missingBindings: Array<Pick<CanvasRequirementInputBinding, "role" | "purpose"> & { title: string; prompt: string }>;
} {
  let inputBindings = sanitizeRequirementInputBindings(bindings);
  const primary = requirementScenarioPrimaryBinding(scenario);
  if (options.reassignSingleInput === true && inputBindings.length === 1) {
    inputBindings = [{ nodeId: inputBindings[0].nodeId, ...primary }];
  }
  const hasPrimaryInput = inputBindings.some((binding) => binding.role === primary.role);
  const missingBindings = requirementScenarioBlankBindings(scenario, hasPrimaryInput).filter((expected) => (
    !inputBindings.some((binding) => binding.role === expected.role)
  ));
  return { inputBindings, missingBindings };
}

export function sanitizeCanvasRequirementScenario(
  value: unknown,
  fallback: CanvasRequirementScenario = "image-to-image",
): CanvasRequirementScenario {
  return CANVAS_REQUIREMENT_SCENARIOS.includes(value as CanvasRequirementScenario)
    ? value as CanvasRequirementScenario
    : fallback;
}

function uniqueBindings(bindings: readonly CanvasRequirementInputBinding[]) {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const nodeId = String(binding.nodeId || "").trim();
    if (!nodeId || seen.has(nodeId)) return false;
    seen.add(nodeId);
    return true;
  }).map((binding) => {
    const purpose = String(binding.purpose || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    return {
      nodeId: String(binding.nodeId).trim(),
      role: binding.role,
      ...(purpose ? { purpose } : {}),
    };
  });
}

export function sanitizeRequirementInputBindings(value: unknown): CanvasRequirementInputBinding[] {
  if (!Array.isArray(value)) return [];
  return uniqueBindings(value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Partial<CanvasRequirementInputBinding>;
    const nodeId = typeof source.nodeId === "string" ? source.nodeId.trim().slice(0, 160) : "";
    const role = source.role === "reference" ? "reference" : source.role === "source" ? "source" : null;
    const purpose = typeof source.purpose === "string"
      ? source.purpose.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
      : "";
    return nodeId && role ? [{ nodeId, role, purpose: purpose || undefined }] : [];
  })).slice(0, 240);
}

export function requirementInputRoleForNode(node: WorkflowNode | null | undefined): AssetTaskRole {
  if (!node) return "source";
  if (node.imageContainerRole === "reference") return "reference";
  if (node.imageContainerRole === "source") return "source";
  const roles = new Set((node.assets ?? []).map((asset) => asset.taskRole).filter(Boolean));
  return roles.size === 1 && roles.has("reference") ? "reference" : "source";
}

export function requirementInputBindings(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
): CanvasRequirementInputBinding[] {
  const explicit = sanitizeRequirementInputBindings(node.requirement?.inputBindings);
  if (explicit.length) return explicit;
  const parentId = String(node.parentId || "").trim();
  if (!parentId) return [];
  return [{
    nodeId: parentId,
    role: requirementInputRoleForNode(allNodes.find((candidate) => candidate.id === parentId)),
  }];
}

/** Expand only connected image ancestry; requirements are strict task boundaries. */
export function requirementLinkedImageBindings(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
): CanvasRequirementInputBinding[] {
  const bindings = requirementInputBindings(node, allNodes).slice(0, 200);
  const directBindings = [...bindings];
  const seen = new Set(bindings.map((binding) => binding.nodeId));
  const nodeById = new Map(allNodes.map((candidate) => [candidate.id, candidate]));
  for (const binding of directBindings) {
    let current = nodeById.get(binding.nodeId);
    const visited = new Set<string>();
    while (current?.type === "image" && current.parentId && bindings.length < 200) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      const parent = nodeById.get(current.parentId);
      if (parent?.type !== "image") break;
      if (!seen.has(parent.id)) {
        bindings.push({ nodeId: parent.id, role: requirementInputRoleForNode(parent) });
        seen.add(parent.id);
      }
      current = parent;
    }
  }
  return bindings;
}

export function requirementInputNodeIds(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
) {
  return requirementInputBindings(node, allNodes).map((binding) => binding.nodeId);
}

export function requirementInputRoleMap(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
) {
  return Object.fromEntries(requirementInputBindings(node, allNodes).map((binding) => [binding.nodeId, binding.role])) as Record<string, AssetTaskRole>;
}

export function requirementInputPurposeMap(
  node: Pick<WorkflowNode, "parentId" | "requirement">,
  allNodes: readonly WorkflowNode[] = [],
) {
  return Object.fromEntries(
    requirementInputBindings(node, allNodes)
      .filter((binding) => Boolean(binding.purpose))
      .map((binding) => [binding.nodeId, binding.purpose!]),
  ) as Record<string, string>;
}

export function primaryRequirementInputNodeId(bindings: readonly CanvasRequirementInputBinding[]) {
  return bindings.find((binding) => binding.role === "source")?.nodeId || bindings[0]?.nodeId || "";
}

export function upsertRequirementInputBinding(
  requirement: CanvasRequirement,
  binding: CanvasRequirementInputBinding,
): CanvasRequirement {
  const current = sanitizeRequirementInputBindings(requirement.inputBindings);
  const index = current.findIndex((item) => item.nodeId === binding.nodeId);
  const next = index >= 0
    ? current.map((item, itemIndex) => itemIndex === index
      ? {
          ...item,
          ...binding,
          purpose: binding.purpose === undefined ? item.purpose : binding.purpose,
        }
      : item)
    : [...current, { ...binding }];
  return {
    ...requirement,
    version: 3,
    inputBindings: uniqueBindings(next),
    lastError: undefined,
  };
}

export function removeRequirementInputBindings(
  requirement: CanvasRequirement,
  nodeIds?: ReadonlySet<string>,
): CanvasRequirement {
  const current = sanitizeRequirementInputBindings(requirement.inputBindings);
  const inputBindings = nodeIds ? current.filter((binding) => !nodeIds.has(binding.nodeId)) : [];
  return {
    ...requirement,
    version: 3,
    inputBindings,
    lastError: undefined,
  };
}

export function sanitizeCanvasImageTask(value: unknown): CanvasImageTask | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = value as Partial<CanvasImageTask>;
  if (task.version !== 1 || !CANVAS_REQUIREMENT_SCENARIOS.includes(task.scenario!)) return undefined;
  const clean = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : undefined;
  return {
    version: 1,
    scenario: task.scenario!,
    inputBindings: sanitizeRequirementInputBindings(task.inputBindings),
    requirementNodeId: clean(task.requirementNodeId, 160) || undefined,
    title: clean(task.title, 240),
    text: clean(task.text, 24000),
  };
}
