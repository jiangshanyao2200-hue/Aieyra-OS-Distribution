/* @file-map:start
文件: link/office/web/station-visual.mjs
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/station-model.js
上游: link/desktop/ui/work-status.mjs, link/desktop/ui/workspace.css, link/office/web/link-page.css
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  seatHash | function
  equipment | function
  deskArt | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {deviceKind} from './station-model.js';
const SEAT_STATE = {
  working: 'running',
  idle: 'idle',
  waiting: 'waiting_user',
  error: 'error',
  offline: 'offline',
  lost: 'lost',
  sync: 'offline',
};
const BASE =
  '<ellipse class="work-orbit" cx="0" cy="23" rx="69" ry="34"/><path class="desk-side" d="M-49-1 0 23 49-1V8L0 33-49 8Z"/><path class="desk-top" d="M-49-1 0-26 49-1 0 23Z"/><path class="desk-leg" d="M-41 11v21m82-21v21"/>';
const CHAIR =
  '<path class="seat-chair" d="M-11 27 2 20 18 28 5 35Z M-11 27v12l16 8 13-8V28"/><circle class="seat-signal" cx="42" cy="-3" r="3"/>';
const SCREENS = [
  'M3 4h21M3 8h14M3 12h9',
  'M3 3h9v10H3Z M15 3h9v4h-9Z M15 10h9',
  'M3 12V3m0 9h21M5 10l5-5 6 4 7-6',
];
/* @chain-region seatHash | calls: String, Math.imul, c.codePointAt */ function seatHash(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}
/* @chain-region equipment | calls: join, map, Array.from */ function equipment(kind, hash) {
  if (kind === 'server')
    return `<g class="seat-equipment device-rack"><path class="monitor-back" d="M-23-58 10-42 10 9-23-7Z"/><path class="device-side" d="M10-42 24-49 24 2 10 9Z M-23-58-9-65 24-49 10-42Z"/>${[
      0, 1, 2, 3,
    ]
      .map(
        (i) =>
          `<path class="monitor-screen" d="M-18 ${-48 + i * 11} 5 ${-37 + i * 11}v7l-23-11Z"/><path class="device-vent" d="M-14 ${-43 + i * 11} 0 ${-36 + i * 11}"/><circle class="device-led" cx="2" cy="${-35 + i * 11}" r="1.1"/>`,
      )
      .join('')}<path class="keyboard" d="M-10 8 3 2 19 10 6 16Z"/></g>`;
  if (kind === 'phone')
    return '<g class="seat-equipment device-handheld"><path class="keyboard" d="M-12 4 1-3 18 5 5 12Z"/><path class="device-stand" d="M1-13v16m-7 2 7-4 7 4"/><path class="monitor-back" d="M-14-55 8-44V-7L-14-18Z"/><path class="monitor-screen" d="M-11-47 5-39v25l-16-8Z"/><path class="device-speaker" d="M-6-48 0-45"/><path class="device-app" d="M-8-38-3-35v5l-5-3Z M0-34 3-32.5v5L0-29Z M-8-28-3-25v5l-5-3Z"/><circle class="device-led" cx="-3" cy="-17" r="1.2"/></g>';
  const marks = Array.from(
    { length: 6 },
    (_, i) =>
      `<path class="device-identity-mark" opacity="${hash & (1 << i) ? '.9' : '.2'}" d="M${20 + i * 1.5} -6v3"/>`,
  ).join('');
  return `<g class="seat-equipment device-computer"><path class="monitor-back" d="M-25-43 13-25 13 4-25-14Z"/><path class="monitor-screen" d="M-20-35 8-21 8-4-20-18Z"/><g transform="matrix(1 .5 0 1 -20 -35)"><path class="device-screen-pattern" d="${SCREENS[hash % SCREENS.length]}"/></g><path class="keyboard" d="M-2 5 12-2 26 5 12 12Z"/><g class="device-tower"><path class="monitor-back" d="M18-27 30-21V2L18-4Z"/><path class="device-side" d="M30-21 36-24V-1L30 2Z M18-27 24-30 36-24 30-21Z"/><path class="device-vent" d="M21-19 27-16m-6 4 6 3"/><circle class="device-led" cx="25" cy="-4" r="1.1"/>${marks}</g></g>`;
}
export const /* @chain-region deskArt | calls: equipment, deviceKind, seatHash */ deskArt = (s, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} viewBox="-88 -74 176 145" aria-hidden="true"><g class="floor-seat seat-${SEAT_STATE[s.link.state] || 'idle'}">${BASE}${equipment(deviceKind(s.agent, s.name), seatHash(s.id))}${CHAIR}</g></svg>`;

