// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupRecoveredSends
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/recovered-sends.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';

// A prior OS launch has a different live task. Never retarget an uncertain
// request to that task, or silently turn a pending operation into fresh work.
export function setupRecoveredSends(footer,{entries,onRestore,onDiscard,onCheck,onError}){
 const root=el('div',undefined,'send-recovery recovered-sends ui-feedback');root.hidden=true;root.setAttribute('aria-label','保留的消息');footer.prepend(root);
 let signature='';
 const act=async(button,fn)=>{button.disabled=true;try{await fn();paint();}catch(error){onError(error.message);}finally{button.disabled=false;}};
 function paint(){
  const rows=entries(),key=JSON.stringify(rows);if(key===signature)return;signature=key;root.hidden=!rows.length;root.replaceChildren();if(!rows.length)return;
  const details=el('details'),summary=el('summary',rows.every(e=>e.delivery==='prepared'||e.rejection)?`${rows.length} 条上次未发送的消息`:`${rows.length} 条消息待确认`);details.append(summary);root.append(details);
  for(const entry of rows){
   const safe=entry.delivery==='prepared'||!!entry.rejection,card=el('section',undefined,'recovered-send'),label=el('p',safe?'消息未发送，可恢复后重试。':'发送确认中断，原文和附件已保留。');
   const body=el('details'),title=el('summary','查看原文与附件'),text=el('textarea');text.value=entry.text;text.readOnly=true;text.rows=2;text.setAttribute('aria-label','上次待发正文');body.append(title,text);
   for(const a of entry.attachments||[])body.append(el('p',a.name));
   card.append(label,body);details.append(card);
   if(safe){
    const actions=el('div',undefined,'send-recovery-actions'),restore=el('button','恢复到输入框'),discard=el('button','放弃这条未发送消息');restore.type=discard.type='button';
    restore.onclick=()=>act(restore,()=>onRestore(entry));discard.onclick=()=>act(discard,()=>onDiscard(entry));actions.append(restore,discard);card.append(actions);
   }else{
    const identity=el('p',`原请求：${entry.request_id}`);identity.className='recovered-send-identity';card.append(identity);
    if(onCheck){const confirm=el('button','核对发送结果');confirm.type='button';confirm.onclick=()=>act(confirm,async()=>{if(!await onCheck(entry))throw Error('暂未查到接收结果，原消息继续保留。');});card.append(confirm);}
   }
  }
 }
 return {paint};
}
