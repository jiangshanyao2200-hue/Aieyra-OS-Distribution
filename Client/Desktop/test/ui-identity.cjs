// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: EXPECTED_TITLE; EXPECTED_URL_FRAGMENT; EXPECTED_URL_SUFFIX; identifyPage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/ui-identity.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Automation must identify its own configuration page before interacting.
const EXPECTED_TITLE='Aieyra Config';
const EXPECTED_URL_FRAGMENT='/Client/Desktop/renderer/';
const EXPECTED_URL_SUFFIX='Client/Desktop/renderer/index.html';
function identifyPage(page) {
 if (!page) return '找不到页面';
 const url=String(page.url||'').replace(/\\/g,'/');
 if (!/^file:\/\//i.test(url)||!url.endsWith(EXPECTED_URL_SUFFIX)) return '不是本应用';
 if (page.title!==EXPECTED_TITLE) return '标题不符';
 return null;
}
module.exports={identifyPage,EXPECTED_TITLE,EXPECTED_URL_FRAGMENT,EXPECTED_URL_SUFFIX};
