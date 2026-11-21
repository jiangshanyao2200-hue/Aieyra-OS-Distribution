// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProfileOwnershipRefcountsAndMigrationBarrier; TestProfileOwnersIncludeNodeAndReleaseAfterExit
// Impact: python -B scripts/code-atlas.py show Contracts/storage/ownership_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestProfileOwnershipRefcountsAndMigrationBarrier(t *testing.T) {
	config := profileFixture(t)
	p, err := Bind(config)
	if err != nil {
		t.Fatal(err)
	}
	a, err := Enter(config)
	if err != nil {
		t.Fatal(err)
	}
	defer a()
	b, err := Enter(config)
	if err != nil {
		t.Fatal(err)
	}
	defer b()
	owners, err := Owners(p.Root)
	if err != nil || len(owners) != 1 || owners[0].PID != os.Getpid() {
		t.Fatal(owners, err)
	}
	a()
	owners, err = Owners(p.Root)
	if err != nil || len(owners) != 1 {
		t.Fatal("released another owner", owners, err)
	}
	barrier := filepath.Join(p.Root, MigrationBarrier)
	if err = os.WriteFile(barrier, []byte("initial publication"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Enter(config); err == nil {
		t.Fatal("cached binding bypassed migration barrier")
	}
	b()
	owners, err = Owners(p.Root)
	if err != nil || len(owners) != 0 {
		t.Fatal("owner was not drained", owners, err)
	}
	if err = os.Remove(barrier); err != nil {
		t.Fatal(err)
	}
	c, err := Enter(config)
	if err != nil {
		t.Fatal(err)
	}
	c()
}

func TestProfileOwnersIncludeNodeAndReleaseAfterExit(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node unavailable")
	}
	config := profileFixture(t)
	p, err := Bind(config)
	if err != nil {
		t.Fatal(err)
	}
	module, err := filepath.Abs("profile.cjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(node, "-e", `const p=require(process.argv[1]);p.use(process.argv[2]);process.stdout.write('ready\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`, module, config)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stdin.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatal(line, err)
	}
	owners, err := Owners(p.Root)
	if err != nil || len(owners) != 1 || owners[0].PID != cmd.Process.Pid {
		t.Fatal("Node owner was invisible", owners, err)
	}
	_ = stdin.Close()
	if err = cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	owners, err = Owners(p.Root)
	if err != nil || len(owners) != 0 {
		t.Fatal("exited Node retained ownership", owners, err)
	}
}
