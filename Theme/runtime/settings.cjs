// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; cfg; themes; presets; fonts; regions; thinkingAnimations; statusAnimations; motionChoices; fields; RECOMMENDED; defaults; own; object; keys; number; LOOK; THEME_AT_RULES; layoutCache; layoutVariables; plainCss; themeCssSafe; merge; FILE_MAX; createAppearanceStore
// Impact: python -B scripts/code-atlas.py show Theme/runtime/settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// OS 页面与 Agent 共用独立配置；不会读写 Terminal 外观、模型设置或个人图像。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cfg=require('../../Core/platform/config-file.cjs');
const themes=require('./overrides.cjs');
const presets=require('./presets.cjs');
const fonts={
 latin:[{id:'system',label:'系统无衬线',css:'"Segoe UI", Inter, sans-serif'},{id:'inter',label:'Inter（内置）',css:'"Aieyra Inter", Inter, "Segoe UI", sans-serif'},{id:'sora',label:'Sora（内置）',css:'"Aieyra Sora", Sora, "Segoe UI", sans-serif'},{id:'georgia',label:'Georgia 衬线',css:'Georgia, "Times New Roman", serif'},{id:'mono',label:'系统等宽',css:'"Cascadia Code", Consolas, monospace'}],
 cjk:[{id:'system',label:'系统中文',css:'"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'},{id:'yahei',label:'微软雅黑',css:'"Microsoft YaHei", "PingFang SC", sans-serif'},{id:'pingfang',label:'苹方',css:'"PingFang SC", "Microsoft YaHei", sans-serif'},{id:'noto_sans',label:'Noto Sans SC（内置）',css:'"Aieyra Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'},{id:'song',label:'宋体',css:'SimSun, "Songti SC", "Noto Serif CJK SC", serif'},{id:'noto_serif',label:'Noto Serif SC（内置）',css:'"Aieyra Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif'}],
};
const regions={assistant:'Eyra 正文与报告',user:'用户正文',thinking:'思考',status:'名字右侧状态',tools:'工具与过程',composer:'输入',identity:'姓名与时间',interface:'按钮与辅助信息'};
const thinkingAnimations=[{id:'flow',label:'浮现'},{id:'fade',label:'淡入'},{id:'register',label:'对位'},{id:'unfold',label:'展行'},{id:'reveal',label:'揭帘'},{id:'none',label:'即时显示'}];
const statusAnimations=[{id:'fade',label:'平移'},{id:'slide',label:'换行'},{id:'settle',label:'归位'},{id:'reveal',label:'揭帘'},{id:'pivot',label:'转入'},{id:'none',label:'即时显示'}];
const motionChoices={
 spread_animation:[['ripple','涟漪'],['echo','回声'],['tide','潮汐'],['step','阶环'],['ellipse','椭圆波'],['none','静止']],
 work_animation:[['signal','工具信号'],['scan','扫描'],['index','步进'],['pivot','摆针'],['press','敲击'],['still','定格']],
 name_animation:[['trace','校准'],['relay','交接'],['hinge','折角'],['stride','步进'],['press','落字'],['none','静止']],
 inner_animation:[['pulse','脉冲'],['orbit','轨道'],['wave','涟漪'],['spark','星点'],['vernier','游标']]
};
const fields={
 font_latin:{label:'英文字体',options:fonts.latin,default:'system'},font_cjk:{label:'中文字体',options:fonts.cjk,default:'system'},
 size:{label:'字号（px）',min:8,max:48,step:.01,default:16},weight:{label:'加粗',min:100,max:900,step:.01,default:400},
 color:{label:'字体颜色',type:'color',default:'#c9ced8'},
 line_height:{label:'行高',min:1,max:3.2,step:.01,default:1.7},letter_spacing:{label:'字间距（px）',min:0,max:12,step:.01,default:0},
 paragraph_spacing:{label:'段间距（px）',min:0,max:80,step:.01,default:12},
 stroke_width:{label:'描边（px，0 关闭）',min:0,max:4,step:.01,default:0},stroke_color:{label:'描边颜色',type:'color',default:'#000000'},
 shadow_blur:{label:'阴影（px，0 关闭）',min:0,max:32,step:.01,default:0},shadow_color:{label:'阴影颜色',type:'color',default:'#000000'},
};
// 推荐排版（用户 2026-11-10 定为默认）：正文与用户消息 Inter/思源黑体、轻描边与阴影，思考区紧凑宽字距。
const RECOMMENDED={assistant:{font_latin:'inter',font_cjk:'noto_sans',weight:500,letter_spacing:1.5,paragraph_spacing:20,stroke_width:.5,shadow_blur:6},user:{font_latin:'inter',font_cjk:'noto_sans',size:16,weight:500,letter_spacing:1.5,paragraph_spacing:20,stroke_width:.5,shadow_blur:6},thinking:{size:14,line_height:1.6,letter_spacing:.2,paragraph_spacing:8},status:{font_latin:'inter',font_cjk:'noto_sans',size:14,line_height:1.5,weight:400,letter_spacing:.2,color:'#e4f1ff'}};
function defaults(){return {schema_version:1,sounds:{enabled:false,volume:35},window:{width:1000,height:680},first_line_indent:.5,thinking_animation:'flow',status_animation:'fade',...Object.fromEntries(Object.entries(motionChoices).map(([key,choices])=>[key,choices[0][0]])),region_overrides:{},regions:Object.fromEntries(Object.keys(regions).map(id=>[id,{...Object.fromEntries(Object.entries(fields).map(([k,s])=>[k,s.default])),size:{assistant:16,user:16,thinking:14,status:14,tools:14,composer:20,identity:13,interface:12}[id],line_height:{assistant:1.85,user:1.65,thinking:1.6,status:1.5,tools:1.7,composer:1.2,identity:1.5,interface:1.5}[id],...(id==='tools'?{font_latin:'mono'}:{}),...RECOMMENDED[id]}]))};}
const own=(o,k)=>Object.hasOwn(o,k);
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+'格式不正确');}
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error('未知外观参数：'+label+'.'+key);}
function number(value,min,max,label,integer=false){if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw Error(label+'必须在 '+min+' 到 '+max+' 之间');}
// 主题只改外观：配色、背景、边框颜色与圆角、阴影、字形和动效。尺寸、布局和可见性都不在名单里；
// 界面已拿去做布局的变量不能改；长度有上限；设置页始终不套用主题，“移除主题”一定点得到。
const LOOK=/^(?:color|background(?:-(?:color|image|position(?:-[xy])?|size|repeat|attachment|clip|origin|blend-mode))?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-(?:color|style)|border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius|outline-(?:color|style)|box-shadow|text-shadow|text-decoration(?:-(?:line|color|style|thickness))?|text-transform|font-(?:family|weight|style)|accent-color|caret-color|scrollbar-color|backdrop-filter|transition(?:-[a-z]+)*|animation-(?:duration|timing-function|delay|iteration-count|direction|fill-mode|play-state)|fill|stroke|stop-color)$/i;
const THEME_AT_RULES=/^@(?:media|supports|keyframes)\b/i,THEME_MAX=24000,UNIT_MAX={px:64,pt:48,em:4,rem:4,ex:8,ch:8,'%':100},FREE_UNITS=new Set(['s','ms','deg','turn','rad','grad','x','dppx','dpi']);
let layoutCache=null;
// 界面 CSS/脚本里被尺寸、位置、可见性等属性用到的变量（含间接引用），主题不能改。
function layoutVariables(){
 if(layoutCache)return layoutCache;const dir=path.join(__dirname,'../../Client/Desktop/ui'),uses=new Map(),tainted=new Set();
 let files=[];try{files=fs.readdirSync(dir).filter(n=>/\.(?:css|mjs|html)$/.test(n));}catch{}
 if(!files.length)tainted.add('*');
 for(const n of files){
  const raw=fs.readFileSync(path.join(dir,n),'utf8');
  if(!n.endsWith('.mjs'))for(const [,prop,value] of raw.replace(/\/\*[\s\S]*?\*\//g,' ').matchAll(/([-\w]+)\s*:\s*([^;{}\x22]*)/g))for(const [,v] of value.matchAll(/var\(\s*(--[\w-]+)/g)){if(!uses.has(v))uses.set(v,new Set());uses.get(v).add(prop.startsWith('--')?prop:prop.toLowerCase());}
  if(!n.endsWith('.css'))for(const [,v] of raw.matchAll(/(?:getPropertyValue\(\s*['\x22`]|var\(\s*)(--[\w-]+)/g))tainted.add(v);
 }
 for(let changed=true;changed;){changed=false;for(const [name,consumers] of uses)if(!tainted.has(name)&&[...consumers].some(c=>c.startsWith('--')?tainted.has(c):!LOOK.test(c))){tainted.add(name);changed=true;}}
 return layoutCache=tainted;
}
// 与浏览器同样切分：注释换成空白，字符串换成空串；未闭合、跨行或带转义一律拒绝。
function plainCss(css){
 let out='',i=0;
 while(i<css.length){const c=css[i];
  if(c==='/'&&css[i+1]==='*'){const end=css.indexOf('*/',i+2);if(end<0)return null;out+=' ';i=end+2;continue;}
  if(c==='\x22'||c==="'"){let j=i+1;for(;j<css.length&&css[j]!==c;j++)if(/[\r\n\\]/.test(css[j]))return null;if(j>=css.length)return null;out+='\x22\x22';i=j+1;continue;}
  out+=c;i++;}
 return out;
}
function themeCssSafe(css){
 if(typeof css!=='string'||css.length>THEME_MAX||/[\\<]/.test(css))return false;
 const text=plainCss(css);if(text===null)return false;
 if(/url\s*\(|image-set|src\s*\(|@import|expression\s*\(|-moz-binding|javascript:|https?:|\b(?:calc|clamp|min|max)\s*\(/i.test(text))return false;
 const frames=new Set([...text.matchAll(/@keyframes\s+([-\w]+)/gi)].map(m=>m[1])),layout=layoutVariables();
 for(const [,raw,mark] of text.matchAll(/([^{};]*)([{};]|$)/g)){
  const part=raw.trim();if(!part)continue;
  if(mark==='{'){if(part.startsWith('@')&&!THEME_AT_RULES.test(part))return false;continue;}
  const colon=part.indexOf(':');if(colon<1||part.startsWith('@'))return false;
  const name=part.slice(0,colon).trim(),value=part.slice(colon+1).replace(/!\s*important\s*$/i,'').trim();
  if(name.startsWith('--')){if(layout.has('*')||layout.has(name))return false;}
  // 只能播放主题自己定义的动画，借不到界面里的淡出、收起动画。
  else if(/^animation-name$/i.test(name)){if(!value.split(',').every(v=>frames.has(v.trim())||v.trim()==='none'))return false;}
  else if(!LOOK.test(name)||/shadow|filter/i.test(name)&&/var\s*\(/i.test(value))return false;
  for(const [,n,unit] of value.replace(/#[0-9a-f]{3,8}\b/gi,' ').matchAll(/(?<![\w-])(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)/gi)){const u=unit.toLowerCase();if(FREE_UNITS.has(u))continue;if(!(u in UNIT_MAX)||Math.abs(Number(n))>UNIT_MAX[u])return false;}
 }
 return true;
}
function merge(base,patch,track=true){
 keys(patch,['schema_version','sounds','window','first_line_indent','thinking_animation','status_animation',...Object.keys(motionChoices),'regions','theme_css','layout_theme','region_overrides','theme_profiles','theme_edit','theme_presets','theme_preset'],'appearance');
 const out=structuredClone(base);out.region_overrides??={};
 if(!track&&(own(patch,'theme_edit')||own(patch,'theme_preset')))throw Error('保存的外观不能包含待执行命令');
 if(own(patch,'theme_profiles'))out.theme_profiles=themes.validateProfiles(patch.theme_profiles);
 if(own(patch,'theme_presets'))out.theme_presets=presets.validatePresets(patch.theme_presets);
 if(own(patch,'theme_preset')){
  if(['layout_theme','theme_profiles','theme_edit','theme_presets'].some(k=>own(patch,k)))throw Error('预设操作须独立提交');
  const command=patch.theme_preset;
  if(command?.action==='apply'||command?.action==='author'){
   const result=command.action==='author'?presets.applyAuthorPreset(out.theme_profiles,out.layout_theme,command):presets.applyPreset(out.theme_profiles,out.layout_theme,out.theme_presets,command);
   out.theme_profiles=result.profiles;out.layout_theme=result.selection;
  }else out.theme_presets=presets.savePreset({profiles:out.theme_profiles,selection:out.layout_theme,presets:out.theme_presets},command);
 }
 if(own(patch,'region_overrides')){
  keys(patch.region_overrides,Object.keys(regions),'region_overrides');
  for(const names of Object.values(patch.region_overrides))if(!Array.isArray(names)||names.some(k=>!own(fields,k))||new Set(names).size!==names.length)throw Error('无效文字覆盖字段');
  out.region_overrides=structuredClone(patch.region_overrides);
 }
 if(own(patch,'layout_theme')){
  const value=patch.layout_theme;
  if(value===null)delete out.layout_theme;
  else {const selected=themes.selectTheme(out.theme_profiles,value);out.theme_profiles=selected.profiles;out.layout_theme=selected.selection;}
 }
 if(own(patch,'theme_edit')){
  if(own(patch,'layout_theme')||own(patch,'theme_profiles'))throw Error('主题选择和编辑须分别提交');
  if(!out.layout_theme)throw Error('请先应用一个主题');
  const edited=themes.editTheme(out.theme_profiles,out.layout_theme.id,patch.theme_edit);out.theme_profiles=edited.profiles;out.layout_theme=edited.selection;
 }
 // Complete-state writes (including self-settings recovery) derive the active
 // definition from the same saved profile instead of applying an edit twice.
 if(out.layout_theme&&out.theme_profiles){const selected=themes.selectTheme(out.theme_profiles,out.layout_theme);out.theme_profiles=selected.profiles;out.layout_theme=selected.selection;}
 if(own(patch,'theme_css')){const css=patch.theme_css;if(!themeCssSafe(css))throw Error('主题 CSS 只能改配色、背景、边框颜色与圆角、阴影、字形和动效，不能改尺寸、布局或界面布局用的变量，不能隐藏或覆盖控件，也不能引用外部资源、脚本或转义');out.theme_css=css;}
 if(own(patch,'sounds')){keys(patch.sounds,['enabled','volume'],'sounds');out.sounds??={enabled:false,volume:35};if(own(patch.sounds,'enabled')){if(typeof patch.sounds.enabled!=='boolean')throw Error('声音开关须为布尔值');out.sounds.enabled=patch.sounds.enabled;}if(own(patch.sounds,'volume')){number(patch.sounds.volume,0,100,'声音音量',true);out.sounds.volume=patch.sounds.volume;}}
 if(own(patch,'thinking_animation')){if(!thinkingAnimations.some(x=>x.id===patch.thinking_animation))throw Error('思考动效无效');out.thinking_animation=patch.thinking_animation;}
 if(own(patch,'status_animation')){if(!statusAnimations.some(x=>x.id===patch.status_animation))throw Error('状态动效无效');out.status_animation=patch.status_animation;}
 for(const [key,choices] of Object.entries(motionChoices))if(own(patch,key)){
  if(!choices.some(([id])=>id===patch[key]))throw Error('无效动画设置：'+key);
  out[key]=patch[key];
 }
 if(own(patch,'schema_version')&&patch.schema_version!==1)throw Error('不支持此外观配置版本');
 if(own(patch,'first_line_indent')){number(patch.first_line_indent,0,10,'首行缩进');out.first_line_indent=patch.first_line_indent;}
 if(own(patch,'window')){keys(patch.window,['width','height'],'window');for(const [key,value] of Object.entries(patch.window)){number(value,key==='width'?480:360,key==='width'?3840:2160,'初始窗口'+key,true);out.window[key]=value;}}
 if(own(patch,'regions')){keys(patch.regions,Object.keys(regions),'regions');for(const [region,values] of Object.entries(patch.regions)){
  keys(values,Object.keys(fields),region);
  for(const [key,value] of Object.entries(values)){
   const f=fields[key];if(f.options){if(!f.options.some(x=>x.id===value))throw Error('未知字体：'+key);}
   else if(f.type==='color'){if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error('颜色须为 #RRGGBB');}
   else number(value,f.min,f.max,f.label);
   out.regions[region][key]=value;
   if(track&&!own(patch,'region_overrides'))out.region_overrides[region]=[...new Set([...(out.region_overrides[region]||[]),key])];
  }
 }}
 return out;
}
const FILE_MAX=2*1024*1024;
function createAppearanceStore(config){
 const file=path.join(path.dirname(config),'os-appearance.json');
 function load(){
  let raw;try{const st=fs.statSync(file);if(st.size>FILE_MAX)throw Error('外观配置过大');raw=fs.readFileSync(file);}catch(e){if(e.code==='ENOENT')return {version:'missing',settings:defaults()};throw e;}
  if(raw.length>FILE_MAX)throw Error('外观配置过大');
  const saved=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));if(typeof saved?.theme_css==='string'&&!themeCssSafe(saved.theme_css))delete saved.theme_css;
  let themeError='';if(saved.layout_theme){try{merge(defaults(),{layout_theme:saved.layout_theme});}catch(e){themeError=e.message;delete saved.layout_theme;}}
  if(saved.inner_animation==='profile')saved.inner_animation='pulse';
  const settings=merge(defaults(),saved,false);
  // Old files stored complete default-expanded regions. Only differences can
  // be identified as overrides; reading never rewrites the original file.
  if(!own(saved,'region_overrides')){const baseline=defaults();for(const [region,values]of Object.entries(saved.regions||{})){const changed=Object.keys(values).filter(k=>values[k]!==baseline.regions[region][k]);if(changed.length)settings.region_overrides[region]=changed;}}
  return {version:crypto.createHash('sha256').update(raw).digest('hex'),settings,...(themeError?{theme_error:themeError}:{})};
 }
 function read(){try{const loaded=load(),profile=loaded.settings.theme_profiles?.[loaded.settings.layout_theme?.id];return {ok:true,...loaded,...(profile?{theme_status:themes.materialize(profile)}:{}),defaults:defaults(),regions,fields,thinkingAnimations,statusAnimations,motionChoices,note:'Inter、Sora、Noto Sans SC 和 Noto Serif SC 随程序提供，可离线使用；其他字体使用本机字族，缺失时按候选链回退。初始窗口尺寸在下次打开时应用。'};}catch{return {ok:false,code:'appearance_invalid',error:'外观配置无法读取，原文件已保留。',settings:defaults()};}}
 function update(patch,expected){
  if(typeof expected!=='string'||!expected)return {ok:false,code:'version_conflict',error:'请先读取外观版本'};
  try{
   return cfg.withWriteLock(file,expected,()=>{
    const settings=merge(load().settings,patch),temp=file+'.'+crypto.randomUUID()+'.tmp',bytes=JSON.stringify(settings)+'\n';
    if(Buffer.byteLength(bytes)>FILE_MAX)throw Error('外观配置过大，原文件已保留');
    try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});cfg.replaceConfigFile(temp,file,expected);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    return read();
   });
  }catch(e){return {ok:false,code:e.code||'invalid_appearance',error:e.message};}
 }
 return {read,update};
}
module.exports={createAppearanceStore,defaults,merge,fonts,fields,regions};
