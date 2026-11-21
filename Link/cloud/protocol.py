# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Link/cloud/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: CloudError; digest; atomic; read; endpoint; make_key; parse_key; NoRedirect; CloudHTTP
# Impact: python -B scripts/code-atlas.py show Link/cloud/protocol.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Aieyra Link cloud wire helpers. Python standard library, verified HTTPS."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

VERSION = "0.2.0"
PREFIX = "aieyra-link-v1."
TOKEN = re.compile(r"[A-Za-z0-9_-]{43,128}\Z")
DEVICE = re.compile(r"[a-f0-9]{32}\Z")
LIMIT = 8 * 1024 * 1024


class CloudError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status
        super().__init__(code)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8", newline="\n") as output:
            os.chmod(tmp, 0o600)
            json.dump(value, output, ensure_ascii=False, allow_nan=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(tmp, path)
        if os.name != "nt":
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        tmp.unlink(missing_ok=True)


def read(path):
    with Path(path).open(encoding="utf-8-sig") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise CloudError("cloud_state_invalid")
    return value


def endpoint(value, *, test=False):
    if not isinstance(value, str) or len(value) > 512:
        raise CloudError("invalid_cloud_endpoint")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise CloudError("invalid_cloud_endpoint") from None
    allowed = parsed.scheme == "https" or (test and parsed.scheme == "http" and parsed.hostname == "127.0.0.1")
    if not allowed or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or (port is not None and not 1 <= port <= 65535) or not re.fullmatch(r"/[A-Za-z0-9_/-]+", parsed.path):
        raise CloudError("verified_https_cloud_endpoint_required")
    return value.rstrip("/")


def make_key(url, secret):
    encoded = base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
    return PREFIX + encoded + "." + secret


def parse_key(value, *, test=False):
    if not isinstance(value, str) or len(value) > 1024 or not value.strip().startswith(PREFIX):
        raise CloudError("invalid_link_key")
    try:
        encoded, secret = value.strip()[len(PREFIX):].split(".")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", encoded) or not TOKEN.fullmatch(secret):
            raise ValueError()
        url = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True).decode()
        return {"url": endpoint(url, test=test), "key": secret}
    except (ValueError, UnicodeError):
        raise CloudError("invalid_link_key") from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class CloudHTTP:
    def __init__(self, url, *, test=False, timeout=30):
        self.url, self.timeout = endpoint(url, test=test), timeout
        self.opener = build_opener(NoRedirect())

    def request(self, path, token, body=None, *, method=None):
        if not isinstance(path, str) or not path.startswith("/v1/") or any(x in path for x in ("..", "#", "%", "\\")):
            raise CloudError("invalid_cloud_route")
        raw = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        request = Request(self.url + path, data=raw, method=method,
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                status, data = response.status, response.read(LIMIT + 1)
        except HTTPError as response:
            with response:
                status, data = response.code, response.read(LIMIT + 1)
        except (URLError, TimeoutError, ConnectionError, OSError):
            raise CloudError("cloud_connection_unconfirmed_query_original_request", 503) from None
        if len(data) > LIMIT:
            raise CloudError("cloud_response_too_large", 502)
        try:
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ValueError()
        except (ValueError, RecursionError):
            raise CloudError("invalid_cloud_response_query_original_request", 502) from None
        if status != 200:
            code = result.get("code", "cloud_request_failed")
            if not isinstance(code, str) or not re.fullmatch(r"[a-z0-9_]{1,100}", code):
                code = "cloud_request_failed"
            raise CloudError(code, status)
        return result
