// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: stem; mentionToken; setupComposerMention
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/composer-mention.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {hoverGlide} from './glide.mjs';
import {animateUI} from './motion.mjs';
// "@" in the input lists this message's attachments. The inserted name is the
// attachment's own short name, or its 图N / 文件N label, which Core shows beside it.
const stem=name=>String(name||'').replace(/\.[^.\s]{1,8}$/u,'').trim();
export function mentionToken(a,list){
 const base=stem(a.name);
 if(base&&[...base].length<=16&&!/\s/u.test(base)&&list.filter(x=>stem(x.name)===base).length===1)return base;
 if(a.label)return a.label;
 const same=list.filter(x=>x.kind===a.kind);
 return (a.kind==='image'?'图':'文件')+(same.findIndex(x=>x.sha256===a.sha256)+1);
}
export function setupComposerMention(input,{attachments,thumbnail=()=>null,doc=document}){
 if(!input)return {close(){}};
 const pop=doc.createElement('div');pop.className='cm-pop';pop.hidden=true;pop.setAttribute('role','listbox');pop.setAttribute('aria-label','引用附件');doc.body.append(pop);
 const glide=hoverGlide(pop,'.cm-pick',{doc});
 let picks=[],index=0,range=null,composing=false;
 function query(){
  const at=input.selectionStart;if(at!==input.selectionEnd)return null;
  const m=/(^|[\s，。、,.;；:：!?！？(（])@([^\s@]{0,24})$/u.exec(input.value.slice(0,at));
  return m?{start:at-m[2].length-1,end:at,q:m[2].toLowerCase()}:null;
 }
 function hide(){if(pop.hidden)return;pop.hidden=true;range=null;}
 function paint(){
  const r=query(),list=attachments.values();if(!r||!list.length)return hide();
  const was=pop.hidden;range=r;
  picks=list.map(a=>({a,token:mentionToken(a,list)})).filter(p=>!r.q||p.token.toLowerCase().includes(r.q)||p.a.name.toLowerCase().includes(r.q));
  if(!picks.length)return hide();index=Math.min(index,picks.length-1);
  pop.replaceChildren(...picks.map((p,i)=>{
   const b=doc.createElement('button');b.type='button';b.className='cm-pick';b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===index));
   const face=doc.createElement('span');face.className='cm-face';face.dataset.kind=p.a.kind;
   if(p.a.kind==='image')Promise.resolve(thumbnail(p.a)).then(t=>{if(t?.data){const img=doc.createElement('img');img.alt='';img.src=t.data;face.append(img);}}).catch(()=>{});
   const text=doc.createElement('span');text.className='cm-text';const token=doc.createElement('b');token.textContent='@'+p.token;const name=doc.createElement('small');name.textContent=p.a.name;text.append(token,name);
   b.append(face,text);b.onpointerdown=e=>e.preventDefault();b.onclick=()=>insert(p);return b;}));
  pop.hidden=false;
  const box=(input.closest('#composer')||input).getBoundingClientRect();
  pop.style.left=Math.max(8,box.left+12)+'px';pop.style.bottom=Math.max(8,innerHeight-box.top+8)+'px';
  glide.refresh();if(was)animateUI(pop,[{opacity:0,translate:'0 6px'},{opacity:1,translate:'0 0'}],{kind:'fast',key:'pop'});
 }
 function insert(p){
  if(!range)return;const text='@'+p.token+' ',v=input.value;
  input.value=v.slice(0,range.start)+text+v.slice(range.end);const caret=range.start+text.length;input.setSelectionRange(caret,caret);
  hide();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});
 }
 input.addEventListener('compositionstart',()=>{composing=true;});
 input.addEventListener('compositionend',()=>{composing=false;paint();});
 input.addEventListener('input',()=>{if(!composing)paint();});
 input.addEventListener('click',()=>paint());
 input.addEventListener('blur',()=>setTimeout(hide,120));
 // Ahead of the composer's own keys (Enter sends), while the list is open.
 (input.closest('#composer')||input.parentElement).addEventListener('keydown',event=>{
  if(pop.hidden||event.target!==input||event.isComposing)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){index=(index+(event.key==='ArrowDown'?1:-1)+picks.length)%picks.length;for(const [i,b] of [...pop.children].filter(n=>n.classList.contains('cm-pick')).entries())b.setAttribute('aria-selected',String(i===index));}
  else if(event.key==='Enter'||event.key==='Tab')insert(picks[index]);
  else if(event.key==='Escape')hide();
  else return;
  event.preventDefault();event.stopImmediatePropagation();
 },true);
 return {close(){glide.close();pop.remove();}};
}
