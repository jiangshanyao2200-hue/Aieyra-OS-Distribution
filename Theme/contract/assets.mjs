// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: idPattern; pathPattern; validateAssets; assetReference; assetProperty; assetURL; assetFamily; assetCSS; fontFaces; soundEvents; validateSounds
// Impact: python -B scripts/code-atlas.py show Theme/contract/assets.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const idPattern=/^[a-z][a-z0-9-]{0,47}$/;
const pathPattern=/^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|woff2|wav)$/;
export function validateAssets(assets={}){
 if(!assets||typeof assets!=='object'||Array.isArray(assets)||Object.keys(assets).length>64)throw Error('Invalid theme assets');
 for(const [id,a]of Object.entries(assets)){
  if(!idPattern.test(id)||!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['path','mime','fallback'].includes(k))||typeof a.path!=='string'||a.path.length>240||!pathPattern.test(a.path))throw Error('Invalid theme asset: '+id);
  const valid=a.mime==='image/png'&&a.path.endsWith('.png')||a.mime==='image/jpeg'&&/\.jpe?g$/.test(a.path)||a.mime==='font/woff2'&&a.path.endsWith('.woff2')||a.mime==='audio/wav'&&a.path.endsWith('.wav');
  if(!valid||a.mime!=='font/woff2'&&a.fallback!==undefined||a.fallback!==undefined&&!['sans-serif','serif','monospace'].includes(a.fallback))throw Error('Unsupported theme asset format: '+id);
 }
 return assets;
}
export function assetReference(value){return /^asset\(([a-z][a-z0-9-]{0,47})\)$/.exec(value)?.[1]||'';}
export function assetProperty(property,value,assets={}){
 if(!/asset\s*\(/i.test(value))return true;
 const id=assetReference(value),a=Object.hasOwn(assets,id)&&assets[id];
 return !!a&&(property==='font-family'&&a.mime==='font/woff2'||['background','background-image'].includes(property)&&a.mime.startsWith('image/'));
}
export function assetURL(selection,id){
 if(!/^[a-z][a-z0-9_.-]{1,127}$/.test(selection?.id)||!/^[a-f0-9]{64}$/.test(selection?.digest)||!idPattern.test(id))throw Error('Invalid theme asset identity');
 if(selection.preview_token!==undefined){if(!/^[a-f0-9]{64}$/.test(selection.preview_token))throw Error('Invalid preview resource identity');return 'aieyra-theme://preview/'+selection.preview_token+'/'+id;}
 return 'aieyra-theme://assets/'+selection.id+'/'+selection.digest+'/'+id;
}
export const assetFamily=(selection,id)=>'aieyra-theme-'+selection.digest+'-'+id;
export function assetCSS(property,value,selection){
 const id=assetReference(value);if(!id)return value;
 const a=selection.definition.assets[id];
 return property==='font-family'?'"'+assetFamily(selection,id)+'", '+(a.fallback||'sans-serif'):'url("'+assetURL(selection,id)+'")';
}
export function fontFaces(selection){
 return Object.entries(selection?.definition?.assets||{}).filter(([,a])=>a.mime==='font/woff2').map(([id])=>'@font-face{font-family:"'+assetFamily(selection,id)+'";src:url("'+assetURL(selection,id)+'") format("woff2");font-weight:100 900;font-display:swap;}').join('\n');
}
export const soundEvents=['task.completed','task.failed','attention.pending'];
export function validateSounds(sounds={},assets={}){
 if(!sounds||typeof sounds!=='object'||Array.isArray(sounds))throw Error('Theme sounds must be an object');
 for(const [event,id]of Object.entries(sounds))if(!soundEvents.includes(event)||typeof id!=='string'||!idPattern.test(id)||!Object.hasOwn(assets,id)||assets[id].mime!=='audio/wav')throw Error('Theme sound needs a declared WAV asset: '+event);
 return sounds;
}
