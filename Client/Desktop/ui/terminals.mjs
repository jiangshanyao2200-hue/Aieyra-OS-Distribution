// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: active; stopped; failed; stateText; label; setupTerminals
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/terminals.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {animateUI} from './motion.mjs';
import {el} from './views.mjs';
import {setupTerminalScreen} from './terminal-screen.mjs';

const active=row=>row.state==='starting'||row.state==='running'||row.exit_code==null&&['cancelled','timed_out'].includes(row.state);
// 用户主动结束的终端是“已停止”，不是运行失败。
const stopped=row=>row.state==='cancelled'&&row.exit_code!=null;
const failed=row=>!stopped(row)&&(row.exit_code!=null&&row.exit_code!==0||['interrupted','interrupted_unknown','rejected','timed_out'].includes(row.state));
// 运行时以Brief说明动作，状态光点保留；完整状态和退出码在悬停/读屏中可查。
const stateText=row=>active(row)?(row.state==='starting'?'正在启动':'运行中'):stopped(row)?'已停止':failed(row)?'未成功':'已结束';
const label=row=>row.description||row.cmd||'终端 '+row.session_id;

export function setupTerminals(api,doc=document){
  // 后台终端（UI设计知识库 形态 §9、§15 K1）：首页右侧栏每个后台或交互式会话一个小圆；点开是贴着右侧栏的玻璃弹窗，不再跳到单独页面。
  // 弹窗里只有终端本身：左上角收起，旁边是状态；直接在终端底部的光标处输入；滚轮往上翻时不打扰，点终端以外的地方回到最新。
  const $=id=>doc.getElementById(id),rail=$('terminal-orbs'),pop=$('terminal-pop'),win=doc.defaultView;
  let scope=null,key='',ownerKey='',rows=[],selected=0,epoch=0,lastList=0,listBusy='',closed=false,stopBusy='',open=false,mutation=0;
  const current=()=>rows.find(row=>row.session_id===selected);
  const listed=()=>rows.filter(row=>row.background||row.tty&&active(row));
  const screen=setupTerminalScreen(api,{node:$('terminal-pop-screen'),getScope:()=>scope,getRow:current,getRevision:()=>mutation,markMutation:()=>++mutation,
    onReceipt:(result,revision)=>{if(revision!==mutation||current()?.session_id!==result.session_id)return;const {terminal_output,output,...receipt}=result;Object.assign(current(),receipt);drawHead();},
    onError:message=>{$('terminal-pop-error').textContent=message;}},doc);
  const matching=(result,target)=>result?.task_id===target.task_id&&result?.agent_id===target.agent_id&&result?.generation===target.generation;
  function checked(result){if(result?.ok===false)throw Error(result.error?.message||result.error||'终端操作未成功');return result;}
  function drawHead(){
    const row=current(),state=$('terminal-pop-state');
    $('terminal-pop-title').textContent=row?label(row):'终端';$('terminal-pop-title').title=row?.cmd||'';
    state.textContent=row?[active(row)?'':stateText(row),row.private_output?'后续输出保密':''].filter(Boolean).join(' · '):'';
    state.title=row?[stateText(row),row.exit_code==null?'':'退出码 '+row.exit_code].filter(Boolean).join(' · '):'';
    state.setAttribute('aria-label',state.title);
    state.dataset.state=!row?'ended':active(row)?'active':failed(row)?'failed':'ended';
    $('terminal-stop').hidden=!row||!active(row);$('terminal-stop').disabled=stopBusy===key+':'+selected;
    // 多于一个会话时，标题右侧出现会话标签。
    const tabs=$('terminal-pop-tabs'),shown=listed();tabs.hidden=shown.length<2;
    const byID=new Map([...tabs.children].map(node=>[Number(node.dataset.session),node]));
    for(const r of shown){
      let node=byID.get(r.session_id);
      if(!node){node=el('button',undefined,'tp-tab');node.type='button';node.dataset.session=String(r.session_id);node.onclick=()=>select(r.session_id);tabs.append(node);}
      node.textContent=label(r);node.title=label(r)+' · '+stateText(r);node.dataset.state=active(r)?'active':'ended';node.setAttribute('aria-current',String(r.session_id===selected));byID.delete(r.session_id);
    }
    for(const node of byID.values())node.remove();
  }
  function select(id){
    if(selected!==id){selected=id;screen.reset();$('terminal-pop-error').textContent='';}
    drawHead();screen.show(open&&!!current());if(open)screen.focus();
  }
  function show(id=0){
    open=true;pop.hidden=false;rail.dataset.open='true';
    select(id||(current()?selected:0)||listed().find(active)?.session_id||listed()[0]?.session_id||0);
    paintOrbs();lastList=0;void refresh();
  }
  function hide(){
    if(!open)return;open=false;screen.show(false);delete rail.dataset.open;paintOrbs();
    const done=()=>{if(!open)pop.hidden=true;};
    if(doc.body.classList.contains('reduce-motion')||doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||!pop.animate)return done();
    const animation=animateUI(pop,[{opacity:1,translate:'0 0',scale:'1'},{opacity:0,translate:'14px -6px',scale:'.97'}]);if(animation)animation.finished.then(done,done);else done();
  }
  function orb(row,count=0){
    const node=el('button',undefined,'term-orb'),tip=el('span',undefined,'term-tip');node.type='button';
    node.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8.5l3.5 3.5L6 15.5M12 16h6"/></svg><i class="term-dot" aria-hidden="true"></i>';
    if(count){node.dataset.count=String(count);node.append(el('b',String(count),'term-count'));tip.textContent=count+' 个后台终端';node.onclick=()=>open?hide():show();}
    else{node.dataset.session=String(row.session_id);node.dataset.state=active(row)?'running':'idle';tip.textContent=label(row)+' · '+stateText(row);node.onclick=()=>open&&selected===row.session_id?hide():show(row.session_id);}
    node.setAttribute('aria-label','后台终端：'+tip.textContent);node.setAttribute('aria-expanded',String(open&&(!!count||selected===row.session_id)));node.append(tip);return node;
  }
  function paintOrbs(){
    // 只放后台常驻或交互式（PTY）的会话；前台命令已经在展示台的终端里。
    const shown=listed(),running=rows.filter(active).length;
    rail.hidden=!shown.length;rail.title=`后台终端 · ${running} 个运行中`;
    const signature=JSON.stringify([open&&selected,shown.map(r=>[r.session_id,active(r),r.cmd,r.description,r.state])]);if(rail.dataset.key===signature)return;rail.dataset.key=signature;
    rail.replaceChildren(...(shown.length>3?[orb(null,shown.length)]:shown.map(row=>orb(row))));
  }
  function draw(){
    paintOrbs();
    if(!open)return;
    if(!current()){const next=listed().find(active)?.session_id||listed()[0]?.session_id||0;if(!next){hide();return;}select(next);}
    else drawHead();
  }
  async function refresh(){
    if(!scope||closed||typeof api.terminals!=='function'||listBusy===key)return;
    const target={...scope},captured=key,version=epoch,operationVersion=mutation;listBusy=captured;lastList=Date.now();
    try{
      const result=checked(await api.terminals(target));
      if(key!==captured||version!==epoch||operationVersion!==mutation||!matching(result,target))return;
      if(!result.unchanged){rows=result.sessions||[];draw();}
    }catch(error){if(key===captured&&version===epoch&&open)$('terminal-pop-error').textContent=error.message;}
    finally{if(version===epoch&&listBusy===captured)listBusy='';}
  }
  async function stop(){
    const row=current();if(!row||!scope)return;
    const target={...scope},captured=key,version=epoch,id=selected,busy=captured+':'+id;if(stopBusy===busy)return;
    stopBusy=busy;mutation++;drawHead();
    try{
      const response=checked(await api.terminalInput({...target,session_id:id,session_generation:row.generation,request_id:crypto.randomUUID(),terminate:true}));
      if(key!==captured||version!==epoch||selected!==id||!matching(response,target))return;
      const result=checked(response.result);if(result.session_id!==id||result.generation!==row.generation)return;
      Object.assign(current(),result);$('terminal-pop-error').textContent='';lastList=0;
    }catch(error){if(key===captured&&version===epoch&&selected===id)$('terminal-pop-error').textContent=error.message+'；未自动重试。';}
    finally{mutation++;if(stopBusy===busy)stopBusy='';if(key===captured&&version===epoch)drawHead();}
  }
  $('terminal-collapse').onclick=hide;
  $('terminal-stop').onclick=()=>void stop();
  // Esc 在终端里属于终端程序；焦点在弹窗的其他地方时才收起。
  pop.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!$('terminal-pop-screen').contains(event.target)){event.preventDefault();event.stopPropagation();hide();}});
  doc.addEventListener('pointerdown',event=>{if(open&&!$('terminal-pop-screen').contains(event.target))screen.toBottom();},true);
  win.addEventListener('beforeunload',()=>{closed=true;epoch++;});
  return {
    update(snapshot){
      const role=snapshot.roles?.find(row=>row.role==='matrix'),nextKey=[snapshot.core_epoch,snapshot.session_id,role?.id,role?.generation].join(':');
      if(nextKey!==key){
        // 同一任务换了一轮：后台终端还在，弹窗不关，只按新一轮重新接上；换 CORE、任务或 Agent 才全部清空。
        const owner=[snapshot.core_epoch,snapshot.session_id,role?.id].join(':'),same=owner===ownerKey;ownerKey=owner;
        key=nextKey;epoch++;scope=role?.id&&role.generation>0?{task_id:snapshot.session_id,agent_id:role.id,generation:role.generation}:null;
        mutation++;lastList=0;listBusy='';stopBusy='';
        if(same&&scope){if(open)screen.show(!!current());}
        else{rows=[];selected=0;screen.reset();$('terminal-pop-error').textContent='';hide();}
        draw();
      }
      if(Date.now()-lastList>1000)void refresh();
    },
    open:show,close:hide,
  };
}
