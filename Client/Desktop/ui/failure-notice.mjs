// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: failureNoticeKey; failureNoticeID; createReadFailureTracker; NOTICE_MAX_BYTES; summarizeNoticeText; isPermanentNoticeError
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/failure-notice.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Event identity outlives a renderer or Core process. A new generation or a
// different agent instance must still get its own notice, even for equal text.
export function failureNoticeKey(snapshot,text,roleName='matrix'){
  const role=snapshot?.roles?.find(row=>row.role===roleName),content=String(text||'').trim();
  if(!snapshot?.session_id||!role?.id||!Number.isSafeInteger(role.generation)||role.generation<0||!content)return '';
  return JSON.stringify(['agent-failure',1,snapshot.session_id,role.id,role.generation,role.failure?.code||role.state||'',content]);
}

export async function failureNoticeID(key,cryptoAPI=globalThis.crypto){
  const digest=await cryptoAPI.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest).subarray(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// A read failure belongs to one continuous outage. A real recovery, a different
// error or another read scope starts a new event, even within the toast window.
export function createReadFailureTracker(source,newID=()=>globalThis.crypto.randomUUID()){
  let active='';
  return {
    failed(error,scope=''){
      const signature=JSON.stringify([scope,error?.code||'',String(error?.message??error??'')]);
      if(signature===active)return '';
      active=signature;
      return JSON.stringify(['reader-failure',1,source,scope,newID()]);
    },
    recovered(){active='';}
  };
}

export const NOTICE_MAX_BYTES=16384;
export function summarizeNoticeText(value,detailSource='本次操作的完整错误提示（双击可复制）'){
  const text=String(value??''),bytes=new TextEncoder().encode(text);
  if(bytes.length<=NOTICE_MAX_BYTES)return text;
  const suffix='\n\n…系统信息已保留摘要（原文 '+bytes.length+' 字节）。完整详情：'+detailSource+'。';
  let end=NOTICE_MAX_BYTES-new TextEncoder().encode(suffix).length;
  // Do not split the UTF8 sequence containing the first excluded byte.
  while(end>0&&(bytes[end]&0xc0)===0x80)end--;
  return new TextDecoder().decode(bytes.subarray(0,end)).trimEnd()+suffix;
}

export function isPermanentNoticeError(error){
  const code=String(error?.code??error?.error?.code??'').toLowerCase();
  if(error?.retryable===false||['-32600','-32602','invalid_params','invalid_parameters','invalid_argument','invalid_request','invalid_notice','payload_too_large','request_too_large'].includes(code))return true;
  const message=String(error?.message??error?.error?.message??error?.error??'').trim();
  // Older Core and Electron bridges expose only the exact validation message.
  // Other transport, permission and storage errors may recover and still retry.
  return /(?:^|:\s*)(?:invalid notice|信息编号已用于不同内容|请求内容过大)$/i.test(message);
}
