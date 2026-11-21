/* @file-map:start
文件: link/office/scripts/matrix-proof.cjs
位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
下游: 无已解析的项目内静态导入
上游: 入口/动态加载；参阅链路与目录地图
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
// Native device proof. Secrets travel only over stdin/stdout to the local vault.
const { generateKeyPairSync, createPrivateKey, createPublicKey, sign } = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (part) => {
  input += part;
  if (input.length > 100000) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const value = JSON.parse(input);
    if (value.action === 'generate') {
      const pair = generateKeyPairSync('ed25519');
      process.stdout.write(
        JSON.stringify({
          privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
          publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
        }),
      );
    } else if (value.action === 'sign' && typeof value.message === 'string') {
      const key = createPrivateKey(value.privateKey);
      if (key.asymmetricKeyType !== 'ed25519') throw Error();
      process.stdout.write(
        JSON.stringify({
          signature: sign(null, Buffer.from(value.message), key).toString('base64url'),
          publicKey: createPublicKey(key).export({ type: 'spki', format: 'pem' }),
        }),
      );
    } else throw Error();
  } catch {
    process.stderr.write('matrix_proof_failed');
    process.exitCode = 2;
  }
});
