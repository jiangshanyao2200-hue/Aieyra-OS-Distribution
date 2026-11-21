// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/program-agent-window.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
const {programShellCall}=require('../host/program-agent-overlay.cjs');
test('actual main preload exposes the same session attachment route as the detached program shell',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),calls=[];let api;
 vm.runInNewContext(fs.readFileSync(require.resolve('../host/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer:{invoke:async(channel,args)=>{calls.push({channel,args});return {ok:true};}},webUtils:{}})});
 await api.conversationAttachment({id:'owned',method:'attachmentState'});
 assert.equal(calls[0].channel,'workspace:conversationAttachment');assert.equal(calls[0].args.id,'owned');
});
test('detached program binds every composer, attachment and model call to its persistent session',async()=>{
 const calls=[],target={isDestroyed:()=>false},record={kind:'workspace',placement:'detached',window:{host:target}};
 const invoke=async(method,args)=>{calls.push({method,args});if(args.action==='program')return {ok:true,contact:{id:'canvas-contact'},session:{id:'canvas-session'}};return {ok:true};};
 const call=(method,args)=>programShellCall({record,args:{method,args},invoke});
 await call('conversation',{action:'send',id:'canvas-session',message:'画布输入',request_id:'once'});
 assert.equal(calls.at(-1).args.id,'canvas-session');
 for(const [method,args]of [['conversation',{action:'send',id:'mother'}],['conversationAttachment',{id:'mother',method:'stageFileBytes'}],['sessionModel',{id:'canvas-session',target:'mother'}],['conversation',{action:'contact_update'}],['onboard',{action:'pool',op:'save'}]])await assert.rejects(call(method,args));
 assert.equal(calls.filter(c=>c.args.action==='send').length,1);
 record.window.host=null;await assert.rejects(call('conversation',{action:'snapshot'}),/放回/);
});
test('a late program binding cannot mutate a window after docking',async()=>{
 let resolve;const target={isDestroyed:()=>false},record={kind:'settings',placement:'detached',window:{host:target}};
 const result=programShellCall({record,args:{method:'sessionModel',args:{id:'settings-session'}},invoke:()=>new Promise(r=>resolve=r)});
 record.window.host=null;resolve({contact:{id:'settings-contact'},session:{id:'settings-session'}});await assert.rejects(result,/关闭/);
});
