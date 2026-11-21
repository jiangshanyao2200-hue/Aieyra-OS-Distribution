// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; near; harness
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-viewer.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coverImageSize,clampView,zoomView,createThemeViewport}=require('../ui/theme-library-viewer.mjs');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.001,`${actual} != ${expected}`);

test('every marked source corner is reachable for wide and portrait images, before and after zoom',()=>{
 for(const [sourceWidth,sourceHeight,width,height]of [[1600,900,1100,700],[400,1200,1000,600],[2000,1000,400,800]]){
  const size=coverImageSize(width,height,sourceWidth,sourceHeight);
  near(size.width/size.height,sourceWidth/sourceHeight);
  assert.ok(size.width>=width&&size.height>=height,'initial framing covers the viewport');
  const sourceScale=size.width/sourceWidth;
  for(const scale of [1,2,8])for(const x of [0,sourceWidth])for(const y of [0,sourceHeight]){
   const view=clampView({scale,x:x? -1e6:1e6,y:y? -1e6:1e6},width,height,size.width,size.height);
   // Project independent source corner markers into the actual visible rectangle.
   const px=width/2+view.x+(x-sourceWidth/2)*sourceScale*scale;
   const py=height/2+view.y+(y-sourceHeight/2)*sourceScale*scale;
   assert.ok(px>=-.001&&px<=width+.001,`source edge x=${x} remains reachable at ${scale}`);
   assert.ok(py>=-.001&&py<=height+.001,`source edge y=${y} remains reachable at ${scale}`);
  }
 }
});

test('wide source edges can be panned at the initial cover scale and reset stays centered',()=>{
 const size=coverImageSize(1100,700,1600,900);
 const left=clampView({scale:1,x:1e6,y:1e6},1100,700,size.width,size.height);
 near(left.x,650/9);near(left.y,0);
 const right=clampView({...left,x:-1e6},1100,700,size.width,size.height);near(right.x,-650/9);
 const enlarged=zoomView(left,2,100,50,1100,700,size.width,size.height);
 near((100-left.x)/left.scale,(100-enlarged.x)/enlarged.scale);
 near((50-left.y)/left.scale,(50-enlarged.y)/enlarged.scale);
 assert.deepEqual(clampView({scale:1,x:0,y:0},1100,700,size.width,size.height),{scale:1,x:0,y:0});
});

function harness(t,{width=1100,height=700,category='background'}={}){
 const prior=global.ResizeObserver;let observer;
 global.ResizeObserver=class{constructor(callback){this.callback=callback;observer=this;}observe(){}disconnect(){this.closed=true;}};
 t.after(()=>{global.ResizeObserver=prior;});
 const node=()=>({className:'',style:{},children:[],replaceChildren(...children){this.children=children;},remove(){this.removed=true;}});
 class Viewport extends EventTarget{
  constructor(){super();this.ownerDocument={createElement:node};this.dataset={category};this.clientWidth=width;this.clientHeight=height;this.captured=new Set();}
  replaceChildren(...children){this.children=children;}closest(){return null;}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
  setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}
 }
 const viewport=new Viewport(),controller=createThemeViewport(viewport),content=viewport.children[0];
 const fire=(type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:1,clientX:550,clientY:350,...values});viewport.dispatchEvent(event);return event;};
 const image=(w,h)=>Object.assign(new EventTarget(),{tagName:'IMG',naturalWidth:w,naturalHeight:h,style:{},offsetWidth:602,offsetHeight:602});
 return {viewport,controller,content,fire,image,resize(w,h){viewport.clientWidth=w;viewport.clientHeight=h;observer.callback();},observer};
}

test('the pan layer keeps the complete source aspect and exposes cover overflow before zoom',t=>{
 const h=harness(t),image=h.image(1600,900);h.controller.replace(image);
 near(parseFloat(image.style.width),11200/9);near(parseFloat(image.style.height),700);
 assert.equal(h.viewport.dataset.zoomed,'false');assert.equal(h.viewport.dataset.pannable,'true');
 h.fire('pointerdown');assert.equal(h.viewport.hasPointerCapture(1),true);
 h.fire('pointermove',{clientX:1550});assert.match(h.content.style.transform,/translate\(72\.222/);
 h.fire('pointercancel');assert.equal(h.viewport.hasPointerCapture(1),false);
 h.controller.reset();assert.equal(h.content.style.transform,'translate(0px,0px) scale(1)');
 h.resize(700,1100);near(parseFloat(image.style.height),1100);near(parseFloat(image.style.width),17600/9);
 h.fire('pointerdown');h.controller.close();assert.equal(h.viewport.hasPointerCapture(1),false);assert.equal(h.content.children.length,0);
 h.controller.destroy();assert.equal(h.observer.closed,true);
});

test('image load and resize update source bounds, while replaced images cannot affect the next preview',t=>{
 const h=harness(t),image=h.image(0,0);h.controller.replace(image);assert.equal(h.viewport.dataset.pannable,'false');
 image.naturalWidth=400;image.naturalHeight=1200;image.dispatchEvent(new Event('load'));
 near(parseFloat(image.style.width),1100);near(parseFloat(image.style.height),3300);assert.equal(h.viewport.dataset.pannable,'true');
 h.controller.zoomIn();h.resize(600,900);near(parseFloat(image.style.width),600);near(parseFloat(image.style.height),1800);
 h.controller.replace({tagName:'DIV'});assert.equal(h.viewport.dataset.pannable,'false');
 image.naturalWidth=10000;image.dispatchEvent(new Event('load'));assert.equal(h.content.style.transform,'translate(0px,0px) scale(1)');
 h.controller.destroy();
});

test('avatars keep their contained frame until zoom makes the actual image overflow',t=>{
 const h=harness(t,{category:'avatar'}),image=h.image(256,256);h.controller.replace(image);
 assert.deepEqual(image.style,{});assert.equal(h.viewport.dataset.pannable,'false');h.fire('pointerdown');assert.equal(h.viewport.hasPointerCapture(1),false);
 h.controller.zoomIn();h.controller.zoomIn();assert.equal(h.viewport.dataset.pannable,'true');
 h.fire('pointerdown');h.fire('pointermove',{clientX:10000,clientY:10000});
 const [,x,y]=h.content.style.transform.match(/translate\(([-\d.]+)px,([-\d.]+)px\)/);near(Number(x),127.25);near(Number(y),327.25);
 h.controller.reset();assert.equal(h.viewport.dataset.pannable,'false');h.controller.destroy();
});
