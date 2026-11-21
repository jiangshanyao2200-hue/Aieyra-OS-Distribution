// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: names; isInternalId; generic; actions; actionName; activityToolName; activityBrief; activityLabel; shorten; basename; listOf; isRecord; receiptScalar; softwareSnapshot; reportedBool; moduleSummary; sampleFacts; serverSummary; activityFacts; activityOutcome; activityDetails
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/activity.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {videoFacts} from '../../../Tool/toolbox/official/videogen/presentation/desktop.mjs';
import {imageFacts,imageSections} from '../../../Tool/toolbox/official/imagegen/presentation/desktop.mjs';
// Presentation uses a small allowlist of meaningful outcomes. Raw receipts stay
// in the audit history and never become a fallback user-facing JSON panel.
import {activityData} from '../../../Tool/presentation/receipt.mjs';
import {planData} from '../../../Tool/base/official/update_plan/presentation/model.mjs';
export {activityData,planData};
const names={models:'模型池',image_gen:'图片创作',video_gen:'视频创作',agents:'智能体',browser:'浏览器',settings:'设置',workspace:'工作区',project:'项目',memory:'记忆',community:'社区',link:'Link 办公室',software_api:'软件',server:'服务器管理',updates:'更新',tool_factory:'自建工具',team:'团队',computer:'电脑',exec:'并行',wait:'等待',compact:'压缩',human:'人工确认',cron:'定时任务',terminal:'终端',exec_command:'命令',write_stdin:'命令',read_shell_output:'命令',apply_patch:'文件',update_plan:'计划',view_image:'看图',web_search:'搜索',ask_user:'提问',ask_subconscious:'潜意识',share_diary:'日记',report:'报告'};
// 内部编号（模型配置、窗口、任务）用户看不懂，所有展示都不用它。
export const isInternalId=value=>/^(?:[a-z][a-z0-9]*[-_])?[0-9a-f]{12,}$/i.test(String(value||'').trim());
const generic=/^(调整工作区|调整设置|查看页面|查看内容|查看工具返回内容|处理项目|处理|正在操作)$/;
const actions={
 update_plan:{create:'创建计划',update:'调整计划',complete:'验收计划'},
 core_link:{link_directory:'查看可协作成员',link_invite:'邀请协作成员',link_send:'向成员发送任务',link_read:'阅读成员消息',link_result:'查看成员结果',link_stop:'停止成员任务',link_release:'结束成员协作',program_send:'向程序 Agent 派工',program_result:'查看程序 Agent 结果',program_cancel:'停止程序 Agent 任务'},
 link:{status:'查看办公室',join:'加入办公室',inbox:'阅读频道',post:'在频道发言'},
 server:{list:'查看服务器',add:'登记服务器',connect:'连接服务器',probe:'部署探针',status:'读取服务器状态',remove:'移除服务器'},
 software_api:{describe:'查看软件能力',modules:'读取模块状态',module:'调整模块',order:'调整模块顺序',receipt:'查询软件操作回执'},
 models:{list:'查看可用模型'},image_gen:{generate:'生成图片',edit:'编辑图片',create:'准备图片批次',run:'继续图片创作',status:'查看创作进度',list:'查看图片批次',recover:'恢复已返回图片'},
 agents:{models:'查看可用模型',create:'创建智能体',list:'读取智能体',status:'查看智能体状态',result:'读取智能体结果',send:'继续智能体任务',wait:'等待智能体',cancel:'停止智能体',review:'核验智能体结果',activity:'查看智能体动作',events:'读取智能体记录',open_window:'打开智能体',hide_window:'收起智能体'},
 tool_factory:{read:'查看工具',list:'列出工具',write:'创建工具',create:'创建工具',update:'更新工具',delete:'删除工具',run:'试用工具',register:'登记工具'},
 team:{list:'读取团队',create:'分派任务',status:'核对任务',send:'发消息',wait:'等待工位',cancel:'取消任务',close:'结束任务'},
 computer:{list:'读取窗口列表',attach:'连接目标窗口',detach:'结束窗口操作',inspect:'查看窗口控件',observe:'观察窗口',snapshot:'查看窗口',click:'点击目标',double_click:'双击目标',right_click:'打开右键菜单',set_value:'填写控件',type_text:'输入文字',keypress:'按键',type:'填写控件',keys:'按键',scroll:'滚动窗口',drag:'拖动目标',screenshot:'截图窗口',windows:'读取窗口列表',focus:'切换窗口',presentation:'调整操作模式'},
 exec:{call:'并行执行'},
 memory:{lookup:'检索记忆与原文',packets:'列出阶段记忆',packet:'读取阶段记忆',history:'检索历史原文',record:'记录记忆',seal:'保存阶段记忆',merge:'合并阶段记忆',original:'回看原文',plans:'读取计划记忆',recall:'回看原始对话',dream:'整理梦境',await_startup:'等待记忆载入',read:'读取记忆',write:'写入记忆',search:'搜索记忆',list:'列出记忆',read_turn:'读取对话',read_file:'读取记忆文件',write_file:'写入记忆文件',organize:'整理记忆',digest:'整理记忆',compact:'压缩记忆',forget:'忘记一段',update:'更新记忆',status:'检查记忆状态'},
 toolbox:{list:'确认可用工具'},
 settings:{inspect:'读取当前设置',get:'读取当前设置',read:'读取当前设置',status:'检查设置状态',update:'保存设置',set:'保存设置',save:'保存设置',list:'读取可用设置',schema:'读取设置说明'},
 workspace:{theme:'更新界面偏好',theme_rollback:'恢复界面偏好',model:'切换模型',open_session:'打开会话',new_session:'准备项目目录',sessions:'读取会话列表',connect:'检查工作区连接',control:'检查协作连接',status:'读取工作区状态',workflow_status:'核对任务进度',workflow_capture:'记录待核验文件',workflow_evidence:'记录验证结果',workflow_reconcile:'核对中断操作',workflow_deliver:'记录交付结果',report:'生成文档'},
 report:{report:'生成文档',reports:'读取报告列表',recall_report:'重新打开报告'},
 browser:{open:'打开网页',navigate:'打开网页',read:'读取网页',snapshot:'读取网页',search:'搜索网页',click:'点击页面元素',type:'填写页面',screenshot:'检查页面画面',tabs:'读取页面列表',close:'关闭页面'},
 project:{read:'读取文件',search:'搜索项目',list:'读取项目目录',map:'读取项目结构',memory_read:'读取项目记忆',memory_write:'保存项目记忆'},
};
actions.memory.snapshot='查看当前记忆';
Object.assign(actions.project,{map_read:'读取项目地图',map_write:'保存项目地图',index_refresh:'更新项目索引',index_query:'查询项目索引',index_annotate:'补充索引说明'});
Object.assign(actions.browser,{evaluate:'执行页面脚本',fill:'填写页面',select:'选择选项',wait:'等待页面内容',hover:'悬停页面元素',upload:'上传文件',key:'页面按键',scroll:'滚动页面',back:'返回上一页',forward:'前往下一页',reload:'重新载入页面',activate:'切换页面',handle_dialog:'处理页面对话框',settings:'浏览器设置'});
Object.assign(actions.agents,{identity_enter:'准备专业身份与交接',identity_status:'查看专业身份进展',identity_exit:'返回 Eyra 并交接结果'});
// History rows carry the raw action word; translate it with the same table.
export function actionName(tool,action){return actions[tool]?.[action]||'';}
export function activityToolName(tool){return names[tool]||'';}
export function activityBrief(item){
  const text=String(item.brief||item.title||'').trim();
  const action=String(item.action||'').trim();
  const bare=/^(?:打开|关闭|读取|查看|继续|运行|open|close|read|view|continue|run)$/i.test(text);
  if(text&&!bare&&text.toLowerCase()!==action.toLowerCase())return text;
  if(item.tool==='browser'&&['open','navigate'].includes(action)){
    const data=activityData(item);
    const target=item.targets?.find(value=>/^https?:\/\//i.test(value))||data.url;
    try{
      const url=new URL(target);
      if(['http:','https:'].includes(url.protocol))return '打开网页 · '+shorten(url.host+(url.pathname==='/'?'':url.pathname),85);
    }catch{}
    return '打开网页';
  }
  return bare||text||actions[item.tool]?.[action]?activityLabel({...item,title:''}):'';
}
export function activityLabel(item) {
  const data=activityData(item),packageTitle=item.tool?.startsWith('mod:')&&typeof item.presentation?.title==='string'?item.presentation.title.trim():'',name=packageTitle||names[item.tool]||'工具';
  if(item.action==='load_tool'||item.tool==='toolbox'&&data.open) {
    const opened=item.tool==='toolbox'?Object.keys(data.open||{}).filter(k=>data.open[k]).map(k=>names[k]||k).join('、'):name;
    return (opened||'工具')+'说明'+(item.state==='completed'?'已就绪':'载入中');
  }
  if(item.action==='unload_tool')return name+'已收起';
  if(packageTitle)return packageTitle;
  const title=item.title?.trim();
  const label=title&&!generic.test(title)?title:actions[item.tool]?.[item.action]||({apply_patch:'修改文件',update_plan:'任务进度',exec_command:'运行命令',write_stdin:'继续命令',read_shell_output:'读取命令输出',view_image:'看图',web_search:'搜索网页',ask_user:'问你一个问题',ask_subconscious:'问潜意识',share_diary:'分享日记'}[item.tool])||name+'操作';
  const target=item.targets?.find(t=>!isInternalId(t))||data.path||(item.tool==='workspace'&&item.action==='new_session'?data.workdir:'');
  return target&&!label.includes(target)?label+' · '+target:label;
}
// 工具窗口里的说明（用户 2026-10-13 第 12 项）：不该只写一个工具名。
// 每一类工具说清"做了什么、动的是谁"，用两三行短事实，人扫一眼就懂；
// 不认识的字段一律不显示（原文回执在历史里，界面上不摆 JSON）。
const shorten=(value,n=72)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>n?text.slice(0,n-1)+'…':text;};
const basename=path=>String(path||'').split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).pop()||'';
const listOf=(value,one,two)=>{const n=Array.isArray(value)?value.length:0;return n?(n===1?one:two.replace('%d',String(n))):'';};
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const receiptScalar=value=>typeof value==='string'||typeof value==='number'?String(value):'';
const softwareSnapshot=data=>isRecord(data.current)?data.current:data;
const reportedBool=(value,yes,no)=>value===true?yes:value===false?no:'未报告';
function moduleSummary(row,catalog=false){
 if(!isRecord(row))return '模块记录不完整';
 const fields=[shorten(receiptScalar(row.title)||receiptScalar(row.id)||'未命名模块',160)];
 if(catalog)fields.push('可独立：'+reportedBool(row.detachable,'是','否'));
 else{
  fields.push('位置：'+({attached:'主窗口内',detached:'独立窗口',closed:'已关闭'}[row.placement]||'未报告'),'显示：'+reportedBool(row.visible,'可见','已收起'),'就绪：'+reportedBool(row.ready,'已就绪','未就绪'));
  if(row.starting===true)fields.push('正在启动');
  if(typeof row.error==='string'&&row.error)fields.push('错误：'+shorten(row.error,400));
 }
 return fields.join(' · ');
}
function sampleFacts(sample){
 if(!isRecord(sample))return [];
 const out=[];
 for(const [key,label]of [['host','主机'],['os','系统'],['kernel','内核'],['model','处理器'],['load','负载']])if(typeof sample[key]==='string'&&sample[key])out.push([label,shorten(sample[key],160)]);
 for(const [key,label,unit]of [['cpu','CPU','%'],['cores','核心',''],['mem_used_pct','内存','%'],['swap_used_pct','交换内存','%'],['disk_used_pct','磁盘','%'],['uptime_s','运行时间',' 秒'],['conns','连接数',''],['procs','进程数','']]){
  if(Number.isFinite(sample[key]))out.push([label,String(sample[key])+unit]);
  else if(Object.hasOwn(sample,key))out.push([label,'未报告']);
 }
 for(const [key,label]of [['rx_rate','接收速率'],['tx_rate','发送速率'],['read_rate','磁盘读速率'],['write_rate','磁盘写速率']]){
  if(Number.isFinite(sample[key]))out.push([label,sample[key]+' B/s']);
  else if(Object.hasOwn(sample,key))out.push([label,sample[key]===null?'尚无基线':'未报告']);
 }
 if(Number.isFinite(sample.at)){const at=new Date(sample.at);if(Number.isFinite(at.getTime()))out.push(['采样时间',at.toISOString()]);}
 return out;
}
function serverSummary(row,withSample=true){
 if(!isRecord(row))return '服务器记录不完整';
 const fields=[shorten(receiptScalar(row.name)||receiptScalar(row.host)||'未命名服务器',160)];
 for(const [key,label]of [['host','地址'],['port','端口'],['user','用户']])if(receiptScalar(row[key]))fields.push(label+'：'+shorten(row[key],160));
 fields.push('探针：'+reportedBool(row.probe,'已安装','未安装'));
 if(typeof row.error==='string'&&row.error)fields.push('错误：'+shorten(row.error,400));
 if(withSample){const last=sampleFacts(row.last);fields.push('最近采样：'+(last.length?last.map(([label,value])=>label+' '+value).join(' · '):isRecord(row.last)?'样本未报告状态指标':'尚无样本'));}
 return fields.join(' · ');
}

export function activityFacts(item) {
  const data=activityData(item),out=[];
  const push=(label,value)=>{const text=shorten(value);if(text)out.push({label,value:text});};
  if(item.tool!=='toolbox'&&['load_tool','unload_tool'].includes(item.action)){push('工具',names[item.tool]||item.tool);push('动作',item.action==='load_tool'?'准备工具说明':'收起工具说明');return out;}
  switch(item.tool){
   case 'core_link':push('成员',data.title||data.spec?.title);break;
   case 'models':push('模型',Array.isArray(data.models)?data.models.length+' 个':'');break;
   case 'report':{
    const input=item.input_preview||{},saved=data.document||{};
    push('文档',saved.title||input.title);
    push('格式',String(saved.format||input.format||'').toUpperCase());
    push('数量',listOf(data.documents,'1 份','%d 份'));
    break;}
   case 'image_gen':imageFacts(data,push);break;
   case 'video_gen':videoFacts(data,push);break;
   case 'software_api':{
    const current=softwareSnapshot(data),modules=Array.isArray(current.modules)?current.modules:[];
    if(Array.isArray(current.modules))push('模块',current.modules.length+' 个');
    if(Array.isArray(data.catalog))push('模块目录',data.catalog.length+' 个');
    push('当前页面',receiptScalar(modules.find(row=>row?.id===current.active_page)?.title)||receiptScalar(current.active_page));
    if(typeof current.main_open==='boolean')push('主窗口',current.main_open?'已打开':'已关闭');
    break;}
   case 'server':{
    if(Array.isArray(data.servers))push('服务器',data.servers.length+' 台');
    const server=isRecord(data.server)?data.server:null;
    if(server){push('服务器',server.name||server.host);push('地址',server.host);push('探针',reportedBool(server.probe,'已安装','未安装'));}
    else if(isRecord(data.sample))for(const [label,value]of sampleFacts(data.sample).filter(([label])=>['主机','CPU','内存','采样时间'].includes(label)))push(label,value);
    break;}
   case 'agents':{
    if(item.action?.startsWith('identity_')){const input=item.input_preview||{},identity=data.identity||data;push('身份',identity.name);push('任务',input.task);push('状态',({preparing:'正在准备交接',active:'专业身份执行中',exited:'已返回 Eyra'})[identity.phase]);break;}
    push('名称',data.spec?.title||data.title);
    push('状态',data.state);
    push('数量',listOf(data,'1 个智能体','%d 个智能体'));
    break;}
   case 'toolbox':{
    const opened=Object.keys(data.open||{}).filter(k=>data.open[k]);
    if(opened.length)push('打开',opened.map(k=>names[k]||k).join('、'));
    if(data.name)push('工具',names[data.name]||data.name);
    if(data.close)push('收起',Object.keys(data.close).filter(k=>data.close[k]).map(k=>names[k]||k).join('、'));
    break;}
   case 'memory':{
    if(item.action==='compact'&&data.compaction){const c=data.compaction;push('范围',c.covered_messages>c.first_message?'第 '+(c.first_message+1)+'—'+c.covered_messages+' 条消息':'');push('进展',item.detail);break;}
    push('动作',actions.memory?.[item.action]||'整理记忆');
    push('范围',listOf(data.rows||data.items,'1 条','%d 条'));
    push('层级',data.layer||data.scope||data.kind);
    break;}
   case 'project':{
    push('动作',actions.project?.[item.action]||'处理项目');
    push('位置',item.targets?.[0]||data.path||data.pattern);
    push('结果',[listOf(data.files||data.matches,'1 个文件','%d 个文件'),listOf(data.results,'1 条结果','%d 条结果')].filter(Boolean).join(' · '));
    break;}
   case 'browser':{
    push('动作',actions.browser?.[item.action]||'操作页面');
    push('页面',item.targets?.[0]||data.url||data.title);
    push('元素',data.selector||data.text||data.label);
    break;}
   case 'settings':{
    push('动作',item.title?.trim()||actions.settings?.[item.action]||'调整设置');
    push('模型',data.model||data.model_name);
    push('结果',data.message||data.summary||(data.ok===true?'成功':data.ok===false?'没成功':''));
    const patch=data.patch&&typeof data.patch==='object'?Object.keys(data.patch):[];
    push('改动',listOf(patch,'1 项','%d 项'));
    const keys=Array.isArray(data.keys)?data.keys:Object.keys(data.settings||{});
    push('项目',keys.slice(0,4).join('、'));
    break;}
   case 'workspace':{
    push('动作',actions.workspace?.[item.action]||'调整工作区');
    push('目录',data.workdir);
    push('会话',data.session&&basename(data.session));
    break;}
   case 'team':{
    push('任务',data.task||data.title||item.targets?.[0]);
    push('工位',listOf(data.seats||data.agents,'1 个','%d 个'));
    break;}
   case 'tool_factory':{
    push('工具',data.name||item.targets?.[0]);
    push('版本',data.version);
    break;}
   case 'computer':{
    push('窗口',data.window||data.title||item.targets?.[0]);
    push('动作',item.action||data.action);
    break;}
   case 'exec':{
    push('并行',listOf(data.calls||data.steps,'1 步','%d 步'));
    break;}
   case 'update_plan':
   case 'wait':
   case 'compact':break;
   default:{
    if(data.description)push('说明',data.description);
    if(data.query)push('查询',data.query);
    if(data.url)push('地址',data.url);
    break;}
  }
  return out;
}

export function activityOutcome(item) {
  const data=activityData(item);
  if(item.state==='interrupted_unknown')return '结果未确认，请先核对原操作回执。';
  if(item.state==='persistence_failed')return '结果保存失败，请核对原操作与产物。';
  if(['failed','timed_out','interrupted','interrupted_unknown','persistence_failed'].includes(item.state)||data.ok===false) {
    const error=typeof data.error==='string'?data.error:typeof data.error?.message==='string'?data.error.message:item.detail;
    // Malformed/protocol output is not useful error copy.
    if(typeof error==='string'&&error.trim()&&!/^\s*[\[{]/.test(error))return error.slice(0,500);
    if(Number.isInteger(data.exit_code)&&data.exit_code!==0)return '命令以退出码 '+data.exit_code+' 结束。';
    return '这一步未完成，等待重新处理。';
  }
  if(item.tool==='workspace'&&item.action==='theme'&&data.theme?.scale)return '界面缩放 '+Math.round(data.theme.scale*100)+'%';
  if(item.tool==='core_link'&&item.action==='link_send'){
   if(data.accepted===true)return '任务消息已送达成员。';
   if(data.committed===true)return data.queued===true?'任务消息已保存，等待成员接收。':'任务消息已保存，送达情况待确认。';
  }
  return '';
}

// Bounded, meaningful receipt sections. No arbitrary object/credential dump.
export function activityDetails(item){
 const d=activityData(item),sections=[];
 const add=(label,text)=>{if(typeof text==='number')text=String(text);if(typeof text==='string'&&text.trim())sections.push({label,text:text.length>12000?text.slice(0,12000)+'\n…预览已收起，完整回执见历史。':text});};
 const scalar=v=>typeof v==='string'||typeof v==='number'?String(v):'';
 add('操作',[item.title||actions[item.tool]?.[item.action]||item.action,...(item.targets||[]).filter(t=>!isInternalId(t))].filter(Boolean).join('\n'));
 const info=d.record||d.item||d.packet||d.agent||d;
 const fields={id:'编号',title:'标题',name:'名称',kind:'类型',scope:'范围',state:'状态',status:'状态',revision:'版本',model:'模型',model_id:'模型',path:'位置',source:'来源',count:'数量',total:'总数',total_lines:'总行数',files_scanned:'扫描文件',skipped_files:'跳过文件',duration_ms:'耗时 ms',exit_code:'退出码'};
 // 记忆回执给人看：内部编号/版本/会话哈希不展示，类型与范围译成中文。
 const memory=item.tool==='memory',hidden=new Set(memory?['id','revision','source']:[]);
 if(item.tool==='core_link'){
  for(const key of ['id','revision','kind','scope','state','status','model_id'])hidden.add(key);
  add('任务内容',item.input_preview?.message);
 }
 if(item.tool==='agents'&&item.action?.startsWith('identity_')){
  const input=item.input_preview||{},identity=d.identity||d;
  for(const [key,label]of [['task','任务'],['reason','切换理由'],['success','完成条件'],['exit','返回条件'],['outcome','结果']])add(label,input[key]);
  if(Array.isArray(input.plan))add('执行计划',input.plan.map((text,i)=>(i+1)+'. '+text).join('\n'));
  add('当前身份',identity.name);add('交接结果',identity.outcome);
 }
 if(memory&&item.action==='compact'&&d.compaction){
  const c=d.compaction,stats=c.compression;
  add('进展',item.detail);
  if(stats)add('上下文变化（估算）',stats.before_tokens+' → '+stats.after_tokens+' tokens；不是本次费用或缓存命中。');
  add('压缩前的原文',d.before);add('压缩后的内容',d.after);add('原文读取',d.source_error);
  if(d.before_more||d.after_more)add('继续阅读','此处显示部分内容；双击光圈打开历史，在“压缩记忆”中逐页阅读完整原文和摘要。');
  if(c.state!=='completed')add('压缩后内容','尚无已提交的摘要。');
 }
 if(memory&&item.action==='snapshot'){
  if(Array.isArray(d.packets)&&Array.isArray(d.profile))add('当前记忆',d.packets.length+' 段阶段记忆 · '+d.profile.length+' 条长期记忆');
  if(Number.isFinite(d.summary_tokens))add('摘要大小（估算）',d.summary_tokens+' tokens；不是本次消耗或缓存命中。');
  if(d.merge_recommended===true)add('整理状态','阶段记忆较多，可合并整理；本次仅查看，尚未修改。');
 }
 if(memory&&['seal','merge'].includes(item.action)){
  const input=item.input_preview||{},c=d.compression;
  add('阶段',input.title);
  if(Number.isFinite(c?.before_tokens)&&Number.isFinite(c?.after_tokens))add('上下文变化（估算）',c.before_tokens+' → '+c.after_tokens+' tokens\n'+(c.before_tokens>=c.after_tokens?'减少 '+(c.before_tokens-c.after_tokens):'增加 '+(c.after_tokens-c.before_tokens))+' tokens；仅本次封存段与摘要，不是整场用量或缓存命中。');
  else add('上下文变化',['queued','running'].includes(item.state)?'等待保存回执，尚未报告变化。':'此回执未报告前后估算，不能据此推断压缩比例。');
  if(Number.isInteger(d.newly_covered_messages))add('封存范围','本次 '+d.newly_covered_messages+' 条；累计覆盖 '+d.covered_messages+' 条消息。');
  if(d.originals_preserved===true)add('原文','已持久保留，可通过记忆检索和历史回看。');
  add(item.state==='completed'&&d.ok===true?'保存的摘要':'本次提交的摘要',input.content);
  add('检索词',input.keywords);
 }
 const words={kind:{fact:'事实',preference:'偏好',decision:'决定',episode:'经历',summary:'摘要',plan:'计划'},scope:{global:'全局',project:'当前项目'},status:{active:'有效',done:'已完成',paused:'暂停',cancelled:'已取消'},state:{active:'有效'}};
 const facts=[];for(const [key,label]of Object.entries(fields)){if(hidden.has(key))continue;let value=scalar(info[key]);if(memory&&words[key]?.[value])value=words[key][value];if(value&&!isInternalId(value))facts.push(label+' · '+value);}
 if(info.spec){for(const [key,label]of [['title','名称'],['model','模型'],['objective','目标']])if(scalar(info.spec[key])&&!isInternalId(info.spec[key]))facts.push(label+' · '+scalar(info.spec[key]));}
 add('回执',facts.join('\n'));
 if(item.tool==='computer'){
  add('窗口',d.identity?.title);add('执行',actions.computer?.[d.performed]||d.performed);
  if(d.effect?.delta_y!=null)add('滚动结果','垂直 '+d.effect.delta_y+' 单位（'+d.effect.vertical_notches+' 格，正值向下）；已执行一次，后续观察实际结果。');
  add('截图',d.path);add('下一步',d.next);
 }
 if(item.tool==='browser'){
  const input=item.input_preview||{},text=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
  for(const [key,label]of [['script','执行脚本'],['key','按键'],['selector','页面条件'],['text','查找文字'],['files','上传文件']])if(Object.hasOwn(input,key))add(label,text(input[key]));
  if(Object.hasOwn(input,'value'))add(item.action==='select'?'选择内容':'输入内容',item.action==='fill'?(d.input_sensitive===false?text(Object.hasOwn(d,'input_value')?d.input_value:input.value):'输入内容已隐藏'):text(input.value));
  if(Object.hasOwn(d,'value'))add('脚本结果',text(d.value));
  if(Array.isArray(d.tabs))add('页面列表',d.tabs.map(tab=>[tab.active?'● 当前页面':'○ 页面',tab.title||tab.name||'未命名页面',tab.url||''].filter(Boolean).join('\n')).join('\n\n')||'没有打开的页面');
  add('页面正文',d.text||d.content);
  if(Array.isArray(d.frames))add('页面框架',d.frames.map(frame=>[frame.name,frame.url,frame.title].filter(Boolean).join(' · ')).join('\n'));
 }
 if(item.tool==='report'||item.tool==='workspace'&&item.action==='report'){
  add('正文',item.input_preview?.content);
  if(Array.isArray(d.documents))add('文档',d.documents.slice(0,24).map(row=>row.title).filter(Boolean).join('\n'));
 }
 if(item.tool==='software_api'){
  const current=softwareSnapshot(d),modules=Array.isArray(current.modules)?current.modules:[],state=[];
  if(typeof current.main_open==='boolean')state.push('主窗口：'+(current.main_open?'已打开':'已关闭'));
  if(typeof current.active_page==='string')state.push('当前页面：'+(receiptScalar(modules.find(row=>row?.id===current.active_page)?.title)||current.active_page));
  add('当前状态',state.join('\n'));
  for(const [key,label,catalog]of [['modules','模块状态',false],['catalog','模块目录',true]]){
   const rows=catalog?d[key]:current[key];
   if(!Array.isArray(rows))continue;
   add(label,rows.slice(0,24).map(row=>moduleSummary(row,catalog)).join('\n')||(catalog?'没有可用模块':'没有模块记录'));
   if(rows.length>24)add('预览范围','显示前 24 个模块，共 '+rows.length+' 个。');
  }
  if(!Array.isArray(current.modules)&&['modules','module','order','receipt'].includes(item.action))add('模块状态','此回执未报告模块状态。');
  if(current!==d&&(current.has_more||current.truncated))add('后续','当前模块状态是部分内容；完整回执见历史。');
 }
 if(item.tool==='server'){
  if(Array.isArray(d.servers)){
   add('服务器列表',d.servers.slice(0,24).map(row=>serverSummary(row)).join('\n')||'没有登记服务器');
   if(d.servers.length>24)add('预览范围','显示前 24 台服务器，共 '+d.servers.length+' 台。');
  }else if(item.action==='list')add('服务器列表','此回执未报告服务器列表。');
  if(isRecord(d.server)){
   add('服务器',serverSummary(d.server,false));
   if(!isRecord(d.sample)&&isRecord(d.server.last))add('最近采样',sampleFacts(d.server.last).map(([label,value])=>label+' · '+value).join('\n')||'此样本未报告可显示的状态指标。');
  }
  if(isRecord(d.sample))add('本次采样',sampleFacts(d.sample).map(([label,value])=>label+' · '+value).join('\n')||'此样本未报告可显示的状态指标。');
  else if(['status','connect','probe'].includes(item.action))add('本次采样','此回执未报告采样数据。');
 }
 if(item.tool==='image_gen')imageSections(d,add);
 for(const [key,label]of [['content','内容'],['text','内容'],['excerpt','摘录'],['answer','回复'],['summary','摘要'],['output','输出'],['message','说明'],['notice','提示']])add(label,info[key]);
 const collections=Array.isArray(d)?[['结果',d]]:Object.entries({packets:'阶段记忆',profile:'长期记忆',records:'原文片段',rows:'记忆条目',items:'条目',memories:'记忆',entries:'目录',lines:'文件内容',matches:'匹配',results:'结果',agents:'智能体',models:'模型',sessions:'会话',diaries:'日记',segments:'记忆段',plans:'计划',tools:'工具',images:'图片',batches:'批次',windows:'窗口',elements:'控件',failed:'未完成'}).filter(([key])=>Array.isArray(d[key])).map(([key,label])=>[label,d[key]]);
 for(const [label,rows]of collections){
  const lines=rows.slice(0,24).map(row=>{
   if(typeof row==='string')return row;
   if(!row||typeof row!=='object')return '';
   const location=[row.path||row.name,row.line].map(scalar).filter(Boolean).join(':');
   const title=scalar(row.title||row.role||row.model||(memory?'':row.id)),body=scalar(row.text||row.content||row.excerpt||row.summary||row.objective||row.message||row.prompt||row.input?.prompt),raw=scalar(row.state||row.status),state=memory?(words.status[raw]||words.state[raw]||raw):raw;
   const text=[location,title,state,body].filter(Boolean).join(memory?'\n':' · '),limit=memory?6000:1600;
   return text.slice(0,limit)+(row.truncated||text.length>limit?'\n…此条仅显示部分内容，完整原文可继续读取。':'');
  }).filter(Boolean);
  add(label,lines.join(memory?'\n\n':'\n')||(rows.length?rows.length+' 条记录':'没有匹配记录'));
  if(rows.length>24)add('预览范围','显示前 24 条，共 '+rows.length+' 条。');
 }
 if(d.has_more||d.profile_has_more||d.next_cursor||d.truncated)add('后续','此回执是部分内容；可在历史中查看原文，模型可按游标继续读取。');
 add('错误',activityOutcome(item));
 return sections;
}
