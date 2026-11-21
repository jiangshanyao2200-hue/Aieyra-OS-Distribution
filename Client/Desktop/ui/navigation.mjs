// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupNavigation
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/navigation.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// One shared content surface. Dialogs retain their native open/close contract,
// but are non-modal children of the page; background work keeps its DOM/state.
export function setupNavigation(doc=document){
  const $=id=>doc.getElementById(id),home=$('screen'),surface=$('view-surface'),content=$('view-content');
  const entries=new Map();let current='',key='',returnFocus=null,lastChat=null;
  // A new destination supersedes pending native opens even if the current
  // page already matches it (for example Home while a Program is loading).
  const request=()=>doc.dispatchEvent(new CustomEvent('workspace-view-request'));
  // 这些页面没有自己的关闭按钮，统一给一个返回。其他页面要用，加进这张表就行。
  const BACK_PAGES=new Set(['panel','plan-view']);
  const pageBack=doc.createElement('button');pageBack.id='page-back';pageBack.className='cp-icon page-back';pageBack.type='button';pageBack.hidden=true;pageBack.title='返回';pageBack.setAttribute('aria-label','返回');
  pageBack.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>';surface?.append(pageBack);
  // A DOM top layer cannot cover a separate native WebContentsView. Publish
  // modal changes so page hosts temporarily yield and restore the same view.
  let modal=false;
  const modalObserver=new doc.defaultView.MutationObserver(records=>{
    if(!records.some(record=>record.type==='attributes'?record.target.localName==='dialog':[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.localName==='dialog'||node.querySelector?.('dialog')))))return;
    const next=!!doc.querySelector('dialog:modal');if(next===modal)return;modal=next;
    doc.dispatchEvent(new doc.defaultView.CustomEvent('workspace-modal-change',{detail:{open:modal}}));
  });
  modalObserver.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  doc.defaultView.addEventListener('beforeunload',()=>modalObserver.disconnect(),{once:true});
  function register(id){
    const node=$(id);entries.set(id,node);content.append(node);node.hidden=true;node.classList.add('workspace-view');
    node.addEventListener?.('close',()=>{if(!node.open&&current===id)back();});
    node.addEventListener?.('cancel',event=>{event.preventDefault();if(current===id)back();});
  }
  function paint(){
    const active=!!current;home.hidden=active;surface.hidden=!active;doc.body.dataset.view=current||'home';pageBack.hidden=!BACK_PAGES.has(current);
    for(const button of doc.querySelectorAll('[data-view-key]'))button.setAttribute('aria-expanded',String(active&&button.dataset.viewKey===key));
    doc.dispatchEvent(new CustomEvent('workspace-view-change',{detail:{id:current,key}}));
  }
  function back(){
    if(current==='group-view'&&entries.has('contacts-view'))return open('contacts-view','联系人');
    request();
    if(!current)return;
    doc.dispatchEvent(new CustomEvent('workspace-view-before-change',{detail:{from:current,to:''}}));
    const node=entries.get(current),active=doc.activeElement;
    // close() 与旧 DOM 搬移都会重置焦点；先保存关闭前仍在工作的输入。
    const focus=active&&active!==doc.body&&!node?.contains(active)?active:returnFocus;
    const selection=focus&&typeof focus.selectionStart==='number'?{start:focus.selectionStart,end:focus.selectionEnd,direction:focus.selectionDirection}:null;
    current='';key='';if(node){node.hidden=true;if(node.open&&typeof node.close==='function')node.close();}
    paint();
    const target=focus?.isConnected&&focus.getClientRects().length?focus:returnFocus;
    if(target?.isConnected){target.focus({preventScroll:true});if(target===focus&&selection)target.setSelectionRange(selection.start,selection.end,selection.direction);}
    returnFocus=null;
  }
  function open(id,title,{viewKey=id,toggle=false,preserveFocus=false}={}){
    const node=entries.get(id);if(!node)throw Error('Unknown workspace view: '+id);
    request();
    if(toggle&&current===id&&key===viewKey){back();return false;}
    if(current===id&&key===viewKey){$('view-title').textContent=title;return true;}
    doc.dispatchEvent(new CustomEvent('workspace-view-before-change',{detail:{from:current,to:id}}));
    // Dock 切页可以保留正在输入的路径；非模态 dialog.show 本身会移动焦点。
    const focus=preserveFocus?doc.activeElement:null;
    const selection=focus&&typeof focus.selectionStart==='number'?{start:focus.selectionStart,end:focus.selectionEnd,direction:focus.selectionDirection}:null;
    if(current!==id){
      const prior=entries.get(current);current='';if(prior){prior.hidden=true;if(prior.open&&typeof prior.close==='function')prior.close();}
      if(!prior)returnFocus=doc.activeElement;
    }
    current=id;key=viewKey;if(id==='conversation-view'||id==='group-view')lastChat={id,title,viewKey};node.hidden=false;surface.hidden=false;home.hidden=true;
    $('view-title').textContent=title;if(typeof node.show==='function'&&!node.open)node.show();paint();
    if(focus?.isConnected&&focus.getClientRects().length){focus.focus({preventScroll:true});if(selection)focus.setSelectionRange(selection.start,selection.end,selection.direction);}
    return true;
  }
  for(const id of ['panel','onboarding','settings-view','conversation-view','document-viewer','plan-view','browser-view','control-view','link-view'])if($(id))register(id);
  const goHome=()=>{lastChat=null;back();};
  const resume=()=>lastChat?open(lastChat.id,lastChat.title,{viewKey:lastChat.viewKey}):back();
  $('home-button').onclick=resume;pageBack.onclick=back;
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&current&&!event.defaultPrevented&&!event.target.closest('#bottom-bar')&&!doc.body.classList.contains('composer-open')){event.preventDefault();back();}});
  paint();return {register,request,open,home:goHome,resume,forgetConversation(viewKey){if(lastChat?.viewKey===viewKey)lastChat=null;},
    // 明确选中 Eyra 本身：之后的 OS 首页不再回到上一个独立会话。
    forgetChat(){lastChat=null;},is:(id,viewKey)=>current===id&&(!viewKey||key===viewKey),title:text=>{$('view-title').textContent=text;},get current(){return current;}};
}
