# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: read_icon; pad; block; version_info; build
# Impact: python -B scripts/code-atlas.py show scripts/winres.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Write a Go-linkable Windows resource object (.syso) with an icon and version info.

Replaces the external rcedit step for the module launchers: no third-party tool,
same bytes for the same inputs.
"""
import argparse, struct
from pathlib import Path

RT_ICON, RT_GROUP_ICON, RT_VERSION, LANG = 3, 14, 16, 0x0409


def read_icon(path):
    data = Path(path).read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    if reserved or kind != 1 or not count: raise ValueError('not an .ico file: ' + str(path))
    images = []
    for index in range(count):
        w, h, colors, _, planes, bits, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16 * index)
        images.append(((w, h, colors, planes, bits), data[offset:offset + size]))
    return images


def pad(data, align=4):
    return data + b'\0' * (-len(data) % align)


def block(key, value=b'', text=False, children=b''):
    # VS_VERSIONINFO node: wLength, wValueLength (WCHARs for text), wType, key, pad, value, pad, children.
    name = (key + '\0').encode('utf-16-le')
    value_len = len(value) // 2 if text else len(value)
    raw = pad(struct.pack('<HHH', 0, value_len, 1 if text else 0) + name) + (pad(value) if children else value)
    raw = (pad(raw) + children) if children else raw
    return struct.pack('<H', len(raw)) + raw[2:]


def version_info(name, version):
    parts = [int(x) for x in (version.split('.') + ['0', '0', '0', '0'])[:4]]
    ms, ls = (parts[0] << 16) | parts[1], (parts[2] << 16) | parts[3]
    fixed = struct.pack('<13I', 0xFEEF04BD, 0x00010000, ms, ls, ms, ls, 0x3F, 0, 0x40004, 1, 0, 0, 0)
    strings = b''.join(pad(block(k, (v + '\0').encode('utf-16-le'), text=True)) for k, v in (
        ('CompanyName', 'Aieyra'), ('FileDescription', name), ('FileVersion', version),
        ('OriginalFilename', name + '.exe'), ('ProductName', name), ('ProductVersion', version)))
    table = block('040904b0', children=strings)
    string_info = block('StringFileInfo', children=pad(table))
    var_info = block('VarFileInfo', children=pad(block('Translation', struct.pack('<HH', LANG, 1200))))
    return block('VS_VERSION_INFO', fixed, children=pad(string_info) + var_info)


def build(icon_path, name, version):
    images = read_icon(icon_path)
    group = struct.pack('<HHH', 0, 1, len(images)) + b''.join(
        struct.pack('<BBBBHHIH', w, h, colors, 0, planes, bits, len(data), index + 1)
        for index, ((w, h, colors, planes, bits), data) in enumerate(images))
    tree = {RT_ICON: [(index + 1, data) for index, (_, data) in enumerate(images)],
            RT_GROUP_ICON: [(1, group)], RT_VERSION: [(1, version_info(name, version))]}
    # Layout: all directories first, then data entries, then the payloads.
    types = sorted(tree)
    offset = 16 + 8 * len(types)
    type_dirs = {}
    for kind in types:
        type_dirs[kind] = offset; offset += 16 + 8 * len(tree[kind])
    name_dirs = {}
    for kind in types:
        for ident, _ in tree[kind]:
            name_dirs[(kind, ident)] = offset; offset += 16 + 8
    entries = {}
    for kind in types:
        for ident, _ in tree[kind]:
            entries[(kind, ident)] = offset; offset += 16
    payloads, data_at = b'', {}
    for kind in types:
        for ident, data in tree[kind]:
            data_at[(kind, ident)] = offset + len(payloads); payloads += pad(data, 8)
    directory = lambda count: struct.pack('<IIHHHH', 0, 0, 0, 0, 0, count)
    out = directory(len(types)) + b''.join(struct.pack('<II', kind, 0x80000000 | type_dirs[kind]) for kind in types)
    for kind in types:
        out += directory(len(tree[kind])) + b''.join(
            struct.pack('<II', ident, 0x80000000 | name_dirs[(kind, ident)]) for ident, _ in tree[kind])
    for kind in types:
        for ident, _ in tree[kind]:
            out += directory(1) + struct.pack('<II', LANG, entries[(kind, ident)])
    relocations = []
    for kind in types:
        for ident, data in tree[kind]:
            relocations.append(len(out))
            out += struct.pack('<IIII', data_at[(kind, ident)], len(data), 0, 0)
    out += payloads
    # COFF object: one .rsrc section, ADDR32NB relocations against the section symbol.
    header, section = 20, 40
    raw_at = header + section
    reloc_at = raw_at + len(out)
    symbols_at = reloc_at + 10 * len(relocations)
    coff = struct.pack('<HHIIIHH', 0x8664, 1, 0, symbols_at, 1, 0, 0)
    coff += struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, len(out), raw_at, reloc_at, 0, len(relocations), 0, 0x40000040)
    coff += out
    coff += b''.join(struct.pack('<IIH', at, 0, 3) for at in relocations)
    coff += struct.pack('<8sIhHBB', b'.rsrc', 0, 1, 0, 3, 0) + struct.pack('<I', 4)
    return coff


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--icon', required=True); parser.add_argument('--name', required=True)
    parser.add_argument('--version', required=True); parser.add_argument('--out', required=True)
    args = parser.parse_args()
    Path(args.out).write_bytes(build(args.icon, args.name, args.version))
