// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupProgramImageJobs
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/program-image-jobs.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Image jobs can outlive the chat turn, so their reader must not depend on a
// changed conversation frame. Only an expanded, ready Workspace owns a reader.
export function setupProgramImageJobs({root,read,onError},doc=root.ownerDocument){
 let scope='',revision=0,closed=false,busy=false,pending=false,timer=0,rowsKey='';
 const current=own=>!closed&&!!scope&&own===revision;
 function hidden(){
  clearTimeout(timer);timer=0;pending=false;
  if(scope){scope='';revision++;}
  root.hidden=true;
 }
 async function refresh(){
  clearTimeout(timer);timer=0;if(closed||!scope)return;
  if(busy){pending=true;return;}
  busy=true;pending=false;const own=revision;
  try{
   const result=await read('jobs');if(!current(own))return;
   const rows=(result.jobs||[]).filter(j=>!['completed','cancelled'].includes(j.status)),key=JSON.stringify(rows);
   root.hidden=!rows.length;if(key===rowsKey)return;rowsKey=key;root.replaceChildren();
   for(const j of rows){
    const row=doc.createElement('div'),label=doc.createElement('span');row.className='program-image-job';
    label.textContent=({running:'正在绘图',paused:'绘图已暂停',pausing:'正在保存本批图片',interrupted:'绘图已中断',error:'绘图需要查看'}[j.status]||j.status);row.append(label);
    for(const op of j.status==='running'?['pause','cancel']:['paused','interrupted','error'].includes(j.status)?['resume','cancel']:['cancel']){
     const b=doc.createElement('button');b.type='button';b.className='ui-outline';b.textContent={pause:'暂停绘图',resume:'继续绘图',cancel:'停止绘图'}[op];b.disabled=op==='resume'&&j.unknown>0;
     b.onclick=async()=>{
      if(!current(own)||b.disabled)return;b.disabled=true;
      try{await read('job_control',{jobId:j.id,operation:op});if(current(own)){rowsKey='';await refresh();}}
      catch(e){if(current(own))onError(e);}
      finally{b.disabled=false;}
     };
     row.append(b);
    }
    root.append(row);
   }
  }catch(e){if(current(own))onError(e);}
  finally{
   busy=false;
   if(!closed&&scope){const delay=pending||own!==revision?0:1500;pending=false;timer=setTimeout(()=>void refresh(),delay);}
  }
 }
 return {
  paint(frame){
   if(closed||frame.program!=='workspace'||!frame.expanded||!frame.ready){hidden();return;}
   const next=JSON.stringify([frame.task_id,frame.core_epoch]);if(scope===next)return;
   scope=next;revision++;rowsKey='';root.hidden=true;root.replaceChildren();void refresh();
  },
  hidden,
  close(){closed=true;hidden();},
 };
}
