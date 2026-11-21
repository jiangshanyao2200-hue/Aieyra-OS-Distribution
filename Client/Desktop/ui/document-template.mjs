// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: REPORT_FORMATS; REPORT_FORMAT; REPORT_MAX_BYTES; encoder; text; reportByteLength; normalizeReportFormat; isReportFormat; validateReportPayload; escape; editableHTML; reportHTML
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/document-template.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Report files are written and read by CORE.  The renderer only validates the
// wire payload and creates a self-contained HTML document for an HTML report.
export const REPORT_FORMATS=Object.freeze(['md','html']);
export const REPORT_FORMAT=Object.freeze({MD:'md',HTML:'html'});
export const REPORT_MAX_BYTES=512*1024;

const encoder=typeof TextEncoder==='function'?new TextEncoder():null;
const text=value=>value==null?'':String(value);

export function reportByteLength(value){
  value=text(value);
  return encoder?encoder.encode(value).byteLength:unescape(encodeURIComponent(value)).length;
}

export function normalizeReportFormat(value){
  const format=text(value).trim().toLowerCase();
  if(!REPORT_FORMATS.includes(format))throw new TypeError('报告格式应为 md 或 html');
  return format;
}

export function isReportFormat(value){
  try{normalizeReportFormat(value);return true;}catch{return false;}
}

// This is the renderer-side equivalent of CORE's report contract.  It does
// not write a file; report()/recall_report remain the only persistence path.
export function validateReportPayload(payload={}){
  payload=payload||{};
  const format=normalizeReportFormat(payload.format);
  const content=text(payload.content),bytes=reportByteLength(content);
  if(!content.trim())throw new RangeError('报告正文不能为空');
  if(bytes>REPORT_MAX_BYTES)throw new RangeError('报告正文不能超过512 KiB');
  return Object.freeze({
    title:text(payload.title).trim(),
    format,
    content,
    bytes
  });
}

const escape=value=>text(value)
  .replaceAll('&','&amp;')
  .replaceAll('<','&lt;')
  .replaceAll('>','&gt;')
  .replaceAll('"','&quot;')
  .replaceAll("'",'&#39;');

// The HTML report template intentionally has no user-controlled markup,
// scripts, event attributes, or network references.  companion.mjs applies a
// second isolation pass before putting a report in the sandboxed iframe.
export function editableHTML(title,textContent){
  const heading=text(title),body=text(textContent);
  const csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'+escape(csp)+'"><title>'+escape(heading)+'</title><style>body{margin:0;background:#0b0d12;color:#e6e9f0;font:16px/1.7 "Microsoft YaHei UI","PingFang SC",sans-serif}::selection{background:#a9c0ec40}main{max-width:760px;margin:48px auto;padding:24px}h1{font-size:32px;margin:0 0 20px}p{white-space:pre-wrap;margin:0}</style></head><body><main data-aieyra-id="root"><h1 data-aieyra-id="title">'+escape(heading)+'</h1><p data-aieyra-id="body">'+escape(body)+'</p></main></body></html>';
}

// Naming this explicitly makes the file-layer intent clear at call sites
// while keeping the existing editor/template API intact.
export const reportHTML=editableHTML;
