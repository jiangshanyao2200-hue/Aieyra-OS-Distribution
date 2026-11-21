// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/assets/monaco/vs/nls.messages-loader.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

define("vs/nls.messages-loader",["exports"],(function(s){"use strict";function a(o,l,n,t){const e=t["vs/nls"]?.availableLanguages?.["*"];!e||e==="en"?n({}):l([`vs/nls.messages.${e}`],()=>{n({})})}s.load=a,Object.defineProperty(s,Symbol.toStringTag,{value:"Module"})}));
