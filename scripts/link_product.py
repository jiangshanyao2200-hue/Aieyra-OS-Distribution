# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: regular; discover_app
# Impact: python -B scripts/code-atlas.py show scripts/link_product.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Discover the single Control module inside this OS checkout."""
import os
from pathlib import Path
import stat

def regular(path):
    path=Path(path).absolute()
    for part in (path, *path.parents):
        info=part.lstat()
        if part.is_symlink() or getattr(info,"st_file_attributes",0)&getattr(stat,"FILE_ATTRIBUTE_REPARSE_POINT",0):
            raise ValueError("module_path_must_not_redirect")
    if not path.is_file(): raise ValueError("module_regular_file_required")
    return path

def discover_app(os_root, env=None):
    app=Path(os_root).absolute()/"Control/app"
    regular(app/"scripts/control.py")
    regular(app/"service/main.py")
    return app
