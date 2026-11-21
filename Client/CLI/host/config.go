// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: initialize
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/config.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

// Automation uses the same response receipt and CAS save as the OS editor.
// Model validation, defaults, identity and persistence belong to Desktop.
func initialize(ctx context.Context, o options, out io.Writer) error {
	if _, err := os.Stat(o.config); err == nil {
		// Only the empty configuration created for an explicit UserData profile is
		// eligible. Shared response verification still saves with its exact version.
		p, bindErr := storage.Bind(o.config)
		if bindErr != nil {
			return bindErr
		}
		raw, readErr := os.ReadFile(o.config)
		var fields map[string]json.RawMessage
		if readErr != nil {
			return readErr
		}
		if !p.Unified || json.Unmarshal(raw, &fields) != nil || fields == nil || len(fields) != 0 {
			return fmt.Errorf("configuration already exists; unchanged")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	key := os.Getenv(o.keyEnv)
	if key == "" {
		return fmt.Errorf("credential environment variable is missing")
	}
	if o.baseURL == "" || o.model == "" {
		return fmt.Errorf("init requires --base-url and --model")
	}
	settings := newTerminalSettings(o.config)
	defer settings.close()
	call := func(action string, args any) (map[string]any, error) {
		raw, err := json.Marshal(args)
		if err != nil {
			return nil, err
		}
		result, err := settings.call(ctx, protocol.TerminalSettingsRequest{Version: protocol.TerminalSettingsVersion, Action: action, Arguments: raw})
		if err != nil {
			return nil, err
		}
		var value map[string]any
		if err = json.Unmarshal(result.Result, &value); err != nil {
			return nil, fmt.Errorf("shared settings returned invalid JSON")
		}
		if value["ok"] != true {
			var errors []string
			if items, ok := value["errors"].([]any); ok {
				for _, item := range items {
					if text, ok := item.(string); ok {
						errors = append(errors, text)
					}
				}
			}
			message := strings.Join(errors, "; ")
			if message == "" {
				message = "shared settings operation failed"
			}
			if secret := strings.TrimSpace(key); secret != "" {
				message = strings.ReplaceAll(message, secret, "[redacted]")
			}
			return nil, fmt.Errorf("%s: %s", action, message)
		}
		return value, nil
	}
	// Capacity is supplied by the shared model catalog. The legacy CLI flag
	// remains parseable for existing scripts, but cannot edit that capacity.
	proof, err := call("response_test", map[string]any{"base_url": o.baseURL, "model": o.model, "api_key": key, "api_protocol": o.protocol})
	if err != nil {
		return fmt.Errorf("connection verification failed; configuration not saved: %w", err)
	}
	if proof["response_received"] != true || proof["test_id"] == nil || proof["test_id"] == "" {
		return fmt.Errorf("shared settings returned no response receipt; configuration not saved")
	}
	saved, err := call("response_save", map[string]any{"test_id": proof["test_id"], "expected_version": proof["version"], "roles": []string{"main"}})
	if err != nil {
		return fmt.Errorf("configuration not saved; no retry: %w", err)
	}
	if o.promptDir != "" {
		if _, err = call("update", map[string]any{"patch": map[string]any{"prompt_dir": o.promptDir}, "expected_version": saved["version"]}); err != nil {
			return fmt.Errorf("connection saved, but prompt directory was not saved; use /api to review: %w", err)
		}
	}
	return json.NewEncoder(out).Encode(map[string]any{"configured": true, "path": o.config, "model": o.model, "profile": saved["model_id"], "response_verified": true, "tools_verified": false, "warning": saved["warning"]})
}
