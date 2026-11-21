// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: setTeamProfiles; TestTeamReadyWithoutRoleModels; TestTeamRoleToolLists; TestTeamToolboxOnlyByDispatchGrant; TestTeamRoleSwitches; TestRuntimeSystemKeepsPrefixStable; TestTeamRoleModelsComeFromSettings; TestTeamDispatchRequiresPlan; TestTeamVisionRequestCarriesOwnIdentity; TestToolboxRoutedPublishingNeedsConsent; TestPromptCacheKeyPerRole; TestPromptCachePartitionSurvivesHomeExecutorReopen; TestTeamRoleTerminalsReadable; TestChatToolsToleratesGatewayGeminiShapes
// Impact: python -B scripts/code-atlas.py show Core/team_roles_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
)

func setTeamProfiles(t *testing.T, w *Workspace, vision, execution string, enabled *bool) {
	t.Helper()
	s, err := Load(w.config)
	if err != nil {
		t.Fatal(err)
	}
	s.VisionProfile, s.ExecutionProfile, s.CollaborationEnabled = vision, execution, enabled
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
}

// 团队只看开关：Vaya、Cota 没选模型时用 Eyra 的；用户关掉就不给 team，并在协定里说明。
func TestTeamReadyWithoutRoleModels(t *testing.T) {
	withLegacyHomeTeam(t)
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("readiness called provider") }, nil)
	off := false
	setTeamProfiles(t, w, "local-model", "local-model", &off)
	if slices.Contains(w.permissions(WorkspaceMatrix), "team") {
		t.Fatal("team granted while switched off")
	}
	if contract := w.roleContract(WorkspaceMatrix); !strings.Contains(contract, "Team collaboration is currently unavailable") || !strings.Contains(contract, "switched off") || strings.Contains(contract, "团队通信协议") {
		t.Fatal("contract did not explain the closed team", contract)
	}
	for _, tc := range []struct{ name, vision, execution string }{{"none", "", ""}, {"missing pool entry", "gone-model", "gone-model"}, {"configured", "local-model", "local-model"}} {
		setTeamProfiles(t, w, tc.vision, tc.execution, nil)
		if !slices.Contains(w.permissions(WorkspaceMatrix), "team") || !strings.Contains(w.roleContract(WorkspaceMatrix), "团队通信协议") {
			t.Fatal(tc.name, ": team unavailable")
		}
		w.mu.Lock()
		model, err := w.modelLocked(WorkspaceExecution)
		w.mu.Unlock()
		if err != nil || model != "local-model" {
			t.Fatal(tc.name, ": Cota did not fall back to Eyra's model", model, err)
		}
	}
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	vaya, cota := w.collaborationRoleLocked(WorkspaceProject), w.collaborationRoleLocked(WorkspaceExecution)
	w.mu.Unlock()
	if !vaya || !cota {
		t.Fatal("natural team did not open both roles", vaya, cota)
	}
}

// Eyra 统筹；Vaya 调查（终端不构成只读沙箱）；Cota 编程并维护计划。
// 默认写工具分工不妨碍用户显式选择，工具箱仍须真实授权。
func TestTeamRoleToolLists(t *testing.T) {
	withLegacyHomeTeam(t)
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) {}, nil)
	matrix, vision, execution := w.permissions(WorkspaceMatrix), w.permissions(WorkspaceProject), w.permissions(WorkspaceExecution)
	for _, name := range []string{"project", "update_plan", "memory", "team", "report", "image_gen", "settings", "software_api", "cloud_report", "community", "agents", "terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch"} {
		if !slices.Contains(matrix, name) {
			t.Fatal("Eyra lost", name, matrix)
		}
	}
	for _, name := range []string{"workspace", "exec", "wait"} {
		if slices.Contains(matrix, name) {
			t.Fatal("Eyra kept a retired top-level tool", name)
		}
	}
	for _, name := range []string{"image_gen", "agents", "browser", "update_plan", "settings", "apply_patch"} {
		if slices.Contains(vision, name) {
			t.Fatal("Vaya gained", name)
		}
	}
	for _, name := range []string{"team", "exec_command", "write_stdin", "read_shell_output", "project", "view_image", "web_search", "memory"} {
		if !slices.Contains(vision, name) {
			t.Fatal("Vaya lacks the basic tool", name, vision)
		}
	}
	for _, name := range []string{"team", "apply_patch", "exec_command", "write_stdin", "read_shell_output", "project", "view_image", "web_search", "update_plan", "memory"} {
		if !slices.Contains(execution, name) {
			t.Fatal("Cota lacks", name, execution)
		}
	}
	for _, name := range []string{"agents", "image_gen", "settings", "toolbox", "ask_user"} {
		if slices.Contains(execution, name) {
			t.Fatal("Cota gained", name)
		}
	}
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceExecution}), execution)
	if !toolboxAvailable(ctx) || !slices.Equal(teamToolboxNames(ctx), []string{"project"}) {
		t.Fatal("Cota must discover only its on-demand project by default", teamToolboxNames(ctx))
	}
	s, _ := Load(w.config)
	s.ExecutionTools, s.VisionTools = []string{"exec_command", "toolbox", "memory"}, []string{"project", "web_search", "apply_patch"}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	if got := w.permissions(WorkspaceExecution); !slices.Equal(got, []string{"team", "exec_command", "memory"}) {
		t.Fatal("settings did not narrow Cota to allowed tools", got)
	}
	if got := w.permissions(WorkspaceProject); !slices.Equal(got, []string{"team", "project", "apply_patch", "web_search"}) {
		t.Fatal("settings did not narrow Vaya to allowed tools", got)
	}
}

// project按需保留；额外toolbox能力由Eyra派工分配，下一次派工不带就收回。
func TestTeamToolboxOnlyByDispatchGrant(t *testing.T) {
	stage := CurrentReleaseStage()
	if !stage.Toolbox || !stage.TeamCollaboration {
		t.Skip("stage")
	}
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) {}, nil)
	matrix := WithToolPermissions(context.Background(), []string{"browser", "community"})
	if err := w.grantTeamToolbox(matrix, WorkspaceExecution, []string{"community"}); err == nil {
		t.Fatal("publishing capability was assigned")
	}
	if err := w.grantTeamToolbox(matrix, WorkspaceExecution, []string{"server"}); err == nil {
		t.Fatal("assigned a capability Eyra does not hold")
	}
	if err := w.grantTeamToolbox(matrix, WorkspaceExecution, []string{"browser", "browser"}); err != nil {
		t.Fatal(err)
	}
	got := w.permissions(WorkspaceExecution)
	if !slices.Contains(got, "browser") || slices.Contains(w.permissions(WorkspaceProject), "browser") {
		t.Fatal("grant is per role", got)
	}
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceExecution}), got)
	if !toolboxAvailable(ctx) || !slices.Equal(teamToolboxNames(ctx), []string{"project", "browser"}) {
		t.Fatal("Cota cannot see the assigned toolbox", teamToolboxNames(ctx))
	}
	if err := w.grantTeamToolbox(matrix, WorkspaceExecution, nil); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(w.permissions(WorkspaceExecution), "browser") {
		t.Fatal("next dispatch did not take the grant back")
	}
}

// 用户可以单独关掉 Vaya 或 Cota：关掉的不能派工，Eyra 的协定里写明；两个都关就没有团队。
func TestTeamRoleSwitches(t *testing.T) {
	withLegacyHomeTeam(t)
	if !CurrentReleaseStage().TeamCollaboration {
		t.Skip("stage")
	}
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) {}, nil)
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
		t.Fatal(err)
	}
	off := false
	s, _ := Load(w.config)
	s.ExecutionEnabled = &off
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	if !w.teamRoleOn(WorkspaceProject) || w.teamRoleOn(WorkspaceExecution) {
		t.Fatal("role switch not read")
	}
	w.mu.Lock()
	vaya, cota := w.collaborationRoleLocked(WorkspaceProject), w.collaborationRoleLocked(WorkspaceExecution)
	w.mu.Unlock()
	if !vaya || cota {
		t.Fatal("dispatch gate ignored the switch", vaya, cota)
	}
	contract := w.teamContract(WorkspaceMatrix)
	if !strings.Contains(contract, "Cota is switched off") || strings.Contains(contract, "Vaya is switched off") {
		t.Fatal("Eyra is not told who is off")
	}
	if ready, _ := w.collaborationReady(); !ready {
		t.Fatal("Vaya alone is still a team")
	}
	s, _ = Load(w.config)
	s.VisionEnabled = &off
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	if ready, _ := w.collaborationReady(); ready {
		t.Fatal("both off must leave Eyra alone")
	}
}

// 中转把 Chat 的 system 都并进 Gemini 系统指令：对话之后的时钟不能再是 system，否则每分钟前缀都变。
func TestRuntimeSystemKeepsPrefixStable(t *testing.T) {
	s := &Settings{Adapter: "openai", BaseURL: "https://relay.example/v1", Model: "gemini-4-argon-high"}
	base := []Message{{Role: RoleSystem, Content: "identity"}, {Role: RoleSystem, Content: "contract"}, {Role: RoleUser, Content: "hi"}}
	build := func(clock string) []Message {
		return BuildRequest(s, append(append([]Message(nil), base...), Message{Role: RoleSystem, Name: "aieyra_clock", Content: clock}), false).Messages
	}
	first, second := build("12:01"), build("12:02")
	if len(first) != 3 || first[0].Role != RoleSystem || first[0].Content != second[0].Content {
		t.Fatal("leading system changed", first)
	}
	if last := first[2]; last.Role != RoleUser || !strings.Contains(last.Content, "12:01") {
		t.Fatal("runtime system stayed a system message", last)
	}
	for _, m := range first[1:] {
		if m.Role == RoleSystem {
			t.Fatal("system after conversation", m)
		}
	}
	if len(base) != 3 || base[2].Role != RoleUser {
		t.Fatal("input mutated")
	}
}

// 角色模型来自设置里各自的档；没配时回退到 Matrix（只是兜底，派工由 R14 拦住）。
func TestTeamRoleModelsComeFromSettings(t *testing.T) {
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) {}, nil)
	s, _ := Load(w.config)
	vision := s.APIProfiles[0]
	vision.ID, vision.Model = "vision-model", "vision-fixture"
	s.APIProfiles = append(s.APIProfiles, vision)
	s.VisionProfile, s.ExecutionProfile = "vision-model", ""
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for role, want := range map[string]string{WorkspaceProject: "vision-model", WorkspaceExecution: "local-model", WorkspaceMatrix: "local-model"} {
		if id, err := w.modelLocked(role); err != nil || id != want {
			t.Fatal(role, "model", id, err)
		}
	}
}

// R10：派工前必须已有计划。
func TestTeamDispatchRequiresPlan(t *testing.T) {
	withLegacyHomeTeam(t)
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) { fixtureAnswer(rw, "ok", "done", nil) }, nil)
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
		t.Fatal(err)
	}
	dispatch := rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceProject, "request_id": "map-1", "message": "where is the toolbox", "wait": false})
	noPlan := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{Plan: &PlanEngine{}})
	if _, err := w.team(noPlan, WorkspaceMatrix, dispatch); err == nil || !strings.Contains(err.Error(), "update_plan") {
		t.Fatal("dispatch without a plan was accepted", err)
	}
	planned := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{Plan: &PlanEngine{State: &PlanState{ID: "p", Status: "active"}}})
	if _, err := w.team(planned, WorkspaceMatrix, dispatch); err != nil {
		t.Fatal("planned dispatch refused", err)
	}
}

// Vaya 使用自己的身份和提示词，不带母体人格或专属工具；终端不构成只读沙箱。
func TestTeamVisionRequestCarriesOwnIdentity(t *testing.T) {
	withLegacyHomeTeam(t)
	var mu sync.Mutex
	var body string
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		if strings.Contains(string(data), "Workspace role: project.") {
			mu.Lock()
			body = string(data)
			mu.Unlock()
		}
		fixtureAnswer(rw, "map", "map card", nil)
	}, nil)
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
		t.Fatal(err)
	}
	planned := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{Plan: &PlanEngine{State: &PlanState{ID: "p", Status: "active"}}})
	if _, err := w.team(planned, WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceProject, "request_id": "map-2", "message": "locate the toolbox", "wait": true})); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(body, "你是Vaya") || !strings.Contains(body, "Workspace role: project.") || strings.Contains(body, "画布交流约定") || strings.Contains(body, "You are Eyra") || strings.Contains(body, "你是 Eyra") {
		t.Fatal("Vaya request identity is wrong")
	}
	var request struct {
		Tools []struct{ Name string } `json:"tools"`
	}
	_ = json.Unmarshal([]byte(body), &request)
	var hasProject, hasMemory bool
	for _, tool := range request.Tools {
		hasProject = hasProject || tool.Name == "project"
		hasMemory = hasMemory || tool.Name == "memory"
		if tool.Name == "agents" || tool.Name == "settings" || tool.Name == "apply_patch" {
			t.Fatal("Vaya request offered", tool.Name)
		}
	}
	if !hasProject || !hasMemory {
		t.Fatal("Vaya lost its project or public memory tool", hasProject, hasMemory)
	}
}

// 对外发布与上报必须带 confirmed（先征得用户同意）。
func TestToolboxRoutedPublishingNeedsConsent(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct{ name, args string }{
		{"community", `{"action":"topic_publish","title":"x"}`},
		{"community", `{"action":"reply","id":"1"}`},
		{"cloud_report", `{"action":"report_bug","title":"x"}`},
	} {
		if _, err := toolboxRouted(ctx, tc.name, json.RawMessage(tc.args)); err == nil || !strings.Contains(err.Error(), "ask_user") {
			t.Fatal(tc.name, "published without consent", err)
		}
	}
	if _, err := toolboxRouted(ctx, "cloud_report", json.RawMessage(`{"action":"delete_everything"}`)); err == nil {
		t.Fatal("unknown cloud_report action accepted")
	}
	if data, err := toolboxRouted(ctx, "software_api", json.RawMessage(`{"action":"connections"}`)); data != nil || err != nil {
		t.Fatal("settings actions must fall through to the settings service", string(data), err)
	}
}

// 每个角色一把稳定的缓存键；不支持的供应商不带这个字段。
func TestPromptCacheKeyPerRole(t *testing.T) {
	s := Defaults()
	s.Adapter, s.Model = "openai", "gpt-5.5"
	key := func(id string, s *Settings) any {
		r := withPromptCacheKey(WithProviderSession(context.Background(), id), s, BuildResponsesRequest(s, nil, false, nil))
		data, _ := json.Marshal(r)
		var body map[string]any
		_ = json.Unmarshal(data, &body)
		return body["prompt_cache_key"]
	}
	a, b := key("agent-matrix", s), key("agent-nova", s)
	if a == nil || a == b || a != key("agent-matrix", s) {
		t.Fatal("cache keys must be stable per role and distinct across roles", a, b)
	}
	s.Model = "deepseek-v4-flash"
	if key("agent-matrix", s) != nil {
		t.Fatal("non-GPT providers must not receive prompt_cache_key")
	}
}

func TestPromptCachePartitionSurvivesHomeExecutorReopen(t *testing.T) {
	s := Defaults()
	s.Adapter, s.Model = "openai", "gpt-6.1-sol"
	key := func(record AgentRecord) any {
		request := withPromptCacheKey(WithProviderSession(context.Background(), providerSessionIdentity(record)), s, BuildResponsesRequest(s, nil, true, nil))
		var body map[string]any
		_ = json.Unmarshal(rawJSON(request), &body)
		return body["prompt_cache_key"]
	}
	first := AgentRecord{ID: "executor-before", LinkSession: "durable-home", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}
	reopened := first
	reopened.ID = "executor-after"
	if key(first) == nil || key(first) != key(reopened) {
		t.Fatal("normal reopen repartitioned a durable conversation")
	}
	other := reopened
	other.LinkSession = "another-home"
	if key(other) == key(first) {
		t.Fatal("separate conversations share a partition")
	}
	worker := first
	worker.Spec.WorkspaceRole = WorkspaceExecution
	workerAfter := worker
	workerAfter.ID = "another-worker"
	if key(worker) == key(first) || key(worker) == key(workerAfter) {
		t.Fatal("worker identities were merged into the home session")
	}
}

// 协同形态的执行窗口（R13）：Vaya 和 Cota 的终端按各自角色任务读取；外部任务和代次不对仍然拒绝。
func TestTeamRoleTerminalsReadable(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("terminal projection must not call models") })
	m := shellTestManager(t)
	m.generation = 1
	r := shellDone(t, m, m.start(context.Background(), shellTestCommand(t, "output")))
	primary, nova, foreign := workspaceID(), workspaceID(), workspaceID()
	done := make(chan struct{})
	close(done)
	w.mu.Lock()
	w.state.Roles[WorkspaceMatrix], w.state.Roles[WorkspaceExecution] = primary, nova
	w.mu.Unlock()
	w.manager.mu.Lock()
	w.manager.jobs[primary] = &agentJob{record: AgentRecord{ID: primary, Parent: w.state.ID, Generation: 1, State: "running", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}, done: done}
	w.manager.jobs[nova] = &agentJob{record: AgentRecord{ID: nova, Parent: w.state.ID, Generation: 1, State: "running", Spec: AgentSpec{WorkspaceRole: WorkspaceExecution}}, shell: m, done: done}
	w.manager.jobs[foreign] = &agentJob{record: AgentRecord{ID: foreign, Parent: w.state.ID, Generation: 1, State: "running", Spec: AgentSpec{WorkspaceRole: WorkspaceExecution}}, shell: m, done: done}
	w.manager.mu.Unlock()
	call := func(agent string, generation int) (map[string]any, error) {
		v, err := w.Call(context.Background(), "workspace.terminals", rawJSON(workspaceTerminalRequest{TaskID: w.state.ID, AgentID: agent, Generation: generation}))
		if err != nil {
			return nil, err
		}
		return v.(map[string]any), nil
	}
	value, err := call(nova, 1)
	if err != nil || value["agent_id"] != nova || len(value["sessions"].([]any)) != 1 {
		t.Fatal("Cota terminal not readable", value, err, r.SessionID)
	}
	for _, c := range []struct {
		agent      string
		generation int
	}{{foreign, 1}, {nova, 2}} {
		if _, err := call(c.agent, c.generation); err == nil {
			t.Fatal("terminal binding bypassed", c)
		}
	}
}

// Gemini 经网关的各种工具流形态都要能执行，不能把任务打断。
func TestChatToolsToleratesGatewayGeminiShapes(t *testing.T) {
	read := func(lines ...string) (*Message, error) {
		var out *Message
		err := readChatTools(strings.NewReader("data: "+strings.Join(lines, "\n\ndata: ")+"\n\ndata: [DONE]\n\n"), func(e Event) error {
			if e.Kind == EventResponse {
				out = e.Message
			}
			return nil
		})
		return out, err
	}
	// 并行调用都写 index 0、中途给 stop、第二个没参数、带签名。
	m, err := read(
		`{"id":"a","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"one","arguments":"{}"},"extra_content":{"google":{"thought_signature":"sig"}}}]},"finish_reason":"stop"}]}`,
		`{"id":"a","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c2","type":"function","function":{"name":"two","arguments":""}}]},"finish_reason":"stop"}]}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.ToolCalls) != 2 || m.ToolCalls[1].Function.Name != "two" || m.ToolCalls[1].Function.Arguments != "{}" || m.FinishReason != "tool_calls" {
		t.Fatalf("%+v", m)
	}
	if !strings.Contains(string(m.ToolCalls[0].ExtraContent), "thought_signature") {
		t.Fatal("signature lost")
	}
	// 没有 index、没有 id：各自成一个调用，补上不重复的 id；分片续写的参数不被拆开。
	m, err = read(
		`{"choices":[{"delta":{"tool_calls":[{"function":{"name":"one","arguments":"{\"a\""}}]},"finish_reason":""}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":":1}"}}]},"finish_reason":""}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"function":{"name":"two","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.ToolCalls) != 2 || m.ToolCalls[0].Function.Arguments != `{"a":1}` || m.ToolCalls[0].ID == "" || m.ToolCalls[0].ID == m.ToolCalls[1].ID {
		t.Fatalf("%+v", m.ToolCalls)
	}
	// 流里报过载走重试；坏的函数调用也走重试；没收到 [DONE] 的不算完成。
	_, err = read(`{"error":{"code":503,"message":"The model is overloaded"}}`)
	if transientRequestError(err) == "" {
		t.Fatal("overload in stream must be retried", err)
	}
	_, err = read(`{"choices":[{"delta":{},"finish_reason":"MALFORMED_FUNCTION_CALL"}]}`)
	if transientRequestError(err) == "" {
		t.Fatal("malformed call must be retried", err)
	}
	if _, err = read(`{"error":{"code":400,"message":"API key not valid"}}`); err == nil || transientRequestError(err) != "" {
		t.Fatal("a real rejection is not transient", err)
	}
	cut := readChatTools(strings.NewReader(`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"one","arguments":"{\"a"}}]}}]}`+"\n\n"), func(Event) error { return nil })
	if cut == nil || transientRequestError(cut) == "" {
		t.Fatal("a cut stream must be retried", cut)
	}
	// 偶发 400 只对 Gemini 重试，说请求太大的不算；换供应商不带别家的签名。
	gemini := &Settings{Model: "gemini-4-argon-high"}
	if transientRequestError(markGeminiTransient(gemini, &APIError{StatusCode: 400, Message: "Request contains an invalid argument."})) == "" {
		t.Fatal("gemini 400 not retried")
	}
	if transientRequestError(markGeminiTransient(gemini, &APIError{StatusCode: 400, Message: "input token count exceeds the maximum"})) != "" {
		t.Fatal("too large must not be retried")
	}
	if transientRequestError(markGeminiTransient(&Settings{Model: "gpt-5"}, &APIError{StatusCode: 400})) != "" {
		t.Fatal("only gemini")
	}
	carried := BuildRequest(&Settings{Adapter: "openai", Model: "other"}, []Message{{Role: RoleAssistant, Provider: "elsewhere", ToolCalls: []ToolCall{{ID: "c", ExtraContent: json.RawMessage(`{"x":1}`)}}}}, false)
	if len(carried.Messages[0].ToolCalls[0].ExtraContent) != 0 {
		t.Fatal("signature crossed providers")
	}
}
