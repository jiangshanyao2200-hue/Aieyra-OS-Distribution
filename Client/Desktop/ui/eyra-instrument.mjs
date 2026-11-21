// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: markup; mountRoleInstrument; mountEyraInstrument; instrumentFrame; paintInstrument
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/eyra-instrument.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Stable instrument DOM shared by the original and the native portal.
import {halo} from '../../../Halo/official/instrument.mjs';
const markup = `<div id="presence" class="presence" data-state="boot" role="status" aria-label="Eyra 正在醒来">
            ${halo}
          </div>
          <span id="presence-glyph" class="role-instrument-glyph" aria-hidden="true" hidden></span>
          <img id="presence-avatar" alt="" aria-hidden="true" hidden />`;
// Vaya、Cota 用同一个光圈部件，样式规则也和 Eyra 是同一份。
export function mountRoleInstrument(node,role,doc=document){
 node.innerHTML=`<div class="presence role-instrument" data-state="thinking" role="status">${halo}</div><span class="role-instrument-glyph" aria-hidden="true"></span><img class="role-instrument-avatar" alt="" aria-hidden="true" hidden />`;
 const instrument=node.firstElementChild;instrument.dataset.role=role;
 return {instrument,glyph:node.querySelector('.role-instrument-glyph'),avatar:node.querySelector('.role-instrument-avatar')};
}
export function mountEyraInstrument(doc=document){doc.getElementById('eyra-trigger').innerHTML=markup;}
export function instrumentFrame(doc=document){
 const node=doc.getElementById('presence'),avatar=doc.getElementById('presence-avatar');
 return {data:Object.fromEntries(Object.entries(node.dataset).filter(([key])=>!key.startsWith('halo'))),label:node.getAttribute('aria-label'),code:node.querySelector('.halo-code')?.textContent||'',avatar:avatar.getAttribute('src')||'',avatarHidden:avatar.hidden,glyph:doc.getElementById('presence-glyph')?.textContent||''};
}
export function paintInstrument(value,doc=document){
 const node=doc.getElementById('presence'),avatar=doc.getElementById('presence-avatar');
 for(const key of Object.keys(node.dataset))if(!key.startsWith('halo')&&!Object.hasOwn(value.data||{},key))delete node.dataset[key];
 for(const [key,v]of Object.entries(value.data||{}))if(!key.startsWith('halo')&&node.dataset[key]!==v)node.dataset[key]=v;
 if(doc.body?.dataset.ringEffect)node.dataset.ringEffect=doc.body.dataset.ringEffect;
 if(node.getAttribute('aria-label')!==value.label)node.setAttribute('aria-label',value.label||'Eyra');
 const code=node.querySelector('.halo-code');if(code&&code.textContent!==value.code)code.textContent=value.code;
 // 没带 avatar 表示没变：头像是 data URL，只在变化时才传。
 if(value.avatar!==undefined){if(value.avatar){if(avatar.getAttribute('src')!==value.avatar)avatar.src=value.avatar;}else avatar.removeAttribute('src');}
 const glyph=doc.getElementById('presence-glyph');if(glyph){glyph.textContent=value.glyph||'';glyph.hidden=!value.glyph;}
 avatar.hidden=value.avatarHidden!==false;
}
