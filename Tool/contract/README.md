# 工具共同契约

现有工具工厂的版本定义、身份摘要、受限JSON输入schema、参数和声明式呈现校验归此模块。Core的注册、持久记录读取、实际工具调用与活动回执均消费同一规则；原纯校验测试随实现迁入，Core继续测试真实注册/执行/权限和损坏记录。

`CustomDigest`保持原有有效JSON的版本ID，并拒绝不能序列化的定义；它是既有本地版本标识，不代替Mod包签名。`ValidateArguments`先校验schema，再检查实际参数，未知类型或缺失结构返回错误。`ValidateCustom`在新注册时要求呈现；宿主按原规则补默认cards/terminal，历史未声明呈现的记录允许兼容读取。

Core仍负责能力授权、阶段开关、存储和执行；模块不因schema合格授予工具权限。桌面只使用受信任的声明式组件，不执行呈现中的HTML或JS。可下载Tool/Toolbox/Workbox还必须通过共同包服务的身份、版本、权限、依赖及运行时检查，这些Mod种类已由同一登记服务和实际消费者接入，具体格式见packages.md及Tool/workbox。
