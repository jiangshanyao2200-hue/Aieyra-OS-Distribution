// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: clamp; fit; railLayout; attachedBounds
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/extension-layout.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function fit(rect,area){const width=Math.min(rect.width,area.width),height=Math.min(rect.height,area.height);return {x:Math.round(clamp(rect.x,area.x,area.x+area.width-width)),y:Math.round(clamp(rect.y,area.y,area.y+area.height-height)),width:Math.round(width),height:Math.round(height)};}
function railLayout(owner,area,count,{size=54,gap=12,padding=8}={},side='left'){
 const height=Math.min(owner.height,area.height),available=Math.max(30,height-2*padding),minimumRows=Math.ceil(count/2),cell=Math.max(20,Math.min(size,(available-gap*(minimumRows-1))/Math.max(1,minimumRows))),rows=Math.max(1,Math.floor((available+gap)/(cell+gap))),columns=Math.ceil(Math.max(1,count)/rows);
 const width=columns*(cell+gap)-gap+2*padding,h=Math.min(height,Math.min(rows,count)*(cell+gap)-gap+2*padding);
 const bounds=fit({x:side==='left'?owner.x-width-6:owner.x+owner.width+6,y:owner.y+owner.height-h,width,height:Math.max(cell+2*padding,h)},area);
 const overlaps=bounds.x<owner.x+owner.width&&bounds.x+bounds.width>owner.x&&bounds.y<owner.y+owner.height&&bounds.y+bounds.height>owner.y;
 // No native rail may be clamped over the chat. The main title bar exposes
 // a deliberate collection menu when the display has no outside space.
 return {bounds,rows,columns,size:cell,gap,padding,overflow:overlaps};
}
function attachedBounds(owner,area,{width=840,height=620}={}){
 const right=area.x+area.width-(owner.x+owner.width),left=owner.x-area.x;
 return fit({x:right>=Math.min(width,480)||right>=left?owner.x+owner.width+8:owner.x-width-8,y:owner.y+Math.max(0,(owner.height-height)/2),width,height},area);
}
module.exports={fit,railLayout,attachedBounds};
