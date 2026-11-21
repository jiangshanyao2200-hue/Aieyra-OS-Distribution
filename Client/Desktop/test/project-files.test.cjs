// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/project-files.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProjectFiles}=require('../host/project-files.cjs');
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-project-')),root=path.join(base,'project');fs.mkdirSync(root);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return {root,api:createProjectFiles({dataRoot:path.join(base,'private')})};}
test('new projects create an empty folder without replacing existing files or directories',t=>{
 const {root,api}=fixture(t),target=path.join(root,'New Project');
 const project=api.create(target);assert.equal(project.root,target);assert.deepEqual(fs.readdirSync(target),[]);
 fs.writeFileSync(path.join(target,'keep.txt'),'user content');
 assert.throws(()=>api.create(target),{code:'project_exists'});assert.equal(fs.readFileSync(path.join(target,'keep.txt'),'utf8'),'user content');
 assert.throws(()=>api.create(path.join(target,'keep.txt')),{code:'project_exists'});
});
test('editing detects an external rewrite, preserves the draft, and records actual accepted versions',t=>{
 const {root,api}=fixture(t),file=path.join(root,'app.js');fs.writeFileSync(file,'original\n');const original=api.read(root,'app.js');
 api.draft(root,'app.js',{text:'my draft\n',baseText:original.text,baseVersion:original.version});fs.writeFileSync(file,'agent change\n');
 assert.throws(()=>api.save(root,'app.js','my draft\n',original.version),{code:'project_conflict'});
 assert.equal(fs.readFileSync(file,'utf8'),'agent change\n');const fresh=api.read(root,'app.js');assert.equal(fresh.draft.text,'my draft\n');
 const accepted=api.save(root,'app.js','merged\n',fresh.version);assert.equal(accepted.text,'merged\n');assert.equal(accepted.history.length,3);assert.equal(accepted.history.at(-1).source,'user');
 assert.equal(api.history(root,'app.js',accepted.history[0].id).text,'original\n');
 const reopened=createProjectFiles({dataRoot:path.join(path.dirname(root),'private')});assert.equal(reopened.read(root,'app.js').draft.text,'my draft\n');
});
test('project capability refuses traversal, binary content and versions from another file',t=>{
 const {root,api}=fixture(t);fs.writeFileSync(path.join(root,'safe.txt'),'safe');fs.writeFileSync(path.join(root,'binary'),Buffer.from([0,1,2]));
 assert.throws(()=>api.read(root,'../private'),{code:'project_path'});assert.throws(()=>api.read(root,path.resolve(root,'safe.txt')),{code:'project_path'});assert.throws(()=>api.read(root,'binary'),{code:'project_binary'});
 const first=api.read(root,'safe.txt');fs.writeFileSync(path.join(root,'other.txt'),'other');api.read(root,'other.txt');assert.throws(()=>api.history(root,'other.txt',first.history[0].id),{code:'project_version'});
 assert.deepEqual(api.list(root).entries.map(e=>e.name),['binary','other.txt','safe.txt']);
});
test('agent attribution requires receipt hash matching actual bytes and never relabels later changes',t=>{
 const {root,api}=fixture(t),file=path.join(root,'change.txt'),origin={source:'agent',member:'Cota',call_id:'patch-1',generation:3,receipt_version:'receipt-1',after_sha256:require('node:crypto').createHash('sha256').update('agent bytes').digest('hex')};
 fs.writeFileSync(file,'agent bytes');assert.equal(api.observe(root,'change.txt',origin),true);
 const version=api.read(root,'change.txt').history.at(-1);assert.equal(version.member,'Cota');assert.equal(version.call_id,'patch-1');assert.equal(version.receipt_version,'receipt-1');
 fs.writeFileSync(file,'external rewrite');assert.equal(api.observe(root,'change.txt',origin),false);assert.equal(api.read(root,'change.txt').history.at(-1).source,'observed');
 const saved=api.save(root,'change.txt','agent bytes',api.read(root,'change.txt').version);assert.equal(api.observe(root,'change.txt',origin),true);assert.equal(api.read(root,'change.txt').history.at(-1).source,'user');assert.equal(saved.history.at(-1).source,'user');
});
test('native selections preserve the current root for contained files and validate before switching',t=>{
 const {root,api}=fixture(t),nested=path.join(root,'src');fs.mkdirSync(nested);const file=path.join(nested,'hello.txt');fs.writeFileSync(file,'hello');
 assert.deepEqual(api.selection(root,file,'file'),{root:fs.realpathSync(root),path:'src/hello.txt'});
 assert.deepEqual(api.selection(null,file,'file'),{root:fs.realpathSync(nested),path:'hello.txt'});
 assert.deepEqual(api.selection(null,root,'directory'),{root:fs.realpathSync(root),path:''});
 fs.writeFileSync(path.join(nested,'binary'),Buffer.from([0,1]));assert.throws(()=>api.selection(null,path.join(nested,'binary'),'file'),{code:'project_binary'});
});
