// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Snapshot; snapshot; workspaceRoleStatus; workspaceJobStatus; workspaceRecordStatus; workspaceUsage; messagePage
// Impact: python -B scripts/code-atlas.py show Core/workspace_snapshot.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"time"
)

func (w *Workspace) Snapshot(after uint64) (any, error) { return w.snapshot(after, WorkspaceCursor{}) }

func (w *Workspace) snapshot(after uint64, cursors WorkspaceCursor) (any, error) {
	w.mu.Lock()
	if err := w.refreshSnapshotReportsLocked(time.Now()); err != nil {
		w.mu.Unlock()
		return nil, err
	}
	id, workdir, theme, revision := w.state.ID, w.state.Workdir, w.state.Theme, w.state.Revision
	linkScope := w.coreLinkScopeLocked()
	identityController := w.identity
	segment, historyAfter, epoch := w.state.HistorySegment, w.state.HistoryAfter, w.epoch
	greeting := w.greeting
	startup := w.startupStatusLocked()
	plan := ClonePlan(w.workflowPlan)
	planScope := map[string]any{"agent": w.workflowAgent, "generation": w.workflowGeneration}
	greetingUsage := workspaceUsage(w.greetingUsage)
	usageBase := w.contextUsageBase
	documents := append([]WorkspaceDocument(nil), w.state.Documents...)
	asks := w.pendingAsksLocked()
	talk := w.teamTalkLocked(80)
	live := map[string]WorkspaceLive{}
	for role, value := range w.live {
		// 读取不会改变流状态或修订；公开摘要的显示寿命由 UI 管理。
		if (role == WorkspaceMatrix || role == WorkspaceProject || role == WorkspaceExecution) && value.Revision != cursors.Live[role] {
			live[role] = value
		}
	}
	roleIDs := map[string]string{}
	var statistics *contextStatistics
	if s := w.contextSessionLocked(); s != nil {
		greetingUsage = mergeWorkspaceUsage(s.BackgroundUsage)
		if s.Statistics != nil {
			value := *s.Statistics
			if value.Archive != s.Archive {
				value.Context = nil
			}
			statistics = &value
		}
	}
	for role, value := range w.state.Roles {
		roleIDs[role] = value
	}
	messages := []workspaceMessage{}
	total := len(w.state.Messages)
	if cursors.Revision != revision {
		messages = w.snapshotMessagesLocked()
	}
	model, settings, err := w.modelSettingsLocked(WorkspaceMatrix)
	roleModels := map[string]string{WorkspaceMatrix: model}
	visibleRoles := []string{WorkspaceMatrix}
	if w.Mode() == HostOS && CurrentReleaseStage().TeamCollaboration {
		for _, role := range []string{WorkspaceProject, WorkspaceExecution} {
			if w.collaborationRoleLocked(role) || roleIDs[role] != "" {
				visibleRoles = append(visibleRoles, role)
				roleModels[role], _ = w.modelLocked(role)
			}
		}
	}
	ready := err == nil
	modelName := ""
	if ready {
		modelName = settings.Model
	}
	w.mu.Unlock()
	identity := identityController.projection()
	greeting.Text = w.manager.redact(greeting.Text)
	greeting.Error = w.manager.redact(greeting.Error)
	greeting.Detail = w.manager.redact(greeting.Detail)
	for role, value := range live {
		value.Text = w.manager.redact(value.Text)
		value.Thought = w.manager.redact(value.Thought)
		live[role] = value
	}
	roles := []any{}
	// 复用人工请求的过期处理，不能让无人答复的会话永久显示等待。
	if _, err := w.manager.Humans(id); err != nil {
		return nil, err
	}
	for _, role := range visibleRoles {
		row := map[string]any{"role": role, "state": "idle", "model_id": roleModels[role], "execution_started": false}
		// Restore only display facts from the same conversation. A previous
		// task never becomes runnable merely because its usage is visible.
		if role == WorkspaceMatrix && roleIDs[role] == "" && statistics != nil {
			row["usage"] = statistics.Usage
			if statistics.Context != nil {
				row["context"] = statistics.Context
			}
			row["statistics_restored"] = true
			row["execution_started"] = false
		}
		if agentID := roleIDs[role]; agentID != "" {
			status, e := w.manager.workspaceRoleStatus(id, agentID)
			if e != nil {
				return nil, e
			}
			for key, value := range status {
				row[key] = value
			}
			if role == WorkspaceMatrix && usageBase != nil {
				usage, _ := row["usage"].(map[string]any)
				row["usage"] = mergeWorkspaceUsage(usageBase, usage)
			}
			if role == WorkspaceMatrix && activeAgent(status["state"].(string)) {
				if current, ok := status["request_model"].(string); ok && current != "" {
					modelName = current
				}
			}
			activity, e := w.manager.Activity(id, agentID, cursors.Activity[role], 0, 120)
			if e != nil {
				row["activity_error"] = e.Error()
			} else {
				row["activity"] = activity
			}
		}
		roles = append(roles, row)
	}
	events, cursor, reset := w.feed.read(after)
	subconscious := w.subconsciousView()
	var link map[string]any
	if w.host != nil && w.coreLinkRegistered.Load() && w.split == nil {
		service, e := w.host.conversationManager()
		if e == nil {
			link, e = service.conversationLinkView(AgentRecord{ID: linkScope, Spec: AgentSpec{Kind: "workspace_link"}})
		}
		if e != nil {
			link = map[string]any{"scope": linkScope, "error": w.manager.redact(e.Error())}
		}
	}
	if plan != nil {
		_ = json.Unmarshal([]byte(w.manager.redact(string(rawJSON(plan)))), &plan)
	}
	return map[string]any{"identity": identity, "link": link, "ask_requests": asks, "subconscious": subconscious, "collaboration": w.collaborationSnapshot(), "tasks": w.taskList(), "root_id": id, "history_segment": segment, "history_after": historyAfter, "plan": plan, "plan_scope": planScope, "model_id": model, "model_name": w.manager.redact(modelName), "greeting": greeting, "startup": startup, "greeting_usage": greetingUsage, "documents": documents, "version": 1, "core_epoch": epoch, "session_id": id, "workdir": workdir, "ready": ready, "roles": roles, "messages": messages, "messages_unchanged": cursors.Revision == revision, "message_total": total, "revision": revision, "theme": theme, "team_talk": talk, "events": events, "cursor": cursor, "reset": reset, "live": live}, nil
}

// 高频界面查询只复制显示字段；历史正文、提示词与幂等记录仍由完整 Status 按需读取。
func (m *AgentManager) workspaceRoleStatus(owner, id string) (map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownsLocked(owner, id) {
		return nil, fmt.Errorf("agent not owned by caller")
	}
	return workspaceJobStatus(m.jobs[id]), nil
}

// Display reads the same dispatch fact used by Run for. Intent timestamps are
// written before dispatch, and reading status must not checkpoint the timer.
func workspaceJobStatus(j *agentJob) map[string]any {
	row := workspaceRecordStatus(j.record, j.requestModel)
	started := j.runStarted.Load() > 0
	if r := j.record.RunTime; r != nil {
		for _, interval := range r.Intervals {
			started = started || interval.StartedAt > 0
		}
	}
	row["execution_started"] = started
	return row
}

func workspaceRecordStatus(record AgentRecord, requestModel string) map[string]any {
	r := &record
	var context *AgentContext
	if r.Context != nil {
		value := *r.Context
		context = &value
	}
	var humans []HumanRequest
	if r.HumanRequests != nil {
		humans = make([]HumanRequest, 0, len(r.HumanRequests))
		for _, human := range r.HumanRequests {
			humans = append(humans, cloneHuman(human))
		}
	}
	row := map[string]any{"id": r.ID, "state": r.State, "generation": r.Generation, "model_id": r.Spec.ModelID,
		"error": r.Error, "acceptance": r.Acceptance, "requests": r.Requests, "accounted_tokens": r.AccountedTokens,
		"usage": workspaceUsage(r.Usage), "context": context, "human_requests": humans}
	row["request_model"] = requestModel
	row["chat_retry_attempt"] = r.ChatRetryAttempt
	if r.Failure != nil {
		value := *r.Failure
		row["failure"] = &value
	}
	if r.Compression != nil {
		value := *r.Compression
		row["compression"] = &value
	}
	return row
}

// 用量来自供应商收据；预算估算不冒充计费，部分缺失不能显示成完整命中率。
func workspaceUsage(rows []AgentUsage) map[string]any {
	input, output, cached, reported := 0, 0, 0, 0
	estimated := 0
	cacheInput, cacheReported := 0, 0
	cacheKnown := true
	chatSamples, imageSamples, imageReported, imageInput, imageOutput := 0, 0, 0, 0, 0
	reasoning, reasoningReported := 0, 0
	for _, row := range rows {
		if row.Reported || row.Estimated {
			input += row.Input
			output += row.Output
		}
		if row.Reported {
			reported++
		} else if row.Estimated {
			estimated++
		}
		if row.Kind == "image_gen" {
			imageSamples++
			if row.Reported {
				imageReported++
				imageInput += row.Input
				imageOutput += row.Output
			}
			continue
		}
		chatSamples++
		if row.Cached == nil || !row.Reported {
			cacheKnown = false
		} else {
			cached += *row.Cached
			cacheInput += row.Input
			cacheReported++
		}
		if row.Reported && row.Reasoning != nil {
			reasoning += *row.Reasoning
			reasoningReported++
		}
	}
	return map[string]any{"image_samples": imageSamples, "image_reported": imageReported, "image_unknown": imageSamples - imageReported, "image_input_tokens": imageInput, "image_output_tokens": imageOutput, "estimated": estimated, "unknown": len(rows) - reported - estimated, "input_tokens": input, "output_tokens": output, "total_tokens": input + output, "cached_tokens": cached, "cached_known": chatSamples > 0 && cacheKnown, "cache_input_tokens": cacheInput, "cache_reported": cacheReported, "reasoning_tokens": reasoning, "reasoning_reported": reasoningReported, "reasoning_known": chatSamples > 0 && reasoningReported == chatSamples, "reported": reported, "samples": len(rows), "complete": len(rows) > 0 && reported == len(rows)}
}

func (w *Workspace) messagePage(raw json.RawMessage) any {
	var p struct {
		Before int `json:"before"`
	}
	_ = json.Unmarshal(raw, &p)
	w.mu.Lock()
	defer w.mu.Unlock()
	end := p.Before
	if end <= 0 || end > len(w.state.Messages) {
		end = len(w.state.Messages)
	}
	start := max(0, end-200)
	return map[string]any{"messages": append([]workspaceMessage(nil), w.state.Messages[start:end]...), "before": start, "has_more": start > 0}
}
