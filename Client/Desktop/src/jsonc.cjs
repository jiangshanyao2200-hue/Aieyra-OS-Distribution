// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: parse
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/jsonc.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 字符串内的 URL、转义和逗号必须原样保留；只处理 JSON 外层注释与尾逗号。
function parse(text) {
 let clean='', quoted=false, escaped=false;
 text=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++) {
  const c=text[i],next=text[i+1];
  if(quoted) {clean+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"') {quoted=true;clean+=c;continue;}
  if(c==='/'&&next==='/') {while(i<text.length&&text[i]!=='\n')i++;clean+='\n';continue;}
  if(c==='/'&&next==='*') {const end=text.indexOf('*/',i+2);if(end<0)throw Error('未闭合的 JSON 注释');i=end+1;clean+=' ';continue;}
  clean+=c;
 }
 let result='';quoted=false;escaped=false;
 for(let i=0;i<clean.length;i++) {
  const c=clean[i];
  if(quoted) {result+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;
  if(c===','&&/^[\s]*[}\]]/.test(clean.slice(i+1)))continue;
  result+=c;
 }
 return JSON.parse(result);
}
module.exports={parse};
