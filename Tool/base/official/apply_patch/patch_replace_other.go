//go:build !windows

package patch

import "os"

func replacePatchFile(from, to string) error { return os.Rename(from, to) }
