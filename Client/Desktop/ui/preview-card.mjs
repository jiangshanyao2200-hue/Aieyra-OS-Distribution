// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: previewCardData; renderPreviewCard
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/preview-card.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Only bounded, locally captured bitmap data enters the common tooltip window.
export function previewCardData(value){
 if(!value||typeof value!=='object')return null;
 const title=String(value.title||'程序预览').slice(0,120),state=String(value.state||'').slice(0,120);
 const url=typeof value.url==='string'&&value.url.length<=4*1024*1024&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value.url)?value.url:'';
 const module=['browser','settings','servers','control','market'].includes(value.module)?value.module:'';
 const width=Number(value.width),height=Number(value.height);
 const geometry=Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&width<=32768&&height<=32768?{width,height}:{width:16,height:10};
 return {title,state,url,...geometry,...(module?{module}:{})};
}
export function renderPreviewCard(host,value){
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
   const apply=()=>{if(image.dataset.pending===data.url){image.src=data.url;delete image.dataset.pending;}};
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
