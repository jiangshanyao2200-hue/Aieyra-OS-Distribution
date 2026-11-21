/* @file-map:start
文件: link/office/web/pixel-office.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/model.js
上游: link/office/web/office-home.js
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  pixelPortrait | function
  pixelOfficeTables | function
  recentCompletion | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import { esc, list, text, timestamp } from './model.js';

const palette = ['#18222c', '#305969', '#58c1a5', '#acd77d', '#f3d493', '#d78770', '#f1aebb', '#e0eced', '#788bc3', '#a188c9'];


export /* @chain-region pixelPortrait | calls: Array.isArray, portrait.pixels.every, test, toLowerCase, join, filter, String, Math.imul … */ function pixelPortrait(seat) {
  const portrait = seat.pixel_avatar;
  const custom = Array.isArray(portrait?.pixels) && portrait.pixels.length === 14 &&
    portrait.pixels.every(row => typeof row === 'string' && /^[.0-9]{12}$/.test(row));
  if (!custom) {
    const identity = [seat.name, seat.agent?.name, seat.agent?.runtime?.provider].filter(Boolean).join(' ').toLowerCase();
    let seed = 0;
    for (const ch of String(seat.id || identity)) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
    const style = seat.leader ? 'iris' : /\blink\b|协作|deepseek|深度求索/.test(identity) ? 'jade' :
      /claude|anthropic/.test(identity) ? 'ember' : ['tide', 'iris'][seed % 2];
    return `<span class="pixel-station-avatar portrait-sprite portrait-${style}" aria-hidden="true"></span>`;
  }
  const pixels = portrait.pixels;
  const dots = [];
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 12; x++) {
      const code = pixels[y][x], color = palette[code];
      if (color) dots.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${esc(color)}"/>`);
    }
  }
  return `<svg class="pixel-station-avatar" viewBox="0 0 12 14" shape-rendering="crispEdges" aria-hidden="true">${dots.join('')}</svg>`;
}

export /* @chain-region pixelOfficeTables | calls: Map, map, list, text, tables.has, tables.set, names.get, seats.push … */ function pixelOfficeTables(items, registry) {
  const names = new Map(list(registry?.projects).map(project => [text(project.id), text(project.name)]));
  const tables = new Map();
  for (const seat of items) {
    const project = text(seat.project);
    if (!tables.has(project)) tables.set(project, { name: names.get(project) || project, seats: [] });
    tables.get(project).seats.push(seat);
  }
  return [...tables.values()];
}

export /* @chain-region recentCompletion | calls: Date.now, find, list, timestamp, Number.isFinite */ function recentCompletion(seat, now = Date.now()) {
  return list(seat.tasks).find(task => {
    const at = timestamp(task.updated ?? task.updated_at);
    return task.status === 'accepted' && Number.isFinite(at) && at <= now && now - at <= 15 * 60 * 1000;
  });
}
