/* @file-map:start
文件: link/office/web/dom.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: 无已解析的项目内静态导入
上游: link/office/web/office-home.js
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  key | function
  compatible | function
  patch | function
  children | function
  updateHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// Patch existing elements so polling never replaces an active editor or scene.
const /* @chain-region key | calls: node.getAttribute */ key = (node) => (node.nodeType === 1 ? node.id || node.getAttribute('data-key') || '' : '');
/* @chain-region compatible | calls: key */ function compatible(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
}
/* @chain-region patch | calls: a.hasAttribute, b.hasAttribute, a.removeAttribute, a.getAttribute, a.setAttribute, children */ function patch(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  const persistent = a.hasAttribute('data-persistent');
  // 原位刷新的说明折叠保留用户选择；显式受控的详情仍由业务状态管理。
  const preserveOpen = a instanceof HTMLDetailsElement && b.hasAttribute('data-preserve-open');
  for (const attr of [...a.attributes])
    if (
      !b.hasAttribute(attr.name) &&
      attr.name !== 'data-composing' &&
      !(preserveOpen && attr.name === 'open')
    )
      a.removeAttribute(attr.name);
  for (const attr of [...b.attributes])
    if (!(preserveOpen && attr.name === 'open') && a.getAttribute(attr.name) !== attr.value)
      a.setAttribute(attr.name, attr.value);
  if (persistent) return;
  if (a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) {
    if (!a.dataset.composing && a.value !== b.value) a.value = b.value;
    if (a instanceof HTMLInputElement) a.checked = b.checked;
    return;
  }
  children(a, b);
  if (a instanceof HTMLSelectElement && a.value !== b.value) a.value = b.value;
}
/* @chain-region children | calls: compatible, key, find, old.contains, parent.insertBefore, focused.focus, fresh.cloneNode, patch … */ function children(parent, next) {
  const wanted = [...next.childNodes];
  let cursor = parent.firstChild;
  for (const fresh of wanted) {
    let old = cursor;
    if (!old || !compatible(old, fresh)) {
      old = key(fresh) ? [...parent.childNodes].find((node) => compatible(node, fresh)) : null;
      if (old) {
        // Moving an existing keyed node can drop focus in the browser.
        const focused = old.contains(document.activeElement) ? document.activeElement : null;
        parent.insertBefore(old, cursor);
        focused?.focus({ preventScroll: true });
      } else {
        old = fresh.cloneNode(true);
        parent.insertBefore(old, cursor);
      }
    }
    patch(old, fresh);
    cursor = old.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}
export /* @chain-region updateHTML | calls: document.createElement, children */ function updateHTML(element, html) {
  if (!element) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  children(element, template.content);
}
document.addEventListener('compositionstart', (event) => {
  if (event.target.dataset) event.target.dataset.composing = 'true';
});
document.addEventListener('compositionend', (event) => {
  if (event.target.dataset) delete event.target.dataset.composing;
});
