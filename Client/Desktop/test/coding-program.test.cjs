// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; assert; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/coding-program.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCodingProgram}=require('../../../Program/official/coding/service.cjs');

function fixture({failVaya=false}={}){
 const calls=[],scope='a'.repeat(32);
 const binding={kind:'group',program:'coding',scope_id:scope,host_session_id:'host',members:[
  {contact_id:'c1',session_id:'host',role:'cota',name:'Cota',state:'running',generation:2},
  {contact_id:'c2',session_id:'side',role:'vaya',name:'Vaya',state:'idle',generation:1},
 ]};
 const conversation=async p=>{
  calls.push(p);
  if(p.action==='program'||p.action==='program_open')return {ok:true,configured:true,binding};
  if(p.action==='group')return {seq:7,members:[{key:'host'}],messages:[{id:'m'}]};
  if(p.action==='snapshot'&&p.id==='host')return {activity:{items:[{id:'a',tool:'exec_command',command:'npm test',state:'running',started_at:20,sequence:2},{id:'h',tool:'x',hidden:true,started_at:1}]}};
  if(p.action==='snapshot'&&p.id==='side'){if(failVaya)throw Error('读取失败');return {activity:{items:[{id:'a',tool:'project',action:'read',state:'completed',started_at:10,sequence:1}]}};}
  return {ok:true};
 };
 return {calls,scope,program:createCodingProgram({conversation,openPage:()=>({ok:true}),releasePage:()=>({ok:true})})};
}

test('页面状态只带序号和成员，不带消息',async()=>{
 const f=fixture(),status=await f.program.user({action:'status',after:'5'});
 assert.deepEqual(status.group,{seq:7,members:[{key:'host'}]});
 assert.equal(f.calls.find(c=>c.action==='group').after,5);
});

test('终端合并成员回执，按时间排序并隐藏内部项',async()=>{
 const {program}=fixture(),t=await program.user({action:'terminal'});
 assert.deepEqual(t.items.map(i=>i.id),['vaya:a','cota:a']);
 assert.equal(t.items[1].text,'$ npm test');
 assert.equal(t.warning,'');
});

test('一位成员读取失败时保留其他成员并给出提示',async()=>{
 const {program}=fixture({failVaya:true}),t=await program.user({action:'terminal'});
 assert.deepEqual(t.items.map(i=>i.id),['cota:a']);
 assert.match(t.warning,/Vaya/);
});

test('聊天分页只认当前绑定，不信页面传来的会话和种类',async()=>{
 const f=fixture();
 await f.program.user({action:'chat_page',id:'evil',kind:'conversation',before:'b1'});
 const call=f.calls.find(c=>c.action==='chat_page');
 assert.equal(call.id,f.scope);assert.equal(call.kind,'group');assert.equal(call.before,'b1');assert.equal(call.limit_rounds,20);
});

test('发送需要稳定请求编号和有效内容，取消按成员当前代次，终端没有输入',async()=>{
 const f=fixture();
 await assert.rejects(f.program.user({action:'send',message:'hi'}),/请求编号/);
 await assert.rejects(f.program.user({action:'send',request_id:'r1',message:'  '}),/消息/);
 await f.program.user({action:'send',request_id:'r1',message:'hi'});
 assert.deepEqual(f.calls.find(c=>c.action==='group_post'),{action:'group_post',id:f.scope,text:'hi',request_id:'r1'});
 await assert.rejects(f.program.user({action:'cancel',role:'cota'}),/代次/);
 await f.program.user({action:'cancel',role:'cota',generation:2});
 assert.deepEqual(f.calls.find(c=>c.action==='group_stop'),{action:'group_stop',id:f.scope,member:'host',generation:2});
 await assert.rejects(f.program.user({action:'terminal_input'}),/没有这项操作/);
});

test('Coding draft, attachment and receipts are bound to the host or named member',async()=>{
 const f=fixture();
 await f.program.user({action:'draft_load',id:'other'});
 assert.deepEqual(f.calls.at(-1),{action:'draft_shared_load',id:'host'});
 await f.program.user({action:'receipt',id:'other',role:'vaya',call_id:'step',generation:3,input_offset:0,output_offset:0});
 assert.equal(f.calls.at(-1).action,'group_receipt');assert.equal(f.calls.at(-1).group_id,f.scope);assert.equal(f.calls.at(-1).member_id,'side');assert.equal(f.calls.at(-1).call_id,'step');assert.equal(f.calls.at(-1).id,undefined);
 await assert.rejects(f.program.user({action:'receipt',role:'eyra',call_id:'step'}),/不属于/);
 const files=[{name:'proof.txt',sha256:'a'.repeat(64)}];
 await f.program.user({action:'send',request_id:'file-only',message:'',attachments:files});
 assert.deepEqual(f.calls.at(-1).attachments,files);
});

test('Coding preserves pending and changed receipt responses for bounded retry',async()=>{
 let response={ok:false,pending:true,code:'receipt_pending'};
 const program=createCodingProgram({conversation:async p=>p.action==='program'?{binding:{kind:'group',program:'coding',scope_id:'group',members:[{role:'vaya',session_id:'side'}]}}:response});
 assert.equal(await program.user({action:'receipt',role:'vaya',call_id:'call'}),response);
 response={ok:false,changed:true,code:'receipt_changed'};
 assert.equal(await program.user({action:'receipt',role:'vaya',call_id:'call'}),response);
});

test('project changes reject stale reads and saves; delayed drafts stay in their original project',async()=>{
 let root='C:/project/a';const writes=[];
 const program=createCodingProgram({conversation:async()=>({binding:{kind:'group',program:'coding',scope_id:'group',host_session_id:'cota',project:{root},members:[{role:'cota',session_id:'cota',workdir:root,state:'idle'}]}}),projectFiles:{read:(...p)=>writes.push(['read',...p]),save:(...p)=>writes.push(['save',...p]),draft:(...p)=>writes.push(['draft',...p])}});
 const first=(await program.user({action:'status'})).binding.project_key;
 root='C:/project/b';const second=(await program.user({action:'status'})).binding.project_key;assert.notEqual(first,second);
 await assert.rejects(program.user({action:'project_save',project_key:first,path:'same.txt',text:'draft',version:'v'}),{code:'project_changed'});
 await assert.rejects(program.user({action:'project_read',project_key:first,path:'same.txt'}),{code:'project_changed'});
 await program.user({action:'project_draft',project_key:first,path:'same.txt',draft:{text:'draft'}});
 assert.deepEqual(writes,[['draft','C:/project/a','same.txt',{text:'draft'}]]);
 await program.user({action:'project_read',project_key:second,path:'same.txt'});assert.equal(writes.at(-1)[1],'C:/project/b');
});
test('project history uses complete bound patch receipts, with one observation per receipt',async()=>{
 const observed=[],calls=[],binding={kind:'group',program:'coding',scope_id:'group',host_session_id:'host',members:[{role:'cota',name:'Cota',session_id:'host',workdir:'C:/project'}]};let pending=true;
 const program=createCodingProgram({projectFiles:{observe:(...args)=>observed.push(args)},conversation:async p=>{
  calls.push(p);if(p.action==='program')return {binding};
  if(p.action==='snapshot')return {activity:{items:[{id:'patch',generation:7,receipt_version:'v1',tool:'apply_patch',state:'completed'}]}};
  if(p.action==='group_receipt')return pending?{pending:true}:{output:JSON.stringify({ok:true,state:'applied',files:[{path:'a.txt',after_sha256:'a'.repeat(64)}]}),receipt_version:'v1'};
  throw Error('unexpected action');
 }});
 await program.user({action:'terminal'});assert.equal(observed.length,0);pending=false;await program.user({action:'terminal'});await program.user({action:'terminal'});
 assert.equal(observed.length,1);assert.equal(observed[0][0],'C:/project');assert.equal(observed[0][2].call_id,'patch');assert.equal(observed[0][2].member,'Cota');
 const receipt=calls.find(p=>p.action==='group_receipt');assert.equal(receipt.member_id,'host');assert.equal(receipt.group_id,'group');assert.equal(receipt.receipt_generation,7);assert.equal(receipt.receipt_version,'v1');
});
test('only native selection changes the root, cancellation is inert and saved bytes survive a context failure',async()=>{
 let project={root:'C:/fixtures/first',revision:1},selection=null,failContext=false;const calls=[],files=[];
 const program=createCodingProgram({chooseProject:async()=>selection,projectFiles:{selection:(_root,file)=>({root:file,path:'main.txt'}),save:(...p)=>{files.push(p);return {path:p[1],text:p[2],version:'new'};}},conversation:async p=>{
  calls.push(p);if(p.action==='coding_project'){
   if(failContext)throw Error('context unavailable');
   if(p.operation==='open'){assert.equal(p.expected_revision,project.revision);project={root:p.root,revision:project.revision+1};}
   return {ok:true,project};
  }
  return {configured:false,binding:{kind:'group',program:'coding',scope_id:'scope',project,members:[{role:'cota',workdir:project.root,state:'idle'}]}};
 }});
 assert.equal((await program.user({action:'project_open',root:'C:/fixtures/forged'})).cancelled,true);assert.equal(calls.some(p=>p.action==='coding_project'),false);
 selection='C:/fixtures/native-selection';const selected=await program.user({action:'file_open',root:'C:/fixtures/forged'});assert.equal(project.root,selection);assert.equal(selected.path,'main.txt');
 failContext=true;const saved=await program.user({action:'project_save',project_key:selected.binding.project_key,path:'main.txt',text:'human edit',version:'old'});
 assert.equal(saved.text,'human edit');assert.match(saved.context_warning,/同步失败/);assert.equal(files[0][0],selection);assert.equal(calls.some(p=>p.action==='group_post'),false);
});
test('opening Coding leaves an unselected project empty without registering its internal working directory',async()=>{
 const calls=[];let project={root:'',revision:0};
 const program=createCodingProgram({projectFiles:{},conversation:async p=>{
  calls.push(p);if(p.action==='coding_project'){project={root:p.root,revision:1};return {ok:true,project};}
  return {binding:{kind:'group',program:'coding',scope_id:'scope',project,members:[{role:'cota',workdir:'C:/fixtures/default-project',state:'idle'}]}};
 }});
 for(let i=0;i<2;i++){const value=await program.user({action:'status',open:true});assert.equal(value.binding.project.root,'');assert.equal(value.binding.project_key,'');}
 assert.equal(calls.filter(p=>p.action==='coding_project').length,0);assert.equal(calls.some(p=>p.action==='group_post'),false);
});
test('switching projects excludes earlier operations from the editor and file attribution',async()=>{
 const observations=[],binding={kind:'group',program:'coding',scope_id:'scope',host_session_id:'host',project:{root:'C:/fixtures/new',generation_floor:{host:4}},members:[{role:'cota',session_id:'host',workdir:'C:/fixtures/new'}]};
 const program=createCodingProgram({projectFiles:{observe:(...p)=>observations.push(p)},conversation:async p=>{
  if(p.action==='program')return {binding};
  if(p.action==='snapshot')return {activity:{items:[{id:'old',generation:4,tool:'apply_patch',state:'completed',targets:['same.txt']},{id:'unknown',tool:'apply_patch',state:'completed'},{id:'new',generation:5,tool:'exec_command',state:'completed'}]}};
  throw Error('Old project must not read a receipt or attribute a file: '+p.action);
 }});
 const result=await program.user({action:'terminal'});assert.deepEqual(result.items.map(x=>x.call_id),['new']);assert.deepEqual(observations,[]);
});
