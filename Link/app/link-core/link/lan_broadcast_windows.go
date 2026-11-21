// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: enableLANBroadcast
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lan_broadcast_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"golang.org/x/sys/windows"
	"net"
)

func enableLANBroadcast(conn *net.UDPConn) error {
	raw, err := conn.SyscallConn()
	if err != nil {
		return err
	}
	var socketErr error
	if err = raw.Control(func(fd uintptr) {
		socketErr = windows.SetsockoptInt(windows.Handle(fd), windows.SOL_SOCKET, windows.SO_BROADCAST, 1)
	}); err != nil {
		return err
	}
	return socketErr
}
