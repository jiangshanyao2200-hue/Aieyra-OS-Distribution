import type { AgentMessageAttachments, AssetTaskRole, ReferenceImage, TaskAssetReference, WorkflowNode } from "./core.ts";

export type ResolvedTaskImageAttachments = {
  sourceAssets: TaskAssetReference[];
  referenceAssets: TaskAssetReference[];
  sourceNodes: WorkflowNode[];
  materialized: boolean;
};

export function historyImageAttachments(items: AgentMessageAttachments["sourceAssets"]): ReferenceImage[] {
  return (items || []).filter(asset => asset.path || asset.assetUrl).map(asset => ({
    ...asset, path: asset.path || "", name: asset.name || asset.displayCode, taskRole: asset.role
  }));
}

function normalizedPath(value?: string) {
  const path = String(value || "").replace(/\\/g, "/");
  return /^(?:[a-z]:\/|\/\/)/i.test(path) ? path.toLowerCase() : path;
}

function sameContent(image: ReferenceImage, asset: TaskAssetReference) {
  if (image.contentHash && asset.contentHash) return image.contentHash === asset.contentHash;
  return Boolean(
    image.assetId && image.assetId === asset.assetId ||
    image.path && normalizedPath(image.path) === normalizedPath(asset.path) ||
    image.relativePath && normalizedPath(image.relativePath) === normalizedPath(asset.relativePath) ||
    image.assetUrl && image.assetUrl === asset.assetUrl
  );
}

/** Resolve only against the current project's visible canvas projection. */
export function resolveTaskImageAttachments(images: ReferenceImage[], candidates: TaskAssetReference[], role: AssetTaskRole) {
  const resolved: TaskAssetReference[] = [], pending: ReferenceImage[] = [], issues: string[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const bound = Boolean(image.bindingId || image.nodeId || image.ownerNodeId || image.containerId);
    let matches: TaskAssetReference[] = [];
    if (bound) {
      // A retained occurrence follows a move or container merge. A deleted
      // occurrence must not silently bind to another copy of the same file.
      matches = candidates.filter(asset => image.bindingId && asset.bindingId === image.bindingId);
      if (!matches.length && image.occurrenceId) {
        matches = candidates.filter(asset => asset.occurrenceId === image.occurrenceId);
        if (matches.length > 1) {
          const located = matches.filter(asset => asset.nodeId === image.nodeId || Boolean(image.ownerNodeId && asset.ownerNodeId === image.ownerNodeId));
          if (located.length === 1) matches = located;
        }
      }
      if (!matches.length && !image.occurrenceId) {
        const owners = new Set([image.nodeId, image.ownerNodeId, image.containerId].filter(Boolean));
        matches = candidates.filter(asset => [asset.nodeId, asset.ownerNodeId, asset.containerId].some(id => id && owners.has(id)) && sameContent(image, asset));
        if (!matches.length) matches = candidates.filter(asset => sameContent(image, asset));
      }
      matches = matches.filter(asset => sameContent(image, asset));
      if (matches.length !== 1) {
        issues.push(`${image.displayCode || image.name} ${matches.length ? "引用不明确" : "已被移除或替换"}`);
        continue;
      }
    } else {
      // Reattaching a file already on the canvas reuses that asset. It does
      // not assign a new permanent SOURCE/REFERENCE role to its container.
      matches = candidates.filter(asset => sameContent(image, asset));
    }
    const asset = matches[0];
    if (!asset) { pending.push(image); continue; }
    const key = `${role}:${asset.bindingId || asset.occurrenceId || `${asset.nodeId}:${asset.assetIndex}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const referenceRole = image.referenceRole || (image.role && !["source", "reference", "edit_target"].includes(image.role) ? image.role : undefined);
    resolved.push({ ...asset, role, purpose: image.purpose ?? asset.purpose, referenceRole });
  }
  return { resolved, pending, issues };
}

/** Keep a restored image mention attached to its occurrence after a move. */
export function restoredAttachmentMentions(images: ReferenceImage[], current: TaskAssetReference[]) {
  const mentions: import("./core.ts").AgentTaskMention[] = [];
  for (const image of images) {
    if (!image.displayCode || !(image.bindingId || image.nodeId || image.ownerNodeId)) continue;
    const result = resolveTaskImageAttachments([image], current, image.taskRole || "reference");
    const asset = result.resolved[0];
    if (!asset?.nodeId || result.issues.length) continue;
    if (mentions.some(mention => mention.code === image.displayCode && mention.bindingId === asset.bindingId)) continue;
    mentions.push({ kind: "asset", code: image.displayCode, nodeId: asset.nodeId, assetIndex: asset.assetIndex,
      bindingId: asset.bindingId, assetId: asset.assetId, feedbackScore: asset.feedbackScore });
  }
  return mentions;
}
