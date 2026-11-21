// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/composer-mention.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('mentions use a short unique name, else the 图N / 文件N label Core gives the model',async()=>{
 const {mentionToken}=await import('../ui/composer-mention.mjs');
 const list=[
  {name:'A.png',kind:'image',sha256:'1'},
  {name:'生成图片 · gpt-image · 2026-10-26 12-00-00.png',kind:'image',sha256:'2'},
  {name:'截图 12-30-01.png',kind:'image',sha256:'3'},
  {name:'需求.md',kind:'file',sha256:'4'},
  {name:'notes from the meeting.txt',kind:'file',sha256:'5'},
  {name:'A.jpg',kind:'image',sha256:'6'},
 ];
 assert.deepEqual(list.map(a=>mentionToken(a,list)),['图1','图2','图3','需求','文件2','图4']);
 assert.equal(mentionToken(list[0],[list[0]]),'A');
});

test('labels stay with their attachment when another one is removed',async()=>{
 const {validateAttachments}=await import('../ui/attachments.mjs');
 const {mentionToken}=await import('../ui/composer-mention.mjs');
 const sha=c=>c.repeat(64),img=(n,c)=>({name:n,asset:'x',sha256:sha(c),bytes:10,kind:'image',mime:'image/png'});
 let list=validateAttachments([img('截图 1.png','a'),img('截图 2.png','b'),{name:'a.md',asset:'x',sha256:sha('c'),bytes:3,kind:'file',mime:'application/octet-stream'}]);
 assert.deepEqual(list.map(a=>a.label),['图1','图2','文件1']);
 list=validateAttachments([...list.slice(1),img('截图 3.png','d')]);
 assert.deepEqual(list.map(a=>a.label),['图2','文件1','图3']);
 assert.equal(mentionToken(list[0],list),'图2');
 assert.deepEqual(validateAttachments(JSON.parse(JSON.stringify(list))).map(a=>a.label),['图2','文件1','图3']);
 assert.throws(()=>validateAttachments([{...list[0],label:'文件9'}]));
 assert.throws(()=>validateAttachments([list[0],{...list[2],label:'图2'}]));
});
