// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/tools/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; p; mark
// Impact: python -B scripts/code-atlas.py show Client/Desktop/tools/print-paths.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 路径解析诊断：把「程序到底会读哪个 config.json / 哪个 Prompt」摊开给人看。
//
// 为什么要把候选列全打出来：这两个程序都靠「第一个存在的候选」决策，
// 只打最终结果的话，用户遇到「界面里改了、终端里没变」时无从判断是
// 候选顺序不同，还是两个程序读的根本不是同一个文件。
//
// 运行：node tools/print-paths.cjs

'use strict';

const fs = require('node:fs');
const p = require('../src/paths.cjs');

/** 候选存在与否 + 是不是目录，一眼可见。 */
function mark(target, wantDir) {
  try {
    const st = fs.statSync(target);
    if (wantDir && !st.isDirectory()) return '（存在但不是目录）';
    return '✔ 存在';
  } catch {
    return '· 不存在';
  }
}

console.log('生效配置文件 :', p.resolveConfigPath(''));
console.log('生效提示词   :', p.resolvePromptDir(''));
console.log('');

console.log('配置文件候选（按优先级，先命中者胜出）:');
p.configCandidates().forEach((c, i) => {
  console.log(`  ${i + 1}. ${mark(c, false)}  ${c}`);
});

console.log('');
console.log('其它位置:');
console.log('  用户配置目录 :', p.userConfigPath(), mark(p.userConfigPath(), false));
console.log('  用户提示词   :', p.userPromptDir(), mark(p.userPromptDir(), true));
console.log('  便携配置探测 :', p.portableConfigPath(), mark(p.portableConfigPath(), false));
