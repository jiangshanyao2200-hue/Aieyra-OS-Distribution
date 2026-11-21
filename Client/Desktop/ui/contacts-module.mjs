// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: mountContacts
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/contacts-module.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupNavigation} from './navigation.mjs';
import {setupContacts} from './contacts.mjs';
import {subscribeWindowTheme} from './window-theme.mjs';
export async function mountContacts(api){
 document.body.classList.add('contacts-module');
 const navigation=setupNavigation();
 document.addEventListener('workspace-modal-change',event=>void api.modalSurface({open:event.detail.open}));
 const notice=text=>{const n=document.getElementById('notice');n.hidden=false;n.textContent=text;};
 let profile=(await api.profile()).profile||{};
 const contacts=setupContacts(api,navigation,{profile:()=>profile,onError:notice,restoreDrawer:false});
 const stopVisibility=api.onVisibility?.(value=>{if(value.visible)void contacts.store.refresh();});
 // This native page owns contacts and groups only. Retire the unused home
 // surfaces after binding navigation so a layout theme cannot reveal or move
 // their dormant toolbar, composer and live avatar into the group page.
 for(const id of ['status-anchor','screen','bottom-bar','os-home','status-rail','activity-orbits'])document.getElementById(id)?.remove();
 document.addEventListener('workspace-view-change',()=>void api.sessionFocus?.(navigation.is('group-view')?{kind:'group',id:contacts.groups.current}:{kind:'contacts'}));
 navigation.open('contacts-view','联系人');
 document.body.dataset.placement=(await api.describe()).placement;
 const theme=subscribeWindowTheme(api,document.body,{chat:true,onProfile:value=>{profile=value;document.dispatchEvent(new Event('chat-profile-changed'));}});await theme.refresh();
 api.onState?.(s=>{document.body.dataset.placement=s.placement;});
 window.addEventListener('beforeunload',()=>{stopVisibility?.();contacts.close();theme.close();},{once:true});
}
