// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: GATEWAY; SLOTS; gateway; isAieyra; slot; matches; find; persist; draft; cache; disconnectOfficialAccount
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/user-connections.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Human settings own one slot per source. Agent connections retain independent IDs.
const GATEWAY=require('../../../Contracts/official-services.json').gateway;
const SLOTS=['aieyra','deepseek','opencode','opencode-go','openrouter','bailian','custom'];
const gateway=GATEWAY.replace(/\/+$/,'');
const isAieyra=c=>c?.user_slot==='aieyra'||/^user-aieyra(?:-\d+)?$/.test(c?.id||'')||
 String(c?.base_url||'').replace(/\/+$/,'')===gateway;
function slot(value){if(!SLOTS.includes(value))throw Error('未知连接来源');return value;}
function matches(c,id){return id==='aieyra'?c.base_url===GATEWAY:id==='custom'?c.provider==='custom'&&c.base_url!==GATEWAY:c.provider===id;}
function find(s,id){
 slot(id);const saved=s.user_connections?.[id];
 return s.provider_connections.find(c=>c.id===saved&&matches(c,id))||s.provider_connections.find(c=>c.id===s.api_profiles.find(p=>p.id===s.active_profile)?.connection_id&&matches(c,id))||s.provider_connections.find(c=>matches(c,id));
}
function persist(file,change){
 const cfg=require('./config.cjs'),loaded=cfg.load(file),next=change(require('./model-pool.cjs').migrate(loaded.settings));
 if(next)cfg.save(file,next,loaded.version);
}
function draft(s,id){slot(id);return s.user_connection_drafts?.[id]||find(s,id);}
function cache(file,id,value){persist(file,s=>({...s,user_connection_drafts:{...s.user_connection_drafts,[slot(id)]:{base_url:value.base_url,api_key:value.api_key,model:value.model||'',updated_at:new Date().toISOString()}}}));}
function disconnectOfficialAccount(s){
 const connections=new Set(s.provider_connections.filter(isAieyra).map(c=>c.id));
 const removed=new Set(s.api_profiles.filter(p=>connections.has(p.connection_id)||isAieyra(p)).map(p=>p.id));
 const active=removed.has(s.active_profile)||Boolean(s.api_key&&isAieyra(s));
 if(!connections.size&&!removed.size&&!active&&!s.user_connections?.aieyra&&!s.user_connection_drafts?.aieyra&&
    !Object.keys(s.official_account||{}).length&&!Object.keys(s.aieyra_key_drafts||{}).length)return;
 s.provider_connections=s.provider_connections.filter(c=>!connections.has(c.id));
 s.api_profiles=s.api_profiles.filter(p=>!removed.has(p.id));
 if(removed.has(s.matrix_profile))s.matrix_profile='';
 if(active){s.active_profile='';s.model='';}
 if(s.user_connections)delete s.user_connections.aieyra;
 if(s.user_connection_drafts)delete s.user_connection_drafts.aieyra;
 s.official_account={};
 s.aieyra_key_drafts={};
 return require('./model-pool.cjs').synchronize(s);
}
module.exports={GATEWAY,SLOTS,slot,matches,find,persist,draft,cache,isAieyra,disconnectOfficialAccount};
