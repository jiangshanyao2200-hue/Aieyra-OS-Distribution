// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: KINDS; ICON; KIND_NAME; kind; installedItem; tabs; initial; packageIcon; count; card; skeleton; refreshLocal; load; detail; rail; hiddenAt
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/package-manager.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {$,call,say,setupRail,el} from './app-shell.mjs';
import {openAgentPackages} from './agent-packages.mjs';
import {importMod,modDetail,reviewMod} from './mod-packages.mjs';
import {openThemeShowcase} from './theme-showcase.mjs';
import {halo} from '../../../Halo/official/instrument.mjs';
const KINDS=[['program','程序'],['tool','工具'],['role','角色'],['drawing','绘图'],['prompt','提示词'],['theme','主题']],SORTS=[['recommended','推荐'],['hot','热门'],['latest','最新']];
const ICON={
 program:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m9 10 2.5 2L9 14M13 15h3"/>',
 tool:'<path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2L15 12l-3-3z"/>',
 role:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 drawing:'<path d="m4 20 1-4L16 5l3 3L8 19zM14 7l3 3"/>',
 prompt:'<path d="M5 5h14v11H9l-4 3.5z"/><path d="M9 9.5h6M9 12.5h4"/>',
 theme:'<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
 installed:'<path d="M12 4v10M8 10.5l4 4 4-4M5 19.5h14"/>',
};
const KIND_NAME={...Object.fromEntries(KINDS),agent:'Agent',workbox:'工作流',halo:"光圈",context:"上下文",api:"API适配"},PERMISSION={files:'读写文件',terminal:'运行命令',network:'访问网络',browser:'控制浏览器',appearance:'改外观',clipboard:'读写剪贴板',computer:'操作电脑'};
let kind='program',sort='recommended',q='',cursor=null,showLocal=false,installed=new Map(),aliases=new Map(),ticket=0,searchTimer=0,modRevision=0;
const installedItem=id=>installed.get(aliases.get(id)||id);
function tabs(root,items,current,pick){
 root.replaceChildren(...items.map(([value,label])=>{const b=el('button','',label);b.type='button';b.setAttribute('role','tab');b.dataset.value=value;b.setAttribute('aria-selected',String(value===current()));b.onclick=()=>{if(value===current())return;pick(value);for(const n of root.children)n.setAttribute('aria-selected',String(n.dataset.value===current()));void load();};return b;}));
}
const initial=name=>[...String(name||'?')][0];
function packageIcon(manifest){
 const node=el('span','mk-icon');node.setAttribute('aria-hidden','true');
 if(['agent','role'].includes(manifest.kind)){node.className+=' role-instrument';node.dataset.state='idle';node.innerHTML=halo;}
 else node.textContent=initial(manifest.name);
 return node;
}
const count=n=>n>=10000?(n/10000).toFixed(1)+' 万':String(n||0);
function card(item,index){
 const revision=modRevision,m=item.manifest,b=el('button','mk-card');b.type='button';b.style.setProperty('--i',Math.min(index,16));
 const footer=el('footer');footer.append(el('span','mk-tag'+(installedItem(m.id)?' on':''),installedItem(m.id)?'已安装':KIND_NAME[m.kind]||m.kind),el('span','','v'+m.version),el('span','',item.downloads!=null?count(item.downloads)+' 次下载':''));
 b.append(packageIcon(m),el('h3','',m.name),el('p','',m.summary||''),footer);b.onclick=()=>m.schema==='aieyra.mod/1'?modDetail(item,revision,load):detail(item);return b;
}
function skeleton(){$('grid').replaceChildren(...Array.from({length:9},()=>el('div','mk-skeleton')));}
async function refreshLocal(){const [legacy,mods]=await Promise.all([call({action:'center_local'}),call({action:'mod_list'})]);return {revision:mods.revision,aliases:new Map((legacy.aliases||[]).map(row=>[row.resource_id,row.package_id])),items:new Map([...(legacy.items||[]),...(mods.items||[])].map(row=>[row.manifest?.id,row]))};}
async function load(more=false){
 const own=++ticket;$('state').hidden=true;$('more').hidden=true;if(!more){cursor=null;skeleton();}
 try{
  const local=await refreshLocal();if(own!==ticket)return;modRevision=local.revision;installed=local.items;aliases=local.aliases;
  let items,next=null;
  if(showLocal){items=[...installed.values()].filter(r=>(!q||(r.manifest.name+' '+r.manifest.summary).toLowerCase().includes(q.toLowerCase())));}
  else{const r=await call({action:'center_list',kind,sort,q,...(more&&cursor?{cursor}:{})});if(own!==ticket)return;items=r.items||[];next=r.nextCursor||null;}
  const nodes=items.map(card);if(more)$('grid').append(...nodes);else $('grid').replaceChildren(...nodes);
  cursor=next;$('more').hidden=!cursor;
  if(!more&&!items.length){$('state').textContent=q?'没有找到':showLocal?'还没有安装':'这里还是空的';$('state').hidden=false;}
 }catch(e){if(own!==ticket)return;$('grid').replaceChildren();$('state').textContent=e.message;$('state').hidden=false;}
}
function detail(item){
 const m=item.manifest,body=$('detail-body'),have=installedItem(m.id),head=el('header'),title=el('div');
 title.append(el('h2','',m.name),el('small','',[KIND_NAME[m.kind],'v'+m.version,m.license].filter(Boolean).join(' · ')));head.append(packageIcon(m),title);
 const perms=el('div','mk-perms');for(const p of m.permissions||[])perms.append(el('span','mk-tag',PERMISSION[p]||p));
 const footer=el('footer'),close=el('button','pill','关闭');close.type='button';close.onclick=()=>$('detail').close();
 const act=(label,fn,primary)=>{const b=el('button','pill'+(primary?' primary':''),label);b.type='button';b.onclick=async()=>{for(const n of footer.children)n.disabled=true;b.textContent=label+'中…';try{await fn();$('detail').close();void load();}catch(e){say(e.message,true);for(const n of footer.children)n.disabled=false;b.textContent=label;}};footer.append(b);};
 const expected=m.artifact?{expected_sha256:m.artifact.sha256}:{};
 const legacyProgram=m.kind==='program'&&m.artifact?.name?.endsWith('.aieyra');
 const install=async()=>{
  if(m.kind==='role'){
   const acquired=await call({action:'center_acquire',id:m.id,...expected});
   setTimeout(()=>reviewMod(acquired.inspection,load,params=>call({action:'center_install',id:m.id,...expected,...params})),0);return;
  }
  const result=await call({action:have?.migrationRequired?'center_migrate':'center_install',id:m.id,...expected,...(legacyProgram?{origin:'local'}:{})});say(result.notice||'安装好了');
 };
 if(have){
  if(have.migrationRequired)act('以本地包迁移',install,true);
  else if(have.manifest.version!==m.version)act(legacyProgram?'以本地包更新':'更新',install,true);
  if(m.kind==='program'&&!have.migrationRequired&&have.enabled)act('打开',()=>call({action:'center_open',id:m.id}),true);
  if(m.kind==='theme')act('应用主题',()=>call({action:'center_apply',id:m.id}).then(()=>say('主题已应用')),true);
  if(have.manifest.schema==='aieyra.mod/1')act('管理已安装包',()=>{setTimeout(()=>modDetail(have,modRevision,load),0);});
  else act('卸载',()=>call({action:'center_remove',id:m.id}).then(()=>say('已卸载')));
 }else act(m.kind==='role'?'检查角色包':legacyProgram?'以本地包导入':'安装',install,true);
 footer.append(close);
 body.replaceChildren(head,el('p','',m.description||m.summary||''),...(legacyProgram?[el('p','','这是未签名的旧程序，将转换为本地包。安装后需单独启用；已有资料保留。')]:[]),...(m.permissions?.length?[perms]:[]),footer);$('detail').showModal();
}
const rail=setupRail($('rail'),[...KINDS.map(([id,label])=>({id,label,icon:ICON[id]})),{id:'installed',label:'已安装',icon:ICON.installed}],id=>{
 showLocal=id==='installed';if(!showLocal)kind=id;$('sorts').hidden=showLocal;rail.select(id);void load();
});
rail.select(kind);
tabs($('sorts'),SORTS,()=>sort,v=>{sort=v;});
$('more').onclick=()=>void load(true);
$('q').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{q=$('q').value.trim();void load();},220);};
$('agent-instances').onclick=()=>void openAgentPackages();
$('theme-showcase').onclick=()=>openThemeShowcase();
$('import-folder').onclick=()=>void importMod(false,load);
$('import-archive').onclick=()=>void importMod(true,load);
void load();
// 后台规则：市场本身不轮询；隐藏超过 5 分钟再回来时刷新一次，免得列表过期。
let hiddenAt=0;window.aieyraApp?.onVisibility?.(v=>{if(!v?.visible){hiddenAt=Date.now();return;}if(hiddenAt&&Date.now()-hiddenAt>5*60*1000&&!$('detail').open)void load();hiddenAt=0;});
