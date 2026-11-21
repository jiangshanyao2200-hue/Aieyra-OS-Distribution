// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupExitAsk
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/exit-ask.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// All independent modules use the same exit choice.
// 询问由宿主发起（标题栏关闭、Alt+F4、任务栏关闭都会走到这里）；界面收到后立刻回报"已显示"，否则宿主 2 秒后照常退出。
export function setupExitAsk(api,doc=document){
 if(typeof api?.onExitAsk!=='function'||typeof api?.moduleExit!=='function')return {close(){}};
 const $=id=>doc.getElementById(id),dialog=$('exit-ask');
 if(!dialog)return {close(){}};
 let busy=false;
 const refresh=()=>doc.dispatchEvent(new (doc.defaultView?.Event||Event)('workspace-view-change'));
 dialog.addEventListener('close',refresh);
 const buttons=['exit-cancel','exit-os','exit-all'].map($);
 async function choose(mode){
  // 取消在本地立刻关窗，不等宿主回话。
  if(mode==='cancel'&&dialog.open)dialog.close();
  if(busy)return;busy=true;buttons.forEach(button=>{button.disabled=true;});
  try{const result=await api.moduleExit({mode});if(result?.ok===false)throw Error(result.error);if(dialog.open)dialog.close();}
  catch(error){$('exit-ask-text').textContent=error.message;}
  finally{busy=false;buttons.forEach(button=>{button.disabled=false;});if(mode==='cancel'&&dialog.open)dialog.close();}
 }
 $('exit-cancel').onclick=()=>void choose('cancel');
 $('exit-os').onclick=()=>void choose('os');
 $('exit-all').onclick=()=>void choose('all');
 // Esc 等同取消。
 dialog.addEventListener('cancel',event=>{event.preventDefault();void choose('cancel');});
 const stop=api.onExitAsk(value=>{
  const labels={browser:'浏览器',contacts:'联系人',settings:'设置',link:'Link'};
  const names=[...new Set((value?.modules||[]).map(id=>labels[id]||'对话与详情'))];
  $('exit-ask-text').textContent=(names.length?'仍在使用：'+names.join('、')+'。\n':'')+'只退出 OS：独立窗口继续使用，点 X 关闭各自窗口。\n全部退出：保存草稿并关闭本次运行的所有窗口。';
  if(!dialog.open)dialog.showModal();refresh();
  $('exit-os').focus();
  void api.moduleExit({mode:'shown'}).catch(()=>{});
 });
 return {close(){stop?.();dialog.removeEventListener('close',refresh);}};
}
