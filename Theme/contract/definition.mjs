// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: own; byteLength; object; keys; css; properties; validateTheme; applyThemeValues; resolvePreset; resolveThemePreset
// Impact: python -B scripts/code-atlas.py show Theme/contract/definition.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import catalog from './elements.mjs';
import {validateAssets,assetProperty,validateSounds} from './assets.mjs';
export {catalog};
const own=(o,k)=>Object.hasOwn(o,k);
const byteLength=value=>new TextEncoder().encode(value).byteLength;
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object');}
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(label+': unknown field '+key);}
function css(value){return typeof value==='string'&&byteLength(value)<=512&&!/[\\;{}<>@\x00-\x1f]/.test(value)&&!/(?:url|image-set|expression|attr|src)\s*\(|javascript:|https?:/i.test(value);}
function properties(value={},assets){object(value,'style');for(const [key,v]of Object.entries(value))if(!catalog.properties.includes(key)||!css(v)||!assetProperty(key,v,assets))throw Error('Unsupported theme property: '+key);}
export function validateTheme(value){
 keys(value,['schema','elements','tokens','styles','layouts','renderers','assets','presets','sounds'],'theme');
 if(value.schema!=='aieyra.theme/1'||value.elements!==catalog.version)throw Error('Unsupported theme or element contract');
 if(byteLength(JSON.stringify(value))>65536)throw Error('Theme definition exceeds 64 KiB');
 validateAssets(value.assets);validateSounds(value.sounds,value.assets);
 if(value.tokens!==undefined){object(value.tokens,'tokens');for(const [k,v]of Object.entries(value.tokens))if(!/^--ui-[a-z0-9-]{1,64}$/.test(k)||!css(v)||/asset\s*\(/i.test(v))throw Error('Invalid theme token: '+k);}
 if(value.styles!==undefined){if(!Array.isArray(value.styles)||value.styles.length>256)throw Error('Theme styles must be an array of at most 256 rules');for(const rule of value.styles){keys(rule,['element','state','properties'],'style');if(!own(catalog.elements,rule.element)||!own(catalog.states,rule.state||'default'))throw Error('Unknown theme element or state');properties(rule.properties,value.assets);}}
 for(const [kind,specs]of [['layouts',catalog.surfaces],['renderers',catalog.renderers]])if(value[kind]!==undefined){object(value[kind],kind);for(const [surface,tree]of Object.entries(value[kind])){
  const spec=specs?.[surface];if(!spec)throw Error('Unknown theme surface or content schema: '+surface);
  const seen=new Set();let count=0;
  function walk(n,depth){
   if(++count>128||depth>12)throw Error('Theme layout is too complex');
   keys(n,['slot','tag','label','style','children'],'layout node');properties(n.style,value.assets);
   if(n.slot!==undefined){if(!own(spec.slots,n.slot)||seen.has(n.slot)||n.children!==undefined||n.tag!==undefined||n.label!==undefined)throw Error('Invalid or duplicate theme slot: '+n.slot);seen.add(n.slot);return;}
   if(!['div','section','article','header','footer','nav','aside','main','span'].includes(n.tag||'div'))throw Error('Unsupported theme container');
   if(spec.inline&&n.tag!=='span')throw Error('Theme attachment containers must be spans');
   if(n.label!==undefined&&(typeof n.label!=='string'||byteLength(n.label)>160||n.label.includes('\0')))throw Error('Invalid theme container label');
   if(!Array.isArray(n.children)||!n.children.length)throw Error('A theme container needs children');
   for(const child of n.children)walk(child,depth+1);
  }
  walk(tree,0);for(const slot of Object.keys(spec.slots))if(!seen.has(slot))throw Error('Theme omits required slot: '+surface+'.'+slot);
 }}
 if(value.presets!==undefined){
  object(value.presets,'presets');if(Object.keys(value.presets).length>16)throw Error('Theme supports at most 16 presets');
  for(const [id,preset]of Object.entries(value.presets)){
   if(!/^[a-z][a-z0-9_-]{0,63}$/.test(id))throw Error('Invalid theme preset ID');
   keys(preset,['name','extends','values'],'preset');if(typeof preset.name!=='string'||!preset.name.trim()||byteLength(preset.name)>160||/[\x00-\x1f]/.test(preset.name))throw Error('Invalid theme preset name');
   if(preset.extends!==undefined&&(typeof preset.extends!=='string'||!own(value.presets,preset.extends)))throw Error('Unknown parent theme preset');
   const resolved=resolvePreset(value,id);if(byteLength(JSON.stringify({...resolved,presets:value.presets}))>65536)throw Error('Resolved theme definition exceeds 64 KiB');validateTheme(resolved);
  }
 }
 return value;
}
export function applyThemeValues(base,values){
 keys(values,['tokens','styles','layouts','renderers'],'preset values');const out=structuredClone(base);
 for(const [group,patch]of Object.entries(values)){
  if(group==='styles'){if(patch===null)delete out.styles;else {if(!Array.isArray(patch))throw Error('Preset styles must be an array or null');out.styles=structuredClone(patch);}continue;}
  object(patch,'preset '+group);out[group]??={};
  for(const [key,value]of Object.entries(patch)){
   if(group==='tokens'?!/^--ui-[a-z0-9-]{1,64}$/.test(key):!own(group==='layouts'?catalog.surfaces:catalog.renderers,key))throw Error('Unknown preset property: '+key);
   if(value===null)delete out[group][key];else out[group][key]=structuredClone(value);
  }
 }
 return out;
}
function resolvePreset(definition,id,seen=new Set()){
 if(typeof id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(id))throw Error('Invalid theme preset ID');
 if(!definition.presets||!own(definition.presets,id))throw Error('Unknown theme preset');
 if(seen.has(id)||seen.size>=8)throw Error('Theme preset inheritance is cyclic or exceeds 8 levels');
 seen.add(id);const preset=definition.presets[id],{presets,...plain}=definition;
 const base=preset.extends===undefined?plain:resolvePreset(definition,preset.extends,seen);
 return applyThemeValues(base,preset.values);
}
export function resolveThemePreset(definition,id){validateTheme(definition);return {...resolvePreset(definition,id),presets:structuredClone(definition.presets)};}
