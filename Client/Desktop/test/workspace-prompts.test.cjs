// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; fs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-prompts.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createPromptEditor } = require('../host/prompts.cjs');
test('prompt edits preserve raw text, stay layer scoped, back up and reject stale versions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-prompts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '工作.txt');
  const original = '\uFEFF<!-- personal notes -->\r\n先说明正在做什么。\r\n';
  fs.writeFileSync(file, original);
  const editor = createPromptEditor(dir), result = editor.list();
  assert.equal(result.layers.length, 4);
  const work = result.layers.find((x) => x.id === 'work');
  assert.equal(work.text, original);
  assert.equal(fs.readdirSync(dir).length, 1, 'reading created files');
  assert.throws(() => editor.save({ id: '../outside', directory: dir, text: '', version: 'missing' }));
  const saved = editor.save({ id: 'work', directory: dir, version: work.version, text: original + '补充' });
  assert.equal(fs.readFileSync(file + '.backup.' + work.version, 'utf8'), original);
  assert.equal(saved.layer.text, original + '补充');
  assert.throws(() => editor.save({ id: 'work', directory: dir, version: work.version, text: 'stale' }), /变化/);
  assert.equal(fs.readFileSync(file, 'utf8'), original + '补充');
  assert.throws(() => editor.save({ id: 'work', directory: path.dirname(dir), version: saved.layer.version, text: 'wrong directory' }));
  editor.save({ id: 'boundary', directory: dir, version: 'missing', text: '边界' });
  assert.equal(editor.list().layers.find((x) => x.id === 'boundary').text, '边界');
});

test('defaults are read-only fallbacks; empty overrides, resets and restart undo preserve bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-prompt-defaults-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const defaults = path.join(root,'defaults'), dir = path.join(root,'personal');
  fs.mkdirSync(defaults); fs.writeFileSync(path.join(defaults,'工作.txt'),'默认工作能力');
  const editor = createPromptEditor(dir,defaults);
  const read = () => editor.list().layers.find(x => x.id === 'work');
  let base = read(); assert.equal(base.text,'默认工作能力'); assert.equal(base.source,'default');
  assert.equal(fs.existsSync(dir),false);
  const args = () => ({id:'work',directory:dir,version:read().version,defaultVersion:read().defaultVersion});
  editor.save({...args(),text:''}); assert.equal(read().text,''); assert.equal(read().source,'custom');
  const reset = editor.restore(args()); assert.equal(read().source,'default');
  assert.ok(reset.undoVersion); assert.equal(fs.readFileSync(path.join(defaults,'工作.txt'),'utf8'),'默认工作能力');
  const reopened = createPromptEditor(dir,defaults); base = reopened.list().layers.find(x => x.id === 'work');
  assert.equal(base.undoVersion,reset.undoVersion);
  reopened.undo({...args(),undoVersion:base.undoVersion}); assert.equal(read().text,'');
  editor.save({...args(),text:'\uFEFF个人\r\n'});
  const stale = args(); fs.writeFileSync(path.join(defaults,'工作.txt'),'新版默认');
  assert.throws(() => editor.restore(stale),/默认版本已变化/); assert.equal(read().text,'\uFEFF个人\r\n');
  const valid = editor.restore(args()); assert.equal(read().text,'新版默认');
  fs.writeFileSync(path.join(dir,'工作.txt.backup.'+valid.undoVersion),'坏备份');
  assert.throws(() => editor.undo({...args(),undoVersion:valid.undoVersion}),/已变化/);
  assert.equal(read().source,'default');
  assert.throws(() => createPromptEditor(defaults,defaults),/官方默认目录/);
  assert.throws(() => createPromptEditor(path.join(defaults,'child'),defaults),/官方默认目录/);
});

test('prompt editor rejects damaged and oversized text without destructive fallback', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-prompts-invalid-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'工作.txt'), editor = createPromptEditor(dir);
  fs.writeFileSync(file,Buffer.from([0xff,0xfe])); assert.throws(() => editor.list(),/UTF-8/);
  fs.writeFileSync(file,Buffer.alloc(256*1024+1)); assert.throws(() => editor.list(),/256 KiB/);
  fs.unlinkSync(file); fs.mkdirSync(file); assert.throws(() => editor.list(),/普通/);
});

test('confirmed reset restores all four defaults, protects cancellation and CAS, and retains exact backups',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-four-prompts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'personal'),defaults=path.join(root,'defaults');fs.mkdirSync(dir);fs.mkdirSync(defaults);
 const files=['自我.txt','工作.txt','边界.txt','思考方式.txt'];
 for(const file of files){fs.writeFileSync(path.join(dir,file),'\uFEFF私人 '+file+'\r\n');fs.writeFileSync(path.join(defaults,file),'默认 '+file);}
 fs.writeFileSync(path.join(dir,'基础.txt'),'旧基础保留但不装载');
 const editor=createPromptEditor(dir,defaults),initial=editor.list(),args=()=>({directory:dir,confirmed:true,layers:editor.list().layers.map(x=>({id:x.id,version:x.version,defaultVersion:x.defaultVersion}))});
 assert.deepEqual(initial.layers.map(x=>x.title),['人格与沟通','执行与工作','安全与边界','思考方式']);
 const original=files.map(x=>fs.readFileSync(path.join(dir,x)));
 assert.throws(()=>editor.restoreAll({...args(),confirmed:false}),/确认/);
 files.forEach((x,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,x)),original[i]));
 const stale=args();fs.writeFileSync(path.join(defaults,files[3]),'新版默认');assert.throws(()=>editor.restoreAll(stale),/变化/);
 files.forEach((x,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,x)),original[i]));
 const result=editor.restoreAll(args());assert.equal(result.layers.length,4);assert.ok(result.layers.every(x=>x.source==='default'));
 files.forEach((x,i)=>{assert.equal(fs.existsSync(path.join(dir,x)),false);assert.deepEqual(fs.readFileSync(path.join(dir,x+'.backup.'+initial.layers[i].version)),original[i]);});
 const reopened=createPromptEditor(dir,defaults).list();assert.deepEqual(reopened.layers.map(x=>x.text),files.map(x=>fs.readFileSync(path.join(defaults,x),'utf8')));
 assert.equal(fs.readFileSync(path.join(dir,'基础.txt'),'utf8'),'旧基础保留但不装载');
});

test('all-layer reset rolls back exact custom bytes if a layer cannot be removed',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-reset-rollback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'personal'),defaults=path.join(root,'defaults');fs.mkdirSync(dir);fs.mkdirSync(defaults);
 const files=['自我.txt','工作.txt','边界.txt','思考方式.txt'];for(const file of files){fs.writeFileSync(path.join(dir,file),'\uFEFF'+file+'\r\n');fs.writeFileSync(path.join(defaults,file),'默认');}
 const editor=createPromptEditor(dir,defaults),before=editor.list();
 const unlink=fs.unlinkSync;fs.unlinkSync=function(file){if(file===path.join(dir,'边界.txt'))throw Object.assign(Error('injected write failure'),{code:'EACCES'});return unlink.apply(this,arguments);};
 try{assert.throws(()=>editor.restoreAll({directory:dir,confirmed:true,layers:before.layers}),/injected/);}finally{fs.unlinkSync=unlink;}
 assert.deepEqual(editor.list().layers.map(x=>x.text),before.layers.map(x=>x.text));
 files.forEach(file=>assert.equal(fs.existsSync(path.join(dir,file+'.write-lock')),false));
});
