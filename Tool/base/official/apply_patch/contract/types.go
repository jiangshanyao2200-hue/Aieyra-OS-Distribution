// Package contract defines patch requests and receipts without execution or UI dependencies.
package contract

type PatchRequest struct {
	Patch       string `json:"patch"`
	Workdir     string `json:"workdir,omitempty"`
	Description string `json:"description,omitempty"`
}
type PatchError struct {
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	Path     string   `json:"path,omitempty"`
	Hunk     int      `json:"hunk,omitempty"`
	Expected []string `json:"expected,omitempty"`
	Actual   []string `json:"actual,omitempty"`
}

func (e *PatchError) Error() string { return e.Message }

type PatchLine struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
	Old  int    `json:"old,omitempty"`
	New  int    `json:"new,omitempty"`
}
type PatchHunk struct {
	Context  string      `json:"context,omitempty"`
	OldStart int         `json:"old_start"`
	NewStart int         `json:"new_start"`
	Lines    []PatchLine `json:"lines"`
	Match    string      `json:"match,omitempty"`
}
type PatchFile struct {
	Path           string      `json:"path"`
	NewPath        string      `json:"new_path,omitempty"`
	Operation      string      `json:"operation"`
	Added          int         `json:"added"`
	Removed        int         `json:"removed"`
	Hunks          []PatchHunk `json:"hunks"`
	BeforeHash     string      `json:"before_sha256,omitempty"`
	AfterHash      string      `json:"after_sha256,omitempty"`
	NoFinalNewline bool        `json:"no_final_newline,omitempty"`
}
type PatchResult struct {
	OK           bool        `json:"ok"`
	State        string      `json:"state"`
	Description  string      `json:"description,omitempty"`
	Files        []PatchFile `json:"files,omitempty"`
	Error        *PatchError `json:"error,omitempty"`
	RecoveryPath string      `json:"recovery_path,omitempty"`
}
