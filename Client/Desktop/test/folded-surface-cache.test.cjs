// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/folded-surface-cache.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('folded appearance reuses computed values while drafts, task state, theme and viewport stay live',async t=>{
 const {setupFoldedSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/folded-surface.mjs')).href);
 const win=new EventTarget(),doc=new EventTarget(),classes=new Set(),vars=new Map([['--eyra-ring-size','104px'],['--os-interface-size','14px']]);let reads=0,quick,styleText='initial',task='a',avatarUrl='';const payloads=[];
 const style={getPropertyValue:key=>vars.get(key)||'',[Symbol.iterator]:()=>vars.keys()};
 doc.documentElement={style:{[Symbol.iterator]:function*(){}},className:'',getAttribute:()=>''};
 doc.body={style,dataset:{form:'full'},get className(){return [...classes].join(' ');},getAttribute:()=>styleText,classList:{contains:c=>classes.has(c),remove:c=>classes.delete(c),toggle(c,v){if(v)classes.add(c);else classes.delete(c);}}};
 const message={value:'draft one',selectionStart:1,selectionEnd:2,selectionDirection:'forward'},presence={dataset:{state:'idle'},getAttribute:()=> 'Eyra',querySelector:()=>({textContent:'code'})},avatar={hidden:true,getAttribute:()=>avatarUrl};
 Object.assign(doc,{defaultView:win,querySelector:()=>null,getElementById:id=>({message,presence,'presence-avatar':avatar}[id])});
 const globals={innerWidth:1000,innerHeight:800,matchMedia:()=>({matches:false}),getComputedStyle:()=>{reads++;return {...style,fontFamily:'test-font',fontSize:vars.get('--os-interface-size')};}};
 for(const [key,value]of Object.entries(globals)){const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>prior?Object.defineProperty(globalThis,key,prior):delete globalThis[key]);}
 const overlay=setupFoldedSurface({onQuickInput:fn=>{quick=fn;return ()=>{};},foldedSurface:async value=>{payloads.push(structuredClone(value));return {ready:true};}},{navigation:{current:'settings-view'},companion:{profile:{},overlayState:{kind:'idle',active:false}},snapshot:()=>({session_id:task,core_epoch:'epoch'})},doc);
 overlay.paint();await Promise.resolve();for(let i=0;i<30;i++)overlay.paint();assert.equal(reads,1);assert.equal(payloads.length,1);
 message.value='draft two';task='b';presence.dataset.state='thinking';overlay.paint();assert.equal(reads,1);assert.equal(payloads.at(-1).content.draft,'draft two');assert.equal(payloads.at(-1).content.task_id,'b');assert.equal(payloads.at(-1).presence.instrument.data.state,'thinking');
 vars.set('--eyra-ring-size','120px');vars.set('--os-interface-size','18px');styleText='changed';overlay.paint();assert.equal(reads,2);assert.equal(payloads.at(-1).content.fontSize,'18px');assert.equal(payloads.at(-1).content.theme['--eyra-ring-size'],'120px');
 globalThis.innerHeight=500;overlay.paint();assert.equal(reads,3);assert.equal(payloads.at(-1).content.viewportHeight,500);
 quick({open:true,width:700,height:600,bottomInset:20});assert.equal(payloads.at(-1).content.input,true);assert.equal(payloads.at(-1).content.viewportHeight,580);
 // 头像只在变化时发：工作时每次刷新都发曾持续写几 MB/s。
 avatarUrl='data:image/png;base64,AAAA';overlay.paint();const sent=payloads.length;assert.equal(payloads.at(-1).presence.instrument.avatar,avatarUrl);
 for(let i=0;i<20;i++)overlay.paint();assert.equal(payloads.length,sent);
 presence.dataset.state='tool';overlay.paint();assert.equal('avatar' in payloads.at(-1).presence.instrument,false,'头像没变不重发');
 overlay.close();const count=payloads.length;overlay.paint();assert.equal(payloads.length,count);
});

test('native reacquisition keeps one owner across pending replies, failures and late acknowledgements',async t=>{
 const {setupFoldedSurface}=await import(pathToFileURL(path.join(__dirname,'../ui/folded-surface.mjs')).href);
 const win=new EventTarget(),doc=new EventTarget(),classes=new Set(),pending=[],navigation={current:'settings-view'};let onReady,task='one';
 const style={getPropertyValue:()=>'',*[Symbol.iterator](){}};
 doc.documentElement={style,className:'',getAttribute:()=>''};
 doc.body={style,dataset:{form:'full'},get className(){return [...classes].join(' ');},getAttribute:()=>'',classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,v){if(v)classes.add(c);else classes.delete(c);}}};
 const message={value:'retained draft',selectionStart:2,selectionEnd:4,selectionDirection:'forward'},presence={dataset:{state:'idle'},getAttribute:()=> 'Eyra',querySelector:()=>({textContent:''})},avatar={hidden:true,getAttribute:()=>''};
 Object.assign(doc,{defaultView:win,querySelector:()=>null,getElementById:id=>({message,presence,'presence-avatar':avatar}[id])});
 for(const [key,value]of Object.entries({innerWidth:1000,innerHeight:800,matchMedia:()=>({matches:false}),getComputedStyle:()=>({...style,fontFamily:'test',fontSize:'14px'})})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>prior?Object.defineProperty(globalThis,key,prior):delete globalThis[key]);
 }
 const overlay=setupFoldedSurface({onFoldedReady:fn=>{onReady=fn;return ()=>{onReady=null;};},foldedSurface:value=>new Promise(resolve=>pending.push({value,resolve}))},{navigation,companion:{profile:{},overlayState:{kind:'idle',active:false}},snapshot:()=>({session_id:task,core_epoch:'epoch'})},doc);
 t.after(()=>overlay.close());const hidden=()=>classes.has('native-eyra-overlay'),flush=()=>new Promise(resolve=>setImmediate(resolve));
 overlay.paint();assert.equal(hidden(),false,'cold native loading retains page fallback');pending.at(-1).resolve({ready:false});await flush();assert.equal(hidden(),false);
 onReady({ready:true});assert.equal(hidden(),true);pending.at(-1).resolve({ready:true});await flush();
 navigation.current='';overlay.paint();assert.equal(hidden(),false,'the page regains ownership immediately');const old=pending.at(-1);
 onReady({ready:false});navigation.current='document-viewer';overlay.paint();const reopen=pending.at(-1);assert.equal(hidden(),true,'reopening a prepared native view claims the slot before asynchronous rendering');
 old.resolve({ready:true});reopen.resolve({ready:false});await flush();assert.equal(hidden(),true,'pending or stale responses cannot unhide the duplicate');
 onReady({ready:false,reason:'unavailable'});assert.equal(hidden(),false);assert.equal(overlay.ownsPresence,false);
 pending.at(-1).resolve({ready:false,unavailable:true});await flush();task='two';overlay.paint();assert.equal(hidden(),false,'subsequent task paints retain the failure fallback');const failed=pending.at(-1);
 onReady({ready:true});assert.equal(hidden(),true);failed.resolve({ready:false,unavailable:true});await flush();assert.equal(hidden(),true,'an old failure reply cannot revoke real recovery');
 assert.equal(message.value,'retained draft');assert.deepEqual([message.selectionStart,message.selectionEnd],[2,4]);
});
