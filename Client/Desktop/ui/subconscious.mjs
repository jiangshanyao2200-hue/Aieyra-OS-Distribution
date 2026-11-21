// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: SUB_ORB; pickActivity; activityTag; when; diaryMeta; setupSubconscious
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/subconscious.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 日记报告保留原阅读回执；活动显示由 subconscious-timeline 共用聊天组件。
import {renderMarkdown} from './markdown.mjs';

export const SUB_ORB={doneMs:25000,failedMs:90000,pillMs:30000,leaveMs:420,dissolveMs:900};

// 显示哪一条：有正在等的先显示等的，其次最新的进行中；都没有时，刚做完的那条在保留时间内折叠显示。
export function pickActivity(view,now=Date.now()){
 const list=Array.isArray(view?.activities)?view.activities:[];
 const running=list.filter(a=>a.state==='running');
 if(running.length)return running.findLast(a=>a.waiting)||running[running.length-1];
 const last=list[list.length-1];
 if(!last?.finished)return null;
 return now-last.finished<(last.state==='failed'?SUB_ORB.failedMs:SUB_ORB.doneMs)?last:null;
}

export function activityTag(a){
 if(a.actor==='eyra')return a.state==='running'?'Eyra 在整理记忆':'Eyra 整理了记忆';
 if(a.state==='running')return a.waiting?'潜意识已介入 · Eyra 在等它':'潜意识已介入';
 return a.state==='failed'?'潜意识没做成':'潜意识';
}

function when(ms){
 if(!ms)return '';
 const d=new Date(ms),pad=n=>String(n).padStart(2,'0');
 return `${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function diaryMeta(d){
 const parts=[d.created?'写于 '+when(d.created):''];
 if(d.first_at&&d.last_at){
  const a=when(d.first_at).split(' ')[0],b=when(d.last_at).split(' ')[0];
  parts.push('记的是 '+(a===b?a:a+' – '+b)+' 的事');
 }
 return parts.filter(Boolean).join(' · ');
}

export function setupSubconscious(api,{check=r=>r,notice=()=>{},doc=document}={}){
 const win=doc.defaultView,$=id=>doc.getElementById(id);
 const diaryOrb=$('diary-orb'),diaryBall=$('diary-ball'),diaryTitle=$('diary-current');
 const pop=$('diary-pop'),popTitle=$('diary-pop-title'),popMeta=$('diary-pop-meta'),popBody=$('diary-pop-body'),popClose=$('diary-pop-close');
 let taskId='';
 let diary=null,opened=null,closing=null,pillTimer=0,dissolveTimer=0,loading=false,readRevision=0,layoutFrame=0;
 const dismissed=new Set();
 const reduced=()=>doc.body.classList.contains('reduce-motion')||win.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const data=(el,key,value)=>{const next=String(value);if(el.dataset[key]!==next)el.dataset[key]=next;};
 // 用展开内容的宽度判断，收成圆后仍能重新展开；测量合到一帧，不在快照回调里来回改布局。
 function layout(){
  layoutFrame=0;
  if(diaryOrb.hidden)return;
  const css=win.getComputedStyle(doc.body),v=name=>parseFloat(css.getPropertyValue(name))||0;
  const textRight=Math.min(win.innerWidth-v('--chat-right'),v('--chat-left')+v('--chat-max'));
  const crowded=(rect,width,height=rect.height)=>{
   if(doc.body.dataset.form==='chat')return rect.left-10-width<(win.innerWidth+Math.min(v('--chat-max'),textRight))/2+8;
   if(doc.body.dataset.form==='work')return true;
   return ['answer-stage'].some(id=>{const e=$(id);if(!e||e.hidden)return false;const r=e.getBoundingClientRect();return r.width&&r.height&&rect.left-10-width<r.right+8&&rect.left-10>r.left&&rect.top+height>r.top&&rect.top<r.bottom;});
  };
  if(!diaryOrb.hidden){
   const label=diaryOrb.querySelector('.diary-pill small'),width=Math.min(260,win.innerWidth*.22,40+(label?.scrollWidth||0)+diaryTitle.scrollWidth);
   data(diaryOrb,'crowded',crowded(diaryBall.getBoundingClientRect(),width));
  }
 }
 function scheduleLayout(){if(!layoutFrame)layoutFrame=win.requestAnimationFrame(layout);}
 win.addEventListener('resize',scheduleLayout);
 new win.MutationObserver(scheduleLayout).observe(doc.body,{attributes:true,attributeFilter:['style','data-form','data-desktop-page']});
 const rail=$('status-rail');if(win.ResizeObserver){const observer=new win.ResizeObserver(scheduleLayout);for(const e of [rail,$('bottom-bar')])if(e)observer.observe(e);}

 // ---- 日记圆 ----
 function pill(){diaryOrb.dataset.pill='open';win.clearTimeout(pillTimer);pillTimer=win.setTimeout(()=>{diaryOrb.dataset.pill='hover';},SUB_ORB.pillMs);}
 function paintDiary(d){
  if(d&&dismissed.has(d.id))d=null;
  if((d?.id||0)===(diary?.id||0)){
   if(d&&d.title!==diary.title){diary=d;diaryTitle.textContent=d.title?'《'+d.title+'》':'Eyra 的日记';scheduleLayout();}
   return;
  }
  // 新日记或换任务使旧的读取失效；done 引起的空快照仍等关闭回执完成消散。
  if(d||!closing){readRevision++;loading=false;opened=null;pop.hidden=true;diaryBall.setAttribute('aria-expanded','false');}
  if(d){closing=null;win.clearTimeout(dissolveTimer);diaryOrb.classList.remove('dissolve');}
  diary=d;
  if(!d){win.clearTimeout(pillTimer);if(!closing&&!diaryOrb.classList.contains('dissolve'))diaryOrb.hidden=true;return;}
  diaryOrb.classList.remove('dissolve');
  diaryOrb.hidden=false;
  diaryTitle.textContent=d.title?'《'+d.title+'》':'Eyra 的日记';
  diaryBall.setAttribute('aria-label','Eyra 给你看的日记'+(d.title?'：'+d.title:''));
  diaryOrb.classList.remove('arrive');void diaryOrb.offsetWidth;diaryOrb.classList.add('arrive');
  pill();
  scheduleLayout();
 }
 async function openDiary(){
  if(!diary||loading)return;
  if(opened){closeDiary();return;}
  const target=diary,session=taskId,revision=++readRevision;
  const current=()=>taskId===session&&diary?.id===target.id&&readRevision===revision;
  loading=true;
  try{
   const response=await api.diary({task_id:session,action:'read',id:target.id});
   if(!current())return;
   const result=check(response);
   const d=result.diary||{};
   if(d.id!=null&&d.id!==target.id)throw new Error('这篇日记已经更新，请重新打开。');
   popTitle.textContent=d.title||target.title||'Eyra 的日记';
   popMeta.textContent=diaryMeta(d);
   renderMarkdown(popBody,String(d.content||''));
   popBody.scrollTop=0;
   // 通过计划圆已有的关闭处理收起旧弹窗，保证一次 Esc 关当前日记，再到输入框。
   const planPop=$('plan-pop');if(planPop&&!planPop.hidden)$('plan-bubble')?.click();
   pop.hidden=false;
   diaryBall.setAttribute('aria-expanded','true');
   opened={...target,task_id:session};
   win.requestAnimationFrame(()=>{if(current()&&opened?.id===target.id)popClose.focus({preventScroll:true});});
  }catch(error){if(current())notice(error.message,true);}
  finally{if(readRevision===revision)loading=false;}
 }
 // 看过之后关上：记为已读，这个圆就消散。
 async function closeDiary(){
  if(!opened)return;
  const target=opened,session=target.task_id,revision=++readRevision;opened=null;
  closing={id:target.id,session,revision};
  pop.hidden=true;
  diaryBall.setAttribute('aria-expanded','false');
  const current=()=>taskId===session&&readRevision===revision&&(!diary||diary.id===target.id);
  try{const response=await api.diary({task_id:session,action:'done',id:target.id});if(!current())return;check(response);}
  catch(error){if(current()){closing=null;notice(error.message,true);}return;}
  closing=null;
  dismissed.add(target.id);
  if(diary?.id===target.id)diary=null;
  diaryOrb.classList.add('dissolve');
  win.clearTimeout(pillTimer);win.clearTimeout(dissolveTimer);
  dissolveTimer=win.setTimeout(()=>{if(taskId===session&&readRevision===revision&&diaryOrb.classList.contains('dissolve')){diaryOrb.hidden=true;diaryOrb.classList.remove('dissolve');}},reduced()?0:SUB_ORB.dissolveMs);
 }
 diaryBall.onclick=()=>void openDiary();
 popClose.onclick=()=>void closeDiary();
 $('plan-bubble')?.addEventListener('click',()=>{if(opened)void closeDiary();});
 win.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();void closeDiary();}},true);
 doc.addEventListener('pointerdown',e=>{if(opened&&!pop.contains(e.target)&&!diaryOrb.contains(e.target))void closeDiary();},true);

 return {
  update(snapshot){
   if(snapshot?.session_id&&snapshot.session_id!==taskId){
    // 换了任务视图：各自的潜意识各自显示。
    readRevision++;loading=false;opened=null;closing=null;pop.hidden=true;
    diaryBall.setAttribute('aria-expanded','false');
    taskId=snapshot.session_id;diary=null;dismissed.clear();
    win.clearTimeout(pillTimer);win.clearTimeout(dissolveTimer);diaryOrb.hidden=true;diaryOrb.classList.remove('dissolve','arrive');
   }
   const view=snapshot?.subconscious;
   paintDiary(view?.retired?null:view?.diary||null);
  },
 };
}
