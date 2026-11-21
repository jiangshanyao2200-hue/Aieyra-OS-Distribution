// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: pageCapacity; createCatalogue
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/theme-library-pagination.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// The public catalogue is cursor based. Numbered pages index only real records;
// an undiscovered tail never becomes an invented total or last-page button.
export {pageNumbers,PAGE_WINDOW} from './pagination.mjs';

export function pageCapacity(category,width){
 if(category==='ui'||category==='halo')return 9;
 if(category!=='avatar')return 24;
 return Math.min(24,Math.max(1,Math.floor((Math.max(0,width)+24)/164))*3);
}

export function createCatalogue(fetchPage,size=24){
 let records=[],cursor='',started=false,complete=false,stale=false;
 const cursors=new Set(),ids=new Set();
 // One reader at a time: a background look-ahead and a user jump must not fetch
 // the same cursor twice (which would read as a repeated page).
 let tail=null;
 const serial=fn=>{const run=tail?tail.then(fn,fn):fn(),settled=run.then(()=>{},()=>{});tail=settled;settled.then(()=>{if(tail===settled)tail=null;});return run;};
 const snapshot=index=>{
  const count=Math.max(1,Math.ceil(records.length/size));
  index=Math.max(0,Math.min(index,count-1));
  return {index,offset:index*size,items:records.slice(index*size,(index+1)*size),hasNext:(index+1)*size<records.length||!complete,
   knownPages:Math.max(1,Math.ceil((records.length+(complete?0:1))/size)),total:complete?records.length:null,stale};
 };
 return {
  get size(){return size;},
  resize(value){if(!Number.isInteger(value)||value<1||value>100)throw Error('每页数量无效');size=value;},
  snapshot,
  seek(index,isCurrent=()=>true){return serial(()=>fill(index,isCurrent).then(done=>done?snapshot(index):null));},
  // Discover enough real pages to number a full window without moving the view.
  prefetch(index,isCurrent=()=>true){return serial(()=>fill(index,isCurrent)).then(done=>done?snapshot(0):null);},
 };
 async function fill(index,isCurrent){
   if(!Number.isSafeInteger(index)||index<0)throw Error('请输入有效页码');
   let reads=0;
   while(!complete&&(!started||records.length<(index+1)*size)){
    if(!isCurrent())return false;
    if(reads++>=100)throw Error('目录较大，已保留读取进度，请再次跳转继续载入');
    const requested=cursor,result=await fetchPage(requested);
    if(!isCurrent())return false;
    if(!result||!Array.isArray(result.items)||result.nextCursor!=null&&typeof result.nextCursor!=='string')throw Error('主题分页无效');
    const next=result.nextCursor||null;
    if(next&&(next===requested||cursors.has(next)))throw Error('主题目录返回了重复分页，请重新载入');
    stale=stale||result.stale===true;
    cursors.add(requested);
    for(const item of result.items)if(!ids.has(item.id)){ids.add(item.id);records.push(item);}
    started=true;cursor=next;complete=!next;
   }
   return true;
 }
}
