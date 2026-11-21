package contract

import "github.com/aieyra/aieyra-os/contracts/protocol"

type Image struct {
	ID            string   `json:"id"`
	Path          string   `json:"path"`
	MIME          string   `json:"mime"`
	Width         int      `json:"width"`
	Height        int      `json:"height"`
	CreatedAt     string   `json:"created_at"`
	Model         string   `json:"model"`
	ProfileID     string   `json:"profile_id"`
	TaskID        string   `json:"task_id,omitempty"`
	Operation     string   `json:"operation"`
	Prompt        string   `json:"prompt"`
	SourcePaths   []string `json:"source_paths,omitempty"`
	MaskPath      string   `json:"mask_path,omitempty"`
	Quality       string   `json:"quality,omitempty"`
	RequestedSize string   `json:"requested_size,omitempty"`
	QualityReview string   `json:"quality_review,omitempty"`
}
type Failure struct {
	Index   int    `json:"index"`
	State   string `json:"state"`
	Message string `json:"message"`
}
type Result struct {
	Batches         []BatchSummary        `json:"batches,omitempty"`
	BatchID         string                `json:"batch_id,omitempty"`
	Items           []BatchItem           `json:"items,omitempty"`
	NextOffset      int                   `json:"next_offset,omitempty"`
	Requested       int                   `json:"requested"`
	Submitted       int                   `json:"submitted"`
	Completed       int                   `json:"completed"`
	Unsubmitted     int                   `json:"unsubmitted"`
	State           string                `json:"state"`
	Recovery        string                `json:"recovery,omitempty"`
	Usage           []protocol.AgentUsage `json:"usage,omitempty"`
	AccountingError string                `json:"accounting_error,omitempty"`
	OK              bool                  `json:"ok"`
	Model           string                `json:"model"`
	ProfileID       string                `json:"profile_id"`
	Operation       string                `json:"operation"`
	Paths           []string              `json:"paths"`
	Images          []Image               `json:"images"`
	Failed          []Failure             `json:"failed,omitempty"`
	Unknown         bool                  `json:"unknown,omitempty"`
}
type BatchInput struct {
	OutputFormat      string   `json:"output_format,omitempty"`
	OutputCompression *int     `json:"output_compression,omitempty"`
	Background        string   `json:"background,omitempty"`
	Moderation        string   `json:"moderation,omitempty"`
	InputFidelity     string   `json:"input_fidelity,omitempty"`
	Model             string   `json:"model_requested,omitempty"`
	RouteFingerprint  string   `json:"route_fingerprint,omitempty"`
	Operation         string   `json:"operation,omitempty"`
	Prompt            string   `json:"prompt,omitempty"`
	ProfileID         string   `json:"profile_id,omitempty"`
	Size              string   `json:"size,omitempty"`
	Quality           string   `json:"quality,omitempty"`
	QualityReason     string   `json:"quality_reason,omitempty"`
	Images            []string `json:"images,omitempty"`
	Mask              string   `json:"mask,omitempty"`
}
type BatchItem struct {
	Index     int                  `json:"index"`
	RequestID string               `json:"request_id"`
	State     string               `json:"state"`
	Input     BatchInput           `json:"input"`
	InputSHA  map[string]string    `json:"input_sha256,omitempty"`
	Result    *Result              `json:"result,omitempty"`
	Usage     *protocol.AgentUsage `json:"usage,omitempty"`
	Error     string               `json:"error,omitempty"`
}
type BatchSummary struct {
	ID        string `json:"batch_id"`
	CreatedAt string `json:"created_at"`
	Requested int    `json:"requested"`
	Completed int    `json:"completed"`
	State     string `json:"state"`
}
