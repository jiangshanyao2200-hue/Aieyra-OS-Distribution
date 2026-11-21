// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: tidyValue; magneticValue; bindTidyRange
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/tidy-range.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Number entry and keyboard adjustments retain the requested hundredth.
// Only pointer dragging near a preferred value receives magnetic assistance.
export function tidyValue(value,{min=0,max=100}={}){
 const n=Number(value);return Number(Math.min(max,Math.max(min,Number.isFinite(n)?n:min)).toFixed(2));
}
export function magneticValue(value,{min=0,max=100,value:recommended}={}){
 const v=tidyValue(value,{min,max}),nearest=Math.round(v/5)*5;
 const stops=[min,max,nearest,recommended].filter(n=>Number.isFinite(n)&&n>=min&&n<=max);
 const threshold=Math.min(.4,(max-min)*.004);
 const target=stops.sort((a,b)=>Math.abs(a-v)-Math.abs(b-v))[0];
 return target!==undefined&&Math.abs(target-v)<=threshold?target:v;
}
export function bindTidyRange(input,options={}){
 if(typeof options!=='object')options={};
 const spec=()=>({min:Number(input.min),max:Number(input.max),value:options.value});
 const stops=options.values?.filter(Number.isFinite).sort((a,b)=>a-b),step=stops?.length>1?stops[1]-stops[0]:options.integer?1:.01;
 const constrain=value=>{const v=tidyValue(value,spec());return stops?.length?stops.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a):options.integer?Math.round(v):v;};
 input.step=String(step);let pointer=false,editing=false;
 const output=options.output||input.parentElement?.querySelector('output'),doc=input.ownerDocument;
 const number=doc.createElement('input');number.type='number';number.className='range-number';number.min=input.min;number.max=input.max;number.step=String(step);
 const name=options.label||input.parentElement?.querySelector('span')?.textContent||input.getAttribute('aria-label')||'数值';
 input.setAttribute('aria-label',name);number.setAttribute('aria-label',name+'精确值');
 const unit=doc.createElement('span');unit.className='range-unit';unit.textContent=options.unit||'';
 if(output){output.classList.add('range-value');output.replaceChildren(number,unit);}
 const paint=()=>{number.min=input.min;number.max=input.max;if(!editing)number.value=input.value;const {min,max}=spec(),percent=(Number(input.value)-min)/(max-min||1)*100;input.style.setProperty('--fill',percent+'%');};
 const snap=()=>{input.value=String(constrain(pointer?magneticValue(input.value,spec()):input.value));paint();};
 const emit=()=>{input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
 number.oninput=()=>{if(number.value===''||!Number.isFinite(Number(number.value)))return;editing=true;try{input.value=String(constrain(number.value));emit();}finally{editing=false;}};
 number.onchange=()=>{input.value=String(constrain(number.value));paint();emit();};
 number.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();number.onchange();number.blur();}};
 const down=()=>{pointer=true;},up=()=>{pointer=false;};
 const key=event=>{
  if(!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End','PageUp','PageDown'].includes(event.key))return;
  event.preventDefault();pointer=false;
  const direction=['ArrowLeft','ArrowDown','PageDown'].includes(event.key)?-1:1;
  const amount=stops?.length?step:event.key.startsWith('Page')?(options.integer?10:1):event.shiftKey?step*10:step,{min,max}=spec();
  input.value=String(constrain(event.key==='Home'?min:event.key==='End'?max:Number(input.value)+direction*amount));emit();
 };
 input.addEventListener('pointerdown',down);input.addEventListener('pointerup',up);input.addEventListener('pointercancel',up);
 input.addEventListener('input',snap,true);input.addEventListener('keydown',key);paint();
 return {paint,number,close(){input.removeEventListener('input',snap,true);input.removeEventListener('keydown',key);input.removeEventListener('pointerdown',down);input.removeEventListener('pointerup',up);input.removeEventListener('pointercancel',up);}};
}
