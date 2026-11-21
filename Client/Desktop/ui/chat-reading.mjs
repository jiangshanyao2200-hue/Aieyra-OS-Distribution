// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat, native-chat
// Regions: createChatReadingIntent; createChatLayoutMotion; blocks; captureChatReading; serializeChatReading; restoreChatReading
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/chat-reading.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Capture a visible paragraph before a layout change. Pixel scrollTop alone
// cannot identify the same text after the work column becomes wider.
import {animateUI,cancelMotion,motionAllowed} from './motion.mjs';

// Only a reading gesture can detach the tail. Sending starts a fresh intent:
// queued scroll events from the previous gesture must not detach it again.
// Native views reset the same owner when the upstream reading revision changes.
export function createChatReadingIntent({following=true,now=()=>performance.now(),grace=800}={}){
 let until=-Infinity;
 return {
  get following(){return following;},
  set following(value){following=value!==false;},
  input(event){
   if(event?.target?.closest?.('.work-transcript,input,textarea,select'))return false;
   if(event?.type==='keydown'&&!['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key))return false;
   if(event?.type==='wheel'&&!event.deltaY)return false;
   until=now()+grace;
   if(event?.type==='wheel'&&event.deltaY<0||event?.type==='keydown'&&['PageUp','Home','ArrowUp'].includes(event.key))following=false;
   return true;
  },
  scrolled(atTail){if(now()>=until)return false;following=!!atTail;return true;},
  reset(value=true){following=value!==false;until=-Infinity;},
 };
}

// One shared owner for identity handoff and scrolling, used by Home and its
// native chat document. Keys identify content; a reused DOM node is not an
// identity and must never fly from its previous turn to the new one.
export function createChatLayoutMotion(root,{live=()=>null,following=()=>true,onSettled=()=>{}}={}){
 const doc=root.ownerDocument,win=doc.defaultView,active=new Set(),marked=new Set(),reveals=new Map();
 // A relocated Halo contributes visual overflow to scrollHeight. Following
 // that temporary range would scroll the retained text under its own avatar.
 const canFollow=()=>following()&&doc.body?.dataset?.chatTransition!=='playing';
 const room=doc.createElement('div');room.className='chat-follow-space';room.setAttribute('aria-hidden','true');root.append(room);
 let revision=0,closed=false,scrollFrame=0,target=null,velocity=0,lastTime=0,scrollPosition=null,viewport='';
 // The legacy viewport has CSS smooth scrolling. An explicit instant write
 // lets this one rAF owner control time, rather than restarting a second
 // browser animation on every frame (which makes identities creep for seconds).
 const scroll=top=>root.scrollTo({top,behavior:'instant'});
 const rows=()=>[...root.querySelectorAll('.chat-entry,#emergence')];
 const key=node=>node?.dataset.id||node?.dataset.readingId||'';
 const avatar=node=>node?.querySelector('.role-ring,#eyra-trigger');
 const name=node=>node?.querySelector('.chat-name,.presence-identity');
 const rect=node=>node?.getBoundingClientRect();
 root.classList?.add('chat-bottom-flow');
 const prepare=()=>{if(room.style.height!=='0px')room.style.height='0px';return 0;};
 const stopRows=()=>{revision++;for(const stop of reveals.values())stop();for(const node of active)cancelMotion(node,'chat-layout');for(const node of marked)delete node.dataset.chatMoving;active.clear();marked.clear();};
 function stopScroll(){if(scrollFrame)win.cancelAnimationFrame(scrollFrame);scrollFrame=0;target=null;velocity=0;lastTime=0;scrollPosition=null;}
 function tick(now){
  scrollFrame=0;if(closed||!canFollow()){stopScroll();return;}
  const dt=Math.min(.035,lastTime?(now-lastTime)/1000:1/60);lastTime=now;
  const max=Math.max(0,root.scrollHeight-root.clientHeight),goal=Math.min(max,target??root.scrollTop),position=Math.min(max,scrollPosition??root.scrollTop);
  velocity+=((goal-position)*144-velocity*24)*dt;
  const step=position+velocity*dt,next=goal>=position?Math.min(goal,Math.max(position,step)):Math.max(goal,Math.min(position,step));scrollPosition=next;scroll(next);
  // Scroll offsets are quantized at the display scale; finish at the requested
  // destination instead of integrating an unrepresentable subpixel forever.
  // Integrate the fractional position, not the quantized DOM offset. At high
  // refresh rates small steps otherwise round to zero and never converge.
  if(Math.abs(goal-next)>.2||Math.abs(velocity)>.8)scrollFrame=win.requestAnimationFrame(tick);
  else{scroll(goal);velocity=0;lastTime=0;scrollPosition=null;onSettled();}
 }
 function follow({snap=false}={}){
  if(closed||!canFollow()){stopScroll();return;}
  const extra=prepare(),max=Math.max(0,root.scrollHeight-root.clientHeight);
  let desired=Math.max(0,max-extra);
  const current=live(),size=root.clientWidth+':'+root.clientHeight+':'+(current?.dataset.work==='true'?current.offsetHeight:'history'),refit=viewport!==size;viewport=size;
  if(refit)stopScroll();
  target=Math.min(max,refit?desired:Math.max(root.scrollTop,target??0,desired));
  // Disabling motion changes how we reach the already resolved target; it
  // must not reverse a stable reading position. Explicit reset still refits.
  if(snap||!motionAllowed(root)){const destination=snap?Math.min(max,desired):target;stopScroll();scroll(destination);return;}
  if(!scrollFrame&&Math.abs(target-root.scrollTop)>.25)scrollFrame=win.requestAnimationFrame(tick);
 }
 function animate(node,frames,options={}){
  if(!node)return;const a=animateUI(node,frames,{kind:'move',key:'chat-layout',...options});
  if(a){active.add(node);return a.finished;}
 }
 function reveal(node,before,after){
  let animation=null,stopped=false,resizeFrame=0,resolve;const done=new Promise(finish=>{resolve=finish;}),deadline=win.performance.now()+560,sizes=new Map();
  const stop=()=>{if(stopped)return;stopped=true;if(resizeFrame)win.cancelAnimationFrame(resizeFrame);resizeFrame=0;observer?.disconnect();reveals.delete(node);resolve();};
  const play=(from,to,duration)=>{
   const a=animateUI(node,[{'--chat-row-height':from.height+'px',overflow:'clip',translate:`${from.x-to.x}px ${from.y-to.y}px`},{'--chat-row-height':to.height+'px',overflow:'clip',translate:'none'}],{kind:'move',key:'chat-layout',duration});
   animation=a;if(!a){stop();return;}active.add(node);
   void a.finished.then(()=>{
    if(stopped||animation!==a)return;
    // A font/image/viewport change can precede ResizeObserver delivery in this
    // very frame. Recheck the actual natural row before dropping the clip.
    const natural=rect(node);
    if(motionAllowed(node)&&natural.width&&natural.height&&Math.abs(natural.height-to.height)>.25)play({...natural,height:to.height},natural,160);
    else stop();
   },()=>{if(animation===a)stop();});
  };
  const observer=win.ResizeObserver?new win.ResizeObserver(entries=>{
   let changed=false;
   for(const entry of entries){const box=entry.borderBoxSize?.[0],r=box?{width:box.inlineSize,height:box.blockSize}:rect(entry.target),old=sizes.get(entry.target);
    if(!old||Math.abs(r.width-old.width)>.1||Math.abs(r.height-old.height)>.1){sizes.set(entry.target,r);changed=true;}
   }
   if(!changed||stopped||resizeFrame||!animation||animation.playState!=='running')return;
   // Native resize may deliver sizes with the preceding animation timestamp.
   // Join the next render frame, retaining the old effect until then. Measure
   // and replace it in that same callback so natural height is never painted.
   resizeFrame=win.requestAnimationFrame(()=>{
    resizeFrame=0;if(stopped||!animation||animation.playState!=='running')return;
    const current=rect(node);animation=null;cancelMotion(node,'chat-layout');const natural=rect(node);
    if(!natural.width||!natural.height||!motionAllowed(node)){stop();return;}
    play(current,natural,Math.max(160,deadline-win.performance.now()));follow();
   });
  }):null;
  reveals.set(node,stop);
  // These contents keep their natural size while the outer row is clipped;
  // observing the animated row or stretched main would feed back every frame.
  for(const content of [node.querySelector('.chat-text,#voice'),avatar(node)])if(content&&observer){sizes.set(content,rect(content));observer.observe(content,{box:'border-box'});}
  play(before,after,560);return done;
 }
 return {
  capture(){
   if(closed||!motionAllowed(root))return null;
   const clip=rect(root),snapshot=new Map();
   for(const node of rows()){const r=rect(node);if(r.width>0&&r.height>0&&r.bottom>clip.top&&r.top<clip.bottom)snapshot.set(key(node),{node,rect:r,avatar:rect(avatar(node)),name:rect(name(node))});}
   // Capture an interrupted animation's real position before cancelling it.
   stopRows();return snapshot;
  },
  commit(snapshot,{kind='insert'}={}){
   if(closed||!snapshot||!motionAllowed(root)){onSettled();return;}
   prepare();const token=++revision,current=live(),pending=[];
   const add=value=>{if(value)pending.push(value);};
   for(const node of rows()){
    const before=snapshot.get(key(node)),r=rect(node);
    if(!r.width||!r.height)continue;
    if(!before){
     // New content starts locally. Existing user text never fades or scales.
     if(node===current&&!node.classList.contains('user')){
      node.dataset.chatMoving='true';marked.add(node);
      const entry=kind==='send'?580:420;
      add(animate(avatar(node),[{transform:'translateY(18px) scale(.76)',opacity:0},{transform:'translateY(3px) scale(.96)',opacity:1,offset:.55},{transform:'none',opacity:1}],{duration:entry}));
      add(animate(name(node),[{transform:'translateY(8px)',opacity:0},{transform:'none',opacity:1}],{duration:360,delay:kind==='send'?180:90,fill:'backwards'}));
      add(animate(node.querySelector('.chat-text,#voice'),[{transform:'translateY(6px)',opacity:0},{transform:'none',opacity:1}],{duration:360,delay:kind==='send'?320:180,fill:'backwards'}));
     }
     else if(node.classList.contains('user'))add(animate(node,[{transform:'translateY(12px)'},{transform:'none'}],{duration:300}));
     continue;
    }
    const dx=before.rect.x-r.x,dy=before.rect.y-r.y;
    if(node.dataset.response==='true'&&node.dataset.work!=='true'&&Math.abs(r.height-before.rect.height)>1){
     // The finished answer becomes natural history. Reveal its real height
     // without scaling text or retaining the work reader's inner scrollbar.
     add(reveal(node,before.rect,r));
    }else if(Math.abs(dx)+Math.abs(dy)>.25)add(animate(node,[{translate:`${dx}px ${dy}px`},{translate:'none'}]));
    // A Brief receives the previous live key. Shrink its actual original
    // identity while leaving text unscaled and the history node in place.
    if(node.dataset.brief==='true'&&before.avatar){
     const ring=avatar(node),a=rect(ring),main=node.querySelector('.chat-main'),n=rect(name(node));
     if(a?.width&&a.height){const x=before.avatar.x-a.x-dx,y=before.avatar.y-a.y-dy;
      add(animate(ring,[{transformOrigin:'0 0',transform:`translate(${x}px,${y}px) scale(${before.avatar.width/a.width},${before.avatar.height/a.height})`},{transformOrigin:'0 0',transform:'none'}],{duration:360}));}
     if(main&&n&&before.name)add(animate(main,[{transform:`translate(${before.name.x-n.x-dx}px,${before.name.y-n.y-dy}px)`},{transform:'none'}],{duration:360}));
    }
   }
   follow({reserve:kind==='send'});
   if(!pending.length){for(const node of marked)delete node.dataset.chatMoving;marked.clear();onSettled();return;}
   void Promise.allSettled(pending).then(()=>{
    if(closed||token!==revision)return;
    for(const node of marked)delete node.dataset.chatMoving;marked.clear();active.clear();
    // Row expansion changes scrollHeight after the initial follow measured it.
    // Reuse the same scroll owner and current reader intent at the natural end;
    // native program chats do not have Home's additional layout observer.
    follow();onSettled();
   });
  },
  follow,
  reset(){stopRows();stopScroll();},
  get active(){return active.size>0||!!scrollFrame;},
  close(){if(closed)return;closed=true;stopRows();stopScroll();room.remove();},
 };
}

function blocks(root){
 return [...root.querySelectorAll('.chat-text, #voice')].flatMap(n=>n.children.length?[...n.children]:[n]);
}
export function captureChatReading(root){
 // Navigation can fire another layout event after the home surface is hidden.
 // Its zero geometry is not a new reading position.
 if(root.checkVisibility?.({checkVisibilityCSS:true})===false)return null;
 const box=root.getBoundingClientRect();if(box.width<=0||box.height<=0)return null;
 const candidates=blocks(root);
 const node=candidates.find(n=>n.getBoundingClientRect().top>=box.top+16&&n.getBoundingClientRect().top<box.bottom)
  ||candidates.find(n=>n.getBoundingClientRect().bottom>box.top+16&&n.getBoundingClientRect().top<box.bottom);
 const row=node?.closest?.('.chat-entry,[data-reading-id]');
 return {node,row:row?.dataset.id||row?.dataset.readingId||'',text:node?.textContent?.slice(0,120)||'',offset:node?node.getBoundingClientRect().top-box.top:0,top:root.scrollTop};
}
export function serializeChatReading(anchor){if(!anchor)return null;const {row='',text='',offset=0,top=0}=anchor;return {row,text,offset,top};}
export function restoreChatReading(root,anchor){
 if(!anchor)return;
 const node=anchor.node?.isConnected&&anchor.node.checkVisibility?.({checkVisibilityCSS:true})!==false?anchor.node:anchor.text?blocks(root).find(n=>(!anchor.row||n.closest?.('.chat-entry,[data-reading-id]')?.dataset.id===anchor.row||n.closest?.('.chat-entry,[data-reading-id]')?.dataset.readingId===anchor.row)&&n.textContent?.startsWith(anchor.text)):null;
 const top=node?root.scrollTop+node.getBoundingClientRect().top-root.getBoundingClientRect().top-anchor.offset:anchor.top;
 root.scrollTo({top,behavior:'instant'});
}
