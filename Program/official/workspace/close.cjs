'use strict';
const crypto=require('node:crypto');
// Flush the current renderer before releasing its canvas. A late reply from a
// previous page or close attempt must never authorize destruction of this one.
function createCanvasClose({contents,broadcast,timeoutMs=15000}){
 const guarded=new Set(),unavailable=new Set();let pending=null;
 function register(sender,enabled){if(enabled){guarded.add(sender.id);unavailable.delete(sender.id);}else guarded.delete(sender.id);return {ok:true};}
 function invalidate(sender){
  guarded.delete(sender);unavailable.add(sender);
  if(pending?.sender===sender){const old=pending;pending=null;clearTimeout(old.timer);old.reject(Error('画布页面已中断，最后编辑的保存结果尚未确认，请恢复页面后核对。'));}
 }
 function acknowledge(sender,p){
  if(!pending||sender.id!==pending.sender||p.id!==pending.id)throw Error('画布保存回执已过期');
  const current=pending;pending=null;clearTimeout(current.timer);
  if(p.ok===true)current.resolve({ok:true});else current.reject(Error('画布或草稿尚未保存，页面已保留。'));
  return {ok:true};
 }
 function prepare(){
  if(pending)return pending.promise;
  const wc=contents();if(!wc||wc.isDestroyed())return Promise.resolve({ok:true});
  if(wc.isCrashed?.()||unavailable.has(wc.id))return Promise.reject(Error('画布页面已停止响应或正在恢复，尚无法确认最后编辑已保存。'));
  if(!guarded.has(wc.id))return Promise.resolve({ok:true});
  const id=crypto.randomUUID();let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const timer=setTimeout(()=>{if(pending?.id!==id)return;pending=null;reject(Error('画布保存未确认，页面已保留，请重试。'));},timeoutMs);
  pending={id,sender:wc.id,promise,resolve,reject,timer};
  try{broadcast('aieyra:window:save-drafts',{id});}catch(error){clearTimeout(timer);pending=null;reject(error);}
  return promise;
 }
 return {register,acknowledge,prepare,invalidate,preparing:sender=>pending?.sender===sender};
}
module.exports={createCanvasClose};
