// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: tick; documentFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/session-status.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function documentFixture(){
 const doc=new EventTarget();doc.defaultView=Object.assign(new EventTarget(),{CustomEvent,innerWidth:1280,innerHeight:800});doc.hidden=false;
 const element=tag=>Object.assign(new EventTarget(),{tag,ownerDocument:doc,children:[],style:{},attrs:{},dataset:{},open:false,
  classList:{add(){}},setAttribute(k,v){this.attrs[k]=v;},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},remove(){},focus(){},
  getBoundingClientRect:()=>({bottom:40,right:1000,left:800,top:10,width:200,height:30}),showModal(){this.open=true;},close(){this.open=false;this.dispatchEvent(new Event('close'));},
  querySelectorAll(){return this.children.filter(n=>n.tag==='button');},querySelector(){return this.children.find(n=>n.attrs['aria-pressed']==='true');}});
 doc.createElement=element;doc.body=element('body');doc.button=element('button');doc.getElementById=()=>doc.button;return doc;
}
test('native model choice leaves program content in place and ignores a choice after navigation',async()=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),saved=[],menus=[];
 const create=doc.createElement;doc.createElement=tag=>{const node=create(tag);node.getAttribute=k=>node.attrs[k];return node;};
 const navigation={current:'coding-module-view',is(id){return this.current===id;}};
 const api={conversation:async p=>p.action==='models'?[{id:'one',name:'One'},{id:'two',name:'Two'}]:p.action==='program'?{configured:true,binding:{scope_id:'group',host_session_id:'cota'}}:{sessions:[{id:p.id,revision:7,model_id:'one',model_target:'cota',roles:[]}]},sessionModel:async p=>{saved.push(p);return {ok:true};},sessionModelMenu:p=>p.action==='dismiss'?Promise.resolve({ok:true}):new Promise(resolve=>menus.push({p,resolve}))};
 const controller=setupSessionStatus(api,navigation,{doc,home:()=>({session_id:'home'})});
 try{
  controller.start();await tick();doc.button.onclick({stopPropagation(){}});await tick();assert.equal(doc.body.children[0].open,false,'no DOM modal may hide the program');assert.equal(menus[0].p.items.length,3);
  navigation.current='conversation-view';doc.body.dataset.conversationId='other';doc.dispatchEvent(new Event('workspace-view-change'));menus[0].resolve('2');await tick();assert.equal(saved.length,0);
  navigation.current='coding-module-view';doc.dispatchEvent(new Event('workspace-view-change'));await tick();doc.button.onclick({stopPropagation(){}});await tick();menus[1].resolve('2');await tick();await tick();assert.equal(saved[0].model_id,'two');assert.equal(saved[0].target,'cota');
 }finally{controller.close();}
});
test('late usage cannot replace the newly viewed conversation and models bind to the chosen scope',async()=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),changes=[],saved=[];
 const home={session_id:'home',model_id:'one',model_name:'home-model',roles:[],link:{scope:'home-context'}};let pending,slow=true;
 const navigation={current:null,is(id){return this.current===id;}};
 const row=id=>({id,session_id:id,revision:4,model_id:'one',model_target:id,roles:[{id:'member',usage:{input_tokens:23}}]});
 const api={conversation:async p=>p.action==='models'?[{id:'one',name:'One'},{id:'two',name:'Two'}]:p.id==='home-context'&&slow?new Promise(r=>pending=r):{sessions:[row(p.id)]},sessionModel:async p=>{saved.push(p);return {ok:true};}};
 const controller=setupSessionStatus(api,navigation,{doc,home:()=>home,changed:v=>changes.push(v)});
 try{
  controller.start();navigation.current='conversation-view';doc.body.dataset.conversationId='cota';doc.dispatchEvent(new Event('workspace-view-change'));
  slow=false;pending({sessions:[row('home-context')]});await tick();await tick();
  assert.equal(changes.at(-1).session_id,'cota');assert.equal(changes.at(-1).roles[0].usage.input_tokens,23);
  doc.button.onclick({stopPropagation(){}});await tick();const dialog=doc.body.children[0],choice=dialog.children.find(n=>n.textContent==='Two');
  assert(dialog.open);navigation.current=null;doc.dispatchEvent(new Event('workspace-view-change'));await choice.onclick();assert.equal(saved.length,0,'stale menu cannot target another conversation');
  navigation.current='conversation-view';doc.body.dataset.conversationId='vaya';doc.dispatchEvent(new Event('workspace-view-change'));await tick();
  doc.button.onclick({stopPropagation(){}});await tick();await dialog.children.find(n=>n.textContent==='Two').onclick();
  assert.deepEqual(saved[0],{kind:'conversation',id:'vaya',target:'vaya',revision:4,expected_model:'one',model_id:'two'});
 }finally{controller.close();}
});

test('session status suspension rejects late shutdown errors and resumes real polling without suppressing active failures',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),notices=[],requests=[],changes=[];
 const home={session_id:'home',model_id:'one',roles:[]},navigation={current:null,is(){return false;}};
 const api={conversation:p=>new Promise((resolve,reject)=>requests.push({p,resolve,reject}))};
 const controller=setupSessionStatus(api,navigation,{doc,home:()=>home,notice:s=>notices.push(s),changed:s=>changes.push(s)});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));t.after(()=>controller.close());
 controller.start();assert.equal(requests.length,1);controller.suspend();const count=changes.length;
 requests[0].reject(Error('对话智能体当前不可用'));await flush();t.mock.timers.tick(5000);await flush();await controller.refresh();
 assert.equal(notices.length,0);assert.equal(changes.length,count);assert.equal(requests.length,1);
 controller.resume();assert.equal(requests.length,2);requests[1].reject(Error('active request failed'));await flush();
 assert.deepEqual(notices,['active request failed']);t.mock.timers.tick(1500);assert.equal(requests.length,3);
 controller.close();requests[2].reject(Error('late close failure'));await flush();t.mock.timers.tick(5000);await flush();controller.resume();await controller.refresh();
 assert.equal(requests.length,3);assert.deepEqual(notices,['active request failed']);
});

test('late model menus and saves cannot reopen or notify suspended and closed surfaces',async()=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),notices=[];
 const home={session_id:'home',model_id:'one',roles:[]},navigation={current:null,is(){return false;}};
 let rejectModels,rejectSave,slow=true,changed=0;doc.addEventListener('aieyra:model-changed',()=>changed++);
 const api={conversation:async p=>p.action==='models'?(slow?new Promise((resolve,reject)=>{rejectModels=reject;}):[{id:'one',name:'One'},{id:'two',name:'Two'}]):{sessions:[{id:p.id,revision:1,model_id:'one',roles:[]}]},sessionModel:()=>new Promise((resolve,reject)=>{rejectSave=reject;})};
 const controller=setupSessionStatus(api,navigation,{doc,home:()=>home,notice:s=>notices.push(s)});
 try{
  controller.start();await tick();doc.button.onclick({stopPropagation(){}});controller.suspend();rejectModels(Error('model query after prepare close'));await tick();
  const dialog=doc.body.children[0];assert.equal(dialog.open,false);assert.deepEqual(notices,[]);
  slow=false;controller.resume();doc.button.onclick({stopPropagation(){}});await tick();assert.equal(dialog.open,true);
  const save=dialog.children.find(n=>n.textContent==='Two').onclick();controller.close();rejectSave(Error('save after close'));await save;
  assert.deepEqual(notices,[]);assert.equal(changed,0);
 }finally{controller.close();}
});

test('rapid model toggles and Escape cancel pending opens without a late menu flash',async t=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),requests=[],notices=[];
 const home={session_id:'home',model_id:'one',roles:[]},navigation={current:null,is(){return false;}};
 const api={conversation:p=>p.action==='models'?new Promise((resolve,reject)=>requests.push({resolve,reject})):Promise.resolve({sessions:[{id:p.id,revision:1,model_id:'one',roles:[]}]})};
 const controller=setupSessionStatus(api,navigation,{doc,home:()=>home,notice:s=>notices.push(s)});t.after(()=>controller.close());controller.start();await tick();
 const click=()=>doc.button.onclick({stopPropagation(){}}),models=[{id:'one',name:'One'}],dialog=doc.body.children[0];
 click();click();click();assert.equal(requests.length,2);requests[0].reject(Error('cancelled old query'));await tick();assert.equal(dialog.open,false);assert.deepEqual(notices,[]);
 click();requests[1].resolve(models);await tick();assert.equal(dialog.open,false,'old finalizer cannot clear the new pending-open state');
 click();requests[2].resolve(models);await tick();assert.equal(dialog.open,true);
 click();click();const escape=new Event('keydown');Object.defineProperty(escape,'key',{value:'Escape'});doc.dispatchEvent(escape);requests[3].resolve(models);await tick();assert.equal(dialog.open,false);
});


test('Coding titlebar follows its managed group and binds model changes to its actual host',async()=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),changes=[],saved=[],reads=[];
 let configured=false;
 const navigation={current:'coding-module-view',is(){return false;}};
 const row={id:'coding-group',session_id:'coding-group',model_id:'one',model_name:'Coding model',model_target:'cota-session',revision:7,roles:[{id:'cota-session',usage:{input_tokens:31}},{id:'vaya-session',usage:{input_tokens:17}}]};
 const api={conversation:async p=>{reads.push(p);if(p.action==='program')return {configured,binding:{scope_id:'coding-group',host_session_id:configured?'cota-session':''}};if(p.action==='models')return [{id:'one',name:'One'},{id:'two',name:'Two'}];return {sessions:[row]};},sessionModel:async p=>{saved.push(p);return {ok:true};}};
 const controller=setupSessionStatus(api,navigation,{doc,changed:v=>changes.push(v)});
 try{
  controller.start();await tick();assert.equal(changes.at(-1).configured,false);assert.equal(reads.filter(p=>p.action==='session_usage').length,0);
  configured=true;await controller.refresh();assert.equal(changes.at(-1).model_name,'Coding model');assert.equal(changes.at(-1).roles.length,2);assert.equal(changes.at(-1).id,'coding-group');
  doc.button.onclick({stopPropagation(){}});await tick();const dialog=doc.body.children[0];assert(dialog.open);await dialog.children.find(n=>n.textContent==='Two').onclick();
  assert.deepEqual(saved[0],{kind:'group',id:'coding-group',target:'cota-session',revision:7,expected_model:'one',model_id:'two'});
 }finally{controller.close();}
});

test('Coding without a session selects from the pool through versioned role defaults and opens only an idle binding',async()=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),saved=[];
 let configured=false;
 const navigation={current:'coding-module-view',is(){return false;}},row={id:'coding-group',model_target:'cota-session',revision:0,model_id:'two',roles:[]};
 const api={conversation:async p=>{
  if(p.action==='models')return [{id:'two',name:'Two'}];
  if(p.action==='session_usage')return {sessions:[row]};
  if(p.action==='program_open'){configured=true;saved.push(p);}
  return {configured,contact:{id:'cota'},binding:{scope_id:'coding-group',host_session_id:configured?'cota-session':''}};
 },builtinRole:async p=>{if(p.action==='save'){saved.push(p);return {ok:true};}return {model_id:'',model_binding:'',profile_version:'profile-1',model_version:'model-3'};}};
 const controller=setupSessionStatus(api,navigation,{doc});
 try{
  controller.start();await tick();doc.button.onclick({stopPropagation(){}});await tick();
  const dialog=doc.body.children[0];assert.equal(dialog.open,true);assert(dialog.children.some(n=>n.textContent==='跟随 Eyra'));
  await dialog.children.find(n=>n.textContent==='Two').onclick();
  assert.deepEqual(saved,[{action:'save',builtin:'cota',profile_version:'profile-1',model_version:'model-3',model_id:'two'},{action:'program_open',program:'coding'}]);
 }finally{controller.close();}
});

test('unconfigured program model menu can select without an existing session and binds the contact revision',async()=>{
 const {setupSessionStatus}=await import('../ui/session-status.mjs'),doc=documentFixture(),saved=[];
 const navigation={current:'browser-view',is(){return false;}},contact={id:'navi-contact',name:'Navi',model_id:'',model_inherited:true,model_revision:3};
 const api={conversation:async p=>{if(p.action==='models')return [{id:'two',name:'Two'}];if(p.action==='contact_update'){saved.push(p);return {ok:true};}return {configured:false,contact};}};
 const controller=setupSessionStatus(api,navigation,{doc});
 try{
  controller.start();doc.dispatchEvent(new CustomEvent('aieyra:program-agent',{detail:{program:'browser',contact,configured:false}}));
  doc.button.onclick({stopPropagation(){}});await tick();const dialog=doc.body.children[0];assert.equal(dialog.open,true);
  await dialog.children.find(n=>n.textContent==='Two').onclick();
  assert.deepEqual(saved,[{action:'contact_update',id:'navi-contact',model_id:'two',model_unconfigured:false,expected_model_revision:3}]);
 }finally{controller.close();}
});
