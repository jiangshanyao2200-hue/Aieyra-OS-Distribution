// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TextPacer; thoughtSegments; ThoughtPacer; PhasePacer; briefDwell; BriefPacer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/pacing.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Display timing only. Network, execution, cancellation and receipts never wait here.
export class TextPacer {
  constructor() { this.key=''; this.target=''; this.value=''; this.fast=false; this.started=0; this.arrived=0; this.due=0; this.deadline=0; }
  set(text,key,now) {
    if(key!==this.key || !text.startsWith(this.target)) {
      this.key=key;this.target='';this.value='';this.fast=false;this.started=now;this.arrived=0;this.due=now;this.deadline=now+1800;
    }
    const added=Array.from(text.slice(this.target.length)).length;
    if(added){if(!this.arrived)this.started=now;if(!this.pending)this.deadline=now+1800;this.arrived+=added;const elapsed=Math.max(250,now-this.started);if(added>=24||this.arrived>=18&&this.arrived/elapsed*1000>62)this.fast=true;}
    this.target=text;
  }
  get pending(){return this.value!==this.target;}
  next(now,instant=false){
    if(instant||now>=this.deadline){this.value=this.target;return this.value;}
    if(now<this.due||!this.pending)return this.value;
    const rest=Array.from(this.target.slice(this.value.length));
    // Catch up with bursts in short frames, with no multi-second artificial
    // backlog. Provider/network timing remains independent of presentation.
    let count=this.fast?Math.min(Math.max(4,Math.ceil(rest.length/9)),36,rest.length):1;
    if(this.fast){const punctuation=rest.slice(6,count).findIndex(c=>/[，。！？,;；.!?\n]/u.test(c));if(punctuation>=0)count=punctuation+7;}
    this.value+=rest.slice(0,count).join('');this.due=now+(this.fast?32:20);
    if(!this.pending)this.deadline=now+1800;
    return this.value;
  }
}

// 只平滑已经收到的公开思考，最多落后160ms；新阶段立即清空，不补播旧段。
const thoughtSegments=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export class ThoughtPacer {
  constructor(){this.clear();}
  clear(){this.key='';this.target='';this.value='';this.parts=[];this.ends=[];this.count=0;this.from=0;this.started=0;this.deadline=0;}
  get pending(){return this.value!==this.target;}
  set(text,key,now){
    if(key===this.key&&text===this.target)return;
    if(key!==this.key||!text.startsWith(this.target))this.clear();
    const pending=this.pending;
    this.key=key;
    // 追加只重算末尾两个字素与增量；若分片切开代理对，补全后
    // 仍能与前面的 ZWJ 合并，组合符和旗帜也保持完整边界。
    // 思考越长也不再逐帧重新分词或连接全文。
    const tail=Math.max(0,this.parts.length-2),start=tail?this.ends[tail-1]:0;
    this.parts.length=tail;this.ends.length=tail;
    for(const part of thoughtSegments.segment(text.slice(start))){this.parts.push(part.segment);this.ends.push(start+part.index+part.segment.length);}
    this.target=text;
    if(this.count>tail){this.count=tail;while(this.count<this.ends.length&&this.ends[this.count]<this.value.length)this.count++;if(this.count<this.ends.length)this.count++;this.value=text.slice(0,this.ends[this.count-1]||0);}
    this.from=this.count;this.started=now;
    if(!pending)this.deadline=now+160;
  }
  next(now,instant=false){
    if(instant||now>=this.deadline){this.count=this.parts.length;this.value=this.target;return this.value;}
    const progress=Math.max(0,Math.min(1,(now-this.started)/Math.max(1,this.deadline-this.started)));
    const count=Math.max(this.count,this.from+Math.floor((this.parts.length-this.from)*progress));
    if(count>this.count){this.value+=this.parts.slice(this.count,count).join('');this.count=count;}return this.value;
  }
}

// Brief intermediate phases collapse into the latest one instead of queuing animations.
export class PhasePacer {
  constructor(){this.state='idle';this.key='';this.next='';this.since=0;}
  get pending(){return this.next!==this.state;}
  choose(state,key,now,immediate=false){
    if(key!==this.key){this.key=key;this.state=state;this.next=state;this.since=now;return state;}
    if(immediate||['offline','error','cancelling','waiting_user','idle'].includes(state)){this.state=state;this.next=state;this.since=now;return state;}
    if(state===this.state){this.next=state;this.since=now;return state;}
    if(this.next!==state){this.next=state;this.since=now;}
    const wait=['body','tool'].includes(state)?70:180;
    if(now-this.since>=wait)this.state=state;
    return this.state;
  }
}

// 用户靠 brief 看进度：每条停留到读得完，字越多停越久；排队多了才缩短，再多就跳到最新的。
export function briefDwell(text,backlog=0){
  const read=Math.min(4200,Math.max(1400,700+Array.from(String(text||'')).length*90));
  return backlog>=3?Math.max(700,read*.4):backlog>=1?Math.max(1000,read*.7):read;
}
export class BriefPacer {
  // setTimeout/clearTimeout 不能当成本对象的方法调（浏览器里报 Illegal invocation），默认值包一层。
  constructor(show,{now=()=>Date.now(),later=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}={}){this.show=show;this.now=now;this.later=later;this.cancel=cancel;this.queue=[];this.current=null;this.until=0;this.timer=0;}
  push(text){
    if(!text||text===this.current||text===this.queue.at(-1))return;
    this.queue.push(text);if(this.queue.length>5)this.queue.splice(0,this.queue.length-3);
    this.pump();
  }
  pump(){
    if(this.timer||!this.queue.length)return;
    const wait=this.until-this.now();
    if(wait>0){this.timer=this.later(()=>{this.timer=0;this.pump();},wait);return;}
    this.current=this.queue.shift();this.until=this.now()+briefDwell(this.current,this.queue.length);this.show(this.current);
    if(this.queue.length)this.pump();
  }
  get dwelling(){return this.until>this.now()||this.queue.length>0;}
  close(){this.cancel(this.timer);this.timer=0;this.queue=[];}
}
