"use strict";
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { atomicWriteJson } = require("../core/json-storage.cjs");

function createStyleLibrary({ root, resolveSource, assetUrlFor, importImages, importFiles }) {
  const manifest = path.join(root, "library.json");
  let pending = Promise.resolve();
  const name = value => {
    const text = String(value || "").trim();
    if (!text || text.length > 100) throw new Error("名称须为 1–100 个字符。");
    return text;
  };
  const find = (items, id, label) => {
    const item = items.find(item => item.id === id);
    if (!item) throw new Error(`${label}已不存在，请刷新风格库。`);
    return item;
  };
  async function read() {
    try {
      const data = JSON.parse(await fs.readFile(manifest, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.folders) || !Array.isArray(data.styles) ||
          data.styles.some(style => !Array.isArray(style.images) || style.images.length > 5 || style.images.some(image => !/^[a-f0-9]{64}\.(png|jpe?g|webp)$/i.test(image.file)))) throw new Error("风格库索引格式无效，原文件已保留。");
      if (data.styles.some(style => style.files !== undefined && (!Array.isArray(style.files) || style.files.length > 24 || style.files.some(file => !/^[a-f0-9]{64}\.[a-z0-9]{1,16}$/.test(file.file))))) throw Error("数据库附件索引无效，原文件已保留。");
      return data;
    } catch (error) { if (error.code === "ENOENT") return { version: 1, folders: [], styles: [] }; throw error; }
  }
  const snapshot = data => ({ ...data, styles: data.styles.map(style => ({ ...style,
    files: (style.files || []).map(file => ({ ...file, path: path.join(root, file.file) })),
    images: style.images.map(image => ({ ...image, asset: { type: "file", path: path.join(root, image.file),
      assetUrl: assetUrlFor(path.join(root, image.file)), contentHash: image.hash, originalName: image.name, prompt: image.prompt } })) })) });
  const folder = (data, id) => { if (id) find(data.folders, id, "文件夹"); return id || null; };
  async function importedImage(source) {
    const resolved = resolveSource(source?.asset?.path);
    if (!resolved) throw new Error("图片不存在或不可读取，请从当前作品重新添加。");
    const ext = path.extname(resolved).toLowerCase();
    if (!/^(\.png|\.jpe?g|\.webp)$/.test(ext)) throw new Error("风格库支持 PNG、JPG 和 WebP 图片。");
    if ((await fs.stat(resolved)).size > 128 * 1024 * 1024) throw new Error("单张图片不能超过 128 MB。");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resolved)) hash.update(chunk);
    const digest = hash.digest("hex"), file = `${digest}${ext}`;
    await fs.mkdir(root, { recursive: true });
    await fs.copyFile(resolved, path.join(root, file), 1).catch(error => { if (error.code !== "EEXIST") throw error; });
    return { id: randomUUID(), file, hash: digest, name: name(source.name || source.asset.originalName || "风格图片"),
      prompt: String(source.prompt || "").slice(0, 30000) };
  }
  async function importedFile(source) {
    const resolved = resolveSource(source?.path);
    if (!resolved) throw Error("附件不存在或不可读取。");
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 24 * 1024 * 1024) throw Error("附件必须是24 MB以内的普通文件。");
    const bytes = await fs.readFile(resolved);
    if (bytes.length !== stat.size) throw Error("附件读取期间已变化，请重试。");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const ext = path.extname(resolved).toLowerCase();
    const file = hash + (/^\.[a-z0-9]{1,16}$/.test(ext) ? ext : ".bin");
    await fs.mkdir(root, {recursive:true});
    await fs.writeFile(path.join(root,file), bytes, {flag:"wx"}).catch(error=>{if(error.code!=="EEXIST")throw error;});
    return {id:randomUUID(),file,hash,size:bytes.length,name:name(source.name || path.basename(resolved))};
  }
  async function mutate(input) {
    const data = await read(), action = input.action;
    const previous = new Map(data.styles.map(item => [item.id, {json:JSON.stringify(item),revision:item.revision || 1}]));
    if (input.expectedRevision !== undefined && input.expectedRevision !== (data.revision || 0)) throw new Error("数据库已变化，请重新读取后保存。");
    if (action === "save-record") {
      const recordId=input.id || input.styleId;
      let item = recordId ? find(data.styles, recordId, "数据") : null;
      if (item && input.recordRevision !== (item.revision || 1)) throw new Error("数据条目已被修改，请读取最新版本。");
      const projectId = String(input.projectId || item?.projectId || "").trim();
      const entityKey = String(input.entityKey || item?.entityKey || "").trim().normalize("NFKC").toLocaleLowerCase();
      if (entityKey.length > 200 || projectId.length > 200) throw Error("项目或实体标识过长。");
      if (item?.projectId && projectId !== item.projectId) throw Error("不能将数据库条目移到其他项目。");
      if (entityKey && data.styles.some(record => record.id !== item?.id && record.projectId === projectId && record.entityKey === entityKey)) throw Error("同项目实体已存在，请先读取并合并到已有条目。");
      const merges = input.mergeRecords || [];
      if (!Array.isArray(merges) || merges.length > 24 || new Set(merges.map(record => record.id)).size !== merges.length) throw Error("合并条目列表无效。");
      const merged = merges.map(record => {
        const source = find(data.styles, record.id, "合并来源");
        if (source.id === item?.id || record.revision !== (source.revision || 1)) throw Error("合并来源已变化，请重新读取。");
        if (source.projectId && source.projectId !== projectId) throw Error("不能合并其他项目的数据库条目。");
        return source;
      });
      const descriptor = input.descriptor;
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor) || JSON.stringify(descriptor).length > 40000) throw new Error("请提供不超过40000字符的结构化描述。");
      if (!["person", "anime", "product", "style", "scene", "preference", "other"].includes(input.category)) throw new Error("请选择有效的数据分类。");
      if(input.images!==undefined && !Array.isArray(input.images))throw Error("样板图列表无效。");
      if(input.tags!==undefined && (!Array.isArray(input.tags) || input.tags.length>30 || input.tags.some(tag=>typeof tag!=="string" || tag.trim().length>100)))throw Error("最多30个标签，每个标签不超过100字符。");
      const images = [];
      for (const source of input.images || []) { if (images.length >= 5) throw new Error("每条数据最多保存5张样板图。"); images.push(await importedImage(source)); }
      const files = [...(item?.files || []), ...merged.flatMap(record => record.files || [])];
      if (input.files !== undefined && (!Array.isArray(input.files) || input.files.length > 24)) throw Error("每条数据最多24个附件。");
      for (const source of input.files || []) files.push(await importedFile(source));
      const uniqueFiles = [...new Map(files.map(file => [file.hash, file])).values()];
      if (uniqueFiles.length > 24 || uniqueFiles.reduce((total, file) => total + file.size, 0) > 96 * 1024 * 1024) throw Error("附件超过24个或合计96 MB，未修改条目。");
      const allImages = [...new Map([...(input.images === undefined ? item?.images || [] : images), ...merged.flatMap(record => record.images)].map(image => [image.hash, image])).values()];
      if (allImages.length > 5) throw Error("合并后样板图超过5张，请先将额外图片作为附件保存，未修改条目。");
      if (!item) { item = { id: randomUUID(), name: name(input.name), folderId: folder(data, input.folderId), images: [], createdAt: new Date().toISOString() }; data.styles.push(item); }
      item.images = allImages;
      item.files = uniqueFiles;
      item.projectId = projectId;
      item.entityKey = entityKey;
      if (merged.length) {
        item.mergedRecords = [...(item.mergedRecords || []), ...merged.map(({ images, files, ...record }) => record)];
        const ids = new Set(merged.map(record => record.id));
        data.styles = data.styles.filter(record => !ids.has(record.id));
      }
      Object.assign(item, { name: name(input.name || item.name), category: input.category, descriptor: JSON.parse(JSON.stringify(descriptor)),
        tags: [...new Set((input.tags || item.tags || []).map(value => String(value).trim()).filter(Boolean))].slice(0, 30),
        summary: String(input.summary || "").slice(0, 4000), revision: previous.has(item.id) ? (item.revision || 1)+1 : 1,
        author: input.author === "agent" ? "agent" : "user", updatedAt: new Date().toISOString() });
      item.history = [...(item.history || []), { revision: item.revision, at: item.updatedAt, author: item.author, descriptor: item.descriptor, summary: item.summary }].slice(-30);
    }
    else if (action === "create-folder") data.folders.push({ id: randomUUID(), name: name(input.name), parentId: folder(data, input.parentId) });
    else if (action === "create-style") data.styles.push({ id: randomUUID(), name: name(input.name), folderId: folder(data, input.folderId), images: [] });
    else if (action === "add") {
      let style = input.styleId ? find(data.styles, input.styleId, "风格") : null;
      const newName = style ? "" : name(input.name || "新风格");
      if (!Array.isArray(input.images) || !input.images.length || input.images.length > 5) throw new Error("每个风格最多五张图片，请先选择作品。");
      // Validate the whole request before copying any source files.
      if (style && style.images.length >= 5) throw new Error("这个风格已有五张图片，请先移除一张或选择其他风格。");
      const destination = folder(data, input.folderId);
      const images = [];
      for (const source of input.images) {
        const image = await importedImage(source);
        if (![...(style?.images || []), ...images].some(item => item.hash === image.hash)) images.push(image);
      }
      if ((style?.images.length || 0) + images.length > 5) throw new Error("添加后超过五张图片，风格内容未修改。");
      if (!style) { style = { id: randomUUID(), name: newName, folderId: destination, images: [] }; data.styles.push(style); }
      style.images.push(...images);
    } else if (action === "rename" || action === "move" || action === "delete") {
      if (input.kind === "image") {
        const style = find(data.styles, input.styleId, "风格"), image = find(style.images, input.id, "图片");
        if (action === "rename") image.name = name(input.name);
        else if (action === "move") {
          const destination = find(data.styles, input.destinationId, "目标风格");
          if (destination.id !== style.id) {
            if (destination.images.length >= 5) throw new Error("目标风格已有五张图片。");
            if (destination.images.some(item => item.hash === image.hash)) throw new Error("目标风格已包含这张图片。");
            destination.images.push(image); style.images = style.images.filter(item => item.id !== image.id);
          }
        } else style.images = style.images.filter(item => item.id !== image.id);
      } else if (input.kind === "folder") {
        const current = find(data.folders, input.id, "文件夹");
        if (action === "rename") current.name = name(input.name);
        else if (action === "move") {
          let ancestor = folder(data, input.destinationId), visited = new Set();
          while (ancestor) {
            if (ancestor === current.id || visited.has(ancestor)) throw new Error("不能移动到自身或子文件夹。");
            visited.add(ancestor); ancestor = find(data.folders, ancestor, "文件夹").parentId;
          }
          current.parentId = input.destinationId || null;
        } else {
          if (data.folders.some(item => item.parentId === current.id) || data.styles.some(item => item.folderId === current.id)) throw new Error("请先移出文件夹中的内容，再删除空文件夹。");
          data.folders = data.folders.filter(item => item.id !== current.id);
        }
      } else if (input.kind === "style") {
        const style = find(data.styles, input.id, "风格");
        if (action === "rename") style.name = name(input.name);
        else if (action === "move") style.folderId = folder(data, input.destinationId);
        else data.styles = data.styles.filter(item => item.id !== style.id);
      } else throw new Error("风格库操作类型无效。");
    } else throw new Error("未知风格库操作。");
    if(action!=="save-record")for(const item of data.styles){const old=previous.get(item.id);if(!old)item.revision=1;else if(JSON.stringify(item)!==old.json)item.revision=old.revision+1;}
    data.revision = (data.revision || 0) + 1;
    await fs.mkdir(root, { recursive: true });
    atomicWriteJson(manifest, data);
    // Existing project references own their imported copies. Unreferenced
    // library blobs can be removed only after the manifest commits.
    const referenced = new Set(data.styles.flatMap(style => [...style.images, ...(style.files || [])].map(file => file.file)));
    for (const file of await fs.readdir(root)) if (/^[a-f0-9]{64}\.[a-z0-9]{1,16}$/.test(file) && !referenced.has(file)) await fs.unlink(path.join(root, file)).catch(() => {});
    return snapshot(data);
  }
  const serial = operation => { const result = pending.then(operation); pending = result.catch(() => {}); return result; };
  return {
    list: () => serial(async () => snapshot(await read())),
    mutate: input => serial(() => mutate(input)),
    reference: input => serial(async () => {
      const style = find((await read()).styles, input.styleId, "风格");
      if (style.projectId && style.projectId !== input.projectId) throw Error("数据库条目属于其他项目。");
      if(input.recordRevision!==undefined && input.recordRevision!==(style.revision||1))throw Error("数据库已有更新，请重新读取最新条目后引用。");
      const images = input.imageId ? [find(style.images, input.imageId, "图片")] : style.images;
      const imported = images.length ? await importImages({ projectId: input.projectId, paths: images.map(image => path.join(root, image.file)), maxFiles: 5, includeSourcePaths: true }) : {sourcePaths:[],assets:[]};
      const assets = new Map(imported.sourcePaths.map((source, index) => [path.resolve(source), imported.assets[index]]));
      if (images.some(image => !assets.has(path.join(root, image.file)))) throw new Error("风格图片未完整导入，请重试。");
      const sourceFiles = style.files || [];
      if (sourceFiles.length && !importFiles) throw Error("当前运行环境不支持数据库附件，请更新后重试。");
      const importedFiles = sourceFiles.length ? await importFiles({projectId:input.projectId,paths:sourceFiles.map(file => path.join(root,file.file)),maxFiles:24}) : {files:[]};
      if (importedFiles.skippedCount || importedFiles.files?.length !== sourceFiles.length) throw Error("数据库附件未完整导入，请重试。");
      const files = importedFiles.files.map((file,index)=>({...file,name:sourceFiles[index].name}));
      return { id: style.id, projectId: input.projectId, revision: style.revision || 1, name: style.name, category: style.category || "style", descriptor: style.descriptor || {}, summary: style.summary || "", files, images: images.map(image => ({ ...image, asset: assets.get(path.join(root, image.file)) })) };
    })
  };
}
module.exports = { createStyleLibrary };
