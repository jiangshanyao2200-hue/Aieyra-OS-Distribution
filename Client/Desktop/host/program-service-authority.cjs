// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: program
// Regions: createProgramServiceAuthority
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/program-service-authority.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

// Only Core's registered, currently running program instance may use its own
// durable identity at the desktop service. Names and model arguments confer no
// authority; each call re-reads the public binding without creating a session.
function createProgramServiceAuthority(conversation){
 return async session=>{
  if(typeof session!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(session))return false;
  const rows=await conversation({action:'programs'});
  const running=row=>row?.id===session&&row.state==='running'&&!row.deletion_pending;
  return Array.isArray(rows)&&rows.some(row=>row.program&&!row.deleted&&(running(row.program_session)||row.sessions?.some(running)));
 };
}
module.exports={createProgramServiceAuthority};
