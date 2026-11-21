// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MaxRecordBytes; RecordFile; path; regular; Read; Write; ReadRecord; WriteRecord; LoadRecordDirectory
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/records.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

const MaxRecordBytes = 64 << 20

// RecordFile stores one immutable snapshot in an owner-supplied directory.
// The caller retains the domain lease, schema and authorization. This service
// neither creates another index nor rewrites a record while opening it.
type RecordFile struct {
	Directory string
	Name      string
	MaxBytes  int
}

func (s RecordFile) path() (string, error) {
	if s.Directory == "" || s.Name == "" || s.Name == "." || s.Name == ".." || strings.ContainsAny(s.Name, `/\:`) || s.MaxBytes < 1 || s.MaxBytes > MaxRecordBytes {
		return "", fmt.Errorf("invalid session record location or size limit")
	}
	return filepath.Join(s.Directory, s.Name), nil
}

func (s RecordFile) regular(path string) (os.FileInfo, error) {
	st, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > int64(s.MaxBytes) {
		return nil, fmt.Errorf("session record is not a bounded regular file; original retained")
	}
	return st, nil
}

func (s RecordFile) Read() ([]byte, error) {
	path, err := s.path()
	if err != nil {
		return nil, err
	}
	// A concurrent owner may publish between Lstat and OpenSnapshot. Retry only
	// that identity race; never follow a link or read bytes before validation.
	for attempt := 0; attempt < 3; attempt++ {
		before, err := s.regular(path)
		if err != nil {
			return nil, err
		}
		f, err := privatefile.OpenSnapshot(path)
		if err != nil {
			return nil, err
		}
		opened, err := f.Stat()
		if err != nil || !os.SameFile(before, opened) {
			f.Close()
			if err != nil {
				return nil, err
			}
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, int64(s.MaxBytes)+1))
		after, statErr := f.Stat()
		closed := f.Close()
		if err != nil {
			return nil, err
		}
		if statErr != nil {
			return nil, statErr
		}
		if closed != nil {
			return nil, closed
		}
		if len(data) > s.MaxBytes || int64(len(data)) != after.Size() || opened.Size() != after.Size() || !opened.ModTime().Equal(after.ModTime()) {
			return nil, fmt.Errorf("session record changed during reading or exceeds its limit; original retained")
		}
		return data, nil
	}
	return nil, fmt.Errorf("session record changed during opening; retry the read")
}

// Write requires the owner's existing lease. Replacement preserves readers'
// old snapshots on Windows as well as Unix; it never truncates the old file.
func (s RecordFile) Write(data []byte) error {
	path, err := s.path()
	if err != nil {
		return err
	}
	if len(data) > s.MaxBytes {
		return fmt.Errorf("session record exceeds its size limit; original retained")
	}
	if _, err = s.regular(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return privatefile.WriteSnapshot(path, data)
}

func ReadRecord[T any](s RecordFile, validate func(T) error) (T, error) {
	var record T
	data, err := s.Read()
	if err != nil {
		return record, err
	}
	if err = json.Unmarshal(data, &record); err != nil {
		return record, fmt.Errorf("session record JSON is damaged; original retained: %w", err)
	}
	if validate == nil {
		return record, fmt.Errorf("session record validator is required")
	}
	return record, validate(record)
}

func WriteRecord[T any](s RecordFile, record T, validate func(T) error) error {
	if validate == nil {
		return fmt.Errorf("session record validator is required")
	}
	if err := validate(record); err != nil {
		return err
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return s.Write(data)
}

// LoadRecordDirectory reads the authoritative records, in filename order.
// Selection and validation belong to the domain. No partial directory escapes
// on failure, so recovery cannot mutate earlier records before validation ends.
func LoadRecordDirectory[T any](directory string, maxBytes int, selectName func(string) bool, validate func(string, T) error) ([]T, error) {
	if selectName == nil || validate == nil {
		return nil, fmt.Errorf("session directory selector and validator are required")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	records := make([]T, 0)
	for _, entry := range entries {
		name := entry.Name()
		if !selectName(name) {
			continue
		}
		record, err := ReadRecord(RecordFile{Directory: directory, Name: name, MaxBytes: maxBytes}, func(record T) error { return validate(name, record) })
		if err != nil {
			return nil, fmt.Errorf("session directory record %s: %w", name, err)
		}
		records = append(records, record)
	}
	return records, nil
}
