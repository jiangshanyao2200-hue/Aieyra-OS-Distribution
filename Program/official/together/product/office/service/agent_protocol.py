# @file-map:start
# 文件: link/office/service/agent_protocol.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/agent_access.py
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   openapi | function
#   openapi.operation | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Machine-readable native agent protocol; center calls retain worker authorization."""

from agent_access import READS, WRITES


# @chain-region openapi | calls: list, operation, page['parameters'].extend, path.strip, path.strip('/').replace, path.strip('/').replace('/', '_').replace, path.strip('/').replace('/', '_').replace('{', '').replace, paths.setdefault …
def openapi(origin="http://127.0.0.1:17910"):
    string = {"type": "string", "minLength": 1}
    identifier = {"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,100}$"}
    session = {**identifier, "maxLength": 90}
    request = {"request_id": identifier}
    paths = {}

    # @chain-region openapi.operation | calls: list, path.strip, path.strip('/').replace, path.strip('/').replace('/', '_').replace, path.strip('/').replace('/', '_').replace('{', '').replace, paths.setdefault, str
    def operation(path, method, summary, properties=None, required=None, params=(), owner=False):
        item = {
            "summary": summary,
            "operationId": method
            + "_"
            + path.strip("/").replace("/", "_").replace("{", "").replace("}", ""),
            "security": [{"LocalCSRF": []}] if owner else [{"AgentBearer": []}],
            "responses": {
                str(code): {
                    "description": desc,
                    "content": {"application/json": {"schema": {"type": "object"}}},
                }
                for code, desc in (
                    (200, "Recorded result"),
                    (400, "Invalid request"),
                    (401, "Credential invalid or revoked"),
                    (403, "Identity permission denied"),
                    (404, "Not found"),
                    (409, "State/version conflict"),
                    (503, "Center unavailable; query the original request"),
                )
            },
        }
        if params:
            item["parameters"] = [
                {"name": name, "in": where, "required": True, "schema": string}
                for name, where in params
            ]
        if properties is not None:
            item["requestBody"] = {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": properties,
                            "required": required or list(properties),
                        }
                    }
                },
            }
        paths.setdefault(path, {})[method] = item

    prefix = "/api/agent/v1/"
    for route, description in [
        ("info", "Protocol and capabilities"),
        ("seats", "Select assigned external center seats"),
        ("inbox", "Read fixed-session deliveries; reading does not acknowledge"),
        ("sessions/{id}", "Read current session including expired state"),
        ("deliveries/{id}", "Read original delivery and result"),
        ("requests/{id}", "Reconcile local mutation receipt"),
    ]:
        params = (
            [("session_id", "query")]
            if route == "inbox"
            else [("id", "path")]
            if "{id}" in route
            else []
        )
        operation(prefix + route, "get", description, params=params)
    operation(
        prefix + "link", "post", "Use explicitly granted remote OS sessions through Link",
        {
            "session_id": session,
            "action": {"enum": ["connections", "catalog", "send", "message", "events", "cancel", "answer-status", "request-status"]},
            "operation": {"enum": ["send"]},
            "connection": {"type": "string", "pattern": "^[a-f0-9]{32}$"},
            "target_session": {"type": "string", "pattern": "^[a-f0-9]{32}:[A-Za-z0-9_.:-]{1,160}$"},
            "request_id": {"type": "string", "pattern": "^[A-Za-z0-9_.:-]{1,160}$"},
            "text": {"type": "string", "minLength": 1, "maxLength": 16000},
            "id": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "after": {"type": "integer", "minimum": 0, "maximum": 2**64 - 1},
        },
        ["session_id", "action"],
    )
    link = paths[prefix + "link"]["post"]
    link["requestBody"]["content"]["application/json"]["schema"]["additionalProperties"] = False
    link["description"] = (
        "Requires the caller's live original station and an owner grant for selected connection/session IDs. "
        "connections accepts session_id/action only. All other actions require connection; send also requires "
        "target_session, stable request_id and UTF-8 text at most 16000 bytes. message/cancel/answer-status "
        "require id; events accepts after. request-status requires request_id and operation=send, "
        "recovers a lost HTTP receipt by read-only journal lookup, and never sends even if not-recorded. "
        "Messages are scoped to their submitting actor and granted target. "
        "Read does not grant send or cancel. Unknown sends return the original durable handle, "
        "replay_allowed=false; reusing request_id queries that handle and never repeats execution. "
        "cancel_requested is not proof of stopped execution. Human answers are local-owner-only. "
        "Execution and model configuration remain with the remote OS, not Control."
    )
    operation(
        prefix + "connect",
        "post",
        "Connect transport while preserving the permanent native session",
        {
            **request,
            "session_id": session,
            "seat_id": identifier,
            "seat_epoch": {"type": "integer", "minimum": 1},
            "native_session_id": identifier,
        },
        ["request_id", "session_id", "seat_id", "seat_epoch"],
    )
    station = {
        **request,
        "session_id": session,
        "reason": {"type": "string", "minLength": 1, "maxLength": 1000},
    }
    operation(
        prefix + "station/avatar", "post", "Publish the authenticated station's own named pixel portrait",
        {**request, "session_id": session, "name": {"type": "string", "minLength": 1, "maxLength": 24},
         "pixels": {"type": "array", "minItems": 14, "maxItems": 14,
                    "items": {"type": "string", "pattern": r"^[.0-9]{12}$"}}},
        ["request_id", "session_id", "name", "pixels"],
    )
    operation(prefix + "station/wakeup-checks", "get", "Read project wakeup consumption checks; workers see only their own checks")
    operation(prefix + "station/wakeup-policy", "post", "Project leader: enable default-off consumption checks without queueing",
              {**request, "session_id": session, "enabled": {"type": "boolean", "default": False},
               "window_seconds": {"type": "integer", "minimum": 10, "maximum": 300, "default": 60}})
    operation(prefix + "station/wakeup-prepare", "post", "Project leader: capture native binding and rollout offset BEFORE original codex queue",
              {**request, "session_id": session, "seat_id": identifier, "message_id": identifier,
               "input_sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
               "execution_location": {"enum": ["local", "server", "mobile", "unknown"]}})
    operation(prefix + "station/wakeup-commit", "post", "Project leader: register original queue receipt; acceptance is not consumption",
              {**request, "session_id": session, "check_id": identifier, "queue_id": identifier, "thread_id": identifier})
    for name in ("wakeup-policy", "wakeup-prepare", "wakeup-commit"):
        item = paths[prefix + "station/" + name]["post"]
        item["requestBody"]["content"]["application/json"]["schema"]["additionalProperties"] = False
        item["description"] = ("Requires original live session, center validation and project leader grant. Never runs codex queue. "
            "Prepare binds the leader's original center message, permanent target seat/native/version and exact UTF-8 input SHA256. "
            "Commit uses the same request_id and fixed native thread, and is idempotent. Default off. Queued proves only acceptance. "
            "Only target ACK of the original message after prepare, or exact native input after the captured offset, proves consumption. "
            "A continuously readable log without that input within the window is undelivered; remote/unobservable/discontinuous evidence is unknown. "
            "Failures persist one idempotent project-leader notice; no native retry or recursive wakeup. Public responses omit bodies, paths and identities.")
    operation(
        prefix + "station/notify-leader",
        "post",
        "Persist a message to the authorized project leader and request bounded wakeup",
        {
            **request,
            "body": {"type": "string", "minLength": 1, "maxLength": 2000},
            "leader_actor_id": identifier,
        },
        ["request_id", "body"],
    )
    operation(prefix + "station/keepalive", "get",
              "Read this station's keepalive plan, next due time and limits; default off")
    operation(
        prefix + "station/keepalive",
        "post",
        "Only on the user's request: schedule bounded messages to this station's own native session "
        "(cache keepalive or anti-interruption), cancel it, or record a host-delivered fire",
        {
            **request,
            "session_id": session,
            "action": {"enum": ["set", "cancel", "fire"]},
            "mode": {"enum": ["cache", "resume"]},
            "delivery": {"enum": ["native", "host"]},
            "interval_seconds": {"type": "integer", "minimum": 300, "maximum": 3600},
            "max_fires": {"type": "integer", "minimum": 1, "maximum": 20},
            "user_request": {"type": "string", "minLength": 1, "maxLength": 600},
            "message": {"type": "string", "minLength": 1, "maxLength": 600},
            "reason": {"type": "string", "minLength": 1, "maxLength": 600},
            "id": identifier,
        },
        ["request_id", "action"],
    )
    operation(
        prefix + "station/notifications",
        "get",
        "Page received/sent notifications; total matches filters before cursor; no implicit ACK",
    )
    paths[prefix + "station/notifications"]["get"]["parameters"] = [
        {"name": name, "in": "query", "required": False, "schema": shape}
        for name, shape in (
            (
                "after",
                {
                    **identifier,
                    "description": "Previous next_cursor; remains valid after that notice is handled",
                },
            ),
            ("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}),
            ("direction", {"type": "string", "enum": ["received", "sent"], "default": "received"}),
            ("status", {"type": "string", "enum": ["unhandled", "all"], "default": "unhandled"}),
        )
    ]
    operation(
        prefix + "station/notifications/{id}",
        "get",
        "Sender or target reads the original notification status",
        params=[("id", "path")],
    )
    operation(
        prefix + "station/notification-ack",
        "post",
        "Current bound leader records read/handled; old binding requires explicit review, version and reason",
        {
            "session_id": session,
            "id": identifier,
            "state": {"enum": ["read", "handled"]},
            "review_previous_binding": {"type": "boolean", "default": False},
            "expected_binding_version": {"type": "integer", "minimum": 1},
            "reason": {"type": "string", "minLength": 1, "maxLength": 1000},
        },
        ["session_id", "id", "state"],
    )
    operation(
        prefix + "station/handoff",
        "post",
        "Leader explicitly replaces a disconnected native session using binding version",
        {
            **station,
            "actor_id": identifier,
            "native_session_id": identifier,
            "expected_version": {"type": "integer", "minimum": 1},
        },
    )
    operation(
        prefix + "station/retire",
        "post",
        "Leader removes membership in an authorized project; history remains",
        {**station, "credential_id": identifier},
    )
    operation(
        prefix + "station/enroll",
        "post",
        "Leader adds a permanent station in an authorized project",
        {
            **station,
            "name": string,
            "project": identifier,
            "token": {"type": "string", "minLength": 43, "maxLength": 128, "writeOnly": True},
        },
    )
    operation(prefix + "cloud/status", "get", "Local cloud opt-in state; no network when unsigned")
    operation(
        prefix + "cloud/growth",
        "get",
        "Account-scoped forum receipts and local evidence-based growth records",
    )
    operation(
        prefix + "cloud/matrix-read",
        "post",
        "Read public Matrix topics through authenticated native client",
        {
            "session_id": session,
            "view": {"enum": ["topics", "topic", "replies", "status", "capabilities"]},
            "topic": string,
            "before": {"type": "integer"},
            "board": {"enum": ["releases", "feedback", "lounge"]},
            "type": {"enum": ["project", "bug", "discussion", "repair", "update"]},
            "query": string,
        },
        ["session_id"],
    )
    operation(
        prefix + "cloud/matrix-sync",
        "post",
        "Bounded persistent account-scoped forum event cursor; fetched is not executed",
        {"session_id": session},
    )
    operation(
        prefix + "cloud/matrix-publish",
        "post",
        "Native Agent proof and public review required; stable requestId on retries",
        {
            "session_id": session,
            "action": {"enum": ["create", "reply", "state", "withdraw"]},
            "topic": {"type": "string", "description": "Empty for create; topic UUID otherwise."},
            "payload": {
                "type": "object",
                "description": "Operation-specific reviewed payload; see docs/MATRIX_GROWTH.md and cloud/matrix-read view=capabilities.",
                "properties": {
                    "requestId": identifier,
                    "publication": {"const": "public"},
                    "confirmed": {"const": True},
                    "type": {"enum": ["project", "bug", "discussion", "repair", "update"]},
                    "title": {"type": "string", "minLength": 2, "maxLength": 100},
                    "summary": {"type": "string", "minLength": 2, "maxLength": 500},
                    "content": {
                        "type": "string",
                        "description": "Create: 10–12000 characters; reply: 1–4000.",
                    },
                    "projectUrl": {
                        "type": "string",
                        "description": "Public HTTPS URL required for project topics.",
                    },
                    "sourceType": {"enum": ["", "feedback", "forum", "release", "issue"]},
                    "sourceId": {"type": "string", "maxLength": 160},
                    "growthId": {"type": "string", "maxLength": 100},
                    "expectedRevision": {"type": "integer", "minimum": 1},
                    "state": {"enum": ["open", "triaged", "in_progress", "resolved", "dismissed"]},
                    "note": {"type": "string", "minLength": 2, "maxLength": 2000},
                },
                "required": ["requestId", "publication", "confirmed"],
                "additionalProperties": False,
            },
        },
    )
    operation(
        prefix + "cloud/growth-record",
        "post",
        "CAS growth evidence chain; no automatic execution or deployment certification",
        {
            **request,
            "session_id": session,
            "growthId": identifier,
            "expectedRevision": {"type": "integer"},
            "state": string,
            "baseline": string,
            "candidateDigest": string,
            "source": string,
            "evidence": {"type": "array", "items": string},
            "note": string,
        },
    )
    operation(
        prefix + "cloud/community",
        "get",
        "Explicitly read the public entertainment feed after login",
    )
    operation(
        prefix + "cloud/check",
        "post",
        "Check a signed official release after login",
        {"session_id": session},
    )
    operation(
        prefix + "cloud/feedback",
        "get",
        "Leader reads private durable feedback queue and official receipts",
    )
    operation(
        prefix + "cloud/feedback",
        "post",
        "Leader promptly reports a diagnosed product issue; selected and privacy-reviewed diagnostics only",
        {
            **request,
            "session_id": session,
            "report": {"type": "object"},
            "privacy_reviewed": {"const": True},
        },
    )
    operation(
        prefix + "cloud/feedback-cancel",
        "post",
        "Leader cancels feedback that has not been accepted by the website",
        {"session_id": session, "id": identifier},
    )
    operation(
        prefix + "heartbeat",
        "post",
        "Renew after center revalidation; omitted runtime_state preserves latest state",
        {
            **request,
            "session_id": session,
            "runtime_state": {"enum": ["idle", "running", "paused", "waiting_user", "unknown"]},
            "work_report": {"type": "object", "description": "Optional explicit work summary; requires runtime_state. Idempotent by request_id.",
                            "properties": {"summary": {"type": "string", "minLength": 1, "maxLength": 600},
                                           "task": {"type": "string", "minLength": 1, "maxLength": 120}},
                            "required": ["summary"], "additionalProperties": False},
        },
        ["request_id", "session_id"],
    )
    operation(
        prefix + "disconnect",
        "post",
        "Release seat and stop pending deliveries",
        {**request, "session_id": session},
    )
    memory_fields = {
        **request,
        "project": identifier,
        "version": {"type": "integer", "minimum": 0},
        "sections": {
            "type": "object",
            "properties": {
                key: {"type": "string", "maxLength": 12000}
                for key in ("blueprint", "timeline", "checkpoint", "recovery", "index")
            },
            "required": ["blueprint", "timeline", "checkpoint", "recovery", "index"],
            "additionalProperties": False,
        },
        "summary": {"type": "string", "minLength": 1, "maxLength": 300},
    }
    operation(
        prefix + "memory",
        "get",
        "Read own project handoff; paired if_version/if_sha256 omit unchanged latest sections",
    )
    operation(
        prefix + "memory",
        "post",
        "Save local project revision with active seat and compare-and-swap version",
        {**memory_fields, "session_id": session},
    )
    operation(
        "/api/project-memory",
        "get",
        "List configured local projects or read project handoff/revision history",
        owner=True,
    )
    for route in (prefix + "memory", "/api/project-memory"):
        paths[route]["get"]["parameters"] = [
            {"name": name, "in": "query", "required": False, "schema": shape}
            for name, shape in (
                ("project", identifier),
                ("version", {"type": "integer", "minimum": 1, "maximum": 2147483647}),
                ("history", {"type": "integer", "enum": [1]}),
                ("before", {"type": "integer", "minimum": 1, "maximum": 2147483647}),
                ("if_version", {"type": "integer", "minimum": 1, "maximum": 2147483647}),
                ("if_sha256", {"type": "string", "pattern": "^[a-f0-9]{64}$"}),
            )
        ]
        paths[route]["get"]["description"] = (
            "if_version and if_sha256 must be paired and cannot accompany version/history/before. "
            "Matching latest version AND content hash returns HTTP 200, not_modified=true, "
            "conditional_read=version_and_sha256 and metadata without sections or missing_sections. "
            "Use only already-read matching content. Any difference returns the full latest document "
            "with not_modified=false. Reads do not save memory, renew leases or acknowledge tasks."
        )
    operation(
        "/api/project-memory",
        "post",
        "Owner saves local handoff revision with compare-and-swap version",
        memory_fields,
        owner=True,
    )
    operation(
        prefix + "receipt",
        "post",
        "Record agent observation; completion is not owner acceptance",
        {
            **request,
            "session_id": session,
            "delivery_id": identifier,
            "event_id": identifier,
            "body_sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
            "state": {"enum": ["received", "running", "completed", "failed", "interrupted"]},
            "reply": {"type": "string", "maxLength": 4000},
        },
        ["request_id", "session_id", "delivery_id", "event_id", "body_sha256", "state"],
    )
    for route in sorted(READS):
        operation(
            prefix + "center/" + route,
            "get",
            "Center " + route + " under the enrolled worker identity",
        )
        paths[prefix + "center/" + route]["get"]["x-query-contract"] = (
            "Forward center query parameters; center validates its native contract."
        )
    history = paths[prefix + "center/history"]["get"]
    history["x-query-contract"] = (
        "Newest-first bounded history, no implicit ACK. Follow next_before with before. "
        "Unknown query fields are rejected."
    )
    history["parameters"] = [
        {"name": name, "in": "query", "required": False, "schema": shape}
        for name, shape in (
            ("before", {"type": "integer", "minimum": 1, "maximum": 9223372036854775807}),
            ("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}),
        )
    ]
    inbox = paths[prefix + "center/inbox"]["get"]
    inbox["parameters"] = [
        {"name": name, "in": "query", "required": False, "schema": shape}
        for name, shape in (
            ("after", {"type": "integer", "minimum": 0, "maximum": 9223372036854775807}),
            ("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}),
        )
    ]
    for page in (inbox, history):
        page["parameters"].extend(
            [
                {
                    "name": "project",
                    "in": "query",
                    "required": False,
                    "schema": identifier,
                    "description": "Registered project view; does not change authorization.",
                },
                {
                    "name": "include_coordination",
                    "in": "query",
                    "required": False,
                    "schema": {"type": "integer", "enum": [0, 1], "default": 0},
                    "description": "Requires project; include coordination messages.",
                },
                {
                    "name": "stream_epoch",
                    "in": "query",
                    "required": False,
                    "schema": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                    "description": "Requires project. Echo the prior stream_epoch with its cursor.",
                },
            ]
        )
        page["x-query-contract"] += (
            " With project, local center uses filter_mode=server and one SQLite snapshot. "
            "Legacy center uses filter_mode=legacy_scan and one global page; an empty filtered "
            "page may still have more. Keep the same filter while following next_cursor/after "
            "or next_before/before. Reads never ACK. Inbox exhaustion advances to snapshot_cursor; "
            "legacy snapshot_cursor is null and full pages may conservatively report has_more."
            " Local project views return a persistent database/view stream_epoch and epoch_checked. "
            "Expected epoch mismatch is 409 center_stream_epoch_mismatch; a checked inbox cursor "
            "beyond the head is 409 center_cursor_ahead_of_stream. Never reset automatically. "
            "Legacy epoch is null; an expected epoch is 501 center_stream_epoch_unavailable. "
            "An intact database copy retains the same epoch; this is not a content digest."
        )
    for route in sorted(WRITES):
        operation(
            prefix + "center/" + route,
            "post",
            "Center " + route + "; center enforces roles, versions and request idempotency",
            request,
        )
        paths[prefix + "center/" + route]["post"]["x-body-contract"] = (
            "Native center payload plus stable request_id; additional native fields are forwarded."
        )
    operation(
        "/api/agent-access", "get", "Owner view of local credentials and sessions", owner=True
    )
    operation(
        "/api/agent-access/enroll",
        "post",
        "Enroll dedicated worker; optional existing vault identity",
        {
            **request,
            "name": string,
            "project": identifier,
            "token": {"type": "string", "minLength": 43, "maxLength": 128, "writeOnly": True},
            "local_identity": string,
        },
        ["request_id", "name", "project", "token"],
        owner=True,
    )
    operation(
        "/api/agent-access/revoke",
        "post",
        "Revoke local access and disconnect its sessions",
        {"credential_id": identifier},
        owner=True,
    )
    operation(
        "/api/agent-access/handoff",
        "post",
        "Explicit local owner recovery of a closed native leader session",
        {
            **request,
            "actor_id": identifier,
            "native_session_id": identifier,
            "expected_version": {"type": "integer", "minimum": 1},
            "reason": string,
        },
        owner=True,
    )
    operation(
        "/api/agent-access/exchange",
        "post",
        "Local owner atomically exchanges two disconnected native bindings with dual CAS",
        {
            **request,
            "reason": string,
            "bindings": {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["actor_id", "native_session_id", "expected_version"],
                    "properties": {
                        "actor_id": identifier,
                        "native_session_id": identifier,
                        "expected_version": {"type": "integer", "minimum": 1},
                    },
                },
            },
        },
        owner=True,
    )
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Aieyra Link Agent API",
            "version": "1.0.0",
            "description": "Local office and optional legacy center bridge. Dedicated worker identities retain project permissions. No model vendor SDK required.",
        },
        "servers": [{"url": origin}],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "AgentBearer": {"type": "http", "scheme": "bearer"},
                "LocalCSRF": {"type": "apiKey", "in": "header", "name": "X-Control-CSRF"},
            }
        },
        "x-protocol": "aieyra-agent/1",
        "x-authority": "local-office-or-explicit-legacy-center",
        "x-receipt-policy": "Stable request_id; unchanged retry only. Never execute received/running deliveries a second time. Agent completion requires separate owner acceptance.",
        "x-browser-policy": "Agent endpoints reject Origin and Sec-Fetch headers. Local bootstrap requires same-origin CSRF; no human enrollment UI.",
    }
