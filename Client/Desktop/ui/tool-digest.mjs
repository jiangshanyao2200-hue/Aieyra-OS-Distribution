// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: WIDE; unit; middleEllipsis; foldText; NOTES; FAILED; isReport; activityDigest; renderDigest; createDigestController
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/tool-digest.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 工具详情的版式（用户第 84 轮）：人是来快速过一遍的。
// 先是出了什么事（关键），再是几条短事实（扫一眼），然后才是正文（重要，长的只留头尾，中间点开），最后是小字备注。
import {renderPackageDigest} from '../../../Tool/presentation/desktop.mjs';
import {resultFrame} from '../../../Tool/presentation/frame.mjs';
import {bindThemeRenderer} from '../../../Theme/runtime/layout.mjs';
import {activityData,activityDetails,activityFacts,activityOutcome} from './activity.mjs';
import {renderMarkdown} from './markdown.mjs';
import {planModel,renderPlanPage} from './plan-view.mjs';
import {reconcilePresentation,readingNode} from '../../../Tool/presentation/retained-dom.mjs';
import {createReceiptReader} from '../../../Tool/presentation/receipt-reader.mjs';
import {disposeThemeTree} from '../../../Theme/runtime/layout.mjs';

const WIDE=/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
const unit=ch=>WIDE.test(ch)?2:1;

// 过长的一行只留头尾，中间省略：命令和路径的开头、结尾才是认得出来的部分。max 按半角字符计。
export function middleEllipsis(text,max=72){
 const chars=Array.from(String(text??'').replace(/\s+/g,' ').trim());
 if(chars.reduce((n,ch)=>n+unit(ch),0)<=max)return chars.join('');
 const take=(list,budget)=>{const out=[];let used=0;for(const ch of list){used+=unit(ch);if(used>budget)break;out.push(ch);}return out;};
 const room=Math.max(4,max-1),head=take(chars,Math.ceil(room*.62)),tail=take([...chars].reverse(),room-Math.ceil(room*.62)).reverse();
 return head.join('').trimEnd()+'…'+tail.join('').trimStart();
}

// 长文本只留头尾。hidden 是中间省略的量，unit 说明是行还是字。
export function foldText(text,{head=10,tail=5,chars=900}={}){
 const value=String(text??''),lines=value.split('\n');
 if(lines.length>head+tail+2)return {head:lines.slice(0,head).join('\n'),tail:lines.slice(-tail).join('\n'),hidden:lines.length-head-tail,unit:'行'};
 if(value.length>chars){const front=Math.round(chars*.7),back=chars-front;return {head:value.slice(0,front),tail:value.slice(-back),hidden:value.length-chars,unit:'字'};}
 return {head:value,tail:'',hidden:0,unit:''};
}

const NOTES=new Set(['后续','预览范围','提示','下一步','原文']);
const FAILED=new Set(['failed','timed_out','interrupted','interrupted_unknown','persistence_failed']);
const isReport=item=>item.tool==='report'||item.tool==='workspace'&&item.action==='report';

export function activityDigest(item){
 const data=activityData(item),failed=FAILED.has(item.state)||data.ok===false,outcome=activityOutcome(item);
 const facts=[],seen=new Set(),sections=[],notes=[];
 const fact=(label,value)=>{const text=String(value??'').trim();if(!text||seen.has(text))return;seen.add(text);facts.push({label,value:text});};
 for(const row of activityFacts(item))fact(row.label,row.value);
 for(const section of activityDetails(item)){
  if(section.label==='操作'||section.label==='错误')continue;
  if(section.label==='提示'&&isReport(item))continue;
  if(section.label==='回执'){for(const line of section.text.split('\n')){const at=line.indexOf(' · ');if(at>0)fact(line.slice(0,at),line.slice(at+3));}continue;}
  if(NOTES.has(section.label)){notes.push(section.text);continue;}
  // 只有一小行的不值得占一段，并进事实里。
  if(!section.text.includes('\n')&&section.text.length<=60){fact(section.label,section.text);continue;}
  sections.push(section);
 }
 return {error:failed?outcome:'',lead:failed?'':outcome,facts,sections,notes};
}

export function renderDigest(doc,item,{expanded=new Set(),present=bindThemeRenderer}={}){
 const packaged=renderPackageDigest(doc,item,{present});if(packaged)return packaged;
 const make=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
 const d=activityDigest(item),root=make('div','tool-digest');root.dataset.state=item.state||'';const frame=resultFrame(doc,root,present);
 if(item.tool==='update_plan'&&activityData(item).ok!==false&&planModel(item).steps.length){renderPlanPage(frame.content,planModel(item),doc);return frame.finish();}
 if(d.error)frame.summary.append(make('p','digest-error',d.error));
 if(d.lead)frame.summary.append(make('p','digest-lead',d.lead));
 if(d.facts.length){
  const list=make('dl','digest-facts');
  for(const [index,row]of d.facts.entries()){const box=make('div'),value=make('dd','',row.value);box.dataset.digestKey='fact/'+row.label+'/'+index;value.title=row.value;box.append(make('dt','',row.label),value);list.append(box);}
  frame.content.append(list);
 }
 for(const section of d.sections){
  const box=make('section','digest-section'),fold=foldText(section.text);box.dataset.digestKey='section/'+section.label;box.append(make('h4','',section.label));
  if(isReport(item)&&section.label==='正文'){
   const format=activityData(item).document?.format||item.input_preview?.format||'md',content=make('div','chat-text');let text=section.text;
   if(format==='html'){
    const parsed=new doc.defaultView.DOMParser().parseFromString(text,'text/html');for(const node of parsed.querySelectorAll('script,style,iframe,object,embed'))node.remove();
    for(const node of parsed.body.querySelectorAll('p,h1,h2,h3,h4,tr,li,br'))node.append(parsed.createTextNode('\n'));
    text=parsed.body.textContent;
   }
   const paint=full=>{const shown=full?text:text.slice(0,900);if(format==='html')content.textContent=shown;else renderMarkdown(content,shown);};
   paint(expanded.has(section.label));box.append(content);
   if(text.length>900&&!expanded.has(section.label)){const more=make('button','digest-gap','展开本次内容');more.type='button';more.onclick=event=>{expanded.add(section.label);const button=event.currentTarget,body=button.previousSibling;if(format==='html')body.textContent=text;else renderMarkdown(body,text);button.remove();};box.append(more);}
   frame.content.append(box);continue;
  }
  if(!fold.hidden||expanded.has(section.label))box.append(make('pre','digest-text',section.text));
  else{
   const gap=make('button','digest-gap','展开中间 '+fold.hidden+' '+fold.unit);gap.type='button';
   gap.onclick=event=>{expanded.add(section.label);const button=event.currentTarget;button.previousSibling.textContent=section.text;button.nextSibling.remove();button.remove();};
   box.append(make('pre','digest-text',fold.head),gap,make('pre','digest-text digest-tail',fold.tail));
  }
  frame.content.append(box);
 }
 for(const note of d.notes)frame.details.append(make('p','digest-note',note));
 const id=activityData(item).document?.id;
 if(isReport(item)&&id&&doc.getElementById?.('document-viewer')){
  const open=make('button','digest-open','打开文档');open.type='button';
  open.onclick=event=>{const button=event.currentTarget;doc.dispatchEvent(new doc.defaultView.CustomEvent('aieyra:open-document',{detail:{id,fail:message=>{button.textContent=message;}}}));};
  frame.details.append(open);
 }
 if(![frame.summary,frame.content,frame.details].some(n=>n.children.length))frame.content.append(make('p','digest-note',['queued','running'].includes(item.state)?'等待操作结果…':'完整回执可在历史中查看。'));
 return frame.finish();
}

// One controller belongs to one complete source identity. Updating the same
// call paints facts in place; the original reader remains outside those slots.
export function createDigestController(doc,item,{readPage,isCurrent=()=>true,render=renderDigest}={}){
 const expanded=new Set();let slots,closed=false,visible=true,current=item,signature='',deferred=false;
 const element=render(doc,item,{expanded,present:(root,schema,value)=>{slots=value;bindThemeRenderer(root,schema,value);}});
 const notice=doc.createElement('button');notice.type='button';notice.className='digest-gap';notice.textContent='有新内容，更新';notice.hidden=true;element.append(notice);
 const reader=readPage?createReceiptReader(doc,{readPage,isCurrent:()=>!closed&&visible&&isCurrent()}):null;
 if(reader)element.append(reader.element);
 const view={element,reader,
  update(next,{force=false}={}){
   if(closed)return;current=next;const key=JSON.stringify(next);if(!force&&key===signature)return;signature=key;deferred=false;
   let incoming;const fresh=render(doc,next,{expanded,present:(_root,_schema,value)=>incoming=value});
   element.dataset.state=fresh.dataset.state||'';
   for(const name of ['summary','content','details'])reconcilePresentation(slots[name],incoming[name],{doc,force,onDeferred:()=>deferred=true,dispose:disposeThemeTree});
   notice.hidden=!deferred;
  },
  setVisible(value){visible=!!value;reader?.setVisible(visible);},
  reading(){return !!reader?.element.open||readingNode(doc,element);},
  dispose(){if(closed)return;closed=true;reader?.dispose();notice.onclick=null;disposeThemeTree(element);}
 };
 notice.onclick=()=>view.update(current,{force:true});view.update(item);return view;
}
