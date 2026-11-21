// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/composer-feedback.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
test('paste blocks preserve Unicode, CRLF, tabs, prefix/suffix and expand nested handles',async()=>{
 const {PasteDraft}=await import('../ui/paste-blocks.mjs'),draft=new PasteDraft();
 const payload='第一行\r\n\t👩🏽‍💻 e\u0301\n第三行\n末行',token=draft.pack(payload),value='前缀 '+token+' 后缀';
 assert.equal(draft.expand(value),'前缀 '+payload+' 后缀');
 const restored=new PasteDraft();restored.restore(value,draft.serialize(value));assert.equal(restored.expand(value),draft.expand(value));
 const outer=draft.pack('原文中的标记\n'+token);assert.equal(draft.expand(outer),'原文中的标记\n'+payload);
 assert.equal(draft.pack('短文本'),'短文本');
 assert.deepEqual(draft.selection(value,4,4,'forward'),{start:3,end:3+token.length});
 assert.deepEqual(draft.selection(value,3+token.length,3+token.length,'backward'),{start:3,end:3+token.length});
 assert.throws(()=>new PasteDraft().restore(value,''),/失效/);
 assert.throws(()=>restored.restore(value+' changed',draft.serialize(value)),/不完整/);
 assert.throws(()=>draft.pack('中'.repeat(22000)),/64 KiB/);
 const legacy=new PasteDraft(),a='⟦粘贴 1 · 4 行⟧',b='⟦粘贴 2 · 4 行⟧';
 legacy.restore(a,JSON.stringify({version:1,value:a,blocks:[[a,'prefix '+b],[b,payload]]}));assert.equal(legacy.expand(a),'prefix '+payload);
 const reload=new PasteDraft();reload.restore(a,legacy.serialize(a));assert.equal(reload.expand(a),'prefix '+payload);
 assert.throws(()=>reload.restore(a,JSON.stringify({version:1,value:a,blocks:[[a,b],[b,a]]})),/循环/);
});
test('send queue preserves order, same-text additions and original IDs across lost acknowledgements',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let stored=[],release;
 const queue=new SendQueue('s',[],entries=>stored=structuredClone(entries));
 queue.add('原目标','a');const calls=[];
 const first=queue.drain(async entry=>{calls.push(entry.request_id);await new Promise(resolve=>release=resolve);throw Error('lost ack');});
 queue.add('继续','b');queue.add('继续','c');release();await assert.rejects(first,/lost ack/);
 assert.deepEqual(stored.map(x=>x.request_id),['a','b','c']);
 const reload=new SendQueue('s',stored);const checked=[];await reload.drain(async entry=>calls.push(entry.request_id),async entry=>{checked.push(entry.request_id);return true;});
 assert.deepEqual(checked,['a']);assert.deepEqual(calls,['a','b','c']);assert.equal(reload.entries.length,0);
});
test('editing a paste retains the undo payload and exact restored Unicode bytes',async()=>{
 const {PasteDraft,pasteEditorText,MESSAGE_BYTES,messageBytes}=await import('../ui/paste-blocks.mjs'),draft=new PasteDraft();
 const original='第一行\r\n\t👩🏽‍💻 e\u0301\n第三行\r末行',token=draft.pack(original),edited=pasteEditorText(original,'第一行\n\t👩🏽‍💻 e\u0301\n第三行修改\n末行');
 assert.equal(pasteEditorText(original,original.replace(/\r\n?/g,'\n')),original);
 assert.equal(edited,'第一行\r\n\t👩🏽‍💻 e\u0301\n第三行修改\r末行');
 const replacement=draft.edit(token,edited);assert.notEqual(replacement,token);
 assert.equal(draft.expand(token),original);assert.equal(draft.expand(replacement),edited);
 const restored=new PasteDraft(),value='前 '+replacement+' 后';restored.restore(value,draft.serialize(value));assert.equal(restored.expand(value),'前 '+edited+' 后');
 assert.equal(draft.edit(token,original),token);assert.equal(draft.edit(token,''),'');
 assert.throws(()=>draft.edit(token,'中'.repeat(Math.ceil(MESSAGE_BYTES/3))),/64 KiB/);assert.equal(draft.expand(token),original);
 const atLimit='a'.repeat(MESSAGE_BYTES),limit=draft.edit(token,atLimit);assert.equal(messageBytes(draft.expand(limit)),MESSAGE_BYTES);
 assert.equal(pasteEditorText('a\r\nb\r\nc','a\nb新\n插入\nc'),'a\r\nb新\r\n插入\r\nc');
});
test('a confirmed lost response drains pending additions without retrying accepted work',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');const queue=new SendQueue('s');queue.add('one','a');queue.add('two','b');
 const calls=[];await queue.drain(async entry=>{calls.push(entry.request_id);if(entry.request_id==='a')throw Error('lost');},async entry=>entry.request_id==='a');
 assert.deepEqual(calls,['a','b']);assert.equal(queue.entries.length,0);
});
test('storage failure keeps the draft out of the queue and retains uncertain acknowledgements',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let fail=true;
 const queue=new SendQueue('s',[],()=>{if(fail)throw Error('quota');});
 assert.throws(()=>queue.add('keep draft','a'),/quota/);assert.equal(queue.entries.length,0);
 fail=false;queue.add('sent','a');fail=true;
 await assert.rejects(queue.drain(async()=>{}),/quota/);
 assert.equal(queue.entries[0].request_id,'a');
 fail=false;queue.reconcile([{id:'a'}]);assert.equal(queue.entries.length,0);
});
