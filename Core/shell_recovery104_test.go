// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: shell104Poll; shell104Command; shell104Payload; TestShell104Helper; shell104WriteRecord; shell104AssertPages; TestShell104RecoverExistingLog; TestShell104RecoveryLogBoundaries; TestShell104ActualHostCrashLogRecovery
// Impact: python -B scripts/code-atlas.py show Core/shell_recovery104_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func shell104Poll(t *testing.T, label string, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatal("bounded helper handshake timed out:", label)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func shell104Command(t *testing.T, mode, dir string) ShellCommand {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
	if runtime.GOOS == "windows" {
		quote = func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	}
	command := quote(exe) + " '-test.run=^TestShell104Helper$' -- " + quote(dir)
	if runtime.GOOS == "windows" {
		command = "& " + command + "; exit $LASTEXITCODE"
	}
	return ShellCommand{Cmd: command, Env: map[string]string{"AIEYRA_TEST104_MODE": mode}}
}

func shell104Payload() string {
	return "C02-BEGIN\n" + strings.Repeat("已落盘 中文🙂 output\n", 4200) + "C02-END\n"
}

// A separate, test-owned host is killed without Close. Its native shell job
// and the test helper never touch a real profile, database or user process.
func TestShell104Helper(t *testing.T) {
	mode := os.Getenv("AIEYRA_TEST104_MODE")
	if mode == "" {
		return
	}
	dir := os.Args[len(os.Args)-1]
	if mode == "crash-host" {
		m, err := NewShellManager(dir, filepath.Join(dir, "logs"))
		if err != nil {
			t.Fatal(err)
		}
		zero := 0
		req := shell104Command(t, "log", dir)
		req.YieldTimeMS = &zero
		r := m.start(context.Background(), req)
		if !r.OK || r.SessionID == 0 {
			t.Fatal(r)
		}
		shell104Poll(t, "full output on disk", func() bool {
			data, _ := os.ReadFile(r.OutputRef)
			_, ready := os.Stat(filepath.Join(dir, "ready.json"))
			return ready == nil && bytes.HasSuffix(data, []byte("C02-END\n"))
		})
		data, _ := json.Marshal(r.SessionID)
		if err = os.WriteFile(filepath.Join(dir, "host-ready.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
		time.Sleep(25 * time.Second)
		os.Exit(94)
	}
	if mode != "heartbeat" && mode != "log" {
		os.Exit(95)
	}
	if mode == "log" {
		effect, err := os.OpenFile(filepath.Join(dir, "effect.txt"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err != nil {
			os.Exit(96)
		}
		_, err = effect.WriteString("once\n")
		closeErr := effect.Close()
		if err != nil || closeErr != nil {
			os.Exit(96)
		}
		fmt.Print(shell104Payload())
	}
	data, _ := json.Marshal(os.Getpid())
	if err := os.WriteFile(filepath.Join(dir, "ready.json"), data, 0600); err != nil {
		os.Exit(97)
	}
	f, err := os.OpenFile(filepath.Join(dir, "heartbeat"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		os.Exit(98)
	}
	defer f.Close()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if _, err = f.Write([]byte("x")); err != nil {
			os.Exit(99)
		}
		time.Sleep(20 * time.Millisecond)
	}
	os.Exit(0)
}

func shell104WriteRecord(t *testing.T, dir string, r ShellResult, log []byte) {
	t.Helper()
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.json", r.SessionID)), data, 0600); err != nil {
		t.Fatal(err)
	}
	if log != nil {
		if err = os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.log", r.SessionID)), log, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func shell104AssertPages(t *testing.T, m *ShellManager, id int, want string, terminal bool) {
	t.Helper()
	var got strings.Builder
	var offset int64
	for offset < int64(len(want)) {
		var r ShellResult
		if terminal {
			r = m.job(id).terminalRead(offset)
			got.WriteString(r.TerminalOutput)
		} else {
			r = m.Execute(context.Background(), executionCall("terminal", map[string]any{"action": "read", "session_id": id, "offset": offset, "max_output_tokens": 97}))
			got.WriteString(r.Output)
		}
		if r.State != "interrupted_unknown" || r.ExitCode != nil || r.Error == nil || r.Error.Code != "interrupted_unknown" {
			t.Fatalf("reading stored bytes must preserve unknown execution outcome: %+v", r)
		}
		if r.NextOffset <= offset || r.NextOffset > int64(len(want)) || !utf8.ValidString(r.Output+r.TerminalOutput) {
			t.Fatalf("invalid UTF-8/page progress offset=%d: %+v", offset, r)
		}
		offset = r.NextOffset
	}
	if got.String() != want {
		t.Fatalf("stored bytes lost or duplicated: got %d bytes, want %d", got.Len(), len(want))
	}
}

func TestShell104RecoverExistingLog(t *testing.T) {
	for i, state := range []string{"starting", "running", "cancelled", "timed_out", "interrupted_unknown"} {
		t.Run(state, func(t *testing.T) {
			dir := t.TempDir()
			want := shell104Payload()
			record := ShellResult{OK: true, SessionID: 104, State: state, TTY: true, LoggedBytes: int64(i * 7), OutputBytes: int64(i * 7)}
			if state == "interrupted_unknown" {
				record.OK, record.Error = false, &ShellError{"interrupted_unknown", "previous recovery remained unknown"}
			}
			shell104WriteRecord(t, dir, record, []byte(want))
			if err := os.WriteFile(filepath.Join(dir, "104.tail"), []byte("STALE-TAIL"), 0600); err != nil {
				t.Fatal(err)
			}
			m, err := NewShellManager(dir, dir)
			if err != nil {
				t.Fatal(err)
			}
			defer m.Close()
			r := m.Snapshots()[0]
			t.Logf("metadata bytes=%d; physical log=%d sha256=%x; recovered=%d state=%s", i*7, len(want), sha256.Sum256([]byte(want)), r.LoggedBytes, r.State)
			if r.LoggedBytes != int64(len(want)) || r.OutputBytes < r.LoggedBytes || m.logBytes != int64(len(want)) || !r.LogIncomplete {
				t.Fatalf("recovery ignored physical log bytes/quota/unknown suffix: %+v quota=%d", r, m.logBytes)
			}
			if !strings.HasSuffix(r.Output, "C02-END\n") || strings.Contains(r.Output, "STALE-TAIL") {
				t.Fatal("recovery retained a stale tail instead of saved bytes")
			}
			shell104AssertPages(t, m, 104, want, false)
			shell104AssertPages(t, m, 104, want, true)
		})
	}
}

func TestShell104RecoveryLogBoundaries(t *testing.T) {
	for _, kind := range []string{"missing", "truncated", "directory", "private"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			want := "saved 中文\n"
			r := ShellResult{OK: true, SessionID: 104, State: "running", LoggedBytes: 500, OutputBytes: 500, TTY: true}
			var data []byte
			if kind == "truncated" {
				data = []byte(want)
			}
			if kind == "private" {
				r.PrivateOutput = true
				r.LoggedBytes, r.OutputBytes = int64(len(want)), int64(len(want))
				data = []byte(want + "MUST-NOT-EXPAND-PRIVATE-CAPTURE")
			}
			shell104WriteRecord(t, dir, r, data)
			if kind == "directory" {
				if err := os.Mkdir(filepath.Join(dir, "104.log"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			m, err := NewShellManager(dir, dir)
			if err != nil {
				t.Fatal(err)
			}
			defer m.Close()
			recovered := m.Snapshots()[0]
			if kind == "private" && m.logBytes != int64(len(data)) {
				t.Fatal("physical stored bytes must still count toward quota")
			}
			if recovered.State != "interrupted_unknown" || recovered.ExitCode != nil || !recovered.LogIncomplete {
				t.Fatalf("unknown/gap state was hidden: %+v", recovered)
			}
			if kind == "missing" || kind == "directory" {
				if recovered.LoggedBytes != 0 {
					t.Fatal("unavailable bytes still advertised:", recovered.LoggedBytes)
				}
				got := m.read(ShellRead{SessionID: 104})
				if got.Error == nil || got.Error.Code != "log_unavailable" {
					t.Fatal("missing/nonregular log was presented as readable:", got)
				}
			} else {
				if recovered.LoggedBytes != int64(len(want)) {
					t.Fatalf("readable boundary=%d, want %d", recovered.LoggedBytes, len(want))
				}
				shell104AssertPages(t, m, 104, want, false)
				shell104AssertPages(t, m, 104, want, true)
			}
		})
	}
}

func TestShell104ActualHostCrashLogRecovery(t *testing.T) {
	dir := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestShell104Helper$", "--", dir)
	cmd.Env = append(os.Environ(), "AIEYRA_TEST104_MODE=crash-host")
	configureExecutionProcess(cmd)
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	var child *os.Process
	t.Cleanup(func() {
		if !waited {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
		if child != nil {
			_ = child.Kill()
			_ = child.Release()
		}
	})
	var id int
	shell104Poll(t, "host confirms output before abnormal exit", func() bool {
		data, e := os.ReadFile(filepath.Join(dir, "host-ready.json"))
		return e == nil && json.Unmarshal(data, &id) == nil && id > 0
	})
	childData, err := os.ReadFile(filepath.Join(dir, "ready.json"))
	var childPID int
	if err != nil || json.Unmarshal(childData, &childPID) != nil || childPID <= 0 {
		t.Fatal("native test helper identity unavailable", err)
	}
	child, err = os.FindProcess(childPID)
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	waited = true
	path := filepath.Join(dir, "logs", fmt.Sprintf("%d", id))
	data, err := os.ReadFile(path + ".log")
	if err != nil || string(data) != shell104Payload() {
		t.Fatalf("native output did not reach the saved log: bytes=%d err=%v", len(data), err)
	}
	meta, err := os.ReadFile(path + ".json")
	var before ShellResult
	if err != nil || json.Unmarshal(meta, &before) != nil || before.State != "starting" || before.LoggedBytes != 0 {
		t.Fatalf("fixture accidentally completed/persisted normally: %+v err=%v", before, err)
	}
	t.Logf("killed test host PID=%d session=%d persisted=%d physical=%d sha256=%x", cmd.Process.Pid, id, before.LoggedBytes, len(data), sha256.Sum256(data))
	m, err := NewShellManager(dir, filepath.Join(dir, "logs"))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	shell104AssertPages(t, m, id, string(data), false)
	if snapshots := m.Snapshots(); len(snapshots) != 1 || snapshots[0].SessionID != id || snapshots[0].Pending() {
		t.Fatal("log recovery created or restarted a process:", snapshots)
	}
	if effect, e := os.ReadFile(filepath.Join(dir, "effect.txt")); e != nil || string(effect) != "once\n" {
		t.Fatal("reading recovery replayed a command/side effect:", string(effect), e)
	}
}
