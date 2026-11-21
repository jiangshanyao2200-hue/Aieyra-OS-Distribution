// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: active; stateName; disposeCurrent; openAgentPackages
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/agent-packages.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {$,call,say,el} from './app-shell.mjs';

const active=r=>['queued','running','waiting_user','cancelling'].includes(r?.state);
const stateName={idle:'空闲',queued:'等待运行',running:'执行中',waiting_user:'等待回答',completed:'已完成',failed:'失败',cancelled:'已取消',timed_out:'超时',interrupted:'已中断'};
let disposeCurrent=()=>{};
export async function openAgentPackages(item,selectedID=''){
 disposeCurrent();
 const dialog=$('detail'),root=$('detail-body'),request=(action,extra={})=>call({action:'mod_agent',request:{action,...extra}});
 let stopped=false,busy=false,timer=null,epoch=0,selected=null,sources=[],models=[],rows=[],editKey='',attempt=null,createAttempt=null;
 const dispose=()=>{stopped=true;epoch++;clearTimeout(timer);dialog.removeEventListener('close',dispose);document.removeEventListener('visibilitychange',visibility);dialog.classList.remove('workflow-dialog');root.classList.remove('workflow-panel');};
 disposeCurrent=dispose;dialog.addEventListener('close',dispose);document.addEventListener('visibilitychange',visibility);
 dialog.classList.add('workflow-dialog');root.classList.add('workflow-panel');
 const title=el('h2','','Agent'),content=el('div','workflow-content'),creation=el('details','workflow-create'),createForm=el('form','workflow-form'),list=el('div','workflow-list'),view=el('section','agent-instance'),footer=el('footer');
 const source=el('select','field'),model=el('select','field'),workdir=el('input','field'),name=el('input','field');
 const metadata=el('p'),result=el('pre','agent-result'),settings=el('details'),settingsForm=el('form','workflow-form'),team=el('details'),teamForm=el('form','workflow-form'),sendForm=el('form','workflow-form'),message=el('textarea','field');
 const editName=el('input','field'),editModel=el('select','field'),editPrompt=el('textarea','field'),toolset=el('fieldset','agent-tools'),supervisor=el('select','field'),role=el('input','field');
 function button(label,fn,primary=false){const b=el('button','pill'+(primary?' primary':''),label);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>say(e.message,true));return b;}
 function field(label,input){const box=el('label','workflow-field',label);box.append(input);return box;}
 function option(input,value,label){const o=el('option','',label);o.value=value;input.append(o);}
 function updateSources(next){const previous=source.value;sources=next;source.replaceChildren();for(const s of sources.filter(s=>s.enabled))option(source,s.identity,s.manifest.name+' · '+s.manifest.version+' · '+({official:'官方',local:'本地', 'third-party':'第三方'}[s.origin]||s.origin));if(sources.some(s=>s.enabled&&s.identity===previous))source.value=previous;create.disabled=busy||!source.options.length;}
 function schedule(){clearTimeout(timer);if(!stopped&&!busy&&!document.hidden&&active(selected))timer=setTimeout(()=>void refreshStatus().catch(e=>{say(e.message,true);schedule();}),750);}
 function visibility(){clearTimeout(timer);if(!document.hidden&&!busy)void refreshStatus().catch(e=>say(e.message,true));}
 function lock(on){busy=on;for(const node of root.querySelectorAll('button,input,select,textarea'))node.disabled=on;close.disabled=false;paint();}
 async function mutate(action,extra={}){
  if(busy||!selected)return;const id=selected.id;epoch++;clearTimeout(timer);lock(true);
  try{const key=JSON.stringify([id,action,extra]);if(attempt?.key!==key)attempt={key,request:{id,request_id:crypto.randomUUID(),expected_revision:selected.instance.revision,generation:selected.generation,...extra}};
   const out=await request(action,attempt.request);attempt=null;if(stopped)return;
   selected=out?.instance?out:await request('status',{id});await refreshList();paint();return true;
  }catch(e){say(e.message,true);return false;}finally{if(!stopped){lock(false);schedule();}}
 }
 function paint(){
	create.disabled=busy||!source.options.length;
  view.hidden=!selected;for(const n of footer.children)n.hidden=!selected&&n!==close;if(!selected)return;
  const i=selected.instance,key=selected.id+':'+i.revision,available=sources.find(s=>s.manifest.id===i.current.definition.id),sourceOff=!available?.enabled,versionChanged=available?.enabled&&available.identity!==i.current.package&&!active(selected);
  metadata.textContent=[selected.spec.title,stateName[selected.state]||selected.state,i.disabled?'已停用':'',sourceOff?'来源包已停用或卸载':versionChanged?'来源包已更新，请切换版本':'',i.current.definition.name+' '+i.current.definition.version,i.supervisor?'团队：'+i.team_role:'独立实例'].filter(Boolean).join(' · ');
  result.textContent=selected.error||selected.result||'';result.hidden=!result.textContent;
  if(key!==editKey){
   editName.value=selected.spec.title;editModel.value=selected.spec.model_id;editPrompt.value=selected.spec.prompt;
   toolset.replaceChildren(el('legend','','工具'));
   for(const cap of i.current.allowed_tools||[]){const input=el('input');input.type='checkbox';input.value=cap;input.checked=selected.spec.tools?.includes(cap);const label=el('label','agent-tool');label.append(input,document.createTextNode(cap));toolset.append(label);}
   supervisor.replaceChildren();option(supervisor,'','独立运行');option(supervisor,'primary','Eyra 主团队');
   for(const row of rows)if(row.id!==selected.id)option(supervisor,row.id,row.title);
   supervisor.value=i.supervisor||'';role.value=i.team_role||'';editKey=key;
  }
  for(const n of [...settingsForm.elements,...teamForm.elements])n.disabled=busy||active(selected);
  send.disabled=busy||i.disabled||sourceOff||versionChanged;message.disabled=send.disabled;cancel.disabled=busy||!active(selected);toggle.disabled=busy||active(selected);toggle.textContent=i.disabled?'启用实例':'停用实例';
  exportTemplate.disabled=busy;
  switchVersion.hidden=!sources.some(s=>s.enabled&&s.manifest.id===i.current.definition.id&&s.identity!==i.current.package);
  switchVersion.disabled=busy||active(selected);restoreVersion.hidden=!i.previous;restoreVersion.disabled=busy||active(selected);
  for(const n of list.children){const current=n.dataset.agent===selected.id;n.setAttribute('aria-pressed',String(current));if(current){const label=selected.spec.title+' · '+(stateName[selected.state]||selected.state);if(n.textContent!==label)n.textContent=label;}}
 }
 async function refreshStatus(){if(stopped||busy||!selected)return;const own=epoch,id=selected.id,r=await request('status',{id});if(stopped||busy||epoch!==own||selected?.id!==id)return;selected=r;paint();schedule();}
 async function choose(id){if(busy)return;const own=++epoch;clearTimeout(timer);const r=await request('status',{id});if(stopped||own!==epoch)return;selected=r;paint();schedule();}
 async function refreshList(){const out=await request('list');if(stopped)return;rows=out.instances||[];list.replaceChildren(...rows.map(r=>{const b=button(r.title+' · '+(stateName[r.state]||r.state),()=>choose(r.id));b.dataset.agent=r.id;return b;}));if(!rows.length)list.append(el('p','','尚未创建实例'));}
 const create=el('button','pill primary','创建实例');create.type='submit';
 for(const [label,input]of [['模板',source],['模型连接',model],['工作目录',workdir],['名称',name]])createForm.append(field(label,input));
 source.required=true;model.required=true;workdir.required=true;source.name='package';model.name='model_id';workdir.name='workdir';name.name='title';
 createForm.append(create);creation.append(el('summary','','新建 Agent'),createForm);
 createForm.onsubmit=async e=>{e.preventDefault();if(busy)return;epoch++;lock(true);try{
  const values={package:source.value,model_id:model.value,workdir:workdir.value,title:name.value},key=JSON.stringify(values);if(createAttempt?.key!==key)createAttempt={key,request:{...values,request_id:crypto.randomUUID()}};const r=await request('create',createAttempt.request);createAttempt=null;if(stopped)return;selected=r;creation.open=false;await refreshList();paint();
 }catch(error){say(error.message,true);}finally{if(!stopped)lock(false);}};
 const save=el('button','pill','保存设置');save.type='submit';
 const exportTemplate=button('导出公开模板',async()=>{if(busy||!selected)return;const id=selected.id;epoch++;clearTimeout(timer);lock(true);try{const out=await call({action:'mod_agent_export',id});if(!stopped&&!out.cancelled)say('已导出公开模板');}finally{if(!stopped){lock(false);schedule();}}});
 exportTemplate.title='仅导出原始包，不包含个人设置、对话或记忆';
 settingsForm.append(field('名称',editName),field('模型连接',editModel),field('个人提示词',editPrompt),toolset,save,button('恢复包提示词',()=>mutate('configure',{restore_prompt:true})),button('恢复默认工具',()=>mutate('configure',{restore_tools:true})),exportTemplate);
 settingsForm.onsubmit=e=>{e.preventDefault();void mutate('configure',{title:editName.value,model_id:editModel.value,prompt:editPrompt.value,tools:[...toolset.querySelectorAll('input:checked')].map(n=>n.value)});};
 settings.append(el('summary','','实例设置'),settingsForm);
 const join=el('button','pill','保存团队关系');join.type='submit';teamForm.append(field('管理者',supervisor),field('职责',role),join);
 teamForm.onsubmit=e=>{e.preventDefault();void mutate('team',{supervisor:supervisor.value,team_role:supervisor.value?role.value:''});};team.append(el('summary','','团队关系'),teamForm);
 const send=el('button','pill primary','发送');send.type='submit';message.required=true;message.rows=3;message.name='message';
 sendForm.append(field('消息',message),send);sendForm.onsubmit=async e=>{e.preventDefault();if(await mutate('send',{message:message.value}))message.value='';};
 const cancel=button('取消任务',()=>mutate('cancel')),toggle=button('停用实例',()=>mutate('configure',{enabled:!!selected.instance.disabled}));
 const switchVersion=button('切到新版本',()=>{const next=sources.find(s=>s.enabled&&s.manifest.id===selected.instance.current.definition.id&&s.identity!==selected.spec.agent_package);if(next)return mutate('switch',{package:next.identity});}),restoreVersion=button('恢复前一版本',()=>mutate('restore_version'));
 const openTask=button('查看任务',async()=>{await call({action:'mod_agent_task',id:selected.id});dialog.close();});
 const close=button('关闭',()=>dialog.close());
 footer.append(openTask,cancel,toggle,switchVersion,restoreVersion,close);view.append(metadata,result,sendForm,settings,team);
 content.append(creation,list,view);root.replaceChildren(title,content,footer);paint();if(!dialog.open)dialog.showModal();
 try{
  const [catalog,connections]=await Promise.all([request('sources'),request('models')]);if(stopped)return;updateSources(catalog.sources||[]);models=connections||[];workdir.value=catalog.workdir||'';
  option(model,'','选择模型');for(const row of models){option(model,row.id,row.name||row.model);option(editModel,row.id,row.name||row.model);}
  if(item)source.value='mod:'+item.manifest.id+'@'+item.digest;
  await refreshList();if(stopped)return;if(rows[0])await choose(rows.some(r=>r.id===selectedID)?selectedID:rows[0].id);else creation.open=true;
  title.after(button('刷新',async()=>{const next=await request('sources');if(stopped)return;updateSources(next.sources||[]);await refreshList();await refreshStatus();}));
 }catch(error){say(error.message,true);}
}
