// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/feedback.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('feedback summarizes compatibility and transport issues without falsely declaring a failed send',async()=>{
 const {feedbackSummary}=await import('../ui/feedback.mjs');
 assert.equal(feedbackSummary("Eyra 暂不可用：官方组件 aieyra.vaya（1.1.2）与当前程序的兼容目录不匹配。详情：official package is not in this host's trusted catalog: aieyra.vaya@1.1.2 ("+'a'.repeat(64)+')'),'组件版本暂不兼容，请检查并更新完整程序。');
 assert.match(feedbackSummary('ETIMEDOUT'),/响应超时，请稍后重试/);
 assert.doesNotMatch(feedbackSummary('ETIMEDOUT'),/未发送|已保存|已取消/);
 assert.equal(feedbackSummary('每次最多拖入 10 个文件'),'每次最多拖入 10 个文件');
 assert.doesNotMatch(feedbackSummary('Error: Authorization: Bearer private-token-123'),/private-token/);
 assert.ok(feedbackSummary('x'.repeat(4000)).length<100);
});
