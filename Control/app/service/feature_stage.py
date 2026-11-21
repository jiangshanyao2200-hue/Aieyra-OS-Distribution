# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: release_stage
# Impact: python -B scripts/code-atlas.py show Control/app/service/feature_stage.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Only the public release switches; never return private configuration."""
import json
import os
from pathlib import Path

KEYS = ("team_collaboration", "toolbox", "link_situation", "cli")


def release_stage():
    root = Path(os.environ.get("AIEYRA_RESOURCE_ROOT") or Path(__file__).resolve().parents[3])
    try:
        raw = json.loads((root / "Config" / "运行参数.json").read_text(encoding="utf-8-sig"))
        stage = raw.get("release_stage", {})
        if not isinstance(stage, dict):
            stage = {}
    except (OSError, ValueError, AttributeError):
        stage = {}
    return {key: stage.get(key) is True for key in KEYS}
