export const canvasClipboardMime = "application/x-aieyra-canvas";
export function copyCanvasSelection(nodes, groups, selected) {
    const ids = new Set(selected);
    // A container carries its contents, including nested containers. Ordinary
    // derivation edges do not silently expand the user's selection.
    let changed = true;
    while (changed) {
        const before = ids.size;
        for (const group of groups)
            if (ids.has(group.hostNodeId))
                group.memberNodeIds.forEach(id => ids.add(id));
        for (const node of nodes)
            if (ids.has(node.id)) {
                [...(node.imageContainerSpec?.memberNodeIds || []), ...(node.imageContainerSpec?.childContainerNodeIds || [])].forEach(id => ids.add(id));
            }
        changed = ids.size !== before;
    }
    return structuredClone({ version: 1, nodes: nodes.filter(node => ids.has(node.id)),
        groups: groups.filter(group => ids.has(group.hostNodeId)).map(group => ({ ...group, memberNodeIds: group.memberNodeIds.filter(id => ids.has(id)) })) });
}
export function readCanvasClipboard(text) {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.groups) || !value.nodes.length ||
        value.nodes.length > 10000 || value.nodes.some((node) => !node || typeof node.id !== "string" ||
        !["image", "requirement", "intent", "review", "export", "branch", "post", "agent"].includes(node.type) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) ||
        new Set(value.nodes.map((node) => node.id)).size !== value.nodes.length ||
        value.groups.some((group) => !group || typeof group.id !== "string" || typeof group.hostNodeId !== "string" || !Array.isArray(group.memberNodeIds)))
        throw new Error("剪贴板节点格式无效。");
    return value;
}
export function clipboardAssetPaths(value) {
    const paths = new Set();
    const walk = (item) => {
        if (!item || typeof item !== "object")
            return;
        if (Array.isArray(item)) {
            item.forEach(walk);
            return;
        }
        const record = item;
        if (typeof record.path === "string" && record.path)
            paths.add(record.path);
        Object.values(record).forEach(walk);
    };
    walk(value);
    return [...paths];
}
export function pasteCanvasSelection(source, ids, assets, position, zOrder) {
    const identities = new Map();
    const fresh = (value) => {
        if (!identities.has(value))
            identities.set(value, `occ-${crypto.randomUUID().replace(/-/g, "")}`);
        return identities.get(value);
    };
    const minX = Math.min(...source.nodes.map(node => node.x)), minY = Math.min(...source.nodes.map(node => node.y));
    const codes = new Map(), ambiguousCodes = new Set();
    const rememberCode = (code, mapped) => {
        const key = code.toLowerCase();
        if (codes.has(key) && codes.get(key) !== mapped)
            ambiguousCodes.add(key);
        codes.set(key, mapped);
    };
    for (const node of source.nodes) {
        const code = node.displayCode || node.id, mapped = ids.get(node.id);
        rememberCode(code, mapped);
        node.assets?.forEach((asset, index) => rememberCode(asset.displayCode || `${code}${index + 1}`, `${mapped}${index + 1}`));
    }
    const nodeFields = /^(?:parentId|sourceParentId|nodeId|hostNodeId|sourceNodeId|ownerNodeId|containerId|containerNodeId|requirementNodeId|agentOwnerId|sourceContainerId)$/;
    const nodeLists = /^(?:memberNodeIds|childContainerNodeIds|sourceNodeIds|referenceContainerIds|sourceContainerIds|contextNodeIds)$/;
    const identityLists = /^(?:failedLayerIds|successfulLayerIds|sourceBindingIds|referenceBindingIds|expectedSourceBindingIds)$/;
    const remapCode = (code) => ambiguousCodes.has(code.toLowerCase()) ? undefined : codes.get(code.toLowerCase());
    const transform = (value, key = "") => {
        if (typeof value === "string") {
            if (nodeFields.test(key))
                return ids.get(value);
            if (key === "displayCode")
                return remapCode(value);
            if (/^(?:bindingId|occurrenceId|layerId|groupId|layoutId|id)$/.test(key))
                return value ? fresh(value) : value;
            if (/^(?:prompt|revisedPrompt|text|note)$/.test(key))
                return value.replace(/(?<![\w@])@([A-Za-z]+\d*)\b/g, (match, code) => {
                    const mapped = remapCode(code);
                    return mapped ? `@${mapped}` : `〔原画布引用 ${code}，未复制〕`;
                });
            return value;
        }
        if (Array.isArray(value))
            return nodeLists.test(key) ? value.map(id => ids.get(String(id))).filter(Boolean)
                : identityLists.test(key) ? value.map(id => fresh(String(id)))
                    : key === "referenceCodes" ? value.map(code => remapCode(String(code).replace(/^@/, ""))).filter(Boolean)
                        : value.map(item => transform(item)).filter(item => item !== undefined);
        if (!value || typeof value !== "object")
            return value;
        const record = value;
        if (typeof record.nodeId === "string" && !ids.has(record.nodeId))
            return undefined;
        const mapped = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, transform(item, key)]).filter(([, item]) => item !== undefined));
        if (typeof record.path === "string" && record.path) {
            const asset = Object.prototype.hasOwnProperty.call(assets, record.path) ? assets[record.path] : undefined;
            if (!asset)
                throw new Error("复制的图片素材未能完整导入，请重试。");
            const { revisedPrompt: _prompt, originalName: _name, runId: _run, index: _index, ...imported } = asset;
            Object.assign(mapped, imported, { occurrenceId: fresh(String(record.occurrenceId || record.path)) });
        }
        return mapped;
    };
    return {
        version: 1,
        nodes: source.nodes.map((node, index) => {
            const next = transform(node);
            Object.assign(next, { id: ids.get(node.id), displayCode: ids.get(node.id), x: position.x + node.x - minX,
                y: position.y + node.y - minY, zOrder: zOrder + index, createdAt: new Date().toISOString(),
                generationRunId: undefined, agentConversationId: undefined, taskProvenance: undefined });
            if (next.assets)
                next.assets = next.assets.map(asset => ({ ...asset, runId: undefined, displayCode: undefined,
                    ...(asset.status === "pending" ? { status: asset.path || asset.url ? "done" : "error", error: asset.path || asset.url ? undefined : "原图尚未生成，请在原画布完成后重新复制。" } : {}) }));
            if (node.imageState === "generating") {
                next.imageState = next.assets?.some(asset => asset.path || asset.url) ? "done" : "empty";
                next.status = "done";
                next.imageProgress = undefined;
            }
            if (next.requirement) {
                // A feedback note belongs to its original project's goal log.
                // A copied canvas node has no corresponding target goal/checkpoint.
                delete next.requirement.goalFeedback;
                next.requirement.lastSourceSignature = undefined;
                next.requirement.lastRunAt = undefined;
                next.requirement.lastError = undefined;
            }
            if (next.layerGroup) {
                next.layerGroup.toolRunId = undefined;
                next.layerGroup.anchorX += position.x - minX;
                next.layerGroup.anchorY += position.y - minY;
            }
            return next;
        }),
        groups: source.groups.map(group => ({ ...group, id: fresh(group.id), hostNodeId: ids.get(group.hostNodeId),
            memberNodeIds: group.memberNodeIds.map(id => ids.get(id)).filter((id) => Boolean(id)) })).filter(group => group.hostNodeId)
    };
}
