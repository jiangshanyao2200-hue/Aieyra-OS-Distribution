// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/market-inventory.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('late market inventory cannot replace the revision bound to a visible package',async()=>{
 const pending=[],nodes=new Map(),opened=[];let pick;
 const element=(tag,cls,text)=>({tag,children:[],dataset:{},textContent:text,style:{setProperty(){}},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
 const source=fs.readFileSync(path.join(__dirname,'../ui/package-manager.mjs'),'utf8').replace(/^import .*\r?\n/gm,'');
 vm.runInNewContext(source,{$,el:element,setupShell(){},setupRail(_root,_items,choose){pick=choose;return{select(){}};},importMod(){},modDetail(item,revision){opened.push({id:item.manifest.id,revision});},say(){},setTimeout,clearTimeout,window:{aieyraApp:{}},call(request){
  if(request.action==='center_list')return Promise.resolve({items:[]});
  return new Promise(resolve=>pending.push({request,resolve}));
 }});
 pick('installed');
 const item={manifest:{schema:'aieyra.mod/1',id:'example.statistics',kind:'tool',name:'Statistics',version:'1.0.0'}};
 const finish=(offset,revision)=>{pending[offset].resolve({items:[]});pending[offset+1].resolve({revision,items:[item]});};
 finish(2,2);await new Promise(setImmediate);
 const visible=$('grid').children[0];visible.onclick();assert.equal(opened[0].revision,2);
 finish(0,1);await new Promise(setImmediate);
 assert.equal($('grid').children[0],visible,'obsolete response replaced the visible list');
 visible.onclick();assert.equal(opened[1].revision,2,'old response changed the mutation precondition of an already rendered package');
});
