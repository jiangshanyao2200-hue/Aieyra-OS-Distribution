// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; os; cpuTicks; createCenterTelemetry
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/center-telemetry.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const fs=require('node:fs/promises');
const os=require('node:os');

function cpuTicks(){
 let busy=0,total=0;
 const cores=os.cpus();
 for(const {times} of cores){
  const ticks=times.user+times.nice+times.sys+times.irq;
  busy+=ticks;total+=ticks+times.idle;
 }
 return {cores,busy,total};
}

function createCenterTelemetry({app,screen,dataDir}){
 let previous=cpuTicks(),gpu=null;
 // The Electron report also contains driver and host metadata. Keep the device projection small.
 void Promise.resolve().then(()=>app.getGPUInfo('basic')).then(info=>{
  gpu=Array.isArray(info?.gpuDevice)?info.gpuDevice.slice(0,16).map(device=>({
   vendorId:device.vendorId??null,deviceId:device.deviceId??null,
   name:typeof device.deviceString==='string'?device.deviceString.slice(0,120):null,
   active:device.active===true,
  })):null;
 }).catch(()=>{});
 return async function sampleHost(){
  const observedAt=new Date().toISOString(),current=cpuTicks();
  const elapsed=current.total-previous.total,used=current.busy-previous.busy;
  const cpuPercent=elapsed>0&&used>=0&&used<=elapsed?100*used/elapsed:null;
  previous=current;
  const totalBytes=os.totalmem(),freeBytes=os.freemem();
  const processes=app.getAppMetrics();
  const disk=await fs.statfs(dataDir).then(value=>({
   totalBytes:value.blocks*value.bsize,
   availableBytes:value.bavail*value.bsize,
  }),()=>null);
  return {observedAt,source:'node:os + Electron app/screen + statfs',
   operatingSystem:{platform:os.platform(),version:os.version(),release:os.release(),architecture:os.arch(),uptimeSeconds:os.uptime()},
   hardware:{cpu:{model:current.cores[0]?.model||null,logicalCores:current.cores.length,availableParallelism:os.availableParallelism(),utilizationPercent:cpuPercent},
    memory:{totalBytes,freeBytes,usedPercent:totalBytes>0?100*(1-freeBytes/totalBytes):null},disk,gpu,
    displays:screen.getAllDisplays().map(display=>({width:display.size.width,height:display.size.height,
     scale:display.scaleFactor,refreshHz:Number.isFinite(display.displayFrequency)&&display.displayFrequency>0?display.displayFrequency:null}))},
   processCount:processes.length,processes:processes.slice(0,128).map(process=>({pid:process.pid,type:process.type,
    cpuPercent:Number.isFinite(process.cpu?.percentCPUUsage)?process.cpu.percentCPUUsage:null,
    residentBytes:Number.isFinite(process.memory?.workingSetSize)?1024*process.memory.workingSetSize:null}))};
 };
}

module.exports={createCenterTelemetry};
