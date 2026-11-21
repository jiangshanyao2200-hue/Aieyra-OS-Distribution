// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TRAY; quiet; failedStates; liveStates; SHELL; WORDS; trim; data; idOf; isFailed; isLive; leaf; targetOf; humanLine; ToolTray; setupToolTray
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/tool-tray.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 首页工具临时区（第109轮 R2）：Eyra 调用工具时，头像上方向上展开一小块区域，用人话写正在做什么。
// 数据只来自当前代次的真实回执；展开与收起只是展示状态，原始回执照旧归档，可从历史查看。
// 收起：下一段思考或正文出现，或停留满上限；失败和等你回答时不自动收起，给出恢复入口。
import {activityLabel,activityData,isInternalId} from './activity.mjs';
import {shellSceneKind} from './model.mjs';

export const TRAY={yieldMs:600,maxHoldMs:8000,maxRows:3,textMax:56,closeMs:260};
// 这些工具有自己的呈现（计划圆、提问、日记圆、协同），不进临时区。
const quiet=new Set(['update_plan','team','exec','wait','compact','ask_user','ask_subconscious','share_diary']);
const failedStates=new Set(['failed','timed_out','interrupted','interrupted_unknown','persistence_failed']);
const liveStates=new Set(['queued','running','cancelling']);
const SHELL={search:['在代码里找东西','找完了'],reader:['在看文件','看完了'],map:['在看目录','目录看完了'],terminal:['在运行一条命令','命令跑完了']};
const WORDS={apply_patch:['在修改文件','文件改好了'],web_search:['在搜索网页','网页搜完了'],view_image:['在看图片','图片看完了'],browser:['在查看页面','页面看完了'],write_stdin:['在继续那条命令','继续完成了'],read_shell_output:['在读取命令输出','输出读完了']};
const trim=(value,max=TRAY.textMax)=>{const chars=Array.from(String(value||'').replace(/\s+/g,' ').trim());return chars.length>max?chars.slice(0,max-1).join('')+'…':chars.join('');};
const data=item=>{try{return activityData(item)||{};}catch{return {};}};
const idOf=item=>String(item.key||item.id||'');
export const isFailed=item=>failedStates.has(item.state)||data(item).ok===false;
export const isLive=item=>liveStates.has(item.state);
const leaf=value=>String(value||'').split(/[\\/]/).filter(Boolean).pop()||'';
const targetOf=item=>{const hit=(item.targets||[]).find(t=>!isInternalId(t))||data(item).path||'';return trim(leaf(hit),28);};

// 写给人看：只说在做什么、做完没有，不出现命令原文、路径全名和内部编号。
export function humanLine(item){
  let label;try{label=activityLabel(item);}catch{label='操作';}
  if(isFailed(item))return trim('没做成：'+label+'（双击头像看详情）',80);
  if(item.state==='cancelled')return trim('已取消：'+label);
  const pair=item.tool==='exec_command'?SHELL[shellSceneKind(item.command||data(item).cmd)]:WORDS[item.tool];
  const name=targetOf(item),tail=name?'：'+name:'';
  if(pair)return trim((isLive(item)?pair[0]:pair[1])+tail);
  if(isLive(item))return trim('在'+label);
  return trim(/已(就绪|收起)$/.test(label)?label:'已'+label);
}

// 纯投影：时间由调用方传入，便于测试；wake 是下一次需要重新判断的毫秒数（0 表示不需要）。
export class ToolTray{
  constructor(){this.turn='';this.signature='';this.changedAt=0;this.retired=new Set();this.dismissed=new Set();}
  dismiss(ids){for(const id of ids)this.dismissed.add(id);}
  project(items,{turn='',state='',now=Date.now()}={}){
    if(turn!==this.turn){this.turn=turn;this.signature='';this.changedAt=now;this.retired.clear();this.dismissed.clear();}
    const rows=(Array.isArray(items)?items:[]).filter(i=>i&&!i.hidden&&!quiet.has(i.tool)&&!this.retired.has(idOf(i)));
    const failed=rows.filter(i=>isFailed(i)&&!this.dismissed.has(idOf(i)));
    const normal=rows.filter(i=>!isFailed(i));
    const waiting=state==='waiting_user',running=normal.some(isLive);
    const signature=JSON.stringify([normal.map(i=>[idOf(i),i.state]),failed.map(idOf),waiting]);
    if(signature!==this.signature){this.signature=signature;this.changedAt=now;}
    const idle=now-this.changedAt,yielding=!running&&(state==='thinking'||state==='body');
    const retire=!waiting&&!running&&normal.length>0&&((yielding&&idle>=TRAY.yieldMs)||idle>=TRAY.maxHoldMs);
    if(retire)for(const i of normal)this.retired.add(idOf(i));
    const keep=new Set([...(retire?[]:normal),...failed].map(idOf));
    const shown=rows.filter(i=>keep.has(idOf(i))).slice(-TRAY.maxRows);
    for(const i of failed)if(!shown.includes(i))shown.unshift(i);
    const out=shown.map(i=>({id:idOf(i),state:isFailed(i)?'failed':isLive(i)?'running':'done',text:humanLine(i)}));
    if(waiting)out.push({id:'waiting-user',state:'waiting',text:'在等你回答这个问题'});
    const wake=!retire&&!waiting&&!running&&normal.length>0?Math.max(50,(yielding?TRAY.yieldMs:TRAY.maxHoldMs)-idle):0;
    return {open:out.length>0,rows:out,waiting,failedIds:failed.map(idOf),wake};
  }
}

// 挂在头像所在的 .presence-header 里，向上展开；没有这个节点时什么都不做。
export function setupToolTray(doc=document,{answer}={}){
  const win=doc.defaultView,host=doc.querySelector('.presence-header');
  if(!host)return {paint(){},close(){}};
  const model=new ToolTray(),nodes=new Map();
  const root=doc.createElement('div'),list=doc.createElement('ul'),action=doc.createElement('button');
  root.id='tool-tray';root.hidden=true;root.dataset.open='false';root.setAttribute('role','status');root.setAttribute('aria-live','polite');
  list.className='tool-tray-list';action.type='button';action.className='tool-tray-action';action.hidden=true;
  root.append(list,action);host.append(root);
  let timer=0,hideTimer=0,signature='',lastItems=[],lastContext={},lastView={failedIds:[]},mode='';
  const reduced=()=>doc.body.classList.contains('reduce-motion')||!!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function render(view){
    if(view.open){
      win.clearTimeout(hideTimer);
      const seen=new Set();
      for(const row of view.rows){
        let li=nodes.get(row.id);
        if(!li){li=doc.createElement('li');li.append(doc.createElement('i'),doc.createElement('span'));nodes.set(row.id,li);list.append(li);}
        if(li.dataset.state!==row.state)li.dataset.state=row.state;
        if(li.lastChild.textContent!==row.text)li.lastChild.textContent=row.text;
        seen.add(row.id);
      }
      for(const [id,li] of nodes)if(!seen.has(id)){li.remove();nodes.delete(id);}
      mode=view.waiting?'answer':view.failedIds.length?'dismiss':'';
      action.hidden=!mode;action.textContent=mode==='answer'?'去回答':'知道了';
      if(root.hidden){root.hidden=false;void root.offsetWidth;}
      root.dataset.open='true';
    }else if(root.dataset.open==='true'){
      root.dataset.open='false';
      hideTimer=win.setTimeout(()=>{if(root.dataset.open==='false')root.hidden=true;},reduced()?0:TRAY.closeMs);
    }
  }
  function paint(items,context={}){
    lastItems=items;lastContext=context;win.clearTimeout(timer);
    const view=model.project(items,{...context,now:Date.now()});lastView=view;
    const key=JSON.stringify([view.open,view.rows,view.waiting,view.failedIds]);
    if(key!==signature){signature=key;render(view);}
    if(view.wake)timer=win.setTimeout(()=>paint(lastItems,lastContext),view.wake+20);
  }
  action.onclick=()=>{
    if(mode==='answer'){(answer||(()=>doc.getElementById('ask-orb')?.click()))();return;}
    model.dismiss(lastView.failedIds);paint(lastItems,lastContext);
  };
  return {paint,close(){win.clearTimeout(timer);win.clearTimeout(hideTimer);root.remove();}};
}
