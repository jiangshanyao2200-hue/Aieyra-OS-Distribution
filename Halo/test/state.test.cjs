// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test; surface
// Impact: python -B scripts/code-atlas.py show Halo/test/state.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {paintHaloState}=require('../official/instrument.mjs');
const {haloState}=require('../official/effects.mjs');
const surface=()=>{const code={textContent:''};return {dataset:{ringEffect:'wave',haloCustom:'author.theme'},querySelector:()=>code,code};};
test('complete Halo state belongs to an instance and does not overwrite its selected style',()=>{
 const a=surface(),b=surface();
 paintHaloState(a,'tool','terminal',{now:0});paintHaloState(b,'thinking','generic',{now:0});
 assert.equal(a.dataset.effect,'terminal');assert.equal(a.dataset.ringEffect,'wave');assert.equal(a.dataset.haloCustom,'author.theme');
 const first=a.code.textContent;paintHaloState(a,'tool','terminal',{now:180});assert.notEqual(a.code.textContent,first);
 paintHaloState(a,'waiting','generic',{now:300});assert.equal(a.dataset.carry,'true');assert.equal(a.dataset.effect,'terminal');
 paintHaloState(a,'waiting','generic',{now:5300});assert.equal(a.dataset.longWait,'true');assert.equal(b.dataset.longWait,'false');
 paintHaloState(a,'idle','generic',{now:5400});assert.equal(a.dataset.longWait,'false');assert.equal(a.dataset.recent,'');assert.equal(a.dataset.carry,'false');
});
test('failed and waiting members keep their actual state; reduced terminal motion is stable',()=>{
 for(const state of ['failed','timed_out','interrupted','persistence_failed'])assert.equal(haloState(state),'error');
 assert.equal(haloState('waiting_user'),'waiting_user');assert.equal(haloState('replying'),'body');assert.equal(haloState('completed'),'idle');
 const a=surface();paintHaloState(a,'tool','terminal',{now:0,reduced:true});const first=a.code.textContent;paintHaloState(a,'tool','terminal',{now:9180,reduced:true});assert.equal(a.code.textContent,first);
});
