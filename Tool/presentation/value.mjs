// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: object; parse; display; renderToolValue
// Impact: python -B scripts/code-atlas.py show Tool/presentation/value.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared, bounded text-only rendering of actual tool values. Full receipts stay
// with the owning view; values never become HTML, URLs or executable actions.
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const parse=v=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return v;}};
const display=v=>typeof v==='string'?v:JSON.stringify(v,null,2)??'';
export function renderToolValue(doc,value,{columns,labels={},depth=0}={}){
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 value=parse(value);
 const render=v=>renderToolValue(doc,v,{labels,depth:depth+1});
 const note=()=>make('p','digest-note','此处显示部分内容；完整内容见原始回执。');
 if(depth>=5)return make('pre','digest-text',display(value));
 if(object(value)&&Array.isArray(value.output)&&(value.cell_id||value.state||typeof value.ok==='boolean')){
  const root=make('div','tool-values');
  if(value.error)root.append(make('p','digest-error',display(value.error)));
  for(const block of value.output.slice(0,200))root.append(render(block.type==='text'?block.text:block));
  if(value.output.length>200||value.has_more)root.append(note());
  if(!value.output.length&&!value.error)root.append(make('p','digest-note','本次没有输出。'));
  return root;
 }
 if(Array.isArray(value)){
  const rows=value.slice(0,200),root=make('div','package-tool-table-wrap');
  const keys=columns?.length?columns:rows.length&&rows.every(object)?[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,12).map(key=>({key,label:labels[key]||key})):null;
  if(keys?.length){
   const table=make('table','package-tool-table'),head=make('thead'),tr=make('tr'),body=make('tbody');
   for(const c of keys){const th=make('th','',c.label||c.key);th.scope='col';tr.append(th);}head.append(tr);table.append(head,body);
   for(const row of rows){const tr=make('tr');for(const c of keys)tr.append(make('td','',object(row)&&Object.hasOwn(row,c.key)?display(row[c.key]):''));body.append(tr);}root.append(table);
  }else{const list=make('ul','tool-values');for(const v of rows){const li=make('li');li.append(render(v));list.append(li);}root.append(list);}
  if(value.length>200||!columns&&rows.some(row=>object(row)&&Object.keys(row).some(k=>!keys?.some(c=>c.key===k))))root.append(note());
  if(!value.length)root.append(make('p','digest-note','没有结果。'));
  return root;
 }
 if(object(value)){
  const list=make('dl','digest-facts package-tool-cards'),entries=Object.entries(value);
  for(const [key,val]of entries.slice(0,50)){
   const box=make('div'),name=make('dt','',labels[key]||key),content=make('dd');
   if(key==='workdir'){const details=make('details','digest-section');details.append(make('summary','','查看目录'),render(val));content.append(details);}else content.append(render(val));
   box.append(name,content);list.append(box);
  }
  if(entries.length>50)list.append(note());return list;
 }
 return make('pre','digest-text',display(value));
}
