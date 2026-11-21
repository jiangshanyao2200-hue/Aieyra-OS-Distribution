// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: mode; apply
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/window-presentation.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Agent窗口默认只展示：不抢焦点，也不截获用户正在操作其他程序的鼠标。
function mode(value='display'){
 if(!['display','interactive'].includes(value))throw Error('presentation must be display or interactive');
 return value;
}
function apply(win,value='display'){
 const presentation=mode(value),interactive=presentation==='interactive';
 win.aieyraPresentation=presentation;win.setFocusable(interactive);win.setIgnoreMouseEvents(!interactive);win.setSkipTaskbar(!interactive);
 return presentation;
}
module.exports={mode,apply};
