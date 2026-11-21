// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: pool; stable; comparable; dirty
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/settings-draft.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 比较真实保存数据，筛选/目录选择/浏览供应商不计修改；无效输入仍须保留并提示。
const pool=require('./model-pool.cjs');
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
function comparable(input,providers){
 let s=pool.editDraft(providers.capture(structuredClone(input)));
 const referenced=new Set(s.api_profiles.map(p=>p.connection_id));
 s.provider_connections=s.provider_connections.filter(c=>referenced.has(c.id)||c.api_key||c.api_key_history?.length).map(c=>({...c,api_key_history:[...c.api_key_history||[]].sort()})).sort((a,b)=>a.id.localeCompare(b.id));
 s=pool.synchronize(s);
 for(const k of Object.keys(s))if(k.startsWith('__')||k==='selected_provider')delete s[k];
 s.api_key_history=[...s.api_key_history||[]].sort();
 return JSON.stringify(stable(s));
}
function dirty(settings,baseline,providers){try{return comparable(settings,providers)!==comparable(baseline,providers);}catch{return true;}}
module.exports={dirty};
