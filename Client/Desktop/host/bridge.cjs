// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: http; validateDescriptor; supportsWorkspaceAction; unsupportedAction; requestCore
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/bridge.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const http = require('node:http');

function validateDescriptor(value) {
	if(value?.mode==='os'&&!/^[a-f0-9]{32}$/.test(value.session_id||''))throw Error('无效的 OS 会话身份');
  const url = new URL(value?.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/v1/rpc' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.port ||
    !/^[a-f0-9]{64}$/.test(value.token || '')
  )
    throw Error('无效的核心连接');
  return value;
}

function supportsWorkspaceAction(descriptor,action){
  if(['workspace.packages','workspace.paths','workspace.workflows'].includes(action))return Array.isArray(descriptor.capabilities)&&descriptor.capabilities.includes(action);
  if(action!=='workspace.conversation')return true;
  if(Array.isArray(descriptor.capabilities))return descriptor.capabilities.includes(action);
  const match=/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(descriptor.version||'');
  if(!match)return false;
  const [major,minor,patch]=match.slice(1).map(Number);
  return major>0||minor>2||minor===2&&patch>=38;
}
function unsupportedAction(action){
  const message=action==='workspace.conversation'?'当前运行的 OS 内核尚不支持对话智能体。请完成程序更新后重新打开。':'当前运行的程序不支持这项操作，请完成更新后重新打开。';
  return Object.assign(Error(message),{code:'core_update_required',action});
}
function requestCore(descriptor, action, args = {}) {
  validateDescriptor(descriptor);
  if(!supportsWorkspaceAction(descriptor,action))return Promise.reject(unsupportedAction(action));
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ action, arguments: args }));
    if (body.length > 1024 * 1024) return reject(Error('请求内容过大'));
    const request = http.request(
      descriptor.url,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + descriptor.token,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      },
      (response) => {
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) {
            request.destroy(Error('核心响应过大'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200 || !data.ok) {
              // 超时类错误本身不带来源；在详情里记下核心调用名，提示文字仍是同一句摘要。
              const text=data.error || '核心请求未成功',timeout=/context deadline exceeded/i.test(text);
              const error=data.error==='unknown workspace action'?unsupportedAction(action):Error(timeout?text+'\n详情：核心调用 '+action+' 超时':text),receipt=data.send_rejection;
              if(response.statusCode===400&&action==='workspace.task_send'&&['attachment_rejected','not_admitted'].includes(receipt?.code)&&receipt.task_id===args.task_id&&receipt.request_id===args.request_id)
                error.send_rejection={code:receipt.code,task_id:receipt.task_id,request_id:receipt.request_id};
              throw error;
            }
            resolve(data.data);
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      },
    );
    request.setTimeout(action==='workspace.updates'?26*60*1000:65000, () =>
      request.destroy(Error('核心响应超时，请检查状态后重试')),
    );
    request.on('error', reject);
    request.end(body);
  });
}
module.exports = { validateDescriptor, requestCore, supportsWorkspaceAction };
