// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; fs; runtimeRoot; hash; ff; settle
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/workspace-video.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {createCanvasVideoMedia}=require('../../../Program/official/workspace/video-media.cjs');
const runtimeRoot=path.resolve(__dirname,'../../../runtime/media');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const ff=(name,args,options={})=>execFileSync(path.join(runtimeRoot,name+'.exe'),args,{windowsHide:true,timeout:60000,...options});
async function settle(service,requestId){const deadline=Date.now()+90000;for(;;){const r=await service.call('canvas','status',{requestId});if(!['queued','running','cancelling'].includes(r.job.state))return r;if(Date.now()>deadline)throw Error('Video export did not settle');await new Promise(r=>setTimeout(r,50));}}

test('real video trims, order, sound, range reads, CAS and reopening share one durable service',{skip:process.platform!=='win32',timeout:120000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-video-')),data=path.join(root,'data');
 let service=createCanvasVideoMedia({root:data,runtimeRoot});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const blue=path.join(root,'blue.mp4'),red=path.join(root,'red.mp4');
 ff('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=blue:s=320x240:r=12:d=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',blue]);
 ff('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=red:s=640x360:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',red]);
 const originals=[hash(blue),hash(red)],a=(await service.call('canvas','import',{path:blue})).asset,b=(await service.call('canvas','import',{path:red})).asset;
 assert.equal(a.audio,false);assert.equal(b.audio,true);assert.equal((await service.call('canvas','import',{path:blue})).asset.id,a.id);
 await assert.rejects(service.call('other','create',{clips:[{assetId:a.id,start:0,end:1}]}),/不属于/);
 await assert.rejects(service.call('canvas','create',{clips:[{assetId:a.id,start:1,end:3}]}),/范围/);
 let timeline=(await service.call('canvas','create',{name:'剪辑证据',clips:[{assetId:b.id,start:0,end:1},{assetId:a.id,start:0,end:1}]})).timeline;
 const stale=timeline.revision;timeline=(await service.call('canvas','update',{...timeline,clips:[{assetId:a.id,start:.2,end:.8},{assetId:b.id,start:.2,end:1.2}]})).timeline;
 await assert.rejects(service.call('canvas','update',{...timeline,revision:stale}),/另一个入口/);
 await service.call('canvas','export',{id:timeline.id,revision:timeline.revision,requestId:'ordered-export'});
 const result=await settle(service,'ordered-export');assert.equal(result.job.state,'completed',result.job.error);
 const output=service.assetPath('canvas',result.asset.id),probe=JSON.parse(ff('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));
 assert.ok(Math.abs(Number(probe.format.duration)-1.6)<.15,probe.format.duration);
 const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,1280);assert.equal(video.height,720);assert.equal(video.avg_frame_rate,'30/1');assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
 const pixel=time=>[...ff('ffmpeg',['-v','error','-nostdin','-ss',String(time),'-i',output,'-frames:v','1','-vf','crop=16:16:640:360,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])];
 const first=pixel(.1),second=pixel(1.2);assert.ok(first[2]>180&&first[0]<40,first);assert.ok(second[0]>180&&second[2]<40,second);
 const response=service.response(result.asset.id,new Request(result.asset.src,{headers:{Range:'bytes=16-31'}}));assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(output).subarray(16,32));
 assert.equal(service.response(result.asset.id,new Request(result.asset.src,{headers:{Range:'bytes=999999999-'}})).status,416);
 assert.deepEqual([hash(blue),hash(red)],originals,'imports and export cannot modify source videos');
 const exportedHash=hash(output);await service.close();service=createCanvasVideoMedia({root:data,runtimeRoot});
 assert.deepEqual((await service.call('canvas','list')).timelines,[timeline]);
 const repeated=await service.call('canvas','export',{id:timeline.id,revision:timeline.revision,requestId:'ordered-export'});assert.equal(repeated.job.state,'completed');assert.equal(service.active(),false);assert.equal(hash(output),exportedHash);
 const empty=(await service.call('canvas','update',{...timeline,clips:[]})).timeline;assert.equal(empty.clips.length,0);
 await assert.rejects(service.call('canvas','export',{id:empty.id,revision:empty.revision,requestId:'empty'}),/片段/);
});

test('cancellation and service close leave a durable stopped export; an ID never silently restarts',{skip:process.platform!=='win32',timeout:90000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-video-cancel-')),source=path.join(root,'sample.mp4');let service=createCanvasVideoMedia({root:path.join(root,'data'),runtimeRoot});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 ff('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=2','-c:v','libx264','-threads','1',source]);
 const asset=(await service.call('canvas','import',{path:source})).asset,timeline=(await service.call('canvas','create',{clips:Array.from({length:10},()=>({assetId:asset.id,start:0,end:2}))})).timeline;
 await service.call('canvas','export',{id:timeline.id,revision:timeline.revision,requestId:'cancel-me'});const cancelled=await service.call('canvas','cancel',{requestId:'cancel-me'});assert.equal(cancelled.job.state,'cancelled');assert.equal(service.active(),false);
 await service.close();service=createCanvasVideoMedia({root:path.join(root,'data'),runtimeRoot});
 assert.equal((await service.call('canvas','export',{id:timeline.id,revision:timeline.revision,requestId:'cancel-me'})).job.state,'cancelled');assert.equal(service.active(),false);
 await service.call('canvas','export',{id:timeline.id,revision:timeline.revision,requestId:'close-me'});await service.close();service=createCanvasVideoMedia({root:path.join(root,'data'),runtimeRoot});
 assert.equal((await service.call('canvas','status',{requestId:'close-me'})).job.state,'cancelled');assert.equal((await service.call('canvas','list')).assets.length,1);
});
