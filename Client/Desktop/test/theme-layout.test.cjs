// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: base
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-layout.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {validateTheme}=require('../../../Theme/contract/definition.mjs');
const base=()=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../SDK/examples/theme-columns/theme.json')));
test('renderer catalog and author schema match the authoritative theme vocabulary without a network capability',()=>require('../../../SDK/tools/theme-catalog.cjs').sync(true));
test('greetings project the real live layout without empty controls or changing the theme definition',async()=>{
 const {projectLayoutSlots}=await import('../../../Theme/runtime/layout.mjs'),tree=base().layouts.live,before=JSON.stringify(tree),projected=projectLayoutSlots(tree,new Set(['identity','answer']));
 const slots=[],visit=node=>{if(node.slot)slots.push(node.slot);else{assert(node.children.length>0);node.children.forEach(visit);}};visit(projected);
 assert.deepEqual(slots,['identity','answer']);assert.equal(JSON.stringify(tree),before);assert.equal(projected.children.length,1);
 assert.equal(projectLayoutSlots(tree,new Set()),null);
});
test('theme contract accepts author layouts and rejects lost controls, hidden code and unknown capabilities',()=>{
 assert.equal(validateTheme(base()).schema,'aieyra.theme/1');
 const missing=base();missing.layouts.message.children.pop();assert.throws(()=>validateTheme(missing),/required slot/);
 const duplicate=base();duplicate.layouts.message.children.push({slot:'avatar'});assert.throws(()=>validateTheme(duplicate),/duplicate/);
 const script=base();script.layouts.message.tag='script';assert.throws(()=>validateTheme(script),/container/);
 const network=base();network.styles[0].properties.background='url(https://example.com/private)';assert.throws(()=>validateTheme(network),/property/);
 const malformed=base();malformed.tokens['--ui-text']='red;}body{display:none';assert.throws(()=>validateTheme(malformed),/token/);
 const future=base();future.elements='2.0.0';assert.throws(()=>validateTheme(future),/contract/);
});
test('theme selection preserves unrelated user overrides and can be removed through the shared appearance store',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-state-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=require('../../../Theme/runtime/settings.cjs').createAppearanceStore(path.join(dir,'config.json'));
 let result=store.update({regions:{assistant:{size:23}}},'missing');assert.equal(result.ok,true);
 result=store.update({layout_theme:{id:'example.columns',digest:'a'.repeat(64),definition:base()}},result.version);assert.equal(result.ok,true,result.error);assert.equal(result.settings.regions.assistant.size,23);
 const raw=fs.readFileSync(path.join(dir,'os-appearance.json'));const bad=base();bad.layouts.message.children=[];assert.equal(store.update({layout_theme:{id:'example.columns',digest:'b'.repeat(64),definition:bad}},result.version).ok,false);assert.deepEqual(fs.readFileSync(path.join(dir,'os-appearance.json')),raw);
 result=store.update({layout_theme:null},result.version);assert.equal(result.ok,true);assert.equal(result.settings.layout_theme,undefined);assert.equal(result.settings.regions.assistant.size,23);
});
test('legacy typography is inferred without rewriting and explicit default choices survive theme updates',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-overrides-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {createAppearanceStore,defaults}=require('../../../Theme/runtime/settings.cjs'),store=createAppearanceStore(path.join(dir,'config.json')),file=path.join(dir,'os-appearance.json');
 const legacy=defaults();delete legacy.region_overrides;legacy.regions.assistant.size=23;
 const raw=JSON.stringify(legacy);fs.writeFileSync(file,raw);let read=store.read();
 assert.deepEqual(read.settings.region_overrides,{assistant:['size']});assert.equal(fs.readFileSync(file,'utf8'),raw);
 read=store.update({regions:{assistant:{size:16}}},read.version);assert.equal(read.ok,true);assert.deepEqual(read.settings.region_overrides.assistant,['size']);
 read=store.update({layout_theme:{id:'example.columns',digest:'c'.repeat(64),definition:base()}},read.version);
 assert.equal(read.settings.regions.assistant.size,16);assert.deepEqual(store.read().settings.region_overrides.assistant,['size']);
 assert.equal(store.update({region_overrides:{assistant:['invented']}},read.version).ok,false);
 read=store.update({region_overrides:{}},read.version);assert.equal(read.ok,true);assert.deepEqual(read.settings.region_overrides,{});
});
test('theme text limits count UTF-8 bytes consistently with the Core validator',()=>{
 const theme=base();theme.layouts.message.label='界'.repeat(54);assert.throws(()=>validateTheme(theme),/label/);
 delete theme.layouts.message.label;theme.styles[0].properties['font-family']='界'.repeat(171);assert.throws(()=>validateTheme(theme),/property/);
});

test('content schema versions preserve required semantic slots and reject active capabilities',()=>{
 const theme=base();assert.equal(validateTheme(theme),theme);
 for(const [schema,tree]of [
  ['aieyra.content.code/2',{slot:'content'}],
  ['aieyra.content.code/1',{slot:'caption'}],
  ['aieyra.content.quote/1',{children:[{slot:'content'},{slot:'content'}]}],
  ['aieyra.content.table/1',{tag:'script',children:[{slot:'content'}]}],
  ['aieyra.content.quote/1',{slot:'content',style:{background:'url(https://example.invalid/image)'}}],
  ['aieyra.content.image/1',{children:[{slot:'heading'},{slot:'content'}]}],
  ['aieyra.content.media/1',{children:[{slot:'heading'},{slot:'content'}]}],
  ['aieyra.content.attachment/1',{tag:'div',children:[{slot:'name'},{slot:'metadata'}]}],
 ])assert.throws(()=>validateTheme({...theme,renderers:{[schema]:tree}}));
});
