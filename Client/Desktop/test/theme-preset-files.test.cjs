// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-preset-files.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {themePresetFile}=require('../host/theme-preset-files.cjs');
const {createAppearanceStore}=require('../../../Theme/runtime/settings.cjs');
const {MAX}=require('../../../Theme/runtime/presets.cjs');
test('invalid preset IDs are rejected before opening native file dialogs',async()=>{
 let calls=0;const dependencies={core:async()=>{calls++;return {ok:true,version:'v1',settings:{theme_presets:{}}};},dialog:{showOpenDialog:async()=>{calls++;return {canceled:true};},showSaveDialog:async()=>{calls++;return {canceled:true};}}};
 for(const action of ['os_theme_preset_import','os_theme_preset_export'])for(const id of [['preset.saved'],null,{},1,'','../preset']){
  await assert.rejects(themePresetFile(dependencies,{action,id,expected_version:'v1'}),/标识/);assert.equal(calls,0);
 }
});
test('native preset files export only the chosen inheritance and import without applying; cancellation and stale dialogs preserve state',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'preset-file-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=createAppearanceStore(path.join(dir,'config.json')),target=path.join(dir,'chosen.json');
 let read=store.update({layout_theme:{id:'example.files',digest:'a'.repeat(64),definition:{schema:'aieyra.theme/1',elements:'1.0.0',tokens:{'--ui-accent':'#abcabc'}}},regions:{assistant:{size:23}}},'missing');
 read=store.update({theme_preset:{action:'save',id:'preset.selected',name:'Selected'}},read.version);assert.equal(read.ok,true,read.error);
 read=store.update({theme_preset:{action:'save',id:'preset.private',name:'unrelated-private-sentinel'}},read.version);assert.equal(read.ok,true,read.error);
 const core=async(_method,p)=>p.action==='os_appearance_read'?store.read():store.update(p.patch,p.expected_version);let cancelled=true,change=false;const parent={};
 const dialog={showSaveDialog:async owner=>{assert.equal(owner,parent);if(change)store.update({first_line_indent:2},store.read().version);return {canceled:cancelled,filePath:target};},showOpenDialog:async()=>({canceled:cancelled,filePaths:[target]})};
 const call=(action,id='preset.selected')=>themePresetFile({core,dialog,parent},{action,id,expected_version:store.read().version});
 fs.writeFileSync(target,'existing file');assert.equal((await call('os_theme_preset_export')).cancelled,true);assert.equal(fs.readFileSync(target,'utf8'),'existing file');
 cancelled=false;change=true;assert.equal((await call('os_theme_preset_export')).code,'version_conflict');assert.equal(fs.readFileSync(target,'utf8'),'existing file');
 change=false;const exported=await call('os_theme_preset_export');assert.equal(exported.ok,true);const text=fs.readFileSync(target,'utf8');assert.ok(!text.includes('unrelated-private-sentinel')&&!text.includes('region_overrides'));assert.equal(JSON.parse(text).name,'Selected');
 const before=store.read(),imported=await call('os_theme_preset_import','preset.imported');assert.equal(imported.ok,true,imported.error);assert.deepEqual(imported.settings.layout_theme,before.settings.layout_theme);assert.deepEqual(imported.settings.theme_profiles,before.settings.theme_profiles);
 cancelled=true;assert.equal((await call('os_theme_preset_import','preset.cancelled')).cancelled,true);assert.equal(store.read().version,imported.version);
 cancelled=false;fs.writeFileSync(target,'{');await assert.rejects(call('os_theme_preset_import','preset.invalid'));assert.equal(store.read().version,imported.version);
 fs.writeFileSync(target,'x'.repeat(MAX+1));await assert.rejects(call('os_theme_preset_import','preset.too-large'),/512 KiB/);assert.equal(store.read().version,imported.version);
 await assert.rejects(themePresetFile({core,dialog,parent},{action:'os_theme_preset_import',id:'preset.hidden-path',expected_version:imported.version,path:target}),/无效/);
 assert.equal(fs.readdirSync(dir).some(name=>name.startsWith('.theme-preset-')),false);
});
