// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupStageTools
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/stage-tools.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Host adapters inject authorized scope and shared motion into tool-owned views.
import {setupImageView} from '../../../Tool/base/official/view_image/presentation/desktop.mjs';
import {setupSearchView} from '../../../Tool/base/official/web_search/presentation/desktop.mjs';
import {activityOutcome} from './activity.mjs';
import {motionAllowed} from './motion.mjs';
export function setupStageTools({api,doc=document,make,reduced,role:roleName='matrix'}){
 function scopeOf(snapshot){const role=snapshot?.roles?.find(r=>r.role===roleName);return role?.id&&role.generation>0?{task_id:snapshot.session_id,agent_id:role.id,generation:role.generation}:null;}
 const image=setupImageView({load:p=>api.toolImage(p),scopeOf,doc,make,activityOutcome});
 const search=setupSearchView({doc,make,reduced,motionAllowed,activityOutcome});
 return {fillImage:image.fill,fillSearch(p,items,snapshot){const scope=scopeOf(snapshot);search.fill(p,items,JSON.stringify([snapshot?.core_epoch,snapshot?.session_id,scope?.agent_id,scope?.generation]));},suspend(p){image.suspend(p);search.suspend(p);},close(p){image.close(p);search.close(p);}};
}
