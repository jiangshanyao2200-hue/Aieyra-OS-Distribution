// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: moduleContext
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/cmd/aieyra-link/owner.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"regexp"
	"strconv"
	"time"
)

// 先验证活 OS 生命周期，再读取设备身份或启动任何网络服务。
func moduleContext(parent context.Context) (context.Context, func(), error) {
	port, err := strconv.Atoi(os.Getenv("AIEYRA_OS_OWNER_PORT"))
	token := os.Getenv("AIEYRA_OS_OWNER_TOKEN")
	if err != nil || port < 1 || port > 65535 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(token) {
		return nil, nil, fmt.Errorf("Link 是 Aieyra OS 内部模块，请先启动 Aieyra OS")
	}
	peer, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 3*time.Second)
	if err != nil {
		return nil, nil, fmt.Errorf("OS 生命周期连接不可用，请从 Aieyra OS 重新打开 Link")
	}
	peer.SetDeadline(time.Now().Add(3 * time.Second))
	_, err = io.WriteString(peer, token+"\n")
	var ack string
	if err == nil {
		ack, err = bufio.NewReader(io.LimitReader(peer, 128)).ReadString('\n')
	}
	if err != nil || ack != "aieyra-os-owner/1\n" {
		peer.Close()
		return nil, nil, fmt.Errorf("OS 生命周期验证失败")
	}
	peer.SetDeadline(time.Time{})
	ctx, cancel := context.WithCancel(parent)
	go func() { _, _ = io.Copy(io.Discard, peer); cancel() }()
	if os.Getenv("AIEYRA_OS_OWNER_STDIN") == "1" {
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); cancel() }()
	}
	return ctx, func() { cancel(); peer.Close() }, nil
}
