// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-capabilities.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {requestCore,supportsWorkspaceAction}=require('../host/bridge.cjs');
test('optional conversation API checks the running core before any HTTP request',async t=>{
 let requests=0,unknown=false;
 const server=http.createServer((req,res)=>{requests++;res.setHeader('Content-Type','application/json');res.statusCode=unknown?400:200;res.end(JSON.stringify(unknown?{ok:false,error:'unknown workspace action'}:{ok:true,data:[]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const descriptor={url:'http://127.0.0.1:'+server.address().port+'/v1/rpc',token:'a'.repeat(64),version:'0.2.36'};
 await assert.rejects(requestCore(descriptor,'workspace.conversation',{action:'list'}),e=>e.code==='core_update_required'&&e.message.includes('更新'));
 assert.equal(requests,0,'older core never receives the unknown action');
 await requestCore(descriptor,'workspace.snapshot');assert.equal(requests,1,'existing APIs remain usable');
 assert.deepEqual(await requestCore({...descriptor,version:'0.2.38'},'workspace.conversation'),[]);
 assert.equal(supportsWorkspaceAction({...descriptor,version:'1.0.0',capabilities:[]},'workspace.conversation'),false,'explicit capability list is authoritative');
 assert.equal(supportsWorkspaceAction({...descriptor,capabilities:['workspace.conversation']},'workspace.conversation'),true);
 assert.equal(supportsWorkspaceAction({...descriptor,version:''},'workspace.conversation'),false);
 unknown=true;
 await assert.rejects(requestCore({...descriptor,version:'0.2.38'},'workspace.conversation'),e=>e.code==='core_update_required'&&!e.message.includes('unknown workspace action'));
});

test('conversation surface follows navigation and modals without a duplicate polling loop',async()=>{
 const {setupConversationSurface}=await import('../ui/conversation-surface.mjs');
 const handlers=new Map(),frames=new Map(),surfaces=[],viewKeys=[];let frame=0,current='',modal=false,nav,state,disconnected=false,queries=0;
 const win={requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{observe(){}disconnect(){disconnected=true;}},addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n)};
 const host={getBoundingClientRect:()=>({x:12,y:48,width:800,height:600})};
 const doc={defaultView:win,hidden:false,body:{dataset:{}},getElementById:()=>host,querySelector:()=>modal,addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n)};
 const api={conversation:()=>{queries++;},extensionSurface:async p=>{surfaces.push(p);return {ok:true};},onNavigate:f=>{nav=f;return ()=>nav=null;},onExtensionState:f=>{state=f;return ()=>state=null;}};
 const navigation={is:id=>current===id,open:(id,title,{viewKey=id}={})=>{current=id;viewKeys.push(viewKey);},home:()=>{current='';handlers.get('workspace-view-change')?.();},title(){}};
 const hostView=setupConversationSurface(api,navigation,{doc});
 const flush=async()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn();}for(let i=0;i<5;i++)await Promise.resolve();};
 assert.equal(queries,0);assert.equal(surfaces.length,0);
 nav({page:'conversation:first'});await flush();assert.equal(surfaces.at(-1).visible,true);assert.deepEqual(surfaces.at(-1).bounds,{x:12,y:48,width:800,height:600});
 modal=true;handlers.get('workspace-modal-change')();await flush();assert.equal(surfaces.at(-1).visible,false);
 modal=false;handlers.get('workspace-modal-change')();await flush();assert.equal(surfaces.at(-1).visible,true);
 nav({page:'conversation:second'});await flush();assert.ok(surfaces.some(x=>x.key==='conversation:first'&&x.visible===false));assert.equal(doc.body.dataset.conversationId,'second');
 assert.deepEqual(viewKeys,['conversation:first','conversation:second'],'each conversation must trigger navigation observers, including titlebar accounting and sidebar selection');
 state({kind:'conversation',agent_id:'second',placement:'detached'});await flush();assert.equal(current,'');assert.equal(surfaces.at(-1).visible,false);
 hostView.close();await flush();assert.equal(disconnected,true);assert.equal(handlers.size,0);assert.equal(nav,null);assert.equal(state,null);assert.equal(queries,0);
});
