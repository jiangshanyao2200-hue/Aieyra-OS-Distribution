// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: seed
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/default-profile.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProfileStore}=require('../host/profile.cjs');
const seed=require('../../../Theme/official/default/profile.json').profile;

test('a fresh install reads the recommended profile, named User, with rotation and layout ready',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-default-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createProfileStore(path.join(dir,'config.json')),profile=store.read();
 assert.equal(profile.version,'missing');assert.equal(profile.initialized,false);
 assert.equal(profile.name,'User');assert.equal(profile.eyraName,'Eyra');assert.equal(profile.avatar,'');assert.equal(profile.background,'');
 assert.deepEqual(profile.chatLayout,seed.chatLayout);assert.equal(profile.backgroundOpacity,0);assert.equal(profile.chatOpacity,.18);assert.equal(profile.chatBlur,12);
 assert.deepEqual(Object.keys(profile.mediaRotation).sort(),['avatar','background','cotaAvatar','eyraAvatar','vayaAvatar']);
 assert.equal(profile.mediaRotation.background.intervalSeconds,600);
 for(const target of ['avatar','eyraAvatar','cotaAvatar','vayaAvatar'])assert.equal(profile.mediaRotation[target].intervalSeconds,86400);
 assert.ok(Object.values(profile.mediaRotation).every(row=>row.mode==='random'&&row.nextAt===0));
 assert.equal(fs.existsSync(store.file),false,'reading defaults never creates the file');
 const saved=store.update({name:'Someone'},profile.version);assert.equal(saved.name,'Someone');assert.deepEqual(saved.chatLayout,seed.chatLayout);
});
test('precise layout and independent veil patches survive CAS without overwriting other choices',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-precise-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createProfileStore(path.join(dir,'config.json')),first=store.read();
 const chosen=store.update({name:'Keep',chatLayout:{eyraAvatar:121.15,lineHeight:1.15,textSize:19},backgroundBlur:2.15,backgroundOpacity:.0715,chatBlur:6.15,chatOpacity:.2115},first.version);
 const before=fs.readFileSync(store.file);assert.throws(()=>store.update({chatOpacity:.3},first.version));assert.deepEqual(fs.readFileSync(store.file),before);
 const next=store.update({chatOpacity:.3215},chosen.version),read=store.read();assert.equal(next.name,'Keep');assert.equal(read.chatLayout.eyraAvatar,121.15);assert.equal(read.chatLayout.lineHeight,1.15);assert.equal(read.chatLayout.textSize,19);assert.equal(read.backgroundBlur,2.15);assert.equal(read.backgroundOpacity,.0715);assert.equal(read.chatBlur,6.15);assert.equal(read.chatOpacity,.3215);
});
