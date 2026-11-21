/* @file-map:start
文件: link/desktop/activity-store.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/onboarding.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  ActivityStore | class
  ActivityStore.constructor | method
  ActivityStore.read | method
  ActivityStore.save | method
  ActivityStore.migrate | method
  ActivityStore.append | method
  ActivityStore.page | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
/* @chain-region ActivityStore */ class ActivityStore{
 /* @chain-region ActivityStore.constructor | calls: test, Error, path.join */ constructor(directory,account,storage){if(!/^[a-f0-9]{32}$/.test(account))throw Error('invalid_account');this.root=path.join(directory,'activity',account);this.storage=storage;}
 /* @chain-region ActivityStore.read | calls: path.join, fs.statSync, JSON.parse, storage.decryptString, fs.readFileSync */ read(name,fallback){try{const file=path.join(this.root,name+'.enc');if(fs.statSync(file).size>64000)return fallback;return JSON.parse(this.storage.decryptString(fs.readFileSync(file)));}catch{return fallback;}}
 /* @chain-region ActivityStore.save | calls: fs.mkdirSync, path.join, fs.writeFileSync, storage.encryptString, JSON.stringify, fs.renameSync */ save(name,value){fs.mkdirSync(this.root,{recursive:true});const file=path.join(this.root,name+'.enc'),tmp=file+'.tmp';fs.writeFileSync(tmp,this.storage.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(tmp,file);}
 /* @chain-region ActivityStore.migrate | calls: read, append, events.at, events.slice */ migrate(events){if(events.length&&this.read('index',{next:1}).next===1)this.append(events.at(-1),events.slice(0,-1));}
 /* @chain-region ActivityStore.append | calls: read, Math.floor, String, page.push, save, page.slice, fs.unlinkSync, path.join */ append(event,initial=[]){
  const index=this.read('index',{next:1});
  const rows=index.next===1?[...initial,event]:[event];
  for(const value of rows){const seq=index.next++,block=Math.floor((seq-1)/20),page=this.read(String(block),[]);page.push({...value,seq});this.save(String(block),page.slice(-20));}
  this.save('index',index);
  const oldBlock=Math.floor((index.next-1)/20)-13;if(oldBlock>=0)try{fs.unlinkSync(path.join(this.root,oldBlock+'.enc'));}catch{}
 }
 /* @chain-region ActivityStore.page | calls: read, Number.isSafeInteger, Error, Math.max, Math.floor, String, reverse, items.push … */ page(before=0){
  const index=this.read('index',{next:1});
  if(!Number.isSafeInteger(before)||before<0||before>index.next)throw Error('invalid_activity_cursor');
  let seq=(before||index.next)-1;const minimum=Math.max(1,index.next-240),items=[];
  while(seq>=minimum&&items.length<30){const block=Math.floor((seq-1)/20),rows=this.read(String(block),[]);
   for(const row of [...rows].reverse())if(row.seq<=seq&&row.seq>=minimum&&items.length<30)items.push({seq:row.seq,action:row.action,last_at:row.created});
   seq=block*20;
  }
  return {items,next_before:items.length===30&&items.at(-1).seq>minimum?items.at(-1).seq:null};
 }
}
module.exports={ActivityStore};
