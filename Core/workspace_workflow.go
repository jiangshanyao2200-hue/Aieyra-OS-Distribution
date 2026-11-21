// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workflowContextKey; workflowContext; WorkflowFile; WorkflowCapture; WorkflowEvidence; WorkflowDelivery; WorkflowState; workflowVisible; atomicWorkspaceFile; loadWorkflowLocked; workflowMarkdown; saveWorkflowLocked; workflowUnknown; syncWorkflow; bindPlanTaskBoundary; workflowFiles; workflowValidity; workflowReceiptRef; workflowReceiptKey; workflowReceiptAfter; workflow; workflowBoundary; workflowNotice
// Impact: python -B scripts/code-atlas.py show Core/workspace_workflow.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 工作记录保存可验证事实；计划勾选和模型判断保持单独语义。
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"
)

type workflowContextKey struct{}
type workflowContext struct {
	Plan       *PlanEngine
	Agent      string
	Generation int
}
type WorkflowFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}
type WorkflowCapture struct {
	ID            string         `json:"id"`
	Label         string         `json:"label"`
	At            string         `json:"at"`
	Files         []WorkflowFile `json:"files"`
	PriorReceipts []string       `json:"prior_receipts"`
}
type WorkflowEvidence struct {
	ID         string `json:"id"`
	CaptureID  string `json:"capture_id"`
	Receipt    string `json:"receipt"`
	OutputHash string `json:"output_hash"`
	At         string `json:"at"`
}
type WorkflowDelivery struct {
	Verdict    string   `json:"verdict"`
	Summary    string   `json:"summary"`
	Evidence   []string `json:"evidence"`
	Unresolved []string `json:"unresolved"`
	At         string   `json:"at"`
}
type WorkflowState struct {
	Version        int                `json:"version"`
	Revision       int                `json:"revision"`
	Agent          string             `json:"agent"`
	Generation     int                `json:"generation"`
	Plan           *PlanState         `json:"plan,omitempty"`
	Captures       []WorkflowCapture  `json:"captures"`
	Evidence       []WorkflowEvidence `json:"evidence"`
	Unknown        []string           `json:"unknown"`
	Resolved       map[string]string  `json:"resolved"`
	Reconciliation map[string]string  `json:"reconciliation,omitempty"`
	Delivery       *WorkflowDelivery  `json:"delivery,omitempty"`
}

// Receipt membership is an internal replay guard, not useful model context.
func workflowVisible(s WorkflowState) WorkflowState {
	s.Captures = append([]WorkflowCapture(nil), s.Captures...)
	for i := range s.Captures {
		s.Captures[i].PriorReceipts = nil
	}
	return s
}

func atomicWorkspaceFile(dir, name string, data []byte) error {
	f, err := os.CreateTemp(dir, ".commit-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, name))
}
func (w *Workspace) loadWorkflowLocked() (WorkflowState, error) {
	s := WorkflowState{Version: 1, Resolved: map[string]string{}}
	f, err := os.Open(filepath.Join(w.workflowDirectory(), "workflow.json"))
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (2<<20)+1))
	if err != nil {
		return s, err
	}
	if len(data) > 2<<20 || json.Unmarshal(data, &s) != nil || s.Version != 1 || s.Revision < 0 || len(s.Captures) > 64 || len(s.Evidence) > 128 || s.Resolved == nil {
		return s, fmt.Errorf("工作记录损坏或来自不支持的版本；原文件已保留")
	}
	return s, nil
}
func workflowMarkdown(s WorkflowState) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# 工作执行计划\n\n记录版本：%d；任务代次：%d。\n\n", s.Revision, s.Generation)
	if s.Plan != nil {
		fmt.Fprintf(&b, "## 目标\n\n%s\n\n计划：%s / 修订%d / %s\n\n", s.Plan.Objective, s.Plan.ID, s.Plan.Revision, s.Plan.Status)
		for _, p := range s.Plan.Phases {
			fmt.Fprintf(&b, "### %s\n\n", p.Title)
			for _, step := range p.Steps {
				mark := " "
				if step.Status == PlanCompleted {
					mark = "x"
				}
				fmt.Fprintf(&b, "- [%s] %s — %s（%s）\n", mark, step.Text, step.Status, step.ID)
				if step.Reason != "" {
					fmt.Fprintf(&b, "  原因：%s\n", step.Reason)
				}
				for _, e := range step.Evidence {
					fmt.Fprintf(&b, "  计划所报证据：%s\n", e)
				}
			}
			b.WriteString("\n")
		}
		b.WriteString("## 验收条件\n\n")
		for _, c := range s.Plan.Acceptance {
			fmt.Fprintf(&b, "- %s\n", c)
		}
	}
	b.WriteString(runtimePrompt("Matrix/辅助指令/工作记录验证说明.txt"))
	for _, c := range s.Captures {
		fmt.Fprintf(&b, "- 快照 %s：%s / %s\n", c.ID, c.Label, c.At)
		for _, f := range c.Files {
			fmt.Fprintf(&b, "  - `%s` · `%s` · %d bytes\n", f.Path, f.SHA256, f.Bytes)
		}
	}
	for _, e := range s.Evidence {
		fmt.Fprintf(&b, "- 验证 %s：快照%s / 收据%s / 输出摘要%s\n", e.ID, e.CaptureID, e.Receipt, e.OutputHash)
	}
	for _, key := range s.Unknown {
		if s.Resolved[key] == "" {
			b.WriteString(formatPromptText(runtimePrompt("Matrix/辅助指令/工作记录中断调用.txt"), key))
		} else {
			fmt.Fprintf(&b, "- Agent已说明后续核实：%s → %s；%s。宿主只核验文件和命令收据关联，外部效果以原系统为准。\n", key, s.Resolved[key], s.Reconciliation[key])
		}
	}
	if s.Delivery != nil {
		fmt.Fprintf(&b, "\n## 交付声明\n\n%s：%s\n\n", s.Delivery.Verdict, s.Delivery.Summary)
		for _, u := range s.Delivery.Unresolved {
			fmt.Fprintf(&b, "- 未完成/限制：%s\n", u)
		}
	}
	return b.String()
}
func (w *Workspace) saveWorkflowLocked(s *WorkflowState) error {
	s.Revision++
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if len(data) > 2<<20 {
		return fmt.Errorf("工作记录超过2 MiB，请保留档案并开启新任务")
	}
	if err = atomicWorkspaceFile(w.workflowDirectory(), "workflow.json", data); err != nil {
		return err
	}
	w.workflowPlan = ClonePlan(s.Plan)
	w.workflowAgent, w.workflowGeneration = s.Agent, s.Generation
	// JSON是权威；MD投影失败会明确报错，下次状态读取可重建，不能回滚已发生事实。
	return atomicWorkspaceFile(w.workflowDirectory(), "execution-plan.md", []byte(workflowMarkdown(*s)))
}
func workflowUnknown(plan *PlanEngine) []string {
	var out []string
	if plan == nil {
		return out
	}
	for key, r := range plan.Receipts {
		var v struct {
			State string `json:"state"`
		}
		if json.Unmarshal([]byte(r.Output), &v) == nil && v.State == "interrupted_unknown" {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	return out
}
func (w *Workspace) syncWorkflow(plan *PlanEngine, agent string, generation int) error {
	if plan == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	s, err := w.loadWorkflowLocked()
	if err != nil {
		return err
	}
	unknown := workflowUnknown(plan)
	if reflect.DeepEqual(s.Plan, plan.State) && reflect.DeepEqual(s.Unknown, unknown) {
		return nil
	}
	if s.Plan != nil && plan.State != nil && s.Plan.ID != plan.State.ID {
		old, _ := json.MarshalIndent(s, "", "  ")
		if err = atomicWorkspaceFile(w.workflowDirectory(), fmt.Sprintf("workflow-history-%d-%s.json", s.Revision, workspaceID()), old); err != nil {
			return err
		}
		s = WorkflowState{Version: 1, Revision: s.Revision, Resolved: map[string]string{}}
	}
	s.Plan, s.Unknown, s.Agent, s.Generation = ClonePlan(plan.State), unknown, agent, generation
	s.Delivery = nil
	return w.saveWorkflowLocked(&s)
}

// 新用户轮次可显式另立任务；仅恢复历史或压缩不会消耗、完成旧任务。
func (w *Workspace) bindPlanTaskBoundary(plan *PlanEngine, agent string, generation int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	plan.PriorTaskID = ""
	if plan.State != nil && w.workflowPlan != nil && plan.State.ID == w.workflowPlan.ID && w.workflowAgent == agent && w.workflowGeneration > 0 && w.workflowGeneration < generation {
		plan.PriorTaskID = plan.State.ID
	}
}

func (w *Workspace) workflowFiles(ctx context.Context, paths []string) ([]WorkflowFile, error) {
	if len(paths) < 1 || len(paths) > 32 {
		return nil, fmt.Errorf("需要1–32个项目内文件；包含实际检查所依赖的源文件和测试")
	}
	root, err := os.OpenRoot(w.state.Workdir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	var out []WorkflowFile
	seen := map[string]bool{}
	var total int64
	for _, p := range paths {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		p = filepath.Clean(p)
		if !filepath.IsLocal(p) || p == "." || strings.ContainsAny(p, "\r\n\x00:") {
			return nil, fmt.Errorf("证据路径必须是项目内相对文件")
		}
		key := strings.ToLower(p)
		if seen[key] {
			return nil, fmt.Errorf("证据路径重复")
		}
		seen[key] = true
		for _, part := range strings.Split(filepath.ToSlash(key), "/") {
			if part == "prompt" || part == ".git" || part == ".env" || strings.HasPrefix(part, ".env.") || part == "memory" || part == "workspaces" || part == "config.json" {
				return nil, fmt.Errorf("私人配置和存储不能作为交付文件")
			}
		}
		abs := filepath.Join(w.state.Workdir, p)
		real, e := filepath.EvalSymlinks(abs)
		if e != nil {
			return nil, e
		}
		config, _ := filepath.Abs(w.config)
		if strings.EqualFold(real, config) || strings.EqualFold(real, w.dir) || strings.HasPrefix(strings.ToLower(real), strings.ToLower(w.dir)+string(filepath.Separator)) || strings.EqualFold(real, w.manager.dir) || strings.HasPrefix(strings.ToLower(real), strings.ToLower(w.manager.dir)+string(filepath.Separator)) {
			return nil, fmt.Errorf("私人存储不能作为交付文件")
		}
		f, e := root.Open(p)
		if e != nil {
			return nil, e
		}
		info, e := f.Stat()
		if e != nil {
			f.Close()
			return nil, e
		}
		if !info.Mode().IsRegular() || info.Size() > 32<<20 {
			f.Close()
			return nil, fmt.Errorf("证据只支持不超过32 MiB的普通文件")
		}
		h := sha256.New()
		n, e := io.Copy(h, io.LimitReader(f, (32<<20)+1))
		after, se := f.Stat()
		f.Close()
		if e != nil || se != nil || n > 32<<20 || n != info.Size() || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
			return nil, fmt.Errorf("文件在核实中变化，重新读取")
		}
		total += n
		if total > 128<<20 {
			return nil, fmt.Errorf("一组证据超过128 MiB")
		}
		out = append(out, WorkflowFile{filepath.ToSlash(p), hex.EncodeToString(h.Sum(nil)), n})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}
func (w *Workspace) workflowValidity(ctx context.Context, s WorkflowState) map[string]string {
	states := map[string]string{}
	captures := map[string]bool{}
	for _, c := range s.Captures {
		paths := []string{}
		for _, f := range c.Files {
			paths = append(paths, f.Path)
		}
		current, err := w.workflowFiles(ctx, paths)
		captures[c.ID] = err == nil && reflect.DeepEqual(current, c.Files)
	}
	for _, e := range s.Evidence {
		states[e.ID] = "stale"
		if captures[e.CaptureID] {
			states[e.ID] = "current"
		}
	}
	return states
}

// A stable, exact alias reduces copying errors without guessing a receipt.
// Durable evidence always stores the original key and rechecks all guards.
func workflowReceiptRef(key string) string {
	return "r-" + workspaceHash([]byte(key))[:16]
}

func workflowReceiptKey(receipts map[string]ToolReceipt, ref string) (string, bool) {
	if _, ok := receipts[ref]; ok {
		return ref, true
	}
	key := ""
	for candidate := range receipts {
		if workflowReceiptRef(candidate) == ref {
			if key != "" {
				return "", false
			}
			key = candidate
		}
	}
	return key, key != ""
}

func workflowReceiptAfter(c WorkflowCapture, key string, result ShellResult) bool {
	at, err := time.Parse(time.RFC3339Nano, c.At)
	if err != nil || !result.OK || result.State != "exited" || result.ExitCode == nil || *result.ExitCode != 0 || result.LogIncomplete || result.StartedAt.Before(at) {
		return false
	}
	for _, prior := range c.PriorReceipts {
		if prior == key {
			return false
		}
	}
	return true
}

func (w *Workspace) workflow(ctx context.Context, raw json.RawMessage) (any, error) {
	var p struct {
		Action     string   `json:"action"`
		ID         string   `json:"id"`
		Label      string   `json:"label"`
		Paths      []string `json:"paths"`
		Receipt    string   `json:"receipt_key"`
		Evidence   []string `json:"evidence_ids"`
		Expected   int      `json:"expected_version"`
		Verdict    string   `json:"verdict"`
		Summary    string   `json:"summary"`
		Unresolved []string `json:"unresolved"`
	}
	if len(raw) > 64<<10 || json.Unmarshal(raw, &p) != nil {
		return nil, fmt.Errorf("无效工作记录参数")
	}
	c, _ := ctx.Value(workflowContextKey{}).(workflowContext)
	if err := w.syncWorkflow(c.Plan, c.Agent, c.Generation); err != nil {
		return nil, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	s, err := w.loadWorkflowLocked()
	if err != nil {
		return nil, err
	}
	if p.Action == "workflow_status" {
		if err = atomicWorkspaceFile(w.workflowDirectory(), "execution-plan.md", []byte(workflowMarkdown(s))); err != nil {
			return nil, err
		}
		receipts := []map[string]any{}
		if c.Plan != nil {
			for key, r := range c.Plan.Receipts {
				if r.ToolName != "terminal" && r.ToolName != "exec_command" && r.ToolName != "write_stdin" {
					continue
				}
				var result ShellResult
				if json.Unmarshal([]byte(r.Output), &result) == nil {
					eligible := []string{}
					for _, capture := range s.Captures {
						if workflowReceiptAfter(capture, key, result) {
							eligible = append(eligible, capture.ID)
						}
					}
					receipts = append(receipts, map[string]any{"key": key, "ref": workflowReceiptRef(key), "eligible_captures": eligible, "tool": r.ToolName, "state": result.State, "exit_code": result.ExitCode, "started_at": result.StartedAt, "description": utf8Prefix(result.Description, 200)})
				}
			}
			sort.Slice(receipts, func(i, j int) bool {
				return receipts[i]["started_at"].(time.Time).After(receipts[j]["started_at"].(time.Time))
			})
			if len(receipts) > 64 {
				receipts = receipts[:64]
			}
		}
		visible := workflowVisible(s)
		return map[string]any{"ok": true, "state": visible, "receipts": receipts, "validity": w.workflowValidity(ctx, s), "markdown_path": filepath.Join(w.workflowDirectory(), "execution-plan.md"), "notice": "先capture，再运行只读验证，再用receipt_key填写原key或精确ref并登记evidence，最后deliver。eligible_captures仅说明收据时序与退出状态符合，文件是否未变仍会重新核验；业务正确性需独立验收。"}, nil
	}
	if c.Plan == nil || c.Agent == "" {
		return nil, fmt.Errorf("修改工作记录需要当前任务执行上下文")
	}
	if p.Expected != s.Revision {
		return nil, fmt.Errorf("工作记录已变化：当前版本%d，请先workflow_status", s.Revision)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	switch p.Action {
	case "workflow_capture":
		if !planText(p.Label, 300) || len(s.Captures) >= 64 {
			return nil, fmt.Errorf("快照标签无效或已达64组上限")
		}
		files, e := w.workflowFiles(ctx, p.Paths)
		if e != nil {
			return nil, e
		}
		prior := []string{}
		for k := range c.Plan.Receipts {
			prior = append(prior, k)
		}
		sort.Strings(prior)
		s.Captures = append(s.Captures, WorkflowCapture{workspaceID(), p.Label, now, files, prior})
		s.Delivery = nil
	case "workflow_evidence":
		if len(s.Evidence) >= 128 {
			return nil, fmt.Errorf("证据已达128组上限")
		}
		var capture *WorkflowCapture
		for i := range s.Captures {
			if s.Captures[i].ID == p.ID {
				capture = &s.Captures[i]
				break
			}
		}
		if capture == nil {
			return nil, fmt.Errorf("快照不存在")
		}
		key, found := workflowReceiptKey(c.Plan.Receipts, p.Receipt)
		if found {
			p.Receipt = key
		}
		r, ok := c.Plan.Receipts[p.Receipt]
		if !ok || r.ToolName != "terminal" && r.ToolName != "exec_command" && r.ToolName != "write_stdin" {
			return nil, fmt.Errorf("需要此任务已提交的真实Shell退出收据；请从workflow_status复制精确ref或完整key，不要重放原操作")
		}
		for _, key := range capture.PriorReceipts {
			if key == p.Receipt {
				return nil, fmt.Errorf("验证必须在文件快照之后执行")
			}
		}
		var result ShellResult
		if json.Unmarshal([]byte(r.Output), &result) != nil || !result.OK || result.State != "exited" || result.ExitCode == nil || *result.ExitCode != 0 || result.LogIncomplete {
			return nil, fmt.Errorf("验证命令未正常完成、失败或日志不完整")
		}
		at, _ := time.Parse(time.RFC3339Nano, capture.At)
		if result.StartedAt.Before(at) {
			return nil, fmt.Errorf("命令开始时间早于文件快照")
		}
		paths := []string{}
		for _, f := range capture.Files {
			paths = append(paths, f.Path)
		}
		files, e := w.workflowFiles(ctx, paths)
		if e != nil || !reflect.DeepEqual(files, capture.Files) {
			return nil, fmt.Errorf("文件已变化，重新建立快照并验证")
		}
		for _, e := range s.Evidence {
			if e.Receipt == p.Receipt && e.CaptureID == p.ID {
				return map[string]any{"ok": true, "revision": s.Revision, "evidence": e, "replayed": true}, nil
			}
		}
		s.Evidence = append(s.Evidence, WorkflowEvidence{workspaceID(), p.ID, p.Receipt, workspaceHash([]byte(r.Output)), now})
		s.Delivery = nil
	case "workflow_reconcile":
		found := false
		for _, key := range s.Unknown {
			found = found || key == p.Receipt
		}
		if !found {
			return nil, fmt.Errorf("此调用不在待核实列表")
		}
		if w.workflowValidity(ctx, s)[p.ID] != "current" {
			return nil, fmt.Errorf("需要新的有效核实证据；外部效果另行确认")
		}
		if !planText(p.Summary, 2000) || len(strings.TrimSpace(p.Summary)) < 20 {
			return nil, fmt.Errorf("需要核实说明：原调用、检查的原系统/产物、观察结果和未解决限制；命令成功本身不是副作用证明")
		}
		// Evidence predating discovery of this interrupted call cannot reconcile it.
		afterUnknown := false
		for _, evidence := range s.Evidence {
			if evidence.ID != p.ID {
				continue
			}
			for _, capture := range s.Captures {
				if capture.ID != evidence.CaptureID {
					continue
				}
				for _, prior := range capture.PriorReceipts {
					afterUnknown = afterUnknown || prior == p.Receipt
				}
			}
		}
		if !afterUnknown {
			return nil, fmt.Errorf("核实快照必须建立于发现此中断调用之后；不要复用旧验证")
		}
		if s.Reconciliation == nil {
			s.Reconciliation = map[string]string{}
		}
		s.Resolved[p.Receipt] = p.ID
		s.Reconciliation[p.Receipt] = p.Summary
		s.Delivery = nil
	case "workflow_deliver":
		if p.Verdict != "complete" && p.Verdict != "partial" && p.Verdict != "blocked" {
			return nil, fmt.Errorf("交付状态只支持complete/partial/blocked")
		}
		if !planText(p.Summary, 2000) || len(p.Unresolved) > 32 {
			return nil, fmt.Errorf("需要简明交付摘要和有限未完成项")
		}
		for _, u := range p.Unresolved {
			if !planText(u, 1000) {
				return nil, fmt.Errorf("未完成项无效")
			}
		}
		valid := w.workflowValidity(ctx, s)
		for _, id := range p.Evidence {
			if valid[id] != "current" {
				return nil, fmt.Errorf("交付证据不存在或已过期")
			}
		}
		if p.Verdict == "complete" {
			if len(p.Unresolved) > 0 || len(p.Evidence) == 0 || c.Plan.State != nil && c.Plan.State.Status != "complete" {
				return nil, fmt.Errorf("完整交付需要有效证据、已完成计划和无未完成项")
			}
			for _, key := range s.Unknown {
				if valid[s.Resolved[key]] != "current" {
					return nil, fmt.Errorf("尚有未核实中断调用")
				}
			}
		} else if len(p.Unresolved) == 0 {
			return nil, fmt.Errorf("部分或阻塞交付必须明确未完成项")
		}
		s.Delivery = &WorkflowDelivery{p.Verdict, p.Summary, p.Evidence, p.Unresolved, now}
	default:
		return nil, fmt.Errorf("未知工作记录动作")
	}
	s.Agent, s.Generation = c.Agent, c.Generation
	if err = w.saveWorkflowLocked(&s); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "state": workflowVisible(s), "markdown_path": filepath.Join(w.workflowDirectory(), "execution-plan.md")}, nil
}

func (w *Workspace) workflowBoundary(ctx context.Context, agent string, generation int) (string, error) {
	if !workflowAvailable(ctx) {
		return "", nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	s, err := w.loadWorkflowLocked()
	if err != nil {
		return "", err
	}
	if s.Agent != agent || s.Generation != generation || len(s.Captures) == 0 && s.Plan == nil && len(s.Unknown) == 0 {
		return "", nil
	}
	if s.Delivery == nil {
		return runtimePrompt("Matrix/运行协定/产物验收.txt"), nil
	}
	if s.Delivery.Verdict == "complete" {
		valid := w.workflowValidity(ctx, s)
		for _, id := range s.Delivery.Evidence {
			if valid[id] != "current" {
				return "Delivery evidence became stale; revalidate changed files or record partial delivery.", nil
			}
		}
	}
	return "", nil
}

func (w *Workspace) workflowNotice() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, err := w.loadWorkflowLocked()
	if err != nil {
		return runtimePrompt("Matrix/辅助指令/工作记录不可用.txt")
	}
	if s.Plan == nil && len(s.Unknown) == 0 {
		return ""
	}
	unknown := 0
	for _, key := range s.Unknown {
		if s.Resolved[key] == "" {
			unknown++
		}
	}
	plan := "none"
	if s.Plan != nil {
		plan = s.Plan.ID + "/" + s.Plan.Status + ": " + utf8Prefix(s.Plan.Objective, 400)
	}
	return formatPromptText(runtimePrompt("Matrix/辅助指令/持久任务状态.txt"), s.Revision, plan, unknown)
}
