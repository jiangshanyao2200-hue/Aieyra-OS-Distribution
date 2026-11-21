// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createProgramDrafts
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/program-drafts.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {randomUUID}=require('node:crypto');

// Only the current registered program page can confirm its own durable drafts.
// This gate runs before page retirement and before the owner's normal shutdown.
function createProgramDrafts({contents,timeoutMs=15000}){
 let pending=null;
 function prepare(){
  if(pending)return pending.promise;
  const wc=contents();if(!wc||wc.isDestroyed())return Promise.resolve();
  if(wc.isCrashed?.())return Promise.reject(Error('项目页面已停止响应，编辑草稿保存尚未确认。'));
  const id=randomUUID();let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const timer=setTimeout(()=>{if(pending?.id!==id)return;pending=null;reject(Error('编辑草稿保存尚未确认，页面已保留，请重试。'));},timeoutMs);
  pending={id,wc,promise,resolve,reject,timer};
  try{wc.send('plugin:event',{type:'prepare-drafts',id});}catch(error){clearTimeout(timer);pending=null;reject(error);}
  return promise;
 }
 function acknowledge(wc,p){
  if(!pending||pending.wc!==wc||contents()!==wc||p.id!==pending.id)throw Error('编辑草稿保存回执已过期');
  const own=pending;pending=null;clearTimeout(own.timer);
  if(p.ok===true)own.resolve();else own.reject(Error('编辑草稿尚未保存，页面已保留。'));
  return {ok:true};
 }
 return {prepare,acknowledge,preparing:wc=>pending?.wc===wc};
}
module.exports={createProgramDrafts};
