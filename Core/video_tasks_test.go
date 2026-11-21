// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: videoTestTransport; RoundTrip; videoTestFixture; videoTestResponse; videoTestMedia; TestVideoTaskDurableLifecycleDoesNotRechargeOnPollFailureOrReopen; TestVideoTaskUnknownSubmissionRecoveryAndPinnedConnection; TestVideoTaskToolboxDispatchCancellationAndPackageDisable; TestVideoDefaultSelectionAndExistingRequestBinding
// Impact: python -B scripts/code-atlas.py show Core/video_tasks_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	apivideos "github.com/aieyra/aieyra-os/api/videos"
)

type videoTestTransport func(*http.Request) (*http.Response, error)

func (f videoTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func videoTestFixture(t *testing.T, transport videoTestTransport) (string, context.Context) {
	t.Helper()
	useTestStage(t, ReleaseStage{Toolbox: true})
	config := imageGenTestConfig(t, "https://fast.aieyra.cn/v1", true)
	s, err := Load(config)
	if err != nil {
		t.Fatal(err)
	}
	s.APIProfiles[0].Model = "muse-video"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	old := videoClientFactory
	videoClientFactory = func(choice imageGenChoice) (*apivideos.Client, error) {
		return apivideos.NewClient(choice.baseURL, choice.apiKey, &http.Client{Transport: transport})
	}
	t.Cleanup(func() { videoClientFactory = old })
	w := &Workspace{config: config, state: workspaceState{ID: "video-session-a"}}
	return config, context.WithValue(WithToolPermissions(context.Background(), []string{"video_gen"}), workspaceContextKey{}, workspaceContext{workspace: w, role: WorkspaceMatrix})
}

func videoTestResponse(r *http.Request, status int, body []byte) *http.Response {
	return &http.Response{Request: r, StatusCode: status, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body))}
}

func videoTestMedia() []byte {
	box := func(kind string, content ...[]byte) []byte {
		body := bytes.Join(content, nil)
		out := make([]byte, 8)
		binary.BigEndian.PutUint32(out, uint32(len(body)+8))
		copy(out[4:], kind)
		return append(out, body...)
	}
	movie, track, samples := make([]byte, 20), make([]byte, 84), make([]byte, 8)
	binary.BigEndian.PutUint32(movie[12:], 1000)
	binary.BigEndian.PutUint32(movie[16:], 4120)
	binary.BigEndian.PutUint32(track[76:], 1280<<16)
	binary.BigEndian.PutUint32(track[80:], 720<<16)
	binary.BigEndian.PutUint32(samples[4:], 1)
	return bytes.Join([][]byte{box("ftyp", []byte("isom\x00\x00\x00\x00")), box("mdat", []byte("synthetic-media")), box("moov", box("mvhd", movie), box("trak", box("tkhd", track), box("mdia", box("minf", box("stbl", box("stsd", samples, box("avc1")))))))}, nil)
}

func TestVideoTaskDurableLifecycleDoesNotRechargeOnPollFailureOrReopen(t *testing.T) {
	posts, queries, downloads := 0, 0, 0
	config, ctx := videoTestFixture(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "media.example.test" {
			downloads++
			if r.Header.Get("Authorization") != "" {
				t.Fatal("media credential leaked")
			}
			return videoTestResponse(r, 200, videoTestMedia()), nil
		}
		if r.Method == "POST" {
			posts++
			return videoTestResponse(r, 200, []byte(`{"id":"task_public","status":"queued"}`)), nil
		}
		queries++
		if queries == 1 {
			return videoTestResponse(r, 503, []byte(`{"error":"channel is nil"}`)), nil
		}
		return videoTestResponse(r, 200, []byte(`{"id":"task_public","status":"completed","url":"https://media.example.test/movie.mp4?signature=must-stay-private"}`)), nil
	})
	create := rawJSON(map[string]any{"action": "create", "request_id": "video-one", "profile_id": "image-model", "prompt": "quiet river", "duration": 6})
	r, err := runVideoGen(ctx, config, create)
	if err != nil || r.State != "prepared" || posts != 0 {
		t.Fatal(r, err)
	}
	call := func(action string) (videoResult, error) {
		return runVideoGen(ctx, config, rawJSON(map[string]any{"action": action, "request_id": "video-one"}))
	}
	r, err = call("submit")
	if err != nil || r.State != "queued" || posts != 1 || !r.Submitted || r.UsageReported {
		t.Fatal(r, err, posts)
	}
	r, err = call("query")
	if err == nil || r.TaskID != "task_public" || r.State != "queued" {
		t.Fatal("query failure lost original task", r, err)
	}
	_, err = call("query")
	if err == nil || queries != 1 {
		t.Fatal("unbounded polling", err, queries)
	}
	scope, _ := videoScope(ctx)
	dir := filepath.Join(PrivatePaths(config).VideoTasks, workflowHash(scope), "video-one")
	record, err := readVideoRecord(dir, scope, "video-one")
	if err != nil {
		t.Fatal(err)
	}
	record.LastQuery = 0
	if err = saveVideoRecord(dir, record); err != nil {
		t.Fatal(err)
	}
	r, err = call("query")
	if err != nil || r.State != "ready" {
		t.Fatal(r, err)
	}
	r, err = call("download")
	if err != nil || r.State != "completed" || r.Media == nil || r.Media.Seconds != 4.12 || r.Media.Width != 1280 || r.Path == "" || len(r.SHA256) != 64 {
		t.Fatal(r, err)
	}
	encoded, _ := json.Marshal(r)
	if strings.Contains(string(encoded), "signature") || strings.Contains(string(encoded), "fake-key") {
		t.Fatal("private provider information leaked")
	}
	// A new caller object after reopening reads only the persistent record.
	ctx = context.WithValue(ctx, workspaceContextKey{}, workspaceContext{workspace: &Workspace{config: config, state: workspaceState{ID: "video-session-a"}}, role: WorkspaceMatrix})
	for _, action := range []string{"status", "submit", "download", "recover"} {
		r, err = call(action)
		if err != nil || r.State != "completed" {
			t.Fatal(action, r, err)
		}
	}
	if posts != 1 || queries != 2 || downloads != 1 {
		t.Fatal("reopening reissued a network request", posts, queries, downloads)
	}
	if _, err = runVideoGen(ctx, config, rawJSON(map[string]any{"action": "create", "request_id": "video-one", "profile_id": "image-model", "prompt": "changed", "duration": 6})); err == nil {
		t.Fatal("request ID changed meaning")
	}
	other := context.WithValue(ctx, workspaceContextKey{}, workspaceContext{workspace: &Workspace{config: config, state: workspaceState{ID: "other-private-session"}}, role: WorkspaceMatrix})
	if _, err = runVideoGen(other, config, rawJSON(map[string]any{"action": "status", "request_id": "video-one"})); err == nil {
		t.Fatal("cross-conversation task read")
	}
	if err = os.WriteFile(r.Path, []byte("corrupt replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = call("download"); err == nil || downloads != 1 {
		t.Fatal("tampered completed artifact silently accepted or regenerated", err)
	}
}

func TestVideoTaskUnknownSubmissionRecoveryAndPinnedConnection(t *testing.T) {
	posts := 0
	config, ctx := videoTestFixture(t, func(r *http.Request) (*http.Response, error) {
		posts++
		return nil, errors.New("accepted upstream but response lost")
	})
	create := rawJSON(map[string]any{"action": "create", "request_id": "unknown-one", "profile_id": "image-model", "prompt": "quiet river", "duration": 6})
	if _, err := runVideoGen(ctx, config, create); err != nil {
		t.Fatal(err)
	}
	call := func(action string) (videoResult, error) {
		return runVideoGen(ctx, config, rawJSON(map[string]any{"action": action, "request_id": "unknown-one"}))
	}
	r, err := call("submit")
	if err == nil || r.State != "unknown" || posts != 1 {
		t.Fatal(r, err, posts)
	}
	for _, action := range []string{"submit", "status"} {
		r, err = call(action)
		if err != nil || r.State != "unknown" || posts != 1 {
			t.Fatal("unknown request repeated", r, err, posts)
		}
	}
	if _, err = call("recover"); err == nil {
		t.Fatal("recovered without an original response")
	}
	scope, _ := videoScope(ctx)
	dir := filepath.Join(PrivatePaths(config).VideoTasks, workflowHash(scope), "unknown-one")
	// Simulate a captured response whose following task-state commit was lost.
	if err = os.WriteFile(filepath.Join(dir, "create.response.json"), []byte(`{"task_id":"task_captured","status":"in_progress"}`), 0600); err != nil {
		t.Fatal(err)
	}
	r, err = call("recover")
	if err != nil || r.TaskID != "task_captured" || r.State != "processing" || posts != 1 {
		t.Fatal(r, err)
	}
	s, err := Load(config)
	if err != nil {
		t.Fatal(err)
	}
	s.ProviderConnections[0].ID = "replacement"
	s.APIProfiles[0].ConnectionID = "replacement"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err = call("query"); err == nil || posts != 1 {
		t.Fatal("task changed provider binding", err)
	}
	rows, err := discoverModels(config, rawJSON(map[string]any{"category": "video"}))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(rows)
	if !strings.Contains(string(encoded), `"category":"video"`) || strings.Contains(string(encoded), "fake-key") {
		t.Fatal("video model discovery lost or exposed private config")
	}
}

func TestVideoTaskToolboxDispatchCancellationAndPackageDisable(t *testing.T) {
	posts := 0
	config, ctx := videoTestFixture(t, func(r *http.Request) (*http.Response, error) {
		posts++
		return videoTestResponse(r, 200, []byte(`{"id":"task_public","status":"queued"}`)), nil
	})
	state := &ToolboxState{}
	if r := state.Execute(ctx, config, toolboxCall("open-video", "open", "video_gen")); !r.OK {
		t.Fatal(r)
	}
	args := map[string]any{"action": "create", "request_id": "cancel-one", "profile_id": "image-model", "prompt": "quiet river", "duration": 6}
	r := state.Execute(ctx, config, discoveryQueryCall("create-video", "video_gen", args))
	if !r.OK || posts != 0 {
		t.Fatal("toolbox failed to prepare without network", r, posts)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := runVideoGen(cancelled, config, rawJSON(map[string]any{"action": "submit", "request_id": "cancel-one"})); err == nil || posts != 0 {
		t.Fatal("cancelled local wait submitted paid request", err, posts)
	}
	// A disabled native package permits only original-task readback, no new
	// submission. Its admission snapshot is supplied by the host, not input.
	disabled := context.WithValue(ctx, officialToolAdmissionKey{}, map[string]bool{})
	if _, err := runVideoGen(disabled, config, rawJSON(map[string]any{"action": "submit", "request_id": "cancel-one"})); err == nil || posts != 0 {
		t.Fatal("disabled package submitted", err)
	}
	if v, err := runVideoGen(disabled, config, rawJSON(map[string]any{"action": "status", "request_id": "cancel-one"})); err != nil || v.State != "prepared" {
		t.Fatal("disabled package lost original record", v, err)
	}
	for _, raw := range []string{`{"action":"create","request_id":"../other"}`, `{"action":"create","request_id":"new","unknown_option":true}`} {
		if _, err := runVideoGen(ctx, config, json.RawMessage(raw)); err == nil {
			t.Fatal("invalid identity or unsupported option accepted")
		}
	}
}

func TestVideoDefaultSelectionAndExistingRequestBinding(t *testing.T) {
	config, ctx := videoTestFixture(t, func(r *http.Request) (*http.Response, error) {
		t.Fatal("default selection must not submit a video")
		return nil, nil
	})
	var raw map[string]any
	data, _ := os.ReadFile(config)
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	raw["video_profile"] = "image-model"
	data, _ = json.Marshal(raw)
	if err := os.WriteFile(config, data, 0600); err != nil {
		t.Fatal(err)
	}
	args := rawJSON(map[string]any{"action": "create", "request_id": "default-video", "prompt": "quiet river", "duration": 6})
	first, err := runVideoGen(ctx, config, args)
	if err != nil {
		t.Fatal(err)
	}
	if first.Model != "muse-video" {
		t.Fatalf("wrong default: %#v", first)
	}
	raw["video_profile"] = "removed-model"
	data, _ = json.Marshal(raw)
	if err := os.WriteFile(config, data, 0600); err != nil {
		t.Fatal(err)
	}
	again, err := runVideoGen(ctx, config, args)
	if err != nil || again.Model != first.Model {
		t.Fatalf("existing request changed: %#v %v", again, err)
	}
	if _, _, err := videoChoice(config, ""); err == nil {
		t.Fatal("missing default accepted")
	}
}
