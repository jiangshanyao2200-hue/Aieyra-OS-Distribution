// Patch receipt view. The host supplies DOM helpers and common activity state; this module never executes tools.
const base=path=>String(path||'').split(/[\\/]/).filter(Boolean).pop()||String(path||'');

export function createPatchView({make,activityData,activityOutcome,groupState,STATES,middleEllipsis}){
 function fillPatch(p,items){
  const item=items.at(-1),patch=item.patch||activityData(item),files=patch.files||[];
  // 同一文件以最后一次为准；默认看最新改的，点文件名可以回头看别的。
  const latest=new Map();for(const i of items)for(const f of (i.patch||activityData(i)).files||[])if(f.path)latest.set(f.path,f);
  const paths=[...latest.keys()],auto=files.at(-1),file=(p.pickedPath&&latest.get(p.pickedPath))||auto,picked=file!==auto,group=groupState(items),failed=['failed','timed_out','interrupted'].includes(item.state)||activityData(item).ok===false;
  const signature=JSON.stringify([item.id,item.state,item.revision,paths,file,patch.omitted_lines,patch.omitted_files,failed,group.state,group.live]);if(signature===p.signature)return;p.signature=signature;
  if(p.state)p.state.textContent=group.live?STATES.running:group.failed?(failed?'未应用':'有修改未应用'):'已应用';
  p.node.dataset.state=group.state;
  const isAdd=row=>['add','+','insert'].includes(row.kind),isDel=row=>['delete','-','remove'].includes(row.kind);
  let added=0,removed=0;for(const f of latest.values())for(const hunk of f.hunks||[])for(const row of hunk.lines||[]){if(isAdd(row))added++;else if(isDel(row))removed++;}
  const chips=make('div','patch-files');
  if(added||removed)chips.append(make('span','patch-sum',(paths.length>1?paths.length+' 个文件 · ':'')+'+'+added+' −'+removed));
  for(const path of paths){
   const chip=make('button','patch-file',middleEllipsis(base(path),30));chip.type='button';chip.title=path;if(path===file?.path)chip.dataset.current='true';
   chip.addEventListener('click',()=>{p.pickedPath=path===auto?.path?'':path;fillPatch(p,items);});chips.append(chip);
  }
  const diff=make('div','patch-diff');
  const lineOf=row=>{
   const add=isAdd(row),del=isDel(row),line=make('div','patch-line'+(add?' add':del?' del':''));
   const number=del?(row.old??row.old_line??row.line):(row.new??row.new_line??row.line??row.old??row.old_line);
   line.append(make('span','patch-no',String(number??'')),make('span','patch-mark',add?'+':del?'−':''),make('span','patch-text',row.text||''));
   return line;
  };
  for(const hunk of file?.hunks||[]){
   const rows=hunk.lines||[];
   for(let i=0;i<rows.length;){
    let j=i;while(j<rows.length&&!isAdd(rows[j])&&!isDel(rows[j]))j++;
    // 长段没改动的上下文折起来，改动的地方才是要看的。
    if(j-i>8){
     const run=rows.slice(i,j),middle=run.slice(3,-3),gap=make('button','patch-gap','⋯ '+middle.length+' 行未改动');gap.type='button';
     gap.addEventListener('click',()=>gap.replaceWith(...middle.map(lineOf)));
     diff.append(...run.slice(0,3).map(lineOf),gap,...run.slice(-3).map(lineOf));i=j;continue;
    }
    if(j>i){diff.append(...rows.slice(i,j).map(lineOf));i=j;continue;}
    diff.append(lineOf(rows[i]));i++;
   }
  }
  if(!file)diff.append(make('p','stage-empty',['queued','running'].includes(item.state)?'正在读取补丁…':'没有可显示的差异'));
  const parts=failed?[make('p','stage-error',activityOutcome(item)),chips,diff]:[chips,diff],omitted=[];
  if(patch.omitted_lines>0)omitted.push(patch.omitted_lines+' 行');
  if(patch.omitted_files>0)omitted.push(patch.omitted_files+' 个文件');
  if(omitted.length)parts.push(make('p','patch-omission','预览另省略 '+omitted.join('、')+'；实际修改以文件和完整回执为准。'));
  p.body.replaceChildren(...parts);diff.scrollTop=picked?0:diff.scrollHeight;
 }
 return fillPatch;
}
