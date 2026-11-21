// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: normalized; label; excerpt; setupMemoryRecords
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/memory-records.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {confirmDialog} from './contacts.mjs';

const normalized=value=>String(value??'').replace(/\r\n?/g,'\n');
const label=row=>String(row.title||row.excerpt||row.content||row.preview||row.id||row.key||'原文');
const excerpt=row=>[...label(row).replace(/\s+/g,' ')].slice(0,180).join('');

export function setupMemoryRecords(api,{doc=document,check=value=>value}={}){
  const parent=doc.getElementById('memory-settings');if(!parent)return;
  const area=doc.createElement('details');area.className='settings-area memory-records';
  area.innerHTML='<summary>长期记忆与阶段摘要</summary><p class="memory-hint">按需查看原始记录。关闭自动带入后，这些资料仍可检索。</p><div class="memory-row"><select aria-label="记忆来源"><option value="search">事实与偏好</option><option value="packets">PAC 阶段摘要</option><option value="history">历史原文</option></select><input aria-label="检索记忆" placeholder="关键词（可留空）"><button type="button" class="quiet memory-search">检索</button></div><div class="memory-record-list"></div><button type="button" class="quiet memory-more" hidden>下一页</button><pre class="memory-record-detail" tabindex="0" hidden></pre><button type="button" class="quiet memory-detail-next" hidden>继续读取</button><div class="memory-record-editor" hidden><label>记录正文<textarea spellcheck="false"></textarea></label><div class="memory-row"><button type="button" class="memory-record-save">保存记录</button><button type="button" class="quiet memory-record-forget">删除记录</button></div></div><p class="memory-record-status" role="status" aria-live="polite"></p>';
  parent.append(area);
  const $=s=>area.querySelector(s),kind=$('select'),query=$('input'),list=$('.memory-record-list'),detail=$('pre'),editor=$('textarea'),form=$('.memory-record-editor'),status=$('.memory-record-status'),next=$('.memory-detail-next'),more=$('.memory-more');
  let busy=false,saving=false,selected=null,opened=null,cursor=null,search=null,activeButton=null;
  const dirty=()=>selected&&editor.value!==normalized(selected.content);
  const discard=async()=>!dirty()||await confirmDialog({doc,title:'离开未保存的记忆',body:'当前记录有未保存的修改。',action:'继续',danger:false});
  const call=async(memory_action,args={})=>check(await api.context({action:'records',memory_action,...args}));
  function controls(){
    area.setAttribute('aria-busy',String(busy));
    editor.readOnly=busy&&!saving;
    for(const node of area.querySelectorAll('button,input,select'))node.disabled=busy;
    $('.memory-record-save').disabled=busy||!dirty();
    $('.memory-record-forget').disabled=busy||!selected;
  }
  function clearDetail(){selected=null;opened=null;activeButton=null;form.hidden=detail.hidden=next.hidden=true;detail.textContent='';}
  function showDetail(){
    const {full,content,kind:source}=opened,row=full.record||full;
    let body=content;
    if(source==='history'&&full.format==='message_json'&&!full.next_cursor){
      try{const message=JSON.parse(content);body=typeof message.content==='string'&&!message.tool_calls?.length&&!message.image_attachments?.length?message.content:JSON.stringify(message,null,2);}catch{/* Legacy payload remains readable as stored. */}
    }
    const meta=[row.title,full.source||({search:'长期记忆',packets:'PAC 阶段摘要',history:'历史原文'})[source],row.at||row.updated_at,row.id||full.id,row.revision?`修订 ${row.revision}`:''].filter(Boolean);
    const scroll=detail.scrollTop;detail.textContent=meta.join(' · ')+'\n\n'+body;detail.hidden=false;detail.scrollTop=scroll;
    next.hidden=!(source==='packets'?full.has_more:source==='history'&&full.next_cursor);
    status.textContent=next.hidden?'已读取完整内容。':'已读取部分内容，可继续读取。';
  }
  async function read(row,source,button,continuation=false){
    if(busy)return;busy=true;controls();
    try{
      if(!continuation&&!await discard())return;
      status.textContent='正在读取…';
      const args=source==='history'?{key:row.key,position:row.position??row.pos,limit_chars:8000,...(continuation?{cursor:opened.full.next_cursor}:{})}:{id:row.id,...(source==='packets'?{limit_chars:4000,...(continuation?{offset:opened.full.next_offset}:{})}:{})};
      const full=await call(source==='search'?'read':source==='packets'?'packet':'original',args);
      if(continuation&&((source==='history'&&full.next_cursor&&full.next_cursor===opened.full.next_cursor)||(source==='packets'&&full.has_more&&full.next_offset<=opened.full.next_offset)))throw Error('读取位置未前进，请重新检索');
      opened={row,kind:source,full,content:(continuation?opened.content:'')+String((full.record||full).content??'')};
      activeButton=button;selected=source==='search'?full.record:null;form.hidden=!selected;
      if(selected)editor.value=normalized(selected.content);
      if(!continuation)detail.scrollTop=0;
      showDetail();
      if(continuation&&next.hidden)detail.focus({preventScroll:true});
    }catch(e){status.textContent=e.message+'；已读取内容和编辑已保留。';}finally{busy=false;controls();}
  }
  async function load(continuation=false){
    if(busy)return;busy=true;controls();
    try{
      if(!await discard())return;
      const request=continuation?search:{kind:kind.value,query:query.value};
      status.textContent='正在读取…';
      const result=await call(request.kind,{query:request.query,cursor:continuation?cursor:undefined,limit:20});
      search=request;clearDetail();
      list.replaceChildren(...(result.records||result.messages||[]).map(row=>{
        const button=doc.createElement('button');button.type='button';button.className='quiet';button.textContent=excerpt(row);button.title=[row.source,row.at,label(row)].filter(Boolean).join('\n');
        button.onclick=()=>read(row,request.kind,button);return button;
      }));
      cursor=result.next_cursor;more.hidden=!cursor;
      status.textContent=list.children.length?`已读取 ${list.children.length} 条。`:cursor?'此页没有匹配，仍可继续下一页。':'没有匹配的记录。';
      if(continuation)(list.firstElementChild||query).focus({preventScroll:true});
    }catch(e){status.textContent=e.message+'；现有记录和编辑已保留。';}finally{busy=false;controls();}
  }
  $('.memory-search').onclick=()=>load();query.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void load();}};
  more.onclick=()=>load(true);next.onclick=()=>opened&&read(opened.row,opened.kind,activeButton,true);
  editor.addEventListener('input',controls);
  $('.memory-record-save').onclick=async()=>{
    if(busy||!selected||!dirty())return;busy=true;saving=true;controls();const record=selected,text=editor.value;status.textContent='正在保存…';
    try{const result=await call('update',{id:record.id,expected_revision:record.revision,content:text});selected=result.record;opened={...opened,full:result,content:selected.content};if(activeButton){activeButton.textContent=excerpt(selected);activeButton.title=label(selected);}showDetail();status.textContent=editor.value===normalized(selected.content)?'记录已保存。':'记录已保存，仍有新的编辑尚未保存。';}catch(e){status.textContent=e.message+'；编辑内容已保留。';}finally{busy=false;saving=false;controls();}
  };
  $('.memory-record-forget').onclick=async()=>{
    if(busy||!selected)return;busy=true;controls();const record=selected;
    try{
      if(!await confirmDialog({doc,title:'删除这条长期记忆',body:(record.title||record.id)+(dirty()?'；当前尚未保存的编辑也将移除。':''),action:'删除'}))return;
      await call('forget',{id:record.id,expected_revision:record.revision});
      const focus=activeButton?.nextElementSibling||activeButton?.previousElementSibling||query;activeButton?.remove();clearDetail();status.textContent='记录已删除。';
      busy=false;controls();focus.focus({preventScroll:true});
    }catch(e){status.textContent=e.message+'；编辑内容已保留。';}finally{busy=false;controls();}
  };
  controls();
}
