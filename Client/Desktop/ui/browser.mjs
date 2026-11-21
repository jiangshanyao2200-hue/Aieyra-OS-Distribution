// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupBrowser
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/browser.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {workspaceBounds} from './workspace-slide.mjs';
import {el} from './views.mjs';
import {syncAttribute} from './interaction.mjs';

export function setupBrowser(api,navigation,doc=document,task=()=>undefined){
 if(typeof api.browserUser!=='function')return {close(){}};
 const $=id=>doc.getElementById(id),button=$('browser-bubble');
 let state={groups:[],count:0},selected='',signature='',paintKey='',layoutKey='',frame=0,closed=false,pendingPoll=null,pendingSelection='',chain=Promise.resolve(),busy=false,known=false,revision=0;
 const error=e=>{if(closed)return;$('browser-error').textContent=e?.message||String(e);if(!state.groups.length){$('browser-empty').hidden=false;$('browser-retry').hidden=false;}};
 async function command(args){const result=await api.browserUser({...args,task_id:task()});if(result?.ok===false)throw Error(result.error);return result;}
 function surface(){
  frame=0;if(closed)return;
  const group=state.groups.find(g=>g.id===selected),visible=!doc.querySelector('dialog:modal')&&navigation.is('browser-view')&&!!group&&!group.detached,r=workspaceBounds($('browser-surface'));
  const style=getComputedStyle(doc.body),variables=Object.fromEntries(['--ui-text','--ui-text-2','--ui-accent'].map(k=>[k,style.getPropertyValue(k).trim()]).filter(([,v])=>v));variables['--browser-font']=style.getPropertyValue('--os-interface-font').trim()||style.fontFamily;variables['--browser-size']=style.getPropertyValue('--os-interface-size').trim()||style.fontSize;
  const visibleGroups=selected===state.artifact_group_id?[selected]:state.groups.filter(g=>g.owner==='program/browser'&&!g.detached).map(g=>g.id);
  const payload={appearance:{variables,reduced:doc.body.classList.contains('reduce-motion')},visible:visible&&r.width>0&&r.height>0,bounds:{x:r.x,y:r.y,width:r.width,height:r.height},group_ids:[...new Set([selected,...visibleGroups])].filter(Boolean).slice(0,12)};if(pendingSelection){payload.select_group=pendingSelection;pendingSelection='';}
  const key=JSON.stringify(payload);if(key===layoutKey)return;layoutKey=key;
  chain=chain.catch(()=>{}).then(()=>api.browserSurface(payload)).then(result=>{if(result?.ok===false){layoutKey='';error(result.error);}}).catch(e=>{layoutKey='';error(e);});
 }
 function schedule(){if(!frame&&!closed)frame=requestAnimationFrame(surface);}
 function paint(next){
  if(closed)return;
  next={...next,groups:(next.groups||[]).filter(g=>g.owner==='program/browser'||g.id===next.artifact_group_id)};next.count=next.groups.reduce((sum,g)=>sum+g.count,0);state=next;const rows=next.groups;if(next.selected&&rows.some(g=>g.id===next.selected))selected=next.selected;else if(!rows.some(g=>g.id===selected))selected=rows[0]?.id||'';
  const key=JSON.stringify(rows.map(g=>[g.id,g.profile,g.profile_label,g.owner,g.count,g.detached]));
  const inBrowser=navigation.is('browser-view'),viewKey=JSON.stringify([key,selected,next.count,inBrowser,known]);if(viewKey===paintKey)return;paintKey=viewKey;
  button.title='浏览器'+(next.count?' · '+next.count+' 个标签':'');syncAttribute(button,'aria-current',navigation.is('browser-view')?'page':'false');
  if(key!==signature){signature=key;$('browser-groups').replaceChildren(...rows.map(g=>{const b=el('button',(g.profile==='default'?'默认身份':g.profile_label||g.profile)+' · '+g.count,'quiet');b.dataset.group=g.id;b.onclick=()=>{selected=g.id;pendingSelection=g.id;state.selected=g.id;paint(state);schedule();};return b;}));}
  const group=rows.find(g=>g.id===selected);$('browser-groups').hidden=rows.length<2;$('browser-empty').hidden=!group?.detached;
  $('browser-detached').hidden=!group?.detached;$('browser-placement').hidden=!group?.detached;
  if(!group&&known&&inBrowser)void act(openDefault);
  schedule();
 }
 async function act(fn){if(busy||closed)return;busy=true;$('browser-error').textContent='';$('browser-retry').hidden=true;try{await fn();await poll();}catch(e){error(e);}finally{busy=false;}}
 function poll(){if(closed)return Promise.resolve();if(pendingPoll)return pendingPoll;const ticket=revision;pendingPoll=api.browserStatus().then(next=>{if(!closed&&ticket===revision&&next?.ok!==false){known=true;paint(next);}}).catch(e=>{if(ticket===revision)error(e);}).finally(()=>{pendingPoll=null;});return pendingPoll;}
 async function openDefault(){if(state.groups.length)return;const next=await command({action:'open',profile:'default'});selected=next.selected;paint(next);}
 $('browser-retry').onclick=()=>act(openDefault);
 $('browser-placement').onclick=()=>act(async()=>{const group=state.groups.find(g=>g.id===selected);if(group)paint(await command({action:'placement',group_id:group.id,detached:false}));});
 button.onclick=()=>{navigation.open('browser-view','浏览器',{viewKey:'browser',toggle:true});paint(state);if(navigation.is('browser-view'))void poll();};
 const onView=()=>{paint(state);cancelAnimationFrame(frame);surface();};doc.addEventListener('workspace-view-change',onView);doc.addEventListener('workspace-modal-change',onView);
 const appearanceObserver=new MutationObserver(schedule);appearanceObserver.observe(doc.body,{attributes:true,attributeFilter:['class','style','data-os-appearance']});
 const resize=new ResizeObserver(schedule);resize.observe($('browser-surface'));window.addEventListener('resize',schedule);
 // Subscribe before the first read; an older read must not replace a newer event.
 const stopChanged=api.onBrowserChanged?.(next=>{if(closed||next?.ok===false)return;known=true;revision++;paint(next);});
 const timer=typeof api.onBrowserChanged==='function'?null:setInterval(poll,700);void poll();
 return {close(){closed=true;stopChanged?.();clearInterval(timer);cancelAnimationFrame(frame);resize.disconnect();appearanceObserver.disconnect();window.removeEventListener('resize',schedule);doc.removeEventListener('workspace-view-change',onView);doc.removeEventListener('workspace-modal-change',onView);void api.browserSurface({visible:false});}};
}
