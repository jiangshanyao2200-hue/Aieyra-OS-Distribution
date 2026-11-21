/* @file-map:start
文件: link/desktop/ui/controls.mjs
位置: 市中心·界面原语 | 头像、成员属性、导航按钮与分页的唯一共享HTML契约。
约束: 只生成转义后的结构，不读取页面状态或调用业务API；保留data-*、aria-current和disabled契约；由调用方决定权限与分页游标
下游: link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs
上游: AIDEBUG/controls.test.mjs, link/desktop/ui/engineering.mjs, link/desktop/ui/unified.mjs, link/desktop/ui/workspace.mjs
链路: shared-ui
验证: AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  userAttributes | function
  avatar | function
  railButton | function
  pagerHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {icon} from './icons.mjs';

// One markup contract for page modules; handlers continue to own authorization.
export /* @chain-region userAttributes | calls: test, e, Number */ function userAttributes(user){
 return /^[a-f0-9]{32}$/.test(user?.id||'')?`data-user-id="${e(user.id)}" data-user-name="${e(user.name||'')}" data-user-role="${e(user.role||'')}" data-user-muted="${Number(user.muted_until)||0}" data-user-banned="${!!user.disabled}"`:'';
}
export /* @chain-region avatar | calls: userAttributes, test, e, Array.from */ function avatar(user){
 const attributes=userAttributes(user);
 return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(user?.avatar||'')?`<img class="avatar" ${attributes} src="${e(user.avatar)}" alt="">`:`<span class="avatar" ${attributes} aria-hidden="true">${e(Array.from(user?.name||'E')[0])}</span>`;
}
export /* @chain-region railButton | calls: test, Error, e, icon */ function railButton(key,label,kind,active){
 if(!/^[a-z][a-z0-9-]*$/.test(kind))throw Error('invalid_navigation_attribute');
 return `<button class="ui-rail-button ${active?'active':''}" data-${kind}="${e(key)}" aria-current="${active?'page':'false'}"><i class="ui-rail-icon">${icon(key)}</i><span class="ui-rail-label">${e(label)}</span></button>`;
}
export /* @chain-region pagerHTML | calls: test, includes, Error, e */ function pagerHTML({attribute,previous,next,page,canPrevious,canNext,label='',tag='nav'}){
 if(!/^data-[a-z][a-z0-9-]*$/.test(attribute)||!['nav','div'].includes(tag))throw Error('invalid_pagination_contract');
 return `<${tag} class="pager"${label?` aria-label="${e(label)}"`:''}><button ${attribute}="${e(previous)}" ${canPrevious?'':'disabled'}>上一页</button>${page===undefined?'':`<span>${e(page)}</span>`}<button ${attribute}="${e(next)}" ${canNext?'':'disabled'}>下一页</button></${tag}>`;
}
