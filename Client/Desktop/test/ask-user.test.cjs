// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; settle; load; documentFixture; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/ask-user.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const load=()=>import('../ui/ask-user.mjs');
function documentFixture(){
 let doc;
 class Node{
  constructor(tag){this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.style={};this.className='';this.hidden=false;this.disabled=false;this.value='';this.scrollHeight=40;this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(on)set.add(name);else set.delete(name);this.className=[...set].join(' ');},contains:n=>this.className.split(' ').includes(n)};}
  append(...nodes){for(const n of nodes){n.remove();this.children.push(n);n.parentNode=this;}}
  insertBefore(n,before){if(n===before)return;const index=this.children.indexOf(before);if(index<0)throw Error('reference is not a child');n.remove();this.children.splice(this.children.indexOf(before),0,n);n.parentNode=this;}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
  replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
  querySelectorAll(s){return this.children.flatMap(n=>[...(s.startsWith('#')?n.id===s.slice(1):s.startsWith('.')?n.classList.contains(s.slice(1)):n.tagName.toLowerCase()===s)?[n]:[],...n.querySelectorAll(s)]);}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  contains(n){return this===n||this.children.some(c=>c.contains(n));}focus(){doc.activeElement=this;}scrollIntoView(){}
  click(){if(!this.disabled)this.onclick?.({target:this});}
  prepend(...nodes){for(const n of nodes.reverse()){n.remove();this.children.unshift(n);n.parentNode=this;}}
  get childElementCount(){return this.children.length;}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
 }
 doc={createElement:tag=>new Node(tag),addEventListener(){},removeEventListener(){},activeElement:null};doc.body=new Node('body');
 const ids=new Map();for(const id of ['conversation','status-rail','input-dock','message','add-attachment']){const n=new Node('section');n.id=id;ids.set(id,n);doc.body.append(n);}doc.getElementById=id=>ids.get(id);
 return doc;
}

test('decision layout retains the original composer and restores its position on close',async()=>{
 const doc=documentFixture(),parent=doc.getElementById('input-dock'),editor=doc.createElement('div'),tail=doc.createElement('button'),observations=[];editor.id='composer';
 doc.defaultView={addEventListener(){},removeEventListener(){},ResizeObserver:class{observe(n){observations.push(n);}disconnect(){observations.push('disconnected');}}};
 const input=doc.getElementById('message');editor.append(input);parent.append(editor,tail);
 const {createDecisionPanel}=await load(),view=createDecisionPanel(parent,{doc});
 const sleeve=parent.querySelector('.ask-editor-layout');assert.ok(sleeve);assert.equal(sleeve.children[0],editor);assert.equal(editor.children[0],input);assert.equal(parent.querySelectorAll('#composer').length,1);
 assert.deepEqual(observations,[editor]);view.paint(null);view.close();assert.deepEqual(parent.children,[editor,tail]);assert.equal(editor.children[0],input);assert.equal(parent.querySelector('.ask-editor-layout'),null);assert.equal(observations.at(-1),'disconnected');
});

async function fixture(t){
 const doc=documentFixture(),saved=new Map(),writes=[],errors=[],storage=new Map();let handler=async()=>({ok:true}),opens=0,editor={value:'普通草稿',pastes:'metadata',selection:[1,3,'forward'],scroll:12},composing=false;
 for(const [key,value]of Object.entries({document:doc,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener(){}})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 const {setupAskUser}=await load(),api={askReply:p=>{writes.push(structuredClone(p));return handler(p);},humanReply:p=>{writes.push(structuredClone(p));return handler(p);}};
 const controller=setupAskUser(api,{check:r=>{if(r?.ok===false)throw Error(r.error);return r;},onError:e=>errors.push(e),getEditor:()=>structuredClone(editor),setEditor:e=>{editor=structuredClone(e);doc.getElementById('message').value=e.value;},readText:()=>editor.value,isComposing:()=>composing,openChat:()=>{opens++;doc.body.dataset.desktopPage='home';doc.body.dataset.chatExpanded='true';}});
 t.after(()=>{controller.close();for(const [key,d]of saved)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];});
 const row={id:'q1',question:'如何安排？',assumption:'先检查再继续',state:'pending',options:[{label:'先讨论',description:'交换想法'},{label:'先阅读'}],recommended:1},snapshot={session_id:'s1',core_epoch:'e1',ask_requests:[row]};
 const q=s=>doc.body.querySelector(s),update=(next=snapshot)=>controller.update(next),input=value=>{editor={value,pastes:'',selection:[value.length,value.length,'none'],scroll:0};doc.getElementById('message').value=value;controller.input();};
 return {doc,controller,writes,errors,q,update,input,snapshot,row,storage,get editor(){return editor;},get opens(){return opens;},setHandler:fn=>handler=fn,setComposing:value=>composing=value};
}
test('question extends the original input, never auto-selects or submits, then restores ordinary draft and selection',async t=>{
 const f=await fixture(t);f.update();assert.equal(f.q('.ask-user').parentNode,f.doc.getElementById('input-dock'));assert.equal(f.q('.ask-input'),null);assert.equal(f.editor.value,'');assert.equal(f.controller.frame.selected,'');f.update();assert.equal(f.writes.length,0);
 await f.controller.action('choose','2');assert.equal(f.writes.length,0);f.input('补充中文回答');await f.controller.submit();assert.equal(f.writes[0].option,2);assert.equal(f.writes[0].text,'补充中文回答');assert.equal(f.editor.value,'普通草稿');assert.deepEqual(f.editor.selection,[1,3,'forward']);assert.equal(f.q('.ask-user').hidden,true);
});
test('uncertain replies freeze the exact payload and reuse the request identity through retry',async t=>{
 const f=await fixture(t);f.update();f.input('先暂停一下');f.setHandler(async()=>{throw Error('uncertain receipt');});await f.controller.submit();const request=f.writes[0];assert.equal(f.controller.frame.locked,true);assert.equal(f.controller.frame.retry,true);f.update();await f.controller.action('choose','1');assert.equal(f.controller.frame.selected,'');
 f.setHandler(async()=>({ok:true}));await f.controller.submit();assert.deepEqual(f.writes[1],request);assert.equal(f.editor.value,'普通草稿');
});
test('multiple questions retain independent answers and ordinary draft across later and settings navigation',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2',question:'第二问'}]};f.update(s);f.input('第一问草稿');await f.controller.action('next');assert.equal(f.editor.value,'');f.input('第二问草稿');await f.controller.action('prev');assert.equal(f.editor.value,'第一问草稿');await f.controller.action('later');assert.equal(f.editor.value,'普通草稿');assert.equal(f.writes.length,0);
 f.q('.ask-orb').click();assert.equal(f.editor.value,'第一问草稿');f.doc.body.dataset.desktopPage='settings';f.update(s);assert.equal(f.controller.active,false);assert.equal(f.editor.value,'普通草稿');f.doc.body.dataset.desktopPage='home';f.update(s);assert.equal(f.editor.value,'第一问草稿');assert.equal(f.writes.length,0);
});

test('pages stage editable answers without writing, then one final action sends the complete group',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2',question:'第二问'}]};f.update(s);
 await f.controller.action('choose','2');f.input('第一问初稿');await f.controller.submit();assert.equal(f.controller.frame.id,'q2');assert.equal(f.writes.length,0);
 f.input('第二问回答');await f.controller.action('prev');assert.equal(f.editor.value,'第一问初稿');assert.equal(f.controller.frame.selected,'2');f.input('第一问修订');await f.controller.action('next');assert.equal(f.editor.value,'第二问回答');assert.equal(f.writes.length,0);
 await f.controller.submit();assert.deepEqual(f.writes.map(p=>[p.id,p.option,p.text]),[['q1',2,'第一问修订'],['q2',0,'第二问回答']]);assert.notEqual(f.writes[0].request_id,f.writes[1].request_id);assert.equal(f.editor.value,'普通草稿');assert.equal(f.controller.active,false);
});

test('final submission returns to an unanswered page instead of silently adopting its recommendation',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2'}]};f.update(s);await f.controller.action('next');f.input('第二问回答');await f.controller.submit();assert.equal(f.writes.length,0);assert.equal(f.controller.frame.id,'q1');assert.ok(f.controller.frame.error);
 await f.controller.submit();assert.equal(f.writes.length,0);assert.equal(f.controller.frame.id,'q2');await f.controller.submit();assert.equal(f.writes.length,2);assert.equal(f.writes[0].option,0);assert.equal(f.writes[0].text,'');
});

test('skip stays local until final confirmation and remains a skip in the original Core payload',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2'}]};f.update(s);f.input('第一问回答');await f.controller.submit();await f.controller.action('skip');assert.equal(f.writes.length,0);assert.equal(f.controller.frame.skipped,true);await f.controller.submit();assert.deepEqual(f.writes.map(p=>p.action),['answer','skip']);assert.equal(f.writes[1].text,'');
});

test('a partially confirmed group retries only its unconfirmed immutable reply',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2'}]};f.update(s);f.input('第一问回答');await f.controller.submit();f.input('第二问回答');f.setHandler(async p=>{if(p.id==='q2')throw Error('uncertain second receipt');return {ok:true};});await f.controller.submit();assert.equal(f.writes.length,2);assert.equal(f.controller.frame.id,'q2');assert.equal(f.controller.frame.locked,true);assert.equal(f.controller.frame.retry,true);const original=f.writes[1];
 await f.controller.action('choose','1');f.setHandler(async()=>({ok:true}));await f.controller.submit();assert.equal(f.writes.length,3);assert.deepEqual(f.writes[2],original);assert.equal(f.writes.filter(p=>p.id==='q1').length,1);assert.equal(f.editor.value,'普通草稿');
});

test('arriving questions and snapshots cannot extend an already confirmed group or double submit it',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2'}]};f.update(s);f.input('第一问');await f.controller.submit();f.input('第二问');let release;f.setHandler(p=>p.id==='q1'?new Promise(r=>release=r):Promise.resolve({ok:true}));const sending=f.controller.submit();await settle();await f.controller.submit();assert.equal(f.writes.length,1);
 f.update({...s,ask_requests:[s.ask_requests[1],{...f.row,id:'q3',question:'新到达第三问'}]});assert.equal(f.controller.frame.id,'q2');release({ok:true});await sending;assert.deepEqual(f.writes.map(p=>p.id),['q1','q2']);assert.equal(f.controller.frame.id,'q3');assert.equal(f.editor.value,'');
});

test('switching task during a group reply stops subsequent dispatch and preserves the new task editor',async t=>{
 const f=await fixture(t),s={...f.snapshot,ask_requests:[f.row,{...f.row,id:'q2'}]};f.update(s);f.input('第一问');await f.controller.submit();f.input('第二问');let release;f.setHandler(()=>new Promise(r=>release=r));const sending=f.controller.submit();await settle();
 f.controller.prepare({...s,session_id:'s2'});f.update({...s,session_id:'s2',ask_requests:[{...f.row,id:'new'}]});f.input('新任务草稿');release({ok:true});await sending;assert.equal(f.writes.length,1);assert.equal(f.controller.frame.id,'new');assert.equal(f.editor.value,'新任务草稿');assert.equal(f.controller.frame.busy,false);
});
test('late success from a previous scope cannot close or overwrite the new question or editor',async t=>{
 const f=await fixture(t);f.update();f.input('旧答复');let resolve;f.setHandler(()=>new Promise(r=>resolve=r));const sending=f.controller.submit();await settle();f.controller.prepare({...f.snapshot,session_id:'s2'});f.update({...f.snapshot,session_id:'s2',ask_requests:[{...f.row,id:'q2'}]});f.input('新问题草稿');resolve({ok:true});await sending;assert.equal(f.controller.frame.id,'q2');assert.equal(f.editor.value,'新问题草稿');assert.equal(f.controller.frame.busy,false);
});
test('human decision requires its declared option and text, binds all origin fields and reuses retry id',async t=>{
 const f=await fixture(t),human={id:'h1',session_id:'s1',agent_id:'agent',generation:4,version:2,request_token_sha256:'token',state:'waiting_user',question:'允许继续吗',options:[{id:'allow',label:'允许',impact:'仅当前任务'}],input_schema:{required:true}};
 f.update({...f.snapshot,ask_requests:[],roles:[{human_requests:[human]}]});await f.controller.submit();assert.equal(f.writes.length,0);await f.controller.action('choose','allow');await f.controller.submit();assert.equal(f.writes.length,0);f.input('仅当前范围');f.setHandler(async()=>{throw Error('uncertain');});await f.controller.submit();assert.equal(f.writes[0].expected_request_version,2);assert.equal(f.writes[0].generation,4);assert.equal(f.writes[0].request_token_sha256,'token');assert.deepEqual(f.writes[0].decision,{option_id:'allow',text:'仅当前范围'});f.setHandler(async()=>({ok:true}));await f.controller.submit();assert.deepEqual(f.writes[1],f.writes[0]);
});
test('IME or an actively typed ordinary draft is not interrupted by an arriving question',async t=>{
 const f=await fixture(t);f.setComposing(true);f.update();assert.equal(f.controller.active,false);assert.equal(f.editor.value,'普通草稿');assert.equal(f.writes.length,0);f.setComposing(false);f.q('.ask-orb').click();assert.equal(f.controller.active,true);assert.equal(f.editor.value,'');
});
test('a stale native decision key cannot choose, skip or submit another question',async t=>{
 const f=await fixture(t);f.update();for(const action of ['choose','skip','submit','next'])assert.equal(await f.controller.action(action,'1','other-key'),false);assert.equal(f.writes.length,0);assert.equal(f.controller.frame.selected,'');
});
