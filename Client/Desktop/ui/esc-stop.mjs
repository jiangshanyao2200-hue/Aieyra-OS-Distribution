// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ESC_STOP_HOLD; bindEscStop
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/esc-stop.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 执行中连按两次 Esc 停止（用户 2026-10-25）：第一次只在顶部空白处亮一句短提示，
// 提示消失前再按一次才停止。第一次 Esc 照常做它原来的事（收起输入框、返回上一页），
// 不另吞键；长按自动重复、输入法组字、菜单 / 对话框 / 面板这些自己要 Esc 的层都不算数。
export const ESC_STOP_HOLD=2500;
export function bindEscStop({doc=document,stop,token=()=>'',blocked=()=>false,hold=ESC_STOP_HOLD}={}){
 const win=doc.defaultView,stopButton=stop||doc.getElementById('stop');
 if(!stopButton)return null;
 const hint=doc.createElement('div');
 hint.id='esc-stop-hint';hint.className='esc-stop-hint';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');hint.hidden=true;
 hint.innerHTML='<span class="esc-stop-spark" aria-hidden="true"></span><span class="esc-stop-text"></span>';
 doc.body.append(hint);
 const text=hint.querySelector('.esc-stop-text');
 let armed=null,timer=0,leaveTimer=0;
 const running=()=>!stopButton.hidden&&!stopButton.disabled;
 function show(message,state,duration){
  win.clearTimeout(timer);win.clearTimeout(leaveTimer);
  text.textContent=message;hint.dataset.state=state;hint.hidden=false;
  place();
  // 重新触发入场动画：同一提示再次亮起时也有那一下“叮”。
  hint.classList.remove('esc-stop-ping');void hint.offsetWidth;hint.classList.add('esc-stop-ping');
  timer=win.setTimeout(leave,duration);
 }
 // 落在标题栏里最宽的那段空白正中（左边是导航键，右边是用量统计和窗口按钮，窄窗口里位置会变）；
 // 空白放不下就落到标题栏下方，不压任何字。
 function place(){
  const bar=doc.getElementById('status-anchor'),box=bar?.getBoundingClientRect();
  hint.style.left='';hint.style.top='';delete hint.dataset.place;
  if(!box?.width)return;
  const taken=[...bar.querySelectorAll('*')].filter(n=>(n.matches('button,svg,img')||n.childElementCount===0&&n.textContent.trim())&&!n.closest('button:not(:scope)')).map(n=>n.getBoundingClientRect()).filter(r=>r.width&&r.height).sort((a,b)=>a.left-b.left);
  let from=box.left,best={width:0,center:0};
  for(const r of taken){if(r.left-from>best.width)best={width:r.left-from,center:(from+r.left)/2};from=Math.max(from,r.right);}
  if(box.right-from>best.width)best={width:box.right-from,center:(from+box.right)/2};
  if(best.width>=hint.offsetWidth+32){hint.style.left=best.center+'px';hint.style.top=(box.top+box.height/2)+'px';}
  else hint.dataset.place='below';
 }
 // 自然到时：淡出的这一小段仍算“消失之前”，第二下照样停止；完全看不见了才作废。
 function leave(){
  win.clearTimeout(timer);
  if(hint.hidden){armed=null;return;}
  hint.dataset.state='leaving';
  leaveTimer=win.setTimeout(()=>{armed=null;hint.hidden=true;hint.classList.remove('esc-stop-ping');},doc.body.classList.contains('reduce-motion')?0:220);
 }
 // 任务结束、换页、失焦：立即作废，提示照常淡出。
 function clear(){const was=armed;armed=null;if(was&&hint.dataset.state==='armed')leave();}
 // 返回 true 表示这次 Esc 已用来停止（调用方应吞掉它）。
 function press(){
  if(!running()){clear();return false;}
  const now=win.performance.now(),key=String(token()||'');
  if(armed&&armed.key===key){
   armed=null;show('正在停止…','stopping',900);stopButton.click();return true;
  }
  armed={key,at:now};show('再按一次 Esc 停止','armed',hold);return false;
 }
 function keydown(event){
  if(event.key!=='Escape')return;
  // 长按：自动重复的 Esc 既不提示也不停止；已在等第二下时吞掉，免得连续收起层层界面。
  if(event.repeat){if(armed){event.preventDefault();event.stopPropagation();}return;}
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||!running()||blocked(event))return;
  if(press()){event.preventDefault();event.stopPropagation();}
 }
 win.addEventListener('keydown',keydown,true);
 // 任务结束 / 换了一回合、切页、窗口失焦，等待中的第二下都作废。
 const observer=new win.MutationObserver(()=>{if(!running())clear();});
 observer.observe(stopButton,{attributes:true,attributeFilter:['hidden','disabled']});
 const changed=()=>{if(armed&&win.performance.now()-armed.at>400)clear();};
 doc.addEventListener('workspace-view-change',changed);
 win.addEventListener('blur',clear);
 return {press,clear,element:hint,close(){win.removeEventListener('keydown',keydown,true);observer.disconnect();doc.removeEventListener('workspace-view-change',changed);win.removeEventListener('blur',clear);win.clearTimeout(timer);win.clearTimeout(leaveTimer);hint.remove();}};
}
