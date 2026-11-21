// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: SendQueue
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/send-queue.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// The stable request identity survives uncertain acknowledgements and reloads.
// Queueing affects transport only; every entry continues the existing CORE task.
import {validateAttachments} from './attachments.mjs';
import {messageBytes,MESSAGE_BYTES} from './paste-blocks.mjs';
export class SendQueue {
  constructor(session,entries=[],persist=()=>{}){
    this.session=session;this.persist=persist;this.running=null;
    this.entries=entries.filter(x=>x?.session_id===session&&typeof x.text==='string'&&typeof x.request_id==='string');
  }
  add(text,id=crypto.randomUUID(),attachments=[]){
    if(typeof text!=='string'||messageBytes(text)>MESSAGE_BYTES)throw Error('消息不能超过 64 KiB。');
    const checked=attachments.length?validateAttachments(attachments):[],prior=this.entries.find(e=>e.request_id===id);
    if(prior){if(prior.text!==text||JSON.stringify(prior.attachments||[])!==JSON.stringify(checked))throw Error('原请求编号仍在使用，请保留原消息后重试。');return prior;}
    // The local send time orders this row among timed Link/team rows until CORE records it.
    const entry={session_id:this.session,text,request_id:id,delivery:'prepared',at:new Date().toISOString()};if(checked.length)entry.attachments=checked;this.commit([...this.entries,entry]);return entry;
  }
  commit(entries){this.persist(entries);this.entries=entries;}
  revise(id,text,attachments){
    const entry=this.entries.find(x=>x.request_id===id);
    if(this.running||!entry||!(entry.rejection||entry.delivery==='prepared'))throw Error('消息仍待接收确认，暂不能修改。');
    if(typeof text!=='string'||messageBytes(text)>MESSAGE_BYTES)throw Error('消息不能超过 64 KiB。');
    const next={...entry,text,attachments:validateAttachments(attachments),request_id:crypto.randomUUID(),delivery:'prepared',rejection:{code:'edited',message:'已修改，等待重试。'}};
    this.commit(this.entries.map(x=>x===entry?next:x));return next;
  }
  discard(id){
    const entry=this.entries.find(x=>x.request_id===id);
    if(this.running||!entry||!(entry.rejection||entry.delivery==='prepared'))throw Error('消息仍待接收确认，暂不能放弃。');
    this.commit(this.entries.filter(x=>x!==entry));
  }
  reconcile(messages){
    const ids=new Set(messages.map(x=>x.id)),entries=this.entries.filter(x=>!ids.has(x.request_id));
    if(entries.length!==this.entries.length)this.commit(entries);
  }
  check(confirm){
    if(this.running)return this.running;
    this.running=(async()=>{
      const entry=this.entries[0];
      if(!entry||entry.delivery==='prepared'||entry.rejection||!await confirm(entry))return false;
      this.commit(this.entries.filter(x=>x.request_id!==entry.request_id));
      return true;
    })().finally(()=>{this.running=null;});
    return this.running;
  }
  drain(send,confirm=async()=>false,beforeSend=null){
    if(this.running)return this.running;
    this.running=(async()=>{
      while(this.entries.length){
        let entry=this.entries[0];
        const unsent=entry.delivery==='prepared'||!!entry.rejection;
        // An earlier dispatch may have committed despite a lost reply. New
        // input and the check button must only query that original request.
        if(!unsent){
          if(!await confirm(entry))throw Error('暂未查到接收结果，原消息继续保留。');
          this.commit(this.entries.filter(x=>x.request_id!==entry.request_id));
          continue;
        }
        if(!entry.text.trim()&&!entry.attachments?.length)throw Error('请为未发送消息添加文字或附件，或放弃这条消息。');
        // Remove edit permission durably before dispatch. A timeout or reload
        // must never turn an uncertain submission into an editable one.
        if(entry.rejection||entry.delivery==='prepared'){const {rejection,...pending}=entry;pending.delivery='pending';this.commit([pending,...this.entries.slice(1)]);entry=pending;}
        // Persist the uncertain state before crossing the IPC/network boundary.
        // A failed flush cannot dispatch, and later launches cannot call it unsent.
        try{if(beforeSend)await beforeSend(entry);}
        catch(error){
          if(unsent)this.commit(this.entries.map(x=>x===entry?{...entry,delivery:'prepared',rejection:{code:'local_save_failed',message:'消息尚未发送：'+String(error.message).slice(0,3800)}}:x));
          throw error;
        }
        try{await send(entry);}catch(error){
          if(!await confirm(entry)){
            const receipt=error.send_rejection;
            if(['attachment_rejected','not_admitted'].includes(receipt?.code)&&receipt.task_id===entry.session_id&&receipt.request_id===entry.request_id)
              this.commit(this.entries.map(x=>x===entry?{...entry,rejection:{code:receipt.code,message:error.message}}:x));
            throw error;
          }
        }
        this.commit(this.entries.filter(x=>x.request_id!==entry.request_id));
      }
    })().finally(()=>{this.running=null;});
    return this.running;
  }
}
