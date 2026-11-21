// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: attachmentNoteMarker; historyAttachmentManifest; historyImageAttachments; historyUserDisplay; attachmentDisplay; historyAssistantDisplay; changesDisplay; artifactNoteRow; artifactNoteFiles
// Impact: python -B scripts/code-atlas.py show Core/history_display.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Default history shows what the user said and read. Host-authored wrappers
// that only instruct the model are projected to short Chinese text here; the
// receipt keeps the exact original. Only exact host formats are recognized.

const attachmentNoteMarker = "\n\n[User attachments: immutable local snapshots."

// Preview references remain subject to the desktop attachment store's path and
// content checks. Extract only bounded, complete image manifests from history.
func historyAttachmentManifest(text string) (int, []ComposerAttachment, bool) {
	i := strings.LastIndex(text, attachmentNoteMarker)
	if i < 0 {
		return 0, nil, false
	}
	rest := text[i+len(attachmentNoteMarker):]
	nl := strings.IndexByte(rest, '\n')
	if nl < 0 || !strings.HasSuffix(rest[:nl], "]") {
		return 0, nil, false
	}
	var items []ComposerAttachment
	raw := strings.TrimSpace(rest[nl+1:])
	decoder := json.NewDecoder(strings.NewReader(raw))
	if decoder.Decode(&items) != nil || len(items) == 0 || len(items) > 10 {
		return 0, nil, false
	}
	imageCount := 0
	for _, a := range items {
		if a.Kind == "image" {
			imageCount++
		}
	}
	tail := strings.TrimSpace(raw[decoder.InputOffset():])
	// Earlier text-only turns appended this host note to the original input.
	// Recognize that exact historical wrapper; new turns keep it in runtime
	// observations so the user's original and attachment identity stay intact.
	const legacyObservation = "Use view_image with an image asset path if you need to inspect it; no visual observation has happened yet."
	if tail == legacyObservation {
		tail = ""
	}
	if tail != "" && (imageCount == 0 || tail != fmt.Sprintf("[附图 %d 张]", imageCount)) {
		return 0, nil, false
	}
	return i, items, true
}

func historyImageAttachments(text string) []ComposerAttachment {
	_, items, ok := historyAttachmentManifest(text)
	if !ok {
		return nil
	}
	var images []ComposerAttachment
	for _, a := range items {
		decoded, err := hex.DecodeString(a.SHA256)
		if a.Kind == "file" && len(a.WebReference) > 0 && len(a.WebReference) <= 60000 && json.Valid(a.WebReference) && a.Name != "" && len(a.Name) <= 255 && a.Asset != "" && len(a.Asset) <= 32768 && err == nil && len(decoded) == 32 && a.Bytes > 0 && a.Bytes <= 60000 && a.MIME == "application/octet-stream" {
			images = append(images, a)
		}
		if a.Kind == "image" && a.Name != "" && len(a.Name) <= 1024 && a.Asset != "" && len(a.Asset) <= 32768 && err == nil && len(decoded) == 32 && a.Bytes > 0 && a.Bytes <= imageByteLimit && (a.MIME == "image/png" || a.MIME == "image/jpeg" || a.MIME == "image/gif" || a.MIME == "image/webp") {
			images = append(images, a)
		}
	}
	return images
}

// historyUserDisplay projects a user row read back from a durable original.
func historyUserDisplay(text string) (string, bool) {
	if shown, ok := askAnswerDisplay(text); ok {
		return shown, true
	}
	return attachmentDisplay(text)
}

// attachmentDisplay replaces the attachment manifest attachmentContent appends
// with the file names the user actually attached.
func attachmentDisplay(text string) (string, bool) {
	i, items, ok := historyAttachmentManifest(text)
	if !ok {
		return text, false
	}
	names := make([]string, 0, len(items))
	for _, a := range items {
		if a.Name != "" {
			names = append(names, a.Name)
		}
	}
	shown := strings.TrimRight(text[:i], " \n")
	if len(names) > 0 {
		if shown != "" {
			shown += "\n"
		}
		shown += "附件：" + strings.Join(names, "、")
	}
	return shown, true
}

// historyAssistantDisplay drops the tool-call lines the transcript appends
// after an assistant's own words; tool calls have their own history rows.
func historyAssistantDisplay(text string) (string, bool) {
	i := strings.Index(text, "\n→ 调用 ")
	if i < 0 {
		return text, false
	}
	return strings.TrimRight(text[:i], " \n"), true
}

// changesDisplay summarizes the file-change context note recordChanges leaves
// for the model.
func changesDisplay(m workspaceMessage) (string, bool) {
	// Recovery may mark an undelivered reference interrupted. Its provenance
	// and receipt content remain a file-change notice in every delivery state.
	if !m.Reference || m.From != WorkspaceMatrix || m.To != WorkspaceProject || !strings.HasPrefix(m.ID, "changes_") {
		return "", false
	}
	var note struct {
		Files []struct {
			Path    string `json:"path"`
			NewPath string `json:"new_path"`
		} `json:"files"`
	}
	if json.Unmarshal([]byte(m.Text), &note) != nil || len(note.Files) == 0 {
		return "", false
	}
	names := []string{}
	for _, f := range note.Files {
		name := f.Path
		if f.NewPath != "" && f.NewPath != f.Path {
			name = f.Path + " → " + f.NewPath
		}
		if name != "" && len(names) < 8 {
			names = append(names, name)
		}
	}
	shown := "Eyra 记录了文件变更：" + strings.Join(names, "、")
	if len(note.Files) > len(names) {
		shown += "等 " + strconv.Itoa(len(note.Files)) + " 个文件"
	}
	return shown, true
}

// Delivered files of a reply are kept in the memory transcript under their own
// session key, so history after a restart can still offer the file entries.
const (
	artifactNoteAgent  = "files"
	artifactNoteName   = "eyra_artifacts"
	artifactNoteHeader = "【交付文件】"
)

func artifactNoteRow(session string, pos int, m workspaceMessage) transcriptRow {
	lines := []string{artifactNoteHeader}
	for _, a := range m.Artifacts {
		lines = append(lines, a.Path)
	}
	at := time.Now()
	if t, err := time.Parse(time.RFC3339Nano, m.At); err == nil {
		at = t
	}
	return transcriptRow{Key: session + "/" + artifactNoteAgent, Pos: pos, At: at.UnixMilli(), Role: RoleAssistant, Name: artifactNoteName, Content: strings.Join(lines, "\n")}
}

// artifactNoteFiles reads a note written by artifactNoteRow.
func artifactNoteFiles(role, name, content string) ([]WorkspaceArtifact, bool) {
	if role != RoleAssistant || name != artifactNoteName || !strings.HasPrefix(content, artifactNoteHeader+"\n") {
		return nil, false
	}
	var files []WorkspaceArtifact
	for _, path := range strings.Split(strings.TrimPrefix(content, artifactNoteHeader+"\n"), "\n") {
		if path = strings.TrimSpace(path); path != "" {
			files = append(files, WorkspaceArtifact{Path: path, Kind: artifactKind(path)})
		}
	}
	return files, len(files) > 0
}
