// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; settle; deferred; selection; editorModule; loadEditor; documentFixture; editorFixture; groupFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/contact-create105.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url');
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const selection=(mode='random',id='avatar.first',seconds=900)=>({mode,intervalSeconds:seconds,nextAt:mode==='random'?Date.now()+seconds*1000:0,id,digest:'a'.repeat(64)});

// Mount the production controllers. Only the separate theme picker is replaced
// by a controllable boundary; menus, editing, permission choices and RPC payloads
// below all run through the real contacts/groups implementation.
let editorModule;
function loadEditor(){
 if(!editorModule)editorModule=(async()=>{const url=pathToFileURL(require.resolve('../ui/contacts.mjs')).href+'?create105';
  const hooks=registerHooks({resolve(specifier,context,next){return context.parentURL===url&&specifier==='./theme-library.mjs'?{url:'data:text/javascript,'+encodeURIComponent('export const pickTheme=(api,options)=>api.pickTheme(options);'),shortCircuit:true}:next(specifier,context);}});
  try{return await import(url);}finally{hooks.deregister();}
 })();return editorModule;
}
function documentFixture(t){
 const previous=new Map();for(const [key,value]of Object.entries({cancelAnimationFrame(){},requestAnimationFrame:()=>1})){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const cleanup=()=>{for(const [key,d]of previous)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];};
 let doc;
 class Node{
  constructor(tag,type=1,text=''){this.nodeType=type;this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.childNodes=[];this.parentNode=null;this.attrs={};this.dataset={};this.style={setProperty(){}};this.listeners={};this.className='';this._text=text;this.value='';this.disabled=false;this.readOnly=false;this.inert=false;this.hidden=false;this.open=false;this.scrollHeight=60;this.offsetWidth=300;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ');},contains:name=>this.className.split(' ').includes(name)};}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');}set textContent(v){this._text=String(v);this.replaceChildren();}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  append(...nodes){for(let n of nodes){if(typeof n==='string')n=doc.createTextNode(n);n.remove();this.childNodes.push(n);n.parentNode=this;}}prepend(n){n.remove();this.childNodes.unshift(n);n.parentNode=this;}
  replaceChildren(...nodes){for(const n of [...this.childNodes])n.remove();this.append(...nodes);}remove(){if(this.parentNode){this.parentNode.childNodes=this.parentNode.childNodes.filter(n=>n!==this);this.parentNode=null;}}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=String(v);if(k==='id')this.id=v;if(k==='hidden')this.hidden=true;if(k==='disabled')this.disabled=true;if(k==='value')this.value=v;}
  getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];if(k==='hidden')this.hidden=false;}hasAttribute(k){if(k==='hidden')return this.hidden;if(k==='inert')return this.inert;return k in this.attrs;}
  matches(selector){return selector.split(',').some(s=>{s=s.trim();if(s==='*')return true;if(s===':popover-open')return !!this.popoverOpen;let excluded=false;s=s.replace(/:not\(([^)]+)\)/g,(_,part)=>{excluded||=this.matches(part);return '';});if(excluded)return false;const tag=s.match(/^[\w-]+/);if(tag&&this.tagName!==tag[0].toUpperCase())return false;for(const m of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;for(const m of s.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g))if(!this.hasAttribute(m[1])||m[2]!==undefined&&this.getAttribute(m[1])!==m[2])return false;return !!tag||s.startsWith('.')||s.startsWith('[');});}
  querySelectorAll(s){if(s.startsWith(':scope > '))return this.children.filter(n=>n.matches(s.slice(9)));return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)]);}
  querySelector(s){if(s.includes(' ')&&!s.startsWith(':scope > ')){const [first,...rest]=s.split(' ');return this.querySelectorAll(first).map(n=>n.querySelector(rest.join(' '))).find(Boolean)||null;}return this.querySelectorAll(s)[0]||null;}
  closest(s){for(let n=this;n;n=n.parentNode)if(n.matches(s))return n;return null;}contains(n){return n===this||this.children.some(c=>c.contains(n));}
  addEventListener(type,fn){(this.listeners[type]??=new Set()).add(fn);}removeEventListener(type,fn){this.listeners[type]?.delete(fn);}
  emit(type,extra={}){const event={type,target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};this['on'+type]?.(event);for(const fn of this.listeners[type]||[])fn(event);return event;}
  blocked(){for(let n=this;n;n=n.parentNode)if(n.inert)return true;return this.disabled;}click(){if(!this.blocked())this.emit('click');}focus(){if(!this.blocked())doc.activeElement=this;}select(){}scrollIntoView(){}checkVisibility(){return !this.hidden&&this.isConnected;}
  getBoundingClientRect(){return {left:0,top:0,right:600,bottom:700,width:600,height:700};}showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
  showPopover(){this.popoverOpen=true;this.emit('toggle',{newState:'open'});}hidePopover(){this.popoverOpen=false;this.emit('toggle',{newState:'closed'});}
  set innerHTML(html){this.replaceChildren();parse(this,html);}insertAdjacentHTML(where,html){const fragment=new Node('fragment');parse(fragment,html);if(where==='afterbegin')for(const n of [...fragment.childNodes].reverse())this.prepend(n);else this.append(...fragment.childNodes);}
 }
 function parse(root,html){const stack=[root],voids=new Set(['INPUT','IMG','BR','HR','META','LINK']);for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(token.startsWith('<')){const m=token.match(/^<([\w-]+)/);if(!m)continue;const n=new Node(m[1]);for(const a of token.slice(m[0].length).matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))n.setAttribute(a[1],a[2]??a[3]??a[4]??'');stack.at(-1).append(n);if(!voids.has(n.tagName)&&!token.endsWith('/>'))stack.push(n);}else if(token.trim())stack.at(-1).append(new Node('#text',3,token));}}
 const events={};doc={cleanup,createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',3,text),activeElement:null,addEventListener(type,fn){(events[type]??=new Set()).add(fn);},removeEventListener(type,fn){events[type]?.delete(fn);},defaultView:{innerWidth:900,innerHeight:800,addEventListener(){},removeEventListener(){},MutationObserver:class{observe(){}disconnect(){}}}};doc.body=new Node('body');doc.activeElement=doc.body;return doc;
}
async function editorFixture(t,{realStore=false}={}){
 const doc=documentFixture(t),calls=[],writes=[],reports=[],media=[],themes=[],images=[],requests=[],record={id:'one',name:'Original',model_id:'m1',prompt:'',tools:[],sessions:[{id:'s1'}]},records=new Map([['one',record]]);let saveGate;
 const metadata=c=>{const copy=structuredClone(c);delete copy.avatar;return copy;};
 const api={themeLibrary:p=>{const gate=deferred();calls.push(p);media.push(gate);return gate.promise;},pickTheme:p=>{const gate=deferred();themes.push({options:p,...gate});return gate.promise;},conversation:async p=>{
  requests.push(p);if(p.action==='contacts')return [...records.values()].map(metadata);if(p.action==='groups')return [];if(p.action==='models')return [{id:'m1',name:'Model'}];if(p.action==='contact')return metadata(records.get(p.id));
  if(p.action==='contact_avatar'){const gate=deferred();images.push({id:p.id,revision:records.get(p.id).avatar_rev,...gate});return gate.promise;}
  if(p.action==='contact_update'){writes.push(p);if(saveGate)await saveGate.promise;Object.assign(records.get(p.id),p);return metadata(records.get(p.id));}throw Error('unexpected conversation action '+p.action);
 }};
 const {setupContactEditor,createContactStore}=await loadEditor(),store=realStore?createContactStore(api,{doc,onError:e=>reports.push(e)}):{models:async()=>[{id:'m1',name:'Model'}],detail:async()=>structuredClone(record),avatar:()=>record.avatar||'',refresh:async()=>{},create:async p=>{writes.push(p);if(saveGate)await saveGate.promise;return {id:'created',sessions:[{id:'new'}]};},update:async p=>{writes.push(p);Object.assign(record,p);return record;}};
 const editor=setupContactEditor({doc,store,api,report:e=>reports.push(e.message||String(e)),openSession:async()=>{},remove:async()=>false});
 const dialog=doc.body.querySelector('.contact-editor'),q=s=>dialog.querySelector(s),options=()=>q('.ce-menu-viewport').children.filter(n=>n.getAttribute('role')==='option');t.after(()=>{editor.close();store.close?.();doc.cleanup();});await settle();
 return {doc,editor,dialog,q,api,store,calls,writes,reports,media,themes,images,requests,options,record,records,face:()=>q('.ce-avatar .role-face')?.src||'',async open(id=null){await editor.open(id);await settle();},async random(period='5 分钟'){await this.source('随机');options().find(n=>n.textContent===period).click();await settle();},async source(label){q('.ce-avatar').click();const option=options().find(n=>n.textContent===label);assert(option,'missing avatar source '+label);option.click();await settle();},holdSave(){return saveGate=deferred();},async save(){q('.ce-save').click();await settle();}};
}
test('a new contact keeps default media unset until the user explicitly chooses or removes it',async t=>{
 const f=await editorFixture(t);await f.open();await f.save();assert.equal(f.writes.length,1);assert.equal(Object.hasOwn(f.writes[0],'avatar'),false);assert.equal(Object.hasOwn(f.writes[0],'avatar_rotation'),false);assert.equal(f.writes[0].description,'与你协作的助手');
 await f.open();await f.random();f.media[0].resolve({ok:true,value:'data:chosen',rotation:selection()});await settle();await f.source('移除');await f.save();assert.equal(f.writes[1].avatar,'');assert.equal(f.writes[1].avatar_rotation.mode,'off');
});
test('avatar click offers the four requested actions and custom alone opens the file input',async t=>{
 const f=await editorFixture(t);await f.open();let files=0;f.q('input[type=file]').onclick=()=>files++;f.q('.ce-avatar').click();assert.deepEqual(f.options().map(n=>n.textContent),['头像库','随机','自定义','移除']);assert.equal(files,0);assert.equal(f.q('.ce-avatar').getAttribute('aria-expanded'),'true');
 f.options().find(n=>n.textContent==='自定义').click();assert.equal(files,1);assert.equal(f.q('.ce-menu').hidden,true);assert.equal(f.q('.ce-avatar').getAttribute('aria-expanded'),'false');assert.equal(f.calls.length,0);
});
test('theme and random sources update only this draft, exclude the previous selection, and save the actual image',async t=>{
 const f=await editorFixture(t);await f.open();await f.source('头像库');assert.deepEqual(f.themes[0].options,{target:'avatar'});f.themes[0].resolve({value:'data:theme',item:{id:'avatar.first'},rotation:selection('theme')});await settle();assert.equal(f.writes.length,0);
 await f.random();assert.equal(f.calls[0].action,'prepare');assert.equal(f.calls[0].mode,'random');assert.equal(f.calls[0].target,'avatar');assert.equal(f.calls[0].exclude_id,'avatar.first');f.media[0].resolve({ok:true,value:'data:random',item:{id:'avatar.second'},rotation:selection('random','avatar.second')});await settle();await f.save();assert.equal(f.writes[0].avatar,'data:random');assert.deepEqual(f.writes[0].tools,[],'showing more tools does not grant them');assert.equal(f.dialog.open,false);
});
test('custom agents save shared rotation metadata and reopen the selected automatic interval',async t=>{
 const f=await editorFixture(t);await f.open('one');await f.random();f.media[0].resolve({ok:true,value:'data:auto',rotation:selection('random','avatar.auto')});await settle();await f.random('1 小时');await f.save();assert.equal(f.writes[0].avatar_rotation.mode,'random');assert.equal(f.writes[0].avatar_rotation.intervalSeconds,3600);assert.equal(f.writes[0].avatar_rotation.id,'avatar.auto');assert(f.writes[0].avatar_rotation.nextAt>Date.now()+3500*1000);assert.equal(f.writes[0].avatar_expected_revision,undefined,'normal edits keep their original save contract');
 await f.open('one');await f.source('随机');assert.equal(f.options().find(n=>n.textContent==='1 小时').getAttribute('aria-selected'),'true');assert.equal(f.calls.length,1,'reopening reads the saved selection instead of starting another random request');
});
test('library choice or removing an automatic avatar stops its saved rotation',async t=>{
 const f=await editorFixture(t);f.record.avatar='data:old';f.record.avatar_rotation=selection('random');await f.open('one');await f.source('头像库');f.themes[0].resolve({value:'data:theme',rotation:selection('theme','avatar.theme')});await settle();assert.equal(f.q('.ce-avatar-rotation-row'),null);await f.save();assert.equal(f.writes[0].avatar_rotation.mode,'theme');assert.equal(f.writes[0].avatar_rotation.nextAt,0);
 f.record.avatar_rotation=selection('random');await f.open('one');await f.source('移除');await f.save();assert.equal(f.writes[1].avatar,'');assert.equal(f.writes[1].avatar_rotation.mode,'off');assert.equal(f.writes[1].avatar_rotation.id,'');
});
test('a built-in contact uses the same editable rotation field through its authoritative profile save',async t=>{
 const f=await editorFixture(t);f.record.builtin='eyra';const current=selection('random');let saved;f.api.builtinRole=async p=>{if(p.action==='save'){saved=p;return {ok:true};}return {ok:true,name:'Eyra',model_id:'m1',profile_version:'p1',model_version:'m1',avatar:'data:eyra',avatar_rotation:current,prompts:[{id:'self',title:'人格与沟通',text:'',version:'v1'}]};};await f.open('one');await f.random('10 分钟');await f.save();assert.equal(saved.builtin,'eyra');assert.equal(saved.avatar_rotation.intervalSeconds,600);assert.equal(saved.avatar,undefined,'changing only the period keeps the current image');assert.equal(f.writes.length,0);
});
test('a late random result cannot replace a newer source or a cleared avatar',async t=>{
 const f=await editorFixture(t);await f.open();await f.random();await f.source('头像库');f.themes[0].resolve({value:'data:newer',rotation:selection('theme','avatar.newer')});await settle();f.media[0].resolve({ok:true,value:'data:old',rotation:selection()});await settle();
 await f.random();await f.source('移除');f.media[1].resolve({ok:true,value:'data:cleared-old'});await settle();await f.save();assert.equal(f.writes[0].avatar,'');
});
test('saving or reopening discards pending avatar receipts and a failed random leaves the selected image intact',async t=>{
 const f=await editorFixture(t);await f.open();await f.source('头像库');f.themes[0].resolve({value:'data:kept',rotation:selection('theme')});await settle();await f.random();f.media[0].reject(Error('theme service unavailable'));await settle();assert.match(f.q('.ce-error').textContent,/unavailable/);
 await f.random();const gate=f.holdSave();await f.save();f.media[1].resolve({ok:true,value:'data:too-late'});await settle();assert.equal(f.writes[0].avatar,'data:kept');gate.resolve();await settle();await f.open('one');assert.equal(f.q('.ce-error').textContent,'');
 await f.random();f.dialog.close();await f.open();f.media[2].reject(Error('old editor failure'));await settle();assert.equal(f.q('.ce-error').textContent,'');assert.deepEqual(f.reports,[]);
});
test('tool choices match the actual Core allowlist, Link is readonly, and selecting tools saves only the explicit grants',async t=>{
 const f=await editorFixture(t);await f.open();f.q('.ce-add').click();const core=fs.readFileSync(require.resolve('../../../Core/conversation_contacts.go'),'utf8'),allow=core.match(/var conversationWorkTools = \[\]string\{([^}]+)\}/)[1].match(/"[^"]+"/g).map(s=>JSON.parse(s));
 const options=f.options();assert.deepEqual(options.filter(n=>n.getAttribute('aria-disabled')!=='true').map(n=>n.dataset.tool).sort(),allow.sort());const link=options.find(n=>n.dataset.tool==='agents');assert(link);assert.equal(link.getAttribute('aria-disabled'),'true');assert.equal(link.tagName,'DIV');
 options.find(n=>n.dataset.tool==='read_shell_output').click();await settle();await f.save();assert.deepEqual(f.writes[0].tools,['read_shell_output']);
});
test('a writable tool still requires its explicit grant and the chosen permission survives reopening',async t=>{
 const f=await editorFixture(t);await f.open('one');f.q('.ce-add').click();f.options().find(n=>n.dataset.tool==='project').click();await settle();let confirm=f.doc.body.children.find(n=>n.classList.contains('contact-confirm')&&n.open);assert(confirm);assert.equal(f.writes.length,0);confirm.returnValue='cancel';confirm.close();await settle();assert(!f.q('.ce-chips').textContent.includes('项目'));
 f.options().find(n=>n.dataset.tool==='project').click();await settle();confirm=f.doc.body.children.find(n=>n.classList.contains('contact-confirm')&&n.open);assert(confirm);confirm.returnValue='ok';confirm.close();await settle();await f.save();assert.deepEqual(f.writes[0].tools,['project']);await f.open('one');assert(f.q('.ce-chips').textContent.includes('项目'));f.q('.ce-add').click();assert.equal(f.options().find(n=>n.dataset.tool==='project').getAttribute('aria-selected'),'true');assert.equal(f.options().find(n=>n.dataset.tool==='exec_command').getAttribute('aria-selected'),'false');
});
test('avatar source menu follows shared Home/End/Escape focus behavior',async t=>{
 const f=await editorFixture(t);await f.open();f.q('.ce-avatar').click();const menu=f.q('.ce-menu');menu.emit('keydown',{key:'End'});assert.equal(f.doc.activeElement.textContent,'移除');menu.emit('keydown',{key:'Home'});assert.equal(f.doc.activeElement.textContent,'头像库');menu.emit('keydown',{key:'Escape'});assert.equal(menu.hidden,true);assert.equal(f.doc.activeElement,f.q('.ce-avatar'));assert.equal(f.dialog.open,true);
});

test('an open editor receives its latest delayed avatar and shares the list request without dirtying the draft',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();f.images[0].resolve({avatar:'data:first',avatar_rev:1});await settle();assert.equal(f.store.avatar('one'),'data:first');
 f.record.avatar_rev=2;await f.store.refresh();await f.open('one');assert.equal(f.face(),'data:first');assert.equal(f.images.length,2,'opening reuses the pending read of this revision');
 f.images[1].resolve({avatar:'data:rotated',avatar_rev:2});await settle();assert.equal(f.face(),'data:rotated');assert.equal(f.writes.length,0);await f.save();assert.equal(f.writes[0].avatar,undefined,'receiving a saved avatar is not a manual avatar edit');assert.equal(f.writes[0].avatar_rotation,undefined);assert.deepEqual(f.reports,[]);
});
test('editor avatar loading follows detail revision even when contact polling still has the previous revision',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();f.images[0].resolve({avatar:'data:first',avatar_rev:1});await settle();f.record.avatar_rev=2;
 await f.open('one');assert.equal(f.store.contacts[0].avatar_rev,1);assert.equal(f.images.length,2,'the newer detail starts its own exact-version read');f.images[1].resolve({avatar:'data:detail-latest',avatar_rev:2});await settle();assert.equal(f.face(),'data:detail-latest');assert.equal(f.store.avatarRev('one'),1,'a detail read does not relabel the older list snapshot');
});
test('delayed avatar replies stay with the original contact instead of a subsequently opened editor',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;f.records.set('two',{...f.record,id:'two',name:'Second',avatar_rev:3});await f.store.refresh();await f.open('one');f.dialog.close();await f.open('two');
 f.images.find(p=>p.id==='one').resolve({avatar:'data:wrong-contact',avatar_rev:1});await settle();assert.equal(f.face(),'');assert.equal(f.q('.ce-name').value,'Second');f.images.find(p=>p.id==='two').resolve({avatar:'data:second',avatar_rev:3});await settle();assert.equal(f.face(),'data:second');
});
test('reopening the same contact rejects the previous open generation and requires the exact avatar revision',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();await f.open('one');f.dialog.close();f.record.avatar_rev=2;await f.store.refresh();await f.open('one');assert.equal(f.images.length,2);
 f.images[0].resolve({avatar:'data:old-generation',avatar_rev:1});await settle();assert.equal(f.face(),'');f.images[1].resolve({avatar:'data:reopened',avatar_rev:2});await settle();assert.equal(f.face(),'data:reopened');
 f.dialog.close();f.record.avatar_rev=3;await f.open('one');f.images[2].resolve({avatar:'data:unexpected-revision',avatar_rev:4});await settle();assert.equal(f.face(),'data:reopened','a different revision cannot replace the retained image');
});
test('a delayed saved avatar cannot overwrite a manually selected avatar',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();await f.open('one');await f.source('头像库');f.themes[0].resolve({value:'data:manual',rotation:selection('theme','avatar.manual')});await settle();assert.equal(f.face(),'data:manual');
 f.images[0].resolve({avatar:'data:saved-late',avatar_rev:1});await settle();assert.equal(f.face(),'data:manual');await f.save();assert.equal(f.writes[0].avatar,'data:manual');
});
test('clearing or submitting the editor prevents delayed saved-avatar backfill',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();f.images[0].resolve({avatar:'data:first',avatar_rev:1});await settle();f.record.avatar_rev=2;await f.store.refresh();await f.open('one');await f.source('移除');assert.equal(f.face(),'');
 f.images[1].resolve({avatar:'data:removed-late',avatar_rev:2});await settle();assert.equal(f.face(),'');await f.save();assert.equal(f.writes[0].avatar,'');
 f.record.avatar_rev=3;await f.store.refresh();await f.open('one');const before=f.face(),gate=f.holdSave();await f.save();f.images.at(-1).resolve({avatar:'data:during-save',avatar_rev:3});await settle();assert.equal(f.face(),before);assert.equal(f.writes.at(-1).avatar,undefined);gate.resolve();await settle();assert.equal(f.dialog.open,false);assert.deepEqual(f.reports,[]);
});
test('a saved-avatar failure retains the image and a later polling recovery updates the unchanged editor',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();f.images[0].resolve({avatar:'data:kept',avatar_rev:1});await settle();f.record.avatar_rev=2;await f.store.refresh();await f.open('one');
 f.images[1].reject(Error('temporary avatar read failure'));await settle();assert.equal(f.face(),'data:kept');assert.deepEqual(f.reports,['temporary avatar read failure']);now+=5000;await f.store.refresh();assert.equal(f.images.length,3);f.images[2].resolve({avatar:'data:recovered',avatar_rev:2});await settle();assert.equal(f.face(),'data:recovered');assert.equal(f.writes.length,0);
});
test('a removed avatar in fresh detail clears an older cached image without another image request',async t=>{
 const f=await editorFixture(t,{realStore:true});f.record.avatar_rev=1;await f.store.refresh();f.images[0].resolve({avatar:'data:old-cache',avatar_rev:1});await settle();f.record.avatar_rev=0;await f.open('one');assert.equal(f.face(),'');assert.equal(f.images.length,1);await f.save();assert.equal(f.writes[0].avatar,undefined);
});

async function groupFixture(t,{group=null,people}={}){
 const doc=documentFixture(t),persons=people||[{id:'a',name:'甲'},{id:'b',name:'乙'},{id:'c',name:'丙'}],writes=[];let gate;
 const {groupDialog}=await import('../ui/groups.mjs'),dialog=groupDialog({doc,store:{people:persons,contacts:persons,avatar:()=>''},group,confirm:async()=>true,save:async(name,members,host,id)=>{writes.push({name,members,host,id});if(gate)await gate.promise;return {id:'g'};}});
 t.after(()=>{if(dialog.open)dialog.close();doc.cleanup();});const q=s=>dialog.querySelector(s);return {doc,dialog,q,writes,pick:id=>q('.ge-picks').children.find(n=>n.dataset.contact===id),host:()=>q('.ge-host'),options:()=>q('.ge-host-menu').children,hold:()=>gate=deferred(),async save(){q('.ce-primary').click();await settle();}};
}
test('new group has a clear empty host state and removing its provisional host selects a remaining member',async t=>{
 const f=await groupFixture(t);assert(f.host());assert.equal(f.host().disabled,true);assert.match(f.host().textContent,/选择成员/);f.pick('a').click();assert.equal(f.host().disabled,false);assert.match(f.host().textContent,/甲/);f.pick('a').click();assert.equal(f.pick('a').getAttribute('aria-checked'),'false');assert.equal(f.host().disabled,true);
 f.pick('a').click();f.pick('b').click();f.host().click();const b=f.options().find(n=>n.dataset.contact==='b');assert(b);b.click();assert.match(f.host().textContent,/乙/);f.pick('b').click();assert.match(f.host().textContent,/甲/);await f.save();assert.deepEqual(f.writes[0].members,['a']);assert.equal(f.writes[0].host,'a');assert(f.writes[0].id);
});
test('editing preserves the initial host and explains why a newly added member cannot host until saved',async t=>{
 const group={id:'g',name:'Existing',initial_host_contact:'a',host_contact:'b',host_name:'乙',members:[{key:'host',name:'甲'},{key:'b',name:'乙'}]},f=await groupFixture(t,{group});f.pick('a').click();assert.equal(f.pick('a').getAttribute('aria-checked'),'true');assert.match(f.q('.ce-error').textContent,/初始/);f.pick('b').click();assert.match(f.q('.ce-error').textContent,/其他主持/);
 f.pick('c').click();f.host().click();const c=f.options().find(n=>n.dataset.contact==='c');assert.equal(c.disabled,true);assert.match(c.textContent,/保存/);c.click();assert.match(f.host().textContent,/乙/);f.options().find(n=>n.dataset.contact==='a').click();f.pick('b').click();await f.save();assert.deepEqual(f.writes[0].members.sort(),['a','c']);assert.equal(f.writes[0].host,'a');
});
test('host chooser participates in the save lock, keeps disabled candidates after a failure, and retains the draft',async t=>{
 const f=await groupFixture(t,{group:{id:'g',name:'Existing',host_contact:'',host_name:'Eyra',members:[{key:'host',name:'Eyra'},{key:'a',name:'甲'}]}});f.pick('c').click();f.host().click();const gate=f.hold();await f.save();assert.equal(f.host().disabled,true);assert.equal(f.q('.ge-host-menu').matches(':popover-open'),false);f.pick('b').click();assert.equal(f.writes.length,1);gate.reject(Error('save failed'));await settle();assert.equal(f.dialog.open,true);assert.equal(f.host().disabled,false);f.host().click();assert.equal(f.options().find(n=>n.dataset.contact==='c').disabled,true);assert.match(f.q('.ce-error').textContent,/save failed/);
});
test('host selector shares keyboard navigation and Escape returns to its trigger without closing the draft',async t=>{
 const f=await groupFixture(t);await f.save();assert.equal(f.writes.length,0);assert.match(f.q('.ce-error').textContent,/至少/);f.pick('a').click();f.pick('b').click();f.host().emit('keydown',{key:'ArrowDown'});const menu=f.q('.ge-host-menu');assert.equal(menu.matches(':popover-open'),true);assert.equal(f.doc.activeElement.dataset.contact,'a');menu.emit('keydown',{key:'End'});assert.equal(f.doc.activeElement.dataset.contact,'b');menu.emit('keydown',{key:'Escape'});assert.equal(menu.matches(':popover-open'),false);assert.equal(f.doc.activeElement,f.host());assert.equal(f.dialog.open,true);
});
