// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: BALL; eyraLayout; setupEyraFloat
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/eyra-float.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Eyra 小球在工作态与其他页面的位置：默认停在左侧、输入条上方；单击弹出输入时被轻轻托起；
// 用户可按住拖动并被记住。思考与正文气泡随小球翻转（上/下、左/右），任何内容都不超出界面。
const BALL=52,MARGIN=24,GAP=14;

// 纯函数：给定屏幕尺寸、小球中心与输入条高度，算出锚点、方向与气泡可用空间。
export function eyraLayout({width,height,center,lift=0}){
 const r=BALL/2,floor=height-MARGIN-lift;
 const x=Math.min(Math.max(center?.x??MARGIN+r,MARGIN+r),width-MARGIN-r);
 const y=Math.min(Math.max(center?.y??floor-r,MARGIN+r),floor-r);
 const v=y-r>height*.36?'above':'below',h=x<width*.62?'left':'right';
 return {x,y,v,h,
  ax:h==='left'?x-r:x+r, ay:v==='above'?y+r:y-r,
  room:Math.max(80,Math.floor(v==='above'?y-r-GAP-MARGIN:floor-(y+r)-GAP)),
  wroom:Math.max(200,Math.floor(h==='left'?width-(x-r)-MARGIN:x+r-MARGIN))};
}

export function setupEyraFloat({screen,body,storage=globalThis.sessionStorage,win=globalThis.window}){
 let center=null,dragging=null,frame=0,closed=false;
 try{const saved=JSON.parse(storage?.getItem('eyra:float')||'null');if(saved&&Number.isFinite(saved.fx)&&Number.isFinite(saved.fy))center={fx:saved.fx,fy:saved.fy};}catch{}
 const compact=()=>body.dataset.eyraPlacement==='compact';
 // Link 页的指挥中心是原生视图，会盖住网页内容：小球固定在它让出的左下角，不用拖动记住的位置，也不能拖进去。
 // 折叠态（UI设计知识库 形态 §10）光圈固定在左下角，也不拖动。
 const pinned=()=>body.dataset.desktopPage==='link'||body.dataset.form==='folded';
 function lift(){
  // Pending supplements, recovery and attachments share the footer with the
  // input. Its whole visible height reserves space, even with input folded.
  const dock=body.ownerDocument.getElementById('bottom-bar');
  if(dock&&Array.from(dock.children).some(e=>!e.hidden&&getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().height>0))return dock.getBoundingClientRect().height+GAP;
  if(!body.classList.contains('composer-open'))return 0;
  const h=parseFloat(getComputedStyle(body.ownerDocument.documentElement).getPropertyValue('--composer-height'))||56;
  return h+GAP;
 }
 function apply(){
  frame=0;if(closed)return;
  // Home owns its chat geometry. The legacy --footer-reserve has no style
  // consumer; measuring and publishing it here woke body observers every
  // animation frame even though the floating placement was not in use.
  if(!compact()){if(body.dataset.eyraFree!=='false')body.dataset.eyraFree='false';return;}
  const rect=screen.getBoundingClientRect(),point=pinned()?null:dragging||(center?{x:center.fx*rect.width,y:center.fy*rect.height}:null);
  const raised=lift(),l=eyraLayout({width:rect.width,height:rect.height,center:point,lift:raised});
  for(const [key,value] of Object.entries({eyraFree:'true',eyraV:l.v,eyraH:l.h,eyraDragging:String(!!dragging)}))if(body.dataset[key]!==value)body.dataset[key]=value;
  const s=body.style;for(const [key,value] of Object.entries({'--composer-lift':raised,'--eyra-ax':l.ax,'--eyra-ay':l.ay,'--eyra-room':l.room,'--eyra-wroom':l.wroom}))if(s.getPropertyValue(key)!==value+'px')s.setProperty(key,value+'px');
 }
 const schedule=()=>{if(!frame&&!closed)frame=win.requestAnimationFrame(apply);};
 const observer=new win.MutationObserver(schedule);
 observer.observe(body,{attributes:true,attributeFilter:['class','data-eyra-placement','data-desktop-page','data-form']});
 observer.observe(body.ownerDocument.documentElement,{attributes:true,attributeFilter:['style']});
 win.addEventListener('resize',schedule);schedule();
 const dock=body.ownerDocument.getElementById('bottom-bar'),resize=win.ResizeObserver?new win.ResizeObserver(schedule):null;
 if(dock)resize?.observe(dock);
 return {
  // 拖动：只在工作态/其他页面生效；中央闲聊时小球保持居中。
  drag:{
   start(){if(!compact()||pinned())return;const rect=screen.getBoundingClientRect(),l=eyraLayout({width:rect.width,height:rect.height,center:center?{x:center.fx*rect.width,y:center.fy*rect.height}:null,lift:lift()});dragging={x:l.x,y:l.y,ox:l.x,oy:l.y};schedule();},
   move(_e,dx,dy){if(!dragging)return;dragging={...dragging,x:dragging.ox+dx,y:dragging.oy+dy};schedule();},
   end(){if(!dragging)return;const rect=screen.getBoundingClientRect(),l=eyraLayout({width:rect.width,height:rect.height,center:dragging,lift:lift()});center={fx:l.x/rect.width,fy:l.y/rect.height};dragging=null;try{storage?.setItem('eyra:float',JSON.stringify(center));}catch{}schedule();},
  },
  reset(){center=null;try{storage?.removeItem('eyra:float');}catch{}schedule();},
  refresh:schedule,
  settle(){if(frame)win.cancelAnimationFrame(frame);apply();},
  close(){closed=true;observer.disconnect();resize?.disconnect();win.removeEventListener('resize',schedule);if(frame)win.cancelAnimationFrame(frame);},
 };
}
