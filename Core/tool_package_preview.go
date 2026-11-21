// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: continuePackagePreview; boundedPackagePreview; boundedWorkflowPreview; packageValuePreview
// Impact: python -B scripts/code-atlas.py show Core/tool_package_preview.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	tool "github.com/aieyra/aieyra-os/tool/contract"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

// Continue a package view from the actual execution delta. The presentation is
// part of the saved receipt, so updating/removing a package cannot rewrite it.
func continuePackagePreview(previous, delta json.RawMessage) json.RawMessage {
	var saved ToolboxResult
	var old, next map[string]json.RawMessage
	if json.Unmarshal(previous, &saved) != nil || !tool.ValidPackageID(saved.Package) || json.Unmarshal(saved.Data, &old) != nil || json.Unmarshal(delta, &next) != nil {
		return previous
	}
	var first, more []ExecOutput
	_ = json.Unmarshal(old["output"], &first)
	_ = json.Unmarshal(next["output"], &more)
	// ExecResult omits false/nil optional fields. A new wait receipt replaces
	// those flags; a finish event without an `ok` field only updates lifecycle.
	if _, receipt := next["ok"]; receipt {
		delete(old, "has_more")
		delete(old, "error")
	}
	for k, v := range next {
		old[k] = v
	}
	old["output"], _ = json.Marshal(append(first, more...))
	saved.Data, _ = json.Marshal(old)
	var result ExecResult
	_ = json.Unmarshal(saved.Data, &result)
	saved.State, saved.OK, saved.Error = result.State, result.OK, result.Error
	if _, present := next["ok"]; !present {
		saved.OK = result.Error == nil && (result.State == "running" || result.State == "completed")
		old["ok"], _ = json.Marshal(saved.OK)
		saved.Data, _ = json.Marshal(old)
	}
	return boundedPackagePreview(saved)
}

func boundedPackagePreview(saved ToolboxResult) json.RawMessage {
	saved.Open, saved.Manuals = nil, nil
	b, _ := json.Marshal(saved)
	if len(b) <= 64<<10 {
		return b
	}
	var workflow workbox.Instance
	if json.Unmarshal(saved.Data, &workflow) == nil && workflow.Schema == workbox.StateSchema {
		return boundedWorkflowPreview(saved, workflow)
	}
	var result ExecResult
	if json.Unmarshal(saved.Data, &result) != nil {
		return b
	}
	// Live activities are bounded; original receipts remain in the archive.
	budget := 8 << 10
	if result.Error != nil {
		copyError := *result.Error
		copyError.Message = utf8Prefix(copyError.Message, 2000)
		result.Error = &copyError
		saved.Error = &copyError
	}
	var output []ExecOutput
	for _, part := range result.Output {
		if budget <= 0 {
			break
		}
		part.Text = utf8Prefix(part.Text, budget)
		budget -= len(part.Text) + len(part.ImageID) + 64
		output = append(output, part)
	}
	result.Output = output
	saved.Data, _ = json.Marshal(result)
	b, _ = json.Marshal(saved)
	var object map[string]any
	_ = json.Unmarshal(b, &object)
	object["preview_truncated"] = true
	b, _ = json.Marshal(object)
	return b
}

// A workflow is not an ExecResult. Retain its identity, every admitted step's
// state and named outputs; only the preview payloads are shortened. The archive
// and the model's original receipt are never rewritten by this projection.
func boundedWorkflowPreview(saved ToolboxResult, instance workbox.Instance) json.RawMessage {
	instance.Input, instance.Dependencies, instance.Tools, instance.Usage = nil, nil, nil, nil
	definition := workbox.Definition{Schema: instance.Definition.Schema}
	for _, step := range instance.Definition.Steps {
		definition.Steps = append(definition.Steps, workbox.Step{ID: step.ID, Title: utf8Prefix(step.Title, 160)})
	}
	instance.Definition = definition
	steps := make([]workbox.StepState, 0, len(instance.Steps))
	for _, step := range instance.Steps {
		step.Arguments = nil
		step.Invocation = ""
		step.Result = packageValuePreview(step.Result)
		step.Error = utf8Prefix(step.Error, 160)
		step.Receipt = utf8Prefix(step.Receipt, 160)
		steps = append(steps, step)
	}
	instance.Steps = steps
	outputs := make(map[string]any, len(instance.Outputs))
	for key, value := range instance.Outputs {
		raw, _ := json.Marshal(value)
		outputs[key] = packageValuePreview(raw)
	}
	instance.Outputs = outputs
	instance.Error = utf8Prefix(instance.Error, 2000)
	saved.PreviewTruncated = true
	saved.Data, _ = json.Marshal(instance)
	b, _ := json.Marshal(saved)
	return b
}

func packageValuePreview(raw json.RawMessage) json.RawMessage {
	if len(raw) <= 256 {
		return raw
	}
	preview, _ := json.Marshal(map[string]any{"preview_text": utf8Prefix(string(raw), 256), "preview_truncated": true})
	return preview
}
