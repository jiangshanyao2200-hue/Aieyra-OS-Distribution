// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ACTIVE_TEAM_ROLES; ROLE_DEFAULTS; LEGACY_NAMES; taskViewProfile; roleIdentity; createRoleRing; paintRoleRing
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/role-identity.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {mountHaloInstrument,paintHaloState} from '../../../Halo/official/instrument.mjs';
import {effect} from '../../../Halo/official/effects.mjs';
export const ACTIVE_TEAM_ROLES=['matrix','project','execution'];
// project 是 Vaya，execution 是助理 Cota。
// 姓名与光圈已表达身份；无自定义头像时不再叠加字母占位。
export const ROLE_DEFAULTS={matrix:{name:'Eyra',ring:'pulse',glyph:''},project:{name:'Vaya',ring:'pulse',glyph:''},execution:{name:'Cota',ring:'pulse',glyph:''},subconscious:{name:'潜意识',ring:'pulse',glyph:''}};
// 旧版默认名（莹、Nova）存进过个人资料；它们不是用户起的名字，按新默认显示。
const LEGACY_NAMES={project:'莹',execution:'Nova'};
// Task snapshots reuse the matrix renderer; their identity belongs to the
// selected instance, never to the user's saved Eyra profile.
export function taskViewProfile(profile={},snapshot,{history=false}={}){
 const id=snapshot?.session_id;
 if(!history&&id&&id===snapshot.root_id&&snapshot.identity?.phase==='active'&&snapshot.identity.name)return {...profile,eyraName:snapshot.identity.name+' · Eyra'};
 if(!id||!snapshot.root_id||id===snapshot.root_id)return profile;
 const task=snapshot.tasks?.find(t=>t.id===id);
 if(!task||task.primary||task.independent)return profile;
 return {...profile,eyraName:task.title||'Agent',eyraAvatar:'',roles:{...profile.roles,matrix:{ring:'pulse'}}};
}
export function roleIdentity(profile={},role='matrix'){
 const saved=profile.roles?.[role]||{},base=ROLE_DEFAULTS[role]||{name:role,ring:'pulse',glyph:''};
 const named=saved.name&&saved.name!==LEGACY_NAMES[role]?saved.name:'';
 return {role,name:role==='matrix'?profile.eyraName||base.name:named||base.name,avatar:role==='matrix'?profile.eyraAvatar||'':saved.avatar||'',ring:effect(saved.ring,base.ring),glyph:base.glyph};
}
export function createRoleRing(identity,{doc=document,state='idle',toolEffect='generic',live=false,interactive=false}={}){
 const node=doc.createElement(interactive?'button':'span');node.className='role-ring';if(interactive)node.type='button';
 paintRoleRing(node,identity,state,doc,{toolEffect,live});return node;
}
export function paintRoleRing(node,identity,state='idle',doc=document,{toolEffect='generic',live=false}={}){
 mountHaloInstrument(node);
 node.dataset.role=identity.role;node.dataset.ringEffect=identity.ring;node.dataset.haloLive=String(live||state!=='idle');
 const visual=paintHaloState(node,state,toolEffect);node.setAttribute('aria-label',identity.name+(visual.title?' · '+visual.title:''));
 const key=identity.avatar+'|'+identity.glyph;if(node.dataset.identity!==key){node.dataset.identity=key;node.querySelector(':scope > .role-face')?.remove();const face=doc.createElement(identity.avatar?'img':'span');face.className='role-face';if(identity.avatar){face.src=identity.avatar;face.alt='';}else face.textContent=identity.glyph;node.append(face);}
}
