// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationGroupsMu; groupMember; conversationGroup; groupMessage; groupDir; readGroupSnapshot; readGroup; coordinatorKey; coordinatorContact; groupChangeCoordinator; writeGroup; groupLog; groupLogs; groupLogPath; groupIndex; appendGroupMessage; groupMessages; groupRange; groupFindRequest; groupNote; member; groupNames; groupMentions; groupTimestamp; groupContactTemplate; createGroup; groupPermissions; groupPost; groupPostAttachments; groupDispatch; groupDeliver; groupAccepted; groupResume; groupWatch; groupSettle; groupFit; groupTurnWorked; groupReconcile; groupMemberKeys; groupLive; groupView; listGroups; groupPatch; groupCall; groupSetMembers; groupToolKey; groupToolContext; GroupToolDefinition; executeGroupTool; groupTurnDisplay
// Impact: python -B scripts/code-atlas.py show Core/conversation_groups.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Group chats: an OS-internal Link channel shared by several contacts. Messages
// carry an increasing seq like Link; @mentions decide who answers. Every member
// answers from its own group session, so contexts stay separate. The selected
// host receives unaddressed messages; old groups retain their Eyra instance. A member's backlog is
// delivered lazily on its next turn, so unaddressed members cost no request.
import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

var conversationGroupsMu sync.Mutex

const (
	groupHost          = "host"
	groupMemberLimit   = 30
	groupChainDepth    = 4
	groupChainReplies  = 12
	groupBacklogLimit  = 40
	groupDeliverBudget = 40 << 10
	groupViewPage      = 200
	groupMessageLimit  = 16 << 10
	groupPass          = "[PASS]"
	groupWatchInterval = 25000
)

type groupMember struct {
	Contact   string `json:"contact"`
	Session   string `json:"session"`
	Delivered int64  `json:"delivered"`
	Await     int    `json:"await,omitempty"`
	Pending   bool   `json:"pending,omitempty"`
	Chain     string `json:"chain,omitempty"`
	Depth     int    `json:"depth,omitempty"`
	Task      string `json:"task,omitempty"`
	TaskAt    string `json:"task_at,omitempty"`
	// A delivery about to be sent: saved first, so a turn the agent accepted is
	// found again by its request id even if the checkpoint after it failed.
	Sending     string `json:"sending,omitempty"`
	SendingUpto int64  `json:"sending_upto,omitempty"`
	SendingMore bool   `json:"sending_more,omitempty"`
}

type conversationGroup struct {
	ManagedProgram string                `json:"managed_program,omitempty"`
	ProgramMembers map[string]string     `json:"program_members,omitempty"`
	LinkScope      string                `json:"link_scope,omitempty"`
	LinkReleased   map[string]int        `json:"link_released,omitempty"`
	WorkspaceLink  *workspaceLinkMailbox `json:"workspace_link,omitempty"`
	ID             string                `json:"id"`
	Name           string                `json:"name"`
	CreatedBy      string                `json:"created_by,omitempty"`
	Created        string                `json:"created"`
	Deleted        bool                  `json:"deleted,omitempty"`
	Seq            int64                 `json:"seq"`
	Host           groupMember           `json:"host"`
	HostContact    string                `json:"host_contact,omitempty"`
	Coordinator    string                `json:"coordinator,omitempty"` // stable participant key; changing host never relabels history
	CreationHash   string                `json:"creation_hash,omitempty"`
	Members        []groupMember         `json:"members"`
	Chains         map[string]int        `json:"chains,omitempty"`
}

type groupMessage struct {
	Attachments      []ComposerAttachment  `json:"attachments,omitempty"`
	To               string                `json:"to,omitempty"`
	TargetGeneration int                   `json:"target_generation,omitempty"`
	SenderGeneration int                   `json:"sender_generation,omitempty"`
	Hops             int                   `json:"hops,omitempty"`
	ReplyGeneration  int                   `json:"reply_generation,omitempty"`
	Seq              int64                 `json:"seq"`
	From             string                `json:"from"`
	Name             string                `json:"name"`
	Text             string                `json:"text"`
	Brief            string                `json:"brief,omitempty"`
	Kind             string                `json:"kind"`
	Mentions         []string              `json:"mentions,omitempty"`
	At               string                `json:"at"`
	Request          string                `json:"request,omitempty"`
}

func (m *AgentManager) groupDir() string { return filepath.Join(m.dir, "groups") }

// Admission may read while holding AgentManager.mu, outside the group writer
// lock. Keep an immutable shared-delete snapshot so Windows replacement never
// invalidates an admitted reader or requires reversing that lock order.
func readGroupSnapshot(path string) ([]byte, error) {
	f, err := privatefile.OpenSnapshot(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

func (m *AgentManager) readGroup(id string) (*conversationGroup, error) {
	if !childPromptID.MatchString(id) {
		return nil, fmt.Errorf("群聊标识无效")
	}
	data, err := readGroupSnapshot(filepath.Join(m.groupDir(), id+".json"))
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("群聊不存在")
	}
	if err != nil {
		return nil, err
	}
	g := &conversationGroup{}
	if err = json.Unmarshal(data, g); err != nil {
		return nil, fmt.Errorf("群聊记录损坏")
	}
	if g.ID != id || g.LinkScope != "" && !sessionIDPattern.MatchString(g.LinkScope) || g.Coordinator != "" && g.member(g.Coordinator) == nil {
		return nil, fmt.Errorf("群聊身份或主持记录损坏")
	}
	if g.Deleted {
		return nil, fmt.Errorf("群聊已删除")
	}
	if g.LinkScope != "" && g.WorkspaceLink == nil {
		// The group's one committed coordinator pointer also owns its Link.
		// Resolve it at read time, avoiding a second metadata commit on handoff.
		data, e := readGroupSnapshot(filepath.Join(m.groupDir(), g.LinkScope+".json"))
		if e == nil {
			var source conversationGroup
			if json.Unmarshal(data, &source) != nil || source.ID != g.LinkScope || source.LinkScope != "" || source.Deleted || source.member(source.coordinatorKey()) == nil {
				return nil, fmt.Errorf("协作所属群聊记录不可用")
			}
			g.Host.Session = source.member(source.coordinatorKey()).Session
		} else if !os.IsNotExist(e) {
			return nil, e
		}
	}
	return g, nil
}

func (g *conversationGroup) coordinatorKey() string {
	if g.Coordinator != "" {
		return g.Coordinator
	}
	return groupHost
}

func (g *conversationGroup) coordinatorContact() string {
	if g.coordinatorKey() == groupHost {
		return g.HostContact
	}
	return g.Coordinator
}

// Change only routing authority, retaining every participant's session and
// historical sender key. The common group lock serializes posts and handoffs.
func (m *AgentManager) groupChangeCoordinator(g *conversationGroup, contact string, expected *string) error {
	if expected == nil || *expected != g.coordinatorContact() {
		return fmt.Errorf("群主持已变化，请刷新后重试")
	}
	key := contact
	if contact == g.HostContact {
		key = groupHost
	}
	if g.member(key) == nil {
		return fmt.Errorf("请先把新主持加入群聊，再选择主持")
	}
	if contact != "" {
		c, sessions, err := m.liveContact(contact)
		if err != nil {
			return err
		}
		_, err = m.groupContactTemplate(c, sessions)
		if err != nil {
			return err
		}
	}
	for _, member := range append([]groupMember{g.Host}, g.Members...) {
		if member.Pending || member.Await > 0 || member.Sending != "" {
			return fmt.Errorf("请等成员消息交付完成后更换主持")
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range m.jobs {
		r := job.record
		if r.Spec.GroupID != g.ID && (r.Link == nil || r.Link.Scope != g.ID) {
			continue
		}
		if activeAgent(r.State) || len(r.PendingMessages) > 0 {
			return fmt.Errorf("请等本群协作任务完成后更换主持")
		}
		select {
		case <-job.done:
		default:
			return errAgentFinishing
		}
	}
	g.Coordinator = key
	return nil
}

func (m *AgentManager) writeGroup(g *conversationGroup) error {
	if err := os.MkdirAll(m.groupDir(), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(g, "", " ")
	if err != nil {
		return err
	}
	return privatefile.WriteSnapshot(filepath.Join(m.groupDir(), g.ID+".json"), data)
}

// The message file is the commit point. groupLog indexes it in memory:
// offsets[i] is where seq i+1 starts. The index follows the file, so a line
// written before a failed metadata write is adopted instead of reused, and a
// torn tail from an interrupted write stays outside until it is overwritten.
type groupLog struct {
	size    int64
	offsets []int64
	rounds  []int64 // request seq per message; reconstructed from the original log
	// Every request id ever committed, so a retry is recognised however late it comes.
	requests map[string]int64
}

var groupLogs = map[string]*groupLog{} // guarded by conversationGroupsMu

func (m *AgentManager) groupLogPath(id string) string {
	return filepath.Join(m.groupDir(), id+".jsonl")
}

func (m *AgentManager) groupIndex(g *conversationGroup) (*groupLog, error) {
	path := m.groupLogPath(g.ID)
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		groupLogs[path] = &groupLog{requests: map[string]int64{}}
		g.Seq = 0
		return groupLogs[path], nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	ix := groupLogs[path]
	if ix == nil || st.Size() < ix.size {
		ix = &groupLog{requests: map[string]int64{}}
		groupLogs[path] = ix
	}
	if st.Size() > ix.size {
		if _, err = f.Seek(ix.size, io.SeekStart); err != nil {
			return nil, err
		}
		r, at := bufio.NewReaderSize(f, 64<<10), ix.size
		for {
			line, err := r.ReadBytes('\n')
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, err
			}
			// Only the next seq counts: a duplicate left by an older build is skipped.
			var head struct {
				Seq     int64  `json:"seq"`
				Request string `json:"request"`
				From    string `json:"from"`
			}
			if json.Unmarshal(line, &head) == nil && head.Seq == int64(len(ix.offsets))+1 {
				ix.offsets = append(ix.offsets, at)
				ix.addRound(head.Seq, head.From)
				if head.Request != "" {
					ix.requests[head.Request] = head.Seq
				}
			}
			at += int64(len(line))
		}
		ix.size = at
	}
	g.Seq = int64(len(ix.offsets))
	return ix, nil
}

// appendGroupMessage commits one line; the metadata only mirrors the seq.
func (m *AgentManager) appendGroupMessage(g *conversationGroup, msg groupMessage) (groupMessage, error) {
	if err := os.MkdirAll(m.groupDir(), 0700); err != nil {
		return msg, err
	}
	ix, err := m.groupIndex(g)
	if err != nil {
		return msg, err
	}
	msg.Seq, msg.At = g.Seq+1, time.Now().UTC().Format(time.RFC3339Nano)
	line, err := json.Marshal(msg)
	if err != nil {
		return msg, err
	}
	f, err := os.OpenFile(m.groupLogPath(g.ID), os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return msg, err
	}
	if err = f.Truncate(ix.size); err == nil {
		_, err = f.WriteAt(append(line, '\n'), ix.size)
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return msg, err
	}
	ix.offsets = append(ix.offsets, ix.size)
	ix.addRound(msg.Seq, msg.From)
	ix.size += int64(len(line)) + 1
	if msg.Request != "" {
		ix.requests[msg.Request] = msg.Seq
	}
	g.Seq = msg.Seq
	// The line is committed; a failed metadata write is caught up by the next read.
	_ = m.writeGroup(g)
	return msg, nil
}

// groupMessages reads every message after a seq.
func (m *AgentManager) groupMessages(g *conversationGroup, after int64) ([]groupMessage, error) {
	return m.groupRange(g, after, -1)
}

// groupRange reads after < seq <= upto (upto < 0: to the end) through the index.
func (m *AgentManager) groupRange(g *conversationGroup, after, upto int64) ([]groupMessage, error) {
	ix, err := m.groupIndex(g)
	if err != nil {
		return nil, err
	}
	n := int64(len(ix.offsets))
	if upto < 0 || upto > n {
		upto = n
	}
	after = max(0, after)
	out := []groupMessage{}
	if after >= upto {
		return out, nil
	}
	start, end := ix.offsets[after], ix.size
	if upto < n {
		end = ix.offsets[upto]
	}
	f, err := os.Open(m.groupLogPath(g.ID))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, end-start)
	if _, err = f.ReadAt(buf, start); err != nil && err != io.EOF {
		return nil, err
	}
	last := after
	for _, line := range bytes.Split(buf, []byte{'\n'}) {
		var msg groupMessage
		if len(line) > 0 && json.Unmarshal(line, &msg) == nil && msg.Seq == last+1 && msg.Seq <= upto {
			out = append(out, msg)
			last = msg.Seq
		}
	}
	return out, nil
}

// groupFindRequest returns the message committed under a request id.
func (m *AgentManager) groupFindRequest(g *conversationGroup, request string) (groupMessage, bool, error) {
	if request == "" {
		return groupMessage{}, false, nil
	}
	ix, err := m.groupIndex(g)
	if err != nil {
		return groupMessage{}, false, err
	}
	seq, ok := ix.requests[request]
	if !ok {
		return groupMessage{}, false, nil
	}
	found, err := m.groupRange(g, seq-1, seq)
	if err != nil || len(found) != 1 || found[0].Request != request {
		return groupMessage{}, false, err
	}
	return found[0], true, nil
}

// groupNote posts a system line once per request id.
func (m *AgentManager) groupNote(g *conversationGroup, text, request string) error {
	if _, ok, err := m.groupFindRequest(g, request); err != nil || ok {
		return err
	}
	_, err := m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: text, Request: request})
	return err
}

func (g *conversationGroup) member(key string) *groupMember {
	if key == groupHost {
		return &g.Host
	}
	for i := range g.Members {
		if g.Members[i].Contact == key {
			return &g.Members[i]
		}
	}
	return nil
}

// names maps each participant key to its current display name.
func (m *AgentManager) groupNames(g *conversationGroup) map[string]string {
	names := map[string]string{groupHost: "Eyra"}
	if g.HostContact != "" {
		if c, _, err := m.liveContact(g.HostContact); err == nil {
			names[groupHost] = m.contactView(c, nil)["name"].(string)
		}
	}
	m.mu.Lock()
	sessions := m.contactSessionsLocked()
	m.mu.Unlock()
	for _, member := range g.Members {
		c, _ := m.readContact(member.Contact)
		name := c.Name
		if builtinConversationRole(c.Builtin) != "" {
			name = m.builtinProfile(c).Name
		}
		if name == "" && len(sessions[member.Contact]) > 0 {
			name = sessions[member.Contact][0].Spec.Title
		}
		if name == "" {
			name = "智能体"
		}
		names[member.Contact] = name
	}
	return names
}

// groupMentions finds @name references; longer names win so "@小橘猫" is not "@小橘".
func groupMentions(text string, names map[string]string, self string, coordinator ...string) []string {
	type entry struct{ key, name string }
	entries := []entry{}
	for key, name := range names {
		entries = append(entries, entry{key, name})
	}
	host := groupHost
	if len(coordinator) > 0 {
		host = coordinator[0]
	}
	entries = append(entries, entry{host, "主持"})
	sort.Slice(entries, func(i, j int) bool {
		return utf8.RuneCountInString(entries[i].name) > utf8.RuneCountInString(entries[j].name)
	})
	found := []string{}
	rest := text
	for _, e := range entries {
		token := "@" + e.name
		if strings.Contains(rest, token) {
			rest = strings.ReplaceAll(rest, token, " ")
			if e.key != self && !slices.Contains(found, e.key) {
				found = append(found, e.key)
			}
		}
	}
	return found
}

func groupTimestamp(at string) string {
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return ""
	}
	return t.Local().Format("15:04")
}

// Resolve the current model for group admission without changing the contact's
// inherited default. Each later turn still resolves the contact and any session
// override at its own send boundary.
func (m *AgentManager) groupContactTemplate(c conversationContact, sessions []AgentRecord) (AgentRecord, error) {
	r, err := m.contactSessionTemplate(c, sessions)
	if err != nil {
		return r, err
	}
	if r.Spec.ModelID == "" {
		r.Spec.ModelID, err = m.programModel(c)
		if err != nil {
			return r, err
		}
	}
	if _, err = m.specSettings(r.Spec); err != nil {
		return r, err
	}
	return r, nil
}

func (m *AgentManager) createGroup(ctx context.Context, name string, contacts []string, requestID string, hostContacts ...string) (*conversationGroup, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > contactNameLimit {
		return nil, fmt.Errorf("群名需要 1 到 %d 字", contactNameLimit)
	}
	if len(contacts) < 1 || len(contacts) > groupMemberLimit {
		return nil, fmt.Errorf("群聊需要 1 到 %d 位成员", groupMemberLimit)
	}
	if requestID == "" || len(requestID) > 96 {
		return nil, fmt.Errorf("request_id 无效")
	}
	hostContact := ""
	if len(hostContacts) > 0 {
		hostContact = hostContacts[0]
	}
	canonical := []string{}
	for _, id := range contacts {
		c, _, err := m.liveContact(id)
		if err != nil {
			return nil, err
		}
		canonical = append(canonical, c.ID)
	}
	sort.Strings(canonical)
	canonical = slices.Compact(canonical)
	if hostContact != "" {
		c, _, err := m.liveContact(hostContact)
		if err != nil {
			return nil, err
		}
		hostContact = c.ID
		if !slices.Contains(canonical, hostContact) {
			return nil, fmt.Errorf("主持必须是选中的联系人")
		}
	}
	fingerprint := taskMessageHash(string(rawJSON(map[string]any{"name": name, "members": canonical, "host_contact": hostContact})))
	id := taskMessageHash("group:" + requestID)[:32]
	managed := ""
	if id == codingScopeID() {
		trusted, _ := ctx.Value(codingGroupCreateKey{}).(bool)
		if !trusted || hostContact != builtinContactID("cota") {
			return nil, fmt.Errorf("Coding 固定会话只能由程序登记")
		}
		managed = "coding"
	}
	if g, err := m.readGroup(id); err == nil {
		if g.CreationHash != "" && g.CreationHash != fingerprint || g.HostContact != hostContact {
			return nil, fmt.Errorf("request_id conflict")
		}
		return g, nil
	}
	// Validate every selected role before creating any member record.
	for _, id := range canonical {
		c, sessions, err := m.liveContact(id)
		if err != nil {
			return nil, err
		}
		_, err = m.groupContactTemplate(c, sessions)
		if err != nil {
			return nil, err
		}
	}
	g := &conversationGroup{ID: id, ManagedProgram: managed, Name: name, HostContact: hostContact, CreationHash: fingerprint, CreatedBy: conversationCaller(ctx), Created: time.Now().UTC().Format(time.RFC3339Nano), Chains: map[string]int{}}
	model := ""
	if s, err := Load(m.config); err == nil {
		model = s.defaultMotherModel()
	}
	seen := map[string]bool{}
	for _, raw := range contacts {
		c, sessions, err := m.liveContact(raw)
		if err != nil {
			return nil, err
		}
		if seen[c.ID] {
			continue
		}
		seen[c.ID] = true
		latest, err := m.groupContactTemplate(c, sessions)
		if err != nil {
			return nil, err
		}
		if model == "" {
			model = latest.Spec.ModelID
		}
		r, err := m.Create(groupPermissions(ctx), m.owner, AgentSpec{Kind: "conversation", ProfileID: c.ID, GroupID: id, RequestID: "group:" + id + ":" + c.ID,
			ModelID: latest.Spec.ModelID, ModelParameters: latest.Spec.ModelParameters, Title: m.contactView(c, sessions)["name"].(string), Workdir: latest.Spec.Workdir, Tools: append(slices.Clone(latest.Spec.Tools), "group")})
		if err != nil {
			return nil, err
		}
		if c.ID == hostContact {
			g.Host = groupMember{Contact: groupHost, Session: r.ID}
		} else {
			g.Members = append(g.Members, groupMember{Contact: c.ID, Session: r.ID})
		}
	}
	var err error
	if hostContact == "" {
		workdir := filepath.Join(m.dir, "files")
		if err := os.MkdirAll(workdir, 0700); err != nil {
			return nil, err
		}
		host, err := m.Create(groupPermissions(ctx), m.owner, AgentSpec{Kind: "conversation", GroupID: id, RequestID: "group:" + id + ":host", ModelID: model,
			Title: "Eyra", Prompt: runtimePrompt("子代/模板/群主持.txt"), Workdir: workdir, Tools: []string{"group"}})
		if err != nil {
			return nil, err
		}
		g.Host = groupMember{Contact: groupHost, Session: host.ID}

	}
	if err = m.writeGroup(g); err != nil {
		return nil, err
	}
	names := m.groupNames(g)
	list := []string{}
	for _, member := range g.Members {
		list = append(list, names[member.Contact])
	}
	_, err = m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: "群聊已创建：" + names[groupHost] + " 主持，成员 " + strings.Join(list, "、") + "。"})
	return g, err
}

func groupPermissions(ctx context.Context) context.Context {
	return WithToolPermissions(ctx, append(conversationCapabilities(), "group"))
}

// post appends a message and starts the turns it addresses. A request id makes
// it idempotent: the same request returns the committed message and re-runs its
// deliveries, which are themselves idempotent; different text is a conflict.
func (m *AgentManager) groupPost(g *conversationGroup, from, text, kind, chain string, depth int, request string) (groupMessage, error) {
	return m.groupPostAttachments(g, from, text, kind, chain, depth, request, nil)
}

func (m *AgentManager) groupPostAttachments(g *conversationGroup, from, text, kind, chain string, depth int, request string, attachments []ComposerAttachment) (groupMessage, error) {
	text = strings.TrimSpace(text)
	if (text == "" && len(attachments) == 0) || len(text) > groupMessageLimit || !utf8.ValidString(text) {
		return groupMessage{}, fmt.Errorf("消息为空或过长")
	}
	old, done, err := m.groupFindRequest(g, request)
	if err != nil {
		return groupMessage{}, err
	}
	if done {
		if old.From != from || attachmentMessageHash(old.Text, old.Attachments) != attachmentMessageHash(text, attachments) {
			return old, fmt.Errorf("request_id conflict")
		}
		return old, m.groupDispatch(g, old, chain, depth)
	}
	if len(attachments) > 0 {
		settings, e := Load(m.config)
		if e != nil {
			return groupMessage{}, e
		}
		if _, e = prepareComposerAttachments(m.config, attachments, m.conversationImageSettings(settings)); e != nil {
			return groupMessage{}, e
		}
	}
	names := m.groupNames(g)
	name := names[from]
	switch from {
	case "user":
		name = "你"
	case "eyra":
		name = "Eyra（主会话）"
	}
	targets := groupMentions(text, names, from, g.coordinatorKey())
	if len(targets) == 0 && from == "user" {
		// Freeze the recipient in the durable message. Retrying after a host
		// change must not deliver an old user message to the new coordinator.
		targets = []string{g.coordinatorKey()}
	}
	msg, err := m.appendGroupMessage(g, groupMessage{From: from, Name: name, Text: text, Kind: kind, Mentions: targets, Request: request, Attachments: append([]ComposerAttachment(nil), attachments...)})
	if err != nil {
		return msg, err
	}
	return msg, m.groupDispatch(g, msg, chain, depth)
}

func (m *AgentManager) groupDispatch(g *conversationGroup, msg groupMessage, chain string, depth int) error {
	targets := msg.Mentions
	if len(targets) == 0 && msg.From == "user" {
		targets = []string{groupHost}
	}
	if chain == "" {
		chain = fmt.Sprintf("%s:%d", g.ID, msg.Seq)
	}
	for _, key := range targets {
		if g.Chains[chain] >= groupChainReplies || depth > groupChainDepth {
			return m.groupNote(g, "这一轮讨论已到自动接力上限，需要继续时请点名成员。", "limit:"+chain)
		}
		if err := m.groupDeliver(g, key, msg, chain, depth); err != nil {
			return err
		}
	}
	return nil
}

// groupDeliver starts one member turn with its unseen backlog, or marks it pending while busy.
func (m *AgentManager) groupDeliver(g *conversationGroup, key string, trigger groupMessage, chain string, depth int) error {
	member := g.member(key)
	if member == nil {
		return nil
	}
	if key != groupHost {
		if c, err := m.readContact(key); err != nil || c.Deleted {
			return nil
		}
	}
	r, err := m.Status(m.owner, member.Session)
	if err != nil {
		return err
	}
	if activeAgent(r.State) || member.Await > 0 {
		member.Pending, member.Chain, member.Depth = true, chain, depth
		return m.writeGroup(g)
	}
	backlog, err := m.groupMessages(g, member.Delivered)
	if err != nil {
		return err
	}
	// The backlog goes out oldest first in pages that fit one request; whatever
	// does not fit stays queued for the next turn, so no instruction is dropped.
	lines, delivered, budget, more := []string{}, member.Delivered, groupDeliverBudget, 0
	var attachments []ComposerAttachment
	for i, msg := range backlog {
		if msg.Kind == "brief" {
			delivered = msg.Seq
			continue
		}
		// Keep attachment labels local to one original message. A second set
		// starts the next durable delivery page; no files are silently dropped.
		if msg.From != key && len(msg.Attachments) > 0 && len(attachments) > 0 {
			more = len(backlog) - i
			break
		}
		line := ""
		if msg.From != key {
			line = fmt.Sprintf("[%s] %s：%s", groupTimestamp(msg.At), msg.Name, msg.Text)
		}
		if line != "" && len(lines) > 0 && (len(lines) >= groupBacklogLimit || len(line)+1 > budget) {
			more = len(backlog) - i
			break
		}
		delivered = msg.Seq
		if msg.From != key && len(msg.Attachments) > 0 {
			attachments = append(attachments, msg.Attachments...)
		}
		if line != "" {
			lines, budget = append(lines, line), budget-len(line)-1
		}
	}
	if len(lines) == 0 {
		// Nothing new for this member: it is no longer queued.
		if delivered != member.Delivered || member.Pending {
			member.Delivered, member.Pending = delivered, false
			return m.writeGroup(g)
		}
		return nil
	}
	if more > 0 {
		lines = append(lines, fmt.Sprintf("（后面还有 %d 条群消息，这一轮结束后接着送达；也可以用 group read 先看。）", more))
	}
	names := m.groupNames(g)
	roster := []string{}
	for _, x := range append([]groupMember{g.Host}, g.Members...) {
		name := names[x.Contact]
		if x.Contact == g.coordinatorKey() {
			name += "（主持）"
		}
		roster = append(roster, name)
	}
	if g.ManagedProgram == "coding" {
		project, e := m.readCodingProject()
		if e != nil {
			return e
		}
		if project.Root != "" {
			project.GenerationFloor = nil // Operation display boundaries are not user context.
			lines = append(lines, "[Coding 用户工作区状态] "+string(rawJSON(project)))
		}
	}
	message := formatPromptText(runtimePrompt("子代/模板/群聊.txt"), g.Name, names[key], strings.Join(roster, "、"), strings.Join(lines, "\n"))
	// The id names the page, so a retry after a lost metadata write reuses the
	// committed turn and takes its real generation from the agent's receipt.
	request := fmt.Sprintf("group:%s:%d:%s", g.ID, delivered, key)
	member.Sending, member.SendingUpto, member.SendingMore = request, delivered, more > 0
	member.Chain, member.Depth = chain, depth
	member.Task, member.TaskAt = trigger.Text, trigger.At
	if err = m.writeGroup(g); err != nil {
		member.Sending, member.SendingUpto, member.SendingMore = "", 0, false
		return err
	}
	rec, err := m.sendGenerationAttachments(m.owner, member.Session, request, message, attachmentMessageHash(message, attachments), r.Generation, attachments)
	if err != nil {
		member.Sending, member.SendingUpto, member.SendingMore = "", 0, false
		_ = m.writeGroup(g)
		return err
	}
	generation := rec.TurnGenerations[request]
	if generation == 0 {
		generation = r.Generation + 1
	}
	return m.groupAccepted(g, key, generation)
}

// groupAccepted records a delivered turn and starts waiting for its reply.
func (m *AgentManager) groupAccepted(g *conversationGroup, key string, generation int) error {
	member := g.member(key)
	member.Delivered, member.Await, member.Pending = member.SendingUpto, generation, member.SendingMore
	member.Sending, member.SendingUpto, member.SendingMore = "", 0, false
	if g.Chains == nil || len(g.Chains) > 200 {
		g.Chains = map[string]int{}
	}
	g.Chains[member.Chain]++
	if err := m.writeGroup(g); err != nil {
		return err
	}
	go m.groupWatch(g.ID, key, member.Session, member.Await)
	return nil
}

// groupResume finishes a delivery whose checkpoint was lost: the agent's own
// receipt says whether the turn was accepted; if not, it is sent again.
func (m *AgentManager) groupResume(g *conversationGroup, key string) error {
	member := g.member(key)
	if member == nil || member.Sending == "" || member.Await > 0 {
		return nil
	}
	r, err := m.Status(m.owner, member.Session)
	if err != nil {
		return err
	}
	if generation, ok := r.TurnGenerations[member.Sending]; ok {
		return m.groupAccepted(g, key, generation)
	}
	chain, depth, task := member.Chain, member.Depth, groupMessage{Text: member.Task, At: member.TaskAt}
	member.Sending, member.SendingUpto, member.SendingMore = "", 0, false
	return m.groupDeliver(g, key, task, chain, depth)
}

// groupWatch waits for one delivered turn and posts its reply into the group.
func (m *AgentManager) groupWatch(group, key, session string, generation int) {
	for m.ctx.Err() == nil {
		r, err := m.Wait(m.ctx, m.owner, session, groupWatchInterval)
		if err != nil {
			return
		}
		if r.Generation >= generation && !activeAgent(r.State) {
			conversationGroupsMu.Lock()
			if g, err := m.readGroup(group); err == nil {
				_ = m.groupSettle(g, key)
			}
			conversationGroupsMu.Unlock()
			return
		}
	}
}

// groupSettle is idempotent: reads and restarts call it to recover finished turns.
func (m *AgentManager) groupSettle(g *conversationGroup, key string) error {
	member := g.member(key)
	if member == nil {
		return nil
	}
	r, err := m.Status(m.owner, member.Session)
	if err != nil || activeAgent(r.State) || r.Generation < member.Await {
		return err
	}
	if member.Await == 0 && r.ChatRetryAttempt == 0 {
		return nil
	}
	// Publish first, then release the wait: the result carries a request id, so a
	// settle interrupted in between finds it committed and does not post twice.
	chain, depth, request := member.Chain, member.Depth, fmt.Sprintf("result:%s:%d", member.Session, member.Await)
	if r.ChatRetryAttempt > 0 {
		request = fmt.Sprintf("result:%s:%d:retry:%d", member.Session, r.Generation, r.ChatRetryAttempt)
		if _, committed, err := m.groupFindRequest(g, request); err != nil || committed {
			return err
		}
		if r.State == "interrupted" || member.Await == 0 && strings.TrimSpace(r.Result) == groupPass {
			return nil
		}
	}
	full, err := m.conversationResult(r.ID, r.Generation, r.Result)
	if err != nil {
		return err
	}
	text := strings.TrimSpace(full)
	if r.State != "completed" {
		reason := map[string]string{"cancelled": "已停止"}[r.State]
		if reason == "" {
			reason = "没有完成：" + clipRunes(m.redact(r.Error), 160)
		}
		err = m.groupNote(g, m.groupNames(g)[key]+" "+reason, request)
	} else if text != "" && text != groupPass {
		kind := "chat"
		if groupTurnWorked(r) {
			kind = "result"
		}
		_, err = m.groupPost(g, key, groupFit(m.redact(text), m.groupNames(g)[key]), kind, chain, depth+1, request)
	}
	if err != nil {
		return err
	}
	if member = g.member(key); member == nil {
		return m.writeGroup(g)
	}
	if member.Await == 0 {
		return nil
	}
	member.Await, member.Task, member.TaskAt = 0, "", ""
	if err = m.writeGroup(g); err != nil {
		return err
	}
	if member.Pending {
		return m.groupDeliver(g, key, groupMessage{Text: "（新的群消息）"}, member.Chain, member.Depth)
	}
	return nil
}

// groupFit keeps a result within one group message. A longer one is shown from
// its start and says plainly where the whole text is: the member's own session.
func groupFit(text, name string) string {
	if len(text) <= groupMessageLimit {
		return text
	}
	note := fmt.Sprintf("\n\n……（结果共 %d 字，这里只显示开头；完整内容在 %s 的私聊里。）", utf8.RuneCountInString(text), name)
	keep := groupMessageLimit - len(note)
	for keep > 0 && !utf8.RuneStart(text[keep]) {
		keep--
	}
	return strings.TrimRight(text[:keep], " \n") + note
}

// A turn that needed more than one model request used tools: it is working, not just replying.
func groupTurnWorked(r AgentRecord) bool { return r.Requests-r.TurnRequestBase > 1 }

func (m *AgentManager) groupReconcile(g *conversationGroup) {
	for _, key := range append([]string{groupHost}, groupMemberKeys(g)...) {
		_ = m.groupResume(g, key)
		_ = m.groupSettle(g, key)
	}
}

func groupMemberKeys(g *conversationGroup) []string {
	out := []string{}
	for _, member := range g.Members {
		out = append(out, member.Contact)
	}
	return out
}

func (m *AgentManager) groupLive(member groupMember, name string, task bool) map[string]any {
	r, err := m.Status(m.owner, member.Session)
	if err != nil {
		return nil
	}
	state := "idle"
	if r.State == "waiting_user" || r.State == "queued" || r.State == "cancelling" || repairFailure(r) || r.State == "interrupted" {
		state = r.State
	} else if activeAgent(r.State) {
		state = "replying"
		if groupTurnWorked(r) {
			state = "working"
		}
	} else if member.Await > 0 || member.Sending != "" {
		// Model completion is not group completion until the result is committed.
		state = "working"
	} else if member.Pending {
		state = "queued"
	}
	row := map[string]any{"key": member.Contact, "session": member.Session, "name": name, "state": state}
	row["generation"] = r.Generation
	row["chat_retry_attempt"] = r.ChatRetryAttempt
	row["updated"], row["error"] = r.Updated, m.redact(r.Error)
	if r.Failure != nil {
		failure := *r.Failure
		failure.Title = m.redact(failure.Title)
		row["failure"] = &failure
	}
	if activity, err := m.Activity(m.owner, r.ID, 0, 0, 12); err == nil {
		row["activity"] = activity
	}
	if member.Contact != groupHost {
		c, _ := m.readContact(member.Contact)
		view := m.contactView(c, nil)
		row["avatar_rev"], row["description"], row["role"], row["ring"] = view["avatar_rev"], view["description"], view["role"], view["ring"]
	}
	if task && member.Task != "" {
		row["task"], row["task_at"] = clipRunes(member.Task, 200), member.TaskAt
	}
	if activeAgent(r.State) && m.streamProjection != nil {
		m.streamProjection.mu.Lock()
		live := m.streamProjection.live[r.ID]
		m.streamProjection.mu.Unlock()
		if live.Generation == r.Generation {
			if codingRecord(r) {
				for request, origin := range r.TurnOrigins {
					if origin.Kind == "message" && r.TurnGenerations[request] == r.Generation {
						row["phase"] = live.Phase
						return row
					}
				}
			}
			row["thought"], row["text"], row["phase"] = m.redact(live.Thought), m.redact(live.Text), live.Phase
			live.Thought, live.Text = m.redact(live.Thought), m.redact(live.Text)
			row["live"] = live
		}
	}
	return row
}

// groupView returns new messages after a seq; without one, the latest page;
// with before, the page just older than it, for reading back through history.
func (m *AgentManager) groupView(g *conversationGroup, after, before int64) (map[string]any, error) {
	if _, err := m.groupIndex(g); err != nil {
		return nil, err
	}
	if g.ManagedProgram == "" {
		m.groupReconcile(g)
	}
	names := m.groupNames(g)
	members := []map[string]any{m.groupLive(g.Host, names[groupHost], true)}
	if g.HostContact != "" && members[0] != nil {
		members[0]["contact_id"] = g.HostContact
		if c, _, e := m.liveContact(g.HostContact); e == nil {
			v := m.contactView(c, nil)
			for _, key := range []string{"avatar_rev", "description", "role", "ring"} {
				members[0][key] = v[key]
			}
		}
	}
	for _, member := range g.Members {
		if c, err := m.readContact(member.Contact); err == nil && !c.Deleted {
			members = append(members, m.groupLive(member, names[member.Contact], true))
		}
	}
	for _, member := range members {
		if member != nil {
			member["host"] = member["key"] == g.coordinatorKey()
		}
	}
	lo, hi := after, int64(-1)
	switch {
	case before > 0:
		hi = min(before-1, g.Seq)
		lo = max(0, hi-groupViewPage)
	case after <= 0:
		lo = max(0, g.Seq-groupViewPage)
	}
	messages, err := m.groupRange(g, lo, hi)
	if err != nil {
		return nil, err
	}
	older := (before > 0 || after <= 0) && lo > 0
	return map[string]any{"id": g.ID, "name": g.Name, "host_contact": g.coordinatorContact(), "host_name": names[g.coordinatorKey()], "initial_host_contact": g.HostContact, "created_by": g.CreatedBy, "created": g.Created, "seq": g.Seq, "members": members, "messages": messages, "has_older": older}, nil
}

func (m *AgentManager) listGroups() ([]map[string]any, error) {
	paths, _ := filepath.Glob(filepath.Join(m.groupDir(), "*.json"))
	out := []map[string]any{}
	for _, p := range paths {
		g, err := m.readGroup(strings.TrimSuffix(filepath.Base(p), ".json"))
		if err != nil || g.LinkScope != "" || g.ManagedProgram != "" {
			continue
		}
		if _, err = m.groupIndex(g); err != nil {
			continue
		}
		names := m.groupNames(g)
		members := []map[string]any{}
		if g.HostContact != "" {
			members = append(members, map[string]any{"key": groupHost, "contact_id": g.HostContact, "name": names[groupHost]})
		}
		// The host counts: unaddressed messages go to her first.
		working := g.Host.Await > 0 || g.Host.Sending != "" || g.Host.Pending
		if r, err := m.Status(m.owner, g.Host.Session); err == nil && activeAgent(r.State) {
			working = true
		}
		for _, member := range g.Members {
			c, _ := m.readContact(member.Contact)
			if c.Deleted {
				continue
			}
			working = working || member.Await > 0 || member.Sending != "" || member.Pending
			members = append(members, map[string]any{"key": member.Contact, "name": names[member.Contact], "avatar_rev": c.AvatarRev})
			if r, err := m.Status(m.owner, member.Session); err == nil && activeAgent(r.State) {
				working = true
			}
		}
		row := map[string]any{"id": g.ID, "name": g.Name, "host_contact": g.coordinatorContact(), "host_name": names[g.coordinatorKey()], "created_by": g.CreatedBy, "created": g.Created, "activity": g.Created, "members": members, "active": working, "seq": g.Seq}
		if last, _ := m.groupRange(g, g.Seq-1, g.Seq); len(last) == 1 {
			row["last"] = map[string]any{"from": last[0].From, "name": last[0].Name, "text": clipRunes(last[0].Text, 80), "at": last[0].At}
			row["activity"] = last[0].At
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool { return conversationListLess(out[i], out[j]) })
	return out, nil
}

type groupPatch struct {
	Attempt      int                  `json:"attempt"`
	SessionID    string               `json:"session_id"`
	ProjectRoot  string               `json:"project_root"`
	Attachments  []ComposerAttachment `json:"attachments"`
	Generation   int                  `json:"generation"`
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Members      []string             `json:"members"`
	HostContact  string               `json:"host_contact"`
	ExpectedHost *string              `json:"expected_host_contact"`
	Text         string               `json:"text"`
	RequestID    string               `json:"request_id"`
	After        int64                `json:"after"`
	Before       int64                `json:"before"`
	Member       string               `json:"member"`
}

func (h *WorkspaceHost) groupCall(ctx context.Context, m *AgentManager, action string, raw json.RawMessage) (any, error) {
	if action == "group_receipt" {
		var request conversationReceiptRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return nil, err
		}
		return m.groupReceipt(request)
	}
	var p groupPatch
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	if action == "groups" {
		return m.listGroups()
	}
	if action == "group_create" {
		g, err := m.createGroup(ctx, p.Name, p.Members, p.RequestID, p.HostContact)
		if err != nil {
			return nil, err
		}
		return m.groupView(g, 0, 0)
	}
	g, err := m.readGroup(p.ID)
	if err != nil {
		return nil, err
	}
	if g.LinkScope != "" {
		return nil, fmt.Errorf("这是会话的核心协作记录，请从原会话查看")
	}
	if err = codingGroupAction(g, action); err != nil {
		return nil, err
	}
	switch action {
	case "group":
		return m.groupView(g, p.After, p.Before)
	case "group_member_retry":
		member := g.member(p.Member)
		if g.ManagedProgram != "" || member == nil || member.Session == "" || member.Session != p.SessionID {
			return nil, fmt.Errorf("群成员会话已变化，请刷新")
		}
		if p.Text == "" {
			return m.retryGroupExecution(g, member, p)
		}
		return m.retryGroupMember(g, member, p, "group-retry")
	case "coding_member_retry":
		return m.retryCodingMember(g, p)
	case "group_post":
		from := "user"
		if conversationCaller(ctx) == "eyra" {
			from = "eyra"
		}
		if len(p.RequestID) > 96 {
			return nil, fmt.Errorf("request_id 无效")
		}
		request := ""
		if p.RequestID != "" {
			request = from + ":" + p.RequestID
		}
		if _, err = m.groupPostAttachments(g, from, p.Text, "chat", "", 0, request, p.Attachments); err != nil {
			return nil, err
		}
		return m.groupView(g, p.After, 0)
	case "group_stop":
		member := g.member(p.Member)
		if member == nil {
			return nil, fmt.Errorf("没有这位成员")
		}
		if p.Generation != 0 {
			status, e := m.Status(m.owner, member.Session)
			if e != nil {
				return nil, e
			}
			if status.Generation != p.Generation {
				return nil, fmt.Errorf("任务代次已变化，请刷新后重试")
			}
		}
		member.Pending = false
		if err = m.writeGroup(g); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, m.CancelGeneration(m.owner, member.Session, p.Generation)
	case "group_update":
		if (p.HostContact != "" || p.ExpectedHost != nil) && p.HostContact != g.coordinatorContact() {
			if err = m.groupChangeCoordinator(g, p.HostContact, p.ExpectedHost); err != nil {
				return nil, err
			}
		}
		if strings.TrimSpace(p.Name) != "" {
			if utf8.RuneCountInString(strings.TrimSpace(p.Name)) > contactNameLimit {
				return nil, fmt.Errorf("群名过长")
			}
			g.Name = strings.TrimSpace(p.Name)
		}
		if p.Members != nil {
			if err = m.groupSetMembers(ctx, g, p.Members); err != nil {
				return nil, err
			}
		}
		if err = m.writeGroup(g); err != nil {
			return nil, err
		}
		return m.groupView(g, p.After, 0)
	case "group_delete":
		for _, member := range append([]groupMember{g.Host}, g.Members...) {
			if r, err := m.Status(m.owner, member.Session); err == nil && activeAgent(r.State) {
				_ = m.CancelGeneration(m.owner, member.Session, 0)
			}
		}
		g.Deleted = true
		return map[string]any{"ok": true, "id": g.ID, "archived": true}, m.writeGroup(g)
	}
	return nil, fmt.Errorf("未知的群聊操作")
}

// groupSetMembers adds new members with fresh group sessions and drops removed ones.
func (m *AgentManager) groupSetMembers(ctx context.Context, g *conversationGroup, contacts []string) error {
	if len(contacts) < 1 || len(contacts) > groupMemberLimit {
		return fmt.Errorf("群聊需要 1 到 %d 位成员", groupMemberLimit)
	}
	if g.HostContact != "" && !slices.Contains(contacts, g.HostContact) {
		return fmt.Errorf("初始主持的群内会话需要保留")
	}
	if g.coordinatorContact() != "" && !slices.Contains(contacts, g.coordinatorContact()) {
		return fmt.Errorf("不能移除当前主持")
	}
	keep := []groupMember{}
	added := []string{}
	for _, raw := range contacts {
		c, sessions, err := m.liveContact(raw)
		if err != nil {
			return err
		}
		if c.ID == g.HostContact {
			continue
		}
		if old := g.member(c.ID); old != nil {
			keep = append(keep, *old)
			continue
		}
		latest, err := m.groupContactTemplate(c, sessions)
		if err != nil {
			return err
		}
		r, err := m.Create(groupPermissions(ctx), m.owner, AgentSpec{Kind: "conversation", ProfileID: c.ID, GroupID: g.ID, RequestID: fmt.Sprintf("group:%s:%s:%d", g.ID, c.ID, g.Seq),
			ModelID: latest.Spec.ModelID, ModelParameters: latest.Spec.ModelParameters, Title: m.contactView(c, sessions)["name"].(string), Workdir: latest.Spec.Workdir, Tools: append(slices.Clone(latest.Spec.Tools), "group")})
		if err != nil {
			return err
		}
		// A member who joins later starts a fresh group session and reads the recent backlog.
		keep = append(keep, groupMember{Contact: c.ID, Session: r.ID, Delivered: max(0, g.Seq-groupBacklogLimit)})
		added = append(added, m.contactView(c, sessions)["name"].(string))
	}
	for _, old := range g.Members {
		if !slices.ContainsFunc(keep, func(x groupMember) bool { return x.Contact == old.Contact }) {
			if r, err := m.Status(m.owner, old.Session); err == nil && activeAgent(r.State) {
				_ = m.CancelGeneration(m.owner, old.Session, 0)
			}
		}
	}
	g.Members = keep
	if len(added) > 0 {
		_, err := m.appendGroupMessage(g, groupMessage{From: "system", Name: "系统", Kind: "system", Text: strings.Join(added, "、") + " 加入了群聊。"})
		return err
	}
	return nil
}

// ---------- group tool: members talk to the group during their own turn ----------

type groupToolKey struct{}
type groupToolContext struct {
	manager *AgentManager
	group   string
	session string
}

func GroupToolDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "group", Description: runtimePrompt("子代/模板/群工具.txt"), Parameters: schemaObject(map[string]any{
		"action": schemaEnum("post", "read", "members"),
		"text":   schemaString(),
		"after":  map[string]any{"type": "integer"},
		"before": map[string]any{"type": "integer"},
		"limit":  map[string]any{"type": "integer"},
	}, "action")}
}

func executeGroupTool(ctx context.Context, call ToolCall) ToolboxResult {
	r := ToolboxResult{State: "failed", Description: "群聊"}
	fail := func(message string) ToolboxResult {
		r.Error = &ShellError{Code: "group_error", Message: message}
		return r
	}
	c, ok := ctx.Value(groupToolKey{}).(groupToolContext)
	if !ok || c.manager == nil {
		return fail("当前会话不在群聊里")
	}
	var a struct {
		Action string `json:"action"`
		Text   string `json:"text"`
		After  int64  `json:"after"`
		Before int64  `json:"before"`
		Limit  int64  `json:"limit"`
	}
	if json.Unmarshal([]byte(call.Function.Arguments), &a) != nil {
		return fail("参数需要是对象")
	}
	m := c.manager
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	g, err := m.readGroup(c.group)
	if err != nil {
		return fail(err.Error())
	}
	key := ""
	for _, member := range append([]groupMember{g.Host}, g.Members...) {
		if member.Session == c.session {
			key = member.Contact
		}
	}
	if key == "" {
		return fail("你已不在这个群聊里")
	}
	var output any
	switch a.Action {
	case "post":
		member, request := g.member(key), ""
		if call.ID != "" {
			request = "note:" + c.session + ":" + call.ID
		}
		msg, err := m.groupPost(g, key, a.Text, "note", member.Chain, member.Depth+1, request)
		if err != nil {
			return fail(err.Error())
		}
		output = map[string]any{"ok": true, "seq": msg.Seq, "mentions": msg.Mentions}
	case "read":
		// One bounded page: newest by default, after a seq going forward, or before one going back.
		if _, err := m.groupIndex(g); err != nil {
			return fail(err.Error())
		}
		limit := a.Limit
		if limit <= 0 || limit > groupBacklogLimit {
			limit = groupBacklogLimit
		}
		lo, hi := max(0, g.Seq-limit), g.Seq
		if a.Before > 0 {
			hi = min(a.Before-1, g.Seq)
			lo = max(0, hi-limit)
		} else if a.After > 0 {
			lo = min(a.After, g.Seq)
			hi = min(g.Seq, lo+limit)
		}
		messages, err := m.groupRange(g, lo, hi)
		if err != nil {
			return fail(err.Error())
		}
		output = map[string]any{"ok": true, "seq": g.Seq, "messages": messages, "has_older": lo > 0, "has_newer": hi < g.Seq}
	case "members":
		names := m.groupNames(g)
		rows := []map[string]any{}
		for _, member := range append([]groupMember{g.Host}, g.Members...) {
			rows = append(rows, m.groupLive(member, names[member.Contact], false))
		}
		output = map[string]any{"ok": true, "members": rows}
	default:
		return fail("group 只支持 post、read、members")
	}
	data, _ := json.Marshal(output)
	r.OK, r.State, r.Data = true, "completed", data
	return r
}

// groupTurnDisplay shows a member's group turn as the messages it received,
// without the delivery instructions around them.
func groupTurnDisplay(text string) string {
	lines := []string{}
	for _, line := range strings.Split(text, "\n") {
		if len(line) > 8 && line[0] == '[' && line[3] == ':' && line[6] == ']' {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return text
	}
	return strings.Join(lines, "\n")
}
