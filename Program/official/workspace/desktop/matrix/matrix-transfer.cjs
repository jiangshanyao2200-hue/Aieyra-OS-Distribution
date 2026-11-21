"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), { randomUUID, createHash } = require("node:crypto");
const { copyCanvasSelection, pasteCanvasSelection, clipboardAssetPaths } = require("../../shared/canvas-transfer.mjs");
const inside = (file, root) => { const relative = path.relative(root, file); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); };
const referenceFile = project => path.join(project.path, ".iiimage", "matrix-references.json");
const relativeFileKey = /^(?:relativePath|previewRelativePath|matrixPdfIndex|matrixSnapshot)$/;
function transferFiles(value) {
  const files = new Set(clipboardAssetPaths(value));
  function walk(item, key) {
    if (typeof item === "string" && item && (relativeFileKey.test(key) || key === "matrixImagePaths")) files.add(item);
    else if (Array.isArray(item)) item.forEach(value => walk(value, key));
    else if (item && typeof item === "object") for (const [key, value] of Object.entries(item)) walk(value, key);
  }
  walk(value, ""); return [...files];
}
async function readMatrixReferences(project) {
  try { const value = JSON.parse(await fs.readFile(referenceFile(project), "utf8")); if (!Array.isArray(value)) throw new Error("引用索引格式无效"); return value; }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function readSnapshot(project, relative) {
  const file = path.resolve(project.path, relative);
  if (!inside(file, project.path) || !inside(await fs.realpath(file), await fs.realpath(project.path))) throw new Error("节点快照路径无效。");
  const restore = value => {
    if (Array.isArray(value)) return value.map(restore);
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, val]) => [key, restore(val)]));
    if (typeof value.path === "string" && typeof value.relativePath === "string") {
      const asset = path.resolve(project.path, value.relativePath);
      if (!inside(asset, project.path)) throw new Error("快照素材路径无效。");
      result.path = asset;
    }
    return result;
  };
  return restore(JSON.parse(await fs.readFile(file, "utf8")));
}
async function atomic(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(value, null, 2)); await fs.rename(temp, file); }
function removeTransferredNodes(session, nodeIds) {
  const ids = new Set(nodeIds);
  const single = /^(?:parentId|sourceParentId|nodeId|hostNodeId|sourceNodeId|ownerNodeId|containerId|containerNodeId|requirementNodeId|agentOwnerId|sourceContainerId)$/;
  const lists = /^(?:memberNodeIds|childContainerNodeIds|sourceNodeIds|referenceContainerIds|sourceContainerIds|contextNodeIds)$/;
  function prune(value, key = "") {
    if (typeof value === "string") return single.test(key) && ids.has(value) ? undefined : value;
    if (Array.isArray(value)) return lists.test(key) ? value.filter(id => !ids.has(id)) : value.filter(item => !item?.nodeId || !ids.has(item.nodeId)).map(item => prune(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, prune(val, key)]));
  }
  return { ...session, nodes: session.nodes.filter(n => !ids.has(n.id)).map(n => prune(n)), layoutGroups: (session.layoutGroups || []).filter(g => !ids.has(g.hostNodeId)).map(g => prune(g)), selectedNodeId: ids.has(session.selectedNodeId) ? "" : session.selectedNodeId };
}
function createMatrixTransfer({ projectById, readSession, saveImage, saveWriting, removeSource, assetUrl }) {
  let queue = Promise.resolve();
  async function transfer(input) {
    const source = projectById(input.sourceProjectId), target = projectById(input.targetProjectId);
    if (!source || !target || !["agent", "image", "writing"].includes(target.kind)) throw new Error("请选择有效的 Matrix、绘画或写作项目。");
    if (!Array.isArray(input.nodeIds) || !input.nodeIds.length) throw new Error("请选择要复制的节点。");
    if (input.mode && !["copy", "move"].includes(input.mode)) throw new Error("请选择复制或移动。");
    if (source.id === target.id && input.mode === "move") throw new Error("同一项目内无需跨项目移动。");
    const session = readSession(source), targetSession = source.id === target.id ? session : readSession(target);
    let canvas, artifacts, documents;
    const sourceReferences = await readMatrixReferences(source);
    const reference = input.nodeIds.length === 1 ? sourceReferences.find(r => r.id === input.nodeIds[0]) : null;
    if (reference) {
      const saved = await readSnapshot(source, reference.snapshotPath); canvas = saved.canvas; artifacts = saved.artifacts; documents=saved.documents;
    } else if (source.kind === "image") {
      const known = new Set((session.nodes || []).map(n => n.id));
      if (input.nodeIds.some(id => !known.has(id))) throw new Error("源节点已经变化，请重新选择。");
      canvas = copyCanvasSelection(session.nodes, session.layoutGroups || [], input.nodeIds);
    } else if (source.kind === "writing") {
      const ids = new Set(input.nodeIds);
      let changed = true;
      while (changed) { const before = ids.size; for (const a of session.artifacts || []) if (ids.has(a.attributes?.novelId)) ids.add(a.id); changed = before !== ids.size; }
      artifacts = structuredClone((session.artifacts || []).filter(a => ids.has(a.id)));
      if (!artifacts.length || input.nodeIds.some(id => !artifacts.some(a => a.id === id))) throw new Error("源文档已经变化，请重新选择。");
      if (artifacts.length === 1 && artifacts[0].attributes?.matrixSourceKind === "image" && artifacts[0].attributes?.matrixSnapshot) {
        const saved = await readSnapshot(source, artifacts[0].attributes.matrixSnapshot); canvas = saved.canvas; artifacts = saved.artifacts; documents=saved.documents;
      } else for (const artifact of artifacts) if (artifact.provenance?.source?.format === "pdf") artifact.matrixPdfIndex = `${path.posix.dirname(artifact.provenance.source.relativePath)}/page-index.v1.json`;
    } else throw new Error("请从 Matrix 引用或实际画布节点复制。");
    if(canvas?.nodes?.some(n=>n.documentId) && !documents){documents=[];for(const node of canvas.nodes){if(!node.documentId)continue;if(!/^[a-zA-Z0-9_-]{1,100}$/.test(node.documentId))throw Error("文档引用无效。");const doc=await readSnapshot(source,`.iiimage/studio/${node.documentId}.json`);if(doc.sha256!==createHash("sha256").update(doc.text).digest("hex"))throw Error("文档校验失败。");documents.push(doc);}}
    const id = `transfer-${randomUUID()}`, folder = path.join(target.path, "assets", "matrix", id);
    await fs.mkdir(folder, { recursive: true });
    const data = { canvas, artifacts, documents }, mappings = new Map();
    for (const old of transferFiles(data)) {
      const file = path.resolve(source.path, old);
      if (!inside(await fs.realpath(file), await fs.realpath(source.path))) throw new Error("源素材未位于项目中，请先导入项目。");
      const ext = path.extname(file), name = createHash("sha256").update(file).digest("hex").slice(0, 20) + ext;
      const dest = path.join(folder, name); await fs.copyFile(file, dest);
      const originalHash = createHash("sha256").update(await fs.readFile(file)).digest("hex");
      if (originalHash !== createHash("sha256").update(await fs.readFile(dest)).digest("hex")) throw new Error("复制素材校验不一致，原节点保持完整。");
      mappings.set(old, dest);
    }
    function relocate(value, key = "") {
      if (typeof value === "string" && mappings.has(value) && (relativeFileKey.test(key) || key === "matrixImagePaths")) return path.relative(target.path, mappings.get(value)).replace(/\\/g, "/");
      if (Array.isArray(value)) return value.map(item => relocate(item, key));
      if (!value || typeof value !== "object") return value;
      const result = Object.fromEntries(Object.entries(value).map(([key, val]) => [key, relocate(val, key)]));
      if (typeof value.path === "string" && mappings.has(value.path)) { result.path = mappings.get(value.path); result.url = assetUrl(result.path); result.relativePath = path.relative(target.path, result.path).replace(/\\/g, "/"); }
      return result;
    }
    const copied = relocate(data);
    const snapshotPath = path.relative(target.path, path.join(folder, "snapshot.json")).replace(/\\/g, "/");
    await atomic(path.join(folder, "snapshot.json"), copied);
    const roots = canvas?.nodes?.filter(n => input.nodeIds.includes(n.id)) || artifacts || [];
    const title = reference?.title || roots.map(n => n.title || n.id).join(" · ") || "复制的节点";
    const receipt = { id, sourceProjectId: source.id, sourceProjectName: source.name, sourceNodeIds: input.nodeIds, title, snapshotPath, createdAt: new Date().toISOString(), count: (canvas?.nodes || artifacts || []).length };
    let importedIds = [];
    if (target.kind === "agent") {
      await atomic(referenceFile(target), [...await readMatrixReferences(target), receipt]); importedIds = [id];
    } else if (target.kind === "image") {
      let bundle = copied.canvas;
      if (!bundle) bundle = { version: 1, groups: [], nodes: copied.artifacts.map((a, i) => ({ id: a.id, type: "requirement", title: a.title, text: a.paragraphs.map(p => p.text).join("\n\n"), prompt: a.paragraphs.map(p => p.text).join("\n\n"), x: i * 360, y: 0, width: 320, height: 240, status: "done", requirement: { text: a.paragraphs.map(p => p.text).join("\n\n") }, matrixSnapshot: snapshotPath })) };
      if(copied.documents?.length){const docIds=new Map();for(const doc of copied.documents){
        const newId="doc-"+randomUUID();docIds.set(doc.id,newId);
        if(doc.source?.relativePath){const original=path.resolve(target.path,doc.source.relativePath),bytes=await fs.readFile(original),digest=createHash("sha256").update(bytes).digest("hex");if(digest!==doc.source.sha256)throw Error("文档原件校验失败。");const canonical=path.join(target.path,".iiimage","studio","sources",digest+path.extname(original));await fs.mkdir(path.dirname(canonical),{recursive:true});await fs.writeFile(canonical,bytes);doc.source.relativePath=path.relative(target.path,canonical).replaceAll("\\","/");}
        await atomic(path.join(target.path,".iiimage","studio",newId+".json"),{...doc,id:newId,projectId:target.id,source:{...doc.source,copiedFrom:{projectId:source.id,id:doc.id,revision:doc.revision}}});
      }bundle.nodes=bundle.nodes.map(n=>n.documentId?{...n,documentId:docIds.get(n.documentId)||n.documentId}:n);}
      let sequence = Math.max(targetSession.nodeSequence || 0, ...(targetSession.nodes || []).map(n => Number(n.id.match(/\d+$/)?.[0]) || 0));
      const ids = new Map(bundle.nodes.map(n => [n.id, `N${++sequence}`]));
      const assets = Object.fromEntries(clipboardAssetPaths(bundle).map(file => [file, { path: file, url: assetUrl(file) }]));
      const maxX = Math.max(0, ...(targetSession.nodes || []).map(n => n.x + (n.width || 320)));
      const pasted = pasteCanvasSelection(bundle, ids, assets, { x: maxX + 80, y: 80 }, (targetSession.nodes || []).length + 1);
      pasted.nodes.forEach(n => { n.matrixSnapshot = snapshotPath; });
      await saveImage(target, { ...targetSession, nodes: [...(targetSession.nodes || []), ...pasted.nodes], layoutGroups: [...(targetSession.layoutGroups || []), ...pasted.groups], nodeSequence: sequence }, targetSession.sessionRevision);
      importedIds = pasted.nodes.map(n => n.id);
    } else {
      const imagePaths = [...new Set(mappings.values())].filter(file => /\.(png|jpe?g|webp|gif|bmp)$/i.test(file));
      importedIds = await saveWriting(target, targetSession, { artifacts: copied.artifacts, title, snapshotPath, imagePaths, count: receipt.count, source });
    }
    let moved = false, moveError;
    if (input.mode === "move") {
      try { await removeSource(source, session, input.nodeIds, canvas, artifacts); moved = true; }
      catch (error) { moveError = `目标已保存，原节点仍保留：${error.message}`; }
    }
    return { ok: !moveError, copied: true, moved, error: moveError, targetProjectId: target.id, sourceProjectId: source.id, nodeIds: importedIds, reference: target.kind === "agent" ? receipt : undefined };
  }
  return { transfer(input) { const next = queue.then(() => transfer(input)); queue = next.catch(() => {}); return next; } };
}
module.exports = { createMatrixTransfer, readMatrixReferences, readSnapshot, removeTransferredNodes, referenceFile, atomic };
