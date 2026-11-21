/* @file-map:start
文件: link/desktop/ui/project-governance.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  projectGovernanceHTML | function
  governanceForm | function
  governanceForm.payload | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
const commands = {
  ban:'封禁开发者',unban:'恢复开发资格','revise-goal':'修改目标','revise-agenda':'修改议程',
  'approve-agenda':'通过议程','reject-agenda':'拒绝议程',approve:'同意申请',reject:'拒绝申请',
};

export /* @chain-region projectGovernanceHTML | calls: join, sections.map, rows.map, map, operations, escape, Math.max */ function projectGovernanceHTML(page, offset, escape) {
  const sections = [
    ['goals','目标',()=>['revise-goal']],
    ['agendas','议程',row=>row.status==='voting'?['revise-agenda','approve-agenda','reject-agenda']:['revise-agenda']],
    ['members','开发者',row=>[row.disabled?'unban':'ban']],
    ['applications','加入申请',()=>['approve','reject']],
  ];
  const groups=sections.map(([key,title,operations])=>{
    const rows=page[key]||[];
    if(!rows.length)return '';
    return '<section><h3>'+title+'</h3>'+rows.map(row=>{
      const actions=operations(row).map(action=>`<button class="text-button" data-govern="${action}" data-list="${key}" data-row="${escape(row.id)}">${commands[action]}</button>`).join('');
      return `<div class="project-governance-row"><span>${escape(row.title||row.name)}</span><div class="actions">${actions}</div></div>`;
    }).join('')+'</section>';
  }).join('');
  return `<div class="project-governance">${groups||'<p>暂无待管理事项</p>'}
    ${offset||page.has_more?`<nav aria-label="治理分页"><button class="text-button" data-govern-page="${Math.max(0,offset-10)}" ${offset?'':'disabled'}>上一页</button>
      <button class="text-button" data-govern-page="${offset+10}" ${page.has_more?'':'disabled'}>下一页</button></nav>`:''}</div>`;
}

export /* @chain-region governanceForm | calls: page.data.list.find, Object.hasOwn, action.startsWith, fields.push */ function governanceForm(page, data) {
  const row=page?.[data.list]?.find(item=>item.id===data.row);
  if(!row||!Object.hasOwn(commands,data.govern))return null;
  const action=data.govern, isRevision=action.startsWith('revise-');
  const fields=[];
  if(isRevision){
    fields.push({name:'title',label:'标题',short:true,min:4,max:100,value:row.title},
      {name:'summary',label:'说明',min:10,max:500,value:row.summary},
      {name:'acceptance',label:'验收条件',min:10,max:3000,value:row.acceptance});
    if(action==='revise-agenda')fields.push({name:'plan',label:'实施计划',min:20,max:8000,value:row.plan});
  }
  fields.push({name:'reason',label:'处理理由',min:10,max:500});
  const /* @chain-region governanceForm.payload | calls: action.endsWith */ payload=({reason,...changes})=>{
    if(action==='approve'||action==='reject')return {action:'review-application',id:row.id,decision:action==='approve'?'approved':'rejected',reason};
    if(isRevision)return {action,cycle_id:page.cycle_id,id:row.id,version:action==='revise-goal'?page.version:row.version,reason,changes};
    if(action.endsWith('-agenda'))return {action,cycle_id:page.cycle_id,agenda_id:row.id,version:row.version,reason};
    return {action,id:row.id,reason};
  };
  return {title:commands[action]+' · '+(row.name||row.title),fields,payload};
}
