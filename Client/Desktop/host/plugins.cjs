// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; officialPrograms; officialTools; MODULE_SUMMARY; createPlugins
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/plugins.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 应用：模块和从中心安装的程序都走这里。负责顶栏显示哪些，并把“本机有什么”写给 Eyra。
// 内置程序的页面和窗口归 module-catalog 和 extensions，这里不开窗口。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const officialPrograms=require('../../../Program/official/catalog.cjs');
const officialTools=require('../../../Tool/catalog.json');
// 模块自带的能力由这里说明；module-catalog.json 新增模块时缺说明会被测试拦下。
const MODULE_SUMMARY=Object.freeze({
 home:['主对话','你和用户说话的地方'],
 contacts:['联系人与群聊','用户的联系人、Agent 和群组','agents 工具'],
 settings:['设置','模型、外观、提示词等全部设置','toolbox 的 settings 工具'],
 ...Object.fromEntries(officialPrograms.programs.map(p=>[p.id,[p.title,p.summary,'software_api program describe/open/snapshot/invoke; arguments.id='+p.packageID]])),
});
function createPlugins({dataDir,configFile,modules,resources,modPackages}){
 const file=configFile||path.join(require('../../../Contracts/storage/paths.cjs').root(dataDir,'runtime'),'os-dock.json'),legacy=path.join(require('../../../Contracts/storage/paths.cjs').root(dataDir,'runtime'),'os-apps.json'),capabilities=path.join(require('../../../Contracts/storage/paths.cjs').root(dataDir,'runtime'),'capabilities.json');
 const load=f=>{try{const v=JSON.parse(fs.readFileSync(f,'utf8'));return v&&typeof v==='object'?v:null;}catch{return null;}};
 // 0.2.84 的服务器和市场还不是模块，存的是不带前缀的编号。
 const moved=list=>Array.isArray(list)?list.map(id=>['servers','market'].includes(id)?'module:'+id:id):[];
 const read=()=>{const own=load(file);if(own?.pinned||own?.hidden)return own;const old=load(legacy);return {...own,...(old?{pinned:moved(old.pinned),hidden:moved(old.hidden)}:{})};};
 const atomic=(f,value)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,1));fs.renameSync(tmp,f);};
 let prefs=read();const listeners=new Set();
 async function installed(){try{return (await resources.call({action:'center_local'})).items||[];}catch{return [];}}
 const pinnedOf=(id,fallback)=>prefs.hidden?.includes(id)?false:prefs.pinned?.includes(id)?true:fallback;
 async function list(){
  const local=modPackages?((await modPackages.call({action:'mod_list'})).items||[]):null;
  const available=m=>!m.packageID||!local||local.some(r=>r.enabled&&r.manifest.id===m.packageID&&r.origin==='official');
  const center=(await installed()).filter(r=>r.manifest?.id!=='aieyra.notes'&&r.manifest?.kind==='program'&&!r.migrationRequired&&!(local||[]).some(p=>p.manifest.id===r.manifest.id)).map(r=>({id:'center:'+r.manifest.id,resource:r.manifest.id,title:r.manifest.name,summary:r.manifest.summary||'',icon:'program',kind:'program',pinned:pinnedOf('center:'+r.manifest.id,false)}));
  const imported=(local||[]).filter(r=>r.manifest.id!=='aieyra.notes'&&r.enabled&&r.manifest.kind==='program'&&!officialPrograms.find(r.manifest.id)).map(r=>({id:'mod:'+r.manifest.id,resource:r.manifest.id,title:r.manifest.name,summary:r.manifest.summary,icon:'program',kind:'program',pinned:pinnedOf('mod:'+r.manifest.id,pinnedOf('center:'+r.manifest.id,false))}));
  const mods=modules.filter(m=>m.id!=='home'&&available(m)).map(m=>({id:'module:'+m.id,module:m.id,title:MODULE_SUMMARY[m.id]?.[0]||m.title,summary:MODULE_SUMMARY[m.id]?.[1]||'',icon:m.id,kind:'module',pinned:pinnedOf('module:'+m.id,true)}));
  return {ok:true,apps:[...mods,...center,...imported]};
 }
 // 这份清单是 Eyra 的“身体感”：宿主有变化就重写，Core 每次请求读取。
 async function writeCapabilities(){
  const items=[...modules.filter(m=>m.id!=='home'&&(!m.packageID||!modPackages)).map(m=>({name:MODULE_SUMMARY[m.id]?.[0]||m.title,kind:'应用',summary:MODULE_SUMMARY[m.id]?.[1]||'',use:MODULE_SUMMARY[m.id]?.[2]||''})),
   ...(await installed()).filter(r=>r.manifest?.kind!=='program').map(r=>({name:r.manifest?.name||r.manifest?.id,kind:({program:'已装程序',tool:'已装工具',drawing:'已装绘图',prompt:'已装提示词',theme:'已装主题'})[r.manifest?.kind]||'资源',summary:r.manifest?.summary||'',use:r.manifest?.kind==='tool'?'toolbox 工具 custom:'+r.manifest?.id:r.manifest?.kind==='program'?'community center_open':''}))];
  if(modPackages){const local=await modPackages.call({action:'mod_list'});for(const r of (local.items||[]).filter(r=>r.manifest.id!=='aieyra.notes'&&r.enabled))items.push({name:r.manifest.name,kind:r.manifest.kind,summary:r.manifest.summary,use:officialTools.some(t=>t.id===r.manifest.id)&&r.origin==='official'?'使用原工具入口 '+officialTools.find(t=>t.id===r.manifest.id).aliases.join(' / '):['tool','toolbox','workbox'].includes(r.manifest.kind)?'toolbox open/call; name=mod:'+r.manifest.id+'@'+r.digest:r.manifest.kind==='program'?'software_api program describe/open/snapshot/invoke; arguments.id='+r.manifest.id:r.manifest.kind==='theme'?'community mod_theme_apply; id='+r.manifest.id:''});}
  atomic(capabilities,{updated_at:new Date().toISOString(),items});
 }
 const broadcast=()=>{for(const fn of listeners)try{fn();}catch{}};
 const changed=()=>{void writeCapabilities().catch(()=>{});broadcast();};
 async function call(p={}){
  if(p.action==='list')return list();
  if(p.action==='pin'){
   if(typeof p.id!=='string'||typeof p.pinned!=='boolean')throw Error('参数无效');
   const pinned=new Set(prefs.pinned||[]),hidden=new Set(prefs.hidden||[]);
   if(p.pinned){pinned.add(p.id);hidden.delete(p.id);}else{hidden.add(p.id);pinned.delete(p.id);}
   prefs={...load(file),pinned:[...pinned],hidden:[...hidden]};atomic(file,prefs);broadcast();return list();
  }
  if(p.action==='open'){
   if(String(p.id).startsWith('mod:')&&modPackages)return modPackages.call({action:'mod_open',id:String(p.id).slice(4)});
   if(String(p.id).startsWith('center:'))return resources.call({action:'center_open',id:String(p.id).slice(7)});
   throw Error('未知的应用');
  }
  throw Error('未知的应用操作');
 }
 return {call,changed,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},close(){listeners.clear();}};
}
module.exports={createPlugins,MODULE_SUMMARY};
