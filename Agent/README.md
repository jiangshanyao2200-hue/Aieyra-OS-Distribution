# Agent

`contract` owns task definitions, acceptance criteria, artifact/review receipts,
observed run time and definition validation. Core owns execution, task locks,
authorization, cancellation, persistence and independent verification. Core's
compatibility aliases retain the existing JSON and callers.

`official/Eyra`, `official/Vaya` and `official/Cota` hold actual source definitions.
Eyra's `team` references the members and the delegatable toolbox list. Core reads
these definitions for role defaults, names and prompt references; Desktop model
settings read the same JSON for selectable tools. User settings can narrow tools
and disable members. Definitions do not grant effective permissions.

Public references resolve through `Config/提示词索引.json`: 24 Eyra execution
agreements live in `official/Eyra/prompts/contracts`, 19 context instructions in
`official/Eyra/context/prompts`, and Vaya/Cota each own their prompt file. These
remain editable text, read at request boundaries.
Unmodified old copies are ignored by the new loader; an old locally edited file,
including an empty file, remains an override. Runtime editing versions bind both
content and location, and backup files stay outside managed product updates.

The four immutable public defaults live in `official/Eyra/prompts/default`.
Each missing personal layer resolves independently through the resource index;
an existing empty personal layer remains an intentional override. Both prompt
editors protect the public default directories. Restore removes personal overrides
only after validating versions and backing up the previous content.
All public resources now resolve to their owning Agent or Tool through the index. Eyra owns execution instructions, host-capability, greeting and delegation guidance; its context provider retains legacy subconscious text. Private role layers use `Data/Agents/Eyra/prompts` when present, with explicit paths and old `Prompt/Matrix` preserved for existing installations. See [prompt ownership](../docs/提示词目录.md).
`context` owns budgets, token calibration, shared history rules and the independent
structured-summary provider. `official/Eyra/context` owns the PAC provider,
projection and prefix-preserving maintenance requests. Both implement
`context/contract.Provider`; Core supplies authorized messages, editable text and
completion calls and owns every durable commit. Provider identities and private
state envelopes are versioned in `Contracts/context`.

The host `workspace.context` view lists providers. `action: provider` accepts an
exact `provider` reference and the current `source` revision at an idle boundary.
It appends migration metadata to a new archive version, preserves originals and
inactive namespaces, hydrates a referenced PAC completely, then commits the
session pointer. Restore returns to the previous version. Reopen checks identity
and supported versions; failure never silently selects a different provider.
Legacy unpinned sessions retain their existing memory-dependent selection.
Agent definitions and task specifications may declare a provider; a missing exact
version is rejected. Provider switching does not enable a retired settings page.

Workbox templates explicitly create task-scoped or retained specialists through
the existing AgentManager. Their durable host, conversations and completion
notices are described in `Tool/workbox/README.md`; primary window restarts do not
change their owner. Session archives/catalogs and Memory now use Core's shared
services; complete data-root migration and dynamic provider distribution remain
unfinished.

Standard Agent packages now declare a complete public definition, model requirements,
tool/Program dependencies, exact Context provider, team, budget, lifetime, data schema,
manual and Desktop/CLI presentation. Official roles and imported packages use the same
decoder; official source packages are compiled resources and cannot be impersonated
by an external import. Package prompt paths only read package files, never the private
host index. Existing primary-role overrides keep their established behavior.

The market Agent panel calls `workspace.agents`: inspect sources and models, create
an idle instance, send a task, edit private overrides, explicitly assign a team, disable,
or switch a version at an idle boundary. Installation does not create instances; creation
does not run a model or implicitly join a team. Instance changes require a revision and stable
request ID. Switching preserves private prompt/tool overrides, retains the prior
definition and rejects implicit Context/data migration. Each instance and delegated
task has its own archive and Memory directory under the shared Agents data area.

Core uses the existing AgentManager for execution, tools, cancellation, model-boundary
steering, task views and durable member notifications. The primary Agent can access
only explicitly assigned members. Delegated Program calls are limited to pinned
dependencies and the existing Desktop Program port; a CLI-only host rejects that port.

The model-side `agents` tool accepts `action: package` with a nested `command`.
Explicit `create` includes a `team_role` and creates an idle member supervised by
the caller. Effective tools are the package defaults intersected with the caller's
grant. Creation receipts are scoped to that supervisor; a user-revoked relationship
cannot be recovered by replaying an old creation request. Role assignment is atomic.
Direct supervisors may configure or switch their members at an idle revision, and
retain or detach their team relationship. They cannot adopt unrelated instances,
expand their own tool grant, enable disabled instances or clone disabled fixed roles.
Both package and legacy send entrypoints check the sender's current grant under the
same lock that admits a turn. User management retains its separate full authority.

`Aieyra CLI agents --discovery FILE` sends the same JSON commands to an existing
Desktop or CLI serve Core. It does not create a competing scheduler. The existing
release-stage CLI switch still applies. Installation, Context/data migration and runtime acceptance must be
validated separately for each tested build.

Workboxes can reference a required standard Agent package with the
`aieyra.workbox/1` workflow port. Explicit creation saves an idle, supervised
instance and a durable reverse link. The port is bound to that workflow's identity
and owner; the specialist cannot approve its own review or operate another workflow.
Cancellation reaches both the existing Agent executor and workflow runner, even
after the specialist's model turn has ended. The SDK includes a working example.

`export` accepts an instance `id` or exact `package` identity and is user-only.
The result contains `package`, `filename`, `sha256` and a base64 ZIP in `archive`.
Desktop's **导出公开模板** saves this through a native file picker. Export reads only
the verified original public files (including disabled or old installed versions);
it preserves package identity and publisher signature. It never reconstructs a
missing source from saved instance settings. Personal prompts, model connections,
workdirs, histories, memories, team and workflow bindings are not template files.
Both uncompressed content and ZIP are limited to 2 MiB to fit the shared CLI RPC
budget; larger templates fail explicitly. Import uses the ordinary package registry;
creating an instance from the imported template starts with independent, idle state.

`context/packaged` supplies installable declarative policies over the common
structured provider engine. A policy controls complete-turn retention and summary
guidance; it does not own source archives, credentials, model calls or durable
commits. The host pins the package digest in session/Agent provider references.
Packages use `context ^1.0.0` and `Contracts/context-policy.schema.json`; author
instructions and a working sample are in `SDK/examples/context-project`.
Unavailable packages reject new execution while retaining archive access and an
explicit switch back to an available provider. Arbitrary author executables and
external storage engines are outside this first declarative contract.
