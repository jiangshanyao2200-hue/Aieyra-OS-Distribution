# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: tool_manual; tool_manual_sidecar; public_prompt_name; public_resource_files; public_default_files
# Impact: python -B scripts/code-atlas.py show scripts/resources.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Public resource inventory shared by source export and application packages."""
import json
from pathlib import PurePosixPath
import re

PUBLIC_CONFIG = (
    '默认设置.json', '模型目录.json', '模型资料.json', 'OpenCode模型.json',
    '终端配色.json', '提示词索引.json', '运行参数.json', 'release.pub.pem',
)


def tool_manual(name):
    return isinstance(name, str) and bool(re.fullmatch(r'Tool/(?:base|toolbox|workbox)/official/[a-z][a-z0-9_-]{0,63}/(?:manual\.txt|(?:manual|prompts)/[a-z][a-z0-9_-]{0,63}\.txt)', name))


def tool_manual_sidecar(name):
    return isinstance(name, str) and bool(re.fullmatch(r'Tool/(?:base|toolbox|workbox)/official/[a-z][a-z0-9_-]{0,63}/(?:manual\.txt|(?:manual|prompts)/[a-z][a-z0-9_-]{0,63}\.txt)\.(?:backup\.[a-f0-9]{64}|tmp\.[^/]+|write-lock|restore\.json)', name))


def public_prompt_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in {'', '.', '..'} or p.rstrip('. ') != p for p in name.split('/')) or '\\' in name or ':' in name or any(ord(c) < 32 for c in name):
        return False
    if re.fullmatch(r'(?:Agent/program/prompts|Prompt/Program)/(?:browser|settings|contacts|link|servers|market|workspace|center|computer|generic)\.txt', name):
        return True
    if tool_manual(name):
        return True
    if re.fullmatch(r'Agent/official/(?:Eyra/(?:context/)?prompts|Vaya/prompts|Cota/prompts)/.+\.txt', name):
        return True
    return bool(re.fullmatch(
        r'Prompt/(?:Matrix/(?:默认|运行协定|工具说明|辅助指令|记忆|连接检测|问候)/.+\.txt'
        r'|(?:Vaya|Cota|Nova|莹|潜意识)/(?:[^/]+/)*[^/]+\.txt|子代/模板/(?:提示词|Eyra会话|对话|看图|工作|群聊|群主持|群工具|核心协作|附件未观察)\.txt)', name))


def public_resource_files(root):
    result = {'Config/' + name: root / 'Config' / name for name in PUBLIC_CONFIG}
    index = json.loads((root / 'Config/提示词索引.json').read_text(encoding='utf-8-sig'))
    locations = {}
    for row in index['resources']:
        key = row['file'].split('#', 1)[0]
        legacy = 'Prompt/' + key
        if not public_prompt_name(legacy):
            raise ValueError('non-public logical resource: ' + key)
        name = row.get('path') or legacy
        digest = row.get('legacy_sha256') or ''
        if row.get('path') and (not isinstance(name, str) or not (name.startswith(('Agent/official/', 'Agent/program/prompts/')) or tool_manual(name)) or not public_prompt_name(name)
                               or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)):
            raise ValueError('invalid mapped prompt resource: ' + key)
        if not row.get('path') and digest:
            raise ValueError('legacy digest needs a mapped path: ' + key)
        if key in locations and locations[key] != (name, digest):
            raise ValueError('conflicting prompt resource: ' + key)
        locations[key] = (name, digest)
    names = {name for name, digest in locations.values()}
    names.update(locations.get('Matrix/默认/'+name, ('Prompt/Matrix/默认/'+name, ''))[0]
                 for name in ('自我.txt', '工作.txt', '边界.txt', '思考方式.txt'))
    for name in sorted(names):
        if not public_prompt_name(name):
            raise ValueError('non-public resource path: ' + name)
        result[name] = root / name
    for name, path in result.items():
        if not path.is_file() or path.is_symlink():
            raise ValueError('resource missing or redirected: ' + name)
    return result


def public_default_files(root):
    """Resolve the four immutable defaults using the same reviewed inventory."""
    files = public_resource_files(root)
    rows = json.loads((root / 'Config/提示词索引.json').read_text(encoding='utf-8-sig'))['resources']
    mapped = {row['file'].split('#', 1)[0]: row.get('path') for row in rows if row.get('path')}
    return {name: files[mapped.get('Matrix/默认/'+name+'.txt', 'Prompt/Matrix/默认/'+name+'.txt')]
            for name in ('自我', '工作', '边界', '思考方式')}
