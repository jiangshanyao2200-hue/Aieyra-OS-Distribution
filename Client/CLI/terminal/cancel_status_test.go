// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestCancellationNoticeFollowsConfirmedCoreState
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/cancel_status_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"strings"
	"testing"
)

func TestCancellationNoticeFollowsConfirmedCoreState(t *testing.T) {
	m := testModel()
	m.snapshot.Busy = true
	m.taskGeneration = 3
	m.completeAction(actionMsg{epoch: m.epoch, kind: "cancel"})
	confirmed := pollMsg{epoch: m.epoch, version: m.actionVersion, data: snapshot{Roles: []role{{Role: "matrix", Generation: 3, State: "cancelled"}}}}
	// A pre-ack poll cannot clear the pending notice.
	stale := confirmed
	stale.version--
	m.Update(stale)
	if m.notice != cancelPendingNotice {
		t.Fatal("stale snapshot cleared pending cancellation")
	}
	running := confirmed
	running.data.Busy = true
	running.data.Roles = []role{{Role: "matrix", Generation: 3, State: "running"}}
	m.Update(running)
	if m.notice != cancelPendingNotice {
		t.Fatal("cancellation acknowledged before the core settled")
	}
	m.Update(confirmed)
	if m.notice != "" || strings.Contains(m.View(), cancelPendingNotice) {
		t.Fatal("confirmed cancellation still shows a pending notice")
	}
	m.notice = "independent error"
	m.Update(confirmed)
	if m.notice != "independent error" {
		t.Fatal("terminal snapshot erased an unrelated notice")
	}
}
