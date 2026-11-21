// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat
// Regions: STRUCTURED; CLAMP_LINES; ICON; iconButton; setIcon; userTextFormat; paintUserText; paintDelivery; userActions; fitUser; HIDDEN_STATES; linkMessagePresentation; linkMessageGeneration; linkMessageAuthor; chatRounds; ARTIFACT_ICONS; FOLDER_ICON; setArtifactError; artifactChips; initial; chatAvatar; setupChatColumn; signatureOf
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/chat-column.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindThemeComponent,bindThemeGreeting,disposeThemeTree} from '../../../Theme/runtime/layout.mjs';
// 聊天形态的聊天列（docs/UI设计知识库.md 形态 §4）：左上角起一条列，每条消息是头像、名字和正文；
// 光圈（#emergence）永远是列的最后一个，位置就是 Eyra 下一句回复的头像位。首屏保留最近 20 轮。
import {renderMarkdown} from './markdown.mjs';
import {problemStatus} from './chat-status.mjs';
import {redactNoticeText} from './system-notices.mjs';
import {roleIdentity,createRoleRing,paintRoleRing} from './role-identity.mjs';
import {createThoughtView} from './thought-view.mjs';
import {animateUI,motionAllowed} from './motion.mjs';
import {messageInTurn,orderTurnReplies} from './turn-scope.mjs';
import {createWorkTranscript} from './work-transcript.mjs';

// 用户消息（R64）：结构化粘贴（代码块、标题、列表、表格、引用）按 Markdown 排版，其余保留原换行；
// 长消息保留展开控件，正文沿用系统选字复制。
const STRUCTURED=/^\s*```|^ {0,3}#{1,6}\s+\S|^\s*(?:[-*+]|\d+[.)])\s+\S|^\s*\|.+\|\s*$|^\s*>\s?\S/m;
const CLAMP_LINES=8;
const ICON={
 expand:'<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
 collapse:'<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>',
};
function iconButton(name,label){
 const b=document.createElement('button');b.type='button';b.className='chat-action quiet';b.dataset.action=name;b.title=label;b.setAttribute('aria-label',label);
 b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICON[name]+'</svg>';return b;
}
function setIcon(button,name){button.querySelector('svg').innerHTML=ICON[name];}
export function userTextFormat(value){return STRUCTURED.test(String(value||''))?'markdown':'plain';}
function paintUserText(node,value){
 const text=node.querySelector('.chat-text');node._raw=value;
 if(userTextFormat(value)==='markdown'){text.classList.add('user-md');renderMarkdown(text,value);}
 else{text.classList.remove('user-md');if(text.textContent!==value){disposeThemeTree(text);text.textContent=value;}}
}
function paintDelivery(node,e){
 node.dataset.delivery=e.delivery||'';
 let status=node.querySelector('.chat-send-status');
 // Terminal execution states belong to their original inputs.
 const state=e.state==='interrupted'||e.state==='cancelled'?e.state:e.delivery;
 const text=({cancelled:'已停止，原消息已保留',interrupted:'执行已中断，原消息已保留',unknown:'尚未确认是否收到，原消息已保留',prepared:e.rejected?'消息尚未发送，请检查后重试':''})[state]||'';
 if(!text){status?.remove();return;}
 if(!status){status=document.createElement('small');status.className='chat-send-status';node.querySelector('.chat-main').append(status);}
 status.textContent=text;status.dataset.delivery=state;
}
function userActions(node){
 const bar=document.createElement('span');bar.className='chat-actions';
 const expand=iconButton('expand','查看全部');
 expand.hidden=true;bar.append(expand);
 expand.onclick=()=>{const open=node.dataset.expanded!=='true';node.dataset.expanded=String(open);setIcon(expand,open?'collapse':'expand');expand.title=open?'收起':'查看全部';expand.setAttribute('aria-label',expand.title);};
 return bar;
}
function fitUser(node){
 const text=node.querySelector('.chat-text'),raw=node._raw||'';
 if(!text||!node.isConnected)return;
 const likely=raw.length>280||raw.split('\n').length>CLAMP_LINES;
 let clamped=false;
 if(likely){const s=getComputedStyle(text),lh=parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.8;text.style.setProperty('--clamp-height',Math.round(lh*CLAMP_LINES)+'px');clamped=text.scrollHeight>lh*(CLAMP_LINES+.5);}
 node.dataset.clamped=String(clamped);const expand=node.querySelector('.chat-action[data-action=expand]');if(expand)expand.hidden=!clamped;
}
const HIDDEN_STATES=new Set(['commentary','cancelled','failed','timed_out','interrupted','persistence_failed']);

// Only a host result with matching provenance has an internal reference tail.
// Keep its exact original available without applying text cleanup to replies.
// Chain chat / communication boundary: live consumers receive Brief only;
// the original dialogue remains available through explicit history/receipts.
// Update home, OS conversation and program-agent consumers together.
export function linkMessagePresentation(message,{history=false}={}){
 if(!history)return {text:String(message?.brief||'').trim()||(message?.kind==='result'?'交回协作结果':'同步协作进展'),brief:true};
 const text=String(message?.text||'');
 if(message?.kind!=='result'||!/^core-link-[a-f0-9]{64}$/.test(message.request||'')||!/^[a-f0-9]{32}$/.test(message.from||'')||!Number.isSafeInteger(message.sender_generation)||message.sender_generation<1)return {text};
 const tail='\n完整结果引用：instance='+message.from+' generation='+message.sender_generation;
 return text.endsWith(tail)?{text:text.slice(0,-tail.length),receipt:text}:{text};
}

export function linkMessageGeneration(message,actor){
 const generation=message.from===actor?message.sender_generation:message.to===actor?message.target_generation:0;
 return Number.isSafeInteger(generation)&&generation>0?generation:0;
}

// Released seats disappear from members, not from existing message identity.
// Core authors is bounded to this page/scope; do not infer execution authority
// from a historical author or substitute the current reader's role/avatar.
export function linkMessageAuthor(link,message){
 return (link?.members||[]).find(m=>m.id===message.from)||(link?.authors||[]).find(m=>m.id===message.from);
}

// 纯函数：从消息里取最近 limit 轮。用户的消息全部算（包括还在发送的），Eyra 只算给用户的、已完成的回复。
// 开场问候不是一条消息（它在 snapshot.greeting 里）：作为 Eyra 的一句话放进列里，不再等着被展示期消散。
// 它发生在第 after 轮结束之后，所以排在那一轮最后一条消息的后面。
// commentary：工作形态里传入当前轮次，本轮的过程正文也作为 Eyra 的普通消息列进来；任务结束后不再传，它们就从列里退场。
export function chatRounds(messages=[],pending=[],{limit=10,greeting=null,commentary=null,talk=[]}={}){
 const seen=new Set(),list=[];
 for(const m of [...messages,...pending]){
  if(!m?.id||seen.has(m.id))continue;seen.add(m.id);
  if(m.from==='user'&&typeof m.text==='string')list.push({id:m.id,from:'user',text:m.text,at:m.at||'',state:m.state||'',delivery:m.delivery||'',attachments:m.attachments||[],generation:m.generation,origin:m.origin||''});
  else if(m.from==='matrix'&&m.to==='user'&&typeof m.text==='string'&&m.text.trim()&&!HIDDEN_STATES.has(m.state)&&m.state==='completed')list.push({id:m.id,from:'eyra',turnID:m.turn_id||'',text:m.text,at:m.at||'',generation:m.generation,artifacts:Array.isArray(m.artifacts)?m.artifacts:[]});
  else if(commentary!==null&&m.from==='matrix'&&m.to==='user'&&m.state==='commentary'&&(typeof commentary==='object'?messageInTurn(m,commentary,messages):m.generation===commentary)&&typeof m.text==='string'&&m.text.trim())list.push({id:m.id,from:'eyra',turnID:m.turn_id||'',text:m.text,at:m.at||'',generation:m.generation,progress:true});
 }
 // Completion can commit after another user has already queued a message.
 // The receipt's input identity determines where the reply belongs; log arrival
 // order must never make it the answer to that later input.
 list.splice(0,list.length,...orderTurnReplies(list));
 if(greeting?.id&&String(greeting.text||'').trim()){
  let index=0;
  if(Object.hasOwn(greeting,'afterID'))index=Math.max(0,list.findIndex(e=>e.id===greeting.afterID)+1);
  else for(const [i,e] of list.entries())if(Number.isFinite(e.generation)&&e.generation>0&&e.generation<=(greeting.after||0))index=i+1;
  list.splice(index,0,{id:greeting.id,from:'eyra',text:String(greeting.text).trim(),at:'',greeting:true});
 }
 // 团队对话：Eyra、Vaya、Cota 之间只放一句 brief，按时间插进对话里；原文不进聊天。
 for(const t of Array.isArray(talk)?talk:[]){
  if(!t?.id||!String(t.brief||'').trim()||seen.has('talk:'+t.id))continue;seen.add('talk:'+t.id);
  const row={id:'talk:'+t.id,from:'eyra',role:t.from,to:t.to,text:String(t.brief).trim(),at:t.at||'',talk:true,brief:true,generation:t.generation,kind:t.kind||''};
  const at=Date.parse(row.at)||0,i=at?list.findIndex(e=>(Date.parse(e.at)||0)>at):-1;
  if(i<0)list.push(row);else list.splice(i,0,row);
 }
 let users=0,start=0;
 for(let i=list.length-1;i>=0;i--)if(list[i].from==='user'&&++users===limit){start=i;break;}
 return list.slice(start);
}

// 产物卡片（README.md 运行时 · 产物 B1）：Eyra 这一轮新建或改过的文件。点卡片：网页、图片在预览窗口打开，其他文件用系统程序打开；
// 悬停时出现“在文件夹中显示”。动作交给 app.mjs（eyra-artifact 事件），失败时卡片变暗并在提示里说明。
const ARTIFACT_ICONS={
 html:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9"/></svg>',
 image:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/></svg>',
 file:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h6.5L18 8v12.5H7z"/><path d="M13.5 3.5V8H18M9.5 12.5h6M9.5 16h6"/></svg>',
};
const FOLDER_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';
export function setArtifactError(chip,message=''){
 if(!chip)return;
 chip.classList.toggle('missing',!!message);chip.removeAttribute('title');
 if(message)chip.dataset.tip=message;else delete chip.dataset.tip;
 // Both interactive targets must expose the error, then restore their own hint.
 // Removing title alone cannot clear a hint already absorbed by tooltip.mjs.
 for(const button of chip.querySelectorAll('[data-artifact-hint]')){
  button.removeAttribute('title');button.dataset.tip=message||button.dataset.artifactHint;
 }
}
export function artifactChips(list){
 const row=document.createElement('div');row.className='chat-artifacts';
 for(const a of list.slice(0,12)){
  const chip=document.createElement('div'),open=document.createElement('button'),reveal=document.createElement('button');
  const preview=['html','image'].includes(a.kind),name=String(a.path||'').split('/').pop();
  chip.className='artifact-chip';chip.dataset.kind=a.kind||'other';
  open.type='button';open.className='artifact-open';open.dataset.tip=open.dataset.artifactHint=(preview?'预览 ':'打开 ')+a.path;
  open.innerHTML=ARTIFACT_ICONS[a.kind]||ARTIFACT_ICONS.file;
  const label=document.createElement('span');label.className='artifact-name';label.textContent=name;open.append(label);
  reveal.type='button';reveal.className='artifact-reveal';reveal.dataset.tip=reveal.dataset.artifactHint='在文件夹中显示';reveal.setAttribute('aria-label','在文件夹中显示 '+name);reveal.innerHTML=FOLDER_ICON;
  const send=action=>document.dispatchEvent(new CustomEvent('eyra-artifact',{detail:{path:a.path,action,chip}}));
  open.onclick=()=>send(preview?'preview':'open');reveal.onclick=()=>send('reveal');
  chip.append(open,reveal);row.append(chip);
 }
 return row;
}

const initial=name=>([...String(name||'').trim()][0]||'·').toUpperCase();

export function chatAvatar(src,name,kind){
 const node=document.createElement('span');node.className='chat-avatar '+kind;
 if(src){const img=document.createElement('img');img.alt='';img.src=src;node.append(img);}
 else if(kind==='user')node.textContent=initial(name);
 return node;
}

// Shared chat owner: appearance, identity nodes and incremental row reuse live
// here. Compact/program/session consumers compose this column; they must not
// restyle names, status or avatars independently or rebuild rows on snapshots.
export function setupChatColumn(root,{getProfile,compact=false}){
 const nodes=new Map(),fits=new Set();let painted=false,profileKey='',fitFrame=0,widthSeen=0,closed=false;
 const scheduleFit=()=>{if(fitFrame||!fits.size)return;fitFrame=requestAnimationFrame(()=>{fitFrame=0;for(const n of fits)fitUser(n);fits.clear();});};
 // 列宽变化会改变折叠判断；只在宽度真正变化时重量用户消息。
 const observer=new ResizeObserver(entries=>{const w=Math.round(entries[0]?.contentRect.width||0);if(w===widthSeen)return;widthSeen=w;for(const n of nodes.values())if(n.classList.contains('user'))fits.add(n);scheduleFit();});observer.observe(root);
 function body(node,e){
  const text=node.querySelector('.chat-text');
  const wasWork=!!node._work;
  node.dataset.brief=String(!!e.brief);node.classList.toggle('brief',!!e.brief);
  node.dataset.work=String(!!e.work);
  node.dataset.response=String(!!e.response||!!e.work);
  if(e.problem){
   node._work?.close();node._work=null;
   node._thought?.detach();node._thought=null;
   const header=node.querySelector('.chat-name');
   let status=header.querySelector('.chat-work-status');
   if(!status){status=document.createElement('small');status.className='chat-work-status';header.append(status);}
   status.textContent=problemStatus;
   const attempt=e.retry?.attempt;
   if(node._failure===e.text&&node._retryable===e.retryable&&node._retryAttempt===attempt)return;
   node._failure=e.text;node._retryable=e.retryable;node._retryAttempt=attempt;
   const title=document.createElement('strong'),detail=document.createElement('p');
   title.textContent='遇到问题';detail.className='chat-failure-detail';detail.textContent=e.text;disposeThemeTree(text);text.replaceChildren(title,detail);
   if(e.retryable){
    const button=document.createElement('button'),result=document.createElement('span');
    button.type='button';button.className='ui-outline chat-failure-retry';button.textContent='重试';result.setAttribute('role','status');text.append(button,result);
    button.onclick=async()=>{
     if(button.disabled)return;button.disabled=true;result.textContent='';
     try{
      if(!node.isConnected)return;
      const detail={...e.retry,failureId:e.id};
      node.dispatchEvent(new CustomEvent('aieyra:chat-retry',{bubbles:true,detail}));
      if(!detail.submit)throw Error('当前会话尚未就绪。');
      await detail.submit();button.textContent='已提交';
     }catch(error){result.textContent=redactNoticeText(error.message);button.disabled=false;}
    };
   }
   return;
  }
  node._failure=null;
  if(e.work){
   if(!node._work){const header=node.querySelector('.chat-name'),label=document.createElement('span');label.className='work-name';label.textContent=header.textContent;header.replaceChildren(label);node._thought?.detach();node._thought=null;disposeThemeTree(text);text.replaceChildren();node._work=createWorkTranscript(text);}
   node._work.update(e.work);
   let status=node.querySelector('.chat-work-status');if(!status){status=document.createElement('small');status.className='chat-work-status';node.querySelector('.chat-name').append(status);}
   if(status.textContent!==e.work.status)status.textContent=e.work.status||'';
   return;
  }
  node._work?.close();node._work=null;
  const workName=node.querySelector('.work-name');if(workName)workName.replaceWith(workName.textContent);
  node.querySelector('.chat-work-status')?.remove();
  node.dataset.subprocess=String(!!e.subprocess);node.dataset.thought=String(!!e.thought);node.dataset.phase=e.phase||'';
  if(e.subprocess&&e.thought){
   if(!node._thought){node._thought=createThoughtView();node._thought.attach(text);}node._thought.update(e.text);
  }else{
   node._thought?.detach();node._thought=null;
   if(e.talk){text.textContent=e.text;return;}
   if(e.subprocess&&['tool','waiting'].includes(e.phase)){
    disposeThemeTree(text);text.replaceChildren();const line=document.createElement('div');line.className='sub-tool-line';
    const dot=document.createElement('span');dot.className='sub-tool-dot';dot.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.textContent=e.text||e.title;line.append(dot,label);text.append(line);
   }else if(e.from==='user')paintUserText(node,e.text);else if(wasWork||node._bodyText!==e.text){renderMarkdown(text,e.text);node._bodyText=e.text;}
  }
 }
 function entry(e,profile,fresh){
  const user=e.from==='user',node=document.createElement('article');
  // A submitted user message is visible in the same event turn; never fade it in.
  if(user)fresh=false;
  node.className='chat-entry '+(user?'user':'eyra')+(e.progress?' progress':'')+(e.talk?' talk':'')+(e.origin==='link'?' link-notice':'')+(fresh?' fresh':'');node.dataset.id=e.id;
  const role=e.role||'matrix',identity=e.identity||roleIdentity(profile,role),name=user?profile.name||'你':identity.name;
  node.dataset.greeting=String(!!e.greeting);node.dataset.system=String(!!e.system);node.dataset.role=user?'user':role;node.dataset.thought=String(!!e.thought);node.dataset.streaming=String(!!e.streaming);
  const main=document.createElement('div'),header=document.createElement('header'),text=document.createElement('div');
  main.className='chat-main';header.className='chat-name';header.textContent=name;text.className='chat-text';
  if(user)header.append(userActions(node));
  if(e.thought&&!e.work){const label=document.createElement('small');label.className='chat-phase';label.textContent=e.streaming?'正在思考':'思考';header.append(label);}
  if(user&&e.attachments?.length){const a=document.createElement('small');a.className='chat-attachments';a.textContent=e.attachments.map(x=>x.name||'附件').join(' · ');main.append(header,text,a);}
  else main.append(header,text);
  if(e.receipt){
   const details=document.createElement('details'),summary=document.createElement('summary'),original=document.createElement('pre');
   details.className='raw-receipt chat-link-receipt';summary.textContent='查看原始记录';original.textContent=e.receipt;details.append(summary,original);main.append(details);
  }
  if(!user&&e.artifacts?.length)main.append(artifactChips(e.artifacts));
  const interactiveAvatar=!compact&&role==='matrix'&&!e.talk;
  const avatar=user?chatAvatar(profile.avatar,name,'user'):createRoleRing(identity,{state:e.haloState|| (e.streaming?(e.phase|| (e.thought?'thinking':'body')):'idle'),toolEffect:e.effect,live:e.live===true,interactive:interactiveAvatar});
  if(user)avatar.style.setProperty('--user-ring-color',profile.userRingColor||'#e6e9f0');
  if(!user&&interactiveAvatar)avatar.onclick=()=>document.getElementById('eyra-trigger')?.click();
  if(e.greeting&&!user){const identity=document.createElement('div');identity.className='chat-greeting-identity';identity.append(avatar);node.append(identity,main);bindThemeGreeting(node,{identity,answer:main});}
  else{node.append(avatar,main);if(!compact)bindThemeComponent(node,'message',{avatar,content:main});}
  body(node,e);if(user)paintDelivery(node,e);
  node.dataset.signature=signatureOf(e);node.dataset.entryIdentity=JSON.stringify(e.identity||null);node._artifactKey=JSON.stringify(e.artifacts||[]);
  return node;
 }
 return {
  // 增量对齐：新条目带入场动画（首次绘制不带），已有条目只在内容变化时更新。
  paint(entries,{prepend=false,tailRoot=null,tailIds=new Set(),motion=true}={}){
   if(closed)return [];
   const profile=getProfile(),key=JSON.stringify([profile.name,profile.eyraName,profile.avatar,profile.eyraAvatar,profile.userRingColor,profile.roles]),profileChanged=key!==profileKey;
   if(profileChanged){profileKey=key;for(const [id,n] of nodes){
    // Identity changes must not replace a user's editor, selection, pending
    // request or retry identity. Refresh its existing identity slots in place.
    if(n.classList.contains('user')){const name=profile.name||'你',header=n.querySelector('.chat-name'),avatar=n.querySelector('.chat-avatar'),fresh=chatAvatar(profile.avatar,name,'user');if(header?.firstChild?.nodeType===3)header.firstChild.nodeValue=name;if(avatar){avatar.replaceChildren(...fresh.childNodes);avatar.style.setProperty('--user-ring-color',profile.userRingColor||'#e6e9f0');}fits.add(n);continue;}
    // Assistant identity is refreshed in its existing slots below. A profile
    // change must not replace its reader, halo, selection or in-flight motion.
   }}
   const keep=new Set(entries.map(e=>e.id));
   for(const [id,node] of nodes)if(!keep.has(id)){node._thought?.detach();node._work?.close();node._pageMotion?.cancel();disposeThemeTree(node);node.remove();nodes.delete(id);}
   let previous=null,tailPrevious=null,added=[];
   for(const value of entries){
    const e=value.greeting?{...value,live:value===entries.at(-1)}:value;
    let node=nodes.get(e.id);const signature=signatureOf(e);
    if(!node||profileChanged||node.dataset.signature!==signature){
     const isNew=!node;
     if(node&&e.from==='user'){
      // A queued message and its accepted receipt are the same visible row.
      // Preserve its avatar, selection and entrance instead of replacing it.
      if(node._raw!==e.text){paintUserText(node,e.text);fits.add(node);}
      const names=(e.attachments||[]).map(x=>x.name||'附件').join(' · ');let attachments=node.querySelector('.chat-attachments');
      if(!attachments?.classList.contains('attachment-cards')){if(names){if(!attachments){attachments=document.createElement('small');attachments.className='chat-attachments';node.querySelector('.chat-main').append(attachments);}if(attachments.textContent!==names)attachments.textContent=names;}else attachments?.remove();}
      paintDelivery(node,e);node.dataset.signature=signature;
     }else if(node&&e.from!=='user'){
      const text=node.querySelector('.chat-text'),nearBottom=!e.work&&text.scrollHeight-text.scrollTop-text.clientHeight<8;
      body(node,e);if(nearBottom&&!e.work)text.scrollTop=text.scrollHeight;
      // A work row becomes the final reply in place, including any real
      // artifacts/receipts published at completion. Keep unchanged cards and
      // their disclosure state while updating only the affected accessory.
      const main=node.querySelector('.chat-main'),artifactKey=JSON.stringify(e.artifacts||[]);
      if(node._artifactKey!==artifactKey){node.querySelector('.chat-artifacts')?.remove();if(e.artifacts?.length)main.append(artifactChips(e.artifacts));node._artifactKey=artifactKey;}
      let receipt=node.querySelector('.chat-link-receipt');
      if(e.receipt){if(!receipt){receipt=document.createElement('details');receipt.className='raw-receipt chat-link-receipt';const summary=document.createElement('summary'),original=document.createElement('pre');summary.textContent='查看原始记录';receipt.append(summary,original);main.append(receipt);}const original=receipt.querySelector('pre');if(original.textContent!==e.receipt)original.textContent=e.receipt;}else receipt?.remove();
      node.dataset.signature=signature;node.dataset.streaming=String(!!e.streaming);
      const identity=e.identity||roleIdentity(profile,e.role||'matrix'),header=node.querySelector('.chat-name');const nameNode=header?.querySelector('.work-name')?.firstChild||header?.firstChild;if(nameNode?.nodeType===3)nameNode.nodeValue=identity.name;
      node.dataset.entryIdentity=JSON.stringify(e.identity||null);
      const ring=node.querySelector('.role-ring');if(ring)paintRoleRing(ring,identity,e.haloState|| (e.streaming?(e.phase|| (e.thought?'thinking':'body')):'idle'),root.ownerDocument,{toolEffect:e.effect,live:e.live===true});
      const label=node.querySelector('.chat-phase');if(label){label.hidden=!e.thought;label.textContent=e.streaming?'正在思考':'思考';}
     }else{const next=entry(e,profile,motion&&painted&&isNew&&!prepend);if(node){node._thought?.detach();node._work?.close();node._pageMotion?.cancel();disposeThemeTree(node);node.replaceWith(next);}node=next;nodes.set(e.id,node);}
     if(isNew)added.push(e);
     if(e.from==='user')fits.add(node);
    }
    const trailing=!!tailRoot&&tailIds.has(e.id),container=trailing?tailRoot:root,last=trailing?tailPrevious:previous;
    const anchor=last?last.nextSibling:container.firstChild;
    if(node!==anchor)container.insertBefore(node,anchor);
    if(prepend&&added.includes(e)&&motionAllowed(root))node._pageMotion=animateUI(node,[{opacity:0},{opacity:1}],{kind:'enter'});
    // Initial streaming text may arrive before this new row is attached.
    // ThoughtView intentionally ignores detached nodes; flush once mounted.
    if(e.subprocess&&e.thought)node._thought?.update(e.text);
    if(trailing)tailPrevious=node;else previous=node;
   }
   // A newly submitted long message must take its final folded height before
   // the parent measures the live row's destination, not one frame afterward.
   for(const e of added)if(e.from==='user'){const node=nodes.get(e.id);fitUser(node);fits.delete(node);}
   painted=true;scheduleFit();
   return added;
  },
  visibility(value){for(const n of nodes.values())n._work?.visibility(value);},
  close(){if(closed)return;closed=true;observer.disconnect();cancelAnimationFrame(fitFrame);fits.clear();this.clear();},
  clear(){for(const n of nodes.values()){n._thought?.detach();n._work?.close();n._pageMotion?.cancel();disposeThemeTree(n);n.remove();}nodes.clear();painted=false;},
 };
}
function signatureOf(e){return JSON.stringify([e.text,e.receipt||'',e.identity||null,!!e.system,!!e.greeting,!!e.live,e.role||'',e.to||'',e.state||'',e.delivery||'',!!e.streaming,!!e.thought,!!e.subprocess,!!e.response,!!e.brief,e.phase,e.effect,e.haloState,e.work,e.problem,e.retryable,e.retry,e.artifacts||[],(e.attachments||[]).map(a=>[a.sha256,a.name])]);}
