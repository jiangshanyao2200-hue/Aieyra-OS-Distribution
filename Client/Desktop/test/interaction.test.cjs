// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: key; element
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/interaction.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const key=(value,target={},extra={})=>({key:value,target,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra});
function element(doc){return Object.assign(new EventTarget(),{ownerDocument:doc,isConnected:true,attrs:{},open:false,disabled:false,children:[],setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},closest(){return null;},contains(n){return this.children.includes(n);},focus(){doc.activeElement=this;},scrollIntoView(){},getBoundingClientRect(){return {left:10,top:10,right:100,bottom:100};},showModal(){this.open=true;doc.activeElement=this;},close(){this.open=false;this.dispatchEvent(new Event('close'));},remove(){this.isConnected=false;},getAnimations(){return [];}});}
test('menus skip unavailable choices, wrap focused rows and preserve input editing',async()=>{
 const {menuKey}=await import('../ui/interaction.mjs'),doc={},nodes=Array.from({length:5},()=>element(doc));nodes[1].disabled=true;nodes[2].attrs['aria-disabled']='true';nodes[3].closest=()=>({});doc.activeElement=nodes[0];
 menuKey(key('ArrowDown'),{items:()=>nodes});assert.equal(doc.activeElement,nodes[4]);menuKey(key('ArrowDown'),{items:()=>nodes});assert.equal(doc.activeElement,nodes[0]);
 menuKey(key('ArrowUp'),{items:()=>nodes});assert.equal(doc.activeElement,nodes[4]);
 const edit=key('Home',{closest:()=>({})});assert.equal(menuKey(edit,{items:()=>nodes}),false);assert.equal(edit.defaultPrevented,undefined);
 assert.equal(menuKey(key('ArrowDown',{}, {ctrlKey:true}),{items:()=>nodes}),false);
});
test('active descendant menus clamp without moving search focus and Escape works even when empty',async()=>{
 const {menuKey}=await import('../ui/interaction.mjs'),doc={},nodes=[element(doc),element(doc)];let active=null,chosen=null,closed=0;
 const options={items:()=>nodes,current:()=>active,activate:n=>active=n,wrap:false,onEnter:n=>chosen=n,onEscape:()=>closed++};
 menuKey(key('ArrowUp'),options);assert.equal(active,nodes[1]);menuKey(key('ArrowDown'),options);assert.equal(active,nodes[1]);assert.equal(doc.activeElement,undefined);
 menuKey(key('Enter'),options);assert.equal(chosen,nodes[1]);const escape=key('Escape');menuKey(escape,{...options,items:()=>[]});assert.equal(closed,1);assert.equal(escape.stopped,true);
});
test('dialog dismissal respects pending saves, returns focus and never dismisses on internal whitespace',async()=>{
 const {bindDialog}=await import('../ui/interaction.mjs'),doc={};doc.body=element(doc);const origin=element(doc),dialog=element(doc);let saving=true,closes=0;origin.focus();
 const life=bindDialog(dialog,{canClose:()=>!saving,onClose:()=>closes++});life.show();dialog.dispatchEvent(new Event('cancel',{cancelable:true}));assert.equal(dialog.open,true);
 saving=false;for(const name of ['pointerdown','click'])dialog.dispatchEvent(Object.assign(new Event(name),{clientX:50,clientY:50}));assert.equal(dialog.open,true);
 for(const name of ['pointerdown','click'])dialog.dispatchEvent(Object.assign(new Event(name),{clientX:1,clientY:1}));assert.equal(dialog.open,false);assert.equal(doc.activeElement,origin);assert.equal(closes,1);life.destroy();
});
test('late dialog close cannot steal another surface focus; listeners and removed dialogs are released',async()=>{
 const {bindDialog}=await import('../ui/interaction.mjs'),doc={};doc.body=element(doc);const origin=element(doc),other=element(doc),dialog=element(doc);origin.focus();
 const life=bindDialog(dialog,{remove:true});life.show();other.focus();life.close();await Promise.resolve();await Promise.resolve();assert.equal(doc.activeElement,other);assert.equal(dialog.isConnected,false);life.show();assert.equal(dialog.open,false);
});
test('asynchronous detail openers can resolve their rebuilt row on close',async()=>{
 const {bindDialog}=await import('../ui/interaction.mjs'),doc={};doc.body=element(doc);const dialog=element(doc);let origin=element(doc);origin.focus();const life=bindDialog(dialog,{opener:()=>origin});life.show();origin.isConnected=false;origin=element(doc);life.close();assert.equal(doc.activeElement,origin);life.destroy();
});
test('dialog Escape stays in the current program, respects saving and ignores IME composition',async()=>{
 const {bindDialog}=await import('../ui/interaction.mjs'),doc={};doc.body=element(doc);const dialog=element(doc),origin=element(doc);let saving=false,backs=0;origin.focus();
 const life=bindDialog(dialog,{canClose:()=>!saving});life.show();
 function press(composing=false){const e=Object.assign(new Event('keydown',{cancelable:true,bubbles:true}),{key:'Escape',isComposing:composing});let stopped=false;e.stopPropagation=()=>{stopped=true;};dialog.dispatchEvent(e);if(!stopped&&!e.defaultPrevented&&!composing)backs++;return e;}
 assert.equal(press(true).defaultPrevented,false);assert.equal(dialog.open,true);
 saving=true;assert.equal(press().defaultPrevented,true);assert.equal(dialog.open,true);assert.equal(backs,0);
 saving=false;press();assert.equal(dialog.open,false);assert.equal(doc.activeElement,origin);assert.equal(backs,0);
 life.destroy();dialog.showModal();assert.equal(press().defaultPrevented,false,'disposed dialog releases its key handler');
});

test('dialog Escape clears a focused search before dismissal, publishes input and preserves IME',async()=>{
 const {bindDialog}=await import('../ui/interaction.mjs'),doc={};doc.body=element(doc);const dialog=element(doc),origin=element(doc),search=element(doc);let inputs=0;
 search.value='r92';search.matches=selector=>selector==='input[type="search"]';search.addEventListener('input',()=>inputs++);origin.focus();dialog.children.push(search);
 const life=bindDialog(dialog,{opener:origin});life.show();search.focus();
 function press(composing=false){const e=Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape',isComposing:composing});Object.defineProperty(e,'target',{value:search});dialog.dispatchEvent(e);return e;}
 try{
  press(true);assert.equal(search.value,'r92');assert.equal(dialog.open,true);assert.equal(inputs,0);
  assert.equal(press().defaultPrevented,true);assert.equal(search.value,'');assert.equal(inputs,1);assert.equal(dialog.open,true);assert.equal(doc.activeElement,search);
  press();assert.equal(dialog.open,false);assert.equal(doc.activeElement,origin);
 }finally{life.destroy();}
});

test('titlebar menus continue the owner region without gaps or flipping in short and zoomed viewports',async()=>{
 const {topbarMenuGeometry,positionTopbarMenu}=await import('../ui/interaction.mjs');
 const win={innerWidth:900,innerHeight:300},doc={defaultView:win,getElementById:()=>({getBoundingClientRect:()=>({left:0,right:900,bottom:54})})};
 const anchor={ownerDocument:doc,getBoundingClientRect:()=>({left:620,right:652,top:12,bottom:44})};
 const region={left:610,right:896,width:286};
 assert.deepEqual(topbarMenuGeometry(anchor,{region,maxHeight:480}),{left:610,top:54,width:286,maxHeight:238});
 const menu={style:{},classList:{add(value){this.value=value;}}};positionTopbarMenu(menu,anchor,{region});
 assert.equal(menu.style.top,'54px');assert.equal(menu.style.width,'286px');assert.equal(menu.style.minWidth,'0');assert.equal(menu.classList.value,'ui-topbar-menu');
 win.visualViewport={offsetLeft:20,offsetTop:10,width:420,height:180};
 assert.deepEqual(topbarMenuGeometry(anchor,{region:{left:-80,right:200,width:280}}),{left:20,top:54,width:280,maxHeight:128});
 assert.deepEqual(topbarMenuGeometry(anchor,{region:{left:-80,right:1000,width:1080}}),{left:20,top:54,width:420,maxHeight:128});
});


test('long titlebar messages preserve reading width and stay inside a narrow visual viewport',async()=>{
 const {topbarMenuGeometry}=await import('../ui/interaction.mjs');
 const win={innerWidth:1280,innerHeight:800},doc={defaultView:win,getElementById:()=>({getBoundingClientRect:()=>({bottom:56})})};
 const anchor={ownerDocument:doc,getBoundingClientRect:()=>({left:1080,right:1112,width:32})};
 assert.deepEqual(topbarMenuGeometry(anchor,{region:{left:1080,right:1260,width:180},align:'end',minWidth:420}),{left:840,top:56,width:420,maxHeight:480});
 assert.equal(topbarMenuGeometry(anchor,{minWidth:280}).width,280);
 win.visualViewport={offsetLeft:0,offsetTop:0,width:360,height:300};
 assert.deepEqual(topbarMenuGeometry(anchor,{region:{left:180,right:350,width:170},align:'end',minWidth:420}),{left:0,top:56,width:360,maxHeight:236});
});
