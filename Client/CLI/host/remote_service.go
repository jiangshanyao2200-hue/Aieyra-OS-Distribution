// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: runRemoteService; discoveryClient; runSessionService
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/remote_service.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"runtime"
	"strings"
)

// A management command attaches to the selected owner's running Core. It never
// opens another workspace or retries a mutation after an uncertain response.
func runRemoteService(ctx context.Context, name, method, help string, limit int64, args []string, in io.Reader, out, diagnostic io.Writer) error {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(diagnostic)
	discovery := fs.String("discovery", "", "private discovery file of the selected running Core")
	fs.Usage = func() {
		fmt.Fprintf(out, "Aieyra CLI %s --discovery FILE\nRead one JSON object from stdin; write one JSON result.\n%s\nThe selected Core owns authorization, state and execution. This command does not start or stop it.\nIf a reply is lost, inspect the original state/request; do not blindly repeat mutations.\n", name, help)
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if fs.NArg() != 0 || *discovery == "" {
		return fmt.Errorf("%s requires --discovery FILE; use %s --help", name, name)
	}
	c, err := discoveryClient(*discovery)
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(in, limit+1))
	if err != nil {
		return err
	}
	if int64(len(raw)) > limit {
		return fmt.Errorf("%s command exceeds %d bytes", name, limit)
	}
	var command map[string]json.RawMessage
	if json.Unmarshal(raw, &command) != nil || command == nil {
		return fmt.Errorf("one JSON %s command object is required", name)
	}
	var result json.RawMessage
	if err = c.call(ctx, method, json.RawMessage(raw), &result); err != nil {
		return err
	}
	if err = json.NewEncoder(out).Encode(result); err != nil {
		return err
	}
	// Partial cleanup receipts are useful even when the operation failed. Keep
	// the complete receipt on stdout, but expose failure to shell automation.
	var receipt struct {
		OK    *bool  `json:"ok"`
		Error string `json:"error"`
	}
	if json.Unmarshal(result, &receipt) == nil && receipt.OK != nil && !*receipt.OK {
		if receipt.Error != "" {
			return fmt.Errorf("%s", terminalText(receipt.Error))
		}
		return fmt.Errorf("%s operation did not complete; inspect the JSON receipt", name)
	}
	return nil
}

func discoveryClient(file string) (*client, error) {
	before, err := os.Lstat(file)
	if err != nil {
		return nil, err
	}
	private := func(info os.FileInfo) bool {
		return info.Mode().IsRegular() && info.Size() <= 64<<10 && (runtime.GOOS == "windows" || info.Mode().Perm()&0077 == 0)
	}
	if !private(before) {
		return nil, fmt.Errorf("select a private regular Core discovery file")
	}
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !private(opened) || !os.SameFile(before, opened) {
		return nil, fmt.Errorf("Core discovery changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	if err != nil || len(data) > 64<<10 {
		return nil, fmt.Errorf("invalid Core discovery")
	}
	var d struct {
		Session string `json:"session_id"`
		URL     string `json:"url"`
		Token   string `json:"token"`
	}
	if json.Unmarshal(bytes.TrimSpace(data), &d) != nil {
		return nil, fmt.Errorf("invalid Core discovery")
	}
	u, err := url.Parse(d.URL)
	id, idErr := hex.DecodeString(d.Session)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/v1/rpc" || u.RawPath != "" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || idErr != nil || len(id) != 16 || d.Session != strings.ToLower(d.Session) || len(d.Token) < 32 {
		return nil, fmt.Errorf("invalid local Core discovery")
	}
	return newClient(map[string]any{"url": d.URL, "token": d.Token, "session_id": d.Session}), nil
}

func runSessionService(ctx context.Context, name string, args []string, in io.Reader, out, diagnostic io.Writer) error {
	switch name {
	case "context":
		return runRemoteService(ctx, name, "workspace.context", "Select the primary Desktop Core. Actions: view, status, new, switch, reset, edit, restore, memory, provider, clean, cancel_clean, records.\nRead view first; changes require its exact source. Text is limited by Core to 256 KiB. Provider uses the exact id/version/state_schema.\nrecords also requires memory_action (search/read/update/forget/status/packets/packet/original/snapshot/history).\nCleaning may call the configured model. Read-only commands never initiate a model call.", 1<<20, args, in, out, diagnostic)
	case "contacts":
		return runRemoteService(ctx, name, "workspace.conversation", "Actions: contacts, contact, contact_create, contact_update, contact_delete, session_create, session_delete, status, snapshot, settings, configure, send, cancel.\nUse the existing contact/session ID and inspected generation/revision for its operation. Send requires a stable request_id.\nDeletion retains and prints any partial cleanup receipt; retry only its pending items through the same service.", 1<<20, args, in, out, diagnostic)
	case "workflows":
		return runRemoteService(ctx, name, "workspace.workflows", "Actions: describe, list, call. Provide the complete package ID. call also takes the existing workflow command.\nUse owner and run identity from list/describe; execution, review, cancellation and recovery stay in the selected Core.\nThis does not install or enable a package; use mods for package lifecycle.", 1<<20, args, in, out, diagnostic)
	}
	return fmt.Errorf("unknown session service")
}
