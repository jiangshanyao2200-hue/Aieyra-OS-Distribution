// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/mod-import-lifecycle.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url');
test('a native picker completing after the settings page changed cannot reopen a package dialog',async t=>{
 const key='__extensionPickerTest',calls=[],notices=[];let finish,current=true;
 globalThis[key]={call:p=>{calls.push(p);return new Promise(resolve=>{finish=resolve;});},say:(...p)=>notices.push(p)};
 t.after(()=>delete globalThis[key]);
 const url=pathToFileURL(require.resolve('../ui/mod-packages.mjs')).href+'?lifecycle114';
 const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===url&&specifier==='./app-shell.mjs')return {url:'data:text/javascript,'+encodeURIComponent(`const b=globalThis.${key};export const call=b.call,say=b.say;export const $=()=>{throw Error('stale dialog was accessed')},el=()=>{throw Error('stale DOM was created')};`),shortCircuit:true};
  return next(specifier,context);
 }});
 let mod;try{mod=await import(url);}finally{hooks.deregister();}
 const importing=mod.importMod(true,()=>assert.fail('hidden page refreshed'),{isCurrent:()=>current});
 assert.equal(calls[0].action,'mod_pick_archive');current=false;finish({cancelled:false,manifest:{name:'selected'}});await importing;
 assert.deepEqual(notices,[],'late picker did not report an error or touch the closed page');
});
