// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceParentLeaseOwnershipAndClosure
// Impact: python -B scripts/code-atlas.py show Core/host/workspace_lease_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"testing"
	"time"
)

func TestWorkspaceParentLeaseOwnershipAndClosure(t *testing.T) {
	port, token, closeLease, err := workspaceParentLease()
	if err != nil {
		t.Fatal(err)
	}
	defer closeLease()
	address := fmt.Sprintf("127.0.0.1:%d", port)
	bad, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer bad.Close()
	_, _ = bad.Write([]byte("wrong\n"))
	_ = bad.SetReadDeadline(time.Now().Add(time.Second))
	if _, err = bad.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("bad proof: %v", err)
	}
	peers := make([]net.Conn, 2)
	for i := range peers {
		peers[i], err = net.Dial("tcp", address)
		if err != nil {
			t.Fatal(err)
		}
		defer peers[i].Close()
		_, _ = peers[i].Write([]byte(token + "\n"))
		_ = peers[i].SetReadDeadline(time.Now().Add(time.Second))
		ack, err := bufio.NewReader(peers[i]).ReadString('\n')
		if err != nil || ack != "aieyra-os-owner/1\n" {
			t.Fatalf("peer %d: %q %v", i, ack, err)
		}
	}
	closeLease()
	closeLease()
	for i, peer := range peers {
		if _, err = peer.Read(make([]byte, 1)); err != io.EOF {
			t.Fatalf("peer %d survived: %v", i, err)
		}
	}
}
