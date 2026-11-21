// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; empty; fixture; packed
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/composer-draft.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createComposerDraft}=require('../host/composer-draft.cjs');
const {createAttachmentStore}=require('../host/attachments.cjs');
const empty=()=>({value:'',pastes:'',attachments:[]});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eyra-composer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,config:path.join(dir,'Config/config.json'),work:path.join(dir,'work')};}
async function packed(text,attachments=[]){const {PasteDraft}=await import(pathToFileURL(path.resolve(__dirname,'../ui/paste-blocks.mjs')).href);const p=new PasteDraft(),value=p.pack(text);return {value,pastes:p.serialize(value),attachments};}
test('unsent Unicode paste and attachments survive a fresh host; projects and configs are isolated',async t=>{
 const {dir,config,work}=await fixture(t),assets=createAttachmentStore(config,{managed:true,owner:'a'.repeat(32)});
 const selected=await assets.chooseFileBytes({name:'资料.txt',bytes:Buffer.from('attachment snapshot')});
 const source='项目🙂\r\n'+'\n'.repeat(32000)+'末尾',draft=await packed(source,selected.attachments);
 const first=createComposerDraft(config,work),open=await first.open();await first.save({token:open.token,sequence:1,draft});
 const next=await createComposerDraft(config,work).open();assert.deepEqual(next.draft,draft);
 const {PasteDraft}=await import('../ui/paste-blocks.mjs');const p=new PasteDraft();p.restore(next.draft.value,next.draft.pastes);assert.equal(p.expand(next.draft.value),source);
 await assets.verify(next.draft.attachments);
 assert.deepEqual((await createComposerDraft(config,path.join(dir,'other')).open()).draft,empty());
 assert.deepEqual((await createComposerDraft(path.join(dir,'Config/other.json'),work).open()).draft,empty());
 const journal=path.join(dir,'Data/runtime/attachments/references-v2',path.basename(first.file));
 assert.deepEqual(JSON.parse(await fs.readFile(journal,'utf8')).sends['composer-draft'],selected.attachments.map(x=>x.sha256));
});
test('newer revisions and another live host cannot be overwritten by late saves',async t=>{
 const {config,work}=await fixture(t),one=createComposerDraft(config,work),two=createComposerDraft(config,work),a=await one.open(),b=await two.open();
 await one.save({token:a.token,sequence:2,draft:await packed('newer text')});
 assert.equal((await one.save({token:a.token,sequence:1,draft:await packed('old text')})).stale,true);
 await assert.rejects(two.save({token:b.token,sequence:1,draft:await packed('foreign overwrite')}),/另一个窗口/);
 assert.equal((await createComposerDraft(config,work).open()).draft.value,'newer text');
 const reloaded=await one.open();assert.equal((await one.save({token:a.token,sequence:3,draft:empty()})).stale,true);
 await one.save({token:reloaded.token,sequence:1,draft:empty()});assert.deepEqual((await createComposerDraft(config,work).open()).draft,empty());
});
test('private drafts survive a fresh host by session and retain uncertain send identities without crossing sessions',async t=>{
 const {config,work,dir}=await fixture(t),id='a'.repeat(32),other='b'.repeat(32);
 const assets=createAttachmentStore(config,{managed:true,owner:id}),selected=await assets.chooseFileBytes({name:'private.txt',bytes:Buffer.from('private draft attachment')});
 const store=createComposerDraft(config,work,{sessionID:id}),opened=await store.open();
 const draft={value:'未发送的私聊🙂',pastes:'',attachments:selected.attachments,outbox:[{session_id:id,request_id:'original-send',text:'未发送的私聊🙂',attachments:selected.attachments,delivery:'pending',preserve_draft:true}]};
 await store.save({token:opened.token,sequence:1,draft});await store.close();
 assert.deepEqual((await createComposerDraft(config,path.join(dir,'different-home'),{sessionID:id}).open()).draft,draft);
 assert.deepEqual((await createComposerDraft(config,work,{sessionID:other}).open()).draft,empty());
 assert.deepEqual((await createComposerDraft(config,work).open()).draft,empty());
 assert.throws(()=>createComposerDraft(config,work,{sessionID:'../escape'}),/会话/);
 await assets.verify(draft.attachments);
});
test('invalid or corrupted draft never replaces a valid payload or prevents reading other projects',async t=>{
 const {config,work,dir}=await fixture(t),store=createComposerDraft(config,work),opened=await store.open();
 await store.save({token:opened.token,sequence:1,draft:await packed('original')});const before=await fs.readFile(store.file);
 for(const draft of [{value:'⟦粘贴 1 · 9 行⟧',pastes:'',attachments:[]},{value:'x'.repeat(65537),pastes:'',attachments:[]},{...empty(),attachments:[{}]}])await assert.rejects(store.save({token:opened.token,sequence:2,draft}));
 assert.deepEqual(await fs.readFile(store.file),before);
 await fs.writeFile(store.file,'{broken');await assert.rejects(createComposerDraft(config,work).open(),/本地草稿内容损坏/);assert.equal(await fs.readFile(store.file,'utf8'),'{broken');
 assert.deepEqual((await createComposerDraft(config,path.join(dir,'other')).open()).draft,empty());
});
test('renderer batches edits, flushes immediately for close/send, and never resurrects a failed older write',async()=>{
 const {createDraftPersistence}=await import('../ui/draft-persistence.mjs');
 const sent=[];let rejectFirst;
 const controller=createDraftPersistence(p=>{sent.push(p);return sent.length===1?new Promise((_,reject)=>{rejectFirst=reject;}):Promise.resolve({ok:true});},{delay:10000});
 controller.initialize({token:'identity',draft:empty()});
 controller.schedule({...empty(),value:'old'});const first=controller.flush();await Promise.resolve();await Promise.resolve();
 controller.schedule({...empty(),value:'latest'});const second=controller.flush();rejectFirst(Error('disk unavailable'));await assert.rejects(first);await second;
 await controller.flush();assert.deepEqual(sent.map(x=>x.draft.value),['old','latest']);
 controller.schedule({...empty(),value:'typed'});controller.schedule(empty());await controller.flush();assert.equal(sent.at(-1).draft.value,'');
 assert.deepEqual(sent.map(x=>x.sequence),[1,2,3]);
});

test('unavailable draft storage never acknowledges new text as saved on close or send',async()=>{
 const {createDraftPersistence}=await import('../ui/draft-persistence.mjs');
 const saved=[];
 const controller=createDraftPersistence(p=>{saved.push(p);return {ok:true};},{delay:10000});
 controller.initialize(null,'原草稿文件无法读取');
 controller.schedule(empty());await controller.flush();
 controller.schedule({...empty(),value:'new work while storage is unavailable'});
 await assert.rejects(controller.flush(),/原草稿文件无法读取/);
 await assert.rejects(controller.flush(),/原草稿文件无法读取/);
 assert.equal(saved.length,0);
 controller.initialize({token:'recovered',draft:empty()});
 await controller.flush();assert.equal(saved[0].draft.value,'new work while storage is unavailable');
});

test('a host without persistent composer support keeps its existing session-only workflow',async()=>{
 const {createDraftPersistence}=await import('../ui/draft-persistence.mjs');
 let calls=0;
 const controller=createDraftPersistence(()=>{calls++;throw Error('unsupported host');},{delay:10000});
 controller.initialize(null);
 controller.schedule({...empty(),value:'legacy workspace input'});await controller.flush();
 assert.equal(calls,0);
});

test('changing back to the saved composer text while a different write is in flight remains the latest edit',async()=>{
 const {createDraftPersistence}=await import('../ui/draft-persistence.mjs');let release,entered;const saved=[];
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const controller=createDraftPersistence(async p=>{saved.push(p);if(saved.length===1){entered();await gate;}return {ok:true};},{delay:10000});
 const original={...empty(),value:'原文🙂'};controller.initialize({token:'identity',draft:original});
 controller.schedule({...empty(),value:'intermediate'});const writing=controller.flush();await started;
 controller.schedule(original);release();await writing;await controller.drain();
 assert.deepEqual(saved.map(p=>p.draft.value),['intermediate','原文🙂']);
});

test('close freezes admission, drains the accepted last save and leaves no lock for reopening',async t=>{
 const {config,work}=await fixture(t),store=createComposerDraft(config,work),opened=await store.open();
 const text=await packed('关闭时最后一份草稿\r\n🙂'),saving=store.save({token:opened.token,sequence:1,draft:text}),closing=store.close();
 await assert.rejects(store.save({token:opened.token,sequence:2,draft:empty()}),/正在关闭/);await saving;await closing;
 assert.deepEqual((await createComposerDraft(config,work).open()).draft,text);await assert.rejects(fs.stat(store.file+'.write-lock'),{code:'ENOENT'});
});
test('a failed last save blocks close and a subsequent successful save can recover',async t=>{
 const {config,work}=await fixture(t),store=createComposerDraft(config,work),opened=await store.open();
 await assert.rejects(store.save({token:opened.token,sequence:1,draft:{...empty(),attachments:[{}]}}));
 await assert.rejects(store.flush());await assert.rejects(store.close());
 const text=await packed('故障修复后的新输入');await store.save({token:opened.token,sequence:2,draft:text});await store.close();
 assert.deepEqual((await createComposerDraft(config,work).open()).draft,text);
});

test('close drain includes edits queued while the previous durable write is in flight',async()=>{
 const {createDraftPersistence}=await import('../ui/draft-persistence.mjs');let release;const sent=[];
 const controller=createDraftPersistence(async p=>{sent.push(p);if(sent.length===1)await new Promise(r=>release=r);return {ok:true};},{delay:10000});
 controller.initialize({token:'identity',draft:empty()});controller.schedule({...empty(),value:'before close'});
 const draining=controller.drain();await Promise.resolve();await Promise.resolve();controller.schedule({...empty(),value:'attachment finished while saving'});release();await draining;
 assert.deepEqual(sent.map(p=>p.draft.value),['before close','attachment finished while saving']);
});
test('program overlay and canvas sidebar share one versioned draft without invalidating each other on read',async t=>{
 const {config,work}=await fixture(t),store=createComposerDraft(config,work,{sessionID:'a'.repeat(32)});
 const left=await store.sharedRead(),right=await store.sharedRead();assert.equal(left.revision,right.revision);
 const saved=await store.sharedSave({revision:left.revision,draft:await packed('画布引用 @A')});
 await assert.rejects(store.sharedSave({revision:right.revision,draft:await packed('迟到覆盖')}),/另一个入口/);
 assert.equal((await store.sharedRead()).draft.value,'画布引用 @A');
 await store.sharedSave({revision:saved.revision,draft:await packed('共同草稿')});
 assert.equal((await createComposerDraft(config,work,{sessionID:'a'.repeat(32)}).sharedRead()).draft.value,'共同草稿');
});
