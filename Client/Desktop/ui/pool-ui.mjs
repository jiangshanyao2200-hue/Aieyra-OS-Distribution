// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: el; formatWindow; chip; poolArea; rowNote; catalogPanel; modelSelect
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/pool-ui.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 设置 · 模型三页共用的小部件：模型池小卡片、模型列表（带 +）、模型下拉。
// 只接收后端的展示数据（名称、末四位、是否在池里），从不接触 Key。
export function el(tag,props={},...children){
 const node=document.createElement(tag);
 for(const [k,v] of Object.entries(props)){
  if(v===undefined||v===null||v===false)continue;
  if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k==='dataset')Object.assign(node.dataset,v);
  else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(k in node&&typeof v!=='string')node[k]=v;else node.setAttribute(k,v===true?'':v);
 }
 node.append(...children.flat().filter(c=>c!==null&&c!==undefined&&c!==false));
 return node;
}
export const formatWindow=n=>!n?'':n>=1000000?(Math.round(n/100000)/10)+'M':Math.round(n/1000)+'K';
// 小卡片：名称 + 一个简单的 ×。label 是卡片前的短标记（如“默认”）。
export function chip(model,{onRemove,label,tag,title,disabled}={}){
 const name=el('span',{class:'pool-chip-name',text:model.name});
 const node=el('span',{class:'pool-chip',tabindex:'0',dataset:{kind:model.kind||'chat'},...(title?{title}:{})},label?el('small',{class:'pool-chip-label',text:label}):null,name,tag?el('small',{class:'pool-chip-tag',text:tag}):null);
 if(onRemove)node.append(el('button',{type:'button',class:'pool-chip-x','aria-label':'移除 '+model.name,title:'移除',disabled,onclick:onRemove},'×'));
 return node;
}
// 模型池：标题 · 数量 · 获取模型列表；下面从左到右排列小卡片。
export function poolArea({title,models,onRemove,disabled,empty,decorate=n=>n}){
 const head=el('div',{class:'pool-head'},el('h3',{text:title}),el('span',{class:'pool-count',text:models.length?String(models.length):''}));
 const contents=models.length
  ?el('div',{class:'pool-chips'},models.map(m=>decorate(chip(m,{tag:m.kind==='video'?'视频':m.kind==='image'?'生图':'',onRemove:()=>onRemove(m),disabled}),m)))
  :el('p',{class:'pool-empty',text:empty||'暂无模型'});
 return el('section',{class:'settings-area model-pool','aria-label':title},head,contents);
}
function rowNote(m){return [m.kind==='video'?'视频':m.kind==='image'?'生图':'',m.free?'免费':'',m.tier||'',formatWindow(m.context_window)].filter(Boolean).slice(0,2).join(' · ');}
// 模型列表：搜索 + 每行一个 +；已在池里的行显示 ✓。点 + 时由调用方决定是否先检测。
export function catalogPanel({models,onAdd,pending,disabled,label}){
 let query='';
 const list=el('div',{class:'catalog-rows',role:'list','aria-label':label||'模型列表'});
 const count=el('span',{class:'catalog-count'});
 const search=el('input',{type:'search',class:'catalog-search',placeholder:'搜索模型','aria-label':'搜索模型',spellcheck:'false',autocomplete:'off',oninput:()=>{query=search.value.trim().toLowerCase();paint();}});
 function paint(){
  const rows=models.filter(m=>!query||(m.id+' '+m.name).toLowerCase().includes(query));
  count.textContent=rows.length+' 个模型';
  list.replaceChildren(...rows.slice(0,300).map(m=>{
   const busy=pending?.has(m.id),added=m.in_pool;
   const button=el('button',{type:'button',class:'catalog-add','aria-label':(added?'已在模型池：':'加入模型池：')+m.name,title:added?'已在模型池':busy?'正在检测':'加入模型池',disabled:disabled||added||busy,dataset:{state:added?'added':busy?'busy':''},onclick:()=>onAdd(m)},added?'✓':busy?'':'+');
   return el('div',{class:'catalog-row',role:'listitem',dataset:{kind:m.kind}},el('span',{class:'catalog-name',title:m.id,text:m.name}),el('span',{class:'catalog-note',text:rowNote(m)}),button);
  }));
  if(!rows.length)list.append(el('p',{class:'catalog-empty',text:models.length?'没有匹配的模型':'这把 Key 暂无可用模型'}));
 }
 paint();
 return el('div',{class:'catalog-panel'},el('div',{class:'catalog-tools'},search,count),list);
}
// 模型下拉：按来源分组（Aieyra / 供应商）；empty 是“未设置”项的文字，省略时没有空项。
export function modelSelect({id,label,models,value,empty,placeholder,onChange,disabled}){
 const select=el('select',{id,'aria-label':label,disabled});
 if(empty!==undefined)select.append(new Option(empty,''));
 if(placeholder!==undefined){const o=new Option(placeholder,'');o.disabled=true;select.append(o);}
 for(const [source,name] of [['aieyra','Aieyra'],['provider','供应商']]){
  const rows=models.filter(m=>m.source===source);if(!rows.length)continue;
  const group=document.createElement('optgroup');group.label=name;
  for(const m of rows){const o=new Option(m.name,m.id);o.modelHover=m;if(m.provider_name)o.dataset.note=m.provider_name;group.append(o);}
  select.append(group);
 }
 if(!select.options.length){const o=new Option('先把模型加入模型池','');o.disabled=true;select.append(o);}
 select.value=[...select.options].some(o=>o.value===value)?value:select.options[0]?.value||'';
 select.addEventListener('change',()=>onChange(select.value,select));
 return select;
}
