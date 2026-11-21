// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/navigation-resume.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// OS 首页承载正在进行的独立会话：离开到其他页面再回 OS 首页，回到同一会话；
// 只有明确选中 Eyra 时才放下它。
const {test}=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const nodes=new Map();
 const node=id=>({id,dataset:{},hidden:false,classList:{add(){}},append(n){if(n?.id)nodes.set(n.id,n);},setAttribute(){},addEventListener(){},contains:()=>false});
 for(const id of ['screen','view-surface','view-content','view-title','home-button','conversation-view','settings-view','panel'])nodes.set(id,node(id));
 const doc={body:node('body'),activeElement:null,defaultView:{MutationObserver:class{observe(){}disconnect(){}},addEventListener(){},CustomEvent},
  createElement:()=>node(''),getElementById:id=>nodes.get(id),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}};
 const {setupNavigation}=await import('../ui/navigation.mjs');
 return {navigation:setupNavigation(doc),homeButton:nodes.get('home-button')};
}
test('returning to the OS home resumes the open conversation',async()=>{
 const {navigation,homeButton}=await fixture();
 navigation.open('conversation-view','电脑助手',{viewKey:'conversation:helper'});
 navigation.open('settings-view','设置');
 navigation.resume();
 assert.equal(navigation.is('conversation-view','conversation:helper'),true);
 navigation.open('panel','历史');homeButton.onclick();
 assert.equal(navigation.is('conversation-view','conversation:helper'),true);
});
test('choosing Eyra explicitly leaves the conversation',async()=>{
 const {navigation}=await fixture();
 navigation.open('conversation-view','电脑助手',{viewKey:'conversation:helper'});
 navigation.forgetChat();navigation.resume();
 assert.equal(navigation.current,'');
 navigation.open('settings-view','设置');navigation.resume();
 assert.equal(navigation.current,'','a later OS home stays on Eyra');
});
