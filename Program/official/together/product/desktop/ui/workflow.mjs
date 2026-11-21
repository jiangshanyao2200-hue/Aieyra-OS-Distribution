/* @file-map:start
文件: link/desktop/ui/workflow.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/markdown.mjs
上游: AIDEBUG/live.test.cjs, AIDEBUG/local-engineering.test.cjs, AIDEBUG/preview-window.test.cjs, link/desktop/ui/index.html, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/live.test.cjs, AIDEBUG/local-engineering.test.cjs, AIDEBUG/preview-window.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  short | function
  pager | function
  workflowHTML | function
  verificationsHTML | function
  releasesHTML | function
  releaseHTML | function
  handoffsHTML | function
  localPreviewsHTML | function
  localEngineeringHTML | function
  localRunHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
const phases={building:'独立开发，分批整合',debug:'集中 Debug',development:'开发版试用',stable:'稳定版已确认'};
const /* @chain-region short | calls: e, slice */ short=v=>e((v||'').slice(0,12));
const /* @chain-region pager | calls: Math.max, Math.floor */ pager=(attribute,value,offset,size)=>offset||value.next_offset!==null?`<div class="pager"><button data-${attribute}="${Math.max(0,offset-size)}" ${offset?'':'disabled'}>上一页</button><span>第 ${Math.floor(offset/size)+1} 页</span><button data-${attribute}="${value.next_offset??offset}" ${value.next_offset!==null?'':'disabled'}>下一页</button></div>`:'';
export /* @chain-region workflowHTML | calls: some, Object.values, Array.isArray, e, join, map, includes */ function workflowHTML(value){
 if(!value?.phase)return '';
 const p=value.phase,b=value.blockers||{},pending=(b.unfinished_agendas?.length||0)+(b.unaccepted_goals?.length||0)+(b.pending_agendas||0),complete=!Object.values(b).some(x=>Array.isArray(x)?x.length:!!x);
 return `<section class="workflow-overview" aria-label="工程阶段"><span class="eyebrow">当前阶段</span><h2>${e(p?phases[p.phase]||'阶段待核对':'等待本轮目标确立')}</h2>${p?`<p class="workflow-summary">${!value.repository.cloud?'等待首份共创源码':b.no_adopted_goals?'等待采纳本轮目标':pending?`${pending} 项工作或验收待完成`:'当前目标和任务已完成阶段验收'}</p><div class="workflow-goals">${(value.goals||[]).map(g=>`<div><strong>${e(g.title)}</strong>${g.accepted?'<span class="state-pill ready">已验收</span>':value.can_authorize?`<button class="secondary" data-accept-goal="${e(g.candidate_id)}">验收目标</button>`:'<span class="state-pill">待阶段验收</span>'}</div>`).join('')}</div>`:''}<div class="actions"><button class="secondary" data-action="local-engineering">本地工作区与运行</button><button class="secondary" data-action="engineering-handoffs">议程接续</button>${value.can_authorize&&p?`${p.phase!=='stable'&&(p.phase==='building'||p.frozen!==value.repository.cloud)?`<button class="secondary" data-engineering-freeze="true" ${complete?'':'disabled'}>授权进入 Debug</button>`:''}${['debug','development'].includes(p.phase)?'<button class="primary" data-engineering-release="development">发布开发版</button>':''}${p.phase==='development'?'<button class="primary" data-engineering-release="stable">确认稳定版</button>':''}`:''}</div><details class="context-details" data-details-key="phase-rules"><summary>阶段依据</summary>${value.repository.cloud?`<p>云代码 <code>${e(value.repository.cloud)}</code></p>`:''}<p>${e(value.verification_trust||'')}</p></details></section>`;
}
export /* @chain-region verificationsHTML | calls: Set, e, join, map, rows.filter, latest.has, r.reviewer.slice, String … */ function verificationsHTML(value,{history=false,offset=0}={}){
 const latest=new Set(value.latest||[]),rows=value.reports||[];
 return `<section class="dialog-section" data-verification-revision="${e(value.revision)}"><h3>精确版本复验</h3>${value.quorum?`<p class="${value.quorum.passed?'':'station-warning'}">${value.quorum.passed?'作者与独立工程师的精确复验条件已满足':value.quorum.reason==='verification_failed'?'当前有失败记录，等待修复与重新复验':'等待作者与另一位工程师通过相同验证流程'}</p>`:''}${rows.filter(r=>history||latest.has(r.id)).map(r=>`<article class="verification-row"><strong>${r.outcome==='pass'?'验证通过':'发现问题'} · ${e(r.name||r.reviewer.slice(0,8))}${latest.has(r.id)?'':' · 历史记录'}</strong><p>${e(r.summary)}</p><details><summary>执行依据</summary><dl class="task-detail"><dt>退出码</dt><dd>${e(String(r.evidence.execution.code))}</dd><dt>源码清单</dt><dd><code>${short(r.evidence.execution.manifest_sha256)}</code></dd><dt>执行环境</dt><dd>${r.evidence.kind==='local-process'?'本地进程 · 固定源码':'本地 KVM · 无网络 · 无宿主挂载'}</dd><dt>环境摘要</dt><dd><code>${short(r.evidence.environment.baseline_id)}</code></dd><dt>日志摘要</dt><dd><code>${e(r.evidence.execution.log_sha256)}</code></dd></dl><pre class="snapshot-source">${e(r.evidence.script)}</pre></details></article>`).join('')||'<p class="muted">本页暂无当前复验记录。</p>'}${history?pager('verification-page',value,offset,20):rows.length?`<button class="secondary" data-verification-page="0" data-revision="${e(value.revision)}">查看全部执行记录</button>`:''}</section>`;
}
export /* @chain-region releasesHTML | calls: join, value.releases.map, e, short, pager */ function releasesHTML(value,offset=0){
 if(!value.releases.length&&!offset)return '';
 return `<section class="release-history"><div class="section-heading"><h3>版本通道</h3></div>${value.releases.map(r=>`<button class="snapshot-row" data-engineering-release-id="${e(r.id)}"><div><strong>${e(r.name)}</strong><small>${short(r.revision)}</small></div><span class="state-pill">${r.channel==='stable'?'稳定版':'开发版'}</span><span aria-hidden="true">↗</span></button>`).join('')||'<p class="muted">尚无阶段产物。</p>'}${pager('releases-page',value,offset,20)}</section>`;
}
export /* @chain-region releaseHTML | calls: join, r.artifacts.map, e, at, a.path.split, toFixed, short */ function releaseHTML(value){
 const r=value.release,m=r.manifest;
 const artifacts=r.artifacts.map(a=>`<article class="verification-row release-artifact" data-artifact="${e(a.sha256)}">
  <div class="release-artifact-heading"><div><strong>${e(a.path.split('/').at(-1))}</strong><small>${(a.bytes/1048576).toFixed(2)} MiB</small></div>
    <div class="actions"><button class="secondary" data-artifact-download="${e(a.sha256)}" data-release="${e(r.id)}">下载</button>
      <button class="secondary" data-artifact-cancel hidden>暂停</button>
      <button class="secondary" data-artifact-reveal="${e(a.sha256)}" data-release="${e(r.id)}" hidden>打开文件位置</button></div>
  </div>
  <progress aria-label="下载进度" max="${a.bytes}" value="0" hidden></progress><p class="connection-note" role="status" hidden></p>
  <details class="context-details"><summary>文件校验值</summary><code class="artifact-digest">${e(a.sha256)}</code></details>
 </article>`).join('');
 return `<span class="eyebrow">${m.provenance?.experimental?'共创实验版本':'共创版本'} · ${r.channel==='stable'?'稳定通道':'开发通道'}</span><h3>${e(r.name)}</h3><p>${e(r.notes)}</p><h3>构建产物</h3>${artifacts}<p class="connection-note">${m.code_signed?'':'此版本没有代码签名。'}公网安装包下载仍暂停。</p><details class="context-details"><summary>构建与源码依据</summary><dl class="task-detail"><dt>精确源码</dt><dd><code>${e(r.revision)}</code></dd><dt>构建与复验</dt><dd><code>${short(r.verification_id)}</code></dd><dt>版本清单摘要</dt><dd><code>${e(value.manifest_sha256)}</code></dd></dl></details>`;
}
export /* @chain-region handoffsHTML | calls: join, value.handoffs.map, e, Object.keys, JSON.stringify, pager */ function handoffsHTML(value,offset=0){
 return (value.handoffs.map(h=>`<article class="verification-row"><strong>${{offered:'等待自愿接续',accepted:'已接续',cancelled:'已撤回',expired:'已到期',superseded:'已更新邀请'}[h.state]||e(h.state)}</strong><p>${e(h.reason)}</p><p>${Object.keys(h.tasks).length} 项交接任务 · ${Object.keys(h.sources).length} 份可恢复源码</p><details><summary>交接依据与 Agent 操作</summary><pre class="snapshot-source">${e(JSON.stringify({id:h.id,tasks:h.tasks,checkpoints:h.checkpoints,sources:h.sources},null,2))}</pre><p>engineering --action handoffs/accept --body-file 接续.json；随后 work recover --task TASK --revision SOURCE。</p></details></article>`).join('')||'<p class="empty">当前没有与你相关的接续邀请。</p>')+pager('handoffs-page',value,offset,40);
}

const runLabels={queued:'正在排队',waiting_resources:'等待本机空闲资源',booting:'正在启动 VM',transferring:'正在校验并传入源码',running:'正在执行',passed:'验证通过',failed:'验证失败',cancelled:'已取消',interrupted:'执行已中断'};
export /* @chain-region localPreviewsHTML | calls: join, map, e, includes, short */ function localPreviewsHTML(value){
 const labels={starting:'正在准备',running:'随源码更新',waiting_resources:'等待本机资源',waiting_workspace:'等待编辑完成',blocked:'当前源码暂不可预览',stopped:'已停止',expired:'已到期',interrupted:'连接已中断',failed:'启动失败',limit_reached:'已达更新上限'};
 return `<section class="local-web-previews" aria-label="本地网页预览"><h3>网页预览</h3>${(value.local_previews||[]).map(p=>`<article class="local-run"><strong>${e(p.entry)}</strong><p>${e(labels[p.state]||'状态待核对')}</p>${p.state==='blocked'?'<p class="station-warning">预览更新失败</p>':''}${['running','waiting_resources','waiting_workspace','blocked'].includes(p.state)?`<button class="secondary" data-local-preview="${e(p.id)}">打开运行画面</button>`:''}<details class="context-details"><summary>预览依据</summary><p>源码 <code>${short(p.snapshot)}</code></p></details></article>`).join('')||'<p class="muted">尚未启动网页预览</p>'}</section>`;
}
export /* @chain-region localEngineeringHTML | calls: sort, localPreviewsHTML, join, rows.map, e, toLocaleString, Date, work.map … */ function localEngineeringHTML(value){
 const env=value.environment||{},local=value.local_environment,rows=[...(value.local_runs||[]),...(value.runs||[])].sort((a,b)=>(b.created||0)-(a.created||0)),work=value.workspaces||[];
 const unknown=env.query_failed||local?.query_failed;
 return `<div class="run-heading"><p>${work.length} 个本机工作区${rows.length?' · 最近 '+rows.length+' 条执行记录':''}</p><button class="secondary" data-action="local-engineering">刷新本机状态</button></div>${unknown?'<p class="station-warning">部分执行记录读取失败</p>':''}${value.preview_query_failed?'<p class="station-warning">预览状态读取失败</p>':localPreviewsHTML(value)}<section class="local-executions"><h3>最近执行</h3>${rows.map(r=>`<article class="local-run"><strong>${e(runLabels[r.state]||'状态待核对')}</strong><p>${r.kind==='local-process'?'本地进程':'本地 VM'}${r.created?' · '+new Date(r.created*1000).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</p><button class="secondary" data-local-run="${e(r.id)}">查看执行记录</button></article>`).join('')||'<p class="muted">尚无执行记录</p>'}</section>${work.length?`<details class="context-details"><summary>本机工作区 · ${work.length}</summary>${work.map(w=>`<article class="verification-row"><strong>工作区 ${short(w.id)}</strong>${w.upstream&&w.upstream!==w.base?'<p class="station-warning">已下载新云代码，等待安全应用</p>':''}${w.cloud_draft?'<p>草稿已同步</p>':''}${w.fusion_queue?'<p>成果已进入融合队列</p>':''}<p class="record-meta">${w.task_id?'关联任务 '+short(w.task_id):'本地副本'} · 基础 ${short(w.base)}</p></article>`).join('')}</details>`:''}<details class="context-details"><summary>运行环境</summary><p>${local?.query_failed?'本地运行状态暂未读到。':local?.ready?'本地工程运行器已就绪。':'本地运行器尚待准备。'}</p><p>${env.query_failed?'VM 状态暂未读到。':env.ready?'可选 VM 已就绪。':'VM 未就绪'}</p>${env.error?`<p>VM 检查结果：${e(env.error)}</p>`:''}</details>`;
}
export /* @chain-region localRunHTML | calls: test, e, short, join, map, split, Math.max */ function localRunHTML(value){
 const r=value.run,preview=value.preview,local=r.kind==='local-process';
 const picture=preview&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(preview.data||'')&&preview.data.length<3*1024*1024;
 return `<span class="eyebrow">${local?'本地工程运行':'本机 VM 执行'}</span><h3>${e(runLabels[r.state]||r.state)}</h3><p>快照 ${short(r.snapshot)}${typeof r.code==='number'?' · 退出码 '+r.code:''}${r.actual_vm?' · 真实 VM':''}</p>${r.error?`<p class="station-warning">${e(r.error)}</p>`:''}<div class="actions"><button class="secondary" data-local-run="${e(r.id)}">刷新记录</button><button class="secondary" data-action="local-engineering">返回本机概览</button></div>${picture?`<figure class="vm-console-preview"><img src="${preview.data}" alt="实际虚拟机控制台中的执行日志"><figcaption>VM 控制台 · 执行日志画面</figcaption></figure>`:''}<h3>执行输出</h3><div class="local-run-log development-logs">${(value.logs?.text||'暂无日志').split(/\r?\n/).map(line=>`<p title="${e(line)}">${e(line)||'&nbsp;'}</p>`).join('')}</div><nav class="pager" aria-label="执行日志分页"><button data-local-log="${e(r.id)}" data-log-offset="${Math.max(0,(value.logs?.offset||0)-32768)}" ${value.logs?.offset?'':'disabled'}>上一页</button><button data-local-log="${e(r.id)}" data-log-offset="${value.logs?.next_offset??0}" ${value.logs?.next_offset===null||value.logs?.next_offset===undefined?'disabled':''}>下一页</button></nav><details class="context-details"><summary>执行编号</summary><code class="artifact-digest">${e(r.id)}</code></details>`;
}
