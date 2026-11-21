'use strict';
// These functions run inside the isolated page world, including open shadow roots.
function observe(a){
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 const role=e=>e.getAttribute('role')||({A:e.hasAttribute('href')?'link':'',BUTTON:'button',TEXTAREA:'textbox',SELECT:e.multiple?'listbox':'combobox',SUMMARY:'button',INPUT:({checkbox:'checkbox',radio:'radio',button:'button',submit:'button',range:'slider',number:'spinbutton'})[e.type]||'textbox'})[e.tagName]||(e.isContentEditable?'textbox':'');
 const name=e=>{const root=e.getRootNode();return norm((e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>root.getElementById?.(id)?.textContent||'').join(' '))||norm(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.innerText).join(' ')||e.innerText||e.placeholder||e.title||e.alt||'');};
 const ancestors=e=>{const items=[];for(let node=e;node;node=node.parentElement||node.getRootNode()?.host)items.push(node);return items;};
 const unavailable=e=>e.matches(':disabled')||ancestors(e).some(n=>n.hasAttribute('inert')||n.getAttribute('aria-disabled')==='true');
 const signature=e=>JSON.stringify([e.tagName,role(e),name(e),e.type,e.href,e.formAction,e.form?.action,e.form?.method,unavailable(e),e.readOnly,e.value,e.checked,e.tagName==='SELECT'?[...e.options].map(o=>[o.value,o.disabled,o.parentElement.disabled]):null]);
 const visible=e=>(e.getClientRects().length>0||getComputedStyle(e).display==='contents')&&ancestors(e).every(n=>{const style=getComputedStyle(n);return !n.hidden&&n.getAttribute('aria-hidden')!=='true'&&!n.hasAttribute('inert')&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&style.display!=='none';});
 const all=[],roots=[document],shadowText=[];
 for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*')){if(e.shadowRoot&&visible(e)){roots.push(e.shadowRoot);shadowText.push([...e.shadowRoot.children].filter(visible).map(n=>n.innerText||'').join('\n'));}const style=getComputedStyle(e),scrollable=!['HTML','BODY'].includes(e.tagName)&&(e.scrollHeight>e.clientHeight&&/auto|scroll/.test(style.overflowY)||e.scrollWidth>e.clientWidth&&/auto|scroll/.test(style.overflowX));if((e.matches('a,button,input,textarea,select,[role],[contenteditable],[tabindex],[onclick],summary')||scrollable)&&visible(e))all.push(e);}
 globalThis.__aieyraElements=all;globalThis.__aieyraRevision=a.revision;
 globalThis.__aieyraValidate=(id,revision)=>{if(globalThis.__aieyraRevision!==revision)throw Error('stale_snapshot');const e=all[id];if(!e?.isConnected||signature(e)!==signatures[id])throw Error('stale_snapshot: target changed; observe again');if(unavailable(e)||!visible(e))throw Error('Element unavailable');return e;};
 globalThis.__aieyraHit=(e,x,y)=>{let hit=document.elementFromPoint(x,y);while(hit?.shadowRoot){const next=hit.shadowRoot.elementFromPoint(x,y);if(!next||next===hit)break;hit=next;}return hit===e||e.contains(hit);};
 const signatures=all.map(signature),rows=all.map((e,i)=>({id:String(i),tag:e.tagName.toLowerCase(),role:role(e),name:name(e).slice(0,180),type:e.type||'',value:e.type==='password'?'[password]':String(e.value??(e.isContentEditable?e.innerText:'')).slice(0,300),disabled:unavailable(e),readonly:!!e.readOnly,checked:e.matches('input[type=checkbox],input[type=radio]')?e.checked:e.getAttribute('aria-checked'),expanded:e.getAttribute('aria-expanded'),href:e.href||null,scrollable:e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth,multiple:e.tagName==='SELECT'?e.multiple:undefined,files:e.type==='file'?[...e.files].map(f=>({name:f.name,size:f.size})):undefined,options:e.tagName==='SELECT'?[...e.options].map(o=>({value:o.value,text:o.text,selected:o.selected,disabled:o.disabled||o.parentElement.disabled===true})):undefined}));
 const matches=rows.filter(e=>(!a.role||e.role===a.role)&&(!a.name||(a.exact?e.name===a.name:e.name.toLocaleLowerCase().includes(a.name.toLocaleLowerCase()))));
 const text=(document.body?.innerText||'')+(shadowText.length?'\n'+shadowText.join('\n'):'');
 return {title:document.title,url:location.href,text:text.slice(a.text_offset,a.text_offset+a.text_limit),text_offset:a.text_offset,text_has_more:text.length>a.text_offset+a.text_limit,total:matches.length,offset:a.offset,has_more:matches.length>a.offset+a.limit,elements:matches.slice(a.offset,a.offset+a.limit),shadow_roots:roots.length-1};
}
function condition(a){
 const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
 if(a.url)return location.href.includes(a.url);
 if(a.text)return roots.some(root=>(root===document?document.body?.innerText:root.textContent||'')?.includes(a.text));
 const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 return roots.some(root=>[...root.querySelectorAll(a.selector)].some(visible));
}
// Called with a DOM node resolved by CDP in the isolated world. The web page
// never receives IPC capabilities; only bounded visible semantics leave it.
function referenceRegion(mode,id){
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
 let node=this.nodeType===1?this:this.parentElement;
 if(mode==='block')node=node.closest('p,article,section,li,figure,[role=group],div')||node;
 if(mode==='table')node=node.closest('table,[role=table],[role=grid]')||node;
 const visible=e=>{if(!e?.getClientRects().length)return false;for(let n=e;n;n=n.parentElement||n.getRootNode()?.host){const style=getComputedStyle(n);if(n.matches('script,style,noscript,input,textarea')||n.isContentEditable||n.hidden||n.hasAttribute('inert')||n.getAttribute('aria-hidden')==='true'||style.display==='none'||['hidden','collapse'].includes(style.visibility))return false;}return true;};
 if(!visible(node))throw Error('这个区域没有可引用的公开内容');
 const textOf=e=>{
  const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let text='',count=0,n;
  while((n=walker.nextNode())&&count++<2500&&text.length<12000)if(visible(n.parentElement))text+=' '+n.textContent;
  return norm(text).slice(0,12000);
 };
 const text=textOf(node),role=node.getAttribute('role')||node.tagName.toLowerCase();
 const links=[...node.querySelectorAll('a[href]')].filter(visible).slice(0,40).map(e=>({text:textOf(e).slice(0,160),url:/^https?:/.test(e.href)?e.href:''}));
 const controls=[...node.querySelectorAll('button,input,select,textarea,[role=button]')].filter(e=>e.getClientRects().length&&visible(e.parentElement)&&getComputedStyle(e).visibility==='visible').slice(0,40).map(e=>({role:e.getAttribute('role')||e.tagName.toLowerCase(),name:norm(e.getAttribute('aria-label')||e.labels?.[0]?.textContent||(e.matches('button,[role=button]')?textOf(e):'')).slice(0,160),disabled:!!e.disabled}));
 const table=[...node.querySelectorAll('tr,[role=row]')].slice(0,40).map(row=>[...row.querySelectorAll('th,td,[role=cell],[role=columnheader]')].slice(0,16).map(e=>textOf(e).slice(0,300)));
 const rect=node.getBoundingClientRect();
 globalThis.__aieyraReferences||=new Map();const records=globalThis.__aieyraReferences;
 while(records.size>=100)records.delete(records.keys().next().value);
 records.set(id,{node,text,textOf});
 const old=node.style.outline;node.style.outline='2px solid #a9c0ec';setTimeout(()=>{if(node.style.outline==='rgb(169, 192, 236) solid 2px'||node.style.outline==='2px solid rgb(169, 192, 236)')node.style.outline=old;},1600);
 return {id,url:location.href,title:document.title.slice(0,240),text,role,tag:node.tagName.toLowerCase(),links,controls,table,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
}
function revealReference(id){
 const record=globalThis.__aieyraReferences?.get(id);
 if(!record||!record.node.isConnected||record.textOf(record.node)!==record.text)return {ok:false,error:'页面已变化，已保留引用时的快照；请重新引用当前区域。'};
 record.node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
 record.node.animate([{outline:'3px solid #a9c0ec',outlineOffset:'4px'},{outline:'3px solid transparent',outlineOffset:'4px'}],{duration:1800});return {ok:true};
}
module.exports={observe,condition,referenceRegion,revealReference};
