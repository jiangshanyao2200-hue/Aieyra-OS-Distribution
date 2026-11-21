// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PLAN_ORB; mountPlanOrb; setupPlanOrb
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/plan-orb.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 计划泡泡（docs/UI设计知识库.md 形态 §8）：左侧状态栏一个圆，外圈进度弧，右边是"当前任务"胶囊。
// 30 秒规则：每换一个当前任务，胶囊自动展开 30 秒（悬停不影响），之后收起，只在悬停时展开。
// 换任务：胶囊文字向上滚走、下一步从下方滚入，泡泡"啵"一下（放大回弹、一圈涟漪、几粒光点）。
// 全部完成：进度弧走满，最后啵一次；本轮结束后约 8 秒淡出。点击打开玻璃弹窗看完整计划。
import {planModel,renderPlanPage} from './plan-view.mjs';

export const PLAN_ORB={openMs:30000,popMs:460,retireMs:8000};

export function mountPlanOrb(doc=document){
 let rail=doc.getElementById('status-rail');const ownRail=!rail;
 if(!rail){rail=doc.createElement('nav');rail.id='status-rail';rail.setAttribute('aria-label','计划与报告');doc.body.append(rail);}
 const root=doc.createElement('div'),pop=doc.createElement('section');root.id='plan-orb';root.className='rail-orb';root.hidden=true;
 root.innerHTML='<button id="plan-bubble" class="plan-ball" type="button" aria-label="当前计划" aria-expanded="false" aria-controls="plan-pop"><svg class="plan-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="plan-track" cx="22" cy="22" r="20"/><circle class="plan-arc" cx="22" cy="22" r="20" pathLength="100"/></svg><svg class="plan-glyph" viewBox="0 0 24 24" aria-hidden="true"><path class="l1" d="M8 8h9"/><path class="l2" d="M8 12h6"/><path class="l3" d="M8 16h8"/></svg><span class="plan-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></button><div class="plan-pill"><span class="plan-track-text" id="plan-current"></span><small id="plan-count"></small></div>';
 pop.id='plan-pop';pop.hidden=true;pop.setAttribute('aria-label','完整计划');const content=doc.createElement('div');content.id='plan-pop-content';pop.append(content);rail.append(root);doc.body.append(pop);
 const orb=setupPlanOrb({root,button:root.querySelector('button'),track:root.querySelector('#plan-current'),count:root.querySelector('#plan-count'),pop,content,doc});
 return {paint:orb.paint,close(){orb.close();root.remove();pop.remove();if(ownRail)rail.remove();}};
}

export function setupPlanOrb({root,button,track,count,pop,content,doc=document}){
 const win=doc.defaultView;
 let current=null,signature='',timer=0,doneAt=0,open=false,model=null,first=true,painted='',feedbackText='';
 const rail=doc.getElementById('status-rail'),composer=doc.getElementById('composer');
 const reading=doc.getElementById('conversation')||doc.querySelector('.layered-chat-content');
 let layoutFrame=0;const observers=[];
 const set=(el,key,value)=>{if(el&&el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value);};
 // 一帧合并预算；圆栏不占输入区，紧凑时横向增加列，所有详情留在圆栏左侧。
 function layoutRail(){
  layoutFrame=0;if(!rail||doc.body.dataset.desktopPage&&doc.body.dataset.desktopPage!=='home'){crowd();return;}
  const css=win.getComputedStyle(doc.body),number=(key,fallback)=>parseFloat(css.getPropertyValue(key))||fallback;
  const base=doc.body.dataset.chatLayer==='true'?number('--chat-layer-top',0)+64:(doc.body.dataset.form==='work'?number('--work-top',64):number('--titlebar-height',56)+14);
  const dock=doc.getElementById('bottom-bar'),input=dock?.getBoundingClientRect(),inputVisible=input?.height>0;
  const bottom=Math.min(win.innerHeight-16,inputVisible?input.top-16:win.innerHeight-16);
  // 按真实顶栏算：桌面模式放大图标后顶栏变高，圆不能嵌进去。
  const dockBox=doc.getElementById('desktop-dock')?.getBoundingClientRect(),barBottom=dockBox?.height?dockBox.bottom+10:0;
  const top=Math.max(8,Math.max(barBottom,Math.min(base,bottom-44))),space=Math.max(44,bottom-top);
  const items=[...rail.children].filter(e=>!e.hidden);
  const terminals=doc.getElementById('terminal-orbs'),termCount=terminals&&!terminals.hidden?terminals.children.length:0;
  const count=items.length-(termCount?1:0)+termCount;
  const sub=doc.getElementById('sub-orb'),card=doc.getElementById('sub-card');
  const detail=sub&&!sub.hidden&&sub.dataset.crowded!=='true'&&sub.dataset.state==='running'&&sub.dataset.fold!=='line'?Math.max(0,(card?.scrollHeight||0)+22-44):0;
  const full=count*44+Math.max(0,count-1)*14+detail;
  const compact=win.innerHeight<=480||full>space;
  const rows=Math.max(1,Math.min(count||1,Math.floor((space+10)/54)));
  if(rail.dataset.compact!==String(compact))rail.dataset.compact=String(compact);
  set(rail,'--rail-rows',String(rows));set(rail,'--rail-top',top+'px');set(rail,'--rail-space',space+'px');
  const columns=compact?Math.ceil(count/rows):1,edge=parseFloat(css.getPropertyValue('--rail-right'))||16,reserve=edge+columns*44+Math.max(0,columns-1)*10+12;
  set(doc.body,'--rail-panel-right',reserve+'px');
  // Only the activity rail consumes this position. Publishing it on body
  // invalidates unrelated chat descendants whenever the input changes size.
  set(doc.getElementById('activity-orbits'),'--status-rail-bottom',(count?Math.min(bottom,top+(compact?rows*44+(rows-1)*10:full))+14:top)+'px');
  for(const e of items)set(e,'--rail-detail-top',top+'px');
  crowd();
 }
 function scheduleLayout(){if(!layoutFrame)layoutFrame=win.requestAnimationFrame(layoutRail);}
 if(rail){
  const railObserver=new win.MutationObserver(scheduleLayout);railObserver.observe(rail,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-state','data-fold']});observers.push(railObserver);
  const bodyObserver=new win.MutationObserver(scheduleLayout);bodyObserver.observe(doc.body,{attributes:true,attributeFilter:['class','data-form','data-desktop-page','data-session-rail','data-chat-expanded']});observers.push(bodyObserver);
  if(win.ResizeObserver){const observer=new win.ResizeObserver(scheduleLayout);observers.push(observer);observer.observe(rail);if(composer)observer.observe(composer);if(reading)observer.observe(reading);for(const id of ['bottom-bar','desktop-dock']){const n=doc.getElementById(id);if(n)observer.observe(n);}}
  win.addEventListener('resize',scheduleLayout);scheduleLayout();
  doc.addEventListener('workspace-inset-change',scheduleLayout);
 }
 function pulse(){root.classList.remove('pop');void root.offsetWidth;root.classList.add('pop');win.clearTimeout(root._pop);root._pop=win.setTimeout(()=>root.classList.remove('pop'),PLAN_ORB.popMs+80);}
 function expand(){root.dataset.pill='open';win.clearTimeout(timer);timer=win.setTimeout(()=>{root.dataset.pill='hover';},PLAN_ORB.openMs);}
 // 文字换行：旧的一行向上滚走，新的一行从下方滚入。
 function roll(text){
  const old=track.querySelector('.plan-line:not(.out)'),line=doc.createElement('span');
  line.className='plan-line';line.textContent=text;
  if(old&&old.textContent===text)return;
  if(old&&!first){old.classList.add('out');line.classList.add('in');win.setTimeout(()=>old.remove(),420);}
  else track.replaceChildren();
  track.append(line);
  if(line.classList.contains('in'))win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>line.classList.remove('in')));
 }
 // 聊天形态里胶囊会伸进聊天正文（AIDEBUG seq56：125% 下“计划已完成 3/3”压在正文行尾）：放不下时只留圆，悬停仍展开。
 // 按聊天排版变量算正文右缘（列从左边距起、最宽 --chat-max，右边距封顶），与当前形态无关；CSS 只在聊天形态里收起。
 function crowd(){
  const line=track.querySelector('.plan-line:not(.out)');if(root.hidden||!line)return;
  if(feedbackText){
   const room=Math.max(0,Math.floor(button.getBoundingClientRect().left-(reading?.getBoundingClientRect().right??0)-24));
   set(root,'--plan-feedback-room',room+'px');
   root.dataset.feedbackInline=String(room>=112);
   root.dataset.crowded='false';
   return;
  }
  const css=win.getComputedStyle(doc.body),v=name=>parseFloat(css.getPropertyValue(name))||0;
  const textRight=Math.min(win.innerWidth-v('--chat-right'),v('--chat-left')+v('--chat-max'));
  const pill=Math.min(380,win.innerWidth*.36,32+line.scrollWidth+10+count.offsetWidth);
  const ball=button.getBoundingClientRect(),left=ball.left-10-pill;
  // 胶囊向左展开：聊天列右边还有空位才常开，否则只在悬停时出现。
  const crowded=doc.body.dataset.form==='chat'?left<(win.innerWidth+Math.min(v('--chat-max'),textRight))/2+8:true;
  if(root.dataset.crowded!==String(crowded))root.dataset.crowded=String(crowded);
 }
 win.addEventListener('resize',crowd);
 function close(){if(!open)return;open=false;pop.hidden=true;button.setAttribute('aria-expanded','false');}
 function renderDetails(){
  pop.setAttribute('aria-label',feedbackText?'计划状态':'完整计划');
  if(model){renderPlanPage(content,model);return;}
  const reason=doc.createElement('p');
  reason.className='plan-feedback';
  reason.textContent=feedbackText;
  content.replaceChildren(reason);
 }
 function show(){if(!model&&!feedbackText)return;open=true;renderDetails();pop.hidden=false;button.setAttribute('aria-expanded','true');}
 button.onclick=()=>open?close():show();
 // Esc 先关弹窗：挂在 window 的捕获阶段，早于 desktop-shell 在 document 捕获阶段"Esc 收起输入框"的处理（Codex A1 实测发现被它吞掉）。
 const escape=e=>{if(e.key==='Escape'&&open&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();close();}};win.addEventListener('keydown',escape,true);
 const outside=e=>{if(open&&!pop.contains(e.target)&&!root.contains(e.target))close();};doc.addEventListener('pointerdown',outside,true);
 return {
  close(){close();for(const observer of observers)observer.disconnect();win.clearTimeout(timer);win.clearTimeout(root._pop);win.cancelAnimationFrame(layoutFrame);win.removeEventListener('resize',scheduleLayout);win.removeEventListener('resize',crowd);win.removeEventListener('keydown',escape,true);doc.removeEventListener('workspace-inset-change',scheduleLayout);doc.removeEventListener('pointerdown',outside,true);button.onclick=null;},
  paint(plan,{active=false,feedback=''}={}){
   if(!plan){
    const next=JSON.stringify([null,feedback]);if(painted===next)return;painted=next;
    feedbackText=feedback;root.hidden=!feedback;model=null;current=null;doneAt=0;first=true;signature='';
    win.clearTimeout(timer);
    root.classList.remove('done');
    root.dataset.active='false';root.dataset.complete='false';
    root.style.setProperty('--dash','0 100');count.textContent='';
    root.dataset.feedback=String(!!feedback);
    const label=feedback.split('：',1)[0]||'当前计划';
    button.setAttribute('aria-label',label);button.removeAttribute('title');delete button.dataset.tip;
    if(feedback){roll(label);root.dataset.pill='open';crowd();scheduleLayout();if(open)renderDetails();}
    else close();
    return;
   }
   feedbackText='';model=planModel(plan);const now=Date.now();
   if(model.complete&&!active)doneAt||=now;else doneAt=0;
   const retired=!!doneAt&&now-doneAt>PLAN_ORB.retireMs;
   // Live text revisions do not change a plan. Avoid rewriting hidden/text
   // attributes and waking the rail's geometry observer for every delta.
   const nextPaint=JSON.stringify([plan,active,retired]);if(painted===nextPaint)return;painted=nextPaint;
   root.hidden=retired;root.dataset.feedback='false';root.dataset.complete=String(model.complete);root.dataset.active=String(active&&!model.complete);
   const progress=model.total?Math.round(model.done/model.total*100):0;root.style.setProperty('--progress',String(progress));root.style.setProperty('--dash',progress+' 100');
   count.textContent=model.total?model.done+' / '+model.total:'';
   button.setAttribute('aria-label','当前计划：'+model.summary);button.title=model.summary;
   const step=model.complete?'done':model.status+':'+(model.current?.id||model.current?.text||'');
   if(step!==current){
    const changed=current!==null;current=step;
    roll(model.summary);
    if(changed)pulse();
    // 计划完成：一段由慢到快、再由快到慢的闪烁（UI设计知识库 形态 §15 P2），之后照常约 8 秒淡出。
    if(model.complete&&changed){root.classList.remove('done');void root.offsetWidth;root.classList.add('done');}
    if(!model.complete)root.classList.remove('done');
    expand();
   }
   // 本轮结束而计划没走完：胶囊收起，只留圆（悬停仍可看当前一步）；走完的计划约 8 秒后淡出。
   if(!active&&!model.complete){win.clearTimeout(timer);root.dataset.pill='hover';}
   first=false;
   const next=JSON.stringify([plan.key,plan.revision,plan.generation]);
   if(next!==signature){signature=next;if(open)renderDetails();}
   if(retired)close();
   scheduleLayout();crowd();
  },
 };
}
