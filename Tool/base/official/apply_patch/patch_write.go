package patch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func patchMatches(image patchImage, after bool) bool {
	if _, err := patchPath("", image.Path); err != nil {
		return false
	}
	b, mode, exists, err := readPatchFile(image.Path)
	if err != nil {
		return false
	}
	if after {
		return exists == image.Keep && (!exists || bytes.Equal(b, image.After) && mode&0200 == image.Mode&0200)
	}
	return exists == image.Exists && (!exists || bytes.Equal(b, image.Before) && mode&0200 == image.Mode&0200)
}

// 在同目录暂存并原子替换单文件；多文件事务另有恢复日志，不能承诺跨文件原子性。
func patchWrite(path string, data []byte, keep bool, mode os.FileMode) error {
	if !keep {
		return os.Remove(path)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".aieyra-patch-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err == nil {
		err = f.Chmod(mode)
	}
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
	return replacePatchFile(name, path)
}

type patchJournal struct {
	State   string       `json:"state"`
	Key     string       `json:"call_key"`
	Applied int          `json:"applied"`
	Images  []patchImage `json:"images"`
	Issues  []string     `json:"issues,omitempty"`
}

func commitPatch(ctx context.Context, p patchPrepared, dir, key, description string, write func(string, []byte, bool, os.FileMode) error) PatchResult {
	result := PatchResult{OK: true, State: "applied", Description: description, Files: p.files}
	if len(p.paths) == 0 {
		result.State = "unchanged"
		return result
	}
	if write == nil {
		write = patchWrite
	}
	if dir == "" {
		return patchFailure("recovery_unavailable", "缺少补丁恢复目录，未执行写入")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return patchFailure("recovery_unavailable", err.Error())
	}
	path := filepath.Join(dir, patchHash([]byte(key))+".json")
	// 调用意图已持久化，日志仍使用排他创建，崩溃后不得直接重用身份重写文件。
	journal := patchJournal{State: "prepared", Key: key, Images: p.paths}
	data, _ := json.Marshal(journal)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		r := patchFailure("recovery_exists", "恢复记录已存在或不可写，请先检查记录和实际文件，不自动重跑："+err.Error())
		r.RecoveryPath = path
		return r
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
		r := patchFailure("recovery_unavailable", err.Error())
		r.RecoveryPath = path
		return r
	}
	save := func() error {
		state := journal
		state.Images = nil
		data, e := json.Marshal(state)
		if e != nil {
			return e
		}
		return patchWrite(path+".state.json", data, true, 0600)
	}
	applied := 0
	for _, image := range p.paths {
		if !patchMatches(image, false) {
			err = fmt.Errorf("文件在预检后发生变化：%s", image.Path)
			break
		}
	}
	if err == nil {
		for i, image := range p.paths {
			if ctx.Err() != nil {
				err = ctx.Err()
				break
			}
			if !patchMatches(image, false) {
				err = fmt.Errorf("文件在提交前发生变化：%s", image.Path)
				break
			}
			if err = write(image.Path, image.After, image.Keep, image.Mode); err != nil {
				break
			}
			applied = i + 1
			journal.Applied = applied
			if err = save(); err != nil {
				break
			}
		}
	}
	if err == nil {
		journal.State = "applied"
		if err = save(); err == nil {
			result.RecoveryPath = path
			return result
		}
	}
	journal.State = "rolling_back"
	journal.Issues = append(journal.Issues, err.Error())
	_ = save()
	for i := applied - 1; i >= 0; i-- {
		image := p.paths[i]
		if !patchMatches(image, true) {
			journal.Issues = append(journal.Issues, "未覆盖外部修改："+image.Path)
			continue
		}
		if e := patchWrite(image.Path, image.Before, image.Exists, image.Mode); e != nil {
			journal.Issues = append(journal.Issues, "恢复失败："+image.Path+"："+e.Error())
		}
	}
	complete := true
	for i := 0; i < applied; i++ {
		if !patchMatches(p.paths[i], false) {
			complete = false
		}
	}
	result.OK = false
	result.State = "rolled_back"
	if applied == 0 {
		result.State = "rejected"
	} else if !complete {
		result.State = "partial"
	}
	journal.State = result.State
	result.Error = &PatchError{Code: "write_failed", Message: fmt.Sprintf("补丁提交未完成：%v。状态 %s；请核对恢复记录和实际文件后再继续。", err, result.State)}
	result.RecoveryPath = path
	if e := save(); e != nil {
		result.Error.Message += " 恢复记录更新失败：" + e.Error()
	}
	return result
}
