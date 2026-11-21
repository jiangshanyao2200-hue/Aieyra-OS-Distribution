package websearch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// This real child process exercises the host injection seam without networking.
func TestLocalHelperProcess(t *testing.T) {
	if len(os.Args) < 2 || !strings.HasPrefix(os.Args[len(os.Args)-1], "search-helper-") {
		return
	}
	mode := strings.TrimPrefix(os.Args[len(os.Args)-1], "search-helper-")
	if os.Getenv("SEARCH_PRIVATE_KEY") != "" || os.Getenv("PYTHONPATH") != "" {
		os.Exit(4)
	}
	var input map[string]string
	if json.NewDecoder(os.Stdin).Decode(&input) != nil || input["query"] != "q" {
		os.Exit(5)
	}
	switch mode {
	case "overflow":
		fmt.Print(strings.Repeat("x", 130<<10))
	case "wait":
		time.Sleep(30 * time.Second)
	default:
		fmt.Print(`{"results":[{"title":"source","url":"https://example.invalid/a%2Fb?q=a%20b#exact"},{"url":"https://example.invalid/a%2Fb?q=a%20b#exact"},{"url":"javascript:alert(1)"}]}`)
	}
	os.Exit(0)
}

func TestLocalProcessBoundariesAndCancellation(t *testing.T) {
	t.Setenv("SEARCH_PRIVATE_KEY", "fixture-secret")
	t.Setenv("PYTHONPATH", "untrusted-startup")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	options := func(mode string) LocalOptions {
		return LocalOptions{Python: exe, Configure: func(cmd *exec.Cmd) {
			cmd.Args = []string{exe, "-test.run=^TestLocalHelperProcess$", "search-helper-" + mode}
			cmd.Env = []string{"SEARCH_PRIVATE_KEY=must-be-removed"}
		}}
	}
	r, err := Local(context.Background(), "q", options("valid"))
	if err != nil || len(r.Searches) != 1 || len(r.Searches[0].Results) != 1 || r.Searches[0].Results[0].URL != "https://example.invalid/a%2Fb?q=a%20b#exact" {
		t.Fatal(r, err)
	}
	if _, err := Local(context.Background(), "q", options("overflow")); err == nil {
		t.Fatal("oversized output accepted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	if _, err := Local(ctx, "q", options("wait")); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("process cancellation", err)
	}
	r, err = Local(context.Background(), "q", options("valid"))
	if err != nil || len(r.Searches) != 1 {
		t.Fatal("slot not released", err)
	}
}
