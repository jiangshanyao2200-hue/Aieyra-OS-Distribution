// Snap only when operated; preserve stored values and reachable endpoints.
export function tidyValue(value,{min=0,max=100,step=5}={}){
 const n=Number(value);if(!Number.isFinite(n))return min;
 if(n<=min)return min;if(n>=max)return max;
 return Math.min(max,Math.max(min,Number((Math.round(n/step)*step).toFixed(6))));
}
export function bindTidyRange(input,step){
 input.step='any';
 const spec=()=>({min:Number(input.min),max:Number(input.max),step});
 const snap=()=>{input.value=String(tidyValue(input.value,spec()));};
 const key=event=>{
  if(!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End','PageUp','PageDown'].includes(event.key))return;
  event.preventDefault();const {min,max}=spec(),value=Number(input.value),direction=['ArrowLeft','ArrowDown','PageDown'].includes(event.key)?-1:1;
  const next=event.key==='Home'?min:event.key==='End'?max:direction>0?(Math.floor(value/step+1e-7)+1)*step:(Math.ceil(value/step-1e-7)-1)*step;
  input.value=String(Math.min(max,Math.max(min,next)));
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
 };
 input.addEventListener('input',snap,true);input.addEventListener('keydown',key);
 return ()=>{input.removeEventListener('input',snap,true);input.removeEventListener('keydown',key);};
}
