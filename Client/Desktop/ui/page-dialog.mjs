// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: send
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/page-dialog.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 外部页面的 alert / confirm / prompt：内容从地址的 hash 读，当文字显示；结果经标题交回宿主，这一页没有别的能力。
const {kind,message,value}=JSON.parse(decodeURIComponent(location.hash.slice(1))),$=id=>document.getElementById(id);
const send=text=>{document.title=text;};
$('message').textContent=message;
if(kind==='prompt'){$('value').hidden=false;$('value').value=value;$('value').focus();$('value').select();}
if(kind==='alert')$('cancel').hidden=true;
if(kind!=='prompt')$('ok').focus();
$('form').onsubmit=event=>{event.preventDefault();send('aieyra:ok:'+encodeURIComponent($('value').value));};
$('cancel').onclick=()=>send('aieyra:cancel');
addEventListener('keydown',event=>{if(event.key==='Escape')send('aieyra:cancel');});
