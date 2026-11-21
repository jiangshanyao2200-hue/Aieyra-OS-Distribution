// Display preferences only; project bindings and editor drafts stay with Core.
export function columnWidths(width,left=.18,right=.28,terminal=false){
 const available=Math.max(0,width-(terminal?12:6)),minimum=Math.min(120,available*.22),middle=Math.min(200,available*.32),rightMinimum=terminal?Math.min(160,available*.27):0;
 const l=Math.max(minimum,Math.min(available*.55,available-middle-rightMinimum,available*left));
 const r=terminal?Math.max(rightMinimum,Math.min(available-l-middle,available*right)):0;
 return {left:Math.round(l),right:Math.round(r)};
}
export function setupProjectLayout(root){
 const doc=root.ownerDocument,win=doc.defaultView,key='aieyra.coding.columns.v1',work=root.parentElement,terminalRoot=work.querySelector('.cd-terminal');let left=.18,right=.28,terminal=false,editorPriority=false,activityEditor=false,hasProject=false,drag=null,closed=false;
 try{const value=JSON.parse(win.localStorage.getItem(key));if(Number.isFinite(value?.left)&&Number.isFinite(value?.right)){left=Math.min(.55,Math.max(.1,value.left));right=Math.min(.75,Math.max(.1,value.right));}}catch{}
 const separators=['left','right'].map(side=>{const node=doc.createElement('div');node.className='project-separator project-separator-'+side;node.tabIndex=0;node.setAttribute('role','separator');node.setAttribute('aria-orientation','vertical');node.setAttribute('aria-label',side==='left'?'调整目录宽度':'调整操作区宽度');(side==='left'?root:work).append(node);return node;});
 function paint(){
  if(closed)return;
  const terminalOnly=terminal&&!hasProject;
  const mode=terminalOnly?'terminal':terminal?'split':'editor';
  if(work.dataset.workLayout!==mode)work.dataset.workLayout=mode;
  if(terminalRoot&&terminalRoot.hidden===terminal)terminalRoot.hidden=!terminal;
  const available=Math.max(0,work.clientWidth-6);
  const rightWidth=terminalOnly?work.clientWidth:terminal?Math.round(available*(editorPriority?right:Math.max(.60,right))):0;
  const leftWidth=columnWidths(root.clientWidth,left,right,false).left;
  root.style.setProperty('--project-left',leftWidth+'px');
  work.style.setProperty('--project-right',rightWidth+'px');
  for(const [index,width] of [leftWidth,rightWidth].entries()){
   separators[index].hidden=index===0?!hasProject:!terminal||terminalOnly;
   separators[index].setAttribute('aria-valuenow',String(width));
   separators[index].setAttribute('aria-valuetext',width+' 像素');
  }
 }
 const save=()=>{try{win.localStorage.setItem(key,JSON.stringify({left,right}));}catch{}};
 function move(side,x){const bounds=(side==='left'?root:work).getBoundingClientRect(),available=Math.max(1,bounds.width-6);if(side==='left')left=Math.max(.1,Math.min(.55,(x-bounds.left)/available));else{editorPriority=true;right=Math.max(.1,Math.min(.75,(bounds.right-x)/available));}paint();}
 for(const [index,node]of separators.entries()){
  const side=index?'right':'left';
  node.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,side};node.setPointerCapture(e.pointerId);root.classList.add('resizing');};
  node.onpointermove=e=>{if(drag?.id===e.pointerId)move(side,e.clientX);};
  const finish=()=>{if(!drag)return;drag=null;root.classList.remove('resizing');save();};
  node.onpointerup=node.onpointercancel=node.onlostpointercapture=finish;
  node.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();if(index)editorPriority=true;if(e.key==='Home'){if(index)right=.28;else left=.18;}else{const delta=(e.key==='ArrowRight'?16:-16)/Math.max(1,index?work.clientWidth:root.clientWidth);if(index)right=Math.max(.1,Math.min(.75,right-delta));else left=Math.max(.1,Math.min(.55,left+delta));}paint();save();};
 }
 const observer=new win.ResizeObserver(paint);observer.observe(work);observer.observe(root);paint();
 return {terminal(value){const next=!!value;if(next===terminal)return;terminal=next;if(!next)editorPriority=activityEditor;paint();},activity(project,edit){if(project===hasProject&&edit===activityEditor)return;hasProject=project;activityEditor=edit;if(!drag)editorPriority=edit;paint();},close(){closed=true;observer.disconnect();for(const node of separators)node.remove();root.classList.remove('resizing');}};
}
