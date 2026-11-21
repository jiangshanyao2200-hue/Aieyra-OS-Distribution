/* @file-map:start
文件: link/desktop/offline.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: link/desktop/main.cjs, link/desktop/offline.html
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
document.querySelector('#retry').addEventListener('click', async event => {
  event.target.disabled = true;
  try { await window.linkHost.retry(); }
  finally { event.target.disabled = false; }
});
