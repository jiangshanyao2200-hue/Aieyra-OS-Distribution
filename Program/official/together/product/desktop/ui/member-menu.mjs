/* @file-map:start
文件: link/desktop/ui/member-menu.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  bindMemberMenu | function
  bindMemberMenu.close | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
export /* @chain-region bindMemberMenu | calls: document.createElement, menu.setAttribute, menu.append, document.body.append, document.addEventListener, event.target.closest, getState, event.preventDefault … */ function bindMemberMenu({getState,moderate}){
 const menu=document.createElement('div');menu.className='member-menu';menu.popover='auto';menu.setAttribute('role','menu');menu.setAttribute('aria-label','成员管理');
 const name=document.createElement('div');name.className='member-menu-name';menu.append(name);document.body.append(menu);
 let member;
 const /* @chain-region bindMemberMenu.close | calls: menu.matches, menu.hidePopover */ close=()=>{if(menu.matches(':popover-open'))menu.hidePopover();};
 document.addEventListener('contextmenu',event=>{
  const target=event.target.closest('[data-user-id]'),state=getState();
  if(!target||!state.access?.admin||target.dataset.userRole==='admin'||target.dataset.userId===state.access?.user?.id)return;
  event.preventDefault();close();
  member={id:target.dataset.userId,name:target.dataset.userName,muted:Number(target.dataset.userMuted)>Date.now()/1000,banned:target.dataset.userBanned==='true'};
  name.textContent=member.name;menu.querySelectorAll('button').forEach(n=>n.remove());
  for(const [action,label]of [[member.muted?'unmute':'mute',member.muted?'解除禁言':'禁言'],[member.banned?'unban':'ban',member.banned?'解除封禁':'封禁']]){
   const button=document.createElement('button');button.type='button';button.dataset.moderation=action;button.textContent=label;button.setAttribute('role','menuitem');if(action==='ban')button.className='danger';menu.append(button);
  }
  menu.showPopover();const r=menu.getBoundingClientRect(),anchor=target.getBoundingClientRect();
  const x=event.clientX||anchor.left,y=event.clientY||anchor.bottom;
  menu.style.left=Math.max(10,Math.min(x,innerWidth-r.width-10))+'px';menu.style.top=Math.max(10,Math.min(y,innerHeight-r.height-10))+'px';menu.querySelector('button').focus({preventScroll:true});
 });
 window.addEventListener('resize',close);
 document.addEventListener('scroll',event=>{if(!menu.contains(event.target))close();},true);
 menu.addEventListener('click',event=>{const button=event.target.closest('[data-moderation]');if(!button)return;const selected={...member};close();moderate(selected,button.dataset.moderation);});
 menu.addEventListener('keydown',event=>{const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}});
 return {close};
}
