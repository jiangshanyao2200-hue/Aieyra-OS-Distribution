// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: $; names; withoutOfficial; setupConnection
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/connection.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const $=id=>document.getElementById(id);
import { setupAccount } from './account.mjs';
import { setupProviders } from './providers-page.mjs';
import { el, modelSelect } from './pool-ui.mjs';
import { hoverCard } from './model-ui.mjs';
import { compactPosition, compactValue, contextPresets, COMPACT_MIN, COMPACT_MAX } from './model-context.mjs';
import { bindTidyRange } from './tidy-range.mjs';
// 设置 · 模型（2026-10-14）：Aieyra API、供应商、模型连接三页。用户只配模型池和基础模型，其余交给 Agent。
// 三页共用一份后端视图（src/model-setup.cjs 的 view）；每次修改带版本号，改完整页重画。
const names={enabled:'开启',disabled:'关闭',none:'关闭',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'极致',auto:'自动',adaptive:'自适应',true:'开启',false:'关闭'};
function withoutOfficial(view){
 const connections=view.connections.filter(c=>c.source!=='aieyra');
 const models=view.models.filter(m=>m.source!=='aieyra');
 const retained=new Set(models.map(m=>m.id));
 const roles={...view.roles};
 for(const key of ['matrix_profile','subconscious_profile','vision_profile','execution_profile','video_profile']){
  if(!retained.has(roles[key]))roles[key]='';
 }
 for(const key of ['matrix_alternates','image_profiles'])roles[key]=roles[key].filter(id=>retained.has(id));
 roles.image_generation_enabled=roles.image_profiles.length>0;
 return {...view,connections,models,roles};
}
export function setupConnection(api,check,onSaved){
 let view=null,version='',loading=null,busy=false,contextSaving=null,accountID='',accountRevision=0;
 const contextPending=new Map(),contextFailures=new Map();
 const pages={};
 function receive(r,paint,notify){
  const mainBefore=view?.roles.matrix_profile;
  view=accountID?r:withoutOfficial(r);version=r.version;
  if(paint)paintAll();
  if(notify&&mainBefore!==undefined&&mainBefore!==view.roles.matrix_profile)void onSaved?.({quiet:true});
 }
 // 每次修改都表达用户的意图（加入、移除、指定），不依赖旧页面状态；配置在别处刚写过时重新读取后自动再试一次。
 async function call(p,retry=true,paint=true){
  const revision=accountRevision;
  let r=await api.onboard({action:'pool',...(p.op==='view'||p.op==='catalog'?{}:{expected_version:version}),...p});
  if(revision!==accountRevision)return r;
  if(r?.ok===false&&r.code==='version_conflict'){await load(paint);if(retry&&revision===accountRevision)return call(p,false,paint);throw Object.assign(Error('配置刚刚在别处改过，已重新读取，请再试一次'),{code:'version_conflict'});}
  check(r);
  if(r.version)version=r.version;
  if(r.models&&r.connections)receive(r,paint,true);
  return r;
 }
 async function load(paint=true){
  if(loading)return loading;
  const revision=accountRevision;
  const task=Promise.resolve().then(async()=>{
   const r=await api.onboard({action:'pool',op:'view'});
   if(revision===accountRevision)receive(check(r),paint,false);
  }).finally(()=>{if(loading===task)loading=null;});
  loading=task;return task;
 }
 function accountChanged(id){
  if(id===accountID)return;
  accountID=id;
  const revision=++accountRevision,started=!!view||!!loading;
  loading=null;
  if(view){view=withoutOfficial(view);paintAll();}
  if(started)void load().catch(error=>{if(revision===accountRevision)setStatus('aieyra-status',error.message,true);});
 }
 async function remove(m,statusId){
  try{await call({op:'remove',id:m.id});setStatus(statusId,'已移出 '+m.name);}catch(e){setStatus(statusId,e.message,true);}
 }
 function setStatus(id,text,error=false){const n=$(id);if(!n)return;n.textContent=text||'';n.classList.toggle('error',!!error);}
 // 保存：每次修改已经带版本号落盘；这里重新读取一次确认落盘内容。反馈就在按钮上（变成“已保存”），不另弹提示。
 async function save(statusId){
  try{while(contextSaving)await contextSaving;if(contextFailures.size)throw Error([...contextFailures.values()][0]);await load();setStatus(statusId,'');void onSaved?.({quiet:true});return true;}catch(e){setStatus(statusId,e.message,true);return false;}
 }
 // 保存按钮原地变成“已保存”，一秒半后复原；失败时按钮轻轻一颤，原因写在左边状态里。
 function flash(button,ok){
  clearTimeout(button._flash);button.dataset.saved=ok?'true':'false';
  button.dataset.label??=button.textContent;if(ok)button.textContent='已保存';
  button._flash=setTimeout(()=>{delete button.dataset.saved;button.textContent=button.dataset.label;},ok?1600:600);
 }
 const ctx={view:()=>view,call,remove,save,accountChanged};
 for(const button of document.querySelectorAll('[data-clear-source]'))button.onclick=async()=>{
  if(button.disabled)return;const source=button.dataset.clearSource,status=source==='aieyra'?'aieyra-status':'providers-status';
  const count=view?.models.filter(m=>m.source===source).length||0;if(!count){setStatus(status,'模型池已为空');return;}
  button.disabled=true;
  try{
   const {confirmDialog}=await import('./contacts.mjs');
   if(!await confirmDialog({title:'清空'+(source==='aieyra'?' Aieyra ':'供应商')+'模型池？',body:'移出 '+count+' 个模型，保留账号、Key 和连接。',action:'清空'}))return;
   while(contextSaving)await contextSaving;
   await call({op:'clear',source});setStatus(status,'已清空模型池');void onSaved?.({quiet:true});
  }catch(error){setStatus(status,error.message,true);}finally{button.disabled=false;}
 };
 for(const button of document.querySelectorAll('#onboarding .settings-save[data-save]'))button.addEventListener('click',async()=>{if(button.disabled)return;button.disabled=true;button.dataset.saved='saving';let ok=false;try{ok=await save(button.dataset.save);}finally{button.disabled=false;flash(button,ok);}});
 pages.account=setupAccount(api,check,ctx);
 pages.providers=setupProviders(ctx);
 // —— 模型连接页 ——
 const providerName=m=>view.connections.find(c=>c.id===m.connection_id)?.name||'';
 const chatModels=()=>view.models.filter(m=>m.kind==='chat'&&m.enabled&&!m.video_verified).map(m=>({...m,provider_name:providerName(m)}));
 const byId=id=>view.models.find(m=>m.id===id);
 async function apply(patch,text){
  if(busy)return;busy=true;await contextSaving;paintLinks();
  try{await call({op:'roles',...patch});setStatus('links-status',text||'已保存');}catch(e){setStatus('links-status',e.message,true);}
  finally{busy=false;paintLinks();}
 }
 // 参数改动：保存后整页重画；拉条拖动中只改数字，松手才保存。
 async function saveParam(op,model,key,value){
  if(busy)return;
  if(contextSaving)await contextSaving;
  const focused=document.activeElement,label=focused?.matches('#links-body input')?focused.getAttribute('aria-label'):null;
  let moved=false;
  const leave=()=>{moved=true;};
  if(label){document.addEventListener('focusin',leave);document.addEventListener('pointerdown',leave);document.addEventListener('keydown',leave);}
  busy=true;paintLinks();
  try{await call({op,id:model.id,key,value});setStatus('links-status','已保存');}catch(e){setStatus('links-status',e.message,true);}
  finally{
   busy=false;paintLinks();
   if(label){
    document.removeEventListener('focusin',leave);document.removeEventListener('pointerdown',leave);document.removeEventListener('keydown',leave);
    if(!moved&&[document.body,document.documentElement].includes(document.activeElement)){
     const next=[...$('links-body').querySelectorAll('input')].find(n=>n.getAttribute('aria-label')===label);
     if(next&&!next.disabled&&next.getClientRects().length)next.focus({preventScroll:true});
    }
   }
  }
 }
 // Keep the live range node while writes are in flight. Coalesce only pending
 // targets; a later drag is always saved after the earlier request completes.
 function saveContext(model,value,mode='custom'){
  contextPending.set(model.id,{value,mode});
  if(contextSaving)return contextSaving;
  contextSaving=(async()=>{
   while(contextPending.size){
    const [id,target]=contextPending.entries().next().value;contextPending.delete(id);
    try{await call({op:'context',id,key:'compact_at_tokens',value:target.value,mode:target.mode},true,false);contextFailures.delete(id);setStatus('links-status',contextPending.size?'正在保存…':'已保存');}
    catch(error){const text=error.message+'；当前选择已保留，请再次调整以重试。';contextFailures.set(id,text);setStatus('links-status',text,true);}
   }
  })().finally(()=>{contextSaving=null;});
  return contextSaving;
 }
 // 档位（思考、开关、枚举）：一排胶囊，直接点选；"自动/默认"在最前。
 function segments(label,options,value,onPick,inactive=false){
  const group=el('div',{class:'param-seg',role:'radiogroup','aria-label':label});
  for(const [v,text] of options){
   const on=!inactive&&String(value??'')===v;
   group.append(el('button',{type:'button',role:'radio','aria-checked':String(on),class:'param-seg-item',disabled:busy,onclick:()=>{if(!on)onPick(v);}},text));
  }
  return group;
 }
 // 数值：拉条 + 右边数值；"默认"表示交给供应商，点数值旁的 × 回到默认。
 function slider(label,f,onSave){
  const num=v=>v===''||v===null||v===undefined?null:Number(v);
  const min=Number.isFinite(f.min)?f.min:0,max=Number.isFinite(f.max)?Math.min(f.max,f.key==='seed'?99999:f.max):1;
  const step=f.type==='integer'?1:max-min<=2?.01:.1,current=num(f.value);
  const range=el('input',{type:'range',min:String(min),max:String(max),step:String(step),value:String(current??min),'aria-label':label,disabled:busy});
  bindTidyRange(range,{integer:f.type==='integer'});
  if(f.key==='reasoning_budget'){
   const exact=el('input',{type:'number',min:String(min),max:String(max),step:String(step),value:current===null?'':String(current),placeholder:'默认','aria-label':label+' token 数',disabled:busy});
   const fill=()=>range.style.setProperty('--fill',((Number(range.value)-min)/(max-min||1)*100)+'%');fill();
   range.addEventListener('input',()=>{exact.value=range.value;fill();});
   const save=()=>{if(exact.checkValidity())void onSave(exact.value);else exact.reportValidity();};
   range.addEventListener('change',save);exact.addEventListener('change',save);
   const reset=current===null?null:el('button',{type:'button',class:'param-reset','aria-label':label+' 恢复默认',title:'恢复默认',disabled:busy,onclick:()=>onSave('')},'×');
   return el('div',{class:'param-slider param-budget',dataset:{set:String(current!==null)}},range,exact,reset);
  }
  const out=el('output',{class:'param-value',text:current===null?'默认':String(current)});
  const fill=()=>range.style.setProperty('--fill',((Number(range.value)-min)/(max-min||1)*100)+'%');
  fill();
  range.addEventListener('input',()=>{out.textContent=String(Number(range.value));out.dataset.set='true';fill();});
  range.addEventListener('change',()=>onSave(range.value));
  const reset=current===null?null:el('button',{type:'button',class:'param-reset','aria-label':label+' 恢复默认',title:'恢复默认',disabled:busy,onclick:()=>onSave('')},'×');
  return el('div',{class:'param-slider',dataset:{set:String(current!==null)}},range,out,reset);
 }
 // These controls use decimal K/M targets, including exact 1K keyboard steps.
 const compactLabel=value=>value>=1000000?value/1000000+'M':Math.round(value/1000)+'K';
 // The slider stores a working target; Core starts compaction at 80%.
 function contextRow(model,label){
  if(!model||model.kind!=='chat')return null;
  let value=model.compact_at_tokens??200000;const presets=contextPresets(model);
  let mode=model.compact_preset||presets.find(p=>p.value===value)?.id||'custom';
  const range=el('input',{type:'range',min:'0',max:'1000',step:'any',value:String(compactPosition(value)), 'aria-label':label+' 上下文压缩',disabled:busy,dataset:{param:'compact_at_tokens'}});
  const out=el('output',{class:'context-value',text:compactLabel(value)});
  const control=el('div',{class:'context-slider'},range,out);
  const choices=el('div',{class:'param-seg context-presets',role:'group','aria-label':label+' 上下文预设'});
  for(const preset of presets)choices.append(el('button',{type:'button',class:'param-seg-item',dataset:{preset:preset.id,tip:preset.label+' · '+compactLabel(preset.value)},onclick:()=>{if(mode==='custom')return;mode=preset.id;value=preset.value;range.value=String(compactPosition(value));paint();void saveContext(model,value,mode);}},preset.label));
  if(presets.length)choices.append(el('button',{type:'button',class:'param-seg-item',dataset:{preset:'custom'},onclick:()=>{mode=mode==='custom'?'manual':'custom';value=Math.min(COMPACT_MAX,Math.max(COMPACT_MIN,value));range.value=String(compactPosition(value));paint();void saveContext(model,value,mode);}},'自定义'));
  const paint=()=>{const ratio=Number(range.value)/Number(range.max||1000);control.style.setProperty('--position',ratio);range.style.setProperty('--fill',ratio*100+'%');out.textContent=compactLabel(value);range.setAttribute('aria-valuetext',out.textContent);for(const button of choices.children){button.setAttribute('aria-pressed',String(button.dataset.preset===mode));button.disabled=busy||mode==='custom'&&button.dataset.preset!=='custom';}};paint();
  range.addEventListener('input',()=>{mode='custom';value=compactValue(Number(range.value));paint();});
  range.addEventListener('change',()=>void saveContext(model,value,mode));
  range.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key))return;
   event.preventDefault();
   mode='custom';value=event.key==='Home'?COMPACT_MIN:event.key==='End'?COMPACT_MAX:Math.min(COMPACT_MAX,Math.max(COMPACT_MIN,Math.round(value/1000)*1000+(['ArrowLeft','ArrowDown','PageDown'].includes(event.key)?-1:1)*(event.key.startsWith('Page')?10000:1000)));
   range.value=String(compactPosition(value));paint();void saveContext(model,value,mode);
  });
  return el('div',{class:'param-row context-row'},el('span',{class:'param-name',text:'上下文压缩'}),el('div',{class:'context-controls'},control,presets.length?choices:null));
 }
 // 一个参数一行：名称在左，控件紧挨在右（思考的档位就在"思考"旁边，不另起一排）。
 function paramRows(model,label){
  const rows=[];
  const t=model?.thinking;
  if(t){
   const budget=t.type==='integer',control=budget?slider(label+' 思考预算',t,v=>saveParam('thinking',model,t.key,v)):segments(label+' 思考',[['','自动'],...t.values.map(v=>[String(v),names[String(v)]||String(v)])],t.value,v=>saveParam('thinking',model,t.key,v),t.inactive);
   rows.push(el('div',{class:'param-row'},el('span',{class:'param-name',text:budget?'思考预算':t.key==='reasoning_effort'?'思考强度':'思考'}),t.hint?el('div',{},control,el('small',{class:'param-context-hint',text:t.hint})):control));
  }else if(model?.thinking_always)rows.push(el('div',{class:'param-row'},el('span',{class:'param-name',text:'思考'}),el('span',{class:'param-context-hint',text:'始终开启'})));
  for(const f of model?.parameters||[]){
   const control=f.type==='enum'||f.type==='boolean'
    ?segments(label+' '+f.label,[['','默认'],...f.values.map(v=>[String(v),names[String(v)]||String(v)])],f.value,v=>saveParam('param',model,f.key,v))
    :slider(label+' '+f.label,f,v=>saveParam('param',model,f.key,v));
   rows.push(el('div',{class:'param-row'},el('span',{class:'param-name',text:f.label}),control));
  }
  const context=contextRow(model,label);if(context)rows.push(context);
  return rows;
 }
 function modelBox(title,select,model){
  const params=paramRows(model,title);
  const info=model?hoverCard(el('span',{class:'link-info',tabindex:'0','aria-label':model.name+' 详情',text:'i'}),model):null;
  return el('div',{class:'settings-area links-area role-box'},
   el('div',{class:'link-row'},el('span',{class:'link-name',text:title}),el('div',{class:'link-control'},select||el('span',{class:'link-unavailable',text:'暂无可用模型'}),info)),
   params.length?el('div',{class:'link-params'},...params):null);
 }
 function paintLinks(){
  if(!view)return;
  const chats=chatModels(),media=view.models.filter(m=>m.enabled).map(m=>({...m,provider_name:providerName(m)})),r=view.roles,main=byId(r.matrix_profile);
  const mainSelect=chats.length?modelSelect({id:'link-matrix',label:'默认对话模型',models:chats,value:r.matrix_profile,placeholder:'选择模型',disabled:busy,onChange:id=>{if(id)void apply({matrix_profile:id});}}):null;
  const imageSelect=media.length?modelSelect({id:'link-image-default',label:'默认生图模型',models:media,value:r.image_profiles[0]||'',empty:'未配置',disabled:busy,onChange:id=>apply({image_profiles:id?[id]:[]},id?'默认生图模型已保存':'已取消默认生图模型')}):null;
  const videoSelect=media.length?modelSelect({id:'link-video-default',label:'默认生视频模型',models:media,value:r.video_profile||'',empty:'未配置',disabled:busy,onChange:id=>apply({video_profile:id},id?'默认生视频模型已保存':'已取消默认生视频模型')}):null;
  const openTab=id=>{const tab=$(id);tab.click();tab.focus({preventScroll:true});};
  const empty=media.length?null:el('div',{class:'settings-area link-pool-empty'},
   el('strong',{text:view.models.length?'模型池中没有已启用的模型':'模型池为空'}),
   el('div',{class:'link-pool-actions'},
    el('button',{type:'button',class:'glass-pill',onclick:()=>openTab('aieyra-tab')},'Aieyra API'),
    el('button',{type:'button',class:'glass-pill',onclick:()=>openTab('providers-tab')},'供应商')));
  $('links-body').replaceChildren(...[
   empty,
   modelBox('默认对话模型',mainSelect,main),
   modelBox('默认生图模型',imageSelect),
   modelBox('默认生视频模型',videoSelect),
  ].filter(Boolean));
 }
 function paintAll(){pages.account.paint();pages.providers.paint();paintLinks();}
 return {
  initialize(_providers,accountState){pages.account.initialize(accountState);},
  async open(){
   try{await load();}catch(e){for(const id of ['links-status','providers-status','aieyra-status'])setStatus(id,e.message,true);}
   void pages.account.refresh();
  },
 };
}

