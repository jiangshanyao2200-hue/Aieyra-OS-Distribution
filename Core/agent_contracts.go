// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentSpec; AgentContract; AgentArtifact; AgentDelivery; AgentReceiptRef; AgentCriterionCheck; AgentReview; AgentOutcome; AgentRunInterval; AgentRunTime
// Impact: python -B scripts/code-atlas.py show Core/agent_contracts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/agent/contract"

// Compatibility aliases retain persisted JSON and existing host entrypoints.
type AgentSpec = contract.AgentSpec
type AgentContract = contract.AgentContract
type AgentArtifact = contract.AgentArtifact
type AgentDelivery = contract.AgentDelivery
type AgentReceiptRef = contract.AgentReceiptRef
type AgentCriterionCheck = contract.AgentCriterionCheck
type AgentReview = contract.AgentReview
type AgentOutcome = contract.AgentOutcome
type AgentRunInterval = contract.AgentRunInterval
type AgentRunTime = contract.AgentRunTime
