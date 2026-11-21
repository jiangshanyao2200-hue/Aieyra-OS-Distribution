// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: subscribeSettingsUpdates
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/settings-sync.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Apply only committed settings to an existing workspace. Each read finishes
// before the next batch, so an older response cannot replace a newer save.
export function subscribeSettingsUpdates(api,{profile=()=>{},appearance=()=>{},connection=()=>{},onError=()=>{},doc=globalThis.document}={}){
  let closed=false,running=false;const pending=new Set();
  const checked=r=>{if(r?.ok===false)throw Error(r.error||(r.errors||[]).join('\n')||'设置暂时无法更新');return r;};
  async function flush(){
    if(running||closed)return;running=true;
    try{
      while(pending.size&&!closed){
        const batch=new Set(pending);pending.clear();
        for(const kind of batch){
          if(closed)break;
          try{
            if(kind==='profile'){const r=checked(await api.profile());if(!closed){profile(r.profile);await api.settingsObserved?.({scope:kind,version:r.profile.version});}}
            if(kind==='appearance'){const r=checked(await api.appearance({action:'os_appearance_read'}));if(!closed){appearance(r);await api.settingsObserved?.({scope:kind,version:r.version});}}
            if(kind==='connection'&&!closed)await connection();
          }catch(error){if(!closed)onError(error.message);}
        }
      }
    }finally{running=false;}
  }
  const stop=api.onSettingsChanged?.(event=>{
    const kind={saveProfile:'profile',appearance:'appearance',onboard:'connection'}[event?.method];
    if(kind&&!closed){pending.add(kind);void flush();}
  });
  // A hidden home renderer may resume after a save notification. Read the
  // committed profile again on return, through the same ordered reader.
  const returned=event=>{if(['','home'].includes(event.detail?.id)&&!closed){pending.add('profile');void flush();}};
  doc?.addEventListener('workspace-view-change',returned);
  return ()=>{closed=true;pending.clear();stop?.();doc?.removeEventListener('workspace-view-change',returned);};
}
