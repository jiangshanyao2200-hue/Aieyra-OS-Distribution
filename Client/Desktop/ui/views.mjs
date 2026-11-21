// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: planView; el; dataOf; lines; valueText; terminalPreview; stateLabels; activityHeading; compactActivity; toolView; updateLiveText; terminals; clearTerminal; renderTerminal; reconcileNode; renderScene; messageView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/views.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {createPlanView,createPlanSteps} from '../../../Tool/base/official/update_plan/presentation/desktop.mjs';
const planView=createPlanView({el});
import {activityDigest,renderDigest} from './tool-digest.mjs';
import { renderMarkdown } from './markdown.mjs';
import { brief, cleanTerminal, sceneKind, roles } from './model.mjs';
import { activityData, activityLabel, activityOutcome, planData } from './activity.mjs';
import {terminalSummary} from './experience.mjs';
import {trimScrollFragments,retireNode,retainNode} from './scroll-edges.mjs';

export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function dataOf(item) {
  return activityData(item);
}
function lines(root, rows) {
  for (const row of rows || []) {
    const added=['add','+','insert'].includes(row.kind),removed=['delete','-','remove'].includes(row.kind);
    const line = el('div', undefined, 'code-line'),
      number = el(
        'span',
        String(row.line ?? (removed?row.old_line:row.new_line) ?? row.new ?? row.old_line ?? ''),
        'line-number',
      );
    line.append(number, el('span',added?'+':removed?'−':'','diff-marker'), el('span', row.text || ''));
    if (added)
      line.classList.add('diff-add');
    if (removed)
      line.classList.add('diff-delete');
    root.append(line);
  }
}
function valueText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

// 实时预览使用核心已提供的内容；主动展开后再按需读取原始完整收据。
function terminalPreview(item,data) {
  if(data.output!==undefined)return valueText(data.output);
  if(data.text!==undefined)return valueText(data.text);
  const outcome=activityOutcome(item);if(outcome)return outcome;
  if(Array.isArray(data.lines))return data.lines.map(line=>String(line.text??'')).join('\n');
  const files=(item.patch||data).files;
  if(Array.isArray(files)&&files.some(file=>Array.isArray(file.hunks)))return files.map(file=>[file.path,...(file.hunks||[]).flatMap(hunk=>(hunk.lines||[]).map(line=>(['add','+','insert'].includes(line.kind)?'+ ':['delete','-','remove'].includes(line.kind)?'- ':'  ')+(line.text||'')))].join('\n')).join('\n\n');
  if(Array.isArray(data.matches))return data.matches.map(match=>[match.path,match.line].filter(value=>value!==undefined).join(':')+' '+(match.text||'')).join('\n');
  if(Array.isArray(data.entries))return data.entries.map(entry=>entry.name+(entry.directory?'/':'')).join('\n');
  if(data.snapshot?.text)return String(data.snapshot.text);
  return '';
}

const stateLabels={queued:'等待',running:'进行中',completed:'完成',failed:'未完成',cancelled:'已停止',timed_out:'超时',interrupted:'已中断',interrupted_unknown:'已中断',persistence_failed:'未保存'};
function activityHeading(item,tag='header') {
  const heading=el(tag,undefined,'tool-heading');
  const label=item.tool==='update_plan'?'更新计划':activityLabel(item);
  heading.append(el('strong',label),el('span',stateLabels[item.state]||'','tool-state'));
  return heading;
}
function compactActivity(item) {
  const data=dataOf(item),kind=sceneKind(item),error=activityOutcome(item);
  const contentKinds=['reader','editor','search','browser','map','table','cards'];
  const hasContent=kind==='reader'?data.lines?.length:kind==='editor'?(item.patch||data).files?.length:
    kind==='search'?data.matches?.length:kind==='browser'?((data.snapshot||data).text||(data.snapshot||data).results?.length):
    kind==='map'?data.entries?.length:contentKinds.includes(kind);
  if(item.tool==='update_plan'&&item.state==='completed'&&data.ok!==false&&planData(item).steps.length)return planView(item);
  // 没有专门画面的工具（文档、设置、记忆……）也要能看详情。
  const digest=!hasContent&&!error&&activityDigest(item),hasDigest=digest&&(digest.facts.length||digest.sections.length);
  const root=el(hasContent||hasDigest?'details':'section',undefined,'tool-view '+(hasContent||hasDigest?'tool-disclosure':'tool-row'));
  root.dataset.tool=item.tool;root.dataset.callId=item.id;root.dataset.state=item.state;
  root.append(activityHeading(item,hasContent||hasDigest?'summary':'header'));
  if(hasDigest){const content=el('div',undefined,'activity-content');content.append(renderDigest(document,item));root.append(content);return root;}
  if(hasContent) {
    const full=toolView(item),content=el('div',undefined,'activity-content');
    for(const node of [...full.children].slice(1))if(!node.classList.contains('tool-label'))content.append(node);
    root.append(content);
  } else if(error)root.append(el('p',error,'activity-outcome'+(item.state==='failed'||data.ok===false?' error':'')));
  else if(kind==='search'&&item.state==='completed')root.append(el('small','未找到匹配内容','activity-outcome'));
  return root;
}

export function toolView(item, { compact = false } = {}) {
  if(compact)return compactActivity(item);
  const root = el('section', undefined, 'tool-view'),
    data = dataOf(item),
    kind = sceneKind(item);
  root.dataset.tool = item.tool;
  root.dataset.callId = item.id;
  const heading = el('header', undefined, 'tool-heading');
  heading.append(el('strong', brief(item)), el('span', { queued: '等待', running: '进行中', completed: '完成', failed: '失败', cancelled: '已停止', timed_out: '超时', interrupted_unknown: '已中断' }[item.state] || item.state, 'tool-state'));
  root.append(heading);
  if (item.tool === 'update_plan' && planData(item).steps.length) {
    root.append(createPlanSteps(planData(item).steps,{el}));
  } else if (kind === 'table' || kind === 'cards') {
    root.append(el('p', item.presentation?.title || brief(item), 'tool-label'));
    const rows = Array.isArray(data) ? data : data.rows || [];
    const columns = item.presentation?.columns || [];
    if (kind === 'table') {
      const table = el('table'),
        head = el('tr');
      for (const column of columns) head.append(el('th', column.label));
      table.append(head);
      for (const value of rows.slice(0, 200)) {
        const row = el('tr');
        for (const column of columns)
          row.append(el('td', valueText(value[column.key] ?? '')));
        table.append(row);
      }
      root.append(table);
    } else
      for (const value of rows.slice(0, 200)) {
        const card = el('div', undefined, 'result-card');
        for (const column of columns)
          card.append(
            el('strong', column.label),
            el('p', valueText(value[column.key] ?? '')),
          );
        root.append(card);
      }
  } else if (kind === 'terminal') {
    root.classList.add('terminal-call');
    root.append(
      el(
        'div',
        '› ' + (item.command || data.cmd || brief(item)),
        'terminal-command',
      ),
    );
    root.append(
      el(
        'pre',
        cleanTerminal(
          data.output ||
            data.text ||
            item.detail ||
            (['running', 'queued'].includes(item.state) ? '等待输出…' : ''),
        ),
        'terminal-output',
      ),
    );
    if (data.truncated)
      root.append(el('small', '输出已截断，完整内容见记录。'));
  } else if (kind === 'reader') {
    root.append(
      el('p', data.path || item.targets?.[0] || '内容', 'tool-label'),
    );
    const code = el('div', undefined, 'code-lines');
    lines(code, data.lines);
    root.append(code);
    if(!data.lines?.length)root.append(el('pre',cleanTerminal(terminalPreview(item,data)),'explore-output'));
    if (data.has_more)
      root.append(el('small', '后面还有 · 从第 ' + data.next_line + ' 行接着看'));
  } else if (kind === 'search') {
    root.append(
      el(
        'p',
        '搜索 · ' + (data.query || item.targets?.[0] || ''),
        'tool-label',
      ),
    );
    for (const match of data.matches || []) {
      const row = el('div', undefined, 'result-card');
      row.append(
        el('strong', match.path + ':' + match.line),
        el('p', match.text),
      );
      root.append(row);
    }
    if (!data.matches?.length)
      root.append(
        el(
          'p',
          cleanTerminal(terminalPreview(item,data)) || (['running', 'queued'].includes(item.state)
            ? '搜索中…'
            : Array.isArray(data.matches)?'暂无结果':stateLabels[item.state]||''),
          'explore-output',
        ),
      );
    if (data.has_more)
      root.append(el('small', '后面还有结果，位置已经记住了。'));
  } else if (kind === 'editor') {
    const patch = item.patch || data;
    for (const file of patch.files || []) {
      root.append(el('p', file.path, 'tool-label'));
      for (const hunk of file.hunks || []) {
        const code = el('div', undefined, 'code-lines');
        lines(code, hunk.lines);
        root.append(code);
      }
    }
    if (!patch.files?.length)
      root.append(
        el(
          'p',
          cleanTerminal(terminalPreview(item,data)) ||
            (['queued','running'].includes(item.state)?'正在读取补丁详情…':stateLabels[item.state]||'未提供差异预览'),
        ),
      );
    if (patch.omitted_lines || patch.omitted_files)
      root.append(el('small', '部分差异已收录到完整调用记录。'));
  } else if (kind === 'browser') {
    const snapshot = data.snapshot || data;
    root.append(
      el('p', snapshot.url || item.targets?.[0] || '页面', 'tool-label'),
    );
    if (snapshot.title) root.append(el('h3', snapshot.title));
    for (const result of snapshot.results || []) {
      const row = el('div', undefined, 'result-card');
      row.append(
        el('strong', result.title || result.url),
        el('p', result.snippet || result.text || ''),
      );
      root.append(row);
    }
    root.append(
      el(
        'pre',
        typeof snapshot.text === 'string' ? snapshot.text : '',
      ),
    );
  } else if (kind === 'map') {
    root.append(el('p', data.path || '项目结构', 'tool-label'));
    for (const entry of data.entries||[])
      root.append(
        el('div', (entry.directory ? '▱  ' : '   ') + entry.name, 'code-lines'),
      );
    if(!data.entries?.length)root.append(el('pre',cleanTerminal(terminalPreview(item,data)),'explore-output'));
  } else if (item.tool === 'team') {
    root.append(el('p', brief(item), 'tool-label'));
    if (data.result) root.append(el('p', data.result));
    else if (data.evidence) root.append(el('p', data.evidence));
    else
      root.append(
        el(
          'p',
          data.state === 'running'
            ? '正在处理 ' + (roles[data.title] || data.title || '任务')
            : data.verdict === 'accepted'
              ? '已完成'
              : (data.error || data.state || '未返回任务状态'),
        ),
      );
  } else {
    heading.replaceWith(activityHeading(item));
    const outcome=activityOutcome(item);if(outcome)root.append(el('p',outcome,'activity-outcome'));
  }
  if (['failed', 'timed_out', 'interrupted', 'persistence_failed'].includes(item.state)) {
    root.append(
      el('p', activityOutcome(item), 'error'),
    );
  }
  return root;
}

// Preserve live text nodes between polls and append real deltas without replay.
export function updateLiveText(root, text) {
  if (root.textContent === text) return;
  const node = root.firstChild;
  if (node?.nodeType === 3 && root.childNodes.length === 1) {
    if (text.startsWith(node.data)) node.appendData(text.slice(node.length));
    else node.data = text;
  } else root.textContent = text;
}

// 已展开的收据属于阅读区，当前调用另占空间；轮询不夺走选择或滚动位置。
const terminals=new WeakMap();
export function clearTerminal(root) {
  const view=terminals.get(root);if(view?.timer)clearTimeout(view.timer);if(view)view.disposed=true;
  if(view?.followFrame)cancelAnimationFrame(view.followFrame);
  view?.layoutObserver?.disconnect();
  terminals.delete(root);root.replaceChildren();root.dataset.presenting='false';root.dataset.reading='false';root.dataset.animating='false';
}
export function renderTerminal(root,items,key,active,{loadDetail,readingItems=items,onChange,capacity=innerHeight<620?2:3,selectedKey='',selectedKeys=[],continuous=false,onSelectionChange}={}) {
  let view=terminals.get(root);
  if(!view){
    const reading=el('div',undefined,'terminal-reading'),current=el('div',undefined,'terminal-current');
    reading.setAttribute('aria-label','正在阅读的调用');current.setAttribute('aria-label','实时调用');
    view={key,rows:new Map(),closed:new Set(),timer:0,reading,current,disposed:false,followCurrent:true};terminals.set(root,view);root.replaceChildren(reading,current);
    current.addEventListener('scroll',()=>{view.followCurrent=current.scrollHeight-current.clientHeight-current.scrollTop<24;},{passive:true});
    // 只在布局发生变化时跟随当前调用；阅读区的选择和滚动位置保持不动。
    view.followLatest=()=>{if(view.disposed||view.followFrame||!view.followCurrent)return;view.followFrame=requestAnimationFrame(()=>{view.followFrame=0;if(view.disposed||!view.followCurrent)return;view.current.scrollTop=view.current.scrollHeight;trimScrollFragments(view.current);});};
    view.layoutObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(view.followLatest);view.layoutObserver?.observe(current);
  }
  view.loadDetail=loadDetail;
  view.onChange=onChange;
  view.continuous=continuous;root.dataset.continuous=String(continuous);
  if(view.key!==key){view.key=key;view.closed.clear();view.followCurrent=true;}
  const identity=item=>item.key||item.id;
  const recent=items.filter(item=>!view.closed.has(identity(item))).slice(-capacity),known=new Set(recent.map(identity));
  view.currentOrder=recent.map(identity);
  const remove=row=>retireNode(row.node,()=>{view.layoutObserver?.unobserve(row.node);if(view.rows.get(row.id)===row)view.rows.delete(row.id);syncRegions();});
  const paintRow=row=>{
    const running=['queued','running'].includes(row.item.state),open=row.manual||!row.collapsed&&(running||view.continuous&&known.has(row.id)||performance.now()<row.until);
    row.node.classList.toggle('summarized',!open);row.node.dataset.reading=String(row.manual);
    row.summary.setAttribute('aria-expanded',String(open));row.close.hidden=!open;
    row.raw.hidden=row.special&&!row.manual;
    row.rawLabel.hidden=!row.special;
    row.navigation.hidden=!row.manual||!row.page&&!row.nextCursor&&!row.receiptError;
    row.back.disabled=row.fetching||!row.page;row.forward.disabled=row.fetching||!row.nextCursor;row.retry.hidden=!row.receiptError;row.retry.disabled=!!row.fetching;
    updateLiveText(row.pageLabel,'第 '+(row.page+1)+' 段');
    if(open)trimScrollFragments(row.detail);
  };
  const syncRegions=()=>{
    if(view.disposed)return;
    // 容量增大或详情关闭后，回到当前区的旧条目仍按原调用顺序排列。
    let previous=null;
    for(const id of view.currentOrder){const row=view.rows.get(id);if(!row||row.manual||row.retired)continue;let next=previous?previous.nextElementSibling:view.current.firstElementChild;while(next?.classList.contains('retiring'))next=next.nextElementSibling;if(next!==row.node)view.current.insertBefore(row.node,next);previous=row.node;}
    view.reading.hidden=![...view.rows.values()].some(row=>row.manual);
    root.dataset.reading=String(!view.reading.hidden);
    root.dataset.presenting=String([...view.rows.values()].some(row=>!row.collapsed&&(row.manual||['queued','running'].includes(row.item.state)||performance.now()<row.until)));
    root.dataset.animating=String([...view.rows.values()].some(row=>row.node.classList.contains('retiring')||!row.manual&&!row.collapsed&&performance.now()<row.until));
    const signature=[...view.rows.values()].filter(row=>row.node.isConnected).length+':'+root.dataset.reading+':'+root.dataset.presenting;
    if(view.signature!==signature){view.signature=signature;view.onChange?.();}
    trimScrollFragments(view.reading);trimScrollFragments(view.current);
    view.followLatest();
  };
  const readDetail=row=>{
    if(!view.loadDetail||!row.manual||view.disposed)return;
    row.receiptRequested=true;
    if(row.fetching){row.detailDirty=true;return;}
    const ticket=++row.detailRequest,version=row.detailVersion,item=row.item,cursor=row.cursors[row.page]||{input_offset:0,output_offset:0};row.fetching=true;row.detailDirty=false;row.receiptError=false;row.detail.setAttribute('aria-busy','true');updateLiveText(row.state,'正在读取原始收据…');paintRow(row);
    Promise.resolve().then(()=>view.loadDetail(item,cursor)).then(full=>{
      if(view.disposed||ticket!==row.detailRequest||version!==row.detailVersion||!row.manual||!full)return;
      const data=full.preview||full,input=full.input??data.input,output=full.output??data.output??data.text;
      if(input!==undefined)updateLiveText(row.command,input?'› '+cleanTerminal(typeof input==='string'?input:JSON.stringify(input,null,2)):'');
      if(output!==undefined)updateLiveText(row.output,cleanTerminal(typeof output==='string'?output:JSON.stringify(output,null,2)));
      row.command.hidden=!row.command.textContent;row.output.hidden=!row.output.textContent;row.fullLoaded=true;
      row.nextCursor=full.next_input||full.next_output?{input_offset:full.next_input||full.input_size||0,output_offset:full.next_output||full.output_size||0}:null;
      if(row.pageChanged){row.detail.scrollTop=0;row.pageChanged=false;}
      updateLiveText(row.state,row.stateText);trimScrollFragments(row.detail);
    }).catch(error=>{if(!view.disposed&&ticket===row.detailRequest&&version===row.detailVersion&&row.manual){row.receiptError=true;updateLiveText(row.state,'收据暂未读到：'+error.message);}}).finally(()=>{row.fetching=false;row.detail.setAttribute('aria-busy','false');if(view.disposed)return;paintRow(row);if(row.manual&&(row.detailDirty||version!==row.detailVersion))readDetail(row);});
  };
  for(const row of view.rows.values()){
    row.retired=!known.has(row.id);
    if(row.retired&&!row.manual)remove(row);
  }
  // 主动阅读的条目仍更新真实执行态，不因退出最近三条而停止接收输出。
  const selected=new Map(recent.map(item=>[identity(item),item]));
  const readingKeys=new Set(selectedKey?[selectedKey,...selectedKeys]:[]);
  for(const row of view.rows.values())if(row.manual&&!readingKeys.has(row.id)){
    row.manual=false;row.collapsed=false;row.detailRequest++;
    if(row.retired)remove(row);else{view.current.append(row.node);paintRow(row);}
  }
  for(const item of readingItems)if(readingKeys.has(identity(item)))selected.set(identity(item),item);
  for(const [id,item] of selected){
    const data=dataOf(item);let row=view.rows.get(id);
    if(!row){
      const node=el('section',undefined,'terminal-entry'),head=el('div',undefined,'transcript-head'),summary=el('button',undefined,'transcript-summary quiet'),close=el('button','×','quiet transcript-close');
      const detail=el('div',undefined,'transcript-detail soft-scroll'),command=el('pre',undefined,'transcript-command'),output=el('pre',undefined,'transcript-output'),state=el('span',undefined,'transcript-state');
      const visual=el('div',undefined,'tool-presentation'),raw=el('details',undefined,'raw-receipt'),rawLabel=el('summary','原始输入与输出');
      const navigation=el('nav',undefined,'receipt-navigation'),back=el('button','上一段','quiet'),forward=el('button','下一段','quiet'),retry=el('button','重新读取','quiet'),pageLabel=el('span',undefined,'receipt-page');
      navigation.setAttribute('aria-label','调用收据分页');navigation.append(back,forward,retry,pageLabel);navigation.hidden=true;
      command.setAttribute('aria-label','真实调用输入');output.setAttribute('aria-label','真实调用输出');close.setAttribute('aria-label','关闭调用详情');
      raw.append(rawLabel,command,output,navigation);detail.tabIndex=0;detail.append(visual,raw);head.append(summary,close);node.append(head,detail,state);node.dataset.callId=item.id;
      row={id,node,summary,close,detail,command,output,state,visual,raw,rawLabel,navigation,back,forward,retry,pageLabel,page:0,cursors:[{input_offset:0,output_offset:0}],manual:false,collapsed:false,item,until:performance.now()+900,follow:true,detailRequest:0,detailVersion:0};view.rows.set(id,row);view.current.append(node);
      view.layoutObserver?.observe(node);
      back.onclick=()=>{if(row.fetching||!row.page)return;row.page--;row.fullLoaded=false;row.pageChanged=true;readDetail(row);};
      forward.onclick=()=>{if(row.fetching||!row.nextCursor)return;row.cursors[++row.page]=row.nextCursor;row.fullLoaded=false;row.pageChanged=true;readDetail(row);};
      retry.onclick=()=>{row.page=0;row.cursors=[{input_offset:0,output_offset:0}];row.pageChanged=true;readDetail(row);};
      detail.addEventListener('scroll',()=>{row.follow=detail.scrollHeight-detail.scrollTop-detail.clientHeight<24;trimScrollFragments(detail);},{passive:true});
      summary.onclick=()=>{
        if(row.manual&&row.grouped){if(!row.fullLoaded&&!row.fetching)readDetail(row);row.raw.open=true;return;}
        if(row.manual){close.click();return;}
        onSelectionChange?.(id);
        retainNode(row.node);row.manual=true;row.collapsed=false;view.reading.append(row.node);paintRow(row);syncRegions();
        if(!row.fullLoaded)readDetail(row);
      };
      close.onclick=()=>{
        onSelectionChange?.('');
        row.manual=false;row.collapsed=true;row.until=0;row.detailRequest++;
        if(row.retired){view.closed.add(id);remove(row);}else{view.current.append(row.node);paintRow(row);}
        syncRegions();
      };
      rawLabel.addEventListener('click',()=>{if(row.manual&&row.grouped&&!row.fullLoaded&&!row.fetching)readDetail(row);});
      if(!document.body.classList.contains('reduce-motion')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)node.animate?.([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});
    }
    retainNode(row.node);row.item=item;row.retired=!known.has(id);
    const kind=sceneKind(item),special=['reader','search','map','editor'].includes(kind);
    if(row.special!==special){row.raw.open=!special;row.special=special;}
    row.visual.hidden=!special;row.node.dataset.kind=kind;
    if(special){
      const fingerprint=JSON.stringify([kind,item.patch,data,item.targets,item.state]);
      if(row.visualFingerprint!==fingerprint){const next=toolView(item);if(row.visual.firstElementChild)reconcileNode(row.visual.firstElementChild,next);else row.visual.append(next);row.visualFingerprint=fingerprint;}
    }
    updateLiveText(row.summary,terminalSummary(item));const title=activityLabel(item)+' · 展开输入和输出';if(row.summary.title!==title)row.summary.title=title;
    const command=item.input||(item.tool==='exec_command'?(item.command||data.cmd):'')||[item.tool,item.action,...item.targets||[]].filter(Boolean).join(' ');
    const output=terminalPreview(item,data);
    const target=cleanTerminal(typeof output==='string'?output:JSON.stringify(output,null,2));
    const detailFingerprint=JSON.stringify([item.revision,item.state,item.detail,command,target]),changed=row.detailFingerprint!==detailFingerprint;
    if(changed){row.detailFingerprint=detailFingerprint;row.detailVersion++;row.fullLoaded=false;}
    if(row.target!==target){row.target=target;if(!row.manual||!view.loadDetail)updateLiveText(row.output,target);if(!row.manual&&!row.collapsed)row.until=performance.now()+900;}
    if(!row.fullLoaded&&(!row.manual||!view.loadDetail)){updateLiveText(row.command,command?'› '+cleanTerminal(command):'');row.command.hidden=!command;row.output.hidden=!target;}
    const state=item.state&&item.state!=='completed'?(stateLabels[item.state]||item.state):item.exit_code!==undefined&&item.exit_code!==0?'退出码 '+item.exit_code:'';
    row.stateText=state;
    if(!row.fetching&&!row.receiptError)updateLiveText(row.state,[state,data.truncated&&!row.fullLoaded?'当前为输出预览':''].filter(Boolean).join(' · '));
    row.node.dataset.state=item.state;row.node.dataset.streaming=String(['running','queued'].includes(item.state));
    if(!row.manual&&row.node.parentElement!==view.current)view.current.append(row.node);
    row.grouped=readingKeys.size>1;
    const opened=readingKeys.has(id)&&!row.manual;
    if(opened){
      row.manual=true;row.collapsed=false;view.reading.append(row.node);
    }
    paintRow(row);
    if((changed||opened)&&row.manual&&(id===selectedKey||row.fullLoaded||row.receiptRequested)) {row.receiptRequested=true;readDetail(row);}
    if(row.follow&&!row.manual)row.detail.scrollTop=row.detail.scrollHeight;
  }
  const schedule=()=>{if(view.timer)clearTimeout(view.timer);view.timer=0;const until=[...view.rows.values()].filter(row=>!row.manual&&!row.collapsed&&row.until>performance.now()).map(row=>row.until);if(until.length)view.timer=setTimeout(()=>{view.timer=0;if(view.disposed)return;for(const row of view.rows.values())paintRow(row);syncRegions();schedule();},Math.max(1,Math.min(...until)-performance.now()+1));};
  syncRegions();schedule();
  return [...view.rows.values()].filter(row=>row.node.isConnected).length;
}

function reconcileNode(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next);
    return;
  }
  if (current.nodeType === 3) {
    if (current.data !== next.data) {
      if (next.data.startsWith(current.data)) current.appendData(next.data.slice(current.length));
      else current.data = next.data;
    }
    return;
  }
  for (const attr of [...current.attributes])
    if (!next.hasAttribute(attr.name) && !(current.nodeName === 'DETAILS' && attr.name === 'open')) current.removeAttribute(attr.name);
  for (const attr of next.attributes)
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  const children = [...next.childNodes];
  for (let i = 0; i < children.length; i++) {
    if (current.childNodes[i]) reconcileNode(current.childNodes[i], children[i]);
    else current.append(children[i]);
  }
  while (current.childNodes.length > children.length) current.lastChild.remove();
}

export function renderScene(root, kind, items, onInspect) {
  const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 40,
    scroll = root.scrollTop;
  if (root.dataset.kind !== kind) root.replaceChildren();
  root.dataset.kind = kind;
  const existing = new Map([...root.children].map((node) => [node.dataset.sceneKey, node]));
  const keep = new Set();
  items.forEach((item, index) => {
    const key = item.key || item.id;
    const prior = existing.get(key);
    const revision=String(item.revision)+':'+item.generation+':'+item.state;
    if (prior && item.revision !== undefined && prior.dataset.renderRevision === revision) {
      if (root.children[index] !== prior) root.insertBefore(prior, root.children[index] || null);
      keep.add(prior); return;
    }
    const next = kind === 'batch' ? el('button', activityLabel(item), 'batch-row') : toolView(item, { compact: kind!=='detail' });
    next.dataset.sceneKey = key;
    if (item.revision !== undefined) next.dataset.renderRevision = revision;
    let node = existing.get(key) || next;
    // A reused receipt identity may change presentation (disclosure -> failure).
    // Keep the actual replacement, never reinsert the now-detached old element.
    if(node!==next&&node.nodeName!==next.nodeName){node.replaceWith(next);node=next;}
    else if (node !== next) reconcileNode(node, next);
    if (kind === 'batch') node.onclick = () => onInspect(item);
    if (root.children[index] !== node) root.insertBefore(node, root.children[index] || null);
    keep.add(node);
  });
  for (const node of [...root.children]) if (!keep.has(node)) node.remove();
  root.scrollTop = kind === 'terminal' && atBottom ? root.scrollHeight : scroll;
}

export function messageView(message) {
  const root = el(
    'article',
    undefined,
    'message-card ' + (message.from === 'user' ? 'user' : ''),
  );
  root.dataset.messageId = message.id;
  const content=el('div');renderMarkdown(content,message.text);
  root.append(el('div', roles[message.from] || '你', 'author'),content);
  if (message.error) root.append(el('p', message.error, 'error'));
  if (['queued', 'interrupted', 'failed'].includes(message.state))
    root.append(
      el(
        'div',
        {
          queued: '排队中',
          interrupted: '已中断，未重试',
          failed: '未完成',
        }[message.state],
        'message-state',
      ),
    );
  return root;
}
