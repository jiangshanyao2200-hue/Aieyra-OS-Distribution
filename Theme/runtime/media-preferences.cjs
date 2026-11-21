// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ROLE_TARGETS; TARGETS; mediaValue; mediaPatch; MIN_SECONDS; ID; interval; selection; preferences
// Impact: python -B scripts/code-atlas.py show Theme/runtime/media-preferences.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Optional, versioned profile fields. A missing preference leaves old profiles unchanged.
const ROLE_TARGETS=Object.freeze({cotaAvatar:'execution',vayaAvatar:'project'});
const TARGETS=Object.freeze(['avatar','eyraAvatar','background',...Object.keys(ROLE_TARGETS)]);
const mediaValue=(profile,target)=>ROLE_TARGETS[target]?profile.roles?.[ROLE_TARGETS[target]]?.avatar||'':profile[target]||'';
const mediaPatch=(target,value)=>ROLE_TARGETS[target]?{roles:{[ROLE_TARGETS[target]]:{avatar:value}}}:{[target]:value};
const MIN_SECONDS=60,MAX_SECONDS=604800,DEFAULT_SECONDS=900;
const ID=/^[a-z][a-z0-9_-]{0,47}\.[a-z][a-z0-9_-]{0,63}$/,DIGEST=/^[a-f0-9]{64}$/;
function interval(value=DEFAULT_SECONDS){
 if(!Number.isSafeInteger(value)||value<MIN_SECONDS||value>MAX_SECONDS)throw Error('随机时间须为 1 分钟至 7 天');
 return value;
}
function selection(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('图像模式无效');
 if(Object.keys(value).some(k=>!['mode','intervalSeconds','nextAt','id','digest'].includes(k)))throw Error('未知图像模式字段');
 const mode=value.mode??'custom';
 if(!['custom','theme','random','off'].includes(mode))throw Error('图像模式无效');
 const seconds=interval(value.intervalSeconds),nextAt=value.nextAt??0,id=value.id||'',digest=value.digest||'';
 if(!Number.isSafeInteger(nextAt)||nextAt<0)throw Error('随机时间无效');
 if(id&&!ID.test(id)||digest&&!DIGEST.test(digest)||!!id!==!!digest)throw Error('主题资源标识无效');
 return {mode,intervalSeconds:seconds,nextAt:mode==='random'?nextAt:0,id,digest};
}
function preferences(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('图像随机设置无效');
 if(Object.keys(value).some(k=>!TARGETS.includes(k)))throw Error('未知图像设置对象');
 return Object.fromEntries(Object.entries(value).map(([key,row])=>[key,selection(row)]));
}
module.exports={TARGETS,ROLE_TARGETS,mediaValue,mediaPatch,MIN_SECONDS,MAX_SECONDS,DEFAULT_SECONDS,ID,DIGEST,interval,selection,preferences};
