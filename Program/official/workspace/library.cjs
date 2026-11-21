'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Prompt writes use the contact service's original hash and revision. Knowledge
// is canvas-owned content, exposed to its tools without a second system prompt.
function createCanvasLibrary({root,conversation,binding}){
 const file=path.join(root,'knowledge.json');let queue=Promise.resolve();
 const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 const sections=()=>import('../../../Client/Desktop/ui/prompt-sections.mjs');
 const check=r=>{if(r?.ok===false)throw Error(r.error);return r;};
 async function state(){
  const b=await binding(),contact=check(await conversation({action:'contact',id:b.contact.id})),docs=read(),api=await sections(),rows=api.promptSections(contact.prompt);
  return {ok:true,revision:hash([contact.prompt_hash,docs]),sections:Object.fromEntries(rows.map(r=>[r.id==='self'?'identity':r.id,r.draft])),entries:docs.map(({text,...entry})=>entry),contact,rows};
 }
 const publicState=({contact,rows,...value})=>value;
 async function update(p){
  const current=await state();if(p.revision!==current.revision)throw Error('知识或提示词已更新，请重新读取后合并修改');
  if(p.operation==='sections'){
   const api=await sections();for(const row of current.rows){const key=row.id==='self'?'identity':row.id;if(typeof p.sections?.[key]!=='string')throw Error('四层提示词不完整');api.editPromptSection(row,p.sections[key]);}
   check(await conversation({action:'contact_update',id:current.contact.id,prompt_hash:current.contact.prompt_hash,prompt_text:api.joinPromptSections(current.rows),expected_revision:current.contact.revision}));
  }else{
   const docs=read();if(hash([current.contact.prompt_hash,docs])!==current.revision)throw Error('知识目录已更新');
   if(p.operation==='save-document'){
    if(typeof p.title!=='string'||!p.title.trim()||p.title.length>120||typeof p.text!=='string'||p.text.length>500000||String(p.description||'').length>500)throw Error('知识文档内容无效');
    const index=p.id?docs.findIndex(d=>d.id===p.id):-1;if(p.id&&index<0)throw Error('知识文档已删除');
    const item={id:p.id||crypto.randomUUID(),title:p.title.trim(),description:String(p.description||''),text:p.text};index<0?docs.push(item):docs.splice(index,1,item);
   }else if(p.operation==='delete-document'){const index=docs.findIndex(d=>d.id===p.id);if(index<0)throw Error('知识文档已删除');docs.splice(index,1);}
   else throw Error('未知知识操作');
   fs.mkdirSync(root,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(docs));fs.renameSync(tmp,file);
  }
  return publicState(await state());
 }
 return {get:async()=>publicState(await state()),read(id){const entry=read().find(d=>d.id===id);if(!entry)throw Error('知识文档已不存在');return {ok:true,...entry};},update(p){const result=queue.then(()=>update(p));queue=result.catch(()=>{});return result;}};
}
module.exports={createCanvasLibrary};
