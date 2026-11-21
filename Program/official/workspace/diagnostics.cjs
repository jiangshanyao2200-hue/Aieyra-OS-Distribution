'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stages=new Set(['restore','render','error','rejection','navigating','loaded','gone','unresponsive','responsive','load-failed','closed','ready','image-recovery','video-recovery','restore-start','storage-dependencies','storage-files','storage-created','settings-loaded','session-loaded','canvas-applied','first-frame','heartbeat']);
const critical=new Set(['restore','render','error','rejection','gone','unresponsive','load-failed','image-recovery','video-recovery']);
const nativeFaults=new Set(['gone','unresponsive','load-failed']);
const metricLimits={durationMs:3600000,nodeCount:10000000,domNodes:1000000,maxGapMs:3600000,samples:1000000,heapMB:1048576};
const names=new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AggregateError','JsonStorageError']);
function diagnosticRecord(stage,value={}){
 if(!stages.has(stage))return null;
 value=value&&typeof value==='object'?value:{};
 const error=value.error||value,frames=[];
 // Keep call sites, never the first line (which can contain a prompt, path,
 // credential or provider body). URLs and arbitrary values are not persisted.
 for(const line of String(error.stack||'').slice(0,24000).split('\n').slice(1)){
  const match=/^\s*at\s+(?:([\w$.<>]+)\s+\()?.*?([\w.-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)\)?\s*$/.exec(line);
  if(match)frames.push({function:match[1]||'',file:match[2].slice(-100),line:Number(match[3]),column:Number(match[4])});
  if(frames.length===16)break;
 }
 const code=String(error.code||''),reason=String(value.reason||''),metrics={};
 for(const [key,max]of Object.entries(metricLimits)){const number=value.metrics?.[key];if(typeof number==='number'&&Number.isFinite(number)&&number>=0&&number<=max)metrics[key]=Math.round(number*10)/10;}
 return {time:new Date().toISOString(),stage,name:names.has(error.name)?error.name:'Error',
  .../^(?:JSON_|ERR_|CANVAS_|WORKSPACE_|LINEAGE_|WRITING_)[A-Z0-9_]{1,60}$|^E[A-Z]{2,20}$/.test(code)?{code}:{},
  ...frames.length?{frames}:{},
  ...['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure'].includes(reason)?{reason}:{},
  ...Number.isInteger(value.exitCode)?{exitCode:value.exitCode}:{},
  ...Object.keys(metrics).length?{metrics}:{}};
}
function createCanvasDiagnostics({root,report=()=>{},maxBytes=256*1024}){
 const directory=path.join(root,'diagnostics'),file=path.join(directory,'workspace-events.jsonl');
 const run=crypto.randomBytes(16).toString('hex');let started=performance.now(),attempt=0,windowStart=0,count=0,criticalCount=0,nativeCount=0;
 function record(stage,value){
  try{
   const row=diagnosticRecord(stage,value);if(!row)return;
   const now=Date.now();if(now-windowStart>60000){windowStart=now;count=criticalCount=nativeCount=0;}
   // Correlation follows every real navigation even if its log row is dropped.
   if(stage==='navigating'){attempt++;started=performance.now();}
   if(nativeFaults.has(stage)){if(nativeCount++>=40)return;}else if(critical.has(stage)){if(criticalCount++>=40)return;}else if(count++>=40)return;
   Object.assign(row,{run,attempt,elapsedMs:Math.round((performance.now()-started)*10)/10,hostRssMB:Math.round(process.memoryUsage().rss/104857.6)/10});
   fs.mkdirSync(directory,{recursive:true});
   if(fs.existsSync(file)&&fs.statSync(file).size>=maxBytes){
    fs.rmSync(file+'.2',{force:true});if(fs.existsSync(file+'.1'))fs.renameSync(file+'.1',file+'.2');fs.renameSync(file,file+'.1');
   }
   fs.appendFileSync(file,JSON.stringify(row)+'\n');
  }catch{try{report({code:'canvas-diagnostics-unavailable'});}catch{/* Diagnostics cannot interrupt product work. */}}
 }
 return {record};
}
module.exports={createCanvasDiagnostics,diagnosticRecord};
