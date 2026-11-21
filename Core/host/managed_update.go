// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: updateFile; updatePlan; updateDeviceName; updateMediaPath; updatePromptSidecar; updateDatabaseName; spreadsheetThemePath; updatePath; updateDigest; checkUpdateFiles; writeUpdateJSON; copyUpdateFile; loadUpdatePlan; updateNames; previousChangedFiles; prepareUpdateBackup; applyUpdateFiles; rollbackUpdate; updateReceipt; cleanUpdateEnv; launchUpdated; RunManagedUpdate; waitUpdatedHealth; ProbeManagedUpdate; RecoverManagedUpdate; RecoverUpdatePlan
// Impact: python -B scripts/code-atlas.py show Core/host/managed_update.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

// The helper is a copy of the trusted installed executable, outside all files
// being replaced. A flushed journal makes partial multi-file replacement
// recoverable; it deliberately does not claim filesystem-wide atomicity.
import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type updateFile struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type updatePlan struct {
	Schema    int                   `json:"schema"`
	Root      string                `json:"root"`
	Candidate string                `json:"candidate"`
	Release   string                `json:"release"`
	Version   string                `json:"version"`
	Sequence  int                   `json:"sequence"`
	Files     map[string]updateFile `json:"files"`
	Previous  map[string]updateFile `json:"previous"`
	Config    string                `json:"config"`
	Session   string                `json:"session"`
	Workdir   string                `json:"workdir"`
	Phase     string                `json:"phase"`
	Applied   []string              `json:"applied"`
	Reason    string                `json:"reason"`
}

var updateDeviceName = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`)
var updateMediaPath = regexp.MustCompile(`^(?:runtime/media/(?:runtime-manifest\.json|README\.txt|LICENSE|ffprobe\.exe|ffmpeg\.exe)|scripts/(?:provision-media\.py|media-runtime\.lock\.json))$`)
var updatePromptSidecar = regexp.MustCompile(`(?:^|/)prompts/.*\.(?:backup\.[a-f0-9]{64}|tmp\.[^/]+|write-lock|restore\.json)$`)
var updateDatabaseName = regexp.MustCompile(`(?i)\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?$`)

const spreadsheetThemePath = "Program/official/workspace/node_modules/exceljs/lib/doc/data/theme1.json"

func updatePath(root, name string) (string, error) {
	publicConfig := map[string]bool{"默认设置.json": true, "模型目录.json": true, "模型资料.json": true, "OpenCode模型.json": true, "终端配色.json": true, "提示词索引.json": true, "运行参数.json": true, "official-baseline.json": true, "release.pub.pem": true, "release.json": true}
	publicPrompt := regexp.MustCompile(`^Prompt/(?:Matrix/(?:默认|运行协定|工具说明|辅助指令|记忆|连接检测|问候)/.+\.txt|(?:Nova|莹|潜意识)/(?:[^/]+/)*[^/]+\.txt|子代/模板/(?:提示词|Eyra会话|对话|看图|工作|群聊|群主持|群工具|附件未观察)\.txt)$`).MatchString(name)
	publicDocument := contracts.DevelopmentDocument(name)
	product := publicDocument || contracts.ModuleSource(name) || regexp.MustCompile(`^(?:Core/|Desktop/|Client/Desktop/|Control/app/(?:service/|web/|scripts/|runtime/python/|config/release-public\.pem$|LICENSE$)|Link/app/(?:link-core/|runtime/link/aieyra-link\.exe$|LICENSE$)|runtime/search/|Aieyra (?:OS|CLI|Link|Browser|Settings|Contacts|Coding|Center|Servers|Workspace)\.exe$|README\.md$|LICENSE$|scripts/(?:build\-provenance\.py|development\-docs\.py|build\-cli\.py|build\-linux\.py|build\-macos\.py|build\-module\-launchers\.ps1|check\-modules\.py|CLI\-README\.md|create\-launchers\.ps1|sync\-cli\-entry\.ps1|create\-module\-shortcuts\.ps1|export\-source\.py|install\-cli\.sh|install\-linux\.sh|link_product\.py|LINUX\-README\.md|package\-link\.py|package\-release\.py|plugins\.py|PLUGINS\.md|provision\-search\.py|public\-privacy\-policy\.json|public\-privacy\.py|PUBLIC\-README\.md|release\-metadata\.json|resources\.py|runtime\-files\.py|search\-runtime\.lock\.json|sign\-link\.cjs|smoke\-macos\.cjs|update\-model\-reference\.py|winres\.py)$)`).MatchString(name)
	if strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") || !(product || name == "Aieyra Together.exe" || updateMediaPath.MatchString(name) || publicPrompt || strings.HasPrefix(name, "Config/") && publicConfig[strings.TrimPrefix(name, "Config/")]) {
		return "", fmt.Errorf("invalid product path")
	}
	if updateDatabaseName.MatchString(name) || updatePromptSidecar.MatchString(name) {
		return "", fmt.Errorf("personal database is protected")
	}
	parts := strings.Split(name, "/")
	for index, part := range parts {
		lower := strings.ToLower(part)
		if part == "" || part == "." || part == ".." || strings.TrimRight(part, ". ") != part || updateDeviceName.MatchString(part) || strings.IndexFunc(part, func(r rune) bool { return r < 32 }) >= 0 {
			return "", fmt.Errorf("invalid path component")
		}
		switch lower {
		case "data":
			if name != spreadsheetThemePath {
				return "", fmt.Errorf("personal path is protected")
			}
		case "config.json", "auth.json", "companion-profile.json", "sessions", "memory", "workspace-desktop", ".aieyra-updates", ".git":
			return "", fmt.Errorf("personal path is protected")
		}
		prefix := strings.Join(parts[:index+1], "/")
		// These names have reviewed public uses, but no blanket directory grant.
		if lower == "history" && prefix != "Agent/context/history" ||
			lower == "cloud" && !publicDocument && !(prefix == "Link/cloud" && contracts.ModuleSource(name)) ||
			(lower == "docs" || lower == "aidebug") && !publicDocument {
			return "", fmt.Errorf("personal path is protected")
		}
		if lower == ".env" || strings.HasPrefix(lower, ".env.") {
			return "", fmt.Errorf("environment file is protected")
		}
	}
	current := root
	for _, part := range append([]string{""}, strings.Split(name, "/")...) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("links are not update targets")
		}
		if info.Mode().IsRegular() {
			if err := rejectUpdateHardlink(current); err != nil {
				return "", err
			}
		}
	}
	return filepath.Join(root, filepath.FromSlash(name)), nil
}
func updateDigest(file string) (updateFile, error) {
	f, err := os.Open(file)
	if err != nil {
		return updateFile{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return updateFile{}, fmt.Errorf("expected regular file")
	}
	h := sha256.New()
	n, err := io.Copy(h, f)
	return updateFile{hex.EncodeToString(h.Sum(nil)), n}, err
}
func checkUpdateFiles(root string, files map[string]updateFile) error {
	for name, want := range files {
		file, err := updatePath(root, name)
		if err != nil {
			return err
		}
		got, err := updateDigest(file)
		if err != nil || got != want {
			return fmt.Errorf("file changed: %s", name)
		}
	}
	return nil
}
func writeUpdateJSON(file string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temp := file + ".next"
	f, err := os.OpenFile(temp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(temp, file)
}
func copyUpdateFile(source, target string, want updateFile) error {
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(filepath.Dir(target), ".aieyra-next-*")
	if err != nil {
		return err
	}
	temp := tempFile.Name()
	defer os.Remove(temp)
	if err := tempFile.Close(); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(temp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0700)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	closeErr := out.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(temp)
		return err
	}
	got, err := updateDigest(temp)
	if err != nil || got != want {
		os.Remove(temp)
		return fmt.Errorf("copy verification failed")
	}
	err = os.Rename(temp, target)
	if err != nil {
		os.Remove(temp)
	}
	return err
}
func loadUpdatePlan(file string) (updatePlan, error) {
	var p updatePlan
	data, err := os.ReadFile(file)
	if err != nil {
		return p, err
	}
	if len(data) > 8<<20 {
		return p, fmt.Errorf("update plan too large")
	}
	if err = json.Unmarshal(data, &p); err != nil {
		return p, err
	}
	p.Root, err = filepath.Abs(p.Root)
	if err != nil {
		return p, err
	}
	expected := filepath.Join(p.Root, ".aieyra-updates", p.Release, "apply.json")
	absolute, _ := filepath.Abs(file)
	if p.Schema != 1 || p.Release == "" || strings.ContainsAny(p.Release, "/\\:") || p.Release == "." || p.Release == ".." || absolute != expected || p.Candidate != filepath.Join(p.Root, ".aieyra-updates", p.Release, "candidate") || len(p.Files) == 0 || len(p.Files) > 10000 || len(p.Previous) > 10000 || !filepath.IsAbs(p.Config) || !filepath.IsAbs(p.Workdir) {
		return p, fmt.Errorf("invalid update plan scope")
	}
	for _, files := range []map[string]updateFile{p.Files, p.Previous} {
		seen := map[string]bool{}
		for name, meta := range files {
			if _, err = updatePath(p.Root, name); err != nil {
				return p, err
			}
			lower := strings.ToLower(name)
			if seen[lower] || len(meta.SHA256) != 64 || meta.Size < 0 || meta.Size > 1<<30 {
				return p, fmt.Errorf("invalid file inventory")
			}
			seen[lower] = true
		}
	}
	return p, nil
}
func updateNames(p updatePlan) []string {
	seen := map[string]bool{}
	for n := range p.Files {
		seen[n] = true
	}
	for n := range p.Previous {
		seen[n] = true
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func previousChangedFiles(p updatePlan) map[string]updateFile {
	files := make(map[string]updateFile)
	for name, old := range p.Previous {
		if next, exists := p.Files[name]; !exists || next != old {
			files[name] = old
		}
	}
	return files
}

func prepareUpdateBackup(p *updatePlan, planFile string) error {
	if err := checkUpdateFiles(p.Root, p.Previous); err != nil {
		return err
	}
	if err := checkUpdateFiles(p.Candidate, p.Files); err != nil {
		return err
	}
	backup := filepath.Join(filepath.Dir(planFile), "backup")
	for _, name := range updateNames(*p) {
		target, err := updatePath(p.Root, name)
		if err != nil {
			return err
		}
		if _, exists := p.Previous[name]; !exists {
			if _, err = os.Lstat(target); !os.IsNotExist(err) {
				return fmt.Errorf("new target already exists: %s", name)
			}
		}
	}
	changed := previousChangedFiles(*p)
	for name, meta := range changed {
		source, err := updatePath(p.Root, name)
		if err != nil {
			return err
		}
		target, err := updatePath(backup, name)
		if err != nil {
			return err
		}
		if err := copyUpdateFile(source, target, meta); err != nil {
			return err
		}
	}
	if err := checkUpdateFiles(backup, changed); err != nil {
		return err
	}
	p.Phase = "prepared"
	return writeUpdateJSON(planFile, p)
}
func applyUpdateFiles(p *updatePlan, planFile string) error {
	if err := checkUpdateFiles(p.Root, p.Previous); err != nil {
		return err
	}
	if err := checkUpdateFiles(p.Candidate, p.Files); err != nil {
		return err
	}
	for name := range p.Files {
		if _, old := p.Previous[name]; !old {
			target, err := updatePath(p.Root, name)
			if err != nil {
				return err
			}
			if _, err = os.Lstat(target); !os.IsNotExist(err) {
				return fmt.Errorf("new target appeared: %s", name)
			}
		}
	}
	p.Phase = "applying"
	if err := writeUpdateJSON(planFile, p); err != nil {
		return err
	}
	for _, name := range updateNames(*p) {
		if old, ok := p.Previous[name]; ok {
			if next, exists := p.Files[name]; exists && old == next {
				continue
			}
		}
		target, err := updatePath(p.Root, name)
		if err != nil {
			return err
		}
		if old, ok := p.Previous[name]; ok {
			got, e := updateDigest(target)
			if e != nil || got != old {
				return fmt.Errorf("file changed during update: %s", name)
			}
		} else if _, e := os.Lstat(target); !os.IsNotExist(e) {
			return fmt.Errorf("new target appeared: %s", name)
		}
		// Persist intent before the replace. Recovery is idempotent even if power
		// loss occurs after rename and before the following journal update.
		p.Applied = append(p.Applied, name)
		if err := writeUpdateJSON(planFile, p); err != nil {
			return err
		}
		if next, exists := p.Files[name]; exists {
			source, err := updatePath(p.Candidate, name)
			if err != nil {
				return err
			}
			if err = copyUpdateFile(source, target, next); err != nil {
				return err
			}
		} else if err = os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if err := checkUpdateFiles(p.Root, p.Files); err != nil {
		return err
	}
	p.Phase = "starting"
	return writeUpdateJSON(planFile, p)
}
func rollbackUpdate(p *updatePlan, planFile string) error {
	backup := filepath.Join(filepath.Dir(planFile), "backup")
	if err := checkUpdateFiles(backup, previousChangedFiles(*p)); err != nil {
		return err
	}
	// 崩溃后用户可能已经修过文件。恢复前逐个核对，不能用备份抹掉新成长。
	for _, name := range p.Applied {
		target, err := updatePath(p.Root, name)
		if err != nil {
			return err
		}
		got, err := updateDigest(target)
		old, hadOld := p.Previous[name]
		next, hasNext := p.Files[name]
		if os.IsNotExist(err) && (!hadOld || !hasNext) {
			continue
		}
		if err != nil || !(hadOld && got == old || hasNext && got == next) {
			return fmt.Errorf("recovery stopped to preserve later local changes: %s", name)
		}
	}
	for i := len(p.Applied) - 1; i >= 0; i-- {
		name := p.Applied[i]
		target, err := updatePath(p.Root, name)
		if err != nil {
			return err
		}
		if old, exists := p.Previous[name]; exists {
			source, _ := updatePath(backup, name)
			if err = copyUpdateFile(source, target, old); err != nil {
				return err
			}
		} else if err = os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if err := checkUpdateFiles(p.Root, p.Previous); err != nil {
		return err
	}
	p.Phase = "rolled_back"
	return writeUpdateJSON(planFile, p)
}
func updateReceipt(p updatePlan) error {
	return writeUpdateJSON(filepath.Join(p.Root, ".aieyra-updates", "transaction.json"), map[string]any{"phase": p.Phase, "release": p.Release, "reason": p.Reason, "at": time.Now().UTC()})
}
func cleanUpdateEnv(root string) []string {
	var result []string
	for _, v := range os.Environ() {
		if strings.HasPrefix(v, "AIEYRA_UPDATE_") || strings.HasPrefix(v, "AIEYRA_WORKSPACE_BRIDGE=") || strings.HasPrefix(v, "AIEYRA_ROOT=") || strings.HasPrefix(v, "ELECTRON_RUN_AS_NODE=") {
			continue
		}
		result = append(result, v)
	}
	return append(result, "AIEYRA_ROOT="+root)
}
func launchUpdated(p updatePlan, health string) (*exec.Cmd, error) {
	command := exec.Command(filepath.Join(p.Root, "Aieyra OS.exe"), "-config", p.Config, "-workdir", p.Workdir)
	command.Dir = p.Root
	command.Env = cleanUpdateEnv(p.Root)
	if health != "" {
		command.Env = append(command.Env, "AIEYRA_UPDATE_HEALTH="+health)
	}
	hideUpdateProcess(command)
	return command, command.Start()
}

func RunManagedUpdate(planFile string, parent int) error {
	p, err := loadUpdatePlan(planFile)
	if err != nil {
		return err
	}
	if p.Phase != "ready" {
		return fmt.Errorf("update plan is not authorized")
	}
	wait, release, err := waitUpdateParent(parent)
	if err != nil {
		return err
	}
	defer release()
	if err = writeUpdateJSON(filepath.Join(filepath.Dir(planFile), "helper-ready.json"), map[string]any{"pid": os.Getpid(), "parent": parent, "release": p.Release}); err != nil {
		return err
	}
	if err = wait(60 * time.Second); err != nil {
		return err
	}
	if err = prepareUpdateBackup(&p, planFile); err != nil {
		p.Phase = "rolled_back"
		p.Reason = "交接验证失败，原版本保留：" + err.Error()
		_ = updateReceipt(p)
		_, _ = launchUpdated(p, "")
		return err
	}
	marker := filepath.Join(p.Root, ".aieyra-updates", "pending.json")
	if err = writeUpdateJSON(marker, map[string]string{"plan": planFile}); err != nil {
		return err
	}
	err = applyUpdateFiles(&p, planFile)
	if err == nil {
		err = waitUpdatedHealth(p)
	}
	if err != nil {
		p.Reason = "新版未通过启动验证，已恢复旧版本：" + err.Error()
		if rollbackErr := rollbackUpdate(&p, planFile); rollbackErr != nil {
			p.Reason = "更新恢复未完成：" + rollbackErr.Error()
			_ = updateReceipt(p)
			return rollbackErr
		}
		_ = updateReceipt(p)
		_ = os.Remove(marker)
		_, _ = launchUpdated(p, "")
		return err
	}
	p.Phase = "committed"
	p.Reason = "新版已启动，运行状态验证通过"
	if err = writeUpdateJSON(planFile, p); err != nil {
		return err
	}
	if err = updateReceipt(p); err != nil {
		return err
	}
	return os.Remove(marker)
}
func waitUpdatedHealth(p updatePlan) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	var random [32]byte
	if _, err = rand.Read(random[:]); err != nil {
		listener.Close()
		return err
	}
	token := hex.EncodeToString(random[:])
	ready := make(chan struct{}, 1)
	server := &http.Server{ReadHeaderTimeout: 3 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/"+token {
			http.NotFound(w, r)
			return
		}
		select {
		case ready <- struct{}{}:
		default:
		}
		w.WriteHeader(204)
	})}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	command, err := launchUpdated(p, "http://"+listener.Addr().String()+"/"+token)
	if err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	timer := time.NewTimer(60 * time.Second)
	defer timer.Stop()
	select {
	case <-ready:
		select {
		case <-time.After(3 * time.Second):
			return nil
		case err = <-done:
			return fmt.Errorf("new application exited after handshake: %v", err)
		}
	case err = <-done:
		return fmt.Errorf("new application exited: %v", err)
	case <-timer.C:
		_ = command.Process.Kill()
		<-done
		time.Sleep(2 * time.Second)
		return fmt.Errorf("new interface did not become ready")
	}
}

// Probe with an isolated profile and no provider calls. Electron itself parses
// and loads the candidate backend, renderer entrypoints and native runtime.
func ProbeManagedUpdate(root string) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	temp, err := os.MkdirTemp("", "aieyra-update-probe-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(root, "Client/Desktop", "node_modules", "electron", "dist", "electron.exe"), filepath.Join(root, "Client/Desktop", "src", "update-probe.cjs"), temp)
	command.Dir = root
	command.Env = append(cleanUpdateEnv(root), "ELECTRON_RUN_AS_NODE=1")
	hideUpdateProcess(command)
	out, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("candidate probe: %w: %.2000s", err, out)
	}
	fmt.Print(string(out))
	return nil
}

// If the machine stopped during replacement, normal startup invokes the same
// journal recovery before loading any of the replaced desktop code.
func RecoverManagedUpdate(root string) (bool, error) {
	marker := filepath.Join(root, ".aieyra-updates", "pending.json")
	data, err := os.ReadFile(marker)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var value map[string]string
	if json.Unmarshal(data, &value) != nil {
		return false, fmt.Errorf("invalid recovery marker")
	}
	p, err := loadUpdatePlan(value["plan"])
	if err != nil {
		return false, err
	}
	if p.Phase == "committed" || p.Phase == "rolled_back" {
		return false, os.Remove(marker)
	}
	// Health-monitored starts belong to the still-running helper.
	if os.Getenv("AIEYRA_UPDATE_HEALTH") != "" {
		return false, nil
	}
	helper := filepath.Join(filepath.Dir(value["plan"]), "update-helper.exe")
	command := exec.Command(helper, "-recover-update", value["plan"], "-update-parent", fmt.Sprint(os.Getpid()))
	command.Dir = root
	command.Env = cleanUpdateEnv(root)
	hideUpdateProcess(command)
	if err = command.Start(); err != nil {
		return false, err
	}
	_ = command.Process.Release()
	return true, nil
}
func RecoverUpdatePlan(file string, parent int) error {
	wait, release, err := waitUpdateParent(parent)
	if err != nil {
		return err
	}
	defer release()
	if err = wait(60 * time.Second); err != nil {
		return err
	}
	p, err := loadUpdatePlan(file)
	if err != nil {
		return err
	}
	if p.Phase != "applying" && p.Phase != "starting" && p.Phase != "prepared" {
		return fmt.Errorf("no partial update to recover")
	}
	if err = rollbackUpdate(&p, file); err != nil {
		return err
	}
	p.Reason = "中断的更新已从本地完整备份恢复"
	_ = updateReceipt(p)
	if err = os.Remove(filepath.Join(p.Root, ".aieyra-updates", "pending.json")); err != nil {
		return err
	}
	_, err = launchUpdated(p, "")
	return err
}
