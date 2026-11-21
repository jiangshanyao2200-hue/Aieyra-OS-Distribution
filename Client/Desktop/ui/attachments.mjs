// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: labelPrefix; previewWebReference; labelled; validateAttachments; renderAttachmentList; setupAttachments; createAttachmentCards; paintBubbleAttachments; setupAttachmentIntake
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/attachments.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindDialog} from './interaction.mjs';
import {bindComposerMenu} from './composer-menu.mjs';
import {canPreviewMedia} from '../../../Theme/runtime/media.mjs';
import {bindThemeRenderer,disposeThemeTree,withThemeBatch} from '../../../Theme/runtime/layout.mjs';
// 图N / 文件N stays with an attachment while others come and go, so "@图2" in the
// text keeps meaning the same picture; Core labels each image part the same way.
const labelPrefix=a=>a.kind==='image'?'图':'文件';
export function previewWebReference(a,{onClose=()=>{},locate=async()=>({ok:false,error:'来源浏览器当前不可用'})}={}){
 const r=a.web_reference;if(!r)return;
 const dialog=document.createElement('dialog');dialog.className='web-reference-preview ui-dialog';dialog.setAttribute('aria-label','网页引用快照');
 const title=document.createElement('h2'),source=document.createElement('p'),text=document.createElement('pre'),status=document.createElement('p'),foot=document.createElement('footer'),back=document.createElement('button'),close=document.createElement('button');
 title.textContent=r.title||'网页区域';source.textContent=r.url+' · '+new Date(r.captured_at).toLocaleString();text.textContent=r.text||'（此区域没有文字）';status.setAttribute('role','status');
 back.textContent='回到来源';back.type=close.type='button';close.textContent='关闭';
 back.onclick=async()=>{back.disabled=true;try{const result=await locate(r);if(result?.ok===false)throw Error(result.error);dialog.close();}catch(e){status.textContent=e.message;}finally{back.disabled=false;}};
 close.onclick=()=>dialog.close();foot.append(back,close);dialog.append(title,source,text,status,foot);document.body.append(dialog);bindDialog(dialog,{remove:true,onClose}).show();
}
function labelled(entries){
 const used=new Set(entries.map(a=>a.label).filter(Boolean));
 return entries.map(a=>{
  if(a.label)return a;
  const prefix=labelPrefix(a),taken=entries.filter(x=>x.label?.startsWith(prefix)).map(x=>Number(x.label.slice(prefix.length)));
  let n=Math.max(0,...taken)+1;if(n>99)for(n=1;used.has(prefix+n);n++);
  used.add(prefix+n);a.label=prefix+n;return a;
 });
}
export function validateAttachments(entries){
 if(!Array.isArray(entries)||entries.length>10)throw Error('每条消息最多添加 10 个附件。');
 let total=0,images=0;const labels=new Set();
 for(const a of entries){
  if(a?.label!==undefined&&(typeof a.label!=='string'||!new RegExp('^'+labelPrefix(a)+'[1-9]\\d?$','u').test(a.label)||labels.has(a.label)))throw Error('附件草稿不完整，请重新添加。');
  if(a?.label)labels.add(a.label);
  if(a?.web_reference&&(!a.web_reference.id||typeof a.web_reference.text!=='string'||JSON.stringify(a.web_reference).length>60000))throw Error('网页引用快照无效。');
  if(!a||typeof a.name!=='string'||!a.name||a.name.length>255||/[\x00-\x1f\x7f/\\]/u.test(a.name)||typeof a.asset!=='string'||!/^[a-f0-9]{64}$/u.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<0||a.bytes>32*1024*1024||!['file','image'].includes(a.kind))throw Error('附件草稿不完整，请重新添加。');
  total+=a.bytes;if(a.kind==='image'){if(!['image/png','image/jpeg','image/gif'].includes(a.mime)||a.bytes>8*1024*1024)throw Error('图片只支持 8 MiB 以内的 PNG、JPEG 或 GIF。');images+=a.bytes;}
  else if(a.mime!=='application/octet-stream')throw Error('附件类型无效，请重新添加。');
 }
 if(total>64*1024*1024||images>24*1024*1024)throw Error('附件合计最多 64 MiB，其中图片最多 24 MiB。');
 return labelled(entries.map(a=>({...a})));
}
export function renderAttachmentList(list,entries,onRemove,{preview,thumbnail,media=true}={}){
  // Removing by keyboard keeps focus in the list (next item, else the input).
  const active=list.ownerDocument.activeElement,oldRows=[...list.children],oldRow=active?.closest('.composer-attachment'),focused=oldRows.indexOf(oldRow),identity=oldRow?.dataset.sha,action=active?.classList.contains('attachment-remove')?'attachment-remove':'attachment-preview';
  disposeThemeTree(list);list.replaceChildren();list.hidden=!entries.length;
  withThemeBatch(list.ownerDocument,()=>entries.forEach((a,index)=>{
   // 与粘贴块同一套玻璃胶囊：类型图标、名称、大小标签、旋转的关闭钮。
   const row=document.createElement('span'),icon=document.createElement('span'),name=document.createElement('span'),meta=document.createElement('span'),remove=document.createElement('button'),body=document.createElement('button'),labels=document.createElement('span');
   row.className='composer-attachment';row.dataset.kind=a.kind;row.dataset.sha=a.sha256;icon.className='attachment-icon';icon.setAttribute('aria-hidden','true');
   name.className='attachment-name';name.textContent=a.name;name.title=a.name;
   meta.className='attachment-meta';meta.textContent=a.web_reference?'@ 网页区域 · '+(a.web_reference.role||'内容'):(a.label?a.label+' · ':a.kind==='image'?'图片 · ':'')+(a.bytes<1024?a.bytes+' B':Math.ceil(a.bytes/1024)+' KiB');
   remove.type='button';remove.className='attachment-remove';remove.setAttribute('aria-label','移除附件 '+a.name);remove.title=remove.getAttribute('aria-label');
   body.type='button';body.className='attachment-preview';body.title=a.kind==='image'||a.web_reference||media&&canPreviewMedia(a)?'查看 '+a.name:a.name;body.setAttribute('aria-label',body.title);body.disabled=a.kind!=='image'&&!a.web_reference&&!(media&&canPreviewMedia(a));
   labels.className='attachment-labels';labels.append(name,meta);labels.dataset.contentSchema='aieyra.content.attachment/1';bindThemeRenderer(labels,'aieyra.content.attachment/1',{name,metadata:meta});body.append(icon,labels);body.onclick=()=>preview?.(a,entries);
   if(a.kind==='image'&&thumbnail){const img=document.createElement('img');img.alt='';img.draggable=false;icon.append(img);Promise.resolve(thumbnail(a)).then(r=>{if(img.isConnected&&r?.data){img.src=r.data;icon.classList.add('has-thumbnail');}}).catch(()=>{body.title='图片暂时无法预览：'+a.name;});}
   remove.onclick=()=>onRemove(a,index);row.append(body,remove);list.append(row);
  }));
  if(focused>=0){const rows=[...list.children],row=rows.find(n=>n.dataset.sha===identity)||rows[Math.min(focused,rows.length-1)],target=row?.querySelector('.'+action+':not(:disabled)')||row?.querySelector('button:not(:disabled)')||list.ownerDocument.getElementById('message');target?.focus({preventScroll:true});}
}
export function setupAttachments(list,button,{choose,compact,stagePaths,stageBytes,stageFileBytes,preview,thumbnail,onChange,onError,onSettled}){
 let entries=[],epoch=0,pendingCount=0,chain=Promise.resolve();
 const remove=index=>{entries=entries.filter((_,i)=>i!==index);render();onChange();};
 const render=()=>renderAttachmentList(list,entries,(_a,index)=>remove(index),{preview,thumbnail});
 const add=load=>{
  const own=epoch;pendingCount++;list.setAttribute('aria-busy','true');
  const run=async()=>{let result;
   try{if(own!==epoch)return;result=await load();if(own!==epoch)return;if(result?.ok===false)throw Error(result.error||'附件添加失败');if(result?.cancelled)return;
    const warnings=[...(result?.warnings||[])];for(const a of result.attachments||[]){if(entries.some(x=>x.sha256===a.sha256))continue;try{entries=validateAttachments([...entries,a]);if(a.preview_unavailable)warnings.push(a.name+' 已作为普通文件添加，模型需用文件工具读取。');}catch(e){warnings.push(a.name+'：'+e.message);}}
    render();onChange();if(warnings.length)onError(warnings.join('\n'));return {accepted:(result.attachments||[]).some(a=>entries.some(x=>x.sha256===a.sha256)),warnings};
   }catch(error){if(own===epoch)onError(error.message);}
   finally{for(const receipt of result?.receipts||[result?.receipt].filter(Boolean))onSettled?.(receipt);if(own===epoch){pendingCount--;list.setAttribute('aria-busy',String(pendingCount>0));button.disabled=false;}}
  };const p=chain.then(run,run);chain=p.catch(()=>{});return p;
 };
 const chooseKind=kind=>add(()=>choose(kind));
 bindComposerMenu(button.ownerDocument,{file:()=>chooseKind('file'),media:()=>chooseKind('media'),compact});
 return {
  choose:chooseKind,
  remove:sha=>{const index=entries.findIndex(a=>a.sha256===sha);if(index>=0)remove(index);},
  addPaths:paths=>add(()=>stagePaths({paths})),
  addResult:load=>add(load),
  addFiles:files=>add(async()=>{
   const attachments=[],receipts=[],warnings=[];
   for(const f of files){try{
    if(f.size>32*1024*1024)throw Error('单个文件最多 32 MiB');
    const load=stageFileBytes||stageBytes,result=await load({name:f.name||'附件',bytes:new Uint8Array(await f.arrayBuffer())});
    if(result?.ok===false)throw Error(result.error||'添加失败');attachments.push(...(result.attachments||[]));receipts.push(...result.receipts||[result.receipt].filter(Boolean));warnings.push(...result.warnings||[]);
   }catch(e){warnings.push((f.name||'附件')+'：'+e.message);}}
   return {attachments,receipts,warnings};
  }),
  addImages:files=>add(async()=>{
   if(files.length+entries.length>10)throw Error('每条消息最多添加 10 个附件。');
   let total=entries.filter(a=>a.kind==='image').reduce((n,a)=>n+a.bytes,0);
   for(const f of files){if(!['image/png','image/jpeg','image/gif'].includes(f.type)||f.size>8*1024*1024)throw Error('图片只支持 8 MiB 以内的 PNG、JPEG 或 GIF。');total+=f.size;}
   if(total>24*1024*1024)throw Error('图片合计最多 24 MiB。');
   const attachments=[],receipts=[];
   try{for(const f of files){const clock=new Date().toTimeString().slice(0,8).replaceAll(':','-'),extension=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif'})[f.type];const result=await stageBytes({name:`截图 ${clock}.${extension}`,bytes:new Uint8Array(await f.arrayBuffer())});if(result?.ok===false)throw Error(result.error||'图片添加失败');attachments.push(...(result.attachments||[]));if(result.receipt)receipts.push(result.receipt);}
    return {attachments,receipts};
   }catch(error){for(const receipt of receipts)onSettled?.(receipt);throw error;}
  }),
  get pending(){return pendingCount>0;},get length(){return entries.length;},values:()=>entries.map(a=>({...a})),save:()=>JSON.stringify(entries),
  restore(metadata){epoch++;pendingCount=0;list.setAttribute('aria-busy','false');button.disabled=false;entries=[];try{entries=validateAttachments(JSON.parse(metadata||'[]'));}catch(error){onError(error.message);}render();},
  clear(){epoch++;pendingCount=0;list.setAttribute('aria-busy','false');button.disabled=false;entries=[];render();onChange();},
 };
}

// The same cards decorate accepted and transport-pending user bubbles without
// changing the chat column's ownership or its scroll/animation behavior.
export function createAttachmentCards(entries){
  const cards=document.createElement('div');cards.className='chat-attachments attachment-cards';
  for(const a of entries){const card=document.createElement(a.kind==='image'||a.web_reference||canPreviewMedia(a)?'button':'span'),name=document.createElement('span'),size=document.createElement('small');card.className='attachment-card';name.className='attachment-card-name';size.className='attachment-card-meta';card.dataset.kind=a.kind;card.title=a.name;name.textContent=a.name;size.textContent=(a.kind==='image'?'图片 · ':'文件 · ')+(a.bytes<1024?a.bytes+' B':Math.ceil(a.bytes/1024)+' KiB');if(a.kind==='image'||a.web_reference||canPreviewMedia(a)){card.type='button';card.onclick=()=>document.dispatchEvent(new CustomEvent(a.web_reference?'eyra-web-reference':canPreviewMedia(a)?'eyra-media':'eyra-attachment',{detail:{attachment:a,attachments:entries}}));}card.append(name,size);card.dataset.contentSchema='aieyra.content.attachment/1';bindThemeRenderer(card,'aieyra.content.attachment/1',{name,metadata:size});cards.append(card);}return cards;
}
export function paintBubbleAttachments(root,messages){
 const rows=new Map(messages.map(m=>[m.id,m]));
 for(const node of root.querySelectorAll('.chat-entry.user')){
  const message=rows.get(node.dataset.id),main=node.querySelector('.chat-main');if(!message||!main)continue;
  const signature=JSON.stringify(message.attachments||[]),old=main.querySelector('.chat-attachments');
  if(old?.dataset.attachments===signature)continue;
  disposeThemeTree(old);old?.remove();if(!message.attachments?.length)continue;
  const cards=createAttachmentCards(message.attachments);cards.dataset.attachments=signature;main.append(cards);
 }
}

export function setupAttachmentIntake(input,{api,attachments,paste,open,onError}){
 const hint=document.createElement('div');hint.id='attachment-drop-hint';hint.hidden=true;hint.textContent='松开，放到输入框上方';document.body.append(hint);
 let depth=0;
 const receive=async transfer=>{
  const files=Array.from(transfer?.files||[]);
  if(files.length){
   open();let paths=[];try{paths=api.pathsForFiles?.(files)||[];}catch{/* Browser-created File objects have no native path. */}
   if(paths.length===files.length&&paths.every(Boolean)){await attachments.addPaths(paths);return;}
   if(paths.some(Boolean)){for(let i=0;i<files.length;i++){if(paths[i])await attachments.addPaths([paths[i]]);else await attachments.addFiles([files[i]]);}return;}
   await (attachments.addFiles?attachments.addFiles(files):attachments.addImages(files));return;
  }
  const text=transfer?.getData('text/plain');if(text){open();paste.insert(text);}
 };
 input.addEventListener('paste',event=>{
  if(!event.clipboardData?.files?.length)return;
  event.preventDefault();receive(event.clipboardData).catch(error=>onError(error.message));
 });
 // Pictures dragged inside the album are routed by the album itself (folders, the composer).
 const relevant=e=>{const types=Array.from(e.dataTransfer?.types||[]);return !types.includes('application/x-aieyra-images')&&types.some(t=>['Files','text/plain'].includes(t));};
 // While a dialog holds the screen the message box is out of reach: nothing dropped lands there.
 const modal=()=>!!document.querySelector('dialog:modal');
 window.addEventListener('dragenter',e=>{if(!relevant(e))return;e.preventDefault();if(modal())return;depth++;hint.hidden=false;});
 window.addEventListener('dragover',e=>{if(!relevant(e))return;e.preventDefault();if(modal()){e.dataTransfer.dropEffect='none';hint.hidden=true;return;}e.dataTransfer.dropEffect='copy';hint.hidden=false;});
 window.addEventListener('dragleave',()=>{if(--depth<=0){depth=0;hint.hidden=true;}});
 window.addEventListener('drop',e=>{depth=0;hint.hidden=true;if(!relevant(e))return;e.preventDefault();if(modal())return;receive(e.dataTransfer).catch(error=>onError(error.message));});
 const reportFrame=document.getElementById('document-html');
 const bindReportDrop=()=>{try{const doc=reportFrame?.contentDocument;if(!doc)return;
  doc.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  doc.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;e.preventDefault();depth=0;hint.hidden=true;receive(e.dataTransfer).catch(error=>onError(error.message));});
 }catch{}};
 reportFrame?.addEventListener('load',bindReportDrop);
 window.addEventListener('blur',()=>{depth=0;hint.hidden=true;});
}
