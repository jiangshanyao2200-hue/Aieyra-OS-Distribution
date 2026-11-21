'use strict';

const SCHEMA='aieyra.health-model/1';
const ALGORITHM='median-mad-ewma';
const FEATURE=/^[a-z][a-z0-9_.-]{0,63}$/;
const LIMIT=1e15;
const MAX_FEATURES=64;
const MAX_BASELINES=4;
const CALIBRATION=12;
const GAIN=.04;
const ALERT=4.5;
const MAX_BYTES=128*1024;
const DEFAULT_SPEC={min:-LIMIT,max:LIMIT,minSpread:1e-6,direction:'both'};

function record(value){
 return value&&typeof value==='object'&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
}

function featureSpec(value){
 const spec={...DEFAULT_SPEC,...value};
 if(!Number.isFinite(spec.min)||!Number.isFinite(spec.max)||spec.min< -LIMIT||spec.max>LIMIT||spec.min>=spec.max||
  !Number.isFinite(spec.minSpread)||spec.minSpread<=0||spec.minSpread>LIMIT||
  !['high','low','both'].includes(spec.direction))throw Error('Invalid health model feature specification');
 return spec;
}

function valid(value,{min,max}){
 return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
}

function median(values){
 const ordered=[...values].sort((a,b)=>a-b);
 const middle=Math.floor(ordered.length/2);
 return ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2;
}

function provenance(input){
 const value={};
 if(typeof input?.build_id==='string'&&/^[a-f0-9]{8,64}$/.test(input.build_id))value.build_id=input.build_id;
 if(typeof input?.source==='string'&&FEATURE.test(input.source))value.source=input.source;
 return value;
}

function baselineKey(origin){
 return JSON.stringify([origin.build_id||null,origin.source||null]);
}

function baselineContext(origin,legacy=false,key=baselineKey(origin)){
 return {key:legacy?'legacy':key,
  scope:legacy?'legacy':origin.build_id?'build':'unattributed',
  provenance:origin,trainedAt:null,features:new Map()};
}

function restoreBaseline(value,specs,legacy=false){
 if(!record(value?.features)||Object.keys(value.features).length>MAX_FEATURES)return null;
 const context=baselineContext(provenance(value.provenance),legacy||value.scope==='legacy');
 if(!legacy&&context.scope!==value.scope)return null;
 context.trainedAt=Number.isSafeInteger(value.trained_at)&&value.trained_at>=0?value.trained_at:null;
 for(const [name,row] of Object.entries(value.features)){
  if(!FEATURE.test(name)||!record(row)||!Number.isSafeInteger(row.samples)||row.samples<1)return null;
  const spec=specs?specs.get(name):DEFAULT_SPEC;
  if(row.samples<CALIBRATION){
   if(!Array.isArray(row.warmup)||row.warmup.length!==row.samples||!row.warmup.every(entry=>valid(entry,DEFAULT_SPEC)))return null;
   if(spec&&row.warmup.every(entry=>valid(entry,spec)))context.features.set(name,{samples:row.samples,warmup:[...row.warmup]});
  }else{
   if(!valid(row.baseline,DEFAULT_SPEC)||!Number.isFinite(row.variance)||row.variance<0||row.variance>4*LIMIT**2)return null;
   if(spec&&valid(row.baseline,spec))context.features.set(name,{samples:row.samples,baseline:row.baseline,variance:row.variance});
  }
 }
 return context;
}

function restoreContexts(value,specs){
 if(value?.schema!==SCHEMA||value.algorithm!==ALGORITHM)return null;
 // Earlier checkpoints could mix different builds under the last observation's identity.
 if(value.checkpoint_version===undefined){
  const context=restoreBaseline(value,specs,true);
  return context?[context]:null;
 }
 if(value.checkpoint_version!==2||!Array.isArray(value.retained)||value.retained.length>=MAX_BASELINES)return null;
 const contexts=[...value.retained,value].map(row=>restoreBaseline(row,specs));
 if(contexts.some(row=>!row)||new Set(contexts.map(row=>row.key)).size!==contexts.length)return null;
 return contexts;
}

function checkpoint(context){
 return {scope:context.scope,provenance:context.provenance,trained_at:context.trainedAt,features:Object.fromEntries(context.features)};
}

function update(row,value,spec,learn){
 if(row.samples<CALIBRATION){
  if(!learn)return {score:null,anomaly:false,trained:false};
  row.warmup.push(value);
  row.samples++;
  if(row.samples===CALIBRATION){
   row.baseline=median(row.warmup);
   row.variance=(1.4826*median(row.warmup.map(sample=>Math.abs(sample-row.baseline))))**2;
   delete row.warmup;
  }
  return {score:null,anomaly:false,trained:true};
 }
 const spread=Math.max(spec.minSpread,Math.abs(row.baseline)*.025,Math.sqrt(row.variance));
 const residual=value-row.baseline;
 const z=residual/spread;
 const score=Math.max(0,spec.direction==='low'?-z:spec.direction==='high'?z:Math.abs(z));
 if(score>=ALERT)return {score,anomaly:true,trained:false};
 if(!learn)return {score,anomaly:false,trained:false};
 // Winsorize the learning step so a single extreme sample cannot widen the model indefinitely.
 const bounded=Math.min(2*spread,Math.max(-2*spread,residual));
 row.baseline+=GAIN*bounded;
 row.variance=(1-GAIN)*(row.variance+GAIN*bounded**2);
 row.samples=Math.min(Number.MAX_SAFE_INTEGER,row.samples+1);
 return {score,anomaly:false,trained:true};
}

function createHealthModel({file,readJson,writeJson,features,clock=Date.now,persistEveryMs=60000,staleAfterMs=90000}={}){
 const specs=features===undefined?null:new Map(Object.entries(features).map(([name,spec])=>{
  if(!FEATURE.test(name))throw Error('Invalid health model feature name');
  return [name,featureSpec(spec)];
 }));
 if((specs?.size||0)>MAX_FEATURES)throw Error('Too many health model features');
 const baselines=new Map(),latest=new Map();
 const storage={status:file?'unavailable':'memory',restored:false,saved_at:null};
 let writable=false,version=0,savedVersion=0,lastAttempt=-Infinity,pending,closing;
 let active=null,updatedAt=null,origin={};
 const quality={observations:0,accepted:0,rejected:0,missing:specs?.size||0,anomalous:0};
 if(file&&typeof readJson==='function'&&typeof writeJson==='function'){
  try{
   const snapshot=readJson(file,{maxBytes:MAX_BYTES});
   if(snapshot?.status==='missing'){storage.status='ready';writable=true;}
   else{
    const contexts=snapshot?.status==='valid'?restoreContexts(snapshot.value,specs):null;
    if(contexts){
     for(const context of contexts)baselines.set(context.key,context);
     active=contexts.at(-1);
     storage.status='ready';storage.restored=true;writable=true;
    }else storage.status='invalid';
   }
  }catch{storage.status='unavailable';}
 }

 function persist(force=false){
  const now=clock();
  if(pending||!writable||version===savedVersion||(!force&&now>=lastAttempt&&now-lastAttempt<persistEveryMs))return pending;
  lastAttempt=now;
  const generation=version;
  const saved=[...baselines.values()];
  const value={schema:SCHEMA,algorithm:ALGORITHM,checkpoint_version:2,...checkpoint(saved.at(-1)),
   retained:saved.slice(0,-1).map(checkpoint)};
  // Freeze the small checkpoint before handing it to the asynchronous host writer.
  const snapshot=JSON.parse(JSON.stringify(value));
  pending=Promise.resolve().then(()=>writeJson(file,snapshot)).then(()=>{
   savedVersion=generation;
   storage.status='ready';storage.saved_at=clock();
  }).catch(()=>{storage.status='error';}).finally(()=>{pending=null;});
  return pending;
 }

 function report(){
  const now=clock(),byFeature={};
  const baseline=active?.features;
  let fresh=0,ready=0,anomalous=0;
  for(const name of specs?.keys()||baseline?.keys()||[]){
   const row=baseline?.get(name),sample=latest.get(name);
   const current=sample&&now>=sample.at&&now-sample.at<=staleAfterMs;
   const trained=(row?.samples||0)>=CALIBRATION;
   if(current){fresh++;if(trained)ready++;if(sample.anomaly)anomalous++;}
   byFeature[name]={
    samples:row?.samples||0,baseline:trained?row.baseline:null,spread:trained?
     Math.max((specs?.get(name)||DEFAULT_SPEC).minSpread,Math.abs(row.baseline)*.025,Math.sqrt(row.variance)):null,
    last:current?sample.value:null,score:current?sample.score:null,observed_at:sample?.at??null,
    state:!current?'unobserved':sample.anomaly?'attention':trained?'tracking':'warming_up'
   };
  }
  return {schema:SCHEMA,algorithm:ALGORITHM,state:anomalous?'attention':ready?'learning':fresh?'warming_up':'unobserved',
   updated_at:updatedAt,trained_at:active?.trainedAt??null,provenance:{...origin},
   training_provenance:active&&active.trainedAt!==null?{...active.provenance}:{},
   baseline_scope:active?.scope??null,
   retained_baselines:[...baselines.values()].filter(context=>context!==active).map(context=>({
    scope:context.scope,provenance:{...context.provenance},trained_at:context.trainedAt,features:context.features.size})),
   features:byFeature,quality:{...quality,fresh,ready,anomalous_now:anomalous,expected:specs?.size??baseline?.size??0},
   storage:{...storage}};
 }

 function observe(features,context){
  if(closing)return report();
  const at=clock(),values=record(features)?features:{};
  origin=provenance(context);
  const key=baselineKey(origin);
  const switched=active?.key!==key;
  if(switched){
   active=baselines.get(key)||baselineContext(origin,false,key);
   latest.clear();
  }
  const baseline=active.features;
  const learn=context?.learn!==false;
  let accepted=0,rejected=0,anomalous=0,trained=false;
  for(const [name,value] of Object.entries(values)){
   const spec=specs?specs.get(name):DEFAULT_SPEC;
   if(!spec||!FEATURE.test(name)||!valid(value,spec)||(!baseline.has(name)&&baseline.size>=MAX_FEATURES)){
    rejected++;continue;
   }
   const row=baseline.get(name)||{samples:0,warmup:[]};
   const outcome=update(row,value,spec,learn);
   if(outcome.trained)baseline.set(name,row);
   latest.set(name,{at,value,score:outcome.score,anomaly:outcome.anomaly});
   accepted++;anomalous+=Number(outcome.anomaly);trained||=outcome.trained;
  }
  updatedAt=at;
  quality.observations++;quality.accepted+=accepted;quality.rejected+=rejected;quality.anomalous+=anomalous;
  quality.missing=(specs?.size??baseline.size)-accepted;
  if(trained)active.trainedAt=at;
  if(trained||(switched&&accepted>0&&baselines.has(active.key))){
   baselines.delete(active.key);
   baselines.set(active.key,active);
   if(baselines.size>MAX_BASELINES)baselines.delete(baselines.keys().next().value);
   version++;
  }
  persist();
  return report();
 }

 function close(){
  closing||=(async()=>{
   await pending;
   await persist(true);
   return report();
  })();
  return closing;
 }

 return {observe,report,close};
}

module.exports={createHealthModel};
