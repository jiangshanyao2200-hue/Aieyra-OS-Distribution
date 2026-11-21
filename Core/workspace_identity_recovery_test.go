// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherIdentityCrashRecoveryRetainsEvidenceWithoutReplaying; TestMotherIdentityRejectsActivationWithoutMatchingCheckpoint; TestMotherTakeoverFencesFailedGeneration
// Impact: python -B scripts/code-atlas.py show Core/workspace_identity_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMotherIdentityCrashRecoveryRetainsEvidenceWithoutReplaying(t *testing.T) {
	for _, phase := range []string{"preparing", "active", "exiting"} {
		t.Run(phase, func(t *testing.T) {
			a := &SessionArchive{Path: filepath.Join(t.TempDir(), "identity.jsonl")}
			if err := a.Start("mother-model"); err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			c := &motherIdentity{archive: a, receipts: map[string]*motherIdentityState{}}
			v := &motherIdentityState{ID: "handoff", Actor: "mother", Scope: "scope", Generation: 1, Model: "mother-model", Contact: "contact", Name: "Specialist", Phase: "preparing", Prompt: "role instructions", PromptHash: fmt.Sprintf("%x", sha256.Sum256([]byte("role instructions"))), Tools: []string{"apply_patch"}, Compaction: "handoff-compact"}
			if err := c.save(v); err != nil {
				t.Fatal(err)
			}
			if phase != "preparing" {
				if err := a.Append("message", Message{Role: RoleUser, Content: "original task"}); err != nil {
					t.Fatal(err)
				}
				if err := a.Append("message", Message{Role: RoleAssistant, Content: "committed tool evidence, never repeat"}); err != nil {
					t.Fatal(err)
				}
				cp := &Checkpoint{Covered: 2, Summary: CompactSummary{Goals: []string{"original task"}}, Compaction: &CompactionState{RequestID: v.Compaction, Trigger: "manual", State: "completed", Purpose: "identity_enter", Covered: 2, Updated: time.Now().UTC().Format(time.RFC3339Nano)}}
				if err := a.Append("checkpoint", cp); err != nil {
					t.Fatal(err)
				}
				v.Phase, v.Checkpoint = "active", 2
				if err := c.save(v); err != nil {
					t.Fatal(err)
				}
				if phase == "exiting" {
					v.Phase, v.Outcome = "exiting", "work done before process loss"
					if err := c.save(v); err != nil {
						t.Fatal(err)
					}
				}
			}
			a.Close()
			// A new reader/controller has no live grant, credentials or worker.
			reopened := &SessionArchive{Path: a.Path}
			r, err := reopened.read()
			if err != nil {
				t.Fatal(err)
			}
			recovery := &motherIdentity{archive: reopened, state: r.MotherIdentity, receipts: r.MotherIdentities}
			if err = recovery.recover(); err != nil {
				t.Fatal(err)
			}
			after, err := reopened.read()
			if err != nil {
				t.Fatal(err)
			}
			if identityOpen(after.MotherIdentity) || len(after.Messages) != len(r.Messages) || string(rawJSON(after.Plan.Receipts)) != string(rawJSON(r.Plan.Receipts)) || string(rawJSON(after.Checkpoint)) != string(rawJSON(r.Checkpoint)) {
				t.Fatal("recovery lost evidence or retained authority")
			}
			if after.MotherIdentity.ID != v.ID || after.MotherIdentity.PromptHash != v.PromptHash || after.MotherIdentity.Revision != r.MotherIdentity.Revision+1 {
				t.Fatal("recovery rewrote handoff identity")
			}
			beforeRevision := after.MotherIdentity.Revision
			if err = recovery.recover(); err != nil || recovery.snapshot().Revision != beforeRevision {
				t.Fatal("recovery was not idempotent", err)
			}
		})
	}
}

func TestMotherIdentityRejectsActivationWithoutMatchingCheckpoint(t *testing.T) {
	a := &SessionArchive{Path: filepath.Join(t.TempDir(), "identity.jsonl")}
	if err := a.Start("mother-model"); err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	c := &motherIdentity{archive: a, receipts: map[string]*motherIdentityState{}}
	v := &motherIdentityState{ID: "handoff", Actor: "mother", Scope: "scope", Generation: 1, Model: "mother-model", Contact: "contact", Phase: "preparing", PromptHash: fmt.Sprintf("%x", sha256.Sum256(nil)), Compaction: "expected"}
	if err := c.save(v); err != nil {
		t.Fatal(err)
	}
	v.Phase, v.Checkpoint = "active", 1
	if err := c.save(v); err != nil {
		t.Fatal(err)
	}
	if _, err := a.read(); err == nil {
		t.Fatal("an active permission record without a checkpoint reopened")
	}
}

func TestMotherTakeoverFencesFailedGeneration(t *testing.T) {
	entered := make(chan struct{})
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		if strings.Contains(string(rawJSON(body)), "FAIL-SOURCE-CONTACT") {
			fixtureAnswer(rw, "source-failure", "", []any{map[string]any{"type": "function_call", "id": "fc-forbidden", "call_id": "forbidden", "name": "apply_patch", "arguments": `{"patch":"must not run"}`}})
			return
		}
		close(entered)
		<-req.Context().Done()
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "failed-contact", "name": "Source", "model_id": "local-model", "prompt_text": "FAIL-SOURCE-CONTACT"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.Send("live-mother", "wait while we inspect a delegated failure"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("mother did not start")
	}
	w.mu.Lock()
	actor, scope := w.state.Roles[WorkspaceMatrix], w.coreLinkScopeLocked()
	w.mu.Unlock()
	ctx := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
	invited, err := w.manager.coreLinkCall(ctx, actor, rawJSON(map[string]any{"action": "link_invite", "request_id": "source", "contact_id": value.(map[string]any)["id"]}))
	if err != nil {
		t.Fatal(err)
	}
	var member struct{ ID string }
	if err = json.Unmarshal(rawJSON(invited), &member); err != nil || member.ID == "" {
		t.Fatal(invited, err)
	}
	if _, err = w.manager.coreLinkCall(ctx, actor, rawJSON(map[string]any{"action": "link_send", "id": member.ID, "generation": 0, "request_id": "work", "message": "perform the assigned work"})); err != nil {
		t.Fatal(err)
	}
	cm, _ := h.conversationManager()
	r, err := cm.Wait(context.Background(), cm.owner, member.ID, 10000)
	if err != nil || r.State != "failed" {
		t.Fatal(r.State, r.Error, err)
	}
	c := &motherIdentity{w: w}
	v := &motherIdentityState{ID: "takeover", Actor: actor, Scope: scope, FailedAgent: r.ID, FailedGeneration: r.Generation}
	if err = c.takeover(v); err != nil {
		t.Fatal(err)
	}
	internal := context.WithValue(context.Background(), conversationLinkOriginKey{}, conversationLinkOrigin{Scope: scope, From: scope, Generation: 1, Kind: "message"})
	if _, err = cm.sendGenerationScoped(internal, cm.owner, r.ID, "late-retry", "must not restart", taskMessageHash("must not restart"), r.Generation, nil); err == nil {
		t.Fatal("late internal message restarted transferred work")
	}
	v.Checkpoint = 2
	if err = c.releaseTakeover(v); err != nil {
		t.Fatal(err)
	}
	if _, err = cm.sendGenerationScoped(internal, cm.owner, r.ID, "after-completion", "must not restart", taskMessageHash("must not restart"), r.Generation, nil); err == nil {
		t.Fatal("completion removed old-generation fence")
	}
	if _, err = cm.Send(cm.owner, r.ID, "explicit-user", "new user request"); err != nil {
		t.Fatal("explicit user could not supersede the handoff", err)
	}
	if err = c.checkTakeover(v); err == nil {
		t.Fatal("mother retained authority after user restarted the original worker")
	}
	if _, err = cm.Wait(context.Background(), cm.owner, r.ID, 10000); err != nil {
		t.Fatal(err)
	}
}
