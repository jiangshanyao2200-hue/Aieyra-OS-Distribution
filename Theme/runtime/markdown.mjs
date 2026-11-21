// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: cache; component; wrapper; element; safeLink; inline; cells; bullet; separator; blocks; disposeTree; activate; reconcile; renderMarkdown; chatMessages
// Impact: python -B scripts/code-atlas.py show Theme/runtime/markdown.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindThemeRenderer,withThemeBatch} from './layout.mjs';
// 只创建文字与受控元素；HTML、图片地址和脚本永远不会成为活动内容。
const cache=new WeakMap(),components=new WeakMap();
function component(root,schema,slots){root.setAttribute('data-content-schema',schema);components.set(root,{schema,slots,active:false,dispose:null});return root;}
function wrapper(){const root=element('div');root.style.display='contents';return root;}
const element=(name,text)=>{const node=document.createElement(name);if(text!==undefined)node.textContent=text;return node;};
export function safeLink(value){try{const u=new URL(value);return ['https:','http:','mailto:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function inline(root,text,depth=0){
 if(depth>8){root.append(document.createTextNode(text));return;}
 const pattern=/(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^\s)]+)\)|\[([^\]]+)\]\(([^\s)]+)\)|(\*\*|(?<![\p{L}\p{N}_])__|~~)(?=\S)([\s\S]*?\S)\7|(\*|(?<![\p{L}\p{N}_])_)(?=\S)([^\n]*?\S)\9|\\([\\`*_[\]{}()#+.!>|~-])/gu;
 let match,start=0;
 while((match=pattern.exec(text))){
  // 标识符里的下划线是原文；不能把工具标记、路径或变量名渲染掉。
  if((match[7]==='__'||match[9]==='_')&&/[\p{L}\p{N}_]/u.test(text[pattern.lastIndex]||''))continue;
  root.append(document.createTextNode(text.slice(start,match.index)));let node;
  if(match[1])node=element('code',match[2].replace(/\n/g,' '));
  else if(match[3]!==undefined)node=element('span',match[3]||'图片');
  else if(match[5]){const href=safeLink(match[6]);node=element(href?'a':'span');inline(node,match[5],depth+1);if(href){node.href=href;node.target='_blank';node.rel='noopener noreferrer';}}
  else if(match[7]){node=element(match[7]==='~~'?'del':'strong');inline(node,match[8],depth+1);}
  else if(match[9]){node=element('em');inline(node,match[10],depth+1);}
  else node=document.createTextNode(match[11]);
  root.append(node);start=pattern.lastIndex;
 }
 root.append(document.createTextNode(text.slice(start)));
}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,'|'));
const bullet=line=>line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
const separator=line=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
function blocks(root,lines,depth=0){
 if(depth>8){root.append(element('p',lines.join('\n')));return;}
 for(let i=0;i<lines.length;){
  const line=lines[i];if(!line.trim()){i++;continue;}
  const fence=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if(fence){const content=[],char=fence[1][0],size=fence[1].length;i++;while(i<lines.length&&!new RegExp('^\\s{0,3}'+char+'{'+size+',}\\s*$').test(lines[i]))content.push(lines[i++]);if(i<lines.length)i++;const pre=element('pre'),code=element('code',content.join('\n'));pre.append(code);const wrap=wrapper(),caption=element('span',fence[2].trim().slice(0,160)||'纯文本');caption.className='markdown-code-caption';wrap.append(caption,pre);root.append(component(wrap,'aieyra.content.code/1',{caption,content:pre}));continue;}
  const heading=line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
  if(heading){const h=element('h'+heading[1].length);inline(h,heading[2].replace(/\s+#+\s*$/,''));root.append(h);i++;continue;}
  if(/^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/.test(line)){root.append(element('hr'));i++;continue;}
  if(/^\s*>/.test(line)){const quote=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*> ?/,''));const node=element('blockquote');blocks(node,quote,depth+1);const wrap=wrapper();wrap.append(node);root.append(component(wrap,'aieyra.content.quote/1',{content:node}));continue;}
  if(i+1<lines.length&&line.includes('|')&&separator(lines[i+1])){
   const wrap=element('div'),table=element('table'),head=element('thead'),tr=element('tr'),body=element('tbody');wrap.className='markdown-table';
   for(const value of cells(line)){const th=element('th');th.scope='col';inline(th,value);tr.append(th);}head.append(tr);table.append(head,body);i+=2;
   while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=element('tr');for(const value of cells(lines[i++])){const td=element('td');inline(td,value);row.append(td);}body.append(row);}wrap.append(table);root.append(component(wrap,'aieyra.content.table/1',{content:table}));continue;
  }
  const first=bullet(line);
  if(first){const ordered=/\d/.test(first[2]),base=first[1].length,list=element(ordered?'ol':'ul');if(ordered&&parseInt(first[2])!==1)list.start=parseInt(first[2]);
   while(i<lines.length){const item=bullet(lines[i]);if(!item||item[1].length!==base||/\d/.test(item[2])!==ordered)break;
    const content=[item[3]],li=element('li');i++;while(i<lines.length&&lines[i].trim()&&/^\s+/.test(lines[i])&&(!bullet(lines[i])||bullet(lines[i])[1].length>base))content.push(lines[i++].slice(Math.min(lines[i-1].match(/^\s*/)[0].length,base+2)));
    const task=content[0].match(/^\[([ xX])\]\s+(.*)$/);if(task){const box=element('span',task[1]===' '?'☐':'☑');box.className='task-mark';box.setAttribute('aria-label',task[1]===' '?'未完成':'已完成');li.append(box);content[0]=task[2];li.className='task-item';}
    blocks(li,content,depth+1);list.append(li);
   }root.append(list);continue;
  }
  const paragraph=[line];i++;
  while(i<lines.length&&lines[i].trim()&&!/^\s{0,3}(?:#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i])&&!bullet(lines[i])&&!(i+1<lines.length&&separator(lines[i+1])))paragraph.push(lines[i++]);
  const p=element('p');if(depth===0&&/[\p{Script=Han}]/u.test(paragraph.join('')))p.classList.add('cjk-paragraph');inline(p,paragraph.join('\n'));root.append(p);
 }
}
function disposeTree(node){
 const c=components.get(node);if(c?.dispose){c.dispose();c.dispose=null;}
 for(const child of [...node.childNodes])disposeTree(child);
}
function activate(node){
 const c=components.get(node);
 if(c){
  if(!c.dispose)c.dispose=bindThemeRenderer(node,c.schema,c.slots,active=>{c.active=active;if(c.slots.caption)c.slots.caption.hidden=!active;});
  for(const slot of Object.values(c.slots))activate(slot);
 }else for(const child of node.childNodes)activate(child);
}
function reconcile(current,next){
 const a=components.get(current),b=components.get(next);
 if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName||a?.schema!==b?.schema){disposeTree(current);current.replaceWith(next);return;}
 // Theme wrappers are presentation. Stream reconciliation follows the original
 // semantic slots, retaining their nodes and nested renderer bindings.
 if(a){for(const key of Object.keys(a.slots))reconcile(a.slots[key],b.slots[key]);if(a.slots.caption)a.slots.caption.hidden=!a.active;return;}
 if(current.nodeType===3){if(current.data!==next.data){if(next.data.startsWith(current.data))current.appendData(next.data.slice(current.length));else current.data=next.data;}return;}
 for(const attr of [...current.attributes])if(attr.name!=='data-theme-node'&&!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
 for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
 const children=[...next.childNodes];for(let i=0;i<children.length;i++){if(current.childNodes[i])reconcile(current.childNodes[i],children[i]);else current.append(children[i]);}while(current.childNodes.length>children.length){disposeTree(current.lastChild);current.lastChild.remove();}
}
export function renderMarkdown(root,text){
 text=String(text||'');const previous=cache.get(root);
 if(previous?.text===text&&previous.first===root.firstChild&&previous.last===root.lastChild)return;
 root.classList.add('markdown');
 const next=element('div');blocks(next,text.replace(/\r\n?/g,'\n').split('\n'));
 const update=()=>{
  const children=[...next.childNodes];for(let i=0;i<children.length;i++){if(root.childNodes[i])reconcile(root.childNodes[i],children[i]);else root.append(children[i]);}
  while(root.childNodes.length>children.length){disposeTree(root.lastChild);root.lastChild.remove();}
  activate(root);
 };
 if(root.ownerDocument)withThemeBatch(root.ownerDocument,update);else update();
 cache.set(root,{text,first:root.firstChild,last:root.lastChild});
}
export function chatMessages(messages){return (messages||[]).filter(m=>(m.from==='user'||m.from==='matrix'&&m.to==='user')&&m.state!=='commentary');}
