// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/probe-auto.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {probe}=require('../src/system-settings.cjs');

for(const protocol of ['responses','chat_completions']) {
 for(const behavior of ['valid','direct_answer','extra_argument','wrong_nonce','extra_call','followup_call','prompt_echo','incomplete']) {
  test(`${protocol}: auto-only endpoint ${behavior}`,async t=>{
   const original=global.fetch,requests=[];t.after(()=>global.fetch=original);
   global.fetch=async(url,options)=>{
    if(url.endsWith('/models'))return Response.json({data:[{id:'auto-only'}]});
    const body=JSON.parse(options.body);requests.push(body);
    // Mirrors the actual 400 restriction without accepting named/none fallback.
    if(body.tool_choice!=='auto')return Response.json({error:'only auto supported'}, {status:400});
    const isResponses=protocol==='responses',fn=isResponses?body.tools[0]:body.tools[0].function;
    const nonce=fn.parameters.properties.token.enum[0],tail=(body.input||body.messages).at(-1);
    const follow=tail.type==='function_call_output'||tail.role==='tool';
    const token=behavior==='wrong_nonce'?'wrong':nonce;
    const args=JSON.stringify({token,...(behavior==='extra_argument'?{unexpected:true}:{})});
    const item=isResponses?{type:'function_call',call_id:'one',name:fn.name,arguments:args}:{id:'one',type:'function',function:{name:fn.name,arguments:args}};
    const returnsCall=!follow&&behavior!=='direct_answer'||follow&&behavior==='followup_call';
    const items=behavior==='extra_call'?[item,{...item,id:'two',call_id:'two'}]:[item];
    const text=behavior==='prompt_echo'||behavior==='direct_answer'?nonce:(tail.output||tail.content);
    if(isResponses)return Response.json({id:follow?'second':'first',status:behavior==='incomplete'?'incomplete':'completed',output:returnsCall?items:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
    return Response.json({choices:[{finish_reason:behavior==='incomplete'?'length':returnsCall?'tool_calls':'stop',message:{role:'assistant',reasoning_content:null,...(returnsCall?{tool_calls:items}:{content:text})}}]});
   };
   const result=await probe({base_url:'https://opencode.ai/zen/go/v1',api_key:'fixture-only',model:'auto-only',api_protocol:protocol},'alpha-auto-probe');
   assert.equal(result.ok,behavior==='valid',JSON.stringify(result));
   assert(requests.length>=1&&requests.length<=2);
   if(behavior==='valid'){
    assert.equal(requests.length,2);assert.equal(result.verified_options.tool_choice,'auto');
    const first=requests[0],second=requests[1],follow=(second.input||second.messages).at(-1);
    assert(!JSON.stringify(first).includes(follow.output||follow.content),'secret answer was leaked before tool execution');
    assert.deepEqual(second.tools,first.tools,'tool schema changed within probe');
    if(protocol==='chat_completions')assert.equal(second.messages[1].reasoning_content,null);
   }
  });
 }
}
