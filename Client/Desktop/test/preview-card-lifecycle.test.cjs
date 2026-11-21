// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; tick
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/preview-card-lifecycle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
function fixture(){
 const decodes=[];
 const doc={createElement(tag){return {tag,ownerDocument:doc,dataset:{},style:{setProperty(){}},children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},querySelector(selector){for(const n of this.children){if(n.tag===selector)return n;const child=n.querySelector(selector);if(child)return child;}return null;},getAttribute(key){return this[key]??null;},decode(){return new Promise((resolve,reject)=>decodes.push({resolve,reject,node:this}));}};}};
 return {host:doc.createElement('div'),decodes};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('preview reuses the decoded image and rejects a delayed frame after returning to the current frame',async()=>{
 const {renderPreviewCard}=await import('../ui/preview-card.mjs'),{host,decodes}=fixture();
 const frame=url=>({title:'设置',width:1280,height:800,url:'data:image/png;base64,'+url});
 renderPreviewCard(host,frame('AAAA'));decodes[0].resolve();await tick();
 const image=host.querySelector('img'),head=host.querySelector('header');
 renderPreviewCard(host,frame('BBBB'));renderPreviewCard(host,frame('BBBB'));
 assert.equal(decodes.length,2,'unchanged pending frames share one decode');
 renderPreviewCard(host,frame('AAAA'));decodes[1].resolve();await tick();
 assert.equal(image.src,frame('AAAA').url,'late B cannot overwrite the newer request for A');
 assert.strictEqual(host.querySelector('img'),image);assert.strictEqual(host.querySelector('header'),head);
 renderPreviewCard(host,frame('CCCC'));decodes[2].reject(Error('invalid bitmap'));await tick();
 assert.equal(image.src,frame('AAAA').url,'failed decode preserves the visible bitmap');
 renderPreviewCard(host,frame('CCCC'));assert.equal(decodes.length,4,'failed capture can retry');
 decodes[3].resolve();await tick();assert.equal(image.src,frame('CCCC').url);
});
