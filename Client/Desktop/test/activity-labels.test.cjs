// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/activity-labels.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=f=>import(pathToFileURL(path.join(__dirname,'../ui',f)).href);

test('工具显示说清楚做了什么，不露内部编号',async()=>{
 const {brief}=await load('model.mjs'),{activityLabel,activityBrief,isInternalId}=await load('activity.mjs');
 const id='matrix-8b397e3e60a72f766204';
 assert.equal(isInternalId(id),true);
 assert.equal(isInternalId('071a18ef5055a5183e1d71f8767bd377'),true);
 for(const ok of ['C:/example/项目/a.go','https://example.com','glm-5.3','gemini-4-argon-high'])assert.equal(isInternalId(ok),false,ok);
 assert.equal(brief({tool:'settings',action:'model_test',title:'测试模型响应',targets:[]}),'测试模型响应');
 assert.equal(brief({tool:'settings',action:'never_seen',targets:[id]}),'调整设置','旧记录也不显示编号');
 assert.equal(brief({tool:'settings',action:'inspect',targets:[id]}),'读取当前设置');
 assert.ok(!activityLabel({tool:'settings',action:'inspect',targets:[id]}).includes('matrix-'));
 const visit={tool:'browser',action:'open',brief:'打开',targets:['https://example.test/preview.html?session=private#token']};
 assert.equal(activityBrief(visit),'打开网页 · example.test/preview.html');
 assert.equal(activityBrief({...visit,brief:'预览刚生成的动画'}),'预览刚生成的动画');
});

test('协作操作区分邀请、任务内容与送达状态，不把投递当成工作完成',async()=>{
 const {activityLabel,activityDetails,activityOutcome}=await load('activity.mjs');
 assert.equal(activityLabel({tool:'core_link',action:'link_invite'}),'邀请协作成员');
 const row={tool:'core_link',action:'link_send',state:'completed',input_preview:{message:'核对图像是否可以打开。'},preview:{ok:true,data:{accepted:true}}};
 assert.equal(activityLabel(row),'向成员发送任务');
 assert.ok(activityDetails(row).some(s=>s.label==='任务内容'&&s.text===row.input_preview.message));
 assert.equal(activityOutcome(row),'任务消息已送达成员。');
 assert.equal(activityOutcome({...row,preview:{ok:true,data:{committed:true,queued:true,accepted:false}}}),'任务消息已保存，等待成员接收。');
 assert.equal(activityOutcome({...row,state:'failed',preview:{ok:false,error:{message:'目标已停止'}}}),'目标已停止');
});
