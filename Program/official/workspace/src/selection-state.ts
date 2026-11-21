export type NodeSelectionMode = "none" | "single" | "multiple";

export type NodeSelectionState = {
  primaryId: string;
  ids: string[];
};

export type PendingSelectionRetargetIntent = {
  selectionKey: string;
  targetKey: string;
  at: number;
  x?: number;
  y?: number;
};

export type SelectionRetargetDecision = {
  confirmed: boolean;
  pending: PendingSelectionRetargetIntent | null;
};

export type NodePlainClickDecision = {
  action: NodeSelectionAction;
  allowOperation: boolean;
  pending: PendingSelectionRetargetIntent | null;
};

export type NodeSelectionAction =
  | { type: "clear" }
  | { type: "replace"; id: string }
  | { type: "focus"; id: string }
  | { type: "plain-click"; id: string }
  | { type: "toggle"; id: string }
  | { type: "replace-group"; ids: string[]; primaryId?: string; preserveOnEmpty?: boolean }
  | { type: "remove"; ids: string[] };

const cleanId = (value: unknown): string => String(value ?? "").trim();

const uniqueIds = (values: readonly string[], availableIds?: ReadonlySet<string>): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const id = cleanId(value);
    if (!id || seen.has(id) || (availableIds && !availableIds.has(id))) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
};

export const nodeSelectionIdentityKey = (ids: readonly string[]): string =>
  uniqueIds(ids).sort().join("\u0000");

export const resolveSelectionRetargetIntent = ({
  previous,
  selectionIds,
  targetKey,
  at,
  x,
  y,
  maxAgeMs = 900,
  maxDistancePx,
}: {
  previous: PendingSelectionRetargetIntent | null;
  selectionIds: readonly string[];
  targetKey: string;
  at: number;
  x?: number;
  y?: number;
  maxAgeMs?: number;
  maxDistancePx?: number;
}): SelectionRetargetDecision => {
  const selectionKey = nodeSelectionIdentityKey(selectionIds);
  const cleanTargetKey = cleanId(targetKey);
  if (!selectionKey || !cleanTargetKey || !Number.isFinite(at)) {
    return { confirmed: false, pending: null };
  }

  const age = previous ? at - previous.at : Number.POSITIVE_INFINITY;
  const distance = previous && Number.isFinite(x) && Number.isFinite(y) &&
    Number.isFinite(previous.x) && Number.isFinite(previous.y)
    ? Math.hypot(Number(x) - Number(previous.x), Number(y) - Number(previous.y))
    : 0;
  const distanceMatches = maxDistancePx === undefined || distance <= Math.max(0, maxDistancePx);
  const confirmed = Boolean(
    previous &&
    previous.selectionKey === selectionKey &&
    previous.targetKey === cleanTargetKey &&
    age >= 0 &&
    age <= Math.max(0, maxAgeMs) &&
    distanceMatches
  );
  return {
    confirmed,
    pending: confirmed
      ? null
      : {
          selectionKey,
          targetKey: cleanTargetKey,
          at,
          ...(Number.isFinite(x) ? { x } : {}),
          ...(Number.isFinite(y) ? { y } : {}),
        },
  };
};

export const emptyNodeSelection = (): NodeSelectionState => ({ primaryId: "", ids: [] });

export const nodeSelectionMode = (selection: NodeSelectionState): NodeSelectionMode => {
  if (selection.ids.length === 0) return "none";
  if (selection.ids.length === 1) return "single";
  return "multiple";
};

export const normalizeNodeSelection = (
  selection: NodeSelectionState,
  availableIds?: ReadonlySet<string>,
): NodeSelectionState => {
  const ids = uniqueIds(selection.ids, availableIds);
  const requestedPrimaryId = cleanId(selection.primaryId);
  return {
    primaryId: requestedPrimaryId && (!availableIds || availableIds.has(requestedPrimaryId)) ? requestedPrimaryId : ids[0] || "",
    ids,
  };
};

export const resolveNodePlainClickIntent = ({ targetId }: {
  selection: NodeSelectionState;
  previous: PendingSelectionRetargetIntent | null;
  targetId: string;
  at: number;
  maxAgeMs?: number;
}): NodePlainClickDecision => {
  const id = cleanId(targetId);
  if (!id) {
    return {
      action: { type: "plain-click", id: "" },
      allowOperation: false,
      pending: null,
    };
  }
  return {
    action: { type: "focus", id },
    allowOperation: true,
    pending: null,
  };
};

export const reduceNodeSelection = (
  currentValue: NodeSelectionState,
  action: NodeSelectionAction,
  availableIds?: ReadonlySet<string>,
): NodeSelectionState => {
  const current = normalizeNodeSelection(currentValue, availableIds);

  if (action.type === "clear") return emptyNodeSelection();

  if (action.type === "replace") {
    const id = cleanId(action.id);
    if (!id || (availableIds && !availableIds.has(id))) return emptyNodeSelection();
    return { primaryId: id, ids: [id] };
  }

  if (action.type === "focus" || action.type === "plain-click") {
    const id = cleanId(action.id);
    if (!id) return current;
    if (availableIds && !availableIds.has(id)) return current;
    return current.primaryId === id ? current : { primaryId: id, ids: [...current.ids] };
  }

  if (action.type === "toggle") {
    const id = cleanId(action.id);
    if (!id || (availableIds && !availableIds.has(id))) return current;
    if (current.ids.includes(id)) {
      const ids = current.ids.filter((candidate) => candidate !== id);
      if (!ids.length) return emptyNodeSelection();
      return {
        primaryId: current.primaryId === id ? ids[0] : current.primaryId,
        ids,
      };
    }
    return { primaryId: id, ids: [...current.ids, id] };
  }

  if (action.type === "replace-group") {
    const ids = uniqueIds(action.ids, availableIds);
    if (!ids.length) return action.preserveOnEmpty ? current : emptyNodeSelection();
    const requestedPrimaryId = cleanId(action.primaryId);
    return {
      primaryId: ids.includes(requestedPrimaryId) ? requestedPrimaryId : ids[0],
      ids,
    };
  }

  const removeIds = new Set(uniqueIds(action.ids));
  const ids = current.ids.filter((id) => !removeIds.has(id));
  if (!ids.length) return emptyNodeSelection();
  return {
    primaryId: ids.includes(current.primaryId) ? current.primaryId : ids[0],
    ids,
  };
};
