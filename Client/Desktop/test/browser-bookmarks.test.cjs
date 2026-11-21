// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-bookmarks.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createBookmarks}=require('../src/browser-bookmarks.cjs');
test('bookmarks persist per profile, deduplicate addresses and remove only requested entry',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-bookmarks-'));try{let store=createBookmarks(dir);assert.deepEqual(store.list('first'),[]);store.toggle('first','https://example.test','中文收藏');store.toggle('second','https://second.test','另一个配置');store=createBookmarks(dir);assert.equal(store.list('first')[0].title,'中文收藏');assert.equal(store.list('second').length,1);store.toggle('first','https://example.test/','Same URL');assert.equal(store.list('first').length,0);store.toggle('first','https://example.test/login','登录');const id=store.list('first')[0].id;store.remove('first',id);assert.equal(store.list('first').length,0);assert.equal(store.list('second').length,1);for(const address of ['javascript:alert(1)','file:///C:/data','https://user:secret@example.test/'])assert.throws(()=>store.toggle('first',address,'invalid'));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('damaged bookmarks are preserved and never silently overwritten',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-bookmarks-bad-'));try{const file=path.join(dir,'bookmarks.json');fs.writeFileSync(file,'damaged');assert.throws(()=>createBookmarks(dir),/preserved/);assert.equal(fs.readFileSync(file,'utf8'),'damaged');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('saved bookmarks validate links and rows before exposing them to browser chrome',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-bookmarks-saved-'));try{const file=path.join(dir,'bookmarks.json');for(const profiles of [[],{default:[{id:'a'.repeat(16),title:'bad',url:'javascript:alert(1)'}]},{default:[null]}]){const raw=JSON.stringify({version:1,profiles});fs.writeFileSync(file,raw);assert.throws(()=>createBookmarks(dir),/preserved/);assert.equal(fs.readFileSync(file,'utf8'),raw);}}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('legacy uppercase identity keeps bookmarks when profile IDs are normalized',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-bookmarks-case-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'bookmarks.json'),JSON.stringify({version:1,profiles:{WORK:[{id:'a'.repeat(16),title:'saved',url:'https://example.test/'}]}}));const store=createBookmarks(dir);assert.equal(store.list('work')[0].title,'saved');store.toggle('work','https://example.test/new','new');assert.equal(createBookmarks(dir).list('WORK').length,2);});
