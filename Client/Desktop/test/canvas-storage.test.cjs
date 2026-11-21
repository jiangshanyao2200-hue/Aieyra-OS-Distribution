// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: createStorage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/canvas-storage.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const createStorage=require('../../../Program/official/workspace/desktop/canvas-storage.cjs');
test('normal canvas reads and reopen preserve stored session and manifest bytes and timestamps',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-readonly-'));
 const open=()=>createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},assertActive(){},broadcast(){},report(){},images:{list:()=>[]}});
 let store=open();t.after(async()=>{await store.close();fs.rmSync(root,{recursive:true,force:true});});
 const event={sender:{id:1,getURL:()=>''}},read=()=>store.handlers.get('aieyra:config:load-session')(event);
 const first=read(),files=[first.project.sessionPath,path.join(first.project.path,'.iiimage','project.json')];
 const session={...JSON.parse(fs.readFileSync(files[0],'utf8')),sessionRevision:9,futureExtension:{retained:'UNKNOWN_FIELD'},nodes:[{id:'retained',type:'requirement',requirement:{text:'Original content'},title:'Keep original',prompt:'Original content',status:'done',x:20,y:20,outputs:0}]};
 fs.writeFileSync(files[0],JSON.stringify(session,null,4)+'\n');
 for(const file of files)fs.utimesSync(file,new Date('2020-01-02'),new Date('2020-01-02'));
 const before=files.map(file=>({bytes:fs.readFileSync(file),mtime:fs.statSync(file).mtimeMs}));
 for(let i=0;i<3;i++){const loaded=read();assert.equal(loaded.session.nodes[0].id,'retained');assert.equal(loaded.session.sessionRevision,9);}
 await store.close();store=open();assert.equal(read().session.nodes[0].id,'retained');
 files.forEach((file,i)=>{assert.deepEqual(fs.readFileSync(file),before[i].bytes);assert.equal(fs.statSync(file).mtimeMs,before[i].mtime);});
});

test('legacy manifest-only canvas migrates once while malformed settings and registry stay intact',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-legacy-read-'));
 const open=()=>createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},assertActive(){},broadcast(){},report(){},images:{list:()=>[]}});
 let store=open();t.after(async()=>{await store?.close();fs.rmSync(root,{recursive:true,force:true});});
 const event={sender:{id:1,getURL:()=>''}},first=store.handlers.get('aieyra:config:load-session')(event),manifest=path.join(first.project.path,'.iiimage','project.json');
 fs.writeFileSync(manifest,JSON.stringify({version:1,session:{schemaVersion:3,sessionRevision:7,nodes:[{id:'legacy',type:'requirement',requirement:{text:'Keep legacy canvas'},title:'Legacy material',prompt:'Keep legacy canvas',status:'done',x:20,y:20}]}}));
 const migrated=store.handlers.get('aieyra:config:load-session')(event);assert.equal(migrated.session.nodes[0].id,'legacy');assert.equal(migrated.session.sessionRevision,7);assert.equal(JSON.parse(fs.readFileSync(manifest,'utf8')).version,2);
 const bytes=fs.readFileSync(first.project.sessionPath);store.handlers.get('aieyra:config:load-session')(event);assert.deepEqual(fs.readFileSync(first.project.sessionPath),bytes);
 await store.close();store=null;
 for(const name of ['app-settings.json','project-list.json']){
  const file=path.join(root,name),saved=fs.readFileSync(file);fs.writeFileSync(file,'{"PRIVATE_BROKEN_ORIGINAL":');const broken=fs.readFileSync(file);
  assert.throws(open,/JSON/);assert.deepEqual(fs.readFileSync(file),broken);fs.writeFileSync(file,saved);
 }
 store=open();assert.equal(store.handlers.get('aieyra:config:load-session')(event).session.nodes[0].id,'legacy');
});
test('video assets and empty edit drafts survive actual canvas save and reopen without becoming image nodes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-video-storage-'));
 const open=()=>createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},assertActive(){},broadcast(){},report(){},images:{list:()=>[]}});
 let store=open();t.after(async()=>{await store.close();fs.rmSync(root,{recursive:true,force:true});});
 const projectId=store.readProjectList().activeProjectId,event={sender:{id:1,getURL:()=>''}};
 const call=(name,args)=>store.handlers.get('aieyra:config:'+name)(event,args);
 const loaded=await call('load-session',{projectId});assert.equal(loaded.ok,true);
 const video={asset:{id:'asset',name:'Video',src:'https://untrusted.invalid/movie.mp4',duration:2,width:1280,height:720,codec:'h264'}};
 const timeline={timeline:{id:'edit',revision:3,name:'Empty edit',clips:[],width:1280,height:720,fps:30}};
 const nodes=[video,timeline].map((data,i)=>({id:'video-'+i,type:'video',title:'Video',prompt:'',status:'done',x:20+i*400,y:20,branch:'media',outputs:1,createdAt:new Date().toISOString(),video:data}));
 const saved=await call('save-session',{...loaded.session,projectId,revision:(loaded.session.sessionRevision||0)+1,nodes});assert.equal(saved.ok,true,saved.error);assert.notEqual(saved.skippedStale,true);
 await store.close();store=open();const restored=await call('load-session',{projectId});assert.equal(restored.ok,true);assert.equal(restored.session.nodes.length,2);
 assert.deepEqual(restored.session.nodes.map(n=>n.type),['video','video']);assert.equal(restored.session.nodes[0].video.asset.src,'iiimage-asset://local/media/asset');assert.deepEqual(restored.session.nodes[1].video.timeline.clips,[]);
});
test('ordinary saves preserve canonical manifest content, stale revision ordering and normalized empty overwrite protection',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-save-snapshot-'));
 const open=()=>createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},assertActive(){},broadcast(){},report(){},images:{list:()=>[]}});
 let store=open();t.after(async()=>{await store.close();fs.rmSync(root,{recursive:true,force:true});});
 const event={sender:{id:1,getURL:()=>''}},loaded=store.handlers.get('aieyra:config:load-session')(event),project=loaded.project;
 const manifest=path.join(project.path,'.iiimage/project.json'),file=path.join(project.path,'.iiimage/assets/owned.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(__dirname,'../../../SDK/examples/theme-assets/assets/paper.png'),file);
 const image={id:'retained',type:'image',title:'Keep image',assets:[{index:1,type:'file',path:file,relativePath:'.iiimage/assets/owned.png'}]};
 const save=input=>store.handlers.get('aieyra:config:save-session')(event,{projectId:project.id,...input});
 const [applied,stale]=await Promise.all([save({revision:2,nodes:[image]}),save({revision:1,nodes:[]})]);
 assert.equal(applied.ok,true);assert.equal(applied.appliedRevision,2);assert.equal(stale.skippedStale,true);assert.equal(stale.appliedRevision,2);
 let session=JSON.parse(fs.readFileSync(project.sessionPath,'utf8')),metadata=JSON.parse(fs.readFileSync(manifest,'utf8'));
 assert.equal(session.nodes.length,1);assert.equal(metadata.sessionRevision,session.sessionRevision);assert.equal(metadata.assets.length,1);
 assert.equal(metadata.assets[0].assetId,session.nodes[0].assets[0].assetId);assert.equal(metadata.assets[0].path,session.nodes[0].assets[0].relativePath);assert.equal(session.nodes[0].assets[0].path,fs.realpathSync(file));
 const before=[fs.readFileSync(project.sessionPath),fs.readFileSync(manifest)];
 // Raw unsupported nodes and hidden messages cannot make an empty normalized
 // snapshot eligible to replace an existing image canvas.
 const blocked=await save({revision:3,nodes:[{id:'old',type:'retired'}],messages:[{role:'assistant',hidden:true,content:'not canvas content'}]});
 assert.equal(blocked.reason,'empty-session-overwrite');assert.equal(blocked.applied,false);assert.equal(blocked.appliedRevision,2);
 assert.deepEqual(fs.readFileSync(project.sessionPath),before[0]);assert.deepEqual(fs.readFileSync(manifest),before[1]);
 const conversation={id:'chat',messages:[{id:'message',role:'user',content:'Keep conversation text'}]};
 const textSaved=await save({revision:3,nodes:[],conversations:[conversation]});assert.equal(textSaved.ok,true);assert.equal(textSaved.applied,true);
 const hiddenOnly=await save({revision:4,nodes:[],messages:[{hidden:true,content:'not saved content'}],conversations:[]});assert.equal(hiddenOnly.reason,'empty-session-overwrite');
 const cleared=await save({revision:4,nodes:[],messages:[],conversations:[],allowEmptyOverwrite:true});assert.equal(cleared.ok,true);assert.equal(cleared.applied,true);
 await store.close();store=open();session=store.handlers.get('aieyra:config:load-session')(event).session;metadata=JSON.parse(fs.readFileSync(manifest,'utf8'));
 assert.equal(session.nodes.length,0);assert.equal(session.sessionRevision,4);assert.equal(metadata.sessionRevision,4);assert.deepEqual(metadata.assets,[]);
});
test('ordinary saves retain corrupt originals and reject a revoked host before changing session or manifest',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-save-protection-'));let revoked=false;
 const store=createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},assertActive(){if(revoked)throw Error('program disabled');},broadcast(){},report(){},images:{list:()=>[]}});
 t.after(async()=>{revoked=false;await store.close();fs.rmSync(root,{recursive:true,force:true});});
 const event={sender:{id:1,getURL:()=>''}},loaded=store.handlers.get('aieyra:config:load-session')(event),project=loaded.project,manifest=path.join(project.path,'.iiimage/project.json');
 const save=revision=>store.handlers.get('aieyra:config:save-session')(event,{projectId:project.id,revision,nodes:[{id:'keep',type:'requirement',requirement:{text:'Retain actual text'}}]});
 assert.equal((await save(1)).ok,true);
 const sessionBytes=fs.readFileSync(project.sessionPath),manifestBytes=fs.readFileSync(manifest),corrupt=Buffer.from('{"KEEP_ORIGINAL":');
 fs.writeFileSync(project.sessionPath,corrupt);await assert.rejects(save(2),/原文件已保留|JSON|损坏/);assert.deepEqual(fs.readFileSync(project.sessionPath),corrupt);assert.deepEqual(fs.readFileSync(manifest),manifestBytes);
 fs.writeFileSync(project.sessionPath,sessionBytes);fs.writeFileSync(manifest,corrupt);await assert.rejects(save(2),/JSON|损坏/);assert.deepEqual(fs.readFileSync(manifest),corrupt);
 fs.writeFileSync(manifest,manifestBytes);const before=fs.readFileSync(project.sessionPath);revoked=true;
 await assert.rejects(save(3),/program disabled/);assert.deepEqual(fs.readFileSync(project.sessionPath),before);assert.deepEqual(fs.readFileSync(manifest),manifestBytes);
 revoked=false;assert.equal((await save(3)).ok,true);
});
test('document UI works after storage initialization, survives reopen and respects shutdown and host revocation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-documents-'));let revoked=false;
 const open=()=>createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},assertActive(){if(revoked)throw Error('program disabled');},broadcast(){},report(){},images:{list:()=>[]}});
 let store=open();t.after(async()=>{await store.close();fs.rmSync(root,{recursive:true,force:true});});
 const call=input=>store.handlers.get('aieyra:studio:documents')({sender:{id:1,getURL:()=>''}},input);
 const projectId=store.readProjectList().activeProjectId;
 const created=await call({action:'create',projectId,title:'UI document',format:'md',text:'Original content'});assert.equal(created.ok,true,created.error);
 const id=created.document.id;
 const edited=await call({action:'edit',projectId,id,expectedRevision:created.document.revision,text:'Saved through UI'});assert.equal(edited.ok,true,edited.error);
 const stale=await call({action:'edit',projectId,id,expectedRevision:created.document.revision,text:'Stale edit'});assert.equal(stale.ok,false);assert.match(stale.error,/已变化/);
 revoked=true;assert.match((await call({action:'read',projectId,id})).error,/program disabled/);revoked=false;
 await store.close();assert.match((await call({action:'read',projectId,id})).error,/尚未就绪/);
 store=open();const restored=await call({action:'read',projectId,id});assert.equal(restored.ok,true,restored.error);assert.equal(restored.document.text,'Saved through UI');assert.equal(restored.document.revision,edited.document.revision);
});
test('original reference picker imports actual bytes; busy archive is refused and idle archive retains project files',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-storage-'));let busy=false;
 const source=path.resolve(__dirname,'../../../SDK/examples/theme-assets/assets/paper.png');
 const store=createStorage({dataRoot:root,electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[source]})}},assertActive(){},broadcast(){},report(){},images:{list:()=>busy?[{status:'running'}]:[]}});
 t.after(async()=>{await store.close();fs.rmSync(root,{recursive:true,force:true});});
 const event={sender:{id:1,getURL:()=>''}},call=(name,p)=>store.handlers.get('aieyra:'+name)(event,p);
 const created=await call('project:create',{name:'Owned reference project',kind:'image'});assert.equal(created.ok,true);
 const refs=await call('asset:pick-reference-images',{projectId:created.project.id,max:1});assert.equal(refs.ok,true);assert.equal(refs.images.length,1);assert.deepEqual(fs.readFileSync(refs.images[0].path),fs.readFileSync(source));assert.notEqual(refs.images[0].path,source);
 busy=true;const rejected=await call('project:archive',{id:created.project.id});assert.equal(rejected.ok,false);assert.match(rejected.error,/停止/);assert.ok(store.readProjectList().projects.some(p=>p.id===created.project.id));
 busy=false;const archived=await call('project:archive',{id:created.project.id});assert.equal(archived.ok,true,archived.error);assert.ok(!archived.projects.some(p=>p.id===created.project.id));assert.ok(fs.existsSync(refs.images[0].path),'archive preserves original project bytes');
 const temporary=await call('project:create',{name:'Delete owned empty project',kind:'image'});const deleted=await call('project:delete',{id:temporary.project.id});assert.equal(deleted.ok,true,deleted.error);assert.ok(!fs.existsSync(temporary.project.path));assert.ok(fs.existsSync(refs.images[0].path));
});
