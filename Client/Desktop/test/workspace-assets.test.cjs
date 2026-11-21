// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture; assetRequest
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-assets.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWorkspaceProgram}=require('../../../Program/official/workspace/service.cjs');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-assets-'));
 const canvas=createWorkspaceProgram({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},conversation:()=>{throw Error('Local assets cannot require a model');}});
 t.after(async()=>{await canvas.close();fs.rmSync(root,{recursive:true,force:true});});
 const restored=await canvas.call('aieyra:canvas:load');assert.equal(restored.ok,true);
 return {root,canvas,project:restored.project};
}
const assetRequest=(file,options)=>new Request('iiimage-asset://local/abs/'+encodeURIComponent(file),options);
test('local canvas image transport preserves exact bytes from a Windows long Unicode path',async t=>{
 const f=await fixture(t);let directory=path.join(f.project.path,'output','imagegen');
 while(directory.length<285)directory=path.join(directory,'asset-长路径-'+('a'.repeat(28)));
 fs.mkdirSync(directory,{recursive:true});
 const file=path.join(directory,'original.png'),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
 fs.writeFileSync(file,bytes);assert.ok(file.length>260);
 const response=await f.canvas.asset(assetRequest(file));
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('content-length'),String(bytes.length));
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.deepEqual(fs.readFileSync(file),bytes);
});
test('file streaming retains the existing asset scope, ordinary-file and request-method checks',async t=>{
 const f=await fixture(t),outsider=path.join(f.root,'outside.png');fs.writeFileSync(outsider,'outside');
 assert.equal((await f.canvas.asset(assetRequest(outsider))).status,404);
 const file=path.join(f.project.path,'output','allowed.webp');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'owned asset');
 assert.equal((await f.canvas.asset(assetRequest(file,{method:'POST'}))).status,404);
 assert.equal((await f.canvas.asset(new Request('iiimage-asset://foreign/abs/'+encodeURIComponent(file)))).status,404);
 assert.equal((await f.canvas.asset(assetRequest(path.dirname(file)))).status,404);
 fs.unlinkSync(file);assert.equal((await f.canvas.asset(assetRequest(file))).status,404);
});
test('registered project asset folders render exact bytes without admitting other project metadata',async t=>{
 const f=await fixture(t),bytes=fs.readFileSync(path.join(__dirname,'../../../SDK/examples/theme-assets/assets/paper.png'));
 for(const relative of ['assets/图片 空格.png','.iiimage/assets/图片 空格.png']){
  const file=path.join(f.project.path,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
  const response=await f.canvas.asset(assetRequest(file));assert.equal(response.status,200,relative);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
 for(const relative of ['.iiimage/private.json','session-secret.png']){
  const file=path.join(f.project.path,relative);fs.writeFileSync(file,'private metadata');assert.equal((await f.canvas.asset(assetRequest(file))).status,404);
 }
});
test('saving repeated image references bounds filesystem validation and revalidates the next snapshot',async t=>{
 const original=fs.realpathSync,watched=new Set();let reads=0,assetReads=0,deniedRoot=null;
 fs.realpathSync=function(...args){reads++;if(watched.has(args[0]))assetReads++;if(args[0]===deniedRoot)throw Object.assign(Error('unreadable optional root'),{code:'EACCES'});return original.apply(this,args);};
 t.after(()=>{fs.realpathSync=original;});
 const f=await fixture(t),file=path.join(f.project.path,'.iiimage/assets/reused.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(__dirname,'../../../SDK/examples/theme-assets/assets/paper.png'),file);
 const nodes=Array.from({length:4000},(_,i)=>({id:'saved-'+i,type:'image',title:'image '+i,assets:[{assetId:'asset-'+i,index:1,type:'file',path:file,relativePath:'.iiimage/assets/reused.png'}]}));
 watched.add(file);reads=assetReads=0;let result=await f.canvas.call('aieyra:config:save-session',{projectId:f.project.id,sessionRevision:1,nodes});
 assert.equal(result.ok,true);const validations=reads;assert.equal(assetReads,1,'one ordinary save validates its shared file once');let saved=JSON.parse(fs.readFileSync(f.project.sessionPath,'utf8'));
 const realFile=fs.realpathSync(file);assert.equal(saved.nodes.length,4000);assert(saved.nodes.every(n=>n.assets.length===1&&n.assets[0].path===realFile));
 assert(validations<1000,'repeated references should not repeat filesystem validation for every node: '+validations);
 fs.unlinkSync(file);result=await f.canvas.call('aieyra:config:save-session',{projectId:f.project.id,sessionRevision:2,nodes});assert.equal(result.ok,true);
 saved=JSON.parse(fs.readFileSync(f.project.sessionPath,'utf8'));assert(saved.nodes.every(n=>!n.assets[0].assetUrl),'a previous snapshot must not retain trust in a removed file');
 const distinct=Array.from({length:128},(_,i)=>{const asset=path.join(path.dirname(file),'unique-'+i+'.png');fs.writeFileSync(asset,'owned fixture');watched.add(asset);return {id:'unique-'+i,type:'image',assets:[{path:asset}]};});
 reads=assetReads=0;result=await f.canvas.call('aieyra:config:save-session',{projectId:f.project.id,sessionRevision:3,nodes:distinct});assert.equal(result.ok,true);assert.equal(assetReads,128,'the manifest reuses the same file snapshot');
 assert(reads<128*3,'independent files should share project-root validation in the same snapshot: '+reads);
 saved=JSON.parse(fs.readFileSync(f.project.sessionPath,'utf8'));assert.equal(saved.nodes.length,128);assert(saved.nodes.every(n=>n.assets[0].assetUrl));
 deniedRoot=path.join(f.project.path,'output/agent-attachments');fs.mkdirSync(deniedRoot,{recursive:true});
 assetReads=0;result=await f.canvas.call('aieyra:config:save-session',{projectId:f.project.id,sessionRevision:4,nodes:distinct});assert.equal(result.ok,true);assert.equal(assetReads,128,'the following save independently revalidates every file');
 saved=JSON.parse(fs.readFileSync(f.project.sessionPath,'utf8'));assert(saved.nodes.every(n=>n.assets[0].assetUrl),'an unreadable unused root must not block other managed files');
 reads=0;const restored=await f.canvas.call('aieyra:config:load-session');assert.equal(restored.ok,true);assert.equal(restored.session.nodes.length,128);assert(restored.session.nodes.every(n=>n.assets.length===1));
 assert(reads<128*3,'restore should share managed-root validation in its own snapshot: '+reads);
});
