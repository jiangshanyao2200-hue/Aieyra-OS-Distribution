# 桌面检查与原生辅助工具 · 工作协约

遵循[根协约](../../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[computer-use.ps1](computer-use.ps1)、[computer-input.cs](computer-input.cs)、[check.cjs](check.cjs)、`screenshot.cjs`（当前工作树未提供：`screenshot.cjs`）、[ui-identity.cjs](../test/ui-identity.cjs)、`build-icons.cjs`（当前工作树未提供：`build-icons.cjs`）。

职责：computer-use.ps1与computer-input.cs组成受控Windows电脑操作入口，二者必须共同进入运行清单；C#按普通文本完整隐私扫描，不作摘要豁免。check.cjs装配syntax/selftest并同步Theme目录；build-icons/ensure-electron等维护受锁依赖和资产；screenshot为手动截图入口，身份校验直接复用Client/Desktop/test/ui-identity.cjs。

依赖与接口：被npm脚本和AIDEBUG消费。25个旧verify-*经消费者核对已退役并逐文件SHA归档工程外，不再把它们列为可用入口。稳定场景复用AIDEBUG共同Run，不复制模型请求、业务状态或进程调度。

资料与状态：只操作本人启动且核验归属的测试窗口，截图/日志/临时资料显式放工程外；不从默认CDP端口猜窗口属于本人，不抢焦点、不改剪贴板或系统显示。

开发与验收：在Client/Desktop执行npm run -s syntax及改动对应自测；更新UI检查还核目录/源码范围，原生适配用本人窗口实际验收。普通文档改动不重新跑完整产品测试。

兼容与交接：screenshot默认写系统临时目录；原生Terminal旧入口早已不存在，不造伪兼容。历史失败/旧验证脚本保留工程外，实际原生窗口和GUI结果须另验，源码身份检查通过不等于新GUI通过。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。
