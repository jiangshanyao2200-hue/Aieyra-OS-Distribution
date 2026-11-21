# 受控第三方运行依赖 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[search-runtime.lock.json](../scripts/search-runtime.lock.json)、[provision-search.py](../scripts/provision-search.py)、`LICENSE.txt`（当前工作树未提供：`search/LICENSE.txt`）。

职责：search是本地搜索桥需要的受锁定Python/DDGS及原生依赖，不是自有业务模块源码。

依赖与接口：Tool/web_search经受控桥使用，版本和载荷来自provision-search及lock；不要进入第三方包逐目录新增AGENTS或手改实现。

资料与状态：软件运行依赖与Data/runtime私人状态无关；不在依赖目录保存用户查询、Key或聊天。

开发与验收：改锁/供应链流程核对来源摘要、许可、离线加载和对应搜索测试；不因文档整理重新下载或清理运行时。

兼容与交接：部署随交付清单，第三方版本升级单独验兼容；目录名runtime不是递归删除许可。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。
