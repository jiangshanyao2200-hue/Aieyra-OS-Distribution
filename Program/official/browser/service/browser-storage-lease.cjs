'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Both desktop embedding and the standalone host share the same persistent store.
function acquireBrowserStorage(storage){
 const file=path.join(storage,'.browser-host.lock'),token=crypto.randomBytes(24).toString('hex');
 fs.mkdirSync(storage,{recursive:true});
 for(let attempt=0;attempt<2;attempt++){
  try{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}));}finally{fs.closeSync(fd);}return ()=>{try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file);}catch{}};}
  catch(error){if(error.code!=='EEXIST')throw error;let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Browser storage lock is unreadable; inspect the previous host before retrying');}
   if(!Number.isSafeInteger(previous?.pid)||previous.pid<1||typeof previous.token!=='string'||!/^[a-f0-9]{48}$/.test(previous.token))throw Error('Invalid browser storage owner');
   try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH'&&attempt===0){const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.pid===previous.pid&&current.token===previous.token)fs.unlinkSync(file);continue;}}
   throw Error('Browser profile store is in use by another Aieyra host');
  }
 }
 throw Error('Browser storage is unavailable');
}
module.exports={acquireBrowserStorage};
