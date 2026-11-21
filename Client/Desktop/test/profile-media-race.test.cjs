// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/profile-media-race.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const nodes=new Map(),menus=new Map(),waiting=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',children:[],dataset:{},style:{setProperty(){}},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(){},querySelector(){return null;},closest(){return node(id+'-card');}});return nodes.get(id);};
 const context={document:{getElementById:node},structuredClone,Date,bindTidyRange:()=>()=>{},rotationControl:()=>({paint(){},close(){}}),mediaMenu:(anchor,handlers)=>{menus.set(anchor.id,handlers);return {close(){}};},cropImage:async value=>value,pickTheme:()=>{}};
 vm.createContext(context);const source=fs.readFileSync(path.join(__dirname,'../ui/profile-media.mjs'),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
 vm.runInContext(source,context);
 const api={themeLibrary:()=>new Promise(resolve=>waiting.push(resolve))},controller=context.setupProfileMedia(api,x=>x,{notice(){}});
 controller.load({avatar:'old-avatar',background:'old-background'});return {node,menus,waiting,controller,value:()=>context.profileMedia()};
}
test('removing an avatar or background wins over a pending random preparation',async()=>{
 for(const target of ['avatar','background']){
  const f=fixture(),pending=target==='avatar'?f.menus.get('avatar-user-source').random():f.node('background-random').onclick();
  if(target==='avatar')f.menus.get('avatar-user-source').remove();else f.node('background-clear').onclick();
  f.waiting[0]({value:'late-image',rotation:{mode:'random',intervalSeconds:60,nextAt:1000}});await pending;
  assert.equal(f.value()[target],'');assert.equal(f.value().mediaRotation[target].mode,'off');f.controller.close();
 }
});
test('the last requested selection owns the draft when random downloads finish out of order',async()=>{
 const f=fixture(),first=f.menus.get('avatar-user-source').random(),second=f.menus.get('avatar-user-source').random();
 f.waiting[1]({value:'newer',rotation:{mode:'random',intervalSeconds:60,nextAt:2000}});await second;
 f.waiting[0]({value:'older',rotation:{mode:'random',intervalSeconds:60,nextAt:1000}});await first;
 assert.equal(f.value().avatar,'newer');assert.equal(f.value().mediaRotation.avatar.nextAt,2000);f.controller.close();
});
