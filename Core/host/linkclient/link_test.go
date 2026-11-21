// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestIndependentLinkProcessHelper; installedHelper; TestStreamsArgumentsAndNonzeroExit; readyWriter; Write; TestCancelOnlyOwnChildAndWaitForExit; TestDiscoveryNeverFallsBackToEmbeddedLink
// Impact: python -B scripts/code-atlas.py show Core/host/linkclient/link_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package linkclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/internal/osowner"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestIndependentLinkProcessHelper(t *testing.T) {
	if os.Getenv("AIEYRA_LINK_PROCESS_HELPER") != "1" {
		return
	}
	owner, err := net.Dial("tcp", "127.0.0.1:"+os.Getenv("AIEYRA_OS_OWNER_PORT"))
	if err != nil {
		os.Exit(81)
	}
	fmt.Fprintln(owner, os.Getenv("AIEYRA_OS_OWNER_TOKEN"))
	ack, err := bufio.NewReader(owner).ReadString('\n')
	if err != nil || ack != osowner.Ack {
		os.Exit(82)
	}
	lost := make(chan struct{})
	go func() { io.Copy(io.Discard, owner); close(lost) }()
	args := os.Args[3:]
	if len(args) > 0 && args[0] == "wait" {
		fmt.Fprintln(os.Stdout, "READY")
		input := make(chan string, 1)
		go func() { line, _ := bufio.NewReader(os.Stdin).ReadString('\n'); input <- line }()
		select {
		case line := <-input:
			fmt.Fprint(os.Stdout, line)
		case <-lost:
		}
		os.Exit(0)
	}
	input, _ := io.ReadAll(os.Stdin)
	json.NewEncoder(os.Stdout).Encode(struct {
		Args  []string `json:"args"`
		Input string   `json:"input"`
	}{args, string(input)})
	fmt.Fprint(os.Stderr, "independent diagnostic\n")
	if len(args) > 0 && args[0] == "exit37" {
		os.Exit(37)
	}
	os.Exit(0)
}

func installedHelper(t *testing.T) string {
	t.Helper()
	product := filepath.Join(t.TempDir(), "独立 Link 带空格")
	name := "aieyra-link"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(product, "Link", "app", "runtime", "link", name)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AIEYRA_ROOT", product)
	t.Setenv("AIEYRA_LINK_ROOT", filepath.Join(product, "ignored-external"))
	t.Setenv("AIEYRA_LINK_PROCESS_HELPER", "1")
	return path
}

func TestStreamsArgumentsAndNonzeroExit(t *testing.T) {
	executable := installedHelper(t)
	if found, err := Discover(); err != nil || found != executable {
		t.Fatalf("discovery %q %v", found, err)
	}
	for _, first := range []string{"normal", "exit37"} {
		var out, diagnostic bytes.Buffer
		args := []string{"-test.run=^TestIndependentLinkProcessHelper$", "--", first, "空 格", "--literal=$()", ""}
		err := Run(context.Background(), args, strings.NewReader("中文\nsecond\x00line"), &out, &diagnostic)
		if first == "normal" && err != nil {
			t.Fatal(err)
		}
		if first == "exit37" {
			if code, child := ExitCode(err); !child || code != 37 {
				t.Fatalf("exit not preserved: %d %v %v", code, child, err)
			}
		}
		var got struct {
			Args  []string
			Input string
		}
		if err := json.Unmarshal(out.Bytes(), &got); err != nil {
			t.Fatal(err, out.String())
		}
		want, _ := json.Marshal(args[2:])
		actual, _ := json.Marshal(got.Args)
		if string(actual) != string(want) || got.Input != "中文\nsecond\x00line" || diagnostic.String() != "independent diagnostic\n" {
			t.Fatalf("stream/args mismatch: %#v %q", got, diagnostic.String())
		}
	}
}

type readyWriter struct {
	once   sync.Once
	ready  chan struct{}
	buffer bytes.Buffer
}

func (w *readyWriter) Write(p []byte) (int, error) {
	if bytes.Contains(p, []byte("READY")) {
		w.once.Do(func() { close(w.ready) })
	}
	return w.buffer.Write(p)
}

func TestCancelOnlyOwnChildAndWaitForExit(t *testing.T) {
	executable := installedHelper(t)
	args := []string{"-test.run=^TestIndependentLinkProcessHelper$", "--", "wait"}
	port, token, release, err := osowner.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	peer := exec.Command(executable, args...)
	peer.Env = osowner.Environment(os.Environ(), port, token)
	peerIn, err := peer.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	peerOut, err := peer.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	prepare(peer)
	if err := peer.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { peerIn.Close(); release(); peer.Wait() }()
	reader := bufio.NewReader(peerOut)
	if line, err := reader.ReadString('\n'); err != nil || line != "READY\n" {
		t.Fatalf("peer startup: %q %v", line, err)
	}
	input, inputWriter, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer inputWriter.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := &readyWriter{ready: make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- Run(ctx, args, input, out, io.Discard) }()
	select {
	case <-out.ready:
	case <-time.After(10 * time.Second):
		t.Fatal("child not ready")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancel unexpectedly succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("own child exit not confirmed")
	}
	if _, err := io.WriteString(peerIn, "peer survives\n"); err != nil {
		t.Fatal(err)
	}
	peerIn.Close()
	if line, err := reader.ReadString('\n'); err != nil || line != "peer survives\n" {
		t.Fatalf("peer was affected: %q %v", line, err)
	}
	if err := peer.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestDiscoveryNeverFallsBackToEmbeddedLink(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "OS")
	name := "aieyra-link"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	old := filepath.Join(root, "build", "link", "windows-x64", name)
	os.MkdirAll(filepath.Dir(old), 0700)
	os.WriteFile(old, []byte("old"), 0700)
	if _, err := discover(root, "", ""); err == nil {
		t.Fatal("embedded Link accepted")
	}
	product := filepath.Join(base, "Aieyra Link")
	os.MkdirAll(product, 0700)
	path := filepath.Join(product, name)
	os.WriteFile(path, []byte("product"), 0700)
	if _, err := discover(root, product, base); err == nil {
		t.Fatal("external Link accepted")
	}
	if _, err := discover(root, filepath.Join(base, "explicit-missing"), ""); err == nil {
		t.Fatal("explicit missing selection fell back")
	}
}
