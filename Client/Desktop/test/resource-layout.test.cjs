// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; resources; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/resource-layout.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const resources=require('../src/resources.cjs');

function fixture(t){
 const defaults=resources.defaults();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-resources-'));
 const previous=process.env.AIEYRA_RESOURCE_ROOT;
 process.env.AIEYRA_RESOURCE_ROOT=root;
 t.after(()=>{if(previous===undefined)delete process.env.AIEYRA_RESOURCE_ROOT;else process.env.AIEYRA_RESOURCE_ROOT=previous;fs.rmSync(root,{recursive:true,force:true});});
 fs.mkdirSync(path.join(root,'Config'));
 fs.writeFileSync(path.join(root,'Config','默认设置.json'),JSON.stringify(defaults));
 const write=(name,value)=>fs.writeFileSync(path.join(root,'Config',name),JSON.stringify(value));
 return {root,write};
}

test('external settings reload, preserve caller isolation and reject corrupt resources',t=>{
 const {root,write}=fixture(t);
 write('默认设置.json',{model:'first',nested:{value:1}});
 const first=resources.defaults();first.nested.value=99;
 assert.equal(resources.defaults().nested.value,1);
 write('默认设置.json',{model:'changed-longer',nested:{value:2}});
 assert.equal(resources.defaults().model,'changed-longer');
 const file=path.join(root,'Config','默认设置.json');
 fs.writeFileSync(file,'{broken');assert.throws(()=>resources.defaults());
 fs.writeFileSync(file,Buffer.from([123,34,120,34,58,34,255,34,125]));assert.throws(()=>resources.defaults(),/encoded data|encoding/i);
 fs.unlinkSync(file);assert.throws(()=>resources.defaults(),/ENOENT/);
});

test('portable config keeps attachments and catalog cache exclusively in Data',async t=>{
 const {root,write}=fixture(t),paths=require('../src/paths.cjs');
 const config=path.join(root,'Config','config.json');write('config.json',{});
 assert.equal(paths.resolveConfigPath(),config);
 assert.equal(paths.dataDir(config),path.join(root,'Data'));
 const store=require('../src/catalog-store.cjs').createStore(config);
 store.put('fixture',{models:[{id:'synthetic-model'}]});
 assert.equal(store.get('fixture').models[0].id,'synthetic-model');
 assert(fs.existsSync(path.join(root,'Data','config.json.catalog-cache')));
 const source=path.join(root,'attachment.txt');fs.writeFileSync(source,'fixture attachment');
 const attachments=require('../host/attachments.cjs').createAttachmentStore(config);
 await attachments.stage([source]);
 assert(fs.existsSync(path.join(root,'Data','runtime','attachments')));
 assert(!fs.existsSync(path.join(root,'Config','runtime')));
 assert(!fs.existsSync(config+'.catalog-cache'));
 assert.equal(paths.dataDir(path.join(root,'legacy.json')),root);
});

test('model metadata and prompt changes are read without restarting the module',t=>{
 const {root,write}=fixture(t),caps=require('../src/model-capabilities.cjs');
 write('模型资料.json',{providers:{fixture:{model:{context:100}}}});
 assert.equal(caps.bundled.providers.fixture.model.context,100);
 write('模型资料.json',{providers:{fixture:{model:{context:2000}}}});
 assert.equal(caps.bundled.providers.fixture.model.context,2000);
 fs.mkdirSync(path.join(root,'Prompt','Matrix'),{recursive:true});
 const file=path.join(root,'Prompt','Matrix','fixture.txt');fs.writeFileSync(file,'initial');
 assert.equal(resources.prompt('Matrix/fixture.txt'),'initial');
 fs.writeFileSync(file,'changed');assert.equal(resources.prompt('Matrix/fixture.txt'),'changed');
 assert.throws(()=>resources.prompt('../escape.txt'),/路径无效/);
});
