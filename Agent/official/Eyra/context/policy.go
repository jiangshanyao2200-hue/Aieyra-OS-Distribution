// Package contextpolicy implements Eyra's default PAC strategy.
package contextpolicy

import (
	"github.com/aieyra/aieyra-os/agent/context/history"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

const RecentUserLimit = history.RecentUserLimit

type Originals = history.Originals

func IsUserOriginal(m protocol.Message, prefix string) bool { return history.IsUserOriginal(m, prefix) }
func CompactCut(m []protocol.Message, n int, prefix string) int {
	return history.CompactCut(m, n, prefix)
}
func CompactWorkCut(m []protocol.Message, n int, emergency bool, prefix string) int {
	return history.CompactWorkCut(m, n, emergency, prefix)
}
func KeepUserOriginals(p *Originals, m []protocol.Message, r, s string) Originals {
	return history.KeepUserOriginals(p, m, r, s)
}
func Recall(m []protocol.Message, n int, q string, b int, p string) string {
	return history.Recall(m, n, q, b, p)
}
