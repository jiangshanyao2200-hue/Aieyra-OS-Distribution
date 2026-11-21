// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Ack; Open; Environment
// Impact: python -B scripts/code-atlas.py show Core/internal/osowner/lease.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package osowner keeps OS modules within the lifetime of their owning core.
package osowner

import (
	"bufio"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"net"
	"strconv"
	"sync"
	"time"
)

const Ack = "aieyra-os-owner/1\n"

// Open returns one bounded, authenticated loopback lease shared by the host and
// its modules. Closing it releases every connection, including pending handshakes.
func Open() (int, string, func(), error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, "", nil, err
	}
	var secret [32]byte
	if _, err = rand.Read(secret[:]); err != nil {
		listener.Close()
		return 0, "", nil, err
	}
	token := hex.EncodeToString(secret[:])
	var mu sync.Mutex
	peers := map[net.Conn]bool{}
	closed := false
	closeLease := func() {
		mu.Lock()
		defer mu.Unlock()
		if closed {
			return
		}
		closed = true
		listener.Close()
		for peer := range peers {
			peer.Close()
		}
	}
	go func() {
		for {
			peer, err := listener.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			if closed || len(peers) >= 64 {
				mu.Unlock()
				peer.Close()
				continue
			}
			peers[peer] = true
			mu.Unlock()
			go func() {
				defer func() { peer.Close(); mu.Lock(); delete(peers, peer); mu.Unlock() }()
				peer.SetDeadline(time.Now().Add(3 * time.Second))
				line, err := bufio.NewReader(io.LimitReader(peer, 128)).ReadString('\n')
				if err != nil || subtle.ConstantTimeCompare([]byte(line), []byte(token+"\n")) != 1 {
					return
				}
				if _, err = io.WriteString(peer, Ack); err != nil {
					return
				}
				peer.SetDeadline(time.Time{})
				_, _ = io.Copy(io.Discard, peer)
			}()
		}
	}()
	return listener.Addr().(*net.TCPAddr).Port, token, closeLease, nil
}

func Environment(base []string, port int, token string) []string {
	result := make([]string, 0, len(base)+2)
	for _, item := range base {
		if len(item) >= 16 && item[:16] == "AIEYRA_OS_OWNER_" {
			continue
		}
		result = append(result, item)
	}
	return append(result, "AIEYRA_OS_OWNER_PORT="+strconv.Itoa(port), "AIEYRA_OS_OWNER_TOKEN="+token)
}
