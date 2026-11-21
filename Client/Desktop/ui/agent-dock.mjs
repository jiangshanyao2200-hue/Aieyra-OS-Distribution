// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PAGE; entryOf; visibleChat; mergeEntries; createAgentDock
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/agent-dock.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {paintBubbleAttachments} from './attachments.mjs';
import {setupChatColumn} from './chat-column.mjs';
import {createReceiptReader} from '../../../Tool/presentation/receipt-reader.mjs';
import {renderMarkdown} from './markdown.mjs';
import {createChatReadingIntent} from './chat-reading.mjs';

// 统一侧栏的聊天部分（第109轮 7.3 B/D）。程序浮层和 Coding 固定右栏共用这一个组件：
// 只有消息列，没有顶栏和历史页。先取最近 20 轮，滚到顶部再取更早一页，直到没有更多。
// 历史用 chat_page 的稳定 entry.id，与实时快照按 snapshot_id 对上；不按累计条数截断。
// 长正文通过同一回执分页器按需读取，切换会话时丢弃旧请求。
const PAGE=20,NEAR=48,TOP=80,HIDDEN=['tool','thinking','system'];

// chat_page 的一行 → 聊天列的条目。sender 对应的身份由调用方给（identityOf），这里不猜角色名。
// 原文引用不能叫 receipt：聊天列把 e.receipt 当原始记录文本显示。
export function entryOf(row,identityOf=()=>undefined){
 const user=row.sender_id==='user',identity=user?undefined:identityOf(row.sender_id);
 return {id:row.id,snapshotId:row.snapshot_id||'',round:row.round_id||'',from:user?'user':'eyra',role:identity?.role,identity,text:row.text||'',at:row.at||'',state:row.state||'',brief:row.kind==='brief',process:!!row.process,generation:row.generation,attachments:row.attachments||[],artifacts:row.artifacts||[],textMore:!!row.text_more,receiptRef:row.receipt||null};
}

export function visibleChat(entries){return entries.filter(e=>(!e.process||e.brief)&&(e.from==='user'||e.brief||!['failed','interrupted','interrupted_unknown','timed_out','cancelled','persistence_failed'].includes(e.state)));}

// 历史在前、实时在后。实时条目按 snapshot_id（或同 id）对上历史时，沿用历史的稳定 id，
// 实时更新状态与流式正文；有原文分页入口的长消息保留摘要，避免快照再次展开全文。
export function mergeEntries(history,stream){
 const out=history.slice(),byId=new Map(),bySnap=new Map(),insertions=new Map(),fresh=new Map();let pending=[];
 out.forEach((h,i)=>{byId.set(h.id,i);if(h.snapshotId)bySnap.set(h.snapshotId,i);});
 for(const m of stream){
  const source=m.snapshotId||m.id,i=bySnap.has(source)?bySnap.get(source):byId.get(m.id);
  if(i===undefined){const old=fresh.get(m.id);if(old)old.value=m;else{const slot={value:m};fresh.set(m.id,slot);pending.push(slot);}}
  else{
   // New Briefs precede the final reply already present in the latest archive.
   // Appending every unmatched row at the end reverses this real chronology.
   if(pending.length){insertions.set(i,[...insertions.get(i)||[],...pending]);pending=[];}
   out[i]={...out[i],...m,id:m.response?m.id:out[i].id,text:out[i].textMore&&out[i].receiptRef?out[i].text:m.text||out[i].text,textMore:out[i].textMore,receiptRef:out[i].receiptRef};
  }
 }
 return out.flatMap((entry,i)=>[...(insertions.get(i)||[]).map(slot=>slot.value),entry]).concat(pending.map(slot=>slot.value));
}

export function createAgentDock({root,scroller=root.parentElement,read,getProfile,identityOf,historyActions=true,layoutMotion=null,onState=()=>{},onError=()=>{}}){
 const column=setupChatColumn(root,{getProfile,historyActions}),readers=new Map(),refreshes=new Set();
 const clearReaders=()=>{for(const r of readers.values())r.reader.dispose();readers.clear();};
 let key='',scope={},version=0,history=[],stream=[],before='',more=false,indexing=false,busy=false,loaded=false,paged=false,error='',near=true,timer=0,resets=0,closed=false,loadingOlder=false,pageTask=null,structure='',userKey='';
 const readingIntent=createChatReadingIntent(),resumeFollowing=()=>{readingIntent.reset();near=true;};
 const state=()=>({loaded,busy,loadingOlder,more,indexing,error,following:near,empty:loaded&&!history.length&&!stream.length}),emit=()=>onState(state());
 const bar=()=>scroller.getBoundingClientRect().top;
 // 读旧消息时记住第一条可见条目的位置，插入更早的内容后放回原处。
 const anchor=()=>{const top=bar(),node=[...root.children].find(n=>n.getBoundingClientRect().bottom>top);return node?{id:node.dataset.id,offset:node.getBoundingClientRect().top-top}:null;};
 function paint(opts){
  if(closed)return;
  const a=near?null:anchor();
  const entries=visibleChat(mergeEntries(history,stream)),nextStructure=JSON.stringify(entries.map(e=>[e.id,!!e.work,!!e.brief])),nextUser=entries.findLast(e=>e.from==='user')?.id||'',kind=nextUser!==userKey?'send':'brief',beforeMotion=layoutMotion&&structure&&structure!==nextStructure&&!opts?.prepend?layoutMotion.capture():null;
  column.visibility(true);column.paint(entries,{...opts,...(layoutMotion?{motion:false}:{})});paintBubbleAttachments(root,entries);
  const keep=new Set();
  for(const e of entries){
   const entry=[...root.children].find(n=>n.dataset.id===e.id);
   if(entry)entry.dataset.historyPreview=String(!!(e.textMore&&e.receiptRef));
   if(!e.textMore||!e.receiptRef)continue;
   const node=entry?.querySelector('.chat-main');if(!node)continue;keep.add(e.id);
   let old=readers.get(e.id);
   if(old?.node===node)continue;
   old?.reader.dispose();
   const own=version,summary=root.ownerDocument.createElement('summary');summary.className='hx-more';summary.textContent='查看全部';
   const reader=createReceiptReader(root.ownerDocument,{summary,mode:'text',renderText:renderMarkdown,readPage:offsets=>read('receipt',{...e.receiptRef,...offsets}),isCurrent:()=>!closed&&own===version&&node.isConnected});
   node.append(reader.element);readers.set(e.id,{node,reader});
  }
  for(const [id,r]of readers)if(!keep.has(id)){r.reader.dispose();r.reader.element.remove();readers.delete(id);}
  if(beforeMotion)layoutMotion.commit(beforeMotion,{kind});
  if(near){if(layoutMotion)layoutMotion.follow({snap:!structure,reserve:!!beforeMotion&&kind==='send'});else scroller.scrollTop=scroller.scrollHeight;}
  else{const node=a&&[...root.children].find(n=>n.dataset.id===a.id);if(node)scroller.scrollTop+=node.getBoundingClientRect().top-bar()-a.offset;}
  structure=nextStructure;userKey=nextUser;
  emit();
 }
 function invalidateRefreshes(){for(const refresh of refreshes)refresh.invalidate();refreshes.clear();}
 function wipe(keepRefreshes=false){layoutMotion?.reset();structure=userKey='';clearReaders();version++;if(keepRefreshes){for(const refresh of refreshes)refresh.version=version;}else invalidateRefreshes();pageTask=null;history=[];before='';more=false;indexing=false;busy=false;loaded=false;paged=false;error='';resumeFollowing();clearTimeout(timer);column.clear();}
 function fill(){if(closed||!more||busy||refreshes.size||indexing||error||scroller.clientHeight<=0)return;if(scroller.scrollHeight<=scroller.clientHeight+TOP)void page('older');}
 async function page(mode,force=false,nextStream){
  if(closed||busy||!key)return false;
  if(mode==='older'&&(!more||!before||indexing&&!force))return false;
  const own=version,task={};pageTask=task;busy=true;loadingOlder=mode==='older';error='';
  // Keep the in-flight page available before emitting its busy state, including
  // when a synchronous reader fails. Atomic refreshes can wait without racing fill.
  task.promise=Promise.resolve().then(async()=>{
  try{
   if(own!==version||closed)return false;
   const r=await read('chat_page',{kind:scope.kind,before:mode==='older'?before:'',limit_rounds:PAGE});
   if(own!==version||closed)return false;
   if(r?.reset){
    // 游标失效（会话变更或归档）：丢掉已有页，从最新一页重来，最多两次。
    if(++resets>2)throw Error('聊天记录已变化，请重新打开侧栏');
    wipe(true);return page('latest',false,nextStream);
   }
   resets=0;
   const rows=(r.entries||[]).filter(x=>!HIDDEN.includes(x.kind)).map(x=>entryOf(x,identityOf));
   const at=new Map(history.map((h,i)=>[h.id,i]));
   if(mode==='older'){history=[...rows.filter(x=>!at.has(x.id)),...history];paged=true;}
   else for(const x of rows){if(at.has(x.id))history[at.get(x.id)]=x;else{at.set(x.id,history.length);history.push(x);}}
   const prior=indexing,prevBefore=before;indexing=!!r.indexing;
   if(mode==='older'||!loaded||prior&&!paged){before=r.before||'';more=!!r.has_more;}if(mode==='older'&&!indexing&&(!rows.length||(r.before||'')===prevBefore))more=false;
   loaded=true;if(nextStream!==undefined)stream=nextStream||[];
   // 索引没完成不等于没有更多：稍后再读同一页。
   clearTimeout(timer);if(indexing)timer=setTimeout(()=>void page(mode,true),1500);
   paint({prepend:mode==='older'});return true;
  }catch(e){if(own===version){error=e.message||String(e);onError(error);}return false;}
  finally{if(own===version&&pageTask===task){pageTask=null;busy=false;loadingOlder=false;emit();fill();}}
  });
  emit();return task.promise;
 }
 async function refresh(messages){
  if(messages===undefined)return page('latest');
  if(closed||!key)return false;
  const refresh={version};
  const invalidated=new Promise(resolve=>{refresh.invalidate=()=>resolve(false);});refreshes.add(refresh);
  try{
   // open() may already be reading a page captured before this live snapshot.
   // Read latest again after it settles; publish its history and live in one paint.
   while(busy){await Promise.race([pageTask.promise,invalidated]);if(closed||refresh.version!==version)return false;}
   return await Promise.race([page('latest',false,messages),invalidated]);
  }finally{refreshes.delete(refresh);if(!closed&&refresh.version===version)fill();}
 }
 const onScroll=()=>{const atTail=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<NEAR;if(!layoutMotion)near=atTail;else if(readingIntent.scrolled(atTail))near=readingIntent.following;if(scroller.scrollTop<TOP&&more&&!busy&&!error)void page('older');};
 const onRead=e=>{readingIntent.following=near;if(readingIntent.input(e)){near=readingIntent.following;if(!near)layoutMotion?.reset();}};
 scroller.addEventListener('scroll',onScroll,{passive:true});
 if(layoutMotion)for(const name of ['wheel','pointerdown','touchstart','keydown'])scroller.addEventListener(name,onRead,{passive:true});
 return {
  // scope、种类或 core_epoch 任一变了就整体重来；迟到的响应按 version 作废。
  open(next){const k=JSON.stringify([next.scope_id,next.kind,next.core_epoch||'']);if(k===key)return false;key=k;scope=next;resets=0;stream=[];wipe();emit();void page('latest');return true;},
  reset(){key='';scope={};resets=0;stream=[];wipe();emit();},
  live(messages){stream=messages||[];paint();fill();},
  refresh,older(){return page('older',true);},
  resumeFollowing,
  state,
  suspend(){layoutMotion?.reset();column.visibility(false);},
  close(){layoutMotion?.reset();clearReaders();closed=true;version++;invalidateRefreshes();pageTask=null;clearTimeout(timer);scroller.removeEventListener('scroll',onScroll);for(const name of ['wheel','pointerdown','touchstart','keydown'])scroller.removeEventListener(name,onRead);column.close();},
 };
}
