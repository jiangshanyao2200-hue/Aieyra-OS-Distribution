# 官方角色与公开提示词 · 工作协约

遵循[根协约](../../AGENTS.md)；当前职责与迁移边界见[工程地图](../../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：[definitions.go](definitions.go)、[definitions.cjs](definitions.cjs)、[definition.json](Eyra/definition.json)、[definition.json](Eyra/team/definition.json)。

职责：Eyra 持有主设计、team 引用、prompts 下的协定、默认、运行引导、宿主能力说明、连接检测、问候与委派模板；Eyra/context 持有 PAC 实现及公开维护文案及旧潜意识兼容文案；Vaya/Cota 各持有定义与提示词。Go 和 JS 读取同一角色 JSON。

依赖与接口：Core 用定义装配默认名称/工具/提示词，Desktop 设置读同一工具表；实际授权、模型和调度不归这里。PAC 实现遵循 Agent/context/contract，由 Core 提交事务。

资料与状态：本协约逐角色覆盖整个 Eyra/Vaya/Cota 子树。它们是 manifest 包载荷，禁止为了补文档向包内散放 AGENTS 或临时材料；公开默认不含个人四层，已有旧个人覆盖含空文件保留。

开发与验收：在 Agent 运行 go test ./official/...；definitions.test.cjs 通过 Desktop 自测。修改公共文案须同步索引与隐私哈希；角色/默认视觉通过实际团队场景验证。

兼容与交接：manifest 完整文件集和编译嵌入摘要共同校验，改包必须按规则更新。保留左侧大头像、三角色、无字母占位及用户关闭角色状态，不能把样板布局当默认改版。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。
