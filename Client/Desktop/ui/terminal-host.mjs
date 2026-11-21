// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: openTerminal
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/terminal-host.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// xterm 的 FitAddon 用父元素的 computed width 算列数。全局 border-box 下这个值含内边距，
// 终端直接开在带内边距的元素上，列数就多算，文字压过内边距贴到右边框。
// 所有终端都从这里开：多包一层没有内边距的元素，外面怎么调内边距都不影响列数。
export function openTerminal(term,parent,doc=document){
 const host=doc.createElement('div');
 host.className='xterm-host';host.style.cssText='width:100%;height:100%;min-width:0';
 parent.replaceChildren(host);term.open(host);
 return host;
}
