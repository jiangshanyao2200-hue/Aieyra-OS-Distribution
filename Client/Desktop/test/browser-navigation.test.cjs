// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-navigation.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),nav=require('../renderer/browser-navigation.js');
test('address input keeps local servers, IPv6, Unicode domains and encoded search distinct',()=>{
 for(const [input,expected] of [['localhost:8032/form','http://localhost:8032/form'],['127.0.0.1:8032','http://127.0.0.1:8032/'],['[::1]:8032/path','http://[::1]:8032/path'],['example.com/a?q=中文','https://example.com/a?q=%E4%B8%AD%E6%96%87'],['你好 世界','https://www.baidu.com/s?wd=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C'],['about:blank','about:blank'],[' HTTPS://example.com ','https://example.com/']])assert.equal(nav.address(input),expected);
 assert.equal(nav.address('  '),null);for(const value of ['javascript:alert(1)','file:///C:/private','data:text/html,test','ftp://example.com','https://'])assert.throws(()=>nav.address(value));
});
test('browser keyboard paths protect IME, support tab cycling and retain shift direction',()=>{
 assert.equal(nav.shortcut({key:'Tab',control:true}),'next_tab');assert.equal(nav.shortcut({key:'Tab',ctrlKey:true,shiftKey:true}),'previous_tab');assert.equal(nav.shortcut({key:'9',meta:true}),'tab_9');assert.equal(nav.shortcut({key:'f',ctrlKey:true}),'find_in_page');assert.equal(nav.shortcut({key:'Escape'}),'stop');assert.equal(nav.shortcut({key:'l',ctrlKey:true,isComposing:true}),null);
});
test('agent keys carry physical codes and modifiers without accepting arbitrary CDP payloads',()=>{
 assert.deepEqual(nav.keySpec('Control+Shift+A'),{key:'A',code:'KeyA',windowsVirtualKeyCode:65,modifiers:10});assert.equal(nav.keySpec('Space').key,' ');assert.equal(nav.keySpec('PageDown').windowsVirtualKeyCode,34);for(const value of ['Control+Control+A','Super+A','F99',{},'Control+'])assert.throws(()=>nav.keySpec(value));
});
