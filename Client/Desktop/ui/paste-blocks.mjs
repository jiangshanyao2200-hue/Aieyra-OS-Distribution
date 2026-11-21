// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: MESSAGE_BYTES; messageBytes; pasteEditorText; marker; PasteDraft; make; sizeText; INK_STYLE; setupPasteBlocks
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/paste-blocks.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {motionAllowed,motionDuration} from './motion.mjs';
export const MESSAGE_BYTES=64*1024;
export const messageBytes=text=>new TextEncoder().encode(text).length;
// Textareas normalize line endings. Preserve untouched bytes, including mixed
// CRLF/LF, and use the source convention only for newly inserted line breaks.
export function pasteEditorText(source,value){
 const normalized=source.replace(/\r\n?/g,'\n');if(value===normalized)return source;
 let start=0,end=0;while(start<normalized.length&&start<value.length&&normalized[start]===value[start])start++;
 while(end<normalized.length-start&&end<value.length-start&&normalized[normalized.length-1-end]===value[value.length-1-end])end++;
 const offsets=[0];for(let i=0;i<source.length;){if(source[i]==='\r'&&source[i+1]==='\n')i+=2;else i++;offsets.push(i);}
 const newline=source.match(/\r\n|\r|\n/)?.[0]||'\n';
 return source.slice(0,offsets[start])+value.slice(start,value.length-end).replace(/\n/g,newline)+source.slice(offsets[normalized.length-end]);
}
const marker=/⟦粘贴 ([a-f0-9-]+) · (\d+) 行⟧/gu;
export class PasteDraft {
  constructor(){this.blocks=new Map();}
  pack(text,{force=false}={}){
    text=this.expand(text);
    // The full payload stays in the draft; keep its inline handle readable.
    const lines=text.split(/\r\n|\r|\n/u).length;
    if(!force&&lines<=3&&Array.from(text).length<=200)return text;
    const used=new Set([...this.blocks.keys()].map(token=>token.match(/^⟦粘贴 (\d+) · /u)?.[1]));
    let id=1;while(used.has(String(id)))id++;
    const token=`⟦粘贴 ${id} · ${lines} 行⟧`;
    this.blocks.set(token,text);return token;
  }
  expand(value){
    const resolve=(value,ancestors)=>{
      if(ancestors.size>64)throw Error('粘贴块嵌套过多，请重新粘贴原文。');
      let text='',at=0;
      for(const match of value.matchAll(marker)){
        const token=match[0];if(!this.blocks.has(token))throw Error('粘贴块已失效，请重新粘贴原文。');
        if(ancestors.has(token))throw Error('粘贴块循环引用，请重新粘贴原文。');
        text+=value.slice(at,match.index)+resolve(this.blocks.get(token),new Set([...ancestors,token]));at=match.index+token.length;
        if(messageBytes(text)>MESSAGE_BYTES)throw Error('消息展开后超过 64 KiB，请分次发送。');
      }
      text+=value.slice(at);if(messageBytes(text)>MESSAGE_BYTES)throw Error('消息展开后超过 64 KiB，请分次发送。');return text;
    };
    return resolve(value,new Set());
  }
  serialize(value){const needed=new Set();const visit=text=>{for(const match of text.matchAll(marker)){const token=match[0];if(needed.has(token))continue;needed.add(token);if(this.blocks.has(token))visit(this.blocks.get(token));}};visit(value);return JSON.stringify({version:1,value,blocks:[...this.blocks].filter(([token])=>needed.has(token))});}
  restore(value,metadata){
    this.blocks.clear();
    if(metadata){const saved=JSON.parse(metadata);if(saved.version!==1||saved.value!==value||!Array.isArray(saved.blocks))throw Error('粘贴草稿不完整，请重新粘贴原文。');
      for(const entry of saved.blocks){if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||typeof entry[1]!=='string'||entry[1].length>MESSAGE_BYTES)throw Error('粘贴草稿不完整。');this.blocks.set(...entry);}}
    this.expand(value);return value;
  }
  clear(){this.blocks.clear();}
  edit(token,text){
    if(!this.blocks.has(token))throw Error('粘贴原文已失效，请重新粘贴。');
    if(text===this.blocks.get(token))return token;
    // A fresh token keeps the previous payload available to native Undo.
    // Reusing a token would silently change the text restored by Ctrl+Z.
    return text?this.pack(text,{force:true}):'';
  }
  ranges(value){return [...value.matchAll(marker)].map(match=>({start:match.index,end:match.index+match[0].length,token:match[0]}));}
  selection(value,start,end,direction){
    for(const range of this.ranges(value)){
      const touches=start===end?(start>range.start&&start<range.end||direction==='backward'&&start===range.end||direction==='forward'&&start===range.start):(start<range.end&&end>range.start);
      if(touches){start=Math.min(start,range.start);end=Math.max(end,range.end);}
    }
    return {start,end};
  }
}

const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
const sizeText=bytes=>bytes<1024?bytes+' B':(bytes/1024).toFixed(bytes<10240?1:0)+' KB';
const INK_STYLE=['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','wordSpacing','lineHeight','textIndent','textTransform','tabSize','whiteSpace','overflowWrap','wordBreak','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','direction'];

// 粘贴块（用户 2026-10-24：“我们又不是 CMD”）：上方是玻璃胶囊（文档图标、行数/大小、首行渐隐预览），
// 展开为可编辑的原文面板；输入框里的记号下面垫一层同排版底片，显示成发光的胶囊。
// 文字始终由输入框自己绘制，输入法、选区与撤销都不受影响。
export function setupPasteBlocks(input,{onChange,onError}){
  const draft=new PasteDraft(),review=make('div','paste-review'),ink=make('div','paste-ink'),rows=new Map();
  review.setAttribute('aria-label','已粘贴的原文');review.hidden=true;ink.setAttribute('aria-hidden','true');ink.hidden=true;
  input.parentElement.prepend(review);input.before(ink);
  let signature='',inked=new Set(),frame=0;
  const replace=(text,start,end)=>{
    // Native editing keeps paste/removal in the same undo stack as typing.
    // End the preceding typing group so one undo affects only this operation.
    input.blur();input.focus({preventScroll:true});input.setSelectionRange(start,end);
    if(!document.execCommand(text?'insertText':'delete',false,text))throw Error('无法修改粘贴块，请重试。');
    input.blur();input.focus({preventScroll:true});
  };
  // 只在文字、记号或输入框尺寸真的变了时重绘底片（R46 性能：每帧重复重建与样式复制造成大量临时分配）。
  let painted='',measured='';
  const paint=()=>{
    const ranges=draft.ranges(input.value);
    ink.hidden=!ranges.length;if(!ranges.length){inked=new Set();painted='';return;}
    const size=input.clientWidth+'x'+input.clientHeight;
    if(size!==measured){measured=size;const style=getComputedStyle(input);for(const key of INK_STYLE)ink.style[key]=style[key];painted='';}
    const key=JSON.stringify([input.value,[...rows.keys()].filter(token=>rows.get(token).matches(':hover,:focus-within'))]);
    if(key===painted){ink.scrollTop=input.scrollTop;return;}
    painted=key;
    // 位置和尺寸由 CSS anchor 跟随输入框（附件行增减、窗口缩放时不会错位）。
    const value=input.value,seen=new Set();let at=0;
    const parts=[];
    for(const {start,end,token} of ranges){
      parts.push(document.createTextNode(value.slice(at,start)));
      const span=make('span','paste-token',token);span.dataset.token=token;
      if(!inked.has(token))span.dataset.new='';
      if(rows.get(token)?.matches(':hover,:focus-within'))span.dataset.active='';
      parts.push(span);seen.add(token);at=end;
    }
    parts.push(document.createTextNode(value.slice(at)+'\u200b'));
    ink.replaceChildren(...parts);ink.scrollTop=input.scrollTop;inked=seen;
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint();});};
  const activate=(token,on)=>{for(const span of ink.querySelectorAll('.paste-token'))if(span.dataset.token===token)span.toggleAttribute('data-active',on);};
  const fill=(body,source,token,details)=>{
    if(source==null){body.append(make('p','paste-lost','粘贴原文已失效，请重新粘贴。'));return;}
    // A legal 64 KiB paste can contain tens of thousands of empty lines. Keep
    // the preview bounded; the draft still owns the exact, complete payload.
    const editor=make('textarea','paste-editor'),footer=make('div','paste-edit-actions'),hint=make('small','paste-edit-hint','Enter 保存 · Shift+Enter 换行'),cancel=make('button','quiet','取消'),save=make('button','quiet ui-outline','保存更改');
    editor.value=source;editor.setAttribute('aria-label','编辑粘贴文本');editor.spellcheck=false;editor.rows=Math.min(8,Math.max(3,source.split(/\r\n|\r|\n/u).length));cancel.type=save.type='button';
    const commit=()=>{
      const range=draft.ranges(input.value).find(r=>r.token===token);if(!range)return;
      try{
        const text=pasteEditorText(source,editor.value);
        draft.expand(input.value.slice(0,range.start)+text+input.value.slice(range.end));
        const replacement=draft.edit(token,text);
        if(replacement!==token){replace(replacement,range.start,range.end);update();onChange();}
        else input.focus({preventScroll:true});
        details.open=false;
      }catch(error){onError(error.message);editor.focus({preventScroll:true});}
    };
    const revert=()=>{editor.value=source;details.open=false;details.querySelector('summary').focus({preventScroll:true});};
    save.onclick=commit;cancel.onclick=revert;
    editor.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229)return;
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.stopPropagation();commit();}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();revert();}
    });
    footer.append(hint,cancel,save);body.append(editor,footer);
  };
  const build=token=>{
    const source=draft.blocks.get(token),[,name,lines]=token.match(/^⟦(粘贴 \d+) · (\d+) 行⟧$/u)||[,token.slice(1,-1),''];
    const row=make('div','paste-block'),details=make('details'),summary=make('summary'),body=make('div','paste-body'),remove=make('button','paste-remove');
    row.dataset.token=token;
    const icon=make('span','paste-icon'),chevron=make('span','paste-chevron');icon.setAttribute('aria-hidden','true');chevron.setAttribute('aria-hidden','true');
    const meta=[lines&&lines+' 行',source!=null&&sizeText(messageBytes(source))].filter(Boolean).join(' · ');
    const first=(source||'').split(/\r\n|\r|\n/u).find(line=>line.trim())?.trim().slice(0,120)||'';
    summary.append(icon,make('span','paste-name',name.replace('粘贴','文本片段')),make('span','paste-meta',meta),make('span','paste-first',first),chevron);
    // 原文在第一次展开时才生成，长文本不拖慢粘贴。
    details.addEventListener('toggle',()=>{if(details.open&&!body.firstChild)fill(body,source,token,details);});
    remove.type='button';remove.setAttribute('aria-label','移除 '+name);remove.title=remove.getAttribute('aria-label');
    remove.onclick=()=>{
      const range=draft.ranges(input.value).find(r=>r.token===token);if(!range)return;
      try{replace('',range.start,range.end);}catch(error){onError(error.message);}
    };
    row.addEventListener('pointerenter',()=>activate(token,true));row.addEventListener('pointerleave',()=>activate(token,row.matches(':focus-within')));
    row.addEventListener('focusin',()=>activate(token,true));row.addEventListener('focusout',()=>setTimeout(()=>activate(token,row.matches(':hover,:focus-within'))));
    details.append(summary,body);row.append(details,remove);return row;
  };
  const leave=row=>{
    const done=()=>{if(row.isConnected&&row.dataset.state==='leaving'){row.remove();review.hidden=!review.childElementCount;}};
    row.dataset.state='leaving';row.inert=true;
    if(!motionAllowed(row)){done();return;}
    row.addEventListener('animationend',done,{once:true});setTimeout(done,motionDuration(row,'enter')+80);
  };
  const update=()=>{
    schedule();
    const tokens=[...new Set(draft.ranges(input.value).map(r=>r.token))],next=JSON.stringify(tokens);
    if(next===signature)return;signature=next;
    const keep=new Set(tokens);
    for(const [token,row] of rows)if(!keep.has(token)){rows.delete(token);leave(row);}
    // 已有的胶囊原地保留（不重播入场），新胶囊插到对应位置。
    let anchor=null;
    for(const token of tokens){
      let row=rows.get(token);
      if(!row){row=build(token);rows.set(token,row);anchor?anchor.after(row):review.prepend(row);}
      else if(anchor&&!(anchor.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING))anchor.after(row);
      anchor=row;
    }
    review.hidden=!review.childElementCount;
  };
  input.addEventListener('scroll',()=>{ink.scrollTop=input.scrollTop;},{passive:true});
  // 底片位置由 CSS anchor 跟随，只有输入框自身尺寸变化才需要重排文字。
  new ResizeObserver(schedule).observe(input);
  const insert=text=>{
    const selected=draft.selection(input.value,input.selectionStart,input.selectionEnd);
    const expanded=draft.expand(input.value.slice(0,selected.start))+draft.expand(text)+draft.expand(input.value.slice(selected.end));
    if(messageBytes(expanded)>MESSAGE_BYTES)throw Error('消息展开后超过 64 KiB，请分次粘贴。');
    const packed=draft.pack(text);replace(packed,selected.start,selected.end);update();onChange();
  };
  input.addEventListener('paste',event=>{
    if(event.clipboardData?.files?.length)return;
    const text=event.clipboardData?.getData('text/plain');if(!text)return;
    try{
      event.preventDefault();insert(text);
    }catch(error){event.preventDefault();onError(error.message);}
  });
  input.addEventListener('beforeinput',event=>{
    if(event.isComposing)return;
    const direction=event.inputType==='deleteContentBackward'?'backward':event.inputType==='deleteContentForward'?'forward':'';
    const selected=draft.selection(input.value,input.selectionStart,input.selectionEnd,direction);
    if(selected.start!==input.selectionStart||selected.end!==input.selectionEnd)input.setSelectionRange(selected.start,selected.end);
  });
  input.addEventListener('compositionstart',()=>{
    const selected=draft.selection(input.value,input.selectionStart,input.selectionEnd);
    input.setSelectionRange(selected.start,selected.end);
  });
  input.addEventListener('input',update);
  return {
    insert,
    expand:()=>draft.expand(input.value),
    save:()=>draft.serialize(input.value),
    restore(value,metadata){
      // 换会话时同名记号可能对应另一段原文，旧胶囊直接撤掉重建。
      for(const row of rows.values())row.remove();rows.clear();signature='';review.replaceChildren();
      input.value=value;try{draft.restore(value,metadata);}catch(error){onError(error.message);}update();},
    clear(){input.value='';draft.clear();update();onChange();},
  };
}
