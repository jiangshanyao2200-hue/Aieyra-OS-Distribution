/* @file-map:start
文件: link/office/web/office-home-model.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/model.js
上游: link/office/tests/unit/office-home-layout.test.mjs, link/office/web/office-home.js
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: link/office/tests/unit/office-home-layout.test.mjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  stationCodes | function
  recentMessages | function
  mergeTasks | function
  recentTasks | function
  orderedMessages | function
  stationRosterPage | function
  homeLayout | function
  homeLayout.gapFor | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import { list, text, timestamp } from './model.js';

// Codes derive from immutable seat identities, never current sort positions.
export /* @chain-region stationCodes | calls: Map, Set, sort, a.id.localeCompare, trim, text, match, c.codePointAt … */ function stationCodes(rows) {
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
export /* @chain-region recentMessages | calls: Date.now, Map, list, timestamp, text, Number.isSafeInteger, Number.isFinite, map.set … */ function recentMessages(items, now = Date.now()) {
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
export /* @chain-region mergeTasks | calls: Map, list, text, records.get, Number.isSafeInteger, timestamp, records.set, sort … */ function mergeTasks(current, incoming) {
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
export /* @chain-region recentTasks | calls: Number.isSafeInteger, Math.max, Math.min, slice, filter, mergeTasks */ function recentTasks(items, limit = 10) {
  const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(20, limit)) : 10;
  return mergeTasks([], items).filter((row) => !row.project || row.project === 'os').slice(0, count);
}
export /* @chain-region orderedMessages | calls: Map, list, text, Number.isSafeInteger, records.set, sort, records.values, localeCompare */ function orderedMessages(items) {
  const records = new Map();
  for (const row of list(items))
    if (text(row.id) && Number.isSafeInteger(row.seq) && row.seq > 0) records.set(row.id, row);
  return [...records.values()].sort((a, b) => a.seq - b.seq || text(a.id).localeCompare(text(b.id)));
}

export /* @chain-region stationRosterPage | calls: filter, split, trim, query.toLowerCase, rows.filter, toLowerCase, terms.every, label.includes … */ function stationRosterPage(rows, { query = '', status = 'all', page = 0 } = {}) {
  const pageSize = 36;
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = rows.filter((row) => {
    if (status !== 'all' && row.link.state !== status) return false;
    if (!terms.length) return true;
    const label = `${row.name || ''} ${row.id}`.toLowerCase();
    return terms.every((term) => label.includes(term));
  });
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Math.max(0, Math.min(pages - 1, page));
  const start = current * pageSize;
  return { items: matches.slice(start, start + pageSize), total: matches.length, page: current, pages };
}

export /* @chain-region homeLayout | calls: Math.max, Math.min, Math.floor, Math.ceil, gapFor */ function homeLayout(count, width, height) {
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
    /* @chain-region homeLayout.gapFor | calls: Math.max */ gapFor = (cols) => (cols <= 3 ? (narrow ? 16 : 38) : Math.max(narrow ? 10 : 14, 38 - (cols - 3) * 6));
  // 一行最多七个；先压缩图形和间距，达到可读下限后再按行均分。
  let cols = Math.min(n, 7);
  while (cols > 1 && cols * min + (cols - 1) * minGap > span) cols--;
  const lines = Math.ceil(n / cols);
  cols = Math.ceil(n / lines);
  const gap = cols > 1 ? Math.floor(Math.min(gapFor(cols), (span - cols * min) / (cols - 1))) : 0,
    size = Math.max(min, Math.min(max, (span - (cols - 1) * gap) / cols, (height - (lines - 1) * rowGap) / lines - text));
  return { columns: cols, size: Math.floor(size), gap };
}
