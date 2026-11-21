# OS 内置 Control 与 Link

Control 工位工具位于 `Control/app`，原生 Link 源码位于 `Link/app/link-core`，运行时位于 `Link/app/runtime/link`。三个桌面入口沿同一模块和数据约定工作。兼容脚本只定位本根内置模块；`AIEYRA_LINK_ROOT` 和相邻独立产品不改变源码入口。

在 OS 根目录可执行：

```text
python -B -X utf8 scripts/plugins.py doctor --help
python -B -X utf8 scripts/plugins.py control --help
python -B -X utf8 scripts/plugins.py link --help
python -B -X utf8 scripts/plugins.py station --help
python -B -X utf8 scripts/plugins.py transfer --help
python -B -X utf8 scripts/plugins.py build-link --help
```

兼容入口原样转发参数和退出码。`build-link` 转给本根 `control.py install-link`，要求完整本根源码与 Go 工具链；已有目标不会被静默覆盖。完整发行采用 OS 成套构建和更新流程；`scripts/package-link.py` 仅提示独立安装包已经停用。

工位恢复沿本人档案、真实 native 和实际办公室地址，不因运行兼容命令而另建空办公室。私有状态由源码树外的资料根保存；生命周期、拆出与放回服务的所有权交接见 [Link接入协议](../docs/Link接入与私有适配.md)。主聊天、任务观察窗与 Link 后台服务有各自的生命周期合同。

本文描述当前 Windows 工程入口，不据此宣称手机、跨平台真机或独立发行已经验收。目录职责见[根入口](../INDEX.md)，验证方法见[Link接入协议](../docs/Link接入与私有适配.md)。
