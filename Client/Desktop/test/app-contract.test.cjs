// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: ui; programs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/app-contract.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 程序开发协定（docs/程序开发协定.md）：新增程序漏掉任何一步，这里就过不去。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ui=path.join(__dirname,'../ui'),read=name=>fs.readFileSync(path.join(ui,name),'utf8');
const {MODULES}=require('../host/module-catalog.cjs'),{MODULE_SUMMARY}=require('../host/plugins.cjs');
const programs=MODULES.filter(m=>m.page);
test('目录里的程序：有页面、有顶栏按钮、有说明，并接进导航',async()=>{
 const {APP_PAGES}=await import('../ui/app-pages.mjs'),index=read('index.html');
 assert.ok(programs.length>=2);
 assert.deepEqual(APP_PAGES.map(a=>a.key).sort(),programs.map(m=>m.id).sort());
 for(const m of programs){
  assert.equal(m.host,'surface',m.id+' 必须是 OS 内页面');
  assert.ok(['sleep','keep'].includes(m.background),m.id+' 要写明后台规则 background（sleep/keep）');
  assert.ok(index.includes('id="'+m.tab+'"'),m.id+' 缺顶栏按钮');
  assert.ok(index.slice(index.indexOf('id="desktop-dock"'),index.indexOf('id="usage-anchor"')).includes('id="'+m.tab+'"'),m.id+' 的按钮要在顶栏导航里');
  assert.ok(MODULE_SUMMARY[m.id]?.[1]&&MODULE_SUMMARY[m.id]?.[2],m.id+' 缺给 Eyra 的说明');
  const html=read(m.page),programRead=name=>read(path.join(path.dirname(m.page),name));
  if(m.id==='workspace'){const source=programRead('../src/main.tsx');assert.match(source,/OverflowTooltipLayer/);assert.doesNotMatch(source,/WorkspaceEdgeNavigation|os-canvas-projects|WorkspaceUsage|MatrixToolboxPanel|ProjectTransferMenu/,'single canvas without retired sidebar or duplicate settings');assert.match(html,/<script[^>]+src="[^"]+\.js"/);assert.doesNotMatch(html,/class="app-rail"/);continue;}
  assert.ok(html.includes('app-shell.css'),m.id+' 要用共同外壳');
  if(['coding','center'].includes(m.id))assert.doesNotMatch(html,/class="app-rail"/,'Coding 固定为左终端、右聊天，不设左侧导航');else assert.ok(html.includes('class="app-rail"'),m.id+' 要有左侧圆形导航');
  assert.doesNotMatch(html,/window-controls|type="(search|number|color)"|<select/,m.id+' 不能自带窗口按钮或系统控件');
  const script=/src="([^"]+\.mjs)"/.exec(html)[1];assert.match(programRead(script),/app-shell\.mjs/,m.id+' 要用共同外壳脚本');
  assert.match(programRead(script),/onVisibility/,m.id+' 隐藏时要自己停下（onVisibility）');
  const css=html.match(/href="(app-(?!shell)[^"]+\.css)"/)?.[1];
  if(css)assert.doesNotMatch(programRead(css).replace(/\/\*[\s\S]*?\*\//g,''),/(^|\n)\s*(html|body)[^{]*\{[^}]*background/,m.id+' 不能给页面画底色，遮罩归 OS');
 }
 assert(!APP_PAGES.some(p=>p.key==='market'),'retired application cannot be reopened through navigation');
 assert(!index.includes('id="dock-market"'));
});
test('外壳页面透明，遮罩才透得上来',()=>{
 assert.match(read('app-shell.css'),/html,body \{[^}]*background:transparent/);
 assert.doesNotMatch(read('app-shell.mjs'),/applyWindowTheme|applyBackground/,'程序不自己铺背景');
});
test('每个页面都装上自绘提示框，也都带基础样式',()=>{
 const imports=(file,seen=new Set())=>{if(seen.has(file)||!fs.existsSync(file))return seen;seen.add(file);for(const m of fs.readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+\.mjs)['"]/g))imports(path.resolve(path.dirname(file),m[1]),seen);return seen;};
 for(const page of [...fs.readdirSync(ui).filter(n=>n.endsWith('.html')),...programs.map(p=>p.page).filter(p=>p.startsWith('../'))]){
  if(page===programs.find(p=>p.id==='workspace')?.page){assert.match(read(page),/<link[^>]+stylesheet/);assert.match(read(path.join(path.dirname(page),'../src/ui.tsx')),/OverflowTooltipLayer/);continue;}
  if(page==='tooltip.html'||page==='page-dialog.html')continue; // 提示框自己；只有固定文字和按钮的对话框
  const script=/<script[^>]+src="([^"]+\.mjs)"/.exec(read(page))?.[1];assert.ok(script,page+' 没有脚本');
  const loaded=imports(path.resolve(ui,path.dirname(page),script));
  const legacy=path.resolve(ui,'../../../Desktop/ui/tooltip.mjs');
  assert.ok(loaded.has(path.join(ui,'tooltip.mjs'))||loaded.has(legacy)&&require('../../../Contracts/desktop-compatibility.json').files['Desktop/ui/tooltip.mjs'],page+' 没有装上提示框');
 }
});
test('提示框位置：放不下就翻到上面，也不出窗口',async()=>{
 const {tipPlacement}=await import('../ui/tooltip.mjs');
 const view={width:800,height:600};
 assert.deepEqual(tipPlacement({left:100,top:50,width:40,height:20,bottom:70},{width:60,height:30},view),{left:90,top:78});
 assert.equal(tipPlacement({left:100,top:560,width:40,height:20,bottom:580},{width:60,height:30},view).top,522);
 assert.equal(tipPlacement({left:780,top:50,width:20,height:20,bottom:70},{width:200,height:30},view).left,592);
 assert.equal(tipPlacement({left:0,top:50,width:20,height:20,bottom:70},{width:200,height:30},view).left,8);
});
test('系统窗口外观：外部内容都装进自绘外壳，页面的对话框也不走系统框',()=>{
 const host=name=>fs.readFileSync(path.join(__dirname,'../host',name),'utf8');
 assert.match(host('official-account.cjs'),/ShellWindow/);assert.match(host('main.cjs'),/ShellWindow/);assert.match(host('main.cjs'),/programWindow/);
 for(const preload of ['preview-preload.cjs','page-dialog-preload.cjs'])for(const name of ['prompt','confirm','alert'])assert.match(host(preload),new RegExp(name+':\\{configurable'),preload+' 漏了 '+name);
 assert.doesNotMatch(host('main.cjs'),/showMessageBox|showErrorBox/);
});
test('Link 服务提供的共用脚本，静态依赖也都由它提供',()=>{
 // 少一个，整个页面的模块都不执行，Link 会永远停在“正在连接”。
 const service=fs.readFileSync(path.join(__dirname,'../../../Control/app/service/main.py'),'utf8');
 const routes=new Map([...service.matchAll(/"\/([\w.-]+\.m?js)": \("([\w.-]+)"/g)].map(m=>[m[1],m[2]]));
 assert.ok(routes.has('motion.mjs')&&routes.has('tooltip.mjs'));
 for(const [route,file] of routes){
  const source=read(file).replace(/\/\/.*$/gm,'');
  for(const m of source.matchAll(/^\s*(?:import\s[^;'"]*from\s*|import\s*)['"]\.\/([^'"]+)['"]/gm))assert.ok(routes.has(m[1]),route+' 静态依赖 '+m[1]+'，但 Link 服务没有这个路由');
 }
 assert.doesNotMatch(read('motion.mjs'),/^import\s/m,'motion.mjs 被 Link 共用，不要加静态依赖');
});
test('Link 页面不带提示框的副本，并容忍取不到',()=>{
 const web=path.join(__dirname,'../../../Control/app/web');
 assert.ok(!fs.existsSync(path.join(web,'tooltip.js')));
 const home=fs.readFileSync(path.join(web,'office-home.js'),'utf8');
 assert.ok(home.includes("import('./tooltip.mjs')")&&home.includes('.catch('));
});
