"use strict";
const { randomUUID } = require("node:crypto");
const { resolveModelAdapter, normalizeAdapter, applyParameters } = require("./provider-adapters.cjs");
const { streamAdaptedResponse } = require("../agent/coding-protocol.cjs");
const { sseEvents, readJsonResponse } = require("./provider-transport.cjs");
// Diagnostic messages contain no project/user documents and never execute tools.
async function probeModel(provider, input, {fetchImpl=fetch, signal}={}) {
  const model=String(input.model||"");
  if(!provider.models.includes(model))throw Error("请先读取目录或手动添加这个模型。");
  const adapter=normalizeAdapter(input.adapter||{}), known=resolveModelAdapter(provider,model);
  const candidates=input.protocols||[known.protocol];
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>4||candidates.some(p=>!["responses","chat","anthropic","google"].includes(p)))throw Error("探测最多指定四种协议。");
  const nonce=randomUUID(), results=[];let requests=0;
  for(const protocol of [...new Set(candidates)]){
    const probeProvider=Object.create(provider);
    Object.defineProperty(probeProvider,"modelAdapters",{value:{...provider.modelAdapters,[model]:{...provider.modelAdapters?.[model],...adapter,protocol,supportsTools:true,maxOutputTokens:1024}}});
    const profile=resolveModelAdapter(probeProvider,model), continuity={};
    const request={model,input:[{role:"user",content:[{type:"input_text",text:`Call connection_probe with value "${nonce}" exactly once. After its result reply OK.`}]}],
      tools:[{type:"function",name:"connection_probe",description:"Connectivity test only; no side effects.",parameters:{type:"object",properties:{value:{type:"string"}},required:["value"],additionalProperties:false}}],max_output_tokens:1024,stream:true};
    const started=Date.now();
    async function run(body){
      requests++;const timeout=AbortSignal.timeout(25000), combined=signal?AbortSignal.any([timeout,signal]):timeout;
      if(protocol!=="responses")return streamAdaptedResponse(body,probeProvider,{continuity,fetchImpl,signal:combined});
      const response=await fetchImpl(provider.endpoint("/responses"),{method:"POST",redirect:"error",signal:combined,headers:provider.authorizeRequestHeaders({"Content-Type":"application/json"}),body:JSON.stringify(applyParameters(body,profile))});
      if(!response.ok){const error=Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
      if(!response.headers.get("content-type")?.includes("text/event-stream"))return readJsonResponse(response);
      let final;
      for await(const event of sseEvents(response.body)){if(event.type==="response.failed"||event.type==="error")throw Error("模型探测未完成。");if(event.type==="response.completed")final=event.response;}
      if(!final)throw Error("探测未收到完整完成回执。");return final;
    }
    try{
      const first=await run(request),calls=(first.output||[]).filter(item=>item.type==="function_call");
      const call=calls[0];let valid=false;try{valid=calls.length===1&&call.name==="connection_probe"&&JSON.parse(call.arguments).value===nonce;}catch{}
      if(!valid){results.push({protocol,state:"request_accepted",toolRoundTrip:false,reason:"未返回有效的测试工具调用",elapsedMs:Date.now()-started});continue;}
      const second=await run({...request,input:[...request.input,...first.output,{type:"function_call_output",call_id:call.call_id,output:JSON.stringify({ok:true,value:nonce})}]});
      const completed=second.status==="completed"&&!(second.output||[]).some(item=>item.type==="function_call")&&(second.output||[]).some(item=>item.type==="message"&&item.content?.some(p=>p.text));
      results.push({protocol,state:completed?"tool_round_trip_verified":"request_accepted",toolRoundTrip:completed,elapsedMs:Date.now()-started});
      if(completed)break;
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      const status=Number(error.status||0);results.push({protocol,state:[400,404,405,422].includes(status)?"rejected":"inconclusive",status,error:provider.scrubPublicText?.(error.message)||error.message,elapsedMs:Date.now()-started});
      if([401,402,403,429].includes(status))break;
    }
  }
  return {model,checkedAt:new Date().toISOString(),requests,results,suggestedProtocol:results.find(r=>r.toolRoundTrip)?.protocol||null,
    parameters:adapter,semanticSupport:"探测仅验证本次请求与工具往返；思考参数是否生效、长任务质量及最大上下文尚未证明。",applied:false};
}
module.exports={probeModel};
