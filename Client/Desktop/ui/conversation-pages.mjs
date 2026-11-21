// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createConversationPager
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/conversation-pages.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Pages contain the public conversation selected by chatRounds. Raw model
// context, including compaction and tools, is observed independently by Core.
export function createConversationPager({pageSize=20}={}){
 let scope=null,rows=[],start=0,expanded=false;
 function pageStart(end){
  let users=0;
  for(let i=end-1;i>=0;i--)if(rows[i].from==='user'&&++users===pageSize)return i;
  return 0;
 }
 const view=reset=>({entries:rows.slice(start),hasMore:start>0,reset});
 return {
  update(entries,identity,{reading=false}={}){
   const changed=scope!==identity,previous=rows[start]?.id;
   rows=entries;
   const retained=changed?-1:rows.findIndex(e=>e.id===previous);
   if(!changed&&(expanded||reading)&&retained>=0)start=retained;
   else{start=pageStart(rows.length);expanded=false;}
   scope=identity;
   // A disappearing progress paragraph is not a session change and must not
   // turn following back on while the user is reading older conversation.
   return view(changed);
  },
  more(){start=pageStart(start);expanded=true;return view(false);},
  clear(){scope=null;rows=[];start=0;expanded=false;},
 };
}
