// A read-only transcript, not a PTY emulator. The caller owns output order,
// retention and whether to follow; this view only paints text and prompt color.
const control=/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const rgb=/^38;2;(\d{1,3});(\d{1,3});(\d{1,3})$/;

export function createReadonlyTerminal(screen,{doc=screen.ownerDocument,following=()=>true,onSelect=()=>{}}={}){
 const win=doc.defaultView||globalThis,viewport=doc.createElement('div'),pre=doc.createElement('pre');
 viewport.className='readonly-terminal';viewport.tabIndex=0;viewport.setAttribute('role','log');viewport.setAttribute('aria-live','off');
 viewport.append(pre);screen.append(viewport);
 const request=win.requestAnimationFrame?.bind(win)||(fn=>win.setTimeout(fn,16));
 const cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout?.bind(win);
 let closed=false,frame=null,state='text',parameters='',color='',lastColor='',lastText=null,stringEsc=false,stringBell=false;
 function follow(){
  if(closed||frame!==null||!following())return;
  frame=request(()=>{frame=null;if(!closed&&following())viewport.scrollTop=viewport.scrollHeight;});
 }
 const owned=range=>pre.contains(range.startContainer)&&pre.contains(range.endContainer);
 function selectionChanged(){
  if(closed)return;const selection=doc.getSelection?.();if(!selection||selection.isCollapsed)return;
  for(let i=0;i<selection.rangeCount;i++)try{const range=selection.getRangeAt(i);if(owned(range)||range.intersectsNode?.(pre)){onSelect();return;}}catch{}
 }
 function clearSelection(){
  if(closed)return;const selection=doc.getSelection?.();if(!selection)return;
  const ranges=[];for(let i=0;i<selection.rangeCount;i++)try{const range=selection.getRangeAt(i);if(owned(range))ranges.push(range);}catch{}
  if(typeof selection.removeRange==='function'){for(const range of ranges)selection.removeRange(range);}
  else if(ranges.length&&ranges.length===selection.rangeCount)selection.removeAllRanges?.();
 }
 doc.addEventListener('selectionchange',selectionChanged);
 const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(follow):null;
 observer?.observe(viewport);observer?.observe(pre);
 function paint(text){
  if(!text)return;
  if(lastText&&lastColor===color){lastText.appendData(text);return;}
  lastText=doc.createTextNode(text);lastColor=color;
  if(color){const span=doc.createElement('span');span.style.color=color;span.append(lastText);pre.append(span);}
  else pre.append(lastText);
 }
 function append(value){
  if(closed||value==null)return;const text=String(value);if(!text)return;
  let index=0,plain=[];
  const flush=()=>{if(plain.length){paint(plain.join(''));plain=[];}};
  const sgr=()=>{
   let next=color;
   if(parameters==='0')next='';
   else{const match=rgb.exec(parameters);if(match&&match.slice(1).every(value=>Number(value)<=255))next='rgb('+match.slice(1).map(Number).join(', ')+')';}
   if(next!==color){flush();color=next;}
  };
  while(index<text.length){
   if(state==='text'){
    control.lastIndex=index;const found=control.exec(text);
    if(!found){plain.push(text.slice(index));break;}
    plain.push(text.slice(index,found.index));index=found.index+1;
    const code=found[0].charCodeAt(0);
    if(code===27)state='escape';
    else if(code===0x9b){state='csi';parameters='';}
    else if([0x90,0x98,0x9d,0x9e,0x9f].includes(code)){state='string';stringBell=code===0x9d;stringEsc=false;}
    continue;
   }
   const ch=text[index++],code=ch.charCodeAt(0);
   if(state==='string'){
    if(code===0x9c||stringBell&&code===7||stringEsc&&ch==='\\'){state='text';stringEsc=false;}
    else stringEsc=code===27;
   }else if(code===27){state='escape';parameters='';}
   else if(state==='escape'){
    if(ch==='['){state='csi';parameters='';}
    else if(ch===']'||ch==='P'||ch==='X'||ch==='^'||ch==='_'){state='string';stringBell=ch===']';stringEsc=false;}
    else state=code>=0x20&&code<=0x2f?'escape-intermediate':'text';
   }else if(state==='escape-intermediate'){
    if(code<0x20||code>0x2f)state='text';
   }else if(state==='csi'){
    if(code>=0x40&&code<=0x7e){if(ch==='m')sgr();state='text';parameters='';}
    else if(code>=0x20&&code<=0x3f){if(parameters.length<64)parameters+=ch;}
    else{state='text';parameters='';}
   }
  }
  flush();follow();
 }
 return {append,follow,clearSelection,
  atBottom(){return closed||viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop<=2;},
  reset(){if(closed)return;clearSelection();pre.replaceChildren();state='text';parameters='';color='';lastColor='';lastText=null;stringEsc=false;stringBell=false;follow();},
  close(){if(closed)return;closed=true;doc.removeEventListener('selectionchange',selectionChanged);observer?.disconnect();if(frame!==null){cancel?.(frame);frame=null;}viewport.remove();lastText=null;}
 };
}
