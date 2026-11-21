// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupMemorySettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/memory-settings.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {confirmDialog} from './contacts.mjs';
import {setupMemoryRecords} from './memory-records.mjs';

export function setupMemorySettings(api,{doc=document,check=value=>value}={}){
  const $=id=>doc.getElementById(id),editor=$('memory-context');
  if(!editor)return {open(){},close(){}};
  setupMemoryRecords(api,{doc,check});
  let state=null,busy=false,loading=0,visible=false,timer=null,closed=false,sequence=0,base='',baseSource='',cleanID='';
  const status=(text,error=false)=>{$('memory-status').textContent=text;$('memory-status').dataset.error=String(error);};
  const dirty=()=>editor.value!==base;
  function controls(){
    editor.readOnly=busy||!!loading;
    for(const id of ['memory-new','memory-switch','memory-save','memory-reset','memory-restore','memory-clean','memory-reload','memory-auto'])$(id).disabled=busy||!!loading||!state;
    for(const id of ['memory-new','memory-switch','memory-save','memory-reset','memory-restore','memory-auto'])$(id).disabled||=!!state?.busy;
    $('memory-clean').disabled||=['running','queued'].includes(state?.cleaning?.state);
    $('memory-cancel').hidden=!['running','queued'].includes(state?.cleaning?.state);
    $('memory-restore').disabled||=!state?.sessions?.find(s=>s.id===state.session_id)?.versions;
    $('memory-save').disabled||=!dirty()||state?.text_truncated===true;
    $('memory-apply-clean').disabled=busy||!!loading||!state||state.busy||state.changed||state.cleaning?.state!=='ready'||state.cleaning.source!==state.source;
  }
  function paint(next,replace=false){
    state=next;
    const selected=$('memory-session').value;
    $('memory-session').replaceChildren(...next.sessions.map(s=>{const option=doc.createElement('option');option.value=s.id;option.textContent=s.title+(s.id===next.session_id?' · 当前':'');return option;}));
    $('memory-session').value=next.sessions.some(s=>s.id===selected)?selected:next.session_id;
    if(replace||!dirty()){base=next.text||'';baseSource=next.source;editor.value=base;$('memory-auto').checked=next.auto_memory;}
    $('memory-overview').textContent=`对话历史 ${next.message_count} 条 · ${next.checkpoint?'已有压缩摘要':'未压缩'} · ${next.auto_memory?'自动带入长期记忆':'长期记忆仅按需检索'}${next.busy?' · 任务进行中，停止后可修改':''}${next.changed?' · 原对话已更新，请重新读取':''}${next.text_truncated?' · 内容过长，仅显示预览，请清洗后应用':''}`;
    const compact=next.compaction,labels={scheduled:'等待整理',running:'正在整理',completed:'整理已完成',skipped:'本次无需整理',deferred:'整理暂缓，原文保留',failed:'整理失败，原文保留',cancelled:'整理已停止',interrupted:'上次整理中断，结果需核对'};
    if(compact&&labels[compact.state])$('memory-overview').textContent+=` · ${labels[compact.state]}`;
    const clean=next.cleaning;
    if(clean?.state==='ready'&&clean.id!==cleanID){cleanID=clean.id;$('memory-clean-preview').value=clean.text;$('memory-clean-result').hidden=false;$('memory-clean-info').textContent=clean.source===next.source?'清洗草稿已就绪，可编辑后应用。':'清洗期间原对话已变化。草稿保留，请重新清洗或手动核对。';}
    if(clean?.state==='ready')$('memory-clean-info').textContent=!next.changed&&clean.source===next.source?'清洗草稿已就绪，可编辑后应用。':'清洗期间原对话已变化。草稿保留，请重新清洗或手动核对。';
    if(clean?.state==='ready'){
      const u=clean.usage,cache=u?.prompt_tokens_details?.cached_tokens??u?.prompt_cache_hit_tokens;
      $('memory-clean-info').textContent+=u?` 本次用量：输入 ${u.prompt_tokens}，输出 ${u.completion_tokens}，${cache==null?'缓存未报告':`缓存命中 ${cache}`}。`:' 本次用量未报告。';
    }
    $('memory-apply-clean').disabled=busy||next.busy||next.changed||clean?.state!=='ready'||clean.source!==next.source;
    if(clean?.state==='failed')status(clean.error||'清洗未完成，原上下文保持。',true);
    if(clean?.state==='cancelled')status('已停止清洗，原上下文保持。');
    $('memory-clean').textContent=clean?.state==='running'?'正在清洗…':'独立清洗';
    controls();
  }
  async function read(replace=false,brief=false){
    if(busy||loading)return;
    const ticket=++sequence;
    if(!brief){loading=ticket;controls();}
    try{const value=check(await api.context({action:brief?'status':'view'}));if(closed||ticket!==sequence)return;
      if(brief&&state){if(value.revision!==state.revision&&!dirty()&&!value.busy){await read(true);return;}paint({...state,busy:value.busy,cleaning:value.cleaning,compaction:value.compaction,changed:value.revision!==state.revision},false);}else paint(value,replace);}
    catch(error){if(!closed&&ticket===sequence)status(error.message,true);}
    finally{if(loading===ticket){loading=0;if(!closed)controls();}}
  }
  async function confirm(title,body,action){return confirmDialog({doc,title,body,action,danger:false});}
  async function mutate(action,extra={}){
    if(busy||loading||!state)return;
    sequence++;busy=true;controls();status('正在处理…');
    const source=action==='edit'?baseSource:state.source;
    try{const next=check(await api.context({action,source,...extra}));if(closed)return;paint(next,!['clean','cancel_clean'].includes(action));status(action==='clean'?'正在独立上下文中整理，完成后会显示草稿。':'已完成。原始记录及修改前版本已保留。');}
    catch(error){status(error.message+'；当前编辑内容已保留。',true);}
    finally{busy=false;if(!closed)controls();}
  }
  editor.addEventListener('input',()=>{controls();status(dirty()?'有未保存的上下文修改。':'');});
  $('memory-reload').onclick=async()=>{if(dirty()&&!await confirm('重新读取上下文','当前未保存的编辑将被重新读取的内容替换。','重新读取'))return;await read(true);};
  $('memory-new').onclick=async()=>{if(dirty()&&!await confirm('新建对话','当前编辑尚未保存。新对话使用空上下文，此前对话仍保留。','新建'))return;await mutate('new',{title:$('memory-title').value,auto_memory:false});};
  $('memory-switch').onclick=async()=>{if(dirty()&&!await confirm('切换对话','当前编辑尚未保存。','切换'))return;await mutate('switch',{id:$('memory-session').value});};
  $('memory-save').onclick=()=>mutate('edit',{text:editor.value,auto_memory:$('memory-auto').checked});
  $('memory-reset').onclick=async()=>{if(await confirm('重置当前上下文','清空下一次请求的对话历史和摘要，停止自动带入旧记忆。聊天记录和修改前版本保留。','重置上下文'))await mutate('reset',{auto_memory:false});};
  $('memory-restore').onclick=async()=>{if(await confirm('恢复上一个上下文版本','将切换到修改前的模型档案。当前版本也会保留。','恢复'))await mutate('restore');};
  $('memory-auto').onchange=async()=>{const requested=$('memory-auto').checked;if(dirty()){status('保存上下文时一并应用长期记忆选项。');return;}await mutate('memory',{auto_memory:requested});};
  $('memory-clean').onclick=()=>mutate('clean',{text:$('memory-clean-request').value});
  $('memory-cancel').onclick=()=>mutate('cancel_clean');
  $('memory-apply-clean').onclick=()=>mutate('edit',{source:state.cleaning.source,text:$('memory-clean-preview').value,auto_memory:false});
  async function poll(){if(closed||!visible)return;if(!busy&&!doc.hidden)await read(false,true);if(visible&&!closed)timer=setTimeout(poll,1500);}
  return {
    async open(){visible=true;clearTimeout(timer);if(!busy){if(!state)await read(true);else await read(false);}clearTimeout(timer);if(visible&&!closed)timer=setTimeout(poll,1500);},
    hide(){visible=false;clearTimeout(timer);},
    close(){closed=true;visible=false;sequence++;clearTimeout(timer);},
  };
}
