# 远程 Link 办公室 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：`server.py`（当前工作树未提供：`server.py`）、[protocol.py](protocol.py)、`remote_runtime.py`（当前工作树未提供：`remote_runtime.py`）、`README.zh-CN.md`（当前工作树未提供：`client/README.zh-CN.md`）。

职责：提供远程办公室、设备/会话协议、受控远端runtime与Web终端；client提供正式轻量接入，examples只含脱敏模板。

依赖与接口：HTTPS/设备撤销/远端执行授权服务端执行；本机办公室与远端模型进程分别持有身份，不从一个队列回执推定实读。

资料与状态：云密钥、远端凭据和运行日志在私有根；公开样板不含实际设备或项目正文。

开发与验收：Python-B运行本目录test_cloud/test_remote/test_remote_runtime/test_admin_remote对应检查，client有Node测试；本地夹具、远端连通与真实模型执行分别留证。

兼容与交接：不关闭TLS校验，不以旧群聊授权远端任务；生产操作与发送公开消息须用户明确授权。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。
