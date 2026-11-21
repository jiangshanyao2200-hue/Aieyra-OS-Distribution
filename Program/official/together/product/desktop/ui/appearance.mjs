/* @file-map:start
文件: link/desktop/ui/appearance.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/markdown.mjs, link/desktop/ui/wallpapers.mjs
上游: link/desktop/ui/index.html, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  Appearance | class
  Appearance.constructor | method
  Appearance.apply | method
  Appearance.save | method
  Appearance.setEnabled | method
  Appearance.schedule | method
  Appearance.next | method
  Appearance.toggleMenu | method
  Appearance.toggleMenu.snap | function
  Appearance.closeMenu | method
  Appearance.focusOption | method
  Appearance.selectMode | method
  Appearance.menuKey | method
  Appearance.syncControls | method
  Appearance.html | method
  Appearance.upload | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {wallpapers} from './wallpapers.mjs';

const storageKey='aieyra-link-appearance-v1';
export const defaults={mode:'plain',minutes:10,shade:68,motion:true,selected:'',custom:''};
const modes=[['random','官网随机'],['fixed','固定背景'],['custom','自选图片'],['plain','纯色']];
export /* @chain-region Appearance */ class Appearance{
 /* @chain-region Appearance.constructor | calls: root.querySelectorAll, JSON.parse, localStorage.getItem, apply, document.addEventListener, Date.now, next, event.target.closest … */ constructor(root,loadState=async()=>null){
  this.root=root;this.loadState=loadState;this.layers=[...root.querySelectorAll('img')];this.index=0;this.serial=0;this.enabled=false;this.current='';this.changedAt=0;
  try{this.settings={...defaults,...JSON.parse(localStorage.getItem(storageKey)||'{}')};}catch{this.settings={...defaults};}
  this.apply();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&this.enabled&&this.settings.mode==='random'&&Date.now()>=this.nextAt)void this.next();});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.background-select'))this.closeMenu();});
  document.addEventListener('keydown',event=>this.menuKey(event));
  window.addEventListener('resize',()=>this.closeMenu());
  document.addEventListener('scroll',event=>{const menu=document.getElementById('background-options');if(menu&&!menu.hidden&&!menu.contains(event.target))this.closeMenu();},true);
  document.addEventListener('close',event=>{if(event.target.contains?.(document.getElementById('background-options')))this.closeMenu();},true);
 }
 /* @chain-region Appearance.apply | calls: modes.some, Math.min, Math.max, Number, document.documentElement.style.setProperty, String */ apply(){
  const s=this.settings;
  if(!modes.some(([mode])=>mode===s.mode))s.mode=defaults.mode;
  s.minutes=Math.min(1440,Math.max(1,Number(s.minutes)||10));s.shade=Math.min(90,Math.max(35,Number(s.shade)||68));
  document.documentElement.style.setProperty('--wallpaper-shade',String(s.shade/100));
  document.documentElement.dataset.motion=s.motion?'full':'reduced';
 }
 /* @chain-region Appearance.save | calls: apply, localStorage.setItem, JSON.stringify, Error, some, next, schedule */ save(values,force=false){
  const previous=this.settings;this.settings={...previous,...values};this.apply();
  try{localStorage.setItem(storageKey,JSON.stringify(this.settings));}
  catch{this.settings=previous;this.apply();throw Error('设置未保存，请选择体积更小的背景图片。');}
  if(['mode','selected','custom'].some(key=>key in values&&previous[key]!==this.settings[key]))void this.next(force);
  else if('minutes' in values)this.schedule();
 }
 /* @chain-region Appearance.setEnabled | calls: root.classList.toggle, clearTimeout, next */ setEnabled(enabled){
  if(this.enabled===enabled)return;this.enabled=enabled;this.serial++;
  this.root.classList.toggle('enabled',enabled);clearTimeout(this.timer);
  if(enabled)void this.next();
 }
 /* @chain-region Appearance.schedule | calls: clearTimeout, Math.max, setTimeout, next, Date.now */ schedule(){
  clearTimeout(this.timer);this.nextAt=Math.max(this.changedAt+this.settings.minutes*60000,this.retryAt||0);
  if(this.enabled&&this.settings.mode==='random')this.timer=setTimeout(()=>{if(!document.hidden)void this.next();},Math.max(1000,this.nextAt-Date.now()));
 }
 /* @chain-region Appearance.next | calls: clearTimeout, root.classList.remove, loadState, Date.now, root.classList.contains, schedule, Set, Promise.race … */ async next(force=false){
  const serial=++this.serial,s={...this.settings};clearTimeout(this.timer);
  if(!this.enabled)return;
  if(s.mode==='plain'){this.root.classList.remove('has-image');this.current='';clearTimeout(this.timer);return;}
  let state=null;
  if(s.mode==='random'||s.mode==='fixed')try{state=await this.loadState({mode:s.mode,url:s.selected||wallpapers[0].url,minutes:s.minutes,force});}catch{}
  if(serial!==this.serial||!this.enabled)return;
  const source=s.mode==='custom'&&s.custom?s.custom:state?.url||'local:fallback';
  const image=s.mode==='custom'&&s.custom?s.custom:state?.data||'./backgrounds/fallback.webp';
  this.changedAt=state?.changedAt||Date.now();this.retryAt=state?.nextAt>this.changedAt+s.minutes*60000?state.nextAt:0;
  if(source===this.current&&this.root.classList.contains('has-image')){this.schedule();return;}
  for(const url of [...new Set([image,'./backgrounds/fallback.webp'])]){
   const next=this.layers[1-this.index],previous=this.layers[this.index];let timeout;
   try{
    next.src=url;await Promise.race([next.decode(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('image_timeout')),12000);})]);
    if(serial!==this.serial||!this.enabled)return;
    next.classList.add('visible');previous.classList.remove('visible');this.index=1-this.index;this.current=source;
    this.root.classList.add('has-image');this.schedule();return;
   }catch{if(serial!==this.serial)return;}finally{clearTimeout(timeout);}
  }
  this.retryAt=Date.now()+300000;this.schedule();
 }
 /* @chain-region Appearance.toggleMenu | calls: document.getElementById, closeMenu, button.getBoundingClientRect, Math.min, menu.showPopover, Math.max, snap, button.setAttribute … */ toggleMenu(){
  const menu=document.getElementById('background-options'),button=document.getElementById('background-mode');if(!menu||!button)return;
  if(!menu.hidden){this.closeMenu();return;}
  const rect=button.getBoundingClientRect(),edge=8,gap=8,scale=devicePixelRatio||1,/* @chain-region Appearance.toggleMenu.snap | calls: Math.round */ snap=value=>Math.round(value*scale)/scale;
  menu.style.width=Math.min(rect.width,innerWidth-edge*2)+'px';menu.hidden=false;menu.showPopover();
  const natural=menu.scrollHeight+menu.offsetHeight-menu.clientHeight,below=Math.max(0,innerHeight-rect.bottom-gap-edge),above=Math.max(0,rect.top-gap-edge);
  const down=below>=natural||below>=above,height=Math.min(natural,Math.max(below,above));
  menu.style.maxHeight=height+'px';menu.style.left=snap(Math.max(edge,Math.min(rect.left,innerWidth-rect.width-edge)))+'px';
  menu.style.top=snap(down?rect.bottom+gap:rect.top-gap-height)+'px';button.setAttribute('aria-expanded','true');
  this.focusOption(menu.querySelector('[aria-selected=true]'),menu);
 }
 /* @chain-region Appearance.closeMenu | calls: document.getElementById, menu.matches, menu.hidePopover, button.setAttribute, button.focus */ closeMenu(restore=false){
  const menu=document.getElementById('background-options'),button=document.getElementById('background-mode');
  if(menu){if(menu.matches(':popover-open'))menu.hidePopover();menu.hidden=true;}if(button)button.setAttribute('aria-expanded','false');if(restore&&button?.isConnected)button.focus({preventScroll:true});
 }
 /* @chain-region Appearance.focusOption | calls: option.focus */ focusOption(option,menu){
  if(!option)return;option.focus({preventScroll:true});
  if(option.offsetTop<menu.scrollTop)menu.scrollTop=option.offsetTop;
  else if(option.offsetTop+option.offsetHeight>menu.scrollTop+menu.clientHeight)menu.scrollTop=option.offsetTop+option.offsetHeight-menu.clientHeight;
 }
 /* @chain-region Appearance.selectMode | calls: save, syncControls, closeMenu */ selectMode(mode){this.save({mode});this.syncControls();this.closeMenu(true);}
 /* @chain-region Appearance.menuKey | calls: event.target.closest, select.querySelector, menu.querySelectorAll, includes, event.preventDefault, event.stopPropagation, toggleMenu, options.indexOf … */ menuKey(event){
  const select=event.target.closest('.background-select');if(!select)return;
  const menu=select.querySelector('[role=listbox]'),options=[...menu.querySelectorAll('[role=option]')];
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();event.stopPropagation();const wasClosed=menu.hidden;if(wasClosed)this.toggleMenu();
   let i=options.indexOf(document.activeElement);if(event.key==='Home')i=0;else if(event.key==='End')i=options.length-1;else if(!wasClosed)i=(i+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
   this.focusOption(options[Math.max(0,i)],menu);
  }else if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();this.closeMenu(true);}
  else if(event.key==='Tab')this.closeMenu();
 }
 /* @chain-region Appearance.syncControls | calls: document.getElementById, modes.find, forEach, document.querySelectorAll, node.setAttribute, String */ syncControls(){
  const s=this.settings,button=document.getElementById('background-mode');if(!button)return;
  button.dataset.value=s.mode;document.getElementById('background-mode-current').textContent=modes.find(([v])=>v===s.mode)[1];
  document.querySelectorAll('[data-background-mode]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.backgroundMode===s.mode)));
  document.querySelectorAll('[data-wallpaper]').forEach(node=>node.setAttribute('aria-pressed',String(s.mode==='fixed'&&s.selected===node.dataset.wallpaper)));
  document.getElementById('background-minutes').value=s.minutes;document.getElementById('background-shade').value=s.shade;document.getElementById('background-motion').checked=s.motion;
 }
 /* @chain-region Appearance.html | calls: modes.find, join, modes.map, wallpapers.map, e */ html(){
  const s=this.settings;
  return `<section class="system-settings-page"><div class="setting-row"><label id="background-mode-label" for="background-mode">背景</label><div class="background-select"><button type="button" id="background-mode" class="background-select-trigger" data-action="background-menu" data-value="${s.mode}" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="background-options" aria-labelledby="background-mode-label background-mode-current"><span id="background-mode-current">${modes.find(([v])=>v===s.mode)[1]}</span><svg class="background-select-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div id="background-options" class="background-options" popover="manual" role="listbox" aria-labelledby="background-mode-label" hidden>${modes.map(([v,t])=>`<button type="button" role="option" data-background-mode="${v}" aria-selected="${s.mode===v}" tabindex="-1"><span>${t}</span><span class="background-option-check" aria-hidden="true">✓</span></button>`).join('')}</div></div></div><div class="setting-row"><label for="background-minutes">自动更换</label><div><input id="background-minutes" data-setting="minutes" type="number" min="1" max="1440" value="${s.minutes}"><span>分钟</span></div></div><div class="setting-row"><label for="background-shade">背景遮罩</label><input id="background-shade" data-setting="shade" type="range" min="35" max="90" value="${s.shade}"></div><div class="setting-row"><label for="background-motion">流畅动效</label><input id="background-motion" data-setting="motion" type="checkbox" ${s.motion?'checked':''}></div><div class="settings-background-actions"><button class="secondary" data-action="background-next">换一张</button><label class="background-upload">选择本地图片<input type="file" id="custom-background" accept="image/png,image/jpeg,image/webp"></label></div><div class="wallpaper-gallery" aria-label="官网背景">${wallpapers.map((v,i)=>`<button data-wallpaper="${e(v.url)}" class="wallpaper-choice" aria-label="使用官网背景 ${i+1}" aria-pressed="${s.mode==='fixed'&&s.selected===v.url}"><img src="${e(v.thumbnail||v.url)}" alt="官网背景 ${i+1}" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div><div class="settings-footer"><span>背景来自 Aieyra OS 官网</span><button data-action="appearance-reset">恢复默认</button></div></section>`;
 }
 /* @chain-region Appearance.upload | calls: includes, Error, createImageBitmap, Math.min, document.createElement, Math.max, Math.round, drawImage … */ async upload(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG、JPEG 或 WebP 图片。');
  if(file.size>30*1024*1024)throw Error('请选择小于30MB的图片。');
  const bitmap=await createImageBitmap(file),scale=Math.min(1,2560/bitmap.width,1600/bitmap.height);
  try{const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);this.save({mode:'custom',custom:canvas.toDataURL('image/jpeg',.85)});}
  finally{bitmap.close();}
 }
}
