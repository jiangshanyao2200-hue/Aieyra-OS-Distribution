// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-agent-surface.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');

test('inline resend preserves an identical composer draft, persists its origin and sends only Core fields',async t=>{
 const {setupProgramAgentSurface}=await import('../ui/program-agent-surface.mjs'),doc=new EventTarget(),background={'--space-veil':'.43','--space-blur':'7px'},style={getPropertyValue:key=>background[key]||'',*[Symbol.iterator](){yield*Object.keys(background);}},frames=[],saved=[],requests=[],errors=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}
 const session={id:'owned-session',state:'idle',generation:0},contact={id:'settings-contact',program:'settings',name:'Sera',model_id:'fixture',sessions:[session]};let receive;
 const surface=setupProgramAgentSurface({onFoldedAction(fn){receive=fn;return ()=>{};},conversationAttachment:async()=>({token:'owned'}),conversation:async p=>{
  if(p.action==='program_open')return {configured:true,contact,session};
  if(p.action==='draft_shared_load')return {revision:'0',draft:{value:'identical draft',pastes:'',attachments:[],outbox:[]}};
  if(p.action==='snapshot')return {core_epoch:'owned-epoch',agent:session,messages:[]};
  if(p.action==='draft_shared_save'){saved.push(structuredClone(p.draft));return {ok:true,revision:String(saved.length),draft:p.draft};}
  if(p.action==='send'){requests.push(p);return {ok:true};}
  throw Error('unexpected '+p.action);
 },foldedSurface:async v=>{frames.push(v);return {ok:true};}},{navigation:{current:'settings-view'},onError:e=>errors.push(e)},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',refresh:async()=>{},subscribe(fn){fn([contact]);return ()=>{};}});for(let i=0;i<10&&!frames.at(-1)?.content?.ready;i++)await new Promise(r=>setImmediate(r));
 const frame=frames.at(-1).content;assert.equal(frame.ready,true);
 assert.equal(frame.theme['--space-veil'],'.43');assert.equal(frame.theme['--space-blur'],'7px','program tools inherit the same program background settings as Home');
 await receive({action:'resend',task_id:frame.task_id,core_epoch:frame.core_epoch,text:JSON.stringify({text:'identical draft',request_id:'inline-id'})});
 assert.deepEqual(errors,[]);assert.equal(requests.length,1);assert.equal(requests[0].inline,undefined);assert.equal(requests[0].message,'identical draft');assert.equal(frames.at(-1).content.draft,'identical draft');assert.equal(saved.find(d=>d.outbox.length).outbox[0].preserve_draft,true);assert.equal(saved.at(-1).outbox.length,0);assert.equal(saved.at(-1).value,'identical draft');
});
test('group focus retires the Contacts overlay, fences late reads and restores the saved panel on return',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const doc=new EventTarget(),style={getPropertyValue:()=>'',*[Symbol.iterator](){}},frames=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const contact={id:'contacts',program:'contacts',name:'Mira',sessions:[]},navigation={current:'contacts-module-view'};
 let focus,action,release,delay=false,unsubscribed=false;
 const api={onSessionFocus(fn){focus=fn;return ()=>{unsubscribed=true;};},onFoldedAction(fn){action=fn;return ()=>{};},conversation:async()=>{if(delay)await new Promise(r=>release=r);return {configured:false,contact};},foldedSurface:async frame=>{frames.push(frame);return {ok:true};}};
 const surface=setupProgramAgentSurface(api,{navigation,onError:e=>assert.fail(e)},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});await new Promise(r=>setImmediate(r));
 surface.toggle();const old=frames.at(-1).content;assert.equal(old.expanded,true);
 delay=true;const pending=surface.refresh();await new Promise(r=>setImmediate(r));
 focus({kind:'group',id:'group'});assert.deepEqual(frames.at(-1),{visible:false,takesPresence:true});assert.equal(surface.ownsPage(),true);
 await action({action:'toggle',task_id:old.task_id,core_epoch:old.core_epoch});release();await pending;
 assert.equal(frames.at(-1).visible,false,'a delayed program read or click cannot cover the group');
 navigation.current='settings-view';doc.dispatchEvent(new Event('workspace-view-change'));navigation.current='contacts-module-view';doc.dispatchEvent(new Event('workspace-view-change'));
 assert.equal(frames.at(-1).visible,false,'returning to a retained group stays clear');
 delay=false;focus(null);await new Promise(r=>setImmediate(r));assert.equal(frames.at(-1).visible,true);assert.equal(frames.at(-1).content.expanded,true,'the program panel keeps its own preference');
 surface.close();assert.equal(unsubscribed,true);
 const detached=setupProgramAgentSurface(api,{navigation,sessionFocus:{kind:'group',id:'group'},onError:e=>assert.fail(e)},doc);t.after(()=>detached.close());
 detached.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});await new Promise(r=>setImmediate(r));assert.equal(frames.at(-1).visible,false,'a detached shell starts from its retained group focus');
 focus(null);await new Promise(r=>setImmediate(r));assert.equal(frames.at(-1).visible,true);
});
test('first navigation renders an unconfigured program before any session or live snapshot exists',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const doc=new EventTarget(),style={getPropertyValue:()=>'',*[Symbol.iterator](){}},frames=[],errors=[],calls=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const contact={id:'canvas',program:'workspace',name:'画布 Agent',sessions:[]};
 const surface=setupProgramAgentSurface({conversation:async p=>{calls.push(p);assert.equal(p.action,'program_open');return {configured:false,contact};},foldedSurface:async frame=>{frames.push(frame);return {ok:true};}},{navigation:{current:'workspace-module-view'},onError:error=>errors.push(error)},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});
 await new Promise(r=>setImmediate(r));
 assert.ok(frames.length);assert.equal(frames.at(-1).content.configured,false);assert.equal(frames.at(-1).content.active,false);assert.equal(frames.at(-1).content.input,false);assert.deepEqual(frames.at(-1).content.messages,[]);assert.deepEqual(errors,[]);assert.equal(calls.length,1);
});
test('returning to a program keeps its conversation epoch and first draft during delayed refresh',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const doc=new EventTarget(),style={getPropertyValue:()=>'',*[Symbol.iterator](){}},frames=[],errors=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const session={id:'workspace-session',state:'idle',generation:0},contact={id:'canvas',program:'workspace',name:'画布 Agent',model_id:'configured',program_session:session,sessions:[{id:'independent-os',state:'running'}]},navigation={current:'workspace-module-view'};
 let receive,delaySnapshot=false,release,draft={value:'',pastes:'',attachments:[],outbox:[]},version=0;
 const surface=setupProgramAgentSurface({onFoldedAction(fn){receive=fn;return ()=>{};},conversationAttachment:async()=>({token:'owned'}),conversation:async p=>{
  if(p.action==='program_open')return {configured:true,contact,session};
  if(p.action==='draft_shared_load')return {revision:String(version),draft:structuredClone(draft)};
  if(p.action==='draft_shared_save'){assert.equal(p.revision,String(version));draft=p.draft;return {revision:String(++version),draft};}
  if(p.action==='snapshot'){if(delaySnapshot)await new Promise(r=>release=r);return {core_epoch:'conversation-epoch',agent:session,messages:[]};}
  throw Error(p.action);
 },foldedSurface:async frame=>{frames.push(frame);return {ok:true};}},{navigation,epoch:()=> 'home-epoch',onError:error=>errors.push(error)},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});
 await new Promise(r=>setImmediate(r));assert.equal(frames.at(-1).content.ready,true);
 navigation.current='settings-view';doc.dispatchEvent(new Event('workspace-view-change'));
 delaySnapshot=true;navigation.current='workspace-module-view';doc.dispatchEvent(new Event('workspace-view-change'));
 await new Promise(r=>setImmediate(r));const f=frames.at(-1).content;
 assert.equal(f.ready,true);assert.match(f.core_epoch,/^conversation-epoch:/);
 await receive({action:'input',text:'返回后第一份草稿',edit_revision:1,task_id:f.task_id,core_epoch:f.core_epoch});
 release();await new Promise(r=>setImmediate(r));await surface.flush();
 assert.equal(draft.value,'返回后第一份草稿');assert.equal(frames.at(-1).content.core_epoch,f.core_epoch);assert.equal(frames.at(-1).content.draft,draft.value);assert.deepEqual(errors,[]);
});
test('repeated package failures notify once and a successful recovery permits a new error notice',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const doc=new EventTarget(),style={getPropertyValue:()=>'',*[Symbol.iterator](){}},errors=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const contact={id:'settings',program:'settings',name:'Sera',sessions:[]};let fail=true;
 const surface=setupProgramAgentSurface({conversation:async()=>{if(fail)throw Error('official package compatibility');return {configured:false,contact};},foldedSurface:async()=>({ok:true})},{navigation:{current:'settings-view'},onError:error=>errors.push(error)},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});await new Promise(r=>setImmediate(r));
 await surface.refresh();await surface.refresh();assert.deepEqual(errors,['official package compatibility']);
 fail=false;await surface.refresh();fail=true;await surface.refresh();assert.deepEqual(errors,['official package compatibility','official package compatibility']);
});
test('first panel click survives initial snapshot arrival without accepting stale draft actions or another navigation',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const doc=new EventTarget(),style={getPropertyValue:()=>'',*[Symbol.iterator](){}},frames=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const session={id:'settings-session',state:'idle',generation:0},contact={id:'settings-contact',program:'settings',name:'Sera',model_id:'fixture',sessions:[session]},navigation={current:'settings-view'};let receive,release;
 const snapshot=new Promise(r=>release=r);
 const surface=setupProgramAgentSurface({onFoldedAction(fn){receive=fn;return ()=>{};},conversationAttachment:async()=>({token:'owned'}),conversation:async p=>{
  if(p.action==='program_open')return {configured:true,contact,session};
  if(p.action==='draft_shared_load')return {revision:'0',draft:{value:'',pastes:'',attachments:[],outbox:[]}};
  if(p.action==='snapshot'){await snapshot;return {core_epoch:'conversation',agent:session,messages:[]};}
  throw Error('unexpected operation: '+p.action);
 },foldedSurface:async frame=>{frames.push(frame);return {ok:true};}},{navigation,epoch:()=> 'home',onError:e=>assert.fail(e)},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});await new Promise(r=>setImmediate(r));const early=frames.at(-1).content;assert.match(early.core_epoch,/^home:/);
 release();await new Promise(r=>setImmediate(r));assert.match(frames.at(-1).content.core_epoch,/^conversation:/);
 await receive({action:'toggle',task_id:early.task_id,core_epoch:early.core_epoch});assert.equal(frames.at(-1).content.expanded,true);
 await receive({action:'input',text:'stale draft',task_id:early.task_id,core_epoch:early.core_epoch});assert.equal(frames.at(-1).content.draft,'');
 navigation.current='home';doc.dispatchEvent(new Event('workspace-view-change'));navigation.current='settings-view';doc.dispatchEvent(new Event('workspace-view-change'));await new Promise(r=>setImmediate(r));
 await receive({action:'toggle',task_id:early.task_id,core_epoch:early.core_epoch});assert.equal(frames.at(-1).content.expanded,true,'a previous navigation cannot close the restored panel');
});


test('the first durable binding preserves an explicit panel choice but a real session switch loads its own preference',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const style={getPropertyValue:()=>'',*[Symbol.iterator](){}};
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 for(const choice of [true,false]){
  const doc=new EventTarget(),frames=[],saved=new Map(),contact={id:'link-contact',program:'link',name:'Lira',model_id:'fixture',sessions:[]};
  Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
  let release,receive,session={id:'link-session',state:'idle',generation:0};const binding=new Promise(resolve=>release=resolve);
  if(!choice)saved.set('program:link:link-session',true);
  const surface=setupProgramAgentSurface({onFoldedAction(fn){receive=fn;return ()=>{};},chatLayerPreference:async({key,open})=>{if(open!==undefined)saved.set(key,open);return {ok:true,open:saved.get(key)??false};},conversationAttachment:async()=>({token:'owned'}),conversation:async p=>{
   if(p.action==='program_open'){await binding;return {configured:true,contact,session};}
   if(p.action==='draft_shared_load')return {revision:'0',draft:{value:'',pastes:'',attachments:[],outbox:[]}};
   if(p.action==='snapshot')return {core_epoch:'conversation',agent:session,messages:[]};
   throw Error('unexpected operation: '+p.action);
  },foldedSurface:async frame=>{frames.push(frame);return {ok:true};}},{navigation:{current:'control-view'},epoch:()=> 'home',onError:e=>assert.fail(e)},doc);t.after(()=>surface.close());
  surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};}});await new Promise(resolve=>setImmediate(resolve));
  const early=frames.at(-1).content;assert.equal(early.task_id,contact.id);assert.equal(early.expanded,false);
  surface.toggle();if(!choice)surface.toggle();assert.equal(frames.at(-1).content.expanded,choice);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(frames.at(-1).content.task_id,session.id);assert.equal(frames.at(-1).content.expanded,choice,'the first binding must retain the last explicit choice');
  assert.equal(saved.get('program:link:link-session'),choice,'the adopted choice belongs to the durable session');
  await receive({action:'input',text:'stale contact draft',task_id:early.task_id,core_epoch:early.core_epoch});assert.equal(frames.at(-1).content.draft,'');
  session={...session,id:'replacement-session'};saved.set('program:link:replacement-session',!choice);await surface.refresh();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(frames.at(-1).content.expanded,!choice,'a replacement session must load its own preference');surface.close();
 }
});

test('send feedback belongs to its composer, survives refresh, and retries uncertain submissions by the same request',async t=>{
 const {setupProgramAgentSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/program-agent-surface.mjs')).href);
 const doc=new EventTarget(),style={getPropertyValue:()=>'',*[Symbol.iterator](){}},frames=[],sent=[];
 Object.assign(doc,{hidden:false,defaultView:new EventTarget(),documentElement:{style},body:{style,dataset:{},classList:{contains:()=>false}},getElementById:()=>null,querySelector:()=>null});
 for(const [key,value]of Object.entries({innerWidth:1200,innerHeight:800,getComputedStyle:()=>({...style,fontFamily:'sans-serif',fontSize:'14px'}),matchMedia:()=>({matches:false})})){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 const session={id:'canvas-session',state:'idle',generation:0},contact={id:'canvas',program:'workspace',name:'Aria',model_id:'configured',program_session:session,sessions:[{id:'independent-os',state:'running'}]},navigation={current:'workspace-module-view'};
 let receive,mode='reject',draft={value:'',pastes:'',attachments:[],context:null,outbox:[]},version=0;
 const surface=setupProgramAgentSurface({onFoldedAction(fn){receive=fn;return ()=>{};},conversationAttachment:async()=>({token:'owned'}),conversation:async p=>{
  if(p.action==='program_open')return {configured:true,contact,session};
  if(p.action==='draft_shared_load')return {revision:String(version),draft:structuredClone(draft)};
  if(p.action==='draft_shared_save'){assert.equal(p.revision,String(version));draft=p.draft;return {revision:String(++version),draft};}
  if(p.action==='snapshot')return {core_epoch:'conversation',agent:session,messages:[]};
  if(p.action==='send'){sent.push(p);if(mode==='reject')return {ok:false,send_rejection:true,error:'引用对象已变化，请重新选择'};if(mode==='unknown')throw Error('连接中断');return {ok:true};}
  throw Error(p.action);
 },foldedSurface:async frame=>{frames.push(frame);return {ok:true};}},{navigation,onError:()=>{}},doc);t.after(()=>surface.close());
 surface.connectStore({avatar:()=>'',subscribe(fn){fn([contact]);return ()=>{};},refresh:async()=>{}});await new Promise(r=>setImmediate(r));
 const action=(action,text)=>{const f=frames.at(-1).content;return receive({action,text,edit_revision:1,task_id:f.task_id,core_epoch:f.core_epoch});};
 await action('send','保留草稿');assert.equal(draft.value,'保留草稿');assert.equal(draft.outbox.length,0);assert.match(frames.at(-1).content.composerError,/引用对象已变化/);
 await surface.refresh();assert.match(frames.at(-1).content.composerError,/引用对象已变化/);
 navigation.current='home';doc.dispatchEvent(new Event('workspace-view-change'));navigation.current='workspace-module-view';doc.dispatchEvent(new Event('workspace-view-change'));await new Promise(r=>setImmediate(r));assert.match(frames.at(-1).content.composerError,/引用对象已变化/);
 await action('input','已修改');assert.equal(frames.at(-1).content.composerError,'');
 mode='unknown';await action('send','已修改');assert.equal(draft.outbox.length,1);assert.match(frames.at(-1).content.composerError,/原请求已保留/);const request=sent.at(-1).request_id;
 mode='ok';await action('send','已修改');assert.equal(sent.at(-1).request_id,request);assert.equal(draft.outbox.length,0);assert.equal(draft.value,'');assert.equal(frames.at(-1).content.composerError,'');
});
