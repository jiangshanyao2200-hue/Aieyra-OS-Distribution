// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; zoom
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/interface-zoom.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const zoom=require('../src/interface-zoom.cjs');
test('overall zoom has fixed bounds and adapts without mutating preference',()=>{
 assert.equal(zoom.clamp(NaN),1);assert.equal(zoom.clamp(Infinity),1);assert.equal(zoom.clamp(-4),.8);assert.equal(zoom.clamp(9),1.75);
 assert.equal(zoom.fit(1.75,1440,900),1.75);assert.equal(zoom.fit(1.75,720,480),1.5);assert.equal(zoom.fit(1.75,390,720),1.05);
 assert.equal(zoom.fit(.8,1440,900),.8);
});
test('zoom persistence preserves other preferences and leaves API config untouched',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-zoom-'));
 try{
  const config=path.join(dir,'config.json'),file=zoom.preferenceFile(config);fs.writeFileSync(config,'{"fixture":"unchanged"}');const before=fs.readFileSync(config);
  assert.equal(zoom.readPreference(file),1);fs.writeFileSync(file,'{"window":"keep"}');zoom.writePreference(file,1.35);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),{window:'keep',zoom:1.35});assert.equal(zoom.readPreference(file),1.35);assert.deepEqual(fs.readFileSync(config),before);
  fs.writeFileSync(file,'{broken');assert.throws(()=>zoom.writePreference(file,1.2));assert.equal(fs.readFileSync(file,'utf8'),'{broken');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('interface zoom leaves Ctrl+wheel to surfaces that zoom themselves',async()=>{
 const vm=require('node:vm'),sent=[],handlers={},inside={closest:selector=>selector==='[data-local-zoom]'?{}:null},outside={closest:()=>null};
 const ipcRenderer={invoke:async()=>true,send:(channel,direction)=>sent.push(direction)};
 const window={addEventListener:(type,handler)=>{handlers[type]=handler;}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/interface-zoom-preload.cjs'),'utf8'),{require:()=>({ipcRenderer}),window});
 await new Promise(resolve=>setImmediate(resolve));
 const wheel=target=>{const event={isTrusted:true,ctrlKey:true,deltaY:-100,target,prevented:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};handlers.wheel(event);return event;};
 assert.equal(wheel(inside).prevented,false);assert.deepEqual(sent,[]);
 assert.equal(wheel(outside).prevented,true);assert.deepEqual(sent,['in']);
});

test('observing the same saved preference restores surfaces whose native zoom drifted',()=>{
 const vm=require('node:vm'),{EventEmitter}=require('node:events');let poll,level=1;
 const app=new EventEmitter(),wc=new EventEmitter(),win=new EventEmitter();
 Object.assign(wc,{id:1,session:{registerPreloadScript(){}},isDestroyed:()=>false,getZoomFactor:()=>level,setZoomFactor:v=>level=v,setZoomMode(){},setVisualZoomLevelLimits:async()=>{},send(){}});
 Object.assign(win,{id:1,webContents:wc,isDestroyed:()=>false,getContentSize:()=>[960,701]});
 const sandbox={module:{exports:{}},__dirname:path.dirname(require.resolve('../src/interface-zoom.cjs')),setTimeout,clearTimeout,require(name){
  if(name==='node:fs')return {readFileSync:()=>'{"zoom":1.25}',watchFile(_file,_options,fn){poll=fn;},unwatchFile(){}};
  if(name==='electron')return {app,ipcMain:{handle(){},on(){}}};
  if(name==='./config.cjs')return {version:()=> 'saved-version'};
  if(name==='./settings-observation.cjs')return {acknowledge(){}};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/interface-zoom.cjs'),'utf8'),sandbox);
 const controller=sandbox.module.exports.forConfig('r24-owned-zoom/config.json');controller.attach(win,{minimum:[720,480]});
 assert.equal(level,1.25);level=1;poll();assert.equal(level,1.25);assert.equal(controller.value,1.25);app.emit('before-quit');
});
