// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: priorAddEventListener; settle; deferred; dom; settingsWindowFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/settings-extension.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// model-ui installs its browser scroll handler at import; no browser is started.
const priorAddEventListener=global.addEventListener;global.addEventListener=()=>{};
after(()=>{if(priorAddEventListener===undefined)delete global.addEventListener;else global.addEventListener=priorAddEventListener;});
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function dom(){
 const nodes=new Map(),listeners=new Map();
 class Node{
  constructor(id=''){this.id=id;this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.dataset={};this.attrs={};this.children=[];this.listeners=new Map();this.isConnected=true;this.classList={add:()=>{}};this.style={setProperty(){},getPropertyValue:()=>''};}
  insertAdjacentHTML(){}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  replaceChildren(...nodes){this.children=nodes;}
  append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this;}
  querySelector(selector){return this.children.find(node=>String(node.className||'').split(' ').includes(selector.slice(1)))||null;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  closest(){return null;}
  focus(){doc.activeElement=this;}
  setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
 }
 const doc={body:new Node('body'),activeElement:null,getElementById(id){if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},createElement:()=>new Node(),
  querySelectorAll:()=>[],querySelector:()=>null,
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
 doc.activeElement=doc.body;
 return {doc,nodes,listeners,$:id=>doc.getElementById(id),emit:(type,event)=>{for(const fn of listeners.get(type)||[])fn(event);}};
}

test('desktop composition mounts settings with only its transport and never loads the workspace',async()=>{
 const {mountDesktop}=await import('../host/entry.mjs'),calls=[],api=Object.freeze({settingsBootstrap(){}}),extension={};
 const options={api,extension,location:{href:'file:///Client/Desktop/ui/index.html?extension=settings'},
  settings:async()=>({mountSettings:(a,e)=>{calls.push(['settings',a,e]);return 'settings';}}),workspace:async()=>{calls.push(['workspace-load']);return {mountWorkspace:a=>{calls.push(['workspace',a]);return 'workspace';}};}};
 assert.equal(await mountDesktop(options),'settings');assert.deepEqual(calls,[['settings',api,extension]]);
 calls.length=0;assert.equal(await mountDesktop({...options,location:{href:'file:///Client/Desktop/ui/index.html'}}),'workspace');assert.deepEqual(calls,[['workspace-load'],['workspace',api]]);
 calls.length=0;await assert.rejects(mountDesktop({...options,location:{href:'file:///Client/Desktop/ui/index.html?extension=unknown'}}),/未知/);assert.deepEqual(calls,[]);
});

test('personal save and layout save serialize saved values while preserving newer media and name drafts',async()=>{
 const {setupProfileSettings}=await import('../ui/settings-controller.mjs'),f=dom(),requests=[],applied=[];let media={avatar:'',eyraAvatar:'',background:'',backgroundBlur:12,backgroundOpacity:.5};
 const controller=setupProfileSettings({saveProfile:p=>{const wait=deferred();requests.push({p,wait});return wait.promise;}},{doc:f.doc,media:{load:p=>{for(const key of Object.keys(media))if(key in p)media[key]=p[key];}},mediaValue:()=>({...media}),onApply:p=>applied.push(p)});
 controller.initialize({name:'original',eyraName:'Eyra',chatLayout:{top:20},initialized:true});
 f.$('display-name').value=' saved name ';f.$('display-name').emit('input');assert.equal(controller.dirty,true);
 const saving=f.$('save-profile').onclick(),layout=controller.saveLayout({top:40});await settle();
 assert.equal(requests.length,1);assert.equal(requests[0].p.name,' saved name ');assert.deepEqual(requests[0].p.chatLayout,{top:20});
 media.backgroundBlur=30;controller.changed();
 requests[0].wait.resolve({ok:true,profile:{...requests[0].p,name:'saved name',initialized:true}});await saving;await settle();
 assert.equal(requests.length,2);assert.equal(requests[1].p.name,'saved name');assert.equal(requests[1].p.backgroundBlur,12,'layout does not submit the newer personal draft');
 requests[1].wait.resolve({ok:true,profile:requests[1].p});await layout;
 assert.equal(f.$('display-name').value,'saved name');assert.equal(controller.profile.name,'saved name');assert.deepEqual(controller.profile.chatLayout,{top:40});
 assert.equal(media.backgroundBlur,30);assert.equal(controller.dirty,true);assert.match(f.$('profile-status').textContent,/仍有未保存/);assert.equal(f.$('save-profile').disabled,false);assert.equal(applied.length,3);
});

test('a rejected personal save keeps its draft and does not poison the next save',async()=>{
 const {setupProfileSettings}=await import('../ui/settings-controller.mjs'),f=dom(),calls=[];let fail=true;
 const controller=setupProfileSettings({saveProfile:async p=>{calls.push(p);return fail?{ok:false,error:'isolated save failed'}:{ok:true,profile:{...p,initialized:true}};}},{doc:f.doc,media:{load(){}},mediaValue:()=>({})});
 controller.initialize({name:'before',eyraName:'Eyra',chatLayout:{}});f.$('display-name').value='draft';
 await f.$('save-profile').onclick();assert.equal(f.$('display-name').value,'draft');assert.equal(controller.profile.name,'before');assert.match(f.$('profile-status').textContent,/isolated save failed.*保留/);assert.equal(f.$('display-name').disabled,false);
 fail=false;await f.$('save-profile').onclick();assert.equal(controller.profile.name,'draft');assert.equal(controller.dirty,false);assert.equal(calls.length,2);
});

test('saving a name rebases a timed image change without overwriting its persisted deadline',async()=>{
 const {setupProfileSettings}=await import('../ui/settings-controller.mjs'),f=dom();
 const original={name:'before',eyraName:'Eyra',avatar:'old',background:'',chatLayout:{},mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:1000}}};
 let saved,media={avatar:'old',mediaRotation:structuredClone(original.mediaRotation)};
 const fresh={...original,version:'new',avatar:'rotated',mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:61000}}};
 const controller=setupProfileSettings({profile:async()=>({ok:true,profile:fresh}),saveProfile:async p=>{saved=p;return {ok:true,profile:p};}},{doc:f.doc,media:{load(){},rebase(){media={avatar:fresh.avatar,mediaRotation:structuredClone(fresh.mediaRotation)};}},mediaValue:()=>media});
 controller.initialize(original);f.$('display-name').value='new name';await f.$('save-profile').onclick();
 assert.equal(saved.name,'new name');assert.equal(saved.avatar,'rotated');assert.equal(saved.mediaRotation.avatar.nextAt,61000);assert.equal(saved.version,'new');
});
test('editing one role field preserves concurrent avatars and another role change',async()=>{
 const {setupProfileSettings}=await import('../ui/settings-controller.mjs'),f=dom();
 const original={name:'User',eyraName:'Eyra',chatLayout:{},roles:{execution:{name:'Cota',avatar:'old',ring:'pulse'},project:{name:'Vaya',avatar:'vaya',ring:'pulse'}},mediaRotation:{cotaAvatar:{mode:'random',intervalSeconds:60,nextAt:1000}}};
 let saved,roles=structuredClone(original.roles);const fresh={...original,version:'new',roles:{execution:{...original.roles.execution,avatar:'rotated'},project:{...original.roles.project,name:'Research'}},mediaRotation:{cotaAvatar:{mode:'random',intervalSeconds:60,nextAt:61000}}};
 const controller=setupProfileSettings({profile:async()=>({ok:true,profile:fresh}),saveProfile:async p=>{saved=p;return {ok:true,profile:p};}},{doc:f.doc,media:{load(){}},mediaValue:()=>({mediaRotation:original.mediaRotation}),roleMedia:{load(){},value:()=>roles,rotation:()=>original.mediaRotation}});
 controller.initialize(original);roles.execution.name='New Cota';await f.$('save-profile').onclick();
 assert.equal(saved.roles.execution.name,'New Cota');assert.equal(saved.roles.execution.avatar,'rotated');assert.equal(saved.roles.project.name,'Research');assert.equal(saved.mediaRotation.cotaAvatar.nextAt,61000);
});

function settingsWindowFixture(){
 const f=dom(),calls=[],callbacks={},notices=[];let placement='attached';
 const state=()=>({ok:true,kind:'settings',key:'settings',title:'设置',placement,visible:true});
 const extension={describe:async()=>state(),onState:fn=>{callbacks.state=fn;return ()=>delete callbacks.state;},onVisibility:fn=>{callbacks.visibility=fn;return ()=>delete callbacks.visibility;},
  detach:async()=>{calls.push('detach');placement='detached';return state();},dock:async()=>{calls.push('dock');placement='attached';return state();},hide:async()=>{calls.push('hide');callbacks.visibility?.({visible:false});return {ok:true};},focusMain:async()=>{calls.push('focusMain');return {ok:true};}};
 const pane=f.$('onboarding'),editor=f.$('prompt-editor');pane.append(editor);editor.value='unsaved prompt';editor.setSelectionRange(2,7,'backward');
 const api={minimizeWindow:async()=>({ok:true}),toggleMaximize:async()=>({ok:true})};
 return {...f,api,extension,calls,callbacks,notices,editor,pane};
}
test('settings relocation and close preserve the editor DOM, draft, caret and saving feedback',async()=>{
 const {setupSettingsWindow}=await import('../ui/settings.mjs'),f=settingsWindowFixture(),surface=setupSettingsWindow(f.api,f.extension,{doc:f.doc,notice:msg=>f.notices.push(msg)});
 const style=new Map();f.doc.body.style.setProperty=(key,value)=>style.set(key,value);
 await surface.initialize();f.$('prompt-status').textContent='正在保存…';f.$('prompts-tab').setAttribute('aria-selected','true');f.$('settings-body').scrollTop=187;
 f.callbacks.state({placement:'attached',overlayClearance:{bottom:170,wide:true}});
 assert.equal(style.get('--settings-overlay-space'),'170px');assert.equal(f.doc.body.dataset.overlayWide,'true');
 for(const expected of ['detach','dock']){
  f.editor.focus();f.$('status-anchor').emit('pointerdown');f.$('settings-extension-placement').focus();await f.$('settings-extension-placement').onclick();
  assert.equal(f.calls.at(-1),expected);assert.equal(f.doc.activeElement,f.editor);assert.equal(f.editor.selectionStart,2);assert.equal(f.editor.selectionEnd,7);assert.equal(f.editor.selectionDirection,'backward');
  if(expected==='detach'){assert.equal(style.get('--settings-overlay-space'),'0px');assert.equal(f.doc.body.dataset.overlayWide,'false');}
 }
 await f.$('close-onboarding').onclick();assert.equal(f.calls.at(-1),'hide');assert.equal(f.doc.body.dataset.visible,'false');f.doc.activeElement=f.doc.body;
 f.callbacks.visibility({visible:true});assert.equal(f.doc.activeElement,f.editor);assert.equal(f.editor.value,'unsaved prompt');assert.equal(f.pane.children[0],f.editor);assert.equal(f.$('settings-body').scrollTop,187);
 assert.equal(f.$('prompts-tab').attrs['aria-selected'],'true');assert.equal(f.$('prompt-status').textContent,'正在保存…');assert.deepEqual(f.notices,[]);
 surface.close();surface.close();assert.deepEqual(f.callbacks,{});assert.ok([...f.listeners.values()].every(set=>set.size===0));assert.ok([...f.pane.listeners.values()].every(set=>set.size===0));
});

test('settings Escape leaves composition, open confirmation and select overlays with their own handlers',async()=>{
 const {setupSettingsWindow}=await import('../ui/settings.mjs'),f=settingsWindowFixture(),surface=setupSettingsWindow(f.api,f.extension,{doc:f.doc});await surface.initialize();
 const event=p=>({key:'Escape',preventDefault(){this.defaultPrevented=true;},...p});
 f.emit('keydown',event({isComposing:true}));assert.deepEqual(f.calls,[]);
 f.doc.querySelectorAll=()=>[f.pane,{}];f.emit('keydown',event());assert.deepEqual(f.calls,[]);
 f.doc.querySelectorAll=()=>[f.pane];f.doc.querySelector=()=>({});f.emit('keydown',event());assert.deepEqual(f.calls,[]);
 f.doc.querySelector=()=>null;const escape=event();f.emit('keydown',escape);await settle();assert.equal(escape.defaultPrevented,true);assert.deepEqual(f.calls,['hide']);surface.close();
});

test('committed configuration notifications use readers and preserve pending newer values',async()=>{
 const {subscribeSettingsUpdates}=await import('../ui/settings-sync.mjs'),reads=[],applied=[],errors=[];let notify,connections=0;
 const api={onSettingsChanged:fn=>{notify=fn;return ()=>{notify=null;};},profile:()=>{const wait=deferred();reads.push(wait);return wait.promise;},appearance:async p=>{assert.deepEqual(p,{action:'os_appearance_read'});return {ok:true,settings:{font:'fixture'}};}};
 const stop=subscribeSettingsUpdates(api,{profile:p=>applied.push(p.name),appearance:r=>applied.push(r.settings.font),connection:async()=>{connections++;},onError:error=>errors.push(error)});
 notify({method:'saveProfile'});notify({method:'saveProfile'});notify({method:'appearance'});notify({method:'onboard'});notify({method:'savePrompt'});
 assert.equal(reads.length,1);reads[0].resolve({ok:true,profile:{name:'first'}});await settle();assert.equal(reads.length,2);reads[1].resolve({ok:true,profile:{name:'newer'}});await settle();
 assert.deepEqual(applied,['first','newer','fixture']);assert.equal(connections,1);assert.deepEqual(errors,[]);
 notify({method:'saveProfile'});stop();reads[2].resolve({ok:true,profile:{name:'late after close'}});await settle();assert.deepEqual(applied,['first','newer','fixture']);assert.equal(notify,null);
});

test('failed configuration reads surface the error and allow the next saved notification',async()=>{
 const {subscribeSettingsUpdates}=await import('../ui/settings-sync.mjs');let notify,fail=true;const applied=[],errors=[];
 const stop=subscribeSettingsUpdates({onSettingsChanged:fn=>{notify=fn;},profile:async()=>fail?{ok:false,error:'read failed'}:{ok:true,profile:{name:'recovered'}}},{profile:p=>applied.push(p.name),onError:e=>errors.push(e)});
 notify({method:'saveProfile'});await settle();assert.deepEqual(errors,['read failed']);assert.deepEqual(applied,[]);
 fail=false;notify({method:'saveProfile'});await settle();assert.deepEqual(applied,['recovered']);stop();
});

test('the actual settings preload exposes configuration and lifecycle without task execution',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../host/extension-preload.cjs'),'utf8'),world={},calls=[],events=new Map();
 const electron={contextBridge:{exposeInMainWorld:(name,value)=>world[name]=value},ipcRenderer:{invoke:async(channel,payload)=>{calls.push({channel,...payload});return {ok:true};},on:(channel,fn)=>events.set(channel,fn),removeListener:channel=>events.delete(channel)}};
 vm.runInNewContext(source,{window:{addEventListener(){}},require:name=>{assert.equal(name,'electron');return electron;},process:{argv:['--aieyra-extension-kind=settings']}});
 for(const key of ['bootstrap','greet','send','cancel','terminalInput','terminalResize','openSession','askReply','humanReply','withdraw','updates','browserWorkSurface']){
  assert.equal(world.aieyra[key],undefined,key);assert.equal(world.aieyraExtension[key],undefined,key);
 }
 await world.aieyra.settingsBootstrap();await world.aieyra.savePrompt({version:'v1'});await world.aieyraExtension.dock();
 assert.deepEqual(calls.map(c=>c.method),['settingsBootstrap','savePrompt','dock']);assert.ok(calls.every(c=>c.channel==='extension:invoke'));
 const stop=world.aieyra.onSettingsChanged(()=>{});assert.equal(events.size,1);stop();assert.equal(events.size,0);
 const observer={};vm.runInNewContext(source,{window:{addEventListener(){}},require:()=>({...electron,contextBridge:{exposeInMainWorld:(name,value)=>observer[name]=value}}),process:{argv:['--aieyra-extension-kind=agent']}});assert.equal(observer.aieyra,undefined);
});

test('a repeated prompt version conflict retries once and retains the complete draft',async t=>{
 const f=dom(),oldDocument=global.document,oldObserver=global.MutationObserver,observers=[];global.document=f.doc;global.MutationObserver=class{constructor(fn){observers.push(fn);}observe(){}};
 t.after(()=>{if(oldDocument===undefined)delete global.document;else global.document=oldDocument;if(oldObserver===undefined)delete global.MutationObserver;else global.MutationObserver=oldObserver;});
 f.$('prompt-settings').hidden=true;const requests=[],original={id:'self',title:'人格与沟通',text:'original',version:'original-version',exists:true,defaultAvailable:true};
 const api={profile:async()=>({profile:{}}),builtinRole:async p=>{if(p.action==='read')return {ok:true,prompt_directory:'isolated-prompt',profile_version:'profile-v1',prompts:[original]};requests.push(p);return {ok:false,error:'version conflict'};}};
 const {setupPromptSettings}=await import('../ui/prompts.mjs'),{checkSettings}=await import('../ui/settings-controller.mjs');setupPromptSettings(api,checkSettings);
 f.$('prompt-settings').hidden=false;observers[0]();await settle();f.$('prompt-editor').value='keep this draft';f.$('prompt-editor').oninput();await f.$('save-prompt').onclick();
 assert.equal(f.$('prompt-editor').value,'keep this draft');assert.match(f.$('prompt-status').textContent,/version conflict.*保留/);assert.equal(f.$('save-prompt').disabled,false);
 const expected={action:'save',builtin:'eyra',profile_version:'profile-v1',prompts:[{id:'self',text:'keep this draft',version:'original-version'}]};assert.deepEqual(requests,[expected,expected]);
});

test('explicit prompt save uses the latest file and profile versions and retains newer typing',async t=>{
 const f=dom(),priorDocument=global.document,priorObserver=global.MutationObserver,observers=[];global.document=f.doc;global.MutationObserver=class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}};
 t.after(()=>{if(priorDocument===undefined)delete global.document;else global.document=priorDocument;if(priorObserver===undefined)delete global.MutationObserver;else global.MutationObserver=priorObserver;});
 f.$('prompt-settings').hidden=true;let revision=1,saves=0,release;
 const rows=()=>['self','work'].map(id=>({id,title:id,text:id+' saved '+revision,version:'v'+revision,defaultAvailable:true})),requests=[];
 const api={profile:async()=>({profile:{}}),builtinRole:async p=>{
  if(p.action==='read')return {ok:true,prompt_directory:'owned',profile_version:'p'+revision,prompts:rows()};
  requests.push(structuredClone(p));if(++saves===1){revision=3;return {ok:false,error:'提示词已变化，请重新读取'};}
  await new Promise(resolve=>release=resolve);return {ok:true,prompt_directory:'owned',profile_version:'p3',prompts:rows().map(r=>r.id==='self'?{...r,text:p.prompts[0].text}:r)};
 }};
 const {setupPromptSettings}=await import('../ui/prompts.mjs'),{checkSettings}=await import('../ui/settings-controller.mjs'),controller=setupPromptSettings(api,checkSettings);t.after(()=>controller.close());
 f.$('prompt-settings').hidden=false;observers[0]();await settle();
 f.$('prompt-editor').value='explicit current edit';f.$('prompt-editor').oninput();revision=2;
 const saving=f.$('save-prompt').onclick();await settle();assert.equal(requests.length,2);assert.equal(requests[0].prompts[0].version,'v2');assert.equal(requests[0].profile_version,'p2');assert.equal(requests[1].prompts[0].version,'v3');assert.equal(requests[1].profile_version,'p3');
 f.$('prompt-editor').value='typing during save';f.$('prompt-editor').oninput();release();await saving;
 assert.equal(f.$('prompt-editor').value,'typing during save');assert.equal(requests[1].prompts[0].text,'explicit current edit');
});

test('saving one prompt layer advances sibling versions and retains their drafts',async t=>{
 const f=dom(),oldDocument=global.document,oldObserver=global.MutationObserver,observers=[];global.document=f.doc;let disconnected=false;
 global.MutationObserver=class{constructor(fn){observers.push(fn);}observe(){}disconnect(){disconnected=true;}};
 t.after(()=>{if(oldDocument===undefined)delete global.document;else global.document=oldDocument;if(oldObserver===undefined)delete global.MutationObserver;else global.MutationObserver=oldObserver;});
 f.$('prompt-settings').hidden=true;const requests=[],stored={};
 const api={builtinRole:async p=>{
  if(p.action==='read'){stored[p.builtin]??=['self','work','boundary','thinking'].map(id=>({id,title:id,text:p.builtin+' '+id,version:'v1'}));return {ok:true,profile_version:'p1',prompts:structuredClone(stored[p.builtin])};}
  requests.push(p);const change=p.prompts[0];stored[p.builtin]=stored[p.builtin].map(row=>({...row,text:row.id===change.id?change.text:row.text,version:'v2'}));return {ok:true,profile_version:'p1',prompts:structuredClone(stored[p.builtin])};
 }};
 const {setupPromptSettings}=await import('../ui/prompts.mjs'),{checkSettings}=await import('../ui/settings-controller.mjs'),controller=setupPromptSettings(api,checkSettings);
 f.$('prompt-settings').hidden=false;observers[0]();await settle();
 const edit=text=>{f.$('prompt-editor').value=text;f.$('prompt-editor').oninput();};
 const layer=id=>f.$('prompt-layers').children.find(b=>b.dataset.id===id).onclick();
 edit('self draft');layer('work');edit('work draft');layer('self');await f.$('save-prompt').onclick();
 assert.equal(stored.eyra[0].text,'self draft');layer('work');assert.equal(f.$('prompt-editor').value,'work draft');await f.$('save-prompt').onclick();
 assert.equal(requests[1].prompts[0].version,'v2');assert.equal(stored.eyra[1].text,'work draft');assert.deepEqual(Object.keys(stored),['eyra']);
 controller.close();assert.ok(disconnected);
});


test('returning home rereads the saved avatar after a missed hidden-view notification',async()=>{
 const {subscribeSettingsUpdates}=await import('../ui/settings-sync.mjs');let listener,reads=0;const applied=[];
 const doc={addEventListener:(name,fn)=>{assert.equal(name,'workspace-view-change');listener=fn;},removeEventListener:()=>{listener=null;}};
 const stop=subscribeSettingsUpdates({profile:async()=>{reads++;return {ok:true,profile:{eyraAvatar:'saved-avatar',version:'v2'}};}},{doc,profile:p=>applied.push(p.eyraAvatar)});
 listener({detail:{id:'settings'}});assert.equal(reads,0);listener({detail:{id:''}});await settle();assert.deepEqual(applied,['saved-avatar']);stop();assert.equal(listener,null);
});
