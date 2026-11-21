/* @file-map:start
文件: link/office/web/tooltip-content.mjs
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: 无已解析的项目内静态导入
上游: link/office/web/tooltip.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  tooltipRows | function
  tooltipRowsText | function
  renderTooltipRows | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// Plain label/value content shared by page and native tooltip renderers.
export /* @chain-region tooltipRows | calls: Array.isArray, map, filter, value.slice, row.label.slice, row.value.slice */ function tooltipRows(value){
 if(!Array.isArray(value))return null;
 const rows=value.slice(0,12).filter(row=>row&&typeof row.label==='string'&&typeof row.value==='string').map(row=>({label:row.label.slice(0,80),value:row.value.slice(0,240)}));
 return rows.length?rows:null;
}
export /* @chain-region tooltipRowsText | calls: join, map, tooltipRows */ function tooltipRowsText(value){return (tooltipRows(value)||[]).map(row=>row.label+'　'+row.value).join('\n');}
export /* @chain-region renderTooltipRows | calls: doc.createElement, tooltipRows, rows.forEach, list.append, doc.createTextNode, host.replaceChildren */ function renderTooltipRows(host,value){
 const doc=host.ownerDocument,list=doc.createElement('dl');list.className='ui-tip-rows';
 const rows=tooltipRows(value)||[];
 rows.forEach((row,index)=>{const label=doc.createElement('dt'),detail=doc.createElement('dd');label.textContent=row.label+'　';detail.textContent=row.value;list.append(label,detail);if(index<rows.length-1)list.append(doc.createTextNode('\n'));});
 host.replaceChildren(list);
}
