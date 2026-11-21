// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestContactDefaultMediaKeepsExplicitRemovalAndReopen; TestContactAvatarRotationPersistsAndRejectsStaleDelivery; TestContactAvatarRotationValidation
// Impact: python -B scripts/code-atlas.py show Core/conversation_avatar_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestContactDefaultMediaKeepsExplicitRemovalAndReopen(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("defaults must not call a model") })
	h := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(h.Close)
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	created := call(map[string]any{"action": "contact_create", "request_id": "default-media", "model_id": "local-model"})
	id := created["id"].(string)
	if created["name"] != "智能体" || created["description"] != "与你协作的助手" || created["avatar_rev"] != 1 {
		t.Fatal(created)
	}
	cm, _ := h.conversationManager()
	before, err := os.ReadFile(filepath.Join(cm.contactDir(), id+".avatar"))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = decodeContactAvatar("data:image/png;base64," + base64.StdEncoding.EncodeToString(before)); err != nil {
		t.Fatal(err)
	}
	retried := call(map[string]any{"action": "contact_create", "request_id": "default-media", "model_id": "local-model"})
	var first, again map[string]any
	_ = json.Unmarshal(created["avatar_rotation"].(json.RawMessage), &first)
	_ = json.Unmarshal(retried["avatar_rotation"].(json.RawMessage), &again)
	after, err := os.ReadFile(filepath.Join(cm.contactDir(), id+".avatar"))
	if err != nil || first["nextAt"] != again["nextAt"] || first["id"] != again["id"] || string(before) != string(after) {
		t.Fatal("retry reselected default", err)
	}
	cleared := call(map[string]any{"action": "contact_update", "id": id, "avatar": ""})
	if cleared["avatar_rev"] != 0 {
		t.Fatal(cleared)
	}
	explicit := call(map[string]any{"action": "contact_create", "request_id": "explicit-off", "model_id": "local-model", "avatar": "", "description": ""})
	if explicit["avatar_rev"] != 0 || explicit["description"] != "" {
		t.Fatal("explicit removal overwritten", explicit)
	}
	programID := programContactID("browser")
	program := call(map[string]any{"action": "contact", "id": programID})
	if program["avatar_rev"] != 1 {
		t.Fatal("program missing default avatar", program)
	}
	call(map[string]any{"action": "contact_update", "id": programID, "avatar": ""})
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	t.Cleanup(h.Close)
	for _, removed := range []string{id, explicit["id"].(string), programID} {
		row := call(map[string]any{"action": "contact", "id": removed})
		if row["avatar_rev"] != 0 {
			t.Fatal("reopen restored explicitly removed avatar", row)
		}
	}
}

func TestContactAvatarRotationPersistsAndRejectsStaleDelivery(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("avatar edit must not call a model") })
	h := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(h.Close)
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	rotation := map[string]any{"mode": "random", "intervalSeconds": 60, "nextAt": 123456}
	created := call(map[string]any{"action": "contact_create", "request_id": "avatar-rotation", "name": "rotation", "model_id": "local-model", "avatar": testAvatarURL(t), "avatar_rotation": rotation})
	id := created["id"].(string)
	if created["avatar_revision"] != 1 {
		t.Fatal(created)
	}
	cm, _ := h.conversationManager()
	saved, err := cm.readContact(id)
	if err != nil {
		t.Fatal(err)
	}
	var pref map[string]any
	if err = json.Unmarshal(saved.AvatarRotation, &pref); err != nil || pref["mode"] != "random" || pref["nextAt"] != float64(123456) {
		t.Fatal(pref, err)
	}
	// Editing only the interval invalidates an image already being downloaded.
	rotation["intervalSeconds"] = 300
	edited := call(map[string]any{"action": "contact_update", "id": id, "avatar_rotation": rotation})
	if edited["avatar_revision"] != 2 {
		t.Fatal(edited)
	}
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_update", "id": id, "avatar": testAvatarURL(t), "avatar_rotation": rotation, "avatar_expected_revision": 1})); err == nil {
		t.Fatal("stale rotation replaced new settings")
	}
	updated := call(map[string]any{"action": "contact_update", "id": id, "avatar": testAvatarURL(t), "avatar_rotation": rotation, "avatar_expected_revision": 2})
	if updated["avatar_revision"] != 3 || updated["avatar_rev"] != 3 {
		t.Fatal(updated)
	}
	// Old clients that choose a manual image stop automatic rotation as well.
	manual := call(map[string]any{"action": "contact_update", "id": id, "avatar": ""})
	if manual["avatar_revision"] != 4 || manual["avatar_rev"] != 0 {
		t.Fatal(manual)
	}
	var stopped map[string]any
	if err = json.Unmarshal(manual["avatar_rotation"].(json.RawMessage), &stopped); err != nil || stopped["mode"] != "off" {
		t.Fatal(stopped, err)
	}
	reselected := call(map[string]any{"action": "contact_update", "id": id, "avatar": testAvatarURL(t)})
	if reselected["avatar_rev"] != 5 || reselected["avatar_rev"] == created["avatar_rev"] {
		t.Fatal("cleared avatar reused a cached image identity", reselected)
	}
	h.Close()
	reopened := NewWorkspaceHost(m.config, "", "")
	defer reopened.Close()
	v, err := reopened.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact", "id": id}))
	if err != nil {
		t.Fatal(err)
	}
	if v.(map[string]any)["avatar_revision"] != 5 {
		t.Fatal("reopen lost revision", v)
	}
}

func TestContactAvatarRotationValidation(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{"mode":"unknown"}`, `{"mode":"random","intervalSeconds":59}`, `{"intervalSeconds":604801}`, `{"nextAt":-1}`, `{"nextAt":9007199254740992}`, `{"intervalSeconds":60.5}`, `{"id":"official.avatar-1"}`, `{"url":"https://example.invalid/a"}`} {
		if _, err := cleanContactAvatarRotation(json.RawMessage(raw)); err == nil {
			t.Errorf("accepted invalid rotation %s", raw)
		}
	}
	if got, err := cleanContactAvatarRotation(nil); err != nil || got != nil {
		t.Fatal(got, err)
	}
	if contactAvatarRevision(conversationContact{AvatarRev: 7}) != 7 {
		t.Fatal("legacy revision lost")
	}
}
