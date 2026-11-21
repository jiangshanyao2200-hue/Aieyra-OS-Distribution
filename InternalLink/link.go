// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: InternalLink/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: Binding; Origin; Mailbox; Call; LogID; MessageRequest; maxHops; ValidateMessage; Valid; Stopped
// Impact: python -B scripts/code-atlas.py show InternalLink/link.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package internallink

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

type Binding struct {
	Scope  string `json:"scope"`
	Parent string `json:"parent"`
}

type Origin struct {
	Scope            string `json:"scope"`
	From             string `json:"from"`
	Generation       int    `json:"generation"`
	Kind             string `json:"kind"`
	Hops             int    `json:"hops"`
	TargetGeneration int    `json:"target_generation,omitempty"`
	ReplyGeneration  int    `json:"reply_generation,omitempty"`
}

type Mailbox struct {
	Actor           string `json:"actor"`
	ActorGeneration int    `json:"actor_generation"`
	Generation      int    `json:"generation"`
	StoppedThrough  int    `json:"stopped_through,omitempty"`
	Cursor          int64  `json:"cursor,omitempty"`
	Workdir         string `json:"workdir"`
	Name            string `json:"name"`
	State           string `json:"state,omitempty"`
}

type Call struct {
	Action, ID, Message, Cause, Brief string
	Contact                           string `json:"contact_id"`
	Request                           string `json:"request_id"`
	Generation                        int    `json:"generation"`
	After                             int64  `json:"after"`
}

func LogID(scope string) string {
	sum := sha256.Sum256([]byte("aieyra.core-link/" + scope))
	return hex.EncodeToString(sum[:16])
}

func MessageRequest(sender, request string) string {
	sum := sha256.Sum256([]byte(sender + "\x00" + request))
	return "core-link-" + hex.EncodeToString(sum[:])
}

const maxHops = 12

func ValidateMessage(request, text string, hops, textLimit int) error {
	switch {
	case request == "" || len(request) > 128:
		return errors.New("协作需要非空且不超过 128 字节的 request_id")
	case strings.TrimSpace(text) == "" || len(text) > textLimit:
		return errors.New("协作消息为空或超过长度上限")
	case hops > maxHops:
		return errors.New("本轮协作已达接力上限，请交回会话主角")
	default:
		return nil
	}
}

func (o Origin) Valid(validID func(string) bool, generation int) bool {
	return validID(o.Scope) && validID(o.From) && o.Generation >= 0 && o.Hops >= 0 &&
		o.Hops <= maxHops && generation >= 1 &&
		(o.Kind == "message" || o.Kind == "result" || o.Kind == "intervention")
}

func (b Mailbox) Stopped(o Origin) bool {
	generation := o.TargetGeneration
	if o.Kind == "result" && o.ReplyGeneration > 0 {
		generation = o.ReplyGeneration
	}
	return generation <= b.StoppedThrough
}
