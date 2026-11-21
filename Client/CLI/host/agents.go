// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: runAgents
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/agents.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"io"
)

func runAgents(ctx context.Context, args []string, in io.Reader, out, diagnostic io.Writer) error {
	return runRemoteService(ctx, "agents", "workspace.agents", "Start CLI serve or select an existing Desktop Core's private discovery file.\nActions: sources, models, describe, list, create, status, send, cancel, configure, switch, restore_version, team, export.\nCreate requires package, model_id, workdir and request_id. It creates an idle instance with independent memory.\nSend/cancel require the inspected generation. Changes require request_id and expected_revision.\nExport takes id or package; returns only original public files as a base64 ZIP (2 MiB limit), filename and sha256. It never exports instance settings or memory.\nThe selected Core continues the task after this command exits.", 128<<10, args, in, out, diagnostic)
}
