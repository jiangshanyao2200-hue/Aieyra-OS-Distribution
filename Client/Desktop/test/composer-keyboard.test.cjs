// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/composer-keyboard.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
test('共享输入键：IME不发送、普通回车换行、双回车去掉换行发送、Ctrl回车发送',async()=>{
 const {setupComposerKeys}=await import(pathToFileURL(path.join(__dirname,'../ui/composer-keyboard.mjs')));
 const input=new EventTarget();let now=100,composing=false;const sent=[];
 input.value='你好';input.selectionStart=input.selectionEnd=2;
 input.setSelectionRange=(a,b)=>{input.selectionStart=a;input.selectionEnd=b;};
 const doc={execCommand(cmd){assert.equal(cmd,'delete');input.value=input.value.slice(0,input.selectionStart)+input.value.slice(input.selectionEnd);input.selectionEnd=input.selectionStart;input.dispatchEvent(new Event('input'));}};
 const close=setupComposerKeys(input,{doc,clock:()=>now,isComposing:()=>composing,send:()=>sent.push(input.value)});
 const key=(props={})=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{key:'Enter',...props});input.dispatchEvent(e);return e;};
 composing=true;assert.equal(key({ctrlKey:true}).defaultPrevented,false);assert.equal(sent.length,0);composing=false;
 assert.equal(key().defaultPrevented,false);input.value+='\n';input.selectionStart=input.selectionEnd=3;input.dispatchEvent(new Event('input'));
 now+=100;assert.equal(key().defaultPrevented,true);assert.deepEqual(sent,['你好']);
 now+=100;assert.equal(key({shiftKey:true}).defaultPrevented,false);assert.equal(sent.length,1);
 assert.equal(key({ctrlKey:true}).defaultPrevented,true);assert.equal(sent.length,2);
 close();key({ctrlKey:true});assert.equal(sent.length,2);
});
