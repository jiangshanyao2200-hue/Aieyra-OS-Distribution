// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/renderer/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/renderer/styled-dialog.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
window.aieyraDialog.data().then(data=>{
 if(!data)return;document.documentElement.lang=data.language||'zh-CN';document.title=data.title;
 document.getElementById('heading').textContent=data.title;document.getElementById('message').textContent=data.message;
 data.buttons.forEach((text,index)=>{const button=document.createElement('button');button.textContent=text;button.disabled=data.presentation==='display';if(index===data.defaultId)button.className='primary';button.onclick=()=>window.aieyraDialog.answer(index);document.getElementById('actions').append(button);if(index===data.defaultId&&!button.disabled)button.focus();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();window.aieyraDialog.answer(data.cancelId);}});
});
