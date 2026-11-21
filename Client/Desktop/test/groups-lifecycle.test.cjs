// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; flush; deferred; timerTests; groupsModule; loadGroups; documentFixture; message; group; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/groups-lifecycle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const timerTests=new WeakSet();
let groupsModule;
function loadGroups(){
 if(!groupsModule)groupsModule=(async()=>{
  const url=pathToFileURL(require.resolve('../ui/groups.mjs')).href+'?shutdown-lifecycle';
  // Keep the actual group controller and RPC/draft logic; visual components
  // only record their inputs so this check needs neither a renderer nor GUI.
  const visuals={
   './role-identity.mjs':`export const roleIdentity=()=>({name:'Eyra',avatar:''});export const paintRoleRing=()=>{};export const createRoleRing=(_,options)=>options.doc.createElement('span');`,
   './chat-layout.mjs':`export const bindChatSurface=()=>({refresh(){},close(){}});`,
   './chat-column.mjs':`export const setupChatColumn=root=>({paint(entries){root.entries=entries;},clear(){root.entries=[];},close(){}});`,
   './work-participants.mjs':`export const setupWorkParticipants=()=>({paint(){},close(){}});`,
   './stage.mjs':`export const setupStage=root=>({paint(_snapshot,_presentation,{show=false}={}){root.hidden=!show;},close(){}});`,
   './glide.mjs':`export const hoverGlide=()=>({refresh(){},close(){}});`,
  };
  const hooks=registerHooks({resolve(specifier,context,next){return context.parentURL===url&&visuals[specifier]?{url:'data:text/javascript,'+encodeURIComponent(visuals[specifier]),shortCircuit:true}:next(specifier,context);}});
  try{return await import(url);}finally{hooks.deregister();}
 })();
 return groupsModule;
}

function documentFixture(){
 class Element{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.events=new Map();this.attrs={};this.dataset={};this.className='';this.value='';this.textContent='';this.hidden=false;this.scrollHeight=200;this.scrollTop=200;this.clientHeight=100;this.style={setProperty(){}};this.classList={add:()=>{}};}
  append(...nodes){for(const n of nodes){n.remove();this.children.push(n);n.parentNode=this;}}
  replaceChildren(...nodes){for(const n of this.children)n.parentNode=null;this.children=[];this.append(...nodes);}
  replaceWith(node){const parent=this.parentNode,index=parent.children.indexOf(this);node.remove();parent.children[index]=node;node.parentNode=parent;this.parentNode=null;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  setAttribute(name,value){this.attrs[name]=String(value);if(name==='class')this.className=value;if(name==='id')this.id=value;if(name==='hidden')this.hidden=true;}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
  removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of this.events.get(type)||[])fn({target:this,...event});}
  focus(){this.ownerDocument.activeElement=this;}
  closest(){return null;}
  querySelectorAll(selector){const parts=selector.split(/\s+/),last=parts.pop(),found=[];
   const matches=(node,part)=>part.startsWith('.')?node.className.split(/\s+/).includes(part.slice(1)):part.startsWith('#')?node.id===part.slice(1):node.tagName===part;
   const visit=node=>{for(const child of node.children){if(matches(child,last)){let parent=child.parentNode,index=parts.length-1;while(parent&&index>=0){if(matches(parent,parts[index]))index--;parent=parent.parentNode;}if(index<0)found.push(child);}visit(child);}};visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  set innerHTML(value){this.replaceChildren();const stack=[this];for(const token of value.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)){if(token[1]){if(stack.length>1)stack.pop();continue;}const node=this.ownerDocument.createElement(token[2]);for(const attr of token[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]||'');stack.at(-1).append(node);if(!/\/$/.test(token[3])&&!['input','br','img'].includes(token[2]))stack.push(node);}}
 }
 const doc={events:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.body.id===id?this.body:this.body.querySelector('#'+id);},addEventListener:Element.prototype.addEventListener,removeEventListener:Element.prototype.removeEventListener,fire:Element.prototype.fire};
 doc.body=doc.createElement('body');doc.activeElement=doc.body;const content=doc.createElement('div');content.id='view-content';doc.body.append(content);return doc;
}
const message=(seq,text)=>({seq,from:'user',text,at:'2026-11-09T15:00:00Z'});
const group=(extra={})=>({id:'g',name:'current group',members:[],messages:[],seq:1,has_older:false,...extra});
async function fixture(t,options={}){
 if(!timerTests.has(t)){t.mock.timers.enable({apis:['setTimeout']});timerTests.add(t);}const {setupGroups}=await loadGroups(),doc=documentFixture(),errors=[],reads=[],writes=[],drafts=[];
 const navigation={key:'',is(key){return this.key===key;},register(){},title(){},open(key){this.key=key;},home(){this.key='';}};
 const api={conversation(params){const request={params,...deferred()};(params.action==='group'?reads:writes).push(request);return request.promise;},...options.api};
 if(options.drafts)api.groupDraft=params=>{const request={params,...deferred()};drafts.push(request);return request.promise;};
 const groups=setupGroups(api,navigation,{doc,store:{avatar:()=>''},onError:error=>errors.push(error),confirm:async()=>true});
 t.after(()=>groups.close());
 return {groups,doc,navigation,errors,reads,writes,drafts,node:selector=>doc.body.querySelector(selector)};
}

test('group polling drops shutdown failures and old finally cannot release a resumed request',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();assert.equal(f.reads.length,1);
 f.groups.suspend();f.groups.resume();assert.equal(f.reads.length,2);
 f.reads[0].reject(Error('对话智能体当前不可用'));await opening;await f.groups.poll();assert.equal(f.reads.length,2,'new poll retains its request ownership');assert.deepEqual(f.errors,[]);
 f.reads[1].resolve(group());await flush();assert.equal(f.node('.gv-title h2').textContent,'current group');
 const late=f.groups.poll();assert.equal(f.reads.length,3);f.groups.close();f.groups.resume();f.reads[2].reject(Error('closed Core'));await late;t.mock.timers.tick(10000);await flush();assert.equal(f.reads.length,3);assert.deepEqual(f.errors,[]);
});

test('a late pre-suspend group snapshot cannot repaint or advance the resumed message cursor',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.groups.suspend();f.groups.resume();
 f.reads[1].resolve(group({name:'resumed',seq:5,messages:[message(5,'new')]}));await flush();
 f.reads[0].resolve(group({name:'stale',seq:90,messages:[message(90,'old')]}));await opening;
 assert.equal(f.node('.gv-title h2').textContent,'resumed');assert.deepEqual(f.node('.gv-messages').entries.map(m=>m.text),['new']);
 const next=f.groups.poll();assert.equal(f.reads[2].params.after,5);f.reads[2].resolve(group({seq:5}));await next;
});

test('history pagination drops shutdown errors and keeps a newer page request occupied',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.reads[0].resolve(group({seq:20,has_older:true,messages:[message(20,'latest')]}));await opening;
 const scroll=f.node('.gv-scroll');scroll.scrollTop=0;scroll.fire('scroll');assert.equal(f.reads[1].params.before,20);
 f.groups.suspend();f.groups.resume();scroll.fire('scroll');assert.equal(f.reads[3].params.before,20);
 f.reads[1].reject(Error('Core stopped during history read'));await flush();scroll.fire('scroll');assert.equal(f.reads.length,4);assert.deepEqual(f.errors,[]);
 f.reads[3].resolve(group({messages:[message(19,'older current')]}));await flush();assert.deepEqual(f.node('.gv-messages').entries.map(m=>m.text),['older current','latest']);
 f.reads[2].resolve(group({seq:20}));await flush();
 scroll.fire('scroll');assert.equal(f.reads.length,4,'completed history page correctly updated its older boundary');
});

test('closing a group invalidates late history success and late draft-load failure',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.reads[0].resolve(group({seq:20,has_older:true,messages:[message(20,'latest')]}));await opening;
 const list=f.node('.gv-messages'),scroll=f.node('.gv-scroll');scroll.scrollTop=0;scroll.fire('scroll');f.groups.close();f.reads[1].resolve(group({messages:[message(19,'late history')]}));await flush();assert.deepEqual(list.entries.map(m=>m.text),['latest']);assert.deepEqual(f.errors,[]);
 const d=await fixture(t,{drafts:true}),draftOpen=d.groups.open('g');await flush();assert.equal(d.drafts.length,1);d.groups.close();d.drafts[0].reject(Error('late draft read'));await draftOpen;assert.deepEqual(d.errors,[]);assert.equal(d.reads.length,0);
});

test('suspended draft reads cannot replace edited text or mark a stale revision loaded',async t=>{
 const f=await fixture(t,{drafts:true}),opening=f.groups.open('g');await flush();f.groups.suspend();f.drafts[0].resolve({ok:true,text:'stale draft',revision:'old'});await opening;assert.equal(f.node('textarea').value,'');assert.equal(f.navigation.key,'');
 f.groups.resume();const resumed=f.groups.open('g');await flush();assert.equal(f.drafts.length,2,'discarded read remains reloadable');f.drafts[1].resolve({ok:true,text:'actual draft',revision:'fresh'});await flush();f.reads[0].resolve(group());await resumed;assert.equal(f.node('textarea').value,'actual draft');
});

test('active read errors remain visible, including the same message suppressed only while suspended',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.groups.suspend();f.reads[0].reject(Error('对话智能体当前不可用'));await opening;assert.deepEqual(f.errors,[]);
 f.groups.resume();f.reads[1].reject(Error('对话智能体当前不可用'));await flush();assert.deepEqual(f.errors,['对话智能体当前不可用']);
});

test('an accepted group send and its draft save still settle after suspension',async t=>{
 const saved=[];const f=await fixture(t,{api:{groupDraft:async params=>{if(params.action==='save')saved.push(params);return {ok:true,text:'',revision:'missing'};}}}),opening=f.groups.open('g');await flush();f.reads[0].resolve(group());await opening;
 const input=f.node('textarea');input.value='send once';input.fire('input');f.node('.gv-send').onclick();assert.equal(f.writes.length,1);f.groups.suspend();f.writes[0].resolve({ok:true});await flush();assert.equal(input.value,'');await f.groups.flushDrafts();assert.equal(saved.at(-1).text,'');assert.equal(f.reads.length,1,'write receipt does not restart polling while paused');assert.deepEqual(f.errors,[]);
});

test('a real send failure and a pending draft-write failure survive suspension',async t=>{
 const f=await fixture(t,{api:{groupDraft:async params=>params.action==='load'?{ok:true,text:'',revision:'missing'}:{ok:false,error:'draft disk unavailable'}}}),opening=f.groups.open('g');await flush();f.reads[0].resolve(group());await opening;
 const input=f.node('textarea');input.value='keep this draft';input.fire('input');f.node('.gv-send').onclick();const saving=f.groups.flushDrafts();f.groups.suspend();f.writes[0].reject(Error('send receipt unavailable'));await assert.rejects(saving,/draft disk unavailable/);await flush();assert.equal(input.value,'keep this draft');assert.deepEqual(f.errors,['send receipt unavailable']);assert.equal(f.reads.length,1);
});


test('group submission is visible synchronously and keeps its identity through late acknowledgement and polling',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.reads[0].resolve(group());await opening;
 const input=f.node('textarea');input.value='immediate original';input.fire('input');f.node('.gv-send').onclick();
 const local=f.node('.gv-messages').entries.at(-1),request=f.writes[0].params.request_id;
 assert.equal(local.text,'immediate original');assert.equal(local.id,'g:user:'+request);
 // A poll that began before submission is allowed to arrive before the receipt.
 const polling=f.groups.poll();f.reads[1].resolve(group());await polling;
 assert.equal(f.node('.gv-messages').entries.at(-1).id,local.id);
 f.writes[0].resolve({ok:true});await flush();
 assert.equal(f.node('.gv-messages').entries.at(-1).id,local.id);
 f.reads[2].resolve(group({seq:2,messages:[{...message(2,local.text),request:'user:'+request}]}));await flush();
 assert.deepEqual(f.node('.gv-messages').entries.map(m=>m.id),[local.id]);
});


test('uncertain group submissions remain distinguishable and retry their original request after later editing',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.reads[0].resolve(group());await opening;
 const input=f.node('textarea');input.value='original uncertain';input.fire('input');f.node('.gv-send').onclick();const id=f.writes[0].params.request_id;
 f.writes[0].reject(Error('receipt lost'));await flush();assert.equal(f.node('.gv-messages').entries.at(-1).delivery,'unknown');
 input.value='a later draft';input.fire('input');input.value='original uncertain';input.fire('input');f.node('.gv-send').onclick();
 assert.equal(f.writes[1].params.request_id,id);assert.equal(f.node('.gv-messages').entries.length,1);
 f.groups.suspend();f.writes[1].resolve({ok:true});await flush();
});


test('a rejected group send absent from authoritative history does not leave a ghost row after editing',async t=>{
 const f=await fixture(t),opening=f.groups.open('g');await flush();f.reads[0].resolve(group());await opening;
 const input=f.node('textarea');input.value='rejected original';input.fire('input');f.node('.gv-send').onclick();
 f.writes[0].resolve({ok:false,error:'message refused'});await flush();assert.equal(f.reads[1].params.after,1);f.reads[1].resolve(group());await flush();
 assert.equal(f.node('.gv-messages').entries.length,0);assert.equal(input.value,'rejected original');
 input.value='corrected message';input.fire('input');f.node('.gv-send').onclick();assert.deepEqual(f.node('.gv-messages').entries.map(m=>m.text),['corrected message']);
 f.groups.suspend();f.writes[1].resolve({ok:true});await flush();
});
