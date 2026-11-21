import * as THREE from './three.module.min.js';

const neurons={
 nova:[0,.08,.33,'below'],
 core:[-2.48,.67,-.06,'below'],agents:[-3.48,2.34,.27,'above'],
 internal_link:[-4.81,1.74,-.43,'above'],external_link:[-5.12,.43,.14,'below'],
 browser:[-2.82,-1.24,.04,'below'],integrity:[-5.05,-1.19,.23,'below'],
 updates:[-3.23,-2.5,-.21,'below'],verification:[-4.94,-2.69,-.28,'below'],
 cpu:[2.10,-1.16,.22,'below'],memory:[3.51,-1.54,-.51,'below'],
 disk:[2.47,-2.65,.24,'below'],processes:[5.05,-.81,.25,'below'],resident:[5.2,-2.31,-.15,'below'],
 render:[2.26,1.14,.12,'above'],raf:[3.55,2.54,-.33,'above'],
 latency:[5.15,1.81,.17,'above'],baseline:[4.66,.54,-.36,'below'],
};

const links=[
 ['nova','core',.22],['core','agents',.37],['core','internal_link',.33],
 ['agents','internal_link',-.21],['internal_link','external_link',.24],['external_link','core',-.43],
 ['nova','browser',-.24],['browser','integrity',.34],['browser','updates',-.27],
 ['integrity','verification',-.20],['verification','updates',.14],
 ['nova','cpu',.17],['cpu','memory',.29],['cpu','disk',-.41],
 ['memory','processes',.20],['processes','resident',.37],['resident','memory',.29],
 ['nova','render',.15],['render','raf',.34],['raf','latency',.32],
 ['render','latency',-.31],['latency','baseline',.26],['baseline','nova',.49],
];
const colors={online:0x80d6b9,attention:0xff9b80,unknown:0xc0ad82,idle:0x829ba7,running:0x91c2ec};

function controlPoints(source,dest,bend){
 const dx=dest.x-source.x,dy=dest.y-source.y;
 const factor=bend/Math.hypot(dx,dy);
 return [
  new THREE.Vector3(source.x+dx*.33-dy*factor,source.y+dy*.33+dx*factor,source.z+.47),
  new THREE.Vector3(source.x+dx*.67-dy*factor,source.y+dy*.67+dx*factor,dest.z-.26),
 ];
}

export function mountTopology(canvas,labelLayer,observe=()=>{}){
 const widget=canvas.parentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,40);
 camera.position.set(0,.62,14);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const root=new THREE.Group(),points=new Map(),positions=new Map(),fibers=[];
 const color=new THREE.Color(),projected=new THREE.Vector3();
 const labels=new Map([...labelLayer.children].map(button=>[button.dataset.neuron,button]));
 const needle=new THREE.IcosahedronGeometry(.064,1),nub=new THREE.IcosahedronGeometry(.092,1);
 const outline=new THREE.EdgesGeometry(nub,17);
 for(const [id,[x,y,z,side]] of Object.entries(neurons)){
  positions.set(id,new THREE.Vector3(x,y,z));
  labels.get(id).dataset.side=side;
 }
 scene.add(root,new THREE.HemisphereLight(0xe4fff8,0x333c52,2.0));
 const key=new THREE.DirectionalLight(0xdafff2,2.0);
 key.position.set(-3,4,5);scene.add(key);

 const soma=new THREE.Group();
 const somaMesh=new THREE.Mesh(new THREE.IcosahedronGeometry(.39,3),
  new THREE.MeshStandardMaterial({color:0x4d927e,emissive:0x48846e,emissiveIntensity:.45,roughness:.44}));
 const rim=new THREE.IcosahedronGeometry(.47,1);
 const membrane=new THREE.LineSegments(new THREE.EdgesGeometry(rim,18),
  new THREE.LineBasicMaterial({color:colors.online,transparent:true,opacity:.4}));
 rim.dispose();
 soma.add(somaMesh,membrane);soma.position.copy(positions.get('nova'));root.add(soma);
 for(const [id,position] of positions){
  if(id==='nova')continue;
  const group=new THREE.Group();
  const signal=new THREE.Mesh(nub,new THREE.MeshStandardMaterial({roughness:.52,emissiveIntensity:.53}));
  const contour=new THREE.LineSegments(outline,new THREE.LineBasicMaterial({transparent:true,opacity:.14}));
  group.add(signal,contour);group.position.copy(position);root.add(group);
  points.set(id,{group,signal,contour});
 }
 for(const [from,to,bend] of links){
  const source=positions.get(from),dest=positions.get(to);
  const controls=controlPoints(source,dest,bend);
  const path=new THREE.CubicBezierCurve3(source,...controls,dest);
  const fiber=new THREE.Mesh(new THREE.TubeGeometry(path,36,from==='nova'?.016:.011,5),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false}));
  const sheath=[-.12,.12].map(offset=>{
   const shifted=new THREE.CubicBezierCurve3(source,controls[0].clone().add(new THREE.Vector3(0,offset,offset*2)),
    controls[1].clone().add(new THREE.Vector3(0,-offset,offset)),dest);
   return new THREE.Line(new THREE.BufferGeometry().setFromPoints(shifted.getPoints(30)),new THREE.LineBasicMaterial({transparent:true,depthWrite:false}));
  });
  const pulse=new THREE.Mesh(needle,new THREE.MeshBasicMaterial());
  root.add(fiber,...sheath,pulse);
  fibers.push({from,to,path,controls,fiber,sheath,pulse});
 }

 let renderer,context,surface=canvas;
 function fallback(){
  if(surface!==canvas)return;
  surface=canvas.cloneNode(false);canvas.replaceWith(surface);
  try{context=surface.getContext('2d');}catch{}
  surface.dataset.rendering=context?'canvas':'unavailable';
 }
 try{
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  canvas.dataset.rendering='webgl';
 }catch{fallback();}

 let shown=false,frame=0,last=0,needsPaint=true;
 let width=0,height=0,stretch=1,scale=1,selection='',attention='',overall='unknown';
 let modes='',frameStart=0,previousTick=0,rendered=0,intervals=[];
 let states=new Map();
 function reportMode(value){
  if(modes===value)return;
  modes=value;frameStart=0;previousTick=0;rendered=0;intervals=[];
  if(value!=='live')observe({mode:value});
 }
 function observeFrame(now,shouldRender){
  reportMode('live');
  if(!frameStart)frameStart=now;
  if(previousTick)intervals.push(now-previousTick);
  previousTick=now;
  if(shouldRender)rendered++;
  const windowMs=now-frameStart;
  if(windowMs<4000)return;
  if(windowMs<=20000&&intervals.length){
   intervals.sort((a,b)=>a-b);
   const precision=value=>Math.round(value*100)/100;
   observe({mode:'live',windowMs,rafHz:precision(1000*intervals.length/windowMs),
    renderHz:precision(1000*rendered/windowMs),frameP95Ms:precision(intervals[Math.ceil(intervals.length*.95)-1])});
  }
  frameStart=now;rendered=0;intervals=[];
 }
 function project(position){
  projected.copy(position);projected.x*=stretch;projected.project(camera);
  return [(projected.x+1)*width*.5,(1-projected.y)*height*.5];
 }
 function lineState(from,to){
  const alerted=from===attention||to===attention||from!=='nova'&&states.get(from)==='attention'||to!=='nova'&&states.get(to)==='attention';
  const active=from===selection||to===selection;
  const state=alerted?'attention':states.get(to)||'unknown';
  return {alerted,active,state,color:colors[state]??colors.unknown};
 }
 function drawFlat(){
  if(!context)return;
  context.clearRect(0,0,width,height);
  for(const {from,to,controls:[first,second]} of fibers){
   const start=positions.get(from),end=positions.get(to);
   const state=lineState(from,to);
   context.beginPath();context.moveTo(...project(start));
   context.bezierCurveTo(...project(first),...project(second),...project(end));
   context.strokeStyle='#'+state.color.toString(16);
   context.globalAlpha=state.active||state.alerted?.86:.42;context.stroke();
  }
  context.globalAlpha=1;
  for(const [id,position] of positions){
   context.beginPath();context.arc(...project(position),id==='nova'?Math.max(7,scale*.24):id===selection?5:3,0,2*Math.PI);
   context.fillStyle='#'+(colors[states.get(id)]||colors.unknown).toString(16);context.fill();
  }
 }
 function syncColors(){
  somaMesh.material.emissive.setHex(colors[overall]||colors.unknown).multiplyScalar(.32);
  membrane.material.color.setHex(colors[overall]||colors.unknown);
  for(const [id,{signal,contour}] of points){
   const state=states.get(id)||'unknown';
   const active=selection===id||attention===id;
   color.setHex(colors[state]||colors.unknown);
   signal.material.color.copy(color).multiplyScalar(state==='unknown'?.38:.76);
   signal.material.emissive.copy(color).multiplyScalar(active?.55:.33);
   signal.scale.setScalar(active?1.5:1);
   contour.material.color.copy(color);contour.material.opacity=active?.72:.17;
   contour.scale.setScalar(active?2.01:1.29);
  }
  for(const {from,to,fiber,sheath,pulse} of fibers){
   const {alerted,active,state,color}=lineState(from,to);
   fiber.material.color.setHex(color);fiber.material.opacity=alerted?.85:active?.74:state==='unknown'?.22:.53;
   for(const line of sheath){line.material.color.setHex(color);line.material.opacity=active||alerted?.39:.18;}
   pulse.material.color.setHex(color);
   pulse.visible=!reduced.matches&&(alerted||active||state==='online'||state==='running');
  }
 }
 function paintSurface(now){
  if(!renderer||surface!==canvas){drawFlat();return;}
  const time=reduced.matches?0:now/1000;
  if(needsPaint)syncColors();
  needsPaint=false;
  soma.rotation.set(.2+time*.19,time*.29,.11);
  somaMesh.material.emissiveIntensity=.52+Math.sin(time*1.45)*.15;
  for(const [index,{from,to,path,pulse}] of fibers.entries()){
   if(!pulse.visible)continue;
   const reverse=to===attention;
   const progress=(time*(lineState(from,to).alerted?.21:.34)+index*.191)%1;
   path.getPoint(.08+.84*(reverse?1-progress:progress),pulse.position);
  }
  renderer.render(scene,camera);
 }
 function draw(now){
  frame=0;
  if(!shown)return;
  if(!renderer||surface!==canvas){reportMode('unavailable');return;}
  const repaint=needsPaint||reduced.matches||now-last>=31;
  if(reduced.matches)reportMode('reduced-motion');else observeFrame(now,repaint);
  if(repaint){last=now;paintSurface(now);}
  if(!reduced.matches)request();
 }
 function request(){if(shown&&!frame)frame=requestAnimationFrame(draw);}
 function resize(){
  width=widget.clientWidth;height=widget.clientHeight;
  if(!width||!height)return;
  stretch=Math.min(1.33,Math.max(.86,width/(height*1.78)));
  scale=Math.max(1,Math.min((width-58)/(10.55*stretch),(height-45)/5.54));
  root.scale.x=stretch;soma.scale.x=1/stretch;
  for(const {group} of points.values())group.scale.x=1/stretch;
  camera.left=-width/(2*scale);camera.right=-camera.left;
  camera.top=height/(2*scale);camera.bottom=-camera.top;
  camera.updateProjectionMatrix();
  for(const [id,position] of positions){
   const [x,y]=project(position),label=labels.get(id);
   label.style.setProperty('--neuron-x',x+'px');
   label.style.setProperty('--neuron-y',y+'px');
   if(id==='nova')label.style.setProperty('--neuron-radius',scale*.48+'px');
  }
  const ratio=Math.min(devicePixelRatio,1.5);
  if(surface===canvas&&renderer){
   renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
  }else if(context){
   surface.width=Math.round(width*ratio);surface.height=Math.round(height*ratio);
   context.setTransform(ratio,0,0,ratio,0,0);
  }
  // Resizing clears the framebuffer even when native frame callbacks are suspended.
  needsPaint=true;paintSurface(last);request();
 }
 const watcher=new ResizeObserver(resize);watcher.observe(widget);
 const changeMotion=()=>{needsPaint=true;if(width&&height)paintSurface(last);request();};
 const contextLost=()=>{fallback();resize();};
 reduced.addEventListener('change',changeMotion);canvas.addEventListener('webglcontextlost',contextLost,{once:true});
 return {
  update(items,selected,tone,focus){
   states=new Map(items.map(({id,state})=>[id,state]));selection=selected;overall=tone;attention=focus;
   needsPaint=true;if(width&&height)paintSurface(last);request();
  },
  visibility(value){
   if(shown===value)return;
   shown=value;
   if(value)resize();else{cancelAnimationFrame(frame);frame=0;reportMode('paused');}
  },
  close(){
   shown=false;cancelAnimationFrame(frame);watcher.disconnect();
   reduced.removeEventListener('change',changeMotion);canvas.removeEventListener('webglcontextlost',contextLost);
   const geometries=new Set(),materials=new Set();
   scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});
   for(const geometry of geometries)geometry.dispose();
   for(const material of materials)material.dispose();
   renderer?.dispose();
  },
 };
}
