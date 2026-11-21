package contract

type Request struct {
	Path        string   `json:"path,omitempty"`
	Paths       []string `json:"paths,omitempty"`
	Layout      string   `json:"layout,omitempty"`
	Detail      string   `json:"detail,omitempty"`
	Description string   `json:"description,omitempty"`
}

type Result struct {
	Observation          string   `json:"observation,omitempty"`
	ObservationSource    string   `json:"observation_source,omitempty"`
	ObservationModel     string   `json:"observation_model,omitempty"`
	ObservationLanguage  string   `json:"observation_language,omitempty"`
	ObservationTruncated bool     `json:"observation_truncated,omitempty"`
	Limitation           string   `json:"limitation,omitempty"`
	OK                   bool     `json:"ok"`
	State                string   `json:"state"`
	Path                 string   `json:"path"`
	Paths                []string `json:"paths,omitempty"`
	Layout               *Layout  `json:"layout,omitempty"`
	Description          string   `json:"description,omitempty"`
	Width                int      `json:"width,omitempty"`
	Height               int      `json:"height,omitempty"`
	MIME                 string   `json:"mime,omitempty"`
	ImageID              string   `json:"image_id,omitempty"`
	Detail               string   `json:"detail,omitempty"`
	Error                *Error   `json:"error,omitempty"`
}

type Tile struct {
	Index        int    `json:"index"`
	Path         string `json:"path"`
	X            int    `json:"x"`
	Y            int    `json:"y"`
	W            int    `json:"w"`
	H            int    `json:"h"`
	SourceWidth  int    `json:"source_width"`
	SourceHeight int    `json:"source_height"`
}

type Layout struct {
	Kind    string `json:"kind"`
	Columns int    `json:"columns"`
	Rows    int    `json:"rows"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Tiles   []Tile `json:"tiles"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
