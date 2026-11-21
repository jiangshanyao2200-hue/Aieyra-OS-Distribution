// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/prompt-sections.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');

test('prompt sections preserve preamble, empty and unknown headings, CRLF and trailing bytes',async()=>{
 const {promptSections,joinPromptSections,editPromptSection}=await import('../ui/prompt-sections.mjs');
 for(const text of ['', 'plain\r\ntext\r\n', '前言\r\n## 角色\r\n内容\r\n\r\n## 陌生分区\r\n## 边界\r\n', '## 角色\n第一行\n## 工作\n工作']){
  const rows=promptSections(text);assert.equal(joinPromptSections(rows),text);
  for(const row of rows)editPromptSection(row,row.draft.replace(/\r\n/g,'\n'));
  assert.equal(joinPromptSections(rows),text,'reading a browser textarea must not normalize the stored prompt');
 }
 const rows=promptSections('前言\r\n## 角色\r\n旧内容\r\n\r\n## 边界\r\n保留\r\n');
 assert.deepEqual(rows.map(r=>r.id),['self','work','boundary','thinking']);
 const self=rows.find(r=>r.id==='self');editPromptSection(self,self.draft.replace('旧内容','新内容'));
 assert.equal(joinPromptSections(rows),'前言\r\n## 角色\r\n新内容\r\n\r\n## 边界\r\n保留\r\n');
});

test('unstructured prompts acquire only the extra section explicitly edited',async()=>{
 const {promptSections,joinPromptSections,editPromptSection}=await import('../ui/prompt-sections.mjs');
 const rows=promptSections('保持原文');editPromptSection(rows.find(r=>r.id==='boundary'),'先核对再操作');
 assert.equal(joinPromptSections(rows),'保持原文\n\n## 安全与边界\n先核对再操作');
});
test('editing one layer without a trailing newline keeps adjacent headings and unknown text intact',async()=>{
 const {promptSections,joinPromptSections,editPromptSection}=await import('../ui/prompt-sections.mjs');
 for(const eol of ['\n','\r\n']){
  const source=['## 角色','原人格','## 工作','工作内容','## 陌生分区','私人扩展','## 边界','边界内容',''].join(eol),rows=promptSections(source);
  editPromptSection(rows.find(r=>r.id==='self'),'新的人格');
  const saved=joinPromptSections(rows);assert.equal(saved,source.replace('原人格','新的人格'));
  const reloaded=promptSections(saved);assert.equal(reloaded.find(r=>r.id==='work').text,['工作内容','## 陌生分区','私人扩展',''].join(eol));
  assert.equal(joinPromptSections(reloaded),saved);
 }
});
