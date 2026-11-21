# API 与公共模型协议

| 模块 | 职责与消费者 |
| --- | --- |
| `Contracts/protocol` | Message、ToolCall、Usage、模型 Event/RetryInfo 和终端接口的权威定义；Core、API、工具、CLI 引用 |
| `API/transport` | HTTP 连接、四协议路由与请求、超时、禁止重定向、请求头、会话/缓存键、APIError、Retry-After、网络分类及显式启用的原始诊断 |
| `API/codec` | Chat 文本/工具流、Responses 有序装配、Anthropic/Google 原生响应和用量；不读配置、不执行工具 |
| `API/request` | 四协议请求结构与消息净化、原生历史/签名重放、图片编码和工具批次排列；图片由宿主以校验后的快照提供 |
| `API/parameters` | 参数规格、值/路径校验、厂商规则和通用字段映射；标准字段优先，显式false/0保留 |
| `API/catalog` | 模型目录解析/索引、渠道与原生型号查询、容量/参数参考、已审定入口校验；查询结果与共享资料分离 |
| `Core/model_catalog.go`、`runtime_resources.go` | 宿主加载和缓存目录，转交公共查询；保留配置迁移与持久化 |
| `Core/provider_codec.go` | 原解析函数的兼容门面；转交 codec，不保留另一套解析实现 |
| `Core/provider_request.go`、`provider_images.go` | 选择活动模型与目录规则、校验参数来源、提供图片资料；不编码厂商消息字段 |
| `Core/api.go`、`responses.go`、`native_protocols.go` | 保留兼容构造入口、HTTP调用与配置/任务校验；请求体、路由和请求头转交API；声明式动态适配器已通过共同Mod接入，诊断保留实际路由/参数/缓存来源 |
| `Core/request_retry.go` | 未提交片段的重试边界、取消、重试次数和长思考保护；使用API提供的错误分类 |
| `Core/matrix_worker.go` | 进程间传递公共模型事件、会话身份与错误；宿主保有工具执行与持久任务所有权 |
| `Contracts/product-layout.json` | 共同软件清单；包、更新器、公共扫描使用；Windows构建从清单推导独立Go模块检查范围 |

方向是客户端/任务调度 → 请求装配 → API传输与解析 → 公共事件 → Core事务与UI投影。API只依赖Contracts，不反向导入Core。尚未收到完整、经过身份与参数检查的响应时，工具片段只能触发展示；解析器不能执行工具。

稳定会话/角色键供支持它的供应商分配缓存；命中率仍以返回的usage为准。更换供应商后的签名隔离归API请求编码；近期原文、用户配置和模型池的权威仍在Core。请求不会给共享配置补写缓存键，重复发送使用相同图片快照。

测试中的纯解析顺序/工具参数判据归API；实际HTTP、双轮工具回传、workspace状态及worker测试留在Core，使用公共解码器入口。历史地图的JSON快照维持原采样日期，当前路径以本文为准。

Muse视频协议：Contracts/protocol/video.go → API/videos/client.go（一次创建、原BASE/公开ID查询、无凭据有界下载），API不持有用户配置或任务存储。Core/video_tasks.go已接真实会话范围、固定连接、单次提交与原回执恢复，Tool/toolbox/official/videogen提供手册和双端投影；API/videos/media.go读取实际MP4元数据，Core再校验SHA并登记产物；本地协议与真实供应商分别验证，不因查询或下载故障自动切管理渠道。

Muse文本使用Chat最小参数，非流式/流式均经实际Core请求；缺失usage保留未知，不据型号名称推断原生工具、视觉理解或缓存命中。`API/images`的Muse分支使用单图URL合同，下载调用真实`imagegen.Inspect`完整解码；WebP原始字节和实际尺寸进入相册、SHA快照、历史图片引用及后续模型请求。附件上传仍保留原Electron转换WebP到PNG流程，不将媒体回执支持等同于全部附件入口改变。
