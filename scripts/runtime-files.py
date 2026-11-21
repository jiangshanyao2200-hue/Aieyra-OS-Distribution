# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: runtime_name; runtime_files
# Impact: python -B scripts/code-atlas.py show scripts/runtime-files.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Select reviewed application files, including sources needed for local rebuilds."""
from pathlib import PurePosixPath
import importlib.util, json
from pathlib import Path

_spec = importlib.util.spec_from_file_location('product_resources', Path(__file__).with_name('resources.py'))
resources = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(resources)

MODULE_LAYOUT = json.loads((Path(__file__).resolve().parents[1] / 'Contracts/product-layout.json').read_text(encoding='utf-8'))
DEVELOPMENT_LAYOUT = json.loads((Path(__file__).resolve().parents[1] / 'Contracts/development-documents.json').read_text(encoding='utf-8'))
DEVELOPMENT_FILES = set(DEVELOPMENT_LAYOUT['documents']) | set(DEVELOPMENT_LAYOUT['templates'])
PREFIXES = ('Core/', 'Client/Desktop/', 'Control/app/', 'Link/app/link-core/', 'Editor/src/') + tuple(name+'/' for name in MODULE_LAYOUT['source_trees'])
EXTRAS = {'README.md', 'LICENSE', 
          'scripts/create-launchers.ps1', 'scripts/sync-cli-entry.ps1', 'scripts/CLI-README.md',
          'Editor/package.json', 'Editor/package-lock.json', 'Editor/NOTICE',
          'Editor/scripts/os-only.mjs', 'Editor/desktop/main.cjs', 'Link/app/LICENSE',
          'scripts/plugins.py', 'scripts/link_product.py', 'scripts/package-link.py', 'scripts/PLUGINS.md'} | set(MODULE_LAYOUT['source_files']) | DEVELOPMENT_FILES

# Core/build.ps1 uses the same public selector to freeze build provenance.
# Retain its exact dependencies so an editable delivery can rebuild itself.
EXTRAS |= {'scripts/build-provenance.py', 'scripts/public-privacy.py',
           'scripts/public-privacy-policy.json', 'scripts/runtime-files.py',
           'scripts/resources.py', 'scripts/development-docs.py',
           'scripts/provision-search.py', 'scripts/search-runtime.lock.json',
           'scripts/provision-media.py', 'scripts/media-runtime.lock.json',
           'scripts/build-module-launchers.ps1', 'scripts/winres.py'}


def runtime_name(name):
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or ':' in name or '\\' in name
            or any(part in {'', '.', '..'} for part in name.split('/'))):
        raise ValueError('Invalid runtime path')
    if name in DEVELOPMENT_FILES:
        return True
    # 新模块只从隐私检查通过的清单选入；所有私有数据独立于软件包。
    if any(part.casefold() in {'共享库','私有数据','data','history','sessions','.git','runtime'}
           and not (part in {'runtime','history'} and '/'.join(path.parts[:index+1]) in MODULE_LAYOUT['source_trees'])
           for index,part in enumerate(path.parts)):
        return False
    if name == 'Core/link' or name.startswith('Core/link/'):
        return False
    return (name in EXTRAS or name.startswith(PREFIXES)
            or name.startswith('Config/') and name[7:] in resources.PUBLIC_CONFIG
            or resources.public_prompt_name(name))


def runtime_files(reviewed):
    """Keep complete editable sources from the reviewed inventory, not user files.

    Managed updates preserve local changes and rebuild modified Go sources. A
    UI-only package would remove unchanged dependencies from that candidate.
    """
    return {name: value for name, value in reviewed.items() if runtime_name(name)}
