// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/update-integrity.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {inspect,createIntegrity}=require('../src/update-integrity.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-integrity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 const pair=crypto.generateKeyPairSync('ed25519');put('Config/release.pub.pem',pair.publicKey.export({type:'spki',format:'pem'}));
 const rows={'Core/a.go':'package core','Theme/runtime/a.mjs':'export const theme=1;'};for(const [name,value]of Object.entries(rows))put(name,value);
 const baseline={schema:'aieyra-os-baseline-v1',product:'aieyra-os',version:'0.2.85',sequence:85,files:Object.fromEntries(Object.entries(rows).map(([name,value])=>[name,{size:Buffer.byteLength(value),sha256:crypto.createHash('sha256').update(value).digest('hex')}]))};
 const payload=Buffer.from(JSON.stringify(baseline));put('Config/official-baseline.json',JSON.stringify({algorithm:'Ed25519',payload:payload.toString('base64'),signature:crypto.sign(null,payload,pair.privateKey).toString('base64')}));
 return {root,put};
}
test('integrity compares signed file bytes, missing and added sources, and distinguishes unavailable baseline',async t=>{
 const f=fixture(t);let state=inspect(f.root);assert.equal(state.consistent,2);assert.equal(state.different,0);
 f.put('Core/a.go','changed');f.put('Core/added.go','new');fs.unlinkSync(path.join(f.root,'Theme/runtime/a.mjs'));
 f.put('Data/private.txt','never inventoried');state=inspect(f.root);assert.equal(state.different,2);assert.equal(state.checkedFiles,3);assert.equal(state.modules.find(r=>r.name==='Core').added,1);
 const service=createIntegrity({root:f.root});t.after(()=>service.close());const first=service.check();assert.equal(service.status().phase,'checking');assert.equal(service.check(),first);state=await first;assert.equal(state.different,2);
 fs.unlinkSync(path.join(f.root,'Config/official-baseline.json'));assert.equal(inspect(f.root).phase,'unavailable');
});
test('modified or malformed signed baselines cannot report a clean installation',t=>{
 const f=fixture(t),file=path.join(f.root,'Config/official-baseline.json'),value=JSON.parse(fs.readFileSync(file));value.payload=Buffer.from('{}').toString('base64');f.put('Config/official-baseline.json',JSON.stringify(value));assert.throws(()=>inspect(f.root),/签名/);
});
