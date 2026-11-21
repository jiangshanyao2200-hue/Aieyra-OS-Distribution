// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: cropBounds; cropSource; roundMinZoom; compose; cropImage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/image-crop.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 头像与背景的裁切：拖动定位，滚轮、滑条或方向键缩放与微调；输出时按原图分辨率取样，不从预览画布放大。
// 头像（round）：取景框里的圆就是最终头像（框的内切圆）；可以缩到整张图都放进圆里，空出来的地方用模糊的原图填满
// （用户 E2 Q1）；最大放大 8 倍；旁边按真实大小同步显示聊天里和光圈里的样子。
// 弹窗按需生成，用完即移除；样式在 settings.css（.image-crop）。

import {bindTidyRange,tidyValue} from './tidy-range.mjs';
import {createRoleRing} from './role-identity.mjs';
// zoom=1 是“刚好铺满取景框”。图比框小时只能在框内移动，图比框大时只能拖到图的边缘。
export function cropBounds(width,height,zoom,x,y,frameW,frameH){
 const scale=Math.max(frameW/width,frameH/height)*zoom;
 const maxX=Math.abs(width*scale-frameW)/2,maxY=Math.abs(height*scale-frameH)/2;
 return {scale,x:Math.min(maxX,Math.max(-maxX,x)),y:Math.min(maxY,Math.max(-maxY,y))};
}

// 当前取景框在原图上的区域（原图像素）。
export function cropSource(width,height,bounds,frameW,frameH){
 const left=(width*bounds.scale/2-frameW/2-bounds.x)/bounds.scale,top=(height*bounds.scale/2-frameH/2-bounds.y)/bounds.scale;
 return {sx:left,sy:top,sw:frameW/bounds.scale,sh:frameH/bounds.scale};
}

// 头像最小缩放：整张图（含四角）都能放进内切圆里。
export function roundMinZoom(width,height,frame){
 const cover=Math.max(frame/width,frame/height);
 return Math.min(1,frame/Math.hypot(width,height)/cover);
}

// 把当前构图画到任意大小的画布上：先铺一层模糊的原图（只在图没铺满时看得见），再画图本身。
function compose(ctx,image,b,frameW,frameH,k,blurFill){
 const w=frameW*k,h=frameH*k;
 ctx.clearRect(0,0,w,h);ctx.imageSmoothingQuality='high';
 const dw=image.width*b.scale*k,dh=image.height*b.scale*k,dx=w/2-dw/2+b.x*k,dy=h/2-dh/2+b.y*k;
 if(blurFill&&(dw<w-.5||dh<h-.5)){
  const cover=Math.max(w/image.width,h/image.height)*1.25;
  ctx.save();ctx.filter='blur('+Math.round(14*k)+'px) brightness(.82)';
  ctx.drawImage(image,w/2-image.width*cover/2,h/2-image.height*cover/2,image.width*cover,image.height*cover);ctx.restore();
 }
 ctx.drawImage(image,dx,dy,dw,dh);
}

export function cropImage(source,{title='裁切',frame=[320,320],round=false,output=[160,160],type='image/png',quality=.9,previews=[],doc=document}={}){
 return new Promise((resolve,reject)=>{
  const [fw,fh]=frame,dialog=doc.createElement('dialog'),image=new Image();
  dialog.className='image-crop'+(round?' round':'');dialog.setAttribute('aria-label',title);
  const heading=doc.createElement('h2');heading.textContent=title;
  const hint=doc.createElement('p');hint.textContent='拖动调整位置，滚轮缩放。';
  const body=doc.createElement('div');body.className='crop-body';
  const stage=doc.createElement('div');stage.className='crop-stage'+(round?' round':'');stage.style.aspectRatio=fw+' / '+fh;
  const canvas=doc.createElement('canvas');canvas.width=fw;canvas.height=fh;canvas.tabIndex=0;canvas.setAttribute('aria-label','拖动调整图片位置');stage.append(canvas);
  body.append(stage);
  // 真实大小的样子：聊天里的头像、光圈里的头像。
  const shots=previews.map(p=>{
   const box=doc.createElement('figure'),c=doc.createElement('canvas'),label=doc.createElement('figcaption');
   box.className='crop-preview'+(p.ring?' ring':'');c.width=c.height=Math.round(p.size*2);label.textContent=p.label;
   if(p.ring){const ring=createRoleRing({role:'matrix',name:'Eyra',ring:p.effect||'pulse',avatar:'',glyph:''},{doc,live:true});ring.style.width=ring.style.height=p.size+'px';ring.querySelector('.role-face')?.remove();c.className='role-face';ring.append(c);box.append(ring,label);}
   else{c.style.width=c.style.height=p.size+'px';box.append(c,label);}
   return {box,c,size:p.size};
  });
  if(shots.length){const side=doc.createElement('div');side.className='crop-previews';side.append(...shots.map(s=>s.box));body.append(side);}
  const zoomField=doc.createElement('label');zoomField.className='slider-field';zoomField.textContent='缩放';
  const zoomInput=doc.createElement('input');Object.assign(zoomInput,{type:'range',min:'1',max:'8',step:'0.01',value:'1'});zoomField.append(zoomInput);
  const zoomValue=doc.createElement('output');zoomField.append(zoomValue);
  const zoomRange=bindTidyRange(zoomInput,{label:'缩放',unit:'×',value:1,output:zoomValue});
  const actions=doc.createElement('div');actions.className='crop-actions';
  const cancel=doc.createElement('button');cancel.type='button';cancel.className='quiet';cancel.textContent='取消';
  const apply=doc.createElement('button');apply.type='button';apply.textContent='使用';actions.append(cancel,apply);
  dialog.append(heading,hint,body,zoomField,actions);doc.body.append(dialog);
  const ctx=canvas.getContext('2d');let x=0,y=0,zoom=1,minZoom=1,drag=null,done=false;
  const fill=()=>zoomInput.style.setProperty('--fill',((zoom-minZoom)/(8-minZoom)*100).toFixed(1)+'%');
  const draw=()=>{
   const b=cropBounds(image.width,image.height,zoom,x,y,fw,fh);x=b.x;y=b.y;
   compose(ctx,image,b,fw,fh,1,round);fill();zoomRange.paint();
   for(const s of shots){const g=s.c.getContext('2d');g.clearRect(0,0,s.c.width,s.c.height);g.imageSmoothingQuality='high';g.drawImage(canvas,0,0,s.c.width,s.c.height);}
  };
  const finish=value=>{if(done)return;done=true;zoomRange.close();if(dialog.open)dialog.close();setTimeout(()=>dialog.remove(),320);resolve(value);};
  const resize=v=>{const next=Math.max(minZoom,Math.min(8,v));x*=next/zoom;y*=next/zoom;zoom=next;zoomInput.value=String(zoom);draw();};
  canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);stage.classList.add('dragging');};
  canvas.onpointermove=e=>{if(!drag)return;const f=fw/canvas.getBoundingClientRect().width;x+=(e.clientX-drag.x)*f;y+=(e.clientY-drag.y)*f;drag={x:e.clientX,y:e.clientY};draw();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null;stage.classList.remove('dragging');};
  canvas.onwheel=e=>{e.preventDefault();resize(tidyValue(zoom+(e.deltaY<0?.05:-.05),{min:minZoom,max:8,step:.05}));};
  canvas.onkeydown=e=>{const m={ArrowLeft:[10,0],ArrowRight:[-10,0],ArrowUp:[0,10],ArrowDown:[0,-10]}[e.key];if(m){e.preventDefault();x+=m[0];y+=m[1];draw();}};
  zoomInput.oninput=()=>resize(Number(zoomInput.value));
  apply.onclick=()=>{
   const out=doc.createElement('canvas');[out.width,out.height]=output;
   // 输出按原图取样：同一构图按输出尺寸重画，不从预览画布放大。
   compose(out.getContext('2d'),image,cropBounds(image.width,image.height,zoom,x,y,fw,fh),fw,fh,output[0]/fw,round);
   finish(out.toDataURL(type,quality));
  };
  cancel.onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};
  image.onload=()=>{if(round){minZoom=roundMinZoom(image.width,image.height,fw);zoomInput.min=String(minZoom);}draw();dialog.showModal();canvas.focus();};
  image.onerror=()=>{zoomRange.close();dialog.remove();reject(Error('无法读取这张图片'));};
  image.src=source;
 });
}
