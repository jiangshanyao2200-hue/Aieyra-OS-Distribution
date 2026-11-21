// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: closeCurrent; openThemeShowcase
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/theme-showcase.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {app,call,el} from './app-shell.mjs';
import {scenes,states,totals} from '../../../Theme/showcase/catalog.mjs';
let closeCurrent=null;
export function openThemeShowcase(item){
 closeCurrent?.();
 const dialog=el('dialog','theme-showcase'),header=el('header','showcase-header'),controls=el('div','showcase-controls'),status=el('p','showcase-status'),stage=el('div','showcase-stage'),frame=el('iframe','showcase-frame'),channel=crypto.randomUUID();
 dialog.setAttribute('aria-label','主题组件与状态');status.setAttribute('role','status');frame.title='隔离的主题示例';frame.setAttribute('sandbox','allow-scripts allow-same-origin');
 const button=(label,work)=>{const b=el('button','pill',label);b.type='button';b.onclick=work;return b;};
 const select=(label,options)=>{const row=el('label','',label),s=el('select','field');for(const [id,name]of options){const option=el('option','',name);option.value=id;s.append(option);}row.append(s);controls.append(row);return s;};
 const scene=select('场景',scenes),state=select('状态',Object.entries(states)),width=select('宽度',[['full','铺满'],['680','680 px'],['360','360 px']]);
 const motion=el('label','', '减少动效'),reduced=el('input');reduced.type='checkbox';motion.prepend(reduced);controls.append(motion);
 let disposed=false,ready=false,previewId='',timer=0,generation=0,appearance=null,saved=null,mode='source',hostVisible=true,visible=!document.hidden;
 const seen={elements:new Set(),renderers:new Set(),surfaces:new Set()};
 const notice=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
 const render=()=>{if(!disposed&&ready&&appearance)frame.contentWindow.postMessage({channel,type:'render',scene:scene.value,state:state.value,reduced:reduced.checked,visible,appearance},'*');};
 const release=()=>{clearTimeout(timer);const id=previewId;previewId='';if(id)void call({action:'mod_theme_preview_close',preview_id:id}).catch(()=>{});};
 const reset=()=>{mode='default';++generation;release();if(saved){appearance={settings:saved.defaults,fields:saved.fields};render();notice('已恢复默认示例，当前主题未改变。');}};
 async function refresh(){
  mode='source';const own=++generation;release();const id=crypto.randomUUID();previewId=id;notice('正在准备示例…');
  try{
   const config=await call({action:'mod_theme_showcase_config'});if(disposed||own!==generation)return;saved=config;
   if(item){const result=await call({action:'mod_theme_preview',id:item.manifest.id,expected_digest:item.digest,preview_id:id});
    if(disposed||own!==generation){void call({action:'mod_theme_preview_close',preview_id:id}).catch(()=>{});return;}
    appearance={settings:{...config.defaults,layout_theme:result.selection},fields:config.fields};
    timer=setTimeout(()=>{reset();notice('预览已到期，已恢复默认示例；可重新载入。');},Math.max(0,result.expires_at-Date.now()));
   }else{previewId='';appearance={settings:config.settings,fields:config.fields};}
   render();notice(item?'包默认效果 · '+item.manifest.name:'当前外观 · 示例数据');
  }catch(error){if(!disposed&&own===generation){reset();notice(error.message,true);}}
 }
 function close(){if(disposed)return;disposed=true;++generation;release();unsubscribe?.();stopTheme?.();window.removeEventListener('message',message);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',close);frame.remove();if(dialog.open)dialog.close();dialog.remove();if(closeCurrent===close)closeCurrent=null;}
 function message(event){
  if(disposed||event.source!==frame.contentWindow||event.data?.channel!==channel)return;const data=event.data;
  if(data.type==='ready'){if(data.privileged){notice('预览隔离不可用',true);frame.remove();return;}ready=true;render();}
  if(data.type==='error')notice(String(data.error).slice(0,300)+'；可恢复默认或关闭。',true);
  if(data.type==='close')close();
  if(data.type==='coverage'){
   for(const key of ['elements','renderers'])for(const id of (Array.isArray(data[key])?data[key]:[]).slice(0,128))if(typeof id==='string'&&id.length<100)seen[key].add(id);
   if(data.scene?.startsWith('surface:'))seen.surfaces.add(data.scene.slice(8));
   const report={elements:seen.elements.size,renderers:seen.renderers.size,surfaces:seen.surfaces.size};dialog.dataset.coverage=JSON.stringify(report);
   footer.textContent=`全部为合成示例 · 已查看元件 ${report.elements}/${totals.elements}、内容组件 ${report.renderers}/${totals.renderers}、布局 ${report.surfaces}/${totals.surfaces}。布局样例不代表原生窗口验收。`;
  }
 }
 const visibility=()=>{visible=hostVisible&&!document.hidden;if(!visible&&dialog.open)reset();else render();};
 const unsubscribe=app.onVisibility?.(event=>{hostVisible=event?.visible!==false;visibility();});
 const stopTheme=app.on?.(event=>{if(event?.type==='theme'&&!item&&mode==='source'&&!disposed)void refresh();});
 header.append(el('strong','',item?'预览组件 · '+item.manifest.name:'组件与状态'),button('重新载入',()=>void refresh()),button('恢复默认',reset),button('关闭',close));
 const footer=el('p','showcase-footer','全部为合成示例；仅在此窗口预览。');stage.append(frame);dialog.append(header,controls,status,stage,footer);document.body.append(dialog);dialog.showModal();
 scene.onchange=state.onchange=reduced.onchange=render;width.onchange=()=>{frame.style.width=width.value==='full'?'100%':width.value+'px';};
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);window.addEventListener('message',message);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',close);
 closeCurrent=close;frame.src='theme-showcase-frame.html#'+channel;void refresh();
}
