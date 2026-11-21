// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: feedbackSummary; feedbackContent; rendered; setFeedback
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/feedback.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';
import {redactNoticeText} from './system-notices.mjs';

// The concise surface never replaces the diagnostic record or decides whether
// an operation is safe to retry. That remains with its owning service.
export function feedbackSummary(value){
 const text=redactNoticeText(value).trim();
 if(/official package is not in this host's trusted catalog|官方组件[\s\S]*兼容目录不匹配/i.test(text))return '组件版本暂不兼容，请检查并更新完整程序。';
 if(/ECONNREFUSED|ERR_CONNECTION_REFUSED|fetch failed|Failed to fetch/i.test(text))return '暂时无法连接服务，请检查连接后重试。';
 if(/context deadline exceeded|ETIMEDOUT|ERR_TIMED_OUT|请求超时|连接超时|响应超时/i.test(text))return '响应超时，请稍后重试。';
 const first=text.split(/\r?\n|详情[:：]|原始错误[:：]/)[0].trim();
 if(first.length<=100&&!/[a-f0-9]{32,}|\bat .+\(.+:\d+|Traceback|Error:/i.test(first))return first||'本次操作暂未完成。';
 const sentence=first.match(/^.{1,90}?[。！？]/)?.[0];
 return sentence||'本次操作暂未完成，可展开详情查看原因。';
}

export function feedbackContent(value,{summary=feedbackSummary(value),label='查看详情'}={}){
 const text=redactNoticeText(value),root=el('div',undefined,'ui-feedback-content');
 const message=el('span',summary,'notice-text ui-feedback-message');root.append(message);
 if(text&&text!==summary){
  const details=el('details',undefined,'ui-feedback-details'),toggle=el('summary',label),body=el('pre',text,'ui-feedback-diagnostic');
  details.append(toggle,body);root.append(details);
 }
 return root;
}

const rendered=new WeakMap();
export function setFeedback(node,value){
 const text=redactNoticeText(value||'');node.hidden=!text;
 if(rendered.get(node)===text)return;
 rendered.set(node,text);node.classList.add('ui-feedback');
 node.replaceChildren(...(text?[feedbackContent(text)]:[]));
}
