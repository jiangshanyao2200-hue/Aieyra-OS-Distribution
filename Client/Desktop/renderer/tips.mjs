// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/renderer/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: native
// Impact: python -B scripts/code-atlas.py show Client/Desktop/renderer/tips.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 外壳页面的提示框：系统 title 提示不用，统一自绘。浏览器外壳夹着网页视图，提示框画在原生小窗里才不会被压住。
import {setupTooltips,configureTooltips} from '../ui/tooltip.mjs';
setupTooltips(document);
const native=window.aieyraBrowser?.tip;
if(native)configureTooltips(document,{native:()=>native});
