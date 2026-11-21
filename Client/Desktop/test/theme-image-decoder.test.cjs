// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; samples; container
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-image-decoder.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webpSize,createThemeImageDecoder}=require('../host/theme-image-decoder.cjs');
const samples=require('../../../AIDEBUG/fixtures/theme-webp.json');
const {webp}=require('../../../AIDEBUG/fixtures/official-themes.cjs');
function container(chunks){
 const head=Buffer.alloc(12);head.write('RIFF');head.write('WEBP',8);
 const bytes=Buffer.concat([head,...chunks.flatMap(([type,data])=>{const h=Buffer.alloc(8);h.write(type);h.writeUInt32LE(data.length,4);return [h,data,...(data.length&1?[Buffer.alloc(1)]:[])];})]);bytes.writeUInt32LE(bytes.length-8,4);return bytes;
}
test('real lossy and transparent lossless WebP headers are accepted without trusting filenames',()=>{
 assert.deepEqual(webpSize(Buffer.from(samples.background.image,'base64')),{width:1920,height:1080});
 assert.deepEqual(webpSize(webp(samples.background.preview,'catalogue item')),{width:480,height:270});
 assert.deepEqual(webpSize(Buffer.from(samples.avatar.preview,'base64')),{width:256,height:256});
 assert.deepEqual(webpSize(Buffer.from(samples.lossless,'base64')),{width:16,height:16});
});
test('truncated, animated, missing and excessive raster dimensions fail before Chromium allocation',()=>{
 const original=Buffer.from(samples.background.preview,'base64');
 assert.throws(()=>webpSize(original.subarray(0,-1)),/格式无效/);
 assert.throws(()=>webpSize(container([['JUNK',Buffer.from('no image')]])),/尺寸无效/);
 assert.throws(()=>webpSize(container([['ANIM',Buffer.alloc(6)]])),/静态/);
 const extended=Buffer.alloc(10),frame=Buffer.from('0000009d012a00000000','hex');extended.writeUIntLE(7999,4,3);extended.writeUIntLE(7999,7,3);frame.writeUInt16LE(8000,6);frame.writeUInt16LE(8000,8);
 assert.throws(()=>webpSize(container([['VP8X',extended],['VP8 ',frame]])),/过大/);
 extended[0]=2;assert.throws(()=>webpSize(container([['VP8X',extended],['VP8 ',frame]])),/静态/);
});
test('PNG originals never require a Chromium surface and decoder close is final',async()=>{
 let surfaces=0;
 const nativeImage={createFromBuffer(){return {isEmpty:()=>false,getSize:()=>({width:512,height:512}),crop(){return this;},resize(){return this;},toPNG:()=>Buffer.from('encoded PNG')};}};
 const decode=createThemeImageDecoder({nativeImage,BrowserWindow:class{constructor(){surfaces++;}}});
 assert.match(await decode(Buffer.from('PNG'),{category:'avatar',variant:'file',width:512,height:512}),/^data:image\/png;base64,/);
 assert.equal(surfaces,0);
 await assert.rejects(decode(Buffer.from(samples.background.preview,'base64'),{variant:'file'}),/PNG/);assert.equal(surfaces,0);
 decode.close();await assert.rejects(decode(Buffer.from('PNG')),/已关闭/);
});
