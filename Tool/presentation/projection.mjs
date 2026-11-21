// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: projection
// Regions: parse; live; projectionTitles; toolNames; projectionKind; projectionIdentity; projectionLabel; stateLabels; projectionState; createToolProjection
// Impact: python -B scripts/code-atlas.py show Tool/presentation/projection.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Readonly tool scenes. All content is derived from a receipt or a pending
// Core question. Hosts inject scoped reads; this module cannot run a tool.
import {activityData} from './receipt.mjs';
import {reconcilePresentation} from './retained-dom.mjs';
import {planData} from '../base/official/update_plan/presentation/model.mjs';
const parse=v=>{if(typeof v==='string'){try{v=JSON.parse(v);}catch{return {};}}return v&&typeof v==='object'&&!Array.isArray(v)?v:{};};
const live=s=>['queued','starting','running','cancelling','waiting_user','waiting'].includes(s);
export const projectionTitles={terminal:'终端',search:'检索',patch:'差异',project:'项目',image:'影像',video:'视频',workflow:'流程',agents:'协作',decision:'决策',toolbox:'Toolbox',receipt:'回执',browser:'浏览器',contacts:'联系人'};
const toolNames={project:'项目',agents:'协作',image_gen:'图片创作',video_gen:'视频创作',settings:'设置',software_api:'软件操作',cloud_report:'云端回执',community:'社区',link:'Link',server:'服务器',browser:'浏览器',computer:'电脑',tool_factory:'工具工坊',human:'人工决策',compact:'上下文整理'};
export function projectionKind(item){
 const input=parse(item?.input_preview),action=item?.action||input?.action;
 if(['load_tool','unload_tool'].includes(action)||item?.tool==='toolbox'&&['open','close','list'].includes(action))return 'toolbox';
 const tool=item?.tool==='toolbox'&&action==='call'?input?.name||'toolbox':item?.tool||'';
 const args=item?.tool==='toolbox'?parse(input.arguments):input;
 if(tool==='browser'||tool==='software_api'&&args.action==='program'&&args.arguments?.id==='aieyra.browser')return 'browser';
 if(tool==='agents'&&/^(contacts|contact|contact_create|contact_update|contact_delete|session_create|session_delete|sessions|program|programs)$/.test((item?.tool==='toolbox'?args.action:action)||''))return 'contacts';
 if(['terminal','exec_command','write_stdin','read_shell_output'].includes(tool))return 'terminal';
 if(tool==='apply_patch')return 'patch';if(/search/i.test(tool))return 'search';
 if(['view_image','image_gen'].includes(tool))return 'image';if(tool==='video_gen')return 'video';
 if(tool==='project')return 'project';if(tool==='human'||tool==='ask_user'||item?.decision)return 'decision';
 if(tool==='agents'||tool==='team'||tool==='core_link')return 'agents';
 const data=activityData(item);if(['update_plan','exec','wait','compact'].includes(tool)||data.schema==='aieyra.workbox-state/1')return 'workflow';
 return 'receipt';
}
export function projectionIdentity(scope,item){return JSON.stringify([scope,item.member||item.agent||'',item.generation||0,item.call_id||item.id]);}
export function projectionLabel(item){const kind=projectionKind(item);return kind==='toolbox'?'Toolbox':['browser','contacts'].includes(kind)?projectionTitles[kind]:toolNames[item.tool]||projectionTitles[kind];}
const stateLabels={queued:'排队中',starting:'准备中',running:'进行中',cancelling:'正在停止',waiting_user:'等待回答',waiting:'等待回执',pending:'尚未执行',in_progress:'进行中',in_flight:'进行中',completed:'完成',exited:'结束',ready:'就绪',paused:'暂停',cancelled:'已停止',failed:'未成功',timed_out:'超时',blocked:'受阻',unknown:'结果待确认',interrupted_unknown:'结果待确认',interrupted:'已中断',persistence_failed:'记录未保存',awaiting_review:'等待审阅'};
export const projectionState=state=>stateLabels[state]||state||'状态待确认';

export function createToolProjection(doc,{kind,loadImage,loadArtifact,loadProgram,nativeProgram,onDecision=()=>{},facts=()=>[]}={}){
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
 const root=make('div','tool-projection'),media=make('div','projection-media');root.dataset.view=kind;
 let signature='',revision=0,closed=false,visible=true,mediaKey='',last=null,programTimer=0,programLoading=false,programGeneration=0,programSource='';
 const programBody=make('div','projection-program');programBody.setAttribute('aria-live','off');
 const card=(label,value,detail,key=label)=>{const n=make('section','projection-card');n.dataset.digestKey=key;n.append(make('strong','',label));if(value!==undefined&&value!=='')n.append(make('span','',value));if(detail)n.append(make('p','',detail));return n;};
 const list=(items,render)=>{const n=make('div','projection-list');items.slice(0,40).forEach((v,i)=>n.append(render(v,i)));return n;};
 function draw(item){
  const raw=activityData(item),data=raw.result&&typeof raw.result==='object'?raw.result:raw,input=parse(item.input_preview),body=make('div','projection-content');
  const note=text=>body.append(make('p','projection-note',text));
  if(kind==='browser'||kind==='contacts'){note(kind==='browser'?'正在读取浏览画面…':'正在读取联系人…');}
  else if(kind==='toolbox'){
   const action=['unload_tool','close'].includes(item.action||input.action)?'close':['load_tool','open'].includes(item.action||input.action)?'open':'list',name=data.name||input.name||item.tool;
   const n=make('section','projection-capability');n.dataset.action=action;n.append(make('span','projection-symbol',action==='open'?'＋':action==='close'?'−':'◇'),make('strong','',toolNames[name]||name||'Toolbox'),make('span','',action==='open'?'开启能力':action==='close'?'关闭能力':'能力目录'));body.append(n);
   const capabilities=data.tools||data.catalog||data.available;if(Array.isArray(capabilities))body.append(list(capabilities,(v,i)=>card(typeof v==='string'?toolNames[v]||v:v.title||v.name||v.id,v.state?projectionState(v.state):'',v.description,'cap'+i)));
  }else if(kind==='decision'){
   const q=item.decision||data.request||data;
   body.append(make('h3','projection-question',q.question||input.question||item.title||'等待你的决定'));
   if(q.recommendation||q.assumption)note(q.recommendation||q.assumption);
   if(Array.isArray(q.options))body.append(list(q.options,(o,i)=>card(o.label,'',o.detail||o.impact||o.description,'option'+i)));
   if(item.decision){const b=make('button','projection-decision','在输入框回答');b.type='button';b.onclick=()=>onDecision(item.decision.key);body.append(b);}
  }else if(kind==='project'){
   const records=data.files||data.entries||data.matches||data.results||data.paths;
   if(Array.isArray(records))body.append(list(records,(f,i)=>{if(typeof f==='string')return card(f,'','','file'+i);const n=card(f.path||f.name||f.file||f.title||'文件',f.line?':'+f.line:'',f.snippet||f.preview||f.text,'file'+i);n.classList.add('projection-file');return n;}));
   else if(data.path||input.path)body.append(card(data.path||input.path,data.language||'',data.content||data.text||data.snippet,'file'));
  }else if(kind==='workflow'){
   const plan=planData(item),steps=plan.steps?.length?plan.steps:data.steps||data.instance?.steps;
   if(plan.objective||data.title||data.summary)note(plan.objective||data.title||data.summary);
   if(Array.isArray(steps)){const ol=make('ol','projection-flow');steps.slice(0,60).forEach((s,i)=>{const n=make('li');n.dataset.digestKey=s.id||'step'+i;n.dataset.state=s.state||s.status||'pending';n.append(make('i','projection-flow-dot'),make('strong','',s.title||s.step||s.text||s.description||s.id||String(i+1)),make('span','',projectionState(s.state||s.status||'pending')));if(s.error)n.append(make('p','',s.error));ol.append(n);});body.append(ol);}
   if(data.before_tokens!==undefined||data.after_tokens!==undefined)body.append(card('上下文',data.before_tokens!==undefined?String(data.before_tokens):'',data.after_tokens!==undefined?'整理后 '+data.after_tokens:''));
  }else if(kind==='agents'){
   const records=data.agents||data.tasks||data.members||data.records||(data.record?[data.record]:data.agent?[data.agent]:data.id?[data]:[]);
   if(Array.isArray(records))body.append(list(records,(a,i)=>{const n=card(a.spec?.title||a.title||a.name||a.role||'专项任务',projectionState(a.state),a.result||a.error||a.spec?.task||a.task,'agent'+(a.id||i));n.dataset.state=a.state||'';return n;}));
  }else if(kind==='image'||kind==='video'){
   const ready=Number.isInteger(data.completed)&&Number.isInteger(data.requested);
   const state=data.unknown?'结果待确认':projectionState(data.state||item.state);
   body.append(card(kind==='video'?'视频创作':'影像处理',state,ready?data.completed+' / '+data.requested+' 张完成':data.model||'','phase'));
   if(ready&&data.requested>0){const progress=make('progress');progress.max=data.requested;progress.value=data.completed;progress.setAttribute('aria-label','已返回图片');body.append(progress);}
   const paths=data.images||[];if(Array.isArray(paths)&&paths.length)body.append(list(paths,(f,i)=>card(f.name||f.path||f.id||'影像',f.width&&f.height?f.width+' × '+f.height:'','','image'+i)));
   if(data.path)body.append(card('文件',data.path));if(data.recovery)note(data.recovery);
  }
  if(!body.childElementCount){const rows=facts(item);if(rows.length)body.append(list(rows,(f,i)=>card(f.label,f.value,'','fact'+i)));else if(live(item.state))note('等待工具回执…');}
  const error=data.error||raw.error;if(error)body.append(make('p','projection-error',typeof error==='string'?error:error.message||'操作未完成'));
  if(item.preview_truncated||raw.preview_truncated||data.preview_truncated)note('此处显示部分回执。');
  return body;
 }
 function update(item){
  if(closed)return;last=item;if(!visible){signature='';return;}
  const source=item.call_id||item.id||'';
  const key=JSON.stringify([source,item.state,item.revision,item.preview,item.input_preview,item.decision]);if(signature===key)return;signature=key;
  const next=draw(item),old=root.querySelector('.projection-content');if(old)reconcilePresentation(old,next);else root.prepend(next);
  if(kind==='browser'||kind==='contacts'){
   if(source!==programSource){
    programSource=source;
    programGeneration++;
    doc.defaultView.clearTimeout(programTimer);
    programTimer=0;
   }
   if(!programBody.isConnected)root.append(programBody);
   if(!programLoading&&!programTimer)void refreshProgram();
   return;
  }
  if(kind!=='image')return;
  const raw=activityData(item),data=raw.result&&typeof raw.result==='object'?raw.result:raw,id=data.image_id;
  const paths=(data.images||[]).map(f=>typeof f==='string'?f:f.path).filter(Boolean),sources=id&&loadImage?[{id}]:loadArtifact?paths.slice(0,8).map(path=>({path})):[];
  const keyMedia=JSON.stringify([source,sources]);if(!sources.length){media.remove();mediaKey='';revision++;return;}
  if(mediaKey===keyMedia)return;mediaKey=keyMedia;const own=++revision;media.replaceChildren();root.prepend(media);
  for(const source of sources){const tile=make('div','projection-image'),status=make('p','projection-note','正在读取影像…');tile.append(status);media.append(tile);
   Promise.resolve().then(()=>{if(closed||!visible||own!==revision)return;return source.id?loadImage(source.id,item):loadArtifact(source.path,item);}).then(result=>{
    if(closed||!visible||own!==revision)return;
    const value=source.id?result:result?.image;
    if(result?.ok===false||source.id&&value?.image_id!==source.id||!/^image\/(png|jpeg|webp|gif)$/.test(value?.mime)||typeof value?.data!=='string')throw Error(result?.error?.message||result?.error||'影像暂不可读');
    const img=make('img');img.alt=data.description||source.path||'工具返回的影像';img.decoding='async';
    img.addEventListener('load',()=>{img.dataset.orientation=img.naturalHeight>img.naturalWidth?'portrait':'landscape';},{once:true});
    const prefix='data:'+value.mime+';base64,';img.src=value.data.startsWith(prefix)?value.data:prefix+value.data;tile.replaceChildren(img);
   }).catch(error=>{if(!closed&&visible&&own===revision)tile.replaceChildren(make('p','projection-error',error.message));});
  }
 }
 async function refreshProgram(){
  clearTimeout(programTimer);programTimer=0;if(closed||!visible||programLoading||!last||!loadProgram)return;
  const own=programGeneration,item=last;programLoading=true;
  try{
   const frame=await loadProgram(item,{metadataOnly:nativeProgram?.eligible()===true});if(closed||!visible||own!==programGeneration)return;
   nativeProgram?.apply(frame?.native===true?frame.tab_id:'');
   if(frame?.ok===false){if(frame.pending)return;throw Error(frame.error||'程序画面暂不可读');}
   if(!frame?.available){programBody.replaceChildren(make('p','projection-note',kind==='browser'?'等待当前网页画面…':'等待联系人回执…'));return;}
   const content=make('div','projection-program-content');
   if(kind==='browser'&&frame.program==='browser'){
    const bar=make('div','projection-browser-bar');bar.append(make('span','',frame.profile==='default'?'默认身份':frame.profile||'浏览器'),make('span','',frame.control==='human'?'由你操作':(item.name||'Agent')+' 操作'));content.append(bar);
    if(typeof frame.url==='string'&&/^data:image\/(jpeg|png);base64,/.test(frame.url)){const image=make('img','projection-browser-image');image.alt='当前浏览器的真实页面';image.src=frame.url;image.draggable=false;content.append(image);content.dataset.identity=frame.identity||'';}
   }else if(kind==='contacts'&&frame.program==='contacts'){
    const contacts=frame.contacts||[];content.append(list(contacts,(c,i)=>{const n=card(c.name,c.program?({browser:'浏览器',settings:'设置',contacts:'联系人'}[c.program]||c.program):'',c.description,'contact-'+c.id);n.classList.add('projection-contact');if(c.sessions?.length)n.append(make('small','',c.sessions.map(s=>projectionState(s.state)).join(' · ')));return n;}));
   }
   const old=programBody.firstElementChild;if(old?.className===content.className)reconcilePresentation(old,content);else programBody.replaceChildren(content);
   const note=root.querySelector('.projection-content');if(note)note.hidden=true;
  }catch(e){if(!closed&&visible&&own===programGeneration){nativeProgram?.apply('');programBody.replaceChildren(make('p','projection-error',e.message));}}
  finally{programLoading=false;if(!closed&&visible)programTimer=doc.defaultView.setTimeout(refreshProgram,own===programGeneration?900:0);}
 }

 return {element:root,update,setVisible(value,item=last){visible=!!value;last=item;if(!visible){revision++;programGeneration++;nativeProgram?.apply('');doc.defaultView?.clearTimeout(programTimer);programTimer=0;programBody.replaceChildren();mediaKey='';media.replaceChildren();}else if(last){signature='';update(last);}},close(){closed=true;revision++;programGeneration++;nativeProgram?.apply('');doc.defaultView?.clearTimeout(programTimer);programTimer=0;programBody.replaceChildren();media.replaceChildren();root.remove();}};
}
