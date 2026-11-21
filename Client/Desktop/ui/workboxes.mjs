// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: labels; active; disposeCurrent; openWorkboxes
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/workboxes.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {pageNumbers} from './pagination.mjs';
import {$,call,say,el} from './app-shell.mjs';
import {renderWorkflowDigest} from '../../../Tool/workbox/presentation/desktop.mjs';
import {bindThemeRenderer} from '../../../Theme/runtime/layout.mjs';
import {openAgentPackages} from './agent-packages.mjs';

const labels={prompt:'原图描述',edit_prompt:'编辑要求',profile_id:'图片连接（留空使用当前设置）',size:'图片尺寸',values:'数字（用逗号分隔）',workdir:'保存目录',file:'文件名'};
const active=i=>['running','pause_requested','cancel_requested'].includes(i?.state);
let disposeCurrent=()=>{};
export async function openWorkboxes(item){
 disposeCurrent();
 const identity='mod:'+item.manifest.id+'@'+item.digest,dialog=$('detail'),root=$('detail-body');
 const request=(action,extra={})=>call({action:'mod_workflow',request:{action,package:identity,...extra}});
 let stopped=false,timer=null,selected=null,busy=false,epoch=0,listTicket=0,offset=0,total=0,rows=[],painted='',actionsPainted='',modelsLoaded=false,modelsLoading=false;
 const dispose=()=>{stopped=true;epoch++;clearTimeout(timer);dialog.removeEventListener('close',dispose);document.removeEventListener('visibilitychange',visibility);dialog.classList.remove('workflow-dialog');root.classList.remove('workflow-panel');};
 disposeCurrent=dispose;dialog.addEventListener('close',dispose);document.addEventListener('visibilitychange',visibility);
 dialog.classList.add('workflow-dialog');root.classList.add('workflow-panel');
 const title=el('h2','',item.manifest.name),content=el('div','workflow-content'),list=el('div','workflow-list'),pager=el('nav','workflow-pager ui-pages'),view=el('div'),buttons=el('footer');
 const creation=el('details','workflow-create'),summary=el('summary','','新建工作流'),form=el('form','workflow-form');creation.append(summary,form);
 const specialist=el('section'),specialistForm=el('form','workflow-form'),specialistModel=el('select','field'),specialistLabel=el('label','workflow-field','专员模型连接'),specialistCreate=el('button','pill','创建专职 Agent'),specialistManage=el('button','pill','管理专员');
 specialistModel.name='specialist_model';specialistModel.required=true;specialistLabel.append(specialistModel);specialistCreate.type='submit';specialistForm.append(specialistLabel,specialistCreate);specialist.append(specialistForm,specialistManage);specialist.hidden=true;specialistManage.type='button';
 specialistForm.onsubmit=e=>{e.preventDefault();void mutate('create_agent',{model_id:specialistModel.value});};
 specialistManage.onclick=()=>{const id=selected?.agent_id;if(id){dispose();void openAgentPackages(null,id);}};
 const close=el('button','pill','关闭');close.type='button';close.onclick=()=>dialog.close();
 content.append(creation,list,pager,view,specialist);root.replaceChildren(title,content,buttons);if(!dialog.open)dialog.showModal();
 function button(label,action){const b=el('button','pill',label);b.type='button';b.onclick=action;return b;}
 function schedule(){clearTimeout(timer);if(!stopped&&!busy&&!document.hidden&&active(selected))timer=setTimeout(()=>void status().catch(error=>{say(error.message,true);schedule();}),750);}
 function visibility(){clearTimeout(timer);if(!document.hidden&&!busy)void status().catch(error=>say(error.message,true));}
 function accept(instance){if(!instance)return;if(selected?.id===instance.id&&selected.revision>instance.revision)return;selected=instance;paint();schedule();}
 async function status(){
  if(stopped||busy||!selected)return;
  const own=epoch,id=selected.id,result=await request('call',{owner:selected.owner,command:{action:'status',id}});
  if(stopped||busy||own!==epoch||selected?.id!==id)return;
  accept(result.instance);
 }
 async function mutate(action,extra={}){
  if(busy||!selected)return;
  busy=true;epoch++;clearTimeout(timer);paint();
  try{const out=await request('call',{owner:selected.owner,command:{action,id:selected.id,expected_revision:selected.revision,request_id:crypto.randomUUID(),...extra}});if(!stopped)accept(out.instance);}
  catch(error){say(error.message,true);}finally{busy=false;if(!stopped){paint();await status().catch(error=>say(error.message,true));}}
 }
 function paint(){
  if(stopped)return;
  const key=selected?selected.id+':'+selected.revision:'';
  if(key!==painted){
   const same=painted.startsWith(selected?.id+':'),opened=new Set([...view.querySelectorAll('details[data-detail][open]')].map(n=>n.dataset.detail)),scroll=content.scrollTop;
   const focused=view.contains(document.activeElement)?document.activeElement.closest('details')?.dataset.detail:null;
   view.replaceChildren();if(selected)view.append(renderWorkflowDigest(document,{package:identity,data:selected},{present:bindThemeRenderer}));
   if(same){for(const node of view.querySelectorAll('details[data-detail]')){if(opened.has(node.dataset.detail))node.open=true;if(focused===node.dataset.detail)node.querySelector('summary')?.focus({preventScroll:true});}content.scrollTop=scroll;}
   painted=key;
  }
  const actionKey=(selected?.id||'')+':'+(selected?.state||'')+':'+busy;
  if(actionKey!==actionsPainted){
   buttons.replaceChildren();
   if(selected){
    for(const [states,label,action]of [[['ready'],'运行','run'],[['paused'],'继续','resume'],[['running'],'暂停','pause'],[['running','paused','ready','awaiting_review','blocked','unknown','failed'],'取消','cancel'],[['running','pause_requested','cancel_requested','unknown','failed','blocked','cancelled'],'检查已有回执','recover']])if(states.includes(selected.state))buttons.append(button(label,()=>void mutate(action)));
    if(selected.state==='awaiting_review'){const step=selected.steps.find(s=>s.state==='awaiting_review');const b=button('确认审阅',()=>void mutate('approve',{step:step?.id}));b.classList.add('primary');buttons.append(b);}
   }
   for(const n of buttons.children)n.disabled=busy;buttons.append(close);actionsPainted=actionKey;
  }
  for(const node of list.children)node.setAttribute('aria-pressed',String(node.dataset.workflow===selected?.id));
  const packaged=!!selected?.definition?.agentTemplate?.package;
  specialist.hidden=!packaged;specialistForm.hidden=!!selected?.agent_id;specialistManage.hidden=!selected?.agent_id;specialistManage.disabled=busy;
  specialistModel.disabled=specialistCreate.disabled=busy||active(selected)||!modelsLoaded||['completed','cancelled'].includes(selected?.state);
  if(packaged&&!modelsLoaded&&!modelsLoading){
   modelsLoading=true;
   void call({action:'mod_agent',request:{action:'models'}}).then(models=>{if(stopped)return;const empty=el('option','','选择模型连接');empty.value='';specialistModel.replaceChildren(empty);for(const m of models||[]){const option=el('option','',m.name||m.model);option.value=m.id;specialistModel.append(option);}modelsLoaded=true;modelsLoading=false;paint();}).catch(error=>{if(!stopped){modelsLoading=false;say(error.message,true);}});
  }
 }
 async function choose(row){
  if(busy||stopped)return;epoch++;selected=row;painted='';view.replaceChildren();
  const own=epoch;
  const out=await request('call',{owner:row.owner,command:{action:'status',id:row.id}});
  if(!stopped&&own===epoch)accept(out.instance);
 }
 async function refresh(){
  const ticket=++listTicket,result=await request('list',{offset,limit:20});if(stopped||ticket!==listTicket)return;
  rows=result.instances||[];total=result.total||0;
  list.replaceChildren(...rows.map(row=>{const b=button(row.title+' · '+new Date(row.created).toLocaleString(),()=>void choose(row).catch(e=>say(e.message,true)));b.dataset.workflow=row.id;return b;}));
  if(!rows.length)list.append(el('p','','尚未创建工作流'));
  pager.replaceChildren();
  if(total>20){const previous=button('上一页',()=>{offset=Math.max(0,offset-20);void refresh().catch(e=>say(e.message,true));}),next=button('下一页',()=>{offset=result.next_offset;void refresh().catch(e=>say(e.message,true));});previous.disabled=offset===0;next.disabled=result.next_offset>=total;const current=Math.floor(offset/20)+1,numbers=el('span','ui-page-numbers');for(const page of pageNumbers(current,Math.ceil(total/20))){const b=button(String(page),()=>{offset=(page-1)*20;void refresh().catch(e=>say(e.message,true));});b.classList.add('ui-page-number');b.setAttribute('aria-label','第 '+page+' 页');if(page===current)b.setAttribute('aria-current','page');numbers.append(b);}pager.append(previous,numbers,next);}
  if(!selected&&rows[0])await choose(rows[0]);else await status();
  if(!selected)creation.open=true;
  paint();
 }
 try{
  if(item.enabled){
   const description=await request('describe');if(stopped)return;
   const fields=new Map();
   for(const [key,schema]of Object.entries(description.definition.input.properties||{})){
    const label=el('label','workflow-field',schema.description||labels[key]||key),structured=schema.type==='object'||schema.type==='array'&&!['number','integer'].includes(schema.items?.type),input=el(schema.enum?'select':structured?'textarea':'input','field');
    input.name=key;const required=description.definition.input.required?.includes(key)===true;input.required=required&&key!=='profile_id';
    if(schema.enum)for(const value of schema.enum){const option=el('option','',String(value));option.value=JSON.stringify(value);input.append(option);}
    else if(schema.type==='boolean'){input.type='checkbox';input.required=false;}
    else if(['number','integer'].includes(schema.type)){input.type='number';input.step=schema.type==='integer'?'1':'any';}
    else if(structured)input.placeholder=schema.type==='array'?'["第一项", "第二项"]':'{"字段": "值"}';
    if(!schema.enum&&schema.type!=='boolean')input.value=key==='workdir'?description.workdir:key==='size'?'1536x1024':key==='file'?'report.json':'';
    label.append(input);form.append(label);fields.set(key,{input,schema,required});
   }
   const workdir=el('input','field');workdir.value=description.workdir;workdir.required=true;const label=el('label','workflow-field','运行目录');label.append(workdir);form.append(label);
   const create=el('button','pill primary','创建工作流');create.type='submit';form.append(create);
   form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;busy=true;epoch++;clearTimeout(timer);create.disabled=true;paint();
    try{
     const input={};for(const [key,f]of fields){const value=f.input.value;if(!f.required&&!value&&f.schema.type!=='boolean')continue;
      if(f.schema.enum)input[key]=JSON.parse(value);else if(f.schema.type==='boolean')input[key]=f.input.checked;else if(f.schema.type==='array'&&['number','integer'].includes(f.schema.items?.type))input[key]=value.trim().startsWith('[')?JSON.parse(value):value.split(',').filter(v=>v.trim()).map(v=>Number(v.trim()));else if(['number','integer'].includes(f.schema.type))input[key]=Number(value);else if(['object','array'].includes(f.schema.type))input[key]=JSON.parse(value);else input[key]=value;
     }
     const out=await request('call',{command:{action:'create',input,workdir:workdir.value,request_id:crypto.randomUUID()}});if(stopped)return;
     selected=out.instance;creation.open=false;offset=0;accept(selected);await refresh();
    }catch(error){say(error.message,true);}finally{busy=false;create.disabled=false;paint();schedule();}
   };
  }else creation.hidden=true;
  pager.setAttribute('aria-label','工作流分页');
  const refreshButton=button('刷新',()=>void refresh().catch(e=>say(e.message,true)));title.after(refreshButton);
  await refresh();
 }catch(error){say(error.message,true);buttons.replaceChildren(close);}
}
