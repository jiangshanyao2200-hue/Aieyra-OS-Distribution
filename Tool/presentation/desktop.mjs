// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: packageID; parse; object; display; states; packageReceipt; renderPackageDigest
// Impact: python -B scripts/code-atlas.py show Tool/presentation/desktop.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {renderWorkflowDigest} from '../workbox/presentation/desktop.mjs';
import {renderToolValue} from './value.mjs';
import {resultFrame} from './frame.mjs';
// Trusted declarative renderer for aieyra.tool-view/1. The package supplies
// labels and column keys; only actual receipt values become DOM text.
const packageID=/^mod:[a-z][a-z0-9_-]{0,47}(?:\.[a-z][a-z0-9_-]{0,63})+@[a-f0-9]{64}$/;
const parse=value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const display=value=>typeof value==='string'?value:JSON.stringify(value,null,2)??'';
const states={queued:'等待执行',running:'执行中',starting:'正在启动',completed:'已完成',failed:'未成功',cancelled:'已取消',timed_out:'已超时',interrupted_unknown:'执行结果尚未确认',interrupted:'已中断',persistence_failed:'结果保存失败'};

export function packageReceipt(item){
 const receipt=parse(item.preview);
 if(!object(receipt)||!packageID.test(receipt.package||''))return null;
 return receipt;
}

export function renderPackageDigest(doc,item,{present}={}){
 const receipt=packageReceipt(item);if(!receipt)return null;
 const workflow=renderWorkflowDigest(doc,receipt,{present});if(workflow)return workflow;
 const view=receipt.presentation||item.presentation,execution=parse(receipt.data),data=object(execution)?execution:{};
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const root=make('div','tool-digest package-tool-digest'),state=item.state||data.state||receipt.state||'';
 root.dataset.state=state;root.dataset.package=receipt.package;root.dataset.view=view?.kind||'text';
 const frame=resultFrame(doc,root,present);
 frame.summary.append(make('p','digest-lead',view?.title||item.description||'工具结果'));
 frame.summary.append(make('p','digest-note',states[state]||state));
 const error=receipt.error||data.error;
 if(error)frame.summary.append(make('p','digest-error',object(error)?error.message||display(error):String(error)));
 const text=value=>frame.content.append(make('pre','digest-text',display(value)));
 const blocks=Array.isArray(data.output)?data.output:[];
 for(const block of blocks){
  if(block.type!=='text'){text(block);continue;}
  const value=parse(block.text);
  if(view?.kind==='table'&&Array.isArray(value)&&Array.isArray(view.columns)&&view.columns.length){
   frame.content.append(renderToolValue(doc,value,{columns:view.columns}));
  }else if(object(value)){
   const list=make('dl','digest-facts package-tool-cards');
   for(const [key,val] of Object.entries(value)){const box=make('div');box.append(make('dt','',key),make('dd','',display(val)));list.append(box);}
   if(view?.kind==='table'){const extra=make('details','digest-section package-tool-extra');extra.append(make('summary','','附加输出'),list);frame.content.append(extra);}else frame.content.append(list);
  }else text(block.text??block);
 }
 if(!blocks.length&&receipt.output)text(receipt.output);
 if(receipt.preview_truncated)frame.content.append(make('p','digest-note','此处为部分预览；完整输出保留在历史回执。'));
 if(data.has_more)frame.content.append(make('p','digest-note','还有输出待读取。'));
 if(!blocks.length&&!receipt.output&&!error)frame.content.append(make('p','digest-note',['running','starting','queued'].includes(state)?'等待工具输出…':'本次没有输出。'));
 // Keep the complete receipt available for fields not selected by a table,
 // mixed/image output, malformed data and bounded activity preview notices.
 const raw=make('details','digest-section'),summary=make('summary','','预览记录');raw.dataset.detail='record';raw.append(summary,make('pre','digest-text',display(receipt)));frame.details.append(raw);
 return frame.finish();
}
