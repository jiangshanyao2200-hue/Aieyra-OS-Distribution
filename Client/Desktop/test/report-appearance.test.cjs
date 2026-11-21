// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/report-appearance.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
test('inert HTML reports inherit changed theme without reloading the document',async()=>{
 const {reportAppearance,refreshHTMLAppearance}=await import('../ui/html-document.mjs');
 const tokens={'--ui-text':'#18202a','--ui-text-2':'#526070','--ui-accent':'#036650','--ui-glass-soft':'rgba(255,255,255,.9)'};
 const source={body:{},defaultView:{getComputedStyle:()=>({colorScheme:'dark',fontFamily:'"Readable Font", sans-serif',getPropertyValue:name=>tokens[name]||''})}};
 const assigned={},frame={documentElement:{style:{setProperty:(name,value)=>assigned[name]=value}},scrollingElement:{scrollTop:800}};
 refreshHTMLAppearance(frame,source);assert.equal(assigned['--report-text'],'#18202a');assert.equal(assigned['--report-font'],'"Readable Font", sans-serif');assert.equal(assigned['--report-scheme'],'dark');assert.equal(assigned['--report-left-room'],'168px');
 assert.equal(assigned['--report-right-room'],'0px','no report entry means no extra right reservation');
 const entry={hidden:false};source.getElementById=id=>id==='report-orb'?entry:null;tokens['--rail-panel-right']='72px';refreshHTMLAppearance(frame,source);assert.equal(assigned['--report-right-room'],'calc(72px + 4px)');
 tokens['--rail-panel-right']='126px';refreshHTMLAppearance(frame,source);assert.equal(assigned['--report-right-room'],'calc(126px + 4px)');assert.equal(frame.scrollingElement.scrollTop,800,'updating rail space does not reload the reader');
 entry.hidden=true;refreshHTMLAppearance(frame,source);assert.equal(assigned['--report-right-room'],'0px');
 tokens['--ui-text']='#e6e9f0';refreshHTMLAppearance(frame,source);assert.equal(assigned['--report-text'],'#e6e9f0');assert.equal(frame.scrollingElement.scrollTop,800);
 tokens['--ui-text']='</style><script>invalid</script>';assert.equal(reportAppearance(source)['--report-text'],'CanvasText');
});
