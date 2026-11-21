# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: add; exact
# Impact: python -B scripts/code-atlas.py show scripts/ui-contract/check.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""S14 UI 协约检查器（只读）。用法: python -X utf8 scripts/ui-contract/check.py [UI目录] > 输出
规则编号与 docs/UI协约.md 的协约一一对应。退出码 = 违规条数是否为 0。"""
import sys, re, os, glob, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cssparse as C
UI = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Client/Desktop', 'ui')
C.UI = UI if UI.endswith('/') else UI + '/'
FILES = sorted(os.path.basename(p) for p in glob.glob(C.UI + '*.css'))
if len(sys.argv) == 1:
    FILES += sorted(os.path.relpath(p, C.UI) for p in glob.glob(os.path.join(C.UI, '../../../Theme/official/default/*.css')))
    FILES += sorted(os.path.relpath(p, C.UI) for p in glob.glob(os.path.join(C.UI, '../../../Tool/base/official/*/presentation/*.css')))
    FILES += sorted(os.path.relpath(p, C.UI) for p in glob.glob(os.path.join(C.UI, '../../../Halo/official/*.css')))
    FILES += sorted(os.path.relpath(p, C.UI) for p in glob.glob(os.path.join(C.UI, '../../../Halo/runtime/*.css')))
    FILES += sorted(os.path.relpath(p, C.UI) for p in glob.glob(os.path.join(C.UI, '../../../Program/official/*/ui/*.css')))
ALL = [r for f in FILES for r in C.parse(f)]
SKIP_FILES = {'fonts.css', 'look.css'}          # 字体声明与外观助手面板不查
RADIUS_OK = {'0', '0px', '2px', '4px', '6px', '8px', '10px', '14px', '18px', '999px', '50%', '100%'}
FONT_OK = {11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48}
MOTION_OK = {0, 160, 240, 360}
out = collections.defaultdict(list)
def add(rule, r, text): out[rule].append(f"{r['file']}:{r['line']} | {r['sel'][:60]} | {text}")
for r in ALL:
    if r['file'] in SKIP_FILES: continue
    d = C.decls(r['body']); dm = {p: v for p, v, _ in d}
    for p, v, _ in d:
        if p == 'border-radius' and 'var(' not in v:
            for t in re.split(r'[\s/]+', v):
                if t and t not in RADIUS_OK and re.match(r'^[\d.]+(px|%)$', t): add('R1-圆角', r, f'{t} 不在 {{4,6,8,10,14,18,pill,50%}}'); break
        if p == 'font-size' and re.match(r'^[\d.]+px$', v.strip()):
            n = float(v[:-2])
            if n not in FONT_OK: add('R2-字号', r, f'{v}')
        if p in ('transition', 'animation', 'transition-duration', 'animation-duration'):
            durs = [float(m.group(1)) * (1000 if m.group(2) == 's' else 1) for m in re.finditer(r'(?<![\w.-])(\d*\.?\d+)(ms|s)\b', v)]
            ambient = bool(re.search(r'infinite', v)) or any(x >= 900 for x in durs)
            if not ambient:
                bad = [int(x) for x in durs if int(x) not in MOTION_OK]
                if bad: add('R3-动效时长', r, f'{bad}ms 应取 var(--ui-fast/enter/move)=160/240/360')
                if re.search(r'(?<![-\w])(ease|ease-in-out|ease-out|ease-in|linear)(?![-\w])', re.sub(r'var\([^)]*\)', '', v)) and durs: add('R3b-缓动', r, '字面缓动，应取 var(--ui-ease)')
        if re.search(r'#(e3a29c|e39a8f|d98c86|f0c8c3|f2c6c1|e8b3ad|f0c4bd|ffb4a8)\b', v, re.I) and 'var(' not in v: add('R4-状态色', r, f'{p}:{v[:36]} 错误色应取 var(--ui-error)')
        if re.search(r'#(9fd8b4|e3c19c|e9cf8f|edc88d|c4a472)\b', v, re.I): add('R4-状态色', r, f'{p}:{v[:36]} 成功/警告色应取 var(--ui-ok/--ui-warn)（待新增）')
    pos = dm.get('position')
    if pos in ('fixed', 'absolute') and ('box-shadow' in dm or 'backdrop-filter' in dm) and 'border-radius' in dm:
        m = re.search(r'(\d+)px', dm['border-radius'])
        if m and int(m.group(1)) >= 10 and not re.match(r'^(\.glide|\.role|#attachment-drop|dialog\.image-crop)', r['sel']):
            bg = dm.get('background') or dm.get('background-color') or ''
            if not re.search(r'var\(--(ui-glass|glass-surface|pop-bg|glass-strong|glass-panel)', bg): add('R5-浮层背景', r, f'背景应取 var(--glass-surface)（页内）或 var(--ui-glass)（原生窗）：{bg[:40]}')
            bf = dm.get('backdrop-filter', '')
            if bf and not re.search(r'var\(--(ui-blur|glass-filter|pop-blur|glass-blur)', bf): add('R5b-浮层模糊', r, f'模糊应取 var(--glass-filter)：{bf[:40]}')
            if m and int(m.group(1)) not in (14, 18) and 'var(' not in dm['border-radius']: add('R5c-浮层圆角', r, f"{dm['border-radius']} 应为 14px(菜单/列表) 或 18px(卡片/面板)")
    if pos in ('fixed', 'absolute'):
        t = dm.get('top') or ''
        if re.fullmatch(r'(4[4-9]|5[0-9]|6[0-9]|7[0-2])px', t.strip()): add('R6-顶栏间距', r, f'top:{t} 硬编码，应为 calc(var(--titlebar-height) + 16px)')
        ins = dm.get('inset') or ''
        if re.match(r'^(4[4-9]|5[0-9])px\b', ins.strip()): add('R6-顶栏间距', r, f'inset:{ins} 硬编码顶部偏移，应取 var(--titlebar-height)')
        bgv = (dm.get('background') or dm.get('background-color') or '').strip()
        if re.search(r'inset', ' '.join([dm.get('inset', ''), dm.get('top', '') + dm.get('left', '') + dm.get('right', '') + dm.get('bottom', '')])) or dm.get('inset'):
            if re.fullmatch(r'(#000|#000000|rgb\(0, ?0, ?0\)|#0b0b0b|rgb\(11, ?11, ?11\))', bgv): add('R7-整页实色', r, f'整页实色背景 {bgv}，应透出 OS 场景（glass-veil）')
# R8 root/body 级自定义属性同名不同值（跳过 @media 内的响应式变体；值是 var() 别名的不算）
defs = collections.defaultdict(list)
for r in ALL:
    if re.fullmatch(r':root|html|body|body,body\.has-task-tabs', r['sel']) and not r['ctx']:
        for p, v, _ in C.decls(r['body']):
            if p.startswith('--'): defs[p].append((r['file'], r['line'], v[:44]))
for p, lst in defs.items():
    real = [x for x in lst if not x[2].startswith('var(') and x[2] not in ('0ms',)]
    if len({v for _, _, v in real}) > 1 and len({f for f, _, _ in real}) > 1: out['R8-同名异值'].append(f"{p}: " + ' || '.join(f'{f}:{l} {v}' for f, l, v in real))
# R9 同一个选择器在多个文件里各写一套（只比较完全相同的选择器，或 id 自身）
def exact(r, key): return any(x.strip() == key for x in C.split_top(r['sel']))
for key in ['button.quiet', '#control-retry', '#reconnect', '#startup-skip', '#startup-actions']:
    rows = [(r['file'], r['line'], {p: v for p, v, _ in C.decls(r['body'])}) for r in ALL if exact(r, key) or (key.startswith('#') and any(x.strip().split(' ')[-1] == key for x in C.split_top(r['sel'])))]
    if len({f for f, _, _ in rows}) > 1 or len(rows) > 2:
        keys = ('background', 'min-height', 'height', 'padding', 'border-radius', 'font-size')
        shapes = {tuple(d.get(k) for k in keys) for _, _, d in rows}
        out['R9-按钮多套配方'].append(f"{key}: " + ' || '.join(f'{f}:{l}' for f, l, _ in rows) + ('  [数值互相不同]' if len(shapes) > 1 else '  [数值相同，只是重复]'))
total = 0
for rule in sorted(out):
    print(f"## {rule} {len(out[rule])}")
    for line in out[rule]: print('  ' + line)
    total += len(out[rule])
print('TOTAL', total, file=sys.stderr)
for rule in sorted(out): print(f'{rule}\t{len(out[rule])}', file=sys.stderr)
sys.exit(1 if total else 0)
