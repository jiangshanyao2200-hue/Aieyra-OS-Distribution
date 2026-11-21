// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ThoughtRibbon
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/thought-ribbon.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 纵向阅读位置独立于流式追加；到末尾停留，不跳回开头重播。
export class ThoughtRibbon {
  constructor(){this.reset();}
  reset(){this.offset=0;this.last=null;this.pause=900;this.end=false;}
  next(now,overflow,{paused=false,reduced=false}={}){
    const delta=this.last===null?0:Math.min(64,Math.max(0,now-this.last));this.last=now;
    const limit=Math.max(0,overflow);
    this.offset=Math.min(this.offset,limit);
    if(!limit){this.offset=0;this.pause=900;this.end=false;return 0;}
    if(paused||reduced)return this.offset;
    // 新追加的文字接在当前位置后，保留用户已经读过的位置。
    if(this.end&&this.offset<limit){this.end=false;this.pause=0;}
    if(this.pause>0){this.pause=Math.max(0,this.pause-delta);return this.offset;}
    if(this.end)return this.offset;
    this.offset=Math.min(limit,this.offset+delta*.025);
    if(this.offset===limit){this.end=true;this.pause=900;}
    return this.offset;
  }
}
