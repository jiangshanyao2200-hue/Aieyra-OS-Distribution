// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: bytes; offset; validateReceiptPage; ReceiptPages; createReceiptReader
// Impact: python -B scripts/code-atlas.py show Tool/presentation/receipt-reader.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Read-only, explicit pages. A host binds readPage to one authorized source;
// this component cannot execute tools or discover another source.
const bytes=text=>new TextEncoder().encode(text).length;
const offset=value=>Number.isSafeInteger(value)&&value>=0;
export function validateReceiptPage(result,inputOffset=0,outputOffset=0){
 if(result?.changed||result?.code==='receipt_changed')throw Object.assign(Error('记录已更新，请从头读取。'),{changed:true});
 if(result?.pending&&!result.input&&!result.output&&result.input_size===undefined)return {...result,pending:true};
 if(result?.ok===false)throw Error(result.error?.message||result.error||(result.unavailable?'原始记录暂不可用。':'原始记录无法读取。'));
 if(!result||typeof result.input!=='string'||typeof result.output!=='string')throw Error('原始记录格式无效。');
 for(const [side,start]of [['input',inputOffset],['output',outputOffset]]){
  const size=result[side+'_size'],next=result['next_'+side],length=bytes(result[side]);
  if(!offset(size)||!offset(next)||start>size||length>65536||start+length>size||next!==0&&next!==start+length||next>size||next===0&&start+length!==size||next!==0&&next<=start)throw Error('原始记录分页位置无效。');
 }
 if(result.receipt_version!==undefined&&(typeof result.receipt_version!=='string'||!result.receipt_version))throw Error('原始记录版本无效。');
 return result;
}

export class ReceiptPages{
 constructor(readPage,{onChange=()=>{},isCurrent=()=>true}={}){this.readPage=readPage;this.onChange=onChange;this.isCurrent=isCurrent;this.pages=[];this.index=-1;this.sequence=0;this.visible=true;this.closed=false;this.busy=false;this.error='';this.changed=false;this.pending=false;}
 get current(){return this.pages[this.index];}
 get canBack(){return this.index>0;}
 get canNext(){return !!(this.current&&(this.current.result.next_input||this.current.result.next_output));}
 get version(){return this.current?.result.receipt_version;}
 notify(){if(!this.closed)this.onChange(this);}
 setVisible(value){this.visible=!!value;if(!this.visible){this.sequence++;this.busy=false;}this.notify();}
 async load(mode='first'){
  if(this.closed||!this.visible||this.busy||!this.isCurrent())return false;
  if(mode==='retry')mode=this.failedMode||'first';
  if(mode==='back'){if(!this.canBack)return false;this.index--;this.error='';this.notify();return true;}
  if(mode==='next'&&!this.canNext)return false;
  const current=this.current;
  if(mode==='next'&&this.index+1<this.pages.length){this.index++;this.error='';this.notify();return true;}
  const first=mode==='first'||mode==='reload'||!current;
  const inputOffset=first?0:mode==='next'?current.result.next_input||current.result.input_size:current.inputOffset;
  const outputOffset=first?0:mode==='next'?current.result.next_output||current.result.output_size:current.outputOffset;
  const sequence=++this.sequence,version=first?undefined:this.version;
  this.busy=true;this.error='';this.changed=false;this.failedMode=mode;this.notify();
  try{
   const result=validateReceiptPage(await this.readPage({input_offset:inputOffset,output_offset:outputOffset,...(version?{receipt_version:version}:{})}),inputOffset,outputOffset);
   if(sequence!==this.sequence||this.closed||!this.visible||!this.isCurrent())return false;
   if(result.pending&&!result.input&&!result.output){this.pending=true;this.notify();return false;}
   if(version&&result.receipt_version!==version)throw Object.assign(Error('记录已更新，请从头读取。'),{changed:true});
   if(!first&&current&&(result.input_size!==current.result.input_size||result.output_size!==current.result.output_size))throw Object.assign(Error('记录已更新，请从头读取。'),{changed:true});
   const page={inputOffset,outputOffset,result};
   if(first){this.pages=[page];this.index=0;}else if(mode==='next'){this.pages=this.pages.slice(0,this.index+1);this.pages.push(page);this.index++;}else this.pages[this.index]=page;
   this.pending=!!result.pending||result.state==='running';this.error='';this.notify();return true;
  }catch(error){
   if(sequence===this.sequence&&!this.closed&&this.visible&&this.isCurrent()){this.error=error.message;this.changed=!!error.changed;this.notify();}return false;
  }finally{if(sequence===this.sequence&&!this.closed){this.busy=false;this.notify();}}
 }
 dispose(){if(this.closed)return;this.closed=true;this.sequence++;this.busy=false;this.pages=[];this.index=-1;}
}

export function createReceiptReader(doc,{readPage,isCurrent=()=>true,summary:heading,mode='tool',renderText}={}){
 const make=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const element=make('details','hx-receipt'),summary=heading||make('summary','hx-more','阅读完整记录'),body=make('div','hx-receipt-body');body.tabIndex=0;
 const status=make('p','hx-state'),content=make('div'),navigation=make('nav','hx-pages');
 const back=make('button','hx-page','上一段'),next=make('button','hx-page','下一段'),retry=make('button','hx-page','重新读取'),reload=make('button','hx-page','读取最新回执');
 for(const button of [back,next,retry,reload])button.type='button';navigation.append(back,next);body.append(status,content,navigation,retry,reload);element.append(summary,body);
 let lastPage=null,lastResult=null,focus='',hostVisible=true;
 const paint=pages=>{
  status.textContent=pages.error||(!pages.current?(pages.busy?'正在读取原始记录…':pages.pending?'记录仍在整理，可在此读取最新结果。':''):pages.pending?'读取时仍在进行；阅读期间保留当前内容。':'');status.hidden=!status.textContent;
  const page=pages.current,result=page?.result;
  if(page!==lastPage||result!==lastResult){
   lastPage=page;lastResult=result;
   if(result){
    if(mode==='tool'||result.compaction){const input=make('pre','hx-io',result.input),output=make('pre','hx-io',result.output);content.replaceChildren(make('small','',result.compaction?'压缩前的原文':'输入'),input,make('small','',result.compaction?'压缩后的内容与状态':'输出'),output);}
    else{const text=make('div','chat-text');if(renderText)renderText(text,result.input);else text.textContent=result.input;content.replaceChildren(text);}
    body.scrollTop=page.scrollTop||0;
   }
  }
  back.disabled=pages.busy||!pages.canBack;next.disabled=pages.busy||!pages.canNext||pages.changed;navigation.hidden=!pages.canBack&&!pages.canNext;
  retry.hidden=!pages.error||pages.changed;retry.disabled=pages.busy;reload.hidden=!pages.pending&&!pages.changed;reload.disabled=pages.busy;
  if(pages.changed)reload.textContent='从头读取';else reload.textContent='读取最新回执';
  element.setAttribute('aria-busy',String(pages.busy));
  if(focus&&!pages.busy){const preferred=focus==='back'?back:focus==='next'?next:focus==='reload'?reload:retry,other=focus==='next'?back:next;const target=!preferred.hidden&&!preferred.disabled?preferred:!other.hidden&&!other.disabled?other:body;if(element.isConnected)target.focus?.({preventScroll:true});focus='';}
 };
 const pages=new ReceiptPages(readPage,{isCurrent:()=>hostVisible&&element.open&&isCurrent(),onChange:paint});
 const request=async direction=>{if(pages.current)pages.current.scrollTop=body.scrollTop;focus=direction;await pages.load(direction);};
 back.onclick=()=>void request('back');next.onclick=()=>void request('next');retry.onclick=()=>void request('retry');reload.onclick=()=>void request('reload');
 element.ontoggle=()=>{pages.setVisible(hostVisible&&element.open);if(hostVisible&&element.open&&!pages.current)void pages.load();};
 paint(pages);
 return {element,pages,setVisible(value){hostVisible=!!value;pages.setVisible(hostVisible&&element.open);},dispose(){pages.dispose();element.ontoggle=null;for(const button of [back,next,retry,reload])button.onclick=null;}};
}
