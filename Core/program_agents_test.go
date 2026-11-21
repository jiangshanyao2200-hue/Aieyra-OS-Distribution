// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProgramBrowserKeepsDesktopBridgeWithPrivateMemory; TestProgramContactShowsEffectiveToolsBeforeAndAfterEdit; TestProgramNamesMigrateOnlyUneditedDefaults; TestRetiredThemeAgentLeavesArchiveButCannotResume; TestEveryProgramAgentOpensWithShippingToolSelection; TestProgramAgentsFollowEyraWithoutCopyingModelsAndKeepIdentity; TestProgramDelegationUsesPersistentSessionAndMotherMailbox; TestProgramAgentCapabilitiesCannotBeAcquiredByOrdinaryConversation; TestProgramModelSelectionBeforeSessionUsesRevisionAndFollowsCurrentMother; TestProgramHumanUpgradePreservesEditedCapabilities; TestProgramAndOSChatsBindIndependentlyAndCanDeleteOnlyOSChat
// Impact: python -B scripts/code-atlas.py show Core/program_agents_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	programagent "github.com/aieyra/aieyra-os/agent/program"
)

func TestProgramBrowserKeepsDesktopBridgeWithPrivateMemory(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		n := requests.Add(1)
		var args string
		switch n {
		case 1:
			args = `{"action":"open","name":"browser"}`
		case 2:
			args = `{"action":"call","name":"browser","arguments":{"action":"tabs"}}`
		default:
			if !strings.Contains(string(rawJSON(body)), "OWNED_DESKTOP_TAB") {
				t.Error("program did not receive the actual desktop bridge result")
			}
			fixtureAnswer(w, "done", "browser checked", nil)
			return
		}
		fixtureAnswer(w, fmt.Sprint("tool-", n), "", []any{map[string]any{"type": "function_call", "id": fmt.Sprint("browser-call-", n), "call_id": fmt.Sprint("browser-call-", n), "name": "toolbox", "arguments": args}})
	})
	h, _ := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	owners := make(chan string, 2)
	bridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Owner     string                  `json:"owner"`
			Arguments struct{ Action string } `json:"arguments"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.Arguments.Action != "tabs" {
			t.Error("invalid browser tool request")
		}
		owners <- body.Owner
		_, _ = w.Write([]byte(`{"ok":true,"tabs":[{"id":"OWNED_DESKTOP_TAB"}]}`))
	}))
	defer bridge.Close()
	if err := h.service.SetBrowserBridge(bridge.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "program_open", "program": "browser"}))
	if err != nil {
		t.Fatal(err)
	}
	id := v.(map[string]any)["session"].(map[string]any)["id"].(string)
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": id, "request_id": "browser-host", "message": "Read current browser tabs"})); err != nil {
		t.Fatal(err)
	}
	cm, _ := h.conversationManager()
	finished, err := cm.Wait(context.Background(), cm.owner, id, 10000)
	if err != nil || finished.State != "completed" || requests.Load() != 3 {
		t.Fatal("program browser tool did not complete", finished.State, finished.Error, err)
	}
	select {
	case owner := <-owners:
		if owner != "program/browser" {
			t.Fatal("browser specialist did not share the human browser scope", owner)
		}
	default:
		t.Fatal("embedded browser bridge was bypassed")
	}
	h.service.mu.Lock()
	closed := h.service.closed
	h.service.mu.Unlock()
	if closed {
		t.Fatal("private memory cleanup closed the shared desktop service")
	}
}

func TestProgramContactShowsEffectiveToolsBeforeAndAfterEdit(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	id := programContactID("workspace")
	c, err := cm.readContact(id)
	if err != nil {
		t.Fatal(err)
	}
	stored := slices.Clone(c.Defaults.Tools)
	call := func(args map[string]any) map[string]any {
		t.Helper()
		v, e := h.conversationCall(context.Background(), rawJSON(args))
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	shown := call(map[string]any{"action": "contact", "id": id})["tools"].([]string)
	if !slices.Contains(shown, "memory") {
		t.Fatal("shared memory is missing from the managed program profile")
	}
	c, err = cm.readContact(id)
	if err != nil || !slices.Equal(stored, c.Defaults.Tools) {
		t.Fatal("reading effective capabilities changed the stored selection", err)
	}
	selected := slices.DeleteFunc(slices.Clone(shown), func(name string) bool {
		return slices.Contains([]string{"terminal", "exec_command", "write_stdin", "read_shell_output"}, name)
	})
	saved := call(map[string]any{"action": "contact_update", "id": id, "tools": selected})
	if !slices.Equal(saved["tools"].([]string), selected) {
		t.Fatal("editing the displayed selection unexpectedly changed capabilities", saved["tools"])
	}
	again := call(map[string]any{"action": "contact", "id": id})
	if !slices.Equal(again["tools"].([]string), selected) {
		t.Fatal("rereading did not preserve the selected effective tools", again["tools"])
	}
}

func TestProgramNamesMigrateOnlyUneditedDefaults(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	if err := m.ensureProgramContacts(); err != nil {
		t.Fatal(err)
	}
	for _, def := range programagent.Catalog() {
		if def.PreviousName == "" {
			continue
		}
		c, err := m.readContact(programContactID(def.ID))
		if err != nil {
			t.Fatal(err)
		}
		c.Name, c.Description = def.PreviousName, def.PreviousDescription
		if err = m.writeContact(c); err != nil {
			t.Fatal(err)
		}
	}
	custom, _ := m.readContact(programContactID("contacts"))
	custom.Name, custom.Description = "我的联系人专员", "保留我的简介"
	if err := m.writeContact(custom); err != nil {
		t.Fatal(err)
	}
	if err := m.ensureProgramContacts(); err != nil {
		t.Fatal(err)
	}
	for _, def := range programagent.Catalog() {
		c, err := m.readContact(programContactID(def.ID))
		if err != nil {
			t.Fatal(err)
		}
		if def.ID == "contacts" {
			if c.Name != custom.Name || c.Description != custom.Description {
				t.Fatal("custom profile overwritten")
			}
			continue
		}
		if c.Name != def.Name || c.Description != def.Description {
			t.Fatalf("default profile not migrated: %s", def.ID)
		}
		if c.Defaults.ModelID != "" {
			t.Fatal("name migration configured a model")
		}
	}
}

func TestRetiredThemeAgentLeavesArchiveButCannotResume(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("retired program executed") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	id := programContactID("market")
	c := conversationContact{ID: id, Program: "market", Name: "Vela", CreatedBy: "system", Defaults: &AgentSpec{ModelID: "local-model", Workdir: dir}}
	if err = cm.writeContact(c); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(cm.contactDir(), id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := cm.listContacts()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row["id"] == id {
			t.Fatal("retired agent still discoverable")
		}
	}
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "program_open", "program": "market"})); err == nil {
		t.Fatal("retired app opened")
	}
	if err = cm.checkConversationAuthority(AgentRecord{ID: id, Spec: AgentSpec{Kind: "conversation", ModelID: "local-model"}}); err == nil {
		t.Fatal("retired agent can resume")
	}
	after, err := os.ReadFile(filepath.Join(cm.contactDir(), id+".json"))
	if err != nil || string(before) != string(after) {
		t.Fatal("retirement rewrote private records", err)
	}
}

func TestEveryProgramAgentOpensWithShippingToolSelection(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true, TeamCollaboration: true})
	shipping, err := os.ReadFile(filepath.Join("..", "Config", "运行参数.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(ResourceRoot(), "Config", "运行参数.json"), shipping, 0600); err != nil {
		t.Fatal(err)
	}
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("opening invoked a model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	for _, def := range programagent.Catalog() {
		_, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_update", "id": programContactID(def.ID), "model_id": "local-model"}))
		if err != nil {
			t.Fatal(def.ID, err)
		}
		value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "program_open", "program": def.ID}))
		if err != nil || value.(map[string]any)["session"] == nil {
			t.Fatalf("%s cannot open with the shipping capability selection: %v", def.ID, err)
		}
	}
}

func TestProgramAgentsFollowEyraWithoutCopyingModelsAndKeepIdentity(t *testing.T) {
	var requests atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fixtureAnswer(w, "program-answer", "program-result", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	call := func(args map[string]any) any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(args))
		if err != nil {
			t.Fatal(args["action"], err)
		}
		return v
	}
	rows := call(map[string]any{"action": "programs"}).([]map[string]any)
	if len(rows) != len(programagent.Catalog()) {
		t.Fatalf("missing program profiles: %d", len(rows))
	}
	for _, row := range rows {
		if row["model_id"] != "local-model" || row["model_inherited"] != true || row["embedded"] != embeddedProgram(row["program"].(string)) || row["active"] != false {
			t.Fatalf("registration copied a model or started work: %+v", row)
		}
		v := call(map[string]any{"action": "program_open", "program": row["program"]}).(map[string]any)
		if v["configured"] != true || v["session"] == nil {
			t.Fatal("following Eyra did not create an idle session", v)
		}
	}
	id := programContactID("browser")
	detail := call(map[string]any{"action": "contact", "id": id}).(map[string]any)
	for _, layer := range []string{"人格与沟通", "执行与工作", "安全与边界", "思考方式"} {
		if !strings.Contains(detail["prompt"].(string), "## "+layer) {
			t.Fatal("missing editable prompt layer", layer)
		}
	}
	call(map[string]any{"action": "contact_update", "id": id, "name": "我的浏览器", "model_id": "local-model"})
	first := call(map[string]any{"action": "program_open", "program": "browser"}).(map[string]any)
	session := first["session"].(map[string]any)["id"].(string)
	for range 3 {
		v := call(map[string]any{"action": "program_open", "program": "browser"}).(map[string]any)
		if v["session"].(map[string]any)["id"] != session {
			t.Fatal("program opening duplicated the conversation")
		}
	}
	for _, args := range []map[string]any{
		{"action": "contact_delete", "id": id},
		{"action": "session_delete", "id": session, "request_id": "delete"},
	} {
		if _, err := h.conversationCall(context.Background(), rawJSON(args)); err == nil {
			t.Fatalf("embedded identity accepted independent operation: %v", args)
		}
	}
	if requests.Load() != 0 {
		t.Fatal("read/edit/open invoked a model")
	}
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v := call(map[string]any{"action": "program_open", "program": "browser"}).(map[string]any)
	if v["session"].(map[string]any)["id"] != session || v["contact"].(map[string]any)["name"] != "我的浏览器" {
		t.Fatal("reopening replaced the program identity or user profile")
	}
	revision := v["session"].(map[string]any)["revision"]
	call(map[string]any{"action": "session_model", "id": session, "revision": revision, "model_id": ""})
	v = call(map[string]any{"action": "program", "program": "browser"}).(map[string]any)
	if v["configured"] != true || v["contact"].(map[string]any)["model_id"] != "local-model" || v["contact"].(map[string]any)["model_inherited"] != true {
		t.Fatal("model menu did not update the authoritative contact")
	}
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	c, err := cm.readContact(id)
	if err != nil || c.Defaults.ModelID != "" {
		t.Fatal("inherited model was copied into defaults", err)
	}
	if requests.Load() != 0 {
		t.Fatal("model selection started a request")
	}

}

func TestProgramDelegationUsesPersistentSessionAndMotherMailbox(t *testing.T) {
	for _, program := range []string{"browser", "computer"} {
		t.Run(program, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			var programCalls, motherCalls atomic.Int32
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				data := string(rawJSON(body))
				if strings.Contains(data, "PROGRAM-ONLY-PERSONA") {
					programCalls.Add(1)
					if strings.Contains(data, "MOTHER-PRIVATE-HISTORY") || !strings.Contains(data, "程序委派") {
						t.Error("program delegation leaked history or lost source")
					}
					fixtureAnswer(w, "program", "PROGRAM-RESULT-RECEIPT", nil)
					return
				}
				if motherCalls.Add(1) == 1 {
					close(entered)
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
				} else if !strings.Contains(data, "PROGRAM-RESULT-RECEIPT") {
					t.Error("mother did not receive the real result")
				}
				fixtureAnswer(w, "mother", "reviewed", nil)
			})
			h, home := openCoreLinkHome(t, m.config, dir)
			defer h.Close()
			defer once.Do(func() { close(release) })
			call := func(args map[string]any) any {
				t.Helper()
				v, e := h.conversationCall(context.Background(), rawJSON(args))
				if e != nil {
					t.Fatal(e)
				}
				return v
			}
			id := programContactID(program)
			detail := call(map[string]any{"action": "contact", "id": id}).(map[string]any)
			call(map[string]any{"action": "contact_update", "id": id, "model_id": "local-model", "prompt_text": "PROGRAM-ONLY-PERSONA", "prompt_hash": detail["prompt_hash"]})
			opened := call(map[string]any{"action": "program_open", "program": program}).(map[string]any)
			target := opened["session"].(map[string]any)["id"].(string)
			if _, err := home.Send("start", "MOTHER-PRIVATE-HISTORY"); err != nil {
				t.Fatal(err)
			}
			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				home.mu.Lock()
				messages := append([]workspaceMessage(nil), home.state.Messages...)
				home.mu.Unlock()
				t.Fatalf("mother did not start: %+v", messages)
			}
			home.mu.Lock()
			actor, scope := home.state.Roles[WorkspaceMatrix], home.coreLinkScopeLocked()
			home.mu.Unlock()
			ctx := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
			args := map[string]any{"kind": "conversation", "action": "program_send", "program": program, "request_id": "delegation", "generation": 0, "reason": "核对页面", "message": "Inspect the supplied page."}
			if _, err := home.manager.Call(ctx, actor, rawJSON(args)); err != nil {
				t.Fatal(err)
			}
			cm, _ := h.conversationManager()
			finished, err := cm.Wait(context.Background(), cm.owner, target, 10000)
			if err != nil || finished.State != "completed" || programCalls.Load() != 1 {
				t.Fatal("program execution", finished.State, finished.Error, err)
			}
			if len(finished.TurnOrigins) != 1 {
				t.Fatal("delegation origin missing")
			}
			for _, origin := range finished.TurnOrigins {
				if origin.From != scope || origin.Scope != scope || origin.Kind != "message" {
					t.Fatal(origin)
				}
			}
			if _, err := home.manager.Call(ctx, actor, rawJSON(args)); err != nil || programCalls.Load() != 1 {
				t.Fatal("repeated delegation was not idempotent", err)
			}
			current := call(map[string]any{"action": "program", "program": program}).(map[string]any)
			if current["session"].(map[string]any)["id"] != target {
				t.Fatal("delegation cloned the program")
			}
			waitCoreLink(t, "result not committed to mother mailbox", func() bool {
				conversationGroupsMu.Lock()
				defer conversationGroupsMu.Unlock()
				g, e := cm.readGroup(linkLogID(scope))
				if e != nil {
					return false
				}
				msgs, e := cm.groupRange(g, 0, 100)
				if e != nil {
					return false
				}
				for _, msg := range msgs {
					if msg.Kind == "result" && msg.From == target && strings.Contains(msg.Text, "PROGRAM-RESULT-RECEIPT") {
						return true
					}
				}
				return false
			})
			if err := cm.CancelGeneration(cm.owner, target, finished.Generation); err != nil {
				t.Fatal(err)
			}
			args["request_id"], args["generation"] = "after-stop", finished.Generation
			if _, err := home.manager.Call(ctx, actor, rawJSON(args)); err == nil {
				t.Fatal("mother restarted a user-stopped program")
			}
			once.Do(func() { close(release) })
			waitCoreLink(t, "program result not consumed by mother", func() bool { return motherCalls.Load() >= 2 })

		})
	}
}

func TestProgramAgentCapabilitiesCannotBeAcquiredByOrdinaryConversation(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected model call") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	for _, tool := range []string{"software_api", "settings", "browser", "server", "toolbox"} {
		_, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": tool, "model_id": "local-model", "tools": []string{tool}}))
		if err == nil {
			t.Fatalf("ordinary conversation acquired program capability: %s", tool)
		}
	}
}

func TestProgramModelSelectionBeforeSessionUsesRevisionAndFollowsCurrentMother(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("model selection invoked provider") })
	settings, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	settings.ActiveProfile, settings.MatrixProfile = "", ""
	if err = settings.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	call := func(args map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(args))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	binding := call(map[string]any{"action": "program_open", "program": "browser"})
	if binding["configured"] != false || binding["session"] != nil {
		t.Fatal("unconfigured program started a session", binding)
	}
	id := programContactID("browser")
	choice := map[string]any{"action": "contact_update", "id": id, "model_id": "local-model", "expected_model_revision": 0}
	call(choice)
	if _, err = h.conversationCall(context.Background(), rawJSON(choice)); err == nil {
		t.Fatal("stale model revision accepted")
	}
	binding = call(map[string]any{"action": "program_open", "program": "browser"})
	if binding["configured"] != true || binding["session"] == nil {
		t.Fatal("selected model did not open idle session", binding)
	}
	call(map[string]any{"action": "contact_update", "id": id, "model_unconfigured": true, "expected_model_revision": 1})
	binding = call(map[string]any{"action": "program", "program": "browser"})
	if binding["configured"] != false {
		t.Fatal("missing inherited model reported configured")
	}
	settings.ActiveProfile = "local-model"
	if err = settings.Save(); err != nil {
		t.Fatal(err)
	}
	binding = call(map[string]any{"action": "program", "program": "browser"})
	if binding["configured"] != true || binding["contact"].(map[string]any)["model_inherited"] != true {
		t.Fatal("did not follow current mother model")
	}
	cm, _ := h.conversationManager()
	c, err := cm.readContact(id)
	if err != nil || c.Defaults.ModelID != "" || c.ModelRevision != 2 {
		t.Fatal("inheritance copied a model or lost revision", c, err)
	}
}

func TestProgramHumanUpgradePreservesEditedCapabilities(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	if err := m.ensureProgramContacts(); err != nil {
		t.Fatal(err)
	}
	for _, program := range []string{"browser", "settings", "contacts"} {
		c, _ := m.readContact(programContactID(program))
		c.ProgramToolsVersion = 0
		c.Defaults.Tools = slices.DeleteFunc(c.Defaults.Tools, func(name string) bool { return name == "human" })
		if program == "contacts" {
			c.Defaults.Tools = []string{"view_image"}
		}
		if err := m.writeContact(c); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.ensureProgramContacts(); err != nil {
		t.Fatal(err)
	}
	for _, program := range []string{"browser", "settings", "contacts"} {
		c, _ := m.readContact(programContactID(program))
		if c.ProgramToolsVersion != 1 || slices.Contains(c.Defaults.Tools, "human") != (program != "contacts") {
			t.Fatal(program, c)
		}
		c.Defaults.Tools = slices.DeleteFunc(c.Defaults.Tools, func(name string) bool { return name == "human" })
		if err := m.writeContact(c); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.ensureProgramContacts(); err != nil {
		t.Fatal(err)
	}
	for _, program := range []string{"browser", "settings", "contacts"} {
		c, _ := m.readContact(programContactID(program))
		if slices.Contains(c.Defaults.Tools, "human") {
			t.Fatal("restored removed capability", program)
		}
	}
}

func TestProgramAndOSChatsBindIndependentlyAndCanDeleteOnlyOSChat(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("Opening chats must not call a model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	call := func(args map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(args))
		if err != nil {
			t.Fatal(args, err)
		}
		return v.(map[string]any)
	}
	for _, program := range []string{"browser", "settings", "contacts"} {
		contactID := programContactID(program)
		osChat := call(map[string]any{"action": "session_create", "contact_id": contactID, "request_id": "os-before-" + program})
		native := call(map[string]any{"action": "program_open", "program": program})
		nativeID := native["session"].(map[string]any)["id"].(string)
		if nativeID == osChat["id"] {
			t.Fatal("OS conversation replaced program chat")
		}
		after := call(map[string]any{"action": "session_create", "contact_id": contactID, "request_id": "os-after-" + program})
		again := call(map[string]any{"action": "program_open", "program": program})
		if again["session"].(map[string]any)["id"] != nativeID {
			t.Fatal("Most recent OS chat stole program binding")
		}
		contact := again["contact"].(map[string]any)
		if contact["program_session"].(map[string]any)["id"] != nativeID || len(contact["sessions"].([]map[string]any)) != 2 {
			t.Fatal("Chat surfaces were mixed", contact)
		}
		call(map[string]any{"action": "session_delete", "id": after["id"], "request_id": "delete-os-" + program})
		if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "session_delete", "id": nativeID, "request_id": "delete-native-" + program})); err == nil {
			t.Fatal("Deleted program binding")
		}
	}
}
