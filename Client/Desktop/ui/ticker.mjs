// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createTicker
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/ticker.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {animateUI,motionAllowed,motionDuration,observeMotion,setupMotion} from './motion.mjs';

// Link and native shells share scheduling. Hidden tickers retain latest data
// without timers, scrolling animations or accumulated outgoing lines.
export function createTicker(root,{min=1500,prefix='tk'}={}){
 const doc=root.ownerDocument,win=doc.defaultView,frame=doc.createElement('span');
 frame.className=prefix+'-frame';root.replaceChildren(frame);root.setAttribute('role','status');root.setAttribute('aria-live','polite');
 setupMotion(doc);
 let items=[],index=-1,current=null,shownAt=0,timer=0,scroller=null,disposed=false,suspended=true;
 let phase='enter',offset=0,scrollFrom=0,scrollTo=0,scrollDuration=0,urgentKey=null;
 const seen=new Set(),exits=new Map();
 const available=()=>!disposed&&!doc.hidden&&doc.body.dataset.visible!=='false'&&!!items.length&&(!root.checkVisibility||root.checkVisibility({checkVisibilityCSS:true}))&&root.getBoundingClientRect().width>0;
 const stopScroll=()=>{
  if(scroller){
   const time=scroller.currentTime;
   if(typeof time==='number'&&scrollDuration>0)offset=scrollFrom+(scrollTo-scrollFrom)*Math.min(1,Math.max(0,time/scrollDuration));
   scroller.cancel();scroller=null;
  }
  if(current)current.style.transform=`translateX(${offset}px)`;
 };
 const stop=()=>{win.clearTimeout(timer);timer=0;urgentKey=null;stopScroll();};
 const cleanExits=()=>{for(const [node,id] of exits){win.clearTimeout(id);node.remove();}exits.clear();};
 const schedule=(fn,ms,urgent=false)=>{if(urgentKey&&!urgent)return;win.clearTimeout(timer);timer=available()?win.setTimeout(()=>{timer=0;if(available())fn();else pause();},ms):0;};
 const dwell=item=>Math.min(9000,Math.max(4200,2600+[...item.text].length*90));
 function pause(){suspended=true;stop();cleanExits();}
 function measure(){
  if(!available()||!current)return pause();
  const line=current,item=items[index];if(!item)return;
  stopScroll();line.classList.remove('in','long');
  const over=line.scrollWidth-frame.clientWidth;
  offset=motionAllowed(doc)?Math.max(-Math.max(0,over),Math.min(0,offset)):0;
  line.style.transform=`translateX(${offset}px)`;
  // Once a line has been read, new counters must not postpone the next role.
  if(phase==='dwell'){if(over>4)line.classList.add('long');return;}
  if(over>4&&motionAllowed(doc)){
   line.classList.add('long');
   const remaining=over+offset;
   if(remaining<=0){phase='dwell';schedule(next,1600);return;}
   scrollFrom=offset;scrollTo=-over;
   scrollDuration=phase==='scroll'?remaining/46*1000:Math.max(1600,remaining/46*1000);
   phase='scroll';
   const animation=animateUI(line,[{transform:`translateX(${offset}px)`},{transform:`translateX(${-over}px)`}],{key:'scroll',duration:scrollDuration,easing:'linear',fill:'forwards'});
   scroller=animation;
   if(animation)animation.finished.then(()=>{if(current===line&&scroller===animation){phase='dwell';schedule(next,1600);}},()=>{});
   else{phase='dwell';schedule(next,dwell(item));}
  }else{phase='dwell';schedule(next,dwell(item));}
 }
 function show(i){
  stop();if(!available())return pause();suspended=false;
  index=((i%items.length)+items.length)%items.length;
  const item=items[index],line=doc.createElement('span'),dot=doc.createElement('i'),words=doc.createElement('span');
  seen.add(item.key);if(seen.size>256)seen.delete(seen.values().next().value);
  line.className=prefix+'-line';line.dataset.tone=item.tone||'calm';line.dataset.kind=item.kind||'';
  dot.className=prefix+'-dot';dot.setAttribute('aria-hidden','true');words.className=prefix+'-text';words.textContent=item.text;line.append(dot,words);
  const old=current;current=line;phase='enter';offset=0;cleanExits();frame.append(line);root.dataset.tone=line.dataset.tone;root.title=item.text;
  if(old){if(motionAllowed(doc)){old.setAttribute('aria-hidden','true');old.classList.add('out');exits.set(old,win.setTimeout(()=>{old.remove();exits.delete(old);},motionDuration(doc)+40));}else old.remove();}
  if(motionAllowed(doc))line.classList.add('in');shownAt=Date.now();schedule(measure,motionDuration(doc)+40);
 }
 const next=()=>show(index+1);
 function resume(){
  if(!available())return pause();
  if(suspended||!current){suspended=false;show(Math.max(index,0));}
  else if(phase!=='enter')measure();
 }
 function update(list){
  if(disposed)return;
  const key=items[index]?.key,before=new Set(items.map(x=>x.key));
  items=(Array.isArray(list)?list:[]).filter(x=>x&&typeof x.text==='string'&&x.text);root.hidden=!items.length;
  if(!items.length){pause();current?.remove();current=null;index=-1;root.removeAttribute('title');return;}
  const at=key?items.findIndex(x=>x.key===key):-1;
  if(!available()){index=Math.max(0,at);return pause();}
  if(suspended||!current||at<0)return show(Math.max(0,at));
  index=at;
  const words=current.querySelector('.'+prefix+'-text');
  current.dataset.tone=items[at].tone||'calm';current.dataset.kind=items[at].kind||'';root.dataset.tone=current.dataset.tone;
  if(words.textContent!==items[at].text){words.textContent=items[at].text;root.title=items[at].text;if(phase!=='enter')measure();}
  const urgent=items.findIndex(x=>(x.kind==='speech'||x.kind==='alert')&&!before.has(x.key)&&!seen.has(x.key));
  if(urgent>=0&&!urgentKey){urgentKey=items[urgent].key;schedule(()=>{const n=items.findIndex(x=>x.key===urgentKey);show(n<0?index:n);},Math.max(0,min-(Date.now()-shownAt)),true);}
 }
 const stopMotion=observeMotion(doc,resume),resize=win.ResizeObserver?new win.ResizeObserver(resume):null;
 resize?.observe(root);doc.addEventListener('visibilitychange',resume);
 return {update,dispose(){disposed=true;stop();cleanExits();resize?.disconnect();stopMotion();doc.removeEventListener('visibilitychange',resume);frame.replaceChildren();}};
}
