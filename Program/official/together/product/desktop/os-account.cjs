/* @file-map:start
文件: link/desktop/os-account.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/os-account-connection.test.cjs, link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/os-account-connection.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  bindOSAccount | function
  bindOSAccount.report | function
  bindOSAccount.invalidate | function
  bindOSAccount.sync | function
  bindOSAccount.connection | method
  bindOSAccount.status | method
  bindOSAccount.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';

/* @chain-region bindOSAccount */ function bindOSAccount({ account, cloud, changed }) {
  let binding, request, status = 'waiting', closed = false;
  const /* @chain-region bindOSAccount.report | calls: changed */ report = next => {
    if (next === status) return;
    status = next;
    changed({ hostAuth: status });
  };

  /* @chain-region bindOSAccount.invalidate | calls: account.read, request.controller.abort, catch, cloud.logout, cloud.cancelLogin, report */ function invalidate() {
    const current = account.read();
    if (current?.sessionKey === binding?.sessionKey && current?.userID === binding?.userID) return;
    binding = current || null;
    if (request?.binding) {
      request.controller.abort();
      request = null;
    }
    if (cloud.session) void cloud.logout().catch(() => {});
    else cloud.cancelLogin();
    report(binding ? 'waiting' : 'signed-out');
  }

  /* @chain-region bindOSAccount.sync | calls: Promise.resolve, invalidate, cloud.state, report, AbortController, account.refresh, signal.throwIfAborted, account.read … */ function sync({ refresh = false } = {}) {
    if (closed) return Promise.resolve();
    invalidate();
    if (request) return request.promise;
    if (cloud.state().signedIn && !refresh && status === 'ready') return Promise.resolve(cloud.state());
    if (!binding && !refresh) {
      report('signed-out');
      return Promise.resolve();
    }
    const entry = { binding, controller: new AbortController(), promise: null };
    const signal = entry.controller.signal;
    request = entry;
    if (status !== 'ready') report('connecting');
    entry.promise = (async () => {
      try {
        if (!binding) await account.refresh();
        signal.throwIfAborted();
        binding = account.read() || null;
        entry.binding = binding;
        if (!binding) {
          report('signed-out');
          return;
        }
        let result;
        if (cloud.state().signedIn) {
          result = await cloud.refresh(signal);
        } else {
          const url = await cloud.beginLogin({ signal });
          const callback = await account.authorize(binding, url, signal);
          result = await cloud.completeLogin(callback, { expectedUser: binding.userID, signal });
        }
        signal.throwIfAborted();
        report('ready');
        return result;
      } catch (error) {
        if (signal.aborted) return;
        cloud.cancelLogin();
        report('unavailable');
        throw error;
      } finally {
        if (request === entry) request = null;
      }
    })();
    return entry.promise;
  }

  return {
    sync,
    invalidate,
    /* @chain-region bindOSAccount.connection | calls: cloud.state */ connection() {
      const authenticated = cloud.state().signedIn;
      const state = status === 'ready' ? (authenticated ? 'online' : 'unavailable') : status;
      return {state, authenticated, online: state === 'online'};
    },
    /* @chain-region bindOSAccount.status */ status: () => status,
    /* @chain-region bindOSAccount.close | calls: request.controller.abort, cloud.close, catch, cloud.logout */ close() {
      closed = true;
      request?.controller.abort();
      cloud.close();
      if (cloud.session) void cloud.logout().catch(() => {});
    },
  };
}

module.exports = { bindOSAccount };
