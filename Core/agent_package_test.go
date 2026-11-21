// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageAgentFixture; agentPackageVersion; TestAgentPackageVersionPinSteeringAndPrivateOverride; TestAgentPackageMemberOutboxAndModelRequirements; TestAgentPackageOfficialPACAndReportsStayInstanceOwned; newPackageAgent; changePackageAgent; TestAgentPackageIdleExecutionPrivateMemoryAndRestart; TestAgentPackageExplicitTeamAuthorityAndPrivateOverrides
// Impact: python -B scripts/code-atlas.py show Core/agent_package_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/modules"
	agent "github.com/aieyra/aieyra-os/agent/contract"
)

func packageAgentFixture(t *testing.T, handler http.HandlerFunc) (*AgentManager, *Workspace, *AgentManager, string, string) {
	t.Helper()
	m, dir := matrixTestManager(t, handler)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	h := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(func() { m.Close(); h.Close() })
	h.mode = HostOS
	w := &Workspace{host: h, manager: m, config: m.config, dir: t.TempDir(), live: map[string]WorkspaceLive{}, state: workspaceState{ID: m.owner, Workdir: dir, Roles: map[string]string{}}}
	m.workspace = w
	identity := installWorkflowSample(t, m, "agent-reviewer")
	service, err := m.ensurePackageAgentHost(true)
	if err != nil {
		t.Fatal(err)
	}
	return m, w, service, dir, identity
}

func agentPackageVersion(t *testing.T, version, prompt string) string {
	t.Helper()
	p, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/agent-reviewer"))
	if err != nil {
		t.Fatal(err)
	}
	var d agent.Definition
	if err = json.Unmarshal(p.Files["agent.json"], &d); err != nil {
		t.Fatal(err)
	}
	d.Version = version
	p.Manifest.Version = version
	p.Files["agent.json"] = rawJSON(d)
	p.Files["prompts/identity.txt"] = []byte(prompt)
	dir := t.TempDir()
	for name, raw := range p.Files {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(raw)
		p.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(raw))}
		file := filepath.Join(dir, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(file, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.WriteFile(filepath.Join(dir, "manifest.json"), rawJSON(p.Manifest), 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAgentPackageVersionPinSteeringAndPrivateOverride(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	_, _, m, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		text := string(rawJSON(body))
		if strings.Contains(text, "NEW_PUBLIC_PERSONALITY") {
			t.Error("running Agent switched public definition")
		}
		if calls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			fixtureAnswer(w, "first", "first response", nil)
			return
		}
		if !strings.Contains(text, "FOLLOW_USER_CORRECTION") {
			t.Error("steering was not delivered")
		}
		fixtureAnswer(w, "second", "correction applied", nil)
	})
	a := newPackageAgent(t, m, identity, "pinned", dir)
	custom := "PRIVATE_OVERRIDE_PINNED"
	a = changePackageAgent(t, m, a, agentPackageCommand{Action: "configure", Prompt: &custom})
	if _, err := m.SendGeneration(m.owner, a.ID, "run", "start", 0); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("model did not start")
	}
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	source := agentPackageVersion(t, "1.1.0", "NEW_PUBLIC_PERSONALITY")
	next := packageMutation(t, m.toolPackages(), "install", source, "", nil)
	p, _ := modules.Load(context.Background(), source)
	packageMutation(t, m.toolPackages(), "enable", "", p.Manifest.ID, p.Manifest.Permissions)
	newIdentity := "mod:" + p.Manifest.ID + "@" + next.Digest
	if _, err := m.changePackageAgent(context.Background(), agentPackageCommand{Action: "switch", ID: a.ID, Package: newIdentity, ExpectedRevision: &a.Instance.Revision, RequestID: "while-running"}); err == nil {
		t.Fatal("active definition changed")
	}
	if _, err := m.SendGeneration(m.owner, a.ID, "steering", "FOLLOW_USER_CORRECTION", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := m.SendGeneration(m.owner, a.ID, "steering", "FOLLOW_USER_CORRECTION", 1); err != nil {
		t.Fatal("steering replay", err)
	}
	close(release)
	r, err := m.Wait(context.Background(), m.owner, a.ID, 10000)
	if err != nil || r.State != "completed" || r.Result != "correction applied" || calls.Load() != 2 {
		t.Fatal(r, err, calls.Load())
	}
	if _, err = m.SendGeneration(m.owner, a.ID, "blocked", "next", 1); err == nil {
		t.Fatal("new turn used changed package without explicit switch")
	}
	a = changePackageAgent(t, m, r, agentPackageCommand{Action: "switch", Package: newIdentity})
	if a.Spec.Prompt != custom || a.Instance.Current.Prompt != "NEW_PUBLIC_PERSONALITY" || a.Instance.Previous.Package != identity {
		t.Fatal("switch discarded overrides or prior definition", a)
	}
	packageMutation(t, m.toolPackages(), "rollback", "", p.Manifest.ID, nil)
	a = changePackageAgent(t, m, a, agentPackageCommand{Action: "restore_version"})
	if a.Spec.AgentPackage != identity || a.Spec.Prompt != custom {
		t.Fatal("restore lost private override")
	}
	stale := a.Instance.Revision - 1
	if _, err = m.changePackageAgent(context.Background(), agentPackageCommand{Action: "configure", ID: a.ID, ExpectedRevision: &stale, RequestID: "stale", RestorePrompt: true}); err == nil {
		t.Fatal("stale instance mutation accepted")
	}
}

func TestAgentPackageMemberOutboxAndModelRequirements(t *testing.T) {
	_, _, m, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "done", "member result", nil) })
	a := newPackageAgent(t, m, identity, "supervisor", dir)
	b := newPackageAgent(t, m, identity, "member", dir)
	b = changePackageAgent(t, m, b, agentPackageCommand{Action: "team", Supervisor: a.ID, TeamRole: "review"})
	if _, err := m.SendGeneration(a.ID, b.ID, "member-run", "finish", 0); err != nil {
		t.Fatal(err)
	}
	b, err := m.Wait(context.Background(), a.ID, b.ID, 10000)
	if err != nil || b.State != "completed" {
		t.Fatal(b, err)
	}
	path := filepath.Join(t.TempDir(), "outbox.jsonl")
	archive := &SessionArchive{Path: path}
	defer archive.Close()
	added, err := m.drainPackageMessages(a.ID, archive, nil)
	if err != nil || len(added) != 1 || !strings.Contains(added[0].Content, "member result") {
		t.Fatal(added, err)
	}
	if duplicate, err := m.drainPackageMessages(a.ID, archive, added); err != nil || len(duplicate) != 0 {
		t.Fatal("notification replay", duplicate, err)
	}
	d := a.Instance.Current.Definition.Clone()
	d.Runtime.Model.ImageInput = true
	if err := m.checkAgentModel(d, "local-model"); err == nil {
		t.Fatal("unverified image profile accepted")
	}
	if err := m.checkAgentModel(d, ""); err == nil {
		t.Fatal("model implicitly selected")
	}
	d.Runtime.Model.ImageInput = false
	d.Runtime.Model.MinContextTokens = 2000000
	if err := m.checkAgentModel(d, "local-model"); err == nil {
		t.Fatal("invented model capacity")
	}
}

func TestAgentPackageOfficialPACAndReportsStayInstanceOwned(t *testing.T) {
	_, w, m, dir, _ := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "public-eyra", "Public Agent reply", nil)
	})
	compiled, err := compiledAgentPackages()
	if err != nil {
		t.Fatal(err)
	}
	identity := "mod:aieyra.eyra@" + compiled["aieyra.eyra"].Digest
	a := newPackageAgent(t, m, identity, "official-a", dir)
	b := newPackageAgent(t, m, identity, "official-b", dir)
	if _, err = m.SendGeneration(m.owner, a.ID, "pac-run", "verify isolated PAC", 0); err != nil {
		t.Fatal(err)
	}
	a, err = m.Wait(context.Background(), m.owner, a.ID, 10000)
	if err != nil || a.State != "completed" {
		t.Fatal(a, err)
	}
	aw := m.packageMemoryWorkspace(a)
	defer aw.service.Close()
	ctx := context.WithValue(WithToolPermissions(context.Background(), []string{"report"}), workspaceContextKey{}, workspaceContext{aw, WorkspaceMatrix})
	result := executeWorkspaceTool(ctx, ToolCall{Function: FunctionCall{Name: "report", Arguments: `{"action":"report","title":"Instance report","format":"md","content":"ONLY_REPORT_A"}`}})
	var report struct {
		OK       bool              `json:"ok"`
		Document WorkspaceDocument `json:"document"`
	}
	if err = json.Unmarshal(rawJSON(result), &report); err != nil || !report.OK {
		t.Fatal(result, err)
	}
	for _, r := range []AgentRecord{a, b} {
		snapshot, err := w.taskSnapshot(r.ID, WorkspaceCursor{})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(rawJSON(snapshot)), report.Document.ID) != (r.ID == a.ID) {
			t.Fatal("report crossed instance scope")
		}
	}
	data, err := w.scopedTaskCall(context.Background(), "workspace.document", rawJSON(map[string]any{"id": report.Document.ID}), a.ID)
	if err != nil || !strings.Contains(string(rawJSON(data)), "ONLY_REPORT_A") {
		t.Fatal(data, err)
	}
	if _, err = w.scopedTaskCall(context.Background(), "workspace.document", rawJSON(map[string]any{"id": report.Document.ID}), b.ID); err == nil {
		t.Fatal("other instance read private report")
	}
}
func newPackageAgent(t *testing.T, m *AgentManager, identity, request, dir string) AgentRecord {
	t.Helper()
	r, err := m.createPackageAgent(context.Background(), identity, request, "local-model", dir, "")
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func changePackageAgent(t *testing.T, m *AgentManager, r AgentRecord, p agentPackageCommand) AgentRecord {
	t.Helper()
	p.ID = r.ID
	p.ExpectedRevision = &r.Instance.Revision
	if p.RequestID == "" {
		p.RequestID = workspaceID()
	}
	out, err := m.changePackageAgent(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAgentPackageIdleExecutionPrivateMemoryAndRestart(t *testing.T) {
	var calls atomic.Int32
	m, w, service, dir, identity := packageAgentFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(string(rawJSON(body)), "PRIVATE_PRIMARY") {
			t.Error("private parent prompt leaked")
		}
		if calls.Add(1) == 1 {
			fixtureAnswer(w, "patch", "", []any{map[string]any{"type": "function_call", "id": "patch", "call_id": "patch", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: agent-proof.txt\n+package-owned\n*** End Patch"}`}})
			return
		}
		fixtureAnswer(w, "done", "created proof", nil)
	})
	w.prompt = "PRIVATE_PRIMARY"
	a := newPackageAgent(t, service, identity, "create-a", dir)
	b := newPackageAgent(t, service, identity, "create-b", dir)
	if a.State != "idle" || a.Generation != 0 || a.Instance.Supervisor != "" || calls.Load() != 0 || a.ID == b.ID {
		t.Fatal("creation started or joined an Agent", a)
	}
	if replay := newPackageAgent(t, service, identity, "create-a", dir); replay.ID != a.ID {
		t.Fatal("creation replay")
	}
	forged := a.Spec
	forged.RequestID = "forged"
	if _, err := service.Create(context.Background(), service.owner, forged); err == nil {
		t.Fatal("forged binding accepted")
	}
	aw, bw := service.packageMemoryWorkspace(a), service.packageMemoryWorkspace(b)
	defer aw.service.Close()
	defer bw.service.Close()
	if _, err := memoryResult(aw.memory(context.Background(), map[string]any{"action": "record", "request_id": "memory-one", "scope": "global", "kind": "fact", "title": "Instance fact", "content": "ONLY_INSTANCE_A", "source": "fixture"})); err != nil {
		t.Fatal(err)
	}
	for label, ws := range map[string]*Workspace{"a": aw, "b": bw} {
		raw, err := ws.memory(context.Background(), map[string]any{"action": "search", "query": "ONLY_INSTANCE_A"})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "ONLY_INSTANCE_A") != (label == "a") {
			t.Fatalf("memory scope %s: %s", label, raw)
		}
	}
	aw.service.Close()
	bw.service.Close()
	if _, err := service.SendGeneration(service.owner, a.ID, "run-a", "Write the proof", 0); err != nil {
		t.Fatal(err)
	}
	finished, err := service.Wait(context.Background(), service.owner, a.ID, 10000)
	if err != nil || finished.State != "completed" || finished.ToolTurns != 1 {
		t.Fatal(finished, err)
	}
	proof, err := os.ReadFile(filepath.Join(dir, "agent-proof.txt"))
	if err != nil || strings.TrimSpace(string(proof)) != "package-owned" {
		t.Fatal(string(proof), err)
	}
	if _, err = w.taskSnapshot(a.ID, WorkspaceCursor{}); err != nil {
		t.Fatal(err)
	}
	before := calls.Load()
	m.Close()
	second, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	w.manager = second
	second.workspace = w
	restored, err := second.ensurePackageAgentHost(false)
	if err != nil {
		t.Fatal(err)
	}
	r, err := restored.Status(restored.owner, a.ID)
	if err != nil || r.Result != finished.Result || r.Generation != 1 || calls.Load() != before {
		t.Fatal("restart changed or replayed Agent", r, err)
	}
	if !strings.Contains(string(rawJSON(w.taskList())), a.ID) {
		t.Fatal("instance missing from task navigation")
	}
}

func TestAgentPackageExplicitTeamAuthorityAndPrivateOverrides(t *testing.T) {
	m, w, service, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model call") })
	a := newPackageAgent(t, service, identity, "a", dir)
	b := newPackageAgent(t, service, identity, "b", dir)
	primary := "11111111111111111111111111111111"
	m.jobs[primary] = &agentJob{record: AgentRecord{ID: primary, Parent: m.owner, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	w.state.Roles[WorkspaceMatrix] = primary
	if _, err := m.Status(primary, a.ID); err == nil {
		t.Fatal("unassigned Agent visible to primary role")
	}
	a = changePackageAgent(t, service, a, agentPackageCommand{Action: "team", Supervisor: "primary", TeamRole: "review"})
	if _, err := m.Status(primary, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Status(primary, b.ID); err == nil {
		t.Fatal("team grant expanded to unrelated instance")
	}
	if len(m.List(primary)) != 1 {
		t.Fatal("primary list exposed unassigned records")
	}
	custom := "PRIVATE_INSTANCE_OVERRIDE"
	tools := []string{"agents", "apply_patch"}
	a = changePackageAgent(t, service, a, agentPackageCommand{Action: "configure", Prompt: &custom, Tools: &tools})
	if a.Spec.Prompt != custom || a.Instance.Prompt == nil || len(a.Spec.Tools) != 2 {
		t.Fatal(a)
	}
	bad := []string{"computer"}
	revision := a.Instance.Revision
	if _, err := service.changePackageAgent(context.Background(), agentPackageCommand{Action: "configure", ID: a.ID, Tools: &bad, ExpectedRevision: &revision, RequestID: "widen"}); err == nil {
		t.Fatal("undeclared capability allowed")
	}
	b = changePackageAgent(t, service, b, agentPackageCommand{Action: "team", Supervisor: a.ID, TeamRole: "assistant"})
	if _, err := service.Status(a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.changePackageAgent(context.Background(), agentPackageCommand{Action: "team", ID: a.ID, Supervisor: b.ID, TeamRole: "cycle", ExpectedRevision: &revision, RequestID: "cycle"}); err == nil {
		t.Fatal("team cycle accepted")
	}
	a = changePackageAgent(t, service, a, agentPackageCommand{Action: "team"})
	if _, err := m.Status(primary, b.ID); err == nil {
		t.Fatal("detached subtree remains visible")
	}
	enabled := false
	a = changePackageAgent(t, service, a, agentPackageCommand{Action: "configure", Enabled: &enabled})
	if _, err := service.Send(service.owner, a.ID, "disabled", "run"); err == nil {
		t.Fatal("disabled instance ran")
	}
}
