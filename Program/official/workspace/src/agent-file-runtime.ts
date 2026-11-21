import type { AgentFileAttachment, ReferenceImage } from "./core";

// Read DataTransfer while its browser event is live. QQ/clipboard files may
// contain bytes without an OS path; files and items often describe the same file.
export function transferredFiles(transfer: DataTransfer): File[] {
  const files = [...Array.from(transfer.files), ...Array.from(transfer.items).flatMap(item => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  })];
  const seen = new Set<string>();
  return files.filter(file => {
    const key = `${file.name}\0${file.size}\0${file.type}\0${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export async function importTransferredFiles(projectId: string, files: File[]) {
  const api = window.aieyraConfig;
  if (!api?.importAgentFiles) throw Error("当前客户端不支持文件导入，请更新后重试。");
  if (!files.length) throw Error("没有读取到拖入文件，请重新拖入或复制后粘贴。");
  if (files.length > 24) throw Error("一次最多添加 24 个文件，请分批添加。");
  let total = 0;
  const paths: string[] = [], bytes: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const file of files) {
    if (file.size > 24 * 1024 * 1024 || (total += file.size) > 96 * 1024 * 1024) throw Error("单个文件最多 24 MB，一次最多 96 MB；已保留原草稿。");
    let path = "";
    try { path = api.pathForDroppedFile?.(file) || ""; } catch { /* In-memory clipboard file. */ }
    if (path) paths.push(path);
    else bytes.push({ name: file.name || (file.type.startsWith("image/") ? "粘贴图片.png" : "未命名文件"), bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return api.importAgentFiles({ projectId, paths, files: bytes, maxFiles: 24 });
}

export function attachmentKey(file: AgentFileAttachment) {
  return file.id || file.contentHash || file.path || `${file.name}:${file.size}`;
}

export function prepareAgentFileAttachments(
  current: AgentFileAttachment[],
  incoming: AgentFileAttachment[],
  maxCount = 24,
  maxBytes = 96 * 1024 * 1024,
  maxFileBytes = 24 * 1024 * 1024
) {
  const byKey = new Map(current.map((file) => [attachmentKey(file), file]));
  incoming.forEach((file) => byKey.set(attachmentKey(file), file));
  const files: AgentFileAttachment[] = [];
  let totalBytes = 0;
  let rejected = 0;
  for (const file of byKey.values()) {
    const size = Math.max(0, Math.floor(Number(file.size) || 0));
    if (size > maxFileBytes || files.length >= maxCount || totalBytes + size > maxBytes) {
      rejected += 1;
      continue;
    }
    files.push({ ...file, size });
    totalBytes += size;
  }
  const acceptedKeys = new Set(files.map(attachmentKey));
  const acceptedIncoming = incoming.filter((file) => acceptedKeys.has(attachmentKey(file)));
  const incomingImages: ReferenceImage[] = acceptedIncoming.flatMap((file, index) => {
    if (file.kind !== "image" && !/^image\//i.test(file.mimeType)) return [];
    return [{
      assetId: file.id,
      contentHash: file.contentHash,
      name: file.name,
      path: file.path,
      relativePath: file.relativePath,
      mimeType: file.mimeType,
      assetUrl: file.assetUrl,
      displayCode: `ATT${index + 1}`,
      taskRole: "source"
    } satisfies ReferenceImage];
  });
  return {
    files,
    acceptedIncoming,
    incomingImages,
    totalBytes,
    rejected,
    truncated: rejected > 0 || acceptedIncoming.length < incoming.length
  };
}
