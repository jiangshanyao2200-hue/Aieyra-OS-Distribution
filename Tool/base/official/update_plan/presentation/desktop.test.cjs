const test=require('node:test'),assert=require('node:assert/strict');
test('tool-owned plan card retains rejected dependencies, replacements and acceptance evidence',async()=>{
 const {createPlanView,createPlanSteps}=await import('./desktop.mjs');
 const el=(tag,text,className)=>({tag,textContent:text??'',className,children:[],dataset:{},append(...rows){this.children.push(...rows);},setAttribute(){}});
 const plan={mode:'goal',status:'awaiting_acceptance',objective:'交付',acceptance:['读回文件'],phases:[{id:'P',steps:[{id:'old',text:'旧路径',status:'superseded',replaced_by:'new'},{id:'new',text:'新路径',status:'completed',evidence:['目录真实存在']},{id:'check',text:'读回',status:'blocked',depends_on:['new'],reason:'文件尚未产生'}]}]};
 const card=createPlanView({el})({id:'receipt',preview:{state:plan}}),text=JSON.stringify(card);
 for(const expected of ['读回文件','目录真实存在','前置条件：新路径','文件尚未产生','旧路径'])assert.ok(text.includes(expected),expected);
 assert.equal(card.dataset.status,'awaiting_acceptance');
 const history=createPlanSteps([{description:'保留归档步骤',status:'completed'}],{el});
 assert.equal(history.children[0].children[1].textContent,'保留归档步骤');
 assert.equal(history.children[0].className,'completed');
});

test('current step skips unmet dependencies and resume references until the receipt completes them',async()=>{
 const {planModel,createPlanView}=await import('./desktop.mjs');
 const steps=[{id:'wait',text:'场地等待确认',status:'blocked'},{id:'dependent',text:'依赖场地的交付',status:'pending',depends_on:['wait']},{id:'resume',text:'依赖恢复条件的步骤',status:'pending',resume_condition:{step_id:'wait'}},{id:'free',text:'可以独立准备议程',status:'pending'}];
 const item={preview:{status:'active',phases:[{steps}]}};
 assert.equal(planModel(item).current.id,'free');
 const el=(tag,text,className)=>({tag,textContent:text??'',className,children:[],dataset:{},append(...rows){this.children.push(...rows);},setAttribute(){}});
 const card=createPlanView({el})(item);
 assert.equal(card.children[0].children[1].textContent,'可以独立准备议程');
 steps[3].status='completed';
 assert.equal(planModel(item).current.id,'wait');
 steps[0].status='completed';
 assert.equal(planModel(item).current.id,'dependent');
 steps[1].status='completed';
 assert.equal(planModel(item).current.id,'resume');
 steps[2].status='completed';item.preview.status='awaiting_acceptance';
 assert.equal(planModel(item).complete,false);
 assert.match(JSON.stringify(createPlanView({el})(item)),/步骤已完成，待验收/);
});

test('full plan pages retain exact acceptance and phase/step revisions while acceptance remains pending',async()=>{
 const {planModel,renderPlanPage}=await import('./desktop.mjs');
 const criterion='  逐字读回产物\n'+ '验'.repeat(1300)+' <原文>  ';
 const phaseRevisions=[{before:'旧阶段\n调查',after:'中间阶段',reason:'  缺少来源  ',revision:2},{before:'中间阶段',after:'最终核实阶段',reason:'补充独立核验',revision:3}];
 const stepRevisions=[{before:'旧步骤 <read>',after:'中间步骤',reason:'\n保留原始引用\n',revision:2},{before:'中间步骤',after:'逐字读回文件',reason:'核验实际字节',revision:3}];
 const plan={mode:'goal',status:'awaiting_acceptance',objective:'交付并读回',acceptance:[criterion],phases:[{id:'P',title:'最终核实阶段',revisions:phaseRevisions,steps:[{id:'new',text:'逐字读回文件',status:'completed',evidence:['SHA已对账'],revisions:stepRevisions},{id:'old',text:'旧路径',status:'superseded',replaced_by:'new'},{id:'cancel',text:'取消项',status:'cancelled'}]}]};
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
 for(const preview of [{state:plan},JSON.stringify({plan})]){
  const item=freeze({preview}),before=JSON.stringify(item),created=[];
  const doc={createElement(tag){const n={tag,children:[],dataset:{},style:{},attrs:{},textContent:'',className:'',append(...rows){this.children.push(...rows);},replaceChildren(...rows){this.children=rows;},setAttribute(k,v){this.attrs[k]=v;}};created.push(n);return n;}};
  const root=doc.createElement('div'),model=planModel(item);
  assert.deepEqual(model.acceptance,[criterion]);assert.deepEqual(model.phases[0].revisions,phaseRevisions);assert.deepEqual(model.steps[0].revisions,stepRevisions);
  assert.equal(model.total,1);assert.equal(model.done,1);assert.equal(model.complete,false);assert.equal(model.summary,'步骤已完成，待验收');
  assert.deepEqual(model.steps.map(step=>step.state),['completed','superseded','cancelled']);
  renderPlanPage(root,model,doc);
  assert(created.some(n=>n.tag==='li'&&n.textContent===criterion));
  assert(created.some(n=>n.tag==='h3'&&n.textContent==='最终核实阶段'));
  assert.equal(created.filter(n=>n.tag==='details').length,2);
  for(const revision of [...phaseRevisions,...stepRevisions]){
   assert(created.some(n=>n.tag==='del'&&n.textContent===revision.before));
   assert(created.some(n=>n.textContent==='修订后：'+revision.after));
   assert(created.some(n=>n.textContent==='修订原因：'+revision.reason));
  }
  assert(created.some(n=>n.dataset.phaseId==='P'));assert(created.some(n=>n.dataset.stepId==='new'&&n.dataset.state==='completed'));
  assert.equal(JSON.stringify(item),before);
 }
 const moved=planModel({preview:{state:{...plan,phases:[{id:'empty',title:'已移交阶段',steps:[],revisions:phaseRevisions},plan.phases[0]]}}});
 assert.deepEqual(moved.phases.map(phase=>phase.id),['empty','P']);assert.deepEqual(moved.phases[0].revisions,phaseRevisions);
 assert.equal(moved.total,1);assert.equal(moved.done,1);assert.equal(moved.complete,false);
});
