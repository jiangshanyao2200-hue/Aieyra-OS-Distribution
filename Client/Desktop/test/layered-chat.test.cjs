// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; layerDocument
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/layered-chat.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../ui/layered-chat.mjs');
test('independent large fonts retain a complete compact line and an unchanged avatar anchor at every edge',async()=>{
 const {chatCompactTextMetrics,chatCompactPlacement,chatLayerBounds,chatLayerMovePosition}=await load();
 const values={'--eyra-avatar':'100px','--chat-name':'50px','--os-status-size':'21.5px','--os-assistant-size':'20px','--os-assistant-line':'2.5','--os-thinking-size':'22px','--os-thinking-line':'1.6'};
 const metrics=chatCompactTextMetrics({getPropertyValue:k=>values[k]||''});
 assert(100+16+metrics.contentExtra-20-75-4>=50,'identity and padding must leave a full chosen body line');
 for(const y of [0,.1,.5,1])for(const height of [350,800]){
  const geometry={width:960,height,top:48,position:{x:.2,y},...metrics,previewHeight:180},p=chatCompactPlacement(geometry),old=chatLayerBounds({...geometry,contentExtra:0,previewHeight:0});
  assert.deepEqual(p.anchor,old,'text capacity must never move the avatar');
  assert(p.bounds.y>=48&&p.bounds.y+p.bounds.height<=height);
  assert.equal(p.bounds.height,p.anchor.height+p.contentExtra+p.previewHeight);
  assert.equal(p.contentRise+p.previewHeight,p.anchor.y-p.bounds.y);
  assert.deepEqual(chatLayerMovePosition(geometry,0,0),chatLayerMovePosition({...geometry,contentExtra:0},0,0));
 }
 values['--chat-name']='25px';values['--os-assistant-line']='1.3';assert.equal(chatCompactTextMetrics({getPropertyValue:k=>values[k]||''}).contentExtra,0,'normal settings retain the compact geometry');
});
function layerDocument(){
 const nodes=[];let doc;
 const make=()=>{const classes=new Set(),n=Object.assign(new EventTarget(),{dataset:{},style:{setProperty(){}},classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)},append(){},setAttribute(){},querySelector:()=>null,insertAdjacentHTML(){},contains:()=>false,focus(){doc.activeElement=n;},remove(){}});nodes.push(n);return n;};
 doc={body:make(),createElement:make,getElementById:()=>null,querySelector:()=>null,addEventListener(){},removeEventListener(){},defaultView:{cancelAnimationFrame(){},ResizeObserver:class{observe(){}disconnect(){}},matchMedia:()=>({matches:true}),getComputedStyle:()=>({opacity:'1',transform:'none'})}};
 return {doc,nodes,make};
}

test('animated composer height stays on the reading surface, avoids unchanged writes and releases its scoped value',async()=>{
 const {setupChatLayer}=await load(),{doc,make}=layerDocument(),stage=make(),reading=make(),composer=make(),values=new Map(),writes=[];let height=44,resize;
 const style=owner=>({getPropertyValue:key=>values.get(owner+key)||'',setProperty(key,value){values.set(owner+key,value);writes.push({owner,key,value});},removeProperty:key=>values.delete(owner+key)});
 doc.body.style=style('body');stage.style=style('stage');reading.style=style('reading');
 composer.getBoundingClientRect=()=>({height});doc.getElementById=id=>({stage,conversation:reading,'bottom-bar':composer}[id]||null);
 doc.defaultView.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){resize=null;}};
 reading.style.setProperty('--layer-input-height','60px');writes.length=0;
 const layer=setupChatLayer({doc,nodes:[]});
 assert.deepEqual(writes,[{owner:'reading',key:'--layer-input-height',value:'44px'},{owner:'stage',key:'--layer-input-height',value:'44px'}]);
 resize();assert.equal(writes.length,2,'a duplicate size notification must not invalidate style');
 height=150;resize();assert.equal(reading.style.getPropertyValue('--layer-input-height'),'150px');assert.equal(stage.style.getPropertyValue('--layer-input-height'),'150px');
 assert.equal(doc.body.style.getPropertyValue('--layer-input-height'),'','footer motion must not trigger document-wide inherited style observers');
 layer.close();assert.equal(reading.style.getPropertyValue('--layer-input-height'),'60px');assert.equal(stage.style.getPropertyValue('--layer-input-height'),'');assert.equal(resize,null);
});
test('a click before the initial conversation arrives remains selected and persists on that conversation',async()=>{
 const {setupChatLayer}=await load(),{doc,nodes}=layerDocument(),calls=[];
 const layer=setupChatLayer({doc,nodes:[],initialOpen:false,preference:async p=>{calls.push(p);return {open:false};}});
 nodes.find(n=>n.className==='chat-layer-avatar').onclick();assert.equal(layer.expanded,true);
 layer.scope('coding:first');await Promise.resolve();await Promise.resolve();
 assert.equal(layer.expanded,true);assert.deepEqual(calls,[{key:'coding:first',open:true}]);
 layer.scope('coding:other');await Promise.resolve();await Promise.resolve();
 assert.equal(layer.expanded,false);assert.deepEqual(calls.at(-1),{key:'coding:other'});layer.close();
});
test('a delayed saved preference cannot override a click or leak into the next conversation',async()=>{
 const {setupChatLayer}=await load(),{doc,nodes}=layerDocument();let resolve;
 const layer=setupChatLayer({doc,nodes:[],initialOpen:false,preference:p=>'open' in p?{ok:true}:p.key==='first'?new Promise(r=>resolve=r):{open:false}});
 layer.scope('first');nodes.find(n=>n.className==='chat-layer-avatar').onclick();resolve({open:false});await Promise.resolve();await Promise.resolve();
 assert.equal(layer.expanded,true);layer.scope('second');await Promise.resolve();await Promise.resolve();assert.equal(layer.expanded,false);layer.close();
});
test('fold preference uses durable host storage and remains isolated by session',async()=>{
 const {chatLayerPreferences}=await load(),values=new Map(),call=async({key,open})=>{if(open!==undefined)values.set(key,open);return {ok:true,open:values.get(key)??null};};
 const first=chatLayerPreferences(call);first.write('home:one',false);first.write('program:settings:two',true);
 const reopened=chatLayerPreferences(call);assert.equal(await reopened.read('home:one',true),false);assert.equal(await reopened.read('home:new',true),true);assert.equal(await reopened.read('program:settings:two',false),true);assert.equal(await reopened.read('program:browser:two',false),false);
 const unavailable=chatLayerPreferences();unavailable.write('coding:one',false);assert.equal(await unavailable.read('coding:one',true),false);
});
test('native close retains full bounds until its own completion; reversal rejects late completion',async()=>{
 const {ChatLayerState}=await load(),s=new ChatLayerState(true);
 s.set(false);const first=s.transition;assert.equal(s.full,true);
 s.set(true);assert.equal(s.settle(first),false);assert.equal(s.full,true);
 s.set(false);assert.equal(s.settle(first),false);assert.equal(s.full,true);
 assert.equal(s.settle(s.transition),true);assert.equal(s.full,false);
});
test('compact hit rectangle is at bottom left and never consumes the background above it',async()=>{
 const {chatLayerBounds}=await load();
 assert.deepEqual(chatLayerBounds({width:1200,height:800,left:200,top:48,full:true}),{x:200,y:48,width:1000,height:752});
 assert.deepEqual(chatLayerBounds({width:1200,height:800,left:200,top:48}),{x:200,y:642,width:446,height:158});
 assert.deepEqual(chatLayerBounds({width:1200,height:800,avatarSize:185}),{x:0,y:567,width:521,height:233});
 const small=chatLayerBounds({width:250,height:90,left:20,top:48});assert.equal(small.width,230);assert.equal(small.height,42);assert.equal(small.y,48);
});
test('Brief previews grow above the same anchor and dragging stays clamped at every viewport size',async()=>{
 const {chatLayerBounds,chatLayerMovePosition}=await load();
 for(const position of [{x:0,y:1},{x:.35,y:.42},{x:1,y:0}]){
  const geometry={width:1200,height:800,left:210,top:48,position},idle=chatLayerBounds(geometry),work=chatLayerBounds({...geometry,previewHeight:200});
  assert.equal(idle.y+idle.height,work.y+work.height);assert.equal(idle.x,work.x);assert(work.y>=48);
  assert.deepEqual(chatLayerMovePosition(geometry,-20000,20000),{x:0,y:1});
  const small=chatLayerBounds({...geometry,width:400,height:250,previewHeight:200});assert(small.x>=210&&small.y>=48&&small.x+small.width<=400&&small.y+small.height<=250);
 }
});
test('compact Briefs and current text remain separate, bounded and isolated from old generations',async()=>{
 const {compactWorkRows,compactLiveRows}=await load(),{ConversationPresentation}=await import('../ui/work-transcript.mjs'),p=new ConversationPresentation();
 const current=p.project([],{scope:'epoch:sera',agentId:'sera',generation:2,active:true,live:{generation:2,agent_id:'sera',phase:'body',text:'CURRENT_BODY',body_id:'b',body_at:2000000},briefs:[{id:'call',title:'CURRENT_BRIEF',state:'completed',started_at:1000}]});
 const rows=compactWorkRows([{id:'old',from:'eyra',generation:1,text:'OLD',response:true},...current],2);
 assert(!rows.some(r=>r.text==='CURRENT_BODY'));assert(rows.some(r=>r.text==='CURRENT_BRIEF'));assert(!JSON.stringify(rows).includes('OLD'));
 assert.deepEqual(compactLiveRows(current,2).map(r=>r.text),['CURRENT_BODY']);assert.deepEqual(compactLiveRows(current,3),[]);
 const bounded=compactWorkRows([{generation:2,work:{journal:{rows:Array.from({length:20},(_,i)=>({id:String(i),kind:i===19?'thinking':'brief',text:String(i)+':'+'.'.repeat(900)}))}}}],2);
 assert.equal(bounded.length,3);assert.deepEqual(bounded.map(r=>r.id),['16','17','18']);assert(bounded.every(r=>r.text.length===700));
 const identity={role:'conversation',name:'真实成员',avatar:'data:image/png;base64,a'},talk={id:'link:1',from:'eyra',role:'conversation',identity,generation:2,talk:true,brief:true,text:'AUTHORED_BRIEF',receipt:'HISTORY_ONLY'};
 const [folded]=compactWorkRows([talk],2);assert.equal(folded.identity,identity);assert.equal(folded.role,'conversation');assert.equal(folded.talk,true);assert.equal(folded.text,'AUTHORED_BRIEF');assert(!JSON.stringify(folded).includes('HISTORY_ONLY'));assert.deepEqual(compactWorkRows([talk],3),[]);
});

test('idle native hit area shrinks to its avatar without moving the working anchor',async()=>{
 const {chatLayerBounds}=await load();
 for(const position of [{x:0,y:1},{x:.4,y:.35},{x:1,y:0}]){
  const geometry={width:1200,height:800,left:210,top:48,avatarSize:120,position},idle=chatLayerBounds({...geometry,details:false}),work=chatLayerBounds({...geometry,details:true,previewHeight:200});
  assert.equal(idle.width,168);assert.equal(idle.x,work.x);assert.equal(idle.y+idle.height,work.y+work.height);assert(idle.width<work.width);
 }
 const {setupChatLayer}=await load(),{doc,nodes}=layerDocument(),layer=setupChatLayer({doc,nodes:[],initialOpen:false});
 layer.update({active:false,identity:{role:'matrix',name:'Eyra'},label:'OLD',rows:[],liveRows:[]});
 assert.equal(nodes.find(n=>n.className==='chat-layer-details').hidden,true);assert.equal(nodes.find(n=>n.className==='chat-layer-mini').dataset.active,'false');layer.close();
});
test('pointer drag does not capture ordinary clicks or consume the next real expand click',async()=>{
 const {setupChatLayer}=await load(),{doc,nodes}=layerDocument(),moves=[],frames=new Map();let sequence=0,captured=0;
 doc.defaultView.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};doc.defaultView.cancelAnimationFrame=id=>frames.delete(id);
 const layer=setupChatLayer({doc,nodes:[],initialOpen:false,external:true,onMove:p=>moves.push(p),onChange:open=>moves.push({open})}),mini=nodes.find(n=>n.className==='chat-layer-mini'),avatar=nodes.find(n=>n.className==='chat-layer-avatar');
 mini.setPointerCapture=()=>captured++;
 const pointer=(type,x,y)=>mini.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{button:0,pointerId:7,screenX:x,screenY:y}));
 pointer('pointerdown',100,200);pointer('pointerup',101,201);assert.equal(captured,0);avatar.onclick({});assert.deepEqual(moves,[{open:true}]);moves.length=0;
 pointer('pointerdown',100,200);pointer('pointermove',101,198);assert.equal(captured,0);pointer('pointermove',110,160);assert.equal(captured,1);pointer('pointerup',110,160);avatar.onclick({preventDefault(){}});
 assert.equal(moves.at(-1).done,true);assert.equal(moves.at(-1).dy,-40);assert(!moves.some(m=>'open' in m));
 pointer('pointerdown',110,160);pointer('pointerup',110,160);avatar.onclick({});assert.deepEqual(moves.at(-1),{open:true});layer.close();assert.equal(frames.size,0);
});
test('a delayed position read cannot overwrite a drag that has already moved',async()=>{
 const {chatLayerPreferences}=await load();let complete;const prefs=chatLayerPreferences(()=>new Promise(r=>complete=r)),pending=prefs.read('program:settings:sera',false);
 prefs.move('program:settings:sera',{x:.2,y:.3},{save:false});complete({ok:true,open:false,position:{x:0,y:1}});await pending;
 assert.deepEqual(prefs.position('program:settings:sera'),{x:.2,y:.3});
});

test('native expansion measures its source in the ready viewport and waits for the retained target',async()=>{
 const {setupChatLayer}=await load(),{doc,nodes,make}=layerDocument(),animations=[],frames=new Map();let sequence=0;
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
 const rect=(x,y,width=120,height=120)=>({x,y,left:x,top:y,width,height,right:x+width,bottom:y+height});
 const create=doc.createElement;doc.createElement=(...args)=>{const n=create(...args);n.ownerDocument=doc;n.animate=(frames,options)=>{let finish;const a={node:n,frames,options,finished:new Promise(resolve=>finish=resolve),cancel:()=>finish()};animations.push(a);return a;};return n;};
 doc.body.ownerDocument=doc;doc.body.animate=()=>{};
 Object.assign(doc.defaultView,{innerWidth:168,innerHeight:168,requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:()=>''})});
 const reading=make(),target=doc.createElement('span'),composer=make(),heights=new Map();let available=false,composerHeight=0,followOffset=0,followCalls=0;
 reading.style={getPropertyValue:key=>heights.get(key)||'',setProperty:(key,value)=>heights.set(key,value),removeProperty:key=>heights.delete(key)};
 composer.getBoundingClientRect=()=>rect(0,700,600,composerHeight);doc.getElementById=id=>id==='bottom-bar'?composer:null;
 target.getBoundingClientRect=()=>rect(158,541-followOffset);
 reading.querySelectorAll=()=>available?[target]:[];
 const layer=setupChatLayer({doc,content:reading,nodes:[reading],initialOpen:false,external:true,deferMotion:true,onBeforeOpen:()=>{followCalls++;if(available){assert.equal(heights.get('--layer-input-height'),'48px');followOffset=48;}}}),mini=nodes.find(n=>n.className==='chat-layer-mini'),ring=nodes.find(n=>n.className==='role-ring');
 ring.getBoundingClientRect=()=>mini.hidden?rect(0,0,0,0):rect(parseFloat(mini.style.left)+8,doc.defaultView.innerHeight-parseFloat(mini.style.bottom)-128);
 // These are the incoming full-surface coordinates while Chromium still has
 // the old compact viewport. They must never become the relocation origin.
 layer.update({miniPosition:{x:46,bottom:221}});doc.body.dataset.frameReady='false';layer.set(true,{notify:false});
 assert.equal(doc.body.dataset.chatTransition,'waiting');assert.equal(animations.length,0);
 doc.defaultView.innerWidth=1280;doc.defaultView.innerHeight=745;doc.body.dataset.frameReady='true';doc.body.dataset.portalPresented='false';layer.presented();flush();
 assert.equal(animations.length,0,'layout acknowledgement cannot animate a native view before it is presented');
 assert.equal(followCalls,0,'hidden native preparation must not move the retained reading position');
 doc.body.dataset.portalPresented='true';layer.presented();flush();
 assert.equal(doc.body.dataset.chatTransition,'waiting','an asynchronous history read cannot expose its initial layout');assert.equal(animations.length,0);
 available=true;layer.presented();composerHeight=48;flush();
 const relocation=animations.find(a=>a.node===target);assert(relocation);assert.equal(relocation.frames[0].translate,'-104px -97px');
 assert.equal(followOffset,48,'the destination must include actual following for the newly reserved composer');
 assert.equal(relocation.frames[0].scale,1);assert.equal(mini.hidden,true,'source measurement must not leave a second avatar visible');
 // A failed history read arriving before that one queued frame must release
 // the waiting surface too; the later viewport acknowledgement has no error
 // option and must not overwrite this newer terminal reading state.
 layer.set(false,{notify:false,animate:false});layer.set(true,{notify:false});available=false;
 layer.presented();layer.presented({empty:true});layer.presented();assert.equal(frames.size,1);flush();
 assert.equal(doc.body.dataset.chatTransition,'playing','coalescing cannot strand a failed history read in the waiting state');
 layer.set(false,{notify:false,animate:false});layer.set(true,{notify:false});layer.presented();assert.equal(frames.size,1);
 layer.close();assert.equal(doc.body.dataset.chatTransition,undefined);assert.equal(frames.size,0);await Promise.resolve();
});
test('unfinished and failed statuses expose no error body; concurrent actions remain a single line',async()=>{
 const {chatStatus}=await import('../ui/chat-status.mjs');
 const detail='PRIVATE ERROR\nstack at file';
 assert.equal(chatStatus({state:'failed',caption:detail,label:detail}),'我们遇到了问题');
 assert.equal(chatStatus({state:'running',phase:'waiting',active:true,activities:[{state:'failed',title:detail,error:detail}]}),'等待模型回应');
 assert.equal(chatStatus({state:'running',activities:[{state:'running',brief:'读取文件\nextra'},{state:'running',title:'核对引用'}]}),'读取文件 · 核对引用');
 assert.equal(chatStatus({state:'thinking',label:'仍在思考'}),'仍在思考');
 assert.equal(chatStatus({state:'idle',activities:[{state:'completed',title:'旧操作'}]}),'');
});

test('programs start folded on a new launch while home preference and same-launch choices survive',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createChatLayerPreferences}=require('../host/chat-layer-preferences.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chat-launch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'layers.json');
 fs.writeFileSync(file,JSON.stringify({version:1,entries:{'program:browser:navi':{open:true},'coding:cota':{open:true}}}));
 const launch=createChatLayerPreferences(file);
 assert.equal(launch.call({key:'program:browser:navi'}).open,false);assert.equal(launch.call({key:'coding:cota'}).open,false);
 launch.call({key:'program:browser:navi',open:true});launch.call({key:'home:eyra',open:false});
 assert.equal(launch.call({key:'program:browser:navi'}).open,true);
 const next=createChatLayerPreferences(file);assert.equal(next.call({key:'program:browser:navi'}).open,false);assert.equal(next.call({key:'home:eyra'}).open,false);
});
