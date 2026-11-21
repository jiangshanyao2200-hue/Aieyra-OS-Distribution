// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestImageFallbackAcrossRuntimeRoles; TestAuxiliaryVisionUsesActualRequestAndUsage
// Impact: python -B scripts/code-atlas.py show Core/image_fallback_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
	viewtool "github.com/aieyra/aieyra-os/tool/base/official/view_image"
)

func TestImageFallbackAcrossRuntimeRoles(t *testing.T) {
	if !viewtool.OCRAvailable() {
		t.Skip("local OCR adapter unavailable")
	}
	for _, role := range []string{"child", "conversation", "primary", "package"} {
		t.Run(role, func(t *testing.T) {
			var requests atomic.Int32
			var path string
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				wire := string(rawJSON(body))
				if strings.Contains(wire, "data:image/") {
					t.Error("text model received unsupported image bytes")
				}
				if requests.Add(1) == 1 {
					if !strings.Contains(string(rawJSON(body["tools"])), `"name":"view_image"`) {
						t.Error("missing assigned fallback schema")
					}
					fixtureAnswer(w, "image-call", "", []any{map[string]any{"type": "function_call", "id": "fc-image", "call_id": "call-image", "name": "view_image", "arguments": string(rawJSON(ImageRequest{Path: path}))}})
					return
				}
				if !strings.Contains(wire, "windows_ocr") || !strings.Contains(wire, "observation_language") || !strings.Contains(wire, "limitation") {
					t.Error("OCR provenance absent from actual next request", wire)
				}
				fixtureAnswer(w, "done", "OBSERVATION_RECEIVED", nil)
			})
			shell := shellTestManager(t)
			path = imageFixture(t, shell)
			var r AgentRecord
			var err error
			manager := m
			switch role {
			case "child":
				r, err = m.Create(context.Background(), m.owner, AgentSpec{RequestID: "image-child", ModelID: "local-model", Task: "Read the assigned image", Prompt: "image reader", Workdir: dir, Tools: []string{"view_image"}})
			case "conversation":
				h := NewWorkspaceHost(m.config, "", "")
				defer h.Close()
				manager, err = h.conversationManager()
				if err != nil {
					t.Fatal(err)
				}
				var out any
				out, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "image-conversation", "model_id": "local-model"}))
				if err != nil {
					t.Fatal(err)
				}
				r = out.(AgentRecord)
				r, err = manager.Send(manager.owner, r.ID, "image-read", "Read the assigned image")
			case "primary":
				_, home := openCoreLinkHome(t, m.config, dir)
				_, err = home.Send("image-home", "Read the assigned image")
				if err != nil {
					t.Fatal(err)
				}
				waitCoreLink(t, "home runtime not started", func() bool {
					home.mu.Lock()
					defer home.mu.Unlock()
					return home.state.Roles[WorkspaceMatrix] != ""
				})
				home.mu.Lock()
				r.ID = home.state.Roles[WorkspaceMatrix]
				home.mu.Unlock()
				manager = home.manager
			case "package":
				_, home := openCoreLinkHome(t, m.config, dir)
				source := filepath.Join(mustProjectRoot(t), "Agent", "official", "Cota")
				pkg, e := modules.Load(context.Background(), source)
				if e != nil {
					t.Fatal(e)
				}
				installed := packageMutation(t, m.toolPackages(), "install", source, "", pkg.Manifest.Permissions)
				packageMutation(t, m.toolPackages(), "enable", "", pkg.Manifest.ID, pkg.Manifest.Permissions)
				manager, err = home.manager.ensurePackageAgentHost(true)
				if err != nil || manager == nil {
					t.Fatal(err)
				}
				r = newPackageAgent(t, manager, "mod:"+pkg.Manifest.ID+"@"+installed.Digest, "image-package", dir)
				assigned := []string{"view_image"}
				r = changePackageAgent(t, manager, r, agentPackageCommand{Action: "configure", Tools: &assigned})
				r, err = manager.Send(manager.owner, r.ID, "image-read", "Read the assigned image")
			}
			if err != nil {
				t.Fatal(err)
			}
			r, err = manager.Wait(context.Background(), manager.owner, r.ID, 25000)
			if err != nil || r.State != "completed" || r.Result != "OBSERVATION_RECEIVED" || requests.Load() != 2 {
				t.Fatalf("role=%s state=%s error=%s requests=%d: %v", role, r.State, r.Error, requests.Load(), err)
			}
		})
	}
}

func TestAuxiliaryVisionUsesActualRequestAndUsage(t *testing.T) {
	var requests, observations atomic.Int32
	var path string
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		wire := string(rawJSON(body))
		if body["model"] == ModelFlash {
			observations.Add(1)
			tools, _ := body["tools"].([]any)
			if !strings.Contains(wire, "data:image/png;base64,") || len(tools) != 0 {
				t.Error("vision helper did not receive pixels without tools")
			}
			fixtureAnswer(w, "vision", "FIXTURE_PIXEL_DESCRIPTION", nil)
			return
		}
		if requests.Add(1) == 1 {
			fixtureAnswer(w, "image-call", "", []any{map[string]any{"type": "function_call", "id": "fc-image", "call_id": "call-image", "name": "view_image", "arguments": string(rawJSON(ImageRequest{Path: path}))}})
			return
		}
		if strings.Contains(wire, "data:image/") || !strings.Contains(wire, "FIXTURE_PIXEL_DESCRIPTION") || !strings.Contains(wire, "vision_model") {
			t.Error("helper observation not projected to text model")
		}
		fixtureAnswer(w, "done", "VISION_RECEIVED", nil)
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.APIProfiles = append(s.APIProfiles, APIProfile{ID: "vision-helper", ConnectionID: "local", BaseURL: s.ProviderConnections[0].BaseURL, Adapter: "deepseek", Protocol: ProtocolResponses, Model: ModelFlash, ToolCalls: true, ContextWindow: 128000, Parameters: rawJSON(map[string]any{"stream": false})})
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	selected, err := m.settings("local-model")
	if _, e := m.settings("vision-helper"); e != nil {
		t.Fatal("invalid helper fixture", e)
	}
	if err != nil || !SupportsToolImages(m.conversationImageSettings(selected)) {
		t.Fatal("fixture vision model unavailable", err)
	}
	path = imageFixture(t, shellTestManager(t))
	r, err := m.Create(context.Background(), m.owner, AgentSpec{RequestID: "auxiliary-image", ModelID: "local-model", Task: "Read the assigned image", Prompt: "image reader", Workdir: dir, Tools: []string{"view_image"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), m.owner, r.ID, 25000)
	if err != nil || r.State != "completed" || r.Result != "VISION_RECEIVED" || observations.Load() != 1 || requests.Load() != 2 || len(r.Usage) != 3 {
		t.Fatalf("state=%s error=%s requests=%d observations=%d usage=%d: %v", r.State, r.Error, requests.Load(), observations.Load(), len(r.Usage), err)
	}
}
