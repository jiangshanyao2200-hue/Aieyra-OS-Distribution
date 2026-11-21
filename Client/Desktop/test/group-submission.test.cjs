// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; tick; documentFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/group-submission.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('committed group with a lost reply is retried with the same id and creates only one durable record',async t=>{
 const {createContactStore}=await import('../ui/contacts.mjs'),{createGroupSubmission}=await import('../ui/groups.mjs');
 const durable=new Map(),ids=[];let lose=true;
 const store=createContactStore({conversation:async p=>{
  if(p.action==='contacts')return [];
  if(p.action==='groups')return [...durable.values()];
  assert.equal(p.action,'group_create');ids.push(p.request_id);
  if(!durable.has(p.request_id))durable.set(p.request_id,{id:p.request_id,name:p.name,members:p.members});
  if(lose){lose=false;throw Error('reply lost after commit');}return durable.get(p.request_id);
 }},{doc:{addEventListener(){},removeEventListener(){}}});t.after(()=>store.close());await tick();
 const submit=createGroupSubmission((...args)=>store.createGroup(...args));
 await assert.rejects(submit('same group',['cota','vaya'],'cota'),/reply lost/);
 const saved=await submit('same group',['vaya','cota'],'cota');assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(durable.size,1);assert.equal(saved.id,ids[0]);
 assert.equal(await submit('same group',['cota','vaya'],'cota'),saved);assert.equal(ids.length,2,'accepted receipt is cached');
 const another=createGroupSubmission((...args)=>store.createGroup(...args));await another('same group',['cota','vaya'],'cota');assert.equal(durable.size,2,'a separate deliberate creation owns a new id');
});

test('concurrent creation retries share the pending receipt and cannot change its submitted payload',async()=>{
 const {createGroupSubmission}=await import('../ui/groups.mjs');let finish;const calls=[];
 const submit=createGroupSubmission((...args)=>{calls.push(args);return new Promise(resolve=>finish=resolve);});
 const first=submit('group',['a'],'a'),second=submit('group',['a'],'a');assert.equal(first,second);await tick();assert.equal(calls.length,1);
 await assert.rejects(submit('other',['a'],'a'),/正在创建/);finish({id:'one'});assert.deepEqual(await first,{id:'one'});
});

function documentFixture(t){
 const previous=global.cancelAnimationFrame;global.cancelAnimationFrame=()=>{};t.after(()=>{if(previous===undefined)delete global.cancelAnimationFrame;else global.cancelAnimationFrame=previous;});
 class Element{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attrs={};this.style={setProperty(){}};this.events={};this.className='';this.value='';this.open=false;this.disabled=false;this.classList={add:name=>{this.className+=' '+name;}};}
  append(...nodes){for(const node of nodes){this.children.push(node);if(node&&typeof node==='object')node.parentNode=this;}}
  prepend(node){this.children.unshift(node);node.parentNode=this;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  insertAdjacentHTML(){}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  removeEventListener(){}
  matches(selector){return selector===':popover-open'?!!this.popoverOpen:false;}
  showPopover(){this.popoverOpen=true;for(const fn of this.events.toggle||[])fn({newState:'open'});}
  hidePopover(){this.popoverOpen=false;for(const fn of this.events.toggle||[])fn({newState:'closed'});}
  focus(){this.ownerDocument.activeElement=this;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
  querySelectorAll(selector){const parts=selector.split(',').map(s=>s.trim()),all=[];const visit=node=>{for(const child of node.children||[]){if(!child||typeof child!=='object')continue;if(parts.some(s=>s.startsWith('.')?child.className.split(' ').includes(s.slice(1)):child.tagName===s))all.push(child);visit(child);}};visit(this);return all;}
  querySelector(selector){return this.querySelectorAll(selector.replace(':scope > ',''))[0]||null;}
  showModal(){this.open=true;}
  close(){this.open=false;for(const fn of this.events.close||[])fn();}
 }
 const doc={createElement(tag){return new Element(tag,this);},addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){},MutationObserver:class{observe(){}disconnect(){}}}};doc.body=doc.createElement('body');return doc;
}

test('real group dialog closes before opening, reports draft failure separately, and preserves retry id',async t=>{
 const {groupDialog}=await import('../ui/groups.mjs'),doc=documentFixture(t),person={id:'cota',name:'Cota'},errors=[],ids=[],durable=new Map();let first=true,closedAtOpen=false;
 const dialog=groupDialog({doc,store:{people:[person],contacts:[person],avatar:()=>''},confirm:async()=>true,save:async(name,members,host,id)=>{
  ids.push(id);if(!durable.has(id))durable.set(id,{id,name,members,host});if(first){first=false;throw Error('unknown creation reply');}return durable.get(id);
 },afterSave:async()=>{closedAtOpen=!dialog.open;throw Error('draft load failed');},report:error=>errors.push(error.message)});
 dialog.querySelector('.ge-pick').onclick();const create=dialog.querySelector('.ce-primary');await create.onclick();assert.equal(dialog.open,true);assert.equal(create.disabled,false);assert.match(dialog.querySelector('.ce-error').textContent,/unknown creation reply/);
 await create.onclick();assert.equal(dialog.open,false);assert.equal(closedAtOpen,true);assert.deepEqual(errors,['draft load failed']);assert.equal(durable.size,1);assert.equal(ids[0],ids[1]);await create.onclick();assert.equal(ids.length,2,'closed modal cannot submit again');
});
