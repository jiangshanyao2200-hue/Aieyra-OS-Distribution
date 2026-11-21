// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: memberAvatars
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/member-avatars.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Avatar bytes are fetched once per revision, separately from frequent work
// snapshots. Failed reads retry slowly and never replace a newer revision.
export function memberAvatars(read,onChange=()=>{}){
 const cache=new Map();let closed=false;
 return {
  get(member){
   const id=member.id,revision=member.avatar_rev||0;if(!id||!revision)return '';
   let entry=cache.get(id);
   if(entry?.revision===revision&&(entry.pending||entry.retryAt>Date.now()||entry.ready))return entry.avatar||'';
   entry={revision,avatar:entry?.avatar||'',pending:true};cache.set(id,entry);
   Promise.resolve().then(()=>read(member)).then(value=>{
    if(closed||cache.get(id)!==entry)return;
    if(value?.ok===false)throw Error(value.error||'头像读取失败');
    entry.avatar=value?.avatar||'';entry.ready=true;entry.pending=false;onChange();
   }).catch(()=>{if(!closed&&cache.get(id)===entry){entry.pending=false;entry.retryAt=Date.now()+5000;}});
   return entry.avatar;
  },
  clear(){cache.clear();},
  close(){closed=true;cache.clear();}
 };
}
