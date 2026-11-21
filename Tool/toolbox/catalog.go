// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/toolbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: CatalogVersion; DiscoveryInstructions; Capability; Catalog; Names; Find; Describe; DescribeIndex; describeSummary; SystemSection; SystemTarget
// Impact: python -B scripts/code-atlas.py show Tool/toolbox/catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package toolbox owns public discovery metadata for the existing Toolbox
// capabilities. Entries are not installable Mod registrations or permissions.
package toolbox

import (
	"encoding/json"
	"strings"
)

const CatalogVersion = 1

const DiscoveryInstructions = "Open before call. You may emit explicit open followed by call in the same response when all target arguments are already known. Queries do not run automatically; observation may capture data and recovery changes state. These are partial input schemas; other actions require the opened manual."

// Capability describes the service boundary, never a live service or user data.
// Manual is a resource key; the host resolves private overrides at request time.
type Capability struct {
	Name    string
	Summary string
	Manual  string
	Owner   string
	Service string
	Host    string
}

// Catalog returns a fresh, stable-order catalogue. Business implementations and
// authorization remain with the named owners; only discovery belongs here.
func Catalog() []Capability {
	return []Capability{
		{"project", "read and maintain project maps, file indexes and annotations for the selected working directory", "Matrix/工具说明/工程索引.txt", "Core project service", "workspace/conversation project", ""},
		{"agents", "discover program agents, delegate to their persistent sessions, and manage agent profiles, models, editable prompts and tools", "Matrix/工具说明/专项助手.txt", "Core common agent management", "AgentManager", ""},
		{"image_gen", "generate or edit highest-quality images, run durable batches, inspect progress and resume only unsent items", "Matrix/工具说明/生图.txt", "Tool/toolbox/official/imagegen", "Core image batches", ""},
		{"settings", "discover, inspect, validate, apply and restore Aieyra settings, with versioned receipts and application status", "Matrix/工具说明/设置.txt", "Core and client settings", "SettingsService", ""},
		{"software_api", "operate Aieyra OS modules through the shared runtime; delegate settings to the existing settings tool", "Matrix/工具说明/软件接口.txt", "Core software facade and client module runtime", "softwareAPICall", ""},
		{"cloud_report", "report a product problem publicly to the Aieyra cloud and check official update status", "Matrix/工具说明/云端上报.txt", "Core cloud routes", "toolboxRouted", ""},
		{"community", "read and (with consent) post in the Aieyra HOME forum; browse, install and publish 中心 resources", "Matrix/工具说明/社区.txt", "Core community routes", "toolboxRouted", ""},
		{"link", "join the local Link office: see stations and who is online, read the channel, post messages and hand off work to other agents", "Matrix/工具说明/Link办公室.txt", "Link/Control", "hostPluginTool", "os_desktop"},
		{"server", "manage the servers the user owns: register SSH servers, deploy probes, read live metrics and keep the shared password book", "Matrix/工具说明/服务器管理.txt", "Program/official/servers", "hostPluginTool", "os_desktop"},
		{"browser", "isolated Chromium browser with page snapshots, navigation and interaction", "Matrix/工具说明/浏览器.txt", "Program/official/browser", "SettingsService agent:browser", ""},
		{"computer", "observe native windows, view screenshots, and operate semantic controls or observed pixel coordinates", "Matrix/工具说明/电脑操作.txt", "Client native interaction", "SettingsService agent:computer", ""},
		{"tool_factory", "register versioned custom JavaScript tools", "Matrix/工具说明/工具工厂.txt", "Core package lifecycle", "AgentManager toolFactory", ""},
		{"human", "pause a helper for a concrete human decision", "Matrix/工具说明/人工决策.txt", "Core human decisions", "AgentManager requestHuman", ""},
		{"compact", "compress old conversation at a safe boundary using Eyra and PAC", "Matrix/工具说明/主动压缩.txt", "Core context lifecycle", "requestContextCompaction", ""},
		{"video_gen", "prepare and submit a durable video task once; query, recover and download its verified media", "Matrix/工具说明/视频生成.txt", "Tool/toolbox/official/videogen", "Core video tasks", ""},
	}
}

func Names() []string {
	var names []string
	for _, entry := range Catalog() {
		names = append(names, entry.Name)
	}
	return names
}

func Find(name string) (Capability, bool) {
	for _, entry := range Catalog() {
		if entry.Name == name {
			return entry, true
		}
	}
	return Capability{}, false
}

// Describe formats only host-projected public metadata. It does not decide
// availability and must never receive private manual text or query results.
func Describe(entry Capability, queries []Query, recoveryOnly bool) string {
	text := describeSummary(entry, queries, recoveryOnly)
	if len(queries) > 0 {
		encoded, _ := json.Marshal(queries)
		text += " Explicit query inputs: " + string(encoded)
	}
	return text
}

// DescribeIndex is the companion catalogue entry for a request whose toolbox
// definition already carries Describe. Do not duplicate the full input schemas
// in system messages on every model turn.
func DescribeIndex(entry Capability, queries []Query, recoveryOnly bool) string {
	text := describeSummary(entry, queries, recoveryOnly)
	if len(queries) > 0 {
		var actions []string
		for _, query := range queries {
			actions = append(actions, query.Action+" ("+query.Effect+")")
		}
		text += " Actions: " + strings.Join(actions, ", ") + "."
	}
	return text
}

func describeSummary(entry Capability, queries []Query, recoveryOnly bool) string {
	summary := entry.Summary
	if recoveryOnly && entry.Name == "image_gen" {
		summary = "new operations unavailable; only list/status/recover for existing image batches remain available; recover changes recovery state"
	} else if recoveryOnly && entry.Name == "video_gen" {
		summary = "new submissions unavailable; status/list/recover/query/download for original video tasks remain available"
	} else if entry.Name == "software_api" && len(queries) == 0 {
		summary = "shared settings and authorized service routes; OS desktop module queries and operations require the OS main session"
	}
	return entry.Name + ": " + summary + "."
}

// System is a discovery facade. Sections retain their original grants, manuals,
// durable open state and executors; adding the facade grants no capability.
func SystemSection(name string) string {
	switch name {
	case "settings":
		return "settings"
	case "software_api":
		return "software"
	case "tool_factory":
		return "tools"
	}
	return ""
}
func SystemTarget(section string) string {
	switch section {
	case "settings":
		return "settings"
	case "software":
		return "software_api"
	case "tools":
		return "tool_factory"
	}
	return ""
}
