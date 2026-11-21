// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: enableLANBroadcast
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lan_broadcast_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package link

import (
	"golang.org/x/sys/unix"
	"net"
)

func enableLANBroadcast(conn *net.UDPConn) error {
	raw, err := conn.SyscallConn()
	if err != nil {
		return err
	}
	var socketErr error
	if err = raw.Control(func(fd uintptr) { socketErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_BROADCAST, 1) }); err != nil {
		return err
	}
	return socketErr
}
