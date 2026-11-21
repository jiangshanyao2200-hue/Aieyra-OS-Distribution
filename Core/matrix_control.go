// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MatrixCommand; MatrixCommandResult; MatrixControl; NewMatrixControl; WriteMatrixJSON; Close; serve; Call; SetWindowOpener
// Impact: python -B scripts/code-atlas.py show Core/matrix_control.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// One authenticated endpoint per live Matrix session. Discovery files stay in
// the user's configuration directory, never in the workspace or telemetry.
type MatrixCommand struct {
	Context   context.Context
	Action    string
	Arguments json.RawMessage
	Reply     chan MatrixCommandResult
}
type MatrixCommandResult struct {
	Data any
	Err  error
}
type MatrixControl struct {
	Commands             chan MatrixCommand
	manager              *AgentManager
	server               *http.Server
	file, token, address string
	done                 chan struct{}
	closeOnce            sync.Once
	registrationState    string
}

func NewMatrixControl(manager *AgentManager) (*MatrixControl, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	var secret [32]byte
	if _, err = rand.Read(secret[:]); err != nil {
		l.Close()
		return nil, err
	}
	c := &MatrixControl{manager: manager, Commands: make(chan MatrixCommand, 8), token: hex.EncodeToString(secret[:]), address: "http://" + l.Addr().String(), done: make(chan struct{})}
	c.server = &http.Server{Handler: http.HandlerFunc(c.serve), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	dir := PrivatePaths(manager.config).MatrixAPI
	if err = os.MkdirAll(dir, 0700); err != nil {
		l.Close()
		return nil, err
	}
	c.file = filepath.Join(dir, manager.owner+".json")
	exe, _ := os.Executable()
	created := time.Now().UTC().Format(time.RFC3339Nano)
	mode := manager.workspace.Mode()
	b, _ := json.MarshalIndent(map[string]any{"version": 1, "session_id": manager.owner, "pid": os.Getpid(), "executable": exe, "url": c.address + "/v1/rpc", "token": c.token, "created_at": created, "mode": mode}, "", "  ")
	if err = privatefile.Write(c.file, b); err != nil {
		l.Close()
		return nil, err
	}
	c.registrationState = "not_configured"
	register := manager.workspace == nil || manager.workspace.host == nil || !manager.workspace.isTerminal() || manager.workspace.host.control
	if !register {
		c.registrationState = "disabled"
	} else if err = c.registerControl(created, exe); err != nil {
		c.registrationState = "registration_failed"
	}
	go func() { _ = c.server.Serve(l); close(c.done) }()
	return c, nil
}

func WriteMatrixJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return privatefile.Write(path, b)
}
func (c *MatrixControl) Close() {
	if c == nil {
		return
	}
	c.closeOnce.Do(func() { _ = c.server.Close(); <-c.done; _ = os.Remove(c.file) })
}
func (c *MatrixControl) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	write := func(status int, value any) { w.WriteHeader(status); _ = json.NewEncoder(w).Encode(value) }
	provided, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !bearer || r.Host != strings.TrimPrefix(c.address, "http://") || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" || subtle.ConstantTimeCompare([]byte(provided), []byte(c.token)) != 1 {
		write(403, map[string]any{"ok": false, "error": "unauthorized"})
		return
	}
	if r.Method != "POST" || r.URL.Path != "/v1/rpc" {
		write(404, map[string]any{"ok": false, "error": "unknown_endpoint"})
		return
	}
	mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaErr != nil || mediaType != "application/json" {
		write(415, map[string]any{"ok": false, "error": "json_required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var p protocol.RPCRequest
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil || d.Decode(new(any)) != io.EOF {
		write(400, map[string]any{"ok": false, "error": "invalid_request"})
		return
	}
	if len(p.Arguments) == 0 {
		p.Arguments = json.RawMessage(`{}`)
	}
	timeout := 55 * time.Second
	if p.Action == "workspace.updates" {
		timeout = 25 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	value, err := c.Call(ctx, p.Action, p.Arguments)
	if err != nil {
		result := map[string]any{"ok": false, "error": c.manager.redact(err.Error())}
		var rejected *composerSendRejection
		if errors.As(err, &rejected) && (p.Action == "workspace.task_send" || p.Action == "workspace.send" || p.Action == "matrix.send") {
			code := rejected.Code
			if code == "" {
				code = "attachment_rejected"
			}
			result["send_rejection"] = map[string]string{"code": code, "task_id": rejected.TaskID, "request_id": rejected.RequestID}
		}
		write(400, result)
		return
	}
	// Shared services already redact, with this final filter covering new fields.
	b, err := json.Marshal(map[string]any{"ok": true, "data": value})
	if err != nil {
		write(500, map[string]any{"ok": false, "error": "encode_failed"})
		return
	}
	_, _ = w.Write([]byte(c.manager.redact(string(b))))
}
func (c *MatrixControl) Call(ctx context.Context, action string, args json.RawMessage) (any, error) {
	if w := c.manager.workspace; w != nil && (strings.HasPrefix(action, "workspace.") || action == "matrix.status" || action == "matrix.send" || action == "matrix.cancel" || action == "matrix.events") {
		return w.Call(ctx, action, args)
	}
	if strings.HasPrefix(action, "humans.") {
		return c.scopedHuman(action, args)
	}
	if action == "agents.activity" {
		var p struct {
			TaskID string `json:"task_id"`
			ID     string `json:"id"`
			Since  int64  `json:"since"`
			Before int64  `json:"before"`
			Limit  int    `json:"limit"`
		}
		if decodeHuman(args, &p) != nil {
			return nil, fmt.Errorf("invalid activity arguments")
		}
		m, err := c.taskManager(p.TaskID)
		if err != nil {
			return nil, err
		}
		if p.TaskID != "" && p.TaskID != m.owner && p.ID != p.TaskID {
			return nil, fmt.Errorf("activity does not belong to the selected task")
		}
		return m.Activity(m.owner, p.ID, p.Since, p.Before, p.Limit)
	}
	if action == "describe" {
		return map[string]any{"version": 1, "generation_guarded_commands": true, "human_callback_version": 1, "control_registration": c.registrationState, "session_id": c.manager.owner, "actions": []string{"matrix.status", "matrix.send", "matrix.cancel", "matrix.events", "humans.list", "humans.status", "humans.reply", "agents.models", "agents.create", "agents.list", "agents.status", "agents.activity", "agents.events", "agents.wait", "agents.send", "agents.cancel", "agents.review", "agents.open_window", "agents.hide_window", "tool_factory", "settings"}, "tool_manual": MatrixAgentManual(), "factory_manual": ToolFactoryManual(), "scope": "this Matrix session and its descendants"}, nil
	}
	if action == "matrix.events" {
		var p struct {
			Cursor int64 `json:"cursor"`
			Limit  int   `json:"limit"`
		}
		if json.Unmarshal(args, &p) != nil {
			return nil, fmt.Errorf("invalid event arguments")
		}
		path, err := SessionPath(c.manager.config, c.manager.owner)
		if err != nil {
			return nil, err
		}
		return c.manager.events(path, p.Cursor, p.Limit)
	}
	if action == "tool_factory" {
		return c.manager.toolFactory(ctx, args)
	}
	if strings.HasPrefix(action, "agents.") {
		var p map[string]any
		if json.Unmarshal(args, &p) != nil || p == nil {
			return nil, fmt.Errorf("arguments must be an object")
		}
		p["action"] = strings.TrimPrefix(action, "agents.")
		data, _ := json.Marshal(p)
		return c.manager.Call(ctx, c.manager.owner, data)
	}
	if action == "settings" {
		if c.manager.service == nil {
			return nil, fmt.Errorf("settings service unavailable")
		}
		var p map[string]json.RawMessage
		if json.Unmarshal(args, &p) != nil || p == nil {
			return nil, fmt.Errorf("arguments must be an object")
		}
		var method string
		_ = json.Unmarshal(p["action"], &method)
		delete(p, "action")
		allowed := map[string]bool{"read": true, "models": true, "pool": true, "connections": true, "connection_update": true, "connection_remove": true, "catalog": true, "catalog_add": true, "matrix": true, "matrix_update": true, "model_update": true, "pool_action": true, "model_test": true, "model_diagnostics": true, "probe": true, "configure": true, "switch": true, "remove": true, "update": true, "capabilities_refresh": true, "parameters_probe": true, "appearance_read": true, "appearance_update": true, "os_appearance_read": true, "os_appearance_update": true}
		allowed["onboarding_status"], allowed["onboarding_catalog"], allowed["onboarding_connect"] = true, true, true
		allowed["api_adapter_apply"], allowed["api_adapter_reset"] = true, true
		for _, name := range []string{"schema", "inspect", "validate", "apply", "restore", "diagnostics", "profile_image", "onboarding_draft", "onboarding_parameters", "onboarding_preferences", "onboarding_test", "onboarding_save", "onboarding_recovery", "onboarding_restore", "connection_recovery", "connection_restore", "connection_draft", "response_test", "response_save"} {
			allowed[name] = true
		}
		if !allowed[method] {
			return nil, fmt.Errorf("settings action is not exposed")
		}
		data, _ := json.Marshal(p)
		result, err := c.manager.service.Call(ctx, c.manager.owner, method, data)
		if err == nil && (method == "response_save" || method == "onboarding_save") && c.manager.workspace != nil {
			c.manager.workspace.acceptConnectionResponse(result)
		}
		return result, err
	}
	if action != "matrix.status" && action != "matrix.send" && action != "matrix.cancel" {
		return nil, fmt.Errorf("unknown_action")
	}
	cmd := MatrixCommand{Context: ctx, Action: action, Arguments: args, Reply: make(chan MatrixCommandResult, 1)}
	select {
	case c.Commands <- cmd:
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
		return nil, fmt.Errorf("Matrix command queue is busy")
	}
	select {
	case result := <-cmd.Reply:
		return result.Data, result.Err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.done:
		return nil, fmt.Errorf("Matrix session closed")
	}
}

func (m *AgentManager) SetWindowOpener(open func(...string) error, hide ...func() error) {
	m.mu.Lock()
	m.window = open
	if len(hide) > 0 {
		m.windowHide = hide[0]
	}
	m.mu.Unlock()
}
