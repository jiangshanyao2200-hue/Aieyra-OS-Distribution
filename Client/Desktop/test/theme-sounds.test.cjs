// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: definition; settings; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-sounds.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createThemeSounds}=require('../../../Theme/runtime/sounds.mjs');
const {validateTheme}=require('../../../Theme/contract/definition.mjs');
const {defaults,merge}=require('../../../Theme/runtime/settings.cjs');
const definition=require('../../../SDK/examples/theme-sounds/theme.json');
const settings={sounds:{enabled:true,volume:35},layout_theme:{id:'example.theme-sounds',digest:'a'.repeat(64),definition}};
function fixture(){
 const players=[];let time=0;
 const runtime=createThemeSounds({now:()=>time,createAudio:()=>{const audio={src:'',paused:true,unloaded:0,play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){this.unloaded++;}};players.push(audio);return audio;}});
 runtime.configure(settings);
 return {runtime,players,tick(){time+=1500;},snapshot(state,generation=1,extra={}){return {session_id:'session',core_epoch:'epoch',cursor:1,revision:1,roles:[{role:'matrix',id:'eyra',generation,state}],...extra};}};
}
test('sound bindings require declared WAVs and user opt-in is independent of presets',()=>{
 validateTheme(definition);assert.deepEqual(defaults().sounds,{enabled:false,volume:35});
 for(const sounds of [null,[],{'click':'complete'},{'task.completed':'missing'},{'task.completed':['complete']}])assert.throws(()=>validateTheme({...definition,sounds}));
 for(const sounds of [{enabled:1},{volume:101},{volume:.5},{volume:'35'},{autoplay:true}])assert.throws(()=>merge(defaults(),{sounds}));
 const value=merge(defaults(),{sounds:{enabled:true,volume:55}});assert.deepEqual(merge(value,{first_line_indent:2}).sounds,{enabled:true,volume:55});
 const {selectTheme,editTheme}=require('../../../Theme/runtime/overrides.cjs');
 const selected=selectTheme(undefined,settings.layout_theme);
 assert.throws(()=>editTheme(selected.profiles,settings.layout_theme.id,{action:'edit',definition:{...definition,sounds:{'task.completed':'failure'}}}),/原始包/);
});
test('only fresh transitions play; terminal replay, stale generations, scope and cancelled work stay silent',()=>{
 const {runtime:r,players:p,snapshot:s,tick}=fixture();r.observe(s('completed'));assert.equal(p.length,0);
 r.observe(s('running',2));r.observe(s('completed',2));assert.equal(p.length,1);assert.match(p[0].src,/\/complete$/);assert.equal(p[0].volume,.35);
 tick();r.observe(s('running',2));r.observe(s('completed',2));r.observe(s('failed',1));assert.equal(p.length,1);
 r.observe(s('running',3));r.observe(s('failed',3,{cursor:0}));assert.equal(p.length,1);
 r.observe(s('failed',3));assert.equal(p.length,2);assert.match(p[1].src,/\/failure$/);assert.ok(p[0].paused&&p[0].unloaded);
 tick();r.observe(s('running',4));r.observe(s('cancelled',4));assert.equal(p.length,2);
 r.observe(s('completed',5,{session_id:'different'}));assert.equal(p.length,2);assert.ok(p[1].paused);
});
test('attention bursts coalesce and consumed events never queue after hidden, config change or disable',()=>{
 const {runtime:r,players:p,snapshot:s,tick}=fixture();r.observe(s('running'));
 const ask=id=>({id,generation:1,state:'pending'});
 r.observe(s('waiting_user',1,{ask_requests:[ask('q1'),ask('q2')]}));assert.equal(p.length,1);assert.match(p[0].src,/\/attention$/);
 tick();r.observe(s('running'));r.observe(s('running',1,{ask_requests:[ask('q1')]}));r.observe(s('waiting_user'));assert.equal(p.length,1);
 r.setVisible(false);assert.ok(p[0].paused);r.observe(s('failed'));r.setVisible(true);r.observe(s('failed'));assert.equal(p.length,1);
 r.observe(s('running',2));r.observe(s('completed',2));assert.equal(p.length,2);
 r.configure({...settings,sounds:{enabled:false,volume:35}});assert.ok(p[1].paused);tick();r.observe(s('running',3));r.observe(s('completed',3));assert.equal(p.length,2);
 r.configure(settings);r.observe(s('completed',3));assert.equal(p.length,2);r.observe(s('running',4));r.observe(s('failed',4));assert.equal(p.length,3);
 tick();r.observe(s('running',5));r.configure({...settings,layout_theme:{...settings.layout_theme,digest:'b'.repeat(64)}});assert.ok(p[2].paused);r.observe(s('completed',5));assert.equal(p.length,3);
 r.observe(s('running',6));r.observe(s('completed',6));assert.equal(p.length,4);r.dispose();assert.ok(p[3].paused);tick();r.observe(s('failed',7));assert.equal(p.length,4);
});
test('rejected late playback cannot stop a newer player and no automatic retry occurs',async()=>{
 const {runtime:r,players:p,snapshot:s,tick}=fixture();r.observe(s('running'));r.observe(s('completed'));const oldEnd=p[0].onended;
 tick();r.observe(s('running',2));r.observe(s('failed',2));oldEnd();assert.equal(p[1].paused,false);p[1].onerror();assert.ok(p[1].paused);assert.equal(p.length,2);
 r.observe(s('failed',2));await Promise.resolve();assert.equal(p.length,2);
});

test('pending play rejection after cancellation cannot affect the current sound',async()=>{
 let reject,second=false;const players=[];
 const r=createThemeSounds({now:()=>second?2000:0,createAudio:()=>{const a={paused:true,play(){this.paused=false;return second?Promise.resolve():new Promise((_,no)=>{reject=no;});},pause(){this.paused=true;},removeAttribute(){},load(){}};players.push(a);return a;}});
 const {snapshot:s}=fixture();r.configure(settings);r.observe(s('running'));r.observe(s('completed'));second=true;r.observe(s('running',2));r.observe(s('failed',2));reject(Error('cancelled old playback'));await Promise.resolve();await Promise.resolve();assert.equal(players[1].paused,false);assert.equal(players.length,2);r.dispose();
});

test('simultaneous role events have one highest-priority sound and burst events do not queue',()=>{
 const {runtime:r,players:p,snapshot:s,tick}=fixture();r.observe(s('running'));
 r.observe(s('completed',1,{roles:[{id:'eyra',role:'matrix',generation:1,state:'completed'},{id:'helper',role:'project',generation:1,state:'failed'}],ask_requests:[{id:'question',generation:1,state:'pending'}]}));assert.equal(p.length,1);assert.match(p[0].src,/failure$/);
 r.observe(s('completed',2));assert.equal(p.length,1);tick();r.observe(s('completed',2));assert.equal(p.length,1);
 r.observe(s('running',3,{ask_requests:[{id:'stale',generation:1,state:'pending'}]}));assert.equal(p.length,1);
});
