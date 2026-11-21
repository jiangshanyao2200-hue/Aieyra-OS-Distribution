// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; pass; t; ours
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/automation-safety.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 验证「自动化只操作自己启动的应用」这条安全判定。
// 之前的自动化直接拿 9222 端口上的任意页面点击，那是真实隐患：
// 端口上若是别的应用，click 会落在别人的界面上。
const assert = require('node:assert');
const { identifyPage, EXPECTED_TITLE } = require('./ui-identity.cjs');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✖ ' + name + '\n      ' + e.message); }
}

const ours = {
  title: EXPECTED_TITLE,
  url: 'file:///C:/fixtures/Aieyra%20OS/Client/Desktop/renderer/index.html',
};

t('本应用的页面通过', () => {
  assert.strictEqual(identifyPage(ours), null);
});

t('Windows 反斜杠路径也通过', () => {
  assert.strictEqual(identifyPage({
    title: EXPECTED_TITLE,
    url: 'file:///C:\\fixtures\\Aieyra OS\\Client\\Desktop\\renderer\\index.html',
  }), null);
});

t('别的应用被拒绝（标题不符）', () => {
  const why = identifyPage({ title: 'Aieyra Workspace', url: ours.url });
  assert.ok(why && why.includes('标题'), '应因标题不符被拒绝');
});

t('别的应用被拒绝（路径不符）', () => {
  const why = identifyPage({ title: EXPECTED_TITLE, url: 'file:///C:/other/app/index.html' });
  assert.ok(why && why.includes('不是本应用'), '应因路径不符被拒绝');
});

t('http 远端同名路径被拒绝', () => {
  const why = identifyPage({ title: EXPECTED_TITLE, url: 'http://evil/Client/Desktop/renderer/index.html' });
  assert.ok(why && why.includes('不是本应用'), 'http 远端即使路径含子串也应被拒绝（S4）');
});

t('端口上什么都没有被拒绝', () => {
  assert.ok(identifyPage(null), '应返回拒绝原因');
});

t('空标题被拒绝', () => {
  assert.ok(identifyPage({ title: '', url: ours.url }));
});

t('DevTools 页面被拒绝', () => {
  assert.ok(identifyPage({ title: 'DevTools', url: 'devtools://devtools/bundled/inspector.html' }));
});

console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
