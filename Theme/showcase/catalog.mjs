// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/showcase/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: scenes; states; coverage; totals
// Impact: python -B scripts/code-atlas.py show Theme/showcase/catalog.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {catalog} from '../contract/definition.mjs';
export const scenes=[['controls','控件与输入'],['conversation','对话与排版'],['tools','工具与工作流'],['media','图片与音视频'],['system','导航与浮层'],...Object.keys(catalog.surfaces).map(id=>['surface:'+id,'布局 · '+id])];
export const states={default:'默认',hover:'悬停（移入）',focus:'焦点（Tab）',active:'按下（按住）',disabled:'禁用',selected:'选中',expanded:'展开',busy:'忙碌',readonly:'只读',failed:'失败',cancelled:'取消',running:'运行',unknown:'未知',loading:'加载',empty:'空',dragging:'拖动',stale:'过期',offline:'离线',completed:'完成',checked:'勾选'};
// Counts refer to rendered samples. Native HWND behavior, real tasks and
// client acceptance remain separate from this synthetic authoring showcase.
export function coverage(doc){
 const elements=Object.entries(catalog.elements).filter(([,selector])=>doc.querySelector(selector)).map(([id])=>id);
 const renderers=new Set();for(const node of doc.querySelectorAll('*')){const b=node._themeBinding;if(b?.kind==='renderers')renderers.add(b.surface);}
 return {elements,renderers:[...renderers],states:Object.entries(catalog.states).filter(([,selector])=>!selector||doc.querySelector(selector)).map(([id])=>id)};
}
export const totals={elements:Object.keys(catalog.elements).length,renderers:Object.keys(catalog.renderers).length,surfaces:Object.keys(catalog.surfaces).length,states:Object.keys(catalog.states).length};
