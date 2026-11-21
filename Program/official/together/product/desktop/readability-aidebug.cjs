/* @file-map:start
文件: link/desktop/readability-aidebug.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/aidebug.cjs, link/desktop/workspace-aidebug.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  measureReadability | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';

// Read-only measurements from the actual isolated renderer. No application state,
// credential fields, clipboard contents or user profile are read here.
const expression=String.raw`(()=>{
 const rgba=value=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle=value;ctx.fillRect(0,0,1,1);
  const v=ctx.getImageData(0,0,1,1).data;return [v[0],v[1],v[2],v[3]/255];
 };
 const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
 const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const visible=element=>element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!element.closest('[aria-hidden=true],.sr-only,.ui-tip-accessible');
 const inside=r=>r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;
 const dialog=[...document.querySelectorAll('dialog[open]')].at(-1),scope=dialog||document.querySelector('#workspace')||document.querySelector('#main')||document.body;
 const texts=[],walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
 let node;
 while(node=walker.nextNode()){
  if(!node.textContent.trim())continue;
  const parent=node.parentElement;if(!parent||!visible(parent)||parent.closest('script,style,noscript'))continue;
  const range=document.createRange();range.selectNodeContents(node);
  if(![...range.getClientRects()].some(inside))continue;
  const style=getComputedStyle(parent),ancestors=[];
  for(let p=parent;p;p=p.parentElement)ancestors.unshift(p);
  let background=[8,9,11],opacity=1,solid=true;
  for(const ancestor of ancestors){
   const s=getComputedStyle(ancestor);opacity*=Number(s.opacity);
   const color=rgba(s.backgroundColor);color[3]*=opacity;background=blend(color,background);
   if(s.backgroundImage!=='none'||s.backdropFilter!=='none')solid=false;
  }
  const color=rgba(style.color);color[3]*=opacity;
  const foreground=blend(color,background),a=luminance(foreground),b=luminance(background);
  const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size=parseFloat(style.fontSize),large=size>=24||(size>=18.66&&Number(style.fontWeight)>=700);
  texts.push({text:node.textContent.trim().slice(0,100),tag:parent.tagName,class:parent.className||'',size,lineHeight:style.lineHeight,color:style.color,opacity,contrast:Number(ratio.toFixed(3)),solidBackground:solid,contrastRequired:large?3:4.5,disabled:!!parent.closest(':disabled')});
 }
 const controls=[...scope.querySelectorAll('button,summary,input:not([type=hidden]),textarea,select,a[href]')].filter(n=>visible(n)&&inside(n.getBoundingClientRect())).map(n=>{
  const r=n.getBoundingClientRect();return {tag:n.tagName,label:n.ariaLabel||n.textContent.trim()||n.title||n.labels?.[0]?.textContent.trim()||'',width:r.width,height:r.height,disabled:n.disabled||false};
 });
 return {viewport:[innerWidth,innerHeight],scope:scope.id||scope.tagName,texts,controls,smallText:texts.filter(t=>t.size<14),lowContrast:texts.filter(t=>!t.disabled&&t.solidBackground&&t.contrast<t.contrastRequired),unnamedControls:controls.filter(n=>!n.label),smallTargets:controls.filter(n=>!n.disabled&&(n.width<24||n.height<24))};
})()`;

/* @chain-region measureReadability | calls: contents.executeJavaScript */ async function measureReadability(contents){return contents.executeJavaScript(expression,true);}
module.exports={measureReadability};
