// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupWorkParticipants
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/work-participants.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {chatStatus,chatFailureEntry} from './chat-status.mjs';
import {sceneKind} from './model.mjs';
import {setupChatColumn} from './chat-column.mjs';
import {WorkSelection,workingState,workVisible,workNeedsAttention,workText,workPhase} from './work-selection.mjs';

// All work cards are ordinary messages in the history scroller. A hidden card
// owns no execution state; opening the list cannot start or resume an Agent.
export function setupWorkParticipants(root,{getProfile=()=>({}),onInspect=null,fullMessages=false,retryMember=null}={}){
 const doc=root.ownerDocument,selection=new WorkSelection();let rows=[],scope='',expanded=false,closed=false;
 root.classList.add('work-participants');root.dataset.fullMessages=String(fullMessages);root.setAttribute('aria-label','成员工作状态');
 root.addEventListener('aieyra:chat-retry',handleRetry);
 function handleRetry(event){
  const member=rows.find(m=>m.id===event.detail.id&&m.generation===event.detail.generation);
  if(!member||!retryMember)return;
  event.stopPropagation();event.detail.submit=()=>retryMember(member,event.detail.attempt);
 }
 const list=doc.createElement('div'),toggle=doc.createElement('button');
 list.className='work-participant-list';toggle.className='quiet work-participant-toggle';toggle.type='button';
 root.append(list,toggle);const column=setupChatColumn(list,{getProfile});
 function paint(){
  if(closed)return;
  const available=root.closest?.('#conversation,#conversation-scroll,.gv-scroll')?.clientHeight||((doc.defaultView?.innerHeight||1020)-120);
  const limit=Math.max(1,Math.min(6,Math.floor((available*.7-64)/64)));
  const current=selection.select(rows.filter(workVisible),{expanded,limit});
  root.hidden=current.total===0;root.dataset.expanded=String(expanded);root.dataset.crowded=String(!fullMessages&&current.total>1);
  toggle.hidden=current.total<=limit;toggle.textContent=expanded?'收起成员':'查看全部 '+current.total+' 位成员';toggle.setAttribute('aria-expanded',String(expanded));
  const compact=!fullMessages&&current.total>1&&!expanded;
  column.paint(current.items.map(m=>{const failure=fullMessages&&chatFailureEntry(m,scope,m.identity);if(failure)return {...failure,retryable:!!retryMember&&failure.retryable};return {id:'work:'+m.id,from:'eyra',role:m.identity?.role||'conversation',identity:m.identity,streaming:workingState(m.state),subprocess:!compact&&!fullMessages,thought:!compact&&!workNeedsAttention(m)&&m.phase==='thinking',phase:workPhase(m),haloState:workPhase(m),effect:m.effect||(m.activity?.items?.length?sceneKind(m.activity.items.at(-1)):'generic'),text:compact?workText(m,true):'',work:compact?undefined:{key:'work:'+m.id+':'+m.generation,phase:workPhase(m),live:m.live||m,thought:m.thought||m.live?.thought||'',text:m.text||m.live?.text||'',briefs:m.activity?.items||[],status:chatStatus({state:m.state,phase:workPhase(m),activities:m.activity?.items||[],active:workingState(m.state)})}};}));
  if(onInspect)for(const node of list.children){const id=node.dataset.id?.slice(5),member=current.items.find(m=>m.id===id);if(!member||!member.session)continue;
   let button=node.querySelector('.work-participant-inspect');if(!button){button=doc.createElement('button');button.type='button';button.className='quiet work-participant-inspect';button.textContent='查看';node.querySelector('.chat-name').append(button);}
   button.setAttribute('aria-label','查看 '+(member.identity?.name||'成员')+' 的工作');button.onclick=()=>onInspect(member);
  }
 }
 toggle.onclick=()=>{expanded=!expanded;paint();};
 doc.defaultView?.addEventListener('resize',paint);
 return {paint(next,{key=''}={}){if(key!==scope){scope=key;expanded=false;selection.clear();column.clear();}rows=next;paint();},close(){root.removeEventListener('aieyra:chat-retry',handleRetry);closed=true;doc.defaultView?.removeEventListener('resize',paint);column.close();root.replaceChildren();}};
}
