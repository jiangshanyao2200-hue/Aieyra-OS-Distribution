// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; png; sha; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/image-library.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createImageLibrary}=require('../host/image-library.cjs'),{createAttachmentStore}=require('../host/attachments.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBp0AAAAASUVORK5CYII=','base64');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-library-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const config=path.join(root,'config.json'),decode=()=>({width:1,height:1,data:png,mime:'image/png'}),library=createImageLibrary(config,{decode}),store=createAttachmentStore(config);return {root,config,decode,library,store};}
test('imported images survive restart, deduplicate, hide and restore without deleting originals',async t=>{
 const {root,config,decode,library,store}=await fixture(t),source=path.join(root,'看图 中文.png');await fs.writeFile(source,png);const attachments=await store.stage([source]);await library.importFiles(attachments);await library.importFiles(attachments);
 let list=await library.list();assert.equal(list.total,1);assert.equal(list.items[0].name,'看图 中文.png');assert.equal(list.items[0].path,undefined);
 await library.setHidden([attachments[0].sha256],true);assert.equal((await library.list()).total,0);assert.equal((await library.list({removed:true})).total,1);assert.deepEqual(await fs.readFile(source),png);
 const reopened=createImageLibrary(config,{decode});await reopened.setHidden([attachments[0].sha256],false);assert.equal((await reopened.list()).total,1);assert.match((await reopened.preview(attachments[0].sha256)).data,/^data:image\/png;base64,/);
});
test('generated images use the trusted manifest, pagination and exact content hashes',async t=>{
 const {root,library}=await fixture(t),dir=path.join(root,'generated-images');await fs.mkdir(dir);const id=sha(png),file=path.join(dir,id+'.png');await fs.writeFile(file,png);await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({version:1,images:[{id,path:file,name:'海边鹈鹕',width:1,height:1,model:'gpt-image-2',created_at:'2026-10-26',operation:'edit'}]}));
 assert.equal((await library.list({query:'鹈鹕',source:'generated'})).total,1);assert.equal((await library.list({query:'无结果'})).total,0);assert.equal((await library.list({offset:1})).items.length,0);assert.equal((await library.resolve(id)).operation,'edit');await library.preview(id);
 await fs.writeFile(file,Buffer.concat([png,Buffer.from('tampered')]));await assert.rejects(library.preview(id),/内容已变化/);
});
test('manifest cannot grant reads outside generated storage and malformed indexes remain errors',async t=>{
 const {root,library}=await fixture(t),dir=path.join(root,'generated-images');await fs.mkdir(dir);const id=sha(png),foreign=path.join(root,'private.png');await fs.writeFile(foreign,png);await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({version:1,images:[{id,path:foreign}]}));await assert.rejects(library.preview(id),/不属于/);
 await fs.writeFile(path.join(dir,'index.json'),'{');await assert.rejects(library.list());await assert.rejects(library.setHidden(['../x'],true),/请选择/);
});
test('desktop can stage ordinary File bytes, convert common images, and retain good files in a mixed batch',async t=>{
 const {root,config}=await fixture(t),store=createAttachmentStore(config,{decodeImage:()=>({data:png,width:1,height:1,mime:'image/png'})});
 const [file]=await store.stageFileBytes({name:'程序.py',bytes:new Uint8Array(Buffer.from('print(49)'))});assert.equal(file.kind,'file');await store.verify([file]);
 const webp=path.join(root,'参考.webp');await fs.writeFile(webp,'fixture webp decoder');const [converted]=await store.stage([webp]);assert.equal(converted.name,'参考.png');assert.equal(converted.source_name,'参考.webp');assert.equal(converted.kind,'image');await store.verify([converted]);
 const svg=path.join(root,'矢量.svg');await fs.writeFile(svg,'<svg/>');const [vector]=await store.stage([svg]);assert.equal(vector.kind,'file');assert.equal(vector.preview_unavailable,true);await store.verify([vector]);
 const mixed=await store.chooseBatch([webp,path.join(root,'missing.png'),svg]);assert.equal(mixed.attachments.length,2);assert.equal(mixed.warnings.length,1);assert.match(mixed.warnings[0],/missing/);
});

test('generated metadata shards merge legacy history beyond 4000 and survive restart',async t=>{
 const {root,config,decode,library}=await fixture(t),dir=path.join(root,'generated-images'),entries=path.join(dir,'entries');await fs.mkdir(entries,{recursive:true});
 const old=Array.from({length:4001},(_,i)=>{const id=sha(Buffer.from('legacy-'+i));return {id,path:path.join(dir,id+'.png'),created_at:'2026-10-01',prompt:'legacy '+i};});
 await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({version:1,images:old}));
 const id=sha(png),file=path.join(dir,id+'.png');await fs.writeFile(file,png);await fs.writeFile(path.join(entries,id+'.json'),JSON.stringify({id,path:file,prompt:'new high quality image',created_at:'2026-10-26'}));
 assert.equal((await library.list()).total,4002);assert.equal((await library.list({offset:4000})).items.length,2);
 const reopened=createImageLibrary(config,{decode});assert.equal((await reopened.list({query:'new high quality'})).total,1);await reopened.preview(id);
 await reopened.setHidden([id],true);assert.equal((await reopened.list()).total,4001);assert.deepEqual(await fs.readFile(file),png);
});
test('folders group images, survive restart, and deleting one keeps its images',async t=>{
 const {root,config,decode,library,store}=await fixture(t),a=path.join(root,'A.png');await fs.writeFile(a,png);const staged=await store.stage([a]);await library.importFiles(staged);const id=staged[0].sha256;
 const {folder}=await library.createFolder('  参考图  ');assert.equal(folder.name,'参考图');
 await library.move([id],folder.id);let list=await library.list();assert.equal(list.items[0].folder,folder.id);assert.equal(list.folders[0].count,1);assert.equal(list.folders[0].cover,id);
 assert.equal((await library.list({folder:''})).total,0);assert.equal((await library.list({folder:folder.id})).total,1);assert.deepEqual(await library.folderItems(folder.id),[id]);
 const reopened=createImageLibrary(config,{decode});await reopened.renameFolder(folder.id,'背景');assert.equal((await reopened.list()).folders[0].name,'背景');
 await reopened.deleteFolder(folder.id);list=await reopened.list();assert.equal(list.folders.length,0);assert.equal(list.total,1);assert.equal(list.items[0].folder,'');
 await assert.rejects(()=>reopened.move([id],folder.id),/不存在/);await assert.rejects(()=>reopened.createFolder('  '),/名字/);
});
