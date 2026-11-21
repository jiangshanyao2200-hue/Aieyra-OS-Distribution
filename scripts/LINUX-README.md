# Aieyra OS on Linux

The compatibility `aieyra-os` command runs the shared CLI host. New standalone packages use `aieyra-cli`; see the [CLI guide](CLI-README.md) for current commands, platform requirements and terminal controls. Both use the same Go execution core. The standalone CLI remains subject to the release-stage switch.

Extract the matching Linux package, enter its directory and run `sh install.sh`. The compatibility installer uses `${XDG_DATA_HOME:-$HOME/.local/share}/aieyra-os` and `$HOME/.local/bin`; add the latter to PATH. Configuration is private under `${XDG_CONFIG_HOME:-$HOME/.config}/AieyraOS/`, or select a compatible external file with `--config`. Do not put personal data in the source tree.

For a new connection, set `AIEYRA_API_KEY` without placing its value in command arguments, then use the provider's actual model and protocol:

```sh
aieyra-os init --base-url https://your-provider.example/v1 --model YOUR_MODEL
unset AIEYRA_API_KEY
aieyra-os chat --workdir "$PWD"
aieyra-os run -p 'Inspect this project' --workdir "$PWD"
aieyra-os serve --workdir "$PWD"
```

Supported protocol names are `responses`, `chat_completions`, `anthropic_messages` and `google_generate`. Initialization verifies a short text response before saving a new connection and does not overwrite an existing config; that check does not establish tool or image support. The legacy `--context-window` option does not override reviewed model capacity. `config` displays identity and credential presence without the key.

Keep `chat` or `serve` running to continue its primary conversation. Saved-session creation, listing, switching and `--resume` commands are retired; existing files are retained. Within the same Core, a stable request ID retrieves its existing result without repeating completed side effects. Starting a new process does not resume that request.

`serve` remains active until SIGINT/SIGTERM even with stdin closed. Its authenticated loopback API writes a private discovery file; keep that file and credential private. `context`, `contacts`, `workflows` and `agents` use `--discovery FILE` to manage an existing Core through the same authorized RPCs. Do not expose the loopback service publicly or automatically retry uncertain writes.

Control participation is optional through `--control` and requires an existing configured bridge. Link routes work to the owning device; pairing is separate from moving session data. Personal prompts use `--prompt-dir`, with public defaults included separately. Desktop-only UI and platform capabilities require their corresponding runtime and must not be claimed from a CLI build.

For Termux use the Android arm64 CLI package rather than the Linux compatibility package. Cross-compilation does not establish device testing. To uninstall the compatibility package, run `sh "$HOME/.local/share/aieyra-os/install.sh" --uninstall`, adjusting for XDG_DATA_HOME; personal configuration and history remain intact.
