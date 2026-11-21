// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupTerminalScreen
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/terminal-screen.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {Terminal} from './vendor/xterm.mjs';
import {FitAddon} from './vendor/xterm-fit.mjs';
import {openTerminal} from './terminal-host.mjs';

// 一个原生进程、一条带作用域的字节流。后台终端和 PTY 是同一种终端（UI设计知识库 形态 §15 K2）：
// 交互式会话直接在终端底部的光标处输入；非交互的只读显示。这里不能启动进程；
// 输出交给 xterm 解析，不当作 HTML 或链接插入；OSC 标题、链接、剪贴板一律吞掉。
export function setupTerminalScreen(api,{node,getScope,getRow,getRevision,markMutation,onReceipt,onError},doc=document){
  let term,fit,identity='',epoch=0,offset=0,busy=false,visible=false,closed=false;
  let inputClient='',inputSequence=0,inputQueue='',inputSending=false,inputFailed=false,waiting='',nextSize='',sentSize='';
  let ready=false;
  const currentKey=()=>{const s=getScope(),r=getRow();return s&&r?[s.task_id,s.agent_id,s.generation,r.session_id,r.generation].join(':'):'';};
  const scope=()=>({...getScope(),session_id:getRow().session_id,session_generation:getRow().generation});
  const interactive=()=>!!getRow()?.tty&&getRow()?.state==='running';
  const stdinOff=()=>!visible||!ready||!interactive()||inputFailed;
  function check(response,target){
    if(response?.ok===false)throw Error(response.error?.message||response.error||'终端操作失败');
    if(response?.task_id!==target.task_id||response.agent_id!==target.agent_id||response.generation!==target.generation)throw Error('终端任务已改变');
    const r=response.result;if(r?.ok===false)throw Error(r.error?.message||'终端操作失败');
    if(r?.session_id!==target.session_id||r.generation!==target.session_generation)throw Error('终端会话已改变');
    return r;
  }
  const live=(token,key)=>!closed&&token===epoch&&identity===key&&currentKey()===key;
  function dispose(){epoch++;term?.dispose();term=null;node.replaceChildren();identity='';offset=0;busy=false;inputQueue='';inputSending=false;inputFailed=false;waiting='';sentSize='';nextSize='';ready=false;}
  function ensure(){
    const key=currentKey();if(identity===key&&term)return;
    dispose();if(!key)return;identity=key;inputClient=crypto.randomUUID();inputSequence=0;
    const row=getRow();
    term=new Terminal({cols:row.columns||120,rows:row.rows||30,allowTransparency:true,scrollback:5000,fontSize:13,fontFamily:'Consolas, "Cascadia Mono", monospace',cursorBlink:true,disableStdin:true,convertEol:!row.tty,
      linkHandler:{activate(){}},theme:{background:'#00000000',foreground:'#dce2ee',cursor:'#c9d6ff',cursorAccent:'#0c0e13',selectionBackground:'#a9c0ec38'}});
    for(const id of [0,1,2,8,52])term.parser.registerOscHandler(id,()=>true);
    fit=new FitAddon();term.loadAddon(fit);openTerminal(term,node);
    term.attachCustomKeyEventHandler(event=>{if(event.key==='Escape')event.stopPropagation();return true;});
    term.onData(data=>{
      if(!ready||!visible||inputFailed||!interactive())return;
      if(new TextEncoder().encode(inputQueue+data).length>4096){onError('一次最多输入 4 KiB；超出部分未发送。');return;}
      inputQueue+=data;void flushInput();
    });
    term.onResize(({cols,rows})=>{nextSize=cols+':'+rows;});
  }
  async function flushInput(){
    if(!term||inputSending||waiting||!inputQueue||inputFailed||!visible||!interactive()||getRow()?.input_state==='pending')return;
    const token=epoch,key=identity,target=scope(),chars=inputQueue;inputQueue='';inputSending=true;
    const revision=markMutation();
    const request_id=crypto.randomUUID(),sequence=++inputSequence;
    try{
      const r=check(await api.terminalInput({...target,request_id,chars,input_client:inputClient,input_sequence:sequence}),target);
      if(!live(token,key))return;
      onReceipt(r,revision);
      if(r.input_state==='pending')waiting=request_id;
      else if(r.input_state!=='written')throw Error('按键写入状态未知');
    }catch(error){if(live(token,key)){inputFailed=true;inputQueue='';onError(error.message+'；按键未自动重试，请收起后重新打开终端。');}}
    finally{if(live(token,key)){markMutation();inputSending=false;void flushInput();}}
  }
  async function poll(){
    if(!term||!visible||busy||closed)return;
    const token=epoch,key=identity,target=scope(),revision=getRevision(),tty=!!getRow()?.tty;busy=true;
    try{
      const r=check(await api.terminalRead({...target,offset,terminal:tty}),target);
      if(!live(token,key))return;
      onReceipt(r,revision);
      if(revision===getRevision()&&waiting&&r.input_id===waiting&&r.input_state!=='pending'){
        waiting='';if(r.input_state!=='written'){inputFailed=true;inputQueue='';onError('按键写入失败或未知，未自动重试。');}
      }
      if(!Number.isSafeInteger(r.next_offset)||r.next_offset<offset)throw Error('终端输出游标无效');
      const text=tty?r.terminal_output:r.output;
      if(text){const terminal=term;await new Promise(resolve=>terminal.write(text,resolve));}
      if(!live(token,key))return;
      offset=r.next_offset;
      // 停在末尾却没有进展，可能是不完整的 UTF-8 字符或被 CORE 暂扣的凭据前缀；不能因此锁住输入。
      ready=offset>=r.logged_bytes||!text;
      term.options.disableStdin=stdinOff();
      if(ready&&visible){
        fit.fit();
        if(interactive()&&revision===getRevision()&&nextSize&&nextSize!==sentSize){
          const size=nextSize,[columns,rows]=size.split(':').map(Number);
          const resized=check(await api.terminalResize({...target,columns,rows}),target);
          if(live(token,key)){sentSize=size;onReceipt(resized,revision);}
        }
      }
    }catch(error){if(live(token,key))onError(error.message);}
    finally{if(live(token,key)){busy=false;void flushInput();}}
  }
  const observer=new ResizeObserver(()=>{if(visible&&term&&ready)fit.fit();});observer.observe(node);
  const timer=setInterval(()=>void poll(),200);
  function visibility(next){
    // 重新打开时建立新的输入客户端；之前失败的按键一律丢弃，不重试。
    if(next&&!visible&&inputFailed){dispose();ensure();}
    visible=next;
    if(!visible){inputQueue='';if(term)term.options.disableStdin=true;}
  }
  window.addEventListener('beforeunload',()=>{closed=true;clearInterval(timer);observer.disconnect();dispose();});
  return {
    show(show){
      visibility(!!show&&!!getRow());node.hidden=!visible;
      if(visible){ensure();if(term)term.options.disableStdin=stdinOff();void poll();}
    },
    reset:dispose,
    focus(){if(visible)term?.focus();},
    toBottom(){term?.scrollToBottom();},
  };
}
