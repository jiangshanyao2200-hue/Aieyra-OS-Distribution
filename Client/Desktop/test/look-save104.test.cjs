// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; deferred; settle; documentFixture; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/look-save104.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAppearanceStore}=require('../src/os-appearance.cjs');
const {defaults}=require('../../../Theme/runtime/settings.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};

// Only DOM plumbing is synthetic; tests mount the actual controller, dispatch
// its actual input/save handlers and read the real appearance store afterward.
function documentFixture(){
 let doc;
 class Node{
  constructor(name,type=1,text=''){this.nodeType=type;this.nodeName=name.toUpperCase();this._children=[];this.parentNode=null;this.dataset={};this.attrs=new Map();this.value='';this._text=text;this.className='';this.listeners=new Map();this.hidden=false;this.ownerDocument=doc;const styles=new Map();this.style={setProperty:(k,v)=>styles.set(k,String(v)),getPropertyValue:k=>styles.get(k)||'',removeProperty:k=>styles.delete(k)};this.classList={add:(...xs)=>{this.className=[...new Set([...this.className.split(' '),...xs])].join(' ');},remove:(...xs)=>{this.className=this.className.split(' ').filter(x=>!xs.includes(x)).join(' ');},contains:x=>this.className.split(' ').includes(x)};}
  get children(){return this._children.filter(n=>n.nodeType===1);}get childNodes(){return this._children;}get firstChild(){return this._children[0];}get lastChild(){return this._children.at(-1);}
  get textContent(){return this._text+this._children.map(n=>n.textContent).join('');}set textContent(value){this._text=String(value);this._children=[];}
  get isConnected(){return true;}get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
  append(...nodes){for(const node of nodes){node.remove();this._children.push(node);node.parentNode=this;}}
  insertBefore(node,other){node.remove();const index=this._children.indexOf(other);if(index<0)this._children.push(node);else this._children.splice(index,0,node);node.parentNode=this;}
  insertAdjacentHTML(position,html){assert.equal(position,'afterbegin');const node=doc.createElement('svg');node.className=/class="([^"]+)"/.exec(html)?.[1]||'';this.insertBefore(node,this.firstChild);}
  before(node){this.parentNode?.insertBefore(node,this);}remove(){if(this.parentNode){const siblings=this.parentNode._children;const index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);this.parentNode=null;}}
  replaceChildren(...nodes){for(const n of [...this._children])n.remove();this._text='';this.append(...nodes);}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}hasAttribute(k){return this.attrs.has(k);}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);}removeEventListener(k,fn){this.listeners.get(k)?.delete(fn);}
  dispatchEvent(event){this['on'+event.type]?.(event);for(const fn of this.listeners.get(event.type)||[])fn(event);return true;}
  matches(selector){return selector==='*'||selector.toLowerCase()===this.nodeName.toLowerCase()||selector.startsWith('.')&&this.classList.contains(selector.slice(1))||selector==='[data-look-field=stroke_width]'&&this.dataset.lookField==='stroke_width';}
  querySelectorAll(selector){if(selector.includes(' ')){const [first,...rest]=selector.split(' ');return this.querySelectorAll(first).flatMap(n=>n.querySelectorAll(rest.join(' ')));}return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}getBoundingClientRect(){return {left:0,top:0,width:800,height:600,right:800,bottom:600};}
  focus(){}closest(){return null;}
 }
 const observers=[];
 doc={hidden:false,createElement:name=>new Node(name),createTextNode:text=>new Node('#text',3,text),addEventListener(){},removeEventListener(){},dispatchEvent(){}};
 doc.body=new Node('body');doc.head=new Node('head');doc.body.dataset.view='onboarding';doc.defaultView={innerWidth:1280,innerHeight:800,location:{search:'?extension=settings'}};
 const nodes=new Map();for(const id of ['appearance-settings','look-tabs','look-stage','settings-body','onboarding','look-status','look-fields','look-theme-remove','look-reset','look-save']){const node=new Node('div');node.id=id;nodes.set(id,node);doc.body.append(node);}
 const tabs=new Node('nav');tabs.className='settings-tabs';nodes.get('onboarding').append(tabs);
 doc.getElementById=id=>[doc.body,doc.head,...doc.body.querySelectorAll('*'),...doc.head.querySelectorAll('*')].find(node=>node.id===id)||null;
 doc.querySelectorAll=selector=>doc.body.querySelectorAll(selector);
 return {doc,$:id=>doc.getElementById(id),observers,globals:{document:doc,innerWidth:1280,innerHeight:800,addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}}}};
}
async function fixture(t){
 const dom=documentFixture(),prior=new Map(Object.keys(dom.globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const [key,value]of Object.entries(dom.globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'look-save104-')),store=createAppearanceStore(path.join(dir,'config.json'));let profile={name:'User',eyraName:'Eyra',chatLayout:{top:20}},appearanceGate=null,layoutGate=null,layoutError=null;
 const appearanceCalls=[],layoutCalls=[],readCalls=[],readGates=[];
 const api={appearance:async args=>{if(args.action==='os_appearance_read'){readCalls.push(structuredClone(args));const result=store.read(),gate=readGates.shift();if(!gate)return result;const replacement=await gate.promise;return replacement===undefined?result:replacement;}appearanceCalls.push(structuredClone(args));const gate=appearanceGate;appearanceGate=null;if(gate)await gate.promise;return store.update(args.patch,args.expected_version);}};
 const {setupLook}=await import('../ui/look.mjs');
 const controller=setupLook(api,{profile:()=>profile,saveLayout:async layout=>{layoutCalls.push(structuredClone(layout));const gate=layoutGate;layoutGate=null;if(gate)await gate.promise;if(layoutError){const error=layoutError;layoutError=null;throw error;}profile={...profile,chatLayout:structuredClone(layout)};return structuredClone(profile);}});
 t.after(()=>{controller.close();fs.rmSync(dir,{recursive:true,force:true});for(const [key,descriptor]of prior)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 await controller.initialize(store.read());
 const edit=(tab,label,value)=>{controller.select(tab);const field=dom.$('look-fields').querySelectorAll('label').find(n=>n.children.find(c=>c.nodeName==='SPAN')?.textContent===label);assert(field,'missing control '+tab+'/'+label);const input=field.querySelector('input');assert(input,'missing input '+label);input.value=String(value);input.oninput();};
 return {...dom,controller,store,appearanceCalls,layoutCalls,readCalls,edit,save:()=>dom.$('look-save').onclick(),holdAppearance(){return appearanceGate=deferred();},holdLayout(){return layoutGate=deferred();},holdRead(){const gate=deferred();readGates.push(gate);return gate;},failLayout(){layoutError=Error('layout persistence failed');},profile:()=>profile,reopen:async()=>{for(const fn of dom.observers)fn([]);await settle();}};
}

test('a theme-only commit between refresh and Save rebases once without overwriting the theme or draft',async t=>{
 const f=await fixture(t);f.edit('layout','水平位置',100);
 const prior=f.store.read(),updated=f.store.update({theme_css:'body{--theme-accent:#123456}'},prior.version);assert.equal(updated.ok,true);
 await f.save();assert.equal(f.appearanceCalls.length,2);assert.equal(f.appearanceCalls.at(-1).expected_version,updated.version);
 assert.equal(f.store.read().settings.theme_css,'body{--theme-accent:#123456}');assert.equal(f.profile().chatLayout.position,100);assert.equal(f.$('look-status').textContent,'已保存，界面已更新。');
});

test('returning to the visible appearance page refreshes theme versions without losing an edited layout',async t=>{
 const f=await fixture(t);f.edit('layout','水平位置',100);f.controller.visibility(false);
 const prior=f.store.read(),updated=f.store.update({theme_css:'body{--theme-accent:#123456}'},prior.version);assert.equal(updated.ok,true);
 await f.controller.visibility(true);assert.equal(f.controller.draft.layout.position,100);
 await f.save();assert.equal(f.appearanceCalls.at(-1).expected_version,updated.version);assert.equal(f.store.read().settings.theme_css,'body{--theme-accent:#123456}');
 assert.equal(f.profile().chatLayout.position,100);assert.equal(f.$('look-status').textContent,'已保存，界面已更新。');
});

test('avatar changes save the same normalized layout used by the preview and clear dirty state',async t=>{
 const f=await fixture(t);f.edit('people','Eyra 头像',148);
 assert.equal(f.controller.draft.layout.ring,148);
 await f.save();assert.equal(f.profile().chatLayout.eyraAvatar,148);assert.equal(f.profile().chatLayout.ring,148);
 assert.equal(f.$('look-status').textContent,'已保存，界面已更新。');
 const gate=f.holdLayout();f.edit('people','Eyra 头像',140);const saving=f.save();await settle();f.edit('people','Eyra 头像',130);gate.resolve();await saving;
 assert.equal(f.profile().chatLayout.eyraAvatar,140);assert.equal(f.controller.draft.layout.ring,130);assert.match(f.$('look-status').textContent,/未保存/);
 await f.save();assert.equal(f.profile().chatLayout.ring,130);assert.equal(f.$('look-status').textContent,'已保存，界面已更新。');
});

test('appearance save submits one snapshot and preserves edits made while its response is pending',async t=>{
 const f=await fixture(t);f.edit('text','段间距',16);const before=f.controller.draft,held=f.holdAppearance(),saving=f.save();
 f.edit('text','段间距',28);f.edit('status',f.store.read().fields.size.label,24.25);f.edit('layout','额外消息间距',36);
 held.resolve();await saving;
 assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,16);
 assert.deepEqual(f.layoutCalls[0],before.layout,'a later layout edit is not part of the earlier submitted save');
 assert.equal(f.controller.draft.text.paragraph_spacing,28);assert.equal(f.controller.draft.status.size,24.25);
 assert.match(f.$('look-status').textContent,/未保存/);
 await f.reopen();assert.equal(f.controller.draft.text.paragraph_spacing,28,'reopening does not discard the later draft');
 await f.save();assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,28);assert.equal(f.store.read().settings.regions.status.size,24.25);assert.doesNotMatch(f.$('look-status').textContent,/未保存/);
});

test('edits made while layout persistence waits remain unsaved and visible',async t=>{
 const f=await fixture(t);f.edit('text','段间距',18);const gate=f.holdLayout(),saving=f.save();await settle();assert.equal(f.layoutCalls.length,1);
 f.edit('text','段间距',30);gate.resolve();await saving;
 assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,18);assert.equal(f.controller.draft.text.paragraph_spacing,30);assert.match(f.$('look-status').textContent,/未保存/);
 await f.reopen();assert.equal(f.controller.draft.text.paragraph_spacing,30);
});

test('reset during a save remains a newer unsaved choice',async t=>{
 const f=await fixture(t);f.edit('text','段间距',24);const gate=f.holdAppearance(),saving=f.save();f.$('look-reset').onclick();const reset=f.controller.draft;
 gate.resolve();await saving;assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,24);assert.deepEqual(f.controller.draft,reset);assert.match(f.$('look-status').textContent,/未保存/);
 await f.reopen();assert.deepEqual(f.controller.draft,reset);
});

test('an earlier appearance commit plus failed layout cannot erase a later revert to the original value',async t=>{
 const f=await fixture(t),original=f.controller.draft.text.paragraph_spacing;f.edit('text','段间距',24);const gate=f.holdAppearance(),saving=f.save();
 f.edit('text','段间距',original);f.failLayout();gate.resolve();await saving;
 assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,24);assert.match(f.$('look-status').textContent,/layout persistence failed/);
 await f.reopen();assert.equal(f.controller.draft.text.paragraph_spacing,original,'the explicit newer revert is still unsaved relative to the partial commit');
 await f.save();assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,original);
});

test('failed appearance requests keep the latest draft and allow retry',async t=>{
 const f=await fixture(t);f.edit('text','段间距',18);const gate=f.holdAppearance(),saving=f.save();f.edit('text','段间距',26);gate.reject(Error('appearance disconnected'));await saving;
 assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,defaults().regions.assistant.paragraph_spacing);assert.equal(f.controller.draft.text.paragraph_spacing,26);assert.match(f.$('look-status').textContent,/appearance disconnected/);assert.equal(f.$('look-save').disabled,false);
 await f.save();assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,26);assert.doesNotMatch(f.$('look-status').textContent,/未保存/);
});

test('a real appearance version conflict preserves newer edits until an explicit refreshed retry',async t=>{
 const f=await fixture(t);f.edit('text','段间距',18);const gate=f.holdAppearance(),saving=f.save();f.edit('text','段间距',26);
 const current=f.store.read();assert.equal(f.store.update({first_line_indent:1},current.version).ok,true);gate.resolve();await saving;
 assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,defaults().regions.assistant.paragraph_spacing);assert.equal(f.controller.draft.text.paragraph_spacing,26);assert.equal(f.layoutCalls.length,0);
 assert.doesNotMatch(f.$('look-status').textContent,/已保存/);assert.equal(f.$('look-save').disabled,false);
 await f.reopen();assert.equal(f.controller.draft.text.paragraph_spacing,26);await f.save();assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,26);
});

test('a refresh started before a save cannot replace the saved preview, draft or CAS version',async t=>{
 const f=await fixture(t),old=f.holdRead();await f.reopen();assert.equal(f.readCalls.length,1);
 f.edit('text','段间距',18);await f.save();const version=f.store.read().version,status=f.$('look-status').textContent;
 old.resolve();await settle();
 assert.equal(f.controller.draft.text.paragraph_spacing,18,'the delayed old read cannot reload the saved draft');
 assert.equal(f.$('look-stage').style.getPropertyValue('--os-assistant-paragraph'),'18px');
 assert.equal(f.doc.body.style.getPropertyValue('--os-assistant-paragraph'),'18px');
 assert.equal(f.$('look-status').textContent,status);
 f.edit('text','段间距',24);await f.save();assert.equal(f.appearanceCalls.at(-1).expected_version,version);assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,24);
});

test('refreshes completed in reverse order keep the newest saved values',async t=>{
 const f=await fixture(t),old=f.holdRead();await f.reopen();
 const current=f.store.read();assert.equal(f.store.update({regions:{assistant:{paragraph_spacing:20}}},current.version).ok,true);
 const latest=f.holdRead();await f.reopen();assert.equal(f.readCalls.length,2);latest.resolve();await settle();assert.equal(f.controller.draft.text.paragraph_spacing,20);
 old.resolve();await settle();assert.equal(f.controller.draft.text.paragraph_spacing,20);assert.equal(f.doc.body.style.getPropertyValue('--os-assistant-paragraph'),'20px');
});

test('reverse refresh responses preserve both newer local edits and concurrent persisted settings',async t=>{
 const f=await fixture(t),old=f.holdRead();await f.reopen();
 const current=f.store.read(),updated=f.store.update({first_line_indent:1,regions:{assistant:{paragraph_spacing:20}}},current.version);assert.equal(updated.ok,true);
 f.edit('text','段间距',26);const latest=f.holdRead();await f.reopen();latest.resolve();await settle();
 old.resolve();await settle();assert.equal(f.controller.draft.text.paragraph_spacing,26);assert.equal(f.$('look-stage').style.getPropertyValue('--os-assistant-paragraph'),'26px');
 assert.equal(f.doc.body.style.getPropertyValue('--os-assistant-paragraph'),'20px');assert.equal(f.doc.body.style.getPropertyValue('--os-first-indent'),'1em');
 assert.match(f.$('look-status').textContent,/保存/);await f.save();assert.equal(f.appearanceCalls.at(-1).expected_version,updated.version);assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,26);
});

test('an older rejected refresh cannot replace feedback from a newer successful refresh',async t=>{
 const f=await fixture(t),old=f.holdRead();await f.reopen();
 const current=f.store.read();assert.equal(f.store.update({regions:{assistant:{paragraph_spacing:20}}},current.version).ok,true);
 const latest=f.holdRead();await f.reopen();latest.resolve();await settle();const status=f.$('look-status').textContent;
 old.reject(Error('old refresh disconnected'));await settle();assert.equal(f.$('look-status').textContent,status);assert.equal(f.controller.draft.text.paragraph_spacing,20);assert.equal(f.doc.body.style.getPropertyValue('--os-assistant-paragraph'),'20px');
});

test('an older unsuccessful refresh cannot replace successful save feedback',async t=>{
 const f=await fixture(t),old=f.holdRead();await f.reopen();f.edit('text','段间距',18);await f.save();const status=f.$('look-status').textContent;
 old.resolve({ok:false,error:'old read failed'});await settle();assert.equal(f.$('look-status').textContent,status);assert.equal(f.controller.draft.text.paragraph_spacing,18);assert.equal(f.doc.body.style.getPropertyValue('--os-assistant-paragraph'),'18px');
});

test('a current refresh failure remains visible and an explicit retry loads the current settings',async t=>{
 const f=await fixture(t),current=f.holdRead();await f.reopen();current.reject(Error('current refresh disconnected'));await settle();assert.match(f.$('look-status').textContent,/current refresh disconnected/);
 const saved=f.store.read();assert.equal(f.store.update({regions:{assistant:{paragraph_spacing:20}}},saved.version).ok,true);
 await f.reopen();assert.equal(f.controller.draft.text.paragraph_spacing,20);assert.equal(f.$('look-status').textContent,'');
});

test('a refresh started before theme removal cannot restore the removed theme or its old version',async t=>{
 const f=await fixture(t),current=f.store.read();assert.equal(f.store.update({theme_css:'body{--theme-accent:#123456}'},current.version).ok,true);await f.reopen();assert.equal(f.$('look-theme-remove').hidden,false);
 const old=f.holdRead();await f.reopen();await f.$('look-theme-remove').onclick();const version=f.store.read().version,status=f.$('look-status').textContent;
 old.resolve();await settle();assert.equal(f.$('look-theme-remove').hidden,true);assert.equal(f.$('look-status').textContent,status);
 f.edit('text','段间距',18);await f.save();assert.equal(f.appearanceCalls.at(-1).expected_version,version);assert.equal(f.store.read().settings.theme_css,'');assert.equal(f.store.read().settings.regions.assistant.paragraph_spacing,18);
});
