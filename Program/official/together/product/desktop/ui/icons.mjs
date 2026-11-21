/* @file-map:start
文件: link/desktop/ui/icons.mjs
位置: 市中心·图形原语 | 共用SVG图标与图标节点装饰。
约束: 保留统一viewBox、描边和中心线；复用图标语义；不逐页面复制SVG
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/carousel.mjs, link/desktop/ui/controls.mjs, link/desktop/ui/elections.mjs, link/desktop/ui/engineering.mjs, link/desktop/ui/source-browser.mjs, link/desktop/ui/unified.mjs, link/desktop/ui/welcome.mjs, link/desktop/ui/work-status.mjs, link/desktop/ui/workspace.mjs
链路: shared-ui
验证: AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  icon | function
  decorate | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// One public stroke language for navigation, actions and state. No platform glyphs.
const paths = {
  settings: '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  agent: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12v2M16 12v2M9 17h6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',

  elections: '<path d="M4 9h16v12H4ZM8 9l-2-5 8-2 2 7M8 14h8"/>',
  blueprint: '<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6 9v9h8M10 6h8v9"/>',
  cloud: '<path d="M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 1 4.5 4.5 0 0 1 0 9Z"/><path d="m9 13 3-3 3 3m-3-3v8"/>',
  home: '<path d="m3 11 9-8 9 8M5 9v12h5v-7h4v7h5V9"/>',
  repository: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H6.5A2.5 2.5 0 0 1 4 17.5Zm0 11a2.5 2.5 0 0 1 2.5-2.5H20M8 4v11"/>',
  office: '<path d="m9 15 6-6M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2"/>',
  chat: '<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h8M7 13h5"/>',
  management: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  goals: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  agendas: '<path d="M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01"/>',
  members: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  milestones: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M7 21h10"/>',
  broadcast: '<path d="M3 12h4l3-6 4 12 3-6h4"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v2a5 5 0 0 1-5 5H6"/>',
  release: '<path d="M12 2c-3 3-5 6-5 10l5 5 5-5c0-4-2-7-5-10ZM7 11l-3 3v4l5-2m8-5 3 3v4l-5-2m-3 3v3"/><circle cx="12" cy="9" r="1"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  applications: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 15h4"/>',
  audit: '<path d="M4 4h16v16H4ZM8 8h8M8 12h8M8 16h4"/>',
  refresh: '<path d="M20 4v6h-6M4 20v-6h6M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  send: '<path d="m3 3 18 9-18 9 4-9Zm4 9h14"/>',
  folder: '<path d="M3 6V4h6l2 3h10v13H3Z"/>',
  file: '<path d="M5 3h9l5 5v13H5ZM14 3v6h5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  like: '<path d="M7 10h3l2-7c3 0 3 3 2 7h5a2 2 0 0 1 2 2l-2 7H7ZM3 10h4v9H3Z"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
};
export /* @chain-region icon */ function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.code}</svg>`;
}
export /* @chain-region decorate | calls: forEach, root.querySelectorAll, icon */ function decorate(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
}
