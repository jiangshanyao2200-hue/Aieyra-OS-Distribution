// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: canPreviewMedia; setupMediaViewer
// Impact: python -B scripts/code-atlas.py show Theme/runtime/media.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindThemeRenderer} from './layout.mjs';

// The host owns asset verification. Theme owns presentation and retains the
// original media node, playback position and controls across layout changes.
export const canPreviewMedia=a=>a?.kind==='file'&&/\.(wav|webm|mp4|m4a)$/i.test(a.name||'');
export function setupMediaViewer({read,subscribeVisibility,document:doc=document}){
 const win=doc.defaultView,viewer=doc.createElement('dialog');viewer.className='media-viewer';viewer.setAttribute('aria-label','音视频预览');
 viewer.innerHTML='<header class="media-heading"><strong class="media-title"></strong><button type="button" class="media-close" aria-label="关闭音视频预览">×</button></header><div class="media-content"><p class="media-status" role="status"></p></div><footer class="media-controls"><button type="button" class="media-play">播放</button><input class="media-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="播放位置"><output class="media-time">0:00 / 0:00</output><button type="button" class="media-mute" aria-pressed="false">静音</button></footer>';
 viewer.dataset.contentSchema='aieyra.content.media/1';doc.body.append(viewer);
 const $=selector=>viewer.querySelector(selector),content=$('.media-content'),status=$('.media-status'),play=$('.media-play'),seek=$('.media-seek'),mute=$('.media-mute');
 let media=null,url='',release=null,epoch=0,current=null,returnFocus=null,visible=true,disposed=false;
 const time=value=>{const n=Number.isFinite(value)?Math.max(0,Math.floor(value)):0;return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
 function paint(){
  const ready=!!media&&media.readyState>0&&!media.error;
  play.disabled=mute.disabled=!ready;seek.disabled=!ready||!Number.isFinite(media.duration)||media.duration<=0;
  play.textContent=media&&!media.paused?'暂停':'播放';mute.textContent=media?.muted?'取消静音':'静音';mute.setAttribute('aria-pressed',String(!!media?.muted));
  seek.max=String(ready&&Number.isFinite(media.duration)?media.duration:0);seek.value=String(media?.currentTime||0);
  $('.media-time').textContent=time(media?.currentTime)+' / '+time(media?.duration);
 }
 function unload(){
  if(media){media.pause();media.removeAttribute('src');media.load();media.remove();media=null;}
  if(url){win.URL.revokeObjectURL(url);url='';}
  paint();
 }
 function pause(){media?.pause();paint();}
 function close(){
  ++epoch;unload();release?.();release=null;current=null;status.replaceChildren();
  if(viewer.open)viewer.close();
  if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;
 }
 function failure(message){
  unload();viewer.dataset.mediaKind='error';status.textContent=message;const retry=doc.createElement('button');retry.type='button';retry.className='media-retry';retry.textContent='重试';retry.onclick=()=>load();status.append(' ',retry);
 }
 async function load(){
  const own=++epoch;unload();viewer.dataset.mediaKind='pending';status.textContent='正在打开…';
  try{
   const result=await read(current);
   if(own!==epoch||!viewer.open||disposed)return;
   if(result?.ok===false)throw Error(result.error);
   if(!['audio/wav','video/webm','video/mp4','audio/mp4'].includes(result?.mime)||!(result.bytes instanceof Uint8Array)||result.bytes.length>32*1024*1024)throw Error('音视频快照无效');
   const kind=result.mime.startsWith('audio/')?'audio':'video',player=doc.createElement(kind);media=player;viewer.dataset.mediaKind=kind;player.className='media-player';player.preload='metadata';player.playsInline=true;player.setAttribute('aria-label',current.name);
   url=win.URL.createObjectURL(new win.Blob([result.bytes],{type:result.mime}));player.src=url;content.prepend(player);
   const update=()=>{if(own===epoch&&media===player){if(player.readyState>0)status.textContent='';paint();}};
   for(const event of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','volumechange'])player.addEventListener(event,update);
   player.addEventListener('play',()=>{if(!visible||doc.hidden)player.pause();});
   player.addEventListener('error',()=>{if(own===epoch&&media===player)failure('此音视频无法解码，附件原件仍保留。');},{once:true});
   paint();
  }catch(error){if(own===epoch&&viewer.open&&!disposed)failure(error.message);}
 }
 async function show(attachment){
  if(disposed)return;
  if(!viewer.open){returnFocus=doc.activeElement;release=bindThemeRenderer(viewer,'aieyra.content.media/1',{heading:$('.media-heading'),content,controls:$('.media-controls')});viewer.showModal();}
  current={...attachment};$('.media-title').textContent=attachment.name;await load();
 }
 play.onclick=async()=>{const player=media,own=epoch;if(!player)return;if(!player.paused){pause();return;}try{await player.play();}catch(error){if(own===epoch&&media===player){status.textContent='播放失败：'+error.message;paint();}}};
 seek.oninput=()=>{if(media&&!seek.disabled)media.currentTime=Number(seek.value);paint();};
 mute.onclick=()=>{if(media)media.muted=!media.muted;paint();};
 $('.media-close').onclick=close;
 viewer.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close();});
 viewer.addEventListener('close',()=>{if(!viewer.open&&current)close();});
 const visibility=()=>{if(doc.hidden)pause();};doc.addEventListener('visibilitychange',visibility);
 const unsubscribe=subscribeVisibility?.(value=>{visible=value?.visible!==false;if(!visible)pause();});
 const dispose=()=>{if(disposed)return;close();disposed=true;unsubscribe?.();doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',dispose);viewer.remove();};
 win.addEventListener('pagehide',dispose);paint();
 return {show,close,pause,dispose,viewer};
}
