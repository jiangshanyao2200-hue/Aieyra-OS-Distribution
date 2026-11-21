// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: IDExpression; MaxArchiveBytes; idPattern; Record; Recovery; Path; NewPath; Encode; Append; Replay; ReplayMemory; replay
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/archive.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package sessionservice owns archive framing, durable append/recovery, and identity.
// Hosts own authorization, typed replay, attachment leases, and execution state.
package sessionservice

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const IDExpression = `^[a-f0-9]{32}$`
const MaxArchiveBytes = 256 << 20

var idPattern = regexp.MustCompile(IDExpression)

type Record struct {
	Kind  string          `json:"kind"`
	Value json.RawMessage `json:"value"`
	At    json.RawMessage `json:"at,omitempty"`
}
type Recovery struct {
	Truncated bool `json:"truncated"`
	Records   int  `json:"records"`
}

func Path(dir, id string) (string, error) {
	if dir == "" || !idPattern.MatchString(id) {
		return "", fmt.Errorf("会话编号无效")
	}
	return filepath.Join(dir, id+".jsonl"), nil
}
func NewPath(dir string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("缺少会话保存位置")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	return Path(dir, hex.EncodeToString(id[:]))
}
func Encode(kind string, value any) ([]byte, error) {
	return json.Marshal(struct {
		Kind  string `json:"kind"`
		Value any    `json:"value"`
		At    string `json:"at"`
	}{kind, value, time.Now().UTC().Format(time.RFC3339Nano)})
}

// Append is serialized by the owning archive lease. A failed append rolls back
// to the previous length; a caller must not publish a receipt before success.
func Append(path string, data []byte) error {
	if !json.Valid(data) {
		return fmt.Errorf("会话记录不是完整JSON")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	line := append(append([]byte(nil), data...), '\n')
	n, err := f.Write(line)
	if err == nil && n != len(line) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = f.Sync()
	}
	if err != nil {
		if rollback := f.Truncate(stat.Size()); rollback != nil {
			err = fmt.Errorf("%w; 会话回退失败: %v", err, rollback)
		}
		_ = f.Sync()
	}
	closed := f.Close()
	if err != nil {
		return err
	}
	return closed
}

// Replay validates each typed record before repairing a missing final delimiter.
// Only malformed unterminated tails may be backed up and removed; corruption in
// the middle or a typed-record rejection preserves the original bytes.
func Replay(path string, visit func(Record) error) (Recovery, error) {
	f, err := os.OpenFile(path, os.O_RDWR, 0600)
	if err != nil {
		return Recovery{}, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return Recovery{}, err
	}
	if stat.Size() > MaxArchiveBytes {
		return Recovery{}, fmt.Errorf("会话超过 256 MiB，暂不支持直接恢复")
	}
	return replay(f, f, path, visit)
}
func ReplayMemory(data []byte, visit func(Record) error) (Recovery, error) {
	return replay(bytes.NewReader(data), nil, "", visit)
}
func replay(input io.Reader, file *os.File, path string, visit func(Record) error) (out Recovery, err error) {
	reader := bufio.NewReader(input)
	var offset int64
	for lineNo := 1; ; lineNo++ {
		line, readErr := reader.ReadBytes('\n')
		if len(line) == 0 && readErr == io.EOF {
			return out, nil
		}
		if readErr != nil && readErr != io.EOF {
			return out, readErr
		}
		var record Record
		if json.Unmarshal(line, &record) != nil {
			if readErr == io.EOF && file != nil {
				if err = os.WriteFile(path+".interrupted-tail", line, 0600); err != nil {
					return out, err
				}
				if err = file.Truncate(offset); err != nil {
					return out, err
				}
				if err = file.Sync(); err != nil {
					return out, err
				}
				out.Truncated = true
				return out, nil
			}
			return out, fmt.Errorf("会话第 %d 行损坏，原文件已保留", lineNo)
		}
		if err = visit(record); err != nil {
			return out, fmt.Errorf("会话第 %d 行无法恢复: %w", lineNo, err)
		}
		out.Records++
		offset += int64(len(line))
		if readErr == io.EOF {
			if file != nil {
				if _, err = file.WriteAt([]byte{'\n'}, offset); err == nil {
					err = file.Sync()
				}
			}
			return out, err
		}
	}
}
