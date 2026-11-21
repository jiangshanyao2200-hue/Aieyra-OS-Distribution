# @file-map:start
# 文件: link/office/service/feature_stage.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   release_stage | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Public feature defaults owned by Together, independent from OS private configuration."""
import json
from pathlib import Path

KEYS = ("team_collaboration", "toolbox", "link_situation", "cli")


# @chain-region release_stage | calls: (Path(__file__).resolve().parents[1] / 'features.json').read_text, Path, Path(__file__).resolve, isinstance, json.loads, stage.get
def release_stage():
    try:
        stage = json.loads((Path(__file__).resolve().parents[1] / "features.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stage = {}
    if not isinstance(stage, dict):
        stage = {}
    return {key: stage.get(key) is True for key in KEYS}
