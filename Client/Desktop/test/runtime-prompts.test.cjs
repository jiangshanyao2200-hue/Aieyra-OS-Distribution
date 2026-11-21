// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/runtime-prompts.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRuntimePromptEditor}=require('../host/runtime-prompts.cjs');
test('external runtime prompt editing preserves backups and rejects stale writes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-runtime-prompt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'Config'));fs.mkdirSync(path.join(dir,'Prompt','Matrix'),{recursive:true});
 fs.writeFileSync(path.join(dir,'Config','提示词索引.json'),JSON.stringify({resources:[{file:'Matrix/example.txt'},{file:'Matrix/example.txt#角色'}]}));
 const file=path.join(dir,'Prompt','Matrix','example.txt');fs.writeFileSync(file,'original');const editor=createRuntimePromptEditor(dir);
 assert.equal(editor.call({action:'list'}).files.length,1);
 const initial=editor.call({action:'read',file:'Matrix/example.txt'}),saved=editor.call({action:'save',file:initial.file,version:initial.version,text:'user edit'});
 assert.equal(fs.readFileSync(file,'utf8'),'original');assert.equal(fs.readFileSync(saved.path,'utf8'),'user edit');assert.equal(fs.readFileSync(saved.path+'.backup.'+initial.content_version,'utf8'),'original');
 assert.throws(()=>editor.call({action:'save',file:initial.file,version:initial.version,text:'late'}));assert.equal(fs.readFileSync(saved.path,'utf8'),'user edit');
 assert.throws(()=>editor.call({action:'read',file:'../Config/提示词索引.json'}));
});

test('Windows line endings do not create a phantom draft or block file switching',async()=>{
 const {setupRuntimePrompts}=await import('../ui/runtime-prompts.mjs'),nodes=new Map(),handlers=new Map();
 const make=()=>({value:'',disabled:false,addEventListener(){},replaceChildren(...items){this.value=items[0]?.value||'';}});
 const box={open:true,querySelector(key){if(!nodes.has(key))nodes.set(key,make());return nodes.get(key);},addEventListener:(key,fn)=>handlers.set(key,fn)};
 let creates=0;
 const doc={getElementById:()=>({append(){}}),createElement:()=>++creates===1?box:make()};
 const calls=[],api={runtimePrompts:async p=>{calls.push(p);return p.action==='list'?{files:[{file:'first'},{file:'second'}]}:{file:p.file,path:p.file,text:'line one\r\nline two\r\n',version:'raw-file-version'};}};
 setupRuntimePrompts(api,{doc});await handlers.get('toggle')();
 assert.equal(nodes.get('textarea').value,'line one\nline two\n');assert.equal(nodes.get('.runtime-prompt-save').disabled,true);
 nodes.get('select').value='second';await nodes.get('select').onchange();
 assert.equal(calls.at(-1).file,'second');assert.equal(nodes.get('.runtime-prompt-path').textContent,'second');assert.equal(nodes.get('.runtime-prompt-save').disabled,true);
});


test('prompt mapping rejects traversal, third-party paths and conflicting fragments',()=>{
 const {parse}=require('../../../Contracts/resources/prompts.cjs');
 const row={file:'Vaya/提示词.txt#角色',path:'Agent/official/Vaya/prompts/提示词.txt',legacy_sha256:'a'.repeat(64)};
 for(const target of ['Data/private.txt','Agent/third-party/other/prompts/text.txt','Agent/official/Vaya/prompts/../private.txt','Agent/official/Vaya/prompts/a.txt.backup','/outside.txt'])assert.throws(()=>parse({resources:[{...row,path:target}]}));
 assert.throws(()=>parse({resources:[row,{...row,file:'Vaya/提示词.txt#协定',path:'Agent/official/Vaya/prompts/other.txt'}]}),/Conflicting/);
 const index=parse({resources:[row]});
 for(const name of ['../Data/private.txt','a//b.txt','a/./b.txt','file.txt#'])assert.throws(()=>index.lookup(name));
});

for(const [key,target] of [['Vaya/提示词.txt','Agent/official/Vaya/prompts/提示词.txt'],['Matrix/工具说明/持久计划.txt','Tool/base/official/update_plan/manual.txt'],['Matrix/工具说明/联网查询方式.txt','Tool/base/official/web_search/manual/method.txt'],['Matrix/辅助指令/网络搜索.txt','Tool/base/official/web_search/prompts/search.txt']])test('mapped prompt preserves overrides and excludes backups: '+target,t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-agent-prompt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const put=(name,text)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 const old='original public text';
 const digest=require('node:crypto').createHash('sha256').update(old).digest('hex');
 put('Config/提示词索引.json',JSON.stringify({resources:[{file:key,path:target,legacy_sha256:digest}]}));
 const legacy=put('Prompt/'+key,old),canonical=put(target,'new package text');
 const resources=require('../src/resources.cjs'),editor=createRuntimePromptEditor(dir),updates=require('../src/managed-update-files.cjs');
 const initial=editor.call({action:'read',file:key});assert.equal(initial.path,canonical);assert.equal(initial.text,'new package text');
 const saved=editor.call({action:'save',file:key,version:initial.version,text:'edited package text'});
 assert.equal(fs.readFileSync(legacy,'utf8'),old);assert.equal(fs.readFileSync(canonical,'utf8'),'new package text');
 assert.equal(fs.readFileSync(saved.path+'.backup.'+initial.content_version,'utf8'),'new package text');
 assert.deepEqual(updates.sourceNames(dir),[target]);
 assert.throws(()=>updates.safeName(target+'.backup.'+initial.content_version),/个人数据/);
 assert.equal(resources.promptPath(key,dir),saved.path);fs.unlinkSync(saved.path);
 fs.writeFileSync(legacy,'edited package text');
 const current=editor.call({action:'read',file:key});fs.unlinkSync(legacy);
 assert.throws(()=>editor.call({action:'save',file:key,version:current.version,text:'stale location edit'}),/位置已变化/);
 assert.equal(fs.readFileSync(canonical,'utf8'),'new package text');
 fs.writeFileSync(legacy,'');assert.equal(resources.promptPath(key,dir),legacy);assert.equal(editor.call({action:'read',file:key}).text,'');
 fs.writeFileSync(legacy,'local legacy edit');assert.equal(editor.call({action:'read',file:key}).text,'local legacy edit');
 fs.unlinkSync(legacy);assert.equal(editor.call({action:'read',file:key}).text,'new package text');
 put('Config/提示词索引.json',JSON.stringify({resources:[{file:key,path:'Data/private.txt',legacy_sha256:digest}]}));
 assert.throws(()=>editor.call({action:'read',file:key}),/prompt resource/);
});
