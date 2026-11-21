// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupExtensionSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/extension-settings.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindAppServices,el} from './app-shell.mjs';
import {importMod,modDetail,legacyProgramDetail} from './mod-packages.mjs';
import {openAgentPackages} from './agent-packages.mjs';

// Local package management stays alongside the existing OS configuration.
// Browsing the online resource catalogue remains the browser's responsibility.
export function setupExtensionSettings(api,{doc=document,notice=()=>{}}={}){
 const root=doc.getElementById('extensions-settings'),head=el('header','settings-head'),title=el('h2','','扩展'),actions=el('div','settings-actions'),list=el('div','extension-package-list'),status=el('p','link-hint'),search=el('input','field'),detail=el('dialog','mk-detail'),body=el('article');
 detail.id='detail';body.id='detail-body';detail.append(body);status.setAttribute('role','status');search.type='search';search.placeholder='搜索已安装扩展';search.setAttribute('aria-label','搜索已安装扩展');
 let visible=false,closed=false,ticket=0,viewEpoch=0,items=[],revision=0,loaded=false;
 const guard=()=>{const own=viewEpoch;return ()=>!closed&&visible&&own===viewEpoch;};
 const call=async p=>{const result=await api.extensionPackages(p);if(result?.ok===false)throw Error(result.error||'操作未完成');return result;};
 const restore=bindAppServices({invoke:call,notice,on:()=>()=>{},onVisibility:()=>()=>{}});
 const style=doc.createElement('link');style.rel='stylesheet';style.href='extension-settings.css';doc.head.append(style);
 const button=(text,run)=>{const node=el('button','quiet',text);node.type='button';node.onclick=()=>Promise.resolve().then(()=>{if(visible&&!closed)return run();}).catch(error=>{if(visible&&!closed)notice(error.message,true);});actions.append(node);};
 function paint(){
  const query=search.value.trim().toLocaleLowerCase(),rows=items.filter(item=>[item.manifest.name,item.manifest.id,item.manifest.summary].join(' ').toLocaleLowerCase().includes(query));
  list.replaceChildren(...rows.map(item=>{const node=el('button','link-row extension-package'),info=el('span','link-name',item.manifest.name),meta=el('span','link-control','v'+item.manifest.version+' · '+(item.migrationRequired?'待迁移':item.enabled?'已启用':'已停用')),currentRevision=revision;node.type='button';node.append(info,meta);node.onclick=()=>item.migrationRequired?legacyProgramDetail(item,refresh):modDetail(item,currentRevision,refresh,{showcase:false,isCurrent:guard()});return node;}));
  status.textContent=rows.length?'':query?'没有匹配的扩展':loaded?'可导入扩展开始使用':'';
 }
 async function refresh(){
  if(!visible||closed)return;
  const own=++ticket;status.textContent='正在读取…';
  try{const [result,legacy]=await Promise.all([call({action:'mod_list'}),call({action:'center_local'})]);if(closed||own!==ticket)return;items=[...(result.items||[]),...(legacy.items||[]).filter(item=>item.migrationRequired&&!result.items?.some(row=>row.manifest.id===item.manifest.id))];revision=result.revision;loaded=true;paint();}
  catch(error){if(!closed&&own===ticket)status.textContent=error.message;}
 }
 button('导入文件夹',()=>importMod(false,refresh,{isCurrent:guard()}));button('导入压缩包',()=>importMod(true,refresh,{isCurrent:guard()}));button('Agent 实例',()=>openAgentPackages());button('刷新',refresh);
 search.oninput=paint;head.append(title);root.append(head,actions,search,list,status,detail);
 return {visibility(value){const next=value===true;if(next===visible)return;visible=next;viewEpoch++;if(visible)void refresh();else{ticket++;if(detail.open)detail.close();}},close(){closed=true;viewEpoch++;ticket++;if(detail.open)detail.close();restore();style.remove();root.replaceChildren();}};
}
