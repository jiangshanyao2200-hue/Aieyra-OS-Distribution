"""Together's scoped facade over the extracted, unchanged Link collaboration core."""
from __future__ import annotations

import secrets
import threading
import uuid

from .coordination_core.hub import Store
from .coordination_core.core import Fault


class Office:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.store = Store(path)
        try:
            self.store.init(secrets.token_urlsafe(32))
        except Fault as error:
            if error.code != "already_initialized":
                raise
        self.owner = {"id": "owner", "name": "Together", "role": "owner", "project": "coordination"}
        self.store.write(self.owner, "project-register", {
            "request_id": "together-project-v1", "id": "together", "name": "Aieyra OS Together",
            "root": "", "source": "", "version": 0,
        })

    def enroll(self, name, request_id):
        with self.lock:
            result = self.store.write(self.owner, "register", {
                "request_id": request_id, "name": name[:80], "project": "together",
            })
            return result["id"]

    def actor(self, actor_id, name):
        return {"id": actor_id, "name": name, "role": "agent", "project": "together"}

    def state(self, actor_id, name):
        return self.store.read(self.actor(actor_id, name), "/v1/status", {})

    def write(self, actor_id, name, action, body):
        if action not in {"heartbeat", "message", "ack"}:
            raise Fault("action_not_available", 403)
        value = {**body, "project": "together"}
        if action == "message":
            value["kind"] = "discussion"
        return self.store.write(self.actor(actor_id, name), action, value)

    def revoke(self, actor_id):
        return self.store.write(self.owner, "revoke", {
            "request_id": "revoke-" + uuid.uuid4().hex, "id": actor_id,
        })
