// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: program
// Regions: setupProgramAgentWindow
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/program-agent-window.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupProgramAgentSurface} from './program-agent-surface.mjs';
import {createContactStore} from './contacts.mjs';
import {setupSessionStatus,setupStatusIndicators} from './session-status.mjs';
import {usageSummary} from './status.mjs';
import {setupDockAgents} from './dock-agents.mjs';
import {paintProgramStatus} from './program-icons.mjs';
import {setupAccountStatus} from './account.mjs';

export async function setupProgramAgentWindow(api,state,notice){
 if(!state.kind||['home','conversation','agent','tool','document'].includes(state.kind))return ()=>{};
 const mark=document.querySelector('.module-mark');
 const checked=value=>{if(value?.ok===false)throw Error(value.error);return value;};
 const bridge={onFoldedAction:api.onFoldedAction,onSettingsChanged:api.onSettingsChanged,onAccountChanged:window.aieyraTips?.onAccountChanged,profile:api.profile};
 for(const method of ['conversation','conversationAttachment','sessionModel','sessionModelMenu','openModelSettings','builtinRole','onboard','foldedSurface','chatLayerPreference','account'])bridge[method]=args=>api.program({method,args}).then(checked);
 const targets={[state.kind]:mark};
 const navigation={current:state.kind+'-module-view',is(view){return view===this.current;}};
 const indicators=setupStatusIndicators(),status=setupSessionStatus(bridge,navigation,{notice,changed:value=>{
  indicators.update({usage:usageSummary(value.roles||[]),context:value.context,unconfigured:value.configured===false,model:value.model_name||'',title:value.title,scope:value.id,active:(value.roles||[]).some(r=>['running','queued','cancelling'].includes(r.state))});
 }});
 const closeAccount=setupAccountStatus(bridge,{onError:notice});
 status.start();
 const closeStatus=()=>{closeAccount();status.close();indicators.close();};
 if(state.kind==='coding'){
  document.getElementById('session-indicators').hidden=false;
  const indicator=setupDockAgents(bridge,{targets});
  if(mark){
   mark.onclick=()=>void api.program({method:'chat_toggle'}).then(checked).catch(e=>notice(e.message));
   mark.setAttribute('aria-label','展开或折叠 Coding 对话');
  }
  const close=()=>{closeStatus();indicator.close();if(mark)mark.onclick=null;};
  window.addEventListener('pagehide',close,{once:true});
  return close;
 }
 // Resolve before mounting: third-party pages without a binding report the
 // actual registration failure instead of borrowing the home conversation.
 let profile;
 try{
  await bridge.conversation({action:'program',program:state.kind});
  profile=(await api.profile()).profile||{};
 }catch(error){closeStatus();throw error;}
 const store=createContactStore(bridge,{onError:notice});
 const sessionFocus=state.kind==='contacts'?(await api.describe()).session_scope:null;
 const surfaceBridge=state.kind==='contacts'?{...bridge,onSessionFocus:fn=>api.onState?.(s=>fn(s.session_scope))}:bridge;
 const indicator=setupDockAgents(bridge,{targets});
 indicator.connectStore(store);
 const project=event=>{
  const value=event.detail?.program===state.kind?event.detail:null;
  paintProgramStatus(mark,value?.contact,value?.session);
  indicator.program(value);
 };
 document.addEventListener('aieyra:program-agent',project);
 const surface=setupProgramAgentSurface(surfaceBridge,{navigation,profile:()=>profile,sessionFocus,onError:notice});surface.connectStore(store);
 if(mark){mark.onclick=()=>surface.toggle();mark.setAttribute('aria-label','展开或折叠对话');}
 const showStatus=scope=>{const group=scope?.kind==='group';document.getElementById('session-indicators').hidden=group;if(group)status.suspend();else status.resume();};showStatus(sessionFocus);
 const stopScope=state.kind==='contacts'?api.onState?.(s=>showStatus(s.session_scope)):null;
 const close=()=>{document.removeEventListener('aieyra:program-agent',project);indicator.close();stopScope?.();surface.close();store.close();closeStatus();};
 window.addEventListener('pagehide',close,{once:true});
 return close;
}
