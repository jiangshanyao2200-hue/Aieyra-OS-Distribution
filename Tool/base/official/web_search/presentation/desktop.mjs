// Readonly search receipts; the host injects motion policy and document ownership.
import {activityData} from '../../../../presentation/receipt.mjs';
const live=item=>['queued','running'].includes(item.state);
const failedItem=(item,data)=>['failed','timed_out','interrupted','cancelled'].includes(item.state)||data.ok===false;
const host=url=>{try{return new URL(url).hostname.replace(/^www[.]/,'');}catch{return '';}};
const svgNS='http://www.w3.org/2000/svg';

function icon(doc,d,className){const svg=doc.createElementNS(svgNS,'svg'),path=doc.createElementNS(svgNS,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');if(className)svg.setAttribute('class',className);path.setAttribute('d',d);svg.append(path);return svg;}
const LENS='M10.5 5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM15 15l4.5 4.5';

// 关键词快速敲入：约半秒打完；同一段文字不重打，接着上次的位置继续。
function typeInto(node,text,reduced,win,motionAllowed){
  if(node.dataset.text===text)return;
  const chars=Array.from(text),from=node.dataset.text&&text.startsWith(node.dataset.text)?Array.from(node.dataset.text).length:0;
  node.dataset.text=text;win.clearInterval(node._typing);
  if(reduced||!motionAllowed(node)||chars.length-from<2){node.textContent=text;return;}
  let shown=from;const step=Math.max(1,Math.ceil((chars.length-from)/16));
  node._typing=win.setInterval(()=>{shown=motionAllowed(node)?Math.min(chars.length,shown+step):chars.length;node.textContent=chars.slice(0,shown).join('');if(shown>=chars.length)win.clearInterval(node._typing);},28);
}

export function setupSearchView({doc,make,reduced,motionAllowed,activityOutcome}){
  function group(p,item){
    p.groups??=new Map();
    let g=p.groups.get(item.key||item.id);if(g)return g;
    const root=make('section','search-group'),box=make('div','search-box'),text=make('span','search-text'),caret=make('i','search-caret'),meta=make('p','search-meta'),list=make('ol','search-results'),answer=make('p','search-answer');
    box.append(icon(doc,LENS),text,caret);answer.hidden=true;root.append(box,meta,list,answer);
    g={root,text,meta,list,answer,signature:''};p.groups.set(item.key||item.id,g);return g;
  }
  function hit(h,i){
    const li=make('li','search-hit'),title=make('b','hit-title',h.title||h.url),site=make('small','hit-site'),name=host(h.url);
    li.style.setProperty('--i',String(i));li.title=h.url;if(i<3)li.dataset.rank='top';
    li.tabIndex=0;li.setAttribute('role','button');li.setAttribute('aria-expanded','false');
    const toggle=()=>li.setAttribute('aria-expanded',String(li.classList.toggle('open')));
    li.addEventListener('click',toggle);li.addEventListener('keydown',event=>{if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&(event.key==='Enter'||event.key===' ')){event.preventDefault();toggle();}});
    site.append(make('span','hit-dot',(name[0]||'·').toUpperCase()),doc.createTextNode(name+(h.page_age?' · '+h.page_age:'')));
    li.append(title,site,make('small','hit-url',h.url));if(h.snippet)li.append(make('small','hit-snippet',h.snippet));return li;
  }
  function fillSearch(p,items,scope){
    p.groups??=new Map();
    if(p.searchScope!==scope){suspend(p);for(const g of p.groups.values())g.root.remove();p.groups.clear();p.searchScope=scope;}
    const keys=new Set(items.map(i=>i.key||i.id));
    for(const [key,g] of p.groups)if(!keys.has(key)){doc.defaultView.clearInterval(g.text._typing);g.root.remove();p.groups.delete(key);}
    if(!p.searchList){
      p.searchList=make('div','search-pane');p.body.replaceChildren(p.searchList);
      if(doc.defaultView.ResizeObserver)p.searchObserver=new doc.defaultView.ResizeObserver(([entry])=>p.searchList.classList.toggle('compact',entry.contentRect.height<160));
      p.searchSuspended=true;
    }
    if(p.searchSuspended){p.searchObserver?.observe(p.body);p.searchSuspended=false;}
    const running=items.filter(live).length,failed=items.filter(i=>failedItem(i,activityData(i))).length;
    if(p.state)p.state.textContent=running?(items.length>1?running+' 个搜索进行中':'搜索中'):failed&&failed===items.length?'未成功':items.length>1?items.length+' 次搜索':'完成';
    p.node.dataset.state=running?'running':failed===items.length&&failed?'failed':'completed';
    let grew=false;
    for(const item of items){
      const g=group(p,item),data=live(item)?{}:activityData(item),bad=!live(item)&&failedItem(item,data);
      if(!g.root.isConnected){p.searchList.append(g.root);grew=true;}
      const rounds=Array.isArray(data.searches)?data.searches:[];
      typeInto(g.text,rounds.at(-1)?.query||data.query||item.targets?.[0]||item.title||'',reduced(),doc.defaultView,motionAllowed);
      g.root.dataset.state=live(item)?'running':bad?'failed':'completed';
      const signature=JSON.stringify([item.state,item.revision,rounds.length]);if(g.signature===signature)continue;g.signature=signature;grew=true;
      if(live(item)){g.meta.textContent='正在搜索…';g.list.replaceChildren(...[0,1,2].map(i=>{const li=make('li','search-skeleton');li.style.setProperty('--i',String(i));return li;}));g.answer.hidden=true;continue;}
      const total=rounds.reduce((n,r)=>n+(r.total||r.results?.length||0),0);
      g.meta.textContent=bad?activityOutcome(item)||'搜索未成功':(rounds.length>1?rounds.length+' 次搜索 · ':'')+(total?total+' 条结果':'没有找到结果');
      if(!bad&&data.retrieved_at){const at=new Date(data.retrieved_at);if(Number.isFinite(at.getTime()))g.meta.textContent+=' · 检索于 '+at.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
      const rows=[];let i=0;
      rounds.forEach((round,r)=>{
        if(rounds.length>1&&round.query){const d=make('li','search-divider',(r?'改搜：':'先搜：')+round.query);d.style.setProperty('--i',String(i++));rows.push(d);}
        for(const h of round.results||[])rows.push(hit(h,i++));
      });
      g.list.replaceChildren(...rows);
      // 结论只做三行预览：去掉 Markdown 记号，换行并成空格。
      const brief=String(data.answer||'').split(String.fromCharCode(10)).join(' ').replace(/[#*`>|]+/g,'').replace(/ {2,}/g,' ').trim();
      g.answer.textContent=brief;g.answer.hidden=!brief;g.answer.onclick=()=>g.answer.classList.toggle('open');
    }
    if(grew)p.searchList.scrollTop=p.searchList.scrollHeight;
  }

 function suspend(p){p.searchSuspended=true;p.searchObserver?.disconnect();for(const g of p.groups?.values()||[]){doc.defaultView.clearInterval(g.text._typing);if(g.text.dataset.text!=null)g.text.textContent=g.text.dataset.text;}}
 return {fill:fillSearch,suspend,close:suspend};
}
