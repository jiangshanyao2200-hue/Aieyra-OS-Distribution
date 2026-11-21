// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: deferred; settle; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/extension-state.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
 const nodes=new Map(),callbacks={},renders=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,textContent:'',hidden:false,dataset:{},classList:{add(){}},replaceChildren(){}});return nodes.get(id);};
 const doc={getElementById:node,body:{dataset:{}},addEventListener(){}};
 const describe=deferred(),api={describe:()=>describe.promise,frame:async()=>({status:'loading'}),appearance:async()=>({ok:true,settings:{},fields:[]})};
 for(const [method,name]of [['onState','state'],['onFrame','frame'],['onVisibility','visibility'],['onSettingsChanged','settings']])api[method]=fn=>{callbacks[name]=fn;return ()=>{};};
 for(const method of ['hide','release','minimizeWindow','focusMain','dock','detach'])api[method]=async()=>({ok:true});
 const source=fs.readFileSync(path.join(__dirname,'../ui/extension.mjs'),'utf8').replace(/^import .*\r?\n/gm,'');
 const running=vm.runInNewContext('(async()=>{'+source+'\n})()',{
  window:{aieyraExtension:api,addEventListener(){}},document:doc,
  setupAgentView:()=>({paint(){},setVisible(){}}),renderMarkdown(){},renderHTML(){},planModel:p=>p,renderPlanPage:(_node,p)=>renders.push(p),subscribeWindowTheme:()=>({refresh:async()=>{},close(){}}),console
 });
 return {node,callbacks,describe,running,renders};
}
test('a frame arriving before describe is buffered until the extension is initialized',async()=>{
 const f=fixture();assert.doesNotThrow(()=>f.callbacks.frame({status:'loading'}));f.callbacks.visibility({visible:false});
 f.describe.resolve({ok:true,kind:'plan',title:'计划',placement:'attached'});await f.running;
 f.callbacks.frame({status:'ready',projection:{plan:{summary:'隐藏时收到'}}});assert.equal(f.renders.length,0);
 f.callbacks.visibility({visible:true});assert.equal(f.renders.length,1);assert.equal(f.renders[0].summary,'隐藏时收到');
});
test('plan loading, read failure and recovery with unchanged content remain distinguishable',async()=>{
 const f=fixture();f.describe.resolve({ok:true,kind:'plan',title:'计划',placement:'attached'});await f.running;
 f.callbacks.frame({status:'loading'});assert.equal(f.node('extension-content').textContent,'计划正在更新…');
 f.callbacks.frame({status:'error',error:'隔离读取失败'});assert.equal(f.node('extension-error').hidden,false);assert.equal(f.node('extension-error').textContent,'隔离读取失败');
 const plan={summary:'相同计划'};f.callbacks.frame({status:'ready',projection:{plan}});assert.equal(f.node('extension-error').hidden,true);
 f.callbacks.frame({status:'error',error:'再次失败',projection:{plan}});assert.equal(f.node('extension-error').hidden,false);
 f.callbacks.frame({status:'ready',projection:{plan}});assert.equal(f.node('extension-error').hidden,true);
 await settle();
});
