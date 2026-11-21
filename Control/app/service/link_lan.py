# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: candidate; LinkLAN
# Impact: python -B scripts/code-atlas.py show Control/app/service/link_lan.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Bounded owner discovery and recovery of previously trusted Link devices."""

from copy import deepcopy
from hashlib import sha256
import ipaddress
import re
import time
import unicodedata
from urllib.parse import urlsplit

from device_link import LinkError


PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in (
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "fc00::/7",
    )
)
SCAN_COOLDOWN = 30
CACHE_SECONDS = 60


def candidate(value):
    """Reject malformed/unbounded native output before exposing connection hints."""
    if not isinstance(value, dict):
        raise ValueError()
    identifier, host, pin, name, origin = (
        value.get(key)
        for key in (
            "id",
            "host_id",
            "tls_fingerprint",
            "name",
            "hub_url",
        )
    )
    if (
        not isinstance(identifier, str)
        or not re.fullmatch(r"[a-f0-9]{64}", identifier)
        or not isinstance(host, str)
        or not re.fullmatch(r"[a-f0-9]{32}", host)
        or not isinstance(pin, str)
        or not re.fullmatch(r"[a-f0-9]{64}", pin)
        or not isinstance(name, str)
        or not name.strip()
        or len(name.encode("utf-8")) > 120
        or any(unicodedata.category(character) == "Cc" for character in name)
        or not isinstance(origin, str)
        or len(origin) > 256
        or value.get("verified") is not False
    ):
        raise ValueError()
    parsed = urlsplit(origin)
    address = ipaddress.ip_address(parsed.hostname)
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or not parsed.port
        or not any(
            address.version == network.version and address in network
            for network in PRIVATE_NETWORKS
        )
        or identifier != sha256((host + "\n" + pin + "\n" + origin).encode()).hexdigest()
    ):
        raise ValueError()
    return dict(
        id=identifier, host_id=host, name=name, hub_url=origin, tls_fingerprint=pin, verified=False
    )


class LinkLAN:
    def __init__(self, manager):
        self.manager = manager
        self.state = dict(source="mdns", status="idle", candidates=[], observed_at=None, error="")
        self.expires = self.next_scan = 0
        self.trusted = {}
        self.retries = {}

    def require_capability(self):
        self.manager.require_capability(
            "lan",
            (b"discover", b"recover", b"trust", b"--advertise"),
            "link_update_required_for_lan_discovery",
        )

    def trust(self, key):
        row = self.manager.connection(key)
        if not row.get("paired"):
            raise LinkError("link_pairing_required", 403)
        self.require_capability()
        result = self.manager.run(self.manager.command(key, "trust"))
        if (
            result.get("device_id") != row.get("device_id")
            or type(result.get("pinned")) is not bool
            or not isinstance(result.get("hub_url"), str)
            or result["pinned"]
            and (
                not isinstance(result.get("tls_fingerprint"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", result["tls_fingerprint"])
            )
        ):
            raise LinkError("link_original_identity_invalid", 409)
        with self.manager.lock:
            self.trusted[key] = result
        return result

    def snapshot(self):
        # GET /api/link must stay a cheap cached read, including discovery.
        with self.manager.lock:
            now = time.monotonic()
            result = deepcopy(self.state)
            result.update(
                stale=now >= self.expires,
                cache_remaining_seconds=max(0, self.expires - now),
                scan_cooldown_seconds=SCAN_COOLDOWN,
                cache_seconds=CACHE_SECONDS,
                retry_after_seconds=max(0, round(self.next_scan - now)),
            )
            for item in result["candidates"]:
                item["matches"] = [
                    dict(connection=key, name=self.manager.config["connections"][key]["name"])
                    for key, trust in self.trusted.items()
                    if key in self.manager.config["connections"]
                    and trust.get("pinned")
                    and trust.get("tls_fingerprint") == item["tls_fingerprint"]
                ]
            return result

    def recovery_status(self, key):
        with self.manager.lock:
            value = deepcopy(self.retries.get(key, dict(state="idle", failures=0)))
            next_check = value.pop("next_check", 0)
            value["next_attempt_seconds"] = max(0, round(next_check - time.monotonic()))
            return value

    def discover(self):
        if time.monotonic() < self.next_scan:
            return {**self.snapshot(), "cached": True}
        self.require_capability()
        with self.manager.lock:
            self.next_scan = time.monotonic() + SCAN_COOLDOWN
            self.state.update(status="scanning", error="")
        try:
            value = self.manager.run([self.manager.binary(), "discover", "--timeout", "4s"])
            if (
                value.get("source") != "mdns"
                or not isinstance(value.get("candidates"), list)
                or len(value["candidates"]) > 32
                or not isinstance(value.get("observed_at"), str)
            ):
                raise ValueError()
            candidates = [candidate(item) for item in value["candidates"]]
            if len({item["id"] for item in candidates}) != len(candidates):
                raise ValueError()
            # Only local public trust metadata is read here. Discovery never
            # contacts a candidate, grants access, or creates an identity.
            for key, row in self.manager.config["connections"].items():
                if row.get("paired"):
                    try:
                        self.trust(key)
                    except LinkError:
                        with self.manager.lock:
                            self.trusted.pop(key, None)
            with self.manager.lock:
                self.state.update(
                    status="ready",
                    candidates=candidates,
                    observed_at=value["observed_at"],
                    error="",
                )
                self.expires = time.monotonic() + CACHE_SECONDS
            return {**self.snapshot(), "cached": False}
        except (ValueError, TypeError, UnicodeError):
            error = LinkError("link_discovery_result_invalid", 502)
            with self.manager.lock:
                self.state.update(status="failed", error=error.code)
                self.expires = 0
            raise error from None
        except LinkError as error:
            with self.manager.lock:
                self.state.update(status="failed", error=error.code)
                self.expires = 0
            raise

    def recover(self, key, candidate_id, restart=True):
        if not isinstance(candidate_id, str) or not re.fullmatch(r"[a-f0-9]{64}", candidate_id):
            raise LinkError("link_invalid_discovery_candidate", 400)
        trust = self.trust(key)
        if not trust.get("pinned"):
            raise LinkError("link_original_tls_pin_required", 403)
        with self.manager.lock:
            selected = next(
                (item for item in self.state["candidates"] if item["id"] == candidate_id), None
            )
            if not selected or time.monotonic() >= self.expires:
                raise LinkError("link_discovery_candidate_expired", 409)
            selected = deepcopy(selected)
        if selected["tls_fingerprint"] != trust["tls_fingerprint"]:
            raise LinkError("link_discovered_identity_mismatch", 403)
        result = self.manager.run(
            self.manager.command(
                key, "recover", "--hub-url", selected["hub_url"], "--timeout", "8s"
            )
        )
        row = self.manager.connection(key)
        if (
            result.get("verified") is not True
            or result.get("identity_retained") is not True
            or result.get("replay_allowed") is not False
            or result.get("device_id") != row.get("device_id")
            or result.get("hub_url") != selected["hub_url"]
            or not isinstance(result.get("verified_at"), str)
        ):
            raise LinkError("link_recovery_result_invalid", 502)
        with self.manager.lock:
            row["hub_url"] = result["hub_url"]
            self.manager.save()
            self.manager.sessions.catalogs.setdefault(key, {})["stale"] = True
            self.manager.observed[key] = [
                {**service, "state": "unknown"} for service in self.manager.observed.get(key, [])
            ]
            self.trusted[key] = {**trust, "hub_url": result["hub_url"]}
            self.retries[key] = {
                **self.retries.get(key, {}),
                "state": "verified",
                "verified_at": result["verified_at"],
            }
        # Reopen only children owned by this manager and this connection. The
        # original journals, grants, request IDs and enabled intent stay intact.
        for child_key in list(self.manager.children):
            if isinstance(child_key, tuple) and child_key[0] == key:
                self.manager.stop_child(child_key)
        if restart:
            try:
                self.manager.restore_enabled(key)
                catalog = self.manager.sessions.refresh(key)
                if catalog.get("errors"):
                    raise LinkError(next(iter(catalog["errors"].values())), 503)
                self.succeeded(key)
            except LinkError as error:
                self.failed(key, error)
                return {**result, "restored": False, "error": error.code}
        return {**result, "restored": restart}

    def succeeded(self, key):
        # Clear failure history only after the whole enabled connection has
        # recovered. A successful catalog probe alone cannot heal a child.
        with self.manager.lock:
            self.retries[key] = {
                **self.retries.get(key, {}),
                "state": "connected",
                "failures": 0,
                "next_check": time.monotonic() + 30,
            }
            self.retries[key].pop("error", None)
            self.manager.errors.pop(key, None)

    def failed(self, key, error):
        with self.manager.lock:
            failures = min(6, self.retries.get(key, {}).get("failures", 0) + 1)
            self.retries[key] = {
                **self.retries.get(key, {}),
                "state": "waiting",
                "failures": failures,
                "next_check": time.monotonic() + min(300, 15 * 2**failures),
                "error": error.code,
            }
            self.manager.errors[key] = error.code

    def ready(self, key):
        """Probe at most once per window, then recover known pins after failure."""
        row = self.manager.connection(key)
        if not row.get("paired") or not (
            row.get("attach") or row.get("gateways") or row.get("os_shares")
        ):
            return False
        with self.manager.lock:
            previous = self.retries.get(key, {})
            if time.monotonic() < previous.get("next_check", 0):
                return False
        try:
            self.manager.sessions.refresh(key, include_offices=False)
            return True
        except LinkError as original:
            try:
                trust = self.trust(key)
                if trust.get("pinned"):
                    scan = self.discover()
                    if not scan["stale"]:
                        matches = [
                            item
                            for item in scan["candidates"]
                            if item["tls_fingerprint"] == trust["tls_fingerprint"]
                            and item["hub_url"] != trust["hub_url"]
                        ]
                        for item in matches[:3]:
                            try:
                                self.recover(key, item["id"], restart=False)
                                return True
                            except LinkError:
                                continue
            except LinkError:
                pass
            self.failed(key, original)
            return False
