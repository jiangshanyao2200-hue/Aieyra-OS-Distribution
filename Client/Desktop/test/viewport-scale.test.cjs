// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; assert
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/viewport-scale.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 自由窗口不隐式改变阅读大小；用户主动缩放由宿主单独处理。
const test = require('node:test');
const assert = require('node:assert/strict');

test('free window dimensions retain one reading scale on either axis', async () => {
  const { viewportScale, VIEWPORT } = await import('../ui/viewport.mjs');
  assert.equal(viewportScale(1280, 800), 1, 'reference window is 1:1');
  assert.equal(viewportScale(1920, 1080), 1, 'a bigger window only adds space');
  for(const [width,height] of [[960,600],[640,360],[640,900],[2000,400],[1100,700]])assert.equal(viewportScale(width,height),1);
  assert.equal(VIEWPORT.min,1);
});

test('the host writes one --ui-scale and combines it with the user interface scale', async () => {
  const { setupViewportScale } = await import('../ui/viewport.mjs');
  const written = [];
  const listeners = [];
  const host = setupViewportScale({
    win: { innerWidth: 1280, innerHeight: 800, addEventListener: (name, fn) => listeners.push([name, fn]) },
    apply: value => written.push(value),
  });
  assert.deepEqual(written, ['1']);
  assert.equal(host.scale, 1);
  listeners[0][1](); // 尺寸没变：不再重复写
  assert.equal(written.length, 1);
  host.refresh();
  assert.equal(written.length, 1);
});
