// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; cfg; profileID; builtins; schemes; filePath; boolean; number; string; oneOf; color; dimension; fields; load; active; read; update
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/appearance-settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cfg=require('./config.cjs'),jsonc=require('./jsonc.cjs');
const profileID='{97cbf814-1256-4f28-9e68-74edfa013e7c}';
const builtins=()=>require('./resources.cjs').read('终端配色.json');
function schemes(s) {const all=new Map(builtins().schemes.map(p=>[p.name,p]));for(const p of s.schemes||[])all.set(p.name,{...all.get(p.name),...p});return [...all.values()];}
function filePath() {
 const root=process.env.AIEYRA_ROOT||(process.env.AIEYRA_ROOT_EXE&&path.dirname(process.env.AIEYRA_ROOT_EXE));
 if(!root)throw Error('窗口设置需要从 Aieyra OS 入口启动');
 return path.join(root,'Terminal','runtime','settings','settings.json');
}
const boolean=v=>typeof v==='boolean';
const number=(min,max)=>v=>Number.isFinite(v)&&v>=min&&v<=max;
const string=v=>typeof v==='string'&&v.length<4096;
const oneOf=(...values)=>v=>values.includes(v);
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const dimension=v=>typeof v==='string'&&/^(?:[0-9]+(?:\.[0-9]+)?)(?:px)?$/.test(v)&&parseFloat(v)>0&&parseFloat(v)<=200;
// [实际存储层、原生字段、校验]，字段名以 Terminal 的 MTSMSettings.h 为准。
const fields={
 font_face:['font','face',v=>string(v)&&v.length>0],font_size:['font','size',number(6,72)],font_weight:['font','weight',v=>Number.isInteger(v)&&number(100,900)(v)],
 line_height:['font','cellHeight',dimension],cell_width:['font','cellWidth',dimension],builtin_glyphs:['font','builtinGlyphs',boolean],color_glyphs:['font','colorGlyphs',boolean],
 font_axes:['font','axes',v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,n])=>/^[ -~]{4}$/.test(k)&&Number.isFinite(n))],
 font_features:['font','features',v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,n])=>/^[ -~]{4}$/.test(k)&&Number.isInteger(n)&&n>=0)],
 color_scheme:['profile','colorScheme',string],padding:['profile','padding',v=>typeof v==='string'&&/^\d+(?:\s*,\s*\d+){0,3}$/.test(v)],
 opacity:['profile','opacity',number(0,100)],use_acrylic:['profile','useAcrylic',boolean],
 cursor_shape:['profile','cursorShape',oneOf('bar','vintage','underscore','filledBox','emptyBox','doubleUnderscore')],cursor_height:['profile','cursorHeight',v=>Number.isInteger(v)&&number(1,100)(v)],
 foreground:['profile','foreground',color],background:['profile','background',color],selection_background:['profile','selectionBackground',color],cursor_color:['profile','cursorColor',color],
 scrollbar:['profile','scrollbarState',oneOf('visible','hidden','always')],background_image:['profile','backgroundImage',string],background_image_opacity:['profile','backgroundImageOpacity',number(0,1)],
 background_image_stretch:['profile','backgroundImageStretchMode',oneOf('none','fill','uniform','uniformToFill')],background_image_alignment:['profile','backgroundImageAlignment',oneOf('center','left','right','top','bottom','topLeft','topRight','bottomLeft','bottomRight')],
 intense_text_style:['profile','intenseTextStyle',oneOf('none','bold','bright','all')],adjust_colors:['profile','adjustIndistinguishableColors',oneOf('never','indexed','always','automatic')],retro_effect:['profile','experimental.retroTerminalEffect',boolean],
 theme:['global','theme',oneOf('system','light','dark')],always_on_top:['global','alwaysOnTop',boolean],always_show_tabs:['global','alwaysShowTabs',boolean],
 tab_width_mode:['global','tabWidthMode',oneOf('equal','titleLength','compact')],new_tab_position:['global','newTabPosition',oneOf('afterCurrentTab','atEnd')],
 disable_animations:['global','disableAnimations',boolean],tabs_in_titlebar:['global','showTabsInTitlebar',boolean],acrylic_tab_row:['global','useAcrylicInTabRow',boolean],
 show_admin_shield:['global','showAdminShield',boolean],show_tabs_fullscreen:['global','showTabsFullscreen',boolean],show_tabs_focus:['global','showTabsInFocusMode',boolean],
};
function load() {const file=filePath(),text=fs.readFileSync(file,'utf8');return {file,settings:jsonc.parse(text),version:crypto.createHash('sha256').update(text).digest('hex')};}
function active(s) {return s.profiles?.list?.find(p=>String(p.guid).toLowerCase()===profileID);}
function read() {
 const {settings:s,version}=load();const d=s.profiles?.defaults||{},a=active(s)||{};
 const effective={...d,...a,font:{...(d.font||{}),...(a.font||{})}};
 const settings=Object.fromEntries(Object.entries(fields).map(([key,[scope,name]])=>[key,(scope==='global'?s:scope==='font'?effective.font:effective)[name]??null]));
 return {ok:true,version,settings,schemes:schemes(s),fields:Object.keys(fields),note:'null means Terminal default. Values include the active Aieyra profile overrides. Schemes include bundled Terminal defaults and user overrides. Language is controlled by settings.update(language). JSONC comments are normalized on save.'};
}
function update(patch,expected) {
 const file=filePath();if(!expected)return {ok:false,code:'version_conflict',errors:['请先读取外观版本']};
 try {
  cfg.withWriteLock(file,expected,()=>{
   const s=load().settings;
   s.profiles||={};s.profiles.defaults||={};s.profiles.list||=[];
   let p=active(s);if(!p){p={guid:profileID,name:'Aieyra OS'};s.profiles.list.push(p);}p.font||={};
   for(const [key,value] of Object.entries(patch||{})) {
    if(key==='schemes') {
     if(!Array.isArray(value)||value.length>64)throw Error('配色列表无效');
     s.schemes||=[];
     for(const scheme of value) {
      const keys=['background','foreground','cursorColor','selectionBackground','black','red','green','yellow','blue','purple','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightPurple','brightCyan','brightWhite'];
      if(!scheme||typeof scheme.name!=='string'||!scheme.name||scheme.name.length>120||Object.entries(scheme).some(([k,v])=>k!=='name'&&(!keys.includes(k)||!color(v))))throw Error('配色名称或颜色值无效');
      const i=s.schemes.findIndex(x=>x.name===scheme.name);const merged={...schemes(s).find(x=>x.name===scheme.name),...scheme};
      if(keys.some(k=>!color(merged[k])))throw Error('新配色必须提供全部 20 个颜色字段');
      if(i>=0)s.schemes[i]=merged;else s.schemes.push(merged);
     }continue;
    }
    const field=fields[key];if(!field||!field[2](value))throw Error('无效外观参数：'+key);
    const [scope,name]=field; (scope==='global'?s:scope==='font'?p.font:p)[name]=value;
   }
   if(patch?.color_scheme && !schemes(s).some(x=>x.name===patch.color_scheme))throw Error('请选择已知的配色方案');
   const tmp=file+'.agent.'+crypto.randomUUID()+'.tmp';
   try {fs.writeFileSync(tmp,JSON.stringify(s,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  });
  return read();
 }catch(e){if(!['version_conflict','config_busy'].includes(e.code))throw e;return {ok:false,code:e.code,errors:[e.message]};}
}
module.exports={read,update};
