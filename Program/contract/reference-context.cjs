// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: validateProgramContext
// Impact: python -B scripts/code-atlas.py show Program/contract/reference-context.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Shared draft metadata is data, never an instruction or a caller identity.
function validateProgramContext(value){
 if(value==null)return null;
 if(value.program!=='workspace'||!Array.isArray(value.references)||value.references.length>40)throw Error('画布引用记录无效');
 const ids=new Set();
 const text=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\x00-\x1f]/.test(s);
 const references=value.references.map(r=>{
  if(!r||!text(r.id,160)||!text(r.sourceProjectId,160)||!text(r.title,1000)||!Array.isArray(r.sourceNodeIds)||!r.sourceNodeIds.length||r.sourceNodeIds.length>40||!r.sourceNodeIds.every(id=>text(id,160))||!/^[a-f0-9]{64}$/.test(r.signature)||!Number.isSafeInteger(r.revision)||r.revision<0)throw Error('画布引用版本不完整，请重新选择');
  const key=r.sourceProjectId+'/'+r.id;if(ids.has(key))throw Error('画布引用重复');ids.add(key);
  return {id:r.id,sourceProjectId:r.sourceProjectId,sourceProjectName:String(r.sourceProjectName||'').slice(0,200),sourceNodeIds:[...new Set(r.sourceNodeIds)],title:r.title,signature:r.signature,revision:r.revision,count:new Set(r.sourceNodeIds).size};
 });
 if(references.reduce((n,r)=>n+r.count,0)>40)throw Error('一次最多引用 40 个画布对象');
 return references.length?{program:'workspace',references}:null;
}
module.exports={validateProgramContext};
