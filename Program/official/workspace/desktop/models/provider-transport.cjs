"use strict";
const { randomUUID } = require("node:crypto");
const { applyParameters } = require("./provider-adapters.cjs");
const textOf = value => typeof value === "string" ? value : (value || []).map(p=>p.text||"").filter(Boolean).join("\n");
function imagePart(url, google) {
  const data = /^data:([^;]+);base64,([\s\S]+)$/.exec(url);
  if (data) return google ? { inlineData: { mimeType:data[1],data:data[2] } } : { type:"image",source:{type:"base64",media_type:data[1],data:data[2]} };
  if (google) throw Error("Google 图片工具输入需要实际图片内容，请先读取图片。");
  return {type:"image",source:{type:"url",url}};
}
function nativeRequest(chat, profile) {
  if (profile.protocol === "chat") return applyParameters(chat, profile);
  const google = profile.protocol === "google", messages = [], system = [], callNames = new Map();
  const parts = content => typeof content === "string" ? [{ ...(google ? {} : {type:"text"}),text:content }] : (content || []).flatMap(p =>
    p.type === "text" ? [{ ...(google ? {} : {type:"text"}),text:p.text }] : p.type === "image_url" ? [imagePart(p.image_url.url,google)] : []);
  for (const message of chat.messages) {
    if (["system","developer"].includes(message.role) && !messages.length) { system.push(textOf(message.content)); continue; }
    let role = message.role === "assistant" ? google ? "model" : "assistant" : "user", content;
    if (message.role === "tool") {
      const call = callNames.get(message.tool_call_id);
      if (!call) throw Error("工具回执缺少对应调用，请恢复完整会话。");
      content = google ? [{functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{result:textOf(message.content)}}}] : [{type:"tool_result",tool_use_id:message.tool_call_id,content:parts(message.content)}];
    } else if (Array.isArray(message._nativeContent)) {
      content = structuredClone(message._nativeContent);
    } else {
      content = parts(message.content).filter(p=>p.text!=="");
      for (const call of message.tool_calls || []) {
        const args = JSON.parse(call.function.arguments || "{}");
        content.push(google ? { functionCall:{name:call.function.name,args}, ...(call.extra_content?.google?.thought_signature ? {thoughtSignature:call.extra_content.google.thought_signature} : {}) } : {type:"tool_use",id:call.id,name:call.function.name,input:args});
      }
    }
    const returnedCalls = (message._nativeContent || []).filter(p=>p.functionCall);
    for (const [index,call] of (message.tool_calls || []).entries()) callNames.set(call.id,{name:call.function.name,id:returnedCalls[index]?.functionCall?.id});
    if (!content.length) continue;
    const previous = messages.at(-1);
    if (previous?.role === role) previous[google ? "parts" : "content"].push(...content);
    else messages.push({role,[google ? "parts" : "content"]:content});
  }
  const tools = (chat.tools || []).map(t=>t.function);
  const limit = Math.min(chat.max_tokens || profile.maxOutputTokens || 8192, profile.maxOutputTokens || 10000000);
  if (google) return applyParameters({ contents:messages, ...(system.length?{systemInstruction:{parts:[{text:system.join("\n\n")} ]}}:{}),
    generationConfig:{maxOutputTokens:limit}, ...(tools.length?{tools:[{functionDeclarations:tools.map(t=>({name:t.name,description:t.description,parametersJsonSchema:t.parameters}))}]}:{}) },profile);
  return applyParameters({model:chat.model,messages,stream:chat.stream,max_tokens:limit,...(system.length?{system:system.join("\n\n")}:{}),
    ...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters}))}:{})},profile);
}
async function readJsonResponse(response) {
  const text = await response.text();
  if (text.length > 32 * 1024 * 1024) throw Error("模型回执超过大小限制。");
  return JSON.parse(text);
}
const anthropicUsage = (u = {}) => ({prompt_tokens:(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0),completion_tokens:u.output_tokens||0,...(Number.isFinite(u.cache_read_input_tokens)?{prompt_tokens_details:{cached_tokens:u.cache_read_input_tokens}}:{})});
async function* sseEvents(body) {
  const decoder = new TextDecoder(); let buffer="";
  for await (const bytes of body) {
    buffer += decoder.decode(bytes,{stream:true}); buffer=buffer.replace(/\r\n/g,"\n");
    if (buffer.length > 8*1024*1024) throw Error("模型流式回执超过单事件限制。");
    let end;
    while ((end=buffer.indexOf("\n\n"))>=0) {
      const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
      const data=block.split("\n").filter(s=>s.startsWith("data:")).map(s=>s.slice(5).trimStart()).join("\n");
      if(data==="[DONE]") return;
      if(data) yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  if(buffer.trim().startsWith("data:")&&buffer.slice(5).trim()!=="[DONE]") yield JSON.parse(buffer.slice(5).trim());
}
function mergeReasoningDetails(target, incoming) {
  for (const detail of incoming || []) {
    const previous=target.find(item=>detail.index!==undefined ? item.index===detail.index : detail.id ? item.id===detail.id : false);
    if(!previous) {target.push(structuredClone(detail));continue;}
    for(const [key,value] of Object.entries(detail)) {
      if(["text","summary","data","signature"].includes(key)&&typeof value==="string") previous[key]=(previous[key]||"")+value;
      else previous[key]=value;
    }
  }
}
async function* providerChunks(provider, chat, profile, {fetchImpl=fetch,signal,sessionId}={}) {
  const native=profile.protocol!=="chat", google=profile.protocol==="google";
  const body=nativeRequest(structuredClone(chat),profile);
  const modelPath=String(chat.model).replace(/^models\//,"").split("/").map(encodeURIComponent).join("/");
  const endpoint=google?`/models/${modelPath}:${chat.stream?"streamGenerateContent":"generateContent"}`:profile.protocol==="anthropic"?"/messages":"/chat/completions";
  let url=provider.endpoint(endpoint);
  if(google&&chat.stream)url+="?alt=sse";
  const extras={"Content-Type":"application/json","User-Agent":`AieyraWorkspace/${require("../../package.json").version}`,
    ...(new URL(url).hostname === "opencode.ai" && typeof sessionId === "string" && sessionId && !/[\r\n]/.test(sessionId) ? {"x-opencode-session":sessionId} : {})};
  const headers=provider.authorizeRequestHeaders(extras);
  if(profile.protocol==="anthropic"){headers["x-api-key"]=headers.Authorization.slice(7);headers["anthropic-version"]="2023-06-01";}
  if(google)headers["x-goog-api-key"]=headers.Authorization.slice(7);
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted) abort(); else signal?.addEventListener("abort",abort,{once:true});
  try {
  const response=await fetchImpl(url,{method:"POST",headers,body:JSON.stringify(body),signal:controller.signal,redirect:"error"});
  if(!response.ok){const detail=(await response.text()).slice(0,3000);const error=Error((provider.scrubPublicText?provider.scrubPublicText(detail):detail)||`模型服务返回 ${response.status}`);error.status=response.status;throw error;}
  const events=response.headers.get("content-type")?.includes("text/event-stream")?sseEvents(response.body):(async function*(){const data=await readJsonResponse(response);for(const item of Array.isArray(data)?data:[data])yield item;})();
  const blocks=new Map(), nativeContent=[], toolCalls=[]; let stop="",usage={}, ended=false, googleIndex=0;
  const chunk=(delta={},finish=null)=>({choices:[{delta,finish_reason:finish}]});
  const iterator=events[Symbol.asyncIterator](); let terminal=false;
  while(true){
    // A provider's terminal receipt commits this response. Trailing usage is
    // useful, but a stalled/broken socket after it cannot replay the answer.
    let tailTimer;
    const next=terminal ? await Promise.race([
      iterator.next().catch(()=>({done:true})),
      new Promise(resolve=>{tailTimer=setTimeout(()=>resolve({done:true}),250);})
    ]).finally(()=>clearTimeout(tailTimer)) : await iterator.next();
    if(next.done)break;
    const event=next.value;
    if(terminal){if(event.usage)yield {choices:[],usage:event.usage};continue;}
    if(event.error||event.type==="error")throw Error(provider.scrubPublicText?.(event.error?.message||"模型流返回错误")||"模型流返回错误");
    if(!native){terminal=Boolean(event.choices?.[0]?.finish_reason);yield event;continue;}
    if(google){
      if(event.usageMetadata){const u=event.usageMetadata;usage={prompt_tokens:u.promptTokenCount||0,completion_tokens:(u.candidatesTokenCount||0)+(u.thoughtsTokenCount||0),...(Number.isFinite(u.cachedContentTokenCount)?{prompt_tokens_details:{cached_tokens:u.cachedContentTokenCount}}:{}),completion_tokens_details:{reasoning_tokens:u.thoughtsTokenCount||0}};}
      const candidate=event.candidates?.[0];
      if(event.promptFeedback?.blockReason)throw Error(`模型拒绝本次输入：${event.promptFeedback.blockReason}`);
      for(const p of candidate?.content?.parts||[]){
        nativeContent.push(structuredClone(p));
        if(p.text)yield chunk({[p.thought?"reasoning_content":"content"]:p.text});
        if(p.functionCall){const call={index:googleIndex++,id:p.functionCall.id||`call_${randomUUID()}`,type:"function",function:{name:p.functionCall.name,arguments:JSON.stringify(p.functionCall.args||{})}};toolCalls.push(call);yield chunk({tool_calls:[call]});}
      }
      if(candidate?.finishReason){stop=candidate.finishReason==="STOP"?(toolCalls.length?"tool_calls":"stop"):candidate.finishReason==="MAX_TOKENS"?"length":candidate.finishReason;ended=true;}
    }else if(event.type && event.type !== "message"){
      if(event.type==="message_start")usage=anthropicUsage(event.message?.usage);
      if(event.type==="content_block_start"){
        const block=structuredClone(event.content_block);blocks.set(event.index,block);
        if(block.type==="text"&&block.text)yield chunk({content:block.text});
        if(block.type==="thinking"&&block.thinking)yield chunk({reasoning_content:block.thinking});
      }
      if(event.type==="content_block_delta"){
        const block=blocks.get(event.index);if(!block)throw Error("模型返回无对应起点的内容片段。");
        const d=event.delta;
        if(d.type==="text_delta"){block.text=(block.text||"")+d.text;yield chunk({content:d.text});}
        if(d.type==="thinking_delta"){block.thinking=(block.thinking||"")+d.thinking;yield chunk({reasoning_content:d.thinking});}
        if(d.type==="signature_delta")block.signature=(block.signature||"")+d.signature;
        if(d.type==="input_json_delta")block._json=(block._json||"")+d.partial_json;
      }
      if(event.type==="content_block_stop"){
        const block=blocks.get(event.index);if(!block)throw Error("模型内容结束标记无对应起点。");
        if(block.type==="tool_use"){
          if(block._json!==undefined)block.input=JSON.parse(block._json);delete block._json;
          const call={index:toolCalls.length,id:block.id,type:"function",function:{name:block.name,arguments:JSON.stringify(block.input||{})}};toolCalls.push(call);yield chunk({tool_calls:[call]});
        }
        nativeContent.push(block);blocks.delete(event.index);
      }
      if(event.type==="message_delta"){const reason=event.delta?.stop_reason;stop=reason==="tool_use"?"tool_calls":["end_turn","stop_sequence"].includes(reason)?"stop":reason==="max_tokens"?"length":reason;usage={...usage,completion_tokens:event.usage?.output_tokens||0};}
      if(event.type==="message_stop"){if(blocks.size)throw Error("模型内容片段未完整结束。");ended=true;}
    }else{
      for(const b of event.content||[]){nativeContent.push(b);if(b.type==="text")yield chunk({content:b.text});if(b.type==="thinking")yield chunk({reasoning_content:b.thinking});if(b.type==="tool_use"){const call={index:toolCalls.length,id:b.id,type:"function",function:{name:b.name,arguments:JSON.stringify(b.input||{})}};toolCalls.push(call);yield chunk({tool_calls:[call]});}}
      stop=event.stop_reason==="tool_use"?"tool_calls":["end_turn","stop_sequence"].includes(event.stop_reason)?"stop":event.stop_reason==="max_tokens"?"length":event.stop_reason;
      usage=anthropicUsage(event.usage);ended=Boolean(stop);
    }
    if(native&&ended)break;
  }
  if(native){if(!ended||!stop)throw Error("模型流在完成回执前中断，已保留收到的正文。");yield {...chunk({},stop),usage,_nativeContent:nativeContent};}
  } finally {signal?.removeEventListener("abort",abort);controller.abort();}
}
module.exports={nativeRequest,providerChunks,sseEvents,mergeReasoningDetails,readJsonResponse};
