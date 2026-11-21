// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; createModuleOrder
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/module-order.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path');
const {MODULES}=require('./module-catalog.cjs');
const {atomicWriteJson}=require('./json-storage.cjs');
// 顶栏布局存在 Config/os-dock.json，和外观、资料放在一起。legacy 是旧版放在 Data 里的位置，只读。
function createModuleOrder(file,legacy){
 const ids=MODULES.map(s=>s.id),defaults=()=>[...ids];
 const valid=value=>Array.isArray(value)&&value.length===ids.length&&value[0]==='home'&&new Set(value).size===ids.length&&value.every(id=>ids.includes(id));
 const load=f=>{try{const value=JSON.parse(fs.readFileSync(f,'utf8'));return value&&typeof value==='object'?value:null;}catch{return null;}};
 // 用户拖过的顺序只认它自己的相对位置：后来新增的程序排到最后，不把用户的排列清掉。
 function read(){
  const saved=(load(file)||(legacy&&load(legacy))||{}).order;if(!Array.isArray(saved))return defaults();
  const kept=saved.filter((id,i)=>id!=='home'&&ids.includes(id)&&saved.indexOf(id)===i);
  return ['home',...kept,...ids.filter(id=>id!=='home'&&!kept.includes(id))];
 }
 return {read,write(order){if(!valid(order))throw Error('模块排序无效，首页须保持首位');fs.mkdirSync(path.dirname(file),{recursive:true});atomicWriteJson(file,{...load(file),version:1,order});return read();}};
}
module.exports={createModuleOrder};
