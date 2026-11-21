// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: id; select
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-overrides.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectTheme,editTheme,materialize,validateProfiles}=require('../../../Theme/runtime/overrides.cjs');
const id='example.custom',definition=()=>({schema:'aieyra.theme/1',elements:'1.0.0',tokens:{'--ui-accent':'#123456','--ui-text':'#eeeeee'}});
const select=(digest,def=definition())=>({id,digest:digest.repeat(64),version:'1.0.0',definition:def});
test('theme updates retain immutable defaults, local edits and concrete three-way conflicts',()=>{
 let state=selectTheme({},select('a')),edited=definition();edited.tokens['--ui-accent']='#456789';
 state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 assert.equal(state.profiles[id].base.definition.tokens['--ui-accent'],'#123456');
 const updated=definition();updated.tokens['--ui-accent']='#789abc';updated.tokens['--ui-text']='#ffffff';
 state=selectTheme(state.profiles,select('b',updated));const view=materialize(state.profiles[id]);
 assert.equal(view.definition.tokens['--ui-accent'],'#456789');assert.equal(view.definition.tokens['--ui-text'],'#ffffff');assert.equal(view.conflicts.length,1);
 assert.deepEqual(view.conflicts[0],{path:['tokens','--ui-accent'],before:{exists:true,value:'#123456'},after:{exists:true,value:'#456789'},source:'a'.repeat(64),current:{exists:true,value:'#789abc'}});
 const repeated=selectTheme(state.profiles,state.selection);assert.deepEqual(repeated.profiles,state.profiles,'reapplying effective selection cannot overwrite its original defaults');
 state=editTheme(state.profiles,id,{action:'resolve',path:['tokens','--ui-accent'],choice:'mine'});assert.equal(state.conflicts.length,0);assert.equal(state.selection.definition.tokens['--ui-accent'],'#456789');
 state=editTheme(state.profiles,id,{action:'reset'});assert.equal(state.selection.definition.tokens['--ui-accent'],'#789abc');
 state=editTheme(state.profiles,id,{action:'undo'});assert.equal(state.selection.definition.tokens['--ui-accent'],'#456789');assert.equal(state.conflicts.length,0);
});
test('unrelated edits and multiple package updates retain the original version of unresolved conflicts',()=>{
 let state=selectTheme({},select('a')),edited=definition();edited.tokens['--ui-accent']='#456789';
 state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 const updated=definition();updated.tokens['--ui-accent']='#789abc';state=selectTheme(state.profiles,select('b',updated));
 edited=structuredClone(state.selection.definition);edited.tokens['--ui-text']='#cccccc';state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 assert.equal(state.conflicts.length,1);assert.equal(state.conflicts[0].before.value,'#123456');
 state=selectTheme(state.profiles,select('c',{...updated,tokens:{'--ui-accent':'#aabbcc','--ui-text':'#dddddd'}}));
 const profile=state.profiles[id];assert.deepEqual(profile.history['a'.repeat(64)].definition,definition());assert.deepEqual(profile.history['b'.repeat(64)].definition,updated);assert.equal(materialize(profile).conflicts.length,2);
 state=editTheme(state.profiles,id,{action:'undo'});assert.equal(state.selection.digest,'c'.repeat(64),'undo never rolls back a package');assert.equal(state.selection.definition.tokens['--ui-text'],'#dddddd');assert.equal(state.conflicts.length,1);
 state=selectTheme(state.profiles,select('a'));assert.equal(materialize(state.profiles[id]).conflicts.length,0);assert.equal(state.selection.definition.tokens['--ui-accent'],'#456789');
});
test('shared store preserves profiles through disable, complete-state writes, CAS conflicts and restart',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createAppearanceStore,merge}=require('../../../Theme/runtime/settings.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-merge-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const config=path.join(dir,'config.json'),file=path.join(dir,'os-appearance.json'),store=createAppearanceStore(config);
 let result=store.update({layout_theme:select('a'),regions:{assistant:{size:23}}},'missing');assert.equal(result.ok,true,result.error);
 const edited=definition();edited.tokens['--ui-accent']='#456789';result=store.update({theme_edit:{action:'edit',definition:edited}},result.version);assert.equal(result.ok,true,result.error);
 const snapshot=structuredClone(result.settings);result=store.update(merge(result.settings,{regions:{thinking:{size:17}}}),result.version);assert.equal(result.ok,true,result.error);assert.deepEqual(result.settings.theme_profiles,snapshot.theme_profiles);
 result=store.update({layout_theme:null},result.version);assert.deepEqual(result.settings.theme_profiles,snapshot.theme_profiles);
 const updated=definition();updated.tokens['--ui-accent']='#789abc';result=store.update({layout_theme:select('b',updated)},result.version);assert.equal(result.ok,true,result.error);assert.equal(result.theme_status.conflicts.length,1);
 const raw=fs.readFileSync(file);assert.equal(store.update({theme_edit:{action:'reset'}},'missing').code,'version_conflict');assert.deepEqual(fs.readFileSync(file),raw);
 const reopened=createAppearanceStore(config).read();assert.deepEqual(reopened,result);assert.deepEqual(fs.readFileSync(file),raw);assert.equal(reopened.settings.regions.assistant.size,23);
 const projected=require('../../../Theme/runtime/projection.cjs').publicAppearance(reopened);assert.equal(projected.settings.theme_profiles,undefined);assert.deepEqual(projected.settings.layout_theme,reopened.settings.layout_theme);
 result=store.update({theme_edit:{action:'reset'}},result.version);assert.equal(result.ok,true,result.error);result=store.update({theme_edit:{action:'undo'}},result.version);assert.equal(result.theme_status.conflicts.length,1);
 const bad=structuredClone(result.settings);bad.theme_profiles[id].history={};const invalid=JSON.stringify(bad);fs.writeFileSync(file,invalid);assert.equal(store.read().ok,false);assert.equal(store.update({},require('../src/config.cjs').version(file)).ok,false);assert.equal(fs.readFileSync(file,'utf8'),invalid);
});
test('oversized profile writes fail without committing an unreadable appearance file',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createAppearanceStore}=require('../../../Theme/runtime/settings.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-limits-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'os-appearance.json'),store=createAppearanceStore(path.join(dir,'config.json'));
 const first=store.update({},'missing'),raw=fs.readFileSync(file),large=definition();large.tokens=Object.fromEntries(Array.from({length:120},(_,i)=>['--ui-mark-'+i,'x'.repeat(480)]));
 const profiles={};for(let i=0;i<16;i++){
  const key='example.limit'+i;let row=selectTheme({},{...select('a',large),id:key});
  row=selectTheme(row.profiles,{...select('b',large),id:key});row=selectTheme(row.profiles,{...select('c',large),id:key});profiles[key]=row.profiles[key];
 }
 const failed=store.update({theme_profiles:profiles},first.version);assert.equal(failed.ok,false);assert.match(failed.error,/上限/);assert.deepEqual(fs.readFileSync(file),raw);assert.deepEqual(fs.readdirSync(dir),['os-appearance.json']);
});
test('removed package resources suspend incompatible edits without discarding their old defaults or values',()=>{
 const base={...definition(),assets:{paper:{path:'assets/paper.png',mime:'image/png'}},styles:[]};
 let state=selectTheme({},select('a',base)),edited=structuredClone(base);edited.styles=[{element:'body',properties:{background:'asset(paper)'}}];
 state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 state=selectTheme(state.profiles,select('b',{...definition(),styles:[]}));let view=materialize(state.profiles[id]);
 assert.equal(view.suspended,true);assert.ok(view.error);assert.equal(state.profiles[id].overrides.length,1);assert.deepEqual(view.definition.styles,[]);
 assert.deepEqual(state.profiles[id].overrides[0].after.value,edited.styles);
 state=editTheme(state.profiles,id,{action:'resolve',path:['styles'],choice:'default'});assert.equal(state.suspended,false);assert.equal(state.profiles[id].overrides.length,0);
});
test('theme profiles reject unbounded records, invented paths and resource edits while keeping source objects untouched',()=>{
 const state=selectTheme({},select('a')),saved=structuredClone(state);
 const edited=definition();edited.assets={paper:{path:'assets/paper.png',mime:'image/png'}};
 assert.throws(()=>editTheme(state.profiles,id,{action:'edit',definition:edited}),/资源声明/);
 assert.throws(()=>editTheme(state.profiles,id,{action:'resolve',path:['tokens','__proto__'],choice:'mine'}));
 assert.throws(()=>validateProfiles(Object.fromEntries(Array.from({length:17},(_,i)=>['example.theme'+i,state.profiles[id]]))),/16/);
 const bad=structuredClone(state.profiles);bad[id].overrides=[{path:['schema'],before:{exists:true,value:'aieyra.theme/1'},after:{exists:true,value:'bad'}}];assert.throws(()=>validateProfiles(bad));
 assert.deepEqual(state,saved);
});
test('a deleted token remains an explicit choice when an intervening default also removes it',()=>{
 let state=selectTheme({},select('a')),edited=definition();delete edited.tokens['--ui-accent'];state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 const removed=definition();delete removed.tokens['--ui-accent'];state=selectTheme(state.profiles,select('b',removed));
 edited=structuredClone(state.selection.definition);edited.tokens['--ui-text']='#abcdef';state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 state=selectTheme(state.profiles,select('c'));assert.equal(Object.hasOwn(state.selection.definition.tokens,'--ui-accent'),false,'unrelated editing must not erase an explicit removal');
});
test('valid IDs do not resolve inherited object properties and persisted paths/version references are typed',()=>{
 const chosen=selectTheme({},{...select('a'),id:'constructor'});assert.equal(chosen.selection.id,'constructor');assert.equal(chosen.profiles.constructor.base.digest,'a'.repeat(64));
 const state=selectTheme({},select('a')),edited=definition();edited.tokens['--ui-accent']='#abcdef';const saved=editTheme(state.profiles,id,{action:'edit',definition:edited});
 const badPath=structuredClone(saved.profiles);badPath[id].overrides[0].path=['tokens',['--ui-accent']];assert.throws(()=>validateProfiles(badPath));
 const badVersion=structuredClone(saved.profiles);badVersion[id].origin='constructor';assert.throws(()=>validateProfiles(badVersion));
 assert.throws(()=>selectTheme({},{...select('a'),digest:['a'.repeat(64)]}));
});
test('repeating reset or saving an unchanged definition cannot consume the recovery snapshot',()=>{
 let state=selectTheme({},select('a')),edited=definition();edited.tokens['--ui-accent']='#abcdef';state=editTheme(state.profiles,id,{action:'edit',definition:edited});
 state=editTheme(state.profiles,id,{action:'edit',definition:edited});state=editTheme(state.profiles,id,{action:'undo'});assert.equal(state.selection.definition.tokens['--ui-accent'],'#123456');
 state=editTheme(state.profiles,id,{action:'undo'});state=editTheme(state.profiles,id,{action:'reset'});state=editTheme(state.profiles,id,{action:'reset'});state=editTheme(state.profiles,id,{action:'undo'});assert.equal(state.selection.definition.tokens['--ui-accent'],'#abcdef');
});
