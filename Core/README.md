# Aieyra core

OS and CLI use the same execution engine. Compatibility entrypoints are in `cmd/`; host integration is in `host/`, with terminal commands in `../Client/CLI/host/`. Shared contracts live in `../Contracts/protocol/`; the patch tool and its presentation live in `../Tool/base/official/apply_patch/`. Shell command guards and platform operations remain in `tools/` and `platform/`. Provider transport, request/response encoding, parameters and catalog queries live in `../API/`.

`../Client/CLI/terminal/` renders the interactive CLI through injected protocol capabilities. `../Client/CLI/mdrender/` provides Markdown layout. Neither package executes tasks or imports the core. Desktop presentation currently lives in `../Desktop/ui/`; Mobile is a contract reservation without an App implementation.

## Build and check

```sh
go test ./...
go vet ./...
go build -trimpath -o ../aieyra-cli ./cmd/aieyra-cli
```

On Windows, run `pwsh -NoProfile -File Core/build.ps1` from the project root. The build validates Core and the independent modules, then writes all four entrypoints directly into the main project. Use `-SkipTests` only when the necessary tests have already passed for the current changes, and retain their receipts. Build versions come from `host/app.go`; release metadata must agree. Cross-platform CLI packages use `scripts/build-cli.py`. See the root README and `scripts/CLI-README.md` for installation and terminal controls; the release-stage switch still controls public CLI availability.

## Lifecycle and ownership

OS and CLI share configuration, prompts, sessions, PAC context, memory and execution rules. Context is managed by the shared engine, not by each client's display lifecycle. Preserved history and startup context do not authorize resuming old work. Current context behavior is defined in `../docs/压缩与PAC统一规范.md`.

The core owns task status, tools, cancellation, request identity, usage and receipts. UI projections cannot manufacture execution results or mutate facts when animations finish. Host actions and asynchronous replies remain bound to the selected task and generation. Control is optional in CLI and uses explicit `--control`.

## Tools and updates

File patches, Shell processes, plans, browser capabilities and Matrix work all use the shared executor and its existing permissions and recovery records. An interrupted write must be inspected before retry; a completed patch is not a successful test. Shell processes belong to their originating task and host.

Managed updates verify signed releases, compare base/local/incoming files, preserve local modifications and require a local rebuild when Go sources change. Distributions retain the complete reviewed core sources for that rebuild. Personal configuration, prompts, memory, databases and history are outside replacement targets. Tests use temporary data and local synthetic providers.

Protocol changes require coordinated updates to producers and consumers. Run `scripts/check-modules.py` from the project root to verify dependency direction and `scripts/public-privacy.py` before public export.
