// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: bailian; supportsImages
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/image-capabilities.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const bailian=require('./bailian.cjs');

// 只采用实际图片识读证据；官方目录的 modalities/vision 不等于产品已验证。
// 028/vision/opencode-go-{2827d1187405c456bd07,c7588f32c731e23dbd68}.json
function supportsImages(p) {
 const protocol=p.api_protocol||'responses';
 if(p.adapter!=='openai')return protocol==='responses'&&p.model==='deepseek-flash';
 const base=String(p.base_url||'').trim().replace(/\/+$/,'');
 if(protocol==='chat_completions'&&p.model==='qwen3.8-flash'&&bailian.matches(base))return true;
 return base==='https://opencode.ai/zen/go/v1'&&protocol==='chat_completions'&&['deepseek-v4-flash-vision-exp','mimo-v2.6-flash'].includes(p.model);
}
module.exports={supportsImages};
