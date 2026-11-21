// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: collectDelivery; containedArtifact; collectAgentDelivery; reviewReceipt; ReviewWithChecks
// Impact: python -B scripts/code-atlas.py show Core/matrix_contract.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

func (m *AgentManager) collectDelivery(spec AgentSpec, generation int) *AgentDelivery {
	spec.Workdir = storage.Relocate(m.config, spec.Workdir)
	return collectAgentDelivery(spec, generation)
}

func containedArtifact(root, relative string) (string, error) {
	base, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(base, filepath.FromSlash(relative)))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(base, resolved)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("artifact resolves outside workdir")
	}
	return resolved, nil
}

func collectAgentDelivery(spec AgentSpec, generation int) *AgentDelivery {
	if spec.Contract == nil {
		return nil
	}
	delivery := &AgentDelivery{Generation: generation, Artifacts: []AgentArtifact{}}
	var total int64
	for _, relative := range spec.Contract.Deliverables {
		artifact := AgentArtifact{Path: relative}
		func() {
			resolved, err := containedArtifact(spec.Workdir, relative)
			if err != nil {
				artifact.Error = "file missing or outside workdir"
				return
			}
			f, err := os.Open(resolved)
			if err != nil {
				artifact.Error = "file cannot be read"
				return
			}
			defer f.Close()
			before, err := f.Stat()
			if err != nil || !before.Mode().IsRegular() {
				artifact.Error = "deliverable must be a regular file"
				return
			}
			if before.Size() > 64<<20 || total+before.Size() > 256<<20 {
				artifact.Error = "artifact exceeds hashing budget (64 MiB/file,256 MiB/delivery)"
				return
			}
			h := sha256.New()
			n, err := io.Copy(h, io.LimitReader(f, (64<<20)+1))
			total += n
			after, statErr := f.Stat()
			current, pathErr := os.Stat(resolved)
			finalPath, resolveErr := containedArtifact(spec.Workdir, relative)
			if err != nil || statErr != nil || pathErr != nil || resolveErr != nil || finalPath != resolved || !os.SameFile(before, current) || before.Size() != n || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
				artifact.Error = "artifact changed while collecting delivery"
				return
			}
			artifact.Bytes, artifact.SHA256 = n, hex.EncodeToString(h.Sum(nil))
		}()
		delivery.Artifacts = append(delivery.Artifacts, artifact)
	}
	delivery.CapturedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return delivery
}

func (m *AgentManager) reviewReceipt(owner, target string, ref AgentReceiptRef, delivered time.Time) error {
	source := ref.AgentID
	if source == "" {
		source = owner
	}
	if ref.SessionID < 1 {
		return fmt.Errorf("verification requires a real shell session_id")
	}
	m.mu.Lock()
	allowed := source == owner || m.ownsLocked(owner, source)
	self := source == target || m.ownsLocked(target, source)
	m.mu.Unlock()
	if !allowed || self {
		return fmt.Errorf("verification must belong to the parent or an independent owned reviewer")
	}
	dir := filepath.Join(m.dir, source+".shell")
	if source == m.owner {
		p, err := SessionPath(m.config, source)
		if err != nil {
			return err
		}
		dir = strings.TrimSuffix(p, filepath.Ext(p)) + ".shell"
	}
	data, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("%d.json", ref.SessionID)))
	var r ShellResult
	if err != nil || json.Unmarshal(data, &r) != nil || r.SessionID != ref.SessionID || r.State != "exited" || r.ExitCode == nil || *r.ExitCode != ref.ExpectedExit || r.StartedAt.Before(delivered) || r.Error != nil {
		return fmt.Errorf("verification receipt missing, unfinished, stale or exit differs from expected_exit")
	}
	// Exit status is only an execution fact. Criterion evidence must explain the
	// observed output and why the independently chosen checks prove the contract.
	return nil
}

func (m *AgentManager) ReviewWithChecks(owner, id string, review AgentReview) (AgentRecord, error) {
	if next, actor := m.taskManager(owner, id); next != m {
		return next.ReviewWithChecks(actor, id, review)
	}
	m.mu.Lock()
	if !m.ownsLocked(owner, id) {
		m.mu.Unlock()
		return AgentRecord{}, fmt.Errorf("agent not owned by caller")
	}
	r := copyRecord(m.jobs[id].record)
	m.mu.Unlock()
	if activeAgent(r.State) || review.Verdict != "accepted" && review.Verdict != "rework" || strings.TrimSpace(review.Evidence) == "" || len(review.Evidence) > 8192 || len(review.Checks) > 24 || len(review.RequestID) > 128 {
		return AgentRecord{}, fmt.Errorf("review requires idle agent, verdict and independent evidence")
	}
	if r.Spec.Contract != nil && review.Generation != r.Generation {
		return AgentRecord{}, fmt.Errorf("review generation must match the delivery")
	}
	if review.Generation == 0 {
		review.Generation = r.Generation
	}
	if review.Generation != r.Generation {
		return AgentRecord{}, fmt.Errorf("stale review generation")
	}
	if review.Verdict == "accepted" && r.State != "completed" {
		return AgentRecord{}, fmt.Errorf("unfinished agent cannot be accepted")
	}
	data, _ := json.Marshal(review)
	if len(data) > 64<<10 {
		return AgentRecord{}, fmt.Errorf("review exceeds64 KiB")
	}
	// Deep copy caller-owned slices before validation and persistence.
	var copied AgentReview
	_ = json.Unmarshal(data, &copied)
	review = copied
	if review.RequestID == "" {
		hash := sha256.Sum256(data)
		review.RequestID = "review-" + hex.EncodeToString(hash[:16])
	}
	review.Evidence = m.redact(review.Evidence)
	for i := range review.Checks {
		review.Checks[i].Evidence = m.redact(review.Checks[i].Evidence)
	}
	for _, old := range r.Reviews {
		if old.RequestID == review.RequestID {
			candidate := review
			candidate.Created = old.Created
			if !reflect.DeepEqual(candidate, old) {
				return AgentRecord{}, fmt.Errorf("review request_id conflict")
			}
			return r, nil
		}
	}
	if len(r.Reviews) >= 128 {
		return AgentRecord{}, fmt.Errorf("review history limit reached")
	}
	seen := map[int]bool{}
	for _, check := range review.Checks {
		if r.Spec.Contract == nil || check.Criterion < 0 || check.Criterion >= len(r.Spec.Contract.Acceptance) || seen[check.Criterion] || strings.TrimSpace(check.Evidence) == "" || len(check.Evidence) > 4096 || len(check.Receipts) > 8 || check.Verdict != "passed" && check.Verdict != "failed" && check.Verdict != "unknown" {
			return AgentRecord{}, fmt.Errorf("invalid or duplicate criterion check")
		}
		seen[check.Criterion] = true
	}
	if r.Spec.Contract != nil && review.Verdict == "accepted" {
		if r.Delivery == nil || r.Delivery.Generation != r.Generation || len(review.Checks) != len(r.Spec.Contract.Acceptance) {
			return AgentRecord{}, fmt.Errorf("acceptance requires delivery and a check for every original criterion")
		}
		delivered, err := time.Parse(time.RFC3339Nano, r.Delivery.CapturedAt)
		if err != nil {
			return AgentRecord{}, fmt.Errorf("invalid delivery timestamp")
		}
		for _, check := range review.Checks {
			if check.Verdict != "passed" || len(check.Receipts) == 0 {
				return AgentRecord{}, fmt.Errorf("each accepted criterion requires passed verdict, explanation and independent execution receipts")
			}
			for _, receipt := range check.Receipts {
				if err := m.reviewReceipt(owner, id, receipt, delivered); err != nil {
					return AgentRecord{}, err
				}
			}
		}
		current := m.collectDelivery(r.Spec, r.Generation)
		if !reflect.DeepEqual(current.Artifacts, r.Delivery.Artifacts) {
			return AgentRecord{}, fmt.Errorf("artifacts changed since delivery; request a new delivery before acceptance")
		}
		for _, artifact := range current.Artifacts {
			if artifact.Error != "" || artifact.SHA256 == "" {
				return AgentRecord{}, fmt.Errorf("required deliverable unavailable: %s", artifact.Path)
			}
		}
	}
	review.Created = time.Now().UTC().Format(time.RFC3339Nano)
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j.record.Generation != r.Generation || activeAgent(j.record.State) || j.record.Updated != r.Updated {
		return AgentRecord{}, fmt.Errorf("task changed during review; reload status")
	}
	old := copyRecord(j.record)
	j.record.Acceptance, j.record.Evidence = review.Verdict, review.Evidence
	j.record.Reviews = append(j.record.Reviews, review)
	if err := m.saveLocked(j); err != nil {
		j.record = old
		return AgentRecord{}, err
	}
	return copyRecord(j.record), nil
}
