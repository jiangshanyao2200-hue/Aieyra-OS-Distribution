# Control 产品边界 · 工作协约

遵循[根协约](../AGENTS.md)；当前职责与迁移边界见[工程地图](../docs/工程地图.md)。本文件覆盖本目录中没有更近协约的自有子目录，测试、样例资产和第三方依赖不因此成为独立执行模块。

入口：`README.md`（当前工作树未提供：`app/README.md`）、[main.py](app/service/main.py)、[control.py](app/scripts/control.py)。

职责：活动产品在app，提供本机办公室、Link页面、Agent接入、桌面/手机通道与独立分发；Go Link模块在Link/app/link-core。

依赖与接口：通过正式API/脚本与OS连接；app/service管协议与状态、web管页面、desktop管壳、mobile是Control客户端，不是未来OS手机App。

资料与状态：本OS安装的资料经storage解析到独立私人Control根；分发包按README指定外部根，不把身份/凭据/记忆写回源码。

开发与验收：Python用-B；按app/scripts/check-quality.py与对应tests选择受影响检查，桌面/手机/真实外部连接需单独记录。

兼容与交接：不另建办公室或借用actor；开发协作只按用户明确要求加入现有Link，不把产品的自动接入说明扩成所有开发任务的强制动作。 修改接口时一起核对调用者、交付清单和对应专题地图；未实际验证的范围保持未验，不以目录存在或安装成功代替运行验收。
