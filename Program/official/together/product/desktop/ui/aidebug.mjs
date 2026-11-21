/* @file-map:start
文件: link/desktop/ui/aidebug.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/index.html
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  paint | function
  command | function
  onclick | handler
  onclick | handler
  onchange | handler
  onclick | handler
  onclick.button.onclick | handler
  onclick | handler
  onclick | handler
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// No controls or additional privileges exist in ordinary desktop sessions.
const debug = window.linkDebug;
if (debug) {
  const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='aidebug.css';document.head.append(sheet);
  document.body.classList.add('visible-aidebug');
  const bar=document.createElement('section');bar.className='aidebug-bar';bar.setAttribute('aria-label','AIDEBUG 测试控制');
  bar.innerHTML='<div class="aidebug-label"><small>AIDEBUG · 隔离模拟</small><strong id="aidebug-title">准备可见测试</strong><span id="aidebug-detail">真实客户端与服务 · 测试资料独立</span></div><div class="aidebug-actions"><button id="aidebug-pause" class="secondary">暂停</button><button id="aidebug-next" class="secondary">下一阶段</button><select id="aidebug-speed" aria-label="阶段停留时间"><option value="2000">快速 · 2 秒</option><option value="7000" selected>正常 · 7 秒</option><option value="15000">慢速 · 15 秒</option></select><button id="aidebug-history" class="secondary">阶段回看</button></div>';
  document.querySelector('.titlebar').after(bar);
  const gallery=document.createElement('dialog');gallery.className='aidebug-gallery';gallery.setAttribute('aria-label','测试阶段回看');
  gallery.innerHTML='<form method="dialog" class="dialog-top"><h2>阶段回看</h2><button aria-label="关闭阶段回看">关闭</button></form><div class="aidebug-review"><nav></nav><div><h3></h3><p></p><img alt="所选测试阶段的实际窗口截图"></div></div>';
  document.body.append(gallery);
  let current={paused:false,history:[]};
  const /* @chain-region paint | calls: document.getElementById, setAttribute, String, document.querySelectorAll, node.querySelector */ paint=state=>{current=state;document.getElementById('aidebug-title').textContent=(state.step ? state.step+' · ' : '')+state.title;document.getElementById('aidebug-detail').textContent=state.detail;document.getElementById('aidebug-pause').textContent=state.paused?'继续':'暂停';document.getElementById('aidebug-pause').setAttribute('aria-pressed',String(state.paused));document.getElementById('aidebug-speed').value=String(state.delayMs);document.getElementById('aidebug-next').disabled=state.done;
    for(const node of document.querySelectorAll('.aidebug-modal-controls')){node.querySelector('span').textContent=state.title;node.querySelector('[data-debug-pause]').textContent=state.paused?'继续测试':'暂停测试';node.querySelector('[data-debug-next]').disabled=state.done;}
  };
  const /* @chain-region command | calls: catch, debug.command, document.getElementById */ command=value=>debug.command(value).catch(error=>{document.getElementById('aidebug-detail').textContent=error.message;});
  /* @chain-region onclick | calls: command */ document.getElementById('aidebug-pause').onclick=()=>command({op:'controls',paused:!current.paused});
  /* @chain-region onclick | calls: command */ document.getElementById('aidebug-next').onclick=()=>command({op:'controls',next:true});
  /* @chain-region onchange | calls: command, Number */ document.getElementById('aidebug-speed').onchange=event=>command({op:'controls',delayMs:Number(event.target.value)});
  /* @chain-region onclick | calls: command, gallery.querySelector, nav.replaceChildren, current.history.entries, document.createElement, nav.append, gallery.showModal, nav.lastElementChild.click */ document.getElementById('aidebug-history').onclick=async()=>{
    await command({op:'controls',paused:true});
    await command({op:'review',open:true});
    const nav=gallery.querySelector('nav');nav.replaceChildren();
    for(const [index,entry] of current.history.entries()) {
      const button=document.createElement('button');button.textContent=(index+1)+' · '+entry.title;
      /* @chain-region onclick.button.onclick | calls: gallery.querySelector, command */ button.onclick=async()=>{gallery.querySelector('h3').textContent=entry.title;gallery.querySelector('.aidebug-review>div>p').textContent=entry.detail;gallery.querySelector('img').src=await command({op:'image',id:entry.id});};nav.append(button);
    }
    gallery.showModal();nav.lastElementChild?.click();
  };
  gallery.addEventListener('close',()=>void command({op:'review',open:false}));
  // Native modal dialogs make the outer toolbar inert. Keep real controls inside them.
  for(const dialog of document.querySelectorAll('#dialog,#detail-dialog')){
    const controls=document.createElement('div');controls.className='aidebug-modal-controls';
    controls.innerHTML='<span></span><button type="button" data-debug-pause>暂停测试</button><button type="button" data-debug-next>下一阶段</button>';
    /* @chain-region onclick | calls: command */ controls.querySelector('[data-debug-pause]').onclick=()=>command({op:'controls',paused:!current.paused});
    /* @chain-region onclick | calls: command */ controls.querySelector('[data-debug-next]').onclick=()=>command({op:'controls',next:true});
    dialog.querySelector('.dialog-top').append(controls);dialog.classList.add('aidebug-enabled-dialog');
  }
  debug.onState(paint);
  // Main sends the first state once the local service and control bridge are ready.
}
