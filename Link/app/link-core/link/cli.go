// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: help; Run; readPromptFile
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/cli.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const help = `Aieyra Link — connect your own devices and Control workstations

aieyra-link host --hub-url https://SERVER:17920 [--listen 0.0.0.0:17920] [--advertise]
aieyra-link discover [--timeout 4s]
aieyra-link recover --hub-url HTTPS_ORIGIN [--timeout 8s]
aieyra-link trust
aieyra-link hub-init --hub-url https://your-hub --name owner
aieyra-link serve [--listen 127.0.0.1:17920]
aieyra-link code
aieyra-link connect --name DEVICE [--code-env AIEYRA_LINK_CODE]
aieyra-link invite
aieyra-link pair --hub-url URL --name DEVICE [--invite-env AIEYRA_LINK_INVITE]
aieyra-link attach --discovery FILE [--title NAME]
aieyra-link status
aieyra-link send --session DEVICE:SESSION --request-id ID [-p "task" | --prompt-file FILE]
aieyra-link message --id ID
aieyra-link wait --id ID [--timeout 10m]
aieyra-link cancel --id ID
aieyra-link answer --id MESSAGE --request-id ID --human-id ID --human-version N --human-token HASH [-p TEXT | --prompt-file FILE | --option ID]
aieyra-link answer-status --id ANSWER
aieyra-link events [--after CURSOR]
aieyra-link revoke --id DEVICE
aieyra-link control-attach --control-url http://127.0.0.1:17910 --name OFFICE [--share-view]
aieyra-link control-status
aieyra-link control-connect --service DEVICE:control [--listen 127.0.0.1:17921]

Common: --data DIR (private Link data), --identity FILE
Host creates a private TLS server and a one-use device code. No official account.
Advertise explicitly announces public host metadata on private LAN interfaces.
Discover lists unverified hints, never device codes or permission. Recover checks
the original saved TLS pin and signed device before saving an address override;
it preserves the pairing file, task IDs and grants, and never resubmits a task.
LAN, Wi-Fi and USB networking use the same encrypted connection. USB cables
require an IP network adapter/tethering or an explicitly configured port tunnel.
Serve without TLS remains loopback-only for an HTTPS proxy or SSH tunnel.
Control-attach exposes only the Agent API; --share-view explicitly shares the
read-only office view with paired devices. Existing Agent tokens and CAS apply.
Control-connect creates a local gateway for existing Control Agent profiles.
Attach connects only the selected OS discovery file; the OS core must be running.
Session execution stays on its owning device. Idle Link never calls a model.
Pair reads the invitation from the selected environment variable, never argv.
Prompt files contain one UTF-8 message, at most 16000 bytes, and exclude -p.
`

func Run(ctx context.Context, args []string, out, diagnostic io.Writer) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		_, e := io.WriteString(out, help)
		return e
	}
	if args[0] == "version" {
		_, e := fmt.Fprintln(out, "Aieyra Link", Version)
		return e
	}
	command := args[0]
	fs := flag.NewFlagSet("aieyra-link", flag.ContinueOnError)
	fs.SetOutput(diagnostic)
	base, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	data := fs.String("data", filepath.Join(base, "AieyraLink"), "private Link directory")
	identityPath := fs.String("identity", "", "device identity file")
	endpoint := fs.String("hub-url", "", "HTTPS or loopback hub URL")
	name := fs.String("name", "", "device display name")
	listen := fs.String("listen", "127.0.0.1:17920", "loopback listen address")
	inviteEnv := fs.String("invite-env", "AIEYRA_LINK_INVITE", "invitation environment variable")
	codeEnv := fs.String("code-env", "AIEYRA_LINK_CODE", "device code environment variable")
	controlURL := fs.String("control-url", "http://127.0.0.1:17910", "explicit local Control origin")
	serviceID := fs.String("service", "", "remote Control service ID")
	shareView := fs.Bool("share-view", false, "share read-only office view with paired devices")
	advertise := fs.Bool("advertise", false, "explicitly announce this TLS host on the private LAN")
	discoveryPath := fs.String("discovery", "", "explicit private OS discovery file")
	title := fs.String("title", "", "session title shared with paired devices")
	session := fs.String("session", "", "device:session ID")
	request := fs.String("request-id", "", "idempotent message ID")
	prompt := fs.String("p", "", "message")
	promptFile := fs.String("prompt-file", "", "private UTF-8 message file (at most 16000 bytes; excludes -p)")
	id := fs.String("id", "", "message or device ID")
	after := fs.Uint64("after", 0, "last received event cursor")
	wait := fs.Bool("wait", false, "wait after send until completed or a human decision is required")
	timeout := fs.Duration("timeout", 10*time.Minute, "bounded result wait; timeout does not cancel execution")
	humanID := fs.String("human-id", "", "question ID from message")
	humanVersion := fs.Int("human-version", 0, "original question version")
	humanToken := fs.String("human-token", "", "original question token hash")
	option := fs.String("option", "", "selected option ID")
	if e = fs.Parse(args[1:]); e != nil {
		return e
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected arguments")
	}
	var hasPrompt, hasPromptFile, hasOption, hasTimeout bool
	fs.Visit(func(f *flag.Flag) {
		hasPrompt = hasPrompt || f.Name == "p"
		hasPromptFile = hasPromptFile || f.Name == "prompt-file"
		hasOption = hasOption || f.Name == "option"
		hasTimeout = hasTimeout || f.Name == "timeout"
	})
	if hasPromptFile {
		if command != "send" && command != "answer" {
			return fmt.Errorf("--prompt-file is only for send or answer")
		}
		if hasPrompt {
			return fmt.Errorf("--prompt-file and -p are mutually exclusive")
		}
		if hasOption {
			return fmt.Errorf("--prompt-file and --option are mutually exclusive")
		}
		*prompt, e = readPromptFile(*promptFile)
		if e != nil {
			return e
		}
	}
	if command == "answer" && hasPrompt && hasOption {
		return fmt.Errorf("-p and --option are mutually exclusive")
	}
	if (command == "wait" || command == "send" && *wait) && *timeout <= 0 {
		return fmt.Errorf("timeout must be positive")
	}
	encode := func(v any) error { return json.NewEncoder(out).Encode(v) }
	if *advertise && command != "host" {
		return fmt.Errorf("--advertise is only for a TLS host")
	}
	if command == "discover" {
		if !hasTimeout {
			*timeout = 4 * time.Second
		}
		result, err := DiscoverLAN(ctx, *timeout)
		if err != nil {
			return err
		}
		return encode(result)
	}
	if command == "hub-init" {
		i, e := InitHub(*data, *endpoint, *name)
		if e != nil {
			return e
		}
		return encode(map[string]any{"initialized": true, "device_id": i.ID, "identity": filepath.Join(*data, "owner.json"), "hub_url": i.URL})
	}
	if command == "serve" || command == "host" {
		var certFile, keyFile string
		if command == "host" {
			if *listen == "127.0.0.1:17920" {
				*listen = "0.0.0.0:17920"
			}
			if *name == "" {
				*name = "Link server"
			}
			i, err := LoadIdentity(filepath.Join(*data, "owner.json"))
			if os.IsNotExist(err) {
				if _, err = validURL(*endpoint); err != nil {
					return err
				}
				i, err = InitHub(*data, *endpoint, *name)
			}
			if err != nil {
				return err
			}
			if *endpoint != "" && strings.TrimRight(*endpoint, "/") != i.URL {
				return fmt.Errorf("existing hub URL retained; use the original address")
			}
			var pin string
			certFile, keyFile, pin, err = prepareTLS(*data, i.URL)
			if err != nil {
				return err
			}
			if i.TLSFingerprint != "" && i.TLSFingerprint != pin {
				return fmt.Errorf("server TLS identity changed; original retained")
			}
			i.TLSFingerprint = pin
			if err = writeJSON(filepath.Join(*data, "owner.json"), i); err != nil {
				return err
			}
		}
		host, _, e := net.SplitHostPort(*listen)
		if e != nil || net.ParseIP(host) == nil || command != "host" && !net.ParseIP(host).IsLoopback() {
			return fmt.Errorf("serve requires a literal loopback address; use HTTPS reverse proxy or SSH tunnel")
		}
		h, e := OpenHub(*data)
		if e != nil {
			return e
		}
		defer h.Close()
		l, e := net.Listen("tcp", *listen)
		if e != nil {
			return e
		}
		s := &http.Server{Handler: h, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
		done := make(chan error, 1)
		ready := map[string]any{"state": "ready", "listen": l.Addr().String(), "version": Version}
		if command == "host" {
			i, err := LoadIdentity(filepath.Join(*data, "owner.json"))
			if err != nil {
				l.Close()
				return err
			}
			value, err := h.dispatch(h.state.Devices[i.ID], "/v1/invites", []byte("{}"))
			if err != nil {
				l.Close()
				return err
			}
			if err = writeJSON(h.path, h.state); err != nil {
				l.Close()
				return err
			}
			v := value.(map[string]any)
			ready["device_code"] = encodeCode(i, v["invite"].(string), v["expires_unix"].(int64))
			ready["expires_unix"] = v["expires_unix"]
			ready["hub_url"] = i.URL
			go func() { done <- s.ServeTLS(l, certFile, keyFile) }()
			ready["advertising"] = false
			if *advertise {
				announcement, issue := advertiseLAN(i, l.Addr())
				if issue != nil {
					ready["discovery_error"] = "LAN advertisement unavailable; device-code connection remains available"
				} else {
					defer announcement.Shutdown()
					ready["advertising"] = true
				}
			}
		} else {
			go func() { done <- s.Serve(l) }()
		}
		if e = encode(ready); e != nil {
			s.Close()
			return e
		}
		select {
		case <-ctx.Done():
			stop, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			return s.Shutdown(stop)
		case e = <-done:
			if e == http.ErrServerClosed {
				return nil
			}
			return e
		}
	}
	if *identityPath == "" {
		*identityPath = filepath.Join(*data, "device.json")
		if _, e = os.Stat(*identityPath); os.IsNotExist(e) && command != "pair" && command != "connect" {
			*identityPath = filepath.Join(*data, "owner.json")
		}
	}
	if command == "connect" {
		i, e := PairCode(ctx, *identityPath, *name, os.Getenv(*codeEnv))
		if e != nil {
			return e
		}
		return encode(map[string]any{"paired": true, "device_id": i.ID, "hub_url": i.URL})
	}
	if command == "pair" {
		invite := strings.TrimSpace(os.Getenv(*inviteEnv))
		if len(invite) != 64 {
			return fmt.Errorf("invitation environment variable missing or invalid")
		}
		i, e := Pair(ctx, *identityPath, strings.TrimRight(*endpoint, "/"), *name, invite)
		if e != nil {
			return e
		}
		return encode(map[string]any{"paired": true, "device_id": i.ID, "hub_url": i.URL})
	}
	if command == "recover" {
		if !hasTimeout {
			*timeout = 8 * time.Second
		}
		if *timeout <= 0 || *timeout > 20*time.Second {
			return fmt.Errorf("recovery timeout must be between zero and twenty seconds")
		}
		check, cancel := context.WithTimeout(ctx, *timeout)
		defer cancel()
		result, err := RecoverEndpoint(check, *identityPath, *endpoint)
		if err != nil {
			return err
		}
		return encode(result)
	}
	if command == "trust" {
		result, err := pairedTrust(*identityPath)
		if err != nil {
			return err
		}
		return encode(result)
	}
	i, e := LoadConnectionIdentity(*identityPath)
	if e != nil {
		return e
	}
	c, e := NewClient(i)
	if e != nil {
		return e
	}
	if command == "control-attach" {
		if *name == "" {
			*name = i.Name
		}
		return RunControlBridge(ctx, c, *controlURL, *name, filepath.Join(*data, "control", i.ID), *shareView, out)
	}
	if command == "control-connect" {
		if *listen == "127.0.0.1:17920" {
			*listen = "127.0.0.1:17921"
		}
		return ServeControlProxy(ctx, c, *serviceID, *listen, out)
	}
	if command == "attach" {
		if *discoveryPath == "" {
			return fmt.Errorf("--discovery must select one OS session")
		}
		b, e := OpenBridge(ctx, c, *discoveryPath, *title)
		if e != nil {
			return e
		}
		defer b.Close()
		if e = encode(map[string]any{"state": "attached", "session_id": b.SessionID(), "execution_device": i.ID}); e != nil {
			return e
		}
		return b.Run(ctx, diagnostic)
	}
	var result json.RawMessage
	switch command {
	case "code":
		var invitation struct {
			Invite  string `json:"invite"`
			Expires int64  `json:"expires_unix"`
		}
		if e = c.Call(ctx, "/v1/invites", nil, &invitation); e != nil {
			return e
		}
		return encode(map[string]any{"device_code": encodeCode(i, invitation.Invite, invitation.Expires), "expires_unix": invitation.Expires})
	case "control-status":
		e = c.Call(ctx, "/v1/control/catalog", nil, &result)
	case "invite":
		e = c.Call(ctx, "/v1/invites", nil, &result)
	case "status":
		e = c.Call(ctx, "/v1/catalog", nil, &result)
	case "events":
		e = c.Call(ctx, "/v1/events", map[string]any{"after": *after}, &result)
	case "message":
		e = c.Call(ctx, "/v1/messages", map[string]string{"id": *id}, &result)
	case "wait":
		if *timeout <= 0 {
			return fmt.Errorf("timeout must be positive")
		}
		waitCtx, cancel := context.WithTimeout(ctx, *timeout)
		defer cancel()
		m, err := c.Wait(waitCtx, *id)
		if err != nil {
			return err
		}
		return encode(m)
	case "cancel":
		e = c.Call(ctx, "/v1/cancel", map[string]string{"id": *id}, &result)
	case "answer":
		e = c.Call(ctx, "/v1/answer", map[string]any{"id": *id, "request_id": *request, "human_id": *humanID, "expected_request_version": *humanVersion, "request_token_sha256": *humanToken, "decision": Decision{OptionID: *option, Text: *prompt}}, &result)
	case "answer-status":
		e = c.Call(ctx, "/v1/answers", map[string]string{"id": *id}, &result)
	case "revoke":
		e = c.Call(ctx, "/v1/revoke", map[string]string{"device_id": *id}, &result)
	case "send":
		if *request == "" {
			return fmt.Errorf("--request-id is required for safe retry")
		}
		e = c.Call(ctx, "/v1/send", map[string]string{"session_id": *session, "request_id": *request, "text": *prompt}, &result)
		if e == nil && *wait {
			var sent Message
			if e = json.Unmarshal(result, &sent); e != nil {
				return e
			}
			// Print the durable handle before waiting, including on timeout.
			if e = encode(sent); e != nil {
				return e
			}
			waitCtx, cancel := context.WithTimeout(ctx, *timeout)
			defer cancel()
			m, err := c.Wait(waitCtx, sent.ID)
			if err != nil {
				return err
			}
			return encode(m)
		}
	default:
		return fmt.Errorf("unknown command; use help")
	}
	if e != nil {
		return e
	}
	return encode(result)
}

func readPromptFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("prompt file unavailable")
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > 16000 {
		return "", fmt.Errorf("prompt file must be a regular file of at most 16000 bytes")
	}
	b, err := io.ReadAll(io.LimitReader(f, 16001))
	if err != nil || len(b) > 16000 || !utf8.Valid(b) || strings.ContainsRune(string(b), '\x00') {
		return "", fmt.Errorf("prompt file must contain at most 16000 bytes of UTF-8 text without NUL")
	}
	return string(b), nil
}
