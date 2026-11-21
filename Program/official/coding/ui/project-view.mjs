// Monaco is only the local text/diff engine. Core binding and the host own
// paths, file versions and saves; no workspace paths reach a Node renderer.
import {projectEvidence} from './project-evidence.mjs';
const language=path=>({js:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',jsx:'javascript',json:'json',py:'python',go:'go',rs:'rust',md:'markdown',css:'css',html:'html',yml:'yaml',yaml:'yaml',sh:'shell',txt:'plaintext'}[path.split('.').at(-1)]||'plaintext');
let loading;
function monaco(){
 if(!loading)loading=new Promise((resolve,reject)=>{
  const base=new URL('../../../../Client/Desktop/assets/monaco/vs/',import.meta.url).href;
  const workers={json:'json.worker-DKiEKt88.js',css:'css.worker-HnVq6Ewq.js',scss:'css.worker-HnVq6Ewq.js',less:'css.worker-HnVq6Ewq.js',html:'html.worker-B51mlPHg.js',handlebars:'html.worker-B51mlPHg.js',razor:'html.worker-B51mlPHg.js',typescript:'ts.worker-CMbG-7ft.js',javascript:'ts.worker-CMbG-7ft.js'};
  globalThis.MonacoEnvironment={getWorker:(_module,label)=>new Worker(new URL('assets/'+(workers[label]||'editor.worker-Be8ye1pW.js'),base),{type:'module'})};
  globalThis.require.config({paths:{vs:base.replace(/\/$/,'')}});
  globalThis.require(['vs/editor/editor.main'],resolve,reject);
 });return loading;
}
export function setupProjectView({root,read,dropProject,onError=()=>{},onBindingChanged=()=>{}}){
 const doc=root.ownerDocument,make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
 const tree=make('aside','project-tree'),treeTitle=make('strong','','项目'),treeBody=make('div','project-tree-entries'),center=make('section','project-center'),bar=make('header','project-toolbar'),title=make('span','project-path','选择一个文件'),edit=make('button','ui-outline','编辑'),save=make('button','ui-outline','保存'),follow=make('button','quiet','跟随 Agent'),diff=make('button','quiet','比较变化'),history=make('select','project-history'),status=make('p','project-status'),editorRoot=make('div','project-editor'),editorHost=make('div','project-code-host');editorRoot.append(editorHost);
 const treeBar=make('header','project-tree-toolbar'),openProject=make('button','', '打开项目'),openFile=make('button','','打开文件');
 const icons=['<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>','<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>','<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>','<path d="M8 3v18M16 3v18M3 7h2m6 0h10M3 17h10m6 0h2"/>'];
 for(const [i,b] of [edit,save,follow,diff,openProject,openFile].entries()){b.type='button';b.className='ui-icon-button project-action';b.setAttribute('aria-label',b.textContent);b.dataset.tip=b.textContent;b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(icons[i]||["<path d='M3 7V4h6l3 3h9v13H3Z'/><path d='M3 10h18'/>","<path d='M5 3h9l5 5v13H5Z'/><path d='M14 3v6h5M8 14h8m-8 3h5'/>"][i-4])+'</svg>';}
 history.setAttribute('aria-label','选择文件历史版本');status.setAttribute('role','status');tree.setAttribute('aria-label','项目目录');treeTitle.setAttribute('role','heading');
 const evidence=make('div','project-evidence'),rebase=make('button','ui-outline','以比较后的磁盘版本继续编辑');evidence.setAttribute('aria-label','Cota 与 Vaya 的文件视野');rebase.type='button';rebase.hidden=true;
 openProject.dataset.tip='打开项目 · Ctrl+Shift+O';openFile.dataset.tip='打开文件 · Ctrl+O';treeBar.append(treeTitle,openProject,openFile);tree.append(treeBar,treeBody,evidence);bar.append(title,edit,save,follow,diff,history);center.append(bar,status,rebase,editorRoot);root.prepend(tree,center);
 const start=make('section','project-start'),startTitle=make('h1','','Coding'),startActions=make('div','project-start-actions'),createProject=make('button','ui-outline','新建项目'),chooseExisting=make('button','ui-outline','打开项目');
 start.setAttribute('aria-label','开始一个项目');createProject.type=chooseExisting.type='button';startActions.append(createProject,chooseExisting);start.append(startTitle,startActions,make('p','','也可以把项目文件夹拖到这里'));root.prepend(start);
 function empty(value){root.classList.toggle('project-empty',value);start.hidden=!value;tree.hidden=center.hidden=value;}
 empty(true);
 let engine,editor,diffEditor,current=null,selected='',manual=false,tracking=true,muted=false,closed=false,visible=true,readVersion=0,scope='',lastOperation='',treeKey='',draftTimer=0,draftChain=Promise.resolve(),pendingDraft=null,saving=false,choosing=false;
 const models=new Map(),expanded=new Set(['']);
 let projectKey='',requestedKey='',queue=Promise.resolve(),latestUpdate=null,updating=false,compared=null;
 const request=(action,p={},key=projectKey)=>read(action,{...p,project_key:key});
 const enqueue=work=>{const job=queue.catch(()=>{}).then(()=>closed?undefined:work());queue=job;void job.catch(e=>{say('操作未完成，当前编辑已保留');onError(e.message);});return job;};
 const say=text=>{status.textContent=text;status.hidden=!text;};
 const dirty=()=>current&&editor&&editor.getValue()!==current.text;
 function controls(){const changing=requestedKey!==projectKey;createProject.disabled=chooseExisting.disabled=openProject.disabled=openFile.disabled=choosing||saving;edit.hidden=!current||manual;save.hidden=!current||!manual;follow.hidden=!current;diff.hidden=!current||!manual&&!diffEditor&&(current.history?.length||0)<2;history.hidden=!current||(current.history?.length||0)<2;edit.disabled=!current||manual||changing;save.disabled=!current||!manual||!dirty()||saving||changing;diff.disabled=!current||changing;history.disabled=!current||changing;for(const [button,label]of [[edit,manual?'编辑中':'编辑'],[follow,tracking?'正在跟随 Agent':'恢复跟随'],[diff,diffEditor?'返回文件':'比较变化']]){button.setAttribute('aria-label',label);button.dataset.tip=label;}follow.setAttribute('aria-pressed',String(tracking));diff.setAttribute('aria-pressed',String(!!diffEditor));title.textContent=selected||'选择一个文件';title.title=selected||'';for(const button of treeBody.querySelectorAll('[data-project-file]')){if(button.dataset.projectFile===selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}}
 function queueDraft(){
  if(!current||muted)return;pendingDraft={project_key:projectKey,path:selected,draft:dirty()?{text:editor.getValue(),baseText:current.text,baseVersion:current.version}:null};
  clearTimeout(draftTimer);draftTimer=setTimeout(flushDraft,300);controls();
 }
 function flushDraft(){clearTimeout(draftTimer);if(!pendingDraft)return draftChain;const p=pendingDraft;pendingDraft=null;draftChain=draftChain.catch(()=>{}).then(()=>read('project_draft',p)).then(value=>{if(value?.context_warning)onError(value.context_warning);return value;}).catch(e=>{if(!pendingDraft)pendingDraft=p;say('编辑草稿尚未保存');onError(e.message);throw e;});void draftChain.catch(()=>{});return draftChain;}
 async function ensure(){
  if(editor)return;const m=await monaco();if(closed)return;engine=m;syncTheme();
  editor=m.editor.create(editorHost,{value:'',language:'plaintext',theme:'aieyra-project',readOnly:true,automaticLayout:true,wordWrap:'on',minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,renderWhitespace:'selection',stickyScroll:{enabled:true}});
  editor.onDidChangeModelContent(()=>{if(!muted)queueDraft();});
 }
 let themeSignature='',themeFrame=0;
 function syncTheme(){
  if(!engine||closed)return;
  const probe=make('span',''),canvas=doc.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});probe.hidden=true;root.append(probe);
  const color=value=>{probe.style.color=value;ctx.clearRect(0,0,1,1);ctx.fillStyle=doc.defaultView.getComputedStyle(probe).color;ctx.fillRect(0,0,1,1);return '#'+Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');};
  const background=color(doc.defaultView.getComputedStyle(doc.body).backgroundColor),foreground=color('var(--ui-text)'),muted=color('var(--ui-text-3)'),accent=color('var(--ui-accent)');probe.remove();
  const signature=[background,foreground,muted,accent].join();if(signature===themeSignature)return;themeSignature=signature;
  const rgb=background.slice(1).match(/../g).map(n=>parseInt(n,16)),light=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>140;
  engine.editor.defineTheme('aieyra-project',{base:light?'vs':'vs-dark',inherit:true,rules:[],colors:{'editor.background':'#00000000','editor.foreground':foreground,'editorGutter.background':'#00000000','editorLineNumber.foreground':muted,'editorLineNumber.activeForeground':foreground,'editor.lineHighlightBackground':foreground+'08','editor.selectionBackground':accent+'44','editor.inactiveSelectionBackground':accent+'22','editorWidget.background':background,'editorOverviewRuler.border':'#00000000'}});engine.editor.setTheme('aieyra-project');
 }
 const scheduleTheme=()=>{if(!themeFrame)themeFrame=doc.defaultView.requestAnimationFrame(()=>{themeFrame=0;syncTheme();});};
 const themeObserver=new doc.defaultView.MutationObserver(scheduleTheme);themeObserver.observe(doc.body,{attributes:true,attributeFilter:['class','style','data-theme']});themeObserver.observe(doc.head,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});doc.addEventListener('load',scheduleTheme,true);
 function paintHistory(){history.replaceChildren();const latest=make('option','','当前文件');latest.value='';history.append(latest);for(const row of current?.history||[]){const opt=make('option','',(row.source==='user'?'手动编辑':row.member||'外部变更（已观察）')+' · '+new Date(row.at).toLocaleTimeString());opt.value=row.id;history.append(opt);}}
 function closeDiff(){if(diffEditor){const pair=diffEditor.getModel();diffEditor.dispose();pair?.original.dispose();pair?.modified.dispose();diffEditor=null;}editorRoot.replaceChildren(editorHost);editor.layout();controls();}
 async function showDiff(original,modified){await ensure();if(!editor||closed)return;closeDiff();const box=make('div','project-diff');editorRoot.replaceChildren(box);diffEditor=engine.editor.createDiffEditor(box,{theme:'aieyra-project',readOnly:true,automaticLayout:true,diffWordWrap:'on',renderSideBySide:root.clientWidth>850,minimap:{enabled:false},originalEditable:false});diffEditor.setModel({original:engine.editor.createModel(original,language(selected)),modified:engine.editor.createModel(modified,language(selected))});controls();}
 async function open(path,{automatic=false}={}){
  if(automatic&&(!tracking||manual))return;
  if(selected!==path)await flushDraft();const own=++readVersion;try{
   const key=projectKey,file=await request('project_read',{path,user:!automatic});if(file.context_warning&&!automatic)onError(file.context_warning);if(closed||own!==readVersion||key!==requestedKey)return;await ensure();if(closed||own!==readVersion||key!==requestedKey||!editor)return;
   if(selected===path&&current){
    if(file.version===current.version)return;
    if(dirty()||manual){say('文件已变化；编辑草稿保留，可比较后再处理');return;}
   }
   closeDiff();compared=null;rebase.hidden=true;selected=path;current=file;manual=!!file.draft;tracking=!manual&&tracking;
   let model=models.get(path);if(!model){model=engine.editor.createModel('',language(path));models.set(path,model);}
   muted=true;editor.setModel(model);editor.setValue(file.draft?.text??file.text);editor.updateOptions({readOnly:!manual});muted=false;
   if(file.draft){current={...file,text:file.draft.baseText,version:file.draft.baseVersion};say(file.draft.baseVersion===file.version?'已恢复未保存编辑':'文件已变化；已恢复编辑草稿，请先比较');}else say('');
   paintHistory();controls();
  }catch(e){if(own===readVersion){say('文件暂不可读');if(!automatic)onError(e.message);}}
 }
 async function directory(path='',parent=treeBody){
  const key=projectKey,result=await request('project_list',{path});if(closed||key!==requestedKey)return;if(!path)treeTitle.textContent=result.name||'项目';parent.replaceChildren();
  for(const item of result.entries){const row=make('div','project-tree-row'),button=make('button','quiet',(item.directory?'▸ ':'')+item.name);button.type='button';button.disabled=item.link;button.setAttribute('aria-label',item.path);row.append(button);parent.append(row);
   if(item.directory){const branch=make('div','project-tree-branch');branch.hidden=!expanded.has(item.path);row.append(branch);button.setAttribute('aria-expanded',String(!branch.hidden));button.onclick=()=>enqueue(async()=>{if(key!==projectKey)return;branch.hidden=!branch.hidden;button.setAttribute('aria-expanded',String(!branch.hidden));if(branch.hidden)expanded.delete(item.path);else{expanded.add(item.path);await directory(item.path,branch);}});if(!branch.hidden)await directory(item.path,branch);}
   else{button.dataset.projectFile=item.path;button.onclick=()=>{tracking=false;void enqueue(()=>key===projectKey&&open(item.path));};}
  }
  if(result.truncated)parent.append(make('small','','目录较大，仅显示前 500 项'));
 }
 async function choose(kind,files){
  if(choosing||saving)return;choosing=true;controls();
  try{
   await flushDraft();const value=files?await dropProject(files):await read(kind==='new'?'project_new':kind==='directory'?'project_open':'file_open');if(value?.ok===false)throw Error(value.error);if(value.cancelled||closed)return;
   // Invalidate earlier polls before applying the picker result to this queue.
   onBindingChanged(value.binding);latestUpdate=null;requestedKey=value.binding.project_key;
   await update({binding:value.binding,operations:[]});
   if(value.path){tracking=false;await open(value.path);}else say('');
  }finally{choosing=false;controls();}
 }
 createProject.onclick=()=>void enqueue(()=>choose('new'));chooseExisting.onclick=()=>void enqueue(()=>choose('directory'));
 start.ondragover=e=>{if(!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';start.classList.add('dragging');};
 start.ondragleave=()=>start.classList.remove('dragging');
 start.ondrop=e=>{e.preventDefault();e.stopPropagation();start.classList.remove('dragging');const files=Array.from(e.dataTransfer?.files||[]);if(files.length!==1||!dropProject){onError('请拖入一个本地项目文件夹');return;}void enqueue(()=>choose('directory',files));};
 openProject.onclick=()=>void enqueue(()=>choose('directory'));openFile.onclick=()=>void enqueue(()=>choose('file'));
 const keys=e=>{const dialog=doc.querySelector('dialog[open]');if(!visible||doc.hidden||e.defaultPrevented||!(e.ctrlKey||e.metaKey)||e.altKey||dialog&&!dialog.contains(root)||!dialog&&doc.body.dataset.chatExpanded==='true')return;
  if(e.key.toLowerCase()==='o'){e.preventDefault();void enqueue(()=>choose(e.shiftKey?'directory':'file'));}
  else if(e.key.toLowerCase()==='s'&&manual){e.preventDefault();if(!save.disabled)save.click();}
 };doc.addEventListener('keydown',keys,true);
 edit.onclick=()=>{if(!current||projectKey!==requestedKey)return;manual=true;tracking=false;closeDiff();editor.updateOptions({readOnly:false});editor.focus();controls();};
 follow.onclick=async()=>{if(tracking){tracking=false;controls();return;}if(dirty()){say('请先保存当前编辑，再恢复跟随');return;}manual=false;tracking=true;if(editor)closeDiff();compared=null;rebase.hidden=true;editor?.updateOptions({readOnly:true});controls();};
 save.onclick=()=>enqueue(async()=>{if(!current||saving||projectKey!==requestedKey)return;saving=true;controls();const key=projectKey,p={path:selected,text:editor.getValue(),version:current.version};try{await flushDraft();const file=await request('project_save',p,key);if(selected===p.path&&key===requestedKey){current=file;paintHistory();queueDraft();await flushDraft();say(file.context_warning||'已保存');}}catch(e){say('保存未完成，编辑草稿已保留');onError(e.message);}finally{saving=false;controls();}});
 diff.onclick=()=>enqueue(async()=>{
  if(diffEditor){closeDiff();history.value='';compared=null;rebase.hidden=true;say('');return;}
  if(!current)return;const key=projectKey,file=await request('project_read',{path:selected});if(key!==requestedKey)return;
  if(!manual&&file.text===editor.getValue()){
   const prior=file.history?.at(-2);if(!prior){say('尚无更早的文件版本；后续变化会保存在版本历史中');return;}
   const old=await request('project_history',{path:selected,version_id:prior.id});if(key!==requestedKey)return;
   await showDiff(old.text,file.text);rebase.hidden=true;compared=null;say('左侧为上一已观察版本，右侧为当前文件');return;
  }
  await showDiff(file.text,editor.getValue());compared=file;rebase.hidden=!manual||file.version===current.version;say('左侧是磁盘版本，右侧是当前编辑');
 });
 rebase.onclick=()=>enqueue(()=>{if(!compared||compared.path!==selected||projectKey!==requestedKey)return;current=compared;compared=null;rebase.hidden=true;closeDiff();queueDraft();paintHistory();controls();say('当前编辑已保留；确认内容后可保存，磁盘再次变化仍会阻止覆盖');});
 history.onchange=()=>{const id=history.value;void enqueue(async()=>{compared=null;rebase.hidden=true;if(!id){closeDiff();say('');return;}const key=projectKey,file=await request('project_history',{path:selected,version_id:id});if(key!==requestedKey)return;await showDiff(file.text,editor.getValue());say('左侧为已保存的历史观察版本');});};
 async function update({binding,operations=[]}){
  if(closed||!visible)return;const project=binding?.project?.root;empty(!project);if(!project){say('打开项目或文件即可开始；也可以交给 Cota 处理。');controls();return;}
  treeTitle.title=project;const next=binding.project_key;if(!next)return;if(scope!==next){await flushDraft();scope=next;projectKey=next;readVersion++;current=null;selected='';treeKey='';lastOperation='';manual=false;tracking=true;expanded.clear();expanded.add('');if(editor){closeDiff();muted=true;editor.setModel(null);muted=false;}for(const model of models.values())model.dispose();models.clear();}
  const key=JSON.stringify(operations.map(o=>[o.id,o.revision,o.state]));
  if(treeKey!==key){treeKey=key;try{await directory();}catch(e){say('目录暂不可读');onError(e.message);}}
  const rows=projectEvidence(operations,project);evidence.replaceChildren();
  for(const row of rows.slice(0,12)){const button=make('button','quiet',row.member+' · '+row.action+' · '+row.path);button.type='button';button.title=button.textContent;button.onclick=()=>{tracking=false;void enqueue(()=>open(row.path));};evidence.append(button);}
  const op=rows[0],target=op?.path,opKey=op&&op.operation+':'+op.revision+':'+op.state;
  if(target&&opKey!==lastOperation&&op.state==='completed'&&tracking&&!manual){
   lastOperation=opKey;
   if(op.change!=='delete'){
    await open(target,{automatic:true});
    if(selected===target&&current&&tracking&&!manual){
     const prior=current.history?.at(-2),key=projectKey;
     if(prior||op.change==='add'){
      const original=prior?(await request('project_history',{path:target,version_id:prior.id},key)).text:'';
      if(key===requestedKey&&selected===target&&tracking&&!manual)await showDiff(original,current.text);
     }
    }
   }
  }
  if(selected&&!manual)await open(selected,{automatic:true});controls();
 }
 controls();
 return {update(value){requestedKey=value.binding?.project_key||'';latestUpdate=value;controls();if(updating)return queue;updating=true;return enqueue(async()=>{try{while(latestUpdate){const next=latestUpdate;latestUpdate=null;await update(next);}}finally{updating=false;}});},chooseProject(kind){return enqueue(()=>choose(kind));},chooseFile(project){return enqueue(()=>choose(project?'directory':'file'));},setVisible(value){visible=!!value;if(!visible)readVersion++;},async flush(){await queue;await flushDraft();},close(){closed=true;doc.removeEventListener('keydown',keys,true);doc.removeEventListener('load',scheduleTheme,true);themeObserver.disconnect();doc.defaultView.cancelAnimationFrame(themeFrame);readVersion++;void flushDraft().catch(()=>{});closeDiffIfNeeded();editor?.dispose();for(const model of models.values())model.dispose();start.remove();tree.remove();center.remove();}};
 function closeDiffIfNeeded(){if(diffEditor){const pair=diffEditor.getModel();diffEditor.dispose();pair?.original.dispose();pair?.modified.dispose();diffEditor=null;}}
}
