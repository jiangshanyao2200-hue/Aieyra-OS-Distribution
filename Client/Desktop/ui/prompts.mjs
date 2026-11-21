// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: LAYER_HINTS; layerState; setupPromptSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/prompts.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import { trimScrollFragments } from './scroll-edges.mjs';
import { tabKeyboard } from './interaction.mjs';
// 每一层一句说明，帮你判断该改哪一层。
const LAYER_HINTS = { self: '她是谁，怎么和你说话。', work: '怎么做事，怎么交付结果。', boundary: '什么不做，怎么保护你和你的资料。', thinking: '遇到问题时怎么想。' };
const layerState = (layer) => layer.draft !== layer.text ? '未保存' : layer.source === 'default' ? '官方默认' : layer.exists ? '自定义' : '空';
export function setupPromptSettings(api, check, {doc=document}={}) {
  const $ = (id) => doc.getElementById(id);
  let layers = [], directory = '', selected = 'self', busy = false, closed = false;
  const builtin = 'eyra';
  const stash = () => { const layer = layers.find((x) => x.id === selected); if (layer && layer.draft.replace(/\r\n?/g, '\n') !== $('prompt-editor').value) layer.draft = $('prompt-editor').value; };
  const status = (saved = false) => {
    const layer = layers.find((x) => x.id === selected);
    if (layer) $('prompt-status').textContent = layer.draft === layer.text ? (saved ? '已保存，下一次请求生效' : layer.source === 'default' || layer.exists ? '' : '此层为空') : '尚未保存';
  };
  const paintLayers = () => {
    for(const button of $('prompt-layers').children){
      const item=layers.find(x=>x.id===button.dataset.id),active=button.dataset.id===selected;
      button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
      if(item){button.querySelector('.layer-state').textContent=layerState(item);button.dataset.dirty=String(item.draft!==item.text);}
    }
  };
  const display = () => {
    const layer = layers.find((x) => x.id === selected);
    if (!layer) return;
    $('prompt-title').textContent = layer.title;
    $('prompt-editor').value = layer.draft;
    // 程序改值不触发 input：下一帧按新内容重算上下渐变（Codex D1）。
    globalThis.requestAnimationFrame?.(() => trimScrollFragments($('prompt-editor')));
    $('restore-prompt').disabled = busy || !layer.defaultAvailable;
    $('restore-prompt').textContent = '恢复默认';
    paintLayers();
    status();
  };
  function paintTabs(){
    $('prompt-layers').replaceChildren(...layers.map(layer=>{
      const b=doc.createElement('button'),name=doc.createElement('span'),state=doc.createElement('small');name.textContent=layer.title;state.className='layer-state sr-only';state.textContent=layerState(layer);
      b.type='button';b.title=LAYER_HINTS[layer.id]||'';b.append(name,state);b.dataset.id=layer.id;b.setAttribute('role','tab');b.setAttribute('aria-label',layer.title);b.setAttribute('aria-controls','prompt-editor');
      b.onclick=()=>{if(busy)return;stash();selected=layer.id;display();};return b;
    }));
  }
  async function load() {
    if (busy) return;
    busy = true; $('prompt-editor').disabled = true; $('save-prompt').disabled = true;
    try {
      const result = check(await api.builtinRole({action:'read',builtin}));if(closed)return;
      directory=result.prompt_directory||'';
      layers=result.prompts.map(x=>({...x,draft:x.text}));
      if (!layers.some(x => x.id === selected)) selected = layers[0]?.id;
      paintTabs();
      display();
    } catch (error) { $('prompt-status').textContent = error.message; }
    finally { busy = false; $('prompt-editor').disabled = false; $('save-prompt').disabled = false; $('restore-prompt').disabled = !layers.find(x => x.id === selected)?.defaultAvailable; }
  }
  // 设置页签的显隐由 companion 统一管理（它会改写页签的 onclick）；这里在提示词区域出现时惰性读取。
  tabKeyboard($('prompt-layers'));
  const loadWhenShown = () => { if (!$('prompt-settings').hidden && !layers.length && !busy) load(); };
  const observer=typeof MutationObserver==='function'?new MutationObserver(loadWhenShown):null;observer?.observe($('prompt-settings'),{attributes:true,attributeFilter:['hidden']});
  loadWhenShown();
  $('prompt-editor').oninput = () => { stash(); status(); paintLayers(); };
  $('save-prompt').onclick = async () => {
    if (busy) return;
    stash(); const layer = layers.find((x) => x.id === selected); if (!layer) return;
    busy = true; $('save-prompt').disabled = true;
    try {
      const submitted=layer.draft;
      // Save the user's explicit edit against the latest version of this
      // layer. Other profile fields and other layer drafts keep their owners.
      // The host backs up the replaced bytes and still commits with file CAS.
      let result;
      for(let attempt=0;attempt<2;attempt++){
        const current=check(await api.builtinRole({action:'read',builtin}));
        if((current.prompt_directory||'')!==directory)throw Error('提示词目录已切换，请返回当前目录后保存');
        const next=current.prompts.find(x=>x.id===layer.id);if(!next)throw Error('当前提示词层暂不可用');
        try{result=check(await api.builtinRole({action:'save',builtin,profile_version:current.profile_version,prompts:[{id:layer.id,text:submitted,version:next.version}]}));break;}
        catch(error){if(attempt||!/提示词.*已变化|version.conflict/i.test(error.message))throw error;}
      }
      if(closed)return;
      for(const next of result.prompts){const old=layers.find(x=>x.id===next.id);if(!old)continue;const draft=old.id===layer.id?(old.draft===submitted?next.text:old.draft):(old.draft===old.text?next.text:old.draft);Object.assign(old,next,{draft});}
      paintLayers();
      status(selected === layer.id);
      // 保存回执滚到光圈之上（滚动区带 scroll-padding）。
      $('prompt-status').scrollIntoView?.({ block: 'nearest' });
    } catch (error) { if (selected === layer.id) $('prompt-status').textContent = error.message + '；当前编辑内容已保留。'; }
    finally { busy = false; $('save-prompt').disabled = false; }
  };
  $('restore-prompt').onclick = async () => {
    if(busy)return;stash();
    $('restore-prompts-status').textContent='';
    const dialog=$('restore-prompts-dialog');if(!dialog.open)dialog.showModal();
  };
  $('cancel-restore-prompts').onclick=()=>$('restore-prompts-dialog').close();
  $('confirm-restore-prompts').onclick=async()=>{
    if(busy)return;busy=true;$('confirm-restore-prompts').disabled=true;
    try{
      const result=check(await api.restoreAllPrompts({directory,confirmed:true,layers:layers.map(x=>({id:x.id,version:x.version,defaultVersion:x.defaultVersion}))}));
      layers=result.layers.map(x=>({...x,draft:x.text}));display();$('restore-prompts-dialog').close();$('prompt-status').textContent='已恢复系统默认；原自定义内容已备份。';
    }catch(error){$('restore-prompts-status').textContent=error.message+'；未保存编辑仍保留。';}
    finally{busy=false;$('confirm-restore-prompts').disabled=false;$('restore-prompt').disabled=!layers.every(x=>x.defaultAvailable);}
  };
  return {close(){closed=true;observer?.disconnect?.();}};
}
