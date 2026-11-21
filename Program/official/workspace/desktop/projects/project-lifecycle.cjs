"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteJson } = require("../core/json-storage.cjs");
const ARCHIVE_FILE = ".iiimage/archived.json";
const pathKey = value => {
  const key = path.resolve(value);
  return process.platform === "win32" ? key.toLowerCase() : key;
};
const contains = (parent, child) => pathKey(child) === pathKey(parent) || pathKey(child).startsWith(pathKey(parent) + path.sep);

// Even an unreadable/incomplete archive marker must not resurrect a project.
function isArchivedProject(directory) {
  try { fs.lstatSync(path.join(directory, ARCHIVE_FILE)); return true; }
  catch (error) { return !["ENOENT", "ENOTDIR"].includes(error.code); }
}

function assertProjectDirectory(project, { protectedPaths = [], projects = [] } = {}) {
  if (!project?.path || !path.isAbsolute(project.path)) throw new Error("项目路径无效，已取消操作。");
  const directory = path.resolve(project.path);
  const real = fs.realpathSync(directory);
  if (fs.lstatSync(directory).isSymbolicLink() || pathKey(real) !== pathKey(directory)) throw new Error("项目目录包含链接，已取消操作。");
  if (pathKey(directory) === pathKey(path.parse(directory).root) || protectedPaths.some(p => p && contains(directory, p))) throw new Error("项目路径受保护，已取消操作。");
  if (projects.some(p => p.id !== project.id && (contains(directory, p.path) || contains(p.path, directory)))) throw new Error("项目目录与其他项目重叠，已取消操作。");
  const manifestPath = path.join(directory, ".iiimage", "project.json");
  if (fs.lstatSync(path.dirname(manifestPath)).isSymbolicLink() || fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error("项目标识包含链接，已取消操作。");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== "iiimage-project" || !manifest.project?.id) throw new Error("项目标识无效，已取消操作。");
  if (manifest.project.id !== project.id) throw new Error("项目目录的标识已变化，与当前项目不一致，已取消操作。请重新打开并核对项目。");
  return directory;
}

function archiveProjectDirectory(project, options) {
  const directory = assertProjectDirectory(project, options);
  atomicWriteJson(path.join(directory, ARCHIVE_FILE), { schemaVersion: 1, projectId: project.id, archivedAt: new Date().toISOString() });
}

// Deliberately inspect raw data. Normalizers may discard unknown/legacy content.
function emptyProjectSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  const metadata = new Set(["schemaVersion", "projectKind", "projectId", "sessionRevision", "canvasRevision", "activeConversationId", "selectedNodeId", "selectedArtifactId", "selectedParagraphId", "artifactViewport"]);
  const collections = new Set(["nodes", "messages", "layoutGroups", "artifacts", "artifactEdges", "artifactLayout"]);
  for (const [key, value] of Object.entries(session)) {
    if (metadata.has(key)) continue;
    if (key === "nodeSequence") { if (value !== 0) return false; continue; }
    if (collections.has(key)) { if (!Array.isArray(value) || value.length) return false; continue; }
    if (key === "conversations") {
      if (!Array.isArray(value) || value.some(c => !c || !Array.isArray(c.messages) || c.messages.length || Object.keys(c).some(k => !["id", "title", "createdAt", "updatedAt", "messages"].includes(k)))) return false;
      continue;
    }
    if (key === "pendingAgentExecution" && value === null) continue;
    return false;
  }
  return Array.isArray(session.nodes) && Array.isArray(session.messages);
}

function isEmptyManagedProject(project, projectsRoot) {
  if (project.external || project.quarantine || !["image", "writing"].includes(project.kind) || isArchivedProject(project.path)) return false;
  if (pathKey(project.path) !== pathKey(path.join(projectsRoot, project.id))) return false;
  try {
    // Populated canvases can have large asset manifests. Reject them before
    // parsing the manifest just to decide whether an optional empty tab exists.
    for (const file of [project.sessionPath, path.join(project.path, ".iiimage/project.json")]) {
      const stats = fs.lstatSync(file);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 256 * 1024) return false;
    }
    assertProjectDirectory(project, { protectedPaths: [projectsRoot] });
    let entries = 0;
    const walk = (directory, prefix = "") => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (++entries > 100 || entry.isSymbolicLink()) return false;
        const relative = prefix + entry.name, file = path.join(directory, entry.name);
        if (entry.isDirectory()) { if (!walk(file, relative + "/")) return false; }
        else if (entry.isFile() && ["session.json", ".iiimage/project.json"].includes(relative)) {
          if (fs.statSync(file).size > 256 * 1024) return false;
        } else return false;
      }
      return true;
    };
    if (!walk(project.path)) return false;
    const manifest = JSON.parse(fs.readFileSync(path.join(project.path, ".iiimage/project.json"), "utf8"));
    if (manifest.project.id !== project.id || !Array.isArray(manifest.assets) || manifest.assets.length) return false;
    return emptyProjectSession(JSON.parse(fs.readFileSync(project.sessionPath, "utf8")));
  } catch { return false; }
}

module.exports = { isArchivedProject, assertProjectDirectory, archiveProjectDirectory, emptyProjectSession, isEmptyManagedProject };
