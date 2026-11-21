// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: pending; copyFeedback
// Impact: python -B scripts/code-atlas.py show Theme/runtime/copy-feedback.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const pending=new WeakMap();
// Call only after the clipboard write succeeds. Repeated clicks extend one cue.
export function copyFeedback(button,label='已复制'){
 pending.get(button)?.();
 const win=button.ownerDocument.defaultView,original=button.innerHTML,attrs=['aria-label','title','data-tip'].map(name=>[name,button.getAttribute(name)]);
 let timer;const reset=()=>{win.clearTimeout(timer);button.innerHTML=original;delete button.dataset.copied;for(const [name,value]of attrs)if(value===null)button.removeAttribute(name);else button.setAttribute(name,value);pending.delete(button);};
 button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';button.dataset.copied='true';button.setAttribute('aria-label',label);button.removeAttribute('title');button.setAttribute('data-tip',label);
 if(!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches&&!button.ownerDocument.body.classList.contains('reduce-motion'))button.querySelector('svg')?.animate?.([{transform:'scale(.75)',opacity:.4},{transform:'scale(1)',opacity:1}],{duration:240,easing:'ease-out'});
 timer=win.setTimeout(reset,1800);pending.set(button,reset);return reset;
}
