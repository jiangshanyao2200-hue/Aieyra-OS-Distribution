// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; path; os; fs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/managed-update-download.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {hash} = require('../src/managed-update-files.cjs');
const {downloadArtifact} = require('../src/managed-update-download.cjs');

for (const scenario of ['resume','range ignored','wrong range','corruption','cancel']) {
  test('official download: ' + scenario, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'os-download-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const bytes = Buffer.from('official file');
    const item = {name:'release.zip', size:bytes.length, sha256:hash(bytes)};
    const dest = path.join(dir,item.name);
    const issue = (request, active=()=>{}, progress=()=>{})=>downloadArtifact(item,dest,request,active,progress);
    let cancel = false;
    await assert.rejects(issue(async()=>new Response(bytes.subarray(0,4)),()=>{
      if(cancel)throw Error('cancelled');
    },received=>{cancel=scenario==='cancel' && received===4;}),scenario==='cancel'?/cancelled/:/中断/);
    assert.equal(fs.existsSync(dest),false);
    const request = async headers=>{
      assert.deepEqual(headers,{range:'bytes=4-','if-range':'"'+item.sha256+'"'});
      if(scenario==='range ignored')return new Response(bytes);
      const content = scenario==='corruption'?Buffer.alloc(bytes.length-4):bytes.subarray(4);
      return new Response(content,{status:206,headers:{
        etag:headers['if-range'],'content-range':'bytes '+(scenario==='wrong range'?3:4)+'-'+(bytes.length-1)+'/'+bytes.length
      }});
    };
    if (scenario==='wrong range'||scenario==='corruption') {
      await assert.rejects(issue(request),scenario==='corruption'?/摘要/:/范围/);
      assert.equal(fs.existsSync(dest),false);
    } else {
      await issue(request);
      assert.deepEqual(fs.readFileSync(dest),bytes);
      await issue(()=>assert.fail('verified download should be reused'));
    }
  });
}
