// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupAgentView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/agent-view.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupStage} from './stage.mjs';
import {renderMarkdown} from './markdown.mjs';
import {projectedPresentation} from './observer-model.mjs';

// The same view remains mounted when its native container is attached,
// detached, hidden or restored. No task-control or model API is used here.
export function setupAgentView(root,{api,doc=root.ownerDocument,role='matrix'}={}){
 const make=(tag,cls,text)=>{const node=doc.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
 const conversation=make('section','agent-conversation'),heading=make('p','agent-state','正在读取进展…'),messages=make('div','agent-messages'),thought=make('div','agent-thought'),body=make('div','agent-body');
 const work=make('section','agent-work'),stageRoot=make('div','agent-stage'),empty=make('p','agent-empty','操作会在这里实时呈现');
 conversation.setAttribute('aria-label','交流与进展');work.setAttribute('aria-label','实时操作');
 conversation.append(heading,messages,thought,body);work.append(stageRoot,empty);root.replaceChildren(conversation,work);
 const stage=setupStage(stageRoot,{api,doc,role});
 let latest=null,visible=true,closed=false,messageSignature='',thoughtSignature='',bodySignature='';
 function paint(frame){
  if(closed)return;latest=frame;
  if(!visible){stage.paint(null,null,{show:false});return;}
  if(frame?.status!=='ready'&&frame?.status!=='error'){heading.textContent=frame?.error||'正在读取进展…';if(frame?.status==='stale')stage.paint(null,null,{show:false});return;}
  const snapshot=frame.snapshot;if(!snapshot)return;
  const row=snapshot.roles?.find(r=>r.role===role),live=snapshot.live?.[role]||{};
  const active=['queued','running','waiting_user','cancelling'].includes(row?.state);
  const state=frame.error||({thinking:'正在思考',body:'正在整理回复',tool:'正在操作',compacting:'正在整理上下文'}[live.phase]||{queued:'正在排队',running:'正在工作',waiting_user:'等待决定',completed:'已完成',failed:'未完成',cancelled:'已停止',cancelling:'正在停止'}[row?.state]||'等待进展');
  heading.textContent=state;root.dataset.state=active?'active':'settled';
  const rows=(snapshot.messages||[]).filter(m=>role==='matrix'||m.from===role||m.to===role).slice(-20);
  const signature=JSON.stringify(rows.map(m=>[m.id,m.text,m.display_text,m.state]));
  if(signature!==messageSignature){
   messageSignature=signature;messages.replaceChildren();
   for(const row of rows){const item=make('article','agent-message'),who=make('small','agent-speaker',row.from==='user'?'你':'进展'),text=make('div','agent-message-text');renderMarkdown(text,row.display_text||row.text||'');item.append(who,text);messages.append(item);}
  }
  const thinking=live.phase==='thinking'?String(live.thought||'').trim():'';
  if(thinking!==thoughtSignature){thoughtSignature=thinking;thought.textContent=thinking;thought.hidden=!thinking;thought.scrollTop=thought.scrollHeight;}
  const text=String(live.text||row?.result||'').trim(),inMessages=rows.some(m=>m.from!=='user'&&String(m.display_text||m.text||'').trim()===text);
  if(text!==bodySignature){bodySignature=text;renderMarkdown(body,text);}
  body.hidden=!text||inMessages;
  stage.paint(snapshot,projectedPresentation(frame),{show:true});empty.hidden=!stageRoot.hidden;
 }
 return {paint,setVisible(value){if(closed)return;visible=!!value;if(!visible)stage.paint(null,null,{show:false});else if(latest)paint(latest);},close(){if(closed)return;closed=true;stage.close();root.replaceChildren();}};
}
