package setup

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// This file installs Git on Windows WITHOUT winget or any interactive installer.
//
// The old approach shelled out to `winget install --id Git.Git`. In our
// no-console, no-TTY launcher that hangs forever: when Git is already present
// winget prints "找到已安装的现有包，正在尝试升级已安装的包" and then waits for
// console input (source/upgrade confirmation) that can never arrive, so the
// action blocks until the 10-minute timeout.
//
// Instead — mirroring install_gh.go — we download Git for Windows' official
// "MinGit" release archive (a self-contained, ~36MB portable Git that needs no
// installer, no admin rights, and no console) straight from github.com and
// unpack it into our app-managed BinDir. MinGit ships git-remote-https and a CA
// bundle, so the HTTPS push in publish.go works. The Runner then resolves git
// from BinDir\git\cmd\git.exe and prepends its dirs to the child PATH.
//
// On macOS/Linux this file is not used: git comes from Xcode CLT / the system.

// mingitLatestAPI resolves the newest Git for Windows release (tag + assets).
const mingitLatestAPI = "https://api.github.com/repos/git-for-windows/git/releases/latest"

// gitDownloadTimeout bounds the whole download+extract. MinGit is ~36MB and
// expands to a few thousand small files, so it is more generous than gh's.
const gitDownloadTimeout = 10 * time.Minute

// gitSubdir is the folder under BinDir that the extracted MinGit tree lives in.
// The runnable entry point is <BinDir>/git/cmd/git.exe.
const gitSubdir = "git"

// installGitWindows downloads the MinGit archive matching goarch and unpacks its
// whole tree into <binDir>/git. It returns the resolved git.exe path on success.
//
// goarch uses Go's naming ("amd64","arm64"); MinGit asset names use "64-bit"
// (for amd64) and "arm64", handled in pickMinGitAsset.
func installGitWindows(ctx context.Context, binDir, goarch string) (string, error) {
	if binDir == "" {
		return "", fmt.Errorf("no managed bin directory configured")
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", fmt.Errorf("创建工具目录失败: %w", err)
	}

	rel, err := fetchRelease(ctx, mingitLatestAPI)
	if err != nil {
		return "", err
	}
	url, err := pickMinGitAsset(rel, goarch)
	if err != nil {
		return "", err
	}

	// Download to a temp file first so a partial download never looks installed.
	tmp, err := os.CreateTemp(binDir, "mingit-dl-*")
	if err != nil {
		return "", fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := downloadTo(ctx, url, tmp); err != nil {
		tmp.Close()
		return "", err
	}
	tmp.Close()

	// Extract into a fresh <binDir>/git (replace any previous install so a
	// re-run cleanly upgrades instead of mixing versions).
	dstRoot := filepath.Join(binDir, gitSubdir)
	if err := os.RemoveAll(dstRoot); err != nil {
		return "", fmt.Errorf("清理旧的 Git 目录失败: %w", err)
	}
	if err := extractZipTree(tmpPath, dstRoot); err != nil {
		return "", err
	}

	gitExe := filepath.Join(dstRoot, "cmd", "git.exe")
	if fi, err := os.Stat(gitExe); err != nil || fi.IsDir() {
		return "", fmt.Errorf("安装包中未找到 git.exe（cmd/git.exe）")
	}
	return gitExe, nil
}

// pickMinGitAsset selects the MinGit archive for goarch. Git for Windows names
// releases like:
//
//	MinGit-2.55.0.3-64-bit.zip           (amd64)
//	MinGit-2.55.0.3-arm64.zip            (arm64)
//	MinGit-2.55.0.3-busybox-64-bit.zip   (busybox variant — skipped)
//
// We take the non-busybox MinGit zip for the arch (busybox trims tools we may
// rely on, so prefer the full MinGit).
func pickMinGitAsset(rel *ghRelease, goarch string) (string, error) {
	archToken := map[string]string{"amd64": "64-bit", "arm64": "arm64", "386": "32-bit"}[goarch]
	if archToken == "" {
		return "", fmt.Errorf("暂不支持在该架构上自动安装 Git (%s)", goarch)
	}
	suffix := "-" + archToken + ".zip"
	for _, a := range rel.Assets {
		name := path.Base(a.URL)
		if !strings.HasPrefix(name, "MinGit-") || !strings.HasSuffix(name, suffix) {
			continue
		}
		if strings.Contains(name, "busybox") {
			continue
		}
		return a.URL, nil
	}
	return "", fmt.Errorf("未找到匹配 windows/%s 的 Git 安装包", goarch)
}

// extractZipTree unpacks every file in the archive under dstRoot, preserving the
// directory layout. It guards against Zip-Slip (entries escaping dstRoot) and
// preserves the executable bit so git.exe and its helpers stay runnable.
func extractZipTree(archivePath, dstRoot string) error {
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("解压安装包失败: %w", err)
	}
	defer zr.Close()

	if err := os.MkdirAll(dstRoot, 0o755); err != nil {
		return fmt.Errorf("创建 Git 目录失败: %w", err)
	}
	rootClean := filepath.Clean(dstRoot)
	for _, f := range zr.File {
		target := filepath.Join(dstRoot, filepath.FromSlash(f.Name))
		// Zip-Slip guard: the resolved path must stay inside dstRoot.
		if target != rootClean && !strings.HasPrefix(target, rootClean+string(os.PathSeparator)) {
			return fmt.Errorf("安装包包含非法路径: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("创建目录失败: %w", err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("创建目录失败: %w", err)
		}
		if err := writeZipEntry(f, target); err != nil {
			return err
		}
	}
	return nil
}

// writeZipEntry streams a single zip entry to target, keeping its file mode
// (so .exe stays executable). Split out for readability and defer scoping.
func writeZipEntry(f *zip.File, target string) error {
	rc, err := f.Open()
	if err != nil {
		return fmt.Errorf("读取安装包失败: %w", err)
	}
	defer rc.Close()
	mode := f.Mode()
	if mode == 0 {
		mode = 0o755
	}
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode|0o200)
	if err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	defer out.Close()
	if _, err := io.Copy(out, rc); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	return nil
}
