// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: markup; mountComposer; layouts; composerLayout
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/composer-surface.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// One input component for the OS and its native top layer. State stays in OS.
const markup = `<span id="input-caret" aria-hidden="true"></span>
      <div id="composer-attachments" aria-label="待发送附件" hidden></div>
      <textarea id="message" rows="1" maxlength="64000" aria-label="在画布上写下消息" placeholder="在这里输入…" spellcheck="false"></textarea>
      <div class="composer-actions"><button id="stop" type="button" class="stop-button" aria-label="停止当前任务" title="停止当前任务（输入内容时可继续发送补充）" hidden><span aria-hidden="true"></span></button><button id="send" aria-label="发送" title="Ctrl + Enter 或连按两次 Enter 发送 · Enter 换行"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button><button id="add-attachment" type="button" aria-label="添加文件或图片" title="添加文件或图片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>`;
export function mountComposer(doc=document){doc.getElementById('composer').innerHTML=markup;}
const layouts=new WeakMap();
export function composerLayout(doc=document,{viewportHeight=doc.defaultView.innerHeight,folded=doc.body.dataset.form==='folded'}={}){
 const input=doc.getElementById('message'),composer=doc.getElementById('composer');
 composer.classList.toggle('has-text',!!input.value);composer.classList.toggle('focused',doc.activeElement===input);
 if(composer.hidden){layouts.delete(composer);return 0;}
 const style=doc.defaultView.getComputedStyle(input),line=parseFloat(style.lineHeight)||24,padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)||0;
 const key=JSON.stringify([input.value,input.clientWidth,viewportHeight,folded,style.font,style.letterSpacing,padding,composer.clientHeight]);
 const old=layouts.get(composer);if(old?.key===key)return old.height;
 const scroll=input.scrollTop;
 const limit=line*Math.max(1,Math.min(folded?6:14,Math.floor(viewportHeight*(folded?.2:.4)/line)))+padding;
 input.style.height='0px';input.style.height=Math.min(Math.max(input.scrollHeight,line+padding),limit)+'px';input.style.overflowY=input.scrollHeight>limit?'auto':'hidden';
 const height=composer.getBoundingClientRect().height;input.scrollTop=scroll;doc.documentElement.style.setProperty('--composer-height',height+'px');layouts.set(composer,{key:JSON.stringify([input.value,input.clientWidth,viewportHeight,folded,style.font,style.letterSpacing,padding,composer.clientHeight]),height});return height;
}
