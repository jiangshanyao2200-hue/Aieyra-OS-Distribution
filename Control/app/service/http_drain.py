# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: drain_rejected_body
# Impact: python -B scripts/code-atlas.py show Control/app/service/http_drain.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Deliver early HTTP rejection responses before bounded upload cleanup."""

import socket
import time


def drain_rejected_body(handler):
    if not getattr(handler, "_unread_post_body", False):
        return
    try:
        handler.wfile.flush()
        handler.connection.shutdown(socket.SHUT_WR)
        deadline = time.monotonic() + 0.25
        remaining = 65536
        while remaining > 0:
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                break
            handler.connection.settimeout(timeout)
            chunk = handler.rfile.read1(min(8192, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
    except OSError:
        pass
