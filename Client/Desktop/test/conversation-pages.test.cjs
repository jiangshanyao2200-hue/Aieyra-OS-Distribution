// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; turns
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/conversation-pages.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
const turns=n=>Array.from({length:n},(_,i)=>[{id:'u'+i,from:'user',text:'same'},{id:'a'+i,from:'eyra',text:'same'}]).flat();
test('recent conversation is bounded by user turns and earlier pages preserve whole pairs',async()=>{
 const {createConversationPager}=await import('../ui/conversation-pages.mjs');
 const pager=createConversationPager();let page;
 for(let n=1;n<=45;n++){
  page=pager.update(turns(n),'session');
  assert.equal(page.entries.length,Math.min(20,n)*2);assert.equal(page.entries.at(-1).id,'a'+(n-1));
 }
 assert.equal(page.entries[0].id,'u25');assert.equal(pager.more().entries[0].id,'u5');page=pager.more();
 assert.equal(page.entries[0].id,'u0');assert.equal(page.hasMore,false);
});
test('reading and expanded pages survive new replies; a new session clears the page',async()=>{
 const {createConversationPager}=await import('../ui/conversation-pages.mjs');
 const pager=createConversationPager({pageSize:2});pager.update(turns(6),'one');
 let page=pager.update(turns(7),'one',{reading:true});assert.equal(page.entries[0].id,'u4');assert.equal(page.reset,false);
 page=pager.more();assert.equal(page.entries[0].id,'u2');
 page=pager.update(turns(8),'one');assert.equal(page.entries[0].id,'u2');
 page=pager.update(turns(8),'two');assert.equal(page.entries[0].id,'u6');assert.equal(page.reset,true);
});
test('completed work removes commentary and tools without changing conversation scope or artifacts',async()=>{
 const {createConversationPager}=await import('../ui/conversation-pages.mjs');
 const {chatRounds}=await import('../ui/chat-column.mjs');
 const pager=createConversationPager(),messages=[
  {id:'u',from:'user',text:'same',state:'delivered',attachments:[{name:'photo.png'}]},
  {id:'p-old',from:'matrix',to:'user',text:'old progress',state:'commentary',generation:1},
  {id:'p',from:'matrix',to:'user',text:'working',state:'commentary',generation:2},
  {id:'tool',from:'tool',to:'matrix',text:'view_image',state:'completed'},
  {id:'failed',from:'matrix',to:'user',text:'partial',state:'failed'},
 ];
 const pending=[{id:'u',from:'user',text:'same'},{id:'next',from:'user',text:'same',state:'queued'}];
 let page=pager.update(chatRounds(messages,pending,{limit:Infinity,commentary:2}),'session');
 assert.deepEqual(page.entries.map(e=>e.id),['u','p','next']);assert.equal(page.entries[0].attachments[0].name,'photo.png');
 messages.push({id:'final',from:'matrix',to:'user',text:'done',state:'completed',artifacts:[{path:'result.html'}]});
 page=pager.update(chatRounds(messages,pending,{limit:Infinity}),'session',{reading:true});
 assert.deepEqual(page.entries.map(e=>e.id),['u','final','next']);assert.equal(page.entries[1].artifacts[0].path,'result.html');assert.equal(page.reset,false);
});
test('removing a progress anchor does not force the reader to the bottom',async()=>{
 const {createConversationPager}=await import('../ui/conversation-pages.mjs');
 const pager=createConversationPager();pager.update([{id:'progress',from:'eyra'}],'one');
 assert.equal(pager.update([{id:'final',from:'eyra'}],'one',{reading:true}).reset,false);
 pager.clear();assert.equal(pager.update(turns(1),'one').reset,true);
});
