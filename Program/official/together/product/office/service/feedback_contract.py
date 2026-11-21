# @file-map:start
# 文件: link/office/service/feedback_contract.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/feedback.py, link/office/service/growth.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   FeedbackError | class
#   FeedbackError.__init__ | function
#   canonical | function
#   redact | function
#   prepare | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Bounded, redacted private diagnostic contract shared by client and cloud."""

import json
import re

FIELDS = {
    "category",
    "severity",
    "title",
    "summary",
    "steps",
    "expected",
    "actual",
    "diagnostics",
    "fix_summary",
    "verification",
    "variant_sha256",
}
LIMITS = {
    "title": 160,
    "summary": 1200,
    "steps": 1000,
    "expected": 500,
    "actual": 1000,
    "diagnostics": 1200,
    "fix_summary": 800,
    "verification": 600,
}
CATEGORIES = {"bug", "crash", "performance", "security", "update", "website"}
SEVERITIES = {"low", "normal", "high", "critical"}


# @chain-region FeedbackError
class FeedbackError(Exception):
    # @chain-region FeedbackError.__init__
    def __init__(self, code, status=400):
        self.code, self.status = code, status


# @chain-region canonical | calls: json.dumps
def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


# @chain-region redact | calls: ''.join, ''.join((c for c in text if c in '\n\t' or ord(c) >= 32)).strip, ord, re.sub
def redact(text):
    # Both ends repeat this filter. Selection/review remains mandatory: regex is
    # not a proof that arbitrary project material is safe to share.
    patterns = [
        (
            r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)",
            "[private key removed]",
        ),
        (
            r"(?im)\b(?:authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*[^\r\n]+",
            "[credential removed]",
        ),
        (r"(?i)\bBearer\s+[A-Za-z0-9_.~+/-]+=*", "[credential removed]"),
        (
            r"\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})",
            "[credential removed]",
        ),
        (r"(?i)\bhttps?://[^\s<>\"\']+", "[URL removed]"),
        (
            r"(?i)\b[A-Z]:[\\/][^\r\n\"<>]*|(?:/Users/|/home/|/root/|/srv/|/opt/|/tmp/)[^\s\"<>]*|\\\\[^\s\"<>]+",
            "[path removed]",
        ),
        (r"\b[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[email removed]"),
        (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "[IP removed]"),
        (r"(?<!\w)(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F:.]*(?:%[\w.-]+)?", "[IP removed]"),
        (r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])", "[opaque value removed]"),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    return "".join(c for c in text if c in "\n\t" or ord(c) >= 32).strip()


# @chain-region prepare | calls: FeedbackError, LIMITS.items, canonical, canonical(result).encode, isinstance, len, re.fullmatch, redact …
def prepare(report):
    if (
        not isinstance(report, dict)
        or set(report) - FIELDS
        or not {"category", "severity", "title", "summary"} <= set(report)
    ):
        raise FeedbackError("invalid_feedback_fields")
    if (
        not isinstance(report["category"], str)
        or not isinstance(report["severity"], str)
        or report["category"] not in CATEGORIES
        or report["severity"] not in SEVERITIES
    ):
        raise FeedbackError("invalid_feedback_classification")
    result = {"category": report["category"], "severity": report["severity"]}
    changed = False
    for field, limit in LIMITS.items():
        if field not in report:
            continue
        value = report[field]
        if not isinstance(value, str) or len(value) > limit:
            raise FeedbackError("feedback_text_limit")
        safe = redact(value)
        changed |= safe != value
        if field in ("title", "summary") and not safe:
            raise FeedbackError("feedback_text_required")
        result[field] = safe
    if "variant_sha256" in report:
        if not isinstance(report["variant_sha256"], str) or not re.fullmatch(
            "[a-f0-9]{64}", report["variant_sha256"]
        ):
            raise FeedbackError("invalid_variant_digest")
        result["variant_sha256"] = report["variant_sha256"]
    if len(canonical(result).encode()) > 6000:
        raise FeedbackError("feedback_body_limit", 413)
    return result, changed
