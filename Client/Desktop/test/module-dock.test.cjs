// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; registry; wait; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/module-dock.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const registry=require('../host/modules/registry.cjs');
const {createModuleDock,moduleEnvironment,DETACHABLE}=require('../host/module-dock.cjs');

const wait=async(predicate,ms=4000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return true;await new Promise(r=>setTimeout(r,25));}return false;};
function fixture(t,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-module-dock-'));
 const config=path.join(dir,'config.json');fs.writeFileSync(config,'{}');
 const calls=[],navigated=[],states=[],launched=[],modules=[];
 const control={release:async()=>{calls.push('control.release');return {ok:true};}};
 const launch=(file,args,options)=>{
  const child=new EventEmitter();child.unref=()=>{};launched.push({file,args,options});
  if(!extra.neverStarts){const id=args.find(a=>a.startsWith('--module=')).slice(9);setTimeout(async()=>{modules.push(await registry.publish({id,configDir:dir,handlers:{focus:p=>{calls.push('module.focus:'+(p.page||''));return {ok:true};}}}));},50);}
  return child;
 };
 const dock=createModuleDock({config,root:'C:/example',control,notify:s=>states.push(s),navigate:p=>navigated.push(p),launch,env:{PATH:'p',AIEYRA_OS_OWNER_TOKEN:'x',AIEYRA_WORKSPACE_BRIDGE:'{}',ELECTRON_RUN_AS_NODE:'1'},electronPath:'electron.exe',pollMs:60,startTimeout:extra.startTimeout||4000,quitTimeout:extra.quitTimeout||20000});
 t.after(async()=>{await dock.close();for(const m of modules)await m.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,config,dock,calls,navigated,states,launched,modules};
}

test('only Link can be detached as an independent window',()=>{
 assert.deepEqual(DETACHABLE,['link']);
});

test('module environment drops OS lifecycle proof, bridge secrets and preload/observer hooks',()=>{
 assert.deepEqual(moduleEnvironment({PATH:'p',AIEYRA_OS_OWNER_PORT:'1',AIEYRA_RUNTIME_TOKEN:'x',AIEYRA_WORKSPACE_BRIDGE:'{}',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require x',AIEYRA_EXPERIENCE_OBSERVER_TOKEN:'t',KEEP:'k'}),{PATH:'p',KEEP:'k'});
});

test('dragging Link out releases Control first, launches a detached module and hides the tab',async t=>{
 const f=fixture(t);await f.dock.start();
 const result=await f.dock.detach({module:'link',x:400,y:300,page:'link'});
 assert.equal(result.modules.link.detached,true);
 assert.equal(f.calls[0],'control.release');
 const {file,args,options}=f.launched[0];
 assert.equal(file,'electron.exe');assert.ok(args.includes('--module=link'));assert.ok(args.includes('--at=400,300'));assert.ok(args.includes('--config='+path.resolve(f.config)));
 assert.equal(options.detached,true);assert.equal(options.env.AIEYRA_OS_OWNER_TOKEN,undefined);assert.equal(options.env.AIEYRA_WORKSPACE_BRIDGE,undefined);
 assert.ok(f.states.some(s=>s.modules.link.detached));
 // 再次请求只聚焦已有窗口。
 await f.dock.detach({module:'link',page:'control'});
 assert.equal(f.launched.length,1);assert.ok(f.calls.includes('module.focus:control'));
 await assert.rejects(f.dock.detach({module:'editor'}),/不能独立打开/);
});

test('Workspace is no longer a detachable OS module',async t=>{
 const f=fixture(t);await f.dock.start();
 await assert.rejects(f.dock.detach({module:'workspace',x:500,y:320,page:'workspace'}),/不能独立打开/);
 assert.equal(f.launched.length,0);
});

test('docking Link back leaves the user on the page they are looking at',async t=>{
 const f=fixture(t);await f.dock.start();
 await f.dock.detach({module:'link',page:'link'});
 const os=await registry.connect(path.dirname(f.config),'os');
 assert.deepEqual(await os.request('dock',{module:'link',page:'control'}),{ok:true,page:'control'});
 os.close();
 await f.modules[0].close();
 assert.ok(await wait(()=>f.dock.state().modules.link.detached===false));
 assert.deepEqual(f.navigated,[]);
});

test('a Link started before OS is adopted without launching another one',async t=>{
 const f=fixture(t);
 f.modules.push(await registry.publish({id:'link',configDir:path.dirname(f.config),handlers:{}}));
 await f.dock.start();
 assert.equal(f.dock.state().modules.link.detached,true);
 assert.ok(f.calls.includes('control.release'));assert.equal(f.launched.length,0);
});

test('while Link is detached, Link pages focus the window; other pages stay in OS',async t=>{
 const f=fixture(t);await f.dock.start();
 const surface=f.dock.wrapSurface({navigate:p=>({ok:true,inner:p})});
 assert.equal(surface.navigate('link').inner,'link');
 await f.dock.detach({module:'link'});
 assert.equal(surface.navigate('control').embedded,false);
 assert.ok(await wait(()=>f.calls.includes('module.focus:control')));
 assert.equal(surface.navigate('home').inner,'home');
});

test('OS rejects requests for modules that are not detachable',async t=>{
 const f=fixture(t);await f.dock.start();
 const os=await registry.connect(path.dirname(f.config),'os');t.after(()=>os.close());
 await assert.rejects(os.request('release',{module:'editor'}),/不能独立打开/);
 await assert.rejects(os.request('workspaceReports'),/不支持/);
});

test('a failed Link launch keeps the tab and reports the error',async t=>{
 const f=fixture(t,{neverStarts:true,startTimeout:300});await f.dock.start();
 await assert.rejects(f.dock.detach({module:'link'}),/没有在/);
 assert.equal(f.dock.state().modules.link.detached,false);assert.match(f.dock.state().modules.link.error,/没有在/);
});

test('closing OS asks the detached Link to run standalone or to quit with it',async t=>{
 for(const [mode,method] of [['os','standalone'],['all','quit']]){
  const f=fixture(t);const seen=[];
  f.modules.push(await registry.publish({id:'link',configDir:path.dirname(f.config),handlers:{standalone:()=>{seen.push('standalone');return {ok:true};},quit:()=>{seen.push('quit');setTimeout(()=>f.modules[0].close(),60);return {ok:true};}}}));
  await f.dock.start();
  assert.equal(f.dock.detached('link'),true);
  await f.dock.exit(mode);
  assert.deepEqual(seen,[method]);
 }
 // 没有独立窗口时直接返回。
 const f=fixture(t);await f.dock.start();
 assert.equal((await f.dock.exit('all')).modules.link.detached,false);
});

test('acknowledged quit without actual module exit preserves OS and allows a later retry',async t=>{
 const f=fixture(t,{quitTimeout:100});let closing=false;
 f.modules.push(await registry.publish({id:'link',configDir:f.dir,handlers:{quit:()=>{if(closing)setTimeout(()=>f.modules[0].close(),25);return {ok:true};}}}));await f.dock.start();
 await assert.rejects(f.dock.exit('all'),/OS 已保留/);assert.equal(f.dock.detached('link'),true);closing=true;await f.dock.exit('all');assert.equal(f.dock.detached('link'),false);
});

test('dock command remains pending until the acknowledged Link actually releases its client',async t=>{
 const f=fixture(t);let accepted=false,settled=false;
 f.modules.push(await registry.publish({id:'link',configDir:f.dir,handlers:{dock:()=>{accepted=true;return {ok:true};}}}));await f.dock.start();
 const command=f.dock.command('link','dock').then(r=>{settled=true;return r;});
 assert.ok(await wait(()=>accepted));await new Promise(r=>setTimeout(r,60));
 assert.equal(settled,false,'acknowledgement is not completion');assert.equal(f.dock.detached('link'),true);
 await f.modules[0].close();assert.equal((await command).ok,true);assert.equal(f.dock.detached('link'),false);
});

test('acknowledged close that never releases fails boundedly and keeps actual detached state',async t=>{
 const f=fixture(t,{quitTimeout:100});
 f.modules.push(await registry.publish({id:'link',configDir:f.dir,handlers:{close:()=>({ok:true})}}));await f.dock.start();
 await assert.rejects(f.dock.command('link','close'),/尚未确认/);assert.equal(f.dock.detached('link'),true);
});
