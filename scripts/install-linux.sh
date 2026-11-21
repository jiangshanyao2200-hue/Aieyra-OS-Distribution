#!/bin/sh
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show scripts/install-linux.sh
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

set -eu
# One user installation. Configuration/session files are outside this directory.
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data_root=${XDG_DATA_HOME:-"$HOME/.local/share"}
bin_root="$HOME/.local/bin"
target="$data_root/aieyra-os"
case "$target" in /*) ;; *) echo 'XDG_DATA_HOME must be absolute' >&2; exit 1;; esac
for process in /proc/[0-9]*/exe; do
    if [ "$(readlink "$process" 2>/dev/null || :)" = "$target/aieyra-os" ]; then
        echo 'This installation is running; stop its owned core before replacing it' >&2
        exit 1
    fi
done
if [ "${1:-}" = '--uninstall' ]; then
    if [ ! -f "$target/.aieyra-install" ]; then echo 'No managed installation found' >&2; exit 1; fi
    if [ -L "$bin_root/aieyra-os" ] && [ "$(readlink "$bin_root/aieyra-os")" = "$target/aieyra-os" ]; then rm -- "$bin_root/aieyra-os"; fi
    rm -f -- "$target/aieyra-os" "$target/install.sh" "$target/README.md"
    echo 'Program removed; configuration, prompts and session data preserved.'
    exit 0
fi
if [ "$#" -ne 0 ]; then echo 'Usage: sh install.sh [--uninstall]' >&2; exit 1; fi
if [ -e "$target" ] && [ ! -f "$target/.aieyra-install" ]; then echo 'Existing unmanaged directory left unchanged' >&2; exit 1; fi
if [ -e "$bin_root/aieyra-os" ] || [ -L "$bin_root/aieyra-os" ]; then
    if [ ! -L "$bin_root/aieyra-os" ] || [ "$(readlink "$bin_root/aieyra-os")" != "$target/aieyra-os" ]; then echo 'Existing command left unchanged' >&2; exit 1; fi
fi
umask 077
mkdir -p -- "$target/Config" "$target/Prompt" "$bin_root"
cp -- "$source_dir/aieyra-os" "$target/.aieyra-os.tmp"
chmod 755 "$target/.aieyra-os.tmp"
mv -f -- "$target/.aieyra-os.tmp" "$target/aieyra-os"
cp -- "$source_dir/README.md" "$source_dir/install.sh" "$target/"
find "$source_dir/Config" "$source_dir/Prompt" -type f | while IFS= read -r resource; do
    relative=${resource#"$source_dir/"}
    destination="$target/$relative"
    mkdir -p -- "$(dirname -- "$destination")"
    if [ ! -e "$destination" ]; then cp -- "$resource" "$destination"; fi
done
printf '%s\n' 'aieyra.os' > "$target/.aieyra-install"
if [ ! -L "$bin_root/aieyra-os" ]; then ln -s "$target/aieyra-os" "$bin_root/aieyra-os"; fi
printf 'Installed: %s\nAdd %s to PATH, then run: aieyra-os help\n' "$bin_root/aieyra-os" "$bin_root"
