// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: controls; summary; legacyProgramDetail; importMod; reviewMod; modDetail
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/mod-packages.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {openAgentPackages} from './agent-packages.mjs';
import {openWorkboxes} from './workboxes.mjs';
import {openThemeShowcase} from './theme-showcase.mjs';
import {$,call,say,el} from './app-shell.mjs';

function controls(root){
 const footer=el('footer'),close=el('button','pill','关闭');close.type='button';close.onclick=()=>$('detail').close();
 const action=(label,work,primary=false)=>{
  const button=el('button','pill'+(primary?' primary':''),label);button.type='button';
  button.onclick=async()=>{for(const node of footer.children)node.disabled=true;try{await work();$('detail').close();}catch(error){say(error.message,true);}finally{for(const node of footer.children)node.disabled=false;}};
  footer.append(button);
 };
 root.append(footer);return {action,finish(){footer.append(close);$('detail').showModal();}};
}
function summary(manifest){
 const root=$('detail-body');root.replaceChildren(el('h2','',manifest.name),el('small','',[manifest.kind,manifest.version,manifest.publisher].join(' · ')),el('p','',manifest.summary));
 for(const permission of manifest.permissions||[])root.append(el('p','',permission.reason+'：'+permission.scope));
 return root;
}
export function legacyProgramDetail(item,refresh){
 const m=item.manifest,root=$('detail-body');
 root.replaceChildren(el('h2','',m.name),el('p','',m.description||m.summary||''),el('p','','这是未签名的旧程序。迁移为本地包后需单独启用，原有资料保留。'));
 const ui=controls(root);
 ui.action('以本地包迁移',async()=>{await call({action:'center_migrate',id:m.id,origin:'local',expected_sha256:m.artifact?.sha256});await refresh();},true);
 ui.finish();
}
export async function importMod(archive,refresh,{isCurrent=()=>true}={}){
 try{
  const inspected=await call({action:archive?'mod_pick_archive':'mod_pick_directory'});if(!isCurrent()||inspected.cancelled)return;
  reviewMod(inspected,refresh);
 }catch(error){if(isCurrent())say(error.message,true);}
}
export function reviewMod(inspected,refresh,install){
  const m=inspected.manifest,root=summary(m),report=inspected.compatibility;
  if(!report.compatible)root.append(el('p','',report.issues.map(x=>x.detail).join('\n')));
  const official=inspected.origin==='official',signed=report.publisher_key!=='unsigned';root.append(el('p','',official?'已核对为当前版本随附的官方包。':signed?'包签名有效；签名用于核对更新来源，不代表作者经过实名认证。':'这是未签名的本地开发包。'));
  const ui=controls(root);
  const request_id=crypto.randomUUID();
  if(report.compatible)ui.action(official||signed?'导入':'以本地开发包导入',async()=>{
   const params={origin:official||signed?'third-party':'local',expected_digest:inspected.digest,expected_revision:inspected.revision,request_id};
   await (install?install(params):call({action:'mod_install',source:inspected.source,...params}));say('已导入，可在已安装中检查并启用');await refresh();
  },true);
  ui.finish();
}

export function modDetail(item,revision,refresh,{showcase=true,isCurrent=()=>true}={}){
 const m=item.manifest,root=summary(m);root.append(el('p','',({official:'官方',local:'本地开发','third-party':'第三方'}[item.origin]||'未知来源')+' · '+(item.enabled?'已启用':'已停用')));
 const ui=controls(root);
 const change=async action=>{await call({action:'mod_'+action,id:m.id,expected_revision:revision,expected_digest:item.digest,request_id:crypto.randomUUID(),...(action==='enable'?{grants:m.permissions||[]}:{})});await refresh();};
 if(showcase&&m.kind==='theme')ui.action('预览组件',()=>{setTimeout(()=>{if(isCurrent())openThemeShowcase(item);},0);});
 if(m.kind==='agent')ui.action('Agent 实例',()=>{setTimeout(()=>{if(isCurrent())void openAgentPackages(item);},0);},true);
 if(m.kind==='workbox')ui.action('工作流',()=>{setTimeout(()=>{if(isCurrent())void openWorkboxes(item);},0);},true);
 if(m.kind==='context'){
  const status=el('p','','正在读取当前会话的上下文提供者…');root.insertBefore(status,root.lastChild);let source='';
  void call({action:'mod_context_view'}).then(state=>{source=state.source;status.textContent=(state.provider.error||'当前：'+state.provider.selected.name)+'。只切换当前主会话；原始档案和近期原文保持。';}).catch(error=>{status.textContent=error.message;});
  const params=()=>{if(!source)throw Error('请等当前会话读取完成');return {expected_source:source};};
  if(item.enabled)ui.action('应用到当前会话',async()=>{await call({action:'mod_apply',id:m.id,expected_digest:item.digest,...params()});say('已切换当前会话的上下文提供者');},true);
  ui.action('恢复内置会话摘要',async()=>{await call({action:'mod_context_reset',...params()});say('已恢复内置会话摘要，原始档案保留');});
 }
 if(item.enabled){
  if(m.kind==='api'){
   const label=el('label','','选择模型'),select=el('select','field'),status=el('p','','正在读取兼容模型…');select.setAttribute('aria-label','API适配目标模型');label.append(select);root.insertBefore(label,root.lastChild);root.insertBefore(status,root.lastChild);
   let version='';
   const load=async()=>{const state=await call({action:'mod_adapter_targets',id:m.id});version=state.version;select.replaceChildren();for(const model of state.models){const option=el('option','',model.name+(model.adapter_package?.id===m.id?' · 已应用':''));option.value=model.id;select.append(option);}status.textContent=state.models.length?'应用后只影响这个模型的新请求。':'模型池中没有使用此协议的模型。';};
   void load().catch(error=>{status.textContent=error.message;});
   const params=()=>{if(!version||!select.value)throw Error('请先选择兼容模型');return {profile_id:select.value,expected_version:version};};
   const checked=async payload=>{const out=await call(payload);if(out.ok===false)throw Error(out.error||out.errors?.join('; ')||'操作未完成');return out;};
   ui.action('应用到模型',async()=>{await checked({action:'mod_apply',id:m.id,expected_digest:item.digest,...params()});say('已应用API适配器');},true);
   ui.action('测试模型响应',async()=>{await checked({action:'mod_adapter_test',...params()});say('模型响应测试通过');});
   ui.action('恢复内置适配',async()=>{await checked({action:'mod_adapter_reset',...params()});say('已恢复内置适配');});
  }
  if(['theme','halo','program'].includes(m.kind))ui.action({theme:'应用主题',halo:'应用光圈',program:'打开'}[m.kind],()=>call({action:m.kind==='program'?'mod_open':'mod_apply',id:m.id,expected_digest:item.digest}),true);
  if(m.kind==='tool'||m.kind==='toolbox'||m.kind==='workbox')root.insertBefore(el('p','',m.presentation?.desktop?.renderer==='aieyra.native-tool'?'可在对话中使用。停用后不再开始新操作；已有操作仍可查看和停止。':'已加入 Eyra 工具箱，可在对话中使用。'),root.lastChild);
  ui.action('停用',()=>change('disable'));
 }
 else ui.action(m.permissions?.length?'授予上述权限并启用':'启用',()=>change('enable'),true);
 if(item.previous)ui.action('回退到 '+item.previous.manifest.version,()=>change('rollback'));
 if(!item.enabled)ui.action('卸载',()=>change('remove'));
 ui.finish();
}
