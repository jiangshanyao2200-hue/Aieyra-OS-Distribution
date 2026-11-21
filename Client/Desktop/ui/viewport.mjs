// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: VIEWPORT; viewportScale; setupViewportScale
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/viewport.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 自由窗口：宽高改变只影响布局空间，不暗中改变字号或压扁控件。
// 阅读大小继续由用户的界面缩放/Ctrl +/- 控制，resize 仍触发布局测量。
export const VIEWPORT={width:1280,height:800,min:1,max:1};

export function viewportScale(width,height,base=VIEWPORT){
 return 1;
}

export function setupViewportScale({win=window,base=VIEWPORT,root=null,apply=null}={}){
 const write=apply||(css=>((root||document.documentElement).style.setProperty('--ui-scale',css)));
 let shown=0;
 function measure(){
  const scale=viewportScale(win.innerWidth||base.width,win.innerHeight||base.height,base);
  const css=String(Math.round(scale*1000)/1000);
  if(css===shown)return;
  shown=css;write(css);
  // 头像、正文、间距这些是 JS 算出来写进 CSS 的（chat-layout.mjs），要按新比例重算一次。
  if(typeof win.dispatchEvent==='function')win.dispatchEvent(new Event('os-scale'));
 }
 measure();
 win.addEventListener('resize',measure);
 return {refresh:measure,get scale(){return Number(shown);}};
}
