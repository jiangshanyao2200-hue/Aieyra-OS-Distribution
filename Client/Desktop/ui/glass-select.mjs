// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Select; proto; protoIndex; roots; resetForms; open; capabilityPaths; capabilityIcons; close; textNode; renderDetails; enhance; setupGlassSelects
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/glass-select.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {menuKey} from './interaction.mjs';
import {motionAllowed,motionDuration} from './motion.mjs';
import {hoverCard,showModelDetails,hideModelDetails} from './model-ui.mjs';
// 原生 select 承载表单与事件。目录顺序保持原样，资料只在本机展开。
// data-catalog / option.glassDetails 启用模型资料；普通下拉沿用短注和说明。
const Select = globalThis.HTMLSelectElement;
const proto = Select && Object.getOwnPropertyDescriptor(Select.prototype, 'value');
const protoIndex = Select && Object.getOwnPropertyDescriptor(Select.prototype, 'selectedIndex');
const roots = new WeakSet();
const resetForms = new WeakSet(), selectSync = new WeakMap();
let open = null, serial = 0, listening = false;
const capabilityPaths={
 vision:['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z','M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
 image:['M14 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-10','M3 17l5-5 5 5 3-3 5 5','M18 2v6M15 5h6'],
 reasoning:['M9 4a3 3 0 0 0-5 2 4 4 0 0 0-1 7 4 4 0 0 0 3 6 3 3 0 0 0 6 1V4a3 3 0 0 0-3-2','M15 4a3 3 0 0 1 5 2 4 4 0 0 1 1 7 4 4 0 0 1-3 6 3 3 0 0 1-6 1','M7 8l2 2M5 14l3-1M17 8l-2 2M19 14l-3-1'],
 tools:['M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 2-2-2 2-4Z'],
 search:['M21 11a9 9 0 1 0-9 10','M3 11h18M12 2c-5 5-5 13 0 18 2-2 3-4 3-6','M20 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 20l3 3'],
};
function capabilityIcons(capabilities){
 const group=document.createElement('span');group.className='glass-select-capabilities';
 for(const capability of capabilities||[]){
  const paths=capabilityPaths[capability.id];if(!paths)continue;
  const icon=document.createElement('span');icon.className='glass-select-capability';icon.title=capability.label;icon.setAttribute('aria-label',capability.label);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  for(const value of paths){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',value);svg.append(path);}
  icon.append(svg);group.append(icon);
 }
 return group;
}

function close(focus = false) {
 hideModelDetails();
 if (!open) return;
 const { list, button, body } = open; open = null;
 // 退出动画仍可见，但当帧就不再截住下方点击或键盘焦点。
 list.style.pointerEvents = 'none'; list.inert = true; list.setAttribute('aria-hidden', 'true');
 button.removeAttribute('aria-controls'); button.removeAttribute('aria-activedescendant'); body.removeAttribute('aria-activedescendant');
 list.classList.remove('shown'); button.setAttribute('aria-expanded', 'false');
 if(motionAllowed(list))setTimeout(() => list.remove(), motionDuration(list));else list.remove();
 if (focus && button.isConnected) button.focus({ preventScroll: true });
}

function textNode(tag, className, value) {
 const node = document.createElement(tag); node.className = className; node.textContent = value || ''; return node;
}

function renderDetails(target, option) {
 const d = option?.glassDetails;
 target.replaceChildren();
 if (!d) { target.append(textNode('p', 'glass-detail-note', '暂无该模型的详细信息')); target.scrollTop=0; return; }
 target.append(textNode('h4', 'glass-detail-name', d.name), textNode('p', 'glass-detail-id', d.id));
 if (d.note) target.append(textNode('p', 'glass-detail-note', d.note));
 if (d.summary) target.append(textNode('p', 'glass-detail-summary', d.summary));
 for (const section of d.sections || []) {
  const area = document.createElement('section'); area.className = 'glass-detail-section';
  area.append(textNode('h5', '', section.title));
  if (section.rows?.length) {
   const rows = document.createElement('dl');
   for (const row of section.rows) rows.append(textNode('dt', '', row.label), textNode('dd', '', row.value));
   area.append(rows);
  }
  if (section.note) area.append(textNode('p', 'glass-detail-note', section.note));
  target.append(area);
 }
 target.scrollTop = 0;
}

function enhance(select) {
 if (select.dataset.glass || select.multiple) return;
 select.dataset.glass = 'true';
 const button = document.createElement('button'), label = document.createElement('span');
 button.type = 'button'; button.className = 'glass-select'; button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
 label.className = 'glass-select-value'; button.append(label);
 if([...select.options].some(o=>o.modelHover))hoverCard(label,()=>select.options[select.selectedIndex]?.modelHover);
 const fieldLabel = select.labels?.[0];
 const directLabel = [...(fieldLabel?.childNodes || [])].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).filter(Boolean).join(' ');
 const fieldName = select.getAttribute('aria-label')?.trim() || directLabel || fieldLabel?.querySelector('span')?.textContent.trim() || '';
 select.classList.add('glass-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
 select.after(button);
 const sync = () => {
  const option = select.options[select.selectedIndex];
  label.textContent = option ? option.textContent : '';
  button.disabled = select.disabled;
  button.title = option?.modelHover?'':label.textContent;
  button.setAttribute('aria-label', [fieldName, label.textContent].filter(Boolean).join('：'));
  if (button.disabled && open?.select === select) close();
 };
 // 程序直接改 value / selectedIndex 时没有事件，这里截住同步显示。
 Object.defineProperty(select, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); sync(); } });
 Object.defineProperty(select, 'selectedIndex', { configurable: true, get() { return protoIndex.get.call(this); }, set(v) { protoIndex.set.call(this, v); sync(); } });
 new MutationObserver(records => { sync(); if (open?.select === select && records.some(r => r.type === 'childList' || r.target !== select)) close(); }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'hidden', 'value'] });
 select.addEventListener('change', sync);
 selectSync.set(select, sync);
 const form = select.form;
 if (form && !resetForms.has(form)) {
  resetForms.add(form);
  form.addEventListener('reset', () => {
   if (open?.select.form === form) close();
   // 仅同步仍属于表单的控件，表单不保留已移除的参数下拉框。
   setTimeout(() => { for (const field of form.elements) selectSync.get(field)?.(); }, 0);
  });
 }
 const choose = (index) => {
  const option = select.options[index];
  if (select.disabled || !option || option.disabled || option.parentElement?.disabled || option.hidden || option.parentElement?.hidden) return;
  const changed = select.selectedIndex !== index;
  protoIndex.set.call(select, index); sync(); close(true);
  if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
 };
 function show() {
  if (select.disabled) return;
  close();
  const id = 'glass-list-' + ++serial, list = document.createElement('div'); list.className = 'glass-select-list';
  const options = [...select.options], catalog = select.dataset.catalog === 'true', rich = catalog || options.some(o => o.dataset.note || o.dataset.desc), searchable = catalog || options.length > 12;
  const body = document.createElement('div'); body.className = 'glass-select-body'; body.id = id; body.setAttribute('role', 'listbox'); body.setAttribute('aria-label', fieldName || '选择'); body.tabIndex = 0;
  const desc = document.createElement(catalog ? 'aside' : 'div'); desc.className = catalog ? 'glass-select-details' : 'glass-select-desc';
  if (catalog) { list.classList.add('catalog'); desc.tabIndex = 0; desc.setAttribute('aria-label', '模型资料'); }
  let search, active, described;
  const groups = [], nodes = [];
  const describe = option => { if (described === option) return; described = option; if (catalog) renderDetails(desc, option); else desc.textContent = option?.dataset.desc || ''; };
  const activate = (node, scroll = false) => {
   active?.classList.remove('active'); active = node;
   for (const control of [button, body, search].filter(Boolean)) control.removeAttribute('aria-activedescendant');
   if (!node) return;
   node.classList.add('active');
   for (const control of [button, body, search].filter(Boolean)) control.setAttribute('aria-activedescendant', node.id);
   const option=options[Number(node.dataset.index)];describe(option); if (scroll) {node.scrollIntoView({ block: 'nearest' });if(option.modelHover)showModelDetails(node,option.modelHover);else hideModelDetails();}
  };
  const item = (option, group) => {
   const index = options.indexOf(option), node = document.createElement('div');
   node.className = 'glass-select-option'; node.id = id + '-option-' + index; node.setAttribute('role', 'option'); node.dataset.index = String(index);
   node.append(textNode('span', 'glass-select-name', option.textContent));
   if (catalog && option.glassCapabilities?.length) node.append(capabilityIcons(option.glassCapabilities));
   if (!catalog && option.dataset.note) node.append(textNode('span', 'glass-select-note', option.dataset.note));
   if (!catalog && option.dataset.muted) node.classList.add('muted');
   node.setAttribute('aria-selected', String(index === select.selectedIndex)); if (option.disabled || option.parentElement?.disabled) node.setAttribute('aria-disabled', 'true');
   if(option.modelHover)hoverCard(node,option.modelHover);
   else node.title = catalog ? option.textContent : [option.textContent, option.dataset.note, option.dataset.desc].filter(Boolean).join(' · ');
   node.onclick = () => choose(index);
   node.onpointerenter = () => { if(node.getAttribute('aria-disabled')!=='true')activate(node); };
   nodes.push(node); group?.items.push(node);
   return node;
  };
  for (const child of select.children) {
   if (child.hidden) continue;
   if (child.tagName === 'OPTGROUP') {
    const shown = [...child.children].filter((o) => !o.hidden); if (!shown.length) continue;
    const collapsible = child.dataset.collapsed === 'true', head = textNode(collapsible ? 'button' : 'div', 'glass-select-group', child.label);
    const group = { head, collapsed: collapsible, collapsible, items: [] }; groups.push(group);
    if (collapsible) { head.type = 'button'; head.setAttribute('aria-expanded', 'false'); head.onclick = () => { group.collapsed = !group.collapsed; filter(); }; }
    body.append(head, ...shown.map(o => item(o, group)));
   } else if (!child.hidden) body.append(item(child));
  }
  function filter() {
   const q = search?.value.trim().toLowerCase() || '';
   for (const node of nodes) { const o = options[Number(node.dataset.index)]; node.hidden = !!q && ![o.textContent, o.value, o.dataset.note, o.dataset.desc].filter(Boolean).join(' ').toLowerCase().includes(q); }
   for (const group of groups) {
    group.head.hidden = !group.items.some(node => !node.hidden);
    if (group.collapsible) group.head.setAttribute('aria-expanded', String(!!q || !group.collapsed));
    if (!q && group.collapsed) for (const node of group.items) node.hidden = true;
   }
   if (!active || active.hidden) activate(null);
   if (!nodes.some(node => !node.hidden)) { empty.hidden = false; describe(null); } else empty.hidden = true;
  }
  const empty = textNode('p', 'glass-select-empty', '没有匹配的模型'); empty.hidden = true; body.append(empty);
  if (searchable) {
   search = document.createElement('input'); search.type = 'search'; search.className = 'glass-select-search'; search.placeholder = catalog ? '搜索模型' : '搜索'; search.setAttribute('aria-label', search.placeholder); search.setAttribute('role', 'combobox'); search.setAttribute('aria-controls', id); search.setAttribute('aria-expanded', 'true');
   search.oninput = filter;
   list.append(search); list.classList.add('searchable');
  }
  if (catalog) { const content = document.createElement('div'); content.className = 'glass-select-content'; content.append(body, desc); list.append(content); }
  else { list.append(body); if (rich) list.append(desc); }
  if (rich) { list.classList.add('rich'); describe(options[select.selectedIndex]); }
  filter();
  document.body.append(list);
  const position = () => {
   const r = button.getBoundingClientRect();
   if (!button.isConnected || !button.getClientRects().length || r.bottom <= 0 || r.top >= innerHeight) { if (open?.list === list) close(); return; }
   const margin = 10, below = Math.max(0, innerHeight - r.bottom - margin - 6), above = Math.max(0, r.top - margin - 6);
   const overlay = Math.max(below, above) < 180, up = !overlay && below < (catalog ? 420 : 320) && above > below;
   const room = overlay ? innerHeight - margin * 2 : up ? above : below, cap = catalog ? 440 : searchable ? 380 : 320;
   const sidecar = catalog && innerWidth >= 1000 && room >= 240;
   list.dataset.detail = sidecar ? 'side' : 'dock';
   const width = Math.max(0, Math.min(innerWidth - margin * 2, Math.max(r.width, catalog ? sidecar ? 920 : 620 : rich ? 300 : 180)));
   const left = Math.max(margin, Math.min(r.left, innerWidth - width - margin));
   Object.assign(list.style, { left: left + 'px', width: width + 'px', maxHeight: Math.max(0, Math.min(cap, room)) + 'px' });
   if (catalog) list.style.height = Math.max(0, Math.min(cap, room)) + 'px';
   const height = Math.min(list.scrollHeight, cap, room);
   list.style.top = (overlay ? margin : up ? r.top - height - 6 : r.bottom + 6) + 'px'; list.dataset.side = up ? 'up' : 'down';
  };
  open = { list, body, button, select, choose, activate, position, visible: () => nodes.filter(n => !n.hidden && n.getAttribute('aria-disabled') !== 'true'), current: () => active };
  position();
  button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-controls', id);
  const selected = open.visible().find(n => n.getAttribute('aria-selected') === 'true') || open.visible()[0]; activate(selected);
  requestAnimationFrame(() => { if (open?.list !== list) return; list.classList.add('shown'); selected?.scrollIntoView({ block: 'nearest' }); (search || body).focus({ preventScroll: true }); });
 }
 button.addEventListener('click', () => { if (open?.button === button) close(true); else show(); });
 button.addEventListener('keydown', event => {
  if (open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); show();
  if (open?.button === button && ['Home', 'End'].includes(event.key)) { const items = open.visible(); open.activate(event.key === 'Home' ? items[0] : items.at(-1), true); }
 });
 sync();
}

export function setupGlassSelects(root) {
 if (!root || roots.has(root)) return;
 roots.add(root);
 for (const select of root.querySelectorAll('select')) enhance(select);
 new MutationObserver(() => { for (const select of root.querySelectorAll('select:not([data-glass])')) enhance(select); if (open && !open.select.isConnected) close(); }).observe(root, { childList: true, subtree: true });
 // 点击时浏览器可能刚把按钮滚入视野。跟随锚点，避免迟到的 scroll 关掉新列表。
 root.addEventListener('scroll', event => { if (open && !open.list.contains(event.target)) requestAnimationFrame(() => open?.position()); }, true);
 root.addEventListener('close', () => { if (open && root.contains(open.select)) close(); }, true);
 if (listening) return;
 listening = true;
 document.addEventListener('pointerdown', event => { if (open && !open.list.contains(event.target) && !open.button.contains(event.target)) close(); }, true);
 document.addEventListener('focusin', event => { if (open && !open.list.contains(event.target) && !open.button.contains(event.target)) close(); });
 document.addEventListener('keydown', event => {
  if (!open) return;
  if(event.key!=='Escape'&&event.target.closest('.glass-select-group,.glass-select-details'))return;
  menuKey(event,{items:()=>open.visible(),current:()=>open.current(),activate:node=>open.activate(node,true),wrap:false,onEscape:()=>close(true),onEnter:node=>open.choose(Number(node.dataset.index))});
 }, true);
 const hide=()=>close();
 window.addEventListener('resize',hide);window.addEventListener('blur',hide);
 document.addEventListener('visibilitychange',hide);document.addEventListener('workspace-view-before-change',hide);
 new MutationObserver(()=>{if(open&&(document.hidden||document.body.dataset.visible==='false'||!open.button.checkVisibility({checkVisibilityCSS:true})))close();}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','data-visible']});
}
