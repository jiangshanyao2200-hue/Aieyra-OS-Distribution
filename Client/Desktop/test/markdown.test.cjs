// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: Node
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/markdown.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

// 只提供解析结果所需的 DOM 接口，断言面向可见文字和语义元素。
class Node {
 constructor(name,text){this.nodeName=name;this.nodeType=name==='#text'?3:1;this.childNodes=[];this.data=text||'';this.parentNode=null;this.ownerDocument=global.document;this.style={};this.attrs=new Map();this.classList={add(){}};}
 append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.childNodes.push(n);}}
 get firstChild(){return this.childNodes[0]||null;}
 get lastChild(){return this.childNodes.at(-1)||null;}
 get length(){return this.data.length;}
 appendData(text){this.data+=text;}
 get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
 hasAttribute(name){return this.attrs.has(name);}
 getAttribute(name){return this.attrs.get(name)??null;}
 setAttribute(name,value){this.attrs.set(name,String(value));}
 removeAttribute(name){this.attrs.delete(name);}
 remove(){if(this.parentNode)this.parentNode.childNodes=this.parentNode.childNodes.filter(n=>n!==this);this.parentNode=null;}
 replaceWith(next){const parent=this.parentNode,index=parent.childNodes.indexOf(this);next.remove();this.remove();parent.childNodes.splice(index,0,next);next.parentNode=parent;}
 get textContent(){return this.nodeType===3?this.data:this.childNodes.map(n=>n.textContent).join('');}
 set textContent(value){if(this.nodeType===3){this.data=String(value);return;}for(const n of [...this.childNodes])n.remove();this.append(new Node('#text',String(value)));}
}

test('Markdown preserves intraword underscores while rendering explicit emphasis',async t=>{
 const prior=global.document;
 global.document={createElement:name=>new Node(name),createTextNode:text=>new Node('#text',text)};
 t.after(()=>{if(prior===undefined)delete global.document;else global.document=prior;});
 const {renderMarkdown}=await import('../ui/markdown.mjs');
 for(const text of ['OS_TASK_DONE','snake_case_value','a__bold__z','é_name_end','中文_任务_完成','pelican_file_name.txt','_part_end','__part__end']){
  const root=new Node('div');renderMarkdown(root,text);assert.equal(root.textContent,text,text);
 }
 for(const [text,expected,tag] of [['_强调_','强调','em'],['__加粗__','加粗','strong'],['**strong**','strong','strong'],['*italic*','italic','em'],['~~deleted~~','deleted','del'],['`OS_TASK_DONE`','OS_TASK_DONE','code']]){
  const root=new Node('div');renderMarkdown(root,text);assert.equal(root.textContent,expected);assert.equal(root.childNodes[0].childNodes.find(n=>n.nodeType===1)?.nodeName,tag);
 }
 const root=new Node('div');renderMarkdown(root,'OS_TASK_DONE 与 _强调_ 及 `snake_case`');assert.equal(root.textContent,'OS_TASK_DONE 与 强调 及 snake_case');
});

test('思考借用正文节点后，相同正文也必须重新挂载',async t=>{
 const prior=global.document;global.document={createElement:name=>new Node(name),createTextNode:text=>new Node('#text',text)};
 t.after(()=>{if(prior===undefined)delete global.document;else global.document=prior;});
 const {renderMarkdown}=await import('../ui/markdown.mjs'),root=new Node('div');
 renderMarkdown(root,'继续核对实际执行结果。');const paragraph=root.firstChild;
 renderMarkdown(root,'继续核对实际执行结果。');assert.equal(root.firstChild,paragraph);
 root.childNodes=[];renderMarkdown(root,'继续核对实际执行结果。');
 assert.equal(root.textContent,'继续核对实际执行结果。');assert.notEqual(root.firstChild,paragraph);
});

test('fenced code and nested quote tables keep semantic nodes while streaming and recover after replacement',async t=>{
 const prior=global.document;global.document={createElement:name=>new Node(name),createTextNode:text=>new Node('#text',text)};
 t.after(()=>{if(prior===undefined)delete global.document;else global.document=prior;});
 const {renderMarkdown}=await import('../ui/markdown.mjs'),root=new Node('div');
 const find=(node,tag)=>node.nodeName===tag?node:node.childNodes.map(n=>find(n,tag)).find(Boolean);
 const first='```js\nconst original = 1;';renderMarkdown(root,first);
 const code=find(root,'code'),text=code.firstChild;assert.equal(text.data,'const original = 1;');assert.equal(find(root,'span').hidden,true);
 const full=first+'\nconst appended = 2;\n```\n\n> 引用\n>\n> | A | B |\n> | --- | --- |\n> | X | 42 |';renderMarkdown(root,full);
 assert.equal(find(root,'code'),code);assert.equal(code.firstChild,text);assert.equal(text.data,'const original = 1;\nconst appended = 2;');
 const quote=find(root,'blockquote'),table=find(quote,'table');assert.ok(table.textContent.includes('42'));
 renderMarkdown(root,full.replace('42','43'));assert.equal(find(root,'blockquote'),quote);assert.equal(find(quote,'table'),table);assert.ok(table.textContent.includes('43'));
 renderMarkdown(root,'');assert.equal(root.childNodes.length,0);renderMarkdown(root,first);assert.notEqual(find(root,'code'),code);
});
