// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createSharedDraftPersistence
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/shared-draft.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Two views of a program share the existing host composer store. A save carries
// the version the editor read; a stale editor keeps its text instead of winning.
/** @param {(p:{revision:string,draft:any})=>Promise<any>} save
 * @param {{onError?:(error:Error)=>void,delay?:number}} options */
export function createSharedDraftPersistence(save,{onError=()=>{},delay=250}={}){
 let revision='',pending=null,timer=null,tail=Promise.resolve(),queued=0,edit=0,last='';
 const flush=()=>{
  clearTimeout(timer);timer=null;
  if(!pending)return tail;
  const draft=pending,version=edit;pending=null;queued++;
  const result=tail.catch(()=>{}).then(async()=>{
   try{const value=await save({revision,draft});if(value?.ok===false)throw Error(value.error);revision=value.revision;last=JSON.stringify(draft);}
   catch(error){if(!pending&&version===edit)pending=draft;throw error;}
   finally{queued--;}
  });tail=result;return result;
 };
 return {
  initialize(value){revision=value.revision;last=JSON.stringify(value.draft);},
  accept(value){if(queued||pending||revision===value.revision)return false;revision=value.revision;last=JSON.stringify(value.draft);return true;},
  schedule(draft){if(JSON.stringify(draft)===last&&!pending&&!queued)return;pending=structuredClone(draft);edit++;clearTimeout(timer);timer=setTimeout(()=>void flush().catch(onError),delay);},
  flush,async drain(){for(;;){const p=flush();await p;if(!pending&&tail===p)return;}},
  get busy(){return queued>0||!!pending;},
 };
}
