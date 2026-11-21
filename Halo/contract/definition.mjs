// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: STATES; object; number; optional; color; validateHalo; validateSelection
// Impact: python -B scripts/code-atlas.py show Halo/contract/definition.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Declarative geometry and motion. No author HTML, CSS, URLs or executable code.
export const STATES=['boot','connecting','compacting','offline','thinking','body','tool','preparing','waiting','queued','confirming','idle','cancelling','waiting_user','error'];
const object=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('光圈字段无效');};
const number=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('光圈数值超出范围');};
const optional=(v,min,max)=>{if(v!==undefined)number(v,min,max);};
const color=v=>v===undefined||typeof v==='string'&&(v==='none'||v==='currentColor'||/^#[\da-fA-F]{6}$/.test(v));
export function validateHalo(value){
 object(value,['schema','preset','layers']);
 if(value.schema!=='aieyra.halo/1')throw Error('不支持的光圈契约');
 if(value.preset!==undefined){if(value.preset!=='classic'||value.layers!==undefined)throw Error('无效官方光圈');return value;}
 if(!Array.isArray(value.layers)||value.layers.length<1||value.layers.length>24)throw Error('光圈需要 1–24 个图层');
 const ids=new Set();
 for(const layer of value.layers){
  object(layer,['id','shape','cx','cy','rx','ry','points','stroke','fill','width','opacity','states','motion']);
  if(typeof layer.id!=='string'||!/^\w{1,32}$/.test(layer.id)||ids.has(layer.id))throw Error('光圈图层标识无效');ids.add(layer.id);
  if(layer.shape==='ellipse'){
   for(const k of ['cx','cy'])number(layer[k],0,100);
   for(const k of ['rx','ry'])number(layer[k],.1,50);
   if(layer.points!==undefined)throw Error('椭圆不能包含点列');
  }else if(['polygon','polyline'].includes(layer.shape)){
   if(['cx','cy','rx','ry'].some(k=>layer[k]!==undefined)||!Array.isArray(layer.points)||layer.points.length<(layer.shape==='polygon'?3:2)||layer.points.length>64)throw Error('光圈点列无效');
   for(const point of layer.points){if(!Array.isArray(point)||point.length!==2)throw Error('光圈坐标无效');point.forEach(n=>number(n,0,100));}
  }else throw Error('不支持的光圈图形');
  for(const key of ['stroke','fill'])if(!color(layer[key]))throw Error('光圈颜色无效');
  optional(layer.width,.1,10);optional(layer.opacity,0,1);
  if(layer.states!==undefined&&(!Array.isArray(layer.states)||!layer.states.length||layer.states.length>STATES.length||new Set(layer.states).size!==layer.states.length||layer.states.some(s=>!STATES.includes(s))))throw Error('光圈状态无效');
  if(layer.motion!==undefined){
   const motion=layer.motion;object(motion,['duration','easing','frames']);number(motion.duration,600,60000);
   if(!['linear','ease-in-out'].includes(motion.easing))throw Error('光圈动画缓动无效');
   if(!Array.isArray(motion.frames)||motion.frames.length<2||motion.frames.length>16)throw Error('光圈动画帧数无效');
   let previous=-1;
   for(const frame of motion.frames){
    object(frame,['offset','rotate','scale','x','y','opacity']);number(frame.offset,0,1);
    if(frame.offset<=previous)throw Error('光圈动画帧顺序无效');previous=frame.offset;
    optional(frame.rotate,-720,720);optional(frame.scale,.1,2);optional(frame.x,-50,50);optional(frame.y,-50,50);optional(frame.opacity,0,1);
   }
   if(motion.frames[0].offset!==0||motion.frames.at(-1).offset!==1)throw Error('光圈动画须含首尾帧');
  }
 }
 if(JSON.stringify(value).length>65536)throw Error('光圈定义过大');
 return value;
}
export function validateSelection(value){
 if(value===null)return null;
 object(value,['id','digest','version','name','definition']);
 if(typeof value.id!=='string'||!/^[a-z][a-z0-9_-]{0,47}(?:\.[a-z][a-z0-9_-]{0,63})+$/.test(value.id)||value.id.length>200||typeof value.version!=='string'||!/^\d+\.\d+\.\d+$/.test(value.version)||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)||typeof value.name!=='string'||!value.name||value.name.length>160)throw Error('光圈包身份无效');
 validateHalo(value.definition);return structuredClone(value);
}
