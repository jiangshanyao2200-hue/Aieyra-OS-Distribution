// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TYPE; word; revealStep; createTypewriter
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/typewriter.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 正文打字机（docs/UI设计知识库.md 形态 §5）：速度优先，与响应同时结束。
// 流还在继续时，每帧显示 积压 × dt / 跟随延迟，所以永远只落后约 0.3 秒；流一结束，剩下的在 250ms 内全部显示。
// 中文逐字；英文按词（不在单词中间停）；不切断代理对。渲染节流到约 30 帧/秒。
import {motionAllowed,observeMotion} from './motion.mjs';
export const TYPE={lagMs:300,finishMs:250,renderMs:33};

const word=/[A-Za-z0-9_'’-]/;
// 纯函数：这一帧之后应显示到第几个字符。
export function revealStep({shown,length,done,dt,doneFor=0,text=''},{lagMs=TYPE.lagMs,finishMs=TYPE.finishMs}={}){
 const backlog=length-shown;if(backlog<=0)return length;
 const budget=done?Math.max(16,finishMs-doneFor):lagMs;
 let next=shown+Math.max(1,Math.ceil(backlog*Math.min(1,dt/budget)));
 if(next>=length)return length;
 // 英文：走到词尾再停；最多多走 16 个字符，避免一帧跳太远。
 for(let i=0;i<16&&next<length&&word.test(text[next]||'')&&word.test(text[next-1]||'');i++)next++;
 // 不停在代理对中间。
 const code=text.charCodeAt(next);if(code>=0xdc00&&code<=0xdfff)next++;
 return Math.min(next,length);
}

export function createTypewriter({render,win=globalThis.window,now=()=>performance.now()}){
 let el=null,text='',shown=0,done=false,doneAt=0,frame=0,last=0,rendered='',lastRender=0,stopMotion=null;
 const instant=()=>!motionAllowed(win?.document)||win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const settle=allowed=>{if(allowed||!el)return;if(frame)win.cancelAnimationFrame(frame);frame=0;last=0;shown=text.length;draw(true);};
 function draw(force){
  const t=now();if(!force&&t-lastRender<TYPE.renderMs&&shown<text.length)return;
  const visible=text.slice(0,shown);
  if(rendered!==visible){lastRender=t;rendered=visible;render(el,visible);}
  el.classList.toggle('typing',shown<text.length||!done);
 }
 function tick(){
  frame=0;if(!el)return;const t=now(),dt=last?Math.min(100,t-last):16;last=t;
  shown=instant()?text.length:revealStep({shown,length:text.length,done,dt,doneFor:done?t-doneAt:0,text});
  draw(shown>=text.length);
  if(shown<text.length)frame=win.requestAnimationFrame(tick);else{last=0;if(done)el.classList.remove('typing');}
 }
 const start=()=>{if(!frame)frame=win.requestAnimationFrame(tick);};
 return {
  // 显示 next 到 target。同一元素、新文本是旧文本的延续时接着打；换了元素可用 from 指定已显示的长度（回复落进聊天时接着打）。
  show(target,next,{done:finished=false,from=null}={}){
   if(!stopMotion)stopMotion=observeMotion(win?.document,settle);
   const continues=target===el&&next.startsWith(text.slice(0,shown));
   if(!continues){el?.classList.remove('typing');el=target;rendered=null;shown=from===null?0:Math.min(from,next.length);done=false;doneAt=0;}
   text=next;
   if(instant()){if(frame)win.cancelAnimationFrame(frame);frame=0;shown=text.length;last=0;}
   // 换了元素时当帧就画出已显示的部分，不让旧内容闪一帧。
   if(!continues&&shown<text.length)draw(true);
   if(finished&&!done){done=true;doneAt=now();}else if(!finished){done=false;}
   if(shown<text.length)start();else draw(true);
  },
  // 交出当前进度（供落进聊天的回复接着打）。
  progress(){return {text:text.slice(0,shown),full:text,el};},
  detach(){if(frame)win.cancelAnimationFrame(frame);stopMotion?.();stopMotion=null;frame=0;el?.classList.remove('typing');el=null;text='';shown=0;done=false;last=0;},
  get active(){return !!el&&shown<text.length;},
 };
}
