// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TABS; layoutField; LOOK_TEXT; INDENT; lookField; GROUPS; MOTION_LABELS; extraMotion; TEXT_KEYS; SAMPLE_USER; SAMPLE_EYRA; SAMPLE_ANIMATION; MOTION_EN; MOTION_OPTIONS_EN; textOf; sliderWeight; setupLook
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/look.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 外观：正文、状态与思考动画、头像与名字、版面。
// 每个标签顶部是一块实景预览，用和真实界面同一套类名与样式画出来；拖动只改预览，保存后才落到界面上。
// 存储分两处：尺寸与版面在个人资料的 chatLayout 里（chat-layout.mjs）；字体、字重、间距、描边与阴影、首行缩进在外观配置里，
// Eyra 与你的正文用同一套，保存时同时写进 assistant 与 user 两个区域。
import {colorField} from './glass-color.mjs';
import {el} from './views.mjs';
import {renderMarkdown} from './markdown.mjs';
import {applyAppearance,regionStyle,fontWeightRange,fontWeight,TEXT_LIMITS,THINKING_STYLE} from './appearance.mjs';
import {CHAT_LAYOUT,normalizeChatLayout,applyChatLayout,slider} from './chat-layout.mjs';
import {chatAvatar} from './chat-column.mjs';
import {createRoleRing,paintRoleRing,roleIdentity} from './role-identity.mjs';
import {tabKeyboard,syncChildren} from './interaction.mjs';
import {createThoughtView} from './thought-view.mjs';
import {motionAllowed,observeMotion} from './motion.mjs';

const TABS=[['text','正文'],['status','状态'],['people','头像与名字'],['layout','版面']];
const layoutField=key=>CHAT_LAYOUT.find(f=>f.key===key);
// 外观配置里的正文参数；范围比配置允许的窄，围绕常用值，怎么调都不难看。
export const LOOK_TEXT=[
 {key:'font_latin',label:'英文字体',kind:'select'},{key:'font_cjk',label:'中文字体',kind:'select'},{key:'color',label:'字体颜色',kind:'color'},
 {key:'weight',label:'加粗',min:300,max:700,step:.01,unit:'',value:500},
 {key:'letter_spacing',label:'字间距',min:0,max:3,step:.01,unit:'px',value:1.5},
 {key:'paragraph_spacing',label:'段间距',min:0,max:32,unit:'px',value:20},
 {key:'stroke_width',label:'描边',min:0,max:.8,step:.01,unit:'px',value:.5},
 {key:'shadow_blur',label:'阴影',min:0,max:12,unit:'px',value:6},
];
const INDENT={key:'first_line_indent',label:'首行缩进',min:0,max:4,step:.01,unit:'字',value:.5};
const lookField=key=>LOOK_TEXT.find(f=>f.key===key);
// 每个标签的分组（排版一组两行、每行三个）。
const GROUPS={
 text:[['字体',['font_latin','font_cjk','color']],['排版',['textSize','weight','letter_spacing','lineHeight','paragraph_spacing','first_line_indent']],['效果',['stroke_width','shadow_blur']]],
 people:[['Eyra',['eyraAvatar','eyraName']],['你',['userName']]],
 layout:[['版面',['top','maxWidth','position','gap']]],
 status:[['状态字体',['status_font_latin','status_font_cjk','status_color']],['状态排版',['status_size','status_weight','status_letter_spacing']],['动画',['status_animation','thinking_animation','spread_animation','work_animation','name_animation','inner_animation']]],
};
const MOTION_LABELS={status_animation:'状态',thinking_animation:'思考',spread_animation:'扩散',work_animation:'工作',name_animation:'名字',inner_animation:'内圈'};
const extraMotion=settings=>Object.fromEntries(['spread_animation','work_animation','name_animation','inner_animation'].map(key=>[key,settings[key]]));
const TEXT_KEYS=LOOK_TEXT.map(f=>f.key);
const SAMPLE_USER='今天的界面怎么样？我想把字调得更舒服一点。';
const SAMPLE_EYRA='好多了。头像大一点，名字清楚一点，读起来更舒服。\n\n第二段用来看段间距和首行缩进：中文段落只缩进第一行，换行以后仍和正文的边缘对齐。Mixed English text 0123456789。';
const SAMPLE_ANIMATION='正在核对界面，将关键步骤整理清楚，再依次验证实际结果。';
const MOTION_EN={status_animation:'Status',thinking_animation:'Thinking',spread_animation:'Outer ring',work_animation:'Working',name_animation:'Name',inner_animation:'Inner ring'};
const MOTION_OPTIONS_EN={
 status_animation:['Shift','Slide','Settle','Reveal','Pivot','Instant'],
 thinking_animation:['Emerge','Fade','Align','Unfold','Reveal','Instant'],
 spread_animation:['Ripple','Echo','Tide','Steps','Ellipse','Still'],
 work_animation:['Tool signal','Scan','Index','Pivot','Press','Still'],
 name_animation:['Align','Relay','Hinge','Stride','Press','Still'],
 inner_animation:['Pulse','Orbit','Wave','Spark','Vernier'],
};

function textOf(settings){const a=settings.regions.assistant,out={stroke_color:'#000000',shadow_color:'#000000'};for(const k of TEXT_KEYS)out[k]=a[k];return out;}
const sliderWeight=range=>range.values?{...range,min:range.values[0],max:range.values.at(-1)}:range;

export function setupLook(api,{profile,saveLayout,onApply=()=>{}}){
 const $=id=>document.getElementById(id),section=$('appearance-settings');
 const english=()=>/^en(?:-|$)/i.test(document.documentElement?.lang||'')||/^en(?:-|$)/i.test((section.ownerDocument||document).defaultView?.navigator?.language||'');
 const local=(zh,en)=>english()?en:zh;
 const tabButtons=new Map();tabKeyboard($('look-tabs'));
 const stage=$('look-stage'),preview=el('details',undefined,'look-preview'),summary=el('summary','预览');
 preview.id='look-preview';summary.setAttribute('aria-controls',stage.id);
 stage.before(preview);preview.append(summary,stage);
 const win=(section.ownerDocument||document).defaultView;
 const shortWindow=win?.matchMedia?.('(max-height:560px)')||globalThis.matchMedia?.('(max-height:560px)');
 const resetPreview=()=>{preview.open=!shortWindow?.matches;};
 resetPreview();shortWindow?.addEventListener?.('change',resetPreview);
 // 左下离线提示止于侧栏与正文之间。按实际边界测量，避免缩放后按钮伸进设置正文。
 const settingsBody=$('settings-body'),settingsTabs=$('onboarding').querySelector('.settings-tabs');
 const statusWidth=()=>{
  if(document.body.dataset.view!=='onboarding')return;
  const body=settingsBody.getBoundingClientRect(),tabs=settingsTabs.getBoundingClientRect();
  if(body.left>tabs.left+10)document.body.style.setProperty('--settings-status-edge',(body.left-18)+'px');
  else document.body.style.removeProperty('--settings-status-edge');
 };
 const sizeObserver=new ResizeObserver(statusWidth);sizeObserver.observe(settingsBody);
 let read=null,saved=null,draft=null,tab='text',busy=false,dirty=false,refreshRevision=0,frameObserver=null,thoughtPreview=null,exampleTimer=0,visible=false,strokeSpec=null;
 const report=text=>$('look-status').textContent=text;
 const value=key=>key in draft.motion?draft.motion[key]:key==='thinking_animation'?draft.thinkingAnimation:key==='status_animation'?draft.statusAnimation:key.startsWith('status_')?draft.status[key.slice(7)]:key in draft.layout?draft.layout[key]:key===INDENT.key?draft.indent:draft.text[key];

 // 预览容器上的变量：尺寸来自 chatLayout，正文参数按真实规则算成 --os-assistant-*（预览里两人都用它）。
 function paintVars(node){
  applyChatLayout(node.style,draft.layout);
  const style=regionStyle({...read.settings.regions.assistant,...draft.text,size:draft.layout.textSize,line_height:draft.layout.lineHeight},read.fields);
  for(const [k,v] of Object.entries(style)){node.style.setProperty('--os-assistant-'+k,v);node.style.setProperty('--os-user-'+k,v);}
  node.style.setProperty('--os-first-indent',draft.indent+'em');
  for(const [k,v]of Object.entries(regionStyle(THINKING_STYLE,read.fields)))node.style.setProperty('--os-thinking-'+k,v);
  for(const [k,v]of Object.entries(regionStyle({...draft.status,line_height:1.5},read.fields)))node.style.setProperty('--os-status-'+k,v);
  node.dataset.thoughtAnimation=draft.thinkingAnimation;
  node.dataset.statusAnimation=draft.statusAnimation;
  for(const [key,choice] of Object.entries(draft.motion))node.dataset[key.replace('_animation','Animation')]=choice;
  node.style.setProperty('--os-identity-color',draft.text.color);
  const p=profile();
  node.style.setProperty('--user-ring-color',p.userRingColor||'#e6e9f0');
  if(p.background){node.style.setProperty('--look-bg','url("'+p.background+'")');node.style.setProperty('--look-blur',(p.backgroundBlur??0)+'px');node.style.setProperty('--look-veil',String(p.backgroundOpacity??0));}
  else node.style.removeProperty('--look-bg');
 }
 function entry(kind,text){
  const p=profile(),user=kind==='user',name=user?p.name||'你':p.eyraName||'Eyra';
  const node=el('article',undefined,'chat-entry '+kind),main=el('div',undefined,'chat-main'),body=el('div',undefined,'chat-text');
  if(user)body.textContent=text;else renderMarkdown(body,text);
  main.append(el('header',name,'chat-name'),body);node.append(user?chatAvatar(p.avatar,name,kind):createRoleRing(roleIdentity(p,'matrix')),main);
  return node;
 }
 // 正文、头像与名字：真实尺寸的一段对话。
 function conversation(){
  const box=el('div',undefined,'look-screen'),col=el('div',undefined,'look-column');
  col.append(entry('user',SAMPLE_USER),entry('eyra',SAMPLE_EYRA));box.append(col);return box;
 }
 // 版面：和当前窗口等比例的小窗口，里面按真实像素排好再整体缩小，顶部留白、左右边距、最大宽度都看得见。
 function windowReplica(){
  const W=Math.max(480,innerWidth),H=Math.max(320,innerHeight);
  const frame=el('div',undefined,'look-window'),inner=el('div',undefined,'look-window-inner look-screen'),col=el('div',undefined,'look-window-column');
  frame.style.aspectRatio=W+' / '+H;inner.style.width=W+'px';inner.style.height=H+'px';
  const ring=el('div',undefined,'look-next');ring.append(createRoleRing(roleIdentity(profile(),'matrix')));
  col.append(entry('user',SAMPLE_USER),entry('eyra',SAMPLE_EYRA),entry('user','好，就这样。'),ring);
  const guides=el('div',undefined,'look-guides');for(const g of ['top','left','right','max'])guides.append(el('i',undefined,'look-guide '+g));
  inner.append(guides,col);frame.append(inner);
  frameObserver?.disconnect();frameObserver=new ResizeObserver(()=>{inner.style.transform='scale('+(frame.clientWidth/W)+')';});frameObserver.observe(frame);
  return frame;
 }
 function paintStage(){
  const stage=$('look-stage');
  frameObserver?.disconnect();
  stage.dataset.tab=tab;
  if(tab==='status'){
   const box=el('div',undefined,'look-screen look-state'),main=el('div',undefined,'look-state-main'),identity=el('div',undefined,'presence-identity');
   const state=el('span',local('正在思考','Thinking'),'presence-work-status');state.id='look-status-example';
   identity.append(el('span',profile().eyraName||'Eyra','chat-name'),state);
   const content=el('div',undefined,'thinking-content');content.id='look-thinking-example';content.setAttribute('aria-label',local('思考动画预览','Thinking animation preview'));
   const work=el('div',undefined,'look-work-example');
   main.append(identity,content,work);box.append(createRoleRing(roleIdentity(profile(),'matrix'),{state:'thinking',live:true}),main);stage.replaceChildren(box);
  }else stage.replaceChildren(tab==='layout'?windowReplica():conversation());
  paintVars(stage);
 }
 function stopExample(){clearInterval(exampleTimer);exampleTimer=0;thoughtPreview?.detach();thoughtPreview=null;}
 function paintExample(focus){
  stopExample();const node=$('look-thinking-example');
  if(!visible||document.hidden||!preview.open||tab!=='status'||!node)return;
  thoughtPreview=createThoughtView();thoughtPreview.attach(node);
  const stage=$('look-stage'),box=stage.querySelector('.look-state'),ring=stage.querySelector('.role-ring'),work=stage.querySelector('.look-work-example'),identity=roleIdentity(profile(),'matrix');
  const phases=[
   ['thinking','generic',local('正在思考','Thinking')],
   ['waiting','generic',local('正在等待响应','Waiting for a response')],
   ['tool','reader',local('正在读取文件','Reading a file'),local('读取文件','Read file')],
   ['tool','terminal',local('正在运行终端','Running the terminal'),local('运行终端','Run terminal')],
   ['idle','generic',local('就绪','Ready')],
  ];
  const sample=local(SAMPLE_ANIMATION,'Review the interface, identify the important steps, and verify each result.');
  const reduced=!motionAllowed(document);
  const phaseTicks=16;
  let tick=focus==='work_animation'?2*phaseTicks+(phaseTicks/2):focus==='inner_animation'?4*phaseTicks:0;
  if(focus==='status_animation')tick=phaseTicks-2;
  const render=()=>{
   const step=tick++%(phaseTicks*phases.length),[state,toolEffect,label,activity]=phases[Math.floor(step/phaseTicks)];
   const part=step%phaseTicks;
   if(part===0||!work.dataset.rendered){
    work.dataset.rendered='true';
    box.dataset.phase=state;box.dataset.work=String(state!=='idle');
    $('look-status-example').textContent=label;
    paintRoleRing(ring,identity,state,document,{toolEffect,live:true});
    node.hidden=state!=='thinking';
    work.hidden=!activity;work.textContent=activity||'';
   }
   if(state==='thinking')thoughtPreview.update(reduced?sample:sample.slice(0,Math.ceil(sample.length*Math.min(1,(part+2)/12))));
  };
  delete work.dataset.rendered;
  render();if(!reduced)exampleTimer=setInterval(render,90);
 }
 const previewVisibility=()=>paintExample();document.addEventListener('visibilitychange',previewVisibility);preview.addEventListener('toggle',previewVisibility);
 const stopMotion=observeMotion(document,previewVisibility);
 const stopPreview=()=>{stopMotion();stopExample();};
 win?.addEventListener?.('pagehide',stopPreview,{once:true});
 function control(key){
  if(key in MOTION_LABELS){
   const label=el('label',undefined,'select-field'),select=el('select'),options=key==='status_animation'?read.statusAnimations:key==='thinking_animation'?read.thinkingAnimations:(read.motionChoices?.[key]||[]).map(([id,label])=>({id,label}));
   select.setAttribute('aria-label',local(MOTION_LABELS[key],MOTION_EN[key]));select.dataset.motionSetting=key;
   for(const [index,{id,label:text}] of options.entries()){const option=el('option',local(text,MOTION_OPTIONS_EN[key][index]||id));option.value=id;select.append(option);}
   select.value=value(key);
   select.onchange=()=>{if(key==='status_animation')draft.statusAnimation=select.value;else if(key==='thinking_animation')draft.thinkingAnimation=select.value;else draft.motion[key]=select.value;changed();paintExample(key);};
   label.append(el('span',local(MOTION_LABELS[key],MOTION_EN[key])),select);return label;
  }
  if(key.startsWith('status_')){
   const field=key.slice(7),range=field==='weight'?fontWeightRange(draft.status):null,spec=({...read.fields[field],...(field==='size'?{min:10,max:30}:{}),...(range?sliderWeight(range):{})});
   const label=el('label',undefined,spec.options?'select-field':'slider-field');
   const update=v=>{draft.status[field]=field==='weight'?Number(v):v;if(field.startsWith('font_'))draft.status.weight=fontWeight(draft.status);changed();if(field.startsWith('font_'))paintFields();};
   if(spec.type==='color'){label.className='select-field';label.dataset.lookField=key;label.append(el('span',spec.label),colorField(document,{value:value(key),label:'状态'+spec.label,dropdown:true,onChange:update}));return label;}
   if(spec.options){const select=el('select');select.setAttribute('aria-label','状态'+spec.label);for(const row of spec.options){const option=el('option',row.label);option.value=row.id;select.append(option);}select.value=field==='weight'?fontWeight(draft.status):value(key);select.onchange=()=>update(select.value);label.append(el('span',spec.label),select);return label;}
   const fieldLabel=slider(document,{...spec,key,label:spec.label,unit:field==='weight'?'':field==='line_height'?'倍':'px',value:spec.default},value(key),update).label;fieldLabel.dataset.lookField=key;return fieldLabel;
  }
  const f=layoutField(key);
  if(f)return slider(document,f,draft.layout[key],v=>{draft.layout[key]=v;changed();}).label;
  if(key===INDENT.key)return slider(document,INDENT,draft.indent,v=>{draft.indent=v;changed();}).label;
  const base=lookField(key),weight=key==='weight'?fontWeightRange(draft.text,base):null,spec=weight?{...base,...sliderWeight(weight)}:base,label=el('label',undefined,spec.kind==='select'||spec.kind==='color'?'select-field':'slider-field');
  if(spec.kind==='select'){
   const select=el('select');select.append(...read.fields[key].options.map(o=>{const x=el('option',o.label);x.value=o.id;return x;}));select.value=draft.text[key];
   select.onchange=()=>{draft.text[key]=select.value;draft.text.weight=fontWeight(draft.text,lookField('weight'));changed();paintFields();};label.append(el('span',spec.label),select);return label;
  }
  if(spec.kind==='color'){
   label.dataset.lookField=key;label.append(el('span',spec.label),colorField(document,{value:draft.text[key],label:spec.label,dropdown:true,onChange:value=>{draft.text[key]=value;changed();}}));return label;
  }
  const constrained=key==='stroke_width'?{...spec,max:Math.min(spec.max,Math.floor(draft.layout.textSize*TEXT_LIMITS.strokeRatio*10)/10)}:spec;
  if(key==='stroke_width')strokeSpec=constrained;
  const field=slider(document,constrained,draft.text[key],v=>{draft.text[key]=v;changed();}).label;field.dataset.lookField=key;return field;
 }
 function paintFields(){
  stopExample();strokeSpec=null;
  const areas=(GROUPS[tab]||[]).map(([title,keys])=>{
   const presentation=keys.includes('thinking_animation'),area=el('div',undefined,'settings-area look-group'),grid=el('div',undefined,'group-grid look-grid look-'+keys.length+(presentation?' look-presentation':tab==='layout'?' look-layout':tab==='text'&&title==='效果'?' look-effects':''));
   area.setAttribute('role','group');area.setAttribute('aria-label',title);for(const key of keys)grid.append(control(key));
   area.append(grid);return area;
  });
  $('look-fields').replaceChildren(...areas);
  paintExample();
 }
 function paintTabs(){
  syncChildren($('look-tabs'),TABS.map(([id,label])=>{
   let b=tabButtons.get(id);
   if(!b){b=el('button',label,'look-tab');b.type='button';b.id='look-tab-'+id;b.setAttribute('role','tab');b.setAttribute('aria-controls','look-fields');b.onclick=()=>select(id);tabButtons.set(id,b);}
   b.setAttribute('aria-selected',String(id===tab));b.tabIndex=id===tab?0:-1;return b;
  }));
  $('look-fields').setAttribute('role','tabpanel');$('look-fields').setAttribute('aria-labelledby','look-tab-'+tab);
 }
 function select(id){if(!TABS.some(([key])=>key===id)||tab===id)return;tab=id;paintTabs();paintStage();paintFields();}
 function changed(){
  draft.layout=normalizeChatLayout(draft.layout);
  dirty=JSON.stringify(draft)!==JSON.stringify(saved);
  report(dirty?'预览已更新，保存后应用到界面。':'');
  paintVars($('look-stage'));
  const stroke=$('look-fields').querySelector('[data-look-field=stroke_width] input');
  if(stroke){const max=Math.min(TEXT_LIMITS.stroke,Math.floor(draft.layout.textSize*TEXT_LIMITS.strokeRatio*10)/10);strokeSpec.max=max;stroke.max=String(max);if(draft.text.stroke_width>max){draft.text.stroke_width=max;stroke.value=String(max);stroke.dispatchEvent(new Event('input'));}}
 }
 function load(){
  if(!read)return;
  const current={motion:extraMotion(read.settings),layout:normalizeChatLayout(profile().chatLayout),text:textOf(read.settings),indent:read.settings.first_line_indent,status:structuredClone(read.settings.regions.status),statusAnimation:read.settings.status_animation,thinkingAnimation:read.settings.thinking_animation};
  current.text.weight=fontWeight(current.text,lookField('weight'));current.status.weight=fontWeight(current.status);
  saved=structuredClone(current);draft=structuredClone(current);dirty=false;
  paintTabs();paintStage();paintFields();report('');
 }
 function accept(result){
  if(!result||result.ok===false){report(result?.error||'外观暂时无法读取。');return false;}
  read=result;applyAppearance(document.body,result.settings,result.fields);$('look-theme-remove').hidden=!result.settings.theme_css&&!result.settings.layout_theme;onApply();return true;
 }
 async function refresh(){
  if(busy||!api.appearance)return;
  const revision=++refreshRevision;
  // A newer refresh or write supersedes both the result and any error.
  try{const result=await api.appearance({action:'os_appearance_read'});if(revision!==refreshRevision)return;if(accept(result)&&!dirty)load();}catch(e){if(revision===refreshRevision)report(e.message);}
 }
 // Refresh saved versions on open while preserving both independent drafts.
 const opened=new MutationObserver(()=>{
  statusWidth();
  if(section.hidden||document.body.dataset.view!=='onboarding')return;
  resetPreview();refresh();
 });
 opened.observe(section,{attributes:true,attributeFilter:['hidden']});
 opened.observe(document.body,{attributes:true,attributeFilter:['data-view']});
 $('look-theme-remove').onclick=async()=>{
  if(busy||!read)return;busy=true;refreshRevision++;report('正在移除主题…');
  try{if(accept(await api.appearance({action:'os_appearance_update',expected_version:read.version,patch:{theme_css:'',layout_theme:null}})))report('主题已移除，界面已更新。');}
  catch(e){report(e.message);}finally{busy=false;}
 };
 $('look-reset').onclick=()=>{
  if(!read)return;
  draft={motion:extraMotion(read.defaults),layout:normalizeChatLayout(),text:textOf(read.defaults),indent:read.defaults.first_line_indent,status:structuredClone(read.defaults.regions.status),statusAnimation:read.defaults.status_animation,thinkingAnimation:read.defaults.thinking_animation};paintStage();paintFields();changed();
 };
 $('look-save').onclick=async()=>{
  if(busy||!read||!draft)return;busy=true;refreshRevision++;$('look-save').disabled=true;report('正在保存…');
  const submitted=structuredClone(draft),baseline=structuredClone(saved);
  // Each store acknowledges only the values included in this click. Preserve
  // newer edits, including a reset or revert made while either write waits.
  const committed=values=>{saved={...saved,...structuredClone(values)};dirty=JSON.stringify(draft)!==JSON.stringify(saved);};
  try{
   const patch={...submitted.motion,first_line_indent:submitted.indent,thinking_animation:submitted.thinkingAnimation,status_animation:submitted.statusAnimation,regions:{identity:{color:submitted.text.color},assistant:{...submitted.text,size:submitted.layout.textSize,line_height:submitted.layout.lineHeight},user:{...submitted.text,size:submitted.layout.textSize,line_height:submitted.layout.lineHeight},status:{...submitted.status}}};
   let result=await api.appearance({action:'os_appearance_update',expected_version:read.version,patch});
   // A theme may commit between showing this page and clicking Save. Retry
   // once only when every editable appearance field still matches our base;
   // an actual concurrent edit remains a conflict, with the draft preserved.
   if(result?.code==='version_conflict'){
    const latest=await api.appearance({action:'os_appearance_read'});
    if(latest?.settings?.regions.identity?.color===read.settings.regions.identity?.color&&latest?.ok!==false&&latest?.settings&&JSON.stringify([extraMotion(latest.settings),textOf(latest.settings),latest.settings.first_line_indent,latest.settings.regions.status,latest.settings.thinking_animation,latest.settings.status_animation])===JSON.stringify([baseline.motion,baseline.text,baseline.indent,baseline.status,baseline.thinkingAnimation,baseline.statusAnimation]))result=await api.appearance({action:'os_appearance_update',expected_version:latest.version,patch});
   }
   if(!accept(result))return;
   committed({motion:extraMotion(result.settings),text:textOf(result.settings),indent:result.settings.first_line_indent,status:result.settings.regions.status,statusAnimation:result.settings.status_animation,thinkingAnimation:result.settings.thinking_animation});
   const profile=await saveLayout(submitted.layout);
   committed({layout:normalizeChatLayout(profile?.chatLayout||submitted.layout)});
   report(dirty?'已保存，仍有未保存的修改。':'已保存，界面已更新。');
  }catch(e){report(e.message+'；当前编辑内容已保留。');}finally{busy=false;$('look-save').disabled=false;}
 };
 return {
  async initialize(initial){if(initial)accept(initial);else await refresh();if(read)load();},
  // 测试和巡检用：当前预览里的值。
  select,
  visibility(value){visible=value===true;if(!visible){stopExample();frameObserver?.disconnect();}else{if(read){paintStage();paintExample();}return refresh();}},
  close(){opened.disconnect();sizeObserver.disconnect();frameObserver?.disconnect();stopPreview();win?.removeEventListener?.('pagehide',stopPreview);document.removeEventListener('visibilitychange',previewVisibility);preview.removeEventListener('toggle',previewVisibility);shortWindow?.removeEventListener?.('change',resetPreview);},
  get draft(){return structuredClone(draft);},
  value,
 };
}
