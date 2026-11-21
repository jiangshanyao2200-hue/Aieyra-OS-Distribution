// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; bundled; fontCache; fontCSS; appearanceCSS; followViewAppearance
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/view-theme.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// HTTP Link views have their own renderer and font registry. Apply only the
// constrained public appearance fields; personal backgrounds stay in the host.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {createAppearanceStore}=require('../src/os-appearance.cjs');
const bundled={inter:['Aieyra Inter','inter-variable.woff2','100 900'],sora:['Aieyra Sora','sora-variable.woff2','100 800'],noto_sans:['Aieyra Noto Sans SC','notosanssc-variable.woff2','100 900'],noto_serif:['Aieyra Noto Serif SC','notoserifsc-variable.woff2','200 900']};
const fontCache=new Map();
function fontCSS(id){
 if(!bundled[id])return '';
 if(!fontCache.has(id)){
  const [family,file,weight]=bundled[id],bytes=fs.readFileSync(path.join(__dirname,'../assets/fonts',file));
  fontCache.set(id,`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2");font-weight:${weight};font-display:swap;}`);
 }
 return fontCache.get(id);
}
async function appearanceCSS(value){
 const {regionStyle}=await import(pathToFileURL(path.join(__dirname,'../ui/appearance.mjs')).href);
 const region=value.settings.regions.interface,style=regionStyle(region,value.fields);
 const variables=Object.entries(style).map(([key,v])=>`--os-interface-${key}:${v}`).join(';');
 return [...new Set([region.font_latin,region.font_cjk])].map(fontCSS).join('')+`:root{${variables}}body,button,input,textarea,select{font-family:var(--os-interface-font)!important}body{font-size:var(--os-interface-size)!important;font-weight:var(--os-interface-weight)!important;line-height:var(--os-interface-line)!important;letter-spacing:var(--os-interface-letter)!important;-webkit-text-stroke:var(--os-interface-stroke) var(--os-interface-strokeColor);text-shadow:var(--os-interface-shadow)}`;
}
function followViewAppearance(contents,config){
 const store=createAppearanceStore(config),file=path.join(path.dirname(config),'os-appearance.json');
 let closed=false,key='',version='',chain=Promise.resolve();
 function refresh(reset=false){
  chain=chain.catch(()=>{}).then(async()=>{
   if(closed||contents.isDestroyed())return;
   const value=store.read();if(value.ok===false||!reset&&value.version===version)return;
   const css=await appearanceCSS(value);if(closed||contents.isDestroyed())return;
   const next=await contents.insertCSS(css);
   if(key&&!reset)await contents.removeInsertedCSS(key);key=next;version=value.version;
  });return chain;
 }
 const loaded=()=>{key='';void refresh(true).catch(()=>{});},changed=()=>{void refresh().catch(()=>{});};
 contents.on('did-finish-load',loaded);fs.watchFile(file,{interval:500,persistent:false},changed);
 const close=()=>{if(closed)return;closed=true;fs.unwatchFile(file,changed);contents.removeListener('did-finish-load',loaded);};
 contents.once('destroyed',close);return {refresh,close};
}
module.exports={appearanceCSS,followViewAppearance};
