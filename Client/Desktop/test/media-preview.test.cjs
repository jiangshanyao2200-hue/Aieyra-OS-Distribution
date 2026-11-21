// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; wave; box
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/media-preview.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {mediaType,previewAttachmentMedia}=require('../host/media-preview.cjs');
const {createAttachmentStore}=require('../host/attachments.cjs');
function wave(){const data=Buffer.alloc(16044);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(8000,24);data.writeUInt32LE(16000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);return data;}
function box(kind,bytes){const header=Buffer.alloc(8);header.writeUInt32BE(8+bytes.length);header.write(kind,4);return Buffer.concat([header,bytes]);}
test('media recognition requires bounded container structure, never a filename or active content',()=>{
 assert.equal(mediaType(wave()),'audio/wav');
 const webm=Buffer.from('1a45dfa3874282847765626d185380678101','hex');assert.equal(mediaType(webm),'video/webm');
 const mp4=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',Buffer.from([0])),box('mdat',Buffer.from([0]))]);assert.equal(mediaType(mp4),'video/mp4');
 const audio=Buffer.from(mp4);audio.write('M4A ',8);assert.equal(mediaType(audio),'audio/mp4');
 for(const bytes of [Buffer.from('<video src="https://example.invalid">'),Buffer.from('RIFF0000WAVE'),wave().subarray(0,50),webm.subarray(0,10),mp4.subarray(0,mp4.length-1),box('ftyp',Buffer.from('isom0000'))])assert.throws(()=>mediaType(bytes));
 const huge=Buffer.from(mp4);huge.writeUInt32BE(0xffffffff);assert.throws(()=>mediaType(huge),/不完整/);
 const ebml=Buffer.from(webm);ebml[4]=0xff;assert.throws(()=>mediaType(ebml),/不完整/);
});
test('media preview returns only owned hash-verified immutable bytes and preserves file send semantics',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-media-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=createAttachmentStore(path.join(dir,'private','config.json'));
 const source=path.join(dir,'声音.wav'),data=wave();await fs.writeFile(source,data);
 const [attachment]=await store.stage([source]);assert.equal(attachment.kind,'file');assert.equal(attachment.mime,'application/octet-stream');
 await fs.writeFile(source,'changed source');const result=await previewAttachmentMedia(store,attachment);assert.equal(result.mime,'audio/wav');assert.deepEqual(result.bytes,data);
 await assert.rejects(previewAttachmentMedia(store,{...attachment,asset:source}),/不属于/);
 await assert.rejects(previewAttachmentMedia(store,{...attachment,bytes:1}),/发生变化/);
 await fs.writeFile(attachment.asset,'corrupt snapshot');await assert.rejects(previewAttachmentMedia(store,attachment),/发生变化/);assert.deepEqual(result.bytes,data);
 const [fake]=await store.stageFileBytes({name:'renamed.mp4',bytes:Buffer.from('<html>not media</html>')});await assert.rejects(previewAttachmentMedia(store,fake),/暂不支持/);assert.deepEqual(await store.verify([fake]),[fake]);
});
