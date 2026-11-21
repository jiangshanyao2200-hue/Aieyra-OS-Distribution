// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: tooltipRows; tooltipRowsText; renderTooltipRows
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/tooltip-content.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Plain label/value content shared by page and native tooltip renderers.
export function tooltipRows(value){
 if(!Array.isArray(value))return null;
 const rows=value.slice(0,12).filter(row=>row&&typeof row.label==='string'&&typeof row.value==='string').map(row=>({label:row.label.slice(0,80),value:row.value.slice(0,240)}));
 return rows.length?rows:null;
}
export function tooltipRowsText(value){return (tooltipRows(value)||[]).map(row=>row.label+'　'+row.value).join('\n');}
export function renderTooltipRows(host,value){
 const doc=host.ownerDocument,list=doc.createElement('dl');list.className='ui-tip-rows';
 const rows=tooltipRows(value)||[];
 rows.forEach((row,index)=>{const label=doc.createElement('dt'),detail=doc.createElement('dd');label.textContent=row.label+'　';detail.textContent=row.value;list.append(label,detail);if(index<rows.length-1)list.append(doc.createTextNode('\n'));});
 host.replaceChildren(list);
}
