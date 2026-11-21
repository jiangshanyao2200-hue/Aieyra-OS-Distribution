// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat
// Regions: CHAT_LAYOUT; snapValue; normalizeChatLayout; readViewportScale; readViewportWidth; chatMargins; autoMargins; marginBindings; bindViewportMargins; applyChatLayout; bindChatBottomRoom; shownValue; slider; bindChatSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/chat-layout.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 外观里的尺寸与版面（存在个人资料的 chatLayout 里）：头像、名字、正文字号与行距、版面、光圈。
// 全部落成 body 上的 CSS 变量，forms.css 只读变量。字体、字重、间距、描边与阴影存在外观配置里（look.mjs）。
// 推荐尺寸来自用户当前选择，数值输入保留两位小数。
// Eyra 的 SVG 留出外圈空间，User 的头像与其内部图像等大。
import {fillRange} from './profile-media.mjs';
import {tidyValue,magneticValue,bindTidyRange} from './tidy-range.mjs';

import chatLayoutSchema from './chat-layout-schema.mjs';
export const CHAT_LAYOUT=chatLayoutSchema;

// 拖动接近推荐值或末位 0、5 的整数时磁吸；精确输入不经过此路径。
export function snapValue(f,raw){
 return magneticValue(raw,f);
}

// 纯函数：缺的用默认值，越界的夹回范围，停在工整的数上。旧版只有一个“名字字号”，两个名字都沿用它。
export function normalizeChatLayout(value={}){
 const source={...(value||{})};
 if(source.nameSize!==undefined){source.eyraName??=source.nameSize;source.userName??=source.nameSize;}
 const out={};
 for(const f of CHAT_LAYOUT){
  const raw=Number(source[f.key]);
  out[f.key]=Number.isFinite(raw)?tidyValue(raw,f):f.value;
 }
 // All Eyra placements use the chosen avatar size. The old independent ring
 // value remains readable in saved profiles but no longer changes a surface.
 out.ring=out.eyraAvatar;
 out.userAvatar=Number((out.eyraAvatar*.7).toFixed(2));
 return out;
}

// 窗口比例：缩窗口时尺寸跟着一起收（用户 2026-10-13 第 2 项）。
// 这里直接乘进数值（而不是写成 calc(...)），因为 plan-orb、subconscious、profile-media 都读这些变量的数字，
// 写成算式它们会读到 0，右侧栏会算错位置。
export function readViewportScale(root=globalThis.document?.body){
 // 浏览器之外（测试、工具）没有可读的样式：按 1 处理，尺寸就是用户设定的值。
 const css=root&&typeof globalThis.getComputedStyle==='function'?globalThis.getComputedStyle(root):null;
 if(!css)return 1;
 const value=parseFloat(css.getPropertyValue('--ui-scale'))||1;
 const zoom=parseFloat(css.getPropertyValue('--scale'))||1;
 return Math.min(2,Math.max(0.5,value*zoom));
}

// 取 CSS 视口宽度。优先使用所属文档的窗口，设置页预览和真实页面因此共用同一套计算；
// 工具/测试没有窗口时返回 0，自动留白退回 0，而不把旧配置里的不对称边距带回界面。
export function readViewportWidth(root=globalThis.document?.body){
 const doc=root?.ownerDocument||globalThis.document;
 const win=doc?.defaultView||globalThis;
 const candidates=[win?.innerWidth,doc?.documentElement?.clientWidth,root?.clientWidth];
 // 会话侧栏打开时把整体界面往右推，聊天列按剩下的宽度居中。
 const push=root&&root===doc?.body?parseFloat(doc.getElementById?.('screen')?.style?.getPropertyValue?.('--workspace-inset'))||0:0;
 for(const candidate of candidates){const n=Number(candidate);if(Number.isFinite(n)&&n>0)return Math.max(0,n-push);}
 return 0;
}

export function chatMargins(width,viewportWidth,position=50){
 const viewport=Number(viewportWidth);
 const room=Number.isFinite(viewport)&&viewport>0?Math.max(0,viewport-width):0;
 const left=Math.round(room*Math.min(100,Math.max(0,position))/100*2)/2,right=Math.max(0,room-left);
 return {left,right};
}
function autoMargins(style,width,viewportWidth,position=50){
 const margins=chatMargins(width,viewportWidth,position);
 style.setProperty('--chat-left',margins.left+'px');style.setProperty('--chat-right',margins.right+'px');
 return margins;
}

const marginBindings=new WeakSet();
function bindViewportMargins(style){
 const root=globalThis.document?.body,win=root?.ownerDocument?.defaultView;
 if(!root||style!==root.style||!win?.addEventListener||marginBindings.has(style))return;
 marginBindings.add(style);
 // viewport.mjs 只在比例改变时派发 os-scale。只改窗口宽度、比例仍相同的时候，
 // 已缩放的正文宽度无需重算，但左右留白必须随新窗口宽度更新。
 const refit=()=>autoMargins(style,parseFloat(style.getPropertyValue('--chat-max'))||0,readViewportWidth(root),Number(style.getPropertyValue('--chat-position')||50));
 root.ownerDocument.addEventListener('workspace-inset-change',refit);
 win.addEventListener('resize',()=>autoMargins(style,parseFloat(style.getPropertyValue('--chat-max'))||0,readViewportWidth(root),Number(style.getPropertyValue('--chat-position')||50)));
}

export function applyChatLayout(style,value,scale=readViewportScale(),viewportWidth=readViewportWidth()){
 const layout=normalizeChatLayout(value),shown={};
 for(const f of CHAT_LAYOUT){
  // 行距是无单位倍数，不缩放；其余按窗口比例收，取整到 0.5px 免得尺寸抖动。
  const n=f.unit==='px'?Number((layout[f.key]*scale).toFixed(2)):layout[f.key];
  shown[f.key]=n;style.setProperty(f.css,n+(f.unit==='px'?'px':''));
 }
 for(const [key,css] of [['eyraAvatar','--work-avatar'],['userAvatar','--work-user-avatar'],['eyraName','--work-name'],['userName','--work-user-name']])style.setProperty(css,shown[key]+'px');
 // Position distributes the space left by the chosen width. Narrow windows
 // naturally have no spare space, so horizontal positioning never clips text.
 const width=Number(shown.maxWidth)||0;
 const margins=autoMargins(style,width,viewportWidth,layout.position);
 shown.left=margins.left;shown.right=margins.right;
 bindViewportMargins(style);
 return shown;
}

// The scroll viewport ends above the entire input region, including attachments
// and queued messages. Measure against its parent: measuring the shortened
// scroller itself would create a ResizeObserver feedback loop.
export function bindChatBottomRoom(doc=globalThis.document){
 const win=doc?.defaultView,body=doc?.body;
 if(!win||!body||body.dataset.chatRoomBound)return;
 body.dataset.chatRoomBound='true';
 let frame=0,settlement=0,observedAnchor=null;
 const measure=()=>{
  frame=0;
  const program=body.dataset.programAgent==='true',scroller=program?doc.querySelector('.program-recent'):doc.getElementById('conversation')||doc.getElementById('conversation-scroll')||doc.querySelector('.program-recent'),bar=doc.getElementById('bottom-bar');
  if(!scroller)return;
  const readingStyle=win.getComputedStyle(scroller),available=Math.max(0,scroller.clientHeight-(parseFloat(readingStyle.paddingTop)||0)-(parseFloat(readingStyle.paddingBottom)||0)),workHeight=available+'px';
  const box=scroller.parentElement.getBoundingClientRect(),cover=bar&&bar.checkVisibility?.()!==false&&!bar.hidden?bar.getBoundingClientRect():null;
  // Align the input to the real avatar, including theme padding, scrollbar
  // gutters and translated workspace insets. Do not guess a second left edge.
  const workRows=[...scroller.querySelectorAll('.chat-entry[data-work=true]')];
  const visible=node=>node&&node.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})!==false;
  const homeAnchor=!program&&doc.getElementById('eyra-trigger'),workAnchor=scroller.querySelector('.chat-entry[data-work=true] > .role-ring');
  const anchor=visible(homeAnchor)?homeAnchor:visible(workAnchor)?workAnchor:[...scroller.querySelectorAll('.chat-entry > .role-ring')].findLast(visible);
  if(anchor!==observedAnchor){if(observedAnchor)observer.unobserve(observedAnchor);observedAnchor=anchor;if(anchor)observer.observe(anchor);}
  // Returning from settings also animates the existing presence ancestors.
  // Their final position need not resize the viewport or the capped composer.
  // Refit once those finite transitions finish, never to their temporary edge.
  const animations=new Set();
  for(let node=anchor;node&&node!==body;node=node.parentElement)for(const animation of node.getAnimations?.()||[])if(animation.playState==='running'&&Number.isFinite(animation.effect?.getComputedTiming().iterations))animations.add(animation);
  const token=++settlement;
  if(animations.size)void Promise.allSettled([...animations].map(a=>a.finished)).then(()=>{if(token===settlement)schedule();});
  let inputLeft=null;
  const axis=readingStyle.getPropertyValue?.('--chat-axis')?.trim(),avatarSize=readingStyle.getPropertyValue?.('--eyra-avatar')?.trim();
  if(cover&&bar.classList.contains('layered-chat-composer')&&body.dataset.chatExpanded!=='false'&&axis&&avatarSize&&scroller.checkVisibility?.()!==false){
   // Consume the very same column expression as the message grid. Briefs and
   // entering rings can shrink or move without moving the input's baseline.
   const reader=scroller.getBoundingClientRect(),left=parseFloat(win.getComputedStyle(bar).left);
   if(Number.isFinite(left))inputLeft='calc('+Math.round((left+reader.left+scroller.clientLeft+(parseFloat(readingStyle.paddingLeft)||0)-cover.left)*100)/100+'px + ('+axis+' - '+avatarSize+') / 2)';
  }else if(cover&&bar.classList.contains('layered-chat-composer')&&body.dataset.chatExpanded!=='false'&&!animations.size&&!anchor?.closest('[data-chat-moving=true]')&&(anchor||scroller.checkVisibility?.()===true)){
   // Before the first message, the avatar column already exists in the
   // retained reader. Use its actual content edge until an avatar is visible.
   const avatar=anchor?anchor.getBoundingClientRect():{left:scroller.getBoundingClientRect().left+scroller.clientLeft+(parseFloat(readingStyle.paddingLeft)||0),width:scroller.clientWidth},left=parseFloat(win.getComputedStyle(bar).left);
   if(avatar.width>0&&Number.isFinite(left)){
    inputLeft=Math.round((left+avatar.left-cover.left)*100)/100+'px';
   }
  }
  const room=cover&&cover.height?Math.max(0,Math.ceil(box.bottom-cover.top))+12:0;
  const value=room+'px';
  // Finish every geometry/style read before committing. These values belong
  // to their consumers, not body: footer animation must not wake unrelated
  // layout observers or invalidate the entire document's inherited style.
  const write=(node,key,value)=>{if(node&&node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);};
  if(!program)write(doc.getElementById('emergence'),'--chat-work-available-height',workHeight);
  for(const row of workRows)write(row,'--chat-work-available-height',workHeight);
  write(scroller,'--chat-bottom-inset',value);write(doc.getElementById('stage'),'--chat-bottom-inset',value);
  if(inputLeft!==null)write(bar,'--chat-input-left',inputLeft);
 };
 const schedule=()=>{if(!frame)frame=win.requestAnimationFrame(measure);};
 const observer=new win.ResizeObserver(schedule);
 const viewports=[doc.getElementById('conversation'),doc.getElementById('conversation-scroll'),doc.querySelector?.('.program-recent')].filter(Boolean);
 const entries=new win.MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.matches?.('.chat-entry'))))schedule();});
 for(const viewport of viewports){observer.observe(viewport);entries.observe(viewport,{childList:true,subtree:true,attributes:true,attributeFilter:['data-work','hidden']});}
 for(const id of ['bottom-bar','composer'])if(doc.getElementById(id))observer.observe(doc.getElementById(id));
 win.addEventListener('resize',schedule);
 new win.MutationObserver(schedule).observe(body,{attributes:true,attributeFilter:['class','style','data-form','data-chat-expanded','data-program-agent']});
 doc.addEventListener('workspace-inset-change',schedule);doc.addEventListener('os-scale',schedule);
 for(const event of ['workspace-view-change','workspace-form-change','workspace-theme-change'])doc.addEventListener(event,schedule);
 doc.addEventListener('transitionend',schedule,true);doc.addEventListener('animationend',schedule,true);
 doc.addEventListener('workspace-chat-layout-settled',schedule);
 schedule();
}

export const shownValue=(f,v)=>f.unit?v+' '+f.unit:f.step&&f.step<1?Number(v).toFixed(2):String(v);

// 一根滑条：拖动时吸附，右上角显示当前值，走过的部分点亮。
export function slider(doc,f,value,onInput){
 const label=doc.createElement('label'),name=doc.createElement('span'),input=doc.createElement('input'),output=doc.createElement('output');
 label.className='slider-field';name.textContent=f.label;label.append(name,input,output);
 if(f.legacy){
  // look.mjs 的字段表仍包含旧版左右边距；隐藏它们可保持存储兼容，同时确保设置页只有一根正文宽度滑条。
  label.hidden=true;label.dataset.legacy='true';input.tabIndex=-1;input.setAttribute('aria-hidden','true');
 }
 Object.assign(input,{type:'range',min:String(f.min),max:String(f.max),step:'.01',value:String(value)});
 const precise=bindTidyRange(input,{...f,output});
 const paint=v=>{input.value=String(v);precise.paint();fillRange(input);};
 input.oninput=()=>{const v=tidyValue(input.value,f);paint(v);onInput(v);};
 paint(value);
 return {label,input,paint};
}

// Native conversations and group pages use their actual reading column width,
// including when previews open. The profile remains the single layout source.
export function bindChatSurface(root,getProfile){
 const doc=root.ownerDocument,win=doc.defaultView;
 root.classList.add('chat-viewport');
 // Sizes inherit from the shared body profile, so work-state theme rules can
 // still override them. Only margins depend on this surface's actual width.
 const refresh=()=>{if(root.classList.contains('layered-chat-content')){root.style.removeProperty('--chat-left');root.style.removeProperty('--chat-right');return;}const layout=normalizeChatLayout(getProfile()?.chatLayout),scale=readViewportScale(doc.body);autoMargins(root.style,Math.round(layout.maxWidth*scale*2)/2,root.clientWidth,layout.position);};
 const observer=new win.ResizeObserver(refresh);observer.observe(root);
 win.addEventListener('os-scale',refresh);refresh();
 return {refresh,close(){observer.disconnect();win.removeEventListener('os-scale',refresh);}};
}
