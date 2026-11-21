// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: moduleWindowSpec; bestWindowSize; restoreModuleBounds
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-window.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Detached program windows share a native size policy.
function moduleWindowSpec() {
 const p=require('../src/resources.cjs').read('运行参数.json').desktop_extensions||{};
 const value=(key,fallback,min,max)=>Number.isFinite(p[key])?Math.round(Math.max(min,Math.min(max,p[key]))):fallback;
 return {width:value('width',1180,520,3840),height:value('height',780,380,2160),minWidth:value('min_width',900,360,1180),minHeight:value('min_height',600,300,780),barHeight:value('titlebar_height',48,36,72)};
}
// 独立窗口默认的最佳大小：16:10，按所在屏幕工作区取高的 82%，再不超过宽的 78%。用户调过大小以后就用用户的。
function bestWindowSize(work,spec=moduleWindowSpec()){
 const ratio=1.6;let height=Math.round(work.height*.82),width=Math.round(height*ratio);
 if(width>work.width*.78){width=Math.round(work.width*.78);height=Math.round(width/ratio);}
 return {width:Math.min(work.width,Math.max(spec.minWidth,width)),height:Math.min(work.height,Math.max(spec.minHeight,height))};
}
// Windows can round a DIP rectangle outward when adding its native resize
// border. Feeding that measured rectangle straight back grows each reopen.
function restoreModuleBounds(win,target){
 let request={...target};
 for(let attempt=0;attempt<3;attempt++){
  win.setBounds(request);const actual=win.getBounds();
  if(['x','y','width','height'].every(k=>actual[k]===target[k]))return;
  request=Object.fromEntries(['x','y','width','height'].map(k=>[k,request[k]+target[k]-actual[k]]));
  if(request.width<1||request.height<1)return;
 }
}
module.exports={moduleWindowSpec,restoreModuleBounds,bestWindowSize};
