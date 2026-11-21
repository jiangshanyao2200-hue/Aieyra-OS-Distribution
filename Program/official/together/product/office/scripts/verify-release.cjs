/* @file-map:start
文件: link/office/scripts/verify-release.cjs
位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
下游: 无已解析的项目内静态导入
上游: 入口/动态加载；参阅链路与目录地图
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const envelope = JSON.parse(input),
      payload = Buffer.from(envelope.payload, 'base64');
    const publicKey = fs.readFileSync(path.join(__dirname, '../config/release-public.pem'));
    if (!crypto.verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64')))
      throw Error('invalid signature');
    const manifest = JSON.parse(payload.toString('utf8'));
    if (
      manifest.product !== 'aieyra-control' ||
      manifest.schema !== 1 ||
      !Number.isSafeInteger(manifest.sequence) ||
      manifest.sequence < 1
    )
      throw Error('invalid manifest');
    if (JSON.stringify(manifest) !== JSON.stringify(envelope.manifest))
      throw Error('display manifest mismatch');
    process.stdout.write(JSON.stringify(manifest));
  } catch {
    process.stderr.write('release_signature_invalid');
    process.exitCode = 1;
  }
});
