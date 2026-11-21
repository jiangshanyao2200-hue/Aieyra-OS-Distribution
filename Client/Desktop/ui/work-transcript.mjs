// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat
// Regions: tailOverlap; WorkTranscript; workTranscriptSegments; ConversationPresentation; createWorkTranscript
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/work-transcript.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {renderMarkdown} from './markdown.mjs';
import {createTypewriter} from './typewriter.mjs';
import {createThoughtView} from './thought-view.mjs';
import {activityBrief} from './activity.mjs';
import {disposeThemeTree} from '../../../Theme/runtime/layout.mjs';

// The Core thought projection is a sliding UTF-8 tail, not the full thought.
// Find the observed overlap in linear time without repeating that tail.
function tailOverlap(previous,next){
 const text=next+'\u0000'+previous.slice(-next.length),prefix=new Uint32Array(text.length);
 for(let i=1;i<text.length;i++){let n=prefix[i-1];while(n&&text[i]!==text[n])n=prefix[n-1];if(text[i]===text[n])n++;prefix[i]=n;}
 return Math.min(next.length,prefix.at(-1)||0);
}


// A presentation journal for one work generation. Phase changes append to the
// same viewport; they never replace its identity, halo or previous paragraphs.
// Core remains the owner of the complete, durable thought/tool/message record.
export class WorkTranscript {
 constructor(){this.key=null;this.rows=[];this.sequence=0;this.seen=new Map();this.sources={};this.revision=0;this.cached=null;}
 update({key='',phase='',thought='',text='',briefs=[],live={}}={}){
  let changed=false;
  if(this.key!==key){this.key=key;this.rows=[];this.sequence=0;this.seen.clear();this.sources={};changed=true;}
  const recordBrief=brief=>{
   const id=brief.id||brief.call_id;if(!id)return;
   const value=activityBrief(brief);if(!value)return;
   let row=this.seen.get(id);
   if(!row){row={id:'brief:'+id,kind:'brief',text:value};this.seen.set(id,row);this.rows.push(row);changed=true;}
   if(row.text!==value||row.state!==(brief.state||''))changed=true;
   row.text=value;row.state=brief.state||'';
  };
  // A short tool can finish between polls. Its receipt precedes the next
  // model pass even when both first arrive in the same snapshot.
  const textStarted=phase==='thinking'?Number(live.reasoning_started_at):Number(live.body_at)/1000;
  if(textStarted>0)for(const brief of briefs)if(brief.started_at>0&&brief.started_at/1000<textStarted)recordBrief(brief);
  // A poll can combine the last thought chunk with the first body chunk, when
  // the status projection already hides thought. Read that public tail using
  // its reasoning identity: a new request can still carry the old thought.
  const reasoning=live.reasoning_history?.at(-1),ownsThought=Number(live.reasoning_started_at)>0||!!live.body_id&&reasoning?.started_at>0&&reasoning.id===`${live.body_id}:${reasoning.started_at}`;
  const publicThought=(phase==='thinking'||ownsThought)&&live.thought||thought;
  for(const [kind,value]of [['thinking',publicThought],['body',text]]){
   // Core retains the preceding body while the next model request is empty.
   // Its new request ID cannot give those old bytes a new paragraph identity.
   if(kind==='body'&&live.new_body)continue;
   if(!value||kind==='thinking'&&live.new_body&&phase!=='thinking'&&!ownsThought)continue;
   const source=kind==='body'?live.body_id&&live.body_id+':'+(live.body_at||0):live.reasoning_started_at?live.body_id+':'+live.reasoning_started_at:live.reasoning_history?.at(-1)?.id||live.body_id||'';
   const old=this.sources[kind];
   if(old?.source===(source||'')&&old.raw===value)continue;
   // A retained thought may coexist with new body text. Only a real change
   // starts a paragraph, and a new model pass cannot rewrite an earlier pass.
   const overlap=kind==='thinking'&&old?tailOverlap(old.raw,value):0;
   const continues=old&&old.source===(source||'')&&(source||String(value).startsWith(old.raw)||overlap);
   const row=continues?old:{id:'text:'+ ++this.sequence,kind,text:'',source:source||'',raw:''};
   if(!continues)this.rows.push(row);
   if(continues&&kind==='thinking'){
    if(String(value).startsWith(row.raw))row.text+=String(value).slice(row.raw.length);
    else if(overlap)row.text+=String(value).slice(overlap);
    else row.text+='\n\n'+value;
   }else row.text=String(value);
   row.raw=String(value);this.sources[kind]=row;
   changed=true;
  }
  for(const brief of briefs)recordBrief(brief);
  if(changed){this.revision++;this.cached=null;}
  return this.rows;
 }
 snapshot(){
  // Only display fields cross renderers; raw tails and source bookkeeping stay
  // with the owner. Reuse an immutable projection until its text changes.
  return this.cached??=Object.freeze({key:this.key,revision:this.revision,rows:Object.freeze(this.rows.map(({id,kind,text,state})=>Object.freeze({id,kind,text,...(state?{state}:{})})))});
 }
}

// The previous live identity becomes this exact Brief row. A new identity is
// born below it; no avatar travels through the intervening conversation.
// Both Home renderers consume the same immutable partition of the real journal.
export function workTranscriptSegments(journal){
 let boundary=-1,segment='start';const briefs=[];
 const key=()=>JSON.stringify([journal.key,segment]);
 for(let i=0;i<journal.rows.length;i++){
  const row=journal.rows[i];if(row.kind!=='brief'||!row.text.trim())continue;
  briefs.push(Object.freeze({key:key(),text:row.text,state:row.state||'',source:row.id}));
  segment=row.id;boundary=i;
 }
 return {briefs,current:Object.freeze({key:key(),revision:journal.revision,rows:Object.freeze(journal.rows.slice(boundary+1))})};
}

// Private OS and program conversations use the same journal/Brief partition as
// Home. Stable display keys survive final persistence and never carry live
// bytes across an execution generation or Core restart.
export class ConversationPresentation {
 constructor(){this.scope='';this.turns=new Map();}
 project(messages,{scope='',agentId='',generation=0,active=false,waiting=false,live={},briefs=[],status='',identity,role='conversation',problem=null}={}){
  if(this.scope!==scope){this.scope=scope;this.turns.clear();}
  const owns=live.generation===generation&&(!live.agent_id||live.agent_id===agentId),current=owns?live:{},phase=current.phase||(current.text?'body':current.thought?'thinking':'waiting');
  const final=messages.findLast(m=>m.from==='eyra'&&!m.process&&!m.talk&&!m.brief&&m.generation===generation),show=!!problem||active||waiting||!final&&this.turns.has(generation);
  let turn=this.turns.get(generation);
  if(show){
   if(!turn){turn={journal:new WorkTranscript()};this.turns.set(generation,turn);}
   const value={key:scope+':'+generation,phase,live:current,thought:current.thought||'',text:current.new_body?'':current.text||'',briefs};
   turn.journal.update(value);turn.segments=workTranscriptSegments(turn.journal.snapshot());
  }
  const out=[],seen=new Set(),appendBriefs=g=>{if(g!==generation||!active||seen.has(g))return;seen.add(g);for(const row of this.turns.get(g)?.segments?.briefs||[])out.push({id:'conversation-work:'+row.key,from:'eyra',role,identity,text:row.text,brief:true,generation:g});};
  for(const message of messages){
   if(problem&&message===final)continue;
   const saved=this.turns.get(message.generation);
   if(message.from==='eyra'&&!message.process&&!message.talk&&!message.brief&&saved?.segments){
    appendBriefs(message.generation);
    out.push({...message,id:'conversation-work:'+saved.segments.current.key,snapshotId:message.id,response:true});
   }else out.push(message);
  }
  if(show&&turn?.segments){
   appendBriefs(generation);
   // Final persistence can precede the terminal state by one observation.
   const id='conversation-work:'+turn.segments.current.key;
   if(problem)out.push({...problem,id,response:true});
   else if(!final)out.push({id,from:'eyra',role,identity,generation,response:true,streaming:active,phase,haloState:phase,work:{key:turn.segments.current.key,phase,journal:turn.segments.current,status}});
  }
  const keep=new Set([generation,...messages.map(m=>m.generation)]);for(const g of this.turns.keys())if(!keep.has(g))this.turns.delete(g);
  return out;
 }
}

export function createWorkTranscript(root,{onReading,wholeLines=false}={}){
 const doc=root.ownerDocument,win=doc.defaultView,model=new WorkTranscript(),nodes=new Map(),parts=new WeakMap();
 let scope=null,closed=false,following=true,userUntil=0,frame=0,active=null,suspended=false,sized=false,anchor=null,projection=null,lastValue=null,scrollTarget=null;
 root.classList.add('work-transcript');root.setAttribute('tabindex','0');root.setAttribute('aria-label','工作过程');
 const bottom=()=>Math.max(0,root.scrollHeight-root.clientHeight);
 // ResizeObserver supplies size after layout. Streaming must not force a new
 // style/layout pass after every Markdown write just to check visibility.
 const visible=()=>!suspended&&sized&&doc.visibilityState!=='hidden'&&root.isConnected&&!root.closest('[hidden]');
 const read=()=>({following,anchor:anchor?{...anchor}:null});
 const scroll=top=>{root.scrollTop=top;scrollTarget=root.scrollTop;};
 const originalClip=wholeLines?root.style.clipPath:'';
 function clipLines(){
  if(!wholeLines)return;
  // A compact reader still uses the user's independent thinking/body fonts.
  // Their line heights need not divide its avatar-sized viewport. Preserve
  // the real tail and reading position, but omit boundary fragments instead
  // of painting half a glyph. Run only after layout/restore, never per delta.
  const box=root.getBoundingClientRect(),walker=doc.createTreeWalker(root,win.NodeFilter.SHOW_TEXT);
  let node,top=0,bottom=0;
  while((node=walker.nextNode())){
   if(!node.textContent.trim())continue;
   const range=doc.createRange();range.selectNodeContents(node);
   for(const r of range.getClientRects()){
    if(r.top<box.top-.5&&r.bottom>box.top+.5)top=Math.max(top,r.bottom-box.top);
    if(r.top<box.bottom-.5&&r.bottom>box.bottom+.5)bottom=Math.max(bottom,box.bottom-r.top);
   }
  }
  const clip=top||bottom?`inset(${top}px 0px ${bottom}px)`:originalClip;
  if(root.style.clipPath!==clip)root.style.clipPath=clip;
 }
 function remember(){
  if(!visible())return;
  const box=root.getBoundingClientRect();if(box.width<=0||box.height<=0)return;
  const candidates=[...nodes.entries()].flatMap(([id,part])=>[...part.body.children].map((node,index)=>({node,id,index})));
  const item=candidates.find(({node})=>{const r=node.getBoundingClientRect();return r.top>=box.top&&r.top<box.bottom;})||candidates.find(({node})=>{const r=node.getBoundingClientRect();return r.bottom>box.top&&r.top<box.bottom;});
  anchor={row:item?.id||'',block:item?.index||0,text:item?.node.textContent?.slice(0,120)||'',offset:item?item.node.getBoundingClientRect().top-box.top:0,top:root.scrollTop};
 }
 function restore(){
  if(!visible())return;
  if(following)scroll(bottom());
  else{
   const part=anchor&&nodes.get(anchor.row),children=part?[...part.body.children]:[],node=children.find(n=>anchor.text&&n.textContent?.startsWith(anchor.text))||children[anchor?.block];
   if(anchor)scroll(node?root.scrollTop+node.getBoundingClientRect().top-root.getBoundingClientRect().top-anchor.offset:anchor.top);
  }
  clipLines();
 }
 const render=(part,text)=>{renderMarkdown(part.body,text);part.visible=text;};
 const writer=createTypewriter({win,render(node,text){render(parts.get(node),text);}});
 const settle=()=>{writer.detach();if(active)render(active,active.text);active=null;};
 const announce=()=>{remember();const value={key:scope,reading:read()};onReading?.(value);root.dispatchEvent(new win.CustomEvent('aieyra:work-reading',{bubbles:true,detail:value}));};
 const input=e=>{
  if(!visible())return;
  scrollTarget=null;
  if(e.type==='wheel'){userUntil=performance.now()+800;if(e.deltaY<0){following=false;settle();announce();}return;}
  if(e.type==='keydown'&&!['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(e.key))return;
  userUntil=performance.now()+800;if(e.type==='keydown'&&['PageUp','Home','ArrowUp'].includes(e.key)){following=false;settle();announce();}
 };
 const scrolled=()=>{
  if(!visible())return;
  if(scrollTarget!==null&&Math.abs(root.scrollTop-scrollTarget)<1){scrollTarget=null;return;}
  if(performance.now()<userUntil){following=bottom()-root.scrollTop<=4;announce();}
 };
 for(const name of ['wheel','pointerdown','touchstart','keydown'])root.addEventListener(name,input,{passive:true});root.addEventListener('scroll',scrolled,{passive:true});
 const scheduleRestore=()=>{if(!frame)frame=win.requestAnimationFrame(()=>{frame=0;restore();});};
 const resize=new win.ResizeObserver(entries=>{
  for(const entry of entries)if(entry.target===root)sized=entry.contentRect.width>0&&entry.contentRect.height>0;
  // Text blocks are observed too: following runs after their layout, rather
  // than forcing layout inside the typewriter's DOM write callback.
  restore();
 });resize.observe(root);
 function clear(){settle();for(const n of nodes.values()){n.thought?.detach();resize.unobserve(n.node);disposeThemeTree(n.node);n.node.remove();}nodes.clear();following=true;anchor=null;projection=null;scrollTarget=null;userUntil=0;if(wholeLines)root.style.clipPath=originalClip;}
 const view={
  update(value){
   if(closed)return;lastValue=value;if(scope!==value.key){scope=value.key;clear();}
   if(value.journal&&value.journal.key!==scope)return;
   if(value.journal&&projection&&value.journal.revision<projection.revision)return;
   const initial=nodes.size===0&&!!value.journal;
   const rows=value.journal?(projection=value.journal).rows:model.update(value),last=rows.at(-1);
   if(value.reading){following=value.reading.following!==false;anchor=value.reading.anchor||null;if(!following)settle();}
   // The hidden owner still accumulates every delta, but Markdown is rendered
   // by the visible native view. Rebuild its retained DOM only on return.
   if(suspended)return;
   // A bounded read-only projection can retire earlier rows without changing
   // its work identity. Release those nodes and readers along the same path.
   if(value.journal){const keep=new Set(rows.map(row=>row.id));for(const [id,part]of nodes)if(!keep.has(id)){if(active===part){writer.detach();active=null;}part.thought?.detach();resize.unobserve(part.node);disposeThemeTree(part.node);part.node.remove();nodes.delete(id);}}
   for(const row of rows){
    let part=nodes.get(row.id);
    if(!part){const node=doc.createElement('section'),body=doc.createElement('div');node.className='work-transcript-block';node.dataset.kind=row.kind;node.dataset.workId=row.id;body.className='work-transcript-text';node.append(body);root.append(node);resize.observe(node);part={node,body,text:null,visible:''};nodes.set(row.id,part);parts.set(body,part);}
    if(row.kind==='thinking'){
     part.body.classList.add('thinking-content');
     if(row===last&&value.phase==='thinking'&&following){
      if(active){settle();}
      if(!part.thought){part.thought=createThoughtView({doc});part.thought.attach(part.body);}
      part.thought.update(row.text);part.text=row.text;part.visible=row.text;continue;
     }
     if(part.thought){part.thought.detach();part.thought=null;render(part,row.text);}
    }
    if(part.text===row.text){if(active===part&&following)writer.show(part.body,row.text,{done:value.phase!==row.kind});continue;}
    if(active&&active!==part){writer.detach();render(active,active.text);active=null;}
    part.text=row.text;
    if(row===last&&row.kind!=='brief'&&following&&visible()&&!initial){active=part;writer.show(part.body,row.text,{done:value.phase!==row.kind,from:row.text.startsWith(part.visible)?part.visible.length:row.text.length});}
    else{render(part,row.text);if(active===part){writer.detach();active=null;}}
   }
   if(initial||value.reading||!following)scheduleRestore();
  },
  snapshot(){return projection||model.snapshot();},
  get reading(){return read();},
  restoreReading(value){if(!value)return;following=value.following!==false;anchor=value.anchor||null;settle();restore();},
  visibility(value){if(value===false){if(!suspended){remember();settle();for(const part of nodes.values())if(part.thought){part.thought.detach();part.thought=null;part.text=null;}suspended=true;}}else if(suspended){suspended=false;if(lastValue)view.update(lastValue);restore();}},
  suspend(){remember();settle();restore();},
  close(){if(closed)return;closed=true;clear();win.cancelAnimationFrame(frame);resize.disconnect();for(const name of ['wheel','pointerdown','touchstart','keydown'])root.removeEventListener(name,input);root.removeEventListener('scroll',scrolled);root.classList.remove('work-transcript');root.removeAttribute('tabindex');root.removeAttribute('aria-label');},
 };return view;
}
