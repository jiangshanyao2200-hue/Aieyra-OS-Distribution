// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: documentFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/usability120.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
test('snapshot preflight failure restores a definitely unsent message and its exact attachments',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let stored,calls=0;
 const files=[{name:'保留附件.txt',asset:path.join(os.tmpdir(),'owned-snapshot'),sha256:'a'.repeat(64),bytes:19,kind:'file',mime:'application/octet-stream'}];
 const q=new SendQueue('home',[],v=>stored=structuredClone(v));q.add('original\r\n原文','stable',files);
 await assert.rejects(q.drain(async()=>calls++,async()=>false,async()=>{throw Error('context deadline exceeded');}),/deadline/);
 assert.equal(calls,0);assert.equal(stored[0].delivery,'prepared');assert.equal(stored[0].request_id,'stable');assert.equal(stored[0].text,'original\r\n原文');assert.equal(stored[0].attachments[0].sha256,files[0].sha256);assert.equal(stored[0].attachments[0].name,files[0].name);
 const restored=new SendQueue('home',stored);await restored.drain(async e=>{calls++;assert.equal(e.request_id,'stable');assert.deepEqual(e.attachments,stored[0].attachments);});assert.equal(calls,1);assert.equal(restored.entries.length,0);
});
test('Coding combines one member’s commands without dropping separate process receipts',async()=>{
 const {workProjectionGroups}=await import('../ui/work-surface.mjs');
 const item=(id,session,state='running')=>({id,member:'cota',generation:2,tool:'exec_command',preview:{session_id:session,generation:2,state}});
 const rows=[{id:'main',member:'vaya',tool:'web_search',state:'running'},item('one',1),item('two',2),item('two-wait',2)];
 const groups=workProjectionGroups('coding',rows);
 assert.deepEqual([...groups.values()].map(g=>g.operations.map(i=>i.id)),[['main'],['one','two','two-wait']]);
 const settled=workProjectionGroups('coding',rows.map(i=>i.preview?{...i,preview:{...i.preview,state:'exited'}}:i));
 assert.deepEqual([...settled.keys()],[...groups.keys()]);
 const last=workProjectionGroups('coding',[{...rows[0],state:'completed'},...rows.slice(1),item('three',3)]);
 assert.deepEqual([...last.values()].map(group=>group.operations.map(i=>i.id)),[['main'],['one','two','two-wait','three']]);
});
test('Coding column widths preserve a usable editor at narrow and wide sizes',async()=>{
 const {columnWidths}=await import('../../../Program/official/coding/ui/project-layout.mjs');
 for(const width of [480,700,1000,1600])for(const left of [.1,.55])for(const right of [.1,.55]){
  const a=columnWidths(width,left,right,true);assert(a.left>0&&a.right>0);assert(width-12-a.left-a.right>=Math.min(200,(width-12)*.32)-1);
  assert.equal(columnWidths(width,left,right,false).right,0);
 }
});
function documentFixture(){
 const timers=new Map();let seq=0;
 const doc={created:[],defaultView:{setTimeout(fn){timers.set(++seq,fn);return seq;},clearTimeout(id){timers.delete(id);},matchMedia:()=>({matches:false})}};
 doc.createElement=tag=>{const attrs=new Map(),n={tagName:tag,ownerDocument:doc,dataset:{},children:[],innerHTML:'',classList:{contains:()=>false},append(...v){this.children.push(...v);},setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),querySelector:()=>({animate(){}}),remove(){this.removed=true;}};doc.created.push(n);return n;};doc.body=doc.createElement('body');
 return {doc,expire(){const list=[...timers.values()];timers.clear();for(const fn of list)fn();}};
}
test('copy feedback repeats without losing the original icon or dynamic tooltip',async()=>{
 const {copyFeedback}=await import('../../../Theme/runtime/copy-feedback.mjs'),f=documentFixture(),button=f.doc.createElement('button');button.innerHTML='<copy/>';button.setAttribute('data-tip','复制说明');button.setAttribute('aria-label','复制');
 copyFeedback(button);assert.equal(button.dataset.copied,'true');assert.equal(button.getAttribute('data-tip'),'已复制');copyFeedback(button);f.expire();
 assert.equal(button.innerHTML,'<copy/>');assert.equal(button.getAttribute('data-tip'),'复制说明');assert.equal(button.dataset.copied,undefined);assert.equal(button.getAttribute('aria-label'),'复制');
});
test('Link directly copies the current office guide once, gives common feedback and creates no popup',async t=>{
 const {setupLinkAccessGuide}=await import('../../../Control/app/web/link-access-guide.js'),f=documentFixture(),parent=f.doc.createElement('header');let resolve,fetches=0;const copies=[];
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async v=>copies.push(v)}}});t.after(()=>old?Object.defineProperty(globalThis,'navigator',old):delete globalThis.navigator);
 const guide={protocol:'aieyra-office/1',origin:'http://127.0.0.1:18237',port:18237,api_base:'http://127.0.0.1:18237/api/agent/v1',guide_url:'http://127.0.0.1:18237/api/office/guide',station_script:path.join(os.tmpdir(),'station.py'),client_script:path.join(os.tmpdir(),'client.py'),current_project_id:'two',projects:[{id:'one',root:path.join(os.tmpdir(),'one')},{id:'two',root:path.join(os.tmpdir(),'two')}]};
 const ui=setupLinkAccessGuide({parent,fetchGuide:async()=>{fetches++;if(fetches>1)return {ok:false};await new Promise(r=>resolve=r);return {ok:true,json:async()=>guide};}});t.after(()=>ui.dispose());
 const button=parent.children[0],one=button.onclick();await button.onclick();assert.equal(fetches,1);resolve();await one;
 assert.equal(copies.length,1);assert.match(copies[0],/project = "two"/);assert.equal(button.dataset.copied,'true');assert.equal(button.disabled,false);assert(!f.doc.created.some(n=>['dialog','select','pre'].includes(n.tagName)));
 const status=f.doc.body.children[0];assert.equal(status.className,'sr-only');assert.equal(status.getAttribute('role'),'status');assert.match(status.textContent,/已复制/);
 await button.onclick();assert.equal(button.dataset.copied,undefined);assert.equal(status.className,'link-copy-notice');assert.match(status.textContent,/复制失败/);
});
test('active tool Brief rows remain readable, while ordinary archived process bodies stay filtered',async()=>{
 const {visibleChat}=await import('../ui/agent-dock.mjs');const rows=[{id:'body',process:true},{id:'brief',from:'eyra',process:true,brief:true,state:'failed'},{id:'user',from:'user'}];assert.deepEqual(visibleChat(rows).map(r=>r.id),['brief','user']);
});
test('Center binds assist to Nova through Core and exposes only the existing narrow update service',async()=>{
 const {createCenterProgram}=require('../../../Program/official/center/service.cjs'),calls=[];
 const p=createCenterProgram({updates:async a=>{calls.push(a);return {ok:true,homeSession:'home',phase:'available'};},conversation:async a=>{calls.push(a);return a.action==='program_open'?{session:{id:'nova',generation:4}}:{ok:true};}});
 const request_id='11111111-1111-4111-8111-111111111111';await assert.rejects(p.user({action:'assist',request_id,session_id:'foreign'}),/切换/);assert(!calls.some(c=>c.action==='send'));
 const result=await p.user({action:'assist',request_id,session_id:'home'});const send=calls.find(c=>c.action==='send');assert.equal(send.id,'nova');assert.equal(send.request_id,'center-update-'+request_id);assert.equal(send.generation,4);assert.equal(result.accepted,true);
 await assert.rejects(p.user({action:'prepare'}),/不支持/);
});
test('update feedback is restricted to the release thread and supports Agent intake and receipts',async()=>{
 const {createCenterProgram}=require('../../../Program/official/center/service.cjs');
 const topic='12345678-1234-4123-8123-123456789abc',request_id='11111111-1111-4111-8111-111111111111';
 let account='one',switchAccount=false;const operations=[];
 const p=createCenterProgram({
  updates:async args=>{
   if(args.action==='status'){if(switchAccount)account='two';return {currentVersion:'0.2.85'};}
   if(args.id!==topic)throw Error('该条目不是官方 OS 发布帖');
   return {id:args.id};
  },
  community:{status:()=>({user:{id:account}}),call:async args=>{
   operations.push(args);
   if(args.action==='sync')return {events:[{topic,kind:'reply',seq:3},{topic:'other',kind:'reply',seq:4}],nextCursor:4};
   if(args.action==='replies')return {items:[{content:'回报'}],nextCursor:'more'};
   return {ok:true,item:{content:args.content||operations.find(x=>x.action==='reply').content}};
  }},
 });
 const args={release_topic:topic,request_id,content:'更新后程序页面无法打开。'};
 await assert.rejects(p.invoke('report_issue',args),/确认/);
 await assert.rejects(p.user({action:'report_issue',...args,release_topic:'foreign',confirmed:true}),/官方/);
 await assert.rejects(p.invoke('quick',{}),/用户/);
 assert.equal(operations.length,0);
 await p.invoke('report_issue',{...args,confirmed:true});
 assert.deepEqual(operations[0],{action:'reply',id:topic,request_id,content:'[Aieyra OS 更新反馈] Agent · 0.2.85\n\n'+args.content});
 assert.equal((await p.invoke('feedback_receipt',args)).ok,true);
 assert.equal((await p.invoke('feedback',{release_topic:topic})).nextCursor,'more');
 assert.deepEqual(await p.invoke('feedback_events',{release_topic:topic,after:2}),{ok:true,events:[{topic,kind:'reply',seq:3}],nextCursor:4,hasMore:false});
 switchAccount=true;
 await assert.rejects(p.user({action:'report_issue',...args,confirmed:true}),/账号已切换/);
 assert.equal(operations.filter(op=>op.action==='reply').length,1);
});
test('opening, restoring and saving an image canvas does not load legacy Office engines',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-lazy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=`const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){if(['exceljs','pptxgenjs','jszip','sharp','./legacy/lineage-runtime.cjs'].includes(name))throw Error('unneeded Office engine '+name);return original.call(this,name,...args);};(async()=>{const {createWorkspaceProgram}=require(${JSON.stringify(path.resolve(__dirname,'../../../Program/official/workspace/service.cjs'))});const canvas=createWorkspaceProgram({dataRoot:${JSON.stringify(root)},electron:{app:{isPackaged:false},BrowserWindow:{getAllWindows:()=>[]}},conversation(){throw Error('no model needed');}});const loaded=await canvas.call('aieyra:canvas:load');if(!loaded.ok)throw Error(loaded.error);const saved=await canvas.call('aieyra:config:save-session',{projectId:loaded.project.id,sessionRevision:1,nodes:[{id:'one',type:'image',title:'One',assets:[]}]});if(!saved.ok)throw Error(saved.error);const restored=await canvas.call('aieyra:config:load-session');if(restored.session.nodes.length!==1)throw Error('canvas lost');await canvas.close();})().catch(e=>{console.error(e);process.exitCode=1;});`;
 const r=spawnSync(process.execPath,['-e',script],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+r.stderr);
});
