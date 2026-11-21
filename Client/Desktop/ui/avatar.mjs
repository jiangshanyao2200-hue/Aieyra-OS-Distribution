// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: $; cropBounds; cropAvatar
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/avatar.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const $=id=>document.getElementById(id);
export function cropBounds(width,height,zoom=1,x=0,y=0,size=320){
 const scale=Math.max(size/width,size/height)*zoom;
 return {scale,x:Math.min((width*scale-size)/2,Math.max(-(width*scale-size)/2,x)),y:Math.min((height*scale-size)/2,Math.max(-(height*scale-size)/2,y))};
}
export function cropAvatar(source){return new Promise((resolve,reject)=>{
 const image=new Image(),canvas=$('crop-canvas'),context=canvas.getContext('2d');let x=0,y=0,zoom=1,drag=null,settled=false;
 const finish=value=>{if(settled)return;settled=true;canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=canvas.onwheel=canvas.onkeydown=null;$('avatar-crop').close();resolve(value);};
 const draw=()=>{const b=cropBounds(image.width,image.height,zoom,x,y);x=b.x;y=b.y;context.clearRect(0,0,320,320);context.drawImage(image,160-image.width*b.scale/2+x,160-image.height*b.scale/2+y,image.width*b.scale,image.height*b.scale);};
 image.onload=()=>{
  $('crop-zoom').value='1';draw();$('avatar-crop').showModal();canvas.focus();
  canvas.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(!drag)return;const factor=320/canvas.getBoundingClientRect().width;x+=(e.clientX-drag.x)*factor;y+=(e.clientY-drag.y)*factor;drag={x:e.clientX,y:e.clientY};draw();};
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;
  const resize=v=>{const next=Math.max(1,Math.min(4,v));x*=next/zoom;y*=next/zoom;zoom=next;$('crop-zoom').value=String(zoom);draw();};
  $('crop-zoom').oninput=()=>resize(Number($('crop-zoom').value));
  canvas.onwheel=e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();resize(zoom-e.deltaY*.002);};
  canvas.onkeydown=e=>{const move={ArrowLeft:[10,0],ArrowRight:[-10,0],ArrowUp:[0,10],ArrowDown:[0,-10]}[e.key];if(move){e.preventDefault();x+=move[0];y+=move[1];draw();}};
  $('apply-crop').onclick=()=>{const out=document.createElement('canvas');out.width=out.height=160;out.getContext('2d').drawImage(canvas,0,0,160,160);finish(out.toDataURL('image/png'));};
  $('cancel-crop').onclick=()=>finish(null);$('avatar-crop').oncancel=e=>{e.preventDefault();finish(null);};
 };
 image.onerror=()=>reject(Error('无法读取这张图片'));image.src=source;
});}
