// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: transportBlock; runReleasePatch; transportOutput; Write; checkTransportEntry; decodeTransport; extractReleasePatch
// Impact: python -B scripts/code-atlas.py show Core/host/release_transport_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

const transportBlock = 1 << 20

// The installed executable supplies the decoder before any user profile is opened.
func runReleasePatch(args []string) error {
	flags := flag.NewFlagSet("extract-release-patch", flag.ContinueOnError)
	archive := flags.String("archive", "", "")
	root := flags.String("base", "", "")
	dest := flags.String("output", "", "")
	version := flags.String("version", "", "")
	from := flags.Int("from", 0, "")
	to := flags.Int("to", 0, "")
	err := flags.Parse(args)
	if err == nil && (flags.NArg() != 0 || *version == "") {
		err = fmt.Errorf("invalid patch arguments")
	}
	if err == nil {
		err = extractReleasePatch(context.Background(), *archive, *root, *dest, *version, *from, *to)
	}
	return err
}

type transportOutput struct {
	writer    io.Writer
	remaining int64
	account   func(int) error
}

func (w *transportOutput) Write(p []byte) (int, error) {
	if int64(len(p)) > w.remaining {
		return 0, fmt.Errorf("transport output exceeds signed size")
	}
	n, err := w.writer.Write(p)
	w.remaining -= int64(n)
	if err == nil {
		err = w.account(n)
	}
	return n, err
}

func checkTransportEntry(entry *zip.File, files map[string]updateFile, seen map[string]bool, compact bool) error {
	want := files[entry.Name]
	if entry.Comment == "" {
		if entry.UncompressedSize64 != uint64(want.Size) {
			return fmt.Errorf("invalid stored size: %s", entry.Name)
		}
		return nil
	}
	mode, base, _ := strings.Cut(entry.Comment, ":")
	if !compact || entry.Method != zip.Store {
		return fmt.Errorf("unexpected transport entry: %s", entry.Name)
	}
	if base != "" {
		if _, ok := files[base]; !ok || base == entry.Name || !seen[strings.ToLower(base)] {
			return fmt.Errorf("installation base is missing: %s", entry.Name)
		}
	}
	switch mode {
	case "copy-v1":
		if base != "" && want == files[base] && entry.UncompressedSize64 == 0 {
			return nil
		}
	case "blocks-v1":
		if strings.HasPrefix(entry.Comment, "blocks-v1:") {
			return nil
		}
	}
	return fmt.Errorf("invalid transport record: %s", entry.Name)
}

func decodeTransport(entry *zip.File, sourcePath string, output io.Writer, size int64, buffer []byte) error {
	input, err := entry.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	var source *os.File
	if sourcePath != "" {
		source, err = os.Open(sourcePath)
		if err != nil {
			return err
		}
		defer source.Close()
	}
	if entry.Comment == "" {
		_, err = io.CopyBuffer(output, input, buffer)
		return err
	}
	if strings.HasPrefix(entry.Comment, "copy-v1:") && source != nil {
		_, err = io.CopyBuffer(output, source, buffer)
		return err
	}
	if !strings.HasPrefix(entry.Comment, "blocks-v1:") || size < 0 || size > 1<<30 {
		return fmt.Errorf("invalid block stream")
	}
	var header [5]byte
	if _, err := io.ReadFull(input, header[:4]); err != nil || int64(binary.LittleEndian.Uint32(header[:4])) != size {
		return fmt.Errorf("invalid block output size")
	}
	options := []zstd.DOption{zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxMemory(4 << 20), zstd.WithDecodeAllCapLimit(true)}
	base := make([]byte, transportBlock)
	decoded := make([]byte, transportBlock)
	encoded := make([]byte, transportBlock+8192)
	for pos := int64(0); pos < size; pos += transportBlock {
		n := int(min(size-pos, transportBlock))
		if _, err := io.ReadFull(input, header[:]); err != nil {
			return err
		}
		arg := int64(binary.LittleEndian.Uint32(header[1:]))
		data := decoded[:n]
		if header[0] == 0 {
			if source == nil || arg%transportBlock != 0 {
				return fmt.Errorf("invalid block source")
			}
			if _, err := source.ReadAt(data, arg); err != nil {
				return err
			}
		} else {
			opts := options
			switch header[0] {
			case 1:
			case 2:
				if source == nil {
					return fmt.Errorf("missing block dictionary")
				}
				read, err := source.ReadAt(base, pos)
				if read == 0 || (err != nil && err != io.EOF) {
					return fmt.Errorf("invalid block dictionary")
				}
				opts = append(opts, zstd.WithDecoderDictRaw(0, base[:read]))
			default:
				return fmt.Errorf("unknown block operation")
			}
			if arg < 1 || arg > int64(len(encoded)) {
				return fmt.Errorf("invalid frame size")
			}
			if _, err := io.ReadFull(input, encoded[:arg]); err != nil {
				return err
			}
			decoder, err := zstd.NewReader(nil, opts...)
			if err != nil {
				return err
			}
			data, err = decoder.DecodeAll(encoded[:arg], decoded[:0:n])
			decoder.Close()
			if err != nil {
				return fmt.Errorf("invalid compressed block: %w", err)
			}
			if len(data) != n {
				return fmt.Errorf("incorrect decoded block length")
			}
		}
		if _, err := output.Write(data); err != nil {
			return err
		}
	}
	if n, err := input.Read(header[:1]); n != 0 || err != io.EOF {
		return fmt.Errorf("invalid block stream ending")
	}
	return nil
}

// Extract only the signed, changed files to a fresh staging directory. Both
// baselines are authenticated before looking up any path supplied by a patch.
func extractReleasePatch(ctx context.Context, archivePath, root, dest, version string, from, to int) error {
	root, err := installDirectory(root)
	if err != nil {
		return err
	}
	dest, err = installDirectory(dest)
	if err != nil {
		return err
	}
	if from < 1 || to <= from {
		return fmt.Errorf("invalid patch sequence")
	}
	keyPath, err := updatePath(root, "Config/release.pub.pem")
	if err != nil {
		return err
	}
	key, err := os.ReadFile(keyPath)
	if err != nil {
		return err
	}
	baselinePath, err := updatePath(root, installerBaseline)
	if err != nil {
		return err
	}
	oldRaw, err := os.ReadFile(baselinePath)
	if err != nil {
		return err
	}
	old, _, err := verifyInstallManifest(oldRaw, key, "", from)
	if err != nil {
		return err
	}
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	if archive.Comment != "aieyra-patch-v1" || len(archive.File) < 1 || len(archive.File) > 10000 {
		return fmt.Errorf("invalid patch archive")
	}
	header := archive.File[0]
	if header.Name != installerBaseline || header.Comment != "blocks-v1:"+installerBaseline || header.Method != zip.Store {
		return fmt.Errorf("invalid patch baseline")
	}
	input, err := header.Open()
	if err != nil {
		return err
	}
	var length [4]byte
	_, err = io.ReadFull(input, length[:])
	input.Close()
	size := int64(binary.LittleEndian.Uint32(length[:]))
	if err != nil || size < 1 || size > 24<<20 {
		return fmt.Errorf("invalid patch manifest size")
	}
	var signed bytes.Buffer
	buffer := make([]byte, 512<<10)
	if err := decodeTransport(header, baselinePath, &signed, size, buffer); err != nil {
		return err
	}
	next, _, err := verifyInstallManifest(signed.Bytes(), key, version, to)
	if err != nil {
		return err
	}
	remaining := make(map[string]updateFile)
	var total int64
	for name, want := range next.Files {
		if want.Size < 0 || want.Size > 1<<30 || name == installerBaseline {
			return fmt.Errorf("invalid release inventory")
		}
		total += want.Size
		if before, exists := old.Files[name]; !exists || before != want {
			remaining[name] = want
		}
	}
	if total+size > installerArchiveLimit || len(remaining)+1 != len(archive.File) {
		return fmt.Errorf("incomplete patch inventory")
	}
	if err := os.Mkdir(dest, 0700); err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.RemoveAll(dest)
		}
	}()
	for _, entry := range archive.File[1:] {
		want, found := remaining[entry.Name]
		if !found || !entry.Mode().IsRegular() || entry.NonUTF8 || entry.Method != zip.Store {
			return fmt.Errorf("invalid patch entry: %s", entry.Name)
		}
		delete(remaining, entry.Name)
		target, err := updatePath(dest, entry.Name)
		if err != nil {
			return err
		}
		source := ""
		if entry.Comment == "blocks-v1:"+entry.Name {
			before, ok := old.Files[entry.Name]
			if !ok {
				return fmt.Errorf("unlisted patch base")
			}
			source, err = updatePath(root, entry.Name)
			if err != nil {
				return err
			}
			if got, err := updateDigest(source); err != nil || got != before {
				return fmt.Errorf("installed patch base differs: %s", entry.Name)
			}
		} else if entry.Comment != "blocks-v1:" {
			return fmt.Errorf("invalid patch base")
		}
		if err := extractInstallFile(entry, target, source, want, buffer, func(int) error { return ctx.Err() }); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Join(dest, "Config"), 0700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dest, filepath.FromSlash(installerBaseline)), signed.Bytes(), 0600); err != nil {
		return err
	}
	complete = true
	return nil
}
