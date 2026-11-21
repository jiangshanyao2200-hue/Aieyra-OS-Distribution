// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createDraftPersistence
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/draft-persistence.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// One persistent main composer per work directory; per-task drafts continue to
// use sessionStorage. Never submit restored text or overwrite a newer edit.
export function createDraftPersistence(save,{onError=()=>{},delay=250}={}){
 let token='',sequence=0,pending=null,timer=null,tail=Promise.resolve(),queued=0,last='',failed=false,unavailable='',enabled=true;
 const flush=()=>{
  clearTimeout(timer);timer=null;
  if(!pending)return tail;
  if(!token){failed=true;return Promise.reject(Error(unavailable||'本地草稿尚未就绪，当前输入已保留。'));}
  const draft=pending;pending=null;queued++;
  const body={token,sequence:++sequence,draft},serialized=JSON.stringify(draft);
  const result=tail.catch(()=>{}).then(async()=>{
   try {const r=await save(body);if(r?.ok===false||r?.stale)throw Error(r?.error||'草稿保存身份已变化，当前输入已保留。');last=serialized;failed=false;}
   catch(error){if(!pending&&sequence===body.sequence)pending=draft;failed=true;throw error;}
   finally{queued--;}
  });
  tail=result;return result;
 };
 return {
  initialize(value,error=''){enabled=!!value||!!error;token=value?.token||'';unavailable=error;sequence=0;last=JSON.stringify(value?.draft||{value:'',pastes:'',attachments:[]});},
  schedule(draft){if(!enabled)return;const serialized=JSON.stringify(draft);if(serialized===last&&!pending&&!queued&&!failed)return;pending=structuredClone(draft);clearTimeout(timer);timer=setTimeout(()=>{void flush().catch(onError);},delay);},
  flush,
  async drain(){for(;;){const current=flush();await current;if(!pending&&tail===current)return;}},
 };
}
