// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/os-appearance.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createAppearanceStore,defaults,merge,fields}=require('../src/os-appearance.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'os-appearance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const config=path.join(dir,'config.json');return {dir,config,file:path.join(dir,'os-appearance.json'),store:createAppearanceStore(config)};}
test('appearance defaults are independent, reads never create files, UI and Agent share CAS',async t=>{
 const {dir,config,file,store}=fixture(t),first=store.read();assert.equal(first.version,'missing');assert.equal(fs.existsSync(file),false);
 for(const name of ['config.json','companion-profile.json','settings.json'])fs.writeFileSync(path.join(dir,name),'preserve '+name);
 const {createSystemSettings}=require('../src/system-settings.cjs'),service=createSystemSettings(config);
 const changed=await service.call('os_appearance_update',{patch:{regions:{assistant:{size:21}}},expected_version:first.version});assert.equal(changed.ok,true);assert.equal(store.read().settings.regions.assistant.size,21);
 assert.equal(store.update({window:{width:900}},first.version).code,'version_conflict');
 assert.equal(store.update({window:{width:900}},changed.version).ok,true);
 for(const name of ['config.json','companion-profile.json','settings.json'])assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),'preserve '+name);
 const d=defaults();d.regions.assistant.size=27;assert.equal(defaults().regions.assistant.size,16);
 assert.equal((await service.call('os_appearance_read')).settings.window.width,900);
});
test('invalid patches cannot modify bytes or leave temporary files',t=>{
 const {dir,file,store}=fixture(t),saved=store.update({},'missing'),before=fs.readFileSync(file);
 for(const patch of [null,[],{schema_version:2},{unknown:1},{window:{width:479}},{window:{height:360.5}},{first_line_indent:11},{regions:{fake:{size:15}}},{regions:{assistant:{size:'20'}}},{regions:{assistant:{size:NaN}}},{regions:{assistant:{weight:99.99}}},{regions:{assistant:{font_latin:'url(x)'}}},{regions:{assistant:{stroke_color:'#abc;'}}},{regions:{assistant:{line_height:3.5}}},JSON.parse('{"__proto__":{"bad":true}}')]){
  assert.equal(store.update(patch,saved.version).ok,false,JSON.stringify(patch));assert.deepEqual(fs.readFileSync(file),before);
 }
 assert.equal(store.update({},undefined).code,'version_conflict');assert.deepEqual(fs.readdirSync(dir),['os-appearance.json']);
});
test('appearance replacement retries a temporary Windows reader denial while preserving committed bytes',t=>{
 const {dir,file,store}=fixture(t),saved=store.update({},'missing'),before=fs.readFileSync(file),rename=fs.renameSync;let attempts=0;
 fs.renameSync=(from,to)=>{if(to===file&&attempts++===0){assert.deepEqual(fs.readFileSync(file),before);assert(fs.existsSync(file+'.write-lock'));throw Object.assign(Error('temporary reader'),{code:'EPERM'});}return rename(from,to);};
 try{const result=store.update({first_line_indent:2},saved.version);assert.equal(result.ok,true,result.error);assert.equal(result.settings.first_line_indent,2);assert.equal(attempts,2);assert.deepEqual(fs.readdirSync(dir),['os-appearance.json']);}finally{fs.renameSync=rename;}
});
test('appearance replacement refuses a concurrent version change after a denied rename',t=>{
 const {dir,file,store}=fixture(t),saved=store.update({},'missing'),rename=fs.renameSync,other=JSON.stringify({...defaults(),first_line_indent:3});let attempts=0;
 fs.renameSync=(from,to)=>{if(to===file){attempts++;fs.writeFileSync(file,other);throw Object.assign(Error('reader and external writer'),{code:'EPERM'});}return rename(from,to);};
 try{const result=store.update({first_line_indent:2},saved.version);assert.equal(result.code,'version_conflict');assert.equal(attempts,1);assert.equal(fs.readFileSync(file,'utf8'),other);assert.deepEqual(fs.readdirSync(dir),['os-appearance.json']);}finally{fs.renameSync=rename;}
});
test('themes change the look only: nothing can hide, move, cover or spoof a control, and no theme can lock the user out',t=>{
 const {file,store}=fixture(t);let version=store.update({},'missing').version;
 for(const css of ['body { --theme-accent: #aabbcc; }','.card > a:hover{background:#123 !important;border-radius:8px;border-top-left-radius:2px;box-shadow:0 2px 8px #0006;transition:color .2s}','/* 说明 url( */ body{--theme-note:.5;--content:1;color:red;font-family:\"Noto Sans SC\"}','@keyframes glow{to{color:red}} a{animation-name:glow;animation-duration:2s}','@media (max-width:600px){a{color:red}}','@keyframes p{from{color:red}to{color:blue}}']){const r=store.update({theme_css:css},version);assert.equal(r.ok,true,css);version=r.version;}
 for(const css of ['button{display:none}','button{DISPLAY : NONE!important}','button{display/**/:none}','a{visibility:hidden}','a{content-visibility:hidden}','a{pointer-events:none}','a{opacity:0}','a{z-index:9}','a::before{content:"x"}','a{position:absolute;inset:0}','*{all:unset}','a{transform:scale(0)}','a{scale:0}','a{translate:-9999px 0}','a{width:0}','#look-theme-remove{height:0}','a{clip-path:inset(50%)}','a{filter:opacity(0)}','a{margin-left:-9999px}','--x:{display:none}','a{background:url(x)}','a{background:image-set("https://x/y" 1x)}','@import "x";','@font-face{font-family:x}','a{color:\\72 ed}','<style>','a{color}','a{font-size:0}','a{letter-spacing:99px}','a{outline-width:9999px}','#a{--a:\"/*\";transform:scale(0);--b:\"*/\"}','a{--a:\"x;color:red\"}','a{color:\"red}','body{--titlebar-height:9999px}','a{box-shadow:0 0 0 9999px #000}','a{box-shadow:0 0 0 calc(64px*64) #000}','a{box-shadow:0 0 0 var(--x) #000}','a{box-shadow:0 0 0 100vw #000}','a{animation-name:fade}','a{animation:x 1s}','/* 未闭合'])
  assert.equal(store.update({theme_css:css},version).ok,false,css);
 // 24000 个中文字符写得进去，也读得回来，移除主题照常可用。
 const large=store.update({theme_css:'/*'+'主题说明'.repeat(5990)+'*/body{color:red}'},version);assert.equal(large.ok,true,large.error);assert.ok(fs.statSync(file).size>32768);assert.equal(store.read().ok,true);
 const cleared=store.update({theme_css:''},large.version);assert.equal(cleared.ok,true);version=cleared.version;
 // 旧版本写下的不合规或超长主题只丢主题，其他外观保留。
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));for(const css of ['button{display:none}','a{color:red}'.repeat(3000)]){fs.writeFileSync(file,JSON.stringify({...saved,theme_css:css,first_line_indent:3}));const read=store.read();assert.equal(read.ok,true);assert.equal(read.settings.theme_css,undefined);assert.equal(read.settings.first_line_indent,3);}
});
test('variables the interface uses for layout are found in the real UI files',()=>{
 const {merge,defaults}=require('../src/os-appearance.cjs');
 for(const css of ['body{--titlebar-height:1px}','body{--os-scale:0}'])assert.throws(()=>merge(defaults(),{theme_css:css}),/布局/,css);
 assert.equal(merge(defaults(),{theme_css:'body{--theme-only-mark:#123456}'}).theme_css,'body{--theme-only-mark:#123456}');
});
test('corrupt, future and oversized files stay untouched; locks are respected',t=>{
 const {file,store}=fixture(t);
 for(const raw of ['{','{"schema_version":2}',' '.repeat(32769)]){
  fs.writeFileSync(file,raw);assert.equal(store.read().code,'appearance_invalid');const version=require('../src/config.cjs').version(file);assert.equal(store.update({},version).ok,false);assert.equal(fs.readFileSync(file,'utf8'),raw);
 }
 fs.writeFileSync(file,'\uFEFF{"schema_version":1}');const read=store.read();assert.equal(read.ok,true);
 fs.writeFileSync(file+'.write-lock','existing owner');assert.equal(store.update({},read.version).code,'config_busy');assert.equal(fs.readFileSync(file+'.write-lock','utf8'),'existing owner');fs.unlinkSync(file+'.write-lock');
});
test('independent writers cannot both commit against one observed version',async t=>{
 const {config,store}=fixture(t),baseline=store.update({},'missing');
 const code=`const {createAppearanceStore}=require(process.argv[1]);const s=createAppearanceStore(process.argv[2]);console.log(JSON.stringify(s.update({regions:{assistant:{size:Number(process.argv[4])}}},process.argv[3])));`;
 const run=size=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['-e',code,require.resolve('../src/os-appearance.cjs'),config,baseline.version,String(size)],{windowsHide:true});let out='';p.stdout.on('data',s=>out+=s);p.on('error',reject);p.on('exit',n=>n?reject(Error('writer exit '+n)):resolve(JSON.parse(out)));});
 const results=await Promise.all([run(22),run(23)]);assert.equal(results.filter(x=>x.ok).length,1);assert.ok(['config_busy','version_conflict'].includes(results.find(x=>!x.ok).code));assert.ok([22,23].includes(store.read().settings.regions.assistant.size));
});
test('font chains preserve Latin generic and put explicit Chinese families before fallback',async()=>{
 const {regionStyle}=await import('../ui/appearance.mjs');
 for(const [id,generic] of [['mono','monospace'],['georgia','serif'],['system','sans-serif']]){
  const value=merge(defaults(),{regions:{assistant:{font_latin:id,font_cjk:'noto_serif',shadow_blur:0}}}).regions.assistant;
  const style=regionStyle(value,fields);assert.ok(style.font.endsWith(', '+generic));assert.ok(style.font.includes('Noto Serif CJK SC'));assert.equal(style.shadow,'none');
 }
});

test('legacy appearance migrates without rewriting; thinking persists independently of prose effects',t=>{
 const {file,store}=fixture(t),legacy=defaults();delete legacy.regions.thinking;delete legacy.thinking_animation;
 legacy.regions.assistant.stroke_width=2;legacy.regions.assistant.shadow_blur=24;
 const bytes=JSON.stringify(legacy);fs.writeFileSync(file,bytes);
 const read=store.read();assert.equal(read.ok,true);assert.equal(fs.readFileSync(file,'utf8'),bytes);
 assert.equal(read.settings.regions.thinking.stroke_width,0);assert.equal(read.settings.regions.thinking.shadow_blur,0);
 const saved=store.update({thinking_animation:'fade',regions:{thinking:{font_latin:'mono',size:18,line_height:1.8,letter_spacing:.3}}},read.version);
 assert.equal(saved.ok,true);assert.equal(store.read().settings.thinking_animation,'fade');
 assert.equal(store.read().settings.regions.thinking.size,18);assert.equal(store.read().settings.regions.assistant.shadow_blur,24);
 assert.equal(store.update({thinking_animation:'unknown'},saved.version).ok,false);
});
