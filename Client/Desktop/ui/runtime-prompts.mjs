// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupRuntimePrompts
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/runtime-prompts.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {confirmDialog} from './contacts.mjs';
export function setupRuntimePrompts(api,{doc=document,check=value=>value}={}){
  const parent=doc.getElementById('prompt-settings');if(!parent)return;
  const box=doc.createElement('details');box.className='settings-area runtime-prompts';
  box.innerHTML='<summary>运行说明与辅助提示词</summary><p class="memory-hint">工具协定、记忆整理及辅助请求使用的外置文件。保存后，下一次读取该文件的请求生效。</p><label>提示词文件<select aria-label="运行提示词文件"></select></label><p class="runtime-prompt-path"></p><textarea aria-label="运行提示词正文" spellcheck="false"></textarea><div class="memory-row"><button type="button" class="quiet runtime-prompt-reload">重新读取</button><button type="button" class="runtime-prompt-save">保存文件</button></div><p role="status" aria-live="polite"></p>';
  parent.append(box);const select=box.querySelector('select'),editor=box.querySelector('textarea'),status=box.querySelector('[role=status]'),save=box.querySelector('.runtime-prompt-save'),reload=box.querySelector('.runtime-prompt-reload');let current=null,busy=false,reading=false,loaded=false;
  // Textareas normalize CRLF on Windows; the raw-file version still guards saves.
  const normalized=value=>({...value,text:value.text.replace(/\r\n?/g,'\n')});
  const controls=()=>{select.disabled=reload.disabled=busy;editor.readOnly=reading||!current;save.disabled=busy||!current||editor.value===current.text;};
  async function read(file){if(busy)return;busy=reading=true;controls();try{current=normalized(check(await api.runtimePrompts({action:'read',file})));select.value=current.file;editor.value=current.text;box.querySelector('.runtime-prompt-path').textContent=current.path;status.textContent='';}catch(e){if(current)select.value=current.file;status.textContent=e.message;}finally{busy=reading=false;controls();}}
  async function discard(){return !current||editor.value===current.text||await confirmDialog({doc,title:'离开未保存的提示词',body:'当前编辑尚未保存。',action:'继续',danger:false});}
  select.onchange=async()=>{const next=select.value;if(await discard())await read(next);else if(current)select.value=current.file;};
  reload.onclick=async()=>{if(await discard())await read(select.value);};editor.oninput=controls;
  save.onclick=async()=>{if(busy||!current)return;busy=true;controls();const submitted=editor.value;try{current=normalized(check(await api.runtimePrompts({action:'save',file:current.file,version:current.version,text:submitted})));status.textContent=editor.value===submitted?'已保存，修改前版本已备份。':'已保存，仍有新的编辑尚未保存。';}catch(e){status.textContent=e.message;}finally{busy=false;controls();}};
  box.addEventListener('toggle',async()=>{if(!box.open||loaded||busy)return;busy=true;controls();try{const result=check(await api.runtimePrompts({action:'list'}));select.replaceChildren(...result.files.map(row=>{const option=doc.createElement('option');option.value=row.file;option.textContent=row.file;return option;}));loaded=true;}catch(e){status.textContent=e.message;}finally{busy=false;controls();}if(loaded&&select.value)await read(select.value);});controls();
}
