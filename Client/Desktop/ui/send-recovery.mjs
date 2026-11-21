// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupSendRecovery
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/send-recovery.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';
import {feedbackContent} from './feedback.mjs';

// The durable outbox owns the original text, attachments and request identity.
// An uncertain submission can only query its receipt, never blindly resend.
export function setupSendRecovery(footer,{getQueue,onRetry,onCheck,onChange,onError}){
  const root=el('div',undefined,'send-recovery ui-feedback');root.hidden=true;root.setAttribute('aria-label','未发送消息');footer.prepend(root);
  let signature='',failure=null,checking=false;
  const act=fn=>{try{fn();signature='';paint();onChange();}catch(error){onError(error.message);}};
  function paint(){
    const queue=getQueue(),entry=queue?.entries[0],shown=entry&&(!queue.running||checking),editable=entry&&(entry.rejection||entry.delivery==='prepared');
    // Keep the last pixels while CSS fades out. Retire interaction immediately.
    root.hidden=!shown;root.inert=!shown;if(!shown){signature='';return;}
    root.setAttribute('aria-label',editable?'未发送消息':'待确认消息');
    const reason=entry.rejection?.message||(failure?.queue===queue&&failure?.id===entry.request_id?failure.text:'');
    const next=JSON.stringify([entry,reason,checking]);if(signature===next)return;signature=next;root.replaceChildren();
    const heading=el('div',undefined,'ui-feedback-heading'),note=feedbackContent(reason,{summary:editable?'我们遇到了一些问题，目前消息尚未发送。':'暂时无法确认消息是否送达，原消息已保留。',label:'错误详情'}),actions=el('div',undefined,'send-recovery-actions');
    note.setAttribute('role','status');heading.append(note,actions);root.append(heading);
    const current=()=>{if(getQueue()!==queue||queue.entries[0]!==entry||queue.running)throw Error('发送状态已变化，请重新查看。');};
    const retry=el('button',editable?'重试':checking?'正在核对…':'核对结果','ui-outline'),discard=el('button','放弃','quiet');retry.type=discard.type='button';discard.hidden=!editable;retry.disabled=checking||!editable&&!onCheck;
    if(!editable)retry.setAttribute('data-tip','查询原消息的接收状态');
    retry.onclick=async()=>{try{current();checking=!editable;const pending=editable?onRetry(queue):onCheck(queue);paint();const accepted=await pending;if(!editable&&!accepted)failure={queue,id:entry.request_id,text:'暂未查到接收结果，原消息继续保留。'};onChange();}catch(error){onError(error.message);}finally{checking=false;paint();}};
    discard.onclick=()=>act(()=>{current();queue.discard(entry.request_id);});actions.append(retry,discard);
  }
  return {paint,failed(queue,error){failure={queue,id:queue.entries[0]?.request_id,text:String(error?.message||error)};paint();}};
}
