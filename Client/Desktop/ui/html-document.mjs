// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: reportAppearance; refreshHTMLAppearance; isolatedHTML
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/html-document.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {presenceRingSize} from './eyra-presence-geometry.mjs';
// Inert reports inherit the current reading surface. Interactive HTML files
// belong to the browser and do not acquire script privileges in this frame.
export function reportAppearance(doc=globalThis.document){
 const body=doc?.body,style=body&&doc.defaultView?.getComputedStyle(body);
 const safe=(value,fallback)=>value&&!/[<>;{}]/.test(value)?value:fallback;
 const token=(name,fallback)=>safe(style?.getPropertyValue(name)?.trim(),fallback);
 const entry=doc?.getElementById?.('report-orb'),rightRoom=entry&&!entry.hidden?'calc('+token('--rail-panel-right','84px')+' + 4px)':'0px';
 return {'--report-text':token('--ui-text','CanvasText'),'--report-muted':token('--ui-text-2','GrayText'),'--report-accent':token('--ui-accent','LinkText'),'--report-panel':token('--ui-glass-soft','transparent'),'--report-font':safe(style?.fontFamily,'system-ui'),'--report-scheme':safe(style?.colorScheme,'normal'),'--report-left-room':(presenceRingSize(doc?.defaultView?.innerHeight||800,parseFloat(style?.getPropertyValue('--eyra-ring-size'))||104)+64)+'px','--report-right-room':rightRoom};
}
export function refreshHTMLAppearance(frameDocument,source=globalThis.document){
 if(!frameDocument?.documentElement)return;
 for(const [name,value]of Object.entries(reportAppearance(source)))frameDocument.documentElement.style.setProperty(name,value);
}
export function isolatedHTML(text,bottomRoom=24,leftRoom=24) {
  const parsed=new DOMParser().parseFromString(text,'text/html');
  for(const node of parsed.querySelectorAll('script,iframe,frame,frameset,object,embed,link,meta,base,form,input,button,textarea,select,video,audio,source'))node.remove();
  for(const node of parsed.querySelectorAll('*'))for(const attribute of [...node.attributes]){
    if(/^on/i.test(attribute.name)||['href','action','formaction','srcdoc','xlink:href'].includes(attribute.name))node.removeAttribute(attribute.name);
    if(attribute.name==='src'&&!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(attribute.value))node.removeAttribute(attribute.name);
  }
  for(const table of [...parsed.querySelectorAll('table')]){const scroll=parsed.createElement('div');scroll.className='report-table-scroll';table.replaceWith(scroll);scroll.append(table);}
  const theme=Object.entries(reportAppearance()).map(([name,value])=>name+':'+value).join(';');
  const css=`:root{${theme};color-scheme:var(--report-scheme);scrollbar-width:thin;scrollbar-color:var(--report-muted) transparent}*{box-sizing:border-box}html{background:transparent}body{margin:0;padding:14px max(var(--report-right-room),clamp(22px,5vw,60px),calc((100% - 780px)/2)) ${Math.max(24,Math.round(Number(bottomRoom)||0))}px;padding-left:max(var(--report-left-room),clamp(22px,5vw,60px),calc((100% - 780px)/2));font:16px/1.85 var(--report-font);color:var(--report-text);background:transparent;overflow-wrap:anywhere;min-width:0}body>:first-child{margin-top:0}h1,h2,h3,h4{line-height:1.4;margin:1.4em 0 .5em}h1{font-size:20px}h2{font-size:16px}h3{font-size:15px}p{margin:.45em 0 .8em}pre{max-width:100%;overflow:auto;white-space:pre-wrap;padding:14px 16px;background:var(--report-panel)}img,svg{max-width:100%;height:auto}.report-table-scroll{max-width:100%;overflow:auto}table{width:100%;border-collapse:collapse}td,th{padding:7px 10px;border-bottom:1px solid color-mix(in srgb,var(--report-text) 15%,transparent);text-align:left;vertical-align:top}th{color:var(--report-muted)}a{color:var(--report-accent)}blockquote{margin:.8em 0;padding-left:14px;border-left:2px solid var(--report-muted);color:var(--report-muted)}`;
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><style>'+css+'</style>'+parsed.head.innerHTML+'</head><body>'+parsed.body.innerHTML+'</body></html>';
}
