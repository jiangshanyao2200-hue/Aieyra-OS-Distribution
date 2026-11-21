'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('image cards distinguish unknown output, unsent work and accounting failure',async()=>{
 const {imageFacts,imageSections}=await import('./desktop.mjs'),facts=[],sections=[];
 const receipt={model:'fixture',batch_id:'batch-fixture',requested:4,completed:1,unsubmitted:2,unknown:true,recovery:'核对现有结果'};
 imageFacts(receipt,(label,value)=>{if(value)facts.push({label,value});});imageSections(receipt,(label,value)=>{if(value)sections.push({label,value});});
 assert.ok(facts.some(x=>x.value==='1 / 4 张完成'));assert.ok(facts.some(x=>x.value.includes('勿重复提交')));assert.ok(sections.some(x=>x.value.includes('2 张未提交；存在待核对结果')));
 const accounting=[];imageFacts({...receipt,unknown:false,accounting_error:'disk full'},(label,value)=>{if(value)accounting.push({label,value});});
 assert.ok(accounting.some(x=>x.value==='图片已保留，用量保存待核对'));assert.ok(!accounting.some(x=>x.value.includes('勿重复提交')));
});
