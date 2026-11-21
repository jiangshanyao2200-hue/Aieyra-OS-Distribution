/* @file-map:start
文件: link/desktop/ui/native-overlays.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/workspace.mjs
链路: modal
验证: AIDEBUG/live-review.cjs, link/desktop/modal-aidebug.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  bindNativeOverlays | function
  bindNativeOverlays.paint | function
  bindNativeOverlays.sync | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// Native child views sit above the shell. Hold their actual last frame while a
// shell modal owns the top layer, then restore the live view after dismissal.
export /* @chain-region bindNativeOverlays | calls: document.getElementById, MutationObserver, observer.observe, sync, observer.disconnect */ function bindNativeOverlays(api){
 const frame=document.getElementById('native-office-frame');let desired=false,epoch=0;
 const /* @chain-region bindNativeOverlays.paint | calls: Promise, requestAnimationFrame */ paint=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 const /* @chain-region bindNativeOverlays.sync | calls: document.querySelector, document.body.classList.add, catch, api.officeOverlay, then, frame.decode, paint, document.body.classList.remove … */ sync=()=>{
  const next=!!document.querySelector('dialog[open]')&&!!document.querySelector('[data-tab="office"][aria-current="page"]');
  if(next===desired)return;desired=next;const current=++epoch;
  if(next){
   document.body.classList.add('native-overlay-pending');
   void(async()=>{
    const result=await api.officeOverlay('capture');if(current!==epoch||!desired)return;
    if(result.image){
      frame.src=result.image;
      const decoded=await frame.decode().then(()=>true,()=>false);
      if(current!==epoch||!desired)return;
      if(decoded){frame.hidden=false;await paint();if(current!==epoch||!desired)return;}
    }
    const committed=await api.officeOverlay('commit',result.generation);if(current!==epoch||!desired)return;
    document.body.classList.remove('native-overlay-pending');
    if(!committed.active)frame.hidden=true;
   })().catch(error=>{if(current!==epoch)return;document.body.classList.remove('native-overlay-pending');frame.hidden=true;console.error('native_overlay_failed',error.message);void api.officeOverlay('restore').catch(()=>{});});
  }else{
   document.body.classList.remove('native-overlay-pending');
   void api.officeOverlay('restore').then(async()=>{await paint();if(current===epoch){frame.hidden=true;frame.removeAttribute('src');}}).catch(error=>console.error('native_overlay_restore_failed',error.message));
  }
 };
 const observer=new MutationObserver(sync);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','aria-current']});sync();
 return ()=>{observer.disconnect();epoch++;};
}
