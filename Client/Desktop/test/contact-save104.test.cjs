// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; deferred; settle; documentFixture; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/contact-save104.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};

// Parse the actual editor template; the fixture supplies DOM plumbing only.
// User input/click helpers respect the native readonly, disabled and inert rules.
function documentFixture(){
 let doc;
 class Node{
  constructor(tag,type=1,text=''){this.nodeType=type;this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.childNodes=[];this.parentNode=null;this.attrs={};this.dataset={};this.style={setProperty(){}};this.listeners={};this.className='';this._text=text;this.value='';this.disabled=false;this.readOnly=false;this.inert=false;this.hidden=false;this.open=false;this.scrollHeight=60;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ');},contains:name=>this.className.split(' ').includes(name)};}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');}set textContent(v){this._text=String(v);this.replaceChildren();}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  append(...nodes){for(let n of nodes){if(typeof n==='string')n=doc.createTextNode(n);n.remove();this.childNodes.push(n);n.parentNode=this;}}
  prepend(n){n.remove();this.childNodes.unshift(n);n.parentNode=this;}
  replaceChildren(...nodes){for(const n of [...this.childNodes])n.remove();this.append(...nodes);}
  remove(){if(this.parentNode){this.parentNode.childNodes=this.parentNode.childNodes.filter(n=>n!==this);this.parentNode=null;}}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=String(v);if(k==='id')this.id=v;if(k==='hidden')this.hidden=true;if(k==='disabled')this.disabled=true;if(k==='readonly')this.readOnly=true;if(k==='value')this.value=v;}
  getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}hasAttribute(k){return k in this.attrs;}
  matches(s){return s.split(',').some(part=>{part=part.trim();if(part==='*')return true;const attr=part.match(/^(\w+)?\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);if(attr)return (!attr[1]||this.tagName===attr[1].toUpperCase())&&this.hasAttribute(attr[2])&&(attr[3]===undefined||this.getAttribute(attr[2])===attr[3]);return part.startsWith('.')?part.slice(1).split('.').every(c=>this.classList.contains(c)):this.tagName===part.toUpperCase();});}
  querySelectorAll(s){if(s.startsWith(':scope > '))return this.children.filter(n=>n.matches(s.slice(9)));const parts=s.split(',').map(x=>x.trim());return this.children.flatMap(n=>[...(parts.some(p=>n.matches(p))?[n]:[]),...n.querySelectorAll(s)]);}
  querySelector(s){if(s.includes(' ')&&!s.startsWith(':scope > ')){const [first,...rest]=s.split(' ');return this.querySelectorAll(first).map(n=>n.querySelector(rest.join(' '))).find(Boolean)||null;}return this.querySelectorAll(s)[0]||null;}
  closest(s){for(let n=this;n;n=n.parentNode)if(n.matches(s))return n;return null;}contains(n){return n===this||this.children.some(c=>c.contains(n));}
  addEventListener(type,fn){(this.listeners[type]??=new Set()).add(fn);}removeEventListener(type,fn){this.listeners[type]?.delete(fn);}
  emit(type,extra={}){const event={type,target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};this['on'+type]?.(event);for(const fn of this.listeners[type]||[])fn(event);return event;}
  blocked(){for(let n=this;n;n=n.parentNode)if(n.inert)return true;return this.disabled;}
  click(){if(!this.blocked())this.emit('click');}focus(){if(!this.blocked())doc.activeElement=this;}select(){}blur(){this.emit('blur');}scrollIntoView(){}
  getBoundingClientRect(){return {left:0,top:0,right:600,bottom:700,width:600,height:700};}
  showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
  set innerHTML(html){this.replaceChildren();parse(this,html);}insertAdjacentHTML(where,html){const fragment=new Node('fragment');parse(fragment,html);if(where==='afterbegin')for(const n of [...fragment.childNodes].reverse())this.prepend(n);else this.append(...fragment.childNodes);}
 }
 function parse(root,html){const stack=[root],voids=new Set(['INPUT','IMG','BR','HR','META','LINK']);for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){stack.pop();continue;}if(token.startsWith('<')){const m=token.match(/^<([\w-]+)/);if(!m)continue;const n=new Node(m[1]);for(const a of token.slice(m[0].length).matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))n.setAttribute(a[1],a[2]??a[3]??a[4]??'');stack.at(-1).append(n);if(!voids.has(n.tagName)&&!token.endsWith('/>'))stack.push(n);}else if(token.trim())stack.at(-1).append(new Node('#text',3,token));}}
 doc={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',3,text),activeElement:null,defaultView:{}};doc.body=new Node('body');doc.activeElement=doc.body;return doc;
}
async function fixture(t,{builtin=false}={}){
 const previous=new Map();for(const [key,value]of Object.entries({cancelAnimationFrame(){},requestAnimationFrame:()=>1})){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 const doc=documentFixture(),requests=[],opened=[],reports=[],records=new Map(),gates=[],thinkingCalls=[];let next=1,thinkingGate=null;
 const original={id:'one',name:'Original',description:'bio',model_id:'m1',prompt:'original prompt',prompt_hash:'hash-original',tools:[],sessions:[{id:'s1'}],...(builtin?{builtin:'cota'}:{})};records.set('one',original);
 const role=()=>({ok:true,name:records.get('one').name,description:'bio',model_id:'m1',profile_version:'profile-v1',model_version:'model-v1',prompts:[{id:'self',title:'人格与沟通',text:records.get('one').prompt,version:'prompt-v1'}]});
 const write=async(kind,args)=>{requests.push({kind,args:structuredClone(args)});const gate=gates.shift();if(gate)await gate.promise;if(kind==='create'){const c={id:'new'+next++,sessions:[{id:'new-session'}],...args,prompt:args.prompt_text,prompt_hash:'new-hash'};records.set(c.id,c);return c;}const c=records.get(args.id||'one');Object.assign(c,args);if(args.prompt_text!==undefined)c.prompt=args.prompt_text;if(args.prompts?.length)c.prompt=args.prompts[0].text;return kind==='builtin'?role():c;};
 const store={models:async()=>[{id:'m1',name:'One'},{id:'m2',name:'Two'}],detail:async id=>structuredClone(records.get(id)),avatar:()=>'',refresh:async()=>{},update:p=>write('update',p),create:p=>write('create',p)};
 const api={builtinRole:async p=>p.action==='read'?role():write('builtin',p),onboard:async p=>{if(p.op==='view')return {models:[{id:'m1',kind:'chat'},{id:'m2',kind:'chat'}]};thinkingCalls.push(structuredClone(p));if(thinkingGate){const gate=thinkingGate;thinkingGate=null;await gate.promise;}return {thinking:{key:'reasoning_effort',value:p.value||'',values:['low','high']},patch:p.value?{reasoning_effort:p.value}:{}};}};
 const {setupContactEditor}=await import('../ui/contacts.mjs');const editor=setupContactEditor({doc,store,api,report:e=>reports.push(e.message||String(e)),openSession:async id=>opened.push(id),remove:async()=>false});
 t.after(()=>{editor.close();for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 const dialog=doc.body.querySelector('.contact-editor'),q=s=>dialog.querySelector(s),input=(s,value)=>{const n=q(s);if(n.blocked()||n.readOnly)return false;n.value=value;n.emit('input');return true;};
 return {doc,editor,dialog,q,input,requests,records,opened,reports,thinkingCalls,hold(){const gate=deferred();gates.push(gate);return gate;},holdThinking(){return thinkingGate=deferred();},async open(id='one'){await editor.open(id);await settle();},save(){q('.ce-save').click();return settle();}};
}

for(const kind of ['existing','new','builtin'])test('contact '+kind+' save locks real edit controls until its receipt and reopens the submitted values',async t=>{
 const f=await fixture(t,{builtin:kind==='builtin'});await f.open(kind==='new'?null:'one');f.input('.ce-name','Submitted');f.input('.ce-prompt','submitted prompt');const gate=f.hold();await f.save();
 const edited=f.input('.ce-name','late name'),promptEdited=f.input('.ce-prompt','late prompt'),bioEdited=f.input('.ce-bio','late bio');f.q('.ce-model').click();const menuOpened=!f.q('.ce-menu').hidden;
 f.q('.ce-save').click();f.dialog.emit('keydown',{ctrlKey:true,key:'s'});await settle();gate.resolve();await settle();
 assert.equal(edited,false,'save accepted a later name edit then closed it');assert.equal(promptEdited,false,'save accepted a later prompt edit then closed it');assert.equal(bioEdited,false);assert.equal(menuOpened,false,'model selection must stay locked');assert.equal(f.requests.length,1,'double submission cannot create/update twice');assert.equal(f.dialog.open,false);
 const id=kind==='new'?[...f.records.keys()].find(k=>k!=='one'):'one';assert.equal(f.records.get(id).name,'Submitted');await f.open(id);assert.equal(f.q('.ce-name').value,'Submitted');assert.equal(f.q('.ce-prompt').value,'submitted prompt');assert.equal(f.q('.ce-name').readOnly,false);assert.equal(f.q('.ce-save').disabled,false);assert.equal(f.q('.ce-close').disabled,false);
});

test('contact failed save retains its submitted draft, unlocks editing and permits a single retry',async t=>{
 const f=await fixture(t);await f.open(null);f.input('.ce-name','Retry draft');f.input('.ce-prompt','keep prompt');const gate=f.hold();await f.save();assert.equal(f.input('.ce-prompt','discarded late edit'),false);
 gate.reject(Error('write failed'));await settle();assert.equal(f.dialog.open,true);assert.equal(f.q('.ce-name').value,'Retry draft');assert.equal(f.q('.ce-prompt').value,'keep prompt');assert.match(f.q('.ce-error').textContent,/write failed/);assert.equal(f.q('.ce-save').disabled,false);assert.equal(f.input('.ce-name','Retried'),true);
 await f.save();assert.equal(f.requests.length,2);assert.equal([...f.records.keys()].filter(k=>k!=='one').length,1);assert.equal(f.dialog.open,false);
});

for(const kind of ['existing','new','builtin'])for(const failure of [false,true])test('leaving an accepted '+kind+' contact save '+(failure?'failure':'success')+' cannot lock or close a newer editor',async t=>{
 const f=await fixture(t,{builtin:kind==='builtin'});await f.open(kind==='new'?null:'one');f.input('.ce-name','Accepted save');const gate=f.hold();await f.save();assert.equal(f.q('.ce-cancel').disabled,false);f.q('.ce-cancel').click();await settle();assert.equal(f.dialog.open,false);
 await f.open('one');assert.equal(f.input('.ce-name','New editor draft'),true);if(failure)gate.reject(Error('accepted save failed after leave'));else gate.resolve();await settle();
 assert.equal(f.dialog.open,true);assert.equal(f.q('.ce-name').value,'New editor draft');assert.equal(f.q('.ce-save').disabled,false);assert.equal(f.input('.ce-prompt','new editor prompt'),true);assert.deepEqual(f.reports,failure?['accepted save failed after leave']:[]);assert.deepEqual(f.opened,[]);assert.equal(f.requests.length,1);assert.equal([...f.records.keys()].filter(k=>k!=='one').length,kind==='new'&&!failure?1:0);
});

test('thinking controls arriving during a save inherit the editing lock and unlock after failure',async t=>{
 const f=await fixture(t),thinking=f.holdThinking();await f.open();f.input('.ce-name','Submitted');const gate=f.hold();await f.save();thinking.resolve();await settle();const low=f.q('.ce-think').children.find(n=>n.textContent==='低');assert(low);const before=f.thinkingCalls.length;low.click();await settle();assert.equal(f.thinkingCalls.length,before,'new controls cannot bypass the saving lock');
 gate.reject(Error('retry'));await settle();low.click();await settle();assert.equal(f.thinkingCalls.length,before+1);assert.equal(f.q('.ce-save').disabled,false);
});

test('contact tool removal and avatar controls stay locked and recover with the failed form',async t=>{
 const f=await fixture(t);
 await f.open();
 const manage=f.q('.ce-add'),menu=f.q('.ce-menu');
 const plan=()=>menu.children.find(node=>node.dataset.tool==='update_plan');
 manage.click();
 plan().click();
 await settle();
 assert.equal(plan().getAttribute('aria-selected'),'true');
 assert.equal(f.q('.ce-chips').querySelector('button'),null);

 const gate=f.hold();
 await f.save();
 manage.click();
 assert.equal(manage.disabled,true);
 assert.equal(menu.hidden,true);
 assert.equal(f.q('input[type=file]').disabled,true);
 assert.equal(f.q('.ce-avatar').disabled,true);
 assert.equal(f.q('.ce-delete').disabled,true);
 assert.deepEqual(f.requests[0].args.tools,['update_plan']);

 gate.reject(Error('tool retry'));
 await settle();
 assert.equal(f.q('.ce-avatar').disabled,false);
 manage.click();
 assert.equal(plan().getAttribute('aria-selected'),'true');
 plan().click();
 await settle();
 assert.equal(plan().getAttribute('aria-selected'),'false');
 assert(!f.q('.ce-chips').textContent.includes('计划'));
 await f.save();
 assert.equal(Object.hasOwn(f.requests[1].args,'tools'),false);
 assert.deepEqual(f.records.get('one').tools,[]);
});

test('an avatar file read begun before save cannot open a late crop or change the submitted form',async t=>{
 const f=await fixture(t),previous=new Map(['FileReader','Image'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let reader,reads=0,images=0;
 Object.defineProperty(globalThis,'FileReader',{configurable:true,value:class{readAsDataURL(){reader=this;reads++;}}});Object.defineProperty(globalThis,'Image',{configurable:true,value:class{constructor(){images++;throw Error('crop must not begin during save');}}});
 t.after(()=>{for(const [key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 await f.open();const file=f.q('input[type=file]');file.files=[{type:'image/png'}];file.onchange();await settle();assert.equal(reads,1);const gate=f.hold();await f.save();reader.result='data:image/png;base64,fixture';reader.onload();f.q('.ce-avatar').emit('drop',{dataTransfer:{files:[{type:'image/png'}]}});await settle();
 assert.equal(images,0);assert.equal(reads,1);assert.equal(f.q('.ce-error').textContent,'');gate.resolve();await settle();assert.equal(f.dialog.open,false);assert.equal(f.requests[0].args.avatar,undefined);
});
