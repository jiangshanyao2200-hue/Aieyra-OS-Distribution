# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: strip_comments; spec; split_top; parse; decls
# Impact: python -B scripts/code-atlas.py show scripts/ui-contract/cssparse.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

import re, os, sys, json
import os
UI = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Client/Desktop', 'ui') + '/'
ORDER = re.findall(r'href="([^"]+\.css)"', open(UI + 'index.html', encoding='utf-8').read())
def strip_comments(s):
    return re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s, flags=re.S)
def spec(sel):
    s = re.sub(r'"[^"]*"|\'[^\']*\'', '""', sel)
    ids = 0; cls = 0; typ = 0
    def inner(m):
        nonlocal ids, cls
        name = m.group(1); arg = m.group(2)
        if name == 'where': return ' '
        best = (0, 0, 0)
        for part in split_top(arg):
            best = max(best, spec(part))
        ids += best[0]; cls += best[1]; return ' '
    # pseudo-classes with args
    s2 = s
    while True:
        m = re.search(r':(is|not|has|where|matches)\(((?:[^()]|\([^()]*\))*)\)', s2)
        if not m: break
        inner(m); s2 = s2[:m.start()] + ' ' + s2[m.end():]
    s2 = re.sub(r':nth-[a-z-]+\([^)]*\)', ' :x ', s2)
    ids += len(re.findall(r'#[\w-]+', s2)); cls += len(re.findall(r'\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+', s2))
    s3 = re.sub(r'#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(\([^)]*\))?', ' ', s2)
    typ = len([t for t in re.split(r'[\s>+~,]+', s3) if re.match(r'^[a-zA-Z][\w-]*$', t)])
    return (ids, cls, typ)
def split_top(s):
    out = []; d = 0; cur = ''
    for ch in s:
        if ch in '([': d += 1
        if ch in ')]': d -= 1
        if ch == ',' and d == 0: out.append(cur); cur = ''
        else: cur += ch
    out.append(cur); return [x.strip() for x in out if x.strip()]
def parse(file):
    src = strip_comments(open(UI + file, encoding='utf-8').read())
    src = re.sub(r'@(?:import|charset|namespace)[^;]*;', lambda m: re.sub(r'[^'+chr(92)+'n]', ' ', m.group(0)), src)
    rules = []; stack = []; i = 0; n = len(src); buf = ''; line = 1; start_line = 1
    while i < n:
        ch = src[i]
        if ch == '\n': line += 1
        if ch == '{':
            head = buf.strip(); 
            if head.startswith('@'):
                stack.append((head, True)); 
                if re.match(r'@(keyframes|font-face|-webkit-keyframes|property|page)', head): 
                    # skip block
                    d = 1; i += 1
                    while i < n and d:
                        if src[i] == '{': d += 1
                        elif src[i] == '}': d -= 1
                        if src[i] == '\n': line += 1
                        i += 1
                    stack.pop(); buf = ''; continue
                buf = ''; i += 1; continue
            # declaration block
            j = i + 1; d = 1
            while j < n and d:
                if src[j] == '{': d += 1
                elif src[j] == '}': d -= 1
                j += 1
            body = src[i + 1:j - 1]
            ctx = ' & '.join(h for h, _ in stack)
            rules.append(dict(file=file, line=start_line, sel=re.sub(r'\s+', ' ', head), ctx=ctx, body=body))
            line += src[i:j].count('\n'); i = j; buf = ''; start_line = line; continue
        if ch == '}':
            if stack: stack.pop()
            buf = ''; i += 1; start_line = line; continue
        if ch == ';' and not buf.strip().count(' ') and False: pass
        if not buf.strip() and ch.strip(): start_line = line
        buf += ch; i += 1
    return rules
def decls(body):
    out = []
    for m in re.finditer(r'([\w-]+)\s*:\s*((?:[^;{}]|\([^)]*\))+)', body):
        v = m.group(2).strip(); imp = '!important' in v
        out.append((m.group(1).lower(), re.sub(r'\s*!important', '', v).strip(), imp))
    return out

import glob
FILES = sorted(os.path.basename(p) for p in glob.glob(UI + '*.css'))
