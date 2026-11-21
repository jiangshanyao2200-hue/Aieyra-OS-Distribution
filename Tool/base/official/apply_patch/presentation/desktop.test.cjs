'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

function fixture(){
 class Node{
  constructor(tag,cls,text=''){this.tagName=tag;this.className=cls;this.textContent=text;this.children=[];this.dataset={};this.listeners={};this.scrollHeight=100;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  replaceWith(...nodes){const parent=this.parent,index=parent.children.indexOf(this);parent.children.splice(index,1,...nodes);for(const node of nodes)node.parent=parent;}
  addEventListener(name,fn){this.listeners[name]=fn;}
 }
 const make=(...args)=>new Node(...args),pane={body:make('div'),node:make('section'),state:make('span')};
 const find=(node,cls)=>[...(node.className===cls?[node]:[]),...node.children.flatMap(c=>find(c,cls))];
 const text=node=>[node.textContent,...node.children.map(text)].join(' ');
 return {make,pane,find,text};
}

test('saved patch receipts keep file selection, expandable context and omission notices',async()=>{
 const {createPatchView}=await import('./desktop.mjs'),f=fixture();
 const fill=createPatchView({make:f.make,activityData:i=>i.patch||{},activityOutcome:()=>'',groupState:()=>({state:'completed',live:0,failed:false}),STATES:{running:'进行中'},middleEllipsis:s=>s});
 const file=(path,value)=>({path,operation:'update',hunks:[{lines:[...Array.from({length:12},(_,i)=>({kind:'context',text:'上下文 '+i,new:i+1})),{kind:'add',text:value,new:13}]}]});
 const items=[{id:'one',state:'completed',revision:1,patch:{ok:true,files:[file('a.txt','真实内容 A')]}},{id:'two',state:'completed',revision:2,patch:{ok:true,files:[file('b.txt','真实内容 B')],omitted_lines:3}}];
 fill(f.pane,items);
 assert.match(f.text(f.pane.body),/真实内容 B/);assert.doesNotMatch(f.text(f.pane.body),/真实内容 A/);
 assert.match(f.text(f.pane.body),/预览另省略 3 行/);
 const chips=f.find(f.pane.body,'patch-file');assert.equal(chips.length,2);chips[0].listeners.click();
 assert.match(f.text(f.pane.body),/真实内容 A/);assert.doesNotMatch(f.text(f.pane.body),/真实内容 B/);
 assert.equal(f.find(f.pane.body,'patch-diff')[0].scrollTop,0);
 const gap=f.find(f.pane.body,'patch-gap')[0];assert.ok(gap);assert.doesNotMatch(f.text(f.pane.body),/上下文 5/);
 gap.listeners.click();assert.match(f.text(f.pane.body),/上下文 5/);
 const body=f.pane.body.children[1];fill(f.pane,items);assert.equal(f.pane.body.children[1],body,'unchanged receipt keeps its expanded DOM');
});

test('a rejected patch stays visibly failed and never gains an applied state',async()=>{
 const {createPatchView}=await import('./desktop.mjs'),f=fixture();
 const fill=createPatchView({make:f.make,activityData:i=>i.patch,activityOutcome:()=> '上下文已改变，未写入',groupState:()=>({state:'failed',live:0,failed:true}),STATES:{running:'进行中'},middleEllipsis:s=>s});
 fill(f.pane,[{id:'failed',state:'failed',revision:1,patch:{ok:false,files:[]}}]);
 assert.equal(f.pane.node.dataset.state,'failed');assert.equal(f.pane.state.textContent,'未应用');
 assert.match(f.text(f.pane.body),/上下文已改变，未写入/);
});
