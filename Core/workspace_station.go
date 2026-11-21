// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceStationScript; stationProfile; stationPython; stationOutput; Write; stationErrorCode; workspaceStation; splitStationBoundary; splitStationRun; splitStationBoundaryLocked; splitStationData
// Impact: python -B scripts/code-atlas.py show Core/workspace_station.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

//go:embed workspace_station.py
var workspaceStationScript string

// All credentials, enrollment intents and private readbacks belong to this
// runtime's persistent profile, outside the ephemeral conversation directory.
func (w *Workspace) stationProfile() (string, error) {
	config, err := filepath.Abs(w.config)
	if err != nil {
		return "", err
	}
	return filepath.Join(PrivatePaths(config).Stations, w.state.ID+".json"), nil
}

func stationPython(directory string) (string, error) {
	if explicit := os.Getenv("AIEYRA_CONTROL_PYTHON"); explicit != "" {
		if !filepath.IsAbs(explicit) {
			return "", fmt.Errorf("station_python_path_invalid")
		}
		if info, err := os.Stat(explicit); err != nil || !info.Mode().IsRegular() {
			return "", fmt.Errorf("station_python_missing")
		}
		return explicit, nil
	}
	for _, name := range []string{"runtime/python/python.exe", "runtime/python/bin/python3"} {
		candidate := filepath.Join(directory, name)
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	for _, name := range []string{"python3", "python"} {
		if file, err := exec.LookPath(name); err == nil {
			return file, nil
		}
	}
	return "", fmt.Errorf("station_python_missing")
}

type stationOutput struct {
	bytes.Buffer
	overflow bool
}

func (b *stationOutput) Write(p []byte) (int, error) {
	n := len(p)
	if remaining := (64 << 10) - b.Len(); len(p) > remaining {
		b.overflow = true
		p = p[:remaining]
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

var stationErrorCode = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,99}$`)

func workspaceStation(ctx context.Context, w *Workspace, action string) (workspaceMembership, error) {
	member := workspaceMembership{State: "offline", Project: "os", NativeID: w.state.ID, Stale: true}
	if w.service == nil {
		return member, fmt.Errorf("station_service_unavailable")
	}
	discovery, err := w.service.CallTool(ctx, "apps", w.state.ID, json.RawMessage(`{"action":"status","app_id":"aieyra.control"}`))
	if err != nil {
		return member, fmt.Errorf("station_discovery_failed")
	}
	var app struct {
		Installed bool   `json:"installed"`
		Directory string `json:"directory"`
	}
	if json.Unmarshal(discovery, &app) != nil || !app.Installed || !filepath.IsAbs(app.Directory) {
		return member, fmt.Errorf("station_control_missing")
	}
	python, err := stationPython(app.Directory)
	if err != nil {
		return member, err
	}
	profile, err := w.stationProfile()
	if err != nil {
		return member, fmt.Errorf("station_private_directory_unavailable")
	}
	w.mu.Lock()
	workdir := w.state.Workdir
	w.mu.Unlock()
	states := map[string]int{}
	for _, r := range w.manager.List(w.state.ID) {
		states[r.State]++
	}
	input := rawJSON(map[string]any{"directory": app.Directory, "profile": profile, "native": w.state.ID, "root": workdir, "action": action, "states": states})
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, python, "-X", "utf8", "-c", workspaceStationScript)
	hideSettingsProcess(cmd)
	cmd.Stdin = bytes.NewReader(input)
	var output stationOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard // Adapter exceptions may contain private paths or bodies.
	cmd.WaitDelay = 2 * time.Second
	if err = cmd.Run(); err != nil {
		return member, fmt.Errorf("station_adapter_unconfirmed")
	}
	var result struct {
		Membership workspaceMembership `json:"membership"`
		Error      string              `json:"error"`
	}
	if output.overflow || json.Unmarshal(output.Bytes(), &result) != nil {
		return member, fmt.Errorf("station_adapter_response_invalid")
	}
	if result.Error != "" {
		if !stationErrorCode.MatchString(result.Error) {
			result.Error = "station_adapter_failed"
		}
		return member, fmt.Errorf("%s", result.Error)
	}
	member = result.Membership
	if member.Project != "os" || member.NativeID != w.state.ID {
		return workspaceMembership{}, fmt.Errorf("station_identity_mismatch")
	}
	if member.State == "connected" && (member.ActorID == "" || member.SeatID == "" || member.TransportID == "" || member.Stale) {
		return workspaceMembership{}, fmt.Errorf("station_identity_unconfirmed")
	}
	if !stationErrorCode.MatchString(member.Error) {
		member.Error = ""
	}
	return member, nil
}

// Called at actual request boundaries, never from a renderer poll or a timer.
// The profile and transport are reused; failure does not start a second task.
func (w *Workspace) splitStationBoundary(ctx context.Context, action string) error {
	if w.split == nil {
		return nil
	}
	s := w.split
	s.op.Lock()
	defer s.op.Unlock()
	return w.splitStationBoundaryLocked(ctx, action)
}

// All roles and supervised helpers share the runtime's membership. Serialize
// the count and transport transition so one completion cannot idle another run.
func (w *Workspace) splitStationRun(ctx context.Context, start bool) error {
	if w.split == nil {
		return nil
	}
	s := w.split
	s.op.Lock()
	defer s.op.Unlock()
	if start {
		if err := w.splitStationBoundaryLocked(ctx, "working"); err != nil {
			return err
		}
		// Close and update-freeze take workspace.mu before split.mu. Commit
		// the worker count under the same order so a late start cannot pass them.
		w.mu.Lock()
		defer w.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return err
		}
		if w.closed || w.updateFrozen {
			return fmt.Errorf("task is closed or frozen")
		}
		s.mu.Lock()
		s.Running++
		s.mu.Unlock()
		return nil
	}
	s.mu.Lock()
	if s.Running == 0 {
		s.mu.Unlock()
		return fmt.Errorf("station_run_not_started")
	}
	s.Running--
	running := s.Running
	s.mu.Unlock()
	w.mu.Lock()
	closed := w.closed
	w.mu.Unlock()
	if closed {
		return nil // Close joins every worker before the final finish boundary.
	}
	action := "idle"
	if running > 0 {
		action = "working"
	}
	return w.splitStationBoundaryLocked(ctx, action)
}

// Requires split.op, never workspace.mu. Adapter calls may read the workspace.
func (w *Workspace) splitStationBoundaryLocked(ctx context.Context, action string) error {
	s := w.split
	if err := ctx.Err(); err != nil {
		return err
	}
	w.mu.Lock()
	closed, frozen := w.closed, w.updateFrozen
	w.mu.Unlock()
	if (closed || frozen) && action != "finish" {
		return fmt.Errorf("task is closed or frozen")
	}
	adapter := w.host.stationAdapter
	if adapter == nil {
		adapter = workspaceStation
	}
	member, err := adapter(ctx, w, action)
	s.mu.Lock()
	previous := s.Membership
	s.mu.Unlock()
	if err == nil && action != "finish" {
		at, dateErr := time.Parse(time.RFC3339Nano, member.ObservedAt)
		if member.State != "connected" || member.Stale || member.NativeID != s.ID || member.Project != "os" || member.ActorID == "" || member.SeatID == "" || member.TransportID == "" || dateErr != nil || time.Since(at) > 45*time.Second || time.Until(at) > 5*time.Second {
			err = fmt.Errorf("station_membership_unconfirmed")
		} else if previous.ActorID != "" && (member.ActorID != previous.ActorID || member.SeatID != previous.SeatID) {
			err = fmt.Errorf("station_identity_changed")
		}
	}
	if err == nil {
		err = ctx.Err()
	}
	w.mu.Lock()
	closed, frozen = w.closed, w.updateFrozen
	if err == nil && (closed || frozen) && action != "finish" {
		err = fmt.Errorf("task is closed or frozen")
	}
	if err != nil {
		// Preserve the last confirmed identity while marking its connection unknown.
		member = previous
		member.State, member.Project, member.NativeID = "offline", "os", s.ID
		member.Error, member.Stale = "station_boundary_unconfirmed", true
	}
	s.mu.Lock()
	s.Membership = member
	s.mu.Unlock()
	w.mu.Unlock()
	if err != nil {
		return err
	}
	return nil
}

func (w *Workspace) splitStationData() string {
	if w.split == nil {
		return ""
	}
	profile, err := w.stationProfile()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(strings.TrimSuffix(profile, ".json") + ".state/os-recovery.json")
	if err != nil || len(data) > 128<<10 {
		return ""
	}
	return string(data)
}
