// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupComposerKeys; setupComposerHistory
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/composer-keyboard.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared keyboard contract for the primary composer and its native top layer.
export function setupComposerKeys(input,{send,isComposing=()=>false,doc=input.ownerDocument,clock=()=>performance.now()}={}){
 let last=0,after=null,waiting=false;
 const changed=()=>{if(waiting){after=input.value;waiting=false;}};
 const key=event=>{
  if(event.key!=='Enter'){last=0;waiting=false;return;}
  if(event.isComposing||isComposing()||event.keyCode===229)return;
  if(event.ctrlKey||event.metaKey){event.preventDefault();last=0;send();return;}
  if(event.shiftKey||event.altKey){last=0;return;}
  const now=clock();
  if(last&&now-last<420&&input.value===after){
   event.preventDefault();last=0;const at=input.selectionStart;
   if(at>0&&at===input.selectionEnd&&input.value[at-1]==='\n'){input.setSelectionRange(at-1,at);doc.execCommand('delete',false);}
   send();return;
  }
  last=now;after=null;waiting=true;
 };
 input.addEventListener('input',changed);input.addEventListener('keydown',key);
 return ()=>{input.removeEventListener('input',changed);input.removeEventListener('keydown',key);};
}
// CLI 式历史（R64）：光标在首行按 ↑ 取上一条已发送消息，在末行按 ↓ 往回翻，翻过最新一条恢复原草稿。
// 用户一旦改动内容，翻历史就结束，改动后的文字成为新的草稿。
export function setupComposerHistory(input,{entries,isComposing=()=>false,onChange=()=>{}}){
 let index=-1,draft='',applying=false;
 const apply=value=>{applying=true;input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new Event('input',{bubbles:true}));applying=false;onChange(value);};
 const reset=()=>{if(!applying)index=-1;};
 const key=event=>{
  if(!['ArrowUp','ArrowDown'].includes(event.key)||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||isComposing()||event.keyCode===229)return;
  if(input.selectionStart!==input.selectionEnd)return;
  const at=input.selectionStart,list=(entries()||[]).filter(v=>typeof v==='string'&&v.trim());
  if(event.key==='ArrowUp'){
   if(input.value.slice(0,at).includes('\n')||index>=list.length-1)return;
   if(index<0&&input.value.trim()&&input.value!==list[list.length-1])draft=input.value;else if(index<0)draft=input.value;
   event.preventDefault();index++;apply(list[list.length-1-index]);
  }else{
   if(index<0||input.value.slice(at).includes('\n'))return;
   event.preventDefault();index--;apply(index<0?draft:list[list.length-1-index]);
  }
 };
 input.addEventListener('keydown',key);input.addEventListener('input',reset);
 return ()=>{input.removeEventListener('keydown',key);input.removeEventListener('input',reset);};
}
