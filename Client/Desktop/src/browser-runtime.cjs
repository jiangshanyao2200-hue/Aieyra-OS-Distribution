// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: runtime; fs; electron; dpapiPrefix; credentialStorage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/browser-runtime.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Client assembly: the Program owns browsing; Desktop supplies platform services.
const runtime=require('../../../Program/official/browser/service/browser-runtime.cjs');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const electron=require('electron');
const dpapiPrefix=Buffer.from('AieyraDPAPI1\0');
function credentialStorage(executable){
 if(process.platform!=='win32')return electron.safeStorage;
 const worker=executable||path.join(__dirname,'../../../Aieyra OS.exe');
 const available=()=>path.isAbsolute(worker)&&fs.existsSync(worker);
 const transform=(flag,input)=>{
  const result=spawnSync(worker,[flag],{input,timeout:3500,maxBuffer:128*1024,windowsHide:true,stdio:['pipe','pipe','ignore']});
  if(result.error||result.status!==0||!result.stdout?.length)throw Error('Windows credential storage failed');
  return result.stdout;
 };
 return {
  isEncryptionAvailable:available,
  encryptString:text=>Buffer.concat([dpapiPrefix,transform('-browser-secret-seal',Buffer.from(text,'utf8'))]),
  decryptString:bytes=>bytes.subarray(0,dpapiPrefix.length).equals(dpapiPrefix)?
   transform('-browser-secret-open',bytes.subarray(dpapiPrefix.length)).toString('utf8'):electron.safeStorage.decryptString(bytes),
 };
}
module.exports={createBrowserRuntime:options=>runtime.createBrowserRuntime({...options,
 electron,credentialStorage:credentialStorage(options.secretExecutable),presentation:require('./window-presentation.cjs'),
 connectSocks:options=>require('socks').SocksClient.createConnection(options),
 zoomService:require('./interface-zoom.cjs'),atomicWriteJson:require('../host/json-storage.cjs').atomicWriteJson,
 preloadDir:__dirname,legacyHomepage:require('../../../Contracts/official-services.json').os,
})};
