// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: resultLabels; labels; renderWorkflowDigest
// Impact: python -B scripts/code-atlas.py show Tool/workbox/presentation/desktop.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Workflow facts come from the persisted instance. A theme can move this view;
// it cannot turn an accepted command into a completed step.
import {renderToolValue} from '../../presentation/value.mjs';
import {resultFrame} from '../../presentation/frame.mjs';
const resultLabels={count:'数量',sum:'合计',mean:'平均值',metric:'指标',value:'数值',file:'文件',workdir:'运行目录',paths:'文件',original:'原图',edited:'编辑结果',report:'报告',statistics:'统计',approved:'已确认',by:'确认者',preview_text:'内容预览',preview_truncated:'预览已截断'};
const labels={ready:'准备就绪',running:'执行中',pause_requested:'将在当前步骤后暂停',paused:'已暂停',awaiting_review:'等待审阅',cancel_requested:'正在取消',cancelled:'已取消',unknown:'结果待核实',blocked:'暂时无法继续',failed:'未成功',completed:'已完成',pending:'尚未执行',in_flight:'执行中',waiting:'等待回执',skipped:'条件不满足，已跳过',persistence_failed:'结果保存失败'};
export function renderWorkflowDigest(doc,receipt,{present}={}){
 const i=receipt?.data;
 if(i?.schema!=='aieyra.workbox-state/1'||!Array.isArray(i.steps))return null;
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const show=value=>typeof value==='string'?value:JSON.stringify(value,null,2)??'';
 const root=make('div','tool-digest package-tool-digest workbox-digest');root.dataset.state=i.state;root.dataset.package=receipt.package;root.dataset.view='workflow';root.dataset.workflow=i.id;
 const frame=resultFrame(doc,root,present);
 frame.summary.append(make('p','digest-lead',i.title||receipt.description||'工作流'),make('p','digest-note',labels[i.state]||i.state));
 if(receipt.error||i.error)frame.summary.append(make('p','digest-error',receipt.error?.message||i.error));
 if(receipt.preview_truncated)frame.content.append(make('p','digest-note','此处为部分预览；完整内容保留在原始回执。'));
 if(i.usage?.length){const reported=i.usage.filter(u=>u.usage_reported),unknown=i.usage.length-reported.length;frame.content.append(make('p','digest-note','图片用量：输入 '+reported.reduce((n,u)=>n+u.input_tokens,0)+' · 输出 '+reported.reduce((n,u)=>n+u.output_tokens,0)+(unknown?' · '+unknown+' 次未报告':'')));}
 const list=make('ol','digest-sections');
 for(const step of i.steps){
  const item=make('li','digest-section'),definition=i.definition?.steps?.find(s=>s.id===step.id);
  item.dataset.step=step.id;item.dataset.state=step.state;
  item.append(make('p','digest-label',(definition?.title||step.id)+' · '+(labels[step.state]||step.state)));
  if(step.error)item.append(make('p','digest-error',step.error));
  if(step.result!==undefined||step.receipt){const details=make('details'),summary=make('summary','','查看步骤结果');details.dataset.detail='step/'+step.id;details.append(summary);if(step.result!==undefined)details.append(renderToolValue(doc,step.result,{labels:resultLabels}));if(step.receipt)details.append(make('p','digest-note','回执：'+step.receipt));item.append(details);}
  list.append(item);
 }
 frame.content.append(list);
 if(i.outputs&&Object.keys(i.outputs).length){const outputs=make('details','digest-section');outputs.dataset.detail='outputs';outputs.open=true;outputs.append(make('summary','','产物'),renderToolValue(doc,i.outputs,{labels:resultLabels}));frame.content.append(outputs);}
 const raw=make('details','digest-section');raw.dataset.detail='record';raw.append(make('summary','','预览记录'),make('pre','digest-text',show(receipt)));frame.details.append(raw);
 return frame.finish();
}
