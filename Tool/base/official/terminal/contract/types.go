package contract

type Command struct {
	Cmd             string            `json:"cmd"`
	Workdir         string            `json:"workdir,omitempty"`
	Shell           string            `json:"shell,omitempty"`
	Login           bool              `json:"login,omitempty"`
	TTY             bool              `json:"tty,omitempty"`
	Background      bool              `json:"background,omitempty"`
	YieldTimeMS     *int              `json:"yield_time_ms,omitempty"`
	MaxOutputTokens int               `json:"max_output_tokens,omitempty"`
	TimeoutMS       *int              `json:"timeout_ms,omitempty"`
	Description     string            `json:"description,omitempty"`
	Parallel        *bool             `json:"parallel,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
}

type Input struct {
	Description     string `json:"description,omitempty"` // Display metadata only; never changes the owned process or input bytes.
	SessionID       int    `json:"session_id"`
	Chars           string `json:"chars,omitempty"`
	PressEnter      bool   `json:"press_enter,omitempty"`
	YieldTimeMS     *int   `json:"yield_time_ms,omitempty"`
	MaxOutputTokens int    `json:"max_output_tokens,omitempty"`
	Terminate       bool   `json:"terminate,omitempty"`
}

type Read struct {
	Description     string `json:"description,omitempty"` // Display metadata only; never changes the retained log.
	SessionID       int    `json:"session_id"`
	Offset          int64  `json:"offset,omitempty"`
	MaxOutputTokens int    `json:"max_output_tokens,omitempty"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
