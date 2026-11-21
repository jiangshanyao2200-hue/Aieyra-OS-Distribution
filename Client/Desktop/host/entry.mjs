// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: mountDesktop
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/entry.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {connectHalo} from '../../../Halo/runtime/desktop.mjs';
// Extension renderers mount only their own surface and restricted transport.
export async function mountDesktop({location=window.location,api=window.aieyra,extension=window.aieyraExtension,
  workspace=()=>import('../ui/app.mjs'),settings=()=>import('../ui/settings.mjs')}={}){
  if(typeof document!=='undefined'&&(api?.halo||extension?.halo))connectHalo(api?.halo?api:extension);
  const kind=new URL(location.href).searchParams.get('extension');
  if(new URL(location.href).searchParams.has('container'))return (await import('../ui/module-container.mjs')).mountContainer(api);
  if(kind==='contacts')return (await import('../ui/contacts-module.mjs')).mountContacts(extension);
  if(kind==='settings')return (await settings()).mountSettings(api,extension);
  if(kind!==null)throw Error('未知的扩展入口');
  return (await workspace()).mountWorkspace(api);
}
if(typeof window!=='undefined')await mountDesktop();
