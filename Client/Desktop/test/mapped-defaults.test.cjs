// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: config; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/mapped-defaults.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createPromptEditor}=require('../host/prompts.cjs'),{createRuntimePromptEditor}=require('../host/runtime-prompts.cjs');
const config=require('../src/config.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-mapped-defaults-'));
 const previous=process.env.AIEYRA_RESOURCE_ROOT;process.env.AIEYRA_RESOURCE_ROOT=root;
 t.after(()=>{if(previous===undefined)delete process.env.AIEYRA_RESOURCE_ROOT;else process.env.AIEYRA_RESOURCE_ROOT=previous;fs.rmSync(root,{recursive:true,force:true});});
 const put=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 const rows=config.PROMPT_FILES.map(layer=>{
  const old='original '+layer.id,target='Agent/official/Eyra/prompts/default/'+layer.file;
  put('Prompt/Matrix/默认/'+layer.file,old);put(target,'packaged '+layer.id);
  return {file:'Matrix/默认/'+layer.file,path:target,legacy_sha256:crypto.createHash('sha256').update(old).digest('hex'),read_only:true};
 });
 put('Config/提示词索引.json',JSON.stringify({resources:rows}));
 const personal=path.join(root,'personal');fs.mkdirSync(personal);
 return {root,put,rows,personal};
}

test('mapped defaults preserve each personal and legacy override including empty files',t=>{
 const f=fixture(t);f.put('personal/自我.txt','');f.put('personal/工作.txt','personal work');f.put('Prompt/Matrix/默认/边界.txt','');
 const status=config.promptStatus(f.personal),editor=createPromptEditor(f.personal);
 const layer=id=>editor.list().layers.find(x=>x.id===id);
 assert.equal(layer('self').source,'custom');assert.equal(layer('self').text,'');
 assert.equal(layer('work').text,'personal work');assert.equal(layer('work').source,'custom');
 assert.equal(layer('boundary').source,'default');assert.equal(layer('boundary').text,'');
 assert.equal(layer('thinking').text,'packaged thinking');
 assert.equal(status.layers.find(x=>x.id==='thinking').path,path.join(f.root,'Agent/official/Eyra/prompts/default/思考方式.txt'));
 fs.unlinkSync(path.join(f.root,'Prompt/Matrix/默认/思考方式.txt'));
 assert.equal(layer('thinking').text,'packaged thinking');
 const current=layer('work'),saved=editor.restore({directory:f.personal,id:'work',version:current.version,defaultVersion:current.defaultVersion});
 assert.equal(saved.layer.source,'default');assert.equal(saved.layer.text,'packaged work');
 editor.undo({directory:f.personal,id:'work',version:saved.layer.version,undoVersion:saved.undoVersion});
 assert.equal(editor.list().layers.find(x=>x.id==='work').text,'personal work');
 assert.equal(fs.readFileSync(path.join(f.root,'Agent/official/Eyra/prompts/default/工作.txt'),'utf8'),'packaged work');
});

test('immutable defaults cannot be edited through either prompt editor or legacy index entries',t=>{
 const f=fixture(t),runtime=createRuntimePromptEditor(f.root),canonical=path.join(f.root,'Agent/official/Eyra/prompts/default'),legacy=path.join(f.root,'Prompt/Matrix/默认');
 assert.deepEqual(runtime.call({action:'list'}).files,[]);
 for(const row of f.rows){
  assert.throws(()=>runtime.call({action:'read',file:row.file}),/登记/);
  assert.throws(()=>runtime.call({action:'save',file:row.file,text:'bad edit',version:'missing'}),/登记/);
 }
 for(const dir of [canonical,legacy,path.join(canonical,'child')])assert.throws(()=>createPromptEditor(dir),/官方默认目录/);
 // Older indexes already listed these resources without read_only metadata.
 // Their stable identities still protect the official baseline from mutation.
 f.put('Config/提示词索引.json',JSON.stringify({resources:f.rows.map(({file})=>({file}))}));
 assert.deepEqual(runtime.call({action:'list'}).files,[]);
 assert.equal(fs.readFileSync(path.join(canonical,'自我.txt'),'utf8'),'packaged self');
});
