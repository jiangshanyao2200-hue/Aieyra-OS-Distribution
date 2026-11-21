// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: message
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/startup-error.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {app}=require('electron');
const {show}=require('./styled-dialog.cjs');
const message=process.env.AIEYRA_STARTUP_ERROR||'启动失败，请检查应用目录和配置。';delete process.env.AIEYRA_STARTUP_ERROR;
app.whenReady().then(async()=>{await show(null,{title:'Aieyra 启动失败',message});app.quit();});
app.on('window-all-closed',()=>{});
