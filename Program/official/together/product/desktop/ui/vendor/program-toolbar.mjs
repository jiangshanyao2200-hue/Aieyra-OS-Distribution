// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: stylesheet; mountProgramToolbar
// Impact: python -B scripts/code-atlas.py show Theme/runtime/program-toolbar.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const stylesheet = new URL('./program-toolbar.css', import.meta.url).href;

export function mountProgramToolbar(bar, {
 row = bar, title = ':scope > strong, :scope > h1, :scope > h2',
 actions = 'button', groups = '', onInset, loadStyles = true,
} = {}) {
 const doc = bar.ownerDocument, win = doc.defaultView;
 if (loadStyles && !doc.querySelector('link[data-program-toolbar-style]')) {
  const style = doc.createElement('link');
  style.rel = 'stylesheet';
  style.href = stylesheet;
  style.dataset.programToolbarStyle = '';
  doc.head.append(style);
 }
 bar.classList.add('os-program-toolbar');
 row.setAttribute('data-program-row','');
 function markControls() {
  row.querySelector(title)?.setAttribute('data-program-title','');
  for (const button of row.querySelectorAll(actions)) button.setAttribute('data-program-action','');
  if (groups) for (const group of row.querySelectorAll(groups)) group.setAttribute('data-program-actions','');
 }
 markControls();
 const controls = new win.MutationObserver(markControls);
 controls.observe(row,{childList:true,subtree:true});
 let lastInset;
 function measure() {
  const inset = Math.ceil(bar.getBoundingClientRect().bottom);
  if (inset !== lastInset) { lastInset = inset; onInset(inset); }
 }
 const size = onInset && new win.ResizeObserver(measure);
 if (size) size.observe(bar);
 function close() {
  controls.disconnect();
  if (size) size.disconnect();
  win.removeEventListener('pagehide', close);
 }
 win.addEventListener('pagehide',close,{once:true});
 return {close};
}
