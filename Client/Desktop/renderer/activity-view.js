// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/renderer/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/renderer/activity-view.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 同一份真实过程模型用于专项窗口；阅读时间仅影响显示，不触碰执行器。
(function(scope){
 const live=new Set(['queued','running','starting','cancelling']);
 const faults=new Set(['failed','cancelled','timed_out','interrupted_unknown','rejected','blocked']);
 const names={exec_command:['执行命令','Run command'],exec:['组合操作','Coordinate tools'],wait:['续接执行','Continue execution'],write_stdin:['输入到进程','Send input'],read_shell_output:['查看执行结果','Read output'],apply_patch:['修改文件','Edit files'],view_image:['查看图片','View image'],update_plan:['更新计划','Update plan'],browser:['浏览网页','Browse'],computer:['操作电脑','Computer action'],settings:['配置系统','Configure system'],agents:['专项协作','Delegate work'],tool_factory:['创建工具','Build a tool'],compact:['整理上下文','Compact context']};
 const actions={open:['打开网页','Open page'],navigate:['访问网页','Navigate'],search:['搜索','Search'],snapshot:['阅读页面','Read page'],click:['点击元素','Click element'],fill:['填写内容','Fill input'],select:['选择选项','Select option'],upload:['上传文件','Upload file'],wait_for:['等待页面内容','Wait for page content'],evaluate:['执行页面操作','Run page operation'],screenshot:['截取页面','Capture page'],key:['按键输入','Press key'],scroll:['滚动页面','Scroll page'],back:['返回上一页','Go back'],forward:['前进','Go forward'],reload:['刷新页面','Reload page'],activate:['切换标签','Switch tab'],close:['关闭标签','Close tab'],handle_dialog:['处理网站提示','Respond to website'],download_cancel:['取消下载','Cancel download'],create:['创建任务','Create task'],review:['检查交付','Review delivery'],send:['补充任务','Send task'],wait:['等待任务','Wait for task'],cancel:['停止','Stop'],test:['测试','Test']};
 class Timeline {
  constructor(){this.items=new Map();this.read=new Map();this.cursor=0;this.total=0;this.hasOlder=false;this.last=0;}
  ingest(page){
   if(page.retained_from)for(const [id,item]of this.items)if(item.sequence<page.retained_from){this.items.delete(id);this.read.delete(id);}
   for(const item of page.items||[]){const old=this.items.get(item.id);if(old&&old.revision>item.revision)continue;if(item.hidden){this.items.delete(item.id);this.read.delete(item.id);continue;}this.items.set(item.id,item);
    if(!old||old.state!==item.state||old.title!==item.title||old.detail!==item.detail||old.command!==item.command||JSON.stringify(old.patch)!==JSON.stringify(item.patch)||JSON.stringify(old.targets)!==JSON.stringify(item.targets))this.read.delete(item.id);
   }
   if(Number.isFinite(page.cursor))this.cursor=Math.max(this.cursor,page.cursor);
   this.total=page.total??this.items.size;if(page.page!=='delta')this.hasOlder=!!page.has_older;
  }
  advance(now,visible,windowVisible=true){
   const delta=this.last?Math.min(300,Math.max(0,now-this.last)):0;this.last=now;
   if(!windowVisible)return;
   for(const id of visible){const item=this.items.get(id);if(!item||live.has(item.state)||faults.has(item.state))continue;this.read.set(id,Math.min(1800,(this.read.get(id)||0)+delta));}
  }
  ordered(){
   const values=[...this.items.values()].sort((a,b)=>a.sequence-b.sequence),byID=this.items;
   const children=new Map();for(const item of values)if(item.parent&&byID.has(item.parent)){if(!children.has(item.parent))children.set(item.parent,[]);children.get(item.parent).push(item);}
   const rows=[],seen=new Set();const add=item=>{if(seen.has(item.id))return;seen.add(item.id);rows.push(item);for(const child of children.get(item.id)||[])add(child);};
   for(const item of values)if(!item.parent||!byID.has(item.parent))add(item);for(const item of values)add(item);return rows;
  }
  collapsed(item){return !live.has(item.state)&&!faults.has(item.state)&&(this.read.get(item.id)||0)>=1800;}
  current(){return this.ordered().filter(item=>!this.collapsed(item));}
  history(){return this.ordered().filter(item=>this.collapsed(item));}
 }
 function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
 class ActivityView {
  constructor(root,options={}){this.root=root;this.context=options.context||'task';this.timeline=new Timeline();this.english=false;this.state='running';this.expanded=false;this.windowVisible=true;this.rowNodes=new Map();
   root.classList.add('activity-view');this.heading=element('div',undefined,'activity-heading');this.label=element('span',undefined,'activity-label');this.historyButton=element('button',undefined,'history-toggle');this.historyButton.type='button';this.historyButton.onclick=()=>{this.expanded=!this.expanded;this.paint();};
   this.heading.append(this.label,this.historyButton);this.current=element('div',undefined,'activity-current');this.past=element('div',undefined,'activity-past');this.empty=element('p',undefined,'activity-empty');this.more=element('button',undefined,'history-toggle older');this.more.type='button';this.more.onclick=()=>this.onOlder?.();
   this.archive=element('p',undefined,'activity-empty');root.append(this.heading,this.current,this.past,this.empty,this.more,this.archive);this.clock=setInterval(()=>this.tick(),200);this.paint();
  }
  destroy(){clearInterval(this.clock);this.root.replaceChildren();}
  text(zh,en){return this.english?en:zh;}
  update(page,english,state){this.english=english;this.state=state;this.archived=page.archived_count||0;this.timeline.ingest(page);this.paint();}
  title(item){const name=names[item.tool]?.[this.english?1:0]||item.tool;let title=item.title||(actions[item.action]?.[this.english?1:0]||name);if(item.action==='load_tool'||item.action==='unload_tool')title=(item.action==='load_tool'?this.text('载入工具说明 · ','Load tool instructions · '):this.text('收起工具说明 · ','Unload tool instructions · '))+name;return (item.actor==='human'?this.text('你 · ','You · '):'')+title;}
  detail(item){const messages={human_control:['已交给你操作，这次请求已中止。','Handed over to you. This request was interrupted.'],snapshot_required:['交还后需要先重新读取页面，此次操作未执行。','Read the page again after handback. This action was not performed.'],observed_again:['已重新读取页面，保留这次未执行的记录。','The page was read again. This earlier action was not performed.']};return messages[item.detail_code]?.[this.english?1:0]||item.detail;}
  row(item){
   let row=this.rowNodes.get(item.id);const signature=JSON.stringify([this.english,item]);
   if(row?.dataset.signature===signature)return row;
   const opened=row?.open||false;if(!row){row=element('details',undefined,'operation');this.rowNodes.set(item.id,row);}
   const wasFocused=row.contains(document.activeElement);row.replaceChildren();row.open=opened;row.dataset.signature=signature;row.dataset.id=item.id;row.dataset.state=item.state;row.classList.toggle('nested',!!item.parent);
   const summary=element('summary'),mark=element('span',faults.has(item.state)?'!':live.has(item.state)?'':'·','operation-mark');mark.setAttribute('aria-label',this.text(faults.has(item.state)?'需要检查':live.has(item.state)?'正在执行':'已执行',faults.has(item.state)?'Needs inspection':live.has(item.state)?'Running':'Executed'));
   const body=element('span',undefined,'operation-content');body.append(element('span',this.title(item),'operation-title'));
   if(item.command){const lines=item.command.trim().split(/\r?\n/),first=lines[0];body.append(element('code',first.slice(0,240)+(lines.length>1||first.length>240?' …':''),'operation-command'));}
   if(item.targets?.length)body.append(element('span',item.targets.join(' · '),'operation-target'));
   if(item.detail)body.append(element('span',this.detail(item),faults.has(item.state)?'operation-error':'operation-target'));
   summary.append(mark,body);row.append(summary);
   row.dataset.tool=item.tool;
   if(item.patch?.files?.length)body.append(this.patchView(item.patch,8));
   const detail=element('div',undefined,'operation-receipt');detail.append(element('span',item.tool+(item.action?' · '+item.action:''),'receipt-tool'));
   if(item.command)detail.append(element('pre',item.command));
   if(item.patch?.files?.length)detail.append(this.patchView(item.patch));
   if(item.exit_code!==undefined)detail.append(element('p',this.text('进程退出码：','Process exit code: ')+item.exit_code));
   detail.append(element('small',this.text('执行收据：','Receipt: ')+item.id));row.append(detail);
   if(wasFocused)summary.focus({preventScroll:true});return row;
  }
  patchView(patch,limit=Infinity){
   const box=element('div',undefined,'operation-diff');
   box.append(element('div',this.text(patch.state==='applied'?'文件修改':'拟修改差异 · 请核对执行结果',patch.state==='applied'?'File changes':'Proposed diff · Check the result'),'diff-caption'));
   let shown=0,extra=0;
   for(const file of patch.files){
    const title=element('div',undefined,'diff-file');title.append(element('span',file.path+(file.new_path?' → '+file.new_path:'')),element('span','+'+file.added,'diff-add'),element('span','−'+file.removed,'diff-remove'));box.append(title);
    for(const hunk of file.hunks||[]){
     box.append(element('div','@@ '+this.text('原 ','old ')+hunk.old_start+' / '+this.text('新 ','new ')+hunk.new_start+(hunk.context?' · '+hunk.context:''),'diff-hunk'));
     for(const line of hunk.lines||[]){if(shown++>=limit){extra++;continue;}const kind=['add','remove'].includes(line.kind)?line.kind:'context',r=element('div',undefined,'diff-line diff-'+kind);r.append(element('span',line.old?String(line.old):'','diff-number'),element('span',line.new?String(line.new):'','diff-number'),element('span',kind==='add'?'+':kind==='remove'?'−':' ','diff-sign'),element('code',line.text));box.append(r);}
    }
   }
   if(extra)box.append(element('div',this.text('展开查看其余 '+extra+' 行','Expand to view '+extra+' more lines'),'diff-hunk'));
   if(patch.omitted_lines)box.append(element('div',this.text('另有 '+patch.omitted_lines+' 行，完整差异保留在任务执行记录。',patch.omitted_lines+' more lines are saved in the task execution records.'),'diff-hunk'));
   if(patch.omitted_files)box.append(element('div',this.text('另有 '+patch.omitted_files+' 个文件，完整路径见任务执行记录。',patch.omitted_files+' more files are saved in the task execution records.'),'diff-hunk'));
   return box;
  }
  place(container,items){
   const wanted=new Set(items.map(i=>i.id));for(const n of [...container.children])if(!wanted.has(n.dataset.id))n.remove();
   items.forEach((item,index)=>{const n=this.row(item);if(container.children[index]!==n)container.insertBefore(n,container.children[index]||null);});
  }
  paint(){
   for(const id of this.rowNodes.keys())if(!this.timeline.items.has(id))this.rowNodes.delete(id);
   const current=this.timeline.current(),past=this.timeline.history(),active=current.some(i=>live.has(i.state));
   this.label.textContent=this.text(live.has(this.state)?'执行中':'执行过程',live.has(this.state)?'Working':'Work performed');this.root.classList.toggle('has-active',active);
   this.historyButton.hidden=!past.length;this.historyButton.textContent=this.expanded?this.text('收起已读过程','Collapse history'):this.text('查看 '+past.length+' 项过程','Show '+past.length+' steps');this.historyButton.setAttribute('aria-expanded',String(this.expanded));
   this.place(this.current,current);this.past.hidden=!this.expanded;this.place(this.past,this.expanded?past:[]);
   this.empty.hidden=!!current.length||!!past.length;
   this.empty.textContent=this.text(live.has(this.state)?past.length?'正在生成下一步；已完成过程可展开查看。':'正在等待模型返回具体操作。':'本轮执行已结束，交付与检查结果在下方。',live.has(this.state)?past.length?'Preparing the next step. Completed work is available above.':'Waiting for the model to produce its next action.':'Execution ended. Delivery and review are shown below.');
   if(this.context==='browser')this.empty.textContent=this.text(live.has(this.state)?'等待页面返回。':'页面就绪。',live.has(this.state)?'Waiting for the page.':'Page ready.');
   this.more.hidden=!this.timeline.hasOlder;this.more.textContent=this.text('查看更早过程','Load earlier work');
   this.archive.hidden=!this.archived;this.archive.textContent=this.text('较早的 '+this.archived+' 项过程已归档，可从任务执行记录查阅。',this.archived+' earlier steps are archived in the task execution records.');
  }
  tick(){
   const visible=[],bounds=this.root.closest('[data-scroll-region]')?.getBoundingClientRect()||{top:0,bottom:innerHeight};
   for(const row of this.current.children){const b=row.getBoundingClientRect();if(!row.open&&!row.contains(document.activeElement)&&b.top>=Math.max(0,bounds.top)&&b.bottom<=Math.min(innerHeight,bounds.bottom))visible.push(row.dataset.id);}
   const before=this.timeline.history().length;this.timeline.advance(performance.now(),visible,!document.hidden&&this.windowVisible);
   if(before!==this.timeline.history().length)this.paint();
  }
 }
 if(typeof module==='object'&&module.exports)module.exports={Timeline};else scope.AieyraActivity={Timeline,ActivityView};
})(globalThis);
