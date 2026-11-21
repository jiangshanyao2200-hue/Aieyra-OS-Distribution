// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/showcase/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: prose; packageID; markup; make; surface; mountScene; setSampleState
// Impact: python -B scripts/code-atlas.py show Theme/showcase/fixtures.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {catalog} from '../contract/definition.mjs';
import {renderMarkdown} from '../runtime/markdown.mjs';
import {createThoughtView} from '../runtime/thinking.mjs';
import {bindThemeComponent,bindThemeRenderer,disposeThemeTree} from '../runtime/layout.mjs';
import {renderPackageDigest} from '../../Tool/presentation/desktop.mjs';
const prose='# 示例报告 · Sample report\n\n这是用于主题制作的合成内容。中文、English、数字 12345 与 **粗体**、*斜体*、`行内代码`。可选择文本并检查换行。\n\n> 引用保留原文和层级。\n\n| 项目 | 数量 |\n| --- | --- |\n| 示例 | 42 |\n\n```js\nconst greeting = "你好，世界";\nconsole.log(greeting);\n```\n\n- 第一项\n- 第二项\n\nhttps://example.invalid/this_is_a_long_word_used_to_check_wrapping_without_network_access';
const packageID='mod:showcase.example@'+'0'.repeat(64);
const markup={
 controls:`<section class="sample-card"><h2>按钮与输入</h2><div class="sample-row"><button class="pill primary" data-state-target>主要</button><button class="pill" data-state-target>次要</button><button class="quiet" data-state-target>轻量</button><button class="pill danger" data-state-target>危险</button><button class="pill" aria-label="新增示例" data-state-target>＋</button></div><div class="sample-grid"><label>文本<input class="field" value="可编辑的示例草稿" data-state-target></label><label>搜索<input class="field" type="search" placeholder="搜索示例" data-state-target></label><label>多行<textarea class="field" rows="3" data-state-target>中文 English\n第二行草稿</textarea></label><label>选择<select class="field" data-state-target><option>第一个选项</option><option>第二个选项</option></select></label><label>滑杆<input type="range" value="35" data-state-target></label><label>颜色<input type="color" value="#7799cc" data-state-target></label><label>文件<input type="file" data-state-target></label></div><div class="sample-row"><label><input type="checkbox" data-state-target>复选框</label><label><input type="radio" name="sample-radio" data-state-target>单选一</label><label><input type="radio" name="sample-radio" data-state-target>单选二</label><button class="pill" role="switch" aria-checked="false" data-state-target>开关</button><kbd>Ctrl + Enter</kbd><a href="#sample-controls">链接示例</a></div></section><section class="sample-card"><h2>反馈</h2><p role="status" data-state-target>状态示例</p><progress max="100" value="42" aria-label="示例进度"></progress><hr><p>通过外层状态选择器检查禁用、只读、勾选和执行状态。悬停、焦点及按下由实际指针和键盘触发。</p></section>`,
 conversation:`<section id="conversation"><div id="conversation-content"><article class="chat-entry eyra"><div class="role-ring" aria-label="Eyra 示例头像"></div><div class="chat-main"><strong class="chat-name">Eyra · 示例</strong><div class="chat-text"></div></div></article><article class="chat-entry user"><div class="chat-main"><strong class="chat-name">用户 · 示例</strong><div class="chat-text"><p>保留我的草稿和阅读位置。</p></div></div></article></div><div id="thought-stream" class="thought-stream"></div></section><section id="input-dock"><div id="composer"><label>示例草稿<textarea id="message" class="field" rows="3">切换主题后，这段未发送文字应保留。</textarea></label><button class="pill" type="button">示例发送</button></div></section><section class="sample-card" id="emergence"><div class="presence-header">Cota 与 Vaya · 并行角色示例</div><div class="sample-row"><span class="role-ring" aria-label="Cota 示例头像"></span><span class="role-ring" aria-label="Vaya 示例头像"></span></div><p class="sample-history">历史正文示例：较小、较灰，仍可阅读。</p></section>`,
 tools:`<section id="stage"><article class="stage-pane sample-card"><header class="stage-head"><strong>工具结果 · 示例</strong><span class="stage-state" data-state-target>已完成</span></header><div class="stage-body"></div></article></section><section class="sample-card"><h2>只读终端</h2><div class="sample-terminal"></div><div class="patch-files"><h3>example.txt</h3><pre class="patch-diff">- old value\n+ new value</pre></div></section><section id="task-plan" class="sample-card"></section>`,
 media:`<section class="sample-card" id="image-album"><h2>媒体与附件</h2><p>打开示例后可操作缩放、播放和定位。所有内容均为内存样例。</p><div class="sample-row"><button class="pill" data-open-image>查看图片</button><button class="pill" data-open-media>查看静音音频</button></div><div class="chat-artifacts"></div><div class="sample-attachments"></div></section>`,
 system:`<section class="sample-card"><h2>导航与浮层</h2><nav aria-label="示例导航"><button class="pill">返回</button> / 资源 / 示例</nav><nav class="sample-row" role="tablist" aria-label="示例标签"><button class="pill" role="tab" aria-selected="true" data-state-target>概览</button><button class="pill" role="tab" aria-selected="false">记录</button></nav><ul role="tree" aria-label="文件示例"><li role="treeitem" tabindex="0" aria-expanded="true" data-state-target>示例目录<ul role="group"><li role="treeitem">example.txt</li></ul></li></ul><div class="surface-card"><p>卡片与分栏示例</p></div><div class="surface-menu module-dock-menu" role="menu" aria-label="菜单示例"><button role="menuitem" class="pill">打开示例</button><button role="menuitem" class="pill">返回示例</button></div><p id="tip" role="tooltip">提示内容示例</p><div class="sample-row"><button class="pill" data-open-dialog>打开对话框</button><button class="pill" popovertarget="sample-popover">打开浮层</button></div><dialog class="sample-dialog"><h2>确认示例</h2><p>此处没有真实操作。</p><form method="dialog"><button class="pill">关闭</button></form></dialog><div id="sample-popover" class="surface-card" popover>浮层示例</div></section><section class="sample-card notice-panel"><header>通知与用量</header><ul class="notice-list"><li data-state-target>示例通知</li></ul><p id="usage-anchor">输入 1200 · 输出 80 · 缓存未知（示例）</p><div class="account-panel">权限与账号示例 · 未连接</div><div class="apps-panel">应用列表 · 示例</div></section><section class="sample-card" id="session-drawer"><h2>会话列表</h2><div class="sd-list"><button class="sd-row pill" data-state-target>示例会话</button></div></section>`
};
function make(doc,selector){
 const first=selector.split(',')[0].replace(/^:scope > /,'');
 const node=doc.createElement(first.startsWith('#')||first.startsWith('.')?'div':first);
 if(first.startsWith('#'))node.id=first.slice(1);else if(first.startsWith('.'))node.className=first.slice(1);
 return node;
}
function surface(doc,host,name){
 const spec=catalog.surfaces[name],root=spec.root==='body'?host:make(doc,spec.root||'article');
 if(root!==host)host.append(root);const slots={};
 for(const [key,selector]of Object.entries(spec.slots)){const node=make(doc,selector);node.classList.add('sample-slot');node.textContent=key+' · 示例内容';slots[key]=node;root.append(node);}
 if(name==='native-shell'){const title=doc.createElement('strong');title.textContent='示例窗口标题';slots.title.replaceChildren(title);}
 if(name==='extension')slots.heading.innerHTML='<strong>示例扩展标题</strong><nav class="window-controls"><button class="pill">关闭示例</button></nav>';
 if(name==='presence')doc.body.dataset.eyraPlacement='compact';
 if(name==='conversation'){const messages=doc.createElement('div');messages.id='conversation-messages';messages.textContent='独立会话消息示例';slots.history.append(messages);}
 if(name==='activity-rail'){const activity=doc.createElement('button');activity.className='extension-orb pill';activity.textContent='示例任务';slots.activity.append(activity);}
 if(spec.component)bindThemeComponent(root,name,slots);
 return ()=>{delete doc.body.dataset.eyraPlacement;};
}
export function mountScene(doc,host,id,adapters={}){
 const disposers=[];host.dataset.scene=id;
 if(id.startsWith('surface:'))disposers.push(surface(doc,host,id.slice(8)));
 else {if(!Object.hasOwn(markup,id))throw Error('未知展示场景');host.innerHTML=markup[id];}
 if(id==='conversation'){
  const message=host.querySelector('.chat-entry'),main=message.querySelector('.chat-main');renderMarkdown(main.querySelector('.chat-text'),prose);
  bindThemeComponent(message,'message',{avatar:message.querySelector('.role-ring'),content:main});
  const thought=createThoughtView({doc,reduced:()=>doc.body.classList.contains('reduce-motion'),motion:adapters.motion});thought.attach(host.querySelector('#thought-stream'));thought.update('**示例可见思考**\n这里展示组件的排版和动画，不是实际模型输出。');disposers.push(()=>thought.detach());
 }
 if(id==='tools'){
  const pane=host.querySelector('.stage-pane'),body=pane.querySelector('.stage-body');
  body.append(renderPackageDigest(doc,{state:'completed',preview:{package:packageID,presentation:{kind:'table',title:'示例统计',columns:[{key:'metric',label:'指标'},{key:'value',label:'数值'}]},data:{output:[{type:'text',text:JSON.stringify([{metric:'数量',value:42},{metric:'合计',value:126}])}]}}},{present:bindThemeRenderer}));
  bindThemeComponent(pane,'tool',{heading:pane.querySelector('.stage-head'),body});
  host.querySelector('#task-plan').append(renderPackageDigest(doc,{preview:{package:packageID,data:{schema:'aieyra.workbox-state/1',id:'sample',title:'示例工作流',state:'paused',steps:[{id:'读取',state:'completed',result:{count:42}},{id:'审阅',state:'waiting'},{id:'写入',state:'pending'}]}}},{present:bindThemeRenderer}));
  disposers.push(adapters.terminal?.(host.querySelector('.sample-terminal')));
 }
 if(id==='media')disposers.push(adapters.media?.(host));
 if(id==='system')host.querySelector('[data-open-dialog]').onclick=()=>host.querySelector('dialog').showModal();
 for(const button of host.querySelectorAll('[role=switch]'))button.onclick=()=>button.setAttribute('aria-checked',String(button.getAttribute('aria-checked')!=='true'));
 return {dispose(){for(const fn of disposers)fn?.();disposeThemeTree(host);host.replaceChildren();}};
}
export function setSampleState(doc,value){
 for(const node of doc.querySelectorAll('[data-state-target]')){
  for(const name of ['aria-selected','aria-expanded','aria-busy','readonly','disabled','data-state'])node.removeAttribute(name);
  if('checked'in node)node.checked=value==='checked';
  if(node.getAttribute('role')==='switch')node.setAttribute('aria-checked',String(value==='checked'));
  if(value==='disabled'&&node.matches('button,input,select,textarea'))node.disabled=true;
  if(value==='readonly'&&node.matches('input:not([type=checkbox],[type=radio],[type=range],[type=color]),textarea'))node.readOnly=true;
  if(node.matches('[role=tab]'))node.setAttribute('aria-selected',String(value==='selected'));
  if(value==='expanded'&&node.matches('button,[role=treeitem]'))node.setAttribute('aria-expanded','true');
  if(value==='busy'||value==='loading')node.setAttribute('aria-busy','true');
  if(['failed','cancelled','running','unknown','empty','dragging','stale','offline','completed'].includes(value))node.dataset.state=value;
 }
}
