'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('independent Tool transcript rejects foreign pages and Core restart clears retained output',async()=>{
 const {TerminalTranscript}=await import('./desktop.mjs');
 const scope={task_id:'task',agent_id:'operator',generation:1};
 const snapshot={core_epoch:'first',session_id:'task',roles:[{id:'operator',role:'matrix',generation:1,activity:{items:[]}}]};
 const transcript=new TerminalTranscript({name:'Operator'});transcript.bind(snapshot,scope);
 transcript.setSessions([{session_id:3,generation:1,state:'running',description:'child'}]);
 transcript.ingest({...snapshot,roles:[{...snapshot.roles[0],activity:{items:[{tool:'exec_command',generation:1,agent:'operator',command:'child',preview:JSON.stringify({session_id:3,generation:1,state:'running'})}]}}]});
 const request={...scope,session_id:3,session_generation:1,offset:0,terminal:false};
 const response={ok:true,...scope,result:{ok:true,session_id:3,generation:1,state:'running',output:'local 中文',next_offset:12,logged_bytes:12}};
 assert.throws(()=>transcript.applyPage(request,{...response,agent_id:'another'}),/所属任务/);
 assert.equal(transcript.applyPage(request,response),true);
 assert.match(transcript.segments().map(s=>s.text).join(''),/local 中文/);
 transcript.bind({...snapshot,core_epoch:'second'},scope);
 assert.equal(transcript.sessions.length,0);
 assert.doesNotMatch(transcript.segments().map(s=>s.text).join(''),/local 中文/);
});

test('tool viewer does not load the vendor or poll before mounting and close releases ownership',async()=>{
 const {createTerminalView}=await import('./desktop.mjs');
 const listeners=new Map(),timers=new Set(),observers=[];
 class Node{constructor(){this.children=[];this.dataset={};this.isConnected=false;}append(...nodes){this.children.push(...nodes);}setAttribute(){}getBoundingClientRect(){return {width:0,height:0};}closest(){return null;}addEventListener(k,v){listeners.set(k,v);}removeEventListener(k){listeners.delete(k);}replaceChildren(){this.children=[];}dispatchEvent(){}}
 class Observer{constructor(){observers.push(this);}observe(){}disconnect(){this.closed=true;}}
 const win={ResizeObserver:Observer,MutationObserver:Observer,CustomEvent:class{},setInterval(fn){timers.add(fn);return fn;},clearInterval(fn){timers.delete(fn);},setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);}};
 const doc={defaultView:win,createElement:()=>new Node(),head:new Node(),body:{classList:{contains:()=>false}},querySelector:()=>null,addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 let loads=0,reads=0;
 const view=createTerminalView({doc,loadTerminal:()=>{loads++;throw Error('must remain lazy');},openTerminal(){throw Error('unmounted');},api:{terminals(){reads++;},terminalRead(){reads++;}},scope:{task_id:'task',agent_id:'a',generation:1}});
 view.update({core_epoch:'one'});view.suspend();view.close();view.close();view.update({core_epoch:'two'});
 assert.equal(loads,0);assert.equal(reads,0);assert.equal(listeners.size,0);assert.equal(timers.size,0);assert.ok(observers.every(o=>o.closed));
});
