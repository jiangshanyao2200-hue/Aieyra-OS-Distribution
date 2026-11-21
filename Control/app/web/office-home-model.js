// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Control/app/web/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: stationCodes; recentMessages; mergeTasks; recentTasks; orderedMessages; homeLayout
// Impact: python -B scripts/code-atlas.py show Control/app/web/office-home-model.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import { list, text, timestamp } from './model.js';

// Codes derive from immutable seat identities, never current sort positions.
export function stationCodes(rows) {
  const map = new Map(),
    used = new Set();
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const declared = text(row.code || row.alias).trim(),
      named = text(row.name).match(/(?:^|[\s·])((?:W|S)-?\d{2,6})(?:$|\s)/i)?.[1];
    let hash = 2166136261;
    for (const c of row.id) {
      hash ^= c.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const generated = 'S-' + hash.toString(36).toUpperCase().padStart(7, '0'),
      base = declared || named || generated;
    let code = base;
    if (used.has(code)) code = generated;
    if (used.has(code)) code = generated + '-' + row.id;
    used.add(code);
    map.set(row.id, code);
  }
  return map;
}
export function recentMessages(items, now = Date.now()) {
  const map = new Map();
  for (const m of list(items)) {
    const at = timestamp(m.created);
    if (
      text(m.id) &&
      Number.isSafeInteger(m.seq) &&
      Number.isFinite(at) &&
      at >= now - 86400000 &&
      at <= now
    )
      map.set(m.id, m);
  }
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

// Read projections only: preserve the center's records and prefer newer versions.
export function mergeTasks(current, incoming) {
  const records = new Map();
  for (const row of [...list(current), ...list(incoming)]) {
    if (!text(row.id)) continue;
    const previous = records.get(row.id),
      version = Number.isSafeInteger(row.version) ? row.version : 0,
      oldVersion = Number.isSafeInteger(previous?.version) ? previous.version : 0,
      at = timestamp(row.updated || row.updated_at || row.created) || 0,
      oldAt = timestamp(previous?.updated || previous?.updated_at || previous?.created) || 0;
    if (!previous || version > oldVersion || (version === oldVersion && at >= oldAt))
      records.set(row.id, row);
  }
  return [...records.values()].sort(
    (a, b) =>
      (timestamp(b.updated || b.updated_at || b.created) || 0) -
        (timestamp(a.updated || a.updated_at || a.created) || 0) || text(a.id).localeCompare(text(b.id)),
  );
}
export function recentTasks(items, limit = 10) {
  const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(20, limit)) : 10;
  return mergeTasks([], items).filter((row) => !row.project || row.project === 'os').slice(0, count);
}
export function orderedMessages(items) {
  const records = new Map();
  for (const row of list(items))
    if (text(row.id) && Number.isSafeInteger(row.seq) && row.seq > 0) records.set(row.id, row);
  return [...records.values()].sort((a, b) => a.seq - b.seq || text(a.id).localeCompare(text(b.id)));
}

export function homeLayout(count, width, height) {
  // 回到原来 Link 的排布（用户 2026-10-16）：工位大、间距宽、居中；名字下面两行——设备（工位色）、状态；不显示编号（docs/工位与协同.md Link §2.5）。
  // width/height 是扣除实际内边距和滚动条后的内容区域，不能再估算窗口留白。
  const narrow = width < 600,
    n = Math.max(1, count),
    min = Math.min(104, Math.max(1, width)),
    max = narrow ? 185 : 260,
    text = 112,
    rowGap = 28,
    span = Math.max(1, Math.floor(width)),
    minGap = 12,
    gapFor = (cols) => (cols <= 3 ? (narrow ? 16 : 38) : Math.max(narrow ? 10 : 14, 38 - (cols - 3) * 6));
  // 一行最多七个；先压缩图形和间距，达到可读下限后再按行均分。
  let cols = Math.min(n, 7);
  while (cols > 1 && cols * min + (cols - 1) * minGap > span) cols--;
  const lines = Math.ceil(n / cols);
  cols = Math.ceil(n / lines);
  const gap = cols > 1 ? Math.floor(Math.min(gapFor(cols), (span - cols * min) / (cols - 1))) : 0,
    size = Math.max(min, Math.min(max, (span - (cols - 1) * gap) / cols, (height - (lines - 1) * rowGap) / lines - text));
  return { columns: cols, size: Math.floor(size), gap };
}
