// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/tools/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; path; root; files; run; mode
// Impact: python -B scripts/code-atlas.py show Client/Desktop/tools/check.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

function files(directory, accepts) {
  return fs.readdirSync(path.join(root, directory), {withFileTypes: true})
    .filter(entry => entry.name !== 'node_modules' && entry.name !== '.git')
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const name = path.posix.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Check input must not be a symlink: ' + name);
      return entry.isDirectory() ? files(name, accepts) : accepts(name) ? [name] : [];
    });
}

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {cwd: root, env, stdio: 'inherit', windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Check failed with exit code ' + (result.status || 1));
}

const mode = process.argv[2];
if (mode === 'syntax') {
  require('../../../SDK/tools/theme-catalog.cjs').sync(true);
  const sources = ['src', 'renderer', 'ui', 'host', 'tools', 'test']
    .flatMap(directory => files(directory, name => /\.(?:[cm]?js)$/.test(name)));
  for(const dir of ['../../Halo/runtime','../../Halo/contract','../../Halo/official','../../Program/runtime','../../Program/official','../../SDK/tools','../../Theme/runtime','../../Theme/showcase','../../Theme/contract','../../Theme/official','../../Tool/base/official','../../Tool/toolbox/official','../../Tool/presentation','../../Tool/workbox','../../Agent/official','../../Contracts/resources','../../Contracts/storage'])if(fs.existsSync(path.join(root,dir)))sources.push(...files(dir,name=>/\.(?:[cm]?js)$/.test(name)));
  for (const name of sources) run(['--check', name]);
  console.log('Syntax checked ' + sources.length + ' files.');
} else if (mode === 'test') {
  const tests = files('test', name => name.endsWith('.test.cjs'));
  for(const dir of ['../../Halo/test','../../Tool/base/official','../../Tool/toolbox/official','../../Tool/presentation','../../Tool/workbox','../../Agent/official'])if(fs.existsSync(path.join(root,dir)))tests.push(...files(dir,name=>name.endsWith('.test.cjs')));
  if (!tests.length) throw Error('No tests found.');
  // Never let a default-path test discover the portable production config.
  // Only public resources enter the fixture; account settings and Data do not.
  const source = require('../src/resources.cjs').root();
  const scratch = path.resolve(root, '../../../AIDEBUG/.test-temp');
  fs.mkdirSync(scratch, {recursive: true});
  const isolated = fs.mkdtempSync(path.join(scratch, 'desktop-'));
  try {
    const temp = path.join(isolated, 'tmp');
    fs.mkdirSync(temp);
    fs.mkdirSync(path.join(isolated, 'Config'));
    for (const name of ['默认设置.json', '模型目录.json', '模型资料.json', '运行参数.json', '提示词索引.json', 'OpenCode模型.json', '终端配色.json'])
      fs.copyFileSync(path.join(source, 'Config', name), path.join(isolated, 'Config', name));
    const index = JSON.parse(fs.readFileSync(path.join(source, 'Config', '提示词索引.json'), 'utf8'));
    const prompts = new Set(require('../../../Contracts/resources/prompts.cjs').parse(index).files());
    for (const name of prompts) {
      const dest = path.join(isolated, name);
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      fs.copyFileSync(path.join(source, name), dest);
    }
    run(['--test', '--test-concurrency=1', '--test-timeout=120000', ...tests], {...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, AIEYRA_RESOURCE_ROOT: isolated, APPDATA: path.join(isolated, 'UserData')});
  } finally {
    fs.rmSync(isolated, {recursive: true, force: true, maxRetries: 5});
  }
} else {
  throw Error('Usage: node tools/check.cjs syntax|test');
}
