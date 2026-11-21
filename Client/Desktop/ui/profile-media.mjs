// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: state; profileMedia; fillRange; avatarPreviews; setupProfileMedia
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/profile-media.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 个人页的头像与背景：选择 → 裁切 → 预览。保存由 companion 统一提交（profileMedia() 合并进个人资料）。
import {cropImage} from './image-crop.mjs';
import {bindTidyRange} from './tidy-range.mjs';
import {pickTheme} from './theme-library.mjs';
import {mediaMenu,rotationControl} from './media-options.mjs';

const state={avatar:'',eyraAvatar:'',userRingColor:'#e6e9f0',background:'',backgroundBlur:0,backgroundOpacity:0,chatBlur:12,chatOpacity:.18,mediaRotation:{}};
export function profileMedia(){return structuredClone(state);}

// 滑动条已走过的部分用 --fill 着色（settings.css）。
export function fillRange(input){
 const min=Number(input.min||0),max=Number(input.max||100),value=Number(input.value);
 input.style.setProperty('--fill',(max>min?(value-min)/(max-min)*100:0).toFixed(1)+'%');
}

// 裁切时旁边按真实大小显示的样子（尺寸取当前外观）：Eyra 在聊天里和光圈里，你在聊天里。
function avatarPreviews(key){
 const px=name=>parseFloat(getComputedStyle(document.body).getPropertyValue(name))||0;
 if(key==='eyraAvatar')return [{label:'聊天与其他页面',size:Math.round(px('--eyra-avatar')||120),ring:true,effect:document.getElementById('eyra-ring-style')?.value||'pulse'}];
 return [{label:'聊天里',size:Math.round(px('--user-avatar')||80)}];
}

export function setupProfileMedia(api,check,{notice,changed=()=>{}}){
 const $=id=>document.getElementById(id);
 const cards=[['avatar','avatar-user','display-name','你'],['eyraAvatar','avatar-eyra','eyra-display-name','Eyra']];
 const rotations=[],menus=[],ranges=new Map();
 const generations={avatar:0,eyraAvatar:0,background:0},pending={avatar:0,eyraAvatar:0,background:0};
 const begin=key=>{pending[key]++;const stamp=++generations[key];paint();return stamp;};
 const finish=key=>{pending[key]--;paint();};
 function paint(){
  for(const [key,id,nameId,fallback] of cards){
   const src=state[key],img=$(id+'-img'),card=$(id).closest('.profile-card');
   if(src)img.src=src;else img.removeAttribute('src');img.hidden=!src;card.dataset.empty=String(!src);
   $(id+'-initial').textContent=key==='eyraAvatar'?'':[...(($(nameId).value||'').trim()||fallback)][0].toUpperCase();
   if(key==='avatar')$(id).style.setProperty('--identity-color',state.userRingColor);
  }
  for(const button of $('user-ring-colors').children)button.setAttribute('aria-pressed',String(button.dataset.color===state.userRingColor));
  const preview=$('background-preview');
  preview.dataset.empty=String(!state.background);
  preview.style.setProperty('--bg-image',state.background?'url("'+state.background+'")':'none');
  // 预览约为窗口的三分之一大小，模糊按比例缩小，观感与首页一致。
  preview.style.setProperty('--bg-blur',(state.backgroundBlur/3).toFixed(1)+'px');
  preview.style.setProperty('--bg-veil',String(state.backgroundOpacity));
  preview.style.setProperty('--bg-chat-blur',(state.chatBlur/3)+'px');preview.style.setProperty('--bg-chat-veil',String(state.chatOpacity));
  for(const [id,key,scale]of [['background-blur','backgroundBlur',1],['background-opacity','backgroundOpacity',100],['chat-blur','chatBlur',1],['chat-opacity','chatOpacity',100]]){if(!$(id))continue;$(id).value=String(Number((state[key]*scale).toFixed(2)));ranges.get(id)?.paint?.();fillRange($(id));}
  $('background-clear').disabled=!state.background&&state.mediaRotation.background?.mode!=='random'&&!pending.background;
  $('background-random').setAttribute('aria-busy',String(pending.background>0));
  for(const [key,id]of cards)$(id+'-source')?.setAttribute('aria-busy',String(pending[key]>0));
  for(const control of [...rotations,...menus])control.paint?.();
 }
 const update=patch=>{Object.assign(state,patch);paint();changed();};
 const setMedia=(key,value,rotation)=>update({[key]:value,mediaRotation:{...state.mediaRotation,[key]:rotation}});
 const resetMedia=(key,mode='off',value='')=>{generations[key]++;setMedia(key,value,{mode,intervalSeconds:state.mediaRotation[key]?.intervalSeconds||900,nextAt:0,id:'',digest:''});};
 const fromTheme=async key=>{const stamp=begin(key);try{const chosen=await pickTheme(api,{target:key});if(stamp===generations[key]&&chosen)setMedia(key,chosen.value,chosen.rotation);}finally{finish(key);}};
 const randomize=async (key,seconds)=>{const stamp=begin(key);try{const chosen=check(await api.themeLibrary({action:'prepare',target:key,mode:'random',intervalSeconds:seconds||state.mediaRotation[key]?.intervalSeconds||900,exclude_id:state.mediaRotation[key]?.id}));if(stamp===generations[key])setMedia(key,chosen.value,chosen.rotation);}catch(error){if(stamp===generations[key])throw error;}finally{finish(key);}};
 const addRotation=(key,host)=>rotations.push(rotationControl(host,{value:()=>state.mediaRotation[key],change:seconds=>update({mediaRotation:{...state.mediaRotation,[key]:{...state.mediaRotation[key],mode:'random',intervalSeconds:seconds,nextAt:Date.now()+seconds*1000}}})}));
 async function pick(key){
  const stamp=begin(key);
  try{
   const background=key==='background',result=check(await (background?api.chooseBackground():api.chooseAvatar()));
   if(result.cancelled||stamp!==generations[key])return;
   const cropped=background
    ?await cropImage(result.background,{title:'裁切背景',frame:[480,300],output:[1600,1000],type:'image/jpeg',quality:.86})
    :await cropImage(result.avatar,{title:key==='eyraAvatar'?'裁切 Eyra 的头像':'裁切你的头像',frame:[320,320],round:true,output:[160,160],previews:avatarPreviews(key)});
   if(cropped&&stamp===generations[key])resetMedia(key,'custom',cropped);
  }catch(error){if(stamp===generations[key])notice(error.message,true);}finally{finish(key);}
 }
 for(const [key,id,nameId] of cards){
  if($(id+'-source'))menus.push(mediaMenu($(id+'-source'),{value:()=>state.mediaRotation[key]||{mode:state[key]?'custom':'off'},theme:()=>fromTheme(key),random:seconds=>randomize(key,seconds),custom:()=>pick(key),remove:()=>resetMedia(key),error:text=>notice(text,true)}));
  $(nameId).addEventListener('input',paint);
  // 名字回车保存。
  $(nameId).addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();$(nameId).blur();$('save-profile').click();}});
 }
 $('background-choose').onclick=()=>fromTheme('background').catch(e=>notice(e.message,true));
 $('background-random').onclick=()=>randomize('background').catch(e=>notice(e.message,true));
 $('background-custom').onclick=()=>pick('background');
 $('background-clear').onclick=()=>resetMedia('background');
 addRotation('background',$('background-random-time'));
 for(const [id,key,scale,recommended]of [['background-blur','backgroundBlur',1,0],['background-opacity','backgroundOpacity',100,0],['chat-blur','chatBlur',1,12],['chat-opacity','chatOpacity',100,18]]){
  const input=$(id);if(!input)continue;
  ranges.set(id,bindTidyRange(input,{value:recommended,unit:scale===100?'%':'px'}));
  input.oninput=()=>update({[key]:Number((Number(input.value)/scale).toFixed(scale===100?4:2))});
 }
 return {setPalette(palette){
  const host=$('user-ring-colors');
  host.replaceChildren();
  for(const {name,color} of palette||[]){
   const button=document.createElement('button');
   button.type='button';button.dataset.color=color;button.title=name;
   button.style.setProperty('--swatch',color);
   button.setAttribute('aria-label',name);
   button.onclick=()=>update({userRingColor:color});
   host.append(button);
  }
  paint();
 },load(profile){
  for(const key of Object.keys(generations))generations[key]++;
  Object.assign(state,{avatar:profile.avatar||'',eyraAvatar:profile.eyraAvatar||'',userRingColor:profile.userRingColor||'#e6e9f0',background:profile.background||'',backgroundBlur:profile.backgroundBlur??0,backgroundOpacity:profile.backgroundOpacity??0,chatBlur:profile.chatBlur??12,chatOpacity:profile.chatOpacity??.18,mediaRotation:structuredClone(profile.mediaRotation||{})});
  paint();
 },rebase(previous,next){if(state.userRingColor===(previous.userRingColor||'#e6e9f0'))state.userRingColor=next.userRingColor||'#e6e9f0';for(const key of ['avatar','eyraAvatar','background'])if(state[key]===(previous[key]||'')&&JSON.stringify(state.mediaRotation[key])===JSON.stringify(previous.mediaRotation?.[key])){state[key]=next[key]||'';if(next.mediaRotation?.[key])state.mediaRotation[key]=structuredClone(next.mediaRotation[key]);else delete state.mediaRotation[key];}for(const [key,fallback]of [['backgroundBlur',0],['backgroundOpacity',0],['chatBlur',12],['chatOpacity',.18]])if(state[key]===(previous[key]??fallback))state[key]=next[key]??fallback;paint();},close(){for(const key of Object.keys(generations))generations[key]++;for(const menu of menus)menu.close();for(const control of rotations)control.close();for(const range of ranges.values())range?.close?.();}};
}
