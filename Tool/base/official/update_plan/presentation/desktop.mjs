// Update Plan 的统一表现：左上轨道圆（进度环 + 当前一步）、悬停卡片、专属计划页。
// 只读 CORE 的 update_plan 回执；不推断、不补写计划。
import {planData} from './model.mjs';

const DONE=new Set(['completed','complete','done']);
const stepText=s=>String(s?.text||s?.description||s?.title||s?.step||'').trim();
const stateOf=s=>DONE.has(s?.status)?'completed':['in_progress','running','active'].includes(s?.status)?'in_progress':['blocked','failed'].includes(s?.status)?'blocked':['deferred','cancelled','superseded'].includes(s?.status)?s.status:'pending';
const label={completed:'已完成',in_progress:'进行中',pending:'待开始',blocked:'受阻',deferred:'暂缓',cancelled:'已取消',superseded:'已替换'};
const statusLabel={active:'进行中',paused:'已暂停',blocked:'受阻',awaiting_acceptance:'步骤已完成，待验收',complete:'计划已完成',cancelled:'已取消'};

// 纯函数：把回执整理成界面需要的形状。
export function planModel(item){
 const data=planData(item);
 const phases=(data.phases||[]).map(p=>({id:String(p.id||''),title:String(p.title||p.name||'').trim(),revisions:Array.isArray(p.revisions)?p.revisions:[],steps:(p.steps||[]).map(s=>({id:String(s.id||''),text:stepText(s),state:stateOf(s),result:String(s.result||'').trim(),evidence:Array.isArray(s.evidence)?s.evidence.map(String):[],reason:String(s.reason||'').trim(),resume:s.resume_condition,dependsOn:Array.isArray(s.depends_on)?s.depends_on:[],replacedBy:String(s.replaced_by||''),replaces:String(s.replaces||''),revisions:Array.isArray(s.revisions)?s.revisions:[]})).filter(s=>s.text)})).filter(p=>p.steps.length||p.revisions.length);
 const steps=phases.flatMap(p=>p.steps);
 const counted=steps.filter(s=>!['cancelled','superseded'].includes(s.state));
 const done=counted.filter(s=>s.state==='completed').length;
 const byID=new Map(steps.map(s=>[s.id,s]));
 const ready=s=>s.dependsOn.every(id=>byID.get(id)?.state==='completed')&&(!s.resume?.step_id||byID.get(s.resume.step_id)?.state==='completed');
 const current=['in_progress','pending','blocked','deferred'].map(state=>steps.find(s=>s.state===state&&(state!=='pending'||ready(s)))).find(Boolean)||null;
 const status=String(data.status||''),complete=status?status==='complete':counted.length>0&&done===counted.length;
 return {objective:String(data.objective||data.summary||'').trim(),phases,steps,done,total:counted.length,current,complete,status,reason:String(data.reason||''),acceptance:Array.isArray(data.acceptance)?data.acceptance:[],completion:data.completion||[],
  summary:complete?'计划已完成':status&&status!=='active'?(statusLabel[status]||status):current?.text||String(data.objective||data.summary||'当前计划')};
}

function node(doc,tag,text,className){const n=doc.createElement(tag);if(text!==undefined&&text!==null)n.textContent=text;if(className)n.className=className;return n;}

function renderRevisions(root,revisions,doc){
 if(!revisions?.length)return;
 const history=node(doc,'details',undefined,'plan-result');history.append(node(doc,'summary','修订记录'));
 for(const revision of revisions){
  const entry=node(doc,'div');
  const before=node(doc,'p');before.append(node(doc,'span','修订前：'),node(doc,'del',revision.before,'plan-prior'));
  entry.append(before,node(doc,'p','修订后：'+revision.after),node(doc,'p','修订原因：'+revision.reason));
  history.append(entry);
 }
 root.append(history);
}

// 悬停卡片：目标 + 前几步，当前一步高亮。
export function renderPlanPeek(root,model,doc=root.ownerDocument){
 root.replaceChildren();
 const head=node(doc,'div',undefined,'peek-head');
 head.append(node(doc,'strong',model.objective||'当前计划'),node(doc,'small',model.done+' / '+model.total));
 root.append(head);
 const list=node(doc,'ol',undefined,'peek-steps');
 const start=Math.max(0,Math.min(model.steps.findIndex(s=>s===model.current),model.steps.length-5));
 for(const s of model.steps.slice(Math.max(0,start),Math.max(0,start)+5)){const li=node(doc,'li',s.text);li.dataset.state=s.state;list.append(li);}
 root.append(list);
 root.append(node(doc,'small','点击查看完整计划','peek-hint'));
}

// 专属计划页：目标、进度、按阶段的时间线与每步结果。
export function renderPlanPage(root,model,doc=root.ownerDocument){
 root.replaceChildren();
 const page=node(doc,'article',undefined,'plan-page');
 const head=node(doc,'header',undefined,'plan-head');
 if(model.objective)head.append(node(doc,'h2',model.objective));
 const meter=node(doc,'div',undefined,'plan-meter');meter.setAttribute('role','progressbar');meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax',String(model.total));meter.setAttribute('aria-valuenow',String(model.done));
 const fill=node(doc,'span');fill.style.width=(model.total?Math.round(model.done/model.total*100):0)+'%';meter.append(fill);
 head.append(meter,node(doc,'p',model.complete?'全部 '+model.total+' 步已完成':model.status&&model.status!=='active'?model.summary:'已完成 '+model.done+' / '+model.total+(model.current?' · '+label[model.current.state]+'：'+model.current.text:''),'plan-progress-text'));
 if(model.reason)head.append(node(doc,'p',model.reason,'plan-result'));
 page.append(head);
 if(model.acceptance?.length){
  const criteria=node(doc,'section',undefined,'plan-phase'),list=node(doc,'ul',undefined,'plan-result');
  criteria.append(node(doc,'h3','验收标准'));
  for(const criterion of model.acceptance)list.append(node(doc,'li',criterion));
  criteria.append(list);page.append(criteria);
 }
 for(const phase of model.phases){
  const section=node(doc,'section',undefined,'plan-phase');section.dataset.phaseId=phase.id;
  if(phase.title&&(model.phases.length>1||phase.revisions?.length))section.append(node(doc,'h3',phase.title));
  renderRevisions(section,phase.revisions,doc);
  const list=node(doc,'ol',undefined,'plan-steps');
  for(const s of phase.steps){
   const li=node(doc,'li',undefined,'plan-step');li.dataset.state=s.state;li.dataset.stepId=s.id;
   const body=node(doc,'div',undefined,'plan-step-body');
   body.append(node(doc,'strong',s.text),node(doc,'small',label[s.state]));
   renderRevisions(body,s.revisions,doc);
   if(s.result)body.append(node(doc,'p',s.result,'plan-result'));
   if(s.reason)body.append(node(doc,'p','原因：'+s.reason,'plan-result'));
   for(const evidence of s.evidence)body.append(node(doc,'p','证据：'+evidence,'plan-result'));
   if(s.resume)body.append(node(doc,'p','恢复条件：'+[s.resume.step_id,s.resume.status,s.resume.detail].filter(Boolean).join(' · '),'plan-result'));
   if(s.replacedBy||s.replaces)body.append(node(doc,'small',s.replacedBy?'由 '+s.replacedBy+' 接替':'接替 '+s.replaces));
   li.append(node(doc,'span',undefined,'plan-dot'),body);list.append(li);
  }
  section.append(list);page.append(section);
 }
 for(const result of model.completion){const block=node(doc,'section',undefined,'plan-phase');block.append(node(doc,'h3',result.criterion));for(const evidence of result.evidence||[])block.append(node(doc,'p',evidence,'plan-result'));page.append(block);}
 root.append(page);
}

export function createPlanView({el}) {
 return function planView(item) {
  const {objective,steps,phases,mode,status,reason,acceptance,completion}=planData(item),root=el('details',undefined,'tool-view task-progress');
  root.dataset.tool='update_plan';root.dataset.callId=item.id;
  root.dataset.mode=mode||'plan';root.dataset.status=status||'active';
  const counted=steps.filter(step=>!['superseded','cancelled'].includes(step.status)),done=counted.filter(step=>step.status==='completed').length,heading=el('summary',undefined,'plan-heading');
  const current=planModel(item).current;
  const currentText=current?.text;
  heading.append(el('span',mode==='goal'?'蓝图':'计划'),el('span',currentText||objective||'查看步骤','plan-current'),el('span',done+' / '+counted.length,'plan-count'));heading.title=currentText||objective||'点击展开计划';root.append(heading);
  if(status&&status!=='active')heading.append(el('span',statusLabel[status]||status));
  const scroll=el('div',undefined,'plan-phases');
  scroll.tabIndex=0;scroll.setAttribute('aria-label','完整计划列表，可滚动查看全部步骤');
  if(objective)scroll.append(el('p',objective,'plan-objective'));
  if(reason)scroll.append(el('small',reason,'plan-reason'));
  if(Array.isArray(acceptance)&&acceptance.length){
    const criteria=el('section',undefined,'plan-acceptance'),list=el('ul');
    criteria.append(el('h4','验收标准'));
    for(const criterion of acceptance)list.append(el('li',criterion));
    criteria.append(list);scroll.append(criteria);
  }
  if(Array.isArray(completion)&&completion.length){
    const results=el('section',undefined,'plan-completion');results.append(el('h4','完成证据'));
    for(const result of completion){
      const entry=el('div',undefined,'plan-criterion');entry.append(el('strong',result.criterion));
      const evidence=el('ul');for(const text of result.evidence||[])evidence.append(el('li',text));
      entry.append(evidence);results.append(entry);
    }
    scroll.append(results);
  }
  for(const phase of phases){
  const section=el('section',undefined,'plan-phase');section.dataset.phaseId=phase.id;
  if(mode==='goal'||phases.length>1){for(const revision of phase.revisions||[])section.append(el('del',revision.before,'plan-prior'));section.append(el('h4',phase.title||phase.id));}
  const list=el('ol',undefined,'plan-steps');
  for(const step of phase.steps||[]) {
    const row=el('li',undefined,step.status||'pending');
    row.dataset.stepId=step.id;
    if(step.status==='in_progress')row.setAttribute('aria-current','step');
    const content=el('div',undefined,'step-content'),text=step.text||step.description||step.title||step.step||'';
    for(const revision of step.revisions||[]){const prior=el('del',revision.before,'plan-prior');prior.title=revision.reason||'';content.append(prior);}
    const label=el(['cancelled','superseded','deferred'].includes(step.status)?'del':'span',text,'step-text');
    if(step.status==='in_progress'){label.dataset.text=text;label.setAttribute('aria-label',text);}
    content.append(label);
    if(step.reason)content.append(el('small',step.reason,'step-reason'));
    if(step.depends_on?.length){const names=step.depends_on.map(id=>phases.flatMap(p=>p.steps||[]).find(s=>s.id===id)?.text||id);content.append(el('small','前置条件：'+names.join('；'),'step-reason'));}
    if(step.resume_condition)content.append(el('small','恢复条件：'+(step.resume_condition.detail||step.resume_condition.step_id||'等待确认'),'step-reason'));
    const evidence=(step.evidence||[]).filter(item=>item!==step.reason);
    if(evidence.length)content.append(el('small',evidence.join('；'),'step-evidence'));
    row.append(el('span',{completed:'●',in_progress:'◉',failed:'×',blocked:'!',cancelled:'−',deferred:'−',superseded:'−',skipped:'−'}[step.status]||'○','step-mark'),content);
    list.append(row);
  }
  section.append(list);scroll.append(section);
  }
  root.append(scroll);
  return root;
};
}

// Historical non-disclosure receipts keep the same compact step list.
export function createPlanSteps(steps,{el}) {
 const list=el('ol',undefined,'plan-steps');
 for(const step of steps){
  const row=el('li',undefined,step.status||'pending');
  row.append(el('span',{completed:'●',in_progress:'◉',pending:'○',failed:'×'}[step.status]||'○'),el('span',stepText(step)));
  list.append(row);
 }
 return list;
}
