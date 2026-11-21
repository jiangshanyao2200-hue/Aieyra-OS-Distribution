// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: redactNoticeText; noticeFailureText; createNoticeInteraction; createNoticeCopy; setupSystemNotices
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/system-notices.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';
import {renderMarkdown} from './markdown.mjs';
import {positionTopbarMenu,topbarMenuGeometry} from './interaction.mjs';
import {animateUI,cancelMotion} from './motion.mjs';

// Preserve diagnostics and error codes; only credential values are removed.
export function redactNoticeText(value){
  return String(value??'')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi,'[私钥已隐藏]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[凭据已隐藏]@')
    // Keep surrounding diagnostic punctuation while removing the complete credential value.
    // Quoted and bracketed values are handled first so a closing `]`/`}` is not
    // left behind by the plain-value expression below.
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|secret|authorization|x-api-key|key|token)["']?\s*[:=]\s*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')/gi,(match,prefix)=>prefix+'[已隐藏]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|secret|authorization|x-api-key|key|token)["']?\s*[:=]\s*)(\[(?:\\.|[^\]\r\n])*\])/gi,'$1[已隐藏]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|secret|authorization|x-api-key|key|token)["']?\s*[:=]\s*)(\{(?:\\.|[^}\r\n])*\})/gi,'$1{已隐藏}')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|secret|authorization|x-api-key|key|token)["']?\s*[:=]\s*)(?!["'\[{])([^\r\n,;&}\]]+?)(?=\s+[\w.-]+["']?\s*[:=]|[,;&}\]\r\n]|$)/gi,'$1[已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi,'[密钥已隐藏]');
}

export function noticeFailureText(snapshot,caption){
  const role=snapshot.roles?.find(r=>r.role==='matrix'),parts=[caption];
  if(role?.failure?.code)parts.push('错误码：'+role.failure.code);
  if(role?.error&&!String(caption).includes(role.error))parts.push('原始错误：'+role.error);
  return redactNoticeText(parts.filter(Boolean).join('\n'));
}

// Reading holds both lifetime timers and automatic DOM changes. Deferred changes
// coalesce by key, so a poll cannot replace the text being selected.
export function createNoticeInteraction(node,onChange=()=>{}){
  const doc=node.ownerDocument,win=doc.defaultView,pending=new Map(),listeners=[];
  let hovered=false,pressed=false,holds=0,locked=false,disposed=false,selectionCache=null;
  const listen=(target,name,fn,options)=>{target.addEventListener(name,fn,options);listeners.push(()=>target.removeEventListener(name,fn,options));};
  function selected(){
    const selection=doc.getSelection();if(!selection||selection.isCollapsed){selectionCache=null;return false;}
    const {anchorNode,anchorOffset,focusNode,focusOffset,rangeCount}=selection,old=selectionCache;
    if(old&&old.selection===selection&&old.anchorNode===anchorNode&&old.anchorOffset===anchorOffset&&old.focusNode===focusNode&&old.focusOffset===focusOffset&&old.rangeCount===rangeCount)return old.value;
    let value=false;
    for(let i=0;i<rangeCount;i++)try{if(selection.getRangeAt(i).intersectsNode(node)){value=true;break;}}catch{}
    selectionCache={selection,anchorNode,anchorOffset,focusNode,focusOffset,rangeCount,value};return value;
  }
  function refresh(){
    if(disposed)return;
    // A range remains selectable while a toast/popover is being hidden or
    // re-laid out. Selection therefore protects the notice independently of
    // CSS visibility; polling must not replace text underneath the selection.
    const next=holds>0||hovered||pressed||node.contains(doc.activeElement)||selected();
    if(next===locked)return;
    locked=next;
    if(!locked){const work=[...pending.values()];pending.clear();for(const update of work)update();}
    onChange(locked);
  }
  listen(node,'pointerenter',()=>{hovered=true;refresh();});
  listen(node,'pointerleave',()=>{hovered=false;refresh();});
  listen(node,'pointerdown',event=>{if(event.button===0){pressed=true;refresh();}});
  const release=()=>{pressed=false;refresh();};
  listen(doc,'pointerup',release,true);listen(doc,'pointercancel',release,true);
  listen(node,'focusin',refresh);listen(node,'focusout',()=>queueMicrotask(refresh));
  // Selection is document-wide; a long chat range must not be walked again
  // for each notice refresh. Endpoints also catch changes before the event.
  listen(doc,'selectionchange',()=>{selectionCache=null;refresh();});listen(win,'blur',()=>{hovered=false;release();});
  listen(node,'copy',event=>{
    if(selected()&&event.clipboardData){event.clipboardData.setData('text/plain',redactNoticeText(doc.getSelection().toString()));event.preventDefault();}
  });
  return {
    get locked(){return locked;},
    refresh(){hovered=node.matches(':hover');refresh();},
    defer(update,key='text'){if(locked)pending.set(key,update);else update();},
    hold(){holds++;refresh();let done=false;return ()=>{if(!done){done=true;holds--;refresh();}};},
    dispose(){disposed=true;pending.clear();for(const remove of listeners)remove();}
  };
}

export function createNoticeCopy(getText,interaction){
  // 不再显示复制按钮（用户 2026-10-24）：双击文字复制，此节点只携带完整文本。
  const button=el('button','复制','quiet notice-copy');button.type='button';button._copyText=()=>redactNoticeText(getText());
  button.setAttribute('aria-label','复制完整提示');
  // A pointer click must preserve the existing text selection.
  button.addEventListener('pointerdown',event=>{if(event.button===0)event.preventDefault();});
  button.onclick=async()=>{
    const release=interaction?.hold();
    try{
      await navigator.clipboard.writeText(redactNoticeText(getText()));
      button.textContent='已复制';button.title='完整文本已复制';
    }catch{button.textContent='手动复制';button.title='未能写入剪贴板，请选中文字后复制';}
    finally{release?.();}
  };
  return button;
}

// Notices share the report store, but reading them never leaves the current view.
export function setupSystemNotices({load,markRead,dismiss=async()=>false,nativeOpen,onOpen=()=>{}}){
  const $=id=>document.getElementById(id),slot=$('system-slot'),bubble=$('system-bubble'),popover=$('system-popover');
  // The top layer escapes titlebar clipping while the DOM position keeps the
  // panel immediately after its trigger in the keyboard focus order.
  popover.setAttribute('popover','manual');
  bubble.classList.add('ui-topbar-trigger');popover.classList.add('ui-topbar-menu');
  const entries=new Map(),contentCache=new Map(),header=el('div',undefined,'system-heading'),count=el('span',undefined,'system-count'),clear=el('button','全部清除','quiet system-clear'),close=el('button','','quiet ui-icon-button system-close'),list=el('div',undefined,'system-list');
  let scope='',revision=0,documents=[],clearing=false,menuEpoch=0,closing=false;
  const interaction=createNoticeInteraction(popover);
  // 关闭用图标；“全部清除”把当前信息全部移出列表（与单条“关闭”同一个动作）。
  close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  close.setAttribute('aria-label','收起系统信息');header.append(count,clear,close);popover.replaceChildren(header,list);
  popover.style.animation='none';
  function hide(focus=false,immediate=false){
    if(bubble.getAttribute('aria-expanded')!=='false')bubble.setAttribute('aria-expanded','false');
    if(!popover.hidden||closing){
      const mine=closing&&!immediate?menuEpoch:++menuEpoch;
      const remove=()=>{if(mine!==menuEpoch)return;try{popover.hidePopover();}catch{}popover.hidden=true;popover.style.pointerEvents='';closing=false;interaction.refresh();};
      if(immediate||popover.hidden){cancelMotion(popover,'notice-presence');remove();}
      else if(!closing){closing=true;popover.style.pointerEvents='none';const from=Number(getComputedStyle(popover).opacity);popover.style.opacity='0';const animation=animateUI(popover,[{opacity:from},{opacity:0}],{kind:'fast',key:'notice-presence'});if(animation)void animation.finished.then(remove,remove);else remove();}
    }
    if(!focus)return;
    // Clearing everything hides the entry itself; keep keyboard focus on the main input instead of BODY.
    const input=document.getElementById('message'),target=!slot.hidden?bubble:input?.checkVisibility?.()?input:document.getElementById('eyra-trigger');target?.focus({preventScroll:true});}
  const topbarRegion=()=>{
    const anchor=slot.getBoundingClientRect(),bar=$('status-anchor').getBoundingClientRect();
    return {left:anchor.left,right:bar.right,width:bar.right-anchor.left};
  };
  function position(){
    if(popover.hidden)return;
    positionTopbarMenu(popover,bubble,{region:topbarRegion,align:'end',minWidth:420});
  }
  function preview(text){return String(text||'').replace(/\s+/g,' ').trim().slice(0,100);}
  function metadata(row,doc){
    row.doc=doc;const title=redactNoticeText(doc.title||'系统信息'),status=doc.read?'已读':'未读';
    if(row.title.textContent!==title)row.title.textContent=title;
    if(row.status.textContent!==status)row.status.textContent=status;row.node.classList.toggle('unread',!doc.read);
    row.read.hidden=!!doc.read&&!row.saving;row.read.disabled=row.saving||!row.loaded;
    const date=new Date(doc.at),valid=Number.isFinite(date.getTime());
    const time=valid?date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
    if(row.time.textContent!==time)row.time.textContent=time;
    row.time.dateTime=valid?date.toISOString():'';row.time.hidden=!valid;
  }
  // 用户刚展开的这一条只显示“正在读取…”占位；读到后立即替换占位，不等指针移开（B035）。
  const fill=update=>update();
  async function content(row){
    if(row.loaded||row.loading||row.queued)return;
    const ticket=revision;row.loading=true;row.message.textContent='正在读取…';row.message.hidden=false;row.retry.hidden=true;row.node.setAttribute('aria-busy','true');
    try{
      const result=contentCache.get(row.doc.id)||await load(row.doc);
      if(ticket!==revision||entries.get(row.doc.id)!==row)return;
      if(result.document?.id!==row.doc.id)throw Error('信息编号不匹配，请重试');
      contentCache.set(row.doc.id,result);
      // System notices are Markdown; even a damaged HTML record remains plain text.
      const text=redactNoticeText(result.content||'');row.queued=true;
      fill(()=>{
        if(ticket!==revision||entries.get(row.doc.id)!==row)return;
        row.queued=false;row.text=text;
        if(result.document.format==='html')row.body.textContent=text;
        else renderMarkdown(row.body,text);
        row.preview.textContent=preview(row.body.textContent)||'（空信息）';row.loaded=true;row.message.hidden=true;row.read.disabled=row.saving;row.copy.disabled=false;
      },'content:'+row.doc.id);
    }catch(error){
      if(ticket!==revision||entries.get(row.doc.id)!==row)return;
      row.queued=true;fill(()=>{
        if(ticket!==revision||entries.get(row.doc.id)!==row)return;
        row.queued=false;row.text=redactNoticeText('暂未读到内容：'+error.message);row.message.textContent=row.text;row.preview.textContent='暂未读到内容';row.retry.hidden=false;row.copy.disabled=false;
      },'content:'+row.doc.id);
    }finally{
      row.loading=false;row.node.setAttribute('aria-busy','false');position();
    }
  }
  function entry(doc){
    const node=el('details',undefined,'system-entry'),summary=el('summary'),title=el('span',undefined,'system-title'),time=el('time'),status=el('span',undefined,'system-read-status sr-only'),hint=el('span',undefined,'system-preview');
    const body=el('div',undefined,'system-content'),message=el('p',undefined,'system-load-status'),actions=el('div',undefined,'system-actions'),read=el('button','标为已读','quiet'),retry=el('button','重试读取','quiet');
    const row={node,summary,title,time,status,preview:hint,body,message,read,retry,doc,text:'',loaded:false,loading:false,saving:false};
    row.copy=createNoticeCopy(()=>row.text,interaction);row.copy.disabled=true;
    node.dataset.noticeId=doc.id;node.open=!doc.read;summary.append(title,status,time,hint);actions.append(row.copy,read,retry);node.append(summary,message,body,actions);retry.hidden=true;
    node.addEventListener('toggle',()=>{if(node.open&&!popover.hidden&&entries.get(doc.id)===row)void content(row);});
    retry.onclick=()=>void content(row);
    read.onclick=async()=>{
      if(row.saving||!row.loaded)return;
      const ticket=revision;row.saving=true;read.disabled=true;read.textContent='正在保存…';
      try{
        const saved=await markRead(doc.id);
        if(ticket!==revision||entries.get(doc.id)!==row)return;
        if(saved===false)return;
        row.doc={...row.doc,read:true};documents=documents.map(d=>d.id===doc.id?row.doc:d);
        node.open=false;
        if(!documents.some(d=>!d.read))hide(true);
        else {const next=[...entries.values()].find(r=>!r.doc.read);next?.summary.focus({preventScroll:true});}
      }finally{
        row.saving=false;read.textContent='标为已读';metadata(row,row.doc);
      }
    };
    return row;
  }
  function show(id){
    if(!documents.length)return;
    onOpen();
    const from=popover.hidden?0:Number(getComputedStyle(popover).opacity);menuEpoch++;closing=false;cancelMotion(popover,'notice-presence');popover.style.pointerEvents='';popover.style.opacity='1';
    popover.hidden=false;try{popover.showPopover();}catch{}bubble.setAttribute('aria-expanded','true');position();animateUI(popover,[{opacity:from},{opacity:1}],{kind:'fast',key:'notice-presence'});
    const target=entries.get(id);
    if(target){target.node.open=true;target.node.scrollIntoView({block:'nearest'});target.summary.focus({preventScroll:true});}
    for(const row of entries.values())if(row.node.open)void content(row);
  }
  let nativeBusy=false;
  bubble.onclick=async()=>{
    if(nativeOpen&&(['browser-view','settings-view','control-view','link-view'].includes(document.body.dataset.view)||/-module-view$/.test(document.body.dataset.view||''))){
      if(nativeBusy)return;nativeBusy=true;onOpen();bubble.setAttribute('aria-expanded','true');
      const ticket=revision,docs=[...documents],request_id=crypto.randomUUID();let active=true;
      try{
        const rows=docs.slice(0,200).map(doc=>({id:doc.id,title:redactNoticeText(doc.title||'系统信息'),read:!!doc.read,at:doc.at,content:null}));
        const box=topbarMenuGeometry(bubble,{region:topbarRegion,align:'end',minWidth:420}),opened=nativeOpen({request_id,x:box.left,y:box.top,attachment:{kind:'topbar',width:box.width,maxHeight:box.maxHeight},rows});
        // Present metadata immediately. Bounded background reads never gate the
        // first frame, and updates preserve each row's expansion and scroll.
        let cursor=0;
        const hydrate=async()=>{while(active&&ticket===revision&&cursor<rows.length){
          const row=rows[cursor++];if(row.content!==null)continue;
          try{const result=contentCache.get(row.id)||await load(docs.find(d=>d.id===row.id));if(result.document?.id!==row.id)throw Error('信息编号不匹配，请重试');if(ticket===revision)contentCache.set(row.id,result);row.content=redactNoticeText(result.content||'').slice(0,16000);}
          catch(error){row.content=redactNoticeText('读取失败：'+error.message);}
          if(active&&ticket===revision)await nativeOpen({action:'update',request_id,rows:[row]}).catch(()=>{});
        }};
        void Promise.all(Array.from({length:Math.min(4,rows.length)},hydrate));
        const action=await opened;
        if(action?.ok===false)throw Error(action.error);if(ticket!==revision||!action)return;
        if(action==='clear'){for(const doc of docs)await dismiss(doc.id);}
        else if(action.startsWith('read:'))await markRead(action.slice(5));
      }catch(error){bubble.title='系统信息暂未展开：'+error.message;show();}finally{active=false;nativeBusy=false;bubble.setAttribute('aria-expanded','false');}
      return;
    }
    popover.hidden||closing?show():hide();
  };close.onclick=()=>hide(true);
  clear.onclick=async()=>{
    if(clearing||!documents.length)return;
    const ticket=revision;clearing=true;clear.disabled=true;clear.textContent='正在清除…';
    // 离场：逐条向右淡出（时长随全局动效档位，减少动画时为零），再真正移出列表。
    const rows=[...entries.values()];rows.forEach((row,i)=>{row.node.style.transitionDelay=(i*40)+'ms';row.node.classList.add('leaving');});
    const wait=parseFloat(getComputedStyle(document.body).getPropertyValue('--t2'))||0;
    await new Promise(r=>setTimeout(r,wait?wait+rows.length*40:0));
    try{for(const doc of [...documents]){if(ticket!==revision)return;await dismiss(doc.id);}hide(true);}
    finally{clearing=false;clear.disabled=false;clear.textContent='全部清除';}
  };
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#system-slot,#system-popover'))hide();});
  // Capture: the open notice panel takes Escape before the input below can fold.
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popover.hidden&&!event.isComposing){event.preventDefault();event.stopPropagation();hide(true);}},true);
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  function paint(nextScope,next){
    if(scope!==nextScope){scope=nextScope;revision++;hide(false,true);entries.clear();contentCache.clear();list.replaceChildren();popover.scrollTop=0;}
    documents=next.filter(d=>d.kind==='system'&&!d.dismissed);
    if(!documents.length&&!entries.size&&slot.hidden&&popover.hidden&&!closing)return;
    const unread=documents.filter(d=>!d.read).length,keep=new Set(documents.map(d=>d.id));
    slot.hidden=!documents.length;bubble.classList.toggle('unread',unread>0);
    bubble.title=unread?'系统信息 · '+unread+' 条未读':'系统信息 · 已读';bubble.setAttribute('aria-label',bubble.title);count.textContent=unread?'系统信息 · '+unread+' 条未读':'系统信息';
    for(const [id,row] of entries)if(!keep.has(id)){row.node.remove();entries.delete(id);contentCache.delete(id);}
    documents.forEach((doc,index)=>{
      let row=entries.get(doc.id);if(!row){row=entry(doc);entries.set(doc.id,row);}
      metadata(row,doc);if(list.children[index]!==row.node)list.insertBefore(row.node,list.children[index]||null);
      if(!popover.hidden&&row.node.open)void content(row);
    });
    if(!documents.length)hide(false,true);position();
  }
  return {show,get visible(){return !popover.hidden||nativeBusy;},paint(nextScope,next){
    if(clearing)paint(nextScope,next);
    else interaction.defer(()=>paint(nextScope,next),'paint');
  }};
}
