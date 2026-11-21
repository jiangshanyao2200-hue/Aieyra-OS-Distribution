// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/first-run.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ensureDesktopShortcut,installationSettings}=require('../host/first-run.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'portable-first-use-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const data=path.join(root,'Data'),config=path.join(data,'Config','config.json'),desktop=path.join(root,'Desktop');
 fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'{}');
 fs.writeFileSync(path.join(data,'.aieyra-userdata.json'),JSON.stringify({schema:'aieyra.user-data/1',id:'a'.repeat(32),state:'ready',config:'Config/config.json'}));
 const shell={readShortcutLink:file=>JSON.parse(fs.readFileSync(file)),writeShortcutLink(file,_mode,value){fs.writeFileSync(file,JSON.stringify(value),{flag:'wx'});return true;}};
 return {root,config,desktop,shell};
}
test('first successful launch creates a local shortcut once and respects later removal',t=>{
 const f=fixture(t),created=ensureDesktopShortcut(f);
 assert.equal(created.status,'created');assert.equal(f.shell.readShortcutLink(created.shortcut).target,path.join(f.root,'Aieyra OS.exe'));
 fs.unlinkSync(created.shortcut);assert.deepEqual(ensureDesktopShortcut(f),created);assert.equal(fs.existsSync(created.shortcut),false);
});
test('another installation shortcut and development installation are preserved',t=>{
 const f=fixture(t);fs.mkdirSync(f.desktop);const shortcut=path.join(f.desktop,'Aieyra OS.lnk'),old=JSON.stringify({target:path.join(f.root,'another','Aieyra OS.exe')});fs.writeFileSync(shortcut,old);
 assert.equal(ensureDesktopShortcut(f).status,'preserved-other');assert.equal(fs.readFileSync(shortcut,'utf8'),old);
 fs.writeFileSync(path.join(path.dirname(f.config),'installation.json'),JSON.stringify({schema:1,role:'development'}));
 assert.equal(ensureDesktopShortcut(f).status,'development');assert.equal(fs.readFileSync(shortcut,'utf8'),old);
});
test('first run reuses the installed suite shortcut',t=>{
 const f=fixture(t),directory=path.join(f.desktop,'Aieyra OS'),shortcut=path.join(directory,'Aieyra OS.lnk');
 fs.mkdirSync(directory,{recursive:true});
 f.shell.writeShortcutLink(shortcut,'create',{target:path.join(f.root,'Aieyra OS.exe')});
 assert.equal(ensureDesktopShortcut(f).shortcut,shortcut);
 assert.equal(fs.existsSync(path.join(f.desktop,'Aieyra OS.lnk')),false);
});
test('only the receiving installation takes the user role from a migrated development profile',t=>{
 const {root,config}=fixture(t);
 const dataRoot=path.dirname(path.dirname(config)),profileId='a'.repeat(32),former=path.join(root,'former');
 const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
 const roleFile=path.join(path.dirname(config),'installation.json');
 save(roleFile,{schema:1,role:'development'});
 const binding=path.join(root,'.aieyra-installation.json');
 save(binding,{schema:1,profileId,dataRoot});
 assert.equal(installationSettings(config,root).role,'development');
 save(path.join(dataRoot,'.aieyra-migration-receipt.json'),{schema:1,id:'c'.repeat(32),state:'complete',profile_id:profileId,
  source_config:path.join(former,'Config','config.json'),source_root:former,destination:dataRoot,inventory_sha:'d'.repeat(64)});
 assert.equal(installationSettings(config,root).role,'user');
 assert.equal(installationSettings(config,path.join(root,'checkout')).role,'development');
 save(binding,{schema:1,profileId:'b'.repeat(32),dataRoot});
 assert.equal(installationSettings(config,root).role,'development');
 assert.equal(JSON.parse(fs.readFileSync(roleFile)).role,'development');
});
test('failed shortcut write remains retryable and does not mark setup complete',t=>{
 const f=fixture(t),write=f.shell.writeShortcutLink;f.shell.writeShortcutLink=()=>false;
 assert.throws(()=>ensureDesktopShortcut(f),/未确认/);assert.equal(fs.existsSync(path.join(path.dirname(f.config),'windows-first-run.json')),false);
 f.shell.writeShortcutLink=write;assert.equal(ensureDesktopShortcut(f).status,'created');
});
