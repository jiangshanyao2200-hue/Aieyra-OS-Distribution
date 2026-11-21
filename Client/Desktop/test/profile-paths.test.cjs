// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; profiles; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/profile-paths.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const profiles=require('../../../Contracts/storage/profile.cjs'),paths=require('../src/paths.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-userdata-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=path.join(root,'Config','config.json');fs.mkdirSync(path.dirname(config));fs.writeFileSync(config,'{}');
 fs.writeFileSync(path.join(root,profiles.marker),JSON.stringify({schema:profiles.schema,id:'0123456789abcdef0123456789abcdef',state:'ready',config:'Config/config.json'}));
 return {root,config};
}
test('declared profile routes actual attachments, settings and catalog writes to owned areas',async t=>{
 const {root,config}=fixture(t),cfg=require('../src/config.cjs');
 assert.equal(paths.dataDir(config),root);
 assert.equal(paths.privatePath(config,'memory'),path.join(root,'Memory'));
 assert.equal(paths.privatePath(config,'sessions'),path.join(root,'Sessions','standalone'));
 const original=cfg.load(config);cfg.save(config,{...original.settings,language:'en-US'},original.version);
 assert.equal(cfg.load(config).settings.language,'en-US');
 const cache=require('../src/catalog-store.cjs').createStore(config);cache.put('sample',{models:[]});
 assert(fs.statSync(path.join(root,'Config','catalog-cache')).isDirectory());
 const source=path.join(root,'sample.txt');fs.writeFileSync(source,'synthetic attachment');
 const store=require('../host/attachments.cjs').createAttachmentStore(config);await store.stage([source]);
 assert(fs.statSync(path.join(root,'Assets','attachments')).isDirectory());
 assert(!fs.existsSync(path.join(root,'Data')));
 assert(!fs.existsSync(path.join(root,'runtime')));
});
test('damaged and unfinished declarations reject real config saves without fallback writes',t=>{
 const {root,config}=fixture(t),file=path.join(root,profiles.marker),cfg=require('../src/config.cjs');
 const m=JSON.parse(fs.readFileSync(file));m.state='initializing';fs.writeFileSync(file,JSON.stringify(m));
 assert.throws(()=>cfg.save(config,{language:'en-US'}),/incomplete/);
 assert.equal(fs.readFileSync(config,'utf8'),'{}');
 assert(!fs.existsSync(config+'.write-lock'));
 fs.writeFileSync(file,'{');assert.throws(()=>paths.dataDir(config));
 assert.equal(fs.readFileSync(file,'utf8'),'{');
});
test('profile prompt scope preserves defaults and personal overrides without using installation overrides',t=>{
 const a=fixture(t),b=fixture(t),resources=require('../src/resources.cjs');
 const previous=process.env.AIEYRA_RESOURCE_ROOT;
 const install=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-defaults-'));
 t.after(()=>{if(previous===undefined)delete process.env.AIEYRA_RESOURCE_ROOT;else process.env.AIEYRA_RESOURCE_ROOT=previous;fs.rmSync(install,{recursive:true,force:true});});
 const write=(base,name,data)=>{const p=path.join(base,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);return p;};
 write(install,'Config/提示词索引.json',JSON.stringify({resources:[{file:'Matrix/manual.txt',path:'Tool/base/official/example/manual.txt',legacy_sha256:'0'.repeat(64)}]}));
 write(install,'Prompt/Matrix/manual.txt','installation customization');
 const official=write(install,'Tool/base/official/example/manual.txt','official default');
 process.env.AIEYRA_RESOURCE_ROOT=install;
 const release=profiles.use(a.config);t.after(release);
 assert.equal(paths.resolvePromptDir(''),path.join(a.root,'Overrides','Prompt','Matrix'));
 const role=path.join(paths.privatePath(a.config,'agents'),'Eyra','prompts');write(role,'边界.txt','');
 assert.equal(paths.resolvePromptDir(''),role);
 const layer=require('../host/prompts.cjs').createPromptEditor(role).list().layers.find(x=>x.id==='boundary');
 assert.equal(layer.source,'custom');assert.equal(layer.text,'');
 assert.equal(paths.resolvePromptDir(a.root),a.root);
 assert.equal(resources.promptPath('Matrix/manual.txt'),official);
 assert.throws(()=>profiles.use(b.config),/Another user-data profile/);
 const personal=write(a.root,'Overrides/Prompt/Matrix/manual.txt','personal customization');
 assert.equal(resources.promptPath('Matrix/manual.txt'),personal);
 assert.equal(resources.prompt('Matrix/manual.txt'),'personal customization');
 fs.writeFileSync(path.join(a.root,profiles.marker),'changed after binding');assert.equal(paths.dataDir(a.config),a.root);
 release();release();assert.equal(profiles.active(),null);
 const second=profiles.use(b.config);assert.equal(resources.promptPath('Matrix/manual.txt'),official);second();
});
