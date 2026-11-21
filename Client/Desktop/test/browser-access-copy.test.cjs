// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: source; harness; grant
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-access-copy.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../../Program/official/browser/ui/browser-panels.js'),'utf8');
function harness(write=async()=>{}){
 const nodes=new Map(),commands=[],copies=[],timers=new Map();let sequence=0;
 const node=()=>({hidden:false,disabled:false,addEventListener(){},contains(){return false;},focus(){},children:[],attrs:{},style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 get('browser-panel').hidden=true;
 get('browser-panel').dataset={};
 const context={document:{documentElement:node(),getElementById:get,createElement:node,createElementNS:node,body:node()},window:{addEventListener(){}},navigator:{clipboard:{async writeText(text){copies.push(text);await write(text);}}},setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id)};
 context.URL=URL;vm.createContext(context);vm.runInContext(source,context);
 const ui=context.createBrowserPanels({command:a=>commands.push(a),openFind(){},layout(){}});
 return {ui,get,copyButton(){if(!ui.active)get('browser-menu').onclick();return get('panel-content').children.find(row=>row.id==='browser-copy-access');},commands,copies,expire(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}};
}
const grant={enabled:true,token:'fixture-only',base_url:'http://127.0.0.1:12345',expires_at:'later',scope:{tabs:[{active:true,tab_id:'tab-1'}]},actions:['snapshot']};
test('bookmark menu toggles the current page and follows navigation',()=>{
 const h=harness(),url='https://example.test/one',bookmarks=[];
 h.ui.update({url,bookmarks});h.ui.open('bookmarks');
 const toggle=()=>h.get('panel-content').children.find(row=>row.children.some(label=>/收藏此页/.test(label.textContent||'')));
 assert(toggle());toggle().onclick();assert.equal(h.commands[0].action,'bookmark_toggle');
 h.ui.update({url,bookmarks:[{url,id:'one'}]});assert(toggle().children.some(label=>label.textContent==='取消收藏此页'));
 h.ui.update({url:'about:blank',bookmarks});assert.equal(toggle(),undefined);
});
test('profile actions stay in the menu and bookmarks also open directly',()=>{
 const h=harness();
 h.ui.update({profile:'default',cookies:{available:true},passwords:{available:true,origins:['https://sample.test']}});
 h.get('browser-menu').onclick();
 const rows=h.get('panel-content').children;
 const labels=rows.flatMap(row=>row.children.map(child=>child.textContent));
 for(const label of ['浏览身份','登录密码','收藏夹','下载','清理 Cookie 和缓存'])assert.ok(labels.includes(label));
 assert.ok(!labels.includes('浏览器设置'));
 rows.find(row=>row.children.some(label=>label.textContent==='登录密码')).onclick();
 assert.equal(h.get('browser-panel').dataset.kind,'passwords');
 h.get('panel-close').onclick();h.get('bookmarks-button').onclick();
 assert.equal(h.get('browser-panel').dataset.kind,'bookmarks');
});
test('one click copies one authenticated guide despite duplicate access notifications, without opening a panel',async()=>{
 const h=harness();h.copyButton().onclick();h.copyButton().onclick();
 assert.equal(h.commands.length,1);assert.equal(h.commands[0].action,'access_enable');
 await h.ui.receiveAccess({enabled:false,starting:true});assert.equal(h.copies.length,0);
 await h.ui.receiveAccess(grant);await h.ui.receiveAccess(grant);
 assert.equal(h.copies.length,1);assert.match(h.copies[0],/Authorization: Bearer fixture-only/);assert.match(h.copies[0],/请等待当前人工输入完成/);
 assert.equal(h.ui.active,true);assert.equal(h.get('browser-panel').hidden,false);assert.equal(h.copyButton().disabled,false);
});
test('browser menu retains access revocation without handback or placement rows',async()=>{
 const h=harness();
 await h.ui.receiveAccess(grant);
 for(const detached of [false,true]){
  h.ui.update({control:'human',canDetach:true,detached});
  h.get('browser-menu').onclick();
  const labels=h.get('panel-content').children.flatMap(row=>row.children.map(child=>child.textContent));
  assert(labels.includes('撤销外部接入'));
  assert(labels.includes('浏览身份'));
  for(const label of ['允许 Agent 操作','独立窗口','放回 OS'])assert(!labels.includes(label));
  assert.equal(h.commands.length,0);
  h.get('panel-close').onclick();
 }
});
test('failed or timed-out copies remain retryable; unsolicited replies cannot write the clipboard',async()=>{
 let fail=true;const h=harness(async()=>{if(fail)throw Error('clipboard unavailable');});
 await h.ui.receiveAccess(grant);assert.equal(h.copies.length,0);
 h.copyButton().onclick();await h.ui.receiveAccess({enabled:false,error:'unavailable'});assert.equal(h.copyButton().disabled,false);assert.equal(h.copies.length,0);
 h.copyButton().onclick();await h.ui.receiveAccess(grant);assert.equal(h.copyButton().disabled,false);
 fail=false;h.copyButton().onclick();await h.ui.receiveAccess(grant);assert.equal(h.copies.length,2);
 h.copyButton().onclick();h.expire();await h.ui.receiveAccess(grant);assert.equal(h.copies.length,2);assert.equal(h.copyButton().disabled,false);
});
