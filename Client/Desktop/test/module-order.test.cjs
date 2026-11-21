// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-order.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createModuleOrder}=require('../host/module-order.cjs');
test('retiring the theme app preserves the relative order and stored choices of other programs',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retired-theme-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'order.json');const original=JSON.stringify({order:['home','market','servers','browser','link','coding','contacts','workspace','settings'],pinned:['module:market','module:browser']});fs.writeFileSync(file,original);
 assert.deepEqual(createModuleOrder(file).read(),['home','servers','browser','link','coding','contacts','workspace','settings','center']);assert.equal(fs.readFileSync(file,'utf8'),original,'reading must not destroy old preferences');
});
test('module order persists across readers and rejects duplicates or moving Home',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'module-order-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'order.json'),store=createModuleOrder(file),order=['home','link','browser','contacts','settings','workspace','servers','coding','center'];
 assert.deepEqual(store.write(order),order);assert.deepEqual(createModuleOrder(file).read(),order);
 for(const invalid of [['browser','home','link','settings','contacts','servers','workspace','coding'],['home','link','link','settings','contacts','servers','workspace','coding'],['home','unknown']])assert.throws(()=>store.write(invalid),/排序无效/);
 assert.deepEqual(store.read(),order);fs.writeFileSync(file,'broken');assert.deepEqual(store.read(),['home','coding','browser','contacts','link','servers','workspace','center','settings']);assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
test('新增程序排到用户自定义顺序的后面，旧版位置只读，布局和钉选共用一个文件',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'module-order-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'os-dock.json'),legacy=path.join(dir,'module-order.json');
 fs.writeFileSync(legacy,JSON.stringify({version:1,order:['home','link','browser','settings','contacts']}));
 const store=createModuleOrder(file,legacy);assert.deepEqual(store.read(),['home','link','browser','settings','contacts','coding','servers','workspace','center']);
 fs.writeFileSync(file,JSON.stringify({pinned:['module:servers']}));
 const order=['home','link','browser','settings','contacts','servers','workspace','coding','center'];store.write(order);
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(saved.order,order);assert.deepEqual(saved.pinned,['module:servers'],'写排序不能丢钉选');
 assert.equal(JSON.parse(fs.readFileSync(legacy,'utf8')).order[1],'link');
});
