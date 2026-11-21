// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/milestone-audit.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProfileStore}=require('../host/profile.cjs');
test('damaged or oversized optional profile cannot block startup or overwrite original',(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-audit-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'companion-profile.json'),store=createProfileStore(path.join(dir,'config.json'));
 for(const input of ['{bad json', 'null', 'x'.repeat(200001)]){
  fs.writeFileSync(file,input);const p=store.read();assert.equal(p.name,'');assert.equal(p.avatar,'');assert.equal(p.initialized,true);assert.ok(p.warning);assert.equal(fs.readFileSync(file,'utf8'),input);
 }
});

test('prompt save completion preserves newer draft and status; reload locks editor',(t)=>new Promise(async(resolve,reject)=>{
 try{
  const nodes=new Map(),node=()=>({value:'',textContent:'',disabled:false,classList:{add(){}},insertAdjacentHTML(){},children:[],dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v},replaceChildren(...c){this.children=c},append(...c){this.children.push(...c)},querySelector(s){return this.children.find(n=>String(n.className||'').split(' ').includes(s.slice(1)))},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){this['on'+k]=f}});
  global.document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node};t.after(()=>delete global.document);
  // 提示词在区域显示出来时才读取（设置页统一管理分页会改写页签 onclick，不能依赖它）。
  let shown;global.MutationObserver=class{constructor(f){shown=f;}observe(){}};t.after(()=>delete global.MutationObserver);
  document.getElementById('prompt-settings').hidden=true;
  let finishSave,finishLoad;const a={id:'self',title:'人格与沟通',text:'原文',version:'v1',exists:true};
  const api={profile:async()=>({profile:{}}),builtinRole:p=>new Promise(r=>{if(p.action==='read')finishLoad=r;else finishSave=r;})};
  const {setupPromptSettings}=await import('../ui/prompts.mjs');setupPromptSettings(api,x=>x);
  const $=id=>document.getElementById(id);assert.equal($('prompt-editor').disabled,false,'hidden section does not load');
  $('prompt-settings').hidden=false;shown();assert.equal($('prompt-editor').disabled,true);
  finishLoad({prompt_directory:'fixture',profile_version:'p1',prompts:[a]});await new Promise(r=>setImmediate(r));assert.equal($('prompt-editor').disabled,false);
  $('prompt-editor').value='保存版本';$('prompt-editor').oninput();const saving=$('save-prompt').onclick();
  finishLoad({prompt_directory:'fixture',profile_version:'p1',prompts:[a]});
  await new Promise(r=>setImmediate(r));
  $('prompt-editor').value='保存之后继续编辑';$('prompt-editor').oninput();finishSave({profile_version:'p1',prompts:[{...a,text:'保存版本',version:'v2'}]});await saving;
  assert.equal($('prompt-editor').value,'保存之后继续编辑');assert.match($('prompt-status').textContent,/尚未保存/);
  $('prompt-editor').value='保存版本';$('prompt-editor').oninput();assert.doesNotMatch($('prompt-status').textContent,/尚未保存/);resolve();
 }catch(e){reject(e)}
}));

test('large activity history stays bounded and never revives completed tools',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs');const p=new WorkspacePresentation();
 for(let start=0;start<10000;start+=100){const items=Array.from({length:100},(_,n)=>({id:String(start+n),tool:'exec_command',state:'completed',generation:1,revision:1,preview:{output:'x'.repeat(120)}}));p.ingest({roles:[{id:'matrix',role:'matrix',generation:1,state:'running',activity:{items}}]});}
 assert.equal(p.items.size,4096);assert.equal(p.order.length,4096);assert.equal(p.terminal().length,4096);assert.ok(p.terminal().every(x=>x.state==='completed'));assert.equal(p.history().length,10);
 p.ingest({roles:[{id:'matrix',role:'matrix',generation:2,state:'completed',activity:{items:[]}}]});assert.equal(p.current().length,0);assert.equal(p.terminal().length,0);
});
