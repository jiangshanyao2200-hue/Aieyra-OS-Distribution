// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: LIMIT; live; shell; plain; keyOf; parse; status; operationOutput; OperationTranscript
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/operation-terminal.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Coding feeds the existing terminal renderer with authorized tool receipts.
// Commands and output share its append-only journal, animation and scroll rules.
import {TerminalTranscript} from './desktop/terminal-view.mjs';
import {activityData,activityLabel,activityFacts,activityDetails} from './activity.mjs';
import {cleanTerminal} from '../../../Tool/base/official/terminal/presentation/text.mjs';
import {validateReceiptPage} from '../../../Tool/presentation/receipt-reader.mjs';
import {planData} from '../../../Tool/base/official/update_plan/presentation/model.mjs';

const LIMIT=256*1024,receiptSource=Symbol('receipt-source');
const live=state=>['queued','starting','running','cancelling'].includes(state);
const shell=item=>['terminal','exec_command','write_stdin','read_shell_output'].includes(item.tool)&&!['load_tool','unload_tool'].includes(item.action);
const plain=value=>cleanTerminal(String(value??'').replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g,'')).replace(/[\r\x7f-\x9f]/g,'');
const keyOf=item=>JSON.stringify([item.member,item.generation,item.call_id||item.id]);
const parse=text=>{try{return JSON.parse(text);}catch{return null;}};
const status=state=>({failed:'执行失败',cancelled:'已停止',timed_out:'执行超时',interrupted:'执行中断',interrupted_unknown:'执行结果待确认',waiting_user:'等待回复',persistence_failed:'结果保存失败'})[state];

export function operationOutput(item){
 const d=activityData(item);
 if(shell(item))return plain(d.output||d.text||d.error?.message||d.error||'');
 if(item.tool==='update_plan'){
  const plan=planData(item),states={pending:'待执行',in_progress:'进行中',completed:'已完成',blocked:'受阻',cancelled:'已取消'};
  return plain([plan.objective||plan.summary,...plan.steps.map(step=>'['+(states[step.status]||step.status||'待执行')+'] '+(step.text||step.description||step.title||''))].filter(Boolean).join('\n'));
 }
 if(item.tool==='web_search'){
  const rounds=Array.isArray(d.searches)?d.searches:[{query:d.query,results:d.results}],lines=[];
  for(const round of rounds){
   if(round.query)lines.push('搜索：'+round.query);
   for(const [i,r]of (round.results||[]).entries())lines.push((i+1)+'. '+(r.title||r.url||''),r.url||'',r.snippet||'');
  }
  if(d.answer)lines.push(d.answer);
  if(d.error)lines.push(typeof d.error==='string'?d.error:d.error.message||'搜索失败');
  return plain(lines.filter(Boolean).join('\n'));
 }
 const details=activityDetails(item).filter(s=>!['操作','回执'].includes(s.label)),facts=activityFacts(item);
 const text=[...facts.map(r=>r.label+'：'+r.value),...details.map(s=>s.label+'\n'+s.text)].join('\n');
 if(text)return plain(text);
 if(d.text||typeof d.output==='string')return plain(d.text||d.output);
 // Unknown tools retain a readable, bounded textual receipt.
 return d&&Object.keys(d).length?plain(JSON.stringify(d,null,2)):'';
}

export class OperationTranscript extends TerminalTranscript{
 constructor(){super({name:'Coding'});this.serial=0;this.reading=false;this.selected='';this.processes=new Map();}
 bind(snapshot,scope){const changed=super.bind(snapshot,scope);if(changed){this.serial++;this.selected='';this.processes.clear();}return changed;}
 rows(){return this.order.map(key=>this.entries.get(key)).filter(Boolean);}
 current(){const rows=this.rows(),active=rows.filter(row=>live(row.state));return active.find(row=>row.key===this.selected)||active.at(-1)||rows.find(row=>row.key===this.selected)||rows.at(-1);}
 ingest(snapshot){
  if(!this.scope)return;
  for(const item of snapshot.operations||[]){
   const key=keyOf(item);let entry=this.entries.get(key);
   if(entry&&Number(item.revision)<entry.revision)continue;
   if(!entry){
    const name=plain(item.name||item.member||'Coding'),cmd=plain(item.command||item.text?.replace(/^\$ /,'')||[item.tool,item.action,...(item.targets||[])].filter(Boolean).join(' '));
    entry={key,session_id:key,generation:item.generation,cmd,description:plain(name+' · '+activityLabel(item)),prompt:'\x1b[38;2;'+(item.member==='vaya'?'180;198;173':'169;192;236')+'m'+name+'\x1b[0m ',output:'',state:'starting',signature:'',readAt:0};
    this.entries.set(key,entry);this.order.push(key);this.announce(entry);this.selected=key;
   }
   const signature=JSON.stringify([item.revision,item.state,item.preview,item.receipt_version]);
   entry.item=item;entry.revision=Number(item.revision)||entry.revision||0;
   if(signature!==entry.signature){entry.signature=signature;entry.needsRead=true;entry.noProcess=false;if(!entry.receiptSeen)this.project(entry,shell(item)?{...item,preview:{state:activityData(item).state}}:item);}
  }
  // Keep bounded display memory; full originals remain in the receipt service.
  while(this.order.length>400)this.entries.delete(this.order.shift());
 }
 project(entry,item){
  const d=activityData(item),rawState=shell(item)&&d.state?d.state:item.state,state=['rejected','spawn_failed'].includes(rawState)?'failed':rawState;
  if(live(state)||entry.state!==state)this.selected=entry.key;
  entry.state=state==='queued'?'starting':state==='cancelling'?'running':state;
  entry.active=live(state);
  const output=shell(item)&&entry.processRead?'':operationOutput(item);
  if(output&&output!==entry.output){
   const append=output.startsWith(entry.output)?output.slice(entry.output.length):'\n'+(entry.output?'[回执更新]\n':'')+output;
   const segment=this.write(entry,append);if(shell(item)&&!entry.processRead&&segment){segment[receiptSource]=entry.key;entry.receiptFallback=true;}entry.output=output;
  }
  const label=status(state);
  if(label&&entry.notice!==label){this.write(entry,'\n['+label+']\n');entry.notice=label;}
 }
 // A receipt may be readable before its process is discoverable. Catch up
 // using normalized text, but commit only the Core's raw byte cursor. Matching
 // prefixes preserve legitimate repeated lines; bounded tail fallbacks are
 // replaced at their own journal position when the authoritative log differs.
 processOutput(entry,output,row){
  if(!entry.processRead&&entry.receiptFallback&&!entry.logReplay)entry.logReplay={expected:entry.output,received:''};
  if(entry.logReplay){
   const replay=entry.logReplay;replay.received+=output;
   if(replay.received.length<replay.expected.length&&replay.expected.startsWith(replay.received)&&(live(row.state)||row.next_offset<row.logged_bytes))return;
   entry.processRead=true;entry.receiptFallback=false;entry.logReplay=null;
   if(replay.received.startsWith(replay.expected))this.write(entry,replay.received.slice(replay.expected.length));
   else if(this.journal.some(s=>s[receiptSource]===entry.key)){
    let replaced=false;const journal=this.journal.flatMap(s=>{if(s[receiptSource]!==entry.key)return [s];if(replaced)return [];replaced=true;return [{kind:'output',text:replay.received}];});
    this.journal=[];this.journalSize=0;for(const s of journal)this.push(s);
   }else this.write(entry,replay.received);
   entry.output=replay.received.slice(-LIMIT);return;
  }
  entry.processRead=true;this.write(entry,output);entry.output=(entry.output+output).slice(-LIMIT);
 }
 async refreshReceipts(readPage,{readTerminal,isCurrent=()=>true,onChange=()=>{}}={}){
  if(this.reading||!this.scope||!isCurrent())return;
  this.reading=true;const serial=this.serial,now=Date.now();
  try{
   const queue=this.rows().filter(e=>e.page||e.needsRead||live(e.state)&&now-e.readAt>=500)
    .sort((a,b)=>Number(live(b.state))-Number(live(a.state))||a.readAt-b.readAt).slice(0,4);
   for(const entry of queue){
    if(serial!==this.serial||!isCurrent())return;
    const page=entry.page||{input:'',output:'',inputOffset:0,outputOffset:0},args={role:entry.item.member,call_id:entry.item.call_id,generation:entry.item.generation,input_offset:page.inputOffset,output_offset:page.outputOffset,...(page.version?{receipt_version:page.version}:{})};
    try{
     if(readTerminal&&shell(entry.item)&&!entry.noProcess){
      const offset=entry.logOffset||0,response=await readTerminal({role:entry.item.member,call_id:entry.item.call_id,generation:entry.item.generation,offset});
      if(serial!==this.serial||!isCurrent()||this.entries.get(entry.key)!==entry)return;
      entry.readAt=Date.now();if(response?.pending)continue;
      if(response?.ok===true&&response.no_process){entry.noProcess=true;continue;}
      const row=response?.result;
      if(response?.ok===false||!row||!row.session_id)throw Error(row?.error?.message||response?.error||'终端日志不可用');
      if(response.call_id!==entry.item.call_id||response.receipt_generation!==entry.item.generation||!Number.isSafeInteger(row.session_id)||!Number.isSafeInteger(row.generation)||!Number.isSafeInteger(row.next_offset)||row.next_offset<offset||row.next_offset>row.logged_bytes||row.next_offset===offset&&row.output)throw Error('终端日志身份或游标已改变');
      const process=JSON.stringify([entry.item.member,row.generation,row.session_id]),seen=this.processes.get(process)||0;
      if(offset<seen){entry.logOffset=seen;continue;}
      entry.private_output=!!row.private_output;entry.log_incomplete=!!row.log_incomplete;
      const output=plain(row.output||'');this.processOutput(entry,output,row);
      this.notes(entry);
      entry.logOffset=row.next_offset;this.processes.set(process,row.next_offset);entry.receiptSeen=true;
      while(this.processes.size>400)this.processes.delete(this.processes.keys().next().value);
      entry.needsRead=row.next_offset<row.logged_bytes;this.project(entry,{...entry.item,state:row.state,preview:{...row,state:row.state==='exited'&&(!row.ok||row.exit_code!=null&&row.exit_code!==0)?'failed':row.state,output:''}});
      if(entry.readError){this.write(entry,'\n[记录读取已恢复]\n');entry.readError='';}onChange();continue;
     }
     const result=validateReceiptPage(await readPage(args),page.inputOffset,page.outputOffset);
     if(serial!==this.serial||!isCurrent()||this.entries.get(entry.key)!==entry)return;
     entry.readAt=Date.now();
     if(result.pending&&!result.input&&!result.output)continue;
     if(page.version&&page.version!==result.receipt_version)throw Object.assign(Error('回执已更新'),{changed:true});
     page.version=result.receipt_version;page.input+=result.input;page.output+=result.output;
     const more=!!(result.next_input||result.next_output),bounded=page.input.length+page.output.length>=LIMIT;
     if(more&&!bounded){page.inputOffset=result.next_input||result.input_size;page.outputOffset=result.next_output||result.output_size;entry.page=page;continue;}
     entry.page=null;entry.needsRead=!!result.pending;
     const data=parse(page.output),input=parse(page.input),item={...entry.item,state:result.state||entry.item.state,input_preview:input||entry.item.input_preview,preview:data||{text:page.output}};
     entry.receiptSeen=true;this.project(entry,item);
     if(bounded&&more&&!entry.bounded){this.write(entry,'\n[终端显示部分输出，完整内容可在原始记录中分页查看]\n');entry.bounded=true;}
     if(entry.readError){this.write(entry,'\n[记录读取已恢复]\n');entry.readError='';}
     onChange();
    }catch(error){
     if(serial!==this.serial||!isCurrent())return;
     entry.page=null;entry.readAt=Date.now();entry.needsRead=true;
     if(error.changed)continue;
     if(entry.readError!==error.message){entry.readError=error.message;this.write(entry,'\n[记录读取失败：'+plain(error.message)+']\n');onChange();}
    }
   }
  }finally{this.reading=false;}
 }
}
