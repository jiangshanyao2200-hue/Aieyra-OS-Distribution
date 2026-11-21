// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-library.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvasLibrary}=require('../../../Program/official/workspace/library.cjs');
test('canvas library edits the four contact layers without replacing other original text and rejects stale documents',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let prompt='## 人格与沟通\r\n原本人格\r\n\r\n## 执行与工作\r\n原本工作\r\n\r\n## 安全与边界\r\n原本边界\r\n\r\n## 思考方式\r\n原本思考\r\n';
 const hash=()=>crypto.createHash('sha256').update(prompt).digest('hex');let revision=1;
 const library=createCanvasLibrary({root,binding:async()=>({contact:{id:'canvas'}}),conversation:async p=>{assert.equal(p.id,'canvas');if(p.action==='contact')return {id:p.id,prompt,prompt_hash:hash(),revision};assert.equal(p.action,'contact_update');assert.equal(p.prompt_hash,hash());assert.equal(p.expected_revision,revision);prompt=p.prompt_text;revision++;return {ok:true};}});
 const old=await library.get();assert.equal(old.sections.thinking,'原本思考\r\n');
 const changed=await library.update({operation:'sections',revision:old.revision,sections:{...old.sections,work:'更新工作\n'}});
 assert.match(prompt,/## 安全与边界\r\n原本边界\r\n\r\n## 思考方式\r\n原本思考\r\n$/);
 const withDoc=await library.update({operation:'save-document',revision:changed.revision,title:'画布知识',text:'可读取的知识正文'});
 assert.equal(library.read(withDoc.entries[0].id).text,'可读取的知识正文');
 await assert.rejects(library.update({operation:'delete-document',revision:changed.revision,id:withDoc.entries[0].id}),/更新/);
 assert.equal((await library.get()).entries.length,1);
});
