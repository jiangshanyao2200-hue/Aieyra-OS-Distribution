# Workbox 1.0.0

Workbox owns the workflow definition, bounded input bindings, step states and
Desktop/CLI presentation. Core supplies the existing package registry, private
snapshot store, execution cells, image batches and AgentManager. Workflows run
steps sequentially in dependency order; this contract does not claim parallel
DAG scheduling. Validate installation, execution, recovery and GUI behavior separately.

The outer `aieyra.mod/1` manifest uses kind=workbox and contracts.workbox=^1.0.0.
Its workflow and manual entries, Desktop `aieyra.workbox` view and CLI
`aieyra.text` binding are mandatory. `workflow.json` contains an object input
schema, declared tools, 1–32 ordered steps and output bindings. A tool is either
the existing `image_gen` Toolbox or a required Tool/Toolbox package dependency.
The exact references require `tool.invoke` or `package.invoke` permissions.
Definitions grant no capability. Nested packages must also satisfy their own
capabilities, current role permissions, release stage and content identity.

Each call step declares needs, arguments and effect=read/idempotent/external.
`{"$input":"/field"}` and `{"$step":"earlier","path":"/field"}` read JSON
pointers without evaluation; step references must be direct dependencies.
An optional when compares an actual prior result. Missing bindings fail instead
of becoming guessed inputs. Checkpoints persist awaiting_review. A specialist
cannot approve its own checkpoint; the owner uses the explicit approve command.

See RequestSchema and CommandManual for the common Toolbox/native-client API.
create saves input, workdir, plan and all dependency digests before execution.
Mutations require a stable request_id and expected_revision. run/resume starts
an owned background runner; status returns current facts. pause stops at a step
boundary, cancel stops owned work and retains receipts. Updates or disable block
new steps; existing snapshots remain inspectable. No completed step is replayed.

recover acquires the former runner's kernel lease, reads existing execution
logs or image batches, and repairs already saved image responses. It does not
dispatch a tool, regenerate an image, or retry an unknown side effect. A missing
receipt remains unknown. A completed JS tool binds its single JSON result; for
multiple or non-JSON outputs the complete execution receipt is the step result.
Image steps retain batch identity, paths, usage and failure details. Credentials
remain in host configuration and never enter the package.

agentTemplate provides public prompt text, token/time budget and task/retained
lifetime. Explicit create_agent uses the existing parent/child scheduler and
completion inbox. It copies neither the parent's private prompts nor PAC memory.
Alternatively, `agentTemplate: {"package":"example.workflow-manager","retention":"retained"}`
references a required Agent dependency with its own `package.invoke` permission.
It cannot be mixed with inline prompt/budget fields. The Agent declares
`runtime.workflow_port="aieyra.workbox/1"` and default `software_api` capability.
Creation links an idle standard instance in the existing Agent service; users
or Eyra send a task through that service to start it. The exact private binding
is saved on both sides before any model request. Retry after a failed workflow
link recovers the existing idle instance, even if its source has since changed.
Software API `action=workflow` supports status/run/pause/resume/cancel/recover
with the normal revision/request receipts. It supplies its bound ID internally,
rejects another ID, and cannot approve checkpoints or create specialists.
The port grants only the accepted workflow's tools, after normal package and
dependency admission. Scoped send also checks the supervisor's current grants.
Cancelling the Agent still reaches workflow execution after its model turn ends;
cancelling the workflow reaches its linked Agent. These bindings are private
instance data and must never be included in a public template.
Task instances stop accepting new turns once their workflow is terminal;
retained instances keep their independent conversation. Both retain results.
Primary OS/CLI windows route workflows to a durable, leased AgentManager in the
private workflows area; reopening a window never invents a new workflow owner.
The service is acquired only for workflow operations or recovery of existing
specialists. An unrelated window does not reserve its lease. Another Core
process holding that lease causes an explicit busy result; ownership is never
stolen and its records remain intact.
Specialists, their task archives and retained conversations survive that reopen
without automatically resuming execution. Completion notices use the existing
Agent records as an outbox, acknowledge actual inbox handling, and include every
completed generation. An unacknowledged notice may be delivered again with the
same identity after a crash; it is not a command to replay workflow effects.

Image usage belongs to the workflow itself, with stable request identities and
unknown samples persisted before submission. A caller changing turns cannot
reject a paid response or cause a second image request. List queries return
metadata pages; the native panel polls only the selected receipt, preserving
opened details and hiding the creation form after creation.

Parent cancellation reaches owned workflow execution. Existing Agent task views
provide supervision; no extra default role or contact is automatically opened.

SDK/examples/workbox-statistics composes the actual statistics/report packages.
SDK/examples/workbox-specialist adds SDK/examples/agent-workflow-manager through
the same manifest mechanism. The native workflow view can create the idle
specialist and open its existing Agent management view.
SDK/examples/workbox-images generates an image, pauses for review and edits the
saved source. Both use the shared importer and package builder. Desktop has a
native management view in the installed package detail. CLI preserves the full
JSON receipt; these examples currently declare Desktop execution only. Mobile
remains a contract, not an implemented workflow client.
