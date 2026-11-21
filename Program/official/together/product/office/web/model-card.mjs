/* @file-map:start
文件: link/office/web/model-card.mjs
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: 无已解析的项目内静态导入
上游: link/office/web/tooltip.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  modelCardData | function
  modelCardData.text | function
  modelCardData.number | function
  modelCardText | function
  renderModelCard | function
  renderModelCard.el | function
  renderModelCard.money | function
  renderModelCard.capacity | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// The same public model description is rendered in pages and native tips.
// Keep credentials, provider configuration and arbitrary markup out of this payload.
export /* @chain-region modelCardData | calls: text, number, Object.fromEntries, map */ function modelCardData(model){
 if(!model||typeof model!=='object')return null;
 const /* @chain-region modelCardData.text | calls: v.slice */ text=v=>typeof v==='string'?v.slice(0,1200):'',/* @chain-region modelCardData.number | calls: Number.isFinite */ number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const info=model.info||{},data={id:text(model.id),model:text(model.model),name:text(model.name),kind:text(model.kind),free:model.free===true,info:{}};
 for(const key of ['summary','description','family','source','reference_date','tool_validation'])if(text(info[key]))data.info[key]=text(info[key]);
 for(const key of ['reasoning','tool_calls','vision','free'])if(typeof info[key]==='boolean')data.info[key]=info[key];
 for(const key of ['context_window','max_output']){const value=number(info[key]??model[key]);if(value!==null)data.info[key]=value;}
 if(info.price&&typeof info.price==='object')data.info.price=Object.fromEntries(['input','output','cache_read'].map(key=>[key,number(info.price[key])]));
 return data;
}
export /* @chain-region modelCardText | calls: modelCardData */ function modelCardText(model){const m=modelCardData(model);return m?.name||m?.model||m?.id||'模型详情';}
export /* @chain-region renderModelCard | calls: modelCardData, el, head.append, bits.push, i.family.0.toUpperCase, i.family.slice, bits.join, nodes.push … */ function renderModelCard(host,model){
 const m=modelCardData(model)||{info:{}},i=m.info,doc=host.ownerDocument;
 const /* @chain-region renderModelCard.el | calls: doc.createElement */ el=(tag,cls='',value='')=>{const n=doc.createElement(tag);n.className=cls;n.textContent=value;return n;};
 const /* @chain-region renderModelCard.money | calls: Number, v.toFixed */ money=v=>v===null||v===undefined?'—':'$'+Number(v.toFixed(v>=100?0:v>=1?2:3));
 const /* @chain-region renderModelCard.capacity | calls: Number, toFixed, String */ capacity=v=>v>=1e6?Number((v/1e6).toFixed(2))+'M':v>=1000?Number((v/1000).toFixed(1))+'K':String(v);
 const id=m.model||m.id||'',head=el('div','mh-head');head.append(el('strong','',m.name||id));if(id&&id!==m.name)head.append(el('small','',id));
 const nodes=[head],bits=[];
 if(i.family)bits.push(i.family[0].toUpperCase()+i.family.slice(1)+' 系列');
 if(i.reasoning)bits.push('支持思考');if(i.tool_calls)bits.push('能调用工具');if(i.vision)bits.push('能看图');if(m.kind==='image')bits.push('生成图片');
 const description=i.summary||i.description||(bits.length?bits.join('，')+'。':'');if(description)nodes.push(el('p','mh-text',description));
 const price=el('div','mh-price');
 if(i.price){for(const [key,label]of [['input','输入'],['output','输出'],['cache_read','缓存']]){if(key==='cache_read'&&i.price[key]==null)continue;const row=el('div');row.append(el('span','',label),el('b','',money(i.price[key])));price.append(row);}price.append(el('small','mh-unit','每百万 token · 参考价'));}
 else{price.classList.add('mh-price-none');price.append(el('span','',i.free||m.free?'免费':'价格以供应商为准'));}nodes.push(price);
 const facts=el('div','mh-facts');
 for(const [key,label]of [['context_window','上下文容量'],['max_output','最大输出']]){if(key==='max_output'&&!i[key])continue;const row=el('span');row.append(doc.createTextNode(label+' '),el('b','',i[key]?capacity(i[key]):'待核实'));facts.append(row);}nodes.push(facts);
 const caps=el('div','mh-caps');for(const [label,value]of [['思考',i.reasoning],['工具',i.tool_calls],['看图',i.vision],['生图',m.kind==='image'?true:null]])if(typeof value==='boolean'){const cap=el('span','mh-cap',label);cap.dataset.on=String(value);caps.append(cap);}if(caps.childElementCount)nodes.push(caps);
 if(i.source)nodes.push(el('small','mh-unit mh-note',i.source+(i.reference_date?' · '+i.reference_date:'')));
 if(i.tool_validation==='not_tested')nodes.push(el('small','mh-unit mh-note','工具调用待验证'));
 host.replaceChildren(...nodes);
}
