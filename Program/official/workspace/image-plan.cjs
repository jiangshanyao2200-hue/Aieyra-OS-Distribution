'use strict';
const {validateSingleImagePrompts}=require('./desktop/images/image-prompt-contract.cjs');
const {resolveImageQuality,validateImage25Size}=require('./shared/image-model-settings.mjs');
const ratios=new Set(['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9','9:21','4:5']);
const presets={'720P':[1280,1024],'1080P':[1920,1088],'2K':[2048,2048],'4K':[3840,2880]};
// Same delivery geometry as the original manual image panel. Explicit pixels
// take precedence; unsupported provider sizes/quality fail without downgrading.
function imageFrame(input){
 const ratio=input.ratio||'1:1',resolution=String(input.resolution||'1080P').toUpperCase();
 if(!ratios.has(ratio)||!presets[resolution])throw Error('图片比例或分辨率档位无效');
 const [w,h]=ratio.split(':').map(Number),[long,square]=presets[resolution],round=n=>Math.max(512,Math.round(n/16)*16);
 const size=input.size||(w===h?`${square}x${square}`:w>h?`${round(long)}x${round(long*h/w)}`:`${round(long*w/h)}x${round(long)}`);
 return {ratio,resolution,size:validateImage25Size(input.model,size),quality:resolveImageQuality(input.model,input.quality,'high')};
}
function normalizeImageInput(value){
 const input=structuredClone(value||{}),operation=input.operation||'generate';
 if(!['generate','edit','replace','variants'].includes(operation))throw Error('该操作在 Workspace 2.0.39 的公开图片工具中已停用');
 if(!String(input.prompt||'').trim())throw Error('图片任务需要完整提示词');
 if(input.generationMode!==undefined&&!['parallel','sequential'].includes(input.generationMode))throw Error('图片生成方式无效');
 if(input.count!==undefined&&(!Number.isInteger(input.count)||input.count<1||input.count>10))throw Error('单次图片任务需要 1–10 张；更多图片使用 images.batch');
 if(input.assetIndex!==undefined&&(!Number.isInteger(input.assetIndex)||input.assetIndex<0))throw Error('来源图片序号必须从0开始');
 const items=input.items;
 if(items!==undefined){
  if(!Array.isArray(items)||items.length<2||items.length>10||items.some(i=>!i||!String(i.prompt||'').trim()))throw Error('不同方案需要 2–10 项完整提示词');
  if(input.count!==undefined&&input.count!==items.length)throw Error('图片张数必须与方案数一致');
  input.count=items.length;
 }
 if(operation==='variants'&&(!items||items.length<2))throw Error('多款创作需要逐项填写不同方案');
 validateSingleImagePrompts(input);
 const normalized={...input,operation,...imageFrame(input)};
 if(items)normalized.items=items.map(item=>({...item,...imageFrame({...input,...item}),prompt:item.prompt.trim()===input.prompt.trim()?item.prompt:`${input.prompt}\n${item.prompt}`}));
 return normalized;
}
function imageBatchPlan(input,args){
 const {count=1,items,generationMode='parallel',...single}=input;
 if(count===1)return null;
 return {input:{...single,operation:single.operation==='variants'?'edit':single.operation},count,concurrency:generationMode==='sequential'?1:3,generationMode,variants:items||[],title:args.title,...(args.goalId?{goalId:args.goalId,goalRevision:args.goalRevision}:{})};
}
module.exports={imageFrame,normalizeImageInput,imageBatchPlan};
