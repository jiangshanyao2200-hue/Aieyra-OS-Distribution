/* @file-map:start
文件: link/desktop/ui/source-browser.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs, link/desktop/ui/surfaces.mjs
上游: AIDEBUG/source-browser.test.mjs, link/desktop/ui/workspace.mjs
链路: source-transfer
验证: AIDEBUG/development-download.test.cjs, AIDEBUG/source-browser.test.mjs, AIDEBUG/transfer-recovery.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  decodeSourceChunk | function
  sourceTree | function
  treeRows | function
  SourceBrowser | class
  SourceBrowser.constructor | method
  SourceBrowser.mount | method
  SourceBrowser.mount.applySearch | function
  SourceBrowser.mount.host.onsubmit | handler
  SourceBrowser.mount.form.elements.query.oninput | handler
  SourceBrowser.mount.host.onclick | handler
  SourceBrowser.load | method
  SourceBrowser.load.current | function
  SourceBrowser.render | method
  SourceBrowser.file | method
  SourceBrowser.file.current | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {project} from './surfaces.mjs';
import {icon} from './icons.mjs';

// Read a few bytes on either side so a UTF-8 character crossing a page boundary
// belongs, in full, to the page containing its first byte.
export const sourceChunkSize=65528;
export /* @chain-region decodeSourceChunk | calls: Math.min, decode, TextDecoder, bytes.subarray */ function decodeSourceChunk(bytes,offset,start){
 let first=offset-start,last=Math.min(bytes.length,first+sourceChunkSize);
 while(first<bytes.length&&(bytes[first]&0xc0)===0x80)first++;
 while(last<bytes.length&&(bytes[last]&0xc0)===0x80)last++;
 return new TextDecoder().decode(bytes.subarray(first,last));
}

export /* @chain-region sourceTree | calls: Map, query.toLocaleLowerCase, includes, path.toLocaleLowerCase, path.split, parts.entries, parent.children.has, parent.children.set … */ function sourceTree(paths, query = '') {
 const root={children:new Map()};
 const term=query.toLocaleLowerCase();
 for(const path of paths){
  if(term&&!path.toLocaleLowerCase().includes(term))continue;
  const parts=path.split('/');let parent=root,prefix='';
  for(const [index,name] of parts.entries()){
   prefix=prefix?`${prefix}/${name}`:name;
   if(!parent.children.has(name))parent.children.set(name,{name,path:prefix,file:index===parts.length-1,children:new Map()});
   parent=parent.children.get(name);
  }
 }
 return root.children;
}

/* @chain-region treeRows | calls: sort, nodes.values, Number, a.name.localeCompare, Math.min, join, ordered.map, e … */ function treeRows(nodes, depth, query, selected, expanded) {
 const ordered=[...nodes.values()].sort((a,b)=>Number(a.file)-Number(b.file)||a.name.localeCompare(b.name));
 const indent=`style="--source-depth:${Math.min(depth, 8)}"`;
 return ordered.map(node=>{
  const path=e(node.path),name=e(node.name);
  if(node.file)return `<button class="source-file" ${indent} data-source-file="${path}" aria-pressed="${node.path===selected}" title="${path}">${icon('file')}<span>${name}</span></button>`;
  const key=e(JSON.stringify([query,node.path]));
  const open=query||expanded.has(node.path);
  return `<details data-details-key="${key}" data-source-folder="${path}"${open?' open':''}><summary class="source-folder" ${indent} title="${path}">${icon('folder')}<span>${name}</span></summary>${treeRows(node.children,depth+1,query,selected,expanded)}</details>`;
 }).join('');
}

// Keep the paged index and bounded file previews on one immutable revision.
export /* @chain-region SourceBrowser */ class SourceBrowser {
 /* @chain-region SourceBrowser.constructor */ constructor(api){this.api=api;this.fileSerial=0;}
 /* @chain-region SourceBrowser.mount | calls: load, Set, project, icon, host.querySelector */ async mount(host,revision){
  if(this.host===host&&this.revision===revision){if(!this.index.error)void this.load();return;}
  this.host=host;this.revision=revision;this.query='';this.path='';this.expanded=new Set();this.fileSerial++;
  this.index={paths:[],next:revision?0:null,total:0,loading:false,error:''};
  project(host,`<section class="source-repository" aria-label="源码仓库"><aside class="source-directory"><form class="tree-search" data-source-search><input name="query" type="search" maxlength="160" placeholder="查找源码" aria-label="查找源码"><button aria-label="搜索">${icon('search')}</button></form><div data-source-files role="region" aria-label="源码目录树"></div><div class="source-index-status" data-source-pages></div></aside><section class="source"><header><strong data-source-name>源码仓库</strong><small data-source-size></small></header><pre tabindex="0" aria-label="源码内容"><code data-source-text>选择文件</code></pre><nav class="pager" data-source-chunks aria-label="源码内容分页"></nav></section></section>`);
  const form=host.querySelector('[data-source-search]');
  const /* @chain-region SourceBrowser.mount.applySearch | calls: form.elements.query.value.trim, Set, map, host.querySelectorAll, render */ applySearch=()=>{
   const query=form.elements.query.value.trim();
   if(query===this.query)return;
   if(!this.query)this.expanded=new Set([...host.querySelectorAll('[data-source-folder][open]')].map(folder=>folder.dataset.sourceFolder));
   this.query=query;this.render();
  };
  /* @chain-region SourceBrowser.mount.host.onsubmit | calls: event.preventDefault, applySearch */ host.onsubmit=event=>{if(event.target!==form)return;event.preventDefault();applySearch();};
  /* @chain-region SourceBrowser.mount.form.elements.query.oninput | calls: applySearch */ form.elements.query.oninput=event=>{if(!event.target.value)applySearch();};
  /* @chain-region SourceBrowser.mount.host.onclick | calls: event.target.closest, file, Number, load */ host.onclick=event=>{const b=event.target.closest('button');if(!b)return;const d=b.dataset;
   if(d.sourceFile!==undefined)void this.file(d.sourceFile);
   if(d.sourceChunk!==undefined)void this.file(this.path,Number(d.sourceChunk));
   if(d.sourceRetry!==undefined)void this.load();
  };
  if(!revision){host.querySelector('[data-source-text]').textContent='源码准备中';return;}
  void this.load();
 }
 /* @chain-region SourceBrowser.load | calls: current, render, api.call, encodeURIComponent, Number.isInteger, Error, index.paths.push, data.files.map … */ async load(){
  const index=this.index,host=this.host,revision=this.revision;
  const /* @chain-region SourceBrowser.load.current */ current=()=>this.index===index&&host.isConnected;
  if(index.loading||index.next===null||!current())return;
  index.loading=true;index.error='';this.render();
  try{
   while(current()&&index.next!==null){
    const offset=index.next;
    const data=await this.api.call('/engineering/manifest?revision='+encodeURIComponent(revision)+'&offset='+offset);
    if(!current())return;
    if(data.revision!==revision||data.next_offset!==null&&(!Number.isInteger(data.next_offset)||data.next_offset<=offset))throw Error('源码目录分页响应无效');
    index.paths.push(...data.files.map(file=>file.path));index.next=data.next_offset;index.total=data.total;
    if(offset===0||index.next===null||offset%400===0)this.render();
    if(!this.path&&index.paths.length)void this.file(index.paths.includes('README.md')?'README.md':index.paths[0]);
   }
  }catch(error){index.error=error.message;}
  finally{index.loading=false;if(current())this.render();}
 }
 /* @chain-region SourceBrowser.render | calls: host.querySelector, project, treeRows, sourceTree, e */ render(){
  const {paths,total,next,error}=this.index;
  const tree=this.host.querySelector('[data-source-files]');
  project(tree,treeRows(sourceTree(paths,this.query),0,this.query,this.path,this.expanded)||
    (next===null?'<p class="empty">未找到文件</p>':''));
  const progress=error?`<span class="error">${e(error)}</span><button type="button" data-source-retry>重试</button>`:
    next!==null?`<span role="status">${total?`读取目录 ${paths.length} / ${total}`:'读取目录…'}</span>`:'';
  project(this.host.querySelector('[data-source-pages]'),progress);
 }
 /* @chain-region SourceBrowser.file | calls: host.querySelector, project, path.split, parents.pop, expanded.add, join, parents.slice, host.querySelectorAll … */ async file(path,offset=0){
  const serial=this.fileSerial=(this.fileSerial||0)+1,revision=this.revision,host=this.host;
  this.path=path;host.querySelector('[data-source-name]').textContent=path;
  host.querySelector('[data-source-text]').textContent='读取中';host.querySelector('[data-source-size]').textContent='';
  project(host.querySelector('[data-source-chunks]'),'');
  const parents=path.split('/');parents.pop();
  for(let length=1;length<=parents.length;length++)this.expanded.add(parents.slice(0,length).join('/'));
  if(!this.query)for(const folder of host.querySelectorAll('[data-source-folder]')){
   if(path.startsWith(folder.dataset.sourceFolder+'/'))folder.open=true;
  }
  host.querySelectorAll('[data-source-file]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sourceFile===path)));
  const start=Math.max(0,offset-3);
  const /* @chain-region SourceBrowser.file.current */ current=()=>serial===this.fileSerial&&revision===this.revision&&host===this.host&&host.isConnected;
  let value,bytes;
  try{
   value=await this.api.call('/engineering/file?revision='+revision+'&path='+encodeURIComponent(path)+'&offset='+start+'&limit=65536');
   if(!current())return;
   bytes=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));
  }
  catch(error){
   if(current()){
    host.querySelector('[data-source-text]').textContent=error.message;
    project(host.querySelector('[data-source-chunks]'),`<button data-source-chunk="${offset}">重试</button>`);
   }
   return;
  }
  const binary=bytes.includes(0)||/\.(?:woff2?|ttf|otf|png|jpe?g|webp|gif|ico|zip|exe|dll|pyd|pdf)$/i.test(path);
  host.querySelector('[data-source-text]').textContent=binary?'二进制文件':decodeSourceChunk(bytes,offset,start);
  host.querySelector('[data-source-size]').textContent=value.bytes.toLocaleString()+' B';
  host.querySelector('pre').scrollTop=0;
  const next=offset+sourceChunkSize<value.bytes?offset+sourceChunkSize:null;
  project(host.querySelector('[data-source-chunks]'),offset||next!==null?`<button data-source-chunk="${Math.max(0,offset-sourceChunkSize)}" ${offset?'':'disabled'}>上一段</button><span>${Math.floor(offset/sourceChunkSize)+1}</span><button data-source-chunk="${next??offset}" ${next===null?'disabled':''}>下一段</button>`:'');
 }
}
