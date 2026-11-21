// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: installerBaseline; installerArchiveLimit; installerManifest; InstallProgress; installVersion; installerManifestFrom; installDirectory; emptyInstallRoot; containsInstallPath; installStageParent; installerEntries; extractInstallFile; InstallWindows; installShortcuts
// Impact: python -B scripts/code-atlas.py show Core/host/install_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"github.com/aieyra/aieyra-os/CORE/userdata"
)

const installerBaseline = "Config/official-baseline.json"
const installerArchiveLimit = 2 << 30

type installerManifest struct {
	Schema   string                `json:"schema"`
	Product  string                `json:"product"`
	Version  string                `json:"version"`
	Sequence int                   `json:"sequence"`
	Files    map[string]updateFile `json:"files"`
}

type InstallProgress struct {
	Step       string `json:"step"`
	Done       int64  `json:"done,omitempty"`
	Total      int64  `json:"total,omitempty"`
	FilesDone  int    `json:"filesDone,omitempty"`
	FilesTotal int    `json:"filesTotal,omitempty"`
	Message    string `json:"message,omitempty"`
}

var installVersion = regexp.MustCompile("^[0-9]+\\.[0-9]+\\.[0-9]+$")

func installerManifestFrom(archive *zip.ReadCloser, public []byte, version string, sequence int) (installerManifest, []byte, error) {
	var manifest installerManifest
	var signed struct {
		Algorithm string
		Payload   string
		Signature string
	}
	entry, err := archive.Open(installerBaseline)
	if err != nil {
		return manifest, nil, fmt.Errorf("安装文件缺少签名清单")
	}
	defer entry.Close()
	raw, err := io.ReadAll(io.LimitReader(entry, (24<<20)+1))
	if err != nil || len(raw) > 24<<20 || json.Unmarshal(raw, &signed) != nil || signed.Algorithm != "Ed25519" {
		return manifest, nil, fmt.Errorf("安装文件签名清单无法读取")
	}
	keyBlock, rest := pem.Decode(public)
	if keyBlock == nil || keyBlock.Type != "PUBLIC KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return manifest, nil, fmt.Errorf("安装器公钥无效")
	}
	key, err := x509.ParsePKIXPublicKey(keyBlock.Bytes)
	verifier, ok := key.(ed25519.PublicKey)
	message, decode := base64.StdEncoding.DecodeString(signed.Payload)
	signature, decodeSignature := base64.StdEncoding.DecodeString(signed.Signature)
	if err != nil || !ok || decode != nil || decodeSignature != nil || !ed25519.Verify(verifier, message, signature) {
		return manifest, nil, fmt.Errorf("安装文件未通过发行签名校验")
	}
	if json.Unmarshal(message, &manifest) != nil || manifest.Schema != "aieyra-os-baseline-v1" ||
		manifest.Product != "aieyra-os" || !installVersion.MatchString(version) || manifest.Version != version ||
		sequence < 1 || manifest.Sequence != sequence || len(manifest.Files) == 0 || len(manifest.Files) >= 10000 {
		return manifest, nil, fmt.Errorf("安装文件与当前安装器版本不匹配")
	}
	for _, file := range []string{"Aieyra OS.exe", "scripts/create-launchers.ps1", "Config/运行参数.json"} {
		if _, ok := manifest.Files[file]; !ok {
			return manifest, nil, fmt.Errorf("安装文件缺少 %s", file)
		}
	}
	return manifest, raw, nil
}

func installDirectory(value string) (string, error) {
	value = filepath.Clean(strings.TrimSpace(value))
	if !filepath.IsAbs(value) || strings.HasPrefix(value, "\\\\") || filepath.Dir(value) == value {
		return "", fmt.Errorf("请选择本机磁盘上的文件夹")
	}
	for name := value; ; name = filepath.Dir(name) {
		if info, err := os.Lstat(name); err == nil {
			resolved, err := filepath.EvalSymlinks(name)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !strings.EqualFold(resolved, name) {
				return "", fmt.Errorf("请选择普通文件夹：%s", name)
			}
		} else if !os.IsNotExist(err) {
			return "", err
		}
		if filepath.Dir(name) == name {
			break
		}
	}
	return value, nil
}

func emptyInstallRoot(root string) error {
	contents, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(contents) != 0 {
		return fmt.Errorf("程序目录已有文件。请选择空文件夹，或通过现有程序检查更新。")
	}
	return nil
}

func containsInstallPath(root, name string) bool {
	base := strings.ToLower(root)
	target := strings.ToLower(name)
	return target == base || strings.HasPrefix(target, base+string(filepath.Separator))
}

func installStageParent(parent string) (string, error) {
	for current := parent; ; current = filepath.Dir(current) {
		_, err := os.Lstat(current)
		if err == nil {
			return current, nil
		}
		if !os.IsNotExist(err) || filepath.Dir(current) == current {
			return "", err
		}
	}
}

func installerEntries(archive *zip.ReadCloser, manifest installerManifest) (int64, error) {
	seen := make(map[string]bool)
	var total int64
	for _, entry := range archive.File {
		lower := strings.ToLower(entry.Name)
		if seen[lower] || !entry.Mode().IsRegular() || entry.NonUTF8 {
			return 0, fmt.Errorf("安装文件包含冲突的条目")
		}
		seen[lower] = true
		if entry.Name == installerBaseline {
			continue
		}
		want, ok := manifest.Files[entry.Name]
		digest, err := hex.DecodeString(want.SHA256)
		if !ok || err != nil || len(digest) != sha256.Size || want.Size < 0 || want.Size > 1<<30 || uint64(want.Size) != entry.UncompressedSize64 {
			return 0, fmt.Errorf("安装文件与签名清单不一致：%s", entry.Name)
		}
		total += want.Size
		if total > installerArchiveLimit {
			return 0, fmt.Errorf("安装文件解压大小超限")
		}
	}
	if len(seen) != len(manifest.Files)+1 || total == 0 {
		return 0, fmt.Errorf("安装文件不完整")
	}
	return total, nil
}

func extractInstallFile(entry *zip.File, target string, want updateFile, buffer []byte, account func(int) error) error {
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer output.Close()
	digest := sha256.New()
	writer := io.MultiWriter(output, digest)
	var written int64
	for {
		n, err := source.Read(buffer)
		if n > 0 {
			written += int64(n)
			if written > want.Size {
				return fmt.Errorf("安装文件大小不一致：%s", entry.Name)
			}
			if _, e := writer.Write(buffer[:n]); e != nil {
				return e
			}
			if e := account(n); e != nil {
				return e
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if written != want.Size || hex.EncodeToString(digest.Sum(nil)) != want.SHA256 {
		return fmt.Errorf("安装文件摘要校验失败：%s", entry.Name)
	}
	return output.Close()
}

// InstallWindows stages a verified full archive beside the destination. The
// atomic directory rename is the single point where the application appears.
func InstallWindows(ctx context.Context, archivePath string, public []byte, version string, sequence int, root, data string, shortcuts bool, desktop string, progress func(InstallProgress), beforeCommit func(context.Context) error, policy ...string) error {
	if len(policy) > 1 || len(policy) == 1 && policy[0] != "" && policy[0] != "2026-11-22" {
		return errors.New("隐私协议版本无效")
	}
	root, err := installDirectory(root)
	if err != nil {
		return err
	}
	data, err = installDirectory(data)
	if err != nil {
		return err
	}
	if !strings.EqualFold(data, filepath.Join(root, "Data")) && (containsInstallPath(root, data) || containsInstallPath(data, root)) {
		return fmt.Errorf("请选择分开的程序和资料目录，或在程序目录中使用 Data 文件夹")
	}
	if err := emptyInstallRoot(root); err != nil {
		return err
	}
	progress(InstallProgress{Step: "verify"})
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	manifest, signed, err := installerManifestFrom(archive, public, version, sequence)
	if err != nil {
		return err
	}
	total, err := installerEntries(archive, manifest)
	if err != nil {
		return err
	}
	if total+int64(len(signed)) > installerArchiveLimit {
		return fmt.Errorf("安装文件解压大小超限")
	}
	parent := filepath.Dir(root)
	stageParent, err := installStageParent(parent)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(stageParent, ".aieyra-setup-")
	if err != nil {
		return err
	}
	defer func() {
		if filepath.Dir(stage) == stageParent && strings.HasPrefix(filepath.Base(stage), ".aieyra-setup-") {
			_ = os.RemoveAll(stage)
		}
	}()
	for name := range manifest.Files {
		if _, err := updatePath(stage, name); err != nil {
			return fmt.Errorf("安装文件路径无效 %s：%w", name, err)
		}
	}
	buffer := make([]byte, 512<<10)
	var done, reported int64
	var filesDone, filesReported int
	filesTotal := len(manifest.Files)
	reportExtract := func() {
		reported, filesReported = done, filesDone
		progress(InstallProgress{Step: "extract", Done: done, Total: total, FilesDone: filesDone, FilesTotal: filesTotal})
	}
	reportExtract()
	for _, entry := range archive.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Name == installerBaseline {
			continue
		}
		file := filepath.Join(stage, filepath.FromSlash(entry.Name))
		err := extractInstallFile(entry, file, manifest.Files[entry.Name], buffer, func(n int) error {
			done += int64(n)
			if done-reported >= 4<<20 {
				reportExtract()
			}
			return ctx.Err()
		})
		if err != nil {
			return err
		}
		filesDone++
		if filesDone-filesReported >= 48 || filesDone == filesTotal {
			reportExtract()
		}
	}
	baseline := filepath.Join(stage, filepath.FromSlash(installerBaseline))
	if err := os.WriteFile(baseline, signed, 0644); err != nil {
		return err
	}
	if len(policy) == 1 && policy[0] == "2026-11-22" {
		if err := os.WriteFile(filepath.Join(stage, ".aieyra-privacy-consent"), []byte(policy[0]), 0600); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	progress(InstallProgress{Step: "profile"})
	if err := beforeCommit(ctx); err != nil {
		return err
	}
	if err := os.MkdirAll(parent, 0755); err != nil {
		return err
	}
	if err := userdata.PrepareInstalledProfile(stage, root, data); err != nil {
		return err
	}
	if _, err := installDirectory(root); err != nil {
		return err
	}
	if err := emptyInstallRoot(root); err != nil {
		return err
	}
	if err := os.Remove(root); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(stage, root); err != nil {
		return err
	}
	var message string
	if shortcuts {
		progress(InstallProgress{Step: "shortcuts"})
		if err := installShortcuts(root, desktop); err != nil {
			message = err.Error()
		}
	}
	progress(InstallProgress{Step: "complete", Message: message})
	return nil
}

func installShortcuts(root, desktop string) error {
	powershell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	args := []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", filepath.Join(root, "scripts", "create-launchers.ps1"), "-Root", root, "-ProductSuite"}
	if desktop != "" {
		args = append(args, "-Destination", desktop)
	}
	command := exec.Command(powershell, args...)
	command.Dir = root
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if err := command.Run(); err != nil {
		return fmt.Errorf("程序已安装。桌面快捷方式创建失败，可以运行安装目录中的 Install.bat 重试。")
	}
	return nil
}
