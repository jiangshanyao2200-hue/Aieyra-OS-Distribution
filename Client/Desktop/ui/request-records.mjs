// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: SIZE; n; ROLE_NAMES; roleName; rate; money; stamp; requestRow; setupRequestRecords
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/request-records.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {pageNumbers} from './pagination.mjs';
// 设置 · 请求记录：默认只看 Aieyra OS 自己的请求（本机账本），可按模型、来源筛选；账号站日志单列，含其他设备和 Key，不混进统计。
const SIZE=50;
const n=v=>v==null?'—':Number(v).toLocaleString('zh-CN');
const ROLE_NAMES={matrix:'Eyra',subconscious:'潜意识',vision:'视觉',execution:'执行',project:'项目',image:'图片'};
const roleName=role=>ROLE_NAMES[role]||role||'—';
const rate=v=>v==null?'未报告':v+'%';
const money=v=>v==null?'—':'$'+(v<0.01&&v>0?Number(v).toFixed(4):Number(v).toFixed(v>=100?0:2));
function stamp(at){const d=new Date(at);if(Number.isNaN(+d))return '—';const p=x=>String(x).padStart(2,'0');return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
export function requestRow(r,source){
 const rate=r.cached!=null&&r.input>0?Math.min(100,Math.round(r.cached/r.input*100)):null;
 return {time:stamp(r.at),model:r.model||'—',role:roleName(r.role),input:n(r.input),output:n(r.output),cache:r.cached==null?'—':n(r.cached)+(rate==null?'':' · '+rate+'%'),extra:source==='official'?money(r.cost):r.host||'—',duration:r.duration_ms?(r.duration_ms/1000).toFixed(1)+'s':'—',estimated:r.estimated===true};
}
export function setupRequestRecords(api,{doc=document,check}){
 const $=id=>doc.getElementById(id);let source='local',page=1,total=0,loading=0,pending=false,model='',role='',days=3,shownKey='';
 const tabs=[...($('request-sources').querySelectorAll?.('button')||[])];
 const ranges=[...($('request-range')?.querySelectorAll?.('button')||[])];
 function summary(items){$('request-summary').replaceChildren(...items.map(([k,v])=>{const d=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=k;dd.textContent=v;d.append(dt,dd);return d;}));}
 // 分组卡：每个模型、每个来源一张，点一下筛选，再点取消。
 function breakdown(result){
  const box=$('request-breakdown');box.hidden=source!=='local'||!(result?.models?.length);if(box.hidden){box.replaceChildren();return;}
  const card=(item,label,active,pick)=>{const b=doc.createElement('button');b.type='button';b.className='request-chip';b.setAttribute('aria-pressed',String(active));const name=doc.createElement('strong'),meta=doc.createElement('small');name.textContent=label;name.title=label;meta.textContent=`${n(item.requests)} 次 · 命中 ${rate(item.cacheRate)}`;b.append(name,meta);b.onclick=pick;return b;};
  box.replaceChildren(...result.models.map(m=>card(m,m.name||'未知模型',model===m.name,()=>{model=model===m.name?'':m.name;page=1;void load();})),...(result.roles.length>1?result.roles.map(r=>card(r,roleName(r.name),role===r.name,()=>{role=role===r.name?'':r.name;page=1;void load();})):[]));
 }
 function rows(list){
  $('request-rows').replaceChildren(...list.map(r=>{const v=requestRow(r,source),tr=doc.createElement('tr');if(v.estimated)tr.title='供应商未报告用量，按本机估算';
   for(const [k,cls] of [['time','time'],['model','model'],...(source==='local'?[['role','role']]:[]),['input','num'],['output','num'],['cache','num'],['extra',source==='official'?'num':'host'],['duration','num']]){const td=doc.createElement('td');td.className=cls;td.textContent=v[k];if(k==='model')td.title=v.model;tr.append(td);}return tr;}));
 }
 async function load(){
  // 只翻页时保留已知总数和当前表格，页码窗口直接按新页排好，不先缩成一个再展开；换来源/筛选才清空。
  const ticket=++loading,query={source,page,model,role,days},key=[source,model,role,days].join('|');pending=true;
  if(key!==shownKey){shownKey=key;total=0;summary([]);breakdown(null);rows([]);}
  $('request-empty').hidden=true;$('request-status').textContent='正在读取…';paint();
  try{
   let result,head=[];const end=Math.ceil(Date.now()/1000),period={start:query.days?end-query.days*86400:0,end:query.days?end:0};
   if(query.source==='official'){
    const state=await api.account({action:'status'});
    if(ticket!==loading)return;
    if(!state?.signedIn){if(ticket!==loading)return;total=0;summary([]);breakdown(null);rows([]);$('request-empty').hidden=false;$('request-empty').textContent='登录 Aieyra 账号后可查看账号全部记录。';$('request-status').textContent='';paint();return;}
    result=check(await api.account({action:'requests_official',page:query.page,page_size:SIZE,...period}));const u=state.user||{};
    head=[['余额',money(u.quota==null?null:u.quota/500000)],['已用',money(u.usedQuota==null?null:u.usedQuota/500000)],['请求次数',n(u.requestCount)]];
   }else{
    result=check(await api.account({action:'requests_local',page:query.page,page_size:SIZE,model:query.model,role:query.role,...period}));const s=(query.model||query.role?result.filtered:result.summary)||{};
    head=[[query.model||query.role?'筛选后请求':query.days?'近 '+query.days+' 天请求':'OS 总请求',n(s.requests)],['输入',n(s.input)],['输出',n(s.output)],['缓存命中',rate(s.cacheRate)]];
   }
   if(ticket!==loading)return;
   total=result.total||0;summary(head);breakdown(result);rows(result.rows||[]);
   $('request-empty').hidden=(result.rows||[]).length>0;$('request-empty').textContent=source==='official'?'这段时间没有账号记录。':'Aieyra OS 还没有发出请求。';
   $('request-status').textContent=total?`第 ${page} 页 · 共 ${n(total)} 条`:'';
  }catch(error){if(ticket===loading){total=0;summary([]);breakdown(null);rows([]);$('request-empty').hidden=true;$('request-status').textContent=error.message;}}
  finally{if(ticket===loading){pending=false;paint();}}
 }
 function paint(){
  for(const b of tabs)b.setAttribute('aria-selected',String(b.dataset.source===source));
  for(const b of ranges)b.setAttribute('aria-selected',String(Number(b.dataset.days)===days));
  $('request-extra-head').textContent=source==='official'?'费用':'线路';$('request-role-head').hidden=source!=='local';
  const numbers=$('request-pages');if(numbers)numbers.dataset.pending=String(pending&&!total);if(numbers)numbers.replaceChildren(...pageNumbers(page,Math.max(page,Math.ceil(total/SIZE))).map(value=>{const b=doc.createElement('button');b.type='button';b.className='ui-outline ui-page-number';b.textContent=String(value);b.setAttribute('aria-label','第 '+value+' 页');if(value===page)b.setAttribute('aria-current','page');b.disabled=pending;b.onclick=()=>{if(pending||value===page)return;page=value;void load();};return b;}));
  $('request-prev').disabled=pending||page<=1;$('request-next').disabled=pending||page*SIZE>=total;
 }
 for(const b of tabs)b.onclick=()=>{if(source===b.dataset.source)return;source=b.dataset.source;page=1;model='';role='';void load();};
 for(const b of ranges)b.onclick=()=>{const value=Number(b.dataset.days);if(value===days)return;days=value;page=1;model='';role='';paint();void load();};
 $('request-prev').onclick=()=>{if(!pending&&page>1){page--;void load();}};
 $('request-next').onclick=()=>{if(!pending&&page*SIZE<total){page++;void load();}};
 $('request-reload').onclick=()=>void load();
 return {open:load};
}
