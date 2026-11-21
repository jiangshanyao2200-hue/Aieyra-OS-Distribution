/* @file-map:start
文件: link/desktop/ui/development.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/connection.mjs, link/desktop/ui/markdown.mjs
上游: link/desktop/ui/workspace.mjs
链路: source-transfer
验证: AIDEBUG/development-download.test.cjs, AIDEBUG/transfer-recovery.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  bytes | function
  developmentModel | function
  developmentHTML | function
  updateDevelopment | function
  developmentLogsHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {connectionMessage} from './connection.mjs';
const labels={idle:'',syncing:'同步源码',downloading:'下载运行环境',preparing:'准备运行环境',ready:'',testing:'测试中',building:'构建中',starting:'启动中',running:'运行中',stopped:'',error:'',conflict:'源码冲突'};
const /* @chain-region bytes | calls: toFixed */ bytes=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':(n/1024**2).toFixed(1)+' MB';
export /* @chain-region developmentModel | calls: includes, Math.max, Math.min, Math.floor, connectionMessage, bytes */ function developmentModel(value={}, {suppressError=false}={}){
 const busy=['syncing','downloading','preparing','testing','building','starting'].includes(value.state),running=value.state==='running',installed=!!value.downloaded;
 const update=installed&&!!value.cloud_revision&&!!value.revision&&value.cloud_revision!==value.revision;
 const total=value.state==='downloading'?value.total:value.count,done=value.state==='downloading'?value.received:value.completed;
 const fraction=value.state==='syncing'&&value.file_total>0?Math.max(0,Math.min(1,(value.file_received||0)/value.file_total)):0;
 const percent=busy&&total>0?Math.max(0,Math.min(100,Math.floor(((done||0)+fraction)/total*100))):null;
 const error=value.error&&!suppressError?connectionMessage({message:value.error}):'';
 const phase=error?((labels[value.failed_phase]||'')?labels[value.failed_phase]+' · '+error:error):((labels[value.state]||'')+(busy&&value.retrying?' · 重连中':''));
 const amount=busy&&total>0?(value.state==='downloading'?bytes(done||0)+' / '+bytes(total):(done||0)+' / '+total+(value.state==='syncing'&&value.file_total?' · '+bytes(value.file_received||0)+' / '+bytes(value.file_total):value.state==='syncing'&&value.page_received?' · 当前 '+bytes(value.page_received):'')):'';
 const primary=running?'stop':installed?'start':'download',primaryLabel=busy?(installed?'准备中':'下载中'):running?'停止':installed?'启动':value.error?'继续下载':'下载到本地';
 return {busy,running,installed,update,percent,phase,amount,error,primary,primaryLabel};
}
export /* @chain-region developmentHTML | calls: developmentModel, e, join, value.conflicts.map */ function developmentHTML(value={}, options={}){
 const m=developmentModel(value,options);
 return `<section class="development-card" aria-label="众创 OS" data-busy="${m.busy}" data-indeterminate="${m.busy&&m.percent===null}" style="--development-progress:${(m.percent||0)/100}" ${m.busy?'aria-busy="true"':''}>
 <div class="development-fill" aria-hidden="true"></div><div class="development-heading"><span class="development-mark" aria-hidden="true"><img src="halo.svg" alt=""><i></i></span><div class="development-title"><h2>众创 OS</h2><div class="development-status"><span role="status" class="development-state ${m.error?'development-error':''}">${e(m.phase)}</span><span class="development-amount">${e(m.amount)}</span></div></div><span class="development-percent" ${m.percent===null?'hidden':''}>${m.percent??0}<small>%</small></span><div class="actions"><button class="primary" data-development="${m.primary}" ${m.busy?'disabled':''}>${e(m.primaryLabel)}</button>${m.update?`<button class="secondary" data-development="download" ${m.busy||m.running?'disabled':''}>同步</button>`:''}</div></div>
 <div class="development-meter" ${m.busy?'':'hidden'} role="progressbar" aria-label="${e(m.phase)}" aria-valuemin="0" aria-valuemax="100" ${m.percent===null?'':`aria-valuenow="${m.percent}"`}></div>
 ${value.source_path||value.error?`<div class="development-footer">${value.source_path?`<button class="text-button" data-development="open-source" title="${e(value.source_path)}">源码目录 ↗</button>`:'<span></span>'}${value.downloaded||value.error?'<button class="text-button" data-action="development-logs">运行日志</button>':''}</div>`:''}${value.conflicts?.length?`<ul class="development-conflicts">${value.conflicts.map(item=>`<li>${e(item.path)}</li>`).join('')}</ul>`:''}</section>`;
}
// Transfer ticks change only text/attributes. The fill, icon and focused action keep their nodes.
export /* @chain-region updateDevelopment | calls: developmentModel, JSON.stringify, host.querySelector, developmentHTML, card.style.setProperty, String, card.querySelector, meter.setAttribute … */ function updateDevelopment(host,value,options={}){
 const m=developmentModel(value,options),key=JSON.stringify([m.busy,m.running,m.installed,m.update,!!m.error,m.primaryLabel,value.source_path,value.error,options.suppressError,value.conflicts]);
 if(host.__developmentShape!==key||!host.querySelector('.development-card')){host.innerHTML=developmentHTML(value,options);host.__developmentShape=key;}
 const card=host.querySelector('.development-card');card.style.setProperty('--development-progress',(m.percent||0)/100);card.dataset.indeterminate=String(m.busy&&m.percent===null);
 for(const [selector,text]of [['.development-state',m.phase],['.development-amount',m.amount]]){const node=card.querySelector(selector);if(node.textContent!==text)node.textContent=text;}
 const percent=card.querySelector('.development-percent');percent.hidden=m.percent===null;if(m.percent!==null){if(percent.firstChild.nodeValue!==String(m.percent))percent.firstChild.nodeValue=String(m.percent);}
 const meter=card.querySelector('.development-meter');meter.setAttribute('aria-label',m.phase);if(m.percent===null)meter.removeAttribute('aria-valuenow');else meter.setAttribute('aria-valuenow',m.percent);
}
export /* @chain-region developmentLogsHTML | calls: join, map, split, e */ function developmentLogsHTML(value,previous){
 return `<div class="development-logs">${(value.text||'暂无日志').split(/\r?\n/).map(line=>`<p title="${e(line)}">${e(line)||'&nbsp;'}</p>`).join('')}</div><nav class="pager" aria-label="运行日志分页"><button data-development-log="previous" ${previous?'':'disabled'}>上一页</button><button data-development-log="${value.next_offset??''}" ${value.next_offset===null?'disabled':''}>下一页</button></nav>`;
}
