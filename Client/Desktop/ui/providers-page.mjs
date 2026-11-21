// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: $; setupProviders
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/providers-page.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const $=id=>document.getElementById(id);
import { el, poolArea } from './pool-ui.mjs';
import { hoverCard, keyRow, openModelPicker, svg } from './model-ui.mjs';
// 供应商页（用户 2026-10-16）：只列名称一行，点开才显示它的 Key；每把 Key 可启用 / 禁用、单独获取模型列表（弹窗）。
// 官方 DeepSeek、阿里云百炼只填 Key；自定义填名称、地址、Key。Key 输入框只在提交时读一次，提交后立即清空。
export function setupProviders(ctx){
 let busy=false,adding='',expanded=new Set(),addForm=null,editing=null;
 const fetching=new Set();
 const status=(text,error=false)=>{$('providers-status').textContent=text||'';$('providers-status').classList.toggle('error',!!error);};
 const groups=view=>{const map=new Map();for(const c of view.connections.filter(c=>c.source==='provider')){if(!map.has(c.group))map.set(c.group,[]);map.get(c.group).push(c);}return [...map.values()];};
 function shown(focus){const box=$('providers-status');if(box?.classList.contains('error'))box.scrollIntoView({block:'nearest'});const node=focus&&$(focus);if(node&&!node.disabled&&(document.activeElement===document.body||!document.activeElement))node.focus({preventScroll:true});if(node&&document.activeElement===node)node.scrollIntoView({block:'nearest'});}
 // 错误提示先滚入视野，再保证要改的那一栏可见：矮窗放不下两者时，输入栏优先。
 async function guarded(fn){if(busy||editing)return;const focus=document.activeElement?.id;busy=true;paint();try{await fn();}catch(e){status(e.message,true);}finally{busy=false;paint();shown(focus);}}
 async function catalogFor(c){
  const r=await ctx.call({op:'catalog',connection_id:c.id,refresh:true});
  if(r.ok===false)throw Error(r.errors?.[0]||'模型列表获取失败');
  return {id:c.id,label:c.name+' ··'+(c.key_hint||''),models:r.models};
 }
 function picker(title,sources,id){
  openModelPicker({title,sources,opener:()=>[...$('providers-body').querySelectorAll('.key-line')].find(n=>n.dataset.keyId===id)?.querySelector('.key-line-fetch'),ctx:{
   test:(s,m)=>ctx.call({op:'test',connection_id:s.id,profile_id:m.pool_id||undefined,model:m.id,kind:m.kind}),
   add:async(s,m)=>{await ctx.call({op:'add',connection_id:s.id,model:m.id,kind:m.kind});},
   remove:async(s,m)=>{const entry=ctx.view().models.find(x=>x.connection_id===s.id&&x.model===m.id);if(entry)await ctx.call({op:'remove',id:entry.id});},
   onSave:()=>ctx.save?.('providers-status'),
  }});
 }
 async function fetchKey(c){
  if(editing||fetching.has(c.id))return;fetching.add(c.id);status('正在获取 '+c.name+' 的模型列表…');paint();
  try{const source=await catalogFor(c);status(source.models.length?'':'这把 Key 暂无可用模型');picker(c.name+' 模型列表',[source],c.id);}
  catch(e){status(e.message,true);}finally{fetching.delete(c.id);paint();}
 }
 // 移除要点两次（防误点）：第一次点，按钮原地变成“确认移除”并开始 6 秒倒计时；倒计时内再点才真正移除，过时自动复原。
 let armed='',armedTimer=0,armedAt=0;
 function disarm(){clearTimeout(armedTimer);if(armed){armed='';status('');paint();}}
 // scope 区分“移除这把 Key”与“移除供应商”：只有一把 Key 的供应商两者的 id 一样，不能一次点亮两个按钮。
 function removeKeys(ids,label,scope='key'){
  const view=ctx.view(),count=view.models.filter(m=>ids.includes(m.connection_id)).length,id=scope+':'+ids.join(',');
  if(armed!==id){
   clearTimeout(armedTimer);armed=id;armedAt=Date.now();armedTimer=setTimeout(disarm,6000);
   status(label+(count?'，会同时移出 '+count+' 个池内模型':'')+'。再点一次确认',true);paint();$('providers-body').querySelector('[data-armed=true]')?.focus();return;
  }
  clearTimeout(armedTimer);armed='';
  return guarded(async()=>{await ctx.call({op:'key_remove',connection_ids:ids});status('已移除');});
 }
 function toggle(c){
  return guarded(async()=>{
   const removed=c.enabled?ctx.view().models.filter(m=>m.connection_id===c.id).length:0;
   await ctx.call({op:'key_enabled',connection_id:c.id,enabled:!c.enabled});
   status(c.enabled?'已禁用这把 Key'+(removed?'，移出 '+removed+' 个模型':''):'已启用这把 Key');
  });
 }
 function keyForm(group){
  const first=group[0],input=el('input',{type:'password',class:'key-input',disabled:busy,placeholder:'粘贴新的 Key','aria-label':'新的 Key',autocomplete:'off',spellcheck:'false'});
  const save=el('button',{type:'button',class:'primary-pill',disabled:busy,onclick:()=>{const key=input.value;input.value='';return guarded(async()=>{await ctx.call({op:'key_add',preset:first.preset,existing:true,name:first.name,base_url:first.preset==='custom'?first.base_url:'',api_key:key});adding='';status('已添加 Key');});}},'添加');
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save.click();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();adding='';paint();}});
  queueMicrotask(()=>input.focus());
  return el('div',{class:'key-new'},input,save,el('button',{type:'button',class:'text-button',disabled:busy,onclick:()=>{adding='';paint();}},'取消'));
 }
 function closeEdit(){
  if(busy||!editing)return;const id=editing.id;editing.key.value='';editing=null;paint();
  [...$('providers-body').querySelectorAll('.key-line')].find(n=>n.dataset.keyId===id)?.querySelector('.key-line-edit')?.focus({preventScroll:true});
 }
 function openEdit(c){
  if(busy||editing||fetching.size)return;
  const snapshot=ctx.view();c=snapshot.connections.find(x=>x.id===c.id&&x.source==='provider');
  if(!c){status('原连接已被移除，请重新读取',true);return;}
  adding='';clearTimeout(armedTimer);armed='';status('');expanded.add(c.group);
  const select=el('select',{'aria-label':'编辑供应商平台'}),name=el('input',{'aria-label':'编辑供应商名称',autocomplete:'off',spellcheck:'false',maxlength:'80',value:c.name});
  const url=el('input',{type:'url','aria-label':'编辑接口地址',autocomplete:'off',spellcheck:'false',value:c.base_url});
  const key=el('input',{type:'password','aria-label':'新 Key（留空保留）',placeholder:'留空保留当前 Key',autocomplete:'new-password',spellcheck:'false'});
  const confirmed=el('input',{type:'checkbox','aria-label':'确认替换 Key'}),confirm=el('label',{class:'provider-edit-confirm',hidden:true},confirmed,'确认替换 Key');
  const note=el('p',{class:'provider-edit-note',role:'status'}),drafts=new Map();
  const e={id:c.id,baseline:c,version:snapshot.version,select,name,url,key,confirmed,confirm,note,drafts,stale:false};
  const presets=()=>{const rows=[...ctx.view().presets];for(const prior of [c,e.baseline])if(!rows.some(p=>p.id===prior.preset))rows.push({id:prior.preset,name:prior.name,base_url:prior.base_url});return rows;};
  const options=()=>{const value=select.value||e.baseline.preset;select.replaceChildren(...presets().map(p=>new Option(p.name,p.id)));select.value=value;};options();select.value=c.preset;
  const layout=()=>{const p=presets().find(p=>p.id===select.value);url.readOnly=!p?.editable_base&&p?.id!=='bailian';};layout();
  let previous=select.value;
  select.addEventListener('change',()=>{
   drafts.set(previous,{name:name.value,base_url:url.value});const p=presets().find(p=>p.id===select.value),saved=drafts.get(select.value);
   name.value=saved?.name??name.value;url.value=saved?.base_url??(select.value===e.baseline.preset?e.baseline.base_url:p?.base_url||url.value);previous=select.value;layout();
  });
  key.addEventListener('input',()=>{confirmed.checked=false;confirm.hidden=!key.value.trim();});
  const save=el('button',{type:'button',class:'primary-pill provider-edit-save',onclick:async()=>{
   if(busy||editing!==e||e.stale)return;
   const secret=key.value,replace=!!secret.trim();
   if(replace&&!confirmed.checked){note.textContent='请确认替换 Key，或清空以保留当前 Key。';confirmed.focus();return;}
   const patch={api_key:secret};if(name.value!==e.baseline.name)patch.name=name.value;if(url.value!==e.baseline.base_url)patch.base_url=url.value;
   const request={op:'key_edit',connection_id:e.id,preset:select.value,expected_version:e.version,patch,replace_key:replace};
   // Keep the original version; a stale editor must never auto-retry its patch.
   key.value='';confirmed.checked=false;confirm.hidden=true;busy=true;note.textContent='正在保存…';paint();
   try{const r=await ctx.call(request,false,false);const current=r.connections.find(x=>x.id===e.id);if(current)expanded.add(current.group);editing=null;status('供应商连接已保存');}
   catch(error){e.stale=error.code==='version_conflict';note.textContent=e.stale?'配置已变化，草稿已保留。重新读取后核对再保存。':error.message+'；草稿已保留，新 Key 请重新填写。';}
   finally{busy=false;paint();if(editing===e)note.scrollIntoView({block:'nearest'});}
  }},'保存');
  const reload=el('button',{type:'button',class:'glass-pill provider-edit-reload',hidden:true,onclick:async()=>{
   if(busy||editing!==e)return;busy=true;paint();
   try{
    const r=await ctx.call({op:'view'},false,false),latest=r.connections.find(x=>x.id===e.id&&x.source==='provider');
    if(!latest){note.textContent='原连接已被移除，请取消；不会重新创建。';return;}
    const before=e.baseline,values={preset:select.value,name:name.value,base_url:url.value};e.baseline=latest;options();
    select.value=values.preset===before.preset?latest.preset:values.preset;previous=select.value;
    name.value=values.name===before.name?latest.name:values.name;url.value=values.base_url===before.base_url?latest.base_url:values.base_url;
    key.value='';confirmed.checked=false;confirm.hidden=true;e.version=r.version;e.stale=false;layout();note.textContent='已读取最新配置，草稿仍保留；请核对后保存。';
   }catch(error){note.textContent=error.message;}
   finally{busy=false;paint();}
  }},'重新读取');
  const cancel=el('button',{type:'button',class:'text-button',onclick:closeEdit},'取消');
  e.node=el('div',{class:'provider-edit',role:'group','aria-label':'编辑供应商连接'},el('div',{class:'add-line'},el('label',{class:'add-preset'},'平台',select),el('label',{class:'add-name'},'名称',name),el('label',{class:'add-url'},'地址',url),el('label',{class:'add-key'},'新 Key',key)),confirm,note,el('div',{class:'provider-edit-actions'},save,reload,cancel));
  e.controls=()=>{for(const n of e.node.querySelectorAll('input,select,button'))n.disabled=busy;save.disabled=busy||e.stale;reload.hidden=!e.stale;};
  e.node.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeEdit();}else if(event.key==='Enter'&&event.target.matches('input:not([type=checkbox])')){event.preventDefault();save.click();}});
  editing=e;paint();name.focus({preventScroll:true});
 }
 function providerKey(c){
  const line=keyRow({id:c.id,name:c.name,mask:c.key_mask,enabled:c.enabled,meta:c.models?c.models+' 个在池':'',disabled:busy||!!editing,fetching:fetching.has(c.id),onToggle:()=>toggle(c),onFetch:()=>fetchKey(c),armed:armed==='key:'+c.id,onRemove:()=>removeKeys([c.id],'移除这把 Key','key')});
  line.dataset.editable='true';line.insertBefore(el('button',{type:'button',class:'text-button key-line-edit','aria-label':'编辑 '+c.name,disabled:busy||!!editing||fetching.size>0,onclick:()=>openEdit(c)},'编辑'),line.querySelector('.key-line-x'));
  return editing?.id===c.id?[line,editing.node]:[line];
 }
 function card(group){
  const first=group[0],gid=first.group,open=expanded.has(gid)||group.some(c=>editing?.id===c.id);
  const on=group.filter(c=>c.enabled).length,pooled=group.reduce((n,c)=>n+c.models,0);
  const head=el('button',{type:'button',class:'provider-row','aria-expanded':String(open),disabled:busy||!!editing,onclick:()=>{open?expanded.delete(gid):expanded.add(gid);paint();}},
   el('span',{class:'provider-chevron'},svg('chevron')),
   el('strong',{text:first.name}),
   el('span',{class:'provider-sum',text:group.length+' 把 Key'+(on<group.length?' · '+(group.length-on)+' 把禁用':'')+(pooled?' · '+pooled+' 个在池':'')}));
  const body=open?el('div',{class:'provider-keys'},
   ...group.flatMap(providerKey),
   adding===gid?keyForm(group):el('div',{class:'provider-actions'},
    el('button',{type:'button',class:'text-button',disabled:busy||!!editing,onclick:()=>{adding=gid;paint();}},'+ Key'),
    el('button',{type:'button',class:'text-button danger provider-remove',disabled:busy||!!editing,dataset:{armed:String(armed==='group:'+group.map(c=>c.id).join(','))},onclick:()=>removeKeys(group.map(c=>c.id),'移除 '+first.name,'group')},armed==='group:'+group.map(c=>c.id).join(',')?'确认移除供应商':'移除供应商'))):null;
  return el('div',{class:'provider-card',dataset:{open:String(open)}},head,body);
 }
 // 添加供应商：一行。官方只填 Key；自定义填名称、地址、Key。
 function addArea(view){
  const presets=view.presets,select=el('select',{id:'provider-preset','aria-label':'供应商'});
  for(const p of presets)select.append(new Option(p.name,p.id));
  select.value=$('provider-preset')?.value||presets[0]?.id;
  const preset=()=>presets.find(p=>p.id===select.value)||presets[0];
  const name=el('input',{id:'provider-name',placeholder:'名称','aria-label':'供应商名称',autocomplete:'off',spellcheck:'false',maxlength:'40'});
  const url=el('input',{id:'provider-url',type:'url',placeholder:'https://…/v1','aria-label':'接口地址',autocomplete:'off',spellcheck:'false'});
  const key=el('input',{id:'api-key',type:'password',placeholder:'粘贴 Key','aria-label':'API Key',autocomplete:'off',spellcheck:'false'});
  const nameField=el('label',{class:'add-name'},'名称',name),urlField=el('label',{class:'add-url'},'地址',url);
  const layout=()=>{const p=preset();nameField.hidden=p.id!=='custom';urlField.hidden=!p.editable_base;};
  select.addEventListener('change',layout);layout();
  const submit=el('button',{type:'button',id:'provider-add-submit',class:'primary-pill',disabled:busy,onclick:()=>{
   const value=key.value,p=preset(),label=name.value,address=p.editable_base?url.value:'';
   if(!value.trim()){status('先粘贴这个供应商的 Key',true);key.focus({preventScroll:true});shown('api-key');return;}
   key.value='';
   return guarded(async()=>{
    await ctx.call({op:'key_add',preset:p.id,name:label,base_url:address,api_key:value});
    if($('provider-name'))$('provider-name').value='';if($('provider-url'))$('provider-url').value='';
    const added=ctx.view().connections.filter(c=>c.source==='provider').at(-1);if(added)expanded.add(added.group);
    status('已添加 '+(p.id==='custom'?(label||'供应商'):p.name));
   });
  }},'添加');
  key.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit.click();}});
  return el('div',{class:'settings-area provider-add'},el('div',{class:'add-line'},el('label',{class:'add-preset'},'供应商',select),nameField,urlField,el('label',{class:'add-key'},'Key',key),submit));
 }
 function paint(){
  const view=ctx.view();if(!view)return;
  const focused=editing?.node.contains(document.activeElement)?document.activeElement:null;
  const caret=focused&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
  const models=view.models.filter(m=>m.source==='provider'),list=groups(view);
  if(!addForm){addForm=addArea(view);$('provider-add-area').replaceChildren(addForm);}
  $('providers-body').replaceChildren(...(list.length?[el('div',{class:'settings-area provider-list'},...list.map(card))]:[]));
  if(editing&&!list.some(group=>group.some(c=>c.id===editing.id))){editing.stale=true;editing.note.textContent='原连接已被移除，请取消；不会重新创建。';$('providers-body').append(editing.node);}
  // Body controls are rebuilt with their own eligibility (enabled/fetching).
  // Only the persistent add form needs its busy/editing state updated in place.
  for(const e of addForm.querySelectorAll('input,select,button'))e.disabled=busy||!!editing;
  editing?.controls();
  for(const b of $('providers-body').querySelectorAll('[data-armed=true]'))b.style.setProperty('--arm-delay',-(Date.now()-armedAt)+'ms');
  $('providers-pool').replaceChildren(poolArea({title:'供应商模型池',models,disabled:busy||!!editing,empty:list.length?'暂无模型':'添加供应商后可获取模型',onRemove:m=>ctx.remove(m,'providers-status'),decorate:hoverCard}));
  if(focused?.isConnected&&!focused.disabled){focused.focus({preventScroll:true});if(caret)focused.setSelectionRange(...caret);}
 }
 return {paint,reset(){if(editing)editing.key.value='';editing=null;adding='';clearTimeout(armedTimer);armed='';status('');}};
}
