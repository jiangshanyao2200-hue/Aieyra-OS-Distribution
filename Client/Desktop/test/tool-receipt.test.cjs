// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; settle; page; dom
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-receipt.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const load=()=>import('../../../Tool/presentation/receipt-reader.mjs');
const settle=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
const page=(input,output,extra={})=>({ok:true,input,output,input_size:Buffer.byteLength(input),output_size:Buffer.byteLength(output),next_input:0,next_output:0,receipt_version:'v1',state:'completed',...extra});

test('receipt pages preserve exact UTF-8 bytes and finish unequal sides independently',async()=>{
 const {ReceiptPages}=await load(),input='中文🙂'.repeat(18000),output='结果🙂\n'.repeat(38000),requests=[];
 const data={input:Buffer.from(input),output:Buffer.from(output)};
 const chunk=(buffer,start)=>{let end=Math.min(start+65536,buffer.length);while(end<buffer.length&&(buffer[end]&192)===128)end--;return buffer.subarray(start,end).toString();};
 const pages=new ReceiptPages(async args=>{requests.push(args);const result={ok:true,state:'completed',receipt_version:'v1'};for(const side of ['input','output']){const offset=args[side+'_offset'];result[side]=chunk(data[side],offset);result[side+'_size']=data[side].length;const end=offset+Buffer.byteLength(result[side]);result['next_'+side]=end<data[side].length?end:0;}return result;});
 assert.equal(requests.length,0);await pages.load();while(pages.canNext)assert.equal(await pages.load('next'),true);
 for(const side of ['input','output'])assert.equal(crypto.createHash('sha256').update(pages.pages.map(p=>p.result[side]).join('')).digest('hex'),crypto.createHash('sha256').update(data[side]).digest('hex'));
 assert.ok(requests.some(r=>r.input_offset===data.input.length&&r.output_offset<data.output.length),'finished input stays at its byte length');
 const count=requests.length;assert.equal(await pages.load('back'),true);assert.equal(await pages.load('next'),true);assert.equal(requests.length,count,'cached navigation does not reread the source');pages.dispose();
});

test('receipt version changes and failed next-page retries preserve the accepted page',async()=>{
 const {ReceiptPages}=await load(),requests=[];let fail=true,changed=false;
 const pages=new ReceiptPages(async args=>{requests.push(args);if(args.input_offset===0)return page('中','',{input_size:6,next_input:3});if(fail){fail=false;throw Error('temporary');}if(changed)return {ok:false,changed:true,code:'receipt_changed'};return page('文','',{input_size:6});});
 await pages.load();const first=pages.current;assert.equal(await pages.load('next'),false);assert.equal(pages.current,first);assert.equal(pages.error,'temporary');
 assert.equal(await pages.load('retry'),true);assert.deepEqual(requests.slice(-2).map(r=>r.input_offset),[3,3]);assert.equal(pages.current.result.input,'文');
 await pages.load('back');changed=true;pages.pages.length=1;assert.equal(await pages.load('next'),false);assert.equal(pages.current,first);assert.equal(pages.changed,true);assert.equal(pages.pages.length,1);assert.equal(await pages.load('reload'),true);assert.equal(pages.changed,false);pages.dispose();
});

test('hidden, replaced and disposed receipt reads reject late success, error and finally',async()=>{
 const {ReceiptPages}=await load(),pending=[];let source=true;
 const pages=new ReceiptPages(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),{isCurrent:()=>source});
 const old=pages.load();pages.setVisible(false);pages.setVisible(true);const fresh=pages.load();pending[0].reject(Error('old'));await old;assert.equal(pages.busy,true,'old finally cannot unlock a newer read');assert.equal(pages.error,'');
 pending[1].resolve(page('new',''));await fresh;assert.equal(pages.current.result.input,'new');
 const replaced=pages.load('reload');source=false;pending[2].resolve(page('foreign',''));await replaced;assert.equal(pages.current.result.input,'new');source=true;
 const closed=pages.load('reload');pages.dispose();pending[3].reject(Error('closed'));await closed;assert.equal(pages.pages.length,0);assert.equal(pages.error,'');
});

test('receipt reader rejects malformed byte cursors and overlarge pages',async()=>{
 const {validateReceiptPage}=await load();
 for(const invalid of [{next_input:2,input_size:6},{next_input:3,input_size:2},{next_input:0,input_size:6},{input_size:-1},{next_input:NaN},{output_size:1.5},{receipt_version:''}])assert.throws(()=>validateReceiptPage(page('中','',invalid)));
 assert.throws(()=>validateReceiptPage(page('x'.repeat(65537),'')));
 assert.throws(()=>validateReceiptPage(page('中',''),4,0));assert.equal(validateReceiptPage({ok:true,pending:true}).pending,true);
});

test('receipt indexing remains pending without losing the last accepted original',async()=>{
 const {ReceiptPages}=await load();let result={ok:false,code:'receipt_pending',pending:true};
 const pages=new ReceiptPages(async()=>result);
 assert.equal(await pages.load(),false);assert.equal(pages.pending,true);assert.equal(pages.error,'');assert.equal(pages.current,undefined);
 result=page('完整输入','原始输出');assert.equal(await pages.load('reload'),true);const accepted=pages.current;
 result={ok:false,code:'receipt_pending',pending:true};assert.equal(await pages.load('reload'),false);assert.equal(pages.current,accepted);assert.equal(pages.pending,true);assert.equal(pages.error,'');
 result={ok:false,code:'receipt_unavailable',unavailable:true,pending:false};assert.equal(await pages.load('reload'),false);assert.equal(pages.current,accepted);assert.match(pages.error,/暂不可用/);pages.dispose();
});

test('a pending continuation retains the accepted version and can retry the same byte cursor',async()=>{
 const {ReceiptPages}=await load(),requests=[];let pending=true;
 const pages=new ReceiptPages(async args=>{requests.push(args);if(!args.input_offset)return page('中','',{input_size:6,next_input:3});return pending?{ok:false,code:'receipt_pending',pending:true}:page('文','',{input_size:6});});
 assert.equal(await pages.load(),true);const first=pages.current;
 assert.equal(await pages.load('next'),false);assert.equal(pages.current,first);assert.equal(pages.pending,true);assert.equal(pages.changed,false);assert.equal(pages.error,'');assert.equal(pages.canNext,true);
 pending=false;assert.equal(await pages.load('retry'),true);assert.equal(pages.current.result.input,'文');assert.deepEqual(requests.slice(-2),[{input_offset:3,output_offset:0,receipt_version:'v1'},{input_offset:3,output_offset:0,receipt_version:'v1'}]);pages.dispose();
});

// Small native-node model for retention semantics. Actual geometry, selection
// painting, native input and themes are verified separately in Electron.
function dom(){
 let selection=null;const doc={activeElement:null,getSelection:()=>selection,defaultView:{},createElement:tag=>new Node(tag),createTextNode:value=>new Text(value)};
 class Base{
  get ownerDocument(){return doc;}get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}get childNodes(){return this.nodes||[];}get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  contains(node){return this===node||this.childNodes.some(n=>n.contains(node));}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.nodes.push(n);}}
  insertBefore(node,before){node.remove();const at=this.nodes.indexOf(before);this.nodes.splice(at<0?this.nodes.length:at,0,node);node.parentNode=this;}
  remove(){if(this.parentNode)this.parentNode.nodes.splice(this.parentNode.nodes.indexOf(this),1);this.parentNode=null;}
  replaceChildren(...nodes){for(const n of [...this.childNodes])n.remove();this.append(...nodes);}
  focus(){doc.activeElement=this;}
 }
 class Text extends Base{constructor(value){super();this.nodeType=3;this.data=value;}get textContent(){return this.data;}set textContent(value){this.data=value;}appendData(value){this.data+=value;}}
 class Node extends Base{
  constructor(tag){super();this.nodeType=1;this.tagName=tag.toUpperCase();this.nodes=[];this.dataset={};this.attributes=new Map();this.style={};this.scrollTop=0;this.hidden=false;this.className='';}
  get textContent(){return this.nodes.map(n=>n.textContent).join('');}set textContent(value){this.replaceChildren(...(value?[new Text(String(value))]:[]));}
  setAttribute(name,value){this.attributes.set(name,String(value));}removeAttribute(name){this.attributes.delete(name);}hasAttribute(name){return this.attributes.has(name);}getAttribute(name){return this.attributes.get(name)??null;}getAttributeNames(){return [...this.attributes.keys()];}
 }
 doc.body=new Node('body');doc.head=new Node('head');return {doc,select(node){selection={isCollapsed:false,rangeCount:1,getRangeAt:()=>({intersectsNode:target=>target===node||target.contains(node)})};},clearSelection(){selection=null;}};
}

test('receipt reader keeps its text and scroll while collapsed, pending or failing',async()=>{
 const {createReceiptReader}=await load(),f=dom(),requests=[];let reject=false;
 const reader=createReceiptReader(f.doc,{readPage:async args=>{requests.push(args);if(reject)throw Error('offline');return page('完整输入','实际输出');}});f.doc.body.append(reader.element);
 assert.equal(requests.length,0);reader.element.open=true;reader.element.ontoggle();await settle();
 const body=reader.element.children[1],content=body.children[1],text=content.children[1].childNodes[0];body.scrollTop=83;
 reader.element.open=false;reader.element.ontoggle();reader.element.open=true;reader.element.ontoggle();await settle();assert.equal(requests.length,1);assert.equal(content.children[1].childNodes[0],text);assert.equal(body.scrollTop,83);
 reject=true;await reader.pages.load('reload');assert.equal(content.children[1].childNodes[0],text);assert.match(body.children[0].textContent,/offline/);reader.dispose();
});

test('digest updates keep open details, text selections, focus and the original page controller',async()=>{
 const {createDigestController}=await import('../ui/tool-digest.mjs'),{resultFrame}=await import('../../../Tool/presentation/frame.mjs'),f=dom();
 const render=(doc,item,{present})=>{const root=doc.createElement('div'),frame=resultFrame(doc,root,present),details=doc.createElement('details'),summary=doc.createElement('summary'),text=doc.createElement('pre');details.dataset.detail='stable';summary.textContent='详情';text.textContent=item.text;details.append(summary,text);frame.content.append(details);frame.summary.textContent=item.state;return frame.finish();};
 const controller=createDigestController(f.doc,{state:'running',text:'旧正文'},{render,readPage:async()=>page('输入','输出')});f.doc.body.append(controller.element);
 const details=controller.element.children[1].children[0],summary=details.children[0],text=details.children[1].childNodes[0];details.open=true;details.scrollTop=77;summary.focus();f.select(text);
 const reader=controller.reader;controller.update({state:'failed',text:'修订正文'});assert.equal(details.children[1].childNodes[0],text);assert.equal(text.textContent,'旧正文');assert.equal(details.open,true);assert.equal(details.scrollTop,77);assert.equal(f.doc.activeElement,summary);assert.equal(controller.reader,reader);assert.equal(controller.element.children[0].textContent,'failed','failure state is current while selected body awaits explicit refresh');
 controller.update({state:'failed',text:'修订正文'},{force:true});assert.equal(text.textContent,'修订正文');f.clearSelection();controller.dispose();assert.equal(reader.pages.closed,true);
});
