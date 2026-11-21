# 联网搜索工具 · 工作协约

遵循[根协约](../../../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[definition.go](definition.go)、[execute.go](execute.go)、[local.go](local.go)、[ddgs_bridge.py](ddgs_bridge.py)。

职责：拥有schema/手册、取消/本地有界子进程、来源回执和双端视图；原生供应商协议在API/search。

依赖与接口：Core授权并注入原生/后备服务，Python只通过受控桥接运行runtime/search，不直接读取连接Key。

资料与状态：结果保留精确网址与来源，generation/task/Agent/Core代次失效时拒绝迟到投影；unknown不盲目重发。

开发与验收：在 Tool 运行 go test ./base/official/web_search/...；实际来源详情、窄窗滚动/焦点和取消按场景验证，联网调用另列。

兼容与交接：不把普通回答当原生搜索成功；保留用户明确网址和旧手册/空覆盖。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。
