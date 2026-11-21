// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PROMPT_LAYERS; aliases; promptSections; joinPromptSections; editPromptSection
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/prompt-sections.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Four semantic layers, shared by contacts and the built-in role store.
// Reading or saving another layer never normalizes existing text or headings.
export const PROMPT_LAYERS=Object.freeze([
 {id:'self',title:'人格与沟通'}, {id:'work',title:'执行与工作'},
 {id:'boundary',title:'安全与边界'}, {id:'thinking',title:'思考方式'},
]);
const aliases=new Map(Object.entries({
 '人格与沟通':'self','人格':'self','角色':'self','自我':'self',
 '执行与工作':'work','工作':'work','协定':'work','角色与工作协约':'work',
 '安全与边界':'boundary','边界':'boundary','安全':'boundary','思考方式':'thinking','思考':'thinking',
}));
export function promptSections(text=''){
 const source=String(text),eol=source.includes('\r\n')?'\r\n':'\n',pieces=[],seen=new Set();
 const matches=[...source.matchAll(/^##[ \t]+([^\r\n]+)(?:\r?\n|$)/gm)];
 let active=null,offset=0;
 for(const m of matches){
  const id=aliases.get(m[1].trim());if(!id||seen.has(id))continue;
  if(!active&&m.index>0){active={id:'self',prefix:'',start:0,order:0};pieces.push(active);seen.add('self');if(id==='self')continue;}
  if(active)active.text=source.slice(offset,m.index);
  active={id,prefix:m[0],start:m.index,order:pieces.length};pieces.push(active);seen.add(id);offset=m.index+m[0].length;
 }
 if(active)active.text=source.slice(offset);
 else pieces.push({id:'self',prefix:'',text:source,order:0});
 return PROMPT_LAYERS.map((layer,index)=>{
  const part=pieces.find(p=>p.id===layer.id);
  return {...layer,...(part||{prefix:eol+eol+'## '+layer.title+eol,text:'',order:pieces.length+index}),present:!!part,draft:part?.text||''};
 });
}
export function joinPromptSections(rows){
 let result='';
 for(const r of [...rows].sort((a,b)=>a.order-b.order)){
  if(!r.present&&!r.text&&!r.draft)continue;
  const eol=r.prefix.includes('\r\n')||r.text.includes('\r\n')?'\r\n':'\n';
  // A textarea edit may remove the last newline. Keep the following heading
  // on its own line; unchanged sections still round-trip byte for byte.
  if(r.present&&r.prefix.startsWith('##')&&result&&!result.endsWith('\n'))result+=eol;
  if(!r.present){
   if(result&&!result.endsWith('\n'))result+=eol;
   if(result&&!result.endsWith(eol+eol))result+=eol;
   result+=r.prefix.replace(/^(?:\r?\n)+/,'')+r.draft;
  }else result+=r.prefix+r.draft;
 }
 return result;
}
export function editPromptSection(row,value){
 const normalized=String(value).replace(/\r\n/g,'\n');
 if(normalized===row.draft.replace(/\r\n/g,'\n'))return;
 row.draft=row.text.includes('\r\n')||row.prefix.includes('\r\n')?normalized.replace(/\n/g,'\r\n'):normalized;
}
