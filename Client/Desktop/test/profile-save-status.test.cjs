// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/profile-save-status.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,addEventListener(){}});return nodes.get(id);};
 const initial={version:'initial',name:'Ryo',eyraName:'Eyra',avatar:'old',eyraAvatar:'',userRingColor:'#e6e9f0',roles:{},background:'',backgroundBlur:12,backgroundOpacity:.5,mediaRotation:{},initialized:true};
 let stored=structuredClone(initial),mediaState=structuredClone(initial),release=null;
 const api={profile:async()=>({profile:structuredClone(stored)}),saveProfile:async value=>{if(release)await release.promise;stored={...structuredClone(value),version:'saved'};stored.mediaRotation=Object.fromEntries(Object.entries(stored.mediaRotation).reverse().map(([key,row])=>[key,Object.fromEntries(Object.entries(row).reverse())]));return {profile:structuredClone(stored)};}};
 const context={document:{getElementById:node,body:{style:{}}},structuredClone,Promise,applyChatLayout(){},checkSettings:r=>r};vm.createContext(context);
 const source=fs.readFileSync(path.join(__dirname,'../ui/settings-controller.mjs'),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');vm.runInContext(source,context);
 const controller=context.setupProfileSettings(api,{media:{load:p=>{mediaState=structuredClone(p);},rebase:(before,next)=>{for(const key of ['avatar','eyraAvatar','background','mediaRotation'])if(JSON.stringify(mediaState[key])===JSON.stringify(before[key]))mediaState[key]=structuredClone(next[key]);}},mediaValue:()=>structuredClone(mediaState)});controller.initialize(initial);
 return {controller,node,media:()=>mediaState,stored:()=>stored,hold(){let resolve;release={promise:new Promise(r=>resolve=r)};return resolve;}};
}
test('saving randomized avatars reports saved despite normalized object key order',async()=>{
 const f=fixture();f.media().avatar='new';f.media().mediaRotation={vayaAvatar:{mode:'random',id:'vaya',nextAt:123,intervalSeconds:86400},cotaAvatar:{mode:'random',id:'cota',nextAt:456,intervalSeconds:86400}};
 await f.node('save-profile').onclick();
 assert.equal(f.stored().avatar,'new');assert.equal(f.stored().mediaRotation.vayaAvatar.id,'vaya');assert.equal(f.node('profile-status').textContent,'已保存。');
 f.media().background='new-background';f.controller.changed();assert.equal(f.node('profile-status').textContent,'有未保存的修改');
});
test('a real edit made during save remains unsaved and is never overwritten',async()=>{
 const f=fixture(),release=f.hold();f.media().avatar='submitted';const saving=f.node('save-profile').onclick();await new Promise(resolve=>setImmediate(resolve));f.media().background='newer';release();await saving;
 assert.equal(f.stored().background,'');assert.equal(f.media().background,'newer');assert.equal(f.node('profile-status').textContent,'已保存，仍有未保存的修改。');
});

test('committed avatar rotation reaches the settings form without overwriting its draft',async()=>{
 const f=fixture();f.media().background='draft';f.node('display-name').value='draft-name';
 Object.assign(f.stored(),{version:'rotated',avatar:'rotated-avatar',eyraAvatar:'rotated-eyra',name:'remote-name'});
 await f.controller.refresh(f.stored());
 assert.equal(f.media().avatar,'rotated-avatar');assert.equal(f.media().eyraAvatar,'rotated-eyra');
 assert.equal(f.media().background,'draft');assert.equal(f.node('display-name').value,'draft-name');assert.equal(f.controller.dirty,true);
});
test('a stale settings notification queued during save cannot restore the old avatar',async()=>{
 const f=fixture(),old=structuredClone(f.stored()),release=f.hold();f.media().avatar='chosen';
 const saving=f.node('save-profile').onclick();await new Promise(resolve=>setImmediate(resolve));
 const notification=f.controller.refresh(old);release();await saving;await notification;
 assert.equal(f.stored().avatar,'chosen');assert.equal(f.media().avatar,'chosen');assert.equal(f.controller.profile.version,'saved');assert.equal(f.controller.dirty,false);
});
