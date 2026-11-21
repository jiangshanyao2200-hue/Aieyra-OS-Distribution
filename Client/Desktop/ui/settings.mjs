// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupSettingsWindow; mountSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/settings.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupSettingsController,checkSettings} from './settings-controller.mjs';
import {setupScrollEdges} from './scroll-edges.mjs';
import {subscribeWindowTheme} from './window-theme.mjs';

// Window relocation preserves the renderer. Remember only a DOM focus path;
// drafts, selected layers, scroll and in-flight saves remain with their editor.
export function setupSettingsWindow(api,extension,{doc=document,notice=()=>{},onVisibility=()=>{}}={}){
  const $=id=>doc.getElementById(id),pane=$('onboarding'),placement=$('settings-extension-placement');
  const stops=[];let descriptor=null,closed=false,focus=null,moving=false;
  function remember(){
    const node=doc.activeElement;
    if(!pane.contains(node)&&!node?.closest?.('dialog[open],.image-crop'))return;
    focus={node,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection};
  }
  function restore(){
    const saved=focus,active=doc.activeElement;
    if(closed||!saved?.node.isConnected||saved.node.disabled||!(active===doc.body||active===placement||active===$('close-onboarding')||active===$('close-window')||active===saved.node))return;
    saved.node.focus({preventScroll:true});
    if(typeof saved.start==='number')saved.node.setSelectionRange(saved.start,saved.end,saved.direction);
  }
  function state(value){
    if(closed||!value)return;descriptor=value;doc.body.dataset.placement=value.placement;
    const detached=value.placement==='detached';placement.textContent=detached?'放回':'独立';placement.setAttribute('aria-label',detached?'放回设置页面':'拆出为独立窗口');
    doc.body.style.setProperty('--settings-overlay-space',(detached?0:value.overlayClearance?.bottom||0)+'px');
    doc.body.dataset.overlayWide=String(!detached&&value.overlayClearance?.wide===true);
    $('settings-extension-position').textContent=detached?'独立窗口':'设置';
  }
  const failure=error=>{if(!closed)notice(String(error.message||error),true);};
  async function hide(){remember();try{checkSettings(await extension.hide());}catch(error){failure(error);}}
  const onFocus=()=>remember();pane.addEventListener('focusin',onFocus);
  const onPointer=()=>remember();$('status-anchor').addEventListener('pointerdown',onPointer,{capture:true});
  placement.onclick=async()=>{
    if(moving)return;moving=true;placement.disabled=true;
    try{state(checkSettings(await (descriptor?.placement==='detached'?extension.dock():extension.detach())));restore();}
    catch(error){failure(error);}finally{moving=false;placement.disabled=false;}
  };
  $('settings-extension-home').onclick=()=>Promise.resolve(extension.focusMain()).then(checkSettings).catch(failure);
  $('close-onboarding').onclick=hide;$('close-window').onclick=hide;
  $('minimize-window').onclick=()=>Promise.resolve(api.minimizeWindow()).then(checkSettings).catch(failure);
  $('maximize-window').onclick=()=>Promise.resolve(api.toggleMaximize()).then(checkSettings).catch(failure);
  const onKey=event=>{
    if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
    if([...doc.querySelectorAll('dialog[open]')].some(node=>node!==pane)||doc.querySelector('.glass-select[aria-expanded=true]'))return;
    event.preventDefault();void hide();
  };
  doc.addEventListener('keydown',onKey);
  stops.push(extension.onState(state),extension.onVisibility(value=>{
    if(closed)return;const changed=doc.body.dataset.visible!==String(value.visible===true);doc.body.dataset.visible=String(value.visible===true);
    if(changed)onVisibility(value.visible===true);
    if(value.visible)restore();else remember();
  }));
  return {
    async initialize(){state(checkSettings(await extension.describe()));doc.body.dataset.visible=String(descriptor.visible===true);},
    close(){if(closed)return;closed=true;for(const stop of stops)stop?.();pane.removeEventListener('focusin',onFocus);$('status-anchor').removeEventListener('pointerdown',onPointer,true);doc.removeEventListener('keydown',onKey);},
  };
}

export async function mountSettings(api,extension){
  const $=id=>document.getElementById(id);
  document.title='设置 · Aieyra';document.body.classList.add('settings-extension');
  document.body.dataset.view='onboarding';document.body.dataset.desktopPage='settings';
  // Reuse the fixed DOM and styles, without mounting any of its workspace
  // consumers or giving the unused task controls an interactive surface.
  const pane=$('onboarding'),surface=$('view-surface');
  $('view-content').append(pane);pane.classList.add('workspace-view');pane.hidden=false;
  for(const node of [...document.body.children])if(![surface,$('status-anchor')].includes(node)&&node.tagName!=='SCRIPT'){
    if(node.id!=='restore-prompts-dialog'){node.hidden=true;node.inert=true;}
  }
  for(const id of ['desktop-dock','session-indicators','usage-anchor','system-slot','view-heading']){$(id).hidden=true;$(id).inert=true;}
  $('brand-title').textContent='设置';$('settings-extension-actions').hidden=false;surface.hidden=false;
  // Use the shared close action inside the actual titlebar stacking context.
  // A fixed button inside the lower settings surface is covered by that bar.
  $('close-window').before($('close-onboarding'));$('close-window').hidden=true;
  pane.show();
  const notice=(text,error=false)=>{const node=$('settings-extension-status');node.textContent=text;node.dataset.error=String(error);};
  const controller=setupSettingsController(api,{notice}),windowControls=setupSettingsWindow(api,extension,{notice,onVisibility:visible=>controller.visibility(visible)});
  const theme=subscribeWindowTheme(api,document.body,{onProfile:value=>{void controller.refreshProfile(value).catch(error=>notice(error.message,true));}});
  const stopScroll=setupScrollEdges();
  window.addEventListener('beforeunload',()=>{windowControls.close();controller.close();stopScroll();theme.close();},{once:true});
  try{
    await windowControls.initialize();
    await controller.initialize(checkSettings(await api.settingsBootstrap()));
    await theme.refresh();
    $('status-anchor').dataset.ready='true';
  }catch(error){notice(error.message,true);}
}
