// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workboxDocument; workboxStore; workflowHash; workflowNow; workflowStore; validWorkflowID; lock; runnerLease; recordFile; validateIdentity; read; validateDocument; write; update
// Impact: python -B scripts/code-atlas.py show Core/workbox_store.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

type workboxDocument struct {
	Instance workbox.Instance  `json:"instance"`
	Requests map[string]string `json:"requests"`
	Creation string            `json:"creation"`
	Workdir  string            `json:"workdir"`
}
type workboxStore struct{ dir string }

func workflowHash(value string) string {
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}
func workflowNow() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (m *AgentManager) workflowStore(owner, id string) (workboxStore, error) {
	if owner == "" || !validWorkflowID(id) {
		return workboxStore{}, fmt.Errorf("invalid workflow identity")
	}
	return workboxStore{filepath.Join(PrivatePaths(m.config).Workflows, workflowHash(owner), id)}, nil
}
func validWorkflowID(id string) bool {
	if len(id) != 34 || id[:2] != "w-" {
		return false
	}
	_, e := hex.DecodeString(id[2:])
	return e == nil
}

// A kernel lease survives neither crashes nor process exits. Lock files stay
// in place, so another process cannot lock a replacement inode.
func (s workboxStore) lock(name string) (*os.File, error) {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(s.dir, name+".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lockImageBatch(f); err != nil {
		f.Close()
		return nil, fmt.Errorf("workflow %s is busy", name)
	}
	return f, nil
}

// Terminal state can become visible just before the former runner drains its
// shell and releases the lease. Allow that short drain, never steal an active
// runner's lease or mark its in-flight work interrupted.
func (s workboxStore) runnerLease(ctx context.Context) (*os.File, error) {
	deadline := time.Now().Add(2 * time.Second)
	for {
		f, err := s.lock("runner")
		if err == nil {
			return f, nil
		}
		d, e := s.read()
		if e != nil {
			return nil, e
		}
		if d.Instance.State == "running" || d.Instance.State == "pause_requested" || d.Instance.State == "cancel_requested" || time.Now().After(deadline) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}
func (s workboxStore) recordFile() sessionservice.RecordFile {
	return sessionservice.RecordFile{Directory: s.dir, Name: "state.json", MaxBytes: 16 << 20}
}
func (s workboxStore) validateIdentity(schema, id, owner string) error {
	if schema != workbox.StateSchema || !validWorkflowID(id) || owner == "" || filepath.Base(s.dir) != id || filepath.Base(filepath.Dir(s.dir)) != workflowHash(owner) {
		return fmt.Errorf("workflow snapshot identity is damaged; original retained")
	}
	return nil
}
func (s workboxStore) read() (workboxDocument, error) {
	return sessionservice.ReadRecord(s.recordFile(), s.validateDocument)
}
func (s workboxStore) validateDocument(d workboxDocument) error {
	if err := s.validateIdentity(d.Instance.Schema, d.Instance.ID, d.Instance.Owner); err != nil {
		return err
	}
	if d.Requests == nil || d.Creation == "" || !filepath.IsAbs(d.Workdir) {
		return fmt.Errorf("workflow snapshot is damaged; original retained")
	}
	if err := d.Instance.Definition.Validate(); err != nil {
		return err
	}
	if len(d.Instance.Steps) != len(d.Instance.Definition.Steps) || d.Instance.Owner == "" {
		return fmt.Errorf("workflow step snapshot is damaged")
	}
	for n, s := range d.Instance.Steps {
		if s.ID != d.Instance.Definition.Steps[n].ID {
			return fmt.Errorf("workflow step identity is damaged")
		}
	}
	for alias := range d.Instance.Definition.Tools {
		if d.Instance.Tools[alias].Identity == "" {
			return fmt.Errorf("workflow dependency lock is missing")
		}
	}

	return nil
}
func (s workboxStore) write(d workboxDocument) error {
	return sessionservice.WriteRecord(s.recordFile(), d, s.validateDocument)
}
func (s workboxStore) update(ctx context.Context, fn func(*workboxDocument) error) (workbox.Instance, error) {
	var lock *os.File
	var err error
	deadline := time.Now().Add(time.Second)
	for {
		lock, err = s.lock("state")
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			return workbox.Instance{}, err
		}
		select {
		case <-ctx.Done():
			return workbox.Instance{}, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	defer lock.Close()
	d, err := s.read()
	if err != nil {
		return workbox.Instance{}, err
	}
	if err = fn(&d); err != nil {
		return d.Instance, err
	}
	if err = s.write(d); err != nil {
		return d.Instance, err
	}
	return d.Instance, nil
}
