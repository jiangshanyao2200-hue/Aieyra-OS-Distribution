// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: REVEAL; inBottomZone; setupReveal; typingOpens
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/reveal.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 靠近即出现（docs/UI设计知识库.md 形态 §3、§15）：
// 输入框在三种形态里都默认收起；鼠标到窗口底部并**稍停**才升起，路过不触发（用户 2026-10-10：一到就弹会来回误判）。
// 点进去就留下；没点、离开后自动收起。有字、有附件、正在组字或正在输入时一直留着。
// 明确收起（Esc、点光圈、发送后折叠）压过这一次停留：指针离开底部区域再回来才重新自动打开（AIDEBUG I1 P1）。
// 顶栏在任何形态都常驻（UI设计知识库 形态 §15 W1：工作形态收顶栏收益低、显示易错乱，已撤销）。
// 只在首页（聊天、工作形态）靠近底部才自动升起；在设置、Link、历史等其他页面，只有点 Eyra 光圈才打开（用户 2026-10-13：
// 设置里点靠下的项目会误弹输入框）。allow() 返回 false 时不自动打开，已打开的照常按离开规则收起。
export const REVEAL={bottomZone:72,bottomDwellMs:280,bottomLeaveMs:400,margin:16};

// 纯函数：当前指针位置是否在"底部区域"（输入框可见时，输入框本身和它上方一点也算）。
export function inBottomZone(y,{height,composerTop=null,zone=REVEAL.bottomZone,margin=REVEAL.margin}){
 const top=composerTop===null?height-zone:Math.min(height-zone,composerTop-margin);
 return y>=top;
}

export function setupReveal({composer,isOpen,open,close,keep,allow=()=>true,doc=document,win=window}){
 let bottomTimer=0,dwellTimer=0,frame=0,last=null,inside=true,closed=false,suppressed=false;
 const clearBottom=()=>{win.clearTimeout(bottomTimer);bottomTimer=0;};
 const clearDwell=()=>{win.clearTimeout(dwellTimer);dwellTimer=0;};
 function scheduleClose(){
  if(bottomTimer||!isOpen()||keep())return;
  bottomTimer=win.setTimeout(()=>{bottomTimer=0;if(!closed&&isOpen()&&!keep()&&!pointerInBottom())close();},REVEAL.bottomLeaveMs);
 }
 function pointerInBottom(){
  if(!last||!inside)return false;
  const rect=isOpen()?composer.getBoundingClientRect():null;
  return inBottomZone(last.y,{height:win.innerHeight,composerTop:rect&&rect.height?rect.top:null});
 }
 function apply(){
  frame=0;if(closed)return;
  if(!allow()){clearDwell();if(!pointerInBottom())scheduleClose();return;}
  if(pointerInBottom()){
   clearBottom();
   // 稍停：在底部区域里停够时间才打开；中途离开就作废。
   if(!isOpen()&&!dwellTimer&&!suppressed)dwellTimer=win.setTimeout(()=>{dwellTimer=0;if(!closed&&!suppressed&&!isOpen()&&allow()&&pointerInBottom())open();},REVEAL.bottomDwellMs);
  }else{suppressed=false;clearDwell();scheduleClose();}
 }
 const schedule=()=>{if(!frame&&!closed)frame=win.requestAnimationFrame(apply);};
 const move=e=>{last={x:e.clientX,y:e.clientY};inside=true;schedule();};
 const leave=e=>{if(!e.relatedTarget){inside=false;schedule();}};
 const blur=()=>win.setTimeout(schedule,0);
 doc.addEventListener('pointermove',move,{passive:true});
 doc.addEventListener('pointerout',leave);
 composer.addEventListener('focusout',blur);
 return {
  // 保留条件变了（组字结束、草稿清空、附件变化、窗口尺寸变化）时重新评估，不必等下一次鼠标移动（AIDEBUG I1 P3）。
  refresh:schedule,
  // 输入框刚被明确收起：撤销待开的停留；指针此刻在底部区域时，直到它离开前都不自动打开。
  suppress(){clearDwell();clearBottom();suppressed=pointerInBottom();},
  // 明确打开（键入、光圈、Ctrl+Enter）：解除抑制。
  arm(){suppressed=false;},
  close(){closed=true;clearBottom();clearDwell();if(frame)win.cancelAnimationFrame(frame);doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerout',leave);composer.removeEventListener('focusout',blur);},
 };
}

// 键入即唤出：首页没有输入控件聚焦、没有弹窗时，直接打字就打开输入框并把字接进去（焦点在 keydown 里移过去，字随之落进输入框）。
export function typingOpens(event,{editable=false,dialogOpen=false,away=false,composerHidden=true}){
 if(!composerHidden||editable||dialogOpen||away||event.defaultPrevented)return false;
 if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing&&event.key!=='Process')return false;
 return event.key==='Process'||(typeof event.key==='string'&&Array.from(event.key).length===1&&event.key!==' ');
}
