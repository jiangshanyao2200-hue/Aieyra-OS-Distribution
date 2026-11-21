// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: profiles; team; byID; toolChoices; promptReferences
// Impact: python -B scripts/code-atlas.py show Agent/official/definitions.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Official source definitions only. No user paths, installs or runtime grants.
const profiles=[require('./Eyra/definition.json'),require('./Vaya/definition.json'),require('./Cota/definition.json')];
const team=require('./Eyra/team/definition.json');
const byID=new Map(profiles.map(p=>[p.id,p]));
function toolChoices(){
 const out={};
 for(const member of team.members){
  const profile=byID.get(member.agent);
  if(!profile)throw Error('Unknown official team member: '+member.agent);
  out[member.tools_setting]=[...profile.tool_choices];
 }
 return out;
}
function promptReferences(){return [...new Set(profiles.flatMap(p=>Object.values(p.prompts)))];}
module.exports={toolChoices,promptReferences};
