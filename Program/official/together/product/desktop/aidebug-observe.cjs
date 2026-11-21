/* @file-map:start
文件: link/desktop/aidebug-observe.cjs
位置: 二环·完整观察模块 | 集中场景、程序日志、截图/连续帧、问题状态与显式证据复验。
约束: observed只表示取证完成；manual_review_required不由零audit项自动清除；dispatch前保存pending_step；失败或unknown停止后续场景，不重放输入；verified/dismissed必须引用存在的诊断证据和具体复验说明；fixed不能自动升级
下游: 无已解析的项目内静态导入
上游: AIDEBUG/observe.test.cjs, link/desktop/aidebug-live.cjs
链路: observation
验证: AIDEBUG/control.test.cjs, AIDEBUG/observe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  name | function
  stamp | function
  createObserver | function
  createObserver.location | function
  createObserver.save | function
  createObserver.list | function
  createObserver.read | function
  createObserver.reference | function
  createObserver.list | method
  createObserver.read | method
  createObserver.finding | method
  createObserver.observe | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const operations=new Set(['status','health','logs','inspect','actions','capture','filmstrip','click','pointer','input','key','scroll','wait','viewport','tab']);
const /* @chain-region name | calls: test, Error */ name=value=>{if(!/^[A-Za-z0-9_-]{1,32}$/.test(value||''))throw Error('invalid_observation_name');return value;};
const /* @chain-region stamp | calls: toISOString, Date */ stamp=()=>new Date().toISOString();

// Own a complete observation cycle. Capture candidates first; visual review and
// proof of repair are explicit findings, never inferred from a zero audit count.
/* @chain-region createObserver | calls: path.join */ function createObserver({directory,dispatch,checkpoint,health,logs,redact=value=>value}){
 const root=path.join(directory,'observations');
 const /* @chain-region createObserver.location | calls: path.join, name */ location=id=>path.join(root,name(id),'observation.json');
 const /* @chain-region createObserver.save | calls: location, fs.writeFileSync, JSON.stringify, redact, fs.renameSync */ save=value=>{const file=location(value.name),temp=file+'.next';fs.writeFileSync(temp,JSON.stringify(redact(value),null,2));fs.renameSync(temp,file);};
 const /* @chain-region createObserver.list | calls: fs.existsSync, slice, reverse, sort, filter, fs.readdirSync, test, location */ list=()=>fs.existsSync(root)?fs.readdirSync(root).filter(id=>/^[A-Za-z0-9_-]{1,32}$/.test(id)&&fs.existsSync(location(id))).sort().reverse().slice(0,40):[];
 const /* @chain-region createObserver.read | calls: JSON.parse, fs.readFileSync, location, list */ read=id=>JSON.parse(fs.readFileSync(location(id||list()[0]),'utf8'));
 const /* @chain-region createObserver.reference | calls: path.isAbsolute, Error, path.relative, path.resolve, relative.startsWith, isFile, fs.statSync */ reference=file=>{
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('absolute_evidence_path_required');
  const relative=path.relative(path.resolve(directory,'..'),path.resolve(file));
  if(!relative||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!fs.statSync(file).isFile())throw Error('diagnostic_evidence_required');
  return file;
 };
 return {
  /* @chain-region createObserver.list | calls: map, list, read, location */ list(){return {observations:list().map(id=>{const value=read(id);return {name:id,state:value.state,scenes:value.scenes.length,findings:value.findings.length,path:location(id)};})};},
  /* @chain-region createObserver.read | calls: read */ read(command){return read(command.name);},
  /* @chain-region createObserver.finding | calls: read, change.summary.trim, Error, includes, Array.isArray, map, change.verification.trim, crypto.randomUUID … */ finding(command){
   const value=read(command.name),change=command.finding;
   if(!change||typeof change.summary!=='string'||!change.summary.trim()||change.summary.length>2000)throw Error('finding_summary_required');
   const state=change.state||'open';
   if(!['open','fixed','verified','dismissed'].includes(state))throw Error('invalid_finding_state');
   if(!Array.isArray(change.evidence||[])||(change.evidence||[]).length>12)throw Error('bounded_finding_evidence_required');
   const evidence=(change.evidence||[]).map(reference);
   if(['verified','dismissed'].includes(state)&&(!evidence.length||typeof change.verification!=='string'||!change.verification.trim()))throw Error('verification_evidence_required');
   const id=change.id||crypto.randomUUID(),previous=value.findings.find(item=>item.id===id);
   if(change.scene&&!value.scenes.some(item=>item.name===change.scene))throw Error('observation_scene_required');
   const item={...previous,id,scene:change.scene||previous?.scene||null,kind:previous?.kind||'visual-review',summary:change.summary,state,evidence,verification:String(change.verification||'').slice(0,2000),source_refs:(Array.isArray(change.source_refs)?change.source_refs:previous?.source_refs||[]).map(String).slice(0,16),updated_at:stamp()};
   if(previous)value.findings[value.findings.indexOf(previous)]=item;else{if(value.findings.length>=400)throw Error('finding_limit');value.findings.push(item);}
   value.updated_at=stamp();save(value);return {finding:item,path:location(value.name)};
  },
  /* @chain-region createObserver.observe | calls: Array.isArray, Error, name, Date.now, Set, seen.has, seen.add, operations.has … */ async observe(command){
   if(!Array.isArray(command.scenes)||!command.scenes.length||command.scenes.length>24)throw Error('observation_scenes_required');
   const id=name(command.name||'review-'+Date.now()),seen=new Set();
   for(const scene of command.scenes){
    name(scene.name);if(scene.name.length>24||seen.has(scene.name))throw Error('unique_scene_names_required');seen.add(scene.name);
    if(scene.steps!==undefined&&(!Array.isArray(scene.steps)||scene.steps.length>20))throw Error('bounded_scene_steps_required');
    for(const step of scene.steps||[])if(!step||!operations.has(step.op))throw Error('unsupported_observation_step');
    if(scene.surface!==undefined&&!['desktop','composite'].includes(scene.surface))throw Error('invalid_observation_surface');
   }
   const folder=path.dirname(location(id));if(fs.existsSync(folder))throw Error('observation_already_exists');fs.mkdirSync(folder,{recursive:true});
   const value={protocol:'aieyra-observation/1',name:id,request_id:command.request_id||null,state:'observing',started_at:stamp(),scenes:[],findings:[],manual_review_required:true};
   save(value);
   try{
    const initial=path.join(folder,'before.json');fs.writeFileSync(initial,JSON.stringify(redact(await health()),null,2));value.before=initial;
    if(logs){const file=path.join(folder,'program-before.json');fs.writeFileSync(file,JSON.stringify(redact(await logs()),null,2));value.program_before=file;}
    for(const scene of command.scenes){
     const record={name:scene.name,chain:String(scene.chain||'').slice(0,120),started_at:stamp(),steps:[],state:'observing'};value.scenes.push(record);save(value);
     try{
      for(const [index,step] of (scene.steps||[]).entries()){
       // Persist intent before dispatch. An interrupted or unknown operation is
       // inspected via its original receipt, never automatically retried here.
       record.pending_step={index,op:step.op,command:step};save(value);
       record.steps.push({index,op:step.op,result:await dispatch(step)});delete record.pending_step;save(value);
      }
      record.checkpoint=await checkpoint({name:'observe-'+id+'-'+scene.name,view:scene.view,surface:scene.surface,note:scene.note});
      for(const issue of record.checkpoint.audit.issues||[]){
       const issueId=crypto.createHash('sha256').update(scene.name+'|'+issue.kind+'|'+issue.selector).digest('hex').slice(0,20);
       if(value.findings.some(item=>item.id===issueId))continue;
       if(value.findings.length>=400){value.unrecorded_candidates=(value.unrecorded_candidates||0)+1;continue;}
       value.findings.push({id:issueId,scene:scene.name,kind:issue.kind,summary:issue.kind+' · '+issue.selector,state:'open',evidence:[record.checkpoint.image],measurement:issue,source_refs:scene.chain?[scene.chain]:[],updated_at:stamp()});
      }
      record.state='observed';value.review=record.checkpoint.review;
     }catch(error){
      record.state=error.outcomeUnknown?'unknown':'failed';record.error={message:error.message,outcomeUnknown:!!error.outcomeUnknown};
      value.findings.push({id:crypto.randomUUID(),scene:scene.name,kind:'observation-failure',summary:error.message,state:'open',evidence:[],updated_at:stamp()});
      value.state='partial';save(value);break;
     }finally{record.finished_at=stamp();save(value);}
    }
    if(value.state==='observing')value.state='observed';
    const final=path.join(folder,'after.json');fs.writeFileSync(final,JSON.stringify(redact(await health()),null,2));value.after=final;
    if(logs){const file=path.join(folder,'program-after.json');fs.writeFileSync(file,JSON.stringify(redact(await logs()),null,2));value.program_after=file;}
   }catch(error){value.state='partial';value.error={message:error.message};}
   finally{value.finished_at=stamp();save(value);}
   return {state:value.state,name:id,path:location(id),review:value.review,scenes:value.scenes.length,findings:value.findings.length,manual_review_required:true};
  },
 };
}
module.exports={createObserver};
