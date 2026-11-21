// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: HistoryPages; historyPageNumbers; historyNavigation
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/history-pages.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Bounded read-only pages, scoped to the original session. No execution here.
export class HistoryPages {
  constructor(fetch,{limit=30,max=240}={}){this.fetch=fetch;this.limit=limit;this.max=max;this.version=0;this.scope='';this.opened=false;this.page=1;this.pages=1;this.rows=[];this.busy=false;this.loaded=false;this.before='';this.hasMore=false;this.indexing=false;this.warning='';this.error='';this.trimmed=false;}
  reset({core_epoch='',session_id,history_segment=''}){
    const scope=JSON.stringify([core_epoch,session_id,history_segment]);if(scope===this.scope)return false;
    this.version++;Object.assign(this,{scope,task:session_id,segment:history_segment,page:1,pages:1,rows:[],busy:false,loaded:false,before:'',hasMore:false,indexing:false,error:'',warning:'',trimmed:false,paged:false});return true;
  }
  close(){this.opened=false;this.version++;this.busy=false;}
  async numbered(page=this.page){
    if(!this.opened)return false;
    const version=++this.version;this.busy=true;this.error='';
    try{
      const result=await this.fetch({task_id:this.task,segment:this.segment,all_history:true,page});
      if(version!==this.version||!this.opened)return false;
      if(result.reset)throw Error('历史段已变化，请重新打开记录。');
      Object.assign(this,{page:result.page||1,pages:result.pages||1,rows:result.entries||[],indexing:!!result.indexing,warning:result.warning||'',loaded:true,paged:result.page>1});
      return true;
    }catch(error){if(version===this.version)this.error=error.message;return false;}
    finally{if(version===this.version)this.busy=false;}
  }
  async load(mode='latest'){
    if(!this.opened||this.busy||mode==='older'&&(this.indexing||!this.hasMore||!this.before))return false;
    const version=this.version,cursor=mode==='older'?this.before:'';
    this.busy=true;this.error='';
    try{
      const result=await this.fetch({task_id:this.task,segment:this.segment,all_history:true,before:cursor,limit:this.limit});
      if(version!==this.version||!this.opened)return false;
      if(result.reset)throw Error('历史段已变化，请重新打开记录。');
      const replacing=mode==='reset'||mode==='latest'&&this.indexing&&!this.paged;
      const incoming=result.entries||[],merged=new Map((replacing?[]:this.rows).map(r=>[r.id,r]));
      for(const row of incoming)merged.set(row.id,row);
      let rows=[...merged.values()].sort((a,b)=>a.sort_key&&b.sort_key?a.sort_key.localeCompare(b.sort_key):Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
      if(rows.length>this.max){this.trimmed=true;rows=mode==='older'?rows.slice(0,this.max):rows.slice(-this.max);}
      this.rows=rows;this.indexing=!!result.indexing;this.warning=result.warning||'';this.loaded=true;
      if(mode==='reset'){this.paged=false;this.trimmed=false;}
      if(mode==='older')this.paged=true;
      if(mode==='older'||replacing||!this.paged&&this.rows.length<=this.limit){this.before=result.before||'';this.hasMore=!!result.has_more;}
      else if(mode==='latest'&&rows.length===this.max){this.before=rows[0]?.sort_key||this.before;this.hasMore=true;}
      return true;
    }catch(e){if(version===this.version&&this.opened)this.error=e.message;return false;}
    finally{if(version===this.version)this.busy=false;}
  }
}

export function historyPageNumbers(page,pages){
 const size=page<6?6:7,start=Math.max(1,Math.min(page<6?1:page-2,pages-size+1));
 return Array.from({length:Math.min(size,pages)},(_,i)=>start+i);
}
export function historyNavigation(doc,select){
 const nav=doc.createElement('nav');nav.className='hx-pagination';nav.setAttribute('aria-label','历史页码');
 let key='';
 return {element:nav,paint(page,pages,busy){
  const state=[page,pages,busy].join('/');if(state===key)return;key=state;
  const focused=nav.contains(doc.activeElement);
  const button=(label,target,aria,disabled=false)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',aria);b.disabled=busy||disabled;b.onclick=()=>select(target);return b;};
  const numbers=historyPageNumbers(page,pages).map(n=>{const b=button(String(n),n,'第 '+n+' 页');if(n===page)b.setAttribute('aria-current','page');return b;});
  nav.replaceChildren(button('‹',page-1,'上一页',page<=1),...numbers,button('›',page+1,'下一页',page>=pages));
  if(focused&&!busy)nav.querySelector('[aria-current]')?.focus({preventScroll:true});
 }};
}
