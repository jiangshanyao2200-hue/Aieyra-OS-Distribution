# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: entry; blocks; checked; patch; compact_installer
# Impact: python -B scripts/code-atlas.py show scripts/windows-transport.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Lossless Windows transport. ZIP comments identify aliases and block streams.

Each stream starts with a uint32 output size (little endian). For each 1 MiB
of output, a byte and a uint32 describe a copy at a source offset (0), a
standalone Zstandard frame (1), or a frame using the aligned base block (2).
"""
import hashlib
import struct
import zipfile

import zstandard as zstd

BLOCK = 1 << 20
BASELINE = 'Config/official-baseline.json'
BLOCKS = b'blocks-v1:'
COPY = b'copy-v1:'


def entry(name, comment=b'', method=zipfile.ZIP_STORED):
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = method
    info.external_attr = 0o644 << 16
    info.comment = comment
    return info


def blocks(archive, name, data, source_name='', source=b''):
    compressor = zstd.ZstdCompressor(level=5)
    offsets = {hashlib.sha256(source[pos:pos + BLOCK]).digest(): pos
               for pos in range(0, len(source), BLOCK)}
    with archive.open(entry(name, BLOCKS + source_name.encode()), 'w') as out:
        out.write(struct.pack('<I', len(data)))
        for pos in range(0, len(data), BLOCK):
            target = data[pos:pos + BLOCK]
            match = offsets.get(hashlib.sha256(target).digest())
            if match is not None:
                out.write(struct.pack('<BI', 0, match))
                continue
            mode, frame = 1, compressor.compress(target)
            base = source[pos:pos + BLOCK]
            if base:
                dictionary = zstd.ZstdCompressionDict(base, dict_type=zstd.DICT_TYPE_RAWCONTENT)
                candidate = zstd.ZstdCompressor(level=5, dict_data=dictionary).compress(target)
                if len(candidate) < len(frame):
                    mode, frame = 2, candidate
            out.write(struct.pack('<BI', mode, len(frame)))
            out.write(frame)


def checked(data, identity):
    if len(data) != identity['size'] or hashlib.sha256(data).hexdigest() != identity['sha256']:
        raise ValueError('Transport input differs from the release baseline')
    return data


def patch(destination, previous_zip, old_envelope, previous, current_envelope, current, read_target):
    with zipfile.ZipFile(previous_zip) as old, zipfile.ZipFile(destination, 'x', allowZip64=False) as out:
        if old.read(BASELINE) != old_envelope:
            raise ValueError('Previous portable does not contain the selected signed baseline')
        out.comment = b'aieyra-patch-v1'
        blocks(out, BASELINE, current_envelope, BASELINE, old_envelope)
        for name, wanted in sorted(current['files'].items()):
            before = previous['files'].get(name)
            if before == wanted:
                continue
            source = checked(old.read(name), before) if before else b''
            blocks(out, name, checked(read_target(name), wanted), name if source else '', source)


def compact_installer(destination, files, manifest, envelope, launchers):
    # Emit dependencies before their consumers. Every alias is installed as an
    # independent file and verified against the ordinary signed inventory.
    first = launchers[0]
    ordered = [first, *sorted(set(files) - {first})]
    seen = {}
    reference = checked(files[first].read_bytes(), manifest['files'][first])
    with zipfile.ZipFile(destination, 'x', allowZip64=False) as out:
        out.comment = b'aieyra-install-v1'
        out.writestr(entry(BASELINE, method=zipfile.ZIP_DEFLATED), envelope)
        for name in ordered:
            identity = manifest['files'][name]
            key = (identity['sha256'], identity['size'])
            if key in seen:
                out.writestr(entry(name, COPY + seen[key].encode()), b'')
                continue
            seen[key] = name
            data = checked(files[name].read_bytes(), identity)
            if name != first and name in launchers:
                blocks(out, name, data, first, reference)
            elif len(data) >= 64 * 1024:
                blocks(out, name, data)
            else:
                out.writestr(entry(name, method=zipfile.ZIP_DEFLATED), data)
