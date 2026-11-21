// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; PNG; hash; row; fixture; paginated; randomRequest; contactProvider; publicOrigin; reopenPublic; publicFiles; publicList
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/official-themes.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createOfficialLibrary}=require('../../../Theme/runtime/official-library.cjs');
const {preferences}=require('../../../Theme/runtime/media-preferences.cjs');
const {createProfileStore}=require('../host/profile.cjs');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=','base64');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),sha=hash(PNG),data='data:image/png;base64,'+PNG.toString('base64');
const row=(id='official.avatar-one')=>({id,digest:hash(id),category:'avatar',width:512,height:512,title:id,author:{name:'Example Author'},official:true,status:'approved',likes:0,liked:false,preview:'/api/v1/themes/items/'+id+'/preview?v='+sha,image:'/api/v1/themes/items/'+id+'/image?v='+sha,artifact:{name:id+'.png',sha256:sha,size:PNG.length}});
function fixture(t,{decode=()=>data,origin=null,contactMedia=null}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-theme-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const profile=createProfileStore(path.join(directory,'config.json'));profile.save({name:'original',avatar:'',initialized:true});
 let time=1000000,accountChange,offline=false,hold=null;const calls=[],images=[],items=[row(),row('official.avatar-two')];
 const client={...(origin?{themeOrigin:origin}:{}),status:()=>({signedIn:true,user:{id:'fixture'}}),subscribe:fn=>{accountChange=fn;return ()=>{};},
  async themeRequest(p){calls.push(p);if(offline)throw Error('offline');if(p.action==='list')return {items,nextCursor:null};return {item:items.find(x=>x.id===p.id)};},
  async themeMedia(p){images.push(p);if(hold)await hold;if(offline)throw Error('offline');return {response:new Response(PNG),assertCurrent(){}};}};
 const service=createOfficialLibrary({client,profile,contactMedia,directory:path.join(directory,'cache'),decode,now:()=>time,random:()=>0});t.after(()=>service.close());
 return {directory,profile,service,client,items,calls,images,advance:n=>time+=n,now:()=>time,logout:()=>accountChange(),offline:v=>offline=v,hold:v=>hold=v};
}
test('legacy profiles stay unchanged and rotation persists with strict time bounds',t=>{
 const f=fixture(t);assert.equal(f.profile.read().mediaRotation,undefined);
 for(const intervalSeconds of [0,59,604801,1.5,'60'])assert.throws(()=>preferences({avatar:{mode:'random',intervalSeconds}}));
 for(const intervalSeconds of [300,600,1800,3600,10800,18000,36000,86400,259200,604800])assert.equal(preferences({avatar:{mode:'random',intervalSeconds}}).avatar.intervalSeconds,intervalSeconds);
 assert.throws(()=>preferences({other:{mode:'random'}}));assert.throws(()=>preferences({avatar:{mode:'random',url:'https://invalid'}}));
 const saved=f.profile.update({mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:1234}}},f.profile.read().version);
 assert.equal(createProfileStore(path.join(f.directory,'config.json')).read().mediaRotation.avatar.nextAt,1234);
 assert.equal(f.profile.update({name:'changed'},saved.version).mediaRotation.avatar.intervalSeconds,60);
});
test('public browsing coalesces reads and full originals are fetched only for explicit selection',async t=>{
 const f=fixture(t),[a,b]=await Promise.all([f.service.call({action:'list',category:'avatar'}),f.service.call({action:'list',category:'avatar'})]);
 assert.deepEqual(a,b);assert.equal(f.calls.length,1);assert.equal(f.images.length,0);
 await f.service.call({action:'image',id:a.items[0].id,digest:a.items[0].digest,variant:'preview'});
 assert.equal(f.images[0].variant,'preview');
 await f.service.call({action:'prepare',target:'avatar',id:a.items[0].id,digest:a.items[0].digest});
 assert.equal(f.images[1].variant,'file');assert.equal(f.profile.read().avatar,'','picker must not commit before application');
 await f.service.call({action:'prepare',target:'avatar',id:a.items[0].id,digest:a.items[0].digest});assert.equal(f.images.length,2);
 assert.deepEqual(fs.readdirSync(path.join(f.directory,'cache')),[sha+'.png']);
});
function paginated(f){
 f.client.themeRequest=async p=>{
  f.calls.push(p);if(p.action!=='list')return {item:f.items.find(item=>item.id===p.id)};
  const items=f.items.filter(item=>item.category===p.category),offset=Number(p.cursor||0);
  assert.equal(p.sort,'latest');return {items:items.slice(offset,offset+24),nextCursor:offset+24<items.length?String(offset+24):null};
 };
}
const randomRequest=(target='avatar',extra={})=>({action:'prepare',mode:'random',target,intervalSeconds:60,...extra});
test('random rounds cover every catalogue page beyond 256 entries without replacement or boundary repeats',async t=>{
 const f=fixture(t);f.items.splice(0,f.items.length,...Array.from({length:289},(_,i)=>row('official.avatar-'+i)));paginated(f);
 const targets=['avatar','eyraAvatar','cotaAvatar','vayaAvatar'],seen=new Set();let previous='';
 for(let i=0;i<f.items.length;i++){
  const result=await f.service.call(randomRequest(targets[i%targets.length]));assert(!seen.has(result.item.id),'an unseen image must be drawn before a repeat');seen.add(result.item.id);previous=result.item.id;
 }
 assert.deepEqual(seen,new Set(f.items.map(item=>item.id)));assert.equal(f.calls.filter(p=>p.action==='list').length,13);
 const next=await f.service.call(randomRequest());assert.notEqual(next.item.id,previous);assert.equal(f.calls.filter(p=>p.action==='list').length,13,'clicking reuses catalogue metadata');
 assert.equal(f.images.length,1,'shared image bytes are still decoded and downloaded once');
});
test('concurrent avatar targets share one catalogue while duplicate clicks share their preparation',async t=>{
 const f=fixture(t);f.items.push(row('official.avatar-three'),row('official.avatar-four'));paginated(f);
 const same=randomRequest(),results=await Promise.all([f.service.call(same),f.service.call(same),f.service.call(randomRequest('eyraAvatar')),f.service.call(randomRequest('cotaAvatar')),f.service.call(randomRequest('vayaAvatar'))]);
 assert.deepEqual(results[0],results[1]);assert.equal(new Set([results[0],...results.slice(2)].map(result=>result.item.id)).size,4);
 assert.equal(f.calls.filter(p=>p.action==='list').length,1);assert.equal(f.calls.filter(p=>p.action==='read').length,4);
});
test('an exclusion is postponed and avatar and background rounds remain independent',async t=>{
 const f=fixture(t);f.items.push(row('official.avatar-three'));
 const background={...row('official.background-one'),category:'background',orientation:'landscape',width:1920,height:1080};f.items.push(background);paginated(f);
 const first=await f.service.call(randomRequest()),second=await f.service.call(randomRequest('avatar',{exclude_id:f.items[2].id})),third=await f.service.call(randomRequest());
 assert.equal(new Set([first,second,third].map(result=>result.item.id)).size,3);assert.notEqual(second.item.id,f.items[2].id);assert.equal(third.item.id,f.items[2].id);
 assert.equal((await f.service.call(randomRequest('background'))).item.id,background.id);
 assert.equal((await f.service.call(randomRequest('background',{exclude_id:background.id}))).item.id,background.id,'a single available background remains usable');
});
test('catalogue refresh retains the unfinished round while including additions and removing withdrawn items',async t=>{
 const f=fixture(t);f.items.push(row('official.avatar-three'));paginated(f);
 const first=await f.service.call(randomRequest());assert.equal(first.item.id,f.items[0].id);
 const withdrawn=f.items.splice(1,1)[0];f.items.push(row('official.avatar-new'));f.advance(15*60000+1);
 const next=[await f.service.call(randomRequest()),await f.service.call(randomRequest())];
 assert(next.every(result=>result.item.id!==first.item.id&&result.item.id!==withdrawn.id));
 assert.deepEqual(new Set(next.map(result=>result.item.id)),new Set(f.items.slice(1).map(item=>item.id)));
 assert.equal(f.calls.filter(p=>p.action==='list').length,2);
});
test('a partially used random round survives reopening without storing profile or image contents',async t=>{
 const f=fixture(t),first=await f.service.call(randomRequest());f.service.close();
 const directory=path.join(f.directory,'cache'),saved=fs.readFileSync(path.join(directory,'random-rounds.json'),'utf8');assert(!saved.includes(data));assert(!saved.includes('original'));
 const reopened=createOfficialLibrary({client:f.client,profile:f.profile,directory,decode:()=>data,now:f.now,random:()=>0});t.after(()=>reopened.close());
 assert.notEqual((await reopened.call(randomRequest())).item.id,first.item.id);
});
test('account refresh invalidates old catalogue requests while preserving the public random round',async t=>{
 const f=fixture(t),first=await f.service.call(randomRequest());f.logout();
 assert.notEqual((await f.service.call(randomRequest())).item.id,first.item.id);assert.equal(f.calls.filter(p=>p.action==='list').length,2);
});
test('damaged random-round caches are preserved while a fresh in-memory round remains usable',async t=>{
 const f=fixture(t),directory=path.join(f.directory,'cache');fs.mkdirSync(directory);const file=path.join(directory,'random-rounds.json');fs.writeFileSync(file,'damaged original');
 const a=await f.service.call(randomRequest()),b=await f.service.call(randomRequest());assert.notEqual(a.item.id,b.item.id);assert.equal(fs.readFileSync(file,'utf8'),'damaged original');
});
test('repeating catalogue cursors fail finitely without downloading an arbitrary partial pool',async t=>{
 const f=fixture(t);f.client.themeRequest=async p=>{f.calls.push(p);return {items:f.items,nextCursor:'loop'};};
 await assert.rejects(f.service.call(randomRequest()),/分页重复/);assert.equal(f.calls.length,2);assert.equal(f.images.length,0);
});
for(const cancel of ['logout','close'])test(cancel+' cancels catalogue pagination before another page or image can start',async t=>{
 const f=fixture(t);let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);let signal;
 f.client.themeRequest=async p=>{f.calls.push(p);if(p.cursor){signal=p.signal;started();await gate;}return {items:f.items,nextCursor:p.cursor?'third':'second'};};
 const pending=f.service.call(randomRequest());await ready;if(cancel==='logout')f.logout();else f.service.close();assert.equal(signal.aborted,true);release();
 await assert.rejects(pending,/过期|关闭/);assert.equal(f.calls.length,2);assert.equal(f.images.length,0);
});
test('pending, changed revisions and portrait images cannot be applied',async t=>{
 const f=fixture(t),item=f.items[0];item.status='pending';
 await assert.rejects(f.service.call({action:'prepare',target:'avatar',id:item.id,digest:item.digest}),/已采纳/);
 item.status='approved';await assert.rejects(f.service.call({action:'prepare',target:'avatar',id:item.id,digest:'f'.repeat(64)}),/已更新/);
 Object.assign(item,{category:'background',orientation:'portrait',width:1080,height:1920});
 await assert.rejects(f.service.call({action:'prepare',target:'background',id:item.id,digest:item.digest}),/不兼容/);assert.equal(f.images.length,0);
});
test('digest mismatches are rejected without writing image or cache',async t=>{
 const f=fixture(t);f.client.themeMedia=async()=>({response:new Response(Buffer.from('not the promised PNG')),assertCurrent(){}});
 await assert.rejects(f.service.call({action:'prepare',target:'avatar',id:f.items[0].id,digest:f.items[0].digest}),/校验失败/);
 assert.equal(f.profile.read().avatar,'');assert.equal(fs.existsSync(path.join(f.directory,'cache')),false);
});
test('a delayed application cannot overwrite a newer manual profile edit',async t=>{
 const f=fixture(t);let release;f.hold(new Promise(resolve=>release=resolve));
 const pending=f.service.call({action:'apply',target:'avatar',id:f.items[0].id,digest:f.items[0].digest,expected_version:f.profile.read().version});
 while(!f.images.length)await new Promise(setImmediate);
 f.profile.update({name:'newer manual name'},f.profile.read().version);release();await assert.rejects(pending,e=>e.code==='version_conflict');
 assert.equal(f.profile.read().name,'newer manual name');assert.equal(f.profile.read().avatar,'');
});
test('rotation reserves once, preserves names and respects persisted deadlines',async t=>{
 const f=fixture(t);f.profile.update({mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:f.now()+60000}}},f.profile.read().version);
 await f.service.tick();assert.equal(f.images.length,0);f.advance(60000);await f.service.tick();
 const saved=f.profile.read();assert.equal(saved.avatar,data);assert.equal(saved.name,'original');assert.equal(saved.mediaRotation.avatar.nextAt,f.now()+60000);
 await f.service.tick();assert.equal(f.images.length,1);
 f.advance(86400000);await f.service.tick();assert.equal(f.profile.read().mediaRotation.avatar.nextAt,f.now()+60000,'missed periods are not replayed');
 assert.equal(f.profile.read().mediaRotation.avatar.id,f.items[1].id,'avoid the previous item when alternatives exist');
});
test('specialist rotations update their existing role profile and a manual avatar edit wins',async t=>{
 const f=fixture(t);f.profile.update({roles:{execution:{name:'Compiler',ring:'wave'},project:{name:'Researcher',ring:'orbit'}},mediaRotation:{cotaAvatar:{mode:'random',intervalSeconds:60,nextAt:0},vayaAvatar:{mode:'random',intervalSeconds:120,nextAt:0}}},f.profile.read().version);
 await f.service.tick();let saved=f.profile.read();assert.equal(saved.roles.execution.avatar,data);assert.equal(saved.roles.project.avatar,data);assert.equal(saved.roles.execution.name,'Compiler');assert.equal(saved.roles.project.ring,'orbit');assert.equal(saved.mediaRotation.cotaAvatar.nextAt,f.now()+60000);assert(!Object.hasOwn(saved,'cotaAvatar'));
 f.profile.update({roles:{execution:{avatar:''}}},saved.version);saved=f.profile.read();assert.notEqual(saved.mediaRotation.cotaAvatar.mode,'random');f.advance(60000);await f.service.tick();assert.equal(f.profile.read().roles.execution.avatar,'');assert.equal(f.profile.read().roles.project.avatar,data);
});
test('offline rotation retains the image and persists a retry deadline across reopening',async t=>{
 const f=fixture(t);f.profile.update({avatar:data,mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:0}}},f.profile.read().version);f.offline(true);
 await f.service.tick();assert.equal(f.profile.read().avatar,data);assert.equal(f.profile.read().mediaRotation.avatar.nextAt,f.now()+300000);
 const calls=f.calls.length;await f.service.tick();assert.equal(f.calls.length,calls);
 const reopened=createOfficialLibrary({client:f.client,profile:f.profile,decode:()=>data,now:f.now});await reopened.tick();reopened.close();assert.equal(f.calls.length,calls);
});
test('manual removal while rotation downloads wins and late account results are discarded',async t=>{
 const f=fixture(t);f.profile.update({mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:0}}},f.profile.read().version);
 let release;f.hold(new Promise(resolve=>release=resolve));const pending=f.service.tick();while(!f.images.length)await new Promise(setImmediate);
 f.profile.update({avatar:'',mediaRotation:{avatar:{mode:'off'}}},f.profile.read().version);release();await pending;assert.equal(f.profile.read().avatar,'');assert.equal(f.profile.read().mediaRotation.avatar.mode,'off');
 f.hold(new Promise(resolve=>release=resolve));const next=f.service.call({action:'prepare',target:'eyraAvatar',id:f.items[1].id,digest:f.items[1].digest});
 // Clear cached image path by using another valid digest in the fixture.
 f.logout();release();await assert.rejects(next,/过期/);
});
function contactProvider(count=1){
 const rows=new Map(Array.from({length:count},(_,i)=>{const id='contact-'+i;return [id,{id,name:'Contact '+i,avatar:'old-'+i,avatar_revision:1,avatar_rotation:{mode:'random',intervalSeconds:60,nextAt:0,id:'',digest:''}}];})),writes=[];
 let scans=0;
 return {rows,writes,get scans(){return scans;},async list(){scans++;return {contacts:[...rows.values()].map(({id,builtin,avatar_revision,avatar_rotation})=>({id,builtin,avatar_revision,avatar_rotation:structuredClone(avatar_rotation)}))};},async update(id,patch){
  writes.push({id,patch:structuredClone(patch)});const row=rows.get(id);if(!row||row.avatar_revision!==patch.avatar_expected_revision)throw Error('avatar revision conflict');
  const {avatar_expected_revision,...changes}=patch;Object.assign(row,changes,{avatar_revision:row.avatar_revision+1});return {ok:true,contact:structuredClone(row)};
 }};
}
test('contact rotations share the avatar pool, reserve before download and only update their avatar fields',async t=>{
 const contacts=contactProvider(3),f=fixture(t,{contactMedia:contacts});f.items.push(row('official.avatar-three'),row('official.avatar-four'));paginated(f);
 f.profile.update({mediaRotation:{avatar:{mode:'random',intervalSeconds:60,nextAt:0}}},f.profile.read().version);
 await f.service.tick();assert.equal(contacts.scans,1);assert.equal(contacts.writes.length,6);assert.equal(f.calls.filter(p=>p.action==='list').length,1);assert.equal(f.images.length,1);
 const ids=new Set([f.profile.read().mediaRotation.avatar.id]);
 for(const [index,contact]of [...contacts.rows.values()].entries()){
  assert.equal(contact.name,'Contact '+index);assert.equal(contact.avatar,data);assert.equal(contact.avatar_revision,3);assert.equal(contact.avatar_rotation.nextAt,f.now()+60000);ids.add(contact.avatar_rotation.id);
  assert.deepEqual(Object.keys(contacts.writes[index*2].patch).sort(),['avatar_expected_revision','avatar_rotation']);assert.equal(contacts.writes[index*2].patch.avatar_rotation.nextAt,f.now()+300000);assert.equal(contacts.writes[index*2+1].patch.avatar_expected_revision,2);
 }
 assert.equal(ids.size,4);await f.service.tick();assert.equal(contacts.writes.length,6,'not-yet-due contacts are metadata only');assert.equal(contacts.scans,1,'other ticks do not rescan before the contact deadline');
});
test('a manual contact edit wins over a late random avatar download',async t=>{
 const contacts=contactProvider(),f=fixture(t,{contactMedia:contacts});let release;f.hold(new Promise(resolve=>release=resolve));
 const pending=f.service.tick();while(!f.images.length)await new Promise(setImmediate);
 const contact=contacts.rows.get('contact-0');assert.equal(contact.avatar_revision,2);contact.avatar='new manual image';contact.avatar_revision++;contact.avatar_rotation={...contact.avatar_rotation,mode:'off'};
 release();await pending;assert.equal(contact.avatar,'new manual image');assert.equal(contact.avatar_rotation.mode,'off');assert.equal(contact.avatar_revision,3);
});
test('offline contact rotation preserves its image and retry deadline across reopening',async t=>{
 const contacts=contactProvider(),f=fixture(t,{contactMedia:contacts});f.offline(true);await f.service.tick();const contact=contacts.rows.get('contact-0');
 assert.equal(contact.avatar,'old-0');assert.equal(contact.avatar_rotation.nextAt,f.now()+300000);const requests=f.calls.length;f.service.close();
 const reopened=createOfficialLibrary({client:f.client,profile:f.profile,contactMedia:contacts,directory:path.join(f.directory,'cache'),decode:()=>data,now:f.now});t.after(()=>reopened.close());
 f.advance(60000);await reopened.tick();assert.equal(f.calls.length,requests);f.advance(240000);f.offline(false);await reopened.tick();assert.equal(contact.avatar,data);assert.equal(contact.avatar_rotation.nextAt,f.now()+60000);
});
test('contact metadata scans skip builtins and invalid or future preferences without reading images',async t=>{
 const contacts=contactProvider(5),f=fixture(t,{contactMedia:contacts});contacts.rows.get('contact-0').builtin='eyra';contacts.rows.get('contact-1').avatar_rotation.nextAt=f.now()+60000;contacts.rows.get('contact-2').avatar_rotation.mode='off';contacts.rows.get('contact-3').avatar_revision=null;contacts.rows.get('contact-4').avatar_rotation.intervalSeconds=1;
 await f.service.tick();assert.equal(contacts.writes.length,0);assert.equal(f.calls.length,0);assert.equal(f.images.length,0);
});
test('contact rotations are serial and bounded while other callers cannot overlap a tick',async t=>{
 const contacts=contactProvider(10),f=fixture(t,{contactMedia:contacts});let running=0,max=0;const update=contacts.update.bind(contacts);
 contacts.update=async(...args)=>{running++;max=Math.max(max,running);await new Promise(setImmediate);try{return await update(...args);}finally{running--;}};
 await Promise.all([f.service.tick(),f.service.tick()]);assert.equal(max,1);assert.equal(contacts.scans,1);assert.equal(contacts.writes.length,16);
 await f.service.tick();assert.equal(contacts.writes.length,20);assert([...contacts.rows.values()].every(contact=>contact.avatar===data));
});
test('a failed contact reservation cannot start a theme request, and closing discards an in-flight result',async t=>{
 const contacts=contactProvider(),f=fixture(t,{contactMedia:contacts}),update=contacts.update.bind(contacts);
 contacts.update=async()=>{throw Error('Core unavailable');};await f.service.tick();assert.equal(f.calls.length,0);assert.equal(contacts.rows.get('contact-0').avatar,'old-0');
 contacts.update=update;f.advance(60000);let release;f.hold(new Promise(resolve=>release=resolve));const pending=f.service.tick();while(!f.images.length)await new Promise(setImmediate);f.service.close();release();await pending;
 assert.equal(contacts.rows.get('contact-0').avatar,'old-0');assert.equal(contacts.writes.length,1);
});
test('asynchronous image decoding is coalesced and a failed decode remains retryable',async t=>{
 let attempts=0;const f=fixture(t,{decode:async()=>{await new Promise(setImmediate);if(++attempts===1)throw Error('decode failed');return data;}}),item=f.items[0];
 const request={action:'image',id:item.id,digest:item.digest,variant:'preview'};
 const first=await Promise.allSettled([f.service.call(request),f.service.call(request)]);
 assert(first.every(r=>r.status==='rejected'&&r.reason.message==='decode failed'));assert.equal(attempts,1);
 assert.equal((await f.service.call(request)).src,data);assert.equal(attempts,2);assert.equal(f.images.length,2);
 assert.equal(fs.existsSync(path.join(f.directory,'cache')),false,'display WebP must not become a persistent original');
});
test('account changes during asynchronous decoding discard the late result',async t=>{
 let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 const f=fixture(t,{decode:async()=>{started();await gate;return data;}}),item=f.items[0];
 const pending=f.service.call({action:'image',id:item.id,digest:item.digest,variant:'preview'});
 await ready;f.logout();release();await assert.rejects(pending,/过期/);
 assert.equal(f.profile.read().avatar,'');assert.equal(fs.existsSync(path.join(f.directory,'cache')),false);
});
test('closing releases the decoder once and blocks its late image',async t=>{
 let release,started,closes=0;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 const decode=async()=>{started();await gate;return data;};decode.close=()=>{closes++;};
 const f=fixture(t,{decode}),item=f.items[0],pending=f.service.call({action:'prepare',target:'avatar',id:item.id,digest:item.digest});
 await ready;f.service.close();f.service.close();release();await assert.rejects(pending,/过期/);
 assert.equal(closes,1);assert.equal(f.profile.read().avatar,'');assert.equal(fs.existsSync(path.join(f.directory,'cache')),false);
});

test('bundled UI and halo previews have persistent local likes without cloud votes or profile writes',async t=>{
 const f=fixture(t),before=f.profile.read().version;
 const ui=await f.service.call({action:'list',category:'ui'}),halos=await f.service.call({action:'list',category:'halo'});
 assert.equal(ui.items.length,1);assert.equal(halos.items.length,4);assert.equal(halos.nextCursor,null);assert(halos.items.every(item=>item.local&&item.likes===0&&item.previewKind==='halo'));
 const item=halos.items[0],request={action:'like',id:item.id,digest:item.digest,liked:true};
 assert.equal((await f.service.call(request)).item.likes,1);assert.equal((await f.service.call(request)).item.likes,1,'a repeated desired state is idempotent');
 const reopened=createOfficialLibrary({client:f.client,profile:f.profile,directory:path.join(f.directory,'cache'),decode:()=>data});t.after(()=>reopened.close());
 const saved=await reopened.call({action:'read',id:item.id,digest:item.digest});assert.equal(saved.item.liked,true);assert.equal(saved.item.digest,item.digest);
 assert.equal((await reopened.call({action:'list',category:'halo',q:item.title})).items.length,1);
 assert.equal((await reopened.call({action:'list',category:'ui',sort:'pending'})).items.length,0);
 await assert.rejects(reopened.call({...request,digest:'f'.repeat(64)}),/已更新/);
 await assert.rejects(reopened.call({action:'prepare',target:'avatar',id:item.id,digest:item.digest}),/对应主题/);
 await assert.rejects(reopened.call({action:'image',id:item.id,digest:item.digest,variant:'image'}),/不提供图片/);
 assert.equal((await reopened.call({...request,liked:false})).item.likes,0);
 assert.equal(f.calls.length,0);assert.equal(f.images.length,0);assert.equal(f.profile.read().version,before);
});

test('damaged local preview votes are preserved and never overwritten by a click',async t=>{
 const f=fixture(t),item=(await f.service.call({action:'list',category:'ui'})).items[0];
 const directory=path.join(f.directory,'cache');fs.mkdirSync(directory);const file=path.join(directory,'builtin-likes.json');fs.writeFileSync(file,'broken original');
 await assert.rejects(f.service.call({action:'like',id:item.id,digest:item.digest,liked:true}),/原记录已保留/);
 assert.equal(fs.readFileSync(file,'utf8'),'broken original');
});

const publicOrigin='https://public-themes.example.invalid';
function reopenPublic(t,f,client=f.client){const service=createOfficialLibrary({client,profile:f.profile,directory:path.join(f.directory,'cache'),decode:()=>data,now:f.now});t.after(()=>service.close());return service;}
function publicFiles(f){const root=path.join(f.directory,'cache'),dir=path.join(root,fs.readdirSync(root).find(name=>name.startsWith('public-')));return {dir,files:fs.readdirSync(dir)};}
const publicList={action:'list',category:'avatar'},publicImage=item=>({action:'image',id:item.id,digest:item.digest,variant:'preview'});

test('public catalogue and decoded display images survive reopening with correct account likes and no credentials',async t=>{
 const f=fixture(t,{origin:publicOrigin});f.items[0].liked=true;f.items[0].artifact.private='fixture-private-metadata-must-not-persist';
 const list=await f.service.call(publicList),image=publicImage(list.items[0]);await Promise.all([f.service.call(image),f.service.call(image)]);
 assert.equal(f.calls.length,1);assert.equal(f.images.length,1);f.service.close();
 const service=reopenPublic(t,f),cached=await service.call(publicList);assert.equal(cached.items[0].liked,true);
 assert.equal((await service.call(image)).src,data);assert.equal(f.calls.length,1);assert.equal(f.images.length,1);
 const {dir,files}=publicFiles(f);assert(files.some(name=>name.startsWith('catalogue-')));assert(files.some(name=>name.startsWith('display-')));
 const saved=files.map(name=>fs.readFileSync(path.join(dir,name),'utf8')).join('');assert(!saved.includes('fixture-private-metadata-must-not-persist'));assert(!saved.includes('accessToken'));assert(!files.some(name=>name.endsWith('.webp')));
});

test('catalogue TTL and explicit refresh have distinct boundaries',async t=>{
 const f=fixture(t,{origin:publicOrigin});await f.service.call(publicList);f.advance(14*60000);await f.service.call(publicList);assert.equal(f.calls.length,1);
 f.items[0]={...f.items[0],title:'updated after TTL'};f.advance(60001);assert.equal((await f.service.call(publicList)).items[0].title,'updated after TTL');assert.equal(f.calls.length,2);
 f.items[0]={...f.items[0],title:'explicit refresh'};assert.equal((await f.service.call({...publicList,refresh:true})).items[0].title,'explicit refresh');assert.equal(f.calls.length,3);
 f.service.close();assert.equal((await reopenPublic(t,f).call(publicList)).items[0].title,'explicit refresh');assert.equal(f.calls.length,3);
});

test('offline catalogue fallback is marked stale, bounded to one day and respects retry cooldown',async t=>{
 const f=fixture(t,{origin:publicOrigin}),item=(await f.service.call(publicList)).items[0];await f.service.call(publicImage(item));f.advance(16*60000);f.offline(true);
 assert.equal((await f.service.call(publicList)).stale,true);const requests=f.calls.length;
 assert.equal((await f.service.call(publicList)).stale,true);assert.equal(f.calls.length,requests);
 await assert.rejects(f.service.call({...publicList,refresh:true}),/offline/);assert.equal(f.calls.length,requests,'explicit refresh cannot evade an active cooldown');
 assert.equal((await f.service.call(publicImage(item))).src,data);assert.equal(f.images.length,1);
 f.advance(5000);assert.equal((await f.service.call(publicList)).stale,true);assert.equal(f.calls.length,requests+1);
 f.advance(24*60*60000);await assert.rejects(f.service.call(publicList),/offline/);
});

test('damaged optional public caches are replaced by verified network results',async t=>{
 const f=fixture(t,{origin:publicOrigin}),item=(await f.service.call(publicList)).items[0];await f.service.call(publicImage(item));f.service.close();
 const {dir,files}=publicFiles(f);for(const file of files)fs.writeFileSync(path.join(dir,file),'damaged fixture');
 const service=reopenPublic(t,f);await service.call(publicList);await service.call(publicImage(item));assert.equal(f.calls.length,2);assert.equal(f.images.length,2);
 for(const file of files)assert.equal(JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')).version,1);
});

test('an unsuccessful explicit refresh preserves a stale directory for a later reopening',async t=>{
 const f=fixture(t,{origin:publicOrigin}),original=await f.service.call(publicList);f.advance(16*60000);f.offline(true);
 await assert.rejects(f.service.call({...publicList,refresh:true}),/offline/);f.service.close();
 const service=reopenPublic(t,f),saved=await service.call(publicList);assert.equal(saved.stale,true);assert.deepEqual(saved.items,original.items);
});

test('public display cache is source-bound and expires after thirty days',async t=>{
 const f=fixture(t,{origin:publicOrigin}),item=(await f.service.call(publicList)).items[0];await f.service.call(publicImage(item));f.service.close();
 const other=reopenPublic(t,f,{...f.client,themeOrigin:'https://different-source.example.invalid'});await other.call(publicList);await other.call(publicImage(item));assert.equal(f.calls.length,2);assert.equal(f.images.length,2);other.close();
 f.advance(30*24*60*60000+1);const service=reopenPublic(t,f);await service.call(publicList);await service.call(publicImage(item));assert.equal(f.images.length,3);
});

test('catalogue snapshots remain isolated when the authenticated account changes',async t=>{
 const f=fixture(t,{origin:publicOrigin});f.items[0].liked=true;await f.service.call(publicList);f.service.close();
 f.client.status=()=>({signedIn:true,user:{id:'another-account'}});f.items[0]={...f.items[0],liked:false};const another=reopenPublic(t,f);assert.equal((await another.call(publicList)).items[0].liked,false);another.close();assert.equal(f.calls.length,2);
 f.client.status=()=>({signedIn:true,user:{id:'fixture'}});const original=reopenPublic(t,f);assert.equal((await original.call(publicList)).items[0].liked,true);original.close();assert.equal(f.calls.length,2,'the original account retains its own disk snapshot');
 // Signed out uses only the bundled defaults: no request and no shared anonymous snapshot.
 f.client.status=()=>({signedIn:false,user:null});assert.ok((await reopenPublic(t,f).call(publicList)).items.every(item=>item.bundled));assert.equal(f.calls.length,2);assert.equal(publicFiles(f).files.filter(name=>name.startsWith('catalogue-')).length,2);
});

test('a signed-in client without a stable account ID never reads or persists a shared catalogue scope',async t=>{
 const f=fixture(t,{origin:publicOrigin});f.client.status=()=>({signedIn:true,user:{}});await f.service.call(publicList);f.service.close();
 await reopenPublic(t,f).call(publicList);assert.equal(f.calls.length,2);assert.equal(fs.existsSync(path.join(f.directory,'cache')),false);
});

test('a failed public catalogue request is shared and retries only after its deadline',async t=>{
 const f=fixture(t,{origin:publicOrigin});f.offline(true);const rejected=await Promise.allSettled([f.service.call(publicList),f.service.call(publicList),f.service.call(publicList)]);
 assert(rejected.every(row=>row.status==='rejected'));assert.equal(f.calls.length,1);await assert.rejects(f.service.call(publicList),/offline/);assert.equal(f.calls.length,1);
 f.advance(5000);f.offline(false);await f.service.call(publicList);assert.equal(f.calls.length,2);
});

test('a successful like invalidates persisted public pages and rejects an older in-flight catalogue',async t=>{
 const f=fixture(t,{origin:publicOrigin});await f.service.call(publicList);let release,started;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve),old={...f.items[0]};let hold=true;
 f.client.themeRequest=async p=>{f.calls.push(p);if(p.action==='list'){if(hold){started();await gate;return {items:[old],nextCursor:null};}return {items:f.items,nextCursor:null};}return {item:f.items[0]={...f.items[0],liked:true,likes:1}};};
 const pending=f.service.call({...publicList,refresh:true});await ready;const liked=await f.service.call({action:'like',id:old.id,digest:old.digest,liked:true});assert.equal(liked.item.liked,true);
 release();await assert.rejects(pending,/已刷新/);hold=false;
 assert.equal((await f.service.call(publicList)).items[0].liked,true);f.service.close();
 const service=reopenPublic(t,f);const cached=await service.call(publicList);assert.equal(cached.items[0].likes,1);assert.equal(cached.items[0].liked,true,'the same authenticated account retains its authoritative liked result');
});

test('signed out the library offers only the ten bundled backgrounds and avatars, verified from disk, then official items after login',async t=>{
 const decoded=[];const f=fixture(t,{decode:(bytes,options)=>{decoded.push({size:bytes.length,...options});return options.category==='avatar'?data:'data:image/jpeg;base64,AAAA';}});
 f.client.status=()=>({signedIn:false,user:null});
 const backgrounds=await f.service.call({action:'list',category:'background'}),avatars=await f.service.call({action:'list',category:'avatar'});
 assert.equal(backgrounds.items.length,10);assert.equal(avatars.items.length,10);assert.equal(f.calls.length,0,'no network while signed out');
 assert.ok([...backgrounds.items,...avatars.items].every(item=>item.bundled&&item.official&&item.status==='approved'&&item.author.name==='Aieyra OS'));
 const bg=backgrounds.items[0];await f.service.call({action:'image',id:bg.id,digest:bg.digest,variant:'preview'});
 assert.equal(decoded[0].category,'background');assert.equal(decoded[0].preview,true);assert.equal(f.images.length,0);
 const prepared=await f.service.call({action:'prepare',target:'avatar',mode:'random',intervalSeconds:3600});
 assert.ok(prepared.item.bundled);assert.equal(prepared.item.category,'avatar');assert.equal(decoded.at(-1).variant,'file');assert.equal(decoded.at(-1).width,256);
 f.client.status=()=>({signedIn:true,user:{id:'fixture'}});
 const official=await f.service.call({action:'list',category:'avatar',refresh:true});assert.ok(official.items.every(item=>!item.bundled));assert.equal(f.calls.length,1);
 assert.ok((await f.service.call({action:'read',id:prepared.item.id,digest:prepared.item.digest})).item.bundled,'an already chosen bundled image stays readable after login');
});
