# Aieyra desktop host and settings

`ui/` contains the shared working canvas; `host/` supplies Electron windows, IPC and core transport. `src/` and `renderer/` contain settings and browser facilities. `mountWorkspace(api)` receives host capabilities instead of importing Electron into presentation code.

OS and CLI share configuration and model semantics. CLI settings use the native terminal and Go host; they do not start this desktop service. Connection edits preserve unknown fields and use revision checks to protect concurrent changes. Keys remain masked in interfaces and are never written to diagnostic output.

## Development

Use the Node version declared in the root README and the dependencies pinned in `package-lock.json`.

```sh
npm ci
npm run ensure
npm start
npm run typecheck
npm run selftest
```

The checker discovers source files and tests, so new coverage does not require another package-script list. `config_path` prints resolved configuration locations. Platform distribution scripts live in `../../scripts/`; there is no separate desktop settings product to release.

## Boundaries

The core owns execution, tool receipts and usage. Presentation owns current-text layout, task tabs, input drafts, reasoning display, report controls and animation. Thinking occupies one horizontal line; body and execution detail share the available viewport. Reduced-motion settings must remain effective.

Settings and Go must agree on protocols, model parameters, memory schema and configuration locations. Provider catalogs are isolated by connection identity; explicit refresh can contact the provider. Public tests use temporary configurations and local synthetic responses.

The updater validates signed inventories and compares base, local and incoming content before preparing a candidate. It preserves locally modified source and excludes personal configuration, prompts, memory, databases and historical data. Public exports include build/check tools and tests; internal diagnostics and operational records remain outside the source and runtime packages.

The authoritative source is `Client/Desktop`. Root `Desktop` is frozen compatibility material for existing processes and the exact Program resources listed in `Contracts/desktop-compatibility.json`; do not develop or rebuild there. Runtime data stays at its original owner paths.
