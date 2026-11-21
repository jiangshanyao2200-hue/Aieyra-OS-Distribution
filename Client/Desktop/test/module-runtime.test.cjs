// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; pause
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-runtime.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createModuleRuntime}=require('../host/module-runtime.cjs');
const {MODULES}=require('../host/module-catalog.cjs');
function fixture(t){const calls=[],rows=Object.fromEntries(MODULES.map(s=>[s.id,{detached:false}]));const adapters=Object.fromEntries(MODULES.map(s=>[s.id,{state:()=>rows[s.id],open(){calls.push('focus:'+s.id);},detach(){calls.push('detach:'+s.id);rows[s.id].detached=true;},dock(){calls.push('dock:'+s.id);rows[s.id].detached=false;},close(){calls.push('close:'+s.id);rows[s.id].detached=false;}}]));const runtime=createModuleRuntime({adapters,showMain:()=>calls.push('show'),hideMain:()=>calls.push('hide'),shutdown:()=>calls.push('shutdown')});t.after(()=>runtime.close());return {runtime,rows,adapters,calls};}
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('Home cannot detach or close as a module; opening it restores the existing main window',async t=>{const f=fixture(t);await assert.rejects(f.runtime.action({module:'home',action:'detach'}),/首页固定/);await assert.rejects(f.runtime.action({module:'home',action:'close'}),/首页固定/);await f.runtime.action({module:'browser',action:'detach'});await f.runtime.closeMain();await f.runtime.action({module:'home',action:'open'});assert.equal(f.runtime.mainOpen,true);assert.equal(f.rows.home.detached,false);assert.ok(f.calls.indexOf('show')<f.calls.indexOf('focus:home'));});

test('independent conversation windows retain the runtime until their own close',async t=>{
 const f=fixture(t);let windows=['conversation:one'];
 const runtime=createModuleRuntime({adapters:f.adapters,auxiliary:()=>windows,showMain(){},hideMain(){},shutdown:()=>f.calls.push('aux-shutdown')});
 t.after(()=>runtime.close());await runtime.closeMain();await pause(300);
 assert.deepEqual(runtime.independent(),['conversation:one']);assert.equal(f.calls.includes('aux-shutdown'),false);
 windows=[];runtime.changed();await pause(300);assert.equal(f.calls.filter(x=>x==='aux-shutdown').length,1);
});
test('closing the main window retains every independent module; closing the last releases the runtime',async t=>{const f=fixture(t);await f.runtime.action({module:'browser',action:'detach'});await f.runtime.action({module:'settings',action:'detach'});await f.runtime.closeMain();await pause(300);assert.equal(f.calls.includes('shutdown'),false);await f.runtime.action({module:'browser',action:'close'});await pause(300);assert.equal(f.calls.includes('shutdown'),false);await f.runtime.action({module:'settings',action:'close'});await pause(300);assert.equal(f.calls.filter(x=>x==='shutdown').length,1);});
test('docking reopens the main window and cancellation of last-window shutdown is immediate',async t=>{const f=fixture(t);await f.runtime.action({module:'contacts',action:'detach'});await f.runtime.closeMain();await f.runtime.action({module:'contacts',action:'dock'});await pause(300);assert.equal(f.runtime.mainOpen,true);assert.equal(f.calls.includes('shutdown'),false);assert.ok(f.calls.indexOf('show')<f.calls.indexOf('dock:contacts'));});
test('concurrent requests join one launch and rejected module IDs never reach adapters',async t=>{const f=fixture(t);let resolve;f.adapters.browser.detach=()=>new Promise(r=>{resolve=()=>{f.rows.browser.detached=true;r();};f.calls.push('launch');});const first=f.runtime.action({module:'browser',action:'detach'}),second=f.runtime.action({module:'browser',action:'detach'});assert.equal(f.runtime.state().modules.browser.starting,true);await f.runtime.closeMain();await pause(300);assert.equal(f.calls.includes('shutdown'),false);resolve();await Promise.all([first,second]);assert.equal(f.calls.filter(x=>x==='launch').length,1);await assert.rejects(f.runtime.action({module:'unknown-program',action:'detach'}),/未知模块/);});

test('close queued behind detach is not swallowed and the last window still releases the runtime',async t=>{
 const f=fixture(t);let release;f.adapters.browser.detach=()=>new Promise(r=>{release=()=>{f.rows.browser.detached=true;r();};f.calls.push('launch');});
 const detached=f.runtime.action({module:'browser',action:'detach'}),closed=f.runtime.action({module:'browser',action:'close'});await f.runtime.closeMain();await pause(10);assert.equal(f.calls.includes('close:browser'),false);release();await Promise.all([detached,closed]);await pause(300);assert.equal(f.rows.browser.detached,false);assert.equal(f.calls.filter(x=>x==='close:browser').length,1);assert.equal(f.calls.filter(x=>x==='shutdown').length,1);
});
test('a rejected action does not poison the next action on the same module',async t=>{
 const f=fixture(t);f.adapters.settings.detach=async()=>{throw Error('could not create window');};const failed=f.runtime.action({module:'settings',action:'detach'}),next=f.runtime.action({module:'settings',action:'open'});await assert.rejects(failed,/could not/);await next;assert.ok(f.calls.includes('focus:settings'));assert.equal(f.runtime.state().modules.settings.starting,false);
});
