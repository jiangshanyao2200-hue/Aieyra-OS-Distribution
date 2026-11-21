// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: PRESETS; TEXT_COLORS; hsl; toHex; validHex; colorField
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/glass-color.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 自绘取色：色块按钮 + 浮层（色相条、预设色、十六进制）。系统取色面板的样式我们管不了。
const PRESETS=['#000000','#525866','#9aa3b2','#ffffff','#a9c0ec','#9fd8b4','#e3c19c','#c9a9ec'];
const TEXT_COLORS={'#ffffff':'白色','#e8edf5':'柔白','#a9c0ec':'浅蓝','#9fd8b4':'浅绿','#e3c19c':'暖金','#c9a9ec':'浅紫','#9de5ef':'青色','#f3b8d1':'浅粉'};
const hsl=hex=>{const n=parseInt(hex.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;let h=0;if(d){h=max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;}return {h:Math.round(h*60),s:d?d/(1-Math.abs(2*l-1)):0,l};};
const toHex=(h,s,l)=>{const f=n=>{const k=(n+h/30)%12,a=s*Math.min(l,1-l);return Math.round((l-a*Math.max(-1,Math.min(k-3,9-k,1)))*255).toString(16).padStart(2,'0');};return '#'+f(0)+f(8)+f(4);};
export const validHex=value=>/^#[0-9a-f]{6}$/i.test(value);
export function colorField(doc,{value,label,onChange,dropdown=false}){
 const button=doc.createElement('button');button.type='button';button.className=dropdown?'glass-color glass-color-dropdown glass-select':'glass-color';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.style.setProperty('--swatch',value);
 let caption;if(dropdown){const swatch=doc.createElement('i');swatch.className='glass-color-dot';swatch.setAttribute('aria-hidden','true');caption=doc.createElement('span');caption.className='glass-select-value';button.append(swatch,caption);}
 let current=validHex(value)?value:'#000000',panel=null,dismiss=null,sync=null,observer=null;
 const display=()=>{if(caption)caption.textContent=TEXT_COLORS[current]||current.toUpperCase();button.title=current.toUpperCase();};display();
 const set=(next,fromInput=false)=>{current=next;button.style.setProperty('--swatch',next);display();onChange(next);sync?.(fromInput);};
 function close(){panel?.remove();panel=null;sync=null;observer?.disconnect();observer=null;if(dismiss)doc.removeEventListener('pointerdown',dismiss,true);dismiss=null;button.setAttribute('aria-expanded','false');}
 function open(){
  panel=doc.createElement('div');panel.className='glass-color-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',label);
  const ranges={};let channels=hsl(current);
  for(const [key,label,max]of [['h','色相',360],['s','饱和度',100],['l','明度',100]]){
   const row=doc.createElement('label'),text=doc.createElement('span'),input=doc.createElement('input');row.className='glass-color-channel';text.textContent=label;input.type='range';input.min='0';input.max=String(max);input.step='1';input.className=key==='h'?'glass-color-hue':'';input.setAttribute('aria-label',label);ranges[key]=input;
   input.oninput=()=>{channels[key]=Number(input.value)/(key==='h'?1:100);set(toHex(channels.h,channels.s,channels.l));};row.append(text,input);panel.append(row);
  }
  const presets=doc.createElement('div');presets.className='glass-color-presets';
  presets.append(...(dropdown?Object.keys(TEXT_COLORS):PRESETS).map(color=>{const b=doc.createElement('button');b.type='button';b.style.setProperty('--swatch',color);b.setAttribute('aria-label',TEXT_COLORS[color]||(color==='#000000'?'黑色':color));b.onclick=()=>{channels=hsl(color);set(color);};return b;}));
  const hex=doc.createElement('input');hex.type='text';hex.value=current;hex.maxLength=7;hex.spellcheck=false;hex.setAttribute('aria-label','十六进制颜色');hex.oninput=()=>{const valid=validHex(hex.value);hex.setAttribute('aria-invalid',String(!valid));if(valid){channels=hsl(hex.value);set(hex.value.toLowerCase(),true);}};
  sync=fromInput=>{for(const [key,input]of Object.entries(ranges))input.value=String(Math.round(channels[key]*(key==='h'?1:100)));if(!fromInput){hex.value=current;hex.removeAttribute('aria-invalid');}for(const b of presets.children)b.setAttribute('aria-pressed',String(b.style.getPropertyValue('--swatch')===current));};sync();
  panel.append(presets,hex);doc.body.append(panel);button.setAttribute('aria-expanded','true');
  const r=button.getBoundingClientRect(),p=panel.getBoundingClientRect(),win=doc.defaultView;
  panel.style.left=Math.max(8,Math.min(win.innerWidth-p.width-8,r.right-p.width))+'px';panel.style.top=(r.bottom+8+p.height>win.innerHeight-8?Math.max(8,r.top-8-p.height):r.bottom+8)+'px';
  dismiss=event=>{if(!panel?.contains(event.target)&&!button.contains(event.target))close();};doc.addEventListener('pointerdown',dismiss,true);
  if(doc.defaultView.MutationObserver){observer=new doc.defaultView.MutationObserver(()=>{if(!button.isConnected||button.checkVisibility?.()===false)close();});observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-view']});}
  panel.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();button.focus();}};hex.focus();hex.select();
 }
 button.onclick=()=>panel?close():open();
 return button;
}
