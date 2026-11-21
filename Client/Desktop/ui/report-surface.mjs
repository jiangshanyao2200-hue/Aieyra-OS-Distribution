// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupReportSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/report-surface.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupReports,setupReportCircles} from './reports.mjs';
import {isolatedHTML} from './html-document.mjs';

// Program pages mount the existing report reader and durable close/minimize
// protocol. The caller resolves each document to its actual session owner.
export function setupReportSurface({read,onError=()=>{}}){
 const viewer=document.createElement('section');viewer.id='document-viewer';viewer.className='scoped-report-surface';viewer.hidden=true;viewer.setAttribute('aria-label','报告阅读');
 viewer.innerHTML='<div class="document-header"><div class="document-heading"><h2 id="document-title">报告</h2><p id="document-meta" hidden></p></div><button id="previous-document" type="button" class="quiet ui-icon-button" aria-label="上一份报告" title="上一份报告" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg></button><button id="next-document" type="button" class="quiet ui-icon-button" aria-label="下一份报告" title="下一份报告" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg></button><button id="minimize-document" type="button" class="quiet ui-icon-button" aria-label="最小化报告" title="最小化报告"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button><button id="close-document" type="button" class="quiet ui-icon-button" aria-label="关闭报告" title="关闭报告"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div><p id="document-status" role="status" hidden></p><article id="document-content" tabindex="0" aria-label="报告正文"></article><iframe id="document-html" title="HTML 报告" sandbox="allow-same-origin" referrerpolicy="no-referrer" hidden></iframe>';
 document.body.append(viewer);
 // Reading is a page transition: preserve the live program and its draft,
 // but do not let Tab or screen readers enter controls behind the report.
 const suspended=new Map();let returnFocus=null,closed=false;
 const restore=()=>{for(const [node,inert]of suspended)if(node.isConnected)node.inert=inert;suspended.clear();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;};
 const reading=()=>{
  if(closed)return;
  // Publish only this reader's visibility. A body-wide :has(...[hidden])
  // selector otherwise invalidates unrelated chat subtrees on every text or
  // hidden mutation, including when there is no embedded report to read.
  const visible=String(!viewer.hidden);if(document.body.dataset.scopedReportOpen!==visible)document.body.dataset.scopedReportOpen=visible;
  if(viewer.hidden){restore();return;}
  if(!suspended.size)returnFocus=document.activeElement;
  for(const node of document.body.children){
   if(node===viewer||['status-rail','report-pop'].includes(node.id)||['SCRIPT','STYLE','LINK'].includes(node.tagName))continue;
   if(!suspended.has(node))suspended.set(node,node.inert);node.inert=true;
  }
 };
 reading();
 const visibility=new MutationObserver(reading);visibility.observe(viewer,{attributes:true,attributeFilter:['hidden']});visibility.observe(document.body,{childList:true});
 const check=r=>{if(r?.ok===false)throw Error(r.error||'报告暂不可读');return r;};
 const reports=setupReports({document:p=>read('document_read',p),documentState:p=>read('document_state',{...p,operation:p.action})},check,isolatedHTML);
 const circles=setupReportCircles(h=>reports.open(h),{onError});
 return {paint:next=>reports.paint(next),minimize:()=>reports.minimize(),close(){if(closed)return;closed=true;visibility.disconnect();restore();circles.close();reports.dispose();viewer.remove();delete document.body.dataset.scopedReportOpen;}};
}
