// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: trustedKey; main
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-install/main_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"io"
	"os"

	"github.com/aieyra/aieyra-os/CORE/host"
)

// The release packager binds the verifier to the public key used to check the
// release. The installer UI never accepts a key or archive from a folder picker.
var trustedKey string

func main() {
	archive := flag.String("archive", "", "")
	version := flag.String("version", "", "")
	sequence := flag.Int("sequence", 0, "")
	root := flag.String("program", "", "")
	data := flag.String("data", "", "")
	desktop := flag.String("desktop", "", "")
	shortcuts := flag.Bool("shortcuts", true, "")
	interactive := flag.Bool("interactive", false, "")
	flag.Parse()
	report := json.NewEncoder(os.Stdout)
	send := func(event host.InstallProgress) { _ = report.Encode(event) }
	key, err := base64.StdEncoding.DecodeString(trustedKey)
	if err != nil || len(key) == 0 {
		send(host.InstallProgress{Step: "error", Message: "安装器缺少签名验证公钥"})
		os.Exit(1)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	commit := make(chan struct{}, 1)
	inputClosed := make(chan struct{})
	go func() {
		defer close(inputClosed)
		input := bufio.NewScanner(os.Stdin)
		for input.Scan() {
			switch input.Text() {
			case "cancel":
				cancel()
				return
			case "commit":
				select {
				case commit <- struct{}{}:
				default:
				}
			}
		}
	}()
	beforeCommit := func(ctx context.Context) error {
		if !*interactive {
			return ctx.Err()
		}
		// Hold the commit while the window is still accepting cancellation.
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-inputClosed:
			if err := ctx.Err(); err != nil {
				return err
			}
			return io.ErrUnexpectedEOF
		case <-commit:
			return ctx.Err()
		}
	}
	if err := host.InstallWindows(ctx, *archive, key, *version, *sequence, *root, *data, *shortcuts, *desktop, send, beforeCommit); err != nil {
		send(host.InstallProgress{Step: "error", Message: err.Error()})
		os.Exit(1)
	}
}
