/* @file-map:start
文件: link/office/web/preview-card.mjs
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: 无已解析的项目内静态导入
上游: link/office/web/tooltip.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  previewCardData | function
  renderPreviewCard | function
  renderPreviewCard.apply | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// Only bounded, locally captured bitmap data enters the common tooltip window.
export /* @chain-region previewCardData | calls: slice, String, test, includes, Number, Number.isFinite */ function previewCardData(value){
 if(!value||typeof value!=='object')return null;
 const title=String(value.title||'程序预览').slice(0,120),state=String(value.state||'').slice(0,120);
 const url=typeof value.url==='string'&&value.url.length<=4*1024*1024&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value.url)?value.url:'';
 const module=['browser','settings','servers','control','market'].includes(value.module)?value.module:'';
 const width=Number(value.width),height=Number(value.height);
 const geometry=Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&width<=32768&&height<=32768?{width,height}:{width:16,height:10};
 return {title,state,url,...geometry,...(module?{module}:{})};
}
export /* @chain-region renderPreviewCard | calls: previewCardData, host.style.setProperty, String, Math.min, Math.max, host.querySelector, head.querySelector, doc.createElement … */ function renderPreviewCard(host,value){
 const data=previewCardData(value),doc=host.ownerDocument;
 if(!data)return;
 const ratio=data.width/data.height;host.style.setProperty('--preview-ratio',String(ratio));host.style.setProperty('--preview-width',(Math.min(320,Math.max(80,240*ratio))+24)+'px');host.dataset.empty=String(!data.url);
 // Polling a bitmap updates the same nodes. Replacing the image every time
 // discards its decoded frame and visibly flashes while the new one decodes.
 let head=host.querySelector('header'),title=head?.querySelector('strong'),state=head?.querySelector('small'),image=host.querySelector('img');
 if(!head||!title||!state){head=doc.createElement('header');title=doc.createElement('strong');state=doc.createElement('small');head.append(title,state);}
 title.textContent=data.title;state.textContent=data.state;state.hidden=!data.state;
 if(data.url){
  if(!image){image=doc.createElement('img');image.alt='';host.replaceChildren(head,image);}
  image.width=data.width;image.height=data.height;
  if(image.getAttribute('src')===data.url)delete image.dataset.pending;
  else if(image.dataset.pending!==data.url){
   const pending=doc.createElement('img');pending.src=data.url;image.dataset.pending=data.url;
   const /* @chain-region renderPreviewCard.apply */ apply=()=>{if(image.dataset.pending===data.url){image.src=data.url;delete image.dataset.pending;}};
   if(typeof pending.decode==='function')void pending.decode().then(apply,()=>{if(image.dataset.pending===data.url)delete image.dataset.pending;});else apply();
  }
  return;
 }
 // An unavailable capture should keep its existing placeholder stable too.
 if(host.querySelector('.program-preview-default')?.dataset.module===(data.module||''))return;
 const box=doc.createElement('div');box.className='program-preview-default';box.dataset.module=data.module||'';
 const bar=doc.createElement('div');bar.className='program-preview-bar';bar.textContent=data.module==='browser'?'搜索或输入网址':data.title;
 const content=doc.createElement('div');content.className='program-preview-content';
 const lines={browser:['搜索网页','书签 · 历史'],settings:['个人 · 外观','模型连接 · 提示词'],servers:['服务器','连接与终端'],control:['Link','工位与协作'],market:['主题','头像 · 背景 · 光圈']}[data.module]||[data.title];
 for(const text of lines){const line=doc.createElement('span');line.textContent=text;content.append(line);}box.append(bar,content);host.replaceChildren(head,box);host.dataset.empty=String(!data.url);
}
