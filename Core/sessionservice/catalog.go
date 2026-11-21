// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MaxCatalogBytes; catalogFile; Identity; IdentifiedSession; Catalog; Validate; catalogBytes; catalogDigest; LoadCatalog; CommitCatalog
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

const MaxCatalogBytes = 32 << 20
const catalogFile = "sessions.json"

// Identity defines ownership independently of the host's projection, memory
// settings or provider state. Every archive version belongs to one session.
type Identity struct {
	ID       string
	Archive  string
	Versions []string
}
type IdentifiedSession interface{ SessionIdentity() Identity }

// Catalog preserves the existing v1 envelope. Each host supplies its typed
// session payload; this service owns identity checks and durable pointer writes.
type Catalog[S IdentifiedSession] struct {
	Version  int    `json:"version"`
	Revision uint64 `json:"revision"`
	Active   string `json:"active"`
	Sessions []S    `json:"sessions"`
}

func (c *Catalog[S]) Validate() error {
	if c == nil || c.Version != 1 || c.Revision == 0 || len(c.Sessions) == 0 {
		return fmt.Errorf("会话目录版本或修订无效，原文件已保留")
	}
	ids, archives := map[string]bool{}, map[string]string{}
	for _, entry := range c.Sessions {
		s := entry.SessionIdentity()
		if !idPattern.MatchString(s.ID) || ids[s.ID] {
			return fmt.Errorf("会话目录包含无效或重复标识")
		}
		ids[s.ID] = true
		for _, version := range append([]string{s.Archive}, s.Versions...) {
			if !idPattern.MatchString(version) || archives[version] != "" {
				return fmt.Errorf("会话档案版本无效或被重复引用，原文件已保留")
			}
			archives[version] = s.ID
		}
	}
	if !ids[c.Active] {
		return fmt.Errorf("当前会话记录缺失")
	}
	return nil
}

func catalogBytes(root *os.Root) ([]byte, error) {
	st, err := root.Lstat(catalogFile)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > MaxCatalogBytes {
		return nil, fmt.Errorf("会话目录不是普通文件或超过32 MiB，原件已保留")
	}
	f, err := root.Open(catalogFile)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxCatalogBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxCatalogBytes {
		return nil, fmt.Errorf("会话目录超过32 MiB，原件已保留")
	}
	return data, nil
}
func catalogDigest(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func LoadCatalog[S IdentifiedSession](directory string) (*Catalog[S], string, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, "", err
	}
	defer root.Close()
	data, err := catalogBytes(root)
	if err != nil {
		return nil, "", err
	}
	var c Catalog[S]
	if json.Unmarshal(data, &c) != nil {
		return nil, "", fmt.Errorf("会话目录无法读取，原文件已保留")
	}
	if err = c.Validate(); err != nil {
		return nil, "", err
	}
	return &c, catalogDigest(data), nil
}

// CommitCatalog requires the owner's lease and serialization. An empty digest
// means create only. Exact-byte comparison detects external replacement even
// when its revision is unchanged; it is not a filesystem CAS against writers
// that ignore the ownership lease. Failed commits leave the old pointer intact.
func CommitCatalog[S IdentifiedSession](directory string, c *Catalog[S], expected string) (string, error) {
	if err := c.Validate(); err != nil {
		return "", err
	}
	data, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	if len(data) > MaxCatalogBytes {
		return "", fmt.Errorf("会话目录超过32 MiB，原记录保留")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return "", err
	}
	defer root.Close()
	check := func() error {
		current, e := catalogBytes(root)
		if os.IsNotExist(e) && expected == "" {
			return nil
		}
		if e != nil {
			return e
		}
		if expected == "" || catalogDigest(current) != expected {
			return fmt.Errorf("会话目录已被外部修改，请重新打开；原文件已保留")
		}
		return nil
	}
	if err = check(); err != nil {
		return "", err
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return "", err
	}
	temp := ".catalog-" + hex.EncodeToString(nonce[:]) + ".tmp"
	f, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer root.Remove(temp)
	n, err := f.Write(data)
	if err == nil && n != len(data) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = f.Sync()
	}
	closed := f.Close()
	if err == nil {
		err = closed
	}
	if err != nil {
		return "", err
	}
	if err = check(); err != nil {
		return "", err
	}
	if err = root.Rename(temp, catalogFile); err != nil {
		return "", err
	}
	return catalogDigest(data), nil
}
