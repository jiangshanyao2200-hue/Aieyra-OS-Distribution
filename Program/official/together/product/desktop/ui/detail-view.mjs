/* @file-map:start
文件: link/desktop/ui/detail-view.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/markdown.mjs
上游: link/desktop/ui/collaboration.mjs, link/desktop/ui/elections.mjs, link/desktop/ui/engineering.mjs, link/desktop/ui/work-status.mjs, link/desktop/ui/workspace.mjs
链路: modal
验证: AIDEBUG/live-review.cjs, link/desktop/modal-aidebug.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  detailButton | function
  createDetailView | function
  createDetailView.clear | function
  createDetailView.close | function
  createDetailView.open | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e,markdown} from './markdown.mjs';

export /* @chain-region detailButton | calls: e */ function detailButton(title,body,{label='查看详情',format='text'}={}){
  return `<button class="read-detail" data-read-title="${e(title)}" data-read-body="${e(body||'')}" data-read-format="${format==='markdown'?'markdown':'text'}" aria-haspopup="dialog" aria-label="${e(title)} · ${e(label)}">${e(label)} <span aria-hidden="true">↗</span></button>`;
}

export /* @chain-region createDetailView | calls: node.querySelector, node.addEventListener, clear, event.preventDefault, close, node.getBoundingClientRect */ function createDetailView(node){
  const title=node.querySelector('h2'),body=node.querySelector('.detail-content');
  let opener=null;
  /* @chain-region createDetailView.clear | calls: body.replaceChildren, target.closest, target.focus */ function clear(restore=true){
    body.replaceChildren();title.textContent='';
    const target=opener;opener=null;
    const parent=target?.closest('dialog');
    if(restore&&target?.isConnected&&(!parent||parent.open))target.focus({preventScroll:true});
  }
  /* @chain-region createDetailView.close | calls: node.close, clear */ function close({restore=true}={}){if(node.open)node.close();clear(restore);}
  node.addEventListener('close',()=>{if(!node.open)clear();});
  node.addEventListener('cancel',event=>{event.preventDefault();close();});
  node.addEventListener('click',event=>{
    if(event.target!==node)return;
    const r=node.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();
  });
  return {
    /* @chain-region createDetailView.open | calls: markdown, node.showModal, body.focus */ open(button){
      opener=button;title.textContent=button.dataset.readTitle;
      body.className='detail-content '+(button.dataset.readFormat==='markdown'?'markdown':'detail-text');
      if(button.dataset.readFormat==='markdown')body.innerHTML=markdown(button.dataset.readBody,8000);
      else body.textContent=button.dataset.readBody;
      node.scrollTop=0;body.scrollTop=0;if(!node.open)node.showModal();body.focus({preventScroll:true});
    },
    close,
  };
}
