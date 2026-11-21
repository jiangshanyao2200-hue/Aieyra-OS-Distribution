/* @file-map:start
文件: link/desktop/service-host.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/main.cjs
链路: startup
验证: AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  health | function
  ServiceHost | class
  ServiceHost.constructor | method
  ServiceHost.start | method
  ServiceHost.start.handshake | function
  ServiceHost.start.finish | function
  ServiceHost.start.onLine | function
  ServiceHost.closeLease | method
  ServiceHost.stop | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

/* @chain-region health | calls: Promise, http.get, response.resume, response.on, resolve, reject, Error, response.setEncoding … */ function health(origin, expectedScope) {
  return new Promise((resolve, reject) => {
    const request = http.get(origin + '/api/health', { timeout: 5000 }, response => {
      if (response.statusCode !== 200 || !expectedScope) {
        response.resume();
        response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error('health_unavailable')));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 8192) request.destroy(new Error('invalid_health_response'));
      });
      response.on('end', () => {
        try {
          const value = JSON.parse(body);
          if (value?.service === 'aieyra-together-link' && value.profile_scope === expectedScope) {
            resolve();
            return;
          }
        } catch {
          reject(new Error('invalid_health_response'));
          return;
        }
        reject(new Error('legacy_office_scope_mismatch'));
      });
    });
    request.on('timeout', () => request.destroy(new Error('health_timeout')));
    request.on('error', reject);
  });
}

// Own one local office. Closing the lease requests a drained shutdown, never a kill.
/* @chain-region ServiceHost */ class ServiceHost {
  /* @chain-region ServiceHost.constructor | calls: some, path.isAbsolute, Error, test, URL, path.resolve, map, path.relative … */ constructor({ linkRoot, dataRoot, runtimeRoot, nodeExecutable, legacyOffice, onExit = () => {} }) {
    if (legacyOffice) {
      const { configFile, stateRoot, origin, scope, hubRoot } = legacyOffice;
      if ([legacyOffice.dataRoot, legacyOffice.runtimeRoot, stateRoot, configFile, hubRoot].some(value =>
        typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('absolute_legacy_office_paths_required');
      if (typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope)) {
        throw new Error('invalid_legacy_office_scope');
      }
      const url = new URL(origin);
      if (!url.port || url.origin !== origin || url.hostname !== '127.0.0.1' || url.protocol !== 'http:') {
        throw new Error('invalid_legacy_office_origin');
      }
      dataRoot = path.resolve(legacyOffice.dataRoot);
      runtimeRoot = path.resolve(legacyOffice.runtimeRoot);
      const privatePaths = [runtimeRoot, stateRoot, configFile, hubRoot].map(value => path.resolve(value));
      for (const value of [dataRoot, ...privatePaths]) {
        const relative = path.relative(linkRoot, value);
        if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
          throw new Error('private_data_must_be_outside_software');
        }
      }
      if (!fs.statSync(dataRoot).isDirectory() || !fs.statSync(runtimeRoot).isDirectory() ||
          !fs.statSync(stateRoot).isDirectory() || !fs.statSync(configFile).isFile() ||
          !fs.statSync(hubRoot).isDirectory()) {
        throw new Error('legacy_office_files_missing');
      }
      this.legacyOffice = { origin, configFile, stateRoot, scope, hubRoot: path.resolve(hubRoot), port: url.port };
    }
    for (const value of [linkRoot, dataRoot, runtimeRoot]) {
      if (!path.isAbsolute(value)) throw new Error('absolute_paths_required');
    }
    const relative = path.relative(linkRoot, dataRoot);
    if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      throw new Error('private_data_must_be_outside_software');
    }
    Object.assign(this, { linkRoot, dataRoot, runtimeRoot, nodeExecutable, onExit });
    this.ownerID = crypto.randomBytes(16).toString('hex');
    this.token = crypto.randomBytes(32).toString('hex');
    this.peers = new Set();
    this.stopping = false;
    this.origin = '';
    this.exitCode = null;
  }

  /* @chain-region ServiceHost.start | calls: Error, path.join, fs.existsSync, net.createServer, peers.add, socket.on, peers.delete, socket.setTimeout … */ async start() {
    if (this.listener || this.stopping) throw new Error('host_already_used');
    const office = path.join(this.linkRoot, 'office');
    const python = path.join(this.linkRoot, 'runtime', 'python', 'python.exe');
    const entry = path.join(office, 'service', 'main.py');
    if (!fs.existsSync(python) || !fs.existsSync(entry)) throw new Error('local_runtime_missing');
    this.listener = net.createServer(socket => {
      this.peers.add(socket);
      socket.on('close', () => this.peers.delete(socket));
      socket.on('error', () => {});
      socket.setTimeout(4000, () => socket.destroy());
      let buffer = '';
      const /* @chain-region ServiceHost.start.handshake | calls: data.toString, socket.destroy, buffer.includes, socket.removeListener, socket.setTimeout, socket.write */ handshake = data => {
        buffer += data.toString('ascii');
        if (buffer.length > 128) return socket.destroy();
        if (!buffer.includes('\n')) return;
        // The office and its native Link children share this authenticated owner.
        if (this.stopping || this.peers.size > 64 || buffer !== this.token + '\n') return socket.destroy();
        socket.removeListener('data', handshake);
        socket.setTimeout(0);
        socket.write('aieyra-os-owner/1\n');
      };
      socket.on('data', handshake);
    });
    await new Promise((resolve, reject) => {
      this.listener.once('error', reject);
      this.listener.listen(0, '127.0.0.1', resolve);
    });
    if (this.stopping) {
      this.closeLease();
      throw new Error('local_start_cancelled');
    }
    // Never inherit an OS office, device identity, owner or interpreter configuration.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(AIEYRA_|PYTHON|ELECTRON_|NODE_OPTIONS$)/i.test(key)));
    Object.assign(env, {
      AIEYRA_CONTROL_HOME: office,
      AIEYRA_CONTROL_DATA: this.dataRoot,
      AIEYRA_CONTROL_STORAGE: path.join(this.dataRoot, 'storage.json'),
      AIEYRA_TOGETHER_RUNTIME: this.runtimeRoot,
      AIEYRA_OS_OWNER_PORT: String(this.listener.address().port),
      AIEYRA_OS_OWNER_TOKEN: this.token,
      AIEYRA_LINK_LAN_AUTO: '0',
      PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
    });
    if (this.nodeExecutable) env.AIEYRA_CONTROL_NODE = this.nodeExecutable;
    const args = ['-X', 'utf8', '-B', entry, '--os-managed', '--os-owner-stdin', '--owner-kind=link'];
    if (this.legacyOffice) {
      env.AIEYRA_CONTROL_SCOPE = this.legacyOffice.scope;
      env.AIEYRA_LINK_DATA_DIR = this.legacyOffice.hubRoot;
      args.push('--port', this.legacyOffice.port, '--config', this.legacyOffice.configFile, '--data-dir', this.legacyOffice.stateRoot);
    } else {
      args.push('--port=0');
    }
    this.child = spawn(python, args, {
      cwd: office, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = new Promise(resolve => {
      this.child.once('close', (code, signal) => {
        this.exitCode = code;
        this.signal = signal;
        this.closeLease();
        resolve({ code, signal });
        if (!this.stopping) this.onExit({ code, signal });
      });
    });
    this.child.stdin.on('error', () => {});
    this.diagnostics = '';
    this.child.stderr.on('data', data => {
      this.diagnostics = (this.diagnostics + data.toString('utf8')).slice(-12000);
    });
    const lines = readline.createInterface({ input: this.child.stdout });
    const ready = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('local_service_start_timeout')), 30000);
      const /* @chain-region ServiceHost.start.finish | calls: clearTimeout, lines.removeListener, reject, resolve */ finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        lines.removeListener('line', onLine);
        error ? reject(error) : resolve(result);
      };
      const /* @chain-region ServiceHost.start.onLine | calls: finish, Error, JSON.parse, URL */ onLine = line => {
        if (line.length > 65536) return finish(new Error('invalid_service_response'));
        let value;
        try { value = JSON.parse(line); } catch { return; }
        if (value.type === 'control.error') return finish(new Error(value.code || 'local_service_error'));
        if (value.type !== 'control.ready') return;
        try {
          const url = new URL(value.url);
          if (!value.owned || value.owner_id !== this.ownerID || value.pid !== this.child.pid ||
              value.service !== 'aieyra-together-link' || url.hostname !== '127.0.0.1' ||
              url.protocol !== 'http:' || !url.port || url.username || url.password ||
              url.pathname !== '/' || url.search || url.hash ||
              (this.legacyOffice && url.origin !== this.legacyOffice.origin)) throw new Error();
          this.origin = url.origin;
          finish(null, this.origin);
        } catch { finish(new Error('invalid_service_owner')); }
      };
      lines.on('line', onLine);
      this.child.once('error', () => finish(new Error('local_service_spawn_failed')));
      this.exited.then(() => finish(new Error('local_service_exited')));
    });
    this.child.stdin.write(JSON.stringify({ type: 'owner.hello', owner_id: this.ownerID }) + '\n');
    try {
      await ready;
      await health(this.origin, this.legacyOffice?.scope);
      return this.origin;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /* @chain-region ServiceHost.closeLease | calls: peer.destroy, peers.clear, listener.close */ closeLease() {
    for (const peer of this.peers) peer.destroy();
    this.peers.clear();
    if (this.listener?.listening) this.listener.close();
  }

  /* @chain-region ServiceHost.stop | calls: child.stdin.end, JSON.stringify, closeLease */ async stop() {
    if (!this.stopping) {
      this.stopping = true;
      if (this.child?.stdin.writable) {
        this.child.stdin.end(JSON.stringify({ type: 'owner.shutdown', owner_id: this.ownerID }) + '\n');
      }
      this.closeLease();
    }
    return this.exited ? this.exited : { code: 0, signal: null };
  }
}
module.exports = { ServiceHost, health };
