// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: requestBody
// Impact: python -B scripts/code-atlas.py show API/images/request.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"bytes"
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"mime/multipart"
	"path/filepath"
	"strconv"
)

func requestBody(input protocol.ImageRequest) ([]byte, string, error) {
	if input.Operation != "edit" {
		body, err := json.Marshal(struct {
			protocol.ImageRequest
			N int `json:"n"`
		}{input, 1})
		return body, "application/json", err
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fields := map[string]string{"model": input.Model, "prompt": input.Prompt, "n": "1", "size": input.Size, "quality": input.Quality, "output_format": input.OutputFormat}
	fields["background"], fields["moderation"], fields["input_fidelity"] = input.Background, input.Moderation, input.InputFidelity
	if input.OutputCompression != nil {
		fields["output_compression"] = strconv.Itoa(*input.OutputCompression)
	}
	for k, v := range fields {
		if v != "" {
			if err := w.WriteField(k, v); err != nil {
				return nil, "", err
			}
		}
	}
	add := func(field string, ref protocol.ImageEditInput) error {
		p, err := w.CreateFormFile(field, filepath.Base(ref.Path))
		if err == nil {
			_, err = p.Write(ref.Data)
		}
		return err
	}
	field := "image"
	if len(input.Images) > 1 {
		field = "image[]"
	}
	for _, ref := range input.Images {
		if err := add(field, ref); err != nil {
			return nil, "", err
		}
	}
	if input.Mask != nil {
		if err := add("mask", *input.Mask); err != nil {
			return nil, "", err
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), w.FormDataContentType(), nil
}
