/* @file-map:start
文件: link/desktop/request-gate.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/cloud-recovery.test.cjs, AIDEBUG/request-gate.test.cjs, link/desktop/cloud-client.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/cloud-recovery.test.cjs, AIDEBUG/request-gate.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  RequestGate | class
  RequestGate.constructor | method
  RequestGate.reset | method
  RequestGate.run | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';

// Coalesce reads, respect the existing budget and backpressure. Never replay writes.
/* @chain-region RequestGate */ class RequestGate {
  /* @chain-region RequestGate.constructor | calls: Promise, setTimeout, Object.assign, Map, reset */ constructor({now = Date.now, random = Math.random, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    Object.assign(this, {now, random, sleep}); this.flights = new Map(); this.reset();
  }
  /* @chain-region RequestGate.reset | calls: now, flights.clear */ reset() { this.epoch = (this.epoch || 0) + 1; this.failures = 0; this.retryAt = 0; this.tokens = 40; this.at = this.now(); this.flights.clear(); }
  /* @chain-region RequestGate.run | calls: signal.throwIfAborted, flights.get, now, finally, then, Promise.resolve, Object.assign, Error … */ async run(key, read, action, bypass = false, signal, deferThrottle = false) {
    signal?.throwIfAborted();
    const pending = read && this.flights.get(key);
    if (pending && pending.signal === signal) return pending.result;
    const epoch = this.epoch,started=this.now();
    const flight = {signal};
    flight.result = Promise.resolve().then(async () => {
      let waited = 0;
      for (let attempt = 0; ; attempt++) {
        while (!bypass) {
          signal?.throwIfAborted();
          if (epoch !== this.epoch) throw Object.assign(Error('账号已切换，请重新读取。'), {status:401});
          const now = this.now();
          this.tokens = Math.min(40, this.tokens + Math.max(0, now - this.at) * 3 / 1000); this.at = now;
          const delay = Math.max(0, this.retryAt - now, Math.ceil((1 - this.tokens) * 1000 / 3));
          if (!delay) break;
          if (waited + delay > 5000) throw Object.assign(Error(`连接正在恢复，约 ${Math.ceil(delay/1000)} 秒后自动更新。`), {status:429,retryAfter:Math.ceil(delay/1000)});
          waited += delay; await this.sleep(delay);
        }
        this.tokens = Math.max(0, this.tokens - 1);
        try {
          signal?.throwIfAborted();
          const value = await action();
          signal?.throwIfAborted();
          if (epoch === this.epoch && this.now() >= this.retryAt) this.failures = 0;
          return value;
        } catch (error) {
          signal?.throwIfAborted();
          if (!bypass && epoch === this.epoch && [429, 502, 503, 504].includes(error.status)) {
            this.failures = Math.min(8, this.failures + 1);
            const hinted = Number(error.retryAfter) || 0;
            const delay = read && error.status === 429 && hinted > 0
              ? Math.max(2, hinted) + (deferThrottle ? 0 : Math.min(24, hinted * 2 * (this.failures - 1)) * this.random())
              : Math.max(hinted, Math.min(60, 2 ** this.failures) * (1 + this.random() * .25));
            this.retryAt = Math.max(this.retryAt, this.now() + Math.min(3600, delay) * 1000);
            error.retryAfter = Math.ceil((this.retryAt - this.now()) / 1000);
            if (read && attempt === 0 && !(deferThrottle && error.status === 429) &&
                Math.max(waited,this.now()-started) + this.retryAt - this.now() <= 5000) continue;
          }
          throw error;
        }
      }
    }).finally(() => { if (this.flights.get(key) === flight) this.flights.delete(key); });
    if (read) this.flights.set(key, flight);
    return flight.result;
  }
}
module.exports = {RequestGate};
