// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; viewerGeometryIssues; viewerSnapshot; themeEnvironment; themeHarness; flushTheme; deferred; themeRecord; pickerHarness
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-library.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCatalogue,pageCapacity,pageNumbers}=require('../ui/theme-library-pagination.mjs');
const {clampView,zoomView,createThemeViewport}=require('../ui/theme-library-viewer.mjs');
const {createThemeSelection,mountThemeLibrary,pickTheme}=require('../ui/theme-library.mjs');
function viewerGeometryIssues(snapshot,{category='background',apply=category==='background'}={}){
 const issues=[],valid=r=>r&&['left','top','right','bottom','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0&&Math.abs(r.right-r.left-r.width)<=1&&Math.abs(r.bottom-r.top-r.height)<=1;
 const inside=(r,area)=>valid(r)&&valid(area)&&r.left>=area.left-1&&r.top>=area.top-1&&r.right<=area.right+1&&r.bottom<=area.bottom+1;
 const near=(a,b)=>Math.abs(a-b)<=2,centerY=r=>(r.top+r.bottom)/2;
 const {screen,frame,area,image,title,footer,left,right,like}=snapshot;
 if(!inside(frame,screen)||!frame.visible)issues.push('viewer outside screen or hidden');
 if(!inside(area,frame)||!area.visible||!['left','top','right','bottom'].every(k=>near(area[k],frame[k])))issues.push('image viewport does not fill viewer');
 if(!valid(image)||!image.visible||!image.decoded)issues.push('image missing, hidden or undecoded');
 else if(category==='background'&&!(image.left<=area.left+1&&image.top<=area.top+1&&image.right>=area.right-1&&image.bottom>=area.bottom-1))issues.push('background does not cover viewport');
 else if(category!=='background'&&!inside(image,area))issues.push('image outside viewport');
 else if(category==='avatar'&&(!near(image.width,image.height)||!near(image.left+image.width/2,area.left+area.width/2)||!near(centerY(image),centerY(area))))issues.push('avatar is not square and centered');
 if(!inside(title,frame)||!title.visible||title.left>frame.left+24||title.top>frame.top+24)issues.push('title is not visible at upper left');
 for(const [name,r]of [['left',left],['right',right]])if(!inside(r,frame)||!r.visible||!near(centerY(r),centerY(frame))||(name==='left'?r.right>frame.left+frame.width*.25:r.left<frame.right-frame.width*.25))issues.push(name+' arrow is not on the middle side');
 if(!inside(footer,frame)||!footer.visible||footer.top<frame.top+frame.height/2||footer.right<frame.right-24||footer.bottom<frame.bottom-24||!inside(like,footer))issues.push('actions are not visible at lower right');
 if(!Array.isArray(snapshot.apply)||snapshot.apply.length!==(apply&&category==='background'?1:0))issues.push('unexpected application action');
 if(!Array.isArray(snapshot.controls)||snapshot.controls.length<7)issues.push('viewer controls incomplete');
 const controls=[left,right,like,...(snapshot.controls||[]),...(snapshot.apply||[])];
 if(controls.some(r=>!inside(r,frame)||!r.visible||!r.hit||r.width<24||r.height<24))issues.push('control hidden, blocked, too small or outside viewer');
 return issues;
}

test('a pending selection excludes competing cards and a late success cannot close a newer preview',async()=>{
 let complete,stamp=1,closed=false;const calls=[],busy=[],applied=[],errors=[];
 const selection=createThemeSelection({select:item=>{calls.push(item);return new Promise(resolve=>complete=resolve);},isCurrent:context=>!closed&&context.stamp===stamp,onBusy:()=>busy.push(selection.busy),onSuccess:context=>applied.push(context.stamp),onError:e=>errors.push(e.message)});
 const first=selection.choose('first',{stamp:1});assert.equal(selection.busy,true);
 assert.equal(await selection.choose('second',{stamp:1}),false);assert.deepEqual(calls,['first']);
 stamp=2;complete();assert.equal(await first,true);assert.deepEqual(applied,[]);assert.deepEqual(busy,[true,false]);assert.equal(selection.busy,false);
 const current=selection.choose('second',{stamp:2});complete();assert.equal(await current,true);assert.deepEqual(applied,[2]);
 closed=true;assert.equal(await selection.choose('after-close',{stamp:2}),false);assert.deepEqual(calls,['first','second']);assert.deepEqual(errors,[]);
});

test('selection failure unlocks retry and stale failures never replace current view errors',async()=>{
 let reject,stamp=1;const errors=[],applied=[];
 const selection=createThemeSelection({select:()=>new Promise((resolve,fail)=>reject=fail),isCurrent:context=>context.stamp===stamp,onBusy:()=>{},onSuccess:context=>applied.push(context),onError:e=>errors.push(e.message)});
 const failed=selection.choose('first',{stamp:1});reject(Error('prepare failed'));assert.equal(await failed,false);assert.equal(selection.busy,false);assert.deepEqual(errors,['prepare failed']);
 const late=selection.choose('retry',{stamp:1});stamp=2;reject(Error('old failure'));assert.equal(await late,false);assert.equal(selection.busy,false);assert.deepEqual(errors,['prepare failed']);assert.deepEqual(applied,[]);
});

function viewerSnapshot(category='background'){
 const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height,visible:true,hit:true});
 const left=rect(116,424,44,52),right=rect(1040,424,44,52),like=rect(850,744,112,40),apply=rect(974,744,110,40);
 return {screen:rect(0,0,1920,1080),frame:rect(100,100,1000,700),area:rect(100,100,1000,700),image:{...rect(...(category==='avatar'?[300,150,600,600]:[100,100,1000,700])),decoded:true},title:rect(116,116,230,64),footer:rect(834,728,266,72),left,right,like,
  apply:category==='background'?[apply]:[],controls:[left,right,like,...(category==='background'?[apply]:[]),rect(850,116,40,40),rect(896,116,40,40),rect(942,116,60,40),rect(1008,116,76,40)]};
}
test('viewer oracle accepts full images with floating controls and centered avatars',()=>{
 assert.deepEqual(viewerGeometryIssues(viewerSnapshot()),[]);
 assert.deepEqual(viewerGeometryIssues(viewerSnapshot('avatar'),{category:'avatar'}),[]);
});
test('viewer oracle rejects blank, clipped, covered or misplaced content and avatar application',()=>{
 const reject=(name,mutate,category='background')=>{const value=viewerSnapshot(category);mutate(value);assert.notDeepEqual(viewerGeometryIssues(value,{category}),[],name);};
 reject('shrunk image',s=>{s.image.width-=100;s.image.right-=100;});
 reject('short image viewport',s=>{s.area.height-=100;s.area.bottom-=100;s.image.height-=100;s.image.bottom-=100;});
 reject('image has not decoded',s=>s.image.decoded=false);
 reject('offscreen viewer',s=>s.screen.right=1000);
 reject('zero sized image',s=>{s.image.height=0;s.image.bottom=s.image.top;});
 reject('hidden title',s=>s.title.visible=false);
 reject('title at bottom',s=>{s.title.top=700;s.title.bottom=764;});
 reject('arrow at bottom',s=>{s.left.top=700;s.left.bottom=752;});
 reject('arrow on wrong side',s=>{s.left.left=600;s.left.right=644;});
 reject('covered action',s=>s.like.hit=false);
 reject('hidden arrow',s=>s.right.visible=false);
 reject('missing viewer controls',s=>s.controls=[]);
 reject('covered zoom control',s=>s.controls[4].hit=false);
 reject('action outside viewer',s=>{s.apply[0].right+=100;s.apply[0].width+=100;});
 reject('action too small',s=>{s.like.width=10;s.like.right=s.like.left+10;});
 reject('missing background application',s=>s.apply=[]);
 reject('avatar application',s=>s.apply=[s.controls[0]],'avatar');
 reject('nonsquare avatar',s=>{s.image.width-=50;s.image.right-=50;},'avatar');
 reject('off-center avatar',s=>{s.image.left+=10;s.image.right+=10;},'avatar');
});

test('numbered jumps discover real cursor pages, cache backward navigation and clamp past the end',async()=>{
 const records=Array.from({length:203},(_,id)=>({id:String(id)})),calls=[];
 const pages=createCatalogue(async cursor=>{calls.push(cursor);const offset=Number(cursor||0);return {items:records.slice(offset,offset+24),nextCursor:offset+24<records.length?String(offset+24):null};});
 let page=await pages.seek(7);assert.equal(page.index,7);assert.equal(page.items[0].id,'168');assert.equal(page.items.length,24);assert.equal(page.total,null);assert.equal(calls.length,8);
 await pages.seek(0);assert.equal(calls.length,8,'backward navigation must not refetch or assume offset cursors');
 page=await pages.seek(99);assert.equal(page.index,8);assert.equal(page.total,203);assert.equal(page.items.length,11);assert.equal(page.hasNext,false);assert.equal(calls.length,9);
 assert.deepEqual(pageNumbers(1,20),[1,2,3,4,5,6,7,8,9,10]);assert.deepEqual(pageNumbers(8,20),[4,5,6,7,8,9,10,11,12,13]);
 assert.deepEqual(pageNumbers(1,3),[1,2,3]);assert.deepEqual(pageNumbers(20,20),[11,12,13,14,15,16,17,18,19,20]);
});

test('ten consecutive page controls slide through all real pages without a page-count cap',async()=>{
 for(const count of [1,3,5,6,20,101,10002])for(const current of [1,Math.ceil(count/2),count]){
  const pages=pageNumbers(current,count);assert.equal(pages.length,Math.min(10,count));assert.ok(pages.includes(current));
  assert.ok(pages[0]>=1&&pages.at(-1)<=count);assert.ok(pages.every((value,index)=>!index||value===pages[index-1]+1));
 }
 const catalogue=createCatalogue(async()=>({items:[{id:'only'}],nextCursor:null}));
 assert.equal((await catalogue.seek(10001)).index,0,'a distant valid jump discovers and clamps to the actual end');
});

test('look-ahead numbers a full window and shares one reader with jumps',async()=>{
 const records=Array.from({length:300},(_,id)=>({id:String(id)})),calls=[];
 const pages=createCatalogue(async cursor=>{calls.push(cursor);await new Promise(r=>setTimeout(r,1));const offset=Number(cursor||0);return {items:records.slice(offset,offset+24),nextCursor:offset+24<records.length?String(offset+24):null};});
 await pages.seek(0);const ahead=pages.prefetch(9),jump=pages.seek(4);
 assert.equal((await jump).items[0].id,'96');assert.ok((await ahead).knownPages>=10);
 assert.equal(new Set(calls).size,calls.length,'concurrent readers never fetch the same cursor twice');
});

test('resizing reuses source records and respects three avatar rows and nine UI slots',async()=>{
 assert.equal(pageCapacity('avatar',140),3);assert.equal(pageCapacity('avatar',304),6);assert.equal(pageCapacity('avatar',632),12);assert.equal(pageCapacity('avatar',2000),24);
 assert.equal(pageCapacity('ui',2000),9);assert.equal(pageCapacity('background',320),24);
 let calls=0;const pages=createCatalogue(async()=>{calls++;return {items:Array.from({length:24},(_,id)=>({id:String(id)})),nextCursor:null};});
 await pages.seek(0);pages.resize(9);const page=await pages.seek(2);assert.equal(page.items[0].id,'18');assert.equal(page.items.length,6);assert.equal(calls,1);
});

test('cursor errors retain confirmed progress and cancelled generations cannot populate the catalogue',async()=>{
 let fail=true;const cursors=[];
 const pages=createCatalogue(async cursor=>{cursors.push(cursor);if(cursor&&fail){fail=false;throw Error('offline');}return {items:[{id:cursor||'first'}],nextCursor:cursor?null:'opaque-next'};},1);
 await pages.seek(0);await assert.rejects(pages.seek(1),/offline/);assert.equal(pages.snapshot(0).items[0].id,'first');
 assert.equal((await pages.seek(1)).items[0].id,'opaque-next');assert.deepEqual(cursors,['','opaque-next','opaque-next']);
 const repeat=createCatalogue(async()=>({items:[{id:'one'}],nextCursor:'same'}),1);await repeat.seek(0);await assert.rejects(repeat.seek(1),/重复分页/);
 let resolve,active=true;const cancelled=createCatalogue(()=>new Promise(done=>resolve=done));const pending=cancelled.seek(0,()=>active);active=false;resolve({items:[{id:'late'}],nextCursor:null});assert.equal(await pending,null);assert.equal(cancelled.snapshot(0).items.length,0);
});

test('zoom keeps the pointer anchor, clamps drag bounds and restores a centered view',()=>{
 const view=zoomView({scale:1,x:0,y:0},2,100,50,800,600);
 assert.deepEqual(view,{scale:2,x:-100,y:-50});assert.equal(100*view.scale+view.x,100);assert.equal(50*view.scale+view.y,50);
 assert.deepEqual(clampView({scale:2,x:9999,y:-9999},800,600),{scale:2,x:400,y:-300});
 const reset=zoomView(view,1,100,50,800,600);assert.equal(reset.scale,1);assert.equal(Math.abs(reset.x)+Math.abs(reset.y),0);
 assert.equal(clampView({scale:99,x:0,y:0},800,600).scale,8);
});

test('viewport releases pointer capture on cancellation and changing content, then removes its listeners',t=>{
 const prior=global.ResizeObserver;let disconnected=false;
 global.ResizeObserver=class{observe(){}disconnect(){disconnected=true;}};t.after(()=>{global.ResizeObserver=prior;});
 const element=()=>({className:'',style:{},children:[],replaceChildren(...nodes){this.children=nodes;},remove(){this.removed=true;}});
 class Viewport extends EventTarget{
  constructor(){super();this.ownerDocument={createElement:element};this.dataset={};this.clientWidth=800;this.clientHeight=600;this.captured=new Set();}
  replaceChildren(...nodes){this.children=nodes;}closest(){return null;}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);}
 }
 const viewport=new Viewport(),controller=createThemeViewport(viewport),content=viewport.children[0];
 const fire=(type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:7,clientX:400,clientY:300,...values});viewport.dispatchEvent(event);return event;};
 assert.equal(fire('wheel',{deltaY:-300,deltaMode:0}).defaultPrevented,true);assert.equal(viewport.dataset.zoomed,'true');
 fire('pointerdown');assert.equal(viewport.hasPointerCapture(7),true);fire('pointermove',{clientX:470});assert.match(content.style.transform,/translate\(70px/);
 fire('pointercancel');assert.equal(viewport.hasPointerCapture(7),false);assert.equal(viewport.dataset.dragging,undefined);
 fire('pointerdown');controller.replace(element());assert.equal(viewport.hasPointerCapture(7),false);assert.equal(viewport.dataset.zoomed,'false');
 controller.destroy();const transform=content.style.transform;fire('wheel',{deltaY:-300,deltaMode:0});assert.equal(content.style.transform,transform);assert.equal(disconnected,true);
});

// Exercise the mounted component; observers and image load are synthetic, geometry is not asserted here.
function themeEnvironment(){
 const prior=new Map(['document','ResizeObserver','IntersectionObserver','MutationObserver'].map(key=>[key,{present:Object.hasOwn(global,key),value:global[key]}])),observers=new Set();
 class Element extends EventTarget{
  constructor(tag,doc){super();Object.assign(this,{tagName:tag.toUpperCase(),ownerDocument:doc,children:[],parentElement:null,className:'',dataset:{},style:{},attrs:new Map(),_text:'',disabled:false,hidden:false,open:false,clientWidth:632,clientHeight:600,value:'',scrollTop:0});this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};}
  set textContent(value){this.replaceChildren();this._text=String(value);}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}}
  setAttribute(key,value){this.attrs.set(key,String(value));}getAttribute(key){return this.attrs.get(key)??null;}removeAttribute(key){this.attrs.delete(key);}
  contains(node){return !!node&&(node===this||this.children.some(n=>n.contains(node)));}
  matches(selector){return selector.split(',').some(raw=>{const value=raw.trim();if(value.startsWith('.'))return value.slice(1).split('.').every(n=>this.classList.contains(n));const attribute=/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(value);return attribute?(attribute[1]==='hidden'?this.hidden:attribute[2]===undefined?this.attrs.has(attribute[1]):this.getAttribute(attribute[1])===attribute[2]):this.tagName.toLowerCase()===value;});}
  querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  get isConnected(){return this.ownerDocument.body.contains(this);}getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
  focus(){this.ownerDocument.activeElement=this;}click(){if(!this.disabled)return this.onclick?.({target:this});}showModal(){this.open=true;}close(){if(this.open){this.open=false;this.dispatchEvent(new Event('close'));}}
  set src(value){this._src=value;queueMicrotask(()=>this.onload?.());}get src(){return this._src;}
 }
 const doc=Object.assign(new EventTarget(),{createElement(tag){return new Element(tag,this);},activeElement:null,hidden:false});doc.body=doc.createElement('body');global.document=doc;
 global.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();observers.add(this);}observe(node){this.targets.add(node);}disconnect(){this.targets.clear();observers.delete(this);}};
 global.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
 global.MutationObserver=class{observe(){}disconnect(){}};
 return {doc,observers,restore(){for(const [key,saved]of prior){if(saved.present)global[key]=saved.value;else delete global[key];}}};
}

test('bundled gallery media loads a thumbnail without a remote URL',async t=>{
 const env=themeEnvironment();t.after(()=>env.restore());
 global.IntersectionObserver=class{constructor(callback){this.callback=callback;}observe(target){queueMicrotask(()=>this.callback([{target,isIntersecting:true}]));}unobserve(){}disconnect(){}};
 const host=env.doc.createElement('div');env.doc.body.append(host);const calls=[];
 const item={id:'builtin.bg-01',digest:'a'.repeat(64),category:'background',title:'Bundled image',author:{name:'Aieyra OS'},bundled:true,status:'approved',likes:0,liked:false};
 const library=mountThemeLibrary(host,{call:async p=>{calls.push(p);if(p.action==='list')return {items:[item],nextCursor:null};if(p.action==='image')return {src:'data:image/jpeg;base64,example'};throw Error('Unexpected action');}});t.after(()=>library.close());
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(host.querySelector('.theme-picture').dataset.state,'ready');
 assert.equal(host.querySelector('.theme-picture').querySelector('img').src,'data:image/jpeg;base64,example');
 assert.equal(calls.filter(p=>p.action==='image').length,1);assert.equal(calls.find(p=>p.action==='image').variant,'preview');
 assert.doesNotMatch(host.textContent,/尚未提供预览/);
});
function themeHarness(t,{category='avatar',records=[],select,like,list}={}){
 const environment=themeEnvironment(),{doc,observers}=environment;
 const host=doc.createElement('div');doc.body.append(host);const calls=[],selections=[];
 const browser=mountThemeLibrary(host,{category,locked:category==='avatar',onSelect:async item=>{selections.push(item);await select?.(item);},call:async p=>{
  calls.push(p);
  if(p.action==='image')return {ok:true,src:'data:image/png;base64,synthetic-load'};
  if(p.action==='list'){
   if(list)return list(p);
   const rows=records.filter(item=>p.sort==='pending'?item.status==='pending':item.status==='approved'),offset=Number(p.cursor||0);
   return {ok:true,items:rows.slice(offset,offset+24),nextCursor:offset+24<rows.length?String(offset+24):null};
  }
  assert.equal(p.action,'like');
  if(like)return {ok:true,item:await like(p)};
  const index=records.findIndex(item=>item.id===p.id&&item.digest===p.digest);assert.ok(index>=0);const old=records[index],likes=old.likes+(p.liked?1:-1);
  const item=records[index]={...old,likes,liked:p.liked,status:old.status==='approved'||likes>=3?'approved':'pending'};return {ok:true,item};
 }});
 t.after(()=>{try{browser.close();host.remove();}finally{environment.restore();}});
 return {host,browser,calls,selections,async sort(label){const button=host.querySelector('.theme-sorts').children.find(n=>n.textContent===label);assert.ok(button);button.click();await flushTheme();},resize(width){const grid=host.querySelector('.theme-grid');grid.clientWidth=width;for(const observer of observers)if(observer.targets.has(grid))observer.callback([{target:grid}]);}};
}
const flushTheme=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const themeRecord=(id,{category='avatar',status='pending',digest='a'.repeat(64)}={})=>({id,digest,category,title:'Theme '+id,author:{name:'Fixture'},status,likes:status==='pending'?2:3,liked:false,image:'/fixture.png'});

test('theme controls consume shared outlines and only an explicit refresh bypasses catalogue caching',async t=>{
 const f=themeHarness(t,{category:'background',records:[themeRecord('one',{category:'background',status:'approved'})]});await flushTheme();
 assert.ok(f.host.querySelector('.theme-search').classList.contains('ui-outline'));
 assert.ok(f.host.querySelector('.theme-sorts').children.every(node=>node.classList.contains('ui-outline')));
 const pager=f.host.querySelector('.theme-pages');assert.ok(pager.classList.contains('ui-pages'));
 assert.ok(f.host.querySelectorAll('.ui-page-number').every(node=>node.classList.contains('ui-outline')));
 assert.equal(f.host.querySelector('.theme-page-label'),null);
 f.browser.refresh();await flushTheme();assert.equal(f.calls.filter(p=>p.action==='list').at(-1).refresh,undefined,'automatic host refresh stays local-first');
 const refresh=f.host.querySelector('.theme-toolbar-actions').children.find(node=>node.getAttribute('aria-label')==='刷新主题');refresh.click();await flushTheme();
 assert.equal(f.calls.filter(p=>p.action==='list').at(-1).refresh,true);
});

test('account changes discard every cached sort and late reads cannot restore the previous account',async t=>{
 let account='anonymous',held=null;
 const f=themeHarness(t,{category:'background',list:p=>held?held.promise:{items:[themeRecord(account+'-'+p.sort,{category:'background',status:'approved'})],nextCursor:null}});
 await flushTheme();await f.sort('热门');await f.sort('推荐');
 assert.match(f.host.textContent,/anonymous-recommended/);
 account='first';f.browser.accountChanged();await flushTheme();
 assert.match(f.host.textContent,/first-recommended/);assert.doesNotMatch(f.host.textContent,/anonymous/);
 await f.sort('热门');assert.match(f.host.textContent,/first-hot/);
 const pending=held=deferred();f.browser.accountChanged();
 held=null;account='anonymous';f.browser.accountChanged();await flushTheme();
 pending.resolve({items:[themeRecord('late-first-hot',{category:'background',status:'approved'})],nextCursor:null});await flushTheme();
 assert.match(f.host.textContent,/anonymous-hot/);assert.doesNotMatch(f.host.textContent,/first/);
 await f.sort('推荐');assert.match(f.host.textContent,/anonymous-recommended/);
 assert.equal(f.calls.filter(p=>p.action==='list').at(-1).refresh,undefined);
});

function pickerHarness(t,{target='background',records=[],prepare}={}){
 const environment=themeEnvironment(),{doc}=environment,calls=[],outcomes=[];
 const result=pickTheme({themeLibrary:async args=>{
  calls.push(args);
  if(args.action==='list')return {ok:true,items:records,nextCursor:null};
  if(args.action==='image')return {ok:true,src:'data:image/png;base64,synthetic-load'};
  assert.equal(args.action,'prepare');return prepare(args);
 }},{target});
 result.then(value=>outcomes.push(value));
 const picker=doc.body.querySelector('.theme-picker'),host=picker.querySelector('.theme-picker-body');
 const cancel=()=>picker.querySelector('.theme-picker-head').children.at(-1).click();
 t.after(()=>{try{cancel();}finally{environment.restore();}});
 return {doc,picker,host,calls,result,outcomes,cancel};
}

for(const navigation of ['next','reopen'])test('pickTheme ignores a late prepared background after '+navigation+' selects another preview',{timeout:5000},async t=>{
 const waiting=deferred(),first=themeRecord('first',{category:'background',status:'approved'}),second=themeRecord('second',{category:'background',status:'approved'});
 const firstValue={ok:true,value:'prepared-first'},secondValue={ok:true,value:'prepared-second'};
 const f=pickerHarness(t,{records:[first,second],prepare:args=>args.id==='first'?waiting.promise:secondValue});await flushTheme();
 f.host.querySelector('.theme-title').click();await flushTheme();const viewer=f.host.querySelector('.theme-viewer');
 const firstAction=viewer.querySelector('.theme-primary');firstAction.click();firstAction.onclick();
 assert.deepEqual(f.calls.filter(args=>args.action==='prepare').map(args=>args.id),['first']);
 if(navigation==='next')viewer.querySelector('.theme-arrow-right').click();else{viewer.close();f.host.querySelectorAll('.theme-title')[1].click();}
 await flushTheme();assert.equal(viewer.dataset.id,'second');assert.equal(viewer.open,true);const secondAction=viewer.querySelector('.theme-primary');assert.equal(secondAction.disabled,true);
 waiting.resolve(firstValue);await flushTheme();
 assert.deepEqual(f.outcomes,[],'late first prepare must not resolve the real picker while second is current');
 assert.equal(f.picker.isConnected,true);assert.equal(f.picker.open,true);assert.equal(viewer.open,true);assert.equal(viewer.dataset.id,'second');assert.equal(secondAction.disabled,false);
 secondAction.click();secondAction.onclick();await flushTheme();assert.deepEqual(await f.result,secondValue);assert.deepEqual(f.outcomes,[secondValue]);
 assert.deepEqual(f.calls.filter(args=>args.action==='prepare').map(args=>args.id),['first','second']);assert.equal(f.picker.isConnected,false);
});

test('pickTheme preserves the current preview after a stale prepare failure and lets it apply',{timeout:5000},async t=>{
 const waiting=deferred(),records=['first','second'].map(id=>themeRecord(id,{category:'background',status:'approved'})),value={ok:true,value:'prepared-second'};
 const f=pickerHarness(t,{records,prepare:args=>args.id==='first'?waiting.promise:value});await flushTheme();f.host.querySelector('.theme-title').click();await flushTheme();
 const viewer=f.host.querySelector('.theme-viewer');viewer.querySelector('.theme-primary').click();viewer.querySelector('.theme-arrow-right').click();await flushTheme();
 waiting.reject(Error('old prepare failed'));await flushTheme();assert.deepEqual(f.outcomes,[]);assert.equal(viewer.dataset.id,'second');assert.equal(viewer.open,true);assert.equal(viewer.querySelector('.theme-status').textContent,'');
 viewer.querySelector('.theme-primary').click();await flushTheme();assert.deepEqual(await f.result,value);assert.deepEqual(f.outcomes,[value]);
});

test('pickTheme shows a current prepare failure and unlocks an explicit retry',{timeout:5000},async t=>{
 const waiting=deferred(),item=themeRecord('first',{category:'background',status:'approved'}),value={ok:true,value:'prepared-first'};let attempts=0;
 const f=pickerHarness(t,{records:[item],prepare:()=>++attempts===1?waiting.promise:value});await flushTheme();f.host.querySelector('.theme-title').click();await flushTheme();
 const viewer=f.host.querySelector('.theme-viewer'),action=viewer.querySelector('.theme-primary');action.click();waiting.resolve({ok:false,error:'current prepare failed'});await flushTheme();
 assert.deepEqual(f.outcomes,[]);assert.equal(f.picker.open,true);assert.equal(viewer.open,true);assert.equal(viewer.querySelector('.theme-status').textContent,'current prepare failed');assert.equal(action.disabled,false);
 action.click();await flushTheme();assert.deepEqual(await f.result,value);assert.equal(attempts,2);assert.deepEqual(f.outcomes,[value]);
});

for(const close of ['button','cancel','hidden'])test('pickTheme discards a prepared background after picker '+close,{timeout:5000},async t=>{
 const waiting=deferred(),item=themeRecord('first',{category:'background',status:'approved'}),f=pickerHarness(t,{records:[item],prepare:()=>waiting.promise});await flushTheme();
 f.host.querySelector('.theme-title').click();await flushTheme();f.host.querySelector('.theme-primary').click();
 if(close==='button')f.cancel();else if(close==='cancel')f.picker.dispatchEvent(new Event('cancel',{cancelable:true}));else{f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}
 assert.equal(await f.result,null);waiting.resolve({ok:true,value:'late-first'});await flushTheme();assert.deepEqual(f.outcomes,[null]);assert.equal(f.picker.isConnected,false);
});

test('pickTheme still commits an accepted avatar directly from its card',{timeout:5000},async t=>{
 const item=themeRecord('avatar',{status:'approved'}),value={ok:true,value:'prepared-avatar'},f=pickerHarness(t,{target:'avatar',records:[item],prepare:()=>value});await flushTheme();
 f.host.querySelector('.theme-select-avatar').click();await flushTheme();assert.deepEqual(await f.result,value);assert.deepEqual(f.outcomes,[value]);assert.equal(f.picker.isConnected,false);
 assert.deepEqual(f.calls.filter(args=>args.action==='prepare'),[{action:'prepare',target:'avatar',id:item.id,digest:item.digest}]);
});

test('third approval enables avatar selection in place and never adds an avatar viewer application',async t=>{
 const item=themeRecord('avatar'),f=themeHarness(t,{records:[item]});await flushTheme();assert.equal(f.host.querySelectorAll('.theme-card').length,0);await f.sort('待审核');
 const card=f.host.querySelector('.theme-card'),picture=card.querySelector('.theme-picture'),main=f.host.querySelector('.theme-content');main.scrollTop=137;
 card.querySelector('.theme-title').click();await flushTheme();const viewer=f.host.querySelector('.theme-viewer'),pan=viewer.querySelector('.theme-pan-content');
 viewer.querySelectorAll('.theme-viewer-tools')[0].children[1].click();const transform=pan.style.transform;
 await viewer.querySelector('.theme-like').click();await flushTheme();
 assert.equal(f.host.querySelector('.theme-card'),card);assert.equal(card.querySelector('.theme-picture'),picture);assert.equal(main.scrollTop,137);assert.equal(pan.style.transform,transform);
 assert.equal(card.querySelector('.theme-review'),null);assert.equal(card.querySelectorAll('.theme-select-avatar').length,1);assert.equal(viewer.querySelector('.theme-primary'),null);
 await viewer.querySelector('.theme-like').click();assert.equal(card.querySelectorAll('.theme-select-avatar').length,1,'repeated approval cannot duplicate actions');
 card.querySelector('.theme-select-avatar').click();await flushTheme();assert.equal(f.selections.length,1);assert.equal(f.selections[0].status,'approved');assert.equal(f.selections[0].likes,2,'selection uses the latest accepted record');
});

test('newly approved avatar actions inherit a pending selection and unlock without duplicate submissions',async t=>{
 const waiting=deferred(),first=themeRecord('first',{status:'approved'}),pending=themeRecord('pending');
 const f=themeHarness(t,{records:[first,pending],select:item=>item.id==='first'?waiting.promise:undefined});await flushTheme();f.host.querySelector('.theme-select-avatar').click();assert.equal(f.selections.length,1);
 await f.sort('待审核');await f.host.querySelector('.theme-like').click();const action=f.host.querySelector('.theme-select-avatar');assert.ok(action);assert.equal(action.disabled,true);
 action.onclick();await flushTheme();assert.equal(f.selections.length,1,'selection controller also rejects programmatic duplicate submissions');
 waiting.resolve();await flushTheme();assert.equal(action.disabled,false);action.click();await flushTheme();assert.deepEqual(f.selections.map(item=>item.id),['first','pending']);
});

test('approved backgrounds keep their preview, inherit busy state, and late application cannot close a newer viewer',async t=>{
 const waiting=deferred(),first=themeRecord('first',{category:'background'}),second=themeRecord('second',{category:'background'});
 const f=themeHarness(t,{category:'background',records:[first,second],select:item=>item.id==='first'?waiting.promise:undefined});await flushTheme();await f.sort('待审核');f.host.querySelector('.theme-title').click();await flushTheme();
 const viewer=f.host.querySelector('.theme-viewer'),image=viewer.querySelector('img'),pan=viewer.querySelector('.theme-pan-content');viewer.querySelector('.theme-viewer-tools').children[1].click();const transform=pan.style.transform;
 await viewer.querySelector('.theme-like').click();assert.equal(viewer.querySelectorAll('.theme-primary').length,1);assert.equal(viewer.querySelector('img'),image);assert.equal(pan.style.transform,transform);
 await viewer.querySelector('.theme-like').click();assert.equal(viewer.querySelectorAll('.theme-primary').length,1);const firstAction=viewer.querySelector('.theme-primary');firstAction.click();firstAction.onclick();assert.equal(f.selections.length,1);
 viewer.querySelector('.theme-arrow-right').click();await flushTheme();assert.equal(viewer.querySelector('.theme-primary'),null);await viewer.querySelector('.theme-like').click();
 const secondAction=viewer.querySelector('.theme-primary');assert.ok(secondAction);assert.equal(secondAction.disabled,true);waiting.resolve();await flushTheme();assert.equal(viewer.open,true);assert.equal(viewer.dataset.id,'second');assert.equal(secondAction.disabled,false);
 secondAction.click();await flushTheme();assert.deepEqual(f.selections.map(item=>item.id),['first','second']);assert.equal(viewer.open,false);
});

test('a delayed approval only updates the same resource and never adds an action to a different preview',async t=>{
 const waiting=deferred(),first=themeRecord('first',{category:'background'}),second=themeRecord('second',{category:'background'});
 const f=themeHarness(t,{category:'background',records:[first,second],like:()=>waiting.promise});await flushTheme();await f.sort('待审核');f.host.querySelector('.theme-title').click();await flushTheme();const viewer=f.host.querySelector('.theme-viewer');
 const response=viewer.querySelector('.theme-like').click();viewer.querySelector('.theme-arrow-right').click();await flushTheme();waiting.resolve({...first,status:'approved',likes:3,liked:true});await response;
 assert.equal(viewer.dataset.id,'second');assert.equal(viewer.querySelector('.theme-primary'),null);assert.equal(viewer.querySelector('.theme-like-count').textContent,'2');assert.equal(f.host.querySelectorAll('.theme-review').length,1);
 viewer.querySelector('.theme-arrow-left').click();await flushTheme();assert.equal(viewer.dataset.id,'first');assert.equal(viewer.querySelectorAll('.theme-primary').length,1);
});

test('approval responses cannot cross resource identity, digest or catalogue generation',async t=>{
 for(const [name,change]of [['id',{id:'other'}],['digest',{digest:'b'.repeat(64)}]])await t.test(name,async t=>{
  const item=themeRecord('same'),f=themeHarness(t,{records:[item],like:async()=>({...item,...change,status:'approved',likes:3})});await flushTheme();await f.sort('待审核');await f.host.querySelector('.theme-like').click();
  assert.equal(f.host.querySelector('.theme-select-avatar'),null);assert.equal(f.host.querySelectorAll('.theme-review').length,1);assert.equal(f.host.querySelector('.theme-like-count').textContent,'2');assert.equal(f.host.querySelector('.theme-status').textContent,'主题已变化，请重新载入');
 });
 await t.test('generation',async t=>{
  const waiting=deferred(),item=themeRecord('same'),f=themeHarness(t,{records:[item],like:()=>waiting.promise});await flushTheme();await f.sort('待审核');const response=f.host.querySelector('.theme-like').click();
  await f.sort('推荐');await f.sort('待审核');waiting.resolve({...item,status:'approved',likes:3});await response;
  assert.equal(f.host.querySelector('.theme-select-avatar'),null);assert.equal(f.host.querySelectorAll('.theme-review').length,1);assert.equal(f.host.querySelector('.theme-like-count').textContent,'2');
 });
});

test('deferred viewer repagination uses the latest width and preserves the existing record anchor',async t=>{
 for(const [name,widths,capacity]of [['restored',[304,632],12],['narrow',[304],6],['latest',[304,796],15]])await t.test(name,async t=>{
  const records=Array.from({length:26},(_,i)=>themeRecord(String(i),{status:'approved'})),f=themeHarness(t,{records});await flushTheme();f.host.querySelector('.theme-pages').children.find(n=>n.textContent==='下一页').click();await flushTheme();
  assert.equal(f.host.querySelector('.theme-title').textContent,'Theme 12');f.host.querySelector('.theme-title').click();await flushTheme();const viewer=f.host.querySelector('.theme-viewer');
  const listed=f.calls.filter(p=>p.action==='list').length;
  for(const width of widths)f.resize(width);assert.equal(f.host.querySelectorAll('.theme-card').length,12,'repagination is deferred while viewing');viewer.close();await flushTheme();
  const titles=f.host.querySelectorAll('.theme-title').map(n=>n.textContent);assert.equal(titles.length,capacity);assert.ok(titles.includes('Theme 12'),'original top record stays on the resized page');
  assert.equal(titles[0],'Theme '+Math.floor(12/capacity)*capacity);assert.equal(f.host.querySelector('.theme-page-numbers').querySelector('[aria-current=page]').textContent,String(Math.floor(12/capacity)+1));assert.equal(f.calls.filter(p=>p.action==='list').length,listed,'resizing must reuse fetched cursor records');
 });
});

test('a width change queued during list loading is replaced or cleared by the latest target',async t=>{
 for(const [name,widths,capacity]of [['restored',[304,632],12],['narrow',[304],6]])await t.test(name,async t=>{
  const waiting=deferred(),records=Array.from({length:24},(_,i)=>themeRecord(String(i),{status:'approved'})),f=themeHarness(t,{list:()=>waiting.promise});
  for(const width of widths)f.resize(width);waiting.resolve({ok:true,items:records,nextCursor:null});await flushTheme();
  assert.equal(f.host.querySelectorAll('.theme-card').length,capacity);assert.equal(f.host.querySelector('.theme-title').textContent,'Theme 0');assert.equal(f.host.querySelector('.theme-page-numbers').querySelector('[aria-current=page]').textContent,'1');assert.equal(f.calls.filter(p=>p.action==='list').length,1);
 });
});

test('shared page numbers stay circular and centred above the outline pill rule; the input follows the drawer inset',()=>{
 const fs=require('node:fs'),path=require('node:path'),css=fs.readFileSync(path.join(__dirname,'../../../Theme/official/default/ui-foundation.css'),'utf8');
 const rule=css.match(/body \.ui-pages button\.ui-page-number \{([^}]*)\}/);assert.ok(rule,'page numbers need .ui-pages specificity over body :is(button.ui-outline,button.pill:not(.primary),...)');
 for(const part of ['padding:0','border-radius:50%','place-items:center','width:32px','height:32px'])assert.ok(rule[1].includes(part),part);
 const drawer=fs.readFileSync(path.join(__dirname,'../ui/contacts.css'),'utf8');
 assert.match(drawer,/#bottom-bar \{ translate:calc\(var\(--workspace-x,0px\) - var\(--workspace-inset,0px\) \/ 2\) 0; width:min\(720px,calc\(100vw - 48px - var\(--workspace-inset,0px\)\)\); \}/);
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../ui/conversation-shared.css'),'utf8'),/--sd-push/,'work geometry uses the live drawer inset');
});
