// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; contact; eyra; fakeDom; ringFactory
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/dock-agents.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../ui/dock-agents.mjs');
const contact=(program,state,extra={})=>({id:'c-'+program,program,name:program+' agent',ring:'orbit',sessions:[{id:'s-'+program,state}],...extra});
const eyra={role:'matrix',name:'Eyra',avatar:'',ring:'pulse',glyph:''};

function fakeDom(ids){
 const timers=new Map();let serial=0;
 const button=id=>{const attrs=new Map(),children=[];return {id,dataset:{},children,append(n){children.push(n);n.parent=this;n.isConnected=true;},getAttribute:k=>attrs.has(k)?attrs.get(k):null,setAttribute:(k,v)=>attrs.set(k,String(v)),removeAttribute:k=>attrs.delete(k)};};
 const buttons=new Map(ids.map(id=>[id,button(id)])),listeners=new Map();
 const win={setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),matchMedia:()=>({matches:false})};
 const doc={hidden:false,defaultView:win,body:{classList:{contains:()=>false}},getElementById:id=>buttons.get(id)||null,addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 const flush=()=>{for(const [id,t] of [...timers]){timers.delete(id);t.fn();}};
 return {doc,buttons,timers,flush,listeners};
}
const ringFactory=log=>({
 createRing:(identity,options)=>{const ring={identity,state:options.state,classes:[],attrs:{},isConnected:false,offsetWidth:0,classList:{add:c=>ring.classes.push(c)},setAttribute:(k,v)=>{ring.attrs[k]=v;},remove(){ring.isConnected=false;const list=ring.parent.children;list.splice(list.indexOf(ring),1);}};log.push(['create',identity.name]);return ring;},
 paintRing:(ring,identity,state)=>{ring.identity=identity;ring.state=state;log.push(['paint',identity.name]);},
});

test('only programs whose agent is really working get a face; idle, waiting and failed do not',async()=>{
 const {dockFaces}=await load();
 const faces=dockFaces({contacts:[contact('browser','running'),contact('servers','idle'),contact('link','waiting_user'),contact('market','failed'),contact('settings','queued'),{id:'p',name:'someone',sessions:[{state:'running'}]}],avatar:id=>id==='c-browser'?'data:image/png;base64,AA':''});
 assert.deepEqual([...faces.keys()].sort(),['browser','settings']);
 assert.equal(faces.get('browser').identity.avatar,'data:image/png;base64,AA');assert.equal(faces.get('browser').identity.name,'browser agent');
});

test('workspace drawing counts as work even when its session is idle',async()=>{
 const {dockFaces}=await load();
 assert.ok(dockFaces({contacts:[contact('workspace','idle',{program_activity:{active:true}})]}).has('workspace'));
 assert.ok(!dockFaces({contacts:[contact('workspace','idle',{program_activity:{active:false}})]}).has('workspace'));
});

test('Coding shows the host Cota when Cota works, otherwise the member that is working',async()=>{
 const {dockFaces}=await load();
 const members=(cota,vaya)=>({members:[{role:'cota',name:'Cota',contact_id:'cota',ring:'pulse',state:cota},{role:'vaya',name:'Vaya',contact_id:'vaya',ring:'pulse',state:vaya}]});
 assert.equal(dockFaces({coding:members('running','running')}).get('coding').identity.name,'Cota');
 const vaya=dockFaces({coding:members('idle','running')}).get('coding');
 assert.equal(vaya.identity.name,'Vaya');assert.equal(vaya.identity.role,'project');
 assert.ok(!dockFaces({coding:members('idle','completed')}).has('coding'));
 assert.ok(!dockFaces({coding:null}).has('coding'));assert.ok(!dockFaces({coding:{members:'broken'}}).has('coding'));
});

test('home follows the real Eyra state: working states show, idle, waiting for the user and errors do not',async()=>{
 const {dockFaces}=await load();
 for(const state of ['thinking','tool','preparing','body','waiting','compacting','cancelling'])assert.ok(dockFaces({home:{state,identity:eyra}}).has('home'),state);
 for(const state of ['idle','waiting_user','error','offline','queued','confirming'])assert.ok(!dockFaces({home:{state,identity:eyra}}).has('home'),state);
 assert.equal(dockFaces({home:{state:'thinking',identity:eyra}}).get('home').state,'thinking');
 assert.equal(dockFaces({home:{state:'preparing',identity:eyra}}).get('home').state,'working','states the ring does not know still animate');
 assert.ok(!dockFaces({home:{state:'thinking'}}).has('home'));
});

test('the ring is mounted inside the button, repainted in place, and fades back before removal',async()=>{
 const {setupDockAgents,DOCK_AGENT}=await load(),dom=fakeDom(['dock-home','browser-bubble']),log=[];
 const api={conversation:async()=>{throw Error('coding is not asked for without its button');}};
 const dock=setupDockAgents(api,{doc:dom.doc,...ringFactory(log)});
 const home=dom.buttons.get('dock-home');
 dock.home({state:'thinking',identity:eyra});
 assert.equal(home.dataset.agentFace,'true');assert.equal(home.children.length,1);assert.deepEqual(home.children[0].classes,['dock-agent']);assert.equal(home.children[0].attrs['aria-hidden'],'true');
 assert.equal(home.getAttribute('aria-description'),'Eyra · 工作中');
 dock.home({state:'thinking',identity:{...eyra}});assert.equal(log.length,1,'an unchanged state does not repaint');
 dock.home({state:'tool',identity:eyra});assert.deepEqual(log.at(-1),['paint','Eyra']);assert.equal(home.children.length,1,'the same ring is reused');
 dock.home({state:'idle',identity:eyra});
 assert.equal(home.dataset.agentFace,'leaving');assert.equal(home.children.length,1,'the ring stays while it fades');assert.equal(home.getAttribute('aria-description'),null);
 assert.equal([...dom.timers.values()][0].ms,DOCK_AGENT.leaveMs);
 dock.home({state:'body',identity:eyra});assert.equal(home.dataset.agentFace,'true','work resuming during the fade keeps the ring');assert.equal(dom.timers.size,0);
 dock.home({state:'idle',identity:eyra});dom.flush();
 assert.equal(home.children.length,0);assert.equal('agentFace' in home.dataset,false);
 dock.close();assert.equal(dom.listeners.size,0);
});

test('program contacts come from the store and Coding is read without opening it',async()=>{
 const {setupDockAgents}=await load(),dom=fakeDom(['browser-bubble','dock-coding']),log=[],calls=[];
 let rows=[contact('browser','running')],listener=null;
 const store={get contacts(){return rows;},avatar:()=>'',subscribe(fn){listener=fn;fn(rows);return ()=>{listener=null;};}};
 const api={conversation:async p=>{calls.push(p);return {ok:true,binding:{members:[{role:'cota',name:'Cota',contact_id:'cota',state:'running'}]}};}};
 const dock=setupDockAgents(api,{doc:dom.doc,...ringFactory(log)});
 dock.connectStore(store);
 assert.equal(dom.buttons.get('browser-bubble').dataset.agentFace,'true');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[{action:'program',program:'coding'}],'the read-only action, never program_open');
 assert.equal(dom.buttons.get('dock-coding').dataset.agentFace,'true');assert.equal(dom.buttons.get('dock-coding').getAttribute('aria-description'),'Cota · 工作中');
 rows=[contact('browser','idle')];listener(rows);
 assert.equal(dom.buttons.get('browser-bubble').dataset.agentFace,'leaving');
 dock.close();assert.equal(listener,null);
});

test('a failing Coding read shows nothing, backs off and never throws',async()=>{
 const {setupDockAgents,DOCK_AGENT}=await load(),dom=fakeDom(['dock-coding']);
 const dock=setupDockAgents({conversation:async()=>({ok:false,error:'Coding 协作已关闭'})},{doc:dom.doc,...ringFactory([])});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(dom.buttons.get('dock-coding').children.length,0);
 assert.deepEqual([...dom.timers.values()].map(t=>t.ms),[DOCK_AGENT.codingErrorMs]);
 dock.close();
});
