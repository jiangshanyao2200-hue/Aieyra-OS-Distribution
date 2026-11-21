import {activityData} from '../../../../presentation/receipt.mjs';
import {cleanTerminal} from './text.mjs';
import {createReadonlyTerminal} from './readonly.mjs';

const shellTools=new Set(['exec_command','write_stdin','read_shell_output']);
const maxOutput=256*1024;
const active=row=>row.active??(['starting','running'].includes(row.state)||row.exit_code==null&&['cancelled','timed_out'].includes(row.state));
const stateText=row=>({starting:'正在启动',running:'运行中',exited:'已退出',completed:'已完成',cancelled:row.exit_code==null?'正在停止':'已停止',timed_out:row.exit_code==null?'超时，等待退出':'已超时',interrupted:'已中断',interrupted_unknown:'状态待确认',rejected:'未启动',failed:'未成功'})[row.state]||'等待回执';
const safeVT=value=>String(value||'').replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g,'');
const safeText=value=>cleanTerminal(safeVT(value)).replace(/[\r\x7f-\x9f]/g,'');
const startedAt=row=>typeof row.started_at==='number'?(row.started_at>1e14?row.started_at/1000:row.started_at):Date.parse(row.started_at)||0;
const sameScope=(a,b)=>a?.task_id===b?.task_id&&a?.agent_id===b?.agent_id&&a?.generation===b?.generation;
const validScope=s=>s&&typeof s.task_id==='string'&&s.task_id&&typeof s.agent_id==='string'&&s.agent_id&&Number.isSafeInteger(s.generation)&&s.generation>0;
const sessionKey=row=>row.key||`${row.generation}:${row.session_id}`;
const checked=response=>{if(!response||response.ok===false)throw Error(response?.error?.message||response?.error||'终端读取失败');return response;};
const tail=text=>{let start=Math.max(0,text.length-maxOutput);if(start&&/[\uDC00-\uDFFF]/.test(text[start]))start++;return text.slice(start);};
// 提示符与状态行的颜色：Eyra 的蓝白、暗灰、暖红（与界面同一套颜色）。
const color=(rgb,text)=>`\x1b[38;2;${rgb}m${text}\x1b[0m`;
const dim=text=>color('107;115;133',text),warn=text=>color('227;162;156',text);
// 提示符写的是谁在敲：Eyra 蓝白；协同形态里 Nova、莹的执行窗口换成各自的名字和角色色。
const promptOf=({name='Eyra',rgb='169;192;236'}={})=>color(rgb,name)+' ',PROMPT_END=' '+color('230;233;240','❯')+' ';
// 等前面的并行命令出现的最长时间；超时后不再为它挡住后面的命令。
const WAIT_MS=4000;
const CRLF=String.fromCharCode(13,10),JOURNAL_MAX=768*1024,bytes=text=>new TextEncoder().encode(text).length;
const short=value=>{const line=String(value||'').split(CRLF[1])[0],chars=Array.from(line);return chars.length>40?chars.slice(0,40).join('')+'…':line;};
const shortDir=value=>{const parts=safeText(value||'').split(/[\\/]+/).filter(Boolean);return dim(parts.at(-1)||'~');};

export function checkTerminalPage(response,target){
  checked(response);
  if(!sameScope(response,target))throw Error('终端所属任务已改变');
  const row=checked(response.result);
  if(row.session_id!==target.session_id||row.generation!==target.session_generation)throw Error('终端所属会话已改变');
  if(!Number.isSafeInteger(target.offset)||target.offset<0||!Number.isSafeInteger(row.next_offset)||row.next_offset<target.offset||!Number.isSafeInteger(row.logged_bytes)||row.logged_bytes<row.next_offset)throw Error('终端输出游标无效');
  if(row.next_offset===target.offset&&(target.terminal?row.terminal_output:row.output))throw Error('终端输出未推进游标');
  return row;
}

// 日志游标使用 CORE 的原始字节数，不能用中文字符数或动画进度代替。
// 同一 Matrix 的前台记录跨轮保留；换 CORE、项目或 Agent 时全部清空。
export class TerminalTranscript{
  constructor(who){this.prompt=promptOf(who);this.owner='';this.scope=null;this.entries=new Map();this.order=[];this.sessions=[];this.clearJournal();}
  // 前台终端是一条只追加的流（Codex X1-03）：命令按 CORE 顺序各敲一次，输出按到达顺序接在后面；
  // 换了来源就插一行暗色的来源标记。已经显示过的内容不重排、不重敲；人看不到退出码和用时（UI设计知识库 形态 §15.11 K3）。
  clearJournal(){this.journal=[];this.journalSize=0;this.lastSource='';this.fresh=[];this.trimmed=false;this.waiting=new Map();}
  journalable(entry){return !entry.tty&&!entry.background;}
  push(segment){
    if(segment.text.length>JOURNAL_MAX/2){segment={...segment,text:tail(segment.text)};this.trimmed=true;}
    this.journal.push(segment);this.journalSize+=segment.text.length;
    // 超过上限时一次裁掉一半，避免每次追加都触发整屏重画。
    if(this.journalSize>JOURNAL_MAX){while(this.journalSize>JOURNAL_MAX/2&&this.journal.length>1)this.journalSize-=this.journal.shift().text.length;this.trimmed=true;}
    return segment;
  }
  announce(entry){
    if(entry.announced||!this.journalable(entry))return;
    entry.announced=true;this.push({kind:'command',text:CRLF+(entry.prompt||this.prompt)+shortDir(entry.workdir)+PROMPT_END+(entry.cmd||entry.description||'')+CRLF});this.lastSource=entry.key;
  }
  notes(entry){
    for(const [flag,label] of [['private_output','[后续输出保密]'],['log_incomplete','[日志保存不完整]']])
      if(entry[flag]&&!entry['noted_'+flag]&&this.journalable(entry)){entry['noted_'+flag]=true;this.push({kind:'status',text:CRLF+dim(label)+CRLF});this.lastSource='';}
  }
  write(entry,text){
    if(!text||!this.journalable(entry))return;
    // 命令还没按顺序敲出时先攒着，等 flush 排好序再一起写（Codex X1 复测：预览提前敲出会打乱并行命令的顺序）。
    if(!entry.announced){entry.pending=(entry.pending||'')+text;if(!this.fresh.includes(entry.key))this.fresh.push(entry.key);return;}
    if(this.lastSource!==entry.key)this.push({kind:'status',text:CRLF+dim('↳ '+short(entry.description||entry.cmd||'终端 '+entry.session_id))+CRLF});
    const segment=this.push({kind:'output',text});this.lastSource=entry.key;this.notes(entry);return segment;
  }
  // tick：来自一次活动快照（ingest）。只有快照才推进"多等一轮"的计数，绘制时的 flush 不推进。
  flush(tick=false){
    const fresh=[...new Set(this.fresh)].map(key=>this.entries.get(key)).filter(entry=>entry&&!entry.announced&&this.journalable(entry));this.fresh=[];
    // 同一批并行调用按 CORE 的 sequence 排（Codex X1-01、seq48）。活动里已有 sequence、但还没有会话号的命令记在 this.waiting。
    // 会话列表常常先到：这时按用途或命令文字认领一个等待中的调用，拿到它的 sequence。
    // 有 sequence 的命令等排在它前面、还没认领的调用；没有 sequence 的命令只在没有任何等待时放行
    // （活动里直接认出的立即放行，只从会话列表来的多等两轮快照）。
    const now=Date.now();
    for(const [key,w] of this.waiting)if(now-w.at>WAIT_MS)this.waiting.delete(key);
    for(const entry of fresh)if(!entry.sequence){
      const w=[...this.waiting.values()].find(w=>!w.claimed&&(w.description&&w.description===entry.description||w.cmd&&w.cmd===entry.cmd));
      if(w){w.claimed=entry.key;entry.sequence=w.sequence;}
    }
    if(tick)for(const entry of fresh)if(!entry.sequence)entry.waits=(entry.waits||0)+1;
    const open=[...this.waiting.values()].filter(w=>!w.claimed),gate=Math.min(Number.MAX_SAFE_INTEGER,...open.map(w=>w.sequence));
    const known=entry=>entry.sequence?entry.sequence<=gate:!open.length&&(entry.seen||entry.waits>=2);
    const ready=fresh.filter(entry=>(entry.cmd||entry.description||entry.pending)&&known(entry)),later=fresh.filter(entry=>!ready.includes(entry));
    const order=entry=>entry.sequence||Number.MAX_SAFE_INTEGER;
    ready.sort((a,b)=>a.generation-b.generation||order(a)-order(b)||startedAt(a)-startedAt(b));
    for(const entry of ready){this.announce(entry);if(entry.pending){const text=entry.pending;entry.pending='';this.write(entry,text);}}
    this.fresh.push(...later.map(entry=>entry.key));
    for(const key of this.order){const entry=this.entries.get(key);if(entry?.announced)this.notes(entry);}
  }
  bind(snapshot,scope){
    scope=validScope(scope)?scope:null;
    const owner=scope?JSON.stringify([snapshot?.core_epoch,scope.task_id,scope.agent_id]):'';
    const changed=owner!==this.owner;
    if(changed){this.owner=owner;this.entries.clear();this.order=[];this.sessions=[];this.clearJournal();}
    if(!sameScope(this.scope,scope))this.sessions=[];
    this.scope=scope?{task_id:scope.task_id,agent_id:scope.agent_id,generation:scope.generation}:null;
    return changed;
  }
  remember(row){
    if(!Number.isSafeInteger(row.session_id)||row.session_id<=0||!Number.isSafeInteger(row.generation)||row.generation<=0)return null;
    const key=sessionKey(row);let entry=this.entries.get(key);
    if(!entry){entry={key,session_id:row.session_id,generation:row.generation,offset:0,output:'',truncated:false};this.entries.set(key,entry);this.order.push(key);this.fresh.push(key);}
    // 迟到的活动快照不能把已确认退出的进程重新显示为运行中。
    if(row.state&&(!entry.state||active(entry)||!active(row)))entry.state=row.state;
    for(const k of ['cmd','description','workdir'])if(typeof row[k]==='string'&&row[k])entry[k]=safeText(row[k]);
    if(row.started_at&&!entry.started_at)entry.started_at=row.started_at;
    if(Number.isSafeInteger(row.sequence)&&row.sequence>0&&!entry.sequence)entry.sequence=row.sequence;
    if(row.exit_code!=null)entry.exit_code=row.exit_code;
    if(Number.isFinite(row.duration_ms)&&row.duration_ms>0)entry.duration_ms=row.duration_ms;
    if(Number.isSafeInteger(row.logged_bytes))entry.logged_bytes=Math.max(entry.logged_bytes||0,row.logged_bytes);
    for(const k of ['tty','background','private_output','log_incomplete'])if(row[k])entry[k]=true;
    while(this.order.length>120)this.entries.delete(this.order.shift());
    return entry;
  }
  ingest(snapshot,presentation){
    if(!this.scope)return;
    const role=snapshot?.roles?.find(row=>row.id===this.scope.agent_id);
    const rows=[...(role?.activity?.items||[]),...(presentation?.terminal?.()||presentation?.current?.()||[])];
    for(const item of rows){
      if(item.hidden||!shellTools.has(item.tool)||item.generation!==this.scope.generation||item.agent&&item.agent!==this.scope.agent_id)continue;
      const p=activityData(item),id=item.session_id||p.session_id,generation=p.generation||item.generation;
      const waitKey=item.key||item.id;
      if(item.tool==='exec_command'&&item.sequence>0&&generation===this.scope.generation){
        if(id>0||!['queued','running'].includes(item.state))this.waiting.delete(waitKey);
        else if(!this.waiting.has(waitKey))this.waiting.set(waitKey,{sequence:item.sequence,at:Date.now(),cmd:safeText(item.command||p.cmd||''),description:safeText(item.title||p.description||'')});
      }
      if(generation!==this.scope.generation&&(!p.background||generation>this.scope.generation))continue;
      const previous=this.entries.get(`${generation}:${id}`);
      if(item.revision&&item.revision<(previous?.activityRevision||0))continue;
      const entry=this.remember({...p,session_id:id,generation,sequence:item.sequence,
        ...(item.tool==='exec_command'?{cmd:item.command||p.cmd||'',description:item.title||p.description||'',started_at:p.started_at||item.started_at}:{}),
        state:p.state||(item.state==='running'?'running':undefined)});
      if(!entry)continue;
      entry.activityRevision=Math.max(entry.activityRevision||0,item.revision||0);entry.seen=true;
      if(typeof p.output==='string'&&(!Number.isSafeInteger(p.next_offset)||p.next_offset>=(entry.previewOffset||0))){entry.preview=tail(safeText(p.output));entry.previewOffset=p.next_offset;}
      // 预览恰好是从头开始的完整输出时，当作第一页记入终端流；之后从它的末尾接着读，不会重复。
      if(typeof p.output==='string'&&p.output&&!entry.read&&entry.offset===0&&p.next_offset===bytes(p.output)){entry.output=tail(safeText(p.output));entry.offset=p.next_offset;entry.read=true;this.write(entry,entry.output);}
    }
    this.flush(true);
  }
  setSessions(rows){
    this.sessions=(Array.isArray(rows)?rows:[]).filter(r=>Number.isSafeInteger(r.session_id)&&r.session_id>0&&Number.isSafeInteger(r.generation)&&r.generation>0&&r.generation<=this.scope?.generation&&(r.generation===this.scope.generation||r.background)).map(r=>({...r}));
    // 会话列表没有调用顺序；新会话等活动快照带来 sequence 后再敲出命令（见 ingest）。
    for(const row of this.sessions)this.remember(row);
  }
  applyPage(target,response){
    if(!sameScope(this.scope,target))return false;
    const entry=this.entries.get(`${target.session_generation}:${target.session_id}`);
    if(!entry||entry.offset!==target.offset)return false;
    const row=checkTerminalPage(response,target);
    const output=target.terminal?row.terminal_output||'':safeText(row.output||'');
    this.remember(row);
    const text=entry.output+output;
    if(text.length>maxOutput)entry.truncated=true;
    entry.output=tail(text);entry.offset=row.next_offset;entry.read=true;this.write(entry,output);
    return true;
  }
  rows(kind='terminal',sessionId=0,sessionGeneration=0){
    return this.order.map(key=>this.entries.get(key)).filter(r=>r&&(kind==='pty'?r.session_id===sessionId&&(!sessionGeneration||r.generation===sessionGeneration):!r.tty&&!r.background));
  }
  segments(kind='terminal',sessionId=0,sessionGeneration=0){
    if(kind!=='pty'){this.flush();return this.trimmed?[{kind:'status',text:dim('[仅保留最近输出；完整日志仍在 CORE]')+CRLF},...this.journal]:this.journal.slice();}
    const rows=this.rows(kind,sessionId,sessionGeneration).sort((a,b)=>{
      return a.generation-b.generation||startedAt(a)-startedAt(b);
    });
    const segments=[];
    // 像一个人在同一个终端里连续操作（UI设计知识库 形态 §7.1）：彩色提示符 + 命令，紧跟输出，结尾一行暗色的状态、退出码和用时。
    for(const row of rows){
      if(row.cmd)segments.push({kind:'command',text:`\r\n${this.prompt}${shortDir(row.workdir)}${PROMPT_END}${safeText(row.cmd)}\r\n`});
      if(row.truncated)segments.push({kind:'status',text:dim('[仅保留最近输出；完整日志仍在 CORE]')+'\r\n'});
      const output=row.read?row.output:row.preview||'';
      if(output)segments.push({kind:'output',text:row.tty?safeVT(output):safeText(output)});
      if(row.private_output)segments.push({kind:'status',text:'\r\n'+dim('[后续输出保密]')+'\r\n'});
      if(row.log_incomplete)segments.push({kind:'status',text:'\r\n'+dim('[日志保存不完整]')+'\r\n'});
    }
    let size=0;return segments.reverse().filter(s=>(size+=s.text.length)<=768*1024).reverse();
  }
}

function suffixSegments(segments,offset){
  const output=[];
  for(const segment of segments){if(offset>=segment.text.length){offset-=segment.text.length;continue;}output.push({...segment,text:segment.text.slice(offset)});offset=0;}
  return output;
}

// 只读取现有进程的回执。组件从不创建进程，也不写 stdin 或调整原生 PTY。
export function createTerminalView({api={},doc=document,getScope,scope,kind='terminal',sessionId=0,sessionGeneration=0,fontSize=13,who,transcript,emptyText,loadTerminal,openTerminal,vendorStyle,textOnly=false}={}){
  const win=doc.defaultView,model=transcript||new TerminalTranscript(who),name=who?.name||'Eyra';
  const make=(tag,className,text)=>{const e=doc.createElement(tag);e.className=className;if(text)e.textContent=text;return e;};
  const element=make('section','desktop-terminal-view'),toolbar=make('div','terminal-view-toolbar'),state=make('span','terminal-view-state','等待回执');
  const screen=make('div','terminal-view-screen'),empty=make('div','terminal-view-empty',emptyText||'等待 '+name+' 的命令。'),error=make('p','terminal-view-error');
  error.hidden=true;screen.setAttribute('aria-label',kind==='pty'?'常驻终端输出，只读':name+' 的命令与输出，只读');
  // 正在跑的命令（用户 2026-10-13：命令在跑却看不出状态）：终端最下方每条一行，用途 + 已用时间 + 一道流动的进度光。
  const running=make('div','terminal-view-running');running.hidden=true;running.setAttribute('role','status');
  toolbar.append(state);element.append(toolbar,screen,running,empty,error);
  if(!doc.querySelector('link[data-terminal-view-style]')){const css=doc.createElement('link');css.rel='stylesheet';css.href=new URL('./desktop.css',import.meta.url).href;css.dataset.terminalViewStyle='';doc.head.append(css);}
  if(!textOnly&&vendorStyle&&!doc.querySelector('link[data-terminal-view-xterm-style],link[href$="vendor/xterm.css"]')){const css=doc.createElement('link');css.rel='stylesheet';css.href=vendorStyle;css.dataset.terminalViewXtermStyle='';doc.head.append(css);}
  let term,textView,fit,loading=null,closed=false,suspended=false,timer=null,epoch=0,coreEpoch,listAt=0,listBusy=false,readBusy=false,following=true;
  let sessionsSignature='',renderBusy=false,drawVersion=0,wanted=null,displayed='',introPending=true,introFrame=0;
  let seenCommands=new Set(),screenWidth=0,screenHeight=0,cssVisible=true;
  const writes=new Set();
  // The screen's observer owns its measured size. Polling and each async
  // continuation reuse it instead of repeatedly forcing layout after writes.
  const visible=()=>!closed&&!suspended&&doc.visibilityState!=='hidden'&&element.isConnected&&!element.closest('[hidden]')&&screenWidth>0&&screenHeight>0&&cssVisible;
  // 只给正在展示的视图安排读取；收起保留原会话、字节游标和终端文本。
  function syncPolling(){
    if(!visible()){
      if(timer!==null){win.clearInterval(timer);timer=null;}
      drawVersion++;wanted=null;win.cancelAnimationFrame?.(introFrame);introFrame=0;
      return false;
    }
    if(timer===null)timer=win.setInterval(()=>{if(syncPolling()){void ensure();void refreshSessions();void read();paintRunning();}},240);
    return true;
  }
  const reduced=()=>doc.body.classList.contains('reduce-motion')||win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const announce=message=>{if(!closed){error.textContent=message;error.hidden=!message;}};
  const valid=(ticket,target)=>!closed&&ticket===epoch&&sameScope(model.scope,target);
  const write=text=>new Promise(resolve=>{
    if(textView&&!closed){textView.append(text);return resolve();}
    if(!term||closed)return resolve();
    const done=()=>{writes.delete(done);resolve();};writes.add(done);term.write(text,done);
  });
  const pause=ms=>new Promise(r=>win.setTimeout(r,ms));
  function revealOutput(){
    if(textView){introPending=false;if(following&&visible())textView.follow();return;}
    if(!term||!following||!visible())return;
    if(!introPending||reduced()){introPending=false;term.scrollToBottom();return;}
    introPending=false;win.cancelAnimationFrame?.(introFrame);
    const base=term.buffer.active.baseY,start=Math.max(0,base-Math.min(120,term.rows*3)),begun=Date.now(),ticket=epoch;
    if(base<=start){term.scrollToBottom();return;}
    const step=()=>{
      introFrame=0;if(closed||ticket!==epoch||!following||!visible()||!term)return;
      const p=Math.min(1,(Date.now()-begun)/120);term.scrollToLine(Math.round(start+(term.buffer.active.baseY-start)*(1-Math.pow(1-p,3))));
      if(p<1)introFrame=win.requestAnimationFrame(step);else term.scrollToBottom();
    };term.scrollToLine(start);introFrame=win.requestAnimationFrame(step);
  }
  // xterm 写入是异步的：必须由同一个绘制循环串行处理，不能在上一批仍在
  // 写入时 reset/追加新快照，否则被打断的半条命令会重复、甚至跨任务残留。
  async function drain(){
    if((!term&&!textView)||closed||renderBusy)return;
    renderBusy=true;
    try{
      while(!closed&&wanted&&following){
        const request=wanted,ticket=drawVersion,drawStarted=Date.now();
        if(request.reset||!request.text.startsWith(displayed)){if(textView){textView.clearSelection();textView.reset();}else{term.clearSelection();term.reset();}displayed='';request.reset=false;}
        if(request.text===displayed)break;
        const animate=request.animate&&visible()&&!reduced()&&doc.visibilityState!=='hidden'&&request.text.length-displayed.length<4096;
        // 命令像被快速敲入（约 120ms 内打完），输出直接流入。
        for(const part of suffixSegments(request.segments,displayed.length)){
          const chars=Array.from(part.text),frames=Math.min(part.kind==='command'?8:12,Math.max(1,Math.ceil(chars.length/(part.kind==='command'?3:512))));
          const count=animate?Math.ceil(chars.length/frames):chars.length||1,started=Date.now();
          for(let i=0;i<chars.length;){
            if(closed||ticket!==drawVersion||!following)break;
            const end=!animate||Date.now()-started>120||Date.now()-drawStarted>120?chars.length:Math.min(chars.length,i+count),chunk=chars.slice(i,end).join('');
            await write(chunk);if(closed)return;displayed+=chunk;i=end;
            if(i<chars.length&&ticket===drawVersion)await pause(part.kind==='command'?12:0);
          }
          if(closed||ticket!==drawVersion||!following)break;
        }
        if(ticket===drawVersion&&following){revealOutput();break;}
      }
    }catch(e){announce('终端绘制失败：'+e.message);}
    finally{renderBusy=false;}
  }
  const runRows=new Map();
  function paintRunning(){
    if(closed)return;
    const live=model.rows(kind,sessionId,sessionGeneration).filter(active),keys=new Set(live.map(sessionKey));
    for(const [key,row] of runRows)if(!keys.has(key)){row.el.remove();runRows.delete(key);}
    for(const r of live){
      const key=sessionKey(r);let row=runRows.get(key);
      if(!row){const el=make('div','terminal-run'),label=make('span','run-label'),time=make('span','run-time'),bar=make('i','run-bar');el.append(label,time,bar);running.append(el);row={el,label,time};runRows.set(key,row);}
      const text=short(r.description||r.cmd||'命令');if(row.label.textContent!==text)row.label.textContent=text;
      // 人看的不显示用时（UI设计知识库 K3）；进行中由光条表示，只在启动阶段给一句状态。
      const phase=r.state==='starting'?'正在启动':'';
      if(row.time.textContent!==phase)row.time.textContent=phase;row.time.hidden=!phase;
    }
    // 只有一条在跑时标题已经写着它的用途，这里只留进行中的光条。
    running.hidden=!live.length;running.dataset.single=String(live.length===1);
  }
  function paint(animate=true,reset=false){
    if(!visible())return;
    paintRunning();
    const segments=model.segments(kind,sessionId,sessionGeneration),text=segments.map(s=>s.text).join(''),rows=model.rows(kind,sessionId,sessionGeneration),row=model.current?.()||rows.filter(active).at(-1)||rows.at(-1);
    empty.hidden=!!text;state.textContent=row?[row.description||short(row.cmd)||stateText(row),row.private_output?'后续输出保密':''].filter(Boolean).join(' · '):emptyText||'等待回执';state.title=row?stateText(row):'';
    if(term)term.options.convertEol=!row?.tty;
    if(!following&&!reset)return;
    // A newer receipt overtaking a transition flushes directly to the latest
    // information. Animation must never form a second output queue.
    if(reset||!wanted||text!==wanted.text||!animate&&renderBusy){wanted={segments,text,animate:animate&&!renderBusy&&text.startsWith(displayed),reset:reset||!!wanted?.reset};drawVersion++;}
    void drain();
  }
  async function ensure(){
    if(term||textView||loading||closed||!visible())return;
    if(textOnly){textView=createReadonlyTerminal(screen,{doc,following:()=>following&&visible(),onSelect:()=>stopFollowing()});paint(false);return;}
    loading=(async()=>{
      if(typeof loadTerminal!=='function'||typeof openTerminal!=='function')throw Error('宿主未提供终端显示能力');
      const {Terminal,FitAddon}=await loadTerminal();
      if(closed||!visible())return;
      term=new Terminal({cols:90,rows:24,allowTransparency:true,scrollback:5000,fontSize,fontFamily:'Consolas, "Cascadia Mono", monospace',cursorBlink:false,disableStdin:true,convertEol:kind!=='pty',
        linkHandler:{activate(){}},theme:{background:'#00000000',foreground:'#dce2ee',cursor:'#adc4ef',selectionBackground:'#a9c0ec38'}});
      // OSC 不能修改剪贴板、标题或生成可点击链接，包括跨页分片的 OSC。
      for(const id of [0,1,2,8,52])term.parser.registerOscHandler(id,()=>true);
      fit=new FitAddon();term.loadAddon(fit);openTerminal(term,screen,doc);screen.querySelector?.('textarea')?.setAttribute('readonly','');
      term.onSelectionChange(()=>{if(term?.hasSelection())stopFollowing();});
      // 窗格入场时宽度从 0 长开：太窄时先按默认列数写，等宽度稳定后再适配，免得提示符被拆行。
      if(screen.getBoundingClientRect().width>=300)fit.fit();else fitTimer=win.setTimeout(()=>{if(term&&visible())fit.fit();},300);
      paint(false);
    })().catch(e=>announce('终端画面暂时不可用：'+e.message)).finally(()=>loading=null);
    await loading;
  }
  async function refreshSessions(){
    if(closed||!model.scope||listBusy||typeof api.terminals!=='function'||Date.now()-listAt<1000||!visible())return;
    const ticket=epoch,target={...model.scope};listAt=Date.now();listBusy=true;
    try{
      const response=checked(await api.terminals(target));if(!valid(ticket,target))return;
      if(!sameScope(response,target))throw Error('终端所属任务已改变');
      if(!response.unchanged){
        model.setSessions(response.sessions||[]);
        const persistent=model.sessions.filter(r=>(r.tty||r.background)&&active(r));
        const signature=JSON.stringify(persistent.map(r=>[r.session_id,r.generation,r.state]));
        if(signature!==sessionsSignature){sessionsSignature=signature;element.dispatchEvent(new win.CustomEvent('terminal-sessions',{detail:{scope:{...target},sessions:persistent.map(r=>({...r}))}}));}
      }
      announce('');paint();void read();
    }catch(e){if(valid(ticket,target))announce(e.message);}
    finally{if(ticket===epoch)listBusy=false;}
  }
  async function read(){
    if(closed||!model.scope||readBusy||!visible()||typeof api.terminalRead!=='function')return;
    const ticket=epoch;readBusy=true;
    try{
      for(const row of model.rows(kind,sessionId,sessionGeneration)){
        if(closed||ticket!==epoch||!visible())return;
        // 前台旧轮记录保留展示，但 CORE 只允许本轮或明确后台保留的原会话读取。
        if(row.generation!==model.scope.generation&&!row.background)continue;
        if(row.read&&!active(row)&&row.offset>=(row.logged_bytes||0))continue;
        const target={...model.scope,session_id:row.session_id,session_generation:row.generation,offset:row.offset,terminal:!!row.tty};
        const response=await api.terminalRead(target);if(!valid(ticket,target))return;
        if(model.applyPage(target,response)){announce('');paint();}
      }
    }catch(e){if(!closed&&ticket===epoch)announce(e.message);}
    finally{if(ticket===epoch)readBusy=false;}
  }
  // 智能跟随（UI设计知识库 形态 §15.11 K3）：只有你用滚轮往上翻、或选中文字时才停下；滚回底部或点终端以外的地方就回到最新。
  // 程序自己的 resize、fit、滚动不改变跟随（Codex X1-02）；恢复时直接画到最新，不重放旧命令。
  const stopFollowing=()=>{following=false;drawVersion++;introPending=false;win.cancelAnimationFrame?.(introFrame);introFrame=0;};
  const resume=()=>{if(closed||following)return;textView?.clearSelection();term?.clearSelection();following=true;paint(false);if(textView)textView.follow();else term?.scrollToBottom();};
  const onWheel=event=>{if(event.deltaY<0)stopFollowing();else if(!following)win.requestAnimationFrame(()=>{const b=term?.buffer.active;if(textView?textView.atBottom():b&&b.viewportY>=b.baseY)resume();});};
  const onPointer=event=>{if(!following&&!element.contains(event.target))resume();};doc.addEventListener('pointerdown',onPointer,true);
  // xterm consumes bubbling wheel events; observe user intent before it does.
  screen.addEventListener('wheel',onWheel,{passive:true,capture:true});
  let fitTimer=0;
  const resize=new win.ResizeObserver(entries=>{
    const box=entries.find(entry=>entry.target===screen)?.contentRect;if(box){screenWidth=box.width;screenHeight=box.height;}
    if(element.isConnected)cssVisible=win.getComputedStyle(element).visibility!=='hidden';
    win.clearTimeout(fitTimer);
    if(syncPolling()){void ensure();fitTimer=win.setTimeout(()=>{if(term&&visible()){fit.fit();if(following)term.scrollToBottom();}},150);}
  });resize.observe(screen);
  const pageChanged=()=>{if(element.isConnected)cssVisible=win.getComputedStyle(element).visibility!=='hidden';if(syncPolling()){void ensure();paint(false);void refreshSessions();void read();}};
  doc.addEventListener('workspace-view-change',pageChanged);doc.addEventListener('visibilitychange',pageChanged);
  const motionChanged=()=>{if(reduced())paint(false);};const motion=new win.MutationObserver(motionChanged);motion.observe(doc.body,{attributes:true,attributeFilter:['class']});
  return {element,
    refresh(){if(!closed&&syncPolling()){void ensure();paint();}},
    suspend(){if(closed)return;suspended=true;syncPolling();win.clearTimeout(fitTimer);win.cancelAnimationFrame?.(introFrame);introFrame=0;},
    update(next,presentation){
      if(closed)return;
      suspended=false;
      const role=next?.roles?.find(r=>r.role==='matrix');
      let target=getScope?getScope(next):scope||(role?.id&&role.generation>0?{task_id:next.session_id,agent_id:role.id,generation:role.generation}:null);
      if(!validScope(target))target=null;
      if(!sameScope(model.scope,target)||next?.core_epoch!==coreEpoch){
        epoch++;listBusy=false;readBusy=false;listAt=0;coreEpoch=next?.core_epoch;
        const changed=model.bind(next,target);following=true;
        if(changed){sessionsSignature='';seenCommands.clear();introPending=true;announce('');paint(false,true);element.dispatchEvent(new win.CustomEvent('terminal-sessions',{detail:{scope:model.scope,sessions:[]}}));}
      }
      model.ingest(next,presentation);
      for(const row of model.rows(kind,sessionId,sessionGeneration)){const key=sessionKey(row);if(!seenCommands.has(key)){seenCommands.add(key);if(following)introPending=true;}}
	  while(seenCommands.size>240)seenCommands.delete(seenCommands.values().next().value);
      if(syncPolling()){void ensure();paint();void refreshSessions();void read();}
    },
    get sessions(){return model.sessions.map(r=>({...r}));},
    close(){if(closed)return;closed=true;epoch++;drawVersion++;if(timer!==null)win.clearInterval(timer);timer=null;win.clearTimeout(fitTimer);win.cancelAnimationFrame?.(introFrame);resize.disconnect();motion.disconnect();doc.removeEventListener('workspace-view-change',pageChanged);doc.removeEventListener('visibilitychange',pageChanged);screen.removeEventListener('wheel',onWheel,true);doc.removeEventListener('pointerdown',onPointer,true);textView?.close();textView=null;term?.dispose();term=null;for(const done of [...writes])done();model.bind(null,null);wanted=null;screen.replaceChildren();},
  };
}
