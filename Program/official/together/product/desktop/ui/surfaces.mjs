/* @file-map:start
文件: link/desktop/ui/surfaces.mjs
位置: 一环·界面更新模块 | 保持页面/子区域更新、滚位、焦点与草稿连续的共享渲染机制。
约束: 页面编排通过此模块更新，不重复重建整页破坏交互上下文；异步结果仍由调用方核对generation/epoch；模块不替代业务权限
下游: link/office/web/motion.mjs
上游: link/desktop/ui/source-browser.mjs, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/workspace.cjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  position | function
  Surfaces | class
  Surfaces.constructor | method
  Surfaces.open | method
  Surfaces.clear | method
  detailsByIdentity | function
  project | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {cancelMotion,enterSurface} from '../../office/web/motion.mjs';
// Keep actual page nodes across navigation. Only a changed data projection is replaced.
// Account changes dispose the entire scope, including detached nodes and drafts.
/* @chain-region position | calls: map, root.querySelectorAll */ function position(root) {
  return [...root.querySelectorAll('.scroll,.rail,.surface,.tree,.source pre,.chat-log')]
    .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
}
export /* @chain-region Surfaces */ class Surfaces {
  /* @chain-region Surfaces.constructor | calls: Map */ constructor(root) { this.root = root; this.pages = new Map(); this.current = ''; }
  /* @chain-region Surfaces.open | calls: cancelMotion, pages.get, position, root.contains, saved.fragment.append, document.createElement, pages.set, root.replaceChildren … */ open(key, html, direction=0) {
    if (this.current === key) return false;
    cancelMotion(this.root,'navigation');
    if (this.current) {
      const saved = this.pages.get(this.current);
      if (saved) {
        saved.positions = position(this.root);
        saved.focus = this.root.contains(document.activeElement) ? document.activeElement : null;
        saved.fragment.append(...this.root.childNodes);
      }
    }
    let page = this.pages.get(key);
    const created = !page;
    if (!page) {
      const template = document.createElement('template'); template.innerHTML = html;
      page = { fragment: template.content, positions: [], focus: null };
      this.pages.set(key, page);
    }
    this.root.replaceChildren(page.fragment);
    if(this.root.firstElementChild)enterSurface(this.root,direction);
    this.current = key;
    for (const saved of page.positions) { saved.node.scrollTop = saved.top; saved.node.scrollLeft = saved.left; }
    if (page.focus?.isConnected) page.focus.focus({ preventScroll: true });
    return created;
  }
  /* @chain-region Surfaces.clear | calls: cancelMotion, pages.clear, root.replaceChildren */ clear() { cancelMotion(this.root,'navigation');this.pages.clear(); this.current = ''; this.root.replaceChildren(); }
}
/* @chain-region detailsByIdentity | calls: Map, map, root.querySelectorAll, textContent.trim, node.querySelector, counts.get, counts.set */ function detailsByIdentity(root) {
  const counts = new Map();
  return [...root.querySelectorAll('details')].map(node => {
    const explicit = node.dataset.detailsKey || node.id;
    const base = explicit ? 'key:' + explicit : 'summary:' + (node.querySelector(':scope > summary')?.textContent.trim() || node.className);
    const occurrence = counts.get(base) || 0;counts.set(base, occurrence + 1);
    return {node,key:base + ':' + occurrence};
  });
}
export /* @chain-region project | calls: node.contains, find, a.name.startsWith, detailsByIdentity, active.matches, previousDetails.find, node.querySelector, Map … */ function project(node, html) {
  if (node.__projection === html) return false;
  const top = node.scrollTop, left = node.scrollLeft;
  const active = node.contains(document.activeElement) ? document.activeElement : null;
  // A stable data identity lets refresh restore keyboard focus without trapping it.
  const identity = active && [...active.attributes].find(a => a.name.startsWith('data-'));
  const previousDetails = detailsByIdentity(node);
  const summaryKey = active?.matches('summary') ? previousDetails.find(({node}) => node.querySelector(':scope > summary') === active)?.key : null;
  const open = new Map(previousDetails.map(({node,key}) => [key,node.open]));
  node.innerHTML = html; node.__projection = html;
  node.scrollTop = top; node.scrollLeft = left;
  const nextDetails = detailsByIdentity(node);
  for(const {node:item,key} of nextDetails)if(open.has(key))item.open=open.get(key);
  if (identity) node.querySelector(`[${identity.name}="${CSS.escape(identity.value)}"]`)?.focus({ preventScroll: true });
  else if (summaryKey) nextDetails.find(({key}) => key === summaryKey)?.node.querySelector(':scope > summary')?.focus({ preventScroll: true });
  return true;
}
