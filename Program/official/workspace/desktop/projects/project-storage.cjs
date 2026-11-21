"use strict";

const fs = require("node:fs");
const { isArchivedProject } = require("./project-lifecycle.cjs");
const fsp = fs.promises;
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { atomicWriteJson } = require("../core/json-storage.cjs");

const key = value => {
  const resolved = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
const inside = (child, parent) => key(child) === key(parent) || key(child).startsWith(`${key(parent)}/`);

function readProjectsRoot(configDir, listPath) {
  if (fs.existsSync(listPath)) {
    try {
      const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
      if (typeof list.projectsRoot === "string") {
        // A registry saved from WSL must still address the same drive on Windows.
        // Resolving /mnt/e/... directly on Windows creates an incorrect drive-relative directory instead.
        const wslDrive = process.platform === "win32" && /^\/mnt\/([a-z])(?:\/|$)/i.exec(list.projectsRoot);
        const root = wslDrive
          ? `${wslDrive[1].toUpperCase()}:\\${list.projectsRoot.slice(wslDrive[0].length).replace(/\//g, "\\")}`
          : list.projectsRoot;
        if (path.isAbsolute(root)) return path.resolve(root);
      }
    } catch { /* normal startup recovery handles malformed registry */ }
  }
  return path.join(configDir, "projects");
}

// Only confirmed missing/non-directory roots leave the registry. A permission
// error is not evidence that a user's project was deleted.
function existingProjectRecords(list) {
  const projects = list.projects.filter(project => {
    try { return fs.statSync(project.path).isDirectory() && !isArchivedProject(project.path); }
    catch (error) { return !["ENOENT", "ENOTDIR"].includes(error.code); }
  });
  if (projects.length === list.projects.length) return list;
  return { ...list, projects, activeProjectId: projects.some(project => project.id === list.activeProjectId) ? list.activeProjectId : projects[0]?.id || "" };
}

async function digest(file, signal) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

function relocateString(value, mappings) {
  if (value.startsWith("iiimage-asset://local/abs/")) {
    try { return `iiimage-asset://local/abs/${encodeURIComponent(relocateString(decodeURIComponent(value.slice(26)), mappings))}`; } catch { return value; }
  }
  if (!path.isAbsolute(value)) return value;
  for (const [from, to] of mappings) {
    if (inside(value, from)) return path.join(to, path.relative(from, value));
  }
  return value;
}

// The registry switches atomically. These aliases let old persisted drafts and
// Agent receipts resolve to the current files without modifying recovery copies.
function projectPathMappings(list) {
  const roots = new Set((list.projects || []).filter(project => !project.external).map(project => key(path.join(list.projectsRoot, project.id))));
  return (Array.isArray(list.pathMappings) ? list.pathMappings : []).filter(mapping =>
    Array.isArray(mapping) && mapping.length === 2 && mapping.every(value => typeof value === "string" && path.isAbsolute(value)) && roots.has(key(mapping[1]))
  ).sort((a, b) => b[0].length - a[0].length);
}

function relocateStoredValue(value, mappings) {
  if (typeof value === "string") {
    const relocated = relocateString(value, mappings);
    if (relocated !== value) return relocated;
    try {
      const json = JSON.parse(value);
      if (json && typeof json === "object" && relocateJson(json, mappings)) return JSON.stringify(json);
    } catch { /* Historical prose is preserved verbatim. */ }
    return value;
  }
  if (value && typeof value === "object") relocateJson(value, mappings);
  return value;
}

// Iterative traversal also handles deeply nested sessions without recursion.
function relocateJson(value, mappings) {
  const stack = [value];
  let changed = false, entries = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const name of Object.keys(current)) {
      if (++entries > 2000000) throw new Error("项目元数据过大，迁移已停止，原文件保持完整。");
      if (typeof current[name] === "string") {
        const next = relocateString(current[name], mappings);
        if (next !== current[name]) { current[name] = next; changed = true; }
      } else if (current[name] && typeof current[name] === "object") stack.push(current[name]);
    }
  }
  return changed;
}

async function assertDirectory(directory) {
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("项目目录不能是符号链接或联接点。");
  if (key(await fsp.realpath(directory)) !== key(directory)) throw new Error("目录包含重定向路径，请选择实际文件夹。");
}

/** Copy + verify before one atomic registry switch. Originals are recovery data. */
async function migrateProjectsRoot({ configDir, listPath, fromRoot, toRoot, progress = () => {}, signal, checkpoint = () => {} }) {
  const sourceRoot = path.resolve(fromRoot), destination = path.resolve(toRoot);
  if (key(sourceRoot) === key(destination)) return { root: sourceRoot, count: 0, changed: false };
  if (inside(destination, sourceRoot) || inside(sourceRoot, destination)) throw new Error("新目录和原项目目录不能互相包含。");
  const originalBytes = await fsp.readFile(listPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const list = originalBytes ? JSON.parse(originalBytes) : { projects: [], activeProjectId: "" };
  if (!Array.isArray(list.projects)) throw new Error("项目列表格式异常，迁移已停止。");
  const managed = list.projects.filter(project => !project.external);
  await fsp.mkdir(destination, { recursive: true });
  await assertDirectory(destination);
  if (managed.length) await assertDirectory(sourceRoot);
  const mappings = managed.map(project => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(project.id) || [".", ".."].includes(project.id)) throw new Error("项目标识无效。");
    return [path.join(sourceRoot, project.id), path.join(destination, project.id)];
  });
  if (new Set(mappings.map(([source]) => key(source))).size !== mappings.length) throw new Error("项目列表包含重复标识，迁移已停止。");
  for (const [source, target] of mappings) {
    await assertDirectory(source);
    if (fs.existsSync(target)) throw new Error(`目标目录已有同名项目 ${path.basename(target)}，请选用空目录。`);
  }
  const stage = await fsp.mkdtemp(path.join(destination, ".aieyra-move-"));
  const promoted = [];
  let committed = false;
  const cancel = () => { if (signal?.aborted) throw signal.reason || new Error("迁移已取消，原项目保持完整。"); };
  try {
    let fileCount = 0, bytes = 0;
    const sources = [], directories = [];
    progress({ phase: "copying", files: 0, bytes: 0, completed: 0, total: mappings.length });
    for (let index = 0; index < mappings.length; index++) {
      const [source, target] = mappings[index];
      const stagedRoot = path.join(stage, path.basename(target));
      const queue = [[source, stagedRoot]];
      while (queue.length) {
        cancel();
        const [directory, output] = queue.pop();
        await assertDirectory(directory);
        await fsp.mkdir(output, { recursive: true });
        const entries = await fsp.readdir(directory, { withFileTypes: true });
        directories.push({ directory, names: entries.map(entry => entry.name).sort().join("\n") });
        for (const entry of entries) {
          cancel();
          if (++fileCount > 200000) throw new Error("项目文件数量超过本次迁移上限，原目录保持完整。");
          const file = path.join(directory, entry.name), copy = path.join(output, entry.name);
          if (entry.isSymbolicLink()) throw new Error(`项目包含链接 ${entry.name}，请先整理该链接后迁移。`);
          if (entry.isDirectory()) { queue.push([file, copy]); continue; }
          if (!entry.isFile()) throw new Error(`无法迁移特殊文件 ${entry.name}。`);
          const before = await fsp.stat(file);
          const sourceHash = await digest(file, signal);
          await fsp.copyFile(file, copy, fs.constants.COPYFILE_EXCL);
          if (sourceHash !== await digest(copy, signal)) throw new Error(`文件校验失败：${entry.name}。`);
          const after = await fsp.stat(file);
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("迁移时项目仍在写入，已停止，请稍后重试。");
          sources.push({ file, size: after.size, mtimeMs: after.mtimeMs });
          bytes += after.size;
          if (/\.json$/i.test(entry.name)) {
            if (after.size >= 64 * 1024 * 1024) throw new Error(`项目元数据 ${entry.name} 超过安全迁移大小，原文件保持完整。`);
            let json;
            try { json = JSON.parse(await fsp.readFile(copy, "utf8")); } catch { continue; }
            if (relocateJson(json, mappings)) await fsp.writeFile(copy, `${JSON.stringify(json, null, 2)}\n`);
          }
          if (fileCount % 16 === 0) progress({ phase: "copying", files: fileCount, bytes, completed: index, total: mappings.length });
        }
      }
      progress({ phase: "verified", files: fileCount, bytes, completed: index + 1, total: mappings.length });
    }
    await checkpoint("copied");
    cancel();
    for (const original of sources) {
      cancel();
      const stat = await fsp.stat(original.file);
      if (stat.size !== original.size || stat.mtimeMs !== original.mtimeMs) throw new Error("项目文件在迁移期间发生变化，已停止切换。");
    }
    for (const { directory, names } of directories) {
      cancel();
      if ((await fsp.readdir(directory)).sort().join("\n") !== names) throw new Error("迁移期间项目文件列表发生变化，已停止切换。");
    }
    const currentBytes = await fsp.readFile(listPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (originalBytes ? !currentBytes?.equals(originalBytes) : currentBytes !== null) throw new Error("项目列表在迁移期间发生变化，请重试。");
    for (const [, target] of mappings) {
      cancel();
      await assertDirectory(destination);
      if (fs.existsSync(target)) throw new Error("目标目录出现同名项目，已停止切换。");
      await fsp.rename(path.join(stage, path.basename(target)), target);
      promoted.push(target);
    }
    await checkpoint("promoted");
    cancel();
    const aliases = projectPathMappings({ ...list, projectsRoot: sourceRoot }).map(([from, to]) => [from, relocateString(to, mappings)]);
    list.pathMappings = [...new Map([...aliases, ...mappings].map(mapping => [key(mapping[0]), mapping])).values()];
    list.projectsRoot = destination;
    for (const project of list.projects) {
      if (!project.external) { relocateJson(project, mappings); project.path = path.join(destination, project.id); project.sessionPath = path.join(project.path, "session.json"); }
    }
    atomicWriteJson(path.join(configDir, "project-root-recovery.json"), {
      id: randomUUID(), fromRoot: sourceRoot, toRoot: destination, createdAt: new Date().toISOString(),
      originalRegistry: originalBytes ? JSON.parse(originalBytes) : null, note: "原目录为迁移恢复副本，当前项目由 project-list.json 唯一登记。"
    });
    atomicWriteJson(listPath, list, { expectedInputSha256: originalBytes ? createHash("sha256").update(originalBytes).digest("hex") : null });
    committed = true;
    return { root: destination, previousRoot: sourceRoot, count: managed.length, files: fileCount, bytes, changed: true };
  } finally {
    // Only paths created exclusively by this invocation can be removed.
    if (!committed) for (const target of promoted.reverse()) {
      if (inside(target, destination) && key(target) !== key(destination)) await fsp.rm(target, { recursive: true, force: true });
    }
    if (inside(stage, destination) && path.basename(stage).startsWith(".aieyra-move-")) await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { existingProjectRecords, readProjectsRoot, migrateProjectsRoot, relocateJson, relocateStoredValue, projectPathMappings };
