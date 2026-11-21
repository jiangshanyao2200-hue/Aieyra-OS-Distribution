/* @file-map:start
文件: link/desktop/aidebug-layout.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/network-probe.test.cjs, link/desktop/aidebug-live.cjs, link/desktop/os-aidebug.cjs
链路: observation
验证: AIDEBUG/control.test.cjs, AIDEBUG/network-probe.test.cjs, AIDEBUG/observe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  layoutProbe | function
  layoutProbe.visible | function
  layoutProbe.bounds | function
  layoutProbe.identity | function
  layoutProbe.issue | function
  layoutProbe.centered | function
  layoutProbe.clips | function
  markImage | function
  writeReview | function
  writeReview.esc | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path');
/* @chain-region layoutProbe | calls: at, document.querySelectorAll, document.querySelector, Error, root.querySelectorAll, centered, n.querySelector, getComputedStyle … */ function layoutProbe(options={}){
 const active=[...document.querySelectorAll('dialog[open]')].at(-1),root=options.selector?document.querySelector(options.selector):active||document.querySelector('#workspace')||document.querySelector('#main')||document.body;
 if(!root)throw Error('audit_root_unavailable');
 const issues=[],controls=[],alignments=[],/* @chain-region layoutProbe.visible | calls: n.getBoundingClientRect, getComputedStyle, Number, n.checkVisibility */ visible=n=>{if(!n)return false;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return !!(r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.05&&(!n.checkVisibility||n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})));};
 const /* @chain-region layoutProbe.bounds | calls: n.getBoundingClientRect */ bounds=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const /* @chain-region layoutProbe.identity | calls: CSS.escape, find, a.name.startsWith, n.tagName.toLowerCase, JSON.stringify, join */ identity=n=>n.id?'#'+CSS.escape(n.id):[...n.attributes].find(a=>a.name.startsWith('data-'))?n.tagName.toLowerCase()+'['+[...n.attributes].find(a=>a.name.startsWith('data-')).name+'='+JSON.stringify([...n.attributes].find(a=>a.name.startsWith('data-')).value)+']':n.tagName.toLowerCase()+'.'+[...n.classList].join('.');
 const /* @chain-region layoutProbe.issue | calls: issues.push, identity, slice, bounds */ issue=(kind,n,detail)=>issues.push({kind,selector:identity(n),text:(n.innerText||n.ariaLabel||'').slice(0,140),rect:bounds(n),detail});
 const tolerance=1/(devicePixelRatio||1)+.05;
 const /* @chain-region layoutProbe.centered | calls: visible, a.getBoundingClientRect, b.getBoundingClientRect, alignments.push, identity, Math.abs, issue */ centered=(kind,a,b,axis)=>{
  if(!visible(a)||!visible(b))return;
  const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),delta=axis==='x'?(ra.left+ra.width/2)-(rb.left+rb.width/2):(ra.top+ra.height/2)-(rb.top+rb.height/2);
  alignments.push({kind,selector:identity(a),axis,delta,physicalPixels:delta*(devicePixelRatio||1)});
  if(Math.abs(delta)>tolerance)issue(kind,a,{axis,delta,physicalPixels:delta*(devicePixelRatio||1),relativeTo:identity(b)});
 };
 for(const n of root.querySelectorAll('.member'))centered('member-content-misaligned',n.querySelector('.avatar'),n.lastElementChild,getComputedStyle(n).flexDirection==='row'?'y':'x');
 for(const n of root.querySelectorAll('.home-seat'))centered('station-content-misaligned',n.querySelector('.pixel-station-avatar'),n.querySelector('.seat-copy'),'y');
 for(const n of document.querySelectorAll('.titlebar button,.dialog-top button')){
  const icon=n.querySelector('svg');if(!icon||!visible(n)||[...n.querySelectorAll('span')].some(visible))continue;
  centered('control-icon-misaligned',icon,n,'x');centered('control-icon-misaligned',icon,n,'y');
 }
 for(const n of document.querySelectorAll('.member-menu:popover-open,.ui-tip:popover-open,.glass-select-list:popover-open,.background-options:not([hidden])')){
  if(!visible(n))continue;const r=n.getBoundingClientRect();
  if(r.left < -tolerance || r.top < -tolerance || r.right > innerWidth+tolerance || r.bottom > innerHeight+tolerance)issue('floating-surface-outside-viewport',n,{});
  if(!n.matches(':popover-open'))for(let p=n.parentElement;p;p=p.parentElement){
   const s=getComputedStyle(p),b=p.getBoundingClientRect(),/* @chain-region layoutProbe.clips | calls: includes */ clips=axis=>['auto','hidden','clip','scroll'].includes(s[axis]);
   if(clips('overflowX')&&(r.left<b.left-tolerance||r.right>b.right+tolerance)||clips('overflowY')&&(r.top<b.top-tolerance||r.bottom>b.bottom+tolerance)){issue('floating-surface-clipped',n,{ancestor:identity(p)});break;}
  }
 }
 if(document.documentElement.scrollWidth>innerWidth+2)issue('page-horizontal-overflow',document.documentElement,{width:document.documentElement.scrollWidth,viewport:innerWidth});
 for(const n of root.querySelectorAll('button,a,input,textarea,select,summary,[role=button],[role=option]')){
  if(!visible(n))continue;
  const r=n.getBoundingClientRect(),s=getComputedStyle(n),name=n.ariaLabel||n.innerText||n.getAttribute('title')||n.placeholder||n.name||'';
  const inViewport=r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;
  if(!inViewport)continue;
  const cx=r.x+r.width/2,cy=r.y+r.height/2,centerVisible=cx>=0&&cx<innerWidth&&cy>=0&&cy<innerHeight,top=centerVisible?document.elementFromPoint(cx,cy):null;
  controls.push({selector:identity(n),label:name.slice(0,120),rect:bounds(n),fontSize:s.fontSize,disabled:!!n.disabled,occluded:centerVisible&&!n.contains(top)});
  if(!name.trim()&&n.tagName!=='INPUT'&&n.tagName!=='TEXTAREA'&&n.tagName!=='SELECT')issue('unnamed-control',n,{});
  if(n.matches('button')&&n.scrollWidth>n.clientWidth+3&&s.textOverflow!=='ellipsis')issue('clipped-control-text',n,{scrollWidth:n.scrollWidth,clientWidth:n.clientWidth});
  if(n.matches('button.primary')&&!n.disabled&&centerVisible&&!n.contains(top))issue('occluded-primary-action',n,{cover:top?.tagName,coverId:top?.id});
 }
 for(const n of root.querySelectorAll('.activity-row time,.activity-row p>span,.development-logs p,.run-log-line')){
  if(!visible(n))continue;const s=getComputedStyle(n),line=parseFloat(s.lineHeight),r=n.getBoundingClientRect();
  if(s.whiteSpace!=='nowrap'||Number.isFinite(line)&&r.height>line+2)issue('single-line-wrapped',n,{height:r.height,line,whiteSpace:s.whiteSpace});
 }
 const messages=[...root.querySelectorAll('.connection-message,.development-error')].filter(visible);
 for(let i=0;i<messages.length;i++)for(let j=i+1;j<messages.length;j++)if(messages[i].innerText.trim()===messages[j].innerText.trim())issue('duplicate-error',messages[j],{});
 const status=document.querySelector('#surface-status');
 if(status&&visible(status)&&status.getBoundingClientRect().height>54)issue('oversized-connection-status',status,{});
 const dialogs=[...document.querySelectorAll('dialog')].map(n=>({id:n.id,open:n.open,visible:visible(n),display:getComputedStyle(n).display,rect:bounds(n)}));
 for(const n of document.querySelectorAll('dialog:not([open])'))if(visible(n))issue('closed-dialog-still-visible',n,{});
 const surface=document.querySelector('.surface');
 return {at:new Date().toISOString(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},root:identity(root),focus:identity(document.activeElement),surface:surface?{rect:bounds(surface),sync:surface.dataset.syncState,content:document.querySelector('#content')?bounds(document.querySelector('#content')):null}:null,issues,controls,alignments,dialogs,palette:{text:getComputedStyle(root).color,background:getComputedStyle(root).backgroundColor,font:getComputedStyle(root).fontFamily}};
}
/* @chain-region markImage | calls: image.getSize, image.toBitmap, Math.max, Math.round, Math.min, nativeImage.createFromBitmap */ function markImage(image,issues,nativeImage,zoom=1){
 const {width,height}=image.getSize(),bitmap=image.toBitmap({scaleFactor:1});
 for(const item of issues){
  const r=item.rect,left=Math.max(0,Math.round(r.x*zoom)),top=Math.max(0,Math.round(r.y*zoom)),right=Math.min(width-1,Math.round((r.x+r.width)*zoom)),bottom=Math.min(height-1,Math.round((r.y+r.height)*zoom));
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(y-top<2||bottom-y<2||x-left<2||right-x<2){const i=(y*width+x)*4;bitmap[i]=90;bitmap[i+1]=130;bitmap[i+2]=245;bitmap[i+3]=255;}
 }
 return nativeImage.createFromBitmap(bitmap,{width,height,scaleFactor:1});
}
/* @chain-region writeReview | calls: entries.map, replace, path.relative, join, map, filter, fs.readdirSync, v.isDirectory … */ function writeReview(directory,entries){
 const /* @chain-region writeReview.esc | calls: replace, String */ esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const data=entries.map(v=>({name:v.name,src:path.relative(directory,v.image).replace(/\\/g,'/'),issues:v.audit.issues,viewport:v.audit.viewport,note:v.note,visibility:v.visibility}));
 const viewers=fs.readdirSync(directory,{withFileTypes:true}).filter(v=>v.isDirectory()&&fs.existsSync(path.join(directory,v.name,'viewer.html'))).map(v=>`<a href="${esc(v.name)}/viewer.html">${esc(v.name)}</a>`).join(' · ');
 const file=path.join(directory,'review.html');
 fs.writeFileSync(file,`<!doctype html><meta charset="utf-8"><title>AIDEBUG · 界面检查</title><style>*{box-sizing:border-box}body{margin:0;background:#10141d;color:#e4eaf4;font:15px system-ui}header{position:sticky;top:0;z-index:1;display:flex;gap:18px;align-items:center;padding:16px 24px;background:#191f2b}button{border:1px solid #ffffff24;background:transparent;color:inherit;border-radius:18px;padding:6px 14px;cursor:pointer}#title{flex:1}main{padding:20px}#screen{display:block;max-width:100%;max-height:78vh;margin:auto;border:1px solid #ffffff20}#details{max-width:1200px;margin:16px auto;line-height:1.8;color:#b9c8dc}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;padding:24px}figure{margin:0;cursor:pointer}figure img{width:100%;aspect-ratio:16/10;object-fit:contain;background:#090d14;border:1px solid #ffffff20}figcaption{padding:10px 0}small{color:#a9bacf}</style><header><strong>AIDEBUG</strong><span id="title"></span><button id="prev">上一张</button><button id="next">下一张</button></header><nav style="padding:12px 24px;color:#b8c9df">${viewers}</nav><main><img id="screen"><div id="details"></div></main><div id="grid">${data.map((v,i)=>`<figure data-index="${i}"><img src="${esc(v.src)}" loading="lazy"><figcaption>${esc(v.name)}<br><small>${v.viewport.width} × ${v.viewport.height} · ${v.issues.length} 项待查</small></figcaption></figure>`).join('')}</div><script>const entries=${JSON.stringify(data).replace(/</g,'\\u003c')};let index=0;function show(i){index=Math.max(0,Math.min(entries.length-1,i));const e=entries[index];if(!e)return;document.getElementById('screen').src=e.src;document.getElementById('title').textContent=(index+1)+' / '+entries.length+' · '+e.name;document.getElementById('details').textContent=(e.note?e.note+' · ':'')+(e.visibility?('可见采样 '+e.visibility.visibleSamples+'/'+e.visibility.totalSamples+(e.visibility.insideScreen?'':' · 部分位于屏幕外')+' · '):'')+(e.issues.length?e.issues.map(v=>v.kind+' · '+v.selector+' · '+v.text).join('； '):'几何检查未发现问题；仍需观察截图、交互和相邻状态。');}document.getElementById('prev').onclick=()=>show(index-1);document.getElementById('next').onclick=()=>show(index+1);document.querySelectorAll('figure').forEach(n=>n.onclick=()=>show(+n.dataset.index));addEventListener('keydown',e=>{if(e.key==='ArrowLeft')show(index-1);if(e.key==='ArrowRight')show(index+1);});show(0);</script><style>a{color:#b8d4ff}nav:empty{display:none}</style>`);
 return file;
}
module.exports={layoutProbe,markImage,writeReview};
