// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: observationLabel
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/observation.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 可读摘要、公开思考文本与仅用量记录必须区分，不能把密文当正文。
export function observationLabel(o){
 if(!o)return '';
 const parts=[];
 if(o.thought_chars>0)parts.push('公开思考文本 '+o.thought_chars+' 字符');
 if(o.summary_chars>0)parts.push('思考摘要 '+o.summary_chars+' 字符');
 if(!parts.length)parts.push(o.encrypted_items?'仅返回加密思考记录':'本次未返回可读思考');
 if(Number.isSafeInteger(o.reasoning_tokens))parts.push('思考 '+o.reasoning_tokens+' tokens');
 return parts.join(' · ');
}
