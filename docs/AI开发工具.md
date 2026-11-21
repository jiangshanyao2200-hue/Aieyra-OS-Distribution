# AI开发工具与接续

从当前任务恢复后，用本页的三个入口定位共同实现、保存检查点、追踪真实观察的问题。它们复用代码地图和AIDEBUG，不执行记录中的动作，也不创建新模型执行器。人类与未来编程Agent使用同一接口；执行权限仍由原Core和使用者授权决定。

先读当前任务及适用的AGENTS，再按需读源文件。工具输出提供导航和可核对的记录；测试通过、实际运行、原生可见和人工接受分别取证。下列命令适用于提供相应工具、索引及完整来源的主工程。公开软件包只有导航文档时，先看机器地图的distribution缺项；缺少AIDEBUG等来源时不能直接运行相应命令或声称全图有效。不要扩大公开源码范围来补运行资料。

## 按需上下文

```text
python -B scripts/code-atlas.py context Client/Desktop/ui/chat-column.mjs --limit 12 --depth 1 --out <主工程 AIDEBUG 下新的绝对 JSON 路径>
python -B scripts/code-atlas.py context chain:development --out <另一主工程 AIDEBUG 下新的绝对 JSON 路径>
python -B scripts/code-atlas.py context-check <绝对上下文JSON路径>
```

context聚合所属模块、城市层级、祖先AGENTS、共同链约束、静态消费者、导入、Go同目录候选和建议验证入口，并给出真实文件行号。readOrder只列接下来需要读取的文件，不复制整份源码、私人任务或提示词。默认最多12文件、每文件4个锚点/导入/消费者，depth为0至3；计数明确说明截断。链的全部种子必须保留，不能靠缩小limit漏掉共同所有者。

默认输出上限24000字符，超出即失败，不截断规则；可减limit/depth，或显式设置--max-chars，范围4000至100000。--out只创建主工程 AIDEBUG 下的新文件，保留旧上下文。上下文绑定源文件库存、正文、导航契约和实际读取协约；新增消费者、其他索引文件修改、规则变化、换工程或修改包内容均会失效。改源码后先refresh/check，再收集新包；旧包可作为历史保留，不能继续当当前导航。

BFS和字面量导入只提供有界候选。动态IPC、事件、CSS、模板、实例所有权及实际生命周期仍须沿人工链和实现核对。source摘要不是完整产品构建摘要，也不能代替实际EXE来源证明。

## 私人任务检查点

```text
python -B scripts/development-session.py checkpoint <主工程 AIDEBUG 下的绝对日志目录> --input <主工程 AIDEBUG 下的绝对更新 JSON>
python -B scripts/development-session.py resume <同一绝对日志目录>
python -B scripts/development-session.py checkpoint <同一绝对日志目录> --expect-head <上次headSHA256> --input <下一份绝对更新JSON>
```

第一次输入可从下例开始。requests保留逐字原文，appendRequests只追加；不要把密钥、完整私人配置或数据库作为证据。原文很长时保留在私人任务MD，同时在检查点引用该文件。

```json
{
  "goal": "核对并修复共同聊天外观的受影响消费者",
  "appendRequests": ["这里填写使用者逐字要求"],
  "constraints": ["沿用共同实现；运行证据在主工程 AIDEBUG；记录实际使用的程序和资料"],
  "next": ["读取上下文包中的共同所有者和适用协约"],
  "items": [{"id":"shared-chat", "summary":"共同所有者和消费者一起核验", "status":"active"}],
  "references": [],
  "failures": [],
  "resources": []
}
```

每次追加生成checkpoint-000001.json等新原件，保存上一版本摘要。更新必须携带resume的headSHA256；并发写者不能覆盖同一版本。恢复核对整个版本链、原文保留、引用的实际字节和当前上下文有效性，再返回下一步、未完成项、失败、活动/未知资源及原话。外部文件丢失或变化时返回非零，仍列referenceProblems和待检查资源，不替人清理或重试。

| 数据 | 要求 |
| --- | --- |
| items | 稳定id、summary、status；pending/active/done/deferred；done必须引用证据，deferred须reason |
| failures | 稳定id、summary、原始evidence引用；open/resolved/deferred；resolved另给verification引用和reason |
| resources | 稳定id、summary、kind、identifier、带时区startedAt、status；kind为gui/process/tool-session/request；released须退出证据 |
| references | 稳定id、绝对file、kind；evidence/context/source/note；只绑定文件摘要，不把内容执行为命令 |
| status | active/complete；未完成工作、未处理失败或未释放资源阻止complete |

evidence和verification使用references的id数组。旧工作、失败、资源和引用不能静默移除。证据引用保持同一路径与摘要；新证据使用新id。source只引用索引或公开文档内的源码，可在后续版本更新；context默认必须通过context-check。旧上下文失效后，在下一份references输入中将该引用标为historical:true，再加入新的当前context；历史包保留原字节。

输入references只提供id/file/kind及可选historical，不复制工具计算的sha256字段。checkpoint及输入限1MiB，每类列表最多100条，单个引用最多64MiB，日志最多10000版本，超限明确失败。哈希链检测漂移，不认证作者；保存已知head到私人接续点，再用resume --expect-head核对，才能发现日志末尾被删除。活动进程是否仍在、是否归本人及是否正常退出，仍以PID＋启动时间和真实退出回执核验。

## 日常桌面验收

从桌面原快捷方式进入产品。前台使用实际用户窗、原生控件和 Windows 屏幕像素，后台读取同一进程的运行状态。操作步骤、实看登记与构建核对见 [AIDEBUG 操作手册](AIDEBUG.md)。
