// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: id; selection; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-presets.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateTheme,resolveThemePreset}=require('../../../Theme/contract/definition.mjs');
const {parsePreset,exportPreset,validatePresets}=require('../../../Theme/runtime/presets.cjs');
const {createAppearanceStore}=require('../../../Theme/runtime/settings.cjs');
const id='example.presets',base=()=>({schema:'aieyra.theme/1',elements:'1.0.0',tokens:{'--ui-accent':'#112233','--ui-text':'#eeeeee'}});
const selection=(digest='a',definition=base())=>({id,digest:digest.repeat(64),version:'1.0.0',definition});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'theme-presets-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,store:createAppearanceStore(path.join(dir,'config.json'))};}
test('author presets inherit full semantic layouts and reject cycles, unknown capabilities and lost slots',()=>{
 const example=JSON.parse(fs.readFileSync(path.join(__dirname,'../../../SDK/examples/theme-columns/theme.json'))),reading=resolveThemePreset(example,'reading');
 assert.equal(reading.tokens['--ui-accent'],'#9be0c2');assert.equal(reading.layouts.message.style.gap,'8px');assert.match(reading.layouts.workspace.style['grid-template-columns'],/520px/);
 assert.deepEqual(example.presets,reading.presets);validateTheme(reading);
 for(const presets of [
  {a:{name:'Cycle',extends:'b',values:{}},b:{name:'Cycle',extends:'a',values:{}}},
  {a:{name:'Missing',extends:'missing',values:{}}},
  {a:{name:'Empty',extends:'',values:{}}},
  {a:{name:'Lost',values:{layouts:{message:{slot:'avatar'}}}}},
  {a:{name:'Resource',values:{assets:{}}}},
  {a:{name:'Unknown deletion',values:{tokens:{'__invalid':null}}}},
  {a:{name:'Code',values:{tokens:{'--ui-accent':'url(https://example.invalid/private)'}}}},
 ])assert.throws(()=>validateTheme({...base(),presets}));
});
test('saved child presets retain a self-contained parent snapshot and apply through versioned recovery after update',t=>{
 const {dir,store}=fixture(t);let read=store.update({layout_theme:selection(),regions:{assistant:{size:23}}},'missing');const update=patch=>{read=store.update(patch,read.version);assert.equal(read.ok,true,read.error);return read;};
 let edited=base();edited.tokens['--ui-accent']='#abcdef';update({theme_edit:{action:'edit',definition:edited}});update({theme_preset:{action:'save',id:'preset.parent',name:'Parent'}});
 edited.tokens['--ui-text']='#ddddcc';update({theme_edit:{action:'edit',definition:edited}});update({theme_preset:{action:'save',id:'preset.child',name:'Child',parent:'preset.parent'}});
 const exported=exportPreset(read.settings.theme_presets,'preset.child'),parsed=parsePreset(exported);assert.equal(parsed.parent.name,'Parent');assert.equal(parsed.values.tokens['--ui-text'],'#ddddcc');assert.equal(parsed.values.tokens['--ui-accent'],undefined);assert.equal(JSON.stringify(parsed).includes('region_overrides'),false);
 update({theme_preset:{action:'delete',id:'preset.parent'}});update({theme_edit:{action:'reset'}});
 update({theme_preset:{action:'apply',id:'preset.child'}});assert.equal(read.settings.layout_theme.definition.tokens['--ui-accent'],'#abcdef');assert.equal(read.settings.layout_theme.definition.tokens['--ui-text'],'#ddddcc');
 update({theme_edit:{action:'reset'}});const newer=base();newer.tokens['--ui-accent']='#ffeedd';update({layout_theme:selection('b',newer)});
 update({theme_preset:{action:'import',id:'preset.imported',preset:parsed}});assert.equal(read.settings.layout_theme.definition.tokens['--ui-accent'],'#ffeedd','import alone does not apply');
 update({theme_preset:{action:'apply',id:'preset.imported'}});assert.equal(read.settings.layout_theme.digest,'b'.repeat(64));assert.equal(read.settings.layout_theme.definition.tokens['--ui-accent'],'#abcdef');assert.equal(read.theme_status.conflicts[0].before.value,'#112233');assert.deepEqual(read.settings.theme_profiles[id].history['a'.repeat(64)].definition,base());
 assert.equal(read.settings.regions.assistant.size,23);const raw=fs.readFileSync(path.join(dir,'os-appearance.json'));assert.deepEqual(createAppearanceStore(path.join(dir,'config.json')).read(),read);assert.deepEqual(fs.readFileSync(path.join(dir,'os-appearance.json')),raw);
 update({theme_edit:{action:'undo'}});assert.equal(read.settings.layout_theme.definition.tokens['--ui-accent'],'#ffeedd');
});
test('missing resources retain imported presets and suspend application without modifying declared assets',t=>{
 const {store}=fixture(t),definition={...base(),assets:{paper:{path:'assets/paper.png',mime:'image/png'}}};let read=store.update({layout_theme:selection('a',definition)},'missing');
 const edited=structuredClone(definition);edited.styles=[{element:'body',properties:{background:'asset(paper)'}}];read=store.update({theme_edit:{action:'edit',definition:edited}},read.version);read=store.update({theme_preset:{action:'save',id:'preset.paper',name:'Paper'}},read.version);assert.equal(read.ok,true,read.error);
 read=store.update({theme_edit:{action:'reset'}},read.version);read=store.update({layout_theme:selection('b')},read.version);read=store.update({theme_preset:{action:'apply',id:'preset.paper'}},read.version);assert.equal(read.ok,true,read.error);assert.equal(read.theme_status.suspended,true);assert.equal(read.settings.layout_theme.definition.assets,undefined);assert.ok(read.settings.theme_presets['preset.paper']);
 read=store.update({theme_edit:{action:'reset'}},read.version);read=store.update({theme_preset:{action:'save',id:'preset.repaired',name:'Repaired child',parent:'preset.paper'}},read.version);assert.equal(read.ok,true,read.error);assert.equal(read.settings.theme_presets['preset.repaired'].values.styles,null);parsePreset(exportPreset(read.settings.theme_presets,'preset.repaired'));
});
test('preset imports reject invalid ancestry and preserve files on stale or conflicting provenance',t=>{
 const {dir,store}=fixture(t);let read=store.update({layout_theme:selection()},'missing');read=store.update({theme_preset:{action:'save',id:'preset.empty',name:'Empty'}},read.version);assert.equal(read.ok,true,read.error);
 const original=read.settings.theme_presets['preset.empty'];let nested=structuredClone(original);for(let i=0;i<8;i++)nested={...structuredClone(original),parent:nested};assert.throws(()=>parsePreset(nested),/8层/);
 assert.throws(()=>parsePreset({...original,parent:{...original,theme:{...original.theme,id:'example.other'}}}),/不同主题/);
 assert.throws(()=>parsePreset({...original,credentials:'not allowed'}));assert.throws(()=>parsePreset({...original,values:{schema:'forged'}}));assert.throws(()=>parsePreset({...original,name:'x'.repeat(524289)}));
 assert.throws(()=>validatePresets(Object.fromEntries(Array.from({length:33},(_,i)=>['preset.'+i,original]))),/32/);
 const forged=structuredClone(original);forged.theme.definition.tokens['--ui-accent']='#999999';read=store.update({theme_preset:{action:'import',id:'preset.forged',preset:forged}},read.version);assert.equal(read.ok,true,read.error);
 const file=path.join(dir,'os-appearance.json'),raw=fs.readFileSync(file);assert.equal(store.update({theme_preset:{action:'apply',id:'preset.forged'}},read.version).ok,false);assert.deepEqual(fs.readFileSync(file),raw);assert.equal(store.update({theme_preset:{action:'delete',id:'preset.empty'}},'missing').code,'version_conflict');assert.deepEqual(fs.readFileSync(file),raw);
});
test('saved preset selectors reject coerced IDs without applying or exporting another preset',t=>{
 const {dir,store}=fixture(t);let read=store.update({layout_theme:selection()},'missing');
 read=store.update({theme_preset:{action:'save',id:'preset.saved',name:'Saved'}},read.version);assert.equal(read.ok,true,read.error);
 const file=path.join(dir,'os-appearance.json'),raw=fs.readFileSync(file);
 for(const value of [['preset.saved'],[['preset.saved']],new String('preset.saved'),null,{},1]){
  const result=store.update({theme_preset:{action:'apply',id:value}},read.version);
  assert.equal(result.ok,false,'non-string selector '+JSON.stringify(value));assert.deepEqual(fs.readFileSync(file),raw);
  assert.throws(()=>exportPreset(read.settings.theme_presets,value),/标识/);
 }
 assert.equal(JSON.parse(exportPreset(read.settings.theme_presets,'preset.saved')).name,'Saved');
 assert.equal(store.update({theme_preset:{action:'apply',id:'preset.saved'}},read.version).ok,true);
});
test('author preset selectors require literal contract IDs and retain one-character author IDs',t=>{
 const {dir,store}=fixture(t),definition={...base(),presets:{a:{name:'A',values:{tokens:{'--ui-accent':'#abcdef'}}}}};
 const read=store.update({layout_theme:selection('a',definition)},'missing');assert.equal(read.ok,true,read.error);
 const file=path.join(dir,'os-appearance.json'),raw=fs.readFileSync(file);
 for(const value of [['a'],[['a']],new String('a'),null,{},1]){
  assert.throws(()=>resolveThemePreset(definition,value),/preset ID/);
  assert.equal(store.update({theme_preset:{action:'author',id:value}},read.version).ok,false);assert.deepEqual(fs.readFileSync(file),raw);
 }
 const result=store.update({theme_preset:{action:'author',id:'a'}},read.version);assert.equal(result.ok,true,result.error);assert.equal(result.settings.layout_theme.definition.tokens['--ui-accent'],'#abcdef');
});
test('preset export rejects an array that would otherwise resolve to an existing saved entry',t=>{
 const {store}=fixture(t);let read=store.update({layout_theme:selection()},'missing');read=store.update({theme_preset:{action:'save',id:'preset.saved',name:'Saved'}},read.version);
 assert.throws(()=>exportPreset(read.settings.theme_presets,['preset.saved']),/标识/);
});
