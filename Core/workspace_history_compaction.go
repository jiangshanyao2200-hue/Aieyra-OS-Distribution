// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: compactionReceipt
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_compaction.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "encoding/json"

func (w *Workspace) compactionReceipt(v historyEntry, inputOffset, outputOffset int, pending bool) (any, error) {
	data, err := historyRead(v.input)
	if err != nil {
		return nil, err
	}
	var event struct {
		Value json.RawMessage `json:"value"`
	}
	if err = json.Unmarshal(data, &event); err != nil {
		return nil, err
	}
	input := compactionTextPage{}
	output := ""
	if v.input.kind == "checkpoint" {
		var cp Checkpoint
		if err = json.Unmarshal(event.Value, &cp); err != nil {
			return nil, err
		}
		first := cp.First
		if cp.Compaction != nil {
			first = cp.Compaction.First
		}
		input, err = compactionSourcePage(v.input, first, cp.Covered, inputOffset, 64<<10, w.manager.redact)
		if err != nil {
			return nil, err
		}
		output = w.manager.redact(checkpointText(&cp))
	} else {
		var state CompactionState
		if err = json.Unmarshal(event.Value, &state); err != nil {
			return nil, err
		}
		output = compactionPhaseText(&state) + "\n尚无已提交的压缩后内容。"
		if state.Covered > state.First {
			input, err = compactionSourcePage(v.input, state.First, state.Covered, inputOffset, 64<<10, w.manager.redact)
		} else {
			_, _, err = historyChunk("", inputOffset)
		}
		if err != nil {
			return nil, err
		}
	}
	output = w.manager.redact(output)
	part, next, err := historyChunk(output, outputOffset)
	if err != nil {
		return nil, err
	}
	return map[string]any{"input": input.Text, "output": part, "next_input": input.Next, "next_output": next, "input_size": input.Size, "output_size": len(output), "tool": v.Title, "state": v.State, "compaction": true, "pending": pending}, nil
}
