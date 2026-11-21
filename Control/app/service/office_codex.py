# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: connection_options; inspect_thread; deliver; main
# Impact: python -B scripts/code-atlas.py show Control/app/service/office_codex.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Private office adapter template for an existing native or WSL Codex thread."""

import json
import os
from pathlib import Path, PurePosixPath
import sys

from native_wakeup import CodexConnection, WakeError

PROTOCOL = "aieyra-office-adapter/1"


def connection_options(config):
    executable = config["executable"]
    home = config["codex_home"]
    env = dict(os.environ)
    if config["transport"] == "wsl":
        if not all(
            isinstance(config.get(k), str) and config[k] and not config[k].startswith("-")
            for k in ("distro", "user")
        ):
            raise WakeError("wsl_identity_required")
        if not PurePosixPath(executable).is_absolute() or not PurePosixPath(home).is_absolute():
            raise WakeError("wsl_absolute_paths_required")
        return (
            config["wsl_executable"],
            [
                "--distribution",
                config["distro"],
                "--user",
                config["user"],
                "--exec",
                "/usr/bin/env",
                "CODEX_HOME=" + home,
                executable,
                "app-server",
                "proxy",
            ],
            env,
        )
    if config["transport"] != "native" or not Path(home).is_absolute():
        raise WakeError("native_environment_required")
    env["CODEX_HOME"] = home
    return executable, ["app-server", "proxy"], env


def inspect_thread(client, native):
    thread = client.call("thread/read", {"threadId": native, "includeTurns": False})["thread"]
    status = thread.get("status", {})
    if thread.get("id") != native:
        raise WakeError("native_identity_mismatch")
    if "archived_sessions" in str(thread.get("path", "")).replace("\\", "/").split("/"):
        raise WakeError("native_handoff_or_user_resume_required")
    if status.get("type") not in ("active", "idle", "notLoaded") or status.get("activeFlags"):
        raise WakeError("native_waiting_or_failed")
    turns = client.call(
        "thread/turns/list",
        {
            "threadId": native,
            "limit": 1,
            "itemsView": "notLoaded",
        },
    ).get("data", [])
    last = turns[0] if turns else {}
    if status["type"] == "active":
        if last.get("status") != "inProgress" or not last.get("id"):
            raise WakeError("native_active_turn_unconfirmed")
    elif last.get("status") != "completed":
        raise WakeError("native_handoff_or_user_resume_required")
    return status["type"], last.get("id")


def deliver(request, config, connection=CodexConnection):
    if request.get("protocol") != PROTOCOL or request.get("operation") != "deliver":
        raise WakeError("office_request_invalid")
    target = request.get("target", {})
    if target != config["binding"]:
        raise WakeError("native_binding_configuration_changed")
    receipt = request.get("receipt", {})
    if receipt.get("native_session_id") != target["native_session_id"] or receipt.get(
        "id"
    ) != request.get("id"):
        raise WakeError("office_receipt_invalid")
    prompt = (
        "[Link direct message]\n"
        + json.dumps(
            {
                "source": request["source"],
                "target": target["actor_id"],
                "body": request["body"],
                "receipt": receipt,
            },
            ensure_ascii=False,
        )
        + "\nReceipt: after reading, use your own Link profile to call office/ack with the delivered receipt fields (omit endpoint)."
    )
    executable, args, env = connection_options(config)
    client = connection(executable, timeout=1.5, proxy_args=args, env=env)
    try:
        native = target["native_session_id"]
        state, turn = inspect_thread(client, native)
        if state == "active":
            result = client.call(
                "turn/steer",
                {
                    "threadId": native,
                    "expectedTurnId": turn,
                    "input": [{"type": "text", "text": prompt}],
                },
            )
            accepted = result.get("turnId") == turn
        else:
            resumed = client.call("thread/resume", {"threadId": native, "excludeTurns": True})[
                "thread"
            ]
            if (
                resumed.get("id") != native
                or resumed.get("status", {}).get("type") != "idle"
                or resumed.get("status", {}).get("activeFlags")
            ):
                raise WakeError("native_identity_or_wait_state_changed")
            result = client.call(
                "turn/start",
                {
                    "threadId": native,
                    "clientUserMessageId": request["id"],
                    "input": [{"type": "text", "text": prompt}],
                },
            )
            accepted = bool(result.get("turn", {}).get("id"))
        if not accepted:
            raise WakeError("native_receipt_invalid")
        return {"protocol": PROTOCOL, "accepted": True}
    finally:
        client.close()


def main():
    from binding import CONFIG

    try:
        request = json.loads(sys.stdin.buffer.read(32769).decode("utf-8"))
        result = deliver(request, CONFIG)
    except Exception:
        # Failure after submission may be unknown. Never retry and never self-ACK.
        result = {"protocol": PROTOCOL, "accepted": False}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
