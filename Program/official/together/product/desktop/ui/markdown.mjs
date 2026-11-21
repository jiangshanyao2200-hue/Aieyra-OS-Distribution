/* @file-map:start
文件: link/desktop/ui/markdown.mjs
位置: 市中心·文本原语 | 文本转义和受限Markdown渲染。
约束: 所有外来文本先转义；不能让代码线索或用户输入变成可执行HTML
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/appearance.mjs, link/desktop/ui/audit.mjs, link/desktop/ui/carousel.mjs, link/desktop/ui/collaboration.mjs, link/desktop/ui/controls.mjs, link/desktop/ui/detail-view.mjs, link/desktop/ui/development.mjs, link/desktop/ui/elections.mjs, link/desktop/ui/engineering.mjs, link/desktop/ui/live.mjs, link/desktop/ui/source-browser.mjs, link/desktop/ui/unified.mjs, link/desktop/ui/welcome.mjs, link/desktop/ui/work-status.mjs, link/desktop/ui/workflow.mjs, link/desktop/ui/workspace.mjs
链路: shared-ui
验证: AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  escape | function
  inline | function
  markdown | function
  markdown.endList | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
export const /* @chain-region escape | calls: replace, String */ escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* @chain-region inline | calls: replace, escape */ function inline(value) {
  // Raw HTML, external images and links remain plain text. Native requests never
  // load attacker-controlled Markdown URLs or execute renderer script.
  return escape(value).replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
}
export /* @chain-region markdown | calls: split, slice, String, Math.min, test, endList, out.push, escape … */ function markdown(source,limit=6000) {
  const lines=String(source||'').slice(0,Math.min(8000,limit)).split('\n');let fenced=false,code=[],out=[],list=false;
  const /* @chain-region markdown.endList | calls: out.push */ endList=()=>{if(list){out.push('</ul>');list=false;}};
  for(const line of lines){
    if(/^```/.test(line)){endList();if(fenced){out.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');code=[];}fenced=!fenced;continue;}
    if(fenced){code.push(line);continue;}
    const heading=/^(#{1,3})\s+(.+)$/.exec(line),bullet=/^[-*]\s+(.+)$/.exec(line);
    if(bullet){if(!list){list=true;out.push('<ul>');}out.push('<li>'+inline(bullet[1])+'</li>');continue;}
    endList();
    if(heading)out.push('<h3>'+inline(heading[2])+'</h3>');
    else if(line.startsWith('> '))out.push('<blockquote>'+inline(line.slice(2))+'</blockquote>');
    else out.push('<p>'+inline(line||' ')+'</p>');
  }
  endList();if(code.length)out.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');return out.join('');
}
