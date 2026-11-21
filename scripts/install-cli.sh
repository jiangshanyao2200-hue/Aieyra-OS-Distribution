#!/bin/sh
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show scripts/install-cli.sh
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

set -eu
# Program and commands only; shared OS config, memory and sessions are preserved.
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data_root=${XDG_DATA_HOME:-"$HOME/.local/share"}
bin_root="$HOME/.local/bin"
# Termux programs must be in private app storage, not Android shared storage.
if [ -n "${TERMUX_VERSION:-}" ]; then
    : "${PREFIX:?Termux PREFIX is required}"
    data_root="$HOME/.local/share"
    bin_root="$PREFIX/bin"
fi
target="$data_root/aieyra-cli"
case "$target:$bin_root" in /*:/*) ;; *) echo 'Install paths must be absolute' >&2; exit 1;; esac
for process in /proc/[0-9]*/exe; do
    if [ "$(readlink "$process" 2>/dev/null || :)" = "$target/aieyra-cli" ]; then
        echo 'This CLI installation is running; close its sessions before updating' >&2
        exit 1
    fi
done
if [ -L "$target" ]; then echo 'Install directory must not be a symlink' >&2; exit 1; fi
if [ "${1:-}" = '--uninstall' ]; then
    if [ "$(cat "$target/.aieyra-install" 2>/dev/null || :)" != 'aieyra.cli/1' ]; then echo 'No managed CLI installation found' >&2; exit 1; fi
    if [ -L "$bin_root/aieyra-cli" ] && [ "$(readlink "$bin_root/aieyra-cli")" = "$target/aieyra-cli" ]; then rm -- "$bin_root/aieyra-cli"; fi
    rm -f -- "$target/aieyra-cli" "$target/install.sh" "$target/README.md" "$target/LICENSE"
    echo 'CLI removed; configuration, prompts and saved sessions preserved.'
    exit 0
fi
if [ "$#" -ne 0 ]; then echo 'Usage: sh install.sh [--uninstall]' >&2; exit 1; fi
if [ -e "$target" ] && [ "$(cat "$target/.aieyra-install" 2>/dev/null || :)" != 'aieyra.cli/1' ]; then echo 'Existing unmanaged directory left unchanged' >&2; exit 1; fi
if [ -e "$bin_root/aieyra-cli" ] || [ -L "$bin_root/aieyra-cli" ]; then
    if [ ! -L "$bin_root/aieyra-cli" ] || [ "$(readlink "$bin_root/aieyra-cli")" != "$target/aieyra-cli" ]; then echo 'Existing command left unchanged' >&2; exit 1; fi
fi
umask 077
mkdir -p -- "$target/Config" "$target/Prompt" "$bin_root"
cp -- "$source_dir/aieyra-cli" "$target/.aieyra-cli.tmp"
chmod 755 "$target/.aieyra-cli.tmp"
mv -f -- "$target/.aieyra-cli.tmp" "$target/aieyra-cli"
cp -- "$source_dir/README.md" "$source_dir/install.sh" "$source_dir/LICENSE" "$target/"
find "$source_dir/Config" "$source_dir/Prompt" -type f | while IFS= read -r resource; do
    relative=${resource#"$source_dir/"}
    destination="$target/$relative"
    mkdir -p -- "$(dirname -- "$destination")"
    if [ ! -e "$destination" ]; then cp -- "$resource" "$destination"; fi
done
printf '%s\n' 'aieyra.cli/1' > "$target/.aieyra-install"
if [ ! -L "$bin_root/aieyra-cli" ]; then ln -s "$target/aieyra-cli" "$bin_root/aieyra-cli"; fi
printf 'Installed: %s\nAdd %s to PATH, then run: aieyra-cli help\n' "$bin_root/aieyra-cli" "$bin_root"
