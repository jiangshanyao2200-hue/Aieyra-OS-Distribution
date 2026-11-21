// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: root; selection
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/theme-assets.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validateTheme}=require('../../../Theme/contract/definition.mjs');
const {assetURL,assetCSS,fontFaces}=require('../../../Theme/contract/assets.mjs');
const {createThemeAssets}=require('../../../Theme/runtime/assets.cjs');
const {readPackage}=require('../host/mod-packages.cjs');
const root=path.resolve(__dirname,'../../../SDK/examples/theme-assets'),definition=JSON.parse(fs.readFileSync(path.join(root,'theme.json'))),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
const selection={id:manifest.id,digest:'a'.repeat(64),definition};
test('theme asset references enforce inert formats, declared types and complete reference values',()=>{
 assert.equal(validateTheme(definition),definition);
 for(const patch of [
  {assets:{paper:{path:'assets/../secret.png',mime:'image/png'}}},
  {assets:{paper:{path:'assets/a.svg',mime:'image/svg+xml'}}},
  {styles:[{element:'body',properties:{background:'asset(missing)'}}]},
  {styles:[{element:'body',properties:{'font-family':'asset(paper)'}}]},
  {styles:[{element:'body',properties:{background:'asset(paper), url(https://example.invalid/a)'}}]},
  {styles:[{element:'body',properties:{background:'asset (paper)'}}]},
  {tokens:{'--ui-image':'asset (paper)'}},
 ])assert.throws(()=>validateTheme({...definition,...patch}));
 assert.equal(assetCSS('background','asset(paper)',selection),'url("'+assetURL(selection,'paper')+'")');
 assert.match(assetCSS('font-family','asset(text)',selection),/sans-serif$/);assert.match(fontFaces(selection),/font-display:swap/);
});
test('asset server supplies only current admitted package resources and revokes in-flight reads',async()=>{
 let selected=selection,enabled=true,resume=null,delay=false,reads=0;
 const item={manifest,directory:root,digest:selection.digest,enabled:true};
 const runtime=createThemeAssets({current:()=>selected,readPackage:p=>{reads++;return readPackage(p);},resolve:async()=>{if(delay)await new Promise(r=>{resume=r;});if(!enabled)throw Error('disabled');return item;}});
 const request=(id='paper')=>({url:assetURL(selection,id),method:'GET'});
 let response=await runtime.serve(request());assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(root,'assets/paper.png')));
 response=await runtime.serve(request('text'));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');assert.equal(reads,1);
 for(const url of [assetURL(selection,'missing'),assetURL(selection,'paper')+'?file=secret',assetURL(selection,'paper').replace('/paper','/%2e%2e/secret'),assetURL({...selection,digest:'b'.repeat(64)},'paper')])assert.notEqual((await runtime.serve({url,method:'GET'})).status,200);
 assert.equal((await runtime.serve({...request(),method:'POST'})).status,400);
 delay=true;const pending=runtime.serve(request());await new Promise(r=>setImmediate(r));selected=null;runtime.invalidate();resume();assert.equal((await pending).status,410);
 delay=false;selected=selection;enabled=false;assert.equal((await runtime.serve(request())).status,404);
 enabled=true;runtime.close();assert.equal((await runtime.serve(request())).status,410);
});
