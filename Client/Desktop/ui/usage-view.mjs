// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ROLE; HIT; roleName; compact; whole; clock; requestBars; usageScope; usageReport; paintUsage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/usage-view.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 用量信息窗：先给结论（四个数），再看每次请求（图），最后是分组和明细。
// 数字只来自快照和本地账本；没报告的写“未报告”，不当成零。
import {formatContext,usageSummary} from './status.mjs';
import {TEAM} from './team.mjs';

const ROLE=Object.fromEntries(TEAM.map(r=>[r.role,r.name]));
// 配色经 dataviz 校验（深色、两色、色盲区分）；未报告用中性灰，不算一个系列。
const HIT='#6a93e6',MISS='#c4862b',UNKNOWN='#6b7385',OUTPUT='#9aa3b2';

export const roleName=role=>ROLE[role]||role||'后台整理';
export function compact(value){
 const n=Number(value)||0;
 if(n>=1e6)return (n/1e6).toFixed(2)+'M';
 if(n>=1e3)return (n/1e3).toFixed(1)+'K';
 return String(n);
}
const whole=value=>(Number(value)||0).toLocaleString('zh-CN');
const clock=at=>{const t=new Date(at);return Number.isFinite(t.getTime())?t.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';};

// 图只画聊天请求：图片接口没有缓存，也不在同一个量级。
export function requestBars(rows=[],limit=60){
 const bars=rows.filter(r=>r.kind!=='image_gen').slice(-limit).map(r=>{
  const input=Number(r.input)||0,known=r.reported!==false&&r.cached!=null,cached=known?Math.min(input,Number(r.cached)||0):0;
  return {at:r.at,role:r.role,model:r.model,input,cached,miss:known?input-cached:0,unknown:known?0:input,output:Number(r.output)||0,duration:Number(r.duration_ms)||0,known};
 });
 return {bars,maxInput:Math.max(0,...bars.map(b=>b.input)),maxOutput:Math.max(0,...bars.map(b=>b.output))};
}

export const usageScope=shown=>String(shown?.link?.scope||shown?.session_id||shown?.id||'');
export function usageReport(shown={},ledger=null){
 const scope=usageScope(shown),matching=ledger?.session===scope?ledger:null;
 // The visible session owns both its durable totals and its retained detail rows.
 const summary=usageSummary([...(shown.roles||[]),{usage:shown.greeting_usage}]);
 const context=shown.context||shown.roles?.find(r=>r.role==='matrix')?.context;
 const partial=!!matching&&['samples','input','output'].some(key=>Number(matching.summary[key]||0)!==Number(summary[key]||0));
 return {summary,context,ledger:matching,partial};
}

export function paintUsage(root,{summary:u,context,ledger,ledgerError='',notes=[]}){
 const doc=root.ownerDocument,make=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
 const page=make('div','usage-page');
 function tile(label,value,sub,meter){
  const box=make('div','usage-tile');box.append(make('small','',label),make('b','',value),make('span','usage-sub',sub));
  if(meter!=null){const bar=make('span','usage-meter'),fill=make('i');fill.style.width=Math.max(0,Math.min(100,meter))+'%';bar.append(fill);box.append(bar);}
  return box;
 }
 const tiles=make('div','usage-tiles'),window=Number(context?.target)||Number(context?.model_window)||Number(context?.window)||0,percent=formatContext(context);
 tiles.append(
  tile('输入',compact(u.input),whole(u.samples)+' 次请求'),
  tile('输出',compact(u.output),u.reasoning===null?'思考未报告':'含思考 '+compact(u.reasoning)),
  tile('缓存命中',u.cacheRate===null?'未报告':u.cacheRate+'%',u.cacheReported?compact(u.cached)+' tokens':'供应商没有返回',u.cacheRate),
  tile('上下文',percent,window>0?compact(context.tokens)+' / '+compact(window):'请求开始后显示',window>0?Number(context.tokens)/window*100:null),
 );
 page.append(tiles);
 const rows=ledger?.recent||[],{bars,maxInput,maxOutput}=requestBars(rows);
 function plot(title,legend,max,segments){
  const section=make('section','usage-section'),head=make('div','usage-head');head.append(make('h3','',title));
  if(legend.length){const list=make('div','usage-legend');for(const [name,color,total]of legend){const item=make('span');const mark=make('i');mark.style.background=color;item.append(mark,doc.createTextNode(name+' '+compact(total)));list.append(item);}head.append(list);}
  const area=make('div','usage-plot'),axis=make('div','usage-axis'),track=make('div','usage-bars');
  axis.append(make('span','',compact(max)),make('span','','0'));
  bars.forEach((bar,i)=>{
   const column=make('div','usage-bar');
   for(const [value,color]of segments(bar)){if(value<=0||max<=0)continue;const part=make('i');part.style.height=value/max*100+'%';part.style.background=color;column.append(part);}
   column.tabIndex=0;column.dataset.tip=['第 '+(rows.length-bars.length+i+1)+' 次 · '+roleName(bar.role)+' · '+clock(bar.at),bar.model,'输入 '+whole(bar.input)+(bar.known?' · 命中 '+whole(bar.cached)+(bar.input?'（'+Math.round(bar.cached/bar.input*100)+'%）':''):' · 缓存未报告'),'输出 '+whole(bar.output)+(bar.duration?' · '+(bar.duration/1000).toFixed(1)+' 秒':'')].filter(Boolean).join('\n');
   column.setAttribute('aria-label',column.dataset.tip.replaceAll('\n',' · '));
   track.append(column);
  });
  area.append(axis,track);section.append(head,area);
  const edge=make('div','usage-edge');edge.append(make('span','',clock(bars[0].at)),make('span','',bars.length>1?clock(bars.at(-1).at):''));section.append(edge);
  return section;
 }
 if(bars.length){
  const sum=key=>bars.reduce((n,b)=>n+b[key],0),legend=[['命中缓存',HIT,sum('cached')],['未命中',MISS,sum('miss')]];
  if(sum('unknown')>0)legend.push(['未报告',UNKNOWN,sum('unknown')]);
  page.append(plot('每次请求的输入',legend,maxInput,bar=>[[bar.unknown,UNKNOWN],[bar.miss,MISS],[bar.cached,HIT]]));
  page.append(plot('每次请求的输出',[],maxOutput,bar=>[[bar.output,OUTPUT]]));
 }else if(ledgerError)page.append(make('p','usage-note','请求记录暂时读不到：'+ledgerError));
 function table(title,columns,list){
  const section=make('section','usage-section'),scroll=make('div','usage-scroll'),box=make('table','usage-table'),head=make('tr');
  section.append(make('h3','',title));
  for(const [name,numeric]of columns){const cell=make('th',numeric?'num':'',name);cell.scope='col';head.append(cell);}
  const thead=make('thead'),tbody=make('tbody');thead.append(head);
  for(const cells of list){const row=make('tr');cells.forEach((value,i)=>{const cell=make('td',columns[i][1]?'num':'',value);cell.title=value;row.append(cell);});tbody.append(row);}
  box.append(thead,tbody);scroll.append(box);section.append(scroll);return section;
 }
 const rate=row=>row.cacheRate==null?'未报告':row.cacheRate+'%';
 if(ledger?.roles?.length){
  const model=role=>rows.filter(r=>r.role===role).at(-1)?.model||'';
  page.append(table('按角色',[['角色'],['模型'],['请求',1],['输入',1],['输出',1],['缓存',1]],ledger.roles.map(r=>[roleName(r.name),model(r.name),whole(r.requests),compact(r.input),compact(r.output),rate(r)])));
 }
 if(ledger?.models?.length>1)page.append(table('按模型',[['模型'],['请求',1],['输入',1],['输出',1],['缓存',1]],ledger.models.map(r=>[r.name||'未知',whole(r.requests),compact(r.input),compact(r.output),rate(r)])));
 if(bars.length){
  const more=make('details','usage-more');more.open=root.dataset.usageMore==='true';more.addEventListener('toggle',()=>{root.dataset.usageMore=String(more.open);});
  more.append(make('summary','','最近 '+bars.length+' 次请求明细'),table('',[['时间'],['角色'],['模型'],['输入',1],['命中',1],['输出',1],['耗时',1]],[...bars].reverse().map(b=>[clock(b.at),roleName(b.role),b.model,whole(b.input),b.known?whole(b.cached):'未报告',whole(b.output),b.duration?(b.duration/1000).toFixed(1)+' 秒':'—'])));
  page.append(more);
 }
 const foot=make('div','usage-notes');for(const note of notes)foot.append(make('p','usage-note',note));page.append(foot);
 const top=root.scrollTop;root.replaceChildren(page);root.scrollTop=top;
}
