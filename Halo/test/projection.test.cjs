// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Halo/test/projection.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {instrumentFrame,paintInstrument}=require('../../Client/Desktop/ui/eyra-instrument.mjs');
function fixture(){
 let label='Eyra';const node={dataset:{state:'thinking',haloCustom:'local.package',haloPaused:'false'},getAttribute:()=>label,setAttribute:(_key,value)=>label=value,querySelector:()=>null};
 const avatar={getAttribute:()=>'',removeAttribute(){},hidden:true},glyph={textContent:'',hidden:true};
 return {node,doc:{getElementById:id=>({'presence':node,'presence-avatar':avatar,'presence-glyph':glyph})[id]}};
}
test('instrument projections carry semantic state without another surface pause or runtime ownership',()=>{
 const f=fixture(),frame=instrumentFrame(f.doc);assert.deepEqual(frame.data,{state:'thinking'});assert.equal(frame.code,'');
 paintInstrument({...frame,data:{state:'tool',haloPaused:'true',haloCustom:'foreign.package'}},f.doc);
 assert.deepEqual(f.node.dataset,{state:'tool',haloCustom:'local.package',haloPaused:'false'});
 paintInstrument({...frame,data:{state:'idle'}},f.doc);assert.equal(f.node.dataset.haloCustom,'local.package');
});
