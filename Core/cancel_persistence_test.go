// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: cancelPersistenceBlockedDirectory; cancelPersistenceManager; cancelPersistenceJob; cancelPersistenceDenyRecord; TestCancelPersistenceFailureReachesProviderAndPreservesSibling; TestWorkspaceCancelSnapshotFailureStopsEveryRoleAndRetainsRequest; TestCoreLinkCancelPersistenceFailureStopsVerifiedServices
// Impact: python -B scripts/code-atlas.py show Core/cancel_persistence_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func cancelPersistenceBlockedDirectory(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "unavailable-directory")
	if err := os.WriteFile(path, []byte("retained filesystem obstacle"), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func cancelPersistenceManager(t *testing.T) *AgentManager {
	t.Helper()
	return &AgentManager{owner: workspaceID(), dir: t.TempDir(), ctx: context.Background(), jobs: map[string]*agentJob{}}
}

func cancelPersistenceJob(t *testing.T, m *AgentManager, parent string, link *conversationLinkBinding) (*agentJob, context.Context) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	id := workspaceID()
	job := &agentJob{cancel: cancel, record: AgentRecord{ID: id, Parent: parent, Depth: 1, Generation: 3, State: "running", Link: link,
		Spec:  AgentSpec{RequestID: "original", Task: "retained original input", Workdir: t.TempDir()},
		Turns: map[string]string{"original": "retained original input"}, TurnGenerations: map[string]int{"original": 3}}}
	if link != nil {
		job.record.Spec.Kind = "conversation"
	}
	m.jobs[id] = job
	if err := m.saveLocked(job); err != nil {
		t.Fatal("cannot establish cancellation fixture", err)
	}
	return job, ctx
}

func cancelPersistenceDenyRecord(t *testing.T, m *AgentManager, id string) (string, []byte) {
	t.Helper()
	file := filepath.Join(m.dir, id+".json")
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	retained := file + ".retained"
	if err = os.Rename(file, retained); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(file, 0700); err != nil {
		t.Fatal(err)
	}
	return retained, original
}

func TestCancelPersistenceFailureReachesProviderAndPreservesSibling(t *testing.T) {
	started, stopped := make(chan string, 3), make(chan string, 3)
	release := make(chan struct{})
	names := []string{"cancel-parent-marker", "cancel-child-marker", "cancel-sibling-marker"}
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		name := ""
		for _, candidate := range names {
			if strings.Contains(string(body), candidate) {
				name = candidate
			}
		}
		started <- name
		select {
		case <-req.Context().Done():
			stopped <- name
		case <-release:
			fixtureAnswer(rw, name, "finished", nil)
		}
	})
	t.Cleanup(func() { close(release) })
	create := func(owner, name string) AgentRecord {
		t.Helper()
		r, err := m.Create(context.Background(), owner, AgentSpec{RequestID: name, ModelID: "local-model", Task: name, Workdir: dir})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	parent := create(testMatrixOwner, names[0])
	child := create(parent.ID, names[1])
	sibling := create(testMatrixOwner, names[2])
	for range 3 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("fixture did not reach the real provider transport")
		}
	}
	originals := map[string][]byte{}
	for _, r := range []AgentRecord{parent, child} {
		file, data := cancelPersistenceDenyRecord(t, m, r.ID)
		originals[file] = data
	}
	for _, invalid := range []struct {
		owner      string
		generation int
	}{{workspaceID(), parent.Generation}, {testMatrixOwner, parent.Generation + 1}} {
		if err := m.CancelGeneration(invalid.owner, parent.ID, invalid.generation); err == nil {
			t.Fatal("invalid cancellation was accepted")
		}
		for _, r := range []AgentRecord{parent, child, sibling} {
			current, err := m.Status(testMatrixOwner, r.ID)
			if err != nil || current.State != "running" {
				t.Fatal("rejected stop changed a live task", current.State, err)
			}
		}
	}
	err := m.CancelGeneration(testMatrixOwner, parent.ID, parent.Generation)
	if err == nil || !strings.Contains(err.Error(), parent.ID) || !strings.Contains(err.Error(), child.ID) {
		t.Fatal("failed subtree receipts were not reported", err)
	}
	for range 2 {
		select {
		case name := <-stopped:
			if name == names[2] {
				t.Fatal("cancelling the subtree stopped its sibling provider")
			}
		case <-time.After(3 * time.Second):
			t.Fatal("a failed snapshot prevented actual provider cancellation")
		}
	}
	if current, err := m.Status(testMatrixOwner, sibling.ID); err != nil || current.State != "running" {
		t.Fatal("unrelated sibling stopped", current.State, err)
	}
	for _, r := range []AgentRecord{parent, child} {
		if _, err := m.Wait(context.Background(), testMatrixOwner, r.ID, 4000); err != nil {
			t.Fatal(err)
		}
		current, _ := m.Status(testMatrixOwner, r.ID)
		if current.Turns[r.Spec.RequestID] != r.Spec.Task {
			t.Fatal("failed cancellation lost the original request", r.ID)
		}
	}
	for file, original := range originals {
		current, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(original, current) {
			t.Fatal("failed write changed a retained snapshot", file, err)
		}
	}
}

func TestWorkspaceCancelSnapshotFailureStopsEveryRoleAndRetainsRequest(t *testing.T) {
	m := cancelPersistenceManager(t)
	first, firstCtx := cancelPersistenceJob(t, m, m.owner, nil)
	second, secondCtx := cancelPersistenceJob(t, m, m.owner, nil)
	w := &Workspace{manager: m, dir: t.TempDir(), state: workspaceState{ID: m.owner,
		Roles:    map[string]string{WorkspaceMatrix: first.record.ID, WorkspaceProject: second.record.ID},
		Messages: []workspaceMessage{{ID: "queued-original", From: "user", To: WorkspaceMatrix, Text: "original\r\n原文", State: "queued"}}}}
	if err := w.saveLocked(); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(w.dir, "workspace.json")
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	w.dir, m.dir = cancelPersistenceBlockedDirectory(t), cancelPersistenceBlockedDirectory(t)
	if err := w.Cancel(); err == nil || !strings.Contains(err.Error(), first.record.ID) || !strings.Contains(err.Error(), second.record.ID) {
		t.Fatal("failed role and workspace writes were not reported", err)
	}
	if firstCtx.Err() == nil || secondCtx.Err() == nil {
		t.Fatal("a snapshot failure left a workspace role active")
	}
	receipt, err := w.sendReceipt(rawJSON(map[string]any{"request_id": "queued-original", "message": "original\r\n原文"}))
	if err != nil || receipt.(map[string]any)["accepted"] != true || len(w.state.Messages) != 1 || w.state.Messages[0].State != "cancelled" {
		t.Fatal("stopping lost or replayed the original accepted request", receipt, err)
	}
	current, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(original, current) {
		t.Fatal("failed workspace write changed its preceding snapshot", err)
	}
}

func TestCoreLinkCancelPersistenceFailureStopsVerifiedServices(t *testing.T) {
	for _, failure := range []string{"member-records", "mailbox-replacement"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "mailbox-replacement" && runtime.GOOS != "windows" {
				t.Skip("actual Windows read-only snapshot replacement denial")
			}
			m, service := cancelPersistenceManager(t), cancelPersistenceManager(t)
			root, rootCtx := cancelPersistenceJob(t, m, m.owner, nil)
			scope := workspaceID()
			root.record.Spec.WorkspaceRole, root.record.LinkSession = WorkspaceMatrix, scope
			w := &Workspace{manager: m, host: &WorkspaceHost{mode: HostOS}}
			w.coreLinkRegistered.Store(true)
			m.workspace = w
			m.linkRootService.Store(service)
			one, oneCtx := cancelPersistenceJob(t, service, service.owner, &conversationLinkBinding{Scope: scope, Parent: scope})
			two, twoCtx := cancelPersistenceJob(t, service, service.owner, &conversationLinkBinding{Scope: scope, Parent: scope})
			_, unrelatedCtx := cancelPersistenceJob(t, service, service.owner, &conversationLinkBinding{Scope: workspaceID(), Parent: workspaceID()})
			g := &conversationGroup{ID: linkLogID(scope), LinkScope: scope, Host: groupMember{Contact: groupHost, Session: scope},
				WorkspaceLink: &workspaceLinkMailbox{Actor: root.record.ID, ActorGeneration: root.record.Generation, Generation: 7}}
			if err := service.writeGroup(g); err != nil {
				t.Fatal(err)
			}
			mailboxFile := filepath.Join(service.groupDir(), g.ID+".json")
			originalMailbox, err := os.ReadFile(mailboxFile)
			if err != nil {
				t.Fatal(err)
			}
			retained := map[string][]byte{}
			if failure == "member-records" {
				for _, job := range []*agentJob{one, two} {
					file, data := cancelPersistenceDenyRecord(t, service, job.record.ID)
					retained[file] = data
				}
			} else {
				if err = os.Chmod(mailboxFile, 0444); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.Chmod(mailboxFile, 0600) })
				if err = service.writeGroup(g); err == nil {
					t.Fatal("fixture did not deny actual mailbox snapshot replacement")
				}
			}
			for _, invalid := range []struct {
				owner      string
				generation int
			}{{workspaceID(), root.record.Generation}, {m.owner, root.record.Generation + 1}} {
				if err = m.CancelGeneration(invalid.owner, root.record.ID, invalid.generation); err == nil {
					t.Fatal("invalid cross-service cancellation was accepted")
				}
				if rootCtx.Err() != nil || oneCtx.Err() != nil || twoCtx.Err() != nil || unrelatedCtx.Err() != nil {
					t.Fatal("rejected cancellation affected a running context")
				}
				current, e := os.ReadFile(mailboxFile)
				if e != nil || !bytes.Equal(originalMailbox, current) {
					t.Fatal("rejected stop changed the mailbox", e)
				}
			}
			err = m.CancelGeneration(m.owner, root.record.ID, root.record.Generation)
			if err == nil {
				t.Fatal("failed cancellation persistence was reported successful")
			}
			if failure == "member-records" && (!strings.Contains(err.Error(), one.record.ID) || !strings.Contains(err.Error(), two.record.ID)) {
				t.Fatal("a failed member prevented cancelling/reporting its peer", err)
			}
			if rootCtx.Err() == nil || oneCtx.Err() == nil || twoCtx.Err() == nil || unrelatedCtx.Err() != nil {
				t.Fatal("verified cancellation did not stop exactly the bound services", err)
			}
			for file, original := range retained {
				current, e := os.ReadFile(file)
				if e != nil || !bytes.Equal(original, current) {
					t.Fatal("failed member persistence changed its retained snapshot", e)
				}
			}
			if failure == "mailbox-replacement" {
				current, e := os.ReadFile(mailboxFile)
				if e != nil || !bytes.Equal(originalMailbox, current) {
					t.Fatal("failed mailbox persistence changed its preceding snapshot", e)
				}
			}
		})
	}
}
